/**
 * ─────────────────────────────────────────────────────────────────
 * Cloudflare Worker 代理（可选部署方式，适合不想运行 Node 服务的场景）
 *
 * 部署步骤：
 *   1. Cloudflare Dashboard → Workers → Create Worker，粘贴本文件
 *   2. Settings → Variables → 添加 DEEPSEEK_API_KEY（加密）
 *      （不配置也可以：前端设置面板里填个人密钥，经 X-User-Api-Key 头传入）
 *   3. 前端「AI 设置 → 服务地址」填 https://<你的子域>.workers.dev/api
 *
 * 说明：
 *   - /api/health 与 /api/models、/api/chat（含 SSE 逐块透传）完整支持
 *   - /api/parse 不支持（Worker 无法做 Excel/PDF 解析）；
 *     前端在该接口失败时会自动回退到浏览器本地解析（SheetJS / pdf.js）
 * ─────────────────────────────────────────────────────────────────
 */
const UPSTREAM = 'https://api.deepseek.com';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Api-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/** JSON 响应 */
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
    });
}

/** 上游错误 → 结构化 JSON */
function mapUpstream(status, bodyText) {
    let msg = '';
    try { const j = JSON.parse(bodyText); msg = (j.error && j.error.message) || j.message || ''; } catch {}
    const map = {
        400: ['UPSTREAM_BAD_REQUEST', '上游拒绝请求（400）：' + (msg || '参数不合法')],
        401: ['AUTH_FAILED', 'API Key 无效或已过期（401）'],
        402: ['INSUFFICIENT_BALANCE', 'DeepSeek 账户余额不足（402）'],
        429: ['RATE_LIMITED', '请求过于频繁或触发限流（429）'],
    };
    const [code, message] = map[status] || ['UPSTREAM_ERROR', '上游返回 ' + status + '：' + (msg || '未知错误')];
    return json({ ok: false, code, message }, status >= 500 ? 502 : status);
}

// 模型列表 5 分钟内存缓存（Worker 实例级）
let modelsCache = { ts: 0, data: null };
const CACHE_TTL = 5 * 60 * 1000;

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';
        const key = request.headers.get('X-User-Api-Key') || env.DEEPSEEK_API_KEY || '';

        // ── 健康检查 ──
        if (path === '/api/health') {
            return json({ ok: true, service: 'cloudflare-worker', hasServerKey: !!env.DEEPSEEK_API_KEY });
        }

        // ── 模型列表（带缓存）──
        if (path === '/api/models') {
            if (!key) return json({ ok: false, code: 'NO_KEY', message: '未配置 API Key（服务端变量或前端个人密钥）' }, 400);
            if (modelsCache.data && Date.now() - modelsCache.ts < CACHE_TTL) {
                return json(modelsCache.data);
            }
            try {
                const r = await fetch(UPSTREAM + '/models', {
                    headers: { Authorization: 'Bearer ' + key },
                    signal: AbortSignal.timeout(15000),
                });
                if (!r.ok) return mapUpstream(r.status, await r.text().catch(() => ''));
                const data = await r.json();
                modelsCache = { ts: Date.now(), data };
                return json(data);
            } catch (e) {
                return json({ ok: false, code: 'UPSTREAM_ERROR', message: '请求上游失败：' + e.message }, 502);
            }
        }

        // ── Chat Completions（SSE 逐块透传，客户端中断即断上游）──
        if (path === '/api/chat') {
            if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: '请使用 POST' }, 405);
            if (!key) return json({ ok: false, code: 'NO_KEY', message: '未配置 API Key（服务端变量或前端个人密钥）' }, 400);
            let body;
            try { body = await request.json(); } catch { return json({ ok: false, code: 'BAD_REQUEST', message: '请求体不是合法 JSON' }, 400); }
            if (!Array.isArray(body.messages) || !body.messages.length) {
                return json({ ok: false, code: 'BAD_REQUEST', message: 'messages 不能为空' }, 400);
            }
            try {
                const upstream = await fetch(UPSTREAM + '/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
                    body: JSON.stringify(body),
                    signal: request.signal,           // 客户端中断 → 上游同步取消
                });
                if (!upstream.ok) return mapUpstream(upstream.status, await upstream.text().catch(() => ''));
                // 直接把上游流式 body 透传给客户端（不缓冲）
                return new Response(upstream.body, {
                    status: 200,
                    headers: {
                        'Content-Type': upstream.headers.get('content-type') || 'application/json',
                        'Cache-Control': 'no-cache, no-transform',
                        'X-Accel-Buffering': 'no',
                        ...CORS_HEADERS,
                    },
                });
            } catch (e) {
                if (request.signal.aborted) return new Response(null, { status: 499 });
                return json({ ok: false, code: 'UPSTREAM_ERROR', message: '请求上游失败：' + e.message }, 502);
            }
        }

        // ── 文件解析：Worker 不支持，前端会自动回退本地解析 ──
        if (path === '/api/parse') {
            return json({
                ok: false,
                code: 'NOT_SUPPORTED',
                message: 'Cloudflare Worker 不支持文件解析，前端将自动改用浏览器本地解析（SheetJS / pdf.js）。',
            }, 501);
        }

        return json({ ok: false, code: 'NOT_FOUND', message: '未知路径，可用端点：/api/health /api/models /api/chat /api/parse' }, 404);
    },
};
