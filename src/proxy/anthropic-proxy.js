/**
 * Anthropic-to-OpenAI Proxy
 * 
 * Translates Anthropic Messages API (POST /v1/messages) to OpenAI Chat Completions API,
 * allowing Claude Code Agent SDK to work with any OpenAI-compatible backend (e.g., OpenRouter).
 * 
 * Reference: https://github.com/1rgs/claude-code-proxy (3.6k stars, Python + LiteLLM)
 * Adapted to pure Node.js for embedding in Electron main process.
 */

const http = require('http');

// ─── Request Translation: Anthropic → OpenAI ───

function translateMessages(anthropicMessages, systemPrompt) {
  const openaiMessages = [];

  // System prompt: Anthropic uses top-level field, OpenAI uses a message
  if (systemPrompt) {
    // systemPrompt can be string or array of content blocks
    if (typeof systemPrompt === 'string') {
      openaiMessages.push({ role: 'system', content: systemPrompt });
    } else if (Array.isArray(systemPrompt)) {
      // Extract text from content blocks
      const text = systemPrompt
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');
      if (text) openaiMessages.push({ role: 'system', content: text });
    }
  }

  for (const msg of anthropicMessages) {
    const role = msg.role;

    // String content (simple text)
    if (typeof msg.content === 'string') {
      openaiMessages.push({ role, content: msg.content });
      continue;
    }

    // Array content (content blocks)
    if (Array.isArray(msg.content)) {
      const textParts = [];
      const toolCalls = [];
      const toolResults = [];
      let hasImage = false;
      const imageParts = [];

      for (const block of msg.content) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
            },
          });
        } else if (block.type === 'tool_result') {
          // Tool results: extract content (can be string or array of blocks)
          let resultContent = '';
          if (typeof block.content === 'string') {
            resultContent = block.content;
          } else if (Array.isArray(block.content)) {
            resultContent = block.content
              .filter(b => b.type === 'text')
              .map(b => b.text)
              .join('\n');
          } else if (block.content) {
            resultContent = String(block.content);
          }
          // If is_error, prepend error indicator
          if (block.is_error) {
            resultContent = `[ERROR] ${resultContent}`;
          }
          toolResults.push({
            tool_call_id: block.tool_use_id,
            content: resultContent,
          });
        } else if (block.type === 'image') {
          hasImage = true;
          // OpenAI image_url format: data:{media_type};base64,{data}
          if (block.source && block.source.type === 'base64') {
            imageParts.push({
              type: 'image_url',
              image_url: {
                url: `data:${block.source.media_type};base64,${block.source.data}`,
              },
            });
          }
        }
      }

      // Tool results become separate "tool" role messages
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          openaiMessages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content });
        }
        // If there's also text in the same message, add as user message
        if (textParts.length > 0) {
          openaiMessages.push({ role: 'user', content: textParts.join('\n') });
        }
        continue;
      }

      // Assistant message with tool calls
      if (toolCalls.length > 0) {
        openaiMessages.push({
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('\n') : null,
          tool_calls: toolCalls,
        });
        continue;
      }

      // Image content
      if (hasImage) {
        const content = [];
        if (textParts.length > 0) {
          content.push({ type: 'text', text: textParts.join('\n') });
        }
        content.push(...imageParts);
        openaiMessages.push({ role, content });
        continue;
      }

      // Text-only content blocks → flatten to string
      if (textParts.length > 0) {
        openaiMessages.push({ role, content: textParts.join('\n') });
      }
    }
  }

  return openaiMessages;
}

function translateTools(anthropicTools) {
  if (!Array.isArray(anthropicTools)) return undefined;
  return anthropicTools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }));
}

function translateToolChoice(anthropicChoice) {
  if (!anthropicChoice) return undefined;
  if (typeof anthropicChoice === 'string') return anthropicChoice;
  if (anthropicChoice.type === 'auto') return 'auto';
  if (anthropicChoice.type === 'any') return 'required';
  if (anthropicChoice.type === 'tool' && anthropicChoice.name) {
    return { type: 'function', function: { name: anthropicChoice.name } };
  }
  if (anthropicChoice.type === 'none') return 'none';
  return undefined;
}

function anthropicToOpenAI(body) {
  const messages = translateMessages(body.messages || [], body.system);

  const openaiBody = {
    model: body.model,
    messages,
    stream: body.stream || false,
  };

  // Max tokens (Anthropic requires it, OpenAI optional but supported)
  if (body.max_tokens) openaiBody.max_tokens = body.max_tokens;

  // Temperature
  if (body.temperature !== undefined) openaiBody.temperature = body.temperature;

  // Top P
  if (body.top_p !== undefined) openaiBody.top_p = body.top_p;

  // Top K → not directly supported by OpenAI, skip
  // Stop sequences
  if (body.stop_sequences && body.stop_sequences.length > 0) {
    openaiBody.stop = body.stop_sequences;
  }

  // Tools
  const tools = translateTools(body.tools);
  if (tools) openaiBody.tools = tools;

  // Tool choice
  const toolChoice = translateToolChoice(body.tool_choice);
  if (toolChoice) openaiBody.tool_choice = toolChoice;

  return openaiBody;
}

