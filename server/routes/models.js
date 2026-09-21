import { Router } from 'express';
import { env } from '../lib/env.js';
import { httpError, mapUpstreamError, logRequest } from '../lib/errors.js';

const router = Router();

// 5 分钟内存缓存
let cache = { ts: 0, data: null };
const CACHE_TTL = 5 * 60 * 1000;

/** GET /api/models — 代转 DeepSeek 模型列表（带缓存） */
router.get('/models', async (req, res, next) => {
    const key = req.get('X-User-Api-Key') || env.deepseekKey;
    if (!key) {
        return next(httpError(400, 'NO_KEY', '未配置 API Key：请在 AI 设置面板填写个人密钥，或在服务端 .env 配置 DEEPSEEK_API_KEY。'));
    }
    const start = Date.now();
    try {
        if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
            req._durMs = Date.now() - start;
            logRequest(req, { status: 200, cached: true });
            return res.json(cache.data);
        }
        const r = await fetch(env.upstream + '/models', {
            headers: { Authorization: 'Bearer ' + key },
            signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) {
            const txt = await r.text().catch(() => '');
            throw mapUpstreamError(r.status, txt);
        }
        const j = await r.json();
        cache = { ts: Date.now(), data: j };
        req._durMs = Date.now() - start;
        logRequest(req, { status: 200 });
        res.json(j);
    } catch (e) {
        next(e);
    }
});

export default router;
