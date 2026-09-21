import { env } from './env.js';

/** 构造带业务码的 HTTP 错误 */
export function httpError(status, code, message) {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
}

/** 上游状态码 → 结构化错误（code + 中文 message） */
export function mapUpstreamError(status, bodyText) {
    let upstreamMsg = '';
    try {
        const j = JSON.parse(bodyText);
        upstreamMsg = (j.error && j.error.message) || j.message || '';
    } catch { /* 非 JSON 响应体 */ }
    switch (status) {
        case 400: return httpError(400, 'UPSTREAM_BAD_REQUEST', '上游拒绝请求（400）：' + (upstreamMsg || '请求参数不合法。'));
        case 401: return httpError(401, 'AUTH_FAILED', 'API Key 无效或已过期（401），请在 AI 设置中检查密钥。');
        case 402: return httpError(402, 'INSUFFICIENT_BALANCE', 'DeepSeek 账户余额不足（402），请前往平台充值。');
        case 429: return httpError(429, 'RATE_LIMITED', '请求过于频繁或触发上游限流（429），请稍后再试。');
        case 502: case 503: case 504:
            return httpError(502, 'UPSTREAM_UNAVAILABLE', '上游服务暂时不可用（' + status + '），请稍后再试。');
        default:
            return httpError(status >= 500 ? 502 : status, 'UPSTREAM_ERROR',
                '上游返回 ' + status + '：' + (upstreamMsg || '未知错误。'));
    }
}

/** 统一错误中间件：所有未捕获错误 → 结构化 JSON */
export function errorMiddleware(err, req, res, _next) {
    // 客户端主动断开 / 上游中断：不再写响应
    if (res.writableEnded || res.destroyed) return;
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    let code = err.code || 'INTERNAL';
    let message = err.message || '服务器内部错误';
    if (err.type === 'entity.too.large') { code = 'PAYLOAD_TOO_LARGE'; message = '请求体过大，超出服务器限制。'; }
    if (err.code === 'LIMIT_FILE_SIZE') { code = 'FILE_TOO_LARGE'; message = '单个文件超过 20MB 上限。'; }
    if (err.code === 'LIMIT_FILE_COUNT') { code = 'TOO_MANY_FILES'; message = '单次最多上传 10 个文件。'; }
    if (err.name === 'TimeoutError' || err.name === 'AbortError') { code = 'TIMEOUT'; message = '请求超时（上游 120 秒未响应）。'; }
    if (status === 500) console.error('[error]', req.method, req.path, err.message);
    res.status(status).json({ ok: false, code, message });
}

/** 简单日志（严禁打印密钥与文件内容） */
export function logRequest(req, extra = {}) {
    const t = new Date().toISOString();
    const parts = [`[${t}]`, req.method, req.path, `${req._durMs ?? '-'}ms`];
    if (extra.model) parts.push('model=' + extra.model);
    if (extra.usage) parts.push('tokens=' + JSON.stringify(extra.usage));
    if (extra.status) parts.push('status=' + extra.status);
    console.log(parts.join(' '));
}

/** CORS：默认同源托管无需跨域；仅当配置了 ALLOWED_ORIGINS 且来源匹配时放行 */
export function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    if (origin && env.allowedOrigins[0] !== '*') {
        if (env.allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Api-Key');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        }
    } else if (origin) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Api-Key');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
}

/** 简单内存限流：每 IP 每分钟 env.rateLimit 次 */
const buckets = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}, 60_000).unref();

export function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + 60_000 }; buckets.set(ip, b); }
    b.count++;
    if (b.count > env.rateLimit) {
        return next(httpError(429, 'TOO_MANY_REQUESTS', `请求过于频繁（每 IP 每分钟上限 ${env.rateLimit} 次），请稍后再试。`));
    }
    next();
}
