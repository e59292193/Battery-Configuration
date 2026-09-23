import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './lib/env.js';
import { errorMiddleware, corsMiddleware, rateLimitMiddleware, authMiddleware, logRequest } from './lib/errors.js';
import healthRoutes from './routes/health.js';
import modelsRoutes from './routes/models.js';
import chatRoutes from './routes/chat.js';
import parseRoutes from './routes/parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');

// ── 基础中间件 ──
app.use(express.json({ limit: '50mb' }));               // 允许前端直发多图 base64（上游上限 48MiB）
app.use(corsMiddleware);
app.use(rateLimitMiddleware);
app.use('/api', authMiddleware);                        // 可选访问口令（API_AUTH_TOKEN 未配置时放行）

// 请求耗时记录
app.use((req, _res, next) => { req._start = Date.now(); next(); });
app.use((req, res, next) => {
    res.on('finish', () => {
        req._durMs = Date.now() - (req._start || Date.now());
        if (req.path.startsWith('/api') && !req.path.startsWith('/api/chat') && !req.path.startsWith('/api/parse')) {
            logRequest(req, { status: res.statusCode });
        }
    });
    next();
});

// ── API 路由（router 内部各自定义 /health /models /chat /parse 子路径）──
app.use('/api', healthRoutes);
app.use('/api', modelsRoutes);
app.use('/api', chatRoutes);
app.use('/api', parseRoutes);
app.get('/api', (_req, res) => res.json({ ok: true, endpoints: ['/api/health', '/api/models', '/api/chat', '/api/parse'] }));

// ── 静态托管前端（前后端同源，彻底规避 CORS）──
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get(/^\/(?!api\/).*/, (_req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    res.status(404).send('index.html 未找到（public/ 目录缺失）');
});

// ── 统一错误处理 ──
app.use(errorMiddleware);

app.listen(env.port, () => {
    console.log(`[battery-configuration] 服务已启动: http://localhost:${env.port}`);
    console.log(`  服务端密钥: ${env.deepseekKey ? '已配置（.env）' : '未配置（可在前端设置面板填个人密钥）'}`);
    console.log(`  访问口令: ${env.apiAuthToken ? '已启用（API_AUTH_TOKEN）' : '未启用（公网部署建议配置）'}`);
    console.log(`  限流: ${env.rateLimit} 次/IP/分钟`);
});
