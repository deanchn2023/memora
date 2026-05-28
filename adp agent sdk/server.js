/**
 * ADP Agent Chat SDK — Server
 * 
 * 极简后端：仅提供 ADP V2 SSE 代理 + 文件代理
 * 适用于任意前端项目嵌入
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load .env (optional)
try {
  const dotenv = await import('dotenv');
  dotenv.config();
} catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3201;
const ADP_APP_KEY = process.env.ADP_APP_KEY || '';
const ADP_URL = process.env.ADP_URL || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';

if (!ADP_APP_KEY) {
  console.warn('⚠️  未配置 ADP_APP_KEY，请在 .env 文件中设置。');
}

const app = Fastify({
  logger: false,
  keepAliveTimeout: 300000,
  requestTimeout: 0,
  connectionTimeout: 0,
});

await app.register(cors, { origin: true });
await app.register(staticPlugin, {
  root: path.join(__dirname, 'public'),
  prefix: '/',
  decorateReply: false,
});

// ============ File Proxy (for iframe preview) ============

const ALLOWED_DOMAINS = [
  'https://wss.lke.cloud.tencent.com/',
  'https://sandbox.adp.cloud.tencent.com/',
];

app.get('/api/agent/file', async (req, reply) => {
  const fileUrl = req.query.url;
  if (!fileUrl) return reply.code(400).send('Missing url parameter');

  const isAllowed = ALLOWED_DOMAINS.some(d => fileUrl.startsWith(d));
  if (!isAllowed) return reply.code(403).send('Only ADP file URLs are allowed');

  try {
    const res = await fetch(fileUrl, { headers: { 'User-Agent': 'ADPAgentSDK/1.0' } });
    if (!res.ok) {
      if (res.status === 401) {
        reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f7;color:#1d1d1f}
.card{background:#fff;border-radius:16px;padding:32px 40px;box-shadow:0 2px 16px rgba(0,0,0,0.08);text-align:center;max-width:420px}
.icon{font-size:48px;margin-bottom:16px}h3{font-size:18px;font-weight:600;margin:0 0 8px}
p{font-size:14px;color:#86868b;margin:0 0 20px;line-height:1.5}
a{color:#007AFF;text-decoration:none;font-weight:500}
</style></head><body><div class="card">
<div class="icon">🔐</div><h3>文件链接已过期</h3>
<p>该文件链接的访问凭证已失效，请回到对话中重新获取。</p>
<a href="javascript:window.close()">关闭</a></div></body></html>`);
        return;
      }
      return reply.code(res.status).send(await res.text());
    }
    const contentType = res.headers.get('content-type') || 'text/html';
    reply.type(contentType).send(await res.text());
  } catch (e) {
    reply.code(502).send(`Proxy error: ${e.message}`);
  }
});

// ============ ADP Agent Chat Proxy (SSE) ============

app.post('/api/agent/chat', async (req, reply) => {
  const { message, conversation_id, visitor_id } = req.body || {};
  if (!message) return reply.code(400).send({ error: 'message is required' });

  function generateId(len = 32) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  const requestBody = {
    RequestId: generateId(32),
    ConversationId: conversation_id || generateId(32),
    AppKey: ADP_APP_KEY,
    VisitorId: visitor_id || generateId(32),
    Contents: [{ Type: 'text', Text: message }],
    Incremental: true,
    Stream: 'enable',
    StreamingThrottle: 5,
  };

  // SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });

  // Prevent Node.js timeout
  reply.raw.setTimeout(0);
  if (reply.raw.socket) reply.raw.socket.setKeepAlive(true, 15000);

  // Heartbeat every 15s
  const heartbeatInterval = setInterval(() => {
    if (!reply.raw.writableEnded) reply.raw.write(': heartbeat\n\n');
  }, 15000);

  try {
    const adpRes = await fetch(ADP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!adpRes.ok) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: `ADP API ${adpRes.status}` })}\n\n`);
      clearInterval(heartbeatInterval);
      reply.raw.end();
      return;
    }

    const reader = adpRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      reply.raw.write(decoder.decode(value, { stream: true }));
    }

    clearInterval(heartbeatInterval);
    reply.raw.end();
  } catch (e) {
    clearInterval(heartbeatInterval);
    if (!reply.raw.writableEnded) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
      reply.raw.end();
    }
  }
});

// ============ Start ============

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`🚀 ADP Agent SDK Server running at http://localhost:${PORT}`);
  console.log(`📝 Chat endpoint: POST http://localhost:${PORT}/api/agent/chat`);
  console.log(`📎 File proxy: GET http://localhost:${PORT}/api/agent/file?url=<url>`);
} catch (err) {
  console.error('Failed to start:', err.message);
  process.exit(1);
}
