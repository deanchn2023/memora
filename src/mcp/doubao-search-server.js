#!/usr/bin/env node
/**
 * 豆包搜索 MCP Server
 * 为 CC Agent 提供联网搜索工具
 *
 * 工具：web_search(query, count?) → 搜索结果摘要
 *
 * 环境变量：
 *   ARK_API_KEY  - 火山方舟 API Key
 *   ARK_BASE_URL - 火山方舟 Base URL
 */

const MCPBaseServer = require('./mcp-base');

const server = new MCPBaseServer('doubao-search', '1.0.0');

const ARK_API_KEY = process.env.ARK_API_KEY || '';
const ARK_BASE_URL = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/agent';

/**
 * 调用豆包搜索 Harness API
 * ⚠️ API 格式为推测值，购买 Agent Plan 后需确认实际格式
 */
async function executeSearch(query, count = 5) {
  if (!ARK_API_KEY) {
    return server.errorResult('ARK_API_KEY 未配置');
  }

  const url = `${ARK_BASE_URL.replace(/\/+$/, '')}/harnesses/doubao_search`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ARK_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ query, count }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Search API error: HTTP ${resp.status} - ${errText.substring(0, 200)}`);
  }

  const data = await resp.json();
  // 格式化搜索结果
  const results = data.results || data.data || [];
  if (results.length === 0) {
    return server.textResult(`未找到与 "${query}" 相关的搜索结果。`);
  }

  const formatted = results.map((r, i) => {
    const title = r.title || r.name || '';
    const url = r.url || r.link || '';
    const snippet = r.snippet || r.description || r.content || '';
    return `${i + 1}. **${title}**\n   ${url}\n   ${snippet}`;
  }).join('\n\n');

  return server.textResult(`搜索 "${query}" 的结果：\n\n${formatted}`);
}

// 注册搜索工具
server.registerTool(
  {
    name: 'web_search',
    description: '使用豆包搜索引擎搜索互联网信息，返回实时搜索结果。适用于查询最新技术文档、API 文档、新闻等。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        count: { type: 'number', description: '返回结果数量（默认5）', default: 5 },
      },
      required: ['query'],
    },
  },
  async (args) => {
    try {
      return await executeSearch(args.query, args.count);
    } catch (err) {
      return server.errorResult(err.message);
    }
  }
);

server.start();
console.error('[doubao-search] MCP Server started');
