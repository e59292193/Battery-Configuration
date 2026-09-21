import multer from 'multer';
import * as XLSX from 'xlsx';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Router } from 'express';
import { env } from '../lib/env.js';
import { httpError, logRequest } from '../lib/errors.js';

// pdfjs-dist legacy build（纯 JS 文本提取；DOMMatrix/Path2D 警告仅影响位图渲染，不影响文本层）
const require = createRequire(import.meta.url);
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const PDF_FONT_DIR = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;

const router = Router();

const ALLOWED = {
    excel: ['xlsx', 'xls', 'csv'],
    pdf: ['pdf'],
    image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
};
const ALL_EXTS = [...ALLOWED.excel, ...ALLOWED.pdf, ...ALLOWED.image];

// 内存流处理，不落盘
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.maxFileBytes, files: env.maxFiles },
    fileFilter: (_req, file, cb) => {
        const ext = (file.originalname.split('.').pop() || '').toLowerCase();
        if (!ALL_EXTS.includes(ext)) {
            return cb(httpError(400, 'UNSUPPORTED_TYPE', `不支持的文件类型: ${ext}（允许: ${ALL_EXTS.join('/')}）`));
        }
        cb(null, true);
    },
});

/** Excel/CSV → 结构化文本（保留工作表名/表头/行数据，超长截断） */
function excelToText(buffer, filename) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    let out = `文件: ${filename}\n`;
    let truncated = false;
    for (const sn of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
        out += `\n[工作表: ${sn}] 共 ${rows.length} 行\n`;
        rows.slice(0, 200).forEach(r => { out += r.map(c => String(c)).join('\t') + '\n'; });
        if (rows.length > 200) { truncated = true; out += `…（其余 ${rows.length - 200} 行已截断）\n`; }
    }
    if (out.length > 60_000) { out = out.slice(0, 60_000) + '\n…（内容过长已截断）'; truncated = true; }
    if (truncated) out += '\n[注意: 文件内容已按行截断]';
    return out.trim();
}

/** 图片 → sharp 压缩（长边 ≤1600px）→ base64 dataURL（BMP 等统一转 JPEG） */
async function imageToDataUrl(buffer) {
    const out = await sharp(buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
    return 'data:image/jpeg;base64,' + out.toString('base64');
}

/** 单文件解析 */
async function parseOne(file) {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const base = { filename: file.originalname, size: file.size };
    try {
        if (ALLOWED.excel.includes(ext)) {
            const text = excelToText(file.buffer, file.originalname);
            return { ...base, kind: 'excel', status: text ? 'ok' : 'empty', text };
        }
        if (ext === 'pdf') {
            const doc = await pdfjsLib.getDocument({
                data: new Uint8Array(file.buffer),
                standardFontDataUrl: PDF_FONT_DIR,
                disableFontFace: true,
                useSystemFonts: false,
            }).promise;
            let text = '';
            const maxPages = Math.min(doc.numPages, 60);
            for (let i = 1; i <= maxPages; i++) {
                const page = await doc.getPage(i);
                const tc = await page.getTextContent();
                text += `\n[第 ${i} 页]\n` + tc.items.map(it => it.str).join(' ');
            }
            text = text.trim();
            if (text.replace(/\s/g, '').length < 20) {
                // 无文本层（扫描件）→ 通知前端走视觉通道
                return { ...base, kind: 'pdf', status: 'ok', needsVision: true, text: '', pages: doc.numPages };
            }
            if (doc.numPages > maxPages) text += `\n…（共 ${doc.numPages} 页，仅提取前 ${maxPages} 页）`;
            return { ...base, kind: 'pdf', status: 'ok', text, pages: doc.numPages };
        }
        // 图片
        const dataUrl = await imageToDataUrl(file.buffer);
        return { ...base, kind: 'image', status: 'ok', images: [dataUrl], text: '' };
    } catch (e) {
        return { ...base, kind: 'unknown', status: 'error', message: '解析失败: ' + (e.message || '未知错误') };
    }
}

/** POST /api/parse — multipart 多文件解析（Excel/CSV/PDF/图片） */
router.post('/parse', upload.array('files', env.maxFiles), async (req, res, next) => {
    const start = Date.now();
    try {
        const files = req.files || [];
        if (!files.length) return next(httpError(400, 'NO_FILES', '未收到任何文件。'));
        let total = files.reduce((s, f) => s + f.size, 0);
        if (total > env.maxTotalBytes) {
            return next(httpError(413, 'PAYLOAD_TOO_LARGE', '单次上传总大小超过 60MB 上限。'));
        }
        const results = await Promise.all(files.map(parseOne));
        req._durMs = Date.now() - start;
        logRequest(req, { status: 200, count: files.length });
        res.json({ ok: true, results });
    } catch (e) {
        next(e);
    }
});

export default router;
