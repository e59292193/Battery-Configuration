import { Router } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../lib/env.js';
import { httpError, mapUpstreamError, logRequest } from '../lib/errors.js';

const router = Router();

/**
 * POST /api/chat — 代转 chat/completions
 * - 支持 stream:true 的 SSE 逐块透传（不缓冲整个响应）
 * - 客户端中断（AbortController / 连接关闭）→ 同步断开上游
 * - 密钥优先级：X-User-Api-Key 请求头 > 服务端 .env
 */
router.post('/chat', async (req, res, next) => {
    const key = req.get('X-User-Api-Key') || env.deepseekKey;
    if (!key) {
        return next(httpError(400, 'NO_KEY', '未配置 API Key：请在 AI 设置面板填写个人密钥，或在服务端 .env 配置 DEEPSEEK_API_KEY。'));
    }
    const body = req.body || {};
    const { model = 'deepseek-flash', messages, stream = false, temperature, max_tokens } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
        return next(httpError(400, 'BAD_REQUEST', 'messages 不能为空。'));
    }
    // 模型名格式 + 可选白名单：防止任意模型名/参数注入消耗额度
    if (typeof model !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(model)) {
        return next(httpError(400, 'BAD_MODEL', 'model 不合法。'));
    }
    if (env.modelAllowlist.length && !env.modelAllowlist.includes(model)) {
        return next(httpError(400, 'MODEL_NOT_ALLOWED', `模型 ${model} 不在服务端白名单内。`));
    }
    // 消息体积上限：上下文是主要成本来源，超限直接拒绝
    let approxChars = 0;
    try { approxChars = JSON.stringify(messages).length; } catch { approxChars = Infinity; }
    if (approxChars > env.maxMessagesChars) {
        return next(httpError(413, 'MESSAGES_TOO_LARGE', '消息体积超过上限（约 3MB），请清空历史或缩减附件后重试。'));
    }

    const start = Date.now();
    const upstreamAbort = new AbortController();
    let clientGone = false;
    // 注意：req 的 'close' 事件在报文读取完成后即触发（Node 13+ 语义），
    // 不能用于判断客户端断开；应监听 res 'close' 且响应未正常结束时才视为断开。
    res.on('close', () => {
        if (!res.writableEnded) { clientGone = true; upstreamAbort.abort(); }
    });
    const timer = setTimeout(() => upstreamAbort.abort(new Error('upstream timeout')), env.upstreamTimeoutMs);

    try {
        const upstream = await fetch(env.upstream + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
            body: JSON.stringify({ model, messages, stream, temperature, max_tokens }),
            signal: upstreamAbort.signal,
        });

        if (!upstream.ok) {
            const txt = await upstream.text().catch(() => '');
            clearTimeout(timer);
            throw mapUpstreamError(upstream.status, txt);
        }

        if (stream && upstream.body) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders?.();
            try {
                await pipeline(Readable.fromWeb(upstream.body), res);
            } catch (e) {
                // 客户端中断导致 pipeline 报错属正常现象
                if (!clientGone) throw e;
            }
            clearTimeout(timer);
            req._durMs = Date.now() - start;
            if (!clientGone) logRequest(req, { model, status: 200, stream: true });
            if (!res.writableEnded) res.end();
            return;
        }

        const data = await upstream.json();
        clearTimeout(timer);
        req._durMs = Date.now() - start;
        logRequest(req, { model, status: 200, usage: data.usage || undefined });
        res.json(data);
    } catch (e) {
        clearTimeout(timer);
        if (clientGone) return;                 // 客户端已断开，无需响应
        if (e.name === 'AbortError' || e.name === 'TimeoutError') {
            return next(httpError(504, 'TIMEOUT', '上游请求超时（120 秒），请稍后重试或减小输入规模。'));
        }
        next(e);
    }
});

export default router;