// ─── Response Translation: OpenAI → Anthropic ───

function mapFinishReason(openaiFinishReason) {
  switch (openaiFinishReason) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool_calls': return 'tool_use';
    case 'content_filter': return 'end_turn';
    default: return 'end_turn';
  }
}

function openaiToAnthropic(data) {
  const choice = data.choices?.[0];
  if (!choice) {
    return {
      id: data.id || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      model: data.model || '',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const content = [];
  const message = choice.message || {};

  // Text content
  if (message.content) {
    content.push({ type: 'text', text: message.content });
  }

  // Tool calls
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      let input = {};
      try {
        input = JSON.parse(tc.function.arguments || '{}');
      } catch (_) {
        input = { raw: tc.function.arguments };
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  // If no content, add empty text
  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  return {
    id: data.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: data.model || '',
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
  };
}

// ─── Streaming Translation ───

/**
 * Translates OpenAI SSE stream to Anthropic SSE stream.
 * 
 * OpenAI sends:  data: {"choices":[{"delta":{"content":"..."}}]}
 * Anthropic expects: event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
 */
async function translateStream(upstreamBody, res, requestModel) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // State
  let messageStarted = false;
  let contentBlockIndex = -1;
  let currentBlockType = null; // 'text' | 'tool_use' | null
  let toolCallIndexMap = new Map(); // OpenAI tool_call index → Anthropic content_block index
  let messageId = `msg_${Date.now()}`;
  let totalOutputTokens = 0;

  function sendSSE(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function startMessage() {
    if (messageStarted) return;
    messageStarted = true;
    sendSSE('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: requestModel,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  function startTextBlock() {
    contentBlockIndex++;
    currentBlockType = 'text';
    sendSSE('content_block_start', {
      type: 'content_block_start',
      index: contentBlockIndex,
      content_block: { type: 'text', text: '' },
    });
  }

  function startToolUseBlock(toolCall) {
    contentBlockIndex++;
    currentBlockType = 'tool_use';
    toolCallIndexMap.set(toolCall.index, contentBlockIndex);
    sendSSE('content_block_start', {
      type: 'content_block_start',
      index: contentBlockIndex,
      content_block: {
        type: 'tool_use',
        id: toolCall.id || `toolu_${Date.now()}_${contentBlockIndex}`,
        name: toolCall.function?.name || '',
        input: {},
      },
    });
  }

  function closeCurrentBlock() {
    if (currentBlockType !== null) {
      sendSSE('content_block_stop', {
        type: 'content_block_stop',
        index: contentBlockIndex,
      });
      currentBlockType = null;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const dataStr = trimmed.slice(6); // Remove "data: " prefix
        if (dataStr === '[DONE]') {
          // Close current block if open
          closeCurrentBlock();
          // Send message_delta and message_stop
          sendSSE('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: totalOutputTokens },
          });
          sendSSE('message_stop', { type: 'message_stop' });
          continue;
        }

        let chunk;
        try {
          chunk = JSON.parse(dataStr);
        } catch (_) {
          continue;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};

        startMessage();

        // Text content
        if (delta.content) {
          if (currentBlockType !== 'text') {
            closeCurrentBlock();
            startTextBlock();
          }
          sendSSE('content_block_delta', {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: { type: 'text_delta', text: delta.content },
          });
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const tcIndex = tc.index ?? 0;

            // New tool call (has id and function.name)
            if (tc.id || (tc.function?.name && !toolCallIndexMap.has(tcIndex))) {
              closeCurrentBlock();
              startToolUseBlock({ ...tc, index: tcIndex });
            }

            // Arguments delta
            if (tc.function?.arguments) {
              const blockIdx = toolCallIndexMap.get(tcIndex);
              if (blockIdx !== undefined) {
                sendSSE('content_block_delta', {
                  type: 'content_block_delta',
                  index: blockIdx,
                  delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
                });
              }
            }
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          closeCurrentBlock();
          const stopReason = mapFinishReason(choice.finish_reason);
          // Try to get usage from the chunk
          if (chunk.usage?.completion_tokens) {
            totalOutputTokens = chunk.usage.completion_tokens;
          }
          sendSSE('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: totalOutputTokens },
          });
          sendSSE('message_stop', { type: 'message_stop' });
        }
      }
    }

    // If we never got a [DONE] or finish_reason, close gracefully
    if (messageStarted && currentBlockType !== null) {
      closeCurrentBlock();
      sendSSE('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: totalOutputTokens },
      });
      sendSSE('message_stop', { type: 'message_stop' });
    }
  } catch (err) {
    console.error('[Proxy] Stream translation error:', err.message);
    if (messageStarted) {
      sendSSE('error', {
        type: 'error',
        error: { type: 'api_error', message: err.message },
      });
    }
  } finally {
    res.end();
  }
}

