#!/usr/bin/env node
/**
 * 火山方舟多模态 MCP Server
 * 为 CC Agent 提供图片生成、视频生成工具
 *
 * 工具：
 *   generate_image(prompt, size?) → 图片 URL
 *   generate_video(prompt, duration?) → 视频 URL
 *
 * 环境变量：
 *   ARK_API_KEY  - 火山方舟 API Key
 *   ARK_BASE_URL - 火山方舟 Base URL
 *   IMAGE_MODEL  - 图像生成模型（默认 doubao-seedream-3-0）
 *   VIDEO_MODEL  - 视频生成模型（默认 seedance-2-0）
 */

const MCPBaseServer = require('./mcp-base');

const server = new MCPBaseServer('ark-multimodal', '1.0.0');

const ARK_API_KEY = process.env.ARK_API_KEY || '';
const ARK_BASE_URL = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/agent';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'doubao-seedream-3-0';
const VIDEO_MODEL = process.env.VIDEO_MODEL || 'seedance-2-0';

/**
 * 调用图像生成 API
 * ⚠️ API 格式为推测值，购买 Agent Plan 后需确认实际格式
 */
async function generateImage(prompt, size = '1024x1024') {
  if (!ARK_API_KEY) {
    return server.errorResult('ARK_API_KEY 未配置');
  }

  const url = `${ARK_BASE_URL.replace(/\/+$/, '')}/images/generations`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ARK_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      size,
      n: 1,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Image generation API error: HTTP ${resp.status} - ${errText.substring(0, 200)}`);
  }

  const data = await resp.json();
  const imageUrl = data.data?.[0]?.url || data.url || '';
  if (!imageUrl) {
    return server.errorResult('图像生成成功但未返回 URL');
  }

  return server.textResult(`图片已生成：\n${imageUrl}\n\nPrompt: ${prompt}\nSize: ${size}`);
}

/**
 * 调用视频生成 API
 * ⚠️ API 格式为推测值，购买 Agent Plan 后需确认实际格式
 */
async function generateVideo(prompt, duration = 5) {
  if (!ARK_API_KEY) {
    return server.errorResult('ARK_API_KEY 未配置');
  }

  const url = `${ARK_BASE_URL.replace(/\/+$/, '')}/videos/generations`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ARK_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: VIDEO_MODEL,
      prompt,
      duration,
    }),
    signal: AbortSignal.timeout(120000), // 视频生成可能较慢
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Video generation API error: HTTP ${resp.status} - ${errText.substring(0, 200)}`);
  }

  const data = await resp.json();
  const videoUrl = data.data?.[0]?.url || data.url || data.video_url || '';
  if (!videoUrl) {
    return server.errorResult('视频生成成功但未返回 URL');
  }

  return server.textResult(`视频已生成：\n${videoUrl}\n\nPrompt: ${prompt}\nDuration: ${duration}s`);
}

// 注册图像生成工具
server.registerTool(
  {
    name: 'generate_image',
    description: '使用火山方舟图像生成模型创建图片。适用于生成 UI 占位图、图标素材、插图等。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片描述（越详细效果越好）' },
        size: {
          type: 'string',
          enum: ['1024x1024', '1280x720', '768x1024'],
          description: '图片尺寸（默认 1024x1024）',
          default: '1024x1024',
        },
      },
      required: ['prompt'],
    },
  },
  async (args) => {
    try {
      return await generateImage(args.prompt, args.size);
    } catch (err) {
      return server.errorResult(err.message);
    }
  }
);

// 注册视频生成工具
server.registerTool(
  {
    name: 'generate_video',
    description: '使用火山方舟视频生成模型创建短视频。适用于生成演示视频、动画效果等。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频描述' },
        duration: { type: 'number', description: '时长（秒，默认5）', default: 5 },
      },
      required: ['prompt'],
    },
  },
  async (args) => {
    try {
      return await generateVideo(args.prompt, args.duration);
    } catch (err) {
      return server.errorResult(err.message);
    }
  }
);

server.start();
console.error('[ark-multimodal] MCP Server started');
