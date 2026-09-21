import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 迷你 .env 加载器（零依赖；不覆盖已存在的环境变量）──
try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) {
            process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
        }
    }
} catch { /* .env 不存在时忽略（可用真实环境变量） */ }

export const env = {
    port: Number(process.env.PORT || 3000),
    deepseekKey: process.env.DEEPSEEK_API_KEY || '',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean),
    rateLimit: Math.max(1, Number(process.env.RATE_LIMIT || 30)),
    upstream: 'https://api.deepseek.com',
    upstreamTimeoutMs: 120_000,
    // 上传限制
    maxFileBytes: 20 * 1024 * 1024,
    maxFiles: 10,
    maxTotalBytes: 60 * 1024 * 1024,
};