// ─── HTTP Server ───

function createAnthropicProxy({ getApiKey, getBaseUrl, getPort }) {
  let server = null;
  let actualPort = null;

  function handleMessages(req, res) {
    let bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', async () => {
      const bodyStr = Buffer.concat(bodyChunks).toString('utf-8');
      let anthropicReq;
      try {
        anthropicReq = JSON.parse(bodyStr);
      } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON' } }));
        return;
      }

      const apiKey = getApiKey();
      const baseUrl = getBaseUrl() || 'https://openrouter.ai/api/v1';

      if (!apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'OpenRouter API Key not configured' } }));
        return;
      }

      // Translate request
      const openaiReq = anthropicToOpenAI(anthropicReq);
      const isStream = anthropicReq.stream || false;
      const requestModel = anthropicReq.model || '';

      console.log(`[Proxy] ${requestModel} | stream=${isStream} | tools=${openaiReq.tools?.length || 0} | msgs=${openaiReq.messages?.length || 0}`);

      try {
        const upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://memora.app',
            'X-OpenRouter-Title': 'Memora M-Agent',
          },
          body: JSON.stringify(openaiReq),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          let errMsg = `HTTP ${upstream.status}`;
          try {
            const errJson = JSON.parse(errText);
            errMsg = errJson.error?.message || errJson.message || errMsg;
          } catch (_) {
            errMsg += `: ${errText.substring(0, 200)}`;
          }
          console.error('[Proxy] Upstream error:', upstream.status, errMsg);

          if (isStream) {
            res.writeHead(upstream.status, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
            });
            res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: errMsg } })}\n\n`);
            res.end();
          } else {
            res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: errMsg } }));
          }
          return;
        }

        if (isStream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          await translateStream(upstream.body, res, requestModel);
        } else {
          const openaiData = await upstream.json();
          const anthropicResp = openaiToAnthropic(openaiData);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(anthropicResp));
        }
      } catch (err) {
        console.error('[Proxy] Request error:', err.message);
        if (isStream) {
          res.writeHead(502, { 'Content-Type': 'text/event-stream' });
          res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: err.message } })}\n\n`);
          res.end();
        } else {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: err.message } }));
        }
      }
    });
  }

  async function handleModels(req, res) {
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl() || 'https://openrouter.ai/api/v1';

    if (!apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API Key not configured' }));
      return;
    }

    try {
      const upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      const data = await upstream.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Count tokens endpoint - return rough estimate (OpenRouter doesn't have this)
  function handleCountTokens(req, res) {
    let bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', () => {
      // Rough estimate: ~4 chars per token
      const bodyStr = Buffer.concat(bodyChunks).toString('utf-8');
      const estimatedTokens = Math.ceil(bodyStr.length / 4);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ input_tokens: estimatedTokens }));
    });
  }

  function start() {
    return new Promise((resolve, reject) => {
      const preferredPort = getPort() || 3999;

      function createServerHandler() {
        return http.createServer((req, res) => {
          // CORS headers for local access
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Headers', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

          if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }

          const url = req.url || '';

          if (req.method === 'POST' && url === '/v1/messages') {
            handleMessages(req, res);
          } else if (req.method === 'POST' && url === '/v1/messages/count_tokens') {
            handleCountTokens(req, res);
          } else if (req.method === 'GET' && url.startsWith('/v1/models')) {
            handleModels(req, res);
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
          }
        });
      }

      function tryListen(port) {
        const s = createServerHandler();
        s.on('error', (err) => {
          if (err.code === 'EADDRINUSE' && port < preferredPort + 10) {
            console.warn(`[Proxy] Port ${port} in use, trying ${port + 1}...`);
            tryListen(port + 1);
          } else {
            reject(err);
          }
        });
        s.listen(port, '127.0.0.1', () => {
          server = s;
          actualPort = port;
          console.log(`[Proxy] Anthropic proxy started on port ${actualPort}`);
          resolve(actualPort);
        });
      }

      tryListen(preferredPort);
    });
  }

  function stop() {
    if (server) {
      server.close();
      server = null;
      actualPort = null;
      console.log('[Proxy] Anthropic proxy stopped');
    }
  }

  function getPort_() {
    return actualPort;
  }

  return { start, stop, getPort: getPort_ };
}

module.exports = { createAnthropicProxy, anthropicToOpenAI, openaiToAnthropic };
