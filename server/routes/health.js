import { Router } from 'express';
import { env } from '../lib/env.js';

const router = Router();

/** GET /api/health — 服务状态（只暴露布尔值，绝不返回密钥本身） */
router.get('/health', (_req, res) => {
    res.json({
        ok: true,
        service: 'battery-configuration',
        hasServerKey: !!env.deepseekKey,
        uptimeSec: Math.round(process.uptime()),
    });
});

export default router;
