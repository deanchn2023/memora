const { app, BrowserWindow, ipcMain, clipboard, Notification, Tray, Menu, nativeImage, powerMonitor, session, systemPreferences } = require('electron');
const os = require('os');

// 加载 .env 环境变量（开发时使用，打包后 .env 不存在则忽略）
try { require('dotenv').config(); } catch (_) {}

// 防止 EPIPE 崩溃：stdout/stderr 管道关闭时（如终端关闭），console.log 写入会抛出 EPIPE
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); });
process.stderr.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); });

// Electron 28 + macOS: getUserMedia + AudioContext 可能导致渲染进程 SIGSEGV(crashed 11)
// 禁用音频服务沙箱化可修复此问题（Chromium 已知 bug）
app.commandLine.appendSwitch('disable-features', 'AudioServiceSandbox,AudioServiceOutOfProcess');
// 禁用 GPU 沙箱（可能干扰音频权限）
app.commandLine.appendSwitch('no-sandbox');
// 禁用音频服务独立进程，改为在渲染进程内处理
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 单实例锁：防止多个 Electron 实例同时运行（避免疯狂开窗口）
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // 如果已有实例在运行，直接退出
  app.quit();
}
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const FormData = require('form-data');

// Anthropic-to-OpenAI Proxy（OpenRouter 集成）
const { createAnthropicProxy } = require('./src/proxy/anthropic-proxy');
let anthropicProxy = null;
let anthropicProxyPort = null;

// SubTask Poller（异步子任务轮询）
const { subTaskPoller, extractTaskIds } = require('./src/proxy/subtask-poller');

// ─── Provider Registry（供应商注册表）───
const PROVIDER_REGISTRY = {
  volcano: {
    id: 'volcano',
    name: '火山引擎 Coding Plan',
    shortName: '火山引擎',
    region: 'cn',
    type: 'direct',           // Anthropic 兼容直连
    icon: '🌋',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: 'https://ark.cn-beijing.volces.com/api/coding' },
      { key: 'authToken', label: 'Auth Token', type: 'password', placeholder: 'ark-xxxxxxxx' },
      { key: 'modelList', label: '模型列表', type: 'textarea', default: '' },
      { key: 'model', label: '模型', type: 'select', default: 'auto', options: [
        { value: 'auto', label: 'Auto（智能调度）' },
      ]},
    ],
    envMap: (config) => ({
      ANTHROPIC_BASE_URL: config.baseUrl,
      ANTHROPIC_AUTH_TOKEN: config.authToken,
      ANTHROPIC_MODEL: config.model,
    }),
  },

  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DeepSeek',
    region: 'cn',
    type: 'direct',           // Anthropic 兼容直连
    icon: '🔵',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: 'https://api.deepseek.com/anthropic' },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-xxxxxxxx' },
      { key: 'modelList', label: '模型列表', type: 'textarea', default: '' },
      { key: 'model', label: '模型', type: 'select', options: [
        { value: 'deepseek-chat', label: 'DeepSeek Chat (快速)' },
        { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (推理)' },
      ]},
    ],
    envMap: (config) => ({
      ANTHROPIC_BASE_URL: config.baseUrl,
      ANTHROPIC_AUTH_TOKEN: config.apiKey,
      ANTHROPIC_MODEL: config.model,
    }),
  },

  tencent: {
    id: 'tencent',
    name: '腾讯云 Coding Plan',
    shortName: '腾讯云',
    region: 'cn',
    type: 'direct',           // Anthropic 兼容直连
    icon: '🐧',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: 'https://api.lkeap.cloud.tencent.com/coding/anthropic' },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-sp-xxxxxxxx' },
      { key: 'modelList', label: '模型列表', type: 'textarea', default: '' },
      { key: 'model', label: '模型', type: 'select', options: [
        { value: 'tc-code-latest', label: 'Auto (自动匹配)' },
        { value: 'minimax-m2.5', label: 'MiniMax-M2.5' },
        { value: 'kimi-k2.5', label: 'Kimi-K2.5' },
        { value: 'glm-5', label: 'GLM-5' },
        { value: 'hunyuan-t1', label: 'Hunyuan-T1' },
        { value: 'hunyuan-turbos', label: 'Hunyuan-TurboS' },
      ]},
    ],
    envMap: (config) => ({
      ANTHROPIC_BASE_URL: config.baseUrl,
      ANTHROPIC_AUTH_TOKEN: config.apiKey,
      ANTHROPIC_MODEL: config.model,
    }),
  },

  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter（海外多模型）',
    shortName: 'OpenRouter',
    region: 'global',
    type: 'proxy',            // OpenAI 格式，需代理翻译
    icon: '🌐',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: 'https://openrouter.ai/api/v1' },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-or-v1-xxxxxxxx' },
      { key: 'defaultModel', label: '默认模型', type: 'text', placeholder: 'anthropic/claude-sonnet-4' },
    ],
    proxyConfig: (config) => ({
      upstreamBaseUrl: config.baseUrl,
      upstreamApiKey: config.apiKey,
      upstreamAuthType: 'bearer',
    }),
  },

  volcano_agent: {
    id: 'volcano_agent',
    name: '火山引擎 Agent Plan',
    shortName: 'Agent Plan',
    region: 'cn',
    type: 'direct',           // Anthropic 兼容直连（与 Coding Plan 相同协议）
    icon: '🌋',
    plan: 'agent',            // 标记为 Agent Plan（用于区分 Coding Plan）
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: 'https://ark.cn-beijing.volces.com/api/agent' },
      { key: 'authToken', label: 'API Key', type: 'password', placeholder: 'ark-xxxxxxxx' },
      { key: 'modelList', label: '模型列表', type: 'textarea', default: '' },
      { key: 'model', label: '主模型', type: 'select', default: 'auto', options: [
        { value: 'auto', label: 'Auto（智能调度）' },
        { value: 'doubao-seed-1-6-vision', label: 'Doubao-Seed-1.6-Vision（代码+视觉）' },
        { value: 'doubao-seed-1-6', label: 'Doubao-Seed-1.6（纯文本）' },
        { value: 'deepseek-v3.1', label: 'DeepSeek-V3.1（推理）' },
      ]},
      // Agent Plan 专属：多模态模型路由
      { key: 'imageGenModel', label: '图像生成模型', type: 'select', default: 'doubao-seedream-3-0', options: [
        { value: 'doubao-seedream-3-0', label: 'Doubao-Seedream-3.0' },
      ]},
      { key: 'videoGenModel', label: '视频生成模型', type: 'select', default: 'seedance-2-0', options: [
        { value: 'seedance-2-0', label: 'Seedance-2.0' },
      ]},
      { key: 'embeddingModel', label: '向量化模型', type: 'select', default: 'doubao-embedding-text', options: [
        { value: 'doubao-embedding-text', label: 'Doubao-Embedding-Text' },
      ]},
      // Harness 开关
      { key: 'enableDoubaoSearch', label: '启用豆包搜索', type: 'toggle', default: 'true' },
      { key: 'enableAgentMemory', label: '启用 Agent 记忆', type: 'toggle', default: 'false' },
    ],
    envMap: (config) => ({
      ANTHROPIC_BASE_URL: config.baseUrl,
      ANTHROPIC_AUTH_TOKEN: config.authToken,
      ANTHROPIC_MODEL: config.model,
    }),
  },
};

// 读取供应商配置
function getProviderConfig(providerId) {
  const provider = PROVIDER_REGISTRY[providerId];
  if (!provider) return {};
  const config = {};
  for (const field of provider.fields) {
    config[field.key] = getSetting(`cc_provider_${providerId}_${field.key}`) || field.default || '';
  }
  config.enabled = getSetting(`cc_provider_${providerId}_enabled`) === 'true';
  return config;
}

// 判断供应商是否已配置
function isProviderConfigured(providerId) {
  const provider = PROVIDER_REGISTRY[providerId];
  if (!provider) return false;
  const config = getProviderConfig(providerId);
  return provider.fields
    .filter(f => f.type === 'password')
    .every(f => config[f.key] && config[f.key].trim() !== '');
}

// 获取所有供应商列表（含未配置的，前端按 configured 字段标记禁用）
function getAvailableProviders() {
  return Object.values(PROVIDER_REGISTRY)
    .sort((a, b) => {
      if (a.region === 'cn' && b.region !== 'cn') return -1;
      if (a.region !== 'cn' && b.region === 'cn') return 1;
      return a.name.localeCompare(b.name);
    });
}

// 旧配置迁移
function migrateOldCCConfig() {
  // 火山引擎：旧 cc_auth_token → 新 cc_provider_volcano_authToken
  if (getSetting('cc_auth_token') && !getSetting('cc_provider_volcano_authToken')) {
    setSetting('cc_provider_volcano_authToken', getSetting('cc_auth_token'));
    setSetting('cc_provider_volcano_baseUrl', getSetting('cc_base_url') || DEFAULT_CC_CONFIG.baseUrl);
    setSetting('cc_provider_volcano_model', getSetting('cc_model') || DEFAULT_CC_CONFIG.model);
    setSetting('cc_provider_volcano_enabled', 'true');
  }
  // OpenRouter：旧 cc_openrouter_api_key → 新 cc_provider_openrouter_apiKey
  if (getSetting('cc_openrouter_api_key') && !getSetting('cc_provider_openrouter_apiKey')) {
    setSetting('cc_provider_openrouter_apiKey', getSetting('cc_openrouter_api_key'));
    setSetting('cc_provider_openrouter_baseUrl', getSetting('cc_openrouter_base_url') || 'https://openrouter.ai/api/v1');
    setSetting('cc_provider_openrouter_defaultModel', getSetting('cc_openrouter_default_model') || '');
    setSetting('cc_provider_openrouter_enabled', 'true');
  }
}

// Claude Code Agent SDK（v2.7 CC 模式）— ESM 模块，需动态 import
let claudeAgentSDK = null;
// 异步加载 SDK（ESM 不能用 require，需动态 import）
async function loadClaudeAgentSDK() {
  if (claudeAgentSDK !== null) return claudeAgentSDK;
  try {
    claudeAgentSDK = await import('@anthropic-ai/claude-agent-sdk');
    console.log('[CC] Claude Agent SDK loaded successfully');
    return claudeAgentSDK;
  } catch (e) {
    console.warn('[CC] Claude Agent SDK not available:', e.message);
    claudeAgentSDK = false; // 标记加载失败，避免重复尝试
    return false;
  }
}
// 启动时预加载
loadClaudeAgentSDK();

// M-Agent 模式默认配置（Anthropic 兼容 API）
const DEFAULT_CC_CONFIG = {
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
  authToken: 'ark-08382ce6-d0e9-4e92-af7a-234062ee6091-2d675',
  model: 'auto',
  allowedTools: 'Read,Glob,Grep,WebSearch,Bash,Write,Edit',
  permissionMode: 'default',
  maxTurns: 50,
};

// 剪贴板智能监控系统
const { startClipboardWatcher, stopClipboardWatcher, getScheduler } = require('./clipboard');
const { getClipboardHash } = require('./clipboard/hashUtils');

let mainWindow;
let tray;
let clipboardWatcher;
let lastClipboardText = '';
let isAnalyzing = false; // 防止并发分析
let processedClipboardHashes = new Set();
let processedImageHashes = new Set();  // 剪贴板图片像素级 SHA-256 去重
const MAX_CLIPBOARD_HASHES = 500; // 限制哈希记录数量防止内存膨胀

// 🔧 辅助函数：同时输出到主进程终端和前端 DevTools
function _sendLog(msg) {
  console.log(msg);
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('clipboard-log', msg);
    } catch (_) {}
  }
}

// 数据库层（JSON文件存储）
const { Database } = require('./src/scripts/database');
let db;

// AI 调用审计日志
const AIAuditLogger = require('./auditLogger');
let auditLogger = null;

/**
 * 审计封装的 DeepSeek API 调用
 * 所有 DeepSeek API 调用应使用此函数替代原生 fetch，自动记录审计日志
 * @param {object} params
 * @param {string} params.module - 调用模块名
 * @param {object} params.apiConfig - { baseUrl, apiKey, model }
 * @param {Array} params.messages - OpenAI 格式 messages
 * @param {object} params.fetchOptions - 额外 fetch 参数 (temperature, max_tokens, stream, response_format 等)
 * @param {string} params.traceId - 可选追踪ID
 * @param {AbortSignal} params.signal - 可选 AbortSignal
 * @returns {Promise<{response: Response, auditId: string}>}
 */
async function auditedDeepSeekCall({ module, apiConfig, messages, fetchOptions = {}, traceId, signal }) {
  const startTime = Date.now();
  let auditRecord = {
    module,
    model: apiConfig.model,
    baseUrl: apiConfig.baseUrl,
    apiKey: apiConfig.apiKey || null,
    adpAppKey: null,
    input: {
      systemPromptLen: messages.find(m => m.role === 'system')?.content?.length || 0,
      userPromptLen: messages.filter(m => m.role === 'user').reduce((sum, m) => {
        const len = typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length;
        return sum + len;
      }, 0),
      userPrompt: messages.filter(m => m.role === 'user').map(m => {
        if (typeof m.content === 'string') return m.content;
        return m.content.filter(c => c.type === 'text').map(c => c.text).join(' ');
      }).join('\n'),
    },
    output: { status: null, contentLen: 0, content: '', finishReason: null },
    tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    latencyMs: 0,
    error: null,
    traceId: traceId || null,
  };

  try {
    // 🔧 防御：baseUrl 不能为空，否则 URL 解析失败
    if (!apiConfig.baseUrl) {
      throw new Error('API Base URL 未配置，请在设置中填写 Base URL（如 https://api.deepseek.com）');
    }
    
    const body = {
      model: apiConfig.model,
      messages,
      ...fetchOptions,
    };

    // 🔧 防御：如果调用方没传 signal，自动加 30s 超时
    // 防止 API 无响应时 fetch 永远挂起，导致剪贴板 isAnalyzing 卡死
    let ownAbortController = null;
    let effectiveSignal = signal;
    if (!signal) {
      ownAbortController = new AbortController();
      effectiveSignal = ownAbortController.signal;
      setTimeout(() => {
        ownAbortController.abort();
        console.warn(`[AI] ⚠️ fetch 超时 30s，已自动中断 (module=${module})`);
      }, 30000);
    }

    const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: effectiveSignal,
    });

    auditRecord.output.status = response.status;

    // 对于非流式调用，解析响应并记录 token
    if (!fetchOptions.stream && response.ok) {
      // Clone response 以便审计日志可以读取 body
      const clonedResponse = response.clone();
      try {
        const data = await clonedResponse.json();
        const content = data.choices?.[0]?.message?.content || '';
        if (content) {
          auditRecord.output.content = content;
          auditRecord.output.contentLen = content.length;
          auditRecord.output.finishReason = data.choices?.[0]?.finish_reason || null;
          // 将完整内容挂载到 response 对象上，避免后续调用方重复读取 body 导致失败
          response._fullContent = content;
        }
        if (data.usage) {
          auditRecord.tokens = {
            prompt_tokens: data.usage.prompt_tokens || 0,
            completion_tokens: data.usage.completion_tokens || 0,
            total_tokens: data.usage.total_tokens || 0,
          };
        }
      } catch (_) {}
    }

    auditRecord.latencyMs = Date.now() - startTime;

    if (!response.ok) {
      try {
        const errBody = await response.clone().text();
        auditRecord.error = `HTTP ${response.status}: ${errBody.substring(0, 200)}`;
      } catch (_) {
        auditRecord.error = `HTTP ${response.status} ${response.statusText}`;
      }
    }

    return { response, auditId: auditRecord.id };
  } catch (err) {
    auditRecord.error = err.message;
    auditRecord.latencyMs = Date.now() - startTime;
    throw err;
  } finally {
    // 异步记录审计日志，不影响主流程
    if (auditLogger) {
      try { auditLogger.record(auditRecord); } catch (_) {}
    }
  }
}

// i18n
const { I18n } = require('./src/scripts/i18n');

// 自动备份定时器
let autoBackupTimer = null;

// 每周优化器定时器
let weeklyOptimizerTimer = null;

// 默认内置API Key（用户未配置时使用，限制10次/天）
// 打包版不内置 LLM API Key，用户必须登录从云端同步或手动填写
// 开发时可通过 .env 的 DEFAULT_API_KEY 覆盖
const DEFAULT_API_KEY = process.env.DEFAULT_API_KEY || '';
const DEFAULT_BASE_URL = process.env.DEFAULT_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding/v3';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'deepseek-v4-flash';

// 大用量 LLM 默认配置（高并发场景：剪贴板分析、记忆提取等高频调用）
const DEFAULT_HIGHVOL_BASE_URL = process.env.DEFAULT_HIGHVOL_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding/v3';
const DEFAULT_HIGHVOL_MODEL = process.env.DEFAULT_HIGHVOL_MODEL || 'deepseek-v4-flash';

// 默认限制（使用内置Key时）
const DEFAULT_DAILY_LIMIT_FOR_BUILTIN_KEY = 10;

// ===== 全局 AI 模式控制 =====
// 'agent' = 所有 AI 调用走 ADP 智能体（已有 ADP 用原逻辑，原 LLM 调用改走通用 ADP AppKey）
// 'llm'   = 所有 AI 调用走本地 LLM（已有 LLM 用原逻辑，原 ADP 调用改走大用量/小用量 LLM）
function getGlobalAIMode() {
  const stored = getSetting('global_ai_mode');
  if (!stored) return 'cc'; // 默认 CC 模式
  // 迁移：旧存储值为 agent 的，升级为 cc（用户已切换默认模式）
  if (stored === 'agent') {
    setSetting('global_ai_mode', 'cc');
    return 'cc';
  }
  return stored;
}

function setGlobalAIMode(mode) {
  if (mode === 'agent' || mode === 'llm' || mode === 'cc') {
    setSetting('global_ai_mode', mode);
    return true;
  }
  return false;
}

// AI调用限制配置
let AI_DAILY_LIMIT = 1000;
const AI_CALLS_KEY = 'taskflow_ai_calls_count';
const AI_CALLS_DATE_KEY = 'taskflow_ai_calls_date';

// ===== 远程配置管理（v2.0 组织配置） =====
let authState = {
  isLoggedIn: false,
  token: null,
  user: null,  // { id, email, name, org_id, org_name, role }
  env: 'beta',  // 'beta' | 'production'
  forceLocalConfig: false  // 已登录但强制使用本地配置
};

let remoteConfig = null;  // 服务器配置（仅内存，不写磁盘，退出登录即清空）
let configPollTimer = null;  // 配置定期同步计时器

// 环境配置（打包后不依赖环境变量，地址直接硬编码）
const DEFAULT_AUTH_SERVERS = {
  beta: {
    name: 'Beta 版本（测试）',
    authUrl: process.env.AUTH_SERVER_URL || 'http://121.5.164.126:3010',
    configUrl: process.env.CONFIG_SERVER_URL || 'http://121.5.164.126:3450',
    toolkitUrl: process.env.TOOLKIT_SERVER_URL || 'http://121.5.164.126:3010',
    loginPath: '/api/auth/login',
    loginField: 'username',
    configPath: '/memora/config',
    validatePath: '/api/auth/me'
  },
  production: {
    name: '正式版本',
    authUrl: process.env.AUTH_SERVER_URL || 'http://121.5.164.126:3010',
    configUrl: process.env.CONFIG_SERVER_URL || 'http://121.5.164.126:3450',
    toolkitUrl: process.env.TOOLKIT_SERVER_URL || 'http://121.5.164.126:3010',
    loginPath: '/api/auth/login',
    loginField: 'username',
    configPath: '/memora/config',
    validatePath: '/api/auth/me'
  }
};

// 深拷贝默认配置作为运行时配置
let AUTH_SERVERS = structuredClone(DEFAULT_AUTH_SERVERS);

// 从持久化存储加载自定义服务器地址
function loadCustomServerUrls() {
  try {
    const custom = getSetting('custom_server_urls');
    if (custom && typeof custom === 'string') {
      const parsed = JSON.parse(custom);
      for (const env of ['beta', 'production']) {
        if (parsed[env]) {
          if (parsed[env].authUrl) {
            AUTH_SERVERS[env].authUrl = parsed[env].authUrl;
            // 同步调整登录路径：ADPToolkit 用 /api/auth/login，config-server 用 /auth/login
            if (parsed[env].authUrl.includes(':3010') || parsed[env].authUrl.includes(':3000')) {
              AUTH_SERVERS[env].loginPath = '/api/auth/login';
              AUTH_SERVERS[env].validatePath = '/api/auth/me';
              AUTH_SERVERS[env].loginField = 'username';
            } else if (parsed[env].authUrl.includes(':3450')) {
              AUTH_SERVERS[env].loginPath = '/auth/login';
              AUTH_SERVERS[env].validatePath = '/auth/validate';
              AUTH_SERVERS[env].loginField = 'email';
            }
          }
          if (parsed[env].configUrl) AUTH_SERVERS[env].configUrl = parsed[env].configUrl;
          if (parsed[env].toolkitUrl) AUTH_SERVERS[env].toolkitUrl = parsed[env].toolkitUrl;
        }
      }
      console.log('[Auth] Loaded custom server URLs:', JSON.stringify(parsed));
    }
  } catch (err) {
    console.error('[Auth] Failed to load custom server URLs:', err.message);
  }
}

// 保存自定义服务器地址到持久化存储
function saveCustomServerUrls(urls) {
  setSetting('custom_server_urls', JSON.stringify(urls));
}

// 验证服务器地址是否可用
async function validateServerUrl(authUrl, configUrl, loginPath) {
  try {
    // 1. 检查 authUrl 可达性（GET 根路径或 health endpoint）
    const healthUrl = authUrl.replace(/\/$/, '');
    const healthRes = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(8000)  // 8 秒超时
    });
    // 只要不超时、不 DNS 失败就算可达（某些服务器根路径返回 404 也正常）
    if (healthRes.status === 0) return { valid: false, error: '服务器无响应' };

    // 2. 检查 configUrl 可达性
    if (configUrl && configUrl !== authUrl) {
      const configHealthUrl = configUrl.replace(/\/$/, '');
      const configRes = await fetch(configHealthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(8000)
      });
      if (configRes.status === 0) return { valid: false, error: '配置服务器无响应' };
    }

    return { valid: true, error: null };
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { valid: false, error: '连接超时（8秒）' };
    }
    if (err.code === 'ENOTFOUND') return { valid: false, error: 'DNS 解析失败，域名不存在' };
    if (err.code === 'ECONNREFUSED') return { valid: false, error: '连接被拒绝，服务器未运行' };
    return { valid: false, error: `网络错误: ${err.message}` };
  }
}

// 获取当前环境的服务器配置
const APP_VERSION = require('./package.json').version;

// 上报登录活动
async function reportLoginActivity(configLoaded = true) {
  if (!authState.isLoggedIn || !authState.token) return;
  const server = getAuthServer();
  try {
    const baseUrl = server.configUrl || server.authUrl;
    await fetch(`${baseUrl}/memora/activity/login`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        login_source: 'memora_client',
        config_loaded: configLoaded,
        app_version: APP_VERSION,
        platform: process.platform
      })
    });
    console.log('[Auth] Login activity reported');
  } catch (err) {
    console.error('[Auth] Report login activity failed:', err.message);
  }
}

// 上报登出活动
async function reportLogoutActivity() {
  if (!authState.token) return;
  const server = getAuthServer();
  try {
    const baseUrl = server.configUrl || server.authUrl;
    await fetch(`${baseUrl}/memora/activity/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        login_source: 'memora_client',
        app_version: APP_VERSION,
        platform: process.platform
      })
    });
    console.log('[Auth] Logout activity reported');
  } catch (err) {
    console.error('[Auth] Report logout activity failed:', err.message);
  }
}

// 拉取服务端通知
async function fetchServerNotifications() {
  if (!authState.isLoggedIn || !authState.token) return [];
  const server = getAuthServer();
  try {
    const baseUrl = server.configUrl || server.authUrl;
    const res = await fetch(`${baseUrl}/memora/notifications`, {
      headers: { 'Authorization': `Bearer ${authState.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      console.log('[Notifications] Fetched', (data.notifications || []).length, 'notifications,', data.unread_count || 0, 'unread');
      return data.notifications || [];
    }
    console.warn('[Notifications] Fetch failed:', res.status, res.statusText, 'from', baseUrl);
    return [];
  } catch (err) {
    console.error('[Notifications] Fetch error:', err.message, '(baseUrl:', (server.configUrl || server.authUrl), ')');
    return [];
  }
}

// 获取未读通知数
async function fetchUnreadNotificationCount() {
  if (!authState.isLoggedIn || !authState.token) return 0;
  const server = getAuthServer();
  try {
    const baseUrl = server.configUrl || server.authUrl;
    const res = await fetch(`${baseUrl}/memora/notifications/unread-count`, {
      headers: { 'Authorization': `Bearer ${authState.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      return data.unread_count || 0;
    }
    return 0;
  } catch (err) {
    console.error('[Notifications] Unread count error:', err.message);
    return 0;
  }
}

// 标记通知已读
async function markNotificationRead(notificationId) {
  if (!authState.isLoggedIn || !authState.token) return false;
  const server = getAuthServer();
  try {
    const baseUrl = server.configUrl || server.authUrl;
    const res = await fetch(`${baseUrl}/memora/notifications/${notificationId}/read`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${authState.token}` }
    });
    return res.ok;
  } catch (err) {
    console.error('[Notifications] Mark read error:', err.message);
    return false;
  }
}

// 标记所有通知已读
async function markAllNotificationsRead() {
  if (!authState.isLoggedIn || !authState.token) return false;
  const server = getAuthServer();
  try {
    const baseUrl = server.configUrl || server.authUrl;
    const res = await fetch(`${baseUrl}/memora/notifications/read-all`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${authState.token}` }
    });
    return res.ok;
  } catch (err) {
    console.error('[Notifications] Mark all read error:', err.message);
    return false;
  }
}

function getAuthServer() {
  return AUTH_SERVERS[authState.env || 'beta'];
}

// 获取认证专用的 URL（send-code/register 等认证接口始终走 ADPToolkit）
// 只有 ADPToolkit 有完整认证接口（send-code/register/login 等），
// AnyDev 等资源服务器不具备认证能力
function getAuthUrlForAuth() {
  const server = getAuthServer();
  // 如果 authUrl 指向非 ADPToolkit 服务器（如 AnyDev），fallback 到默认 ADPToolkit 地址
  if (server.authUrl.includes(':3010') || server.authUrl.includes(':3450')) {
    return server.authUrl;
  }
  // 自定义地址（如 AnyDev :3000）不提供认证接口，回退到 ADPToolkit
  console.log('[Auth] authUrl is not ADPToolkit, falling back to default:', DEFAULT_AUTH_SERVERS[authState.env || 'beta'].authUrl);
  return DEFAULT_AUTH_SERVERS[authState.env || 'beta'].authUrl;
}

// 记忆系统
const { MemoryStore, MEMORY_TYPES, MEMORY_CATEGORIES, BUSINESS_CATEGORIES, BUSINESS_KEYWORDS } = require('./src/scripts/memory');
let memoryStore;

// 记事本系统
const { Notebook } = require('./src/scripts/notebook');
let notebook;

// 知识萃取系统
let knowledgeStore;
let graphDb;

// Prompt 引擎
const PromptEngine = require('./src/scripts/promptEngine');
const promptEngine = new PromptEngine();

// 打包后 prompts 需要可写，使用 userData 目录
const PROMPT_DIR = path.join(app.getPath('userData'), 'prompts');

// 初始化 prompts 目录：首次运行时从内置 prompts 复制到 userData
function initPrompts() {
  if (!fs.existsSync(PROMPT_DIR)) {
    fs.mkdirSync(PROMPT_DIR, { recursive: true });
    console.log('[Prompts] Created prompt directory:', PROMPT_DIR);
  }
  // 从内置 prompts 复制默认文件（不覆盖已有文件）
  const builtinDir = path.join(__dirname, 'prompts');
  if (fs.existsSync(builtinDir)) {
    const files = fs.readdirSync(builtinDir);
    for (const file of files) {
      const src = path.join(builtinDir, file);
      const dest = path.join(PROMPT_DIR, file);
      if (!fs.existsSync(dest) && fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dest);
        console.log('[Prompts] Copied default:', file);
      }
    }
    // 复制子目录（如 backups, candidates）
    for (const subdir of ['backups', 'candidates']) {
      const srcSub = path.join(builtinDir, subdir);
      const destSub = path.join(PROMPT_DIR, subdir);
      if (fs.existsSync(srcSub) && !fs.existsSync(destSub)) {
        fs.mkdirSync(destSub, { recursive: true });
        const subFiles = fs.readdirSync(srcSub);
        for (const f of subFiles) {
          const sf = path.join(srcSub, f);
          const df = path.join(destSub, f);
          if (fs.statSync(sf).isFile() && !fs.existsSync(df)) {
            fs.copyFileSync(sf, df);
          }
        }
        console.log('[Prompts] Copied subdir:', subdir);
      }
    }
  }
}

// 获取 scripts 目录的正确路径（打包后需要从 asar.unpacked 读取）
function getScriptPath(relativePath) {
  if (app.isPackaged) {
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
    if (fs.existsSync(unpackedPath)) return unpackedPath;
  }
  return path.join(__dirname, relativePath);
}

// 获取资源文件路径（图标等，打包后需要从 asar.unpacked 读取）
function getResourcePath(relativePath) {
  if (app.isPackaged) {
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
    if (fs.existsSync(unpackedPath)) return unpackedPath;
  }
  return path.join(__dirname, relativePath);
}

// 初始化 memory/notebook 数据目录（打包后从 ASAR 内迁移已有数据到 userData）
function initDataDirectories() {
  if (!app.isPackaged) return; // 开发模式不需要迁移
  
  const userData = app.getPath('userData');
  
  // 初始化 memory 目录（创建空数据文件，不复制 ASAR 内的开发数据）
  const memoryDest = path.join(userData, 'memory');
  if (!fs.existsSync(memoryDest)) {
    try {
      fs.mkdirSync(memoryDest, { recursive: true });
      // 写入空的记忆数据
      if (!fs.existsSync(path.join(memoryDest, 'memories.json'))) {
        fs.writeFileSync(path.join(memoryDest, 'memories.json'), '[]', 'utf8');
      }
      if (!fs.existsSync(path.join(memoryDest, 'entity-graph.json'))) {
        fs.writeFileSync(path.join(memoryDest, 'entity-graph.json'), '{}', 'utf8');
      }
      console.log('[Data] Initialized empty memory directory');
    } catch (e) { console.error('[Data] Failed to init memory:', e); }
  }
  
  // 初始化 notebook 目录（创建空数据文件）
  const notebookDest = path.join(userData, 'notebook');
  if (!fs.existsSync(notebookDest)) {
    try {
      fs.mkdirSync(notebookDest, { recursive: true });
      if (!fs.existsSync(path.join(notebookDest, 'notes.json'))) {
        fs.writeFileSync(path.join(notebookDest, 'notes.json'), '[]', 'utf8');
      }
      if (!fs.existsSync(path.join(notebookDest, 'categories.json'))) {
        fs.writeFileSync(path.join(notebookDest, 'categories.json'), '[]', 'utf8');
      }
      console.log('[Data] Initialized empty notebook directory');
    } catch (e) { console.error('[Data] Failed to init notebook:', e); }
  }
}

// === FeedbackLogger 反馈闭环系统 ===
class FeedbackLogger {
  constructor() {
    const dir = path.join(app.getPath('userData'), 'feedback');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.tracesFile = path.join(dir, 'ai_traces.jsonl');
    this.feedbackFile = path.join(dir, 'feedback_log.jsonl');
    this.tracesCache = new Map();
    this.tracesCacheLimit = 200;
  }

  newTraceId() {
    return `tr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  recordTrace(trace) {
    try {
      const line = JSON.stringify(trace) + '\n';
      fs.appendFileSync(this.tracesFile, line, 'utf8');
      this.tracesCache.set(trace.trace_id, trace);
      if (this.tracesCache.size > this.tracesCacheLimit) {
        const firstKey = this.tracesCache.keys().next().value;
        this.tracesCache.delete(firstKey);
      }
    } catch (e) { console.error('[FeedbackLogger] recordTrace error:', e); }
  }

  getTrace(traceId) {
    if (this.tracesCache.has(traceId)) return this.tracesCache.get(traceId);
    try {
      if (!fs.existsSync(this.tracesFile)) return null;
      const lines = fs.readFileSync(this.tracesFile, 'utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i]) continue;
        try {
          const obj = JSON.parse(lines[i]);
          if (obj.trace_id === traceId) return obj;
        } catch {}
      }
    } catch (e) { console.error('[FeedbackLogger] getTrace error:', e); }
    return null;
  }

  recordFeedback(feedback) {
    try {
      feedback.fb_id = feedback.fb_id ||
        `fb_${new Date().toISOString().replace(/[:T.-]/g, '').slice(0, 14)}_${crypto.randomBytes(2).toString('hex')}`;
      feedback.ts = feedback.ts || new Date().toISOString();

      if (feedback.trace_id) {
        const trace = this.getTrace(feedback.trace_id);
        if (trace) {
          feedback.module = feedback.module || trace.module;
          feedback.ai_output = feedback.ai_output || trace.output;
          feedback.context = feedback.context || {};
          feedback.context.source_input = feedback.context.source_input || trace.input?.text;
          feedback.context.elapsed_since_ai_ms =
            new Date(feedback.ts) - new Date(trace.ts);
        }
      }

      if (feedback.action === 'edit' && feedback.ai_output && feedback.user_final) {
        feedback.diff = this._computeDiff(feedback.ai_output, feedback.user_final);
      }

      fs.appendFileSync(this.feedbackFile, JSON.stringify(feedback) + '\n', 'utf8');
      return feedback.fb_id;
    } catch (e) { console.error('[FeedbackLogger] recordFeedback error:', e); return null; }
  }

  queryFeedback(options = {}) {
    const { module, action, since, limit = 100 } = options;
    try {
      if (!fs.existsSync(this.feedbackFile)) return [];
      const lines = fs.readFileSync(this.feedbackFile, 'utf8').split('\n');
      const result = [];
      for (let i = lines.length - 1; i >= 0 && result.length < limit; i--) {
        if (!lines[i]) continue;
        try {
          const obj = JSON.parse(lines[i]);
          if (module && obj.module !== module) continue;
          if (action && obj.action !== action) continue;
          if (since && new Date(obj.ts) < new Date(since)) continue;
          result.push(obj);
        } catch {}
      }
      return result;
    } catch (e) { return []; }
  }

  getRecentBadCases(module, limit = 30) {
    return this.queryFeedback({ module, action: 'reject', limit })
      .concat(this.queryFeedback({ module, action: 'edit', limit }))
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, limit);
  }

  _computeDiff(before, after) {
    const diff = {};
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    for (const k of keys) {
      if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) {
        diff[k] = { from: before?.[k], to: after?.[k] };
      }
    }
    return diff;
  }
}

let feedbackLogger;

// v3.1: 向量数据库服务
let embeddingService;
let vectorIndex;
let vectorQueue;
let unifiedContextLayer;
let memoryActivation;

// === 用户画像 ===
function getDefaultProfile() {
  return {
    user: { name: '', english_name: '', role: '', industries: [] },
    frequent_persons: [],
    active_projects: [],
    preferences: {
      priority_signals: ['紧急', 'ASAP', '立即', '今天', '务必'],
      low_priority_signals: ['FYI', '有空', '可选', '参考', '随意']
    },
    work_patterns: { peak_hours: ['09:00-12:00', '14:00-17:00'], task_completion_rate: 0.7 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// 默认的记忆提取Prompt
const DEFAULT_MEMORY_EXTRACTION_PROMPT = `你是一个个人上下文记忆系统AI。
你的任务：从用户复制的文本中提取关键信息，生成结构化的记忆摘要。

记忆分层原则：
1. 瞬时记忆（5分钟~1小时）：当前工作上下文，如正在调试、正在研究
2. 短期记忆（1天~7天）：近期关注的内容、项目、人物
3. 长期记忆（数月）：长期目标、重要人物关系、核心兴趣

需要提取的信息类型：
1. **记忆类型**（memory_type）：
   - "instant"：瞬时记忆（当前工作上下文）
   - "short"：短期记忆（近期关注）
   - "long"：长期记忆（重要信息）

2. **内容分类**（category）：
   - "task"：待办事项
   - "interest"：兴趣关注
   - "person"：人物关系
   - "project"：项目信息
   - "goal"：长期目标
   - "knowledge"：知识要点
   - "action"：行动记录

3. **关键信息**（key_info）：
   - 摘要（不超过50字）
   - 人物（提到的人名、角色）
   - 主题（讨论的核心话题）
   - 关键观点（重要结论、见解、决策）
   - 情感倾向（positive/neutral/negative）
   - 重要性（high/medium/low）

4. **实体信息**（entities）：
   - 人名、公司名、产品名、技术栈等

输出格式（JSON）：
{
  "memory_type": "short",
  "category": "interest",
  "summary": "简短摘要（不超过50字）",
  "persons": ["人物1", "人物2"],
  "topics": ["主题1", "主题2"],
  "key_points": ["观点1", "观点2"],
  "sentiment": "positive",
  "importance": "medium",
  "entities": [
    {"name": "实体名", "type": "person/company/product/tech"}
  ]
}

示例：
输入：昨天我跟四部白酒赛道的销售leader讨论了产品差异
输出：
{
  "memory_type": "short",
  "category": "person",
  "summary": "与白酒赛道销售leader讨论产品差异",
  "persons": ["四部白酒赛道销售leader"],
  "topics": ["产品差异", "销售"],
  "key_points": ["讨论产品差异", "白酒赛道"],
  "sentiment": "neutral",
  "importance": "medium",
  "entities": [
    {"name": "四部白酒赛道销售leader", "type": "person"},
    {"name": "白酒赛道", "type": "industry"}
  ]
}

注意：
- 只输出JSON格式
- 不要添加额外解释
- 如果没有相关信息，对应字段为空数组或null
- summary必须简洁，不超过50字`;

// 获取当前API配置
function getAPIConfig() {
  // v2.0: 登录状态优先使用服务器配置（除非用户强制使用本地配置）
  if (authState.isLoggedIn && remoteConfig?.api && !authState.forceLocalConfig) {
    // 🔧 校验云端配置完整性：base_url + api_key + model 三者必须有值
    const rApiKey = remoteConfig.api.api_key;
    const rBaseUrl = remoteConfig.api.base_url;
    const rModel = remoteConfig.api.model;
    if (rApiKey && rBaseUrl && rModel) {
      return {
        apiKey: rApiKey,
        baseUrl: rBaseUrl,
        model: rModel,
        dailyLimit: remoteConfig.api.daily_limit || 500,
        isCustomKey: false  // 组织Key
      };
    }
    // 云端配置不完整，回退到本地配置
    console.warn('[AI] 云端 API 配置不完整（缺少 base_url/api_key/model），回退到本地配置');
  }
  
  const userApiKey = getSetting('api_key');
  const userBaseUrl = getSetting('api_base_url');
  const userModel = getSetting('api_model');
  const userDailyLimit = parseInt(getSetting('api_daily_limit'));
  
  // 🔧 关键校验：自定义 base_url 必须配对对应的 API Key
  // 如果用户设了 base_url 但没设 api_key，不能回退到 DEFAULT_API_KEY
  // 否则用内置的 key 请求其他平台接口会鉴权失败
  if (userBaseUrl && !userApiKey) {
    console.warn('[AI] api_base_url 已设置但无配对 API Key，回退到默认配置');
    return {
      apiKey: DEFAULT_API_KEY,
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      dailyLimit: DEFAULT_API_KEY ? DEFAULT_DAILY_LIMIT_FOR_BUILTIN_KEY : 0,
      isCustomKey: false
    };
  }
  
  const effectiveApiKey = userApiKey || DEFAULT_API_KEY;
  return {
    apiKey: effectiveApiKey,
    baseUrl: userBaseUrl || DEFAULT_BASE_URL,
    model: userModel || DEFAULT_MODEL,
    dailyLimit: userDailyLimit || (userApiKey ? 1000 : (DEFAULT_API_KEY ? DEFAULT_DAILY_LIMIT_FOR_BUILTIN_KEY : 0)),
    isCustomKey: !!userApiKey
  };
}

// 获取大用量 LLM 配置（高频调用场景：剪贴板分析、记忆提取等）
// 兼容所有 OpenAI 接口格式的大模型，需确保 Base URL + API Key + Model 三者配对
function getHighVolLLMConfig() {
  // 优先云端配置
  if (authState.isLoggedIn && remoteConfig?.api && !authState.forceLocalConfig) {
    const hvBaseUrl = remoteConfig.api.highvol_base_url;
    const hvApiKey = remoteConfig.api.highvol_api_key || remoteConfig.api.api_key;
    if (hvBaseUrl && hvApiKey) {
      return {
        apiKey: hvApiKey,
        baseUrl: hvBaseUrl,
        model: remoteConfig.api.highvol_model || DEFAULT_HIGHVOL_MODEL,
        dailyLimit: remoteConfig.api.daily_limit || 500,
        isCustomKey: false
      };
    }
    // 云端未配置大用量，回退到通用 LLM 配置（含完整性校验）
    return getAPIConfig();
  }
  
  const userApiKey = getSetting('highvol_api_key');
  const userBaseUrl = getSetting('highvol_base_url');
  const userModel = getSetting('highvol_model');
  
  if (userBaseUrl) {
    // 🔧 关键校验：Base URL + API Key + Model 必须三者配对
    // 不能用 api_key（可能是另一个平台）去请求 highvol_base_url
    if (!userApiKey) {
      console.warn('[AI] highvol_base_url 已设置但无配对 highvol_api_key，回退到通用配置');
      return getAPIConfig();
    }
    return {
      apiKey: userApiKey,
      baseUrl: userBaseUrl,
      model: userModel || DEFAULT_HIGHVOL_MODEL,
      dailyLimit: parseInt(getSetting('api_daily_limit')) || 1000,
      isCustomKey: true
    };
  }
  
  // 未配置大用量 LLM，回退到通用 LLM 配置
  return getAPIConfig();
}

// ===== 统一 AI 调用路由（v2.3 全局模式控制） =====
// 根据全局模式 (agent/llm) 和调用类别自动路由到 ADP 或 LLM
// - module: 调用模块名（用于审计）
// - category: 'highvol'(大用量) | 'lowvol'(小用量) — 仅 llm 模式下区分模型选择
// - messages: OpenAI 格式消息数组
// - fetchOptions: fetch 参数
// - adpAppKey: agent 模式下使用的 ADP AppKey（可选，默认通用 AppKey）
// - signal: AbortSignal
// - traceId: 追踪 ID
// - structured: false 表示对话类场景（可走 ADP 智能体），true 表示需要结构化 JSON 返回（必须走 LLM）
async function callAI({ module, category = 'lowvol', messages, fetchOptions = {}, adpAppKey, signal, traceId, structured = true }) {
  const mode = getGlobalAIMode();
  
  if (mode === 'agent' && !structured) {
    // Agent 模式 + 对话类场景：走 ADP 智能体
    const result = await callADPForLLM({ module, messages, adpAppKey, traceId });
    if (!result.response) {
      // ADP 失败时构造错误 response 供调用方兼容
      result.response = { ok: false, status: 500, async json() { return {}; }, async text() { return result.error || 'ADP调用失败'; } };
    }
    return result;
  } else {
    // LLM 模式 或 Agent 模式下需要结构化 JSON 返回 或 对话类但 LLM 模式：走本地 LLM
    const apiConfig = category === 'highvol' ? getHighVolLLMConfig() : getAPIConfig();
    return await auditedDeepSeekCall({ module, apiConfig, messages, fetchOptions, traceId, signal });
  }
}

// ADP 通用调用（非流式，用于替代原 LLM 调用场景）
// 将 OpenAI messages 格式转为 ADP 单轮对话
async function callADPForLLM({ module, messages, adpAppKey, traceId }) {
  const adpConfig = await getADPConfigInternal();
  const appKey = adpAppKey || adpConfig.appKey;
  const url = adpConfig.url || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  
  // 从 messages 提取 system prompt 和 user content
  let systemRole = '';
  let userContent = '';
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemRole += (systemRole ? '\n' : '') + (typeof msg.content === 'string' ? msg.content : '');
    } else if (msg.role === 'user') {
      userContent += (userContent ? '\n' : '') + (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
    } else if (msg.role === 'assistant' && msg.content) {
      userContent += `\n[助手之前的回复]: ${typeof msg.content === 'string' ? msg.content : ''}`;
    }
  }

  const convId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  const requestId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

  const body = {
    AppKey: appKey,
    ConversationId: convId,
    VisitorId: 'memora_user',
    Contents: [{ Type: 'text', Text: userContent }],
    RequestId: requestId,
    Incremental: false,
    Stream: 'enable',
    ...(systemRole ? { SystemRole: systemRole } : {}),
  };

  const startTime = Date.now();
  const auditRecord = {
    module: `adp_${module}`,
    model: `adp_v2`,
    baseUrl: url,
    apiKey: null,
    adpAppKey: appKey ? `${appKey.substring(0, 8)}...` : null,
    input: { systemPromptLen: systemRole.length, userPromptLen: userContent.length, userPrompt: userContent.substring(0, 200) },
    output: { status: null, contentLen: 0, content: '', finishReason: null },
    tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    latencyMs: 0,
    error: null,
    traceId: traceId || null,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    auditRecord.output.status = response.status;

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      auditRecord.error = `ADP HTTP ${response.status}: ${errText.substring(0, 200)}`;
      auditRecord.latencyMs = Date.now() - startTime;
      if (auditLogger) try { auditLogger.record(auditRecord); } catch (_) {}
      return { response: null, auditId: auditRecord.id, error: auditRecord.error };
    }

    // 读取 SSE 流，收集完整回复
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let thinkingContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const evt = JSON.parse(dataStr);
          // V2 事件类型
          if (evt.event === 'text.delta' && evt.data?.content) {
            fullContent += evt.data.content;
          } else if (evt.event === 'thought' && evt.data?.content) {
            thinkingContent += evt.data.content;
          } else if (evt.event === 'error') {
            auditRecord.error = `ADP Error: ${evt.data?.message || JSON.stringify(evt.data)}`;
          } else if (evt.event === 'token_stat' && evt.data) {
            auditRecord.tokens.prompt_tokens = evt.data.input_tokens || 0;
            auditRecord.tokens.completion_tokens = evt.data.output_tokens || 0;
            auditRecord.tokens.total_tokens = auditRecord.tokens.prompt_tokens + auditRecord.tokens.completion_tokens;
          }
        } catch (e) { /* 忽略非JSON行 */ }
      }
    }

    auditRecord.output.contentLen = fullContent.length;
    auditRecord.output.content = fullContent.substring(0, 500);
    auditRecord.output.finishReason = 'stop';
    auditRecord.latencyMs = Date.now() - startTime;
    if (auditLogger) try { auditLogger.record(auditRecord); } catch (_) {}
    incrementAICallCount(); // ADP 调用也计数

    // 返回与 auditedDeepSeekCall 兼容的结构
    // 构造一个 fake response 对象，让调用方可以直接读取完整文本
    const fakeResponse = {
      ok: true,
      status: 200,
      body: null, // 非流式，body 为 null
      _fullContent: fullContent,
      _thinkingContent: thinkingContent,
      async json() { return { choices: [{ message: { content: fullContent }, finish_reason: 'stop' }] }; },
      async text() { return fullContent; },
    };

    return { response: fakeResponse, auditId: auditRecord.id, fullContent, thinkingContent };
  } catch (err) {
    auditRecord.error = err.message;
    auditRecord.latencyMs = Date.now() - startTime;
    if (auditLogger) try { auditLogger.record(auditRecord); } catch (_) {}
    return { response: null, auditId: auditRecord.id, error: err.message };
  }
}

// 内部获取 ADP 配置（避免 IPC）
async function getADPConfigInternal() {
  if (authState.isLoggedIn && remoteConfig?.adp && !authState.forceLocalConfig) {
    return {
      appKey: remoteConfig.adp.app_key || DEFAULT_ADP_APP_KEY,
      url: remoteConfig.adp.url || 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
      knowledgeAppKey: remoteConfig.adp.knowledge_app_key || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
      searchAppKey: remoteConfig.adp.search_app_key || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
      clusteringAppKey: remoteConfig.adp.clustering_app_key || DEFAULT_ADP_CLUSTERING_APP_KEY,
      graphAppKey: remoteConfig.adp.graph_app_key || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
      activationAppKey: remoteConfig.adp.activation_app_key || DEFAULT_ADP_ACTIVATION_APP_KEY,
      evolutionAppKey: remoteConfig.adp.evolution_app_key || DEFAULT_ADP_EVOLUTION_APP_KEY,
      conflictAppKey: remoteConfig.adp.conflict_app_key || DEFAULT_ADP_CONFLICT_APP_KEY,
    };
  }
  return {
    appKey: getSetting('adp_app_key') || DEFAULT_ADP_APP_KEY,
    url: getSetting('adp_url') || 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
    knowledgeAppKey: getSetting('adp_knowledge_app_key') || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
    searchAppKey: getSetting('adp_search_app_key') || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
    clusteringAppKey: getSetting('adp_clustering_app_key') || DEFAULT_ADP_CLUSTERING_APP_KEY,
    graphAppKey: getSetting('adp_graph_app_key') || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
    activationAppKey: getSetting('adp_activation_app_key') || DEFAULT_ADP_ACTIVATION_APP_KEY,
    evolutionAppKey: getSetting('adp_evolution_app_key') || DEFAULT_ADP_EVOLUTION_APP_KEY,
    conflictAppKey: getSetting('adp_conflict_app_key') || DEFAULT_ADP_CONFLICT_APP_KEY,
  };
}

// 默认的AI分析Prompt
const DEFAULT_AI_PROMPT = `你是一个任务识别AI。
你的目标：从用户复制到剪切板的文本中，判断用户是否是在表达一个"未来需要执行的事项"。

识别为任务的强信号（命中任一即优先判定为任务）：
- @提及 + 行动要求（如"@XX 你收集一下"、"@XX 安排"）
- 编号列表 + 行动描述（如"1）报价审批流程太重... 2）标前评审..."）

满足以下条件也识别为任务：
1. 存在明确或隐含行动（如：发送、完成、回复、处理、联系、收集、反馈、整理、梳理、简化、评审、确认、跟进等）
2. 存在未来时间或隐含待办（需要、记得、看看怎么、想想怎么等）
3. 用户可能希望被提醒

间接待办也必须识别：
- "我们需要整理一下" → 是待办
- "大家有问题反馈到XX这里" → 是待办
- "看看怎么简化" → 是待办
- "找大家收集一下" → 是待办

不要把以下内容识别成任务：
- 普通聊天
- 文章段落
- 感慨评论
- 新闻资讯
- 代码片段
- URL链接

请输出JSON。格式如下：
{
  "is_task": true,
  "confidence": 0.92,
  "title": "明天下午给客户发报价",
  "description": "用户需要给客户发送报价单",
  "time": {
      "raw": "明天下午",
      "normalized": "2026-05-29 15:00:00",
      "is_all_day": false
  },
  "priority": "medium",
  "tags": ["工作","客户"],
  "is_valid_info": true,
  "reason": "包含明确行动和时间"
}

如果不是任务：
{
  "is_task": false,
  "confidence": 0.95,
  "is_valid_info": false,
  "reason": "只是普通聊天"
}

规则：
- title要简短，不超过20字
- 不要虚构时间
- 时间不明确时normalized为null
- ⚠️ 时间语义必须与原文一致："上午"→8-11点，"下午"→13-17点，"晚上"→19-22点，"中午"→12点。严禁将"上午"解析为下午时间
- ⚠️ 相对时间推断：无明确日期前缀的"上午/下午/晚上"默认指向当天（除非当前已过该时段）。"今晚/今早"强制当天，"明晚/明早"强制明天
- 当前时间：${new Date().toLocaleString('zh-CN')}
- confidence必须0~1之间
- 只输出JSON，不要有其他内容
- @提及 + 行动要求 → is_task=true, confidence >= 0.9
- 编号列表 + 行动描述 → is_task=true, confidence >= 0.85

示例1（输入）：明天上午组织新人培训
示例1（输出）：{"is_task":true,"confidence":0.95,"title":"组织新人培训","description":"明天上午组织新人培训","time":{"raw":"明天上午","normalized":null,"is_all_day":false},"priority":"medium","tags":["工作"],"is_valid_info":true,"reason":"存在明确行动和时间"}

示例2（输入）：明天下午三点提醒我给客户发合同
示例2（输出）：{"is_task":true,"confidence":0.98,"title":"给客户发合同","description":"提醒用户给客户发送合同","time":{"raw":"明天下午三点","normalized":null,"is_all_day":false},"priority":"high","tags":["工作"],"is_valid_info":true,"reason":"存在明确行动与具体时间"}

示例3（输入）：下周找房东续租
示例3（输出）：{"is_task":true,"confidence":0.91,"title":"联系房东续租","description":"用户需要处理续租事项","time":{"raw":"下周","normalized":null,"is_all_day":false},"priority":"medium","tags":["生活"],"is_valid_info":true,"reason":"存在未来待办事项"}

示例4（输入）：特朗普访问中国可能利好稀土板块
示例4（输出）：{"is_task":false,"confidence":0.96,"is_valid_info":false,"reason":"新闻观点，不是用户待办"}

示例5（输入）：周五之前把PPT做完
示例5（输出）：{"is_task":true,"confidence":0.97,"title":"完成PPT","description":"用户需要在周五前完成PPT","time":{"raw":"周五之前","normalized":null,"is_all_day":false},"priority":"high","tags":["工作"],"is_valid_info":true,"reason":"明确待办和截止时间"}

示例6（输入）：另外昨天跟强总反馈了流程问题，我们需要整理一下，@Dean 你找大家收集一下流程上的问题，我们看看怎么简化。比如 1）报价审批流程太重，每个价格都要审批 2）标前评审流程重，标品也要评审 3）进入中标后的项目，架构师还要花很多精力跟进
示例6（输出）：{"is_task":true,"confidence":0.95,"title":"收集整理流程问题并简化","description":"@Dean找大家收集流程问题，看看怎么简化：1）报价审批流程太重 2）标前评审流程重 3）架构师跟进精力大","time":{"raw":null,"normalized":null,"is_all_day":false},"priority":"high","tags":["工作","流程"],"is_valid_info":true,"reason":"@提及+行动要求+编号列表，强待办信号"}

示例7（输入）：下午有2份PPT：1、我们专场：ADP 4.0升级+demo+跨行业案例 2、katy行业专场：ADP 4.0升级+demo+零售+四部案例
示例7（输出）：{"is_task":true,"confidence":0.95,"title":"准备2份PPT材料","description":"下午需要准备两份PPT：我们专场和katy行业专场","time":{"raw":"下午","normalized":null,"is_all_day":false},"priority":"high","tags":["工作","PPT"],"is_valid_info":true,"reason":"包含明确待办事项"}`;

// 获取当前使用的Prompt（优先读取 .md 模板文件，回退到设置或默认）
function getCurrentAIPrompt() {
  // 优先读取模板文件
  const templatePath = path.join(PROMPT_DIR, 'task_recognition_v2.0.md');
  if (fs.existsSync(templatePath)) {
    try {
      let content = fs.readFileSync(templatePath, 'utf8');
      // 移除模板变量标记，替换为实际值（剪贴板分析场景没有完整上下文）
      const profile = loadProfile();
      content = content.replace(/\{\{user_profile\.name\}\}/g, profile.user?.name || '用户')
                       .replace(/\{\{user_profile\.english_name\}\}/g, profile.user?.english_name || '')
                       .replace(/\{\{user_profile\.role\}\}/g, profile.user?.role || '')
                       .replace(/\{\{current_time\}\}/g, new Date().toLocaleString('zh-CN'))
                       .replace(/\{\{#each user_profile\.industries\}\}\{\{this\}\}\{\{#unless @last\}\}、\{\{\/unless\}\}\{\{\/each\}\}/g, (profile.user?.industries || []).join('、'));
      return content;
    } catch (e) {
      console.error('[Prompt] Failed to read task_recognition_v2.0.md:', e);
    }
  }
  // 回退到设置或默认
  if (db) {
    const settings = db.getSettings();
    return settings.ai_prompt || DEFAULT_AI_PROMPT;
  }
  return getSetting('ai_prompt') || DEFAULT_AI_PROMPT;
}

// 获取当前使用的记忆提取Prompt（优先读取 .md 模板文件，回退到设置或默认）
function getCurrentMemoryPrompt() {
  const templatePath = path.join(PROMPT_DIR, 'memory_extraction_v2.0.md');
  if (fs.existsSync(templatePath)) {
    try {
      let content = fs.readFileSync(templatePath, 'utf8');
      const profile = loadProfile();
      content = content.replace(/\{\{user_profile\.name\}\}/g, profile.user?.name || '用户')
                       .replace(/\{\{user_profile\.english_name\}\}/g, profile.user?.english_name || '')
                       .replace(/\{\{user_profile\.role\}\}/g, profile.user?.role || '')
                       .replace(/\{\{current_time\}\}/g, new Date().toLocaleString('zh-CN'))
                       .replace(/\{\{#each user_profile\.industries\}\}\{\{this\}\}\{\{#unless @last\}\}、\{\{\/unless\}\}\{\{\/each\}\}/g, (profile.user?.industries || []).join('、'));
      return content;
    } catch (e) {
      console.error('[Prompt] Failed to read memory_extraction_v2.0.md:', e);
    }
  }
  if (db) {
    const settings = db.getSettings();
    return settings.memory_prompt || DEFAULT_MEMORY_EXTRACTION_PROMPT;
  }
  return getSetting('memory_prompt') || DEFAULT_MEMORY_EXTRACTION_PROMPT;
}

// 智能过滤配置
const FILTER_CONFIG = {
  maxLength: 1000, // 最大字数限制（放宽，让 AI 判定是否有效信息）
  confidenceThreshold: 0.9, // 自动弹出建议的置信度阈值
  lowConfidenceThreshold: 0.7, // 静默候选的置信度阈值
  
  // 纯代码/纯技术格式黑名单（只过滤明显不是人类自然语言的内容，其余全交给AI判断）
  blacklistPatterns: [
    /^https?:\/\/\S+$/i, // 纯URL
    /^SELECT\s+/i, // SQL查询
    /^{[\s\S]*}$/, // JSON对象
    /^function\s+/i, // 函数定义
    /^const\s+/i, // 常量定义
    /^let\s+/i, // 变量定义
    /^var\s+/i, // 变量定义
    /^import\s+/i, // 导入语句
    /^export\s+/i, // 导出语句
    /^def\s+/i, // Python函数
    /^class\s+/i, // 类定义
    /^```/, // 代码块
    /^0x[0-9a-fA-F]+$/ // 十六进制
  ]
};

// 预分类器：轻量规则判断是否需要调用AI
function preClassify(text) {
  // 1. 空内容检查
  if (!text || text.trim().length === 0) {
    return { shouldAnalyze: false, reason: '空内容' };
  }
  
  // 2. 长度检查（合并后的文本允许更长，由缓冲器的 maxTotalLength 控制）
  const effectiveMaxLength = text.startsWith('[以下是从剪贴板分') ? 3000 : FILTER_CONFIG.maxLength;
  if (text.length > effectiveMaxLength) {
    return { shouldAnalyze: false, reason: `内容过长（${text.length}字 > ${effectiveMaxLength}字）` };
  }
  
  // 3. 黑名单过滤
  for (const pattern of FILTER_CONFIG.blacklistPatterns) {
    if (pattern.test(text)) {
      return { shouldAnalyze: false, reason: `匹配黑名单模式: ${pattern}` };
    }
  }
  
  // 4. 检测强信号用于辅助提示（不作为过滤条件）
  let hasAtMention = /@\S+/.test(text);
  let hasNumberedList = /\d+[）\).]\s*/.test(text);
  
  // 通过预分类，交给AI判断（不再用白名单硬过滤）
  const matchInfo = hasAtMention ? '含@提及' : hasNumberedList ? '含编号列表' : '自然语言文本';
  
  return { 
    shouldAnalyze: true, 
    reason: `通过预分类（${matchInfo}）`,
    hasAtMention,
    hasNumberedList
  };
}

function createWindow() {
  const iconPath = getResourcePath('resources/icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty();
    }
  } catch (e) {
    icon = nativeImage.createEmpty();
    console.error('Icon load error:', e);
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    backgroundColor: '#f5f5f7',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: icon
  });
  
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // ===== 粘贴图片检测：Ctrl+V / Cmd+V 时，如果剪贴板是纯图片（无文本），自动保存到记事本 =====
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'v' && (input.control || input.meta)) {
      handlePasteImage();
    }
  });

  // 渲染进程崩溃恢复
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[App] Renderer process gone:', details.reason, details.exitCode);
    if (details.reason !== 'clean-exit') {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
          console.log('[App] Reloaded after renderer crash');
        }
      }, 1000);
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDesc) => {
    console.error('[App] Failed to load:', errorCode, errorDesc);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.reload();
      }
    }, 2000);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    console.log('[App] Window shown');
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = getResourcePath('resources/icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty();
    } else {
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
    console.error('Tray icon error:', e);
  }
  
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } } },
    { label: '开始番茄钟', click: () => mainWindow.webContents.send('start-pomodoro') },
    { type: 'separator' },
    { label: '退出', click: () => {
      app.isQuitting = true;
      app.quit();
    }}
  ]);

  tray.setToolTip('忆境 Memora');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function initClipboardWatcher() {
  console.log('[Clipboard] Starting smart clipboard scheduler...');
  
  // 🔧 启动前自检
  const selfCheck = {
    hasClipboard: !!clipboard,
    hasPowerMonitor: !!powerMonitor,
    hasMainWindow: !!mainWindow,
    hasNotebook: !!notebook,
    currentClipboardText: clipboard?.readText()?.substring(0, 50) || '(空)',
    apiConfig: getAPIConfig().baseUrl,
    apiModel: getAPIConfig().model,
    hasApiKey: !!getAPIConfig().apiKey,
    canAICall: canMakeAICall(),
    settingsBuffer: getSetting('clipboard_buffer_enabled'),
    settingsFreq: getSetting('clipboard_freq_enabled'),
  };
  console.log('[Clipboard] 🔍 启动自检:', JSON.stringify(selfCheck, null, 2));
  
  if (!mainWindow) {
    console.error('[Clipboard] ❌ mainWindow 不存在！scheduler 的日志转发将不工作');
  }
  
  const scheduler = startClipboardWatcher({
    clipboard,
    powerMonitor,
    preClassifyFn: preClassify,
    analyzeFn: analyzeClipboardText,
    mainWindow,
    notebook,
    getSettingFn: getSetting,
    processedHashes: processedClipboardHashes,
    maxHashes: MAX_CLIPBOARD_HASHES,
    processedImageHashes
    // saveImageFn 不再需要：图片保存改为粘贴触发，由 handlePasteImage() 调用 saveClipboardImage()
  });

  // 保存引用以便清理
  clipboardWatcher = scheduler;

  console.log('[Clipboard] ✅ Smart scheduler started (buffer + dynamic freq + state detect)');
  console.log('[Clipboard] 💡 诊断命令: 在 DevTools 控制台运行 await window.electronAPI.clipboardDiagnostic()');
  console.log('[Clipboard] 💡 强制分析: 在 DevTools 控制台运行 await window.electronAPI.clipboardForceAnalyze()');
}

/**
 * 粘贴触发的图片保存
 * 当用户在 Memora 中按 Ctrl+V / Cmd+V 时：
 * - 剪贴板是纯图片（无文本）→ 保存图片到记事本
 * - 剪贴板有文本（包括图文混合）→ 不处理，让文本走正常流程
 */
function handlePasteImage() {
  try {
    // 1. 先检查剪贴板是否有文本（有文本 = 图文混合或纯文本 → 按文本处理，不保存图片）
    const text = clipboard.readText();
    if (text && text.trim().length > 0) {
      return; // 有文本内容，让文本走正常剪贴板检测流程
    }

    // 2. 检查剪贴板是否有图片
    const image = clipboard.readImage();
    if (!image || image.isEmpty()) {
      return;
    }

    // 3. 计算图片 hash 去重
    const pngBuffer = image.toPNG();
    const crypto = require('crypto');
    const imageHash = crypto.createHash('sha256').update(pngBuffer).digest('hex');

    const scheduler = getScheduler();
    if (scheduler && scheduler.hasProcessedImage(imageHash)) {
      console.log('[PasteImage] 🔁 图片已保存过，跳过');
      return;
    }

    // 4. 保存图片到记事本
    const size = image.getSize();
    console.log(`[PasteImage] 🖼️ 检测到粘贴图片: ${size.width}x${size.height}`);

    // 标记去重
    if (scheduler) {
      scheduler.markImageProcessed(imageHash);
    }

    saveClipboardImage(pngBuffer, imageHash, { width: size.width, height: size.height });
  } catch (e) {
    console.error('[PasteImage] 粘贴图片处理异常:', e.message);
  }
}

/**
 * 修复被错误设为服务端路径的 imagePath
 * 之前的 bug：上传成功后把本地笔记的 imagePath 改成了服务端路径（如 u-admin-001/xxx.png），
 * 导致 notebookGetImage 无法找到本地文件。此函数扫描所有笔记，将服务端路径还原为本地路径。
 */
function _fixCorruptedImagePaths() {
  if (!notebook || !Array.isArray(notebook.notes)) return;
  const imagesDir = path.join(app.getPath('userData'), 'notebook', 'images');
  let fixed = 0;

  for (const note of notebook.notes) {
    if (!note.imagePath || !isServerImagePath(note.imagePath)) continue;

    // 🔧 修复前先保存服务端路径到 serverImagePath，确保同步推送时不丢失
    if (!note.serverImagePath) {
      note.serverImagePath = note.imagePath;
    }

    // 服务端路径格式: u-admin-001/timestamp_hash.png
    // 本地缓存路径: images/sync_timestamp_hash.png
    const localFilename = serverPathToLocalFilename(note.imagePath);
    const syncCachePath = path.join(imagesDir, localFilename);

    if (fs.existsSync(syncCachePath)) {
      // 已下载到本地缓存，使用缓存路径
      note.imagePath = `images/${localFilename}`;
      fixed++;
    } else {
      // 没有缓存，查找同名文件（服务端文件名可能匹配本地原始文件）
      const serverFilename = note.imagePath.split('/').pop();
      const possibleLocalFiles = fs.existsSync(imagesDir)
        ? fs.readdirSync(imagesDir).filter(f => f === serverFilename)
        : [];
      if (possibleLocalFiles.length > 0) {
        note.imagePath = `images/${possibleLocalFiles[0]}`;
        fixed++;
      }
      // 如果还是找不到，保持服务端路径（下次 sync 会尝试下载）
    }
  }

  if (fixed > 0) {
    notebook.saveNotes();
    console.log('[Notebook] Fixed', fixed, 'corrupted image paths (server → local)');
  }
}

/**
 * 剪贴板图片保存到记事本
 * 由 handlePasteImage() 和 fullSync 重试调用
 * @param {Buffer} pngBuffer - PNG 图片二进制数据
 * @param {string} imageHash - 基于像素内容的 SHA-256 hash
 * @param {{width: number, height: number}} meta - 图片尺寸
 */
async function saveClipboardImage(pngBuffer, imageHash, meta) {
  try {
    if (!notebook) {
      console.warn('[ClipboardImage] Notebook not initialized, skip');
      return;
    }

    // 1. 确保图片目录存在
    const imagesDir = path.join(app.getPath('userData'), 'notebook', 'images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    // 2. 保存图片文件（用 hash 作文件名，天然去重——同 hash 同文件不重复写）
    const fileName = `${imageHash.substring(0, 16)}_${meta.width}x${meta.height}.png`;
    const filePath = path.join(imagesDir, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, pngBuffer);
      console.log('[ClipboardImage] Saved:', fileName, `(${(pngBuffer.length / 1024).toFixed(1)}KB)`);
    } else {
      console.log('[ClipboardImage] File exists, skip write:', fileName);
    }

    // 3. 尝试立即上传图片到服务端（不等 fullSync，避免笔记元数据先于图片推送）
    const localImagePath = `images/${fileName}`; // 本地路径，始终不变
    let serverImagePath = null; // 服务端路径（上传成功后才有值）
    let serverImageHash = imageHash;
    let serverImageWidth = meta.width;
    let serverImageHeight = meta.height;
    let imageUploadedToServer = false; // 标记图片是否已成功上传到服务端

    if (authState.isLoggedIn && authState.token) {
      try {
        const uploadResult = await uploadNoteImage(filePath);
        if (uploadResult.ok && uploadResult.uploaded?.length > 0) {
          const imgInfo = uploadResult.uploaded[0];
          serverImagePath = imgInfo.server_path;
          serverImageHash = imgInfo.image_hash || imageHash;
          serverImageWidth = imgInfo.width || meta.width;
          serverImageHeight = imgInfo.height || meta.height;
          imageUploadedToServer = true;
          console.log('[ClipboardImage] ✅ Image uploaded immediately →', imgInfo.server_path);
        } else {
          console.warn('[ClipboardImage] ⚠️ Image upload failed, will retry on next fullSync:', uploadResult.error);
        }
      } catch (uploadErr) {
        console.warn('[ClipboardImage] ⚠️ Image upload error, will retry on next fullSync:', uploadErr.message);
      }
    } else {
      console.log('[ClipboardImage] ℹ️ Not logged in, image will be uploaded on next fullSync');
    }

    // 4. 创建记事本条目（imagePath 始终用本地路径，确保本地显示正常）
    const note = notebook.addNote({
      content: `[图片] ${meta.width}x${meta.height} | ${new Date().toLocaleString('zh-CN')}`,
      title: `剪贴板图片 ${meta.width}×${meta.height}`,
      category: 'image',
      tags: ['clipboard-image', 'auto-saved'],
      imagePath: localImagePath,        // 始终用本地路径（images/xxx.png），确保本地显示正常
      serverImagePath: serverImagePath || '',  // 服务端路径（上传成功才有值，用于同步推送）
      imageHash: serverImageHash,
      imageWidth: serverImageWidth,
      imageHeight: serverImageHeight,
      analyzed: true,              // 图片不需要 AI 分析
      analysis: {
        status: '已自动保存',
        source: 'clipboard_image',
        imageHash: imageHash.substring(0, 8)
      }
    });

    if (note) {
      console.log('[ClipboardImage] ✅ Note created:', note.id, '| hash:', imageHash.substring(0, 8), '| local:', localImagePath, '| server:', serverImagePath || 'not uploaded');
      // 通知前端有新图片笔记
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('new-note-added', {
          source: 'clipboard-image',
          title: note.title,
          imagePath: localImagePath          // 前端显示用本地路径
        });
      }

      // 5. 触发同步推送（始终推送笔记元数据，imagePath 只用服务端路径）
      try {
        mainWindow.webContents.send('sync:trigger-push', {
          dataType: 'notes',
          record: {
            id: note.id,
            title: note.title,
            content: note.content,
            category: note.category,
            tags: note.tags,
            // 🔧 修复：只传服务端路径，不传本地路径。本地路径到服务器端无法解析，导致图片404
            imagePath: serverImagePath || '',  // 上传成功用服务端路径，失败则留空等 fullSync 重试
            imageHash: serverImageHash,
            imageWidth: serverImageWidth,
            imageHeight: serverImageHeight,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt
          }
        });
        if (!imageUploadedToServer) {
          console.log('[ClipboardImage] ⏳ Note pushed without server image_path, will update on next fullSync.');
        }
      } catch (syncErr) {
        console.warn('[ClipboardImage] Sync trigger failed:', syncErr.message);
      }
    } else {
      console.log('[ClipboardImage] 🔁 Duplicate image note, skip (hash:', imageHash.substring(0, 8) + ')');
    }
  } catch (e) {
    console.error('[ClipboardImage] Save failed:', e.message);
  }
}

// 检查剪切板内容是否已处理过
function isClipboardProcessed(text) {
  const hash = getClipboardHash(text);
  return processedClipboardHashes.has(hash);
}

// 标记剪切板内容为已处理
function markClipboardProcessed(text) {
  const hash = getClipboardHash(text);
  processedClipboardHashes.add(hash);
  
  // 限制哈希集合大小，防止内存膨胀
  if (processedClipboardHashes.size > MAX_CLIPBOARD_HASHES) {
    const firstEntry = processedClipboardHashes.values().next().value;
    processedClipboardHashes.delete(firstEntry);
  }
  
  console.log('[Clipboard] Content marked as processed, total:', processedClipboardHashes.size);
}

// 初始化每日AI调用计数
function initAICallCount() {
  const today = new Date().toISOString().split('T')[0];
  const storedDate = getSetting(AI_CALLS_DATE_KEY);
  
  if (storedDate !== today) {
    setSetting(AI_CALLS_KEY, '0');
    setSetting(AI_CALLS_DATE_KEY, today);
    console.log('[AI] Daily call counter reset for', today);
  }
}

// 检查是否可以进行AI调用
function canMakeAICall() {
  initAICallCount();
  const config = getAPIConfig();
  // 无 API Key 时不能调用（未登录且未手动填写 key）
  if (!config.apiKey) {
    console.log('[AI] No API key available, AI calls disabled');
    return false;
  }
  const count = parseInt(getSetting(AI_CALLS_KEY) || '0');
  const dailyLimit = config.dailyLimit;
  const allowed = count < dailyLimit;
  console.log('[AI] Call count:', count, '/', dailyLimit, '- Allowed:', allowed, '- Using custom key:', config.isCustomKey);
  return allowed;
}

// 增加AI调用计数
function incrementAICallCount() {
  initAICallCount();
  const count = parseInt(getSetting(AI_CALLS_KEY) || '0');
  setSetting(AI_CALLS_KEY, (count + 1).toString());
}

// 简单的哈希函数（保留兼容，但标记为废弃）
// 实际使用 clipboard/hashUtils 中的 getClipboardHash
String.prototype.hashCode = function() {
  let hash = 0;
  for (let i = 0; i < this.length; i++) {
    const char = this.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
};

// 简单的设置存储（使用文件）
let settingsCache = {};
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const fs = require('fs');
    if (fs.existsSync(settingsPath)) {
      settingsCache = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {
    console.error('[Settings] Load error:', e);
  }
}

function getSetting(key) {
  return settingsCache[key];
}

function setSetting(key, value) {
  settingsCache[key] = value;
  saveSettings();
}

function saveSettings() {
  try {
    const fs = require('fs');
    fs.writeFileSync(settingsPath, JSON.stringify(settingsCache, null, 2));
  } catch (e) {
    console.error('[Settings] Save error:', e);
  }
}

function deleteSetting(key) {
  delete settingsCache[key];
  saveSettings();
}

// 设置AI每日调用限制
function setAIDailyLimit(limit) {
  AI_DAILY_LIMIT = limit;
  console.log('[AI] Daily limit set to:', limit);
}

/**
 * AI 优化合并剪贴板文本
 * 当用户连续多次复制的内容被缓冲区合并时，用 AI 将拼接的内容优化为通顺完整的表述
 * 不改变主要意思，只让句子更流畅、更完整
 * @param {string} rawJoinedText - 纯拼接的原始文本（不含前缀和分隔线）
 * @param {number} fragmentCount - 拼接片段数量
 * @returns {Promise<string|null>} 优化后的文本，失败返回 null
 */
async function optimizeMergedText(rawJoinedText, fragmentCount) {
  if (!rawJoinedText || fragmentCount <= 1) return null;
  if (!canMakeAICall()) {
    console.log('[Clipboard] AI调用次数达限，跳过合并文本优化');
    return null;
  }

  try {
    const optimizePrompt = `你是一个文本优化助手。用户从聊天中连续复制了 ${fragmentCount} 段内容，这些内容被简单拼接在一起。请将它们优化为一段通顺、完整的表述。

规则：
1. 不改变原文的主要意思和信息量
2. 让句子之间的衔接更自然流畅
3. 去掉重复的表述（多次复制可能包含重复部分）
4. 保留所有关键信息（人名、数字、时间、专有名词等）
5. 如果内容本身是独立的几条信息，用适当的分隔方式保持清晰
6. 只输出优化后的文本，不要解释、不要加前缀后缀`;

    const { response } = await callAI({
      module: 'clipboard_merge_optimize',
      category: 'highvol',
      messages: [
        { role: 'system', content: optimizePrompt },
        { role: 'user', content: rawJoinedText }
      ],
      fetchOptions: { temperature: 0.2, max_tokens: 2000 },
    });

    if (!response.ok) {
      console.log('[Clipboard] 合并文本优化 API 失败:', response.status);
      return null;
    }

    incrementAICallCount();
    const data = await response.json();
    if (data.choices?.[0]?.message?.content) {
      const optimized = data.choices[0].message.content.trim();
      console.log(`[Clipboard] 合并文本优化完成 (${rawJoinedText.length}字 → ${optimized.length}字)`);
      return optimized;
    }
    return null;
  } catch (err) {
    console.error('[Clipboard] 合并文本优化失败:', err.message);
    return null;
  }
}

async function analyzeClipboardText(text) {
  // 🔧 修复：空文本也要通知 scheduler 重置 isAnalyzing
  if (!text || text.trim().length === 0) {
    const scheduler = getScheduler();
    if (scheduler) scheduler.onAnalysisComplete();
    return;
  }
  
  try {
    console.log(`[AI] 🔍 开始分析剪贴板内容 (${text.length}字)...`);
    _sendLog(`[AI] 🔍 开始分析剪贴板内容 (${text.length}字)...`);
    
    // 1. 去重检查 — 🔧 修复：只对非缓冲区合并的文本做检查
    //    缓冲区合并文本由 scheduler 统一管理去重，不在这里重复检查
    const bufferMatch = text.match(/^\[以下是从剪贴板分 (\d+) 次复制的内容，按时间顺序拼接\]/);
    const isBufferMerged = !!bufferMatch;
    const fragmentCount = bufferMatch ? parseInt(bufferMatch[1]) : 1;
    // 从 scheduler 获取纯拼接文本（用于 AI 优化）
    let rawJoinedText = null;
    if (isBufferMerged && fragmentCount > 1) {
      const scheduler = getScheduler();
      rawJoinedText = scheduler?._pendingRawJoinedText || null;
    }
    
    if (!isBufferMerged && isClipboardProcessed(text)) {
      console.log('[AI] 🔁 内容已处理过，跳过AI调用');
      _sendLog('[AI] 🔁 内容已处理过，跳过AI调用');
      return;
    }
    if (isBufferMerged) {
      console.log('[AI] 📎 合并文本模式，跳过去重检查（由 scheduler 管理）');
      _sendLog('[AI] 📎 合并文本模式，跳过去重检查（由 scheduler 管理）');
    }
    
    // 2. 预分类器检查（合并文本已由 scheduler 逐条过滤，跳过二次检查）
    let preResult;
    if (isBufferMerged) {
      // 合并文本直接通过，不再做 preClassify
      // 但仍需检测强信号用于 prompt 增强
      const hasAtMention = /@\S+/.test(text);
      const hasNumberedList = /\d+[）\).]\s*/.test(text);
      preResult = { shouldAnalyze: true, reason: '缓冲区合并文本（已逐条预分类）', hasAtMention, hasNumberedList };
      _sendLog(`[AI] 📎 合并文本模式 | @提及:${hasAtMention} | 编号列表:${hasNumberedList}`);
    } else {
      preResult = preClassify(text);
      _sendLog(`[AI] 🏷️ 预分类结果: ${preResult.shouldAnalyze ? '✅通过' : '🚫拒绝'} | 原因: ${preResult.reason}`);
    }
    
    // 保存到记忆系统（调试期：保存所有剪切板内容）
    let analysisResult = null;
    let confidence = 0;
    let isTask = false;
    let taskTitle = null;
    let _skipOriginalFlow = false;
    
    if (!preResult.shouldAnalyze) {
      console.log('[AI] Pre-classification rejected:', preResult.reason);
      _sendLog(`[AI] 🚫 预分类拒绝: ${preResult.reason}`);
      // 闲聊/无效内容不入记事本，仅记录日志
      console.log('[Notebook] Skipped: pre-classification rejected -', preResult.reason);
      return;
    }
    console.log('[AI] Pre-classification passed:', preResult.reason);
    _sendLog(`[AI] ✅ 预分类通过: ${preResult.reason}`);
    
    // 3. 检查AI调用次数限制
    if (!canMakeAICall()) {
      console.log('[AI] Daily limit reached, skipping analysis');
      _sendLog('[AI] ⛔ 每日AI调用次数已达上限');
      // 保存到记事本
      if (notebook) {
        notebook.addNote({
          content: text,
          category: 'general',
          analyzed: false,
          analysis: {
            reason: '每日调用次数已达上限'
          }
        }); // addNote 自动去重，返回 null 表示重复
      }
      return;
    }
    
    // 获取API配置
    const apiConfig = getAPIConfig();
    _sendLog(`[AI] 📡 API配置: baseUrl=${apiConfig.baseUrl} model=${apiConfig.model} hasKey=${!!apiConfig.apiKey}`);

    
    // 生成 trace_id 用于反馈闭环
    const traceId = feedbackLogger ? feedbackLogger.newTraceId() : `tr_${Date.now()}_local`;
    
    // 构建用户提示词，附带预分类信号和当前时间
    const now = new Date();
    const currentDayOfWeek = ['日','一','二','三','四','五','六'][now.getDay()];
    const currentHour = now.getHours();
    const timePeriod = currentHour < 6 ? '凌晨' : currentHour < 12 ? '上午' : currentHour < 18 ? '下午' : '晚上';
    let userPrompt = `[当前时间：${now.toLocaleString('zh-CN')} 周${currentDayOfWeek} ${timePeriod}]\n\n分析以下文本：\n\n${text}`;
    if (isBufferMerged) {
      userPrompt += '\n\n[预分类信号：这是用户连续多次复制的内容，已自动合并。请仔细分析每条内容，特别是含@提及的条目——这通常意味着有人被分配了待办任务。如果任何一条是待办，请标记 is_task=true]';
      userPrompt += '\n\n[关键规则：合并文本中可能包含上下文信息（如分工表、背景描述）+ 待办任务。description 必须包含足够的上下文信息，让人仅看 description 就能理解待办的具体内容。例如：如果文本包含"BSC分工：p6...p11..."和"@Dean 准备起来吧"，description 应写为"BSC分工表中@Dean需要准备的待办任务（涉及p6公有云收入、p7私有化收入等分工）"，而非仅仅写"准备起来"]';
    } else {
      if (preResult.hasAtMention) {
        userPrompt += '\n\n[预分类信号：检测到@提及，这通常是强待办信号]';
      }
      if (preResult.hasNumberedList) {
        userPrompt += '\n\n[预分类信号：检测到编号列表，这通常是任务列表]';
      }
    }

    // 关联检测：注入最近处理的条目供 AI 参考
    if (getSetting('clipboard_association_enabled') !== false) {
      const scheduler = getScheduler();
      if (scheduler) {
        const recentItems = scheduler.getAssociationHandler().getRecentItemsForPrompt(5);
        if (recentItems && recentItems !== '（暂无）') {
          userPrompt += `\n\n[已有相关内容（最近处理的5条）]\n${recentItems}\n\n[如果新内容与已有内容有关联，在结果中增加 associated_with 字段，包含 has_association, target_id, association_type(supplement/update/duplicate/related), reason]`;
        }
      }
    }
    
    // 构建 system prompt，注入动态数据
    _sendLog('[AI] 🔧 构建 system prompt...');
    
    // v3.1: 优先使用拆分式 Prompt（Level 1 分类 → Level 2 并行提取）
    const useSplitPrompt = getSetting('clipboard_split_prompt_enabled') !== false; // 默认开启
    if (useSplitPrompt) {
      _sendLog('[AI] 🔀 使用拆分式 Prompt (L1→L2)');
      const splitResult = await analyzeClipboardSplit(text, traceId, userPrompt, isBufferMerged, preResult);
      
      if (splitResult === null) {
        // 降级为单体 Prompt
        _sendLog('[AI] ⚠️ 拆分模式降级，使用单体 Prompt');
      } else if (splitResult.skipped) {
        // L1 判定为闲聊，跳过
        console.log('[AI] Skipped (split mode):', splitResult.reason);
        _sendLog(`[AI] 🚫 拆分模式跳过: ${splitResult.reason}`);
        // 记录反馈
        if (feedbackLogger) {
          feedbackLogger.recordFeedback({
            module: 'clipboard_analysis',
            action: 'skip',
            trace_id: traceId,
            ai_output: splitResult.classification,
            context: { source_input: text.substring(0, 200) },
            reason: splitResult.reason,
          });
        }
        return;
      } else {
        // 拆分模式成功，使用合并结果
        analysisResult = splitResult;
        confidence = splitResult.confidence || 0;
        isTask = splitResult.is_task;
        taskTitle = splitResult.title;
        // 跳过后续的单体 Prompt 调用
        _skipOriginalFlow = true;
      }
    }
    
    if (!_skipOriginalFlow) {
    let systemPrompt;
    try {
      systemPrompt = buildClipboardAnalysisPrompt(traceId);
      _sendLog(`[AI] ✅ System prompt 构建完成 (${systemPrompt.length}字)`);
    } catch (promptErr) {
      _sendLog(`[AI] ❌ System prompt 构建失败: ${promptErr.message}`);
      throw promptErr; // 重新抛出，让外层 catch 处理
    }
    
    _sendLog(`[AI] 📤 调用AI API (clipboard_analysis)`);
    const { response } = await callAI({
      module: 'clipboard_analysis',
      category: 'highvol',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      traceId,
    });
    
    // 记录 AI 调用 trace
    const analysisStartTs = Date.now();
    if (feedbackLogger) {
      feedbackLogger.recordTrace({
        trace_id: traceId, ts: new Date(analysisStartTs).toISOString(),
        module: 'clipboard_analysis', prompt_version: 'task_recognition_v2.0',
        model: apiConfig.model,
        input: { text: text.substring(0, 200), pre_classify: preResult.reason },
        output: null, latency_ms: null
      });
    }

    if (!response.ok) {
      console.error('[AI] API response not OK:', response.status);
      _sendLog(`[AI] ❌ API响应异常: status=${response.status} ${response.statusText}`);
      // 尝试读取错误信息
      try {
        const errBody = await response.text();
        _sendLog(`[AI] ❌ 错误详情: ${errBody.substring(0, 300)}`);
      } catch (_) {}
      // 保存到记忆系统
      if (memoryStore) {
        const bizCat = classifyBusinessContext(text);
        memoryStore.addMemory({
          type: MEMORY_TYPES.SHORT,
          category: MEMORY_CATEGORIES.CLIPBOARD,
          business_category: bizCat.length > 0 ? bizCat[0] : BUSINESS_CATEGORIES.OTHER,
          content: text,
          metadata: {
            preClassification: preResult,
            analyzed: false,
            reason: `API调用失败: ${response.status}`
          },
          confidence: 0,
          importance: 'low'
        });
      }
      return;
    }

    // 4. 调用成功后增加计数并标记内容为已处理
    incrementAICallCount();
    markClipboardProcessed(text);
    
    const data = await response.json();
    console.log('[AI] Response received:', JSON.stringify(data).substring(0, 200));
    _sendLog(`[AI] 📨 收到AI响应 (status=${response.status})`);
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      let result;
      try {
        // 尝试提取 JSON（兼容 markdown 代码块包裹）
        let contentStr = data.choices[0].message.content.trim();
        const jsonMatch = contentStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          contentStr = jsonMatch[1].trim();
        }
        result = JSON.parse(contentStr);
        analysisResult = result;
        confidence = result.confidence || 0;
        isTask = result.is_task || false;
        taskTitle = result.title || null;
        const summary = JSON.stringify({
          is_valid_info: result.is_valid_info,
          is_task: result.is_task,
          needs_recommendation: result.needs_recommendation,
          recommendation_intent: result.recommendation_intent,
          recommendation_query: result.recommendation_query,
          confidence: result.confidence
        });
        console.log('[AI] Parsed result:', summary);
        _sendLog(`[AI] 🎯 解析结果: is_valid_info=${result.is_valid_info} is_task=${result.is_task} confidence=${confidence} title=${taskTitle}`);
      } catch (e) {
        console.error('[AI] Failed to parse response:', e, 'Raw:', data.choices[0].message.content?.substring(0, 200));
        _sendLog(`[AI] ❌ 解析AI响应失败: ${e.message} | Raw: ${data.choices[0].message.content?.substring(0, 100)}`);
        // 保存到记忆系统
        if (memoryStore) {
          const bizCat = classifyBusinessContext(text);
          memoryStore.addMemory({
            type: MEMORY_TYPES.SHORT,
            category: MEMORY_CATEGORIES.CLIPBOARD,
            business_category: bizCat.length > 0 ? bizCat[0] : BUSINESS_CATEGORIES.OTHER,
            content: text,
            metadata: {
              preClassification: preResult,
              analyzed: true,
              parseError: e.message,
              rawResponse: data.choices[0].message.content
            },
            confidence: 0,
            importance: 'low'
          });
        }
        return;
      }
    } // end if (!_skipOriginalFlow)
      
      // 保存到记事本 —— 仅保存有效信息（闲聊/无效内容不入记事本）
      // 动态匹配分类：优先使用 AI 返回的 category，再根据 tags 匹配
      let result = analysisResult; // 兼容拆分模式和单体模式
      let noteCategory = result.category || null; // AI 直接返回的 category key
      
      if (!noteCategory) {
        if (result.is_task) {
          noteCategory = 'task';
        } else if (result.tags && result.tags.length > 0) {
          // 从自定义分类中匹配
          const customCategories = notebook.getCustomCategories();
          for (const tag of result.tags) {
            const matchedKey = Object.keys(customCategories).find(key =>
              customCategories[key].label && customCategories[key].label.includes(tag)
            );
            if (matchedKey) {
              noteCategory = matchedKey;
              break;
            }
          }
          // 默认分类映射
          if (!noteCategory) {
            const defaultMapping = {
              '问题': 'feedback', '反馈': 'feedback', 'bug': 'feedback', '报错': 'feedback',
              '会议': 'meeting', '讨论': 'meeting',
              '想法': 'idea', '创意': 'idea', '设计': 'idea',
              '工作': 'task', '项目': 'task'
            };
            for (const [keyword, cat] of Object.entries(defaultMapping)) {
              if (result.tags.some(t => t.includes(keyword))) {
                noteCategory = cat;
                break;
              }
            }
          }
        }
      }
      if (!noteCategory) noteCategory = 'general';

      // 关联检测：在保存前检查是否与已有内容关联
      let associationResult = { handled: false, action: null, targetId: null };
      if (getSetting('clipboard_association_enabled') !== false && result.associated_with) {
        const scheduler = getScheduler();
        if (scheduler) {
          associationResult = scheduler.getAssociationHandler().handleAssociation(result.associated_with, text);
          console.log('[Association] Result:', associationResult.action, associationResult.targetId);

          // 通知前端关联结果
          if (associationResult.handled && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('clipboard-association-detected', {
              action: associationResult.action,
              targetId: associationResult.targetId,
              reason: result.associated_with.reason
            });
          }
        }
      }

      // 重复内容跳过
      if (associationResult.action === 'duplicate') {
        console.log('[Association] Duplicate content, skipping save');
        return;
      }

      // 🔧 合并文本 AI 优化：将多次复制拼接的内容优化为通顺完整的表述
      let optimizedText = text; // 最终用于保存的文本
      let optimizationSource = null; // 来源标注
      if (isBufferMerged && fragmentCount > 1 && rawJoinedText) {
        _sendLog(`[AI] 🔄 开始优化合并文本 (${fragmentCount}次复制, ${rawJoinedText.length}字)...`);
        const optimized = await optimizeMergedText(rawJoinedText, fragmentCount);
        if (optimized) {
          optimizedText = optimized + `\n\n（从剪贴板 ${fragmentCount} 次复制的内容拼接优化）`;
          optimizationSource = `clipboard_merge_optimized_${fragmentCount}`;
          _sendLog(`[AI] ✅ 合并文本优化完成，原文 ${rawJoinedText.length}字 → 优化 ${optimized.length}字`);
        } else {
          // 优化失败，使用原始拼接文本但标注来源
          optimizedText = rawJoinedText + `\n\n（从剪贴板 ${fragmentCount} 次复制的内容拼接）`;
          _sendLog(`[AI] ⚠️ 合并文本优化失败，使用原始拼接文本`);
        }
      }

      // 仅有效信息保存到记事本
      let savedNoteId = null;
      if (result.is_valid_info && notebook) {
        // SMART 标签：根据 smart_level 添加对应标签
        const smartTags = [];
        if (result.smart_level === 'smart_full') {
          smartTags.push('SMART');
        } else if (result.smart_level === 'smart_partial') {
          smartTags.push('待完善');
        } else if (result.smart_level === 'smart_insufficient') {
          smartTags.push('信息不全');
        }

        const noteData = {
          content: optimizedText,
          // 使用 AI 提炼的标题，而非原文截断
          title: result.title || null,
          category: noteCategory,
          tags: [...(result.tags || []), ...smartTags],
          analyzed: true,
          analysis: {
            traceId: traceId,
            isTask: result.is_task,
            taskTitle: result.title,
            taskPriority: result.priority,
            tags: [...(result.tags || []), ...smartTags],
            reason: result.reason,
            time: result.time,
            description: result.description,
            confidence: confidence,
            needsRecommendation: result.needs_recommendation || false,
            recommendationIntent: result.recommendation_intent || null,
            // SMART 评估结果
            smartLevel: result.smart_level || null,
            smartMissing: result.smart_missing || [],
            smartOptimized: result.smart_optimized || false
          }
        };

        // 关联标记
        if (associationResult.action === 'related' && associationResult.targetId) {
          noteData.relatedTo = associationResult.targetId;
        }
        const note = notebook.addNote(noteData);
        savedNoteId = note ? note.id : null;
        console.log('[Notebook] Valid info saved to notebook, category:', noteCategory);
        
        // 通知前端有新笔记
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('new-note-added', {
            source: 'clipboard',
            title: result.title || text.substring(0, 30)
          });
        }

        // 知识萃取：异步提取知识原子（不阻塞主流程）
        if (knowledgeStore && savedNoteId) {
          extractKnowledgeAtoms(optimizedText, savedNoteId, result.tags).catch(err => {
            console.error('[Knowledge] Atom extraction error:', err);
          });
        }
      } else {
        console.log('[Notebook] Skipped: not valid info -', result.reason);
      }
      
      // 提取结构化记忆（只保存提炼后的有效信息）
      if (memoryStore && result.is_valid_info && (result.is_task || confidence >= 0.7)) {
        // v3.1: split 模式下 L2b 已合并记忆提取，直接使用结果，跳过独立 AI 调用
        if (result._split_mode && result.memory_type) {
          try {
            const memoryType = result.memory_type === 'instant' ? MEMORY_TYPES.INSTANT :
                              result.memory_type === 'long' ? MEMORY_TYPES.LONG : MEMORY_TYPES.SHORT;
            memoryStore.addMemory({
              type: memoryType,
              category: result.memory_category || MEMORY_CATEGORIES.KNOWLEDGE,
              business_category: classifyBusinessContext(text).length > 0 ? classifyBusinessContext(text)[0] : BUSINESS_CATEGORIES.OTHER,
              content: result.summary || text.substring(0, 100),
              metadata: {
                persons: result.persons || [],
                topics: result.topics || [],
                keyPoints: result.key_points || [],
                sentiment: result.sentiment || 'neutral',
                entities: result.entities || [],
                linkedKnownPersons: result.linked_known_persons || [],
                linkedKnownProjects: result.linked_known_projects || [],
                ttlHint: result.ttl_hint || null,
                originalNoteId: savedNoteId,
                extractedFrom: 'clipboard_split',
                smartLevel: result.smart_level || null,
                smartMissing: result.smart_missing || []
              },
              confidence: confidence,
              importance: result.importance || 'normal'
            });
            console.log('[Memory] Structured memory saved (split mode, no extra AI call)');
            // 审计日志：记录 split 模式记忆提取（复用 L2b 结果，无独立 AI 调用）
            if (auditLogger) {
              auditLogger.log({
                module: 'clipboard_memory',
                action: 'save_split',
                input: { text_preview: text.substring(0, 100), trace_id: traceId },
                output: {
                  memory_type: result.memory_type,
                  memory_category: result.memory_category,
                  summary: result.summary?.substring(0, 80),
                  persons_count: (result.persons || []).length,
                  topics_count: (result.topics || []).length,
                  entities_count: (result.entities || []).length,
                  importance: result.importance,
                  smart_level: result.smart_level,
                },
                traceId,
                source: 'clipboard_info_extract',
              });
            }
          } catch (memError) {
            console.error('[Memory] Failed to save split memory:', memError);
          }
        } else {
          // 单体模式 / 降级模式：调用记忆提取 Prompt
          try {
            const { response: memoryResponse } = await callAI({
              module: 'clipboard_memory',
              category: 'highvol',
              messages: [
                { role: 'system', content: getCurrentMemoryPrompt() },
                { role: 'user', content: `从以下文本中提取结构化记忆：\n\n${optimizedText}` }
              ],
              traceId,
            });
            
            if (memoryResponse.ok) {
              const memoryData = await memoryResponse.json();
              if (memoryData.choices && memoryData.choices[0]) {
                // 兼容 markdown 代码块包裹的 JSON
                let memoryContent = memoryData.choices[0].message.content.trim();
                const memoryJsonMatch = memoryContent.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (memoryJsonMatch) {
                  memoryContent = memoryJsonMatch[1].trim();
                }
                const memoryResult = JSON.parse(memoryContent);
                
                // 根据提取的信息类型保存到记忆系统
                const memoryType = memoryResult.memory_type === 'instant' ? MEMORY_TYPES.INSTANT :
                                  memoryResult.memory_type === 'long' ? MEMORY_TYPES.LONG : MEMORY_TYPES.SHORT;
                
                memoryStore.addMemory({
                  type: memoryType,
                  category: memoryResult.category || MEMORY_CATEGORIES.KNOWLEDGE,
                  business_category: memoryResult.business_category || (classifyBusinessContext(text).length > 0 ? classifyBusinessContext(text)[0] : BUSINESS_CATEGORIES.OTHER),
                  content: memoryResult.summary || text.substring(0, 100),
                  metadata: {
                    persons: memoryResult.persons || [],
                    topics: memoryResult.topics || [],
                    keyPoints: memoryResult.key_points || [],
                    sentiment: memoryResult.sentiment || 'neutral',
                    entities: memoryResult.entities || [],
                    originalNoteId: savedNoteId,
                    extractedFrom: 'clipboard',
                    smartLevel: memoryResult.smart_level || null,
                    smartMissing: memoryResult.smart_missing || []
                  },
                  confidence: confidence,
                  importance: memoryResult.importance || 'normal'
                });
                console.log('[Memory] Structured memory extracted and saved');
              }
            }
          } catch (memoryError) {
            console.error('[Memory] Failed to extract memory:', memoryError);
          }
        }
      }
      
      // 知识推荐：由 AI 判断是否需要推荐（替代原 regex 分类）
      const needsRecommendation = result.needs_recommendation || false;
      const recommendationIntent = result.recommendation_intent || null;
      const recommendationQuery = result.recommendation_query || text.substring(0, 100);

      // 计算分析结论标签
      let analysisStatus = '无需推荐'; // 默认
      if (!result.is_valid_info) {
        analysisStatus = '闲聊';
      } else if (needsRecommendation) {
        analysisStatus = '已推荐知识';
      } else if (result.is_task) {
        analysisStatus = '识别为待办';
      } else if (result.is_valid_info) {
        analysisStatus = '已提炼记忆';
      }

      // 更新记事本笔记的分析状态标签
      if (result.is_valid_info && savedNoteId && notebook) {
        const note = notebook.notes.find(n => n.id === savedNoteId);
        if (note && note.analysis) {
          note.analysis.status = analysisStatus;
          note.analysis.hasRecommendation = needsRecommendation;
          notebook.saveNotes();
        }
      }

      // 更新 trace 输出
      if (feedbackLogger) {
        feedbackLogger.recordTrace({
          trace_id: traceId, ts: new Date().toISOString(),
          module: 'clipboard_analysis', prompt_version: 'task_recognition_v2.0',
          model: apiConfig.model,
          input: { text: text.substring(0, 200) },
          output: JSON.stringify(result),
          latency_ms: Date.now() - analysisStartTs
        });
      }

      if (result.is_task && confidence >= FILTER_CONFIG.confidenceThreshold) {
        // 高置信度：自动弹出建议
        console.log('[AI] High confidence task detected:', result.title, 'confidence:', confidence);
        _sendLog(`[AI] ✅ 高置信度待办! title="${result.title}" confidence=${confidence} (阈值=${FILTER_CONFIG.confidenceThreshold})`);
        // 时间语义校验：确保 AI 解析的小时与原始文本中的上午/下午语义一致
        let dueDateISO = result.time?.normalized ? new Date(result.time.normalized).toISOString() : null;
        if (dueDateISO && result.time?.raw) {
          dueDateISO = validateTimeSemantic(result.time.raw, dueDateISO);
        }
        
        mainWindow.webContents.send('clipboard-task-detected', {
          rawText: optimizedText,
          task: {
            title: result.title,
            description: result.description,
            dueDate: dueDateISO,
            priority: result.priority || 'medium',
            estimatedDuration: 60,
            tags: result.tags || [],
            confidence: confidence,
            reason: result.reason
          },
          knowledgeIntent: recommendationIntent
        });
      } else if (result.is_task && confidence >= FILTER_CONFIG.lowConfidenceThreshold) {
        // 中等置信度：静默加入候选
        console.log('[AI] Medium confidence task, adding to candidates:', result.title, 'confidence:', confidence);
        _sendLog(`[AI] 🟡 中等置信度待办: title="${result.title}" confidence=${confidence}`);
        mainWindow.webContents.send('clipboard-candidate-detected', {
          rawText: optimizedText,
          task: {
            title: result.title,
            description: result.description,
            priority: result.priority || 'medium',
            confidence: confidence,
            reason: result.reason
          },
          knowledgeIntent: recommendationIntent
        });
      } else {
        console.log('[AI] No task or low confidence:', result.reason || 'confidence too low');
        _sendLog(`[AI] ℹ️ 未识别为待办: is_task=${result.is_task} confidence=${confidence} 阈值=${FILTER_CONFIG.confidenceThreshold}/${FILTER_CONFIG.lowConfidenceThreshold} reason=${result.reason || 'N/A'}`);
      }

      // 知识跟随：AI 判断需要推荐时，异步调用 ADP
      if (needsRecommendation && recommendationIntent) {
        console.log('[Knowledge] AI recommends knowledge, intent:', recommendationIntent, 'query:', recommendationQuery, '- triggering ADP');
        triggerKnowledgeRecommendation(recommendationQuery, recommendationIntent);
      } else {
        console.log('[Knowledge] No recommendation needed. needs_recommendation:', needsRecommendation, 'intent:', recommendationIntent);
      }
    }
  } catch (error) {
    console.error('[AI] ❌ 分析失败:', error);
    _sendLog(`[AI] ❌ 分析失败: ${error.message}\n${error.stack?.substring(0, 200)}`);
  } finally {
    console.log('[AI] ✅ 分析流程结束');
    _sendLog('[AI] ✅ 分析流程结束');
    // 通知 Scheduler 分析完成，处理待重试队列
    const scheduler = getScheduler();
    if (scheduler) scheduler.onAnalysisComplete();
  }
}

async function estimateTaskDuration(task) {
  try {
    const { response } = await callAI({
      module: 'estimate_duration',
      category: 'highvol',
      messages: [
        { role: 'system', content: '你是一个时间管理专家，能够准确预估任务所需时间。只返回数字（分钟数）。' },
        { role: 'user', content: `预估以下任务需要多少分钟完成：\n\n任务：${task.title}\n描述：${task.description || '无'}` }
      ],
    });

    const data = await response.json();
    const duration = parseInt(data.choices[0].message.content) || 60;
    return duration;
  } catch (error) {
    console.error('时间预估失败:', error);
    return 60;
  }
}

// 时间语义校验：确保 AI 解析的小时与原始文本中的上午/下午语义一致
function validateTimeSemantic(rawTime, isoDate) {
  if (!rawTime || !isoDate) return isoDate;
  
  const date = new Date(isoDate);
  const hour = date.getHours();
  const now = new Date();
  let corrected = false;
  
  // 日期校正：如果时间词暗示"今天"但 AI 解析成了明天，修正为今天
  // "晚上/今晚/下午"等无"明天"前缀的时间词，默认指当天
  const hasTomorrowPrefix = /明天|明晚|明早|明下午/.test(rawTime);
  if (!hasTomorrowPrefix) {
    const targetHour = /晚上|今晚|傍晚/.test(rawTime) ? 19 : 
                       /下午|午后/.test(rawTime) ? 14 : 
                       /上午|早上|早晨|清晨/.test(rawTime) ? 9 : 
                       /中午/.test(rawTime) ? 12 : -1;
    
    if (targetHour > 0) {
      // 检查解析出的日期是否是明天
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.getDate() === tomorrow.getDate() && 
                          date.getMonth() === tomorrow.getMonth();
      
      if (isTomorrow) {
        // 如果当前时间还没过该时段，应该指向今天而非明天
        // 例如：当前下午3点说"晚上六点半"，应指今天晚上
        // 但如果当前晚上11点说"晚上"，则明天晚上才合理
        const currentHour = now.getHours();
        const isAlreadyPast = currentHour >= targetHour + 3; // 当前时间已过该时段+3小时缓冲
        
        if (!isAlreadyPast) {
          date.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
          corrected = true;
          console.log(`[Time] 日期校正: "${rawTime}" 从明天修正为今天（当前${currentHour}点，未过${targetHour}点时段）`);
        }
      }
    }
  }
  
  // 小时校正：修正 AI 时间语义不匹配
  // 上午：8-11点，如果解析结果在12点之后，修正为9点
  if (/上午|早上|早晨|清晨/.test(rawTime) && hour >= 12) {
    date.setHours(9, 0, 0, 0);
    corrected = true;
  }
  // 下午：13-17点，如果解析结果在12点之前，修正为14点
  else if (/下午|午后/.test(rawTime) && hour < 12) {
    date.setHours(14, 0, 0, 0);
    corrected = true;
  }
  // 晚上：19-22点
  else if (/晚上|今晚|傍晚/.test(rawTime) && hour < 18) {
    date.setHours(19, 0, 0, 0);
    corrected = true;
  }
  // 中午：12点
  else if (/中午/.test(rawTime) && (hour < 11 || hour > 13)) {
    date.setHours(12, 0, 0, 0);
    corrected = true;
  }
  
  // 保留原文中的具体时间（如"六点半"→18:30）
  const timeMatch = rawTime.match(/(\d{1,2})[点时:：](\d{1,2})?/);
  if (timeMatch) {
    let parsedHour = parseInt(timeMatch[1]);
    const parsedMin = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    
    // "下午3点"/"晚上6点半"等含时段词的时间
    if (/下午|午后|晚上|今晚|傍晚/.test(rawTime) && parsedHour < 12) {
      parsedHour += 12; // 下午6点 → 18点
    }
    if (/上午|早上|早晨|清晨/.test(rawTime) && parsedHour >= 12) {
      parsedHour -= 12; // 上午14点 → 2点（异常修正）
    }
    
    if (parsedHour >= 0 && parsedHour < 24 && parsedMin >= 0 && parsedMin < 60) {
      date.setHours(parsedHour, parsedMin, 0, 0);
      corrected = true;
    }
  }
  
  if (corrected) {
    console.log(`[Time] 校正时间语义: "${rawTime}" → ${date.toLocaleString('zh-CN')}`);
  }
  
  return date.toISOString();
}

function addToCalendar(task) {
  const startDate = new Date(task.dueDate);
  startDate.setHours(startDate.getHours() - (task.estimatedDuration / 60));
  const endDate = new Date(task.dueDate);

  const startStr = startDate.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const endStr = endDate.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const script = `
tell application "Calendar"
  if not (exists calendar "TaskFlow") then
    make new calendar with properties {name:"TaskFlow"}
  end if
  tell calendar "TaskFlow"
    make new event at end of events with properties ¬
      {summary:"${task.title}", ¬
       start date:date "${startStr}", ¬
       end date:date "${endStr}", ¬
       description:"${task.description || '预估时长: ' + task.estimatedDuration + '分钟'}"}
  end tell
end tell
`;

  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (error) => {
    if (error) {
      console.error('添加到日历失败:', error);
    }
  });
}

function removeFromCalendar(taskTitle) {
  if (!taskTitle) return;
  // 删除 TaskFlow 日历中标题匹配的事件
  const script = `
tell application "Calendar"
  if exists calendar "TaskFlow" then
    tell calendar "TaskFlow"
      set eventsToDelete to every event whose summary is "${taskTitle.replace(/"/g, '\\"')}"
      repeat with evt in eventsToDelete
        delete evt
      end repeat
    end tell
  end if
end tell
`;
  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (error) => {
    if (error) {
      console.error('[Calendar] 删除日历事件失败:', error);
    } else {
      console.log('[Calendar] 已删除日历事件:', taskTitle);
    }
  });
}

function showNotification(title, body) {
  console.log('[Notification] show:', title, '|', body, '| isSupported:', Notification.isSupported());
  if (Notification.isSupported()) {
    try {
      const notification = new Notification({
        title: title,
        body: body,
        icon: getResourcePath('resources/icon.png'),
        sound: 'default',
        silent: false
      });
      // 用户点击系统通知 → 自动聚焦应用窗口
      notification.on('click', () => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
        } catch (e) {
          console.warn('[Notification] focus on click failed:', e.message);
        }
      });
      notification.on('show', () => console.log('[Notification] shown'));
      notification.on('failed', (e, err) => console.warn('[Notification] FAILED:', err));
      notification.show();
    } catch (e) {
      console.error('[Notification] create failed:', e.message);
    }
  } else {
    console.warn('[Notification] not supported on this platform');
  }
}

ipcMain.handle('estimate-duration', async (event, task) => {
  return await estimateTaskDuration(task);
});

// AI分析任务输入
ipcMain.handle('analyze-task', async (event, text) => {
  try {
    if (!canMakeAICall()) {
      return { success: false, error: '每日调用次数已达上限' };
    }
    
    const preResult = preClassify(text);
    let userPrompt = `分析以下文本是否包含待办事项：\n\n${text}`;
    if (preResult.hasAtMention) {
      userPrompt += '\n\n[预分类信号：检测到@提及，这通常是强待办信号]';
    }
    if (preResult.hasNumberedList) {
      userPrompt += '\n\n[预分类信号：检测到编号列表，这通常是任务列表]';
    }
    
    const { response } = await callAI({
      module: 'analyze_task',
      category: 'highvol',
      messages: [
        { role: 'system', content: getCurrentAIPrompt() },
        { role: 'user', content: userPrompt }
      ],
    });
    
    if (!response.ok) {
      return { success: false, error: 'API调用失败' };
    }
    
    incrementAICallCount();
    
    const data = await response.json();
    if (data.choices && data.choices[0] && data.choices[0].message) {
      let result = JSON.parse(data.choices[0].message.content);
      
      return {
        success: true,
        task: {
          title: result.title || '',
          description: result.description || '',
          dueDate: result.time?.normalized ? new Date(result.time.normalized).toISOString() : null,
          priority: result.priority || 'medium',
          estimatedDuration: result.is_task ? 60 : 30,
          confidence: result.confidence || 0,
          isAllDay: result.time?.is_all_day || false,
          tags: result.tags || [],
          reason: result.reason || '',
          // v2.1: AI 分析增强 — 识别周期性任务和 AI 小助手任务
          taskType: result.task_type || 'manual',
          recurrence: result.recurrence || null,
          // v3.1: SMART 评估
          smartLevel: result.smart_level || null,
          smartMissing: result.smart_missing || [],
          smartOptimized: result.smart_optimized || false
        }
      };
    }
  } catch (error) {
    console.error('[AI] Task analysis failed:', error);
    return { success: false, error: error.message };
  }
  
  return { success: false, error: '分析失败' };
});

// AI 续写（Tab 补全）
ipcMain.handle('ai-continue-writing', async (event, context) => {
  try {
    if (!canMakeAICall()) {
      return { success: false, error: '每日AI调用次数已达上限，请明天再试' };
    }

    // structured: true（默认）走 LLM 路径，不走 ADP，保证续写文本可靠性
    const { response } = await callAI({
      module: 'continue_writing',
      category: 'highvol',
      messages: [
        { role: 'system', content: '你是一个写作助手。根据用户已写的内容，续写一句话（约15-30字），保持风格和语境一致。只输出续写的那一句话，不要输出任何解释、前缀或标点包裹。不要重复用户已有的内容。' },
        { role: 'user', content: `请根据以下内容续写一句话：\n\n${context}` }
      ],
    });

    if (!response || !response.ok) {
      const errMsg = response?._errorDetail || 'AI服务暂不可用';
      console.error('[AI Continue] Response not ok:', response?.status, errMsg);
      return { success: false, error: errMsg };
    }

    let continuation = '';
    if (response._fullContent) {
      continuation = response._fullContent.trim();
    } else {
      try {
        const data = await response.json();
        continuation = (data.choices?.[0]?.message?.content || '').trim();
      } catch (e) {
        const text = await response.text().catch(() => '');
        continuation = text.trim();
      }
    }

    incrementAICallCount();

    // 清理可能的多余包裹
    continuation = continuation.replace(/^["「『]|["」』]$/g, '').trim();

    if (!continuation) {
      console.warn('[AI Continue] Empty continuation received');
      return { success: false, error: 'AI未返回续写内容' };
    }

    return { success: true, continuation };
  } catch (error) {
    console.error('[AI Continue] Error:', error);
    return { success: false, error: error.message || '续写出错' };
  }
});

ipcMain.handle('analyze-clipboard', async (event, text) => {
  try {
    if (!canMakeAICall()) {
      return { success: false, error: '每日调用次数已达上限' };
    }
    
    const clipboardPrompt = `你是一个**待办事项与有效信息识别AI**，用户：**朱从坤（英文名 Dean）**。

## 一、总体任务
接收用户粘贴的文本，同时做两件事：
1. **识别是否为待办任务（未来要执行的事项）**
2. **识别是否为有效信息（需要保存到记事本）**

## 二、有效信息判定（保存到记事本）
满足任一条件即为**有效信息**，需要保存：
- 文本中包含 **@朱从坤 或 @Dean**（视为分配给我的待办/关注事项）
- 完整描述了**问题、技术特性、产品特性**
- 完整描述了**产品、客户、商机、项目、需求**等业务信息
- 内容语义完整、信息明确、有保存价值

**不保存**（无效信息）：
- 单纯 URL 链接、纯代码片段
- 语义不完整、碎片化、无实质内容的短句
- 普通聊天、感慨、纯新闻资讯、广告、灌水内容

## 三、待办任务判定（is_task=true）

满足以下**任一强信号**即可判定为待办：
- **@提及 + 行动要求**：如"@Dean 你收集一下"、"@XX 安排" → **强制 is_task=true**
- **编号列表 + 行动描述**：如"1）报价审批流程太重... 2）标前评审..." → **强制 is_task=true**

或**同时满足**以下条件：
1. 有**明确或隐含行动动词**：发送、完成、回复、处理、联系、准备、提交、修复、跟进、收集、反馈、整理、梳理、简化、评审、确认、讨论、沟通、优化、推动、落实、执行、部署、汇总、调研、安排等
2. 有**未来时间 / 隐含待办**（明天、下周、周五之前、后续、需要、记得、看看怎么、想想怎么等）
3. 属于**需要执行/跟进/提醒**的事项

**间接待办识别**（重要！）：
- "我们需要整理" → 是待办（隐含"要去做"）
- "大家有问题反馈到XX这里" → 是待办（隐含行动指令）
- "看看怎么简化" → 是待办（隐含需要做简化这件事）
- "找大家收集" → 是待办（明确行动动词+对象）

**不视为任务**：
- 普通聊天、文章段落、感慨评论、新闻资讯
- 纯代码、纯链接、无行动的陈述、纯知识/说明

## 四、输出格式（严格 JSON，无其他文字）

### 1）是任务（且为有效信息）
\`\`\`json
{
  "is_task": true,
  "confidence": 0.0~1.0,
  "title": "≤20字，简短明确",
  "description": "完整描述内容",
  "time": {
    "raw": "原文时间，无则null",
    "normalized": "仅在明确绝对日期时写YYYY-MM-DD HH:MM:SS，否则null",
    "is_all_day": true/false
  },
  "priority": "high/medium/low",
  "tags": ["工作/技术/客户/商机/待办"等],
  "is_valid_info": true,
  "reason": "同时说明：为什么是任务 + 为什么有效"
}
\`\`\`

### 2）不是任务，但属于有效信息
\`\`\`json
{
  "is_task": false,
  "confidence": 0.0~1.0,
  "title": "≤20字，简短概括",
  "description": "完整描述内容",
  "time": {
    "raw": null,
    "normalized": null,
    "is_all_day": false
  },
  "priority": "medium",
  "tags": ["工作/产品/客户/商机"等],
  "is_valid_info": true,
  "reason": "不是任务，但属于有效信息（如包含@朱从坤/@Dean、完整业务/技术描述）"
}
\`\`\`

### 3）既不是任务，也不是有效信息
\`\`\`json
{
  "is_task": false,
  "confidence": 0.0~1.0,
  "title": null,
  "description": null,
  "time": {
    "raw": null,
    "normalized": null,
    "is_all_day": false
  },
  "priority": null,
  "tags": [],
  "is_valid_info": false,
  "reason": "普通聊天/新闻/纯链接/语义不完整/无保存价值"
}
\`\`\`

## 五、硬性规则（必须遵守）
- **只输出纯 JSON**，不要解释、不要 markdown、不要多余文字
- **title 严格 ≤20 字**，能短则短
- **时间不绝对明确时，normalized 强制为 null，禁止编造**
- confidence 必须在 **0–1** 之间，保留 2 位小数
- 遇到 **@朱从坤 / @Dean** → **is_valid_info=true**，并优先视为待办
- 遇到 **@任何人 + 行动要求** → **is_task=true, confidence >= 0.9**
- 遇到 **编号列表（1）2）3）等）+ 行动描述** → **is_task=true, confidence >= 0.85**`;

    const { response } = await callAI({
      module: 'analyze_clipboard',
      category: 'lowvol',
      messages: [
        { role: 'system', content: clipboardPrompt },
        { role: 'user', content: text }
      ],
      fetchOptions: { temperature: 0.3 },
    });
    
    if (!response.ok) {
      return { success: false, error: 'API调用失败' };
    }
    
    incrementAICallCount();
    
    const data = await response.json();
    if (data.choices && data.choices[0] && data.choices[0].message) {
      let result = JSON.parse(data.choices[0].message.content);
      
      // 适配新的prompt返回格式
      return {
        success: true,
        analysis: {
          is_task: result.is_task || false,
          is_valid_info: result.is_valid_info || false,
          confidence: result.confidence || 0,
          reason: result.reason || '',
          title: result.title || null,
          description: result.description || null,
          time: result.time || { raw: null, normalized: null, is_all_day: false },
          priority: result.priority || 'medium',
          tags: result.tags || []
        }
      };
    }
  } catch (error) {
    console.error('[AI] Clipboard analysis failed:', error);
    return { success: false, error: error.message };
  }
  
  return { success: false, error: '分析失败' };
});

// 本地上下文注入：意图分类（Phase 1）
ipcMain.handle('context:classify-intent', async (event, messageText) => {
  try {
    if (!canMakeAICall()) {
      console.log('[Context] AI call limit reached, using fallback');
      return { success: true, classification: null }; // 兜底策略由渲染进程处理
    }

    const classifyPromptPath = path.join(__dirname, 'prompts', 'context-classify.md');
    let classifyPrompt = '';
    try {
      classifyPrompt = fs.readFileSync(classifyPromptPath, 'utf8');
    } catch (e) {
      console.error('[Context] Failed to read classify prompt:', e);
      return { success: true, classification: null };
    }

    // 3 秒超时
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const { response } = await callAI({
      module: 'context_classify',
      category: 'highvol',
      messages: [
        { role: 'system', content: classifyPrompt },
        { role: 'user', content: messageText }
      ],
      fetchOptions: { temperature: 0.1, signal: controller.signal },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn('[Context] LLM classify failed, status:', response.status);
      return { success: true, classification: null };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // 提取 JSON（可能被 markdown 代码块包裹）
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    try {
      const classification = JSON.parse(jsonStr);
      incrementAICallCount();
      console.log('[Context] Intent classified:', classification.intent_summary);
      return { success: true, classification };
    } catch (parseErr) {
      console.warn('[Context] JSON parse failed, content:', content.substring(0, 100));
      incrementAICallCount();
      return { success: true, classification: null };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('[Context] Classify timed out (3s), using fallback');
      return { success: true, classification: null };
    }
    console.error('[Context] Classify error:', error);
    return { success: true, classification: null };
  }
});

ipcMain.handle('optimize-clipboard-prompt', async (event, feedback) => {
  try {
    const currentPrompt = getSetting('clipboard_prompt') || '';
    
    const optimizePrompt = `你是一个Prompt优化专家。根据用户的反馈，优化以下剪切板识别Prompt：

当前Prompt：
${currentPrompt}

用户反馈：
${feedback}

请返回优化后的完整Prompt，保持原有格式和结构，但根据反馈调整判断逻辑。`;

    if (!canMakeAICall()) {
      return { success: false, error: '每日调用次数已达上限' };
    }
    
    const { response } = await callAI({
      module: 'optimize_prompt',
      category: 'lowvol',
      messages: [
        { role: 'user', content: optimizePrompt }
      ],
      fetchOptions: { temperature: 0.5 },
    });
    
    if (!response.ok) {
      return { success: false, error: 'API调用失败' };
    }
    
    incrementAICallCount();
    
    const data = await response.json();
    if (data.choices && data.choices[0] && data.choices[0].message) {
      const optimizedPrompt = data.choices[0].message.content;
      setSetting('clipboard_prompt', optimizedPrompt);
      
      return { success: true, prompt: optimizedPrompt };
    }
  } catch (error) {
    console.error('[AI] Prompt optimization failed:', error);
    return { success: false, error: error.message };
  }
  
  return { success: false, error: '优化失败' };
});

ipcMain.handle('add-to-calendar', async (event, task) => {
  addToCalendar(task);
  return { success: true };
});

ipcMain.handle('remove-from-calendar', async (event, taskTitle) => {
  removeFromCalendar(taskTitle);
  return { success: true };
});

ipcMain.handle('show-notification', async (event, title, body) => {
  showNotification(title, body);
  return { success: true };
});

// 查询窗口是否聚焦/可见（用于 AI 完成提醒决策）
ipcMain.handle('window:get-focus-state', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { focused: false, visible: false, minimized: false, appFocused: false };
  }
  // 对 macOS 特别处理：app.isFocused() 比 window.isFocused() 更可靠
  // 当应用本身没有聚焦（用户切到其他 App），是真的"切走"了
  let appFocused = true;
  try {
    if (process.platform === 'darwin' && app.isHidden) {
      appFocused = !app.isHidden();
    }
    // 检查应用级 focused 状态
    const focusedWindow = require('electron').BrowserWindow.getFocusedWindow();
    appFocused = !!focusedWindow;
  } catch {}
  return {
    focused: mainWindow.isFocused(),
    visible: mainWindow.isVisible(),
    minimized: mainWindow.isMinimized(),
    appFocused: appFocused
  };
});

// 闪烁应用图标 / Dock 弹跳（点击系统通知后立即聚焦窗口）
ipcMain.handle('window:flash-attention', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false };
  try {
    if (process.platform === 'darwin') {
      // macOS: dock bounce
      app.dock?.bounce?.('informational');
    } else if (process.platform === 'win32') {
      // Windows: 任务栏闪烁
      mainWindow.flashFrame(true);
      setTimeout(() => mainWindow?.flashFrame?.(false), 5000);
    }
    return { success: true };
  } catch (e) {
    console.warn('[Window] flash-attention failed:', e.message);
    return { success: false, error: e.message };
  }
});

// 用户点击系统通知 → 聚焦窗口
ipcMain.handle('window:focus', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false };
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return { success: true };
});

ipcMain.handle('get-clipboard-text', async () => {
  return clipboard.readText();
});

ipcMain.handle('write-clipboard-text', async (event, text) => {
  clipboard.writeText(text);
  return true;
});

// 获取AI每日调用统计
ipcMain.handle('get-ai-stats', async () => {
  initAICallCount();
  const count = parseInt(getSetting(AI_CALLS_KEY) || '0');
  const today = new Date().toISOString().split('T')[0];
  return {
    count,
    limit: AI_DAILY_LIMIT,
    date: today
  };
});

// 获取AI Prompt配置
ipcMain.handle('get-ai-prompt', async () => {
  return getSetting('ai_prompt') || DEFAULT_AI_PROMPT;
});

// 设置AI Prompt配置
ipcMain.handle('set-ai-prompt', async (event, prompt) => {
  setSetting('ai_prompt', prompt);
  return { success: true };
});

// 重置AI Prompt为默认
ipcMain.handle('reset-ai-prompt', async () => {
  setSetting('ai_prompt', '');
  return { success: true, prompt: DEFAULT_AI_PROMPT };
});

// 设置AI每日调用限制
ipcMain.handle('set-ai-daily-limit', async (event, limit) => {
  setAIDailyLimit(limit);
  return { success: true, limit: AI_DAILY_LIMIT };
});

// API配置相关
ipcMain.handle('get-api-config', async () => {
  const config = getAPIConfig();
  const highVolConfig = getHighVolLLMConfig();
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    dailyLimit: config.dailyLimit,
    isCustomKey: config.isCustomKey,
    fromServer: authState.isLoggedIn && !!remoteConfig?.api && !authState.forceLocalConfig,
    forceLocalConfig: authState.forceLocalConfig || false,
    // 大用量 LLM 配置
    highvolBaseUrl: highVolConfig.baseUrl,
    highvolModel: highVolConfig.model,
    highvolApiKeySet: !!highVolConfig.apiKey,
    // 全局 AI 模式
    globalAIMode: getGlobalAIMode(),
  };
});

ipcMain.handle('set-api-config', async (event, config) => {
  if (config.apiKey !== undefined) {
    setSetting('api_key', config.apiKey || '');
  }
  if (config.baseUrl !== undefined) {
    setSetting('api_base_url', config.baseUrl || '');
  }
  if (config.model !== undefined) {
    setSetting('api_model', config.model || '');
  }
  if (config.dailyLimit) {
    setSetting('api_daily_limit', config.dailyLimit.toString());
  }
  // 大用量 LLM 配置（支持清空：空字符串也写入，让 getHighVolLLMConfig 正确回退）
  if (config.highvolApiKey !== undefined) {
    setSetting('highvol_api_key', config.highvolApiKey || '');
  }
  if (config.highvolBaseUrl !== undefined) {
    setSetting('highvol_base_url', config.highvolBaseUrl || '');
  }
  if (config.highvolModel !== undefined) {
    setSetting('highvol_model', config.highvolModel || '');
  }
  return { success: true };
});

// 全局 AI 模式控制
ipcMain.handle('get-global-ai-mode', async () => {
  return { mode: getGlobalAIMode() };
});

ipcMain.handle('set-global-ai-mode', async (event, mode) => {
  const result = setGlobalAIMode(mode);
  if (result) {
    // 通知所有窗口模式已更新
    if (mainWindow) {
      mainWindow.webContents.send('global-ai-mode-changed', mode);
    }
  }
  return { success: result, mode: getGlobalAIMode() };
});

// ============ Claude Code 模式（v2.7）============

// 获取 CC 配置（合并默认值与用户设置）
function getCCConfig() {
  const userDataPath = app.getPath('userData');
  let envVars = [];
  try {
    envVars = JSON.parse(getSetting('cc_env_vars') || '[]');
  } catch (_) { envVars = []; }
  return {
    baseUrl: getSetting('cc_base_url') || DEFAULT_CC_CONFIG.baseUrl,
    authToken: getSetting('cc_auth_token') || DEFAULT_CC_CONFIG.authToken,
    model: getSetting('cc_model') || DEFAULT_CC_CONFIG.model,
    allowedTools: (() => {
      let tools = getSetting('cc_allowed_tools') || DEFAULT_CC_CONFIG.allowedTools;
      // 迁移：确保 Bash/Write/Edit 在允许列表中
      const toolsList = tools.split(',').map(t => t.trim()).filter(Boolean);
      for (const t of ['Bash', 'Write', 'Edit']) {
        if (!toolsList.includes(t)) toolsList.push(t);
      }
      const migrated = toolsList.join(',');
      if (migrated !== tools) {
        setSetting('cc_allowed_tools', migrated);
        console.log(`[CC] Migrated allowedTools: ${tools} → ${migrated}`);
      }
      return migrated;
    })(),
    permissionMode: getSetting('cc_permission_mode') || DEFAULT_CC_CONFIG.permissionMode,
    maxTurns: parseInt(getSetting('cc_max_turns')) || DEFAULT_CC_CONFIG.maxTurns,
    defaultWorkdir: getSetting('cc_default_workdir') || path.join(userDataPath, 'cc-workspace'),
    envVars,
    // OpenRouter 配置
    openRouterApiKey: getSetting('cc_openrouter_api_key') || '',
    openRouterBaseUrl: getSetting('cc_openrouter_base_url') || 'https://openrouter.ai/api/v1',
    openRouterDefaultModel: getSetting('cc_openrouter_default_model') || '',
  };
}

// CC 流式调用状态
let ccAbortController = null;
let ccCurrentSessionId = null;
let ccHasText = false; // 是否收到过文本增量
let ccMemorySyncTimer = null; // 记忆定时同步定时器

/**
 * 生成 CLAUDE.md 内容（从 memora 记忆库提取摘要）
 * CC SDK 子进程启动时会自动读取 cwd/CLAUDE.md 作为跨 session 记忆
 */
function generateCLAUDEMd() {
  if (!memoryStore) return '';

  const memories = memoryStore.getMemories({ limit: 100 });
  if (memories.length === 0) return '';

  // 按类型和业务分类分组
  const grouped = {};
  for (const m of memories) {
    const bizCat = m.business_category || 'other';
    const type = m.type || 'short';
    const key = `${bizCat}/${type}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m.content);
  }

  // 构建分类摘要
  const categoryLabels = {
    'work/short': '💼 工作短期记忆',
    'work/long': '💼 工作长期记忆',
    'personal/short': '🏠 个人短期记忆',
    'personal/long': '🏠 个人长期记忆',
    'study/short': '📚 学习短期记忆',
    'study/long': '📚 学习长期记忆',
    'other/short': '📝 其他短期记忆',
    'other/long': '📝 其他长期记忆',
  };

  let sections = [];
  for (const [key, contents] of Object.entries(grouped)) {
    const label = categoryLabels[key] || key;
    // 每类最多保留 15 条，避免 CLAUDE.md 过长
    const items = contents.slice(0, 15).map((c, i) => `${i + 1}. ${c}`).join('\n');
    sections.push(`### ${label}\n${items}`);
  }

  const stats = memoryStore.getStats();
  const now = new Date().toLocaleString('zh-CN');

  return `# Memora 记忆上下文

> 本文件由 Memora 自动生成，为 Claude Code 提供跨会话记忆。
> 最后更新：${now} | 记忆总数：${stats.total || memories.length}

## 用户记忆摘要

${sections.join('\n\n')}

## 指导原则

- 以上记忆来自用户日常使用 Memora 的积累，请在对话中参考这些上下文
- 当用户提到相关信息时，主动关联记忆中的内容
- 如果对话中产生新的重要信息，请在回复末尾用 \`[MEMORY: 记忆内容]\` 标记，Memora 会自动提取保存
`;
}

/**
 * 将 CLAUDE.md 写入 CC 工作目录
 */
function syncCLAUDEMdToCC(workdir) {
  try {
    const config = getCCConfig();
    const ccWorkdir = workdir || config.defaultWorkdir;
    const claudeMdPath = path.join(ccWorkdir, 'CLAUDE.md');
    const content = generateCLAUDEMd();
    if (content) {
      fs.writeFileSync(claudeMdPath, content, 'utf-8');
      console.log(`[CC] CLAUDE.md synced to ${claudeMdPath} (${content.length} chars)`);
    }
  } catch (e) {
    console.error('[CC] Failed to sync CLAUDE.md:', e.message);
  }
}

/**
 * 从 CC 对话结果中提取记忆标记 [MEMORY: ...] 并存入 memora 记忆库
 */
function extractMemoryFromCCResult(resultText) {
  if (!resultText || !memoryStore) return [];

  const memoryRegex = /\[MEMORY:\s*([^\]]+)\]/g;
  const extracted = [];
  let match;
  while ((match = memoryRegex.exec(resultText)) !== null) {
    const content = match[1].trim();
    if (content) {
      const memory = memoryStore.addMemory({
        content,
        type: 'short',
        business_category: 'other',
        source: 'claude_code',
      });
      extracted.push(memory);
      console.log(`[CC] Memory extracted from CC result: ${content.substring(0, 50)}...`);
    }
  }
  return extracted;
}

/**
 * 启动定时记忆同步（每天晚上 22 点 + 每次 CC 对话前）
 * 注：凌晨 4 点用户可能已关闭客户端，改为晚上 22 点（用户通常在使用）
 */
function startCCMemorySync() {
  if (ccMemorySyncTimer) clearInterval(ccMemorySyncTimer);
  // 每 30 分钟检查一次，晚上 22 点执行整理
  ccMemorySyncTimer = setInterval(() => {
    const now = new Date();
    if (now.getHours() === 22 && now.getMinutes() < 30) {
      console.log('[CC] Daily memory sync triggered (22:00)');
      syncCLAUDEMdToCC();
    }
  }, 30 * 60 * 1000);
}

ipcMain.handle('cc:get-config', async () => {
  const config = getCCConfig();
  // 确保迁移已执行
  migrateOldCCConfig();
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    allowedTools: config.allowedTools,
    permissionMode: config.permissionMode,
    maxTurns: config.maxTurns,
    defaultWorkdir: config.defaultWorkdir,
    envVars: config.envVars,
    authTokenConfigured: !!config.authToken,
    // OpenRouter
    openRouterApiKey: config.openRouterApiKey ? '***configured***' : '',
    openRouterBaseUrl: config.openRouterBaseUrl,
    openRouterDefaultModel: config.openRouterDefaultModel,
    openRouterProxyPort: anthropicProxyPort,
    // 供应商列表 — 返回所有供应商（含未配置），设置面板需要显示全部
    providers: Object.values(PROVIDER_REGISTRY).map(p => {
      const providerConfig = getProviderConfig(p.id);
      const fields = p.fields.map(f => {
        const fieldData = {
          ...f,
          value: providerConfig[f.key] || f.default || '',
        };
        // 模型字段：如果有 AI 解析保存的模型列表，用它覆盖默认 options
        if (f.key === 'model') {
          const savedModels = getSetting(`cc_provider_${p.id}_models`);
          if (savedModels) {
            try {
              const parsed = JSON.parse(savedModels);
              if (Array.isArray(parsed) && parsed.length > 0) {
                fieldData.options = parsed;
              }
            } catch (_) {}
          }
        }
        return fieldData;
      });
      return {
        id: p.id,
        name: p.name,
        shortName: p.shortName,
        region: p.region,
        type: p.type,
        icon: p.icon,
        configured: isProviderConfigured(p.id),
        config: providerConfig,
        fields,
      };
    }),
    activeProvider: getSetting('cc_active_provider') || 'volcano',
  };
});

ipcMain.handle('cc:set-config', async (event, config) => {
  if (config.baseUrl !== undefined) setSetting('cc_base_url', config.baseUrl);
  if (config.authToken !== undefined) setSetting('cc_auth_token', config.authToken);
  if (config.model !== undefined) setSetting('cc_model', config.model);
  if (config.allowedTools !== undefined) setSetting('cc_allowed_tools', config.allowedTools);
  if (config.permissionMode !== undefined) setSetting('cc_permission_mode', config.permissionMode);
  if (config.maxTurns !== undefined) setSetting('cc_max_turns', config.maxTurns);
  if (config.defaultWorkdir !== undefined) setSetting('cc_default_workdir', config.defaultWorkdir);
  if (config.envVars !== undefined) setSetting('cc_env_vars', JSON.stringify(config.envVars));
  // OpenRouter 配置
  if (config.openRouterApiKey !== undefined) setSetting('cc_openrouter_api_key', config.openRouterApiKey);
  if (config.openRouterBaseUrl !== undefined) setSetting('cc_openrouter_base_url', config.openRouterBaseUrl);
  if (config.openRouterDefaultModel !== undefined) setSetting('cc_openrouter_default_model', config.openRouterDefaultModel);
  // 供应商配置
  if (config.providers) {
    for (const [providerId, providerConfig] of Object.entries(config.providers)) {
      const provider = PROVIDER_REGISTRY[providerId];
      if (!provider) continue;
      for (const field of provider.fields) {
        if (providerConfig[field.key] !== undefined) {
          setSetting(`cc_provider_${providerId}_${field.key}`, providerConfig[field.key]);
        }
      }
      if (providerConfig.enabled !== undefined) {
        setSetting(`cc_provider_${providerId}_enabled`, providerConfig.enabled ? 'true' : 'false');
      }
    }
  }
  if (config.activeProvider !== undefined) {
    setSetting('cc_active_provider', config.activeProvider);
  }
  return { success: true };
});

// ─── 供应商管理 IPC ───

ipcMain.handle('cc:get-providers', async () => {
  migrateOldCCConfig();
  return {
    providers: getAvailableProviders().map(p => ({
      id: p.id,
      name: p.name,
      shortName: p.shortName,
      region: p.region,
      type: p.type,
      icon: p.icon,
      fields: p.fields.map(f => {
        const fieldData = {
          ...f,
          value: getSetting(`cc_provider_${p.id}_${f.key}`) || f.default || '',
        };
        // 模型字段：如果有 AI 解析保存的模型列表，用它覆盖默认 options
        if (f.key === 'model') {
          const savedModels = getSetting(`cc_provider_${p.id}_models`);
          if (savedModels) {
            try {
              const parsed = JSON.parse(savedModels);
              if (Array.isArray(parsed) && parsed.length > 0) {
                fieldData.options = parsed;
              }
            } catch (_) {}
          }
        }
        return fieldData;
      }),
      configured: isProviderConfigured(p.id),
      enabled: getSetting(`cc_provider_${p.id}_enabled`) === 'true',
    })),
    activeProvider: getSetting('cc_active_provider') || 'volcano',
  };
});

// AI 解析模型列表 — 用户粘贴模型说明文本，AI 提取为 [{value, label}]
ipcMain.handle('cc:parse-models', async (event, { providerId, text }) => {
  if (!text || !text.trim()) {
    return { success: false, error: '请先粘贴模型列表文本' };
  }

  const parsePrompt = `你是一个模型列表解析助手。用户会粘贴大模型平台提供的模型说明文本（可能包含模型名称、描述、注意事项等）。
请从中提取每个模型的信息，生成 JSON 数组，每个元素格式为：
{"value": "模型ID", "label": "模型名称（简短描述）"}

规则：
1. value 使用小写+连字符格式（如 doubao-seed-2.0-code）
2. label 包含模型名称和简短特征描述（如 "Doubao-Seed-2.0-Code（代码+多模态）"）
3. 如果文本中提到"即将下线"或类似表述，在 label 中标注
4. 如果文本中提到"额度消耗快"或类似注意事项，在 label 中标注
5. 忽略纯说明性文字（如"说明"、"注意"开头的段落），只提取模型条目
6. 只输出纯 JSON 数组，不要解释、不要 markdown 代码块

示例输入：
Auto
默认选择。智能调度模型。
Doubao-Seed-2.0-Code
支持多模态视觉理解。代码能力强化。

示例输出：
[{"value":"auto","label":"Auto（智能调度）"},{"value":"doubao-seed-2.0-code","label":"Doubao-Seed-2.0-Code（代码+多模态）"}]`;

  try {
    const { response } = await callAI({
      module: 'parse_models',
      category: 'lowvol',
      messages: [
        { role: 'system', content: parsePrompt },
        { role: 'user', content: text },
      ],
      fetchOptions: { temperature: 0.1 },
    });

    if (!response || !response.ok) {
      return { success: false, error: 'AI 解析失败，请检查 LLM 配置' };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // 提取 JSON 数组（容错：可能被 markdown 包裹）
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return { success: false, error: 'AI 未返回有效的模型列表' };
    }

    let models;
    try {
      models = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return { success: false, error: 'AI 返回的 JSON 格式无效' };
    }

    if (!Array.isArray(models) || models.length === 0) {
      return { success: false, error: '未解析到任何模型' };
    }

    // 校验格式
    for (const m of models) {
      if (!m.value || !m.label) {
        return { success: false, error: '模型格式不正确，缺少 value 或 label' };
      }
    }

    // 保存解析结果
    setSetting(`cc_provider_${providerId}_models`, JSON.stringify(models));
    console.log(`[CC] Parsed ${models.length} models for provider ${providerId}`);

    return { success: true, models };
  } catch (e) {
    console.error('[CC] Parse models error:', e);
    return { success: false, error: `解析失败: ${e.message}` };
  }
});

ipcMain.handle('cc:test-provider', async (event, { providerId }) => {
  const provider = PROVIDER_REGISTRY[providerId];
  if (!provider) return { success: false, error: '未知的供应商' };

  const config = getProviderConfig(providerId);
  if (!isProviderConfigured(providerId)) {
    return { success: false, error: `${provider.name} 尚未配置完成` };
  }

  try {
    if (provider.type === 'direct') {
      // 直连模式：发一个简单的 Anthropic Messages API 请求测试
      const baseUrl = config.baseUrl.replace(/\/+$/, '');
      const authToken = config.authToken || config.apiKey;
      const model = config.model;

      const resp = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': authToken,
          'anthropic-version': '2023-06-01',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      if (resp.ok) {
        return { success: true, message: `${provider.name} 连接成功 ✓` };
      } else {
        const errText = await resp.text();
        return { success: false, error: `HTTP ${resp.status}: ${errText.substring(0, 200)}` };
      }
    } else if (provider.type === 'proxy') {
      // 代理模式：测试 OpenAI 兼容端点
      const baseUrl = config.baseUrl.replace(/\/+$/, '');
      const apiKey = config.apiKey;
      const resp = await fetch(`${baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (resp.ok) {
        return { success: true, message: `${provider.name} 连接成功 ✓` };
      } else {
        return { success: false, error: `HTTP ${resp.status}` };
      }
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
  return { success: false, error: '未知错误' };
});

// CC 选择工作目录（系统目录选择器）
ipcMain.handle('cc:pick-directory', async () => {
  try {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择 Claude Code 工作目录',
    });
    if (result.canceled || !result.filePaths.length) {
      return { success: false, canceled: true };
    }
    const dirPath = result.filePaths[0];
    return { success: true, path: dirPath, name: path.basename(dirPath) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============ CC 环境检测 ============

/**
 * 检测 CC 工作目录的运行时环境
 * 检查 Python/Node/Java/Go/Rust/git 等常见工具是否可用，返回版本和路径
 */
ipcMain.handle('cc:check-env', async (_event, workdir) => {
  const { execFile } = require('child_process');
  const config = getCCConfig();
  const ccWorkdir = workdir || config.defaultWorkdir;

  const tools = [
    { name: 'Python3', cmd: 'python3', args: ['--version'], category: 'python', install: { brew: 'python@3.12', desc: 'Python 3 解释器' } },
    { name: 'Python', cmd: 'python', args: ['--version'], category: 'python', install: null },
    { name: 'pip3', cmd: 'pip3', args: ['--version'], category: 'python', install: { brew: 'python@3.12', desc: 'pip3 随 Python 3 安装' } },
    { name: 'pip', cmd: 'pip', args: ['--version'], category: 'python', install: null },
    { name: 'uv', cmd: 'uv', args: ['--version'], category: 'python', install: { brew: 'uv', desc: '极速 Python 包管理器' } },
    { name: 'conda', cmd: 'conda', args: ['--version'], category: 'python', install: { brew: '--cask miniconda', desc: 'Conda 环境管理器' } },
    { name: 'Node.js', cmd: 'node', args: ['--version'], category: 'node', install: { brew: 'node', desc: 'Node.js 运行时' } },
    { name: 'npm', cmd: 'npm', args: ['--version'], category: 'node', install: { brew: 'node', desc: 'npm 随 Node.js 安装' } },
    { name: 'pnpm', cmd: 'pnpm', args: ['--version'], category: 'node', install: { brew: 'pnpm', desc: '快速磁盘节省型包管理器' } },
    { name: 'yarn', cmd: 'yarn', args: ['--version'], category: 'node', install: { brew: 'yarn', desc: 'Yarn 包管理器' } },
    { name: 'bun', cmd: 'bun', args: ['--version'], category: 'node', install: { brew: 'oven-sh/bun/bun', desc: 'Bun 全栈运行时' } },
    { name: 'Java', cmd: 'java', args: ['-version'], category: 'java', install: { brew: 'openjdk@21', desc: 'OpenJDK 21' } },
    { name: 'Go', cmd: 'go', args: ['version'], category: 'go', install: { brew: 'go', desc: 'Go 语言工具链' } },
    { name: 'Rust (cargo)', cmd: 'cargo', args: ['--version'], category: 'rust', install: { brew: 'rustup', desc: 'Rust 工具链管理器' } },
    { name: 'Git', cmd: 'git', args: ['--version'], category: 'vcs', install: { brew: 'git', desc: '版本控制系统' } },
    { name: 'curl', cmd: 'curl', args: ['--version'], category: 'net', install: { brew: 'curl', desc: 'HTTP 请求工具' } },
    { name: 'jq', cmd: 'jq', args: ['--version'], category: 'util', install: { brew: 'jq', desc: '命令行 JSON 处理器' } },
    { name: 'sqlite3', cmd: 'sqlite3', args: ['--version'], category: 'db', install: { brew: 'sqlite', desc: 'SQLite 数据库' } },
    { name: 'make', cmd: 'make', args: ['--version'], category: 'build', install: { brew: 'make', desc: '构建工具' } },
    { name: 'gcc', cmd: 'gcc', args: ['--version'], category: 'build', install: { brew: 'gcc', desc: 'GNU 编译器' } },
  ];

  function checkTool(tool) {
    return new Promise((resolve) => {
      execFile(tool.cmd, tool.args, { cwd: ccWorkdir, timeout: 5000, env: process.env }, (err, stdout, stderr) => {
        if (err) {
          resolve({ ...tool, available: false, version: '', path: '' });
        } else {
          // java -version 输出到 stderr
          const output = (stdout + stderr).trim().split('\n')[0];
          resolve({ ...tool, available: true, version: output, path: '' });
        }
      });
    });
  }

  // 并行检测所有工具
  const results = await Promise.all(tools.map(checkTool));

  // 按类别分组
  const grouped = {};
  for (const r of results) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r);
  }

  // 检测重要环境变量
  const envVars = {};
  const importantVars = [
    'PYTHONPATH', 'VIRTUAL_ENV', 'PIP_INDEX_URL',
    'NODE_PATH', 'npm_config_registry', 'NVM_DIR',
    'JAVA_HOME', 'GOPATH', 'GOROOT',
    'CARGO_HOME', 'RUSTUP_HOME',
    'PKG_CONFIG_PATH', 'LIBRARY_PATH', 'DYLD_LIBRARY_PATH',
    'SHELL', 'TMPDIR', 'LANG', 'TERM',
  ];
  for (const key of importantVars) {
    if (process.env[key]) envVars[key] = process.env[key];
  }

  return {
    success: true,
    workdir: ccWorkdir,
    tools: results,
    grouped,
    envVars,
    platform: process.platform,
  };
});

/**
 * 一键安装缺失工具（macOS 用 Homebrew，Linux 用 apt）
 * 通过 SSE 流式推送安装进度到前端
 */
ipcMain.handle('cc:install-tool', async (event, { toolName, brewPackage, workdir }) => {
  const platform = process.platform;
  const ccWorkdir = workdir || getCCConfig().defaultWorkdir;

  // 检查 Homebrew 是否安装（macOS）
  let hasBrew = false;
  if (platform === 'darwin') {
    try {
      require('child_process').execSync('which brew', { timeout: 3000 });
      hasBrew = true;
    } catch (_) {}
  }

  let cmd, args, env;
  if (platform === 'darwin' && hasBrew) {
    // macOS: 使用 Homebrew
    cmd = 'brew';
    args = ['install', ...brewPackage.split(' ')];
    env = process.env;
  } else if (platform === 'darwin' && !hasBrew) {
    // macOS 无 brew：先安装 Homebrew
    return {
      success: false,
      error: '未检测到 Homebrew。请先安装 Homebrew：在终端运行 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      needBrew: true,
    };
  } else if (platform === 'linux') {
    // Linux: 使用 apt（Ubuntu/Debian）
    const aptMap = {
      'python@3.12': 'python3 python3-pip',
      'python@3.11': 'python3 python3-pip',
      'uv': 'python3-pip',
      'node': 'nodejs npm',
      'pnpm': 'npm',
      'yarn': 'npm',
      'openjdk@21': 'default-jdk',
      'go': 'golang',
      'rustup': 'rustc cargo',
      'git': 'git',
      'jq': 'jq',
      'sqlite': 'sqlite3',
      'make': 'make',
      'gcc': 'gcc',
    };
    const aptPackage = aptMap[brewPackage] || brewPackage;
    cmd = 'sudo';
    args = ['apt-get', 'install', '-y', ...aptPackage.split(' ')];
    env = process.env;
  } else {
    return {
      success: false,
      error: `暂不支持平台 ${platform} 的一键安装，请手动安装 ${toolName}`,
    };
  }

  // 流式执行安装命令
  const { spawn } = require('child_process');
  const child = spawn(cmd, args, { cwd: ccWorkdir, env, shell: false });

  let stdoutBuf = '';
  let stderrBuf = '';

  child.stdout.on('data', (data) => {
    const text = data.toString();
    stdoutBuf += text;
    // 推送安装进度到前端
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cc:install-progress', { toolName, stream: 'stdout', data: text });
    }
  });

  child.stderr.on('data', (data) => {
    const text = data.toString();
    stderrBuf += text;
    // brew/apt 进度信息走 stderr
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cc:install-progress', { toolName, stream: 'stderr', data: text });
    }
  });

  return new Promise((resolve) => {
    child.on('close', (code) => {
      const success = code === 0;
      resolve({
        success,
        toolName,
        exitCode: code,
        stdout: stdoutBuf.slice(-2000),
        stderr: stderrBuf.slice(-2000),
        message: success ? `${toolName} 安装成功` : `${toolName} 安装失败 (exit ${code})`,
      });
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        toolName,
        error: err.message,
        message: `${toolName} 安装异常: ${err.message}`,
      });
    });
  });
});

// ============ MCP 连接器管理 ============

// 危险命令黑名单（stdio 类型连接器）
const DANGEROUS_COMMANDS = ['rm', 'mv', 'dd', 'mkfs', 'fdisk', 'shred', 'chmod', 'chown', 'kill', 'killall'];

function getConnectors() {
  try {
    return JSON.parse(getSetting('mcp_connectors') || '[]');
  } catch (_) { return []; }
}

function saveConnectors(connectors) {
  setSetting('mcp_connectors', JSON.stringify(connectors));
}

function validateConnector(conn) {
  if (!conn.name || !conn.name.trim()) return '连接器名称不能为空';
  if (!['stdio', 'sse', 'http'].includes(conn.type)) return '类型必须是 stdio / sse / http';
  if (conn.type === 'stdio') {
    if (!conn.config?.command?.trim()) return 'stdio 类型必须填写 command';
    const cmd = conn.config.command.trim();
    const baseCmd = cmd.split(/\s+/)[0];
    if (DANGEROUS_COMMANDS.includes(baseCmd)) return `禁止的危险命令: ${baseCmd}`;
  } else {
    if (!conn.config?.url?.trim()) return `${conn.type} 类型必须填写 URL`;
    try { new URL(conn.config.url); } catch { return 'URL 格式无效'; }
  }
  return null;
}

// 连接器列表
ipcMain.handle('connector:list', async (event, params) => {
  const connectors = getConnectors();
  if (params?.enabledOnly) return connectors.filter(c => c.enabled);
  return connectors;
});

// 添加或更新连接器
ipcMain.handle('connector:save', async (event, connector) => {
  const err = validateConnector(connector);
  if (err) return { success: false, error: err };

  const connectors = getConnectors();
  if (connector.id) {
    // 更新
    const idx = connectors.findIndex(c => c.id === connector.id);
    if (idx === -1) return { success: false, error: '连接器不存在' };
    connectors[idx] = { ...connectors[idx], ...connector, updated_at: new Date().toISOString() };
  } else {
    // 新增
    connector.id = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    connector.created_at = new Date().toISOString();
    connector.updated_at = connector.created_at;
    connectors.push(connector);
  }
  saveConnectors(connectors);
  return { success: true, connector: connector.id ? connectors.find(c => c.id === connector.id) : connector };
});

// 删除连接器
ipcMain.handle('connector:delete', async (event, { id }) => {
  const connectors = getConnectors();
  const filtered = connectors.filter(c => c.id !== id);
  if (filtered.length === connectors.length) return { success: false, error: '连接器不存在' };
  saveConnectors(filtered);
  return { success: true };
});

// 启用/禁用连接器
ipcMain.handle('connector:toggle', async (event, { id, enabled }) => {
  const connectors = getConnectors();
  const conn = connectors.find(c => c.id === id);
  if (!conn) return { success: false, error: '连接器不存在' };
  conn.enabled = enabled;
  conn.updated_at = new Date().toISOString();
  saveConnectors(connectors);
  return { success: true };
});

// ============ Skill 管理（v2.7 CC 模式）============

// Skill 存储目录
function getSkillsDir() {
  const dir = path.join(app.getPath('userData'), 'cc-skills');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 上传 Skill（通过文件路径，避免 IPC 大小限制）
ipcMain.handle('skill:upload', async (event, { filePath }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }
    const fileName = path.basename(filePath);
    if (!fileName.endsWith('.zip')) {
      return { success: false, error: '请上传 .zip 格式的 Skill 包' };
    }

    const skillsDir = getSkillsDir();
    const skillName = fileName.replace(/\.zip$/i, '');
    const skillDir = path.join(skillsDir, skillName);
    if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });

    // 复制 zip 文件到 skills 目录
    const zipPath = path.join(skillsDir, fileName);
    fs.copyFileSync(filePath, zipPath);

    // 解压（macOS/Linux 用系统 unzip，异步避免阻塞主进程）
    try {
      await _execAsync(`unzip -o "${zipPath}" -d "${skillDir}"`, { timeout: 30000 });
    } catch (e) {
      console.warn('[Skill] unzip failed, keeping zip file:', e.message);
    }

    // 删除 zip 文件
    try { fs.unlinkSync(zipPath); } catch (_) {}

    // 读取 skill 描述（如果有 SKILL.md）
    let description = '';
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      description = content.split('\n\n')[0].substring(0, 200);
    }

    console.log(`[Skill] Uploaded: ${skillName}`);
    return { success: true, name: skillName, description, path: skillDir };
  } catch (e) {
    console.error('[Skill] Upload error:', e);
    return { success: false, error: e.message };
  }
});

// 获取已上传但未安装到 CC 的 skill 列表
// 已安装 = skill 目录在 cc-workspace/.claude/skills/ 中存在链接/副本
ipcMain.handle('skill:list-with-status', async (event, { ccWorkdir }) => {
  try {
    const workdir = ccWorkdir || getCCConfig().defaultWorkdir || '';
    const installedDir = path.join(workdir, '.claude', 'skills');

    // 1. 读取上传的 skills（来自 userData/cc-skills/）
    const skillsDir = getSkillsDir();
    let skills = [];
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(skillsDir, entry.name);
          let description = '';
          const skillMdPath = path.join(skillPath, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            try {
              const content = fs.readFileSync(skillMdPath, 'utf-8');
              description = content.split('\n\n')[0].substring(0, 200);
            } catch (_) {}
          }
          skills.push({ name: entry.name, path: skillPath, description, source: 'upload' });
        }
      }
    }

    // 检查每个 skill 是否已安装
    const skillsWithStatus = skills.map(s => {
      const installedPath = path.join(installedDir, s.name);
      const installed = fs.existsSync(installedPath);
      return { ...s, installed };
    });

    // 2. 读取 SkillHub 安装的 skills（来自 ccWorkdir/.claude/skills/ 中非上传来源的）
    const uploadedNames = new Set(skills.map(s => s.name));
    if (fs.existsSync(installedDir)) {
      const installedEntries = fs.readdirSync(installedDir, { withFileTypes: true });
      for (const entry of installedEntries) {
        if (!entry.isDirectory()) continue;
        // 跳过已在上传列表中的（避免重复）
        if (uploadedNames.has(entry.name)) continue;

        const skillPath = path.join(installedDir, entry.name);
        let description = '';
        // 尝试读取 SKILL.md
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          try {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            description = content.split('\n\n')[0].substring(0, 200);
          } catch (_) {}
        }
        // 如果没有 SKILL.md，尝试读取 CLAUDE.md 或 README.md
        if (!description) {
          for (const readme of ['CLAUDE.md', 'README.md', 'readme.md']) {
            const readmePath = path.join(skillPath, readme);
            if (fs.existsSync(readmePath)) {
              try {
                const content = fs.readFileSync(readmePath, 'utf-8');
                description = content.split('\n\n')[0].substring(0, 200);
              } catch (_) {}
              break;
            }
          }
        }
        // 判断来源：通过 lstat 检查是否为符号链接
        const isSymlink = fs.lstatSync(skillPath).isSymbolicLink();
        skillsWithStatus.push({
          name: entry.name,
          path: skillPath,
          description: description || 'CC 工作目录安装',
          source: isSymlink ? 'symlink' : 'cc-workdir',
          installed: true
        });
      }
    }

    return { success: true, skills: skillsWithStatus };
  } catch (e) {
    return { success: false, error: e.message, skills: [] };
  }
});

// 安装 skill 到 CC 工作目录（创建 .claude/skills/ 链接）
ipcMain.handle('skill:install-to-cc', async (event, { skillName, ccWorkdir }) => {
  try {
    const skillsDir = getSkillsDir();
    const skillPath = path.join(skillsDir, skillName);
    if (!fs.existsSync(skillPath)) {
      return { success: false, error: 'Skill 不存在' };
    }
    const workdir = ccWorkdir || getCCConfig().defaultWorkdir;
    const claudeSkillsDir = path.join(workdir, '.claude', 'skills');
    fs.mkdirSync(claudeSkillsDir, { recursive: true });
    const linkPath = path.join(claudeSkillsDir, skillName);
    // 删除已存在的
    try { fs.rmSync(linkPath, { recursive: true, force: true }); } catch (_) {}
    // 优先软链接，失败则复制
    try {
      fs.symlinkSync(skillPath, linkPath);
    } catch (e) {
      fs.cpSync(skillPath, linkPath, { recursive: true });
    }
    console.log(`[Skill] Installed "${skillName}" to ${linkPath}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 卸载 CC 工作目录中的 skill
ipcMain.handle('skill:uninstall-from-cc', async (event, { skillName, ccWorkdir }) => {
  try {
    const workdir = ccWorkdir || getCCConfig().defaultWorkdir;
    const linkPath = path.join(workdir, '.claude', 'skills', skillName);
    if (fs.existsSync(linkPath)) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
    console.log(`[Skill] Uninstalled "${skillName}" from CC`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 列出所有 Skill
ipcMain.handle('skill:list', async () => {
  try {
    const skillsDir = getSkillsDir();
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(skillsDir, entry.name);
        let description = '';
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          try {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            description = content.split('\n\n')[0].substring(0, 200);
          } catch (_) {}
        }
        skills.push({ name: entry.name, path: skillPath, description });
      }
    }
    return { success: true, skills };
  } catch (e) {
    return { success: false, error: e.message, skills: [] };
  }
});

// 删除 Skill
ipcMain.handle('skill:delete', async (event, { name }) => {
  try {
    const skillsDir = getSkillsDir();
    const skillPath = path.join(skillsDir, name);
    if (!fs.existsSync(skillPath)) return { success: false, error: 'Skill 不存在' };
    // 安全检查：确保路径在 skillsDir 内
    if (!path.resolve(skillPath).startsWith(path.resolve(skillsDir))) {
      return { success: false, error: '非法路径' };
    }
    fs.rmSync(skillPath, { recursive: true, force: true });
    console.log(`[Skill] Deleted: ${name}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 导入 CC 工作目录中的 Skill 到持久存储（userData/cc-skills/）
ipcMain.handle('skill:import-from-workdir', async (event, { skillName, ccWorkdir }) => {
  try {
    const workdir = ccWorkdir || getCCConfig().defaultWorkdir || '';
    const srcPath = path.join(workdir, '.claude', 'skills', skillName);
    if (!fs.existsSync(srcPath)) {
      return { success: false, error: 'Skill 在工作目录中不存在' };
    }
    const skillsDir = getSkillsDir();
    const destPath = path.join(skillsDir, skillName);
    // 如果已存在，先删除
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true, force: true });
    }
    // 复制到持久存储
    fs.cpSync(srcPath, destPath, { recursive: true });
    console.log(`[Skill] Imported from workdir: ${skillName} → ${destPath}`);
    return { success: true, destPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 从 CC 工作目录删除 Skill
ipcMain.handle('skill:delete-from-workdir', async (event, { skillName, ccWorkdir }) => {
  try {
    const workdir = ccWorkdir || getCCConfig().defaultWorkdir || '';
    const skillPath = path.join(workdir, '.claude', 'skills', skillName);
    if (!fs.existsSync(skillPath)) return { success: false, error: 'Skill 不存在' };
    // 安全检查：确保路径在 workdir/.claude/skills/ 内
    const skillsDir = path.join(workdir, '.claude', 'skills');
    if (!path.resolve(skillPath).startsWith(path.resolve(skillsDir))) {
      return { success: false, error: '非法路径' };
    }
    fs.rmSync(skillPath, { recursive: true, force: true });
    console.log(`[Skill] Deleted from workdir: ${skillName}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 读取 Skill 详情（完整 SKILL.md + 文件列表 + 元数据解析）
ipcMain.handle('skill:detail', async (event, { name, ccWorkdir }) => {
  try {
    const skillsDir = getSkillsDir();
    let skillPath = path.join(skillsDir, name);
    let source = 'upload';

    // 如果在上传目录中找不到，尝试在 CC 工作目录中查找
    if (!fs.existsSync(skillPath)) {
      const workdir = ccWorkdir || getCCConfig().defaultWorkdir || '';
      const workdirSkillPath = path.join(workdir, '.claude', 'skills', name);
      if (fs.existsSync(workdirSkillPath)) {
        skillPath = workdirSkillPath;
        source = 'cc-workdir';
      } else {
        return { success: false, error: 'Skill 不存在' };
      }
    }

    // 安全检查：确保路径在 skillsDir 或 workdir/.claude/skills/ 内
    const isUploadPath = path.resolve(skillPath).startsWith(path.resolve(skillsDir));
    const workdir = ccWorkdir || getCCConfig().defaultWorkdir || '';
    const workdirSkillsDir = path.join(workdir, '.claude', 'skills');
    const isWorkdirPath = path.resolve(skillPath).startsWith(path.resolve(workdirSkillsDir));
    if (!isUploadPath && !isWorkdirPath) {
      return { success: false, error: '非法路径' };
    }

    // 读取 SKILL.md 完整内容
    let skillMdContent = '';
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');
    }

    // 解析 SKILL.md frontmatter（YAML 头部）
    let metadata = { name, description: '', version: '', author: '' };
    if (skillMdContent) {
      const fmMatch = skillMdContent.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const yamlText = fmMatch[1];
        // 简单 YAML 解析
        for (const line of yamlText.split('\n')) {
          const m = line.match(/^(\w+):\s*(.+)$/);
          if (m) {
            const key = m[1].trim();
            const val = m[2].trim().replace(/^["']|["']$/g, '');
            if (key === 'name' || key === 'description' || key === 'version' || key === 'author') {
              metadata[key] = val;
            }
          }
        }
      }
      // 如果没有 frontmatter，从第一段提取描述
      if (!metadata.description) {
        metadata.description = skillMdContent.split('\n\n')[0].replace(/^#\s*/, '').substring(0, 500);
      }
    }

    // 列出 skill 目录中的文件
    let files = [];
    try {
      const entries = fs.readdirSync(skillPath, { withFileTypes: true, recursive: false });
      files = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
      }));
    } catch (_) {}

    // 检查是否已安装到 CC 工作目录
    const installedPath = path.join(workdir, '.claude', 'skills', name);
    const installed = fs.existsSync(installedPath);

    console.log(`[Skill] Detail: ${name} | source: ${source} | installed: ${installed}`);
    return {
      success: true,
      name,
      source,
      installed,
      path: skillPath,
      skillMdContent,
      metadata,
      files,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Agent Plan AFP 用量查询
ipcMain.handle('ark:get-afp-usage', async (event, providerId) => {
  const pid = providerId || 'volcano_agent';
  const config = getProviderConfig(pid);
  if (!config.authToken) return { success: false, error: 'API Key 未配置' };

  try {
    // 火山方舟用量查询 API（具体 endpoint 购买后确认）
    const url = config.baseUrl.replace(/\/+$/, '') + '/usage';
    const resp = await fetch(url, {
      headers: {
        'x-api-key': config.authToken,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return {
        success: true,
        plan: data.plan || 'unknown',
        totalAFP: data.total_afp || 0,
        usedAFP: data.used_afp || 0,
        remainingAFP: data.remaining_afp || 0,
        resetDate: data.reset_date || '',
      };
    }
    return { success: false, error: `HTTP ${resp.status}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ===== SkillHub 市场集成 =====
const SKILLHUB_CLI = path.join(os.homedir(), '.local', 'bin', 'skillhub');
const EXEC_ENV = { ...process.env, PATH: `/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || ''}` };

/** 异步执行 shell 命令（不阻塞 Electron 主进程） */
function _execAsync(cmd, options = {}) {
  const { exec } = require('child_process');
  return new Promise((resolve, reject) => {
    exec(cmd, {
      encoding: 'utf-8',
      env: EXEC_ENV,
      ...options,
    }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// 检查 SkillHub CLI 是否已安装
ipcMain.handle('skillhub:check', async () => {
  const installed = fs.existsSync(SKILLHUB_CLI);
  return { installed, path: installed ? SKILLHUB_CLI : null };
});

// 安装 SkillHub CLI
ipcMain.handle('skillhub:install-cli', async () => {
  try {
    const cmd = `curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only`;
    await _execAsync(cmd, { timeout: 60000 });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/** 安全解析 JSON，处理 CLI 返回纯文本（如 "No skills found."）的情况 */
function _safeJsonParse(output) {
  const trimmed = output.trim();
  if (!trimmed) return null;
  // 尝试 JSON 解析
  try {
    return JSON.parse(trimmed);
  } catch {
    // 提取输出中可能包含的 JSON 块（CLI 可能混入日志）
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
    }
    // 非纯文本时返回 null（调用方自行处理）
    return null;
  }
}

// 搜索 SkillHub 市场技能
ipcMain.handle('skillhub:search', async (event, { query, limit = 20 }) => {
  try {
    const escapedQuery = query ? query.replace(/"/g, '\\"') : '';
    const cmd = `"${SKILLHUB_CLI}" --skip-self-upgrade search --json --search-limit ${limit} ${escapedQuery ? `"${escapedQuery}"` : ''}`;
    const output = await _execAsync(cmd, { timeout: 15000 });
    const data = _safeJsonParse(output);
    // CLI 在无结果时返回纯文本 "No skills found."，此时 data 为 null
    if (!data) {
      return { success: true, results: [], count: 0, query };
    }
    // 兼容两种格式：{ results: [...] } 或直接 [...]
    const results = Array.isArray(data) ? data : (data.results || []);
    return { success: true, results, count: data.count || results.length, query: data.query || query };
  } catch (e) {
    return { success: false, error: e.message, results: [] };
  }
});

// 安装技能到指定目录
ipcMain.handle('skillhub:install', async (event, { slug, targetDir }) => {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const escapedSlug = slug.replace(/"/g, '\\"');
    const cmd = `"${SKILLHUB_CLI}" --skip-self-upgrade install --json --dir "${targetDir}" "${escapedSlug}"`;
    const output = await _execAsync(cmd, { timeout: 60000 });
    const data = _safeJsonParse(output);
    if (!data) {
      // 非 JSON 输出视为成功（CLI 可能输出纯文本确认信息）
      return { success: true, targetDir, slug, name: slug, version: '' };
    }
    return { success: data.success !== false, targetDir: data.targetDir || targetDir, slug: data.slug || slug, name: data.name, version: data.version };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 列出指定目录中已安装的 SkillHub 技能
ipcMain.handle('skillhub:list', async (event, { dir }) => {
  try {
    const cmd = `"${SKILLHUB_CLI}" --skip-self-upgrade list --dir "${dir}"`;
    const output = await _execAsync(cmd, { timeout: 10000 });
    const trimmed = output.trim();
    if (!trimmed || trimmed.toLowerCase().includes('no skills')) {
      return { success: true, skills: [] };
    }
    // 优先尝试 JSON 解析
    const data = _safeJsonParse(trimmed);
    if (data && Array.isArray(data)) {
      return { success: true, skills: data.map(s => ({ slug: s.slug || s.name || '', version: s.version || '' })) };
    }
    if (data && data.skills && Array.isArray(data.skills)) {
      return { success: true, skills: data.skills };
    }
    // 回退到纯文本行解析
    const skills = trimmed.split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      const version = parts.length > 1 ? parts[parts.length - 1] : '';
      const slug = parts.slice(0, parts.length > 1 ? -1 : undefined).join(' ');
      return { slug, version };
    });
    return { success: true, skills };
  } catch (e) {
    return { success: false, error: e.message, skills: [] };
  }
});

// 卸载 SkillHub 技能（删除目录）
ipcMain.handle('skillhub:uninstall', async (event, { slug, targetDir }) => {
  try {
    const skillDir = path.join(targetDir, slug);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('cc:new-session', async () => {
  ccCurrentSessionId = null;
  return { success: true };
});

// 手动同步 CC 记忆（生成 CLAUDE.md）
ipcMain.handle('cc:sync-memory', async () => {
  try {
    syncCLAUDEMdToCC();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('cc:stop', async () => {
  if (ccAbortController) {
    ccAbortController.abort();
    ccAbortController = null;
  }
  // v3.1: 同时清理任务控制器
  for (const [id, ctrl] of taskControllers) {
    try { ctrl.abort(); } catch (_) {}
  }
  taskControllers.clear();
  return { success: true };
});

// 测试 CC 连接（轻量请求验证 endpoint + key + model）
ipcMain.handle('cc:test-connection', async (event, params) => {
  const config = getCCConfig();
  const baseUrl = params?.baseUrl || config.baseUrl;
  const authToken = params?.authToken || config.authToken;
  const model = params?.model || config.model;

  if (!baseUrl || !authToken || !model) {
    return { ok: false, error: '缺少必要参数：Base URL、Auth Token、模型名称' };
  }

  const startTime = Date.now();
  try {
    // Coding Plan 兼容 Anthropic Messages API
    const url = baseUrl.replace(/\/+$/, '') + '/v1/messages';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': authToken,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const latency = Date.now() - startTime;
    if (response.ok) {
      const data = await response.json();
      const content = data.content?.[0]?.text || '';
      return { ok: true, latency, model: data.model || model, content: content.substring(0, 50) };
    } else {
      const errText = await response.text().catch(() => '');
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        errorMsg = errJson.error?.message || errJson.message || errorMsg;
      } catch (_) {
        errorMsg += `: ${errText.substring(0, 200)}`;
      }
      return { ok: false, error: errorMsg, latency, httpStatus: response.status };
    }
  } catch (err) {
    return { ok: false, error: err.message, latency: Date.now() - startTime };
  }
});

// CC 流式调用（核心）
// OpenRouter: 获取模型列表
ipcMain.handle('cc:openrouter-get-models', async () => {
  const apiKey = getSetting('cc_openrouter_api_key');
  const baseUrl = getSetting('cc_openrouter_base_url') || 'https://openrouter.ai/api/v1';
  if (!apiKey) {
    return { success: false, error: 'OpenRouter API Key 未配置' };
  }
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { success: false, error: `HTTP ${response.status}: ${errText.substring(0, 200)}` };
    }
    const data = await response.json();
    const models = (data.data || []).map(m => ({
      id: m.id,
      name: m.name || m.id,
      pricing: m.pricing || null,
      context_length: m.context_length || null,
    }));
    return { success: true, models };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// OpenRouter: 测试连接
ipcMain.handle('cc:openrouter-test', async (event, params) => {
  const apiKey = params?.apiKey || getSetting('cc_openrouter_api_key');
  const baseUrl = params?.baseUrl || getSetting('cc_openrouter_base_url') || 'https://openrouter.ai/api/v1';
  if (!apiKey) {
    return { ok: false, error: 'OpenRouter API Key 未配置' };
  }
  const startTime = Date.now();
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const latency = Date.now() - startTime;
    if (response.ok) {
      const data = await response.json();
      const count = data.data?.length || 0;
      return { ok: true, latency, modelCount: count };
    } else {
      const errText = await response.text().catch(() => '');
      return { ok: false, error: `HTTP ${response.status}: ${errText.substring(0, 100)}`, latency };
    }
  } catch (err) {
    return { ok: false, error: err.message, latency: Date.now() - startTime };
  }
});

// OpenRouter: 停止代理
ipcMain.handle('cc:openrouter-stop-proxy', async () => {
  if (anthropicProxy) {
    anthropicProxy.stop();
    anthropicProxy = null;
    anthropicProxyPort = null;
  }
  return { success: true };
});

ipcMain.handle('cc:invoke', async (event, { message, attachments, sessionId, systemRole, workdir, skill, connectorIds, openRouterModel, providerId, taskId, content: multimodalContent }) => {
  let sendWarningImageFiltered = false;
  const sdk = await loadClaudeAgentSDK();
  if (!sdk) {
    return { success: false, error: 'Claude Agent SDK 未加载，请检查依赖安装' };
  }
  const config = getCCConfig();

  // ─── 供应商路由 ───
  // 优先级：providerId > openRouterModel (旧兼容) > 默认 Coding Plan
  let activeProviderId = providerId || getSetting('cc_active_provider') || 'volcano';
  let providerEnv = null; // { ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL }
  let useOpenRouter = false;

  // 兼容旧 OpenRouter 路由
  if (!providerId && openRouterModel && config.openRouterApiKey) {
    activeProviderId = 'openrouter';
    useOpenRouter = true;
  }

  const activeProvider = PROVIDER_REGISTRY[activeProviderId];

  if (activeProvider && activeProvider.type === 'direct') {
    // 直连模式（火山引擎/DeepSeek/腾讯云）
    const providerConfig = getProviderConfig(activeProviderId);
    const authToken = providerConfig.authToken || providerConfig.apiKey;
    if (!authToken) {
      return { success: false, error: `${activeProvider.name} 尚未配置认证信息` };
    }
    // 对话栏下拉框选择的模型优先于设置面板保存的配置
    if (openRouterModel) {
      providerConfig.model = openRouterModel;
    }
    providerEnv = activeProvider.envMap(providerConfig);
    console.log(`[CC] Provider: ${activeProvider.name} | baseUrl: ${providerEnv.ANTHROPIC_BASE_URL} | model: ${providerEnv.ANTHROPIC_MODEL}`);
  } else if ((activeProvider && activeProvider.type === 'proxy') || useOpenRouter) {
    // 代理模式（OpenRouter 或其他 OpenAI 兼容服务）
    useOpenRouter = true;
    if (!anthropicProxy) {
      // 确定代理上游
      let proxyApiKey, proxyBaseUrl;
      if (activeProviderId === 'openrouter' || !providerId) {
        proxyApiKey = getSetting('cc_openrouter_api_key') || getProviderConfig('openrouter').apiKey;
        proxyBaseUrl = getSetting('cc_openrouter_base_url') || getProviderConfig('openrouter').baseUrl;
      } else {
        const pc = getProviderConfig(activeProviderId);
        proxyApiKey = pc.apiKey;
        proxyBaseUrl = pc.baseUrl;
      }

      if (!proxyApiKey) {
        return { success: false, error: '代理供应商 API Key 未配置' };
      }

      anthropicProxy = createAnthropicProxy({
        getApiKey: () => proxyApiKey,
        getBaseUrl: () => proxyBaseUrl,
        getPort: () => 3999,
      });
      try {
        anthropicProxyPort = await anthropicProxy.start();
        console.log(`[Proxy] Started for ${activeProvider?.name || 'OpenRouter'} on port ${anthropicProxyPort}`);
      } catch (e) {
        return { success: false, error: `代理启动失败: ${e.message}` };
      }
    }
  } else {
    // 默认 Coding Plan
    if (!config.authToken) {
      return { success: false, error: 'Claude Code Auth Token 未配置' };
    }
  }

  const { query } = sdk;

  // 附件处理：文本类拼入 prompt，图片类构建多模态 content blocks
  let prompt = message;
  if (attachments && attachments.length > 0) {
    // Agent Plan 供应商 + 图片附件 → 多模态 content blocks
    const imageAttachments = attachments.filter(a => a.type === 'image' && a.base64);
    if (imageAttachments.length > 0 && activeProviderId === 'volcano_agent') {
      const content = [];
      // 图片 → image content block
      for (const img of imageAttachments.slice(0, 5)) { // 最多 5 张
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mimeType || 'image/png',
            data: img.base64,
          }
        });
      }
      // 文本附件 → text content block
      for (const att of attachments.filter(a => a.type !== 'image' && a.textContent)) {
        content.push({ type: 'text', text: `[文件: ${att.name}]\n${att.textContent}` });
      }
      // 用户消息
      content.push({ type: 'text', text: message });
      prompt = content; // SDK query() 接受 string 或 content blocks 数组
    } else {
      // 纯文本模式（现有逻辑）
      // Coding Plan 供应商 + 图片 → 过滤图片并提示
      if (imageAttachments.length > 0 && activeProviderId !== 'volcano_agent') {
        sendWarningImageFiltered = true;
      }
      const fileTextParts = attachments
        .filter(a => a.textContent)
        .map(a => `[文件: ${a.name}]\n${a.textContent}`);
      if (fileTextParts.length > 0) {
        prompt = fileTextParts.join('\n\n') + '\n\n' + message;
      }
    }
  }

  // 构建 SDK options
  const allowedTools = config.allowedTools.split(',').map(t => t.trim()).filter(Boolean);
  // 危险工具黑名单：根据权限模式动态调整
  // - bypassPermissions：仅拦截 Agent（防止递归派生），允许 Bash/Write/Edit
  // - acceptEdits：拦截 Monitor + Agent，允许 Bash/Write/Edit（Edit 自动批准，Bash 需确认）
  // - default/plan：拦截 Monitor + Agent，允许 Bash/Write/Edit（均需用户确认）
  let disallowedTools;
  if (config.permissionMode === 'bypassPermissions') {
    disallowedTools = ['Agent'];
  } else if (config.permissionMode === 'acceptEdits') {
    disallowedTools = ['Monitor', 'Agent'];
  } else {
    disallowedTools = ['Monitor', 'Agent'];
  }
  // 工作目录：优先用调用方指定的（对话级），否则用默认（设置级）
  const ccWorkdir = workdir || config.defaultWorkdir;
  try { fs.mkdirSync(ccWorkdir, { recursive: true }); } catch (_) {}

  // 如果选用了 Skill，确认它已安装到 CC 工作目录（用户应先在 Skill 管理中安装）
  // skill 参数仅用于日志记录，实际加载由 CC SDK 扫描 cwd/.claude/skills/ 完成
  if (skill) {
    const skillLinkPath = path.join(ccWorkdir, '.claude', 'skills', skill);
    if (!fs.existsSync(skillLinkPath)) {
      console.warn(`[CC] Skill "${skill}" not installed in workdir, auto-installing...`);
      // 自动安装（兼容用户未在 Skill 管理中点"安装到CC"的情况）
      const skillsDir = getSkillsDir();
      const skillSrcPath = path.join(skillsDir, skill);
      if (fs.existsSync(skillSrcPath)) {
        const claudeSkillsDir = path.join(ccWorkdir, '.claude', 'skills');
        fs.mkdirSync(claudeSkillsDir, { recursive: true });
        try {
          fs.symlinkSync(skillSrcPath, skillLinkPath);
        } catch (e) {
          fs.cpSync(skillSrcPath, skillLinkPath, { recursive: true });
        }
        console.log(`[CC] Skill "${skill}" auto-installed`);
      }
    }
  }

  // 打包后 Claude Agent SDK 无法通过 import.meta.url 正确定位原生 claude 二进制
  // （路径穿过 app.asar 文件，spawn 返回 ENOTDIR），需显式指定解包后的路径
  let pathToClaudeCodeExecutable = undefined;
  if (app.isPackaged) {
    const platformArch = `${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const unpackedPath = path.join(
      process.resourcesPath, 'app.asar.unpacked', 'node_modules',
      '@anthropic-ai', `claude-agent-sdk-${platformArch}`, binaryName
    );
    if (fs.existsSync(unpackedPath)) {
      pathToClaudeCodeExecutable = unpackedPath;
      try { fs.chmodSync(unpackedPath, 0o755); } catch (_) {}
      console.log(`[CC] pathToClaudeCodeExecutable: ${unpackedPath}`);
    }
  }

  // 构建系统提示词（合并传入的 systemRole 和默认约束）
  const defaultSystemRole = `你是一个集成在 Memora 应用中的 AI 编程助手。

## 环境约束
- 你运行在 Claude Agent SDK 内，不是独立的 CLI 工具
- **禁止使用 \`claude\` CLI 命令**（如 \`claude skill install\`、\claude config\` 等），因为 \`claude\` 二进制不在 PATH 中
- 如需安装 Skill，引导用户在 Memora 的"文档 → Skill 管理"中操作
- 如需修改配置，引导用户在 Memora 的设置面板中操作
- 可以使用 Bash/Read/Write/Edit/Glob/Grep/WebSearch 等工具完成编程任务
- Bash 工具可用：可执行 git、npm、npx 等命令
- 工作目录是 CC 的工作区，可在其中创建和修改文件`;

  const finalSystemRole = systemRole
    ? `${defaultSystemRole}\n\n## 用户附加指令\n${systemRole}`
    : defaultSystemRole;

  const options = {
    allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
    disallowedTools,
    permissionMode: config.permissionMode,
    maxTurns: config.maxTurns,
    cwd: ccWorkdir,
    systemPrompt: finalSystemRole,
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
    // 只加载项目级配置，不污染用户全局 ~/.claude/settings.json
    settingSources: ['project'],
    // 捕获子进程 stderr，转发到 UI 便于调试
    stderr: (data) => {
      const text = data.toString().trim();
      if (text) {
        console.error('[CC:stderr]', text);
        if (mainWindow) {
          mainWindow.webContents.send('cc:stream', { event: 'info', level: 'warning', content: `[stderr] ${text.substring(0, 500)}` });
        }
      }
    },
    // 传递完整开发环境（确保 Python/Node/Java 等工具链可用）
    // 先展开系统环境，再用 CC 专用变量覆盖
    env: {
      // ── 基础系统变量（继承宿主机完整环境）──
      ...process.env,
      // ── 供应商路由：直连用 provider env，代理用 localhost，默认用 Coding Plan ──
      ANTHROPIC_BASE_URL: providerEnv?.ANTHROPIC_BASE_URL || (useOpenRouter ? `http://127.0.0.1:${anthropicProxyPort}` : config.baseUrl),
      ANTHROPIC_AUTH_TOKEN: providerEnv?.ANTHROPIC_AUTH_TOKEN || (useOpenRouter ? 'dummy-proxy-not-used' : config.authToken),
      ANTHROPIC_MODEL: providerEnv?.ANTHROPIC_MODEL || (useOpenRouter ? (openRouterModel || getProviderConfig('openrouter').defaultModel) : config.model),
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: 'ANTHROPIC_API_KEY',
      ANTHROPIC_API_KEY: '',
      // ── 注入用户配置的 Skill 环境变量 / API Key（最高优先级）──
      ...Object.fromEntries((config.envVars || []).filter(v => v.key).map(v => [v.key, v.value || ''])),
    },
    // 恢复会话（resume 需要首次 init 返回的 session_id）
    ...(sessionId ? { resume: sessionId } : {}),
  };

  // 构建 MCP Servers（连接器）
  const allConnectors = getConnectors();
  const selectedConnectors = allConnectors.filter(c => {
    if (connectorIds && Array.isArray(connectorIds)) {
      // 用户在对话栏明确选择了连接器
      return connectorIds.includes(c.id);
    }
    // 没有传入 connectorIds 时，使用默认启用的
    return c.enabled;
  });

  if (selectedConnectors.length > 0) {
    const mcpServers = selectedConnectors.map(c => {
      const serverConfig = { type: c.type };
      if (c.type === 'stdio') {
        serverConfig.command = c.config.command;
        if (c.config.args && c.config.args.length > 0) serverConfig.args = c.config.args;
        if (c.config.env && Object.keys(c.config.env).length > 0) serverConfig.env = c.config.env;
      } else {
        serverConfig.url = c.config.url;
        if (c.config.headers && Object.keys(c.config.headers).length > 0) serverConfig.headers = c.config.headers;
      }
      return { [c.name]: serverConfig };
    });
    options.mcpServers = mcpServers;
    console.log(`[CC] MCP servers: ${selectedConnectors.map(c => c.name).join(', ')}`);
  }

  // Agent Plan 专属 MCP Server 自动注入（豆包搜索 + 多模态生成）
  if (activeProviderId === 'volcano_agent') {
    const providerConfig = getProviderConfig('volcano_agent');
    const arkApiKey = providerConfig.authToken;
    const arkBaseUrl = providerConfig.baseUrl;
    if (arkApiKey) {
      const agentMcpServers = [];
      // 豆包搜索 Harness
      if (providerConfig.enableDoubaoSearch !== 'false') {
        agentMcpServers.push({
          'doubao-search': {
            type: 'stdio',
            command: 'node',
            args: [path.join(__dirname, 'src', 'mcp', 'doubao-search-server.js')],
            env: { ARK_API_KEY: arkApiKey, ARK_BASE_URL: arkBaseUrl }
          }
        });
      }
      // 多模态生成工具（图片/视频）
      agentMcpServers.push({
        'ark-multimodal': {
          type: 'stdio',
          command: 'node',
          args: [path.join(__dirname, 'src', 'mcp', 'ark-multimodal-server.js')],
          env: {
            ARK_API_KEY: arkApiKey,
            ARK_BASE_URL: arkBaseUrl,
            IMAGE_MODEL: providerConfig.imageGenModel || 'doubao-seedream-3-0',
            VIDEO_MODEL: providerConfig.videoGenModel || 'seedance-2-0',
          }
        }
      });
      options.mcpServers = [...(options.mcpServers || []), ...agentMcpServers];
      console.log(`[CC] Agent Plan MCP servers injected: ${agentMcpServers.map(s => Object.keys(s)[0]).join(', ')}`);
    }
  }

  // Coding Plan 供应商 + 图片附件 → 提示用户
  if (sendWarningImageFiltered) {
    if (mainWindow) {
      mainWindow.webContents.send('cc:stream', { event: 'info', level: 'warning', content: '当前供应商不支持图片输入，已自动过滤。切换到 Agent Plan 可启用多模态。' });
    }
  }

  const promptLogStr = typeof prompt === 'string' ? prompt.substring(0, 50) : `[multimodal: ${Array.isArray(prompt) ? prompt.length : 0} blocks]`;
  console.log(`[CC] Invoke | prompt: "${promptLogStr}..." | sessionId(resume): ${sessionId || 'null(新会话)'} | workdir: ${ccWorkdir} | provider: ${activeProvider?.name || activeProviderId} | route: ${useOpenRouter ? 'proxy' : (providerEnv ? 'direct' : 'default')}`);

  // v3.1: 统一上下文层 — CC 模式精准注入（替代全量 CLAUDE.md）
  let _ccVectorSources = [];
  let _ccVectorMeta = null;
  if (unifiedContextLayer && message) {
    try {
      const ctxResult = await unifiedContextLayer.retrieve(message, {
        mode: 'cc',
        topK: 5,
        tokenBudget: 1000,
        sources: ['memories', 'notes'],
      });
      if (ctxResult.context && typeof prompt === 'string') {
        prompt = `${ctxResult.context}\n\n---\n\n${prompt}`;
        _ccVectorSources = ctxResult.sources || [];
        _ccVectorMeta = ctxResult.retrieval_meta || null;
        event.sender.send('context:sources', { sources: _ccVectorSources, meta: ctxResult.retrieval_meta });
      }
    } catch (e) {
      console.warn('[Vector] CC context injection failed:', e.message);
    }
  }

  // 每次对话前刷新 CLAUDE.md（将 memora 最新记忆同步到 CC 工作目录）
  syncCLAUDEMdToCC(ccWorkdir);

  // ─── canUseTool 权限回调 ───
  // 当 permissionMode 非 bypassPermissions 时，SDK 需要此回调来向用户请求工具执行权限。
  // 没有此回调，SDK 在 'default' 模式下无法弹出权限请求，导致 Write/Bash 等操作被静默拒绝。
  if (config.permissionMode !== 'bypassPermissions') {
    // 内存缓存：用户选择"总是允许"的工具列表
    if (!global._ccAllowedToolsCache) global._ccAllowedToolsCache = new Set();

    options.canUseTool = async (toolName, input, opts) => {
      // 如果用户之前选了"总是允许"该工具，直接放行
      if (global._ccAllowedToolsCache.has(toolName)) {
        return { behavior: 'allow' };
      }

      // signal 已 abort 时直接拒绝
      if (opts?.signal?.aborted) {
        return { behavior: 'deny', message: '操作已取消' };
      }

      const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      console.log(`[CC] Permission request: ${toolName} | input: ${JSON.stringify(input).substring(0, 200)} | requestId: ${requestId}`);

      // 通知 UI 显示权限请求弹窗
      const targetWindow = taskId ? null : mainWindow;
      if (targetWindow) {
        targetWindow.webContents.send('cc:permission-request', {
          requestId,
          toolName,
          input,
        });
      } else if (taskId) {
        // 子任务模式：通过 task:stream 通道发送
        mainWindow?.webContents.send('task:stream', {
          taskId,
          event: 'permission-request',
          requestId,
          toolName,
          input,
        });
      }

      // 等待渲染进程的响应（超时 120 秒自动拒绝）
      return new Promise((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            console.warn(`[CC] Permission request ${requestId} timed out`);
            resolve({ behavior: 'deny', message: '权限请求超时（120秒未响应）' });
          }
        }, 120000);

        // 监听 abort
        const onAbort = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve({ behavior: 'deny', message: '操作已取消' });
          }
        };
        if (opts?.signal) {
          opts.signal.addEventListener('abort', onAbort, { once: true });
        }

        const channel = `cc:permission-response:${requestId}`;
        ipcMain.once(channel, (event, response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (opts?.signal) {
            opts.signal.removeEventListener('abort', onAbort);
          }
          console.log(`[CC] Permission response for ${requestId}: ${response?.behavior || 'deny'}`);
          if (response?.behavior === 'allow' && response?.alwaysAllow) {
            global._ccAllowedToolsCache.add(toolName);
          }
          resolve(response?.behavior === 'allow'
            ? { behavior: 'allow' }
            : { behavior: 'deny', message: response?.message || '用户拒绝了操作' }
          );
        });
      });
    };
  }

  // v3.1: 支持 per-task 控制器
  const _ccController = new AbortController();
  if (taskId) { taskControllers.set(taskId, _ccController); } else { ccAbortController = _ccController; }
  options.abortController = _ccController;
  ccHasText = false; // 重置文本标志

  let newSessionId = sessionId || null;

  // 外层 timeout：防止 maxTurns 内跑飞（默认 30 分钟，复杂任务可能需要很长时间）
  const CC_TIMEOUT_MS = 30 * 60 * 1000;
  let ccTimeoutHandle = setTimeout(() => {
    console.warn('[CC] Query timeout, aborting...');
    _ccController?.abort();
  }, CC_TIMEOUT_MS);

  // 异步消费流，逐消息推送到渲染进程
  const _ccAuditStart = Date.now();
  let _ccAuditFullText = '';
  let _ccAuditModel = providerEnv?.ANTHROPIC_MODEL || (useOpenRouter ? (openRouterModel || 'openrouter') : config.model);
  let _ccAuditProvider = activeProvider?.name || activeProviderId || 'coding_plan';
  const _ccTraceId = _ccVectorMeta?.trace_id || `cc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  (async () => {
    // v3.1: 多任务事件路由
    const send = (data) => {
      if (!mainWindow) return;
      if (taskId) {
        mainWindow.webContents.send('task:stream', { taskId, event: data.event, ...data });
      } else {
        mainWindow.webContents.send('cc:stream', data);
      }
    };
    try {
      const messageStream = query({ prompt, options });

      for await (const msg of messageStream) {
        if (_ccController?.signal.aborted) break;

        // 全量日志（便于调试）
        console.log('[CC] msg:', msg.type, msg.subtype || '', msg.event?.type || '');

        // SystemMessage(init) 携带 session_id
        if (msg.type === 'system' && msg.subtype === 'init') {
          newSessionId = msg.session_id;
          ccCurrentSessionId = newSessionId;
          console.log(`[CC] Session init | new session_id: ${newSessionId} | resumed from: ${sessionId || 'null'}`);
          send({ event: 'session', sessionId: newSessionId });
          continue;
        }

        // 系统通知类消息（informational / notification / plugin_install / status）
        if (msg.type === 'system' && msg.subtype !== 'init') {
          // 过滤噪音消息：thinking_tokens / commands_changed / session_state_changed 等内部状态不需要展示
          const noiseSubtypes = ['thinking_tokens', 'commands_changed', 'session_state_changed', 'worker_shutting_down', 'files_persisted', 'auth_status'];
          if (noiseSubtypes.includes(msg.subtype)) {
            continue; // 静默忽略
          }
          if (msg.subtype === 'informational') {
            // 显示所有级别的信息消息（包括 info），让用户看到执行过程
            send({ event: 'info', level: msg.level || 'info', content: msg.content });
          } else if (msg.subtype === 'notification') {
            send({ event: 'info', level: 'notice', content: msg.text });
          } else if (msg.subtype === 'plugin_install') {
            const statusMap = { started: '🔄 开始安装', installed: '✅ 已安装', failed: '❌ 安装失败', completed: '✅ 安装完成' };
            const statusText = statusMap[msg.status] || msg.status;
            send({ event: 'info', level: msg.status === 'failed' ? 'warning' : 'notice', content: `Skill ${statusText}${msg.name ? ': ' + msg.name : ''}${msg.error ? ' (' + msg.error + ')' : ''}` });
          } else if (msg.subtype === 'status') {
            if (msg.compact_result) {
              send({ event: 'info', level: 'notice', content: msg.compact_result === 'success' ? '🔄 上下文已压缩' : `⚠️ 上下文压缩失败: ${msg.compact_error || ''}` });
            }
          } else if (msg.subtype === 'permission_denied') {
            send({ event: 'info', level: 'warning', content: `⚠️ 工具被拒绝: ${msg.tool_name} - ${msg.message || ''}` });
          } else {
            // 其他系统消息不展示，避免噪音
          }
          continue;
        }

        // 流式增量（文本 / tool_use 参数片段）
        if (msg.type === 'stream_event' && msg.event) {
          const evt = msg.event;
          if (evt.type === 'content_block_delta') {
            if (evt.delta?.type === 'text_delta' && evt.delta.text) {
              ccHasText = true;
              send({ event: 'delta', content: evt.delta.text });
            } else if (evt.delta?.type === 'thinking_delta' && evt.delta.thinking) {
              send({ event: 'thinking', content: evt.delta.thinking });
            }
          } else if (evt.type === 'content_block_start') {
            if (evt.content_block?.type === 'tool_use') {
              send({ event: 'tool_use', name: evt.content_block.name || 'tool', id: evt.content_block.id });
            }
          }
          continue;
        }

        // 工具执行进度
        if (msg.type === 'tool_progress') {
          send({ event: 'tool_progress', name: msg.tool_name, elapsed: msg.elapsed_time_seconds });
          continue;
        }

        // 工具调用摘要
        if (msg.type === 'tool_use_summary') {
          send({ event: 'tool_summary', content: msg.summary });
          continue;
        }

        // 完整 assistant turn — 提取 thinking / text / tool_use 并推送
        if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'thinking' && block.thinking) {
              // thinking 不走 stream_event，需要在这里发送
              if (!ccHasText) {
                send({ event: 'thinking', content: block.thinking });
              }
            } else if (block.type === 'text' && block.text) {
              // 🔧 修复重复：如果 text 已通过 stream_event 增量发送（ccHasText=true），
              // 不再从 assistant 完整消息中重复发送
              if (!ccHasText) {
                send({ event: 'delta', content: block.text });
                ccHasText = true;
              }
            } else if (block.type === 'tool_use') {
              // 先推送 tool_use（添加进度步骤），再推送 tool_result（标记完成）
              const toolName = block.name || 'tool';
              const toolInput = typeof block.input === 'string' ? block.input : JSON.stringify(block.input);
              send({ event: 'tool_use', name: toolName, id: block.id });
              send({ event: 'tool_result', name: toolName, content: toolInput });
            }
          }
          continue;
        }

        // user turn — 工具执行结果返回（展示完成状态）
        if (msg.type === 'user' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'tool_result') {
              const resultContent = typeof block.content === 'string'
                ? block.content
                : (Array.isArray(block.content)
                    ? block.content.map(c => c.text || '').join('')
                    : JSON.stringify(block.content || ''));
              // 截取摘要
              const summary = resultContent.length > 300
                ? resultContent.substring(0, 300) + '...'
                : resultContent;
              send({ event: 'info', level: 'info', content: `📋 工具结果: ${summary}` });
            }
          }
          continue;
        }

        // 最终结果
        if (msg.type === 'result') {
          const cost = msg.total_cost_usd || 0;
          const usage = msg.usage || {};
          console.log(`[CC] Result: subtype=${msg.subtype} | session: ${msg.session_id} | turns: ${msg.num_turns} | cost: $${cost.toFixed(4)} | is_error: ${msg.is_error} | api_error_status: ${msg.api_error_status}`);

          if (msg.subtype === 'success' && !msg.is_error) {
            // 成本告警
            if (cost > 1.0) {
              console.warn(`[CC] ⚠️ High cost query: $${cost.toFixed(4)}`);
            }
            // 检查是否有实际内容
            const resultText = msg.result || '';
            // 从 CC 结果中提取记忆标记 [MEMORY: ...] 存入 memora
            if (resultText) {
              const extracted = extractMemoryFromCCResult(resultText);
              if (extracted.length > 0) {
                // 有新记忆提取，刷新 CLAUDE.md
                syncCLAUDEMdToCC(ccWorkdir);
              }
            }
            if (!resultText && !ccHasText) {
              // 无内容响应
              send({ event: 'error', error: 'CC 返回了空结果，可能是 API 调用失败。请检查网络和配置后重试。' });
            } else {
              _ccAuditFullText = resultText || '';
              send({
                event: 'done',
                sessionId: msg.session_id || newSessionId,
                usage: msg.usage,
                result: resultText,
                cost,
              });

              // ─── 子任务检测 ───
              // CC query 完成后，检查结果中是否包含异步任务 ID
              // 如果有，启动 SubTaskPoller 轮询后台任务状态
              if (resultText) {
                const taskIds = extractTaskIds(resultText);
                if (taskIds.length > 0) {
                  console.log(`[CC] Detected sub-task IDs (${taskIds.length}): ${taskIds.map(t => `${t.id}(${t.confidence.toFixed(2)},${t.source})`).join(', ')}`);

                  // 构建供应商配置用于轮询 API 调用
                  const pollProviderConfig = activeProvider?.type === 'direct'
                    ? {
                        type: activeProviderId === 'volcano' ? 'volcano' : (activeProviderId === 'tencent' ? 'tencent' : 'custom'),
                        baseUrl: providerEnv?.ANTHROPIC_BASE_URL || config.baseUrl,
                        apiKey: providerEnv?.ANTHROPIC_AUTH_TOKEN || config.authToken,
                      }
                    : {
                        type: activeProviderId === 'tencent' ? 'tencent' : 'volcano',
                        baseUrl: providerEnv?.ANTHROPIC_BASE_URL || config.baseUrl,
                        apiKey: providerEnv?.ANTHROPIC_AUTH_TOKEN || config.authToken,
                      };

                  // 启动子任务轮询 — 轮询所有候选 ID（最多5个）
                  // 先命中的会推送结果，其余的发现 notFound 后自动停止
                  const sessionId = msg.session_id || newSessionId;
                  const maxPoll = Math.min(taskIds.length, 5);
                  for (let i = 0; i < maxPoll; i++) {
                    const task = taskIds[i];
                    const startMsg = i === 0
                      ? `检测到 ${taskIds.length} 个候选任务ID，开始并行监控`
                      : `候选 ${i + 1}: ${task.id}`;
                    console.log(`[CC] Starting poll ${i + 1}/${maxPoll}: ${task.id} (confidence: ${task.confidence.toFixed(2)})`);
                    subTaskPoller.start(
                      task.id,
                      sessionId,
                      pollProviderConfig
                    );
                  }
                }
              }
            }
          } else {
            // 错误结果
            let errMsg = msg.result || '';
            if (msg.api_error_status) {
              errMsg = `API 错误 (${msg.api_error_status}): ${errMsg}`;
            }
            if (!errMsg) errMsg = 'CC 查询失败，请查看控制台日志';
            console.error('[CC] Result error:', errMsg);
            // 审计日志：CC 结果错误
            if (auditLogger) {
              auditLogger.record({
                module: 'cc_chat',
                model: _ccAuditModel,
                skill: skill || null,
                baseUrl: providerEnv?.ANTHROPIC_BASE_URL || config.baseUrl || '',
                input: { systemPromptLen: 0, userPromptLen: message.length, userPrompt: message },
                output: { status: msg.api_error_status || 500, contentLen: 0, content: '', finishReason: 'error' },
                tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                latencyMs: Date.now() - _ccAuditStart,
                error: errMsg,
                traceId: _ccTraceId,
                vectorSources: _ccVectorSources.map(s => ({ source_type: s.source_type, source_id: s.source_id, title: s.title, score: s.score })),
              });
            }
            send({ event: 'error', error: errMsg });
          }
          break;
        }
      }

      // 流正常结束但未收到 result 事件 — 检查是否有内容
      if (!newSessionId) {
        send({ event: 'error', error: 'CC 会话启动失败，请检查 Claude Code SDK 是否正确安装' });
      } else if (!ccHasText) {
        send({ event: 'error', error: 'CC 未返回任何内容。请检查 API 配置和网络连接。' });
      } else {
        // 审计日志：CC 完成
        if (auditLogger) {
          auditLogger.record({
            module: 'cc_chat',
            model: _ccAuditModel,
            skill: skill || null,
            baseUrl: providerEnv?.ANTHROPIC_BASE_URL || config.baseUrl || '',
            input: { systemPromptLen: 0, userPromptLen: message.length, userPrompt: message },
            output: { status: 200, contentLen: _ccAuditFullText.length, content: _ccAuditFullText, finishReason: 'completed' },
            tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            latencyMs: Date.now() - _ccAuditStart,
            traceId: _ccTraceId,
            vectorSources: _ccVectorSources.map(s => ({ source_type: s.source_type, source_id: s.source_id, title: s.title, score: s.score })),
            vectorMeta: _ccVectorMeta,
          });
        }
        send({ event: 'done', sessionId: newSessionId });
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('[CC] Stream error:', e);
        // 审计日志：CC 异常
        if (auditLogger) {
          auditLogger.record({
            module: 'cc_chat',
            model: _ccAuditModel,
            skill: skill || null,
            baseUrl: providerEnv?.ANTHROPIC_BASE_URL || config.baseUrl || '',
            input: { systemPromptLen: 0, userPromptLen: message.length, userPrompt: message },
            output: { status: 500, contentLen: 0, content: '', finishReason: null },
            tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            latencyMs: Date.now() - _ccAuditStart,
            error: e.message,
            traceId: _ccTraceId,
            vectorSources: _ccVectorSources.map(s => ({ source_type: s.source_type, source_id: s.source_id, title: s.title, score: s.score })),
          });
        }
        send({ event: 'error', error: e.message });
      } else {
        // 审计日志：CC 被用户中止
        if (auditLogger) {
          auditLogger.record({
            module: 'cc_chat',
            model: _ccAuditModel,
            skill: skill || null,
            baseUrl: providerEnv?.ANTHROPIC_BASE_URL || config.baseUrl || '',
            input: { systemPromptLen: 0, userPromptLen: message.length, userPrompt: message },
            output: { status: 200, contentLen: _ccAuditFullText.length, content: _ccAuditFullText, finishReason: 'aborted' },
            tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            latencyMs: Date.now() - _ccAuditStart,
            traceId: _ccTraceId,
            vectorSources: _ccVectorSources.map(s => ({ source_type: s.source_type, source_id: s.source_id, title: s.title, score: s.score })),
          });
        }
        send({ event: 'done', sessionId: newSessionId, aborted: true });
      }
    } finally {
      clearTimeout(ccTimeoutHandle);
      if (taskId) { taskControllers.delete(taskId); } else { ccAbortController = null; }
    }
  })();

  return { success: true, streaming: true, sessionId: newSessionId };
});

// CC 模式：在对话中直接执行命令
ipcMain.handle('cc:execute-command', async (event, { command, workdir }) => {
  // 安全检查：阻止危险命令
  const dangerousPatterns = [
    /rm\s+-rf\s+\/(?!\w)/,  // rm -rf /（但不阻止 rm -rf /home/user/project 这种）
    /mkfs/,
    /dd\s+if=.*of=\/dev\//,
    /:\(\)\s*\{\s*:\|:&\s*\}\s*;/,  // fork bomb
    /shutdown/,
    /reboot/,
    /halt\b/,
  ];
  const cmdLower = command.toLowerCase().trim();
  for (const pattern of dangerousPatterns) {
    if (pattern.test(cmdLower)) {
      return { success: false, error: '命令被安全策略拦截：包含危险操作', exitCode: -1 };
    }
  }

  // 友好提示：claude CLI 不可用
  if (/^\s*claude\b/.test(cmdLower)) {
    return {
      success: false,
      error: 'claude CLI 不在 PATH 中。Memora 通过 Claude Agent SDK 运行，不支持 claude CLI 命令。请在"文档 → Skill 管理"中安装/管理 Skill。',
      exitCode: 127,
      stdout: '',
      stderr: '/bin/sh: claude: command not found',
    };
  }

  try {
    const { exec } = require('child_process');
    const result = await new Promise((resolve) => {
      const child = exec(command, {
        cwd: workdir || undefined,
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 2, // 2MB
        env: { ...process.env },
      }, (err, stdout, stderr) => {
        resolve({
          success: !err || err.code !== null,
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: err ? (err.code || 1) : 0,
        });
      });
    });
    return result;
  } catch (err) {
    return { success: false, error: err.message, exitCode: -1, stdout: '', stderr: '' };
  }
});

ipcMain.handle('clear-api-key', async () => {
  setSetting('api_key', '');
  setSetting('api_base_url', '');
  setSetting('api_model', '');
  setSetting('api_daily_limit', '');
  // 同时清空大用量 LLM 配置
  setSetting('highvol_api_key', '');
  setSetting('highvol_base_url', '');
  setSetting('highvol_model', '');
  return { success: true };
});

// 测试 LLM API 连通性（验证 URL + Key + Model 是否配对正确）
ipcMain.handle('test-llm-connection', async (event, { baseUrl, apiKey, model }) => {
  // 如果前端未传 apiKey，尝试使用已保存的配置
  if (!apiKey && baseUrl && model) {
    const savedConfig = getAPIConfig();
    if (savedConfig.apiKey) apiKey = savedConfig.apiKey;
  }
  if (!baseUrl || !apiKey || !model) {
    return { ok: false, error: '缺少必要参数：Base URL、API Key、模型名称均不能为空' };
  }
  const startTime = Date.now();
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(15000), // 15s 超时
    });
    const latency = Date.now() - startTime;
    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      return { ok: true, latency, model: data.model || model, content: content.substring(0, 50) };
    } else {
      const errText = await response.text().catch(() => '');
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        errorMsg = errJson.error?.message || errJson.message || errJson.msg || errorMsg;
      } catch (_) {
        errorMsg += `: ${errText.substring(0, 200)}`;
      }
      return { ok: false, error: errorMsg, latency, httpStatus: response.status };
    }
  } catch (err) {
    return { ok: false, error: err.message, latency: Date.now() - startTime };
  }
});

// ADP配置相关
const DEFAULT_ADP_APP_KEY = process.env.ADP_APP_KEY || '';
// 知识推荐和知识搜索使用的专用 AppKey（与通用 ADP 助手不同）
const DEFAULT_ADP_KNOWLEDGE_APP_KEY = process.env.ADP_KNOWLEDGE_APP_KEY || '';
// 知识聚类使用的 AppKey（默认与智能推荐相同）
const DEFAULT_ADP_CLUSTERING_APP_KEY = process.env.ADP_CLUSTERING_APP_KEY || '';
// v2.3: 洞察模块 AppKey（活化/演化/冲突 — 暂复用知识 Key，后续可独立配置）
const DEFAULT_ADP_ACTIVATION_APP_KEY = DEFAULT_ADP_KNOWLEDGE_APP_KEY;
const DEFAULT_ADP_EVOLUTION_APP_KEY = DEFAULT_ADP_KNOWLEDGE_APP_KEY;
const DEFAULT_ADP_CONFLICT_APP_KEY = DEFAULT_ADP_KNOWLEDGE_APP_KEY;
// File Share 服务默认 API Key
const DEFAULT_FILE_SHARE_API_KEY = process.env.FILE_SHARE_API_KEY || '';

// ===== ADP 文件上传到 COS（官方规范流程）=====
// 参考文档：https://cloud.tencent.com/document/product/1759/108903
// 流程：DescribeStorageCredential → PUT 文件到 COS → (可选) docParse 获取 DocId → 传入 FileInfo

/**
 * TC3-HMAC-SHA256 签名算法（腾讯云 API 3.0 鉴权）
 */
function signTC3(secretId, secretKey, payload, action, region = 'ap-guangzhou') {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];

  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:lke.tencentcloudapi.com\n`;
  const signedHeaders = 'content-type;host';
  const hashedRequestPayload = crypto.createHash('sha256').update(payload).digest('hex');
  const canonicalRequest = [
    httpRequestMethod, canonicalUri, canonicalQueryString,
    canonicalHeaders, signedHeaders, hashedRequestPayload
  ].join('\n');

  const algorithm = 'TC3-HMAC-SHA256';
  const service = 'lke';
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonicalRequest].join('\n');

  const secretDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
  const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, timestamp, contentType };
}

/**
 * 获取 ADP 文件上传凭证（DescribeStorageCredential）
 * 🔧 按 Python SDK：返回 Credentials(临时密钥) + UploadPath + Bucket + Region + Type
 * 兼容旧版：如果 API 也返回了 UploadUrl/FileUrl，也会透传
 */
async function getADPUploadCredential(fileType, botBizId, secretId, secretKey, isPublic = false, typeKey = 'realtime') {
  const body = JSON.stringify({
    BotBizId: botBizId,
    FileType: fileType,
    IsPublic: isPublic,
    TypeKey: typeKey,
  });

  const { authorization, timestamp, contentType } = signTC3(secretId, secretKey, body, 'DescribeStorageCredential');

  console.log('[ADP Upload] Getting upload credential for:', fileType, 'typeKey:', typeKey, 'isPublic:', isPublic);

  const res = await fetch('https://lke.tencentcloudapi.com', {
    method: 'POST',
    headers: {
      'Host': 'lke.tencentcloudapi.com',
      'Content-Type': contentType,
      'X-TC-Action': 'DescribeStorageCredential',
      'X-TC-Version': '2023-11-30',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': 'ap-guangzhou',
      'Authorization': authorization,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json();
  if (data.Response?.Error) {
    const errMsg = `DescribeStorageCredential failed: ${data.Response.Error.Message} (${data.Response.Error.Code})`;
    console.error('[ADP Upload] ❌ Credential error:', errMsg, '| SecretId:', secretId ? secretId.substring(0, 8) + '...' : 'EMPTY', '| BotBizId:', botBizId || 'EMPTY');
    throw new Error(errMsg);
  }

  const resp = data.Response;
  
  // 🔧 按 Python SDK：核心字段是 Credentials + UploadPath + Bucket + Region + Type
  // 兼容旧版：UploadUrl/FileUrl 可能也存在
  const hasCredentials = resp.Credentials?.TmpSecretId && resp.Credentials?.TmpSecretKey && resp.Credentials?.Token;
  const hasUploadUrl = !!resp.UploadUrl;
  
  if (!hasCredentials && !hasUploadUrl) {
    throw new Error('DescribeStorageCredential: response missing both Credentials and UploadUrl');
  }

  console.log('[ADP Upload] Got credential - Bucket:', resp.Bucket, 'Region:', resp.Region,
    'Type:', resp.Type, 'HasCredentials:', hasCredentials, 'HasUploadUrl:', hasUploadUrl,
    'FileUrl:', resp.FileUrl?.substring(0, 80) + '...',
    'UploadPath:', resp.UploadPath?.substring(0, 40) + '...');
  return resp;
}

/**
 * 上传文件到 ADP COS（使用 DescribeStorageCredential 返回的 UploadUrl）
 * 返回 { fileUrl, cosHash, eTag }
 */
async function uploadFileToADPCOS(fileBuffer, fileName, fileType, fileSize, botBizId, secretId, secretKey) {
  // Step 1: 获取上传凭证
  // 🔧 按 Python SDK 示例：图片 is_public=true，文件 is_public=false
  const isImage = ['jpg', 'jpeg', 'png', 'bmp'].includes(fileType.toLowerCase());
  const cred = await getADPUploadCredential(fileType, botBizId, secretId, secretKey, isImage, 'realtime');

  let cosHash = '';
  let eTag = '';

  // Step 2: 上传文件到 COS
  // 🔧 修复：图片必须用正确的 MIME Type（如 image/png），否则 COS 存储为 application/octet-stream
  // ADP 服务端根据 Content-Type 判断文件类型，application/octet-stream 的图片无法显示
  const mimeTypeMap = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    bmp: 'image/bmp', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
    pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  };
  const contentType = mimeTypeMap[fileType.toLowerCase()] || 'application/octet-stream';

  if (cred.UploadUrl) {
    // 方式 A：使用 DescribeStorageCredential 返回的 UploadUrl（预签名 URL）直接 PUT
    console.log('[ADP Upload] Uploading file via UploadUrl:', fileName, 'size:', fileSize, 'contentType:', contentType);
    const uploadRes = await fetch(cred.UploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: fileBuffer,
      signal: AbortSignal.timeout(60000),
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      throw new Error(`COS PUT (UploadUrl) failed: HTTP ${uploadRes.status} ${errText}`);
    }

    cosHash = uploadRes.headers.get('x-cos-hash-crc64ecma') || '';
    eTag = uploadRes.headers.get('etag') || '';
  } else if (cred.Credentials) {
    // 方式 B：使用临时密钥 + COS SDK 上传（Python SDK 方式，更可靠）
    console.log('[ADP Upload] Uploading file via COS SDK + temp credentials:', fileName, 'size:', fileSize);
    const COS = require('cos-nodejs-sdk-v5');
    const cosClient = new COS({
      SecretId: cred.Credentials.TmpSecretId,
      SecretKey: cred.Credentials.TmpSecretKey,
      XCosSecurityToken: cred.Credentials.Token,
    });

    const uploadResult = await new Promise((resolve, reject) => {
      cosClient.putObject({
        Bucket: cred.Bucket,
        Region: cred.Region,
        Key: cred.UploadPath,
        Body: Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer),
        ContentLength: fileSize,
        ContentType: contentType,  // 🔧 修复：设置正确的 MIME Type，否则 COS 默认 application/octet-stream
      }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    eTag = uploadResult.ETag || '';
    cosHash = uploadResult.headers?.['x-cos-hash-crc64ecma'] || '';
    console.log('[ADP Upload] COS SDK upload OK, ETag:', eTag ? 'yes' : 'no', 'cosHash:', cosHash ? 'yes' : 'no');
  } else {
    throw new Error('No upload method available: missing both UploadUrl and Credentials');
  }

  // Step 3: 构造 FileUrl（按 Python SDK 方式自己拼接）
  // Python SDK: https://{Bucket}.{Type}.{Region}.myqcloud.com{UploadPath}
  const fileUrl = cred.FileUrl ||
    `https://${cred.Bucket}.${cred.Type || 'cos'}.${cred.Region}.myqcloud.com${cred.UploadPath}`;

  console.log('[ADP Upload] COS upload OK - FileUrl:', fileUrl.substring(0, 80) + '...',
    'cosHash:', cosHash ? 'yes' : 'no', 'eTag:', eTag ? 'yes' : 'no');

  return {
    fileUrl,
    bucket: cred.Bucket,
    region: cred.Region,
    type: cred.Type || 'cos',
    uploadPath: cred.UploadPath,
    cosHash,
    eTag,
  };
}

/**
 * 调用 ADP 实时文档解析接口获取 DocId
 * 返回 docId（标准模式文件对话必填）
 */
async function parseADPDocument(appKey, _botBizId, fileName, fileType, fileSize, cosResult, conversationId) {
  // 🔧 关键：docParse 的 session_id 必须和后续 chat 请求的 ConversationId 保持一致！
  // 参考 Python SDK 示例注释
  const sessionId = conversationId || Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  const requestId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

  // 🔧 关键修复：严格对照官方 Python SDK！docParse 的 cos_url 用 UploadPath（仅路径，如 /xxx.md）
  // 官方 SDK (main.py:307): "cos_url": credentials['UploadPath']   ← 仅路径！
  // 之前误传完整 URL 导致 docParse 报 Invalid-URL / AccessDenied（COS 鉴权失败）
  // 注意：V2 Chat 的 File.FileUrl 才用完整 URL（cos_final_url），两者不同，不能混用！
  const cosPath = cosResult.uploadPath ||
    (cosResult.fileUrl ? new URL(cosResult.fileUrl).pathname : '');

  const body = JSON.stringify({
    session_id: sessionId,
    bot_app_key: appKey,
    request_id: sessionId,  // Python SDK 中 request_id = session_id
    cos_bucket: cosResult.bucket,
    file_type: fileType,
    file_name: fileName,
    cos_url: cosPath,       // ✅ 官方 SDK：用 UploadPath（仅路径），不是完整 URL
    cos_hash: cosResult.cosHash || '',
    e_tag: cosResult.eTag || '',
    size: String(fileSize),
  });

  console.log('[ADP Upload] Parsing document:', fileName, 'fileType:', fileType,
    'cosPath(UploadPath):', cosPath,
    'sessionId:', sessionId.substring(0, 16) + '...',
    'cosHash:', cosResult.cosHash ? 'yes' : 'no',
    'eTag:', cosResult.eTag ? 'yes' : 'no');

  // 🔧 关键修复：docParse 是 SSE 流式接口，绝不能用 res.text()！
  // res.text() 会一直等到整个连接关闭才返回，但服务端发完 is_final 后通常不立即关连接，
  // 导致请求一直挂起直到 120s 超时被 abort（错误：The operation was aborted due to timeout）。
  // 官方 Python SDK 用 sseclient 逐事件处理、拿到 is_final 立即 break。这里改用流式增量读取。
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), 120000);

  let res;
  try {
    res = await fetch('https://wss.lke.cloud.tencent.com/v1/qbot/chat/docParse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutTimer);
    throw e;
  }

  if (!res.ok) {
    clearTimeout(timeoutTimer);
    const errText = await res.text().catch(() => '');
    console.error('[ADP Upload] ❌ docParse HTTP error:', res.status, errText.substring(0, 200));
    throw new Error(`docParse HTTP error: ${res.status} ${errText.substring(0, 100)}`);
  }

  // 🔧 修复：按 Python SDK 示例，docParse 响应格式是 { payload: { doc_id, status, error_message, is_final } }
  let docId = null;
  let lastPayload = null;
  let lineCount = 0;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;

  try {
    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      // 跨 chunk 安全：按行切分，最后一行可能不完整，留在 buffer 里
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        lineCount++;
        try {
          const data = JSON.parse(line.substring(5).trim());
          const payload = data.payload || data;  // 兼容两种格式
          lastPayload = payload;
          if (payload.is_final) {
            if (payload.status === 'FAILED') {
              console.error('[ADP Upload] ❌ docParse FAILED:', payload.error_message || 'unknown error');
              throw new Error(`docParse failed: ${payload.error_message || 'unknown error'}`);
            }
            docId = payload.doc_id;
            done = true;  // 拿到最终结果，立即结束读取
            break;
          }
        } catch (e) {
          if (e.message && e.message.startsWith('docParse failed')) throw e;
          /* ignore parse errors */
        }
      }
    }
  } finally {
    clearTimeout(timeoutTimer);
    try { await reader.cancel(); } catch (_) { /* ignore */ }
  }

  if (!docId) {
    console.warn('[ADP Upload] ⚠️ docParse completed but no doc_id found.',
      'Last payload status:', lastPayload?.status || 'none',
      'Error:', lastPayload?.error_message || 'none',
      'Response data lines:', lineCount);
  } else {
    console.log('[ADP Upload] ✅ Got DocId:', docId);
  }

  return {
    docId,
    sessionId,
    status: lastPayload?.status || 'UNKNOWN',
    errorMessage: lastPayload?.error_message || '',
  };
}

ipcMain.handle('get-adp-config', async () => {
  // v2.0: 登录状态优先使用服务器配置（除非用户强制使用本地配置）
  console.log('[ADP Config] get-adp-config called, isLoggedIn:', authState.isLoggedIn, 'remoteConfig exists:', !!remoteConfig, 'forceLocal:', authState.forceLocalConfig);
  if (remoteConfig) {
    console.log('[ADP Config] remoteConfig keys:', Object.keys(remoteConfig));
    console.log('[ADP Config] tencent_cloud:', remoteConfig.tencent_cloud ? JSON.stringify({...remoteConfig.tencent_cloud, secret_key: remoteConfig.tencent_cloud.secret_key ? '***' : ''}) : 'NOT FOUND');
  }
  if (authState.isLoggedIn && remoteConfig?.adp && !authState.forceLocalConfig) {
    const serverAppKey = remoteConfig.adp.app_key || '';
    const serverKnowledgeAppKey = remoteConfig.adp.knowledge_app_key || '';
    const serverSearchAppKey = remoteConfig.adp.search_app_key || '';
    const serverClusteringAppKey = remoteConfig.adp.clustering_app_key || '';
    const serverGraphAppKey = remoteConfig.adp.graph_app_key || '';
    const serverActivationAppKey = remoteConfig.adp.activation_app_key || '';
    const serverEvolutionAppKey = remoteConfig.adp.evolution_app_key || '';
    const serverConflictAppKey = remoteConfig.adp.conflict_app_key || '';
    return {
      appKey: serverAppKey || DEFAULT_ADP_APP_KEY,
      url: remoteConfig.adp.url || 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
      agentName: remoteConfig.adp.agent_name || '我的AI助手',
      knowledgeAppKey: serverKnowledgeAppKey || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
      searchAppKey: serverSearchAppKey || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
      clusteringAppKey: serverClusteringAppKey || DEFAULT_ADP_CLUSTERING_APP_KEY,
      graphAppKey: serverGraphAppKey || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
      activationAppKey: serverActivationAppKey || DEFAULT_ADP_ACTIVATION_APP_KEY,
      evolutionAppKey: serverEvolutionAppKey || DEFAULT_ADP_EVOLUTION_APP_KEY,
      conflictAppKey: serverConflictAppKey || DEFAULT_ADP_CONFLICT_APP_KEY,
      fileShareApiKey: remoteConfig?.file_share?.api_key || DEFAULT_FILE_SHARE_API_KEY,
      tcSecretId: remoteConfig?.tencent_cloud?.secret_id || getSetting('adp_tc_secret_id') || '',
      tcSecretKey: (remoteConfig?.tencent_cloud?.secret_key || getSetting('adp_tc_secret_key')) ? '••••••••' : '',  // 不返回明文，但显示是否已配置
      tcSecretKeyConfigured: !!(remoteConfig?.tencent_cloud?.secret_key || getSetting('adp_tc_secret_key')),  // 明确标记是否已配置
      botBizId: remoteConfig?.tencent_cloud?.bot_biz_id || getSetting('adp_bot_biz_id') || '',
      fromServer: true,
      configSource: {
        appKey: serverAppKey ? 'server' : 'default',
        knowledgeAppKey: serverKnowledgeAppKey ? 'server' : 'default',
        searchAppKey: serverSearchAppKey ? 'server' : 'default',
        clusteringAppKey: serverClusteringAppKey ? 'server' : 'default',
        graphAppKey: serverGraphAppKey ? 'server' : 'default',
        activationAppKey: serverActivationAppKey ? 'server' : 'default',
        evolutionAppKey: serverEvolutionAppKey ? 'server' : 'default',
        conflictAppKey: serverConflictAppKey ? 'server' : 'default',
        fileShareApiKey: remoteConfig?.file_share?.api_key ? 'server' : 'default',
        tcSecretId: remoteConfig?.tencent_cloud?.secret_id ? 'server' : 'local',
        tcSecretKey: remoteConfig?.tencent_cloud?.secret_key ? 'server' : 'local',
        botBizId: remoteConfig?.tencent_cloud?.bot_biz_id ? 'server' : 'local',
      }
    };
  }

  const localAppKey = getSetting('adp_app_key') || '';
  const localKnowledgeAppKey = getSetting('adp_knowledge_app_key') || '';
  const localSearchAppKey = getSetting('adp_search_app_key') || '';
  const localClusteringAppKey = getSetting('adp_clustering_app_key') || '';
  const localGraphAppKey = getSetting('adp_graph_app_key') || '';
  const localActivationAppKey = getSetting('adp_activation_app_key') || '';
  const localEvolutionAppKey = getSetting('adp_evolution_app_key') || '';
  const localConflictAppKey = getSetting('adp_conflict_app_key') || '';
  return {
    appKey: localAppKey || DEFAULT_ADP_APP_KEY,
    url: getSetting('adp_url') || 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
    agentName: getSetting('adp_agent_name') || '我的AI助手',
    knowledgeAppKey: localKnowledgeAppKey || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
    searchAppKey: localSearchAppKey || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
    clusteringAppKey: localClusteringAppKey || DEFAULT_ADP_CLUSTERING_APP_KEY,
    graphAppKey: localGraphAppKey || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
    activationAppKey: localActivationAppKey || DEFAULT_ADP_ACTIVATION_APP_KEY,
    evolutionAppKey: localEvolutionAppKey || DEFAULT_ADP_EVOLUTION_APP_KEY,
    conflictAppKey: localConflictAppKey || DEFAULT_ADP_CONFLICT_APP_KEY,
    fileShareApiKey: getSetting('file_share_api_key') || DEFAULT_FILE_SHARE_API_KEY,
    tcSecretId: getSetting('adp_tc_secret_id') || '',
    tcSecretKey: getSetting('adp_tc_secret_key') ? '••••••••' : '',  // 不返回明文，但显示是否已配置
    tcSecretKeyConfigured: !!getSetting('adp_tc_secret_key'),  // 明确标记是否已配置
    botBizId: getSetting('adp_bot_biz_id') || '',
    fromServer: false,
    configSource: {
      appKey: localAppKey ? 'custom' : 'default',
      knowledgeAppKey: localKnowledgeAppKey ? 'custom' : 'default',
      searchAppKey: localSearchAppKey ? 'custom' : 'default',
      clusteringAppKey: localClusteringAppKey ? 'custom' : 'default',
      graphAppKey: localGraphAppKey ? 'custom' : 'default',
      activationAppKey: localActivationAppKey ? 'custom' : 'default',
      evolutionAppKey: localEvolutionAppKey ? 'custom' : 'default',
      conflictAppKey: localConflictAppKey ? 'custom' : 'default',
      fileShareApiKey: getSetting('file_share_api_key') ? 'custom' : 'default',
    }
  };
});

ipcMain.handle('set-adp-config', async (event, config) => {
  if (config.appKey) {
    setSetting('adp_app_key', config.appKey);
  }
  if (config.url) {
    setSetting('adp_url', config.url);
  }
  if (config.agentName) {
    setSetting('adp_agent_name', config.agentName);
  }
  if (config.knowledgeAppKey !== undefined) {
    setSetting('adp_knowledge_app_key', config.knowledgeAppKey);
  }
  if (config.searchAppKey !== undefined) {
    setSetting('adp_search_app_key', config.searchAppKey);
  }
  if (config.clusteringAppKey !== undefined) {
    setSetting('adp_clustering_app_key', config.clusteringAppKey);
  }
  if (config.graphAppKey !== undefined) {
    setSetting('adp_graph_app_key', config.graphAppKey);
  }
  if (config.activationAppKey !== undefined) {
    setSetting('adp_activation_app_key', config.activationAppKey);
  }
  if (config.evolutionAppKey !== undefined) {
    setSetting('adp_evolution_app_key', config.evolutionAppKey);
  }
  if (config.conflictAppKey !== undefined) {
    setSetting('adp_conflict_app_key', config.conflictAppKey);
  }
  if (config.fileShareApiKey !== undefined) {
    setSetting('file_share_api_key', config.fileShareApiKey);
  }
  if (config.tcSecretId !== undefined) {
    setSetting('adp_tc_secret_id', config.tcSecretId);
  }
  if (config.tcSecretKey !== undefined && config.tcSecretKey !== '••••••••') {
    setSetting('adp_tc_secret_key', config.tcSecretKey);
  }
  if (config.botBizId !== undefined) {
    setSetting('adp_bot_biz_id', config.botBizId);
  }
  return { success: true };
});

ipcMain.handle('clear-adp-config', async () => {
  setSetting('adp_app_key', '');
  setSetting('adp_url', '');
  setSetting('adp_agent_name', '');
  setSetting('adp_knowledge_app_key', '');
  setSetting('adp_search_app_key', '');
  setSetting('adp_clustering_app_key', '');
  setSetting('adp_graph_app_key', '');
  setSetting('adp_activation_app_key', '');
  setSetting('adp_evolution_app_key', '');
  setSetting('adp_conflict_app_key', '');
  setSetting('file_share_api_key', '');
  setSetting('adp_tc_secret_id', '');
  setSetting('adp_tc_secret_key', '');
  setSetting('adp_bot_biz_id', '');
  return { success: true };
});

// ===== v2.0 认证与远程配置 IPC =====

// 拉取远程配置到内存（不写磁盘）
async function fetchRemoteConfig() {
  if (!authState.isLoggedIn || !authState.token) return;

  const server = getAuthServer();
  try {
    const res = await fetch(`${server.configUrl}${server.configPath}`, {
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'X-Auth-Server': getAuthUrlForAuth(),  // 传递 ADPToolkit 地址，供 config-server 同步配置使用
      }
    });

    if (res.ok) {
      const data = await res.json();
      // 仅存内存，不写磁盘，退出登录即消失
      remoteConfig = data;
      _lastConfigUpdatedAt = data._meta?.updated_at || null;
      console.log('[Auth] Remote config fetched, keys:', Object.keys(data));
      console.log('[Auth] tencent_cloud in remoteConfig:', data.tencent_cloud ? `secret_id=${data.tencent_cloud.secret_id ? '✅' : '❌'} secret_key=${data.tencent_cloud.secret_key ? '✅' : '❌'} bot_biz_id=${data.tencent_cloud.bot_biz_id ? '✅' : '❌'}` : 'NOT FOUND');
      // 校验 ADP 专用 Key：如果服务器返回的 knowledge_app_key / search_app_key 与 app_key 相同，
      // 说明 org_config 未正确配置，使用本地默认值
      if (remoteConfig.adp) {
        const adp = remoteConfig.adp;
        if (!adp.knowledge_app_key || adp.knowledge_app_key === adp.app_key) {
          console.log('[Auth] knowledge_app_key 未配置或与 app_key 相同，使用本地默认值');
          adp.knowledge_app_key = DEFAULT_ADP_KNOWLEDGE_APP_KEY;
        }
        if (!adp.search_app_key || adp.search_app_key === adp.app_key) {
          console.log('[Auth] search_app_key 未配置或与 app_key 相同，使用本地默认值');
          adp.search_app_key = DEFAULT_ADP_KNOWLEDGE_APP_KEY;
        }
        if (!adp.clustering_app_key || adp.clustering_app_key === adp.app_key) {
          console.log('[Auth] clustering_app_key 未配置或与 app_key 相同，使用本地默认值');
          adp.clustering_app_key = DEFAULT_ADP_CLUSTERING_APP_KEY;
        }
        if (!adp.graph_app_key || adp.graph_app_key === adp.app_key) {
          console.log('[Auth] graph_app_key 未配置或与 app_key 相同，使用本地默认值');
          adp.graph_app_key = DEFAULT_ADP_KNOWLEDGE_APP_KEY;
        }
      }
      console.log('[Auth] ADP config - app_key:', (data.adp?.app_key || '').substring(0, 10) + '...',
        '| knowledge_app_key:', (data.adp?.knowledge_app_key || '').substring(0, 10) + '...',
        '| search_app_key:', (data.adp?.search_app_key || '').substring(0, 10) + '...',
        '| clustering_app_key:', (data.adp?.clustering_app_key || '').substring(0, 10) + '...',
        '| graph_app_key:', (data.adp?.graph_app_key || '').substring(0, 10) + '...');
    } else if (res.status === 401) {
      // token 失效，自动退出
      console.log('[Auth] Token expired, auto logout');
      await handleLogout();
    } else {
      console.error('[Auth] Fetch config failed:', res.status);
    }
  } catch (err) {
    console.error('[Auth] Fetch config error:', err.message);
    // 网络不可用，不清空，使用上次缓存（如果有）
  }
}

// 退出登录处理
async function handleLogout(clearToken = true) {
  const env = authState.env;  // 保留环境选择
  // 退出前先上报登出活动
  if (authState.isLoggedIn && authState.token) {
    await reportLogoutActivity();
  }
  // 停止通知轮询
  stopNotificationPolling();
  // 停止配置轮询
  stopConfigPolling();
  authState = { isLoggedIn: false, token: null, user: null, env, forceLocalConfig: false };
  remoteConfig = null;  // 清空内存中的服务器配置（ADP/LLM key 等随 remoteConfig 一起清空）

  if (clearToken) {
    // 清除持久化的 token
    deleteSetting('auth_token');
    deleteSetting('auth_user');
    deleteSetting('auth_remember_me');
  }

  // 通知渲染进程：配置已清空（让设置页面不再显示云端 key）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:changed', { isLoggedIn: false });
    mainWindow.webContents.send('config:updated', {
      api: null,
      adp: null,
      forceLocalConfig: false,
      reason: 'logout'
    });
  }
}

// 配置定期同步：每 5 分钟拉取一次云端配置，检测是否有更新
let _lastConfigUpdatedAt = null;  // 上次同步时服务端的 updated_at

function startConfigPolling(intervalMs = 5 * 60 * 1000) {
  stopConfigPolling();
  configPollTimer = setInterval(async () => {
    if (!authState.isLoggedIn || authState.forceLocalConfig) return;
    try {
      const oldUpdatedAt = _lastConfigUpdatedAt;
      await fetchRemoteConfig();
      // 如果 updated_at 变了，说明云端配置有更新
      if (remoteConfig?._meta?.updated_at && remoteConfig._meta.updated_at !== oldUpdatedAt) {
        console.log('[Auth] Cloud config updated:', oldUpdatedAt, '->', remoteConfig._meta.updated_at);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('config:updated', {
            api: remoteConfig?.api || null,
            adp: remoteConfig?.adp || null,
            forceLocalConfig: authState.forceLocalConfig,
            reason: 'cloud_updated'
          });
        }
      }
    } catch (err) {
      console.error('[Auth] Config poll error:', err.message);
    }
  }, intervalMs);
  console.log('[Auth] Config polling started, interval:', intervalMs / 1000, 's');
}

function stopConfigPolling() {
  if (configPollTimer) {
    clearInterval(configPollTimer);
    configPollTimer = null;
  }
}

// 启动时自动登录
async function autoLogin() {
  const token = getSetting('auth_token');
  const userStr = getSetting('auth_user');
  const savedEnv = getSetting('auth_env') || 'beta';
  const savedForceLocal = getSetting('auth_force_local') === '1';
  const rememberMe = getSetting('auth_remember_me') !== '0';  // 默认 true

  // 如果用户未勾选记住登录，清除 token 不自动登录
  if (!rememberMe && token) {
    deleteSetting('auth_token');
    deleteSetting('auth_user');
    deleteSetting('auth_remember_me');
    console.log('[Auth] Remember me disabled, cleared token');
    return;
  }

  if (!token || !userStr) return;

  authState.env = savedEnv;
  authState.forceLocalConfig = savedForceLocal;
  const server = getAuthServer();
  const authUrl = getAuthUrlForAuth();

  try {
    const res = await fetch(`${authUrl}${server.validatePath}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      authState.isLoggedIn = true;
      authState.token = token;
      authState.user = data.user || data;
      await fetchRemoteConfig();
      console.log('[Auth] Auto login success:', authState.user?.email || authState.user?.username);
      // 通知渲染进程配置已更新（确保设置页面等刷新）
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('config:updated', {
          api: remoteConfig?.api || null,
          adp: remoteConfig?.adp || null,
          forceLocalConfig: authState.forceLocalConfig
        });
      }
      // 自动登录成功通知
      showNotification('忆境 Memora', `欢迎回来，${authState.user?.name || authState.user?.email || ''}！`);
      // 上报自动登录活动
      await reportLoginActivity(!!remoteConfig);
      // 拉取服务端通知并显示
      const serverNotifs = await fetchServerNotifications();
      if (serverNotifs.length > 0) {
        const unread = serverNotifs.filter(n => !n.read);
        if (unread.length > 0) {
          showNotification('忆境 Memora', `你有 ${unread.length} 条未读通知`);
        }
        // 通知渲染进程
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('notifications:updated', { notifications: serverNotifs, unreadCount: unread.length });
        }
      }
      // 启动通知轮询
      startNotificationPolling();
      // 检查更新
      const updateInfo = await checkForUpdate();
      if (updateInfo.has_update && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:available', updateInfo);
      }
    } else {
      // token 失效，清理
      deleteSetting('auth_token');
      deleteSetting('auth_user');
      console.log('[Auth] Auto login failed: token expired');
    }
  } catch (err) {
    console.log('[Auth] Auto login failed: network error, will use local config');
    // 网络不可用，不清理 token，下次启动重试，本次用本地配置
  }
}

// 登录 — 走 ADPToolkit 认证服务器（与注册一致，用户数据在 ADPToolkit）
ipcMain.handle('auth:login', async (event, { account, password, env, rememberMe }) => {
  // 设置环境
  authState.env = env || 'beta';
  const server = getAuthServer();
  const authUrl = getAuthUrlForAuth();

  // ADPToolkit 使用 username 字段，Config Server 使用 email
  const loginBody = server.loginField === 'username'
    ? { username: account, password }  // ADPToolkit 登录（字段名 username）
    : { email: account, password };  // Config Server 自建认证用 email

  const loginUrl = `${authUrl}${server.loginPath}`;
  console.log('[Auth] Login attempt:', {
    env: authState.env,
    fullUrl: loginUrl,
    loginField: server.loginField,
    account: loginBody.username || loginBody.email
  });

  // 登录请求（带超时）
  let res;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    res = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginBody),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
  } catch (fetchErr) {
    console.error('[Auth] Login fetch error:', fetchErr.message, '| code:', fetchErr.code, '| cause:', fetchErr.cause?.message);
    const errMsg = fetchErr.name === 'AbortError' ? '连接超时，请检查网络'
      : fetchErr.code === 'ECONNREFUSED' ? '连接被拒绝，服务器可能未启动'
      : fetchErr.code === 'ENOTFOUND' ? '域名解析失败'
      : fetchErr.code === 'ETIMEDOUT' || fetchErr.code === 'UND_ERR_CONNECT_TIMEOUT' ? '连接超时'
      : fetchErr.message?.includes('fetch failed') ? `网络连接失败 (${fetchErr.cause?.message || fetchErr.code || 'unknown'})`
      : `网络错误: ${fetchErr.message}`;
    return { success: false, error: errMsg };
  }

  let data;
  try {
    data = await res.json();
  } catch (jsonErr) {
    console.error('[Auth] Login response JSON parse error:', jsonErr.message, '| HTTP status:', res.status);
    return { success: false, error: `服务器响应异常 (HTTP ${res.status})` };
  }

  if (!res.ok) {
    console.error('[Auth] Login failed: HTTP', res.status, data);
    return { success: false, error: data.message || data.error || `登录失败 (HTTP ${res.status})` };
  }

  // 登录成功 —— 保存状态
  authState.isLoggedIn = true;
  authState.token = data.token;
  authState.user = data.user;
  authState.forceLocalConfig = false;

  setSetting('auth_token', data.token);
  setSetting('auth_user', JSON.stringify(data.user));
  setSetting('auth_env', authState.env);
  setSetting('auth_force_local', '0');
  setSetting('auth_remember_me', rememberMe !== false ? '1' : '0');

  console.log('[Auth] Login success:', data.user?.username || data.user?.email, 'env:', authState.env);

  // 后续操作独立 try-catch，不阻塞登录结果
  (async () => {
    try {
      await fetchRemoteConfig();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('config:updated', {
          api: remoteConfig?.api || null,
          adp: remoteConfig?.adp || null,
          forceLocalConfig: authState.forceLocalConfig
        });
      }
    } catch (e) { console.error('[Auth] Post-login fetchRemoteConfig error:', e.message); }

    try {
      await reportLoginActivity(!!remoteConfig);
    } catch (e) { console.error('[Auth] Post-login reportLoginActivity error:', e.message); }

    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:changed', { isLoggedIn: true, user: data.user, env: authState.env });
      }
    } catch (e) { /* ignore */ }

    try {
      const serverNotifs = await fetchServerNotifications();
      if (serverNotifs.length > 0) {
        const unread = serverNotifs.filter(n => !n.read);
        if (unread.length > 0) {
          showNotification('忆境 Memora', `你有 ${unread.length} 条未读通知`);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('notifications:updated', { notifications: serverNotifs, unreadCount: unread.length });
        }
      }
    } catch (e) { console.error('[Auth] Post-login fetchServerNotifications error:', e.message); }

    try { startNotificationPolling(); } catch (e) { /* ignore */ }

    try {
      const updateInfo = await checkForUpdate();
      if (updateInfo.has_update && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:available', updateInfo);
      }
    } catch (e) { console.error('[Auth] Post-login checkForUpdate error:', e.message); }
  })();

  return { success: true, user: data.user, env: authState.env };
});

// 退出登录
ipcMain.handle('auth:logout', async () => {
  await handleLogout();
  return { success: true };
});

// 发送验证码 — 始终走 ADPToolkit 认证服务器（只有 ADPToolkit 有完整认证接口）
ipcMain.handle('auth:send-code', async (event, { mobile }) => {
  const authUrl = getAuthUrlForAuth();
  const sendCodeUrl = `${authUrl}/api/auth/send-code`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(sendCodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await res.json();
    console.log('[Auth] Send-code response:', { ok: res.ok, data });
    if (!res.ok) {
      return { success: false, error: data.error || data.message || '发送失败' };
    }
    return { success: true, ...data };
  } catch (err) {
    console.error('[Auth] Send code error:', err.message);
    return { success: false, error: `网络错误: ${err.message}` };
  }
});

// 注册 — 始终走 ADPToolkit 认证服务器
ipcMain.handle('auth:register', async (event, { username, mobile, sms_code, name, password, nickname, email, env }) => {
  authState.env = env || 'production';
  const authUrl = getAuthUrlForAuth();
  const registerUrl = `${authUrl}/api/auth/register`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(registerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, mobile, sms_code, name: name || username, password, nickname: nickname || '', email: email || '', organization: '注册用户' }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || data.message || '注册失败' };
    }

    // 注册成功——自动登录
    if (data.token && data.user) {
      authState.isLoggedIn = true;
      authState.token = data.token;
      authState.user = data.user;
      authState.forceLocalConfig = false;

      setSetting('auth_token', data.token);
      setSetting('auth_user', JSON.stringify(data.user));
      setSetting('auth_env', authState.env);
      setSetting('auth_force_local', '0');
      setSetting('auth_remember_me', '1');

      // 后续操作
      (async () => {
        try { await fetchRemoteConfig(); } catch (e) { /* ignore */ }
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('config:updated', {
              api: remoteConfig?.api || null,
              adp: remoteConfig?.adp || null,
              forceLocalConfig: false
            });
            mainWindow.webContents.send('auth:changed', { isLoggedIn: true, user: data.user, env: authState.env });
          }
        } catch (e) { /* ignore */ }
        try { await reportLoginActivity(!!remoteConfig); } catch (e) { /* ignore */ }
      })();
    }

    return { success: true, user: data.user, env: authState.env };
  } catch (err) {
    console.error('[Auth] Register error:', err.message);
    return { success: false, error: `网络错误: ${err.message}` };
  }
});

// 更新个人信息
ipcMain.handle('auth:update-profile', async (event, profileData) => {
  if (!authState.isLoggedIn || !authState.token) {
    return { success: false, error: '未登录' };
  }
  const authUrl = getAuthUrlForAuth();
  try {
    const updateUrl = `${authUrl}/api/auth/profile`;
    
    // 支持的15个可修改字段
    const allowedFields = ['name', 'nickname', 'email', 'mobile', 'avatar', 'gender', 'birth_date', 'country_code', 'profession', 'address', 'locale', 'timezone', 'region', 'industry', 'organization'];
    const updateData = {};
    for (const key of allowedFields) {
      if (profileData[key] !== undefined && profileData[key] !== null) {
        updateData[key] = profileData[key];
      }
    }
    
    const res = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authState.token}`,
      },
      body: JSON.stringify(updateData),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || data.message || '更新失败' };
    }
    // 更新本地缓存的用户信息
    if (data.user) {
      authState.user = { ...authState.user, ...data.user };
    }
    return { success: true, user: authState.user };
  } catch (err) {
    console.error('[Auth] Update profile error:', err.message);
    return { success: false, error: `网络错误: ${err.message}` };
  }
});

// 获取当前认证状态
ipcMain.handle('auth:get-state', async () => {
  const server = getAuthServer();
  return {
    isLoggedIn: authState.isLoggedIn,
    token: authState.token || null,
    user: authState.user,
    env: authState.env || 'beta',
    forceLocalConfig: authState.forceLocalConfig || false,
    rememberMe: getSetting('auth_remember_me') !== '0',
    serverName: server.name,
    authUrl: server.authUrl,
    configUrl: server.configUrl,
    toolkitUrl: server.toolkitUrl || server.authUrl
  };
});

// 获取所有环境的服务器地址
ipcMain.handle('auth:get-server-urls', async () => {
  const result = {};
  for (const env of ['beta', 'production']) {
    result[env] = {
      authUrl: AUTH_SERVERS[env].authUrl,
      configUrl: AUTH_SERVERS[env].configUrl,
      defaultAuthUrl: DEFAULT_AUTH_SERVERS[env].authUrl,
      defaultConfigUrl: DEFAULT_AUTH_SERVERS[env].configUrl,
      name: AUTH_SERVERS[env].name,
      isCustom: AUTH_SERVERS[env].authUrl !== DEFAULT_AUTH_SERVERS[env].authUrl ||
                AUTH_SERVERS[env].configUrl !== DEFAULT_AUTH_SERVERS[env].configUrl
    };
  }
  return result;
});

// 验证并保存服务器地址
ipcMain.handle('auth:set-server-urls', async (event, { urls }) => {
  try {
    // 格式校验
    const urlPattern = /^https?:\/\/.+/;
    const errors = [];

    for (const env of ['beta', 'production']) {
      if (!urls[env]) continue;
      if (urls[env].authUrl && !urlPattern.test(urls[env].authUrl)) {
        errors.push(`${env} 认证地址格式不正确（需 http:// 或 https:// 开头）`);
      }
      if (urls[env].configUrl && !urlPattern.test(urls[env].configUrl)) {
        errors.push(`${env} 配置地址格式不正确（需 http:// 或 https:// 开头）`);
      }
    }
    if (errors.length > 0) {
      return { success: false, error: errors.join('; ') };
    }

    // 连通性验证：先测试新地址，不修改运行时配置
    const testResults = [];
    for (const env of ['beta', 'production']) {
      if (!urls[env]) continue;
      const authUrl = urls[env].authUrl || AUTH_SERVERS[env].authUrl;
      const configUrl = urls[env].configUrl || AUTH_SERVERS[env].configUrl;
      const result = await validateServerUrl(authUrl, configUrl);
      testResults.push({ env, ...result });
    }

    const failedTests = testResults.filter(r => !r.valid);
    if (failedTests.length > 0) {
      const failMsg = failedTests.map(r => `${r.env}: ${r.error}`).join('; ');
      return { success: false, error: `验证失败 - ${failMsg}` };
    }

    // 验证通过，更新运行时配置并持久化
    const customUrls = {};
    for (const env of ['beta', 'production']) {
      if (!urls[env]) continue;
      if (urls[env].authUrl) AUTH_SERVERS[env].authUrl = urls[env].authUrl;
      if (urls[env].configUrl) AUTH_SERVERS[env].configUrl = urls[env].configUrl;
      customUrls[env] = {
        authUrl: AUTH_SERVERS[env].authUrl,
        configUrl: AUTH_SERVERS[env].configUrl
      };
    }
    saveCustomServerUrls(customUrls);
    console.log('[Auth] Server URLs updated and saved:', JSON.stringify(customUrls));

    return { success: true };
  } catch (err) {
    console.error('[Auth] Set server URLs error:', err);
    return { success: false, error: `保存失败: ${err.message}` };
  }
});

// 重置服务器地址为默认值
ipcMain.handle('auth:reset-server-urls', async (event, { env }) => {
  try {
    if (env && env !== 'all') {
      AUTH_SERVERS[env] = structuredClone(DEFAULT_AUTH_SERVERS[env]);
    } else {
      AUTH_SERVERS = structuredClone(DEFAULT_AUTH_SERVERS);
    }
    // 更新持久化存储
    if (env && env !== 'all') {
      const custom = getSetting('custom_server_urls');
      const parsed = custom ? JSON.parse(custom) : {};
      delete parsed[env];
      if (Object.keys(parsed).length > 0) {
        setSetting('custom_server_urls', JSON.stringify(parsed));
      } else {
        setSetting('custom_server_urls', '');
      }
    } else {
      setSetting('custom_server_urls', '');
    }
    console.log('[Auth] Server URLs reset to default:', env || 'all');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 配置源切换（云端/本地）
ipcMain.handle('config:set-source', async (event, { forceLocal }) => {
  authState.forceLocalConfig = !!forceLocal;
  setSetting('auth_force_local', authState.forceLocalConfig ? '1' : '0');
  console.log('[Auth] Config source set to:', authState.forceLocalConfig ? 'local' : 'cloud');
  return { success: true, forceLocalConfig: authState.forceLocalConfig };
});

ipcMain.handle('config:get-source', async () => {
  return {
    forceLocalConfig: authState.forceLocalConfig || false,
    isLoggedIn: authState.isLoggedIn,
    hasRemoteConfig: !!remoteConfig
  };
});

// 通知相关 IPC
ipcMain.handle('notifications:fetch', async () => {
  return await fetchServerNotifications();
});

ipcMain.handle('notifications:unread-count', async () => {
  return await fetchUnreadNotificationCount();
});

ipcMain.handle('notifications:mark-read', async (event, notificationId) => {
  return await markNotificationRead(notificationId);
});

ipcMain.handle('notifications:mark-all-read', async () => {
  return await markAllNotificationsRead();
});

// ===== 云端同步 IPC =====

const SYNC_API_BASE = '/memora/sync';

// 服务端 TEXT 列字段：客户端发送时若为数组/对象必须序列化为 JSON 字符串
// 否则 sqlite 写入会报错导致 HTTP 500
const SYNC_TEXT_FIELDS = new Set([
  'pomodoro_sessions', 'reminders', 'tags', 'extra',
  'attachments', 'metadata', 'context'
]);

/**
 * 兜底序列化：递归扫描 push body，将 TEXT 字段的非字符串值转为 JSON 字符串
 * 同时去除 undefined 字段（JSON.stringify 会丢但显式去掉更安全）
 */
function sanitizeSyncPayload(body) {
  if (!body || typeof body !== 'object') return body;
  // 仅处理 changes 段（push/full 的数据载荷）
  if (body.changes && typeof body.changes === 'object') {
    for (const [type, items] of Object.entries(body.changes)) {
      if (!Array.isArray(items)) continue;
      body.changes[type] = items.map(item => {
        if (!item || typeof item !== 'object') return item;
        const cleaned = {};
        for (const [k, v] of Object.entries(item)) {
          if (v === undefined) continue;
          // TEXT 字段强制字符串
          if (SYNC_TEXT_FIELDS.has(k) && v !== null && typeof v !== 'string') {
            try {
              cleaned[k] = JSON.stringify(v);
            } catch {
              cleaned[k] = String(v);
            }
          } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            // 其他对象字段也兜底序列化（除了已知的纯标量字段）
            // 但保留 base_revision、id 等基础字段不变
            cleaned[k] = JSON.stringify(v);
          } else if (Array.isArray(v)) {
            // 任何未知的数组字段也序列化（防止服务端 TEXT 字段未列入白名单）
            cleaned[k] = JSON.stringify(v);
          } else {
            cleaned[k] = v;
          }
        }
        return cleaned;
      });
    }
  }
  return body;
}

async function syncApiRequest(path, options = {}) {
  if (!authState.isLoggedIn || !authState.token) {
    return { ok: false, error: 'Not authenticated' };
  }
  const server = getAuthServer();
  const baseUrl = server.configUrl || server.authUrl;
  const url = `${baseUrl}${SYNC_API_BASE}${path}`;

  // 兜底：对发送数据做字段安全处理，防止 TEXT 列收到数组/对象
  const safeBody = options.body ? sanitizeSyncPayload(options.body) : undefined;

  try {
    const res = await fetch(url, {
      method: options.method || 'POST',
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'Content-Type': 'application/json'
      },
      body: safeBody ? JSON.stringify(safeBody) : undefined
    });

    if (res.status === 401) {
      console.warn('[Sync] Token expired');
      return { ok: false, error: 'Token expired' };
    }

    if (res.status === 403) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.code || 'DEVICE_DEACTIVATED', status: 403 };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[Sync] API error:', res.status, text.substring(0, 500));
      // 尝试解析服务端错误消息
      let serverMsg = `HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(text);
        if (errJson.error || errJson.message) serverMsg = errJson.error || errJson.message;
      } catch {}
      return { ok: false, error: serverMsg, status: res.status };
    }

    return await res.json();
  } catch (err) {
    console.error('[Sync] Network error:', err.message);
    return { ok: false, error: err.message };
  }
}

// ===== 图片同步辅助函数 =====

/**
 * 上传图片文件到服务端
 * 使用 https/http 模块替代 fetch，确保 form-data 流式上传兼容性
 * @param {string} localPath - 本地图片绝对路径
 * @returns {Object} { ok, uploaded: [{ id, server_path, image_hash, width, height, ... }] }
 */
async function uploadNoteImage(localPath) {
  if (!authState.isLoggedIn || !authState.token) {
    return { ok: false, error: 'Not authenticated' };
  }
  if (!fs.existsSync(localPath)) {
    return { ok: false, error: 'File not found: ' + localPath };
  }

  const server = getAuthServer();
  const baseUrl = server.configUrl || server.authUrl;
  const url = `${baseUrl}${SYNC_API_BASE}/notes/images/upload`;

  try {
    // 直接使用 http 模块上传（Node.js fetch 不兼容 form-data npm 包的 stream body，
    // 导致 "Unexpected end of form" 500 错误，所以不走 fetch）
    const result = await _uploadNoteImageViaHttp(url, localPath, authState.token);

    if (result && result.ok && result.uploaded?.length > 0) {
      console.log('[Sync] Image uploaded:', result.uploaded.map(i => i.server_path));
    } else {
      console.warn('[Sync] Image upload response unexpected:', JSON.stringify(result)?.substring(0, 200));
    }
    return result;
  } catch (err) {
    console.error('[Sync] Image upload error:', err.message, err.stack?.split('\n')[1]);
    return { ok: false, error: err.message };
  }
}

/**
 * 使用 http/https 模块上传图片（fetch 降级方案）
 */
function _uploadNoteImageViaHttp(url, localPath, token) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? require('https') : require('http');

    const form = new FormData();
    form.append('images', fs.createReadStream(localPath));
    // 🔧 修复：使用同步引擎注册的 device_id，而非 getDeviceFingerprint()
    // getDeviceFingerprint() 生成 mac_xxx_ip_xxx 格式，与注册的 pc_xxx 格式不匹配
    // 导致 requireActiveDevice 中间件返回 404（设备未注册）
    const deviceIdForUpload = syncDeviceId || getDeviceFingerprint();
    form.append('device_id', deviceIdForUpload);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...form.getHeaders()
      }
    };

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 400) {
            console.error('[Sync] Image upload HTTP fallback error:', res.statusCode, data.substring(0, 300));
            resolve({ ok: false, error: `HTTP ${res.statusCode}` });
            return;
          }
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(new Error('Parse response failed: ' + e.message));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error('HTTP request failed: ' + e.message));
    });

    // 设置超时 30 秒
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Upload timeout (30s)'));
    });

    form.pipe(req);
  });
}

/**
 * 上传 base64 data URL 图片到服务器
 * @param {string} dataUrl - base64 data URL (data:image/png;base64,...)
 * @returns {Promise<{ok:boolean, server_url?:string, error?:string}>}
 */
async function uploadBase64Image(dataUrl) {
  try {
    // 解析 data URL
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return { ok: false, error: 'Invalid data URL' };

    const ext = match[1] === 'jpeg' ? 'jpg' : (match[1] || 'png');
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // 写入临时文件
    const tmpDir = app.getPath('temp');
    const tmpFile = path.join(tmpDir, `memora_html_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
    fs.writeFileSync(tmpFile, buffer);

    try {
      // 上传到服务器
      const result = await uploadNoteImage(tmpFile);
      if (result.ok && result.uploaded?.length > 0) {
        const server = getAuthServer();
        const baseUrl = server.configUrl || server.authUrl;
        const serverPath = result.uploaded[0].server_path;
        const fullUrl = `${baseUrl}/memora/uploads/note-images/${serverPath}`;
        return { ok: true, server_url: fullUrl };
      }
      return { ok: false, error: result.error || 'Upload failed' };
    } finally {
      // 清理临时文件
      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 处理 htmlContent 中的 base64 图片：提取 → 上传 → 替换为服务端 URL
 * @param {string} htmlContent - 原始 HTML 内容
 * @returns {Promise<string>} 处理后的 HTML（base64 图片替换为服务端 URL）
 */
async function processHtmlContentForSync(htmlContent) {
  if (!htmlContent || !htmlContent.includes('data:image')) return htmlContent;

  // 提取所有 base64 图片
  const imgRegex = /<img([^>]*?)src=["'](data:image\/[^"']+)["']([^>]*?)>/gi;
  const matches = [];
  let m;
  while ((m = imgRegex.exec(htmlContent)) !== null) {
    matches.push({ full: m[0], pre: m[1], dataUrl: m[2], post: m[3] });
  }

  if (matches.length === 0) return htmlContent;

  console.log(`[Sync] Processing ${matches.length} base64 images in htmlContent...`);

  // 并行上传（限制并发数）
  const CONCURRENCY = 3;
  for (let i = 0; i < matches.length; i += CONCURRENCY) {
    const batch = matches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (match) => {
        const uploadResult = await uploadBase64Image(match.dataUrl);
        return { match, uploadResult };
      })
    );

    for (const { match, uploadResult } of results) {
      if (uploadResult.ok && uploadResult.server_url) {
        // 替换为服务端 URL
        const newImg = `<img${match.pre}src="${uploadResult.server_url}"${match.post}>`;
        htmlContent = htmlContent.replace(match.full, newImg);
        console.log('[Sync] ✅ Base64 image uploaded →', uploadResult.server_url.substring(0, 80) + '...');
      } else {
        // 上传失败：保留图片标签但用占位符标记（比直接删除好，至少用户知道这里原本有图）
        const newImg = `<img${match.pre}src="" data-upload-failed="true" alt="图片上传失败"${match.post}>`;
        htmlContent = htmlContent.replace(match.full, newImg);
        console.warn('[Sync] ⚠️ Base64 image upload failed:', uploadResult.error);
      }
    }
  }

  return htmlContent;
}

/**
 * 从服务端下载图片文件
 * @param {string} imageId - 图片 ID（img_xxx）
 * @param {string} savePath - 本地保存绝对路径
 * @returns {Object} { ok, size, path }
 */
async function downloadNoteImage(imageId, savePath) {
  if (!authState.isLoggedIn || !authState.token) {
    return { ok: false, error: 'Not authenticated' };
  }

  const server = getAuthServer();
  const baseUrl = server.configUrl || server.authUrl;
  const url = `${baseUrl}${SYNC_API_BASE}/notes/images/${imageId}/download`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${authState.token}` }
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    // 确保目录存在
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, buffer);
    console.log('[Sync] Image downloaded:', imageId, `(${(buffer.length / 1024).toFixed(1)}KB)`);
    return { ok: true, size: buffer.length, path: savePath };
  } catch (err) {
    console.error('[Sync] Image download error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 删除服务端图片
 * @param {string} imageId - 图片 ID
 */
async function deleteNoteImage(imageId) {
  if (!authState.isLoggedIn || !authState.token) {
    return { ok: false, error: 'Not authenticated' };
  }

  try {
    return await syncApiRequest(`/notes/images/${imageId}`, { method: 'DELETE' });
  } catch (err) {
    console.error('[Sync] Image delete error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 拉取图片元数据（增量）
 * @param {string} deviceId
 * @param {number} sinceRevision
 */
async function pullNoteImageMeta(deviceId, sinceRevision = 0) {
  return await syncApiRequest('/notes/images/sync-pull', {
    body: { device_id: deviceId, since_revision: sinceRevision }
  });
}

/**
 * 批量获取图片元数据
 * @param {string[]} imageIds
 */
async function batchGetNoteImageMeta(imageIds) {
  if (!imageIds || imageIds.length === 0) return { ok: true, images: [] };
  return await syncApiRequest('/notes/images/batch-download', {
    body: { image_ids: imageIds.slice(0, 50) }
  });
}

/**
 * 判断 image_path 是否为服务端路径（非本地路径）
 * 服务端路径格式：{userId}/{filename}，不以 images/ 开头
 * 本地路径格式：images/{filename}
 */
function isServerImagePath(imagePath) {
  return imagePath && !imagePath.startsWith('images/') && !imagePath.startsWith('/');
}

/**
 * 获取本地图片存储目录
 */
function getNotebookImagesDir() {
  return path.join(app.getPath('userData'), 'notebook', 'images');
}

/**
 * 从服务端 image_path 解析出本地应保存的文件名
 * server_path: "user_001/1718012345678_a1b2c3d4.png" → local filename
 */
function serverPathToLocalFilename(serverPath) {
  if (!serverPath) return null;
  // 用服务端路径的文件名部分，加前缀区分来源
  const parts = serverPath.split('/');
  const filename = parts[parts.length - 1];
  return `sync_${filename}`;
}

// 注册设备
ipcMain.handle('sync:register-device', async (event, data) => {
  console.log('[Sync] Register device:', data.device_id);
  if (data.device_id) syncDeviceId = data.device_id;
  return await syncApiRequest('/device/register', { body: data });
});

// 获取设备列表
ipcMain.handle('sync:get-device-list', async () => {
  return await syncApiRequest('/device/list', { method: 'GET' });
});

// 停用设备
ipcMain.handle('sync:deactivate-device', async (event, data) => {
  return await syncApiRequest('/device/deactivate', { body: data });
});

// 全量同步
ipcMain.handle('sync:full', async (event, data) => {
  console.log('[Sync] Full sync, device:', data.device_id, ', since:', data.since);
  // 保存同步 device_id（图片上传等场景需要）
  if (data.device_id) syncDeviceId = data.device_id;

  // 增量过滤辅助：根据 since 时间过滤本地变更
  // - since 为 epoch（首次同步）→ 返回全部
  // - 有 since → 只返回 updated_at > since 或 revision=0（新建未推送）的记录
  // - 没有 updated_at 的记录默认包含（避免漏传）
  const FIRST_SYNC_THRESHOLD_MS = 365 * 24 * 60 * 60 * 1000; // since 距今超过 1 年视为首次
  const sinceMs = data.since ? new Date(data.since).getTime() : 0;
  const isFirstSync = !sinceMs || (Date.now() - sinceMs > FIRST_SYNC_THRESHOLD_MS);
  function filterIncremental(items, getUpdatedAt, getRevision) {
    if (isFirstSync) return items;
    return items.filter(item => {
      const rev = getRevision ? getRevision(item) : (item.revision || 0);
      if (rev === 0) return true; // 新建未推送过的必须传
      const ua = getUpdatedAt ? getUpdatedAt(item) : (item.updated_at || item.updatedAt);
      if (!ua) return true; // 无时间戳的保险起见传
      return new Date(ua).getTime() > sinceMs;
    });
  }
  console.log('[Sync] Incremental mode:', !isFirstSync, '(since:', data.since, ')');

  // 🔧 图片上传重试：在收集笔记前，先尝试上传所有未上传的图片笔记
  // 这些图片在 saveClipboardImage 时可能上传失败（网络断开等），现在重试
  try {
    if (notebook && authState.isLoggedIn && authState.token) {
      const imagesDir = path.join(app.getPath('userData'), 'notebook', 'images');
      const pendingNotes = (Array.isArray(notebook.notes) ? notebook.notes : [])
        .filter(n => n.category === 'image' && n.imagePath && n.imagePath.startsWith('images/') && !n.serverImagePath);
      if (pendingNotes.length > 0) {
        console.log('[Sync] Retrying upload for', pendingNotes.length, 'pending image notes...');
        for (const n of pendingNotes) {
          try {
            const absPath = path.join(imagesDir, n.imagePath.replace('images/', ''));
            if (fs.existsSync(absPath)) {
              const uploadResult = await uploadNoteImage(absPath);
              if (uploadResult.ok && uploadResult.uploaded?.length > 0) {
                n.serverImagePath = uploadResult.uploaded[0].server_path;
                console.log('[Sync] ✅ Retried upload for note', n.id, '→', n.serverImagePath);
              } else {
                console.warn('[Sync] ⚠️ Retry upload failed for note', n.id, ':', uploadResult.error);
              }
            }
          } catch (e) {
            console.warn('[Sync] ⚠️ Retry upload error for note', n.id, ':', e.message);
          }
        }
        notebook.saveNotes();
      }
    }
  } catch (e) {
    console.warn('[Sync] Image retry batch failed:', e.message);
  }

  // 补充渲染进程无法直接获取的数据（notes/knowledge/tasks 从数据库补充）
  console.log('[Sync] Data source check: db exists=', !!db, 'db.data=', !!db?.data, 'tasks count=', db?.data?.tasks?.length || 0, 'changes keys=', Object.keys(data.changes || {}));

  // Tasks（独立 try-catch）
  try {
    if (data.changes && !data.changes.tasks && db && db.data && Array.isArray(db.data.tasks) && db.data.tasks.length > 0) {
      const dbTasks = db.data.tasks;
      // 增量过滤：仅上传 updated_at > since 或 revision=0 的 tasks
      const changedTasks = filterIncremental(dbTasks, t => t.updatedAt || t.createdAt, t => t.revision);
      console.log('[Sync] Tasks total:', dbTasks.length, '→ changed:', changedTasks.length);
      if (changedTasks.length > 0) {
        data.changes.tasks = changedTasks.map(t => ({
          id: t.id,
          base_revision: t.revision || 0,
          title: t.title || '',
          description: t.description || '',
          status: t.status || 'pending',
          priority: t.priority || 'medium',
          due_date: t.dueDate || null,
          estimated_duration: t.estimatedDuration || null,
          actual_duration: t.actualDuration || null,
          pomodoro_sessions: t.pomodoroSessions ? (typeof t.pomodoroSessions === 'string' ? t.pomodoroSessions : JSON.stringify(t.pomodoroSessions)) : null,
          reminders: t.reminders ? (typeof t.reminders === 'string' ? t.reminders : JSON.stringify(t.reminders)) : null,
          completed_at: t.completedAt || null,
          extra: JSON.stringify({
            category: t.category || '',
            tags: t.tags || [],
            source: t.source || '',
            rawText: t.rawText || '',
            calendarEventId: t.calendarEventId || ''
          }),
          created_at: t.createdAt || null,
          updated_at: t.updatedAt || t.createdAt || null
        }));
        console.log('[Sync] Supplemented', changedTasks.length, 'tasks from local DB');
      }
    }
  } catch (e) {
    console.warn('[Sync] Failed to collect tasks from local DB:', e.message);
  }

  // Notes（独立 try-catch，使用 notebook.notes 而非不存在的 search 方法）
  try {
    if (notebook && data.changes && !data.changes.notes) {
      const allNotes = Array.isArray(notebook.notes) ? notebook.notes : [];
      // 增量过滤
      const changedNotes = filterIncremental(allNotes, n => n.updatedAt || n.createdAt, n => n.revision);
      console.log('[Sync] Notes total:', allNotes.length, '→ changed:', changedNotes.length);
      if (changedNotes.length > 0) {
        data.changes.notes = await Promise.all(changedNotes
          .filter(n => {
            // 过滤无效图片笔记：category=image 但无 imagePath → 降级为 general 或跳过
            if (n.category === 'image' && !n.imagePath) {
              console.warn('[Sync] Skipping invalid image note (no imagePath):', n.id, n.title);
              return false;
            }
            return true;
          })
          .map(async n => {
            // 🔧 html_content 同步时：提取 base64 内嵌图片 → 上传到服务器 → 替换为服务端 URL
            // 之前直接剥离 base64 导致富文本图片丢失，现在上传后保留图片可跨设备访问
            let htmlContentForSync = n.htmlContent || '';
            if (htmlContentForSync && htmlContentForSync.includes('data:image')) {
              htmlContentForSync = await processHtmlContentForSync(htmlContentForSync);
              // 上传成功后写回本地笔记，让本地也用 URL 版本（跨设备可访问）
              if (htmlContentForSync !== n.htmlContent && notebook) {
                notebook.updateNote(n.id, { htmlContent: htmlContentForSync });
              }
            }
            // 🔧 修复：image_path 用服务端路径（用于远程访问），非本地路径
            // 本地路径 images/xxx.png 在服务端无法解析，导致图片 404
            // serverImagePath 在 saveClipboardImage 时设置（上传成功才有值）
            // 如果 serverImagePath 为空但 imagePath 是本地路径，则留空等后续上传重试
            const isLocalPath = n.imagePath && n.imagePath.startsWith('images/');
            const imagePathForSync = n.serverImagePath || (isLocalPath ? '' : (n.imagePath || ''));
            return {
              id: n.id,
              base_revision: n.revision || 0,
              title: n.title || '',
              content: n.content || '',
              html_content: htmlContentForSync,
              category: n.category || 'default',
              tags: JSON.stringify(n.tags || []),
              image_path: imagePathForSync,
              image_hash: n.imageHash || '',
              image_width: n.imageWidth || 0,
              image_height: n.imageHeight || 0,
              created_at: n.createdAt,
              updated_at: n.updatedAt || n.createdAt
            };
          })
        );
        console.log('[Sync] Supplemented', changedNotes.length, 'notes (incremental)');
      }
    }
  } catch (e) {
    console.warn('[Sync] Failed to collect notes:', e.message);
  }

  // Knowledge nodes（独立 try-catch，兼容不同 API）
  try {
    if (db && data.changes && !data.changes.knowledge_nodes) {
      let nodes = [];
      // 兼容不同的 DB API
      if (typeof db.graphGetNodes === 'function') {
        nodes = db.graphGetNodes({});
      } else if (db.data && Array.isArray(db.data.knowledge_nodes)) {
        nodes = db.data.knowledge_nodes;
      }
      // 增量过滤
      const changedNodes = filterIncremental(nodes, n => n.updated_at || n.created_at, n => n.revision);
      console.log('[Sync] Knowledge nodes total:', nodes.length, '→ changed:', changedNodes.length);
      if (changedNodes.length > 0) {
        data.changes.knowledge_nodes = changedNodes.map(n => ({
          id: n.id,
          base_revision: n.revision || 0,
          name: n.name,
          type: n.type,
          domain: n.domain,
          health: n.health,
          extra: typeof n.extra === 'string' ? n.extra : JSON.stringify(n.extra || {}),
          created_at: n.created_at,
          updated_at: n.updated_at
        }));
        console.log('[Sync] Supplemented', changedNodes.length, 'knowledge_nodes (incremental)');
      }
    }
  } catch (e) {
    console.warn('[Sync] Failed to collect knowledge_nodes:', e.message);
  }

  // Knowledge edges（独立 try-catch，兼容不同 API）
  try {
    if (db && data.changes && !data.changes.knowledge_edges) {
      let edges = [];
      if (typeof db.graphGetEdges === 'function') {
        edges = db.graphGetEdges({});
      } else if (db.data && Array.isArray(db.data.knowledge_edges)) {
        edges = db.data.knowledge_edges;
      }
      // 增量过滤
      const changedEdges = filterIncremental(edges, e => e.updated_at || e.created_at, e => e.revision);
      console.log('[Sync] Knowledge edges total:', edges.length, '→ changed:', changedEdges.length);
      if (changedEdges.length > 0) {
        data.changes.knowledge_edges = changedEdges.map(e => ({
          id: e.id,
          base_revision: e.revision || 0,
          source_id: e.source_id,
          target_id: e.target_id,
          type: e.type,
          created_at: e.created_at,
          updated_at: e.updated_at
        }));
        console.log('[Sync] Supplemented', changedEdges.length, 'knowledge_edges (incremental)');
      }
    }
  } catch (e) {
    console.warn('[Sync] Failed to collect knowledge_edges:', e.message);
  }

  // Clipboard memories（独立 try-catch，兼容不同 API）
  try {
    if (memoryStore && data.changes && !data.changes.clipboard_memories) {
      let memories = [];
      if (typeof memoryStore.search === 'function') {
        memories = memoryStore.search({ type: 'instant', limit: 1000 });
      } else if (Array.isArray(memoryStore.memories)) {
        memories = memoryStore.memories;
      } else if (memoryStore.data && Array.isArray(memoryStore.data.memories)) {
        memories = memoryStore.data.memories;
      }
      // 增量过滤（剪贴板用 created_at 时间戳）
      const changedMemories = filterIncremental(memories, m => m.updated_at || m.created_at, m => m.revision);
      console.log('[Sync] Clipboard memories total:', memories.length, '→ changed:', changedMemories.length);
      if (changedMemories.length > 0) {
        data.changes.clipboard_memories = changedMemories.map(m => ({
          id: m.id,
          base_revision: m.revision || 0,
          content: m.content,
          memory_type: m.type,
          business_category: m.business_category,
          confidence: m.confidence,
          source: m.source || 'clipboard',
          created_at: m.created_at
        }));
        console.log('[Sync] Supplemented', changedMemories.length, 'clipboard_memories (incremental)');
      }
    }
  } catch (e) {
    console.warn('[Sync] Failed to collect clipboard_memories:', e.message);
  }

  const changesSummary = Object.entries(data.changes || {}).map(([k, v]) => `${k}:${v?.length || 0}`).join(', ');
  console.log('[Sync] Sending full sync request, changes:', changesSummary || 'empty');

  // ===== 图片上传：扫描所有未上传的本地图片笔记 =====
  // 不仅仅是 changes 中的笔记，还要扫描 notebook 中所有 imagePath 仍为本地路径的笔记
  // 因为图片上传可能之前失败了（如服务端 note_images 表不存在时），需要重试
  if (notebook) {
    const allNotes = Array.isArray(notebook.notes) ? notebook.notes : [];
    const imageNotesToUpload = allNotes.filter(n =>
      (n.category === 'image' || n.imagePath) &&
      n.imagePath &&
      !isServerImagePath(n.imagePath)
    );

    if (imageNotesToUpload.length > 0) {
      console.log('[Sync] Found', imageNotesToUpload.length, 'notes with local images to upload...');
      console.log('[Sync] Image notes:', imageNotesToUpload.map(n => ({ id: n.id, path: n.imagePath, size: n.imageWidth + 'x' + n.imageHeight })));

      for (const note of imageNotesToUpload) {
        try {
          const localAbsPath = path.join(app.getPath('userData'), 'notebook', note.imagePath);
          if (!fs.existsSync(localAbsPath)) {
            console.warn('[Sync] Image file not found locally, skip upload:', note.imagePath, '→ expected at:', localAbsPath);
            // 本地文件丢失时，仍然推送笔记元数据（不含图片，但笔记本身是有价值的）
            continue;
          }

          const fileStat = fs.statSync(localAbsPath);
          console.log('[Sync] Uploading image for note', note.id, '| file:', note.imagePath, '| size:', (fileStat.size / 1024).toFixed(1), 'KB');

          const uploadResult = await uploadNoteImage(localAbsPath);
          if (uploadResult.ok && uploadResult.uploaded?.length > 0) {
            const imgInfo = uploadResult.uploaded[0];
            // 注意：不更新本地笔记的 imagePath！本地笔记始终用本地路径（images/xxx.png）
            // 仅更新宽高等元数据
            notebook.updateNote(note.id, {
              imageHash: imgInfo.image_hash || note.imageHash,
              imageWidth: imgInfo.width || note.imageWidth,
              imageHeight: imgInfo.height || note.imageHeight,
            });
            console.log('[Sync] ✅ Image uploaded for note', note.id, '→', imgInfo.server_path, '(local note keeps local path)');

            // 同时确保这条笔记的变更被推送到服务端（更新 image_path 字段）
            if (data.changes.notes) {
              const existingIdx = data.changes.notes.findIndex(n => n.id === note.id);
              if (existingIdx >= 0) {
                data.changes.notes[existingIdx].image_path = imgInfo.server_path;
                data.changes.notes[existingIdx].image_hash = imgInfo.image_hash || '';
                data.changes.notes[existingIdx].image_width = imgInfo.width || 0;
                data.changes.notes[existingIdx].image_height = imgInfo.height || 0;
              }
            } else {
              // 没有在 changes 中：强制添加这条笔记的变更
              if (!data.changes.notes) data.changes.notes = [];
              // 🔧 提取 base64 内嵌图片 → 上传到服务器 → 替换为服务端 URL
              let pushHtmlContent = note.htmlContent || '';
              if (pushHtmlContent && pushHtmlContent.includes('data:image')) {
                pushHtmlContent = await processHtmlContentForSync(pushHtmlContent);
              }
              data.changes.notes.push({
                id: note.id,
                base_revision: note.revision || 0,
                title: note.title || '',
                content: note.content || '',
                html_content: pushHtmlContent,
                category: note.category || 'default',
                tags: JSON.stringify(note.tags || []),
                image_path: imgInfo.server_path,
                image_hash: imgInfo.image_hash || '',
                image_width: imgInfo.width || 0,
                image_height: imgInfo.height || 0,
                created_at: note.createdAt,
                updated_at: new Date().toISOString()
              });
            }
          } else {
            console.warn('[Sync] ⚠️ Image upload failed for note', note.id, ':', uploadResult.error);
            // 图片上传失败时：仍然推送笔记元数据（带本地 image_path），下次 fullSync 会重试上传并更新
          }
        } catch (e) {
          console.warn('[Sync] ⚠️ Image upload error for note', note.id, ':', e.message);
          // 异常时也推送笔记元数据
        }
      }
    }
  }

  // 如果设备未注册，先自动注册
  if (data.device_id) {
    try {
      const regResult = await syncApiRequest('/device/register', {
        body: {
          device_id: data.device_id,
          platform: data.platform || 'electron',
          device_name: `PC (${process.platform})`,
          app_version: APP_VERSION
        }
      });
      if (regResult && (regResult.registered || regResult.ok)) {
        console.log('[Sync] Auto-registered device:', data.device_id);
      }
    } catch (e) {
      console.warn('[Sync] Auto-register device failed (may already exist):', e.message);
    }
  }

  let result = await syncApiRequest('/full', { body: data });

  // 如果因设备未注册失败，注册后重试
  if (result && result.error && (result.error.includes('设备未注册') || result.error.includes('not registered') || result.status === 403)) {
    console.log('[Sync] Device not registered, registering and retrying...');
    try {
      await syncApiRequest('/device/register', {
        body: {
          device_id: data.device_id,
          platform: data.platform || 'electron',
          device_name: `PC (${process.platform})`,
          app_version: APP_VERSION
        }
      });
      result = await syncApiRequest('/full', { body: data });
    } catch (e) {
      console.warn('[Sync] Retry after register failed:', e.message);
    }
  }

  // 适配服务端响应格式：result.pull.results.notes.records 而非 result.pulled.notes
  const pulledResults = result?.pull?.results || result?.pulled || {};

  // 同步成功后，将 pull 下来的 notes/knowledge 写入本地
  if (result && result.ok && pulledResults) {
    try {
      // Notes
      const pulledNotes = pulledResults.notes?.records || pulledResults.notes || [];
      if (pulledNotes.length > 0 && notebook) {
        // ===== 图片下载：收集需要下载的服务端图片 =====
        const imageNotesToDownload = pulledNotes.filter(n =>
          n.image_path && isServerImagePath(n.image_path)
        );

        if (imageNotesToDownload.length > 0) {
          console.log('[Sync] Downloading', imageNotesToDownload.length, 'remote images...');
          const imagesDir = getNotebookImagesDir();

          // 先批量获取图片元数据，拿到 imageId → download_url 映射
          // 从 image_path 无法直接得到 imageId，需要通过 sync-pull 或 batch-download
          // 更简单的方案：直接用 image_path 中的文件名在服务端查找
          // 但最可靠的是通过 note_images 表的 sync-pull 获取元数据

          // 方案：逐个通过 image_path 构造下载 URL
          // 服务端 image_path 格式: {userId}/{filename}
          // 可以通过 GET /notes/images?note_id=xxx 获取图片 ID

          for (const note of imageNotesToDownload) {
            try {
              // 检查本地是否已有该图片（通过 hash 判断）
              const localFilename = serverPathToLocalFilename(note.image_path);
              const localAbsPath = path.join(imagesDir, localFilename);

              if (fs.existsSync(localAbsPath)) {
                // 本地已有，跳过下载
                // 更新笔记的 imagePath 指向本地路径
                note.image_path = `images/${localFilename}`;
                continue;
              }

              // 需要通过服务端 API 获取图片 ID 才能下载
              // 方案1: 通过图片列表 API 按 note_id 查找
              const imgListResult = await syncApiRequest(`/notes/images?note_id=${note.id}&limit=1`, { method: 'GET' });

              if (imgListResult.ok && imgListResult.images?.length > 0) {
                const imgMeta = imgListResult.images[0];
                const downloadResult = await downloadNoteImage(imgMeta.id, localAbsPath);

                if (downloadResult.ok) {
                  // 下载成功，将笔记的 image_path 更新为本地路径
                  note.image_path = `images/${localFilename}`;
                  console.log('[Sync] Image downloaded for note', note.id);
                } else {
                  console.warn('[Sync] Image download failed for note', note.id, ':', downloadResult.error);
                }
              } else {
                console.warn('[Sync] No image metadata found for note', note.id);
              }
            } catch (e) {
              console.warn('[Sync] Image download error for note', note.id, ':', e.message);
            }
          }
        }

        // 写入笔记到本地
        for (const note of pulledNotes) {
          if (note.origin_device_id === data.device_id) continue;  // 防回声
          if (note.deleted_at) continue;  // 已删除
          try {
            const existing = notebook.getNoteById(note.id);
            if (!existing) {
              // 解析 imagePath：如果服务端路径已下载到本地缓存，用本地路径
              let addImagePath = note.image_path || '';
              if (addImagePath && isServerImagePath(addImagePath)) {
                const localFilename = serverPathToLocalFilename(addImagePath);
                const localCachePath = path.join(app.getPath('userData'), 'notebook', 'images', localFilename);
                if (fs.existsSync(localCachePath)) {
                  addImagePath = `images/${localFilename}`;
                }
              }
              notebook.addNote({
                id: note.id,
                title: note.title,
                content: note.content,
                htmlContent: note.html_content || '',
                category: note.category,
                tags: typeof note.tags === 'string' ? JSON.parse(note.tags) : (note.tags || []),
                imagePath: addImagePath,
                imageHash: note.image_hash || '',
                imageWidth: note.image_width || 0,
                imageHeight: note.image_height || 0,
                revision: note.revision,
                createdAt: note.created_at,
                updatedAt: note.updated_at
              });
            } else if ((note.revision || 0) > (existing.revision || 0)) {
              // imagePath 优先级：1.本地已有且文件存在的本地路径 2.已下载到本地的服务端路径 3.服务端路径
              let resolvedImagePath = note.image_path || existing.imagePath || '';
              if (existing.imagePath && !isServerImagePath(existing.imagePath)) {
                // 本地已有有效的本地路径，保留它（确保本地显示正常）
                const existingLocalAbs = path.join(app.getPath('userData'), 'notebook', existing.imagePath);
                if (fs.existsSync(existingLocalAbs)) {
                  resolvedImagePath = existing.imagePath;
                }
              } else if (note.image_path && isServerImagePath(note.image_path)) {
                // 服务端路径 → 检查是否已下载到本地缓存
                const localFilename = serverPathToLocalFilename(note.image_path);
                const localCachePath = path.join(app.getPath('userData'), 'notebook', 'images', localFilename);
                if (fs.existsSync(localCachePath)) {
                  resolvedImagePath = `images/${localFilename}`;
                }
              }
              // htmlContent 策略：本地 base64 版本优先保留（file:// 页面无法可靠加载 http:// 图片）
              // 仅在本地没有 htmlContent 时才用服务端版本
              const serverHtml = note.html_content || '';
              const localHtml = existing.htmlContent || '';
              const resolvedHtmlContent = localHtml || serverHtml;
              notebook.updateNote(note.id, {
                title: note.title,
                content: note.content,
                htmlContent: resolvedHtmlContent,
                category: note.category,
                tags: typeof note.tags === 'string' ? JSON.parse(note.tags) : (note.tags || []),
                imagePath: resolvedImagePath,
                imageHash: note.image_hash || existing.imageHash || '',
                imageWidth: note.image_width || existing.imageWidth || 0,
                imageHeight: note.image_height || existing.imageHeight || 0,
                revision: note.revision,
                updatedAt: note.updated_at
              });
            }
          } catch (e) {
            console.warn('[Sync] Failed to apply note:', note.id, e.message);
          }
        }
      }

      // Knowledge nodes
      const pulledNodes = pulledResults.knowledge_nodes?.records || pulledResults.nodes || pulledResults.knowledge_nodes || [];
      if (pulledNodes.length > 0 && db) {
        for (const node of pulledNodes) {
          if (node.origin_device_id === data.device_id) continue;
          if (node.deleted_at) continue;
          try {
            db.upsertKnowledgeNode(node);
          } catch (e) {
            console.warn('[Sync] Failed to apply knowledge node:', node.id, e.message);
          }
        }
      }
    } catch (e) {
      console.warn('[Sync] Failed to apply pulled data:', e.message);
    }
  }

  return result;
});

// 推送（含图片上传：先尝试上传本地图片，成功则更新 image_path；失败也推送元数据，等 fullSync 重试）
ipcMain.handle('sync:push', async (event, data) => {
  // 保存同步 device_id
  if (data.device_id) syncDeviceId = data.device_id;

  // ===== 图片上传：扫描 changes.notes 中的图片笔记，上传本地图片 =====
  if (data.changes?.notes?.length > 0 && notebook) {
    const imageNotes = data.changes.notes.filter(n =>
      (n.category === 'image' || n.image_path) && n.image_path && !isServerImagePath(n.image_path)
    );

    if (imageNotes.length > 0) {
      console.log('[Sync:push] Found', imageNotes.length, 'notes with local images to upload before push...');

      for (const note of imageNotes) {
        try {
          // image_path 是本地相对路径如 images/xxx.png → 拼接绝对路径
          const localAbsPath = path.join(app.getPath('userData'), 'notebook', note.image_path);
          if (!fs.existsSync(localAbsPath)) {
            console.warn('[Sync:push] Local image file missing, still pushing note metadata:', note.id, note.image_path);
            continue;
          }

          console.log('[Sync:push] Uploading image for note', note.id, '|', note.image_path);
          const uploadResult = await uploadNoteImage(localAbsPath);

          if (uploadResult.ok && uploadResult.uploaded?.length > 0) {
            const imgInfo = uploadResult.uploaded[0];
            // 更新 changes 中的 image_path 为服务端路径（推送到服务端用）
            note.image_path = imgInfo.server_path;
            note.image_hash = imgInfo.image_hash || note.image_hash || '';
            note.image_width = imgInfo.width || note.image_width || 0;
            note.image_height = imgInfo.height || note.image_height || 0;
            // 更新本地笔记的 serverImagePath（用于后续 fullSync 推送）
            notebook.updateNote(note.id, {
              serverImagePath: imgInfo.server_path,
              imageHash: imgInfo.image_hash || note.image_hash,
              imageWidth: imgInfo.width || note.image_width,
              imageHeight: imgInfo.height || note.image_height,
            });
            console.log('[Sync:push] ✅ Image uploaded →', imgInfo.server_path, '(local note keeps local path, serverImagePath saved)');
          } else {
            // 🔧 修复：上传失败时，将 image_path 设为空字符串，不让本地格式路径推送到服务器
            // 服务器端用本地路径无法加载图片，空路径好过错误路径
            note.image_path = '';
            console.warn('[Sync:push] ⚠️ Image upload failed, clearing image_path to avoid server 404. Will retry on fullSync:', note.id, uploadResult.error);
          }
        } catch (e) {
          // 异常：同样清空 image_path
          note.image_path = '';
          console.warn('[Sync:push] ⚠️ Image upload error, clearing image_path:', note.id, e.message);
        }
      }
    }
  }

  return await syncApiRequest('/push', { body: data });
});

// 拉取
ipcMain.handle('sync:pull', async (event, data) => {
  return await syncApiRequest('/pull', { body: data });
});

// 解决冲突
ipcMain.handle('sync:resolve', async (event, data) => {
  return await syncApiRequest('/resolve', { body: data });
});

// 获取同步状态
ipcMain.handle('sync:get-status', async () => {
  return await syncApiRequest('/status', { method: 'GET' });
});

// ===== 图片同步专属 API =====

// 上传图片文件
ipcMain.handle('sync:upload-note-image', async (event, localPath) => {
  return await uploadNoteImage(localPath);
});

// 下载图片文件
ipcMain.handle('sync:download-note-image', async (event, imageId, savePath) => {
  return await downloadNoteImage(imageId, savePath);
});

// 删除服务端图片
ipcMain.handle('sync:delete-note-image', async (event, imageId) => {
  return await deleteNoteImage(imageId);
});

// 拉取图片元数据
ipcMain.handle('sync:pull-note-images', async (event, deviceId, sinceRevision) => {
  return await pullNoteImageMeta(deviceId, sinceRevision || 0);
});

// 批量获取图片元数据
ipcMain.handle('sync:batch-note-image-meta', async (event, imageIds) => {
  return await batchGetNoteImageMeta(imageIds);
});

// 获取图片列表
ipcMain.handle('sync:list-note-images', async (event, options = {}) => {
  const params = new URLSearchParams();
  if (options.page) params.set('page', options.page);
  if (options.limit) params.set('limit', options.limit);
  if (options.note_id) params.set('note_id', options.note_id);
  const qs = params.toString();
  return await syncApiRequest(`/notes/images${qs ? '?' + qs : ''}`, { method: 'GET' });
});

// 绑定图片到笔记
ipcMain.handle('sync:bind-note-image', async (event, imageId, noteId) => {
  return await syncApiRequest(`/notes/images/${imageId}/bind`, {
    method: 'PUT',
    body: { note_id: noteId }
  });
});

// ===== 助手会话专属 API =====

// GET /memora/sync/conversations — 会话列表
ipcMain.handle('sync:conversations', async (event, options = {}) => {
  const params = new URLSearchParams();
  if (options.page) params.set('page', options.page);
  if (options.limit) params.set('limit', options.limit);
  if (options.search) params.set('search', options.search);
  const qs = params.toString();
  return await syncApiRequest(`/conversations${qs ? '?' + qs : ''}`, { method: 'GET' });
});

// GET /memora/sync/conversations/:id — 会话详情
ipcMain.handle('sync:conversation-detail', async (event, convId) => {
  if (!convId) return { ok: false, error: 'convId required' };
  return await syncApiRequest(`/conversations/${encodeURIComponent(convId)}`, { method: 'GET' });
});

// GET /memora/sync/conversations/:id/messages — 消息列表
ipcMain.handle('sync:conversation-messages', async (event, convId, options = {}) => {
  if (!convId) return { ok: false, error: 'convId required' };
  const params = new URLSearchParams();
  if (options.page) params.set('page', options.page);
  if (options.limit) params.set('limit', options.limit);
  const qs = params.toString();
  return await syncApiRequest(`/conversations/${encodeURIComponent(convId)}/messages${qs ? '?' + qs : ''}`, { method: 'GET' });
});

// POST /memora/sync/conversations/:id/messages — 追加消息
ipcMain.handle('sync:conversation-append-message', async (event, convId, message) => {
  if (!convId || !message) return { ok: false, error: 'convId and message required' };
  const deviceId = getDeviceFingerprint();
  return await syncApiRequest(`/conversations/${encodeURIComponent(convId)}/messages`, {
    method: 'POST',
    body: {
      device_id: deviceId,
      ...message
    }
  });
});

// PUT /memora/sync/conversations/:id — 更新会话元数据
ipcMain.handle('sync:conversation-update', async (event, convId, updates) => {
  if (!convId) return { ok: false, error: 'convId required' };
  const deviceId = getDeviceFingerprint();
  return await syncApiRequest(`/conversations/${encodeURIComponent(convId)}`, {
    method: 'PUT',
    body: {
      device_id: deviceId,
      ...updates
    }
  });
});

// DELETE /memora/sync/conversations/:id — 删除会话
ipcMain.handle('sync:conversation-delete', async (event, convId) => {
  if (!convId) return { ok: false, error: 'convId required' };
  const deviceId = getDeviceFingerprint();
  return await syncApiRequest(`/conversations/${encodeURIComponent(convId)}?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'DELETE'
  });
});

// ===== 版本更新 =====

// 检查更新（公开接口，无需登录）
async function checkForUpdate() {
  const server = getAuthServer();
  const baseUrl = server.configUrl || server.authUrl;
  try {
    const url = `${baseUrl}/memora/updates/check?version=${APP_VERSION}&platform=${process.platform}&arch=${process.arch}`;
    const res = await fetch(url);
    if (res.ok) {
      return await res.json();
    }
    return { has_update: false };
  } catch (err) {
    console.error('[Updates] Check error:', err.message);
    return { has_update: false, error: err.message };
  }
}

// 通知轮询定时器
let notificationPollTimer = null;
let notificationSSEController = null; // SSE AbortController

function startNotificationPolling(intervalMs = 60 * 1000) {
  stopNotificationPolling();
  // 立即拉取一次
  fetchAndNotifyNotifications();
  notificationPollTimer = setInterval(fetchAndNotifyNotifications, intervalMs);
  console.log('[Notifications] Polling started, interval:', intervalMs / 1000, 's');
  // 同时启动 SSE 实时订阅
  startNotificationSSE();
}

function stopNotificationPolling() {
  if (notificationPollTimer) {
    clearInterval(notificationPollTimer);
    notificationPollTimer = null;
  }
  stopNotificationSSE();
}

// SSE 实时通知订阅
function startNotificationSSE() {
  stopNotificationSSE();
  if (!authState.isLoggedIn || !authState.token) return;
  const server = getAuthServer();
  const baseUrl = server.configUrl || server.authUrl;
  const sseUrl = `${baseUrl}/memora/notifications/stream`;

  const controller = new AbortController();
  notificationSSEController = controller;

  console.log('[Notifications SSE] Connecting to', sseUrl);

  fetch(sseUrl, {
    headers: { 'Authorization': `Bearer ${authState.token}` },
    signal: controller.signal
  }).then(response => {
    if (!response.ok) {
      console.warn('[Notifications SSE] Connection failed:', response.status);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) {
          console.log('[Notifications SSE] Stream ended, reconnecting in 5s...');
          setTimeout(startNotificationSSE, 5000);
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留不完整的行

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.substring(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData = line.substring(6);
          } else if (line === '' && currentEvent && currentData) {
            // 空行表示事件结束
            if (currentEvent === 'notification') {
              try {
                const notif = JSON.parse(currentData);
                console.log('[Notifications SSE] Received:', notif.title);
                // 立即拉取完整通知列表刷新 UI
                fetchAndNotifyNotifications();
                // 系统通知
                if (mainWindow && !mainWindow.isDestroyed()) {
                  showNotification('忆境 Memora', notif.title + (notif.content ? ': ' + notif.content : ''));
                }
              } catch (e) {
                console.error('[Notifications SSE] Parse error:', e.message);
              }
            } else if (currentEvent === 'connected') {
              console.log('[Notifications SSE] Connected successfully');
            }
            currentEvent = '';
            currentData = '';
          } else if (line.startsWith(': ')) {
            // 心跳注释，忽略
          }
        }
        read();
      }).catch(err => {
        if (err.name !== 'AbortError') {
          console.error('[Notifications SSE] Read error:', err.message);
          setTimeout(startNotificationSSE, 5000);
        }
      });
    }
    read();
  }).catch(err => {
    if (err.name !== 'AbortError') {
      console.warn('[Notifications SSE] Connection error:', err.message);
      // SSE 连接失败不影响轮询，5秒后重试
      setTimeout(startNotificationSSE, 5000);
    }
  });
}

function stopNotificationSSE() {
  if (notificationSSEController) {
    notificationSSEController.abort();
    notificationSSEController = null;
  }
}

async function fetchAndNotifyNotifications() {
  if (!authState.isLoggedIn || !authState.token) return;
  const serverNotifs = await fetchServerNotifications();
  const unread = serverNotifs.filter(n => !n.read);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notifications:updated', { notifications: serverNotifs, unreadCount: unread.length });
  }
}

ipcMain.handle('updates:check', async () => {
  return await checkForUpdate();
});

// 手动同步配置
ipcMain.handle('config:sync', async () => {
  if (!authState.isLoggedIn) return { success: false, error: '未登录' };
  await fetchRemoteConfig();
  // 通知渲染进程配置已更新
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('config:updated', {
      api: remoteConfig?.api || null,
      adp: remoteConfig?.adp || null,
      forceLocalConfig: authState.forceLocalConfig
    });
  }
  return { success: true };
});

// ADP消息发送（流式SSE推送，参考 knowledge:search-adp 架构）
let activeChatADPController = null;
let currentADPConversationId = null; // 持久化会话ID，同一对话内复用

// v3.1 多任务并发：per-task AbortController 映射
const taskControllers = new Map(); // taskId → AbortController

// 修复 ADP URL：config-server 可能只返回域名无路径，自动补全 ADP V2 端点
function normalizeADPUrl(url) {
  if (!url) return 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  if (!url.includes('/adp/v2/chat') && !url.includes('/v1/qbot/chat')) {
    return url.replace(/\/+$/, '') + '/adp/v2/chat';
  }
  return url;
}

function generateConversationId() {
  return Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
}

// 新建对话：重置会话ID
ipcMain.handle('adp:new-chat', async () => {
  currentADPConversationId = null;
  console.log('[ADP Chat] New conversation started, convId reset');
  return { success: true };
});

// 设置特定会话的 ConversationId（用于切换对话时恢复上下文）
ipcMain.handle('adp:set-conversation-id', async (event, convId) => {
  if (convId && typeof convId === 'string') {
    currentADPConversationId = convId;
    console.log('[ADP Chat] ConversationId restored to:', convId);
  } else {
    currentADPConversationId = null;
    console.log('[ADP Chat] ConversationId cleared');
  }
  return { success: true };
});

ipcMain.handle('send-adp-message', async (event, data) => {
  // 支持两种调用方式：
  // 1. 旧方式：data 是纯文本字符串
  // 2. 新方式：data = { message, attachments } — 附件信息结构化传递给 ADP V2 Contents 数组
  // 3. v2.6 专家模式：data = { message, appKey, adpUrl, _expertMode } — 专家级配置覆盖
  // 4. v2.7 本地上下文注入：data = { message, ..., systemRole } — 意图分类后的本地上下文
  let message, attachments, expertAppKey, expertAdpUrl, localSystemRole;
  let _skillHint = '', _modelHint = '', _providerHint = '';
  if (typeof data === 'string') {
    message = data;
    attachments = [];
  } else {
    message = data.message || '';
    attachments = data.attachments || [];
    expertAppKey = data.appKey || '';   // v2.6: 专家级 AppKey
    expertAdpUrl = data.adpUrl || '';   // v2.6: 专家级 URL
    localSystemRole = data.systemRole || '';  // v2.7: 本地上下文注入
    _skillHint = data.skillHint || '';    // 🔧 用户选择的 Skill
    _modelHint = data.modelHint || '';    // 🔧 用户选择的模型
    _providerHint = data.providerHint || '';  // 🔧 用户选择的供应商
  }

  // v2.6: 专家模式优先使用专家配置的 appKey/url
  let appKey, url, configSource = 'default';
  if (expertAppKey) {
    // 专家模式：使用专家配置的 appKey
    appKey = expertAppKey;
    url = expertAdpUrl ? normalizeADPUrl(expertAdpUrl) : 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
    configSource = 'expert';
  } else if (authState.isLoggedIn && remoteConfig?.adp && !authState.forceLocalConfig) {
    // v2.0: 登录状态优先使用服务器配置（除非用户强制使用本地配置）
    appKey = remoteConfig.adp.app_key;
    url = remoteConfig.adp.url || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
    configSource = appKey ? 'cloud' : 'default';
  } else {
    appKey = getSetting('adp_app_key');
    url = getSetting('adp_url') || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
    configSource = appKey ? 'local' : 'default';
  }
  
  // AppKey 回退
  if (!appKey || appKey.trim() === '') {
    appKey = DEFAULT_ADP_APP_KEY;
    configSource = 'default';
  }
  
  // 修复：config-server 可能只返回域名无路径，自动补全 ADP V2 端点路径
  url = normalizeADPUrl(url);
  
  console.log('[ADP Chat] send-adp-message called, configSource:', configSource, 'url:', url, 'appKey:', appKey?.substring(0, 8) + '...', 'attachments:', attachments.length);
  
  // 记录当前使用的 appKey 用于审计（脱敏）
  const _adpChatAppKey = appKey;
  const _adpChatModel = `adp_v2${configSource !== 'default' ? `(${configSource})` : ''}${_skillHint ? `+skill:${_skillHint}` : ''}${_modelHint ? `+model:${_modelHint}` : ''}`;
  
  // v3.1 多任务并发支持：提取 taskId，创建事件路由辅助函数
  const _taskId = data?.taskId || null;
  const _sendEvent = (payload) => {
    if (_taskId) {
      mainWindow?.webContents?.send('task:stream', { taskId: _taskId, ...payload });
    } else {
      mainWindow?.webContents?.send('adp:sse-event', payload);
    }
  };
  const _clearCtrl = () => {
    if (_taskId) { taskControllers.delete(_taskId); }
    else { activeChatADPController = null; }
  };
  
  // 复用同一会话的 ConversationId，保持上下文连续性
  // 🔧 关键修复：当同一对话中上次文件上传失败（ADP 误解为图片/没收到文档），
  // 用户再次发文件时，需要创建新对话避免旧上下文污染。
  // 策略：仅在有文件附件且当前对话已有消息时新建对话（首次发文件不强制新建）
  // 这样用户第一次发文件能正常工作，如果失败后重新发会自动切换到新对话
  const hasFileAttachment = attachments.some(a => {
    const e = (a.name.split('.').pop() || '').toLowerCase();
    return !['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'heic', 'heif'].includes(e);
  });
  // 注意：不在这里强制新建对话，因为同一对话中发多轮文件可能是有意的。
  // 用户可以通过前端"新对话"按钮手动重置。

  if (!currentADPConversationId) {
    currentADPConversationId = generateConversationId();
    console.log('[ADP Chat] New conversationId generated:', currentADPConversationId);
  } else {
    console.log('[ADP Chat] Reusing conversationId:', currentADPConversationId);
  }
  const convId = currentADPConversationId;
  const requestId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

  // 构建 Contents 数组（ADP V2 格式）
  const contents = [];

  // 文件上传配置：ADP COS 上传（官方规范）或 File Share 上传（降级方案）
  // 优先使用云端配置，回退到本地配置
  const tcSecretId = remoteConfig?.tencent_cloud?.secret_id || getSetting('adp_tc_secret_id') || '';
  const tcSecretKey = remoteConfig?.tencent_cloud?.secret_key || getSetting('adp_tc_secret_key') || '';
  const botBizId = remoteConfig?.tencent_cloud?.bot_biz_id || getSetting('adp_bot_biz_id') || '';
  const hasADPCOSCreds = !!(tcSecretId && tcSecretKey && botBizId);

  // 🔧 文档上传/解析进度回传：解析发生在本 IPC handler 内部（在返回 streaming 之前），
  // 前端在调用 sendADPMessage 之前已注册 adp:upload-progress 监听，可实时显示"正在解析文档"。
  const sendUploadProgress = (payload) => {
    try { mainWindow?.webContents?.send('adp:upload-progress', payload); } catch (_) { /* ignore */ }
  };
  // 需要走 COS 上传 + docParse 的文档（排除图片与可直接注入的纯文本）
  const IMG_EXTS_FOR_COUNT = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'heic', 'heif'];
  const TEXT_EXTS_FOR_COUNT = ['txt', 'md', 'markdown', 'csv', 'log', 'json', 'yaml', 'yml'];
  const docAttachments = attachments.filter(a => {
    const e = (a.name.split('.').pop() || '').toLowerCase();
    const isInlineText = TEXT_EXTS_FOR_COUNT.includes(e) && a.textContent && a.textContent.trim();
    return !IMG_EXTS_FOR_COUNT.includes(e) && !isInlineText;
  });
  let _docProcessed = 0;

  if (attachments.length > 0) {
    console.log('[ADP Chat] Processing', attachments.length, 'attachments, ADP COS upload:', hasADPCOSCreds ? 'available' : 'unavailable (no TC credentials)');
    if (docAttachments.length > 0) {
      sendUploadProgress({ phase: 'start', total: docAttachments.length, message: `准备处理 ${docAttachments.length} 个文档…` });
    }
  }

  // 1. 处理所有附件
  for (const att of attachments) {
    // 调试日志：追踪 IPC 传输后 buffer 的实际类型和长度
    console.log('[ADP Chat] Attachment:', att.name, 'type:', att.type, 'size:', att.size,
      'buffer type:', typeof att.buffer, Array.isArray(att.buffer) ? `Array[${att.buffer.length}]` :
        att.buffer instanceof ArrayBuffer ? `ArrayBuffer[${att.buffer.byteLength}]` :
        att.buffer ? `other(${Object.keys(att.buffer).length} keys)` : 'null/undefined',
      'has textContent:', !!att.textContent, 'has base64:', !!att.base64);

    const ext = att.name.split('.').pop().toLowerCase();
    // 🔧 修复：图片公网直传（is_public=true）只支持 jpg/jpeg/png/bmp（与官方 SDK 一致）
    // gif/webp/heic 等会被 DescribeStorageCredential 当作私有文件上传到 /private/ 路径，
    // 用 Type:'image' 发送会因 ADP 无法访问私有 URL 而失败 → 这些格式按普通文件处理
    const IMAGE_PUBLIC_EXTS = ['png', 'jpg', 'jpeg', 'bmp'];
    const isImage = (att.type === 'image' && IMAGE_PUBLIC_EXTS.includes(ext)) || IMAGE_PUBLIC_EXTS.includes(ext);
    const fileTypeMap = {
      pdf: 'pdf', doc: 'doc', docx: 'docx', ppt: 'ppt', pptx: 'pptx',
      xls: 'xls', xlsx: 'xlsx', txt: 'txt', md: 'md', csv: 'csv',
      png: 'png', jpg: 'jpg', jpeg: 'jpeg', gif: 'gif', bmp: 'bmp', webp: 'webp', heic: 'heic', heif: 'heif',
    };
    const adpFileType = fileTypeMap[ext] || ext;

    // ===== 方案 0：纯文本文件直接注入文本内容（最稳妥，绕过 COS 上传）=====
    // 对于 txt/md/csv 等纯文本，claw 模式下直接把内容拼进对话，
    // 完全规避 COS 上传 + docParse 的权限问题（AccessDenied）。
    // 仅当文本不太长时使用（避免超出输入长度），否则走 COS 上传走文档解析。
    const TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'log', 'json', 'yaml', 'yml'];
    const isPlainText = (att.type === 'text' || TEXT_EXTS.includes(ext)) && !isImage;
    if (isPlainText && att.textContent && att.textContent.trim()) {
      const textContent = att.textContent;
      // ADP 输入长度有限，纯文本 ≤ 50000 字符直接注入（约等于 docParse 的处理范围内）
      if (textContent.length <= 50000) {
        contents.push({
          Type: 'text',
          Text: `【附件文件：${att.name}】\n\`\`\`\n${textContent}\n\`\`\``
        });
        console.log('[ADP Chat] ✅ 纯文本文件直接注入内容（绕过 COS）:', att.name, '长度:', textContent.length);
        continue; // 文本已注入，无需 COS 上传
      }
      console.log('[ADP Chat] 文本文件过长，转走 COS 上传:', att.name, '长度:', textContent.length);
    }

    // ===== 方案 A：ADP COS 上传（官方规范流程）=====
    if (hasADPCOSCreds && att.buffer) {
      try {
        let fileBuffer;
        // 优先处理普通数组（渲染进程通过 IPC 传来的 buffer 现在是 Array 而非 ArrayBuffer）
        if (Array.isArray(att.buffer)) {
          fileBuffer = Buffer.from(att.buffer);
        } else if (att.buffer instanceof ArrayBuffer || (att.buffer?.buffer instanceof ArrayBuffer)) {
          fileBuffer = Buffer.from(att.buffer instanceof ArrayBuffer ? att.buffer : att.buffer.buffer);
        } else if (att.buffer?.length > 0) {
          // 兜底：可能是被序列化后的类数组对象
          fileBuffer = Buffer.from(att.buffer);
        } else {
          console.warn('[ADP Chat] Attachment buffer is empty or invalid:', att.name, 'typeof:', typeof att.buffer);
          throw new Error(`Empty buffer for ${att.name}`);
        }

        if (fileBuffer.length === 0) {
          throw new Error(`Zero-length buffer for ${att.name}`);
        }

        if (!isImage) {
          _docProcessed++;
          sendUploadProgress({ phase: 'uploading', index: _docProcessed, total: docAttachments.length, fileName: att.name, message: `正在上传文档（${_docProcessed}/${docAttachments.length}）：${att.name}` });
        }

        // Step 1+2: 获取凭证 + 上传到 COS
        const cosResult = await uploadFileToADPCOS(fileBuffer, att.name, adpFileType, att.size, botBizId, tcSecretId, tcSecretKey);

        // 🔧 关键修复：Claw 模式 vs 标准模式的文件传递方式完全不同！
        // 标准模式：Type:file + DocId（需 docParse）
        // Claw 模式：Markdown 链接嵌入 Type:text（不需要 docParse！）
        // 参考：https://cloud.tencent.com/document/product/1759/107908
        // Claw 模式示例：Contents: [{ Type: "text", Text: "[致橡树.txt](https://...cos.../致橡树.txt)请阅读上传的文档" }]
        // Claw 模式图片：Contents: [{ Type: "text", Text: "![](图片URL)描述图片内容" }]

        const fileUrl = cosResult.fileUrl ||
          `https://${cosResult.bucket}.${cosResult.type || 'cos'}.${cosResult.region}.myqcloud.com${cosResult.uploadPath}`;

        if (isImage) {
          // Claw 模式：图片用 Markdown 格式 ![](url) 嵌入 Text
          // 标准模式用 Type: 'image' + Image.Url，但 Claw 模式不支持
          contents.push({
            Type: 'text',
            Text: `![](${fileUrl})`
          });
          console.log('[ADP Chat] ✅ Added image as Markdown (Claw mode):', att.name, 'URL:', fileUrl.substring(0, 80) + '...');
        } else {
          // Claw 模式：文档用 Markdown 链接 [文件名](url) 嵌入 Text
          // 不需要 docParse！不需要 DocId！不需要等待！
          const fileNameNoExt = att.name.replace(/\.[^.]+$/, '');
          contents.push({
            Type: 'text',
            Text: `[${att.name}](${fileUrl})\n\n请阅读以上文档链接中的内容并据此回答。`
          });
          console.log('[ADP Chat] ✅ Added file as Markdown link (Claw mode):', att.name, 'URL:', fileUrl.substring(0, 80) + '...');
        }
        continue; // COS 上传成功，跳过降级方案
      } catch (cosErr) {
        console.warn('[ADP Chat] ADP COS upload failed, falling back:', cosErr.message,
          '| tcSecretId:', tcSecretId ? tcSecretId.substring(0, 8) + '...' : 'EMPTY',
          '| tcSecretKey:', tcSecretKey ? '✅已配置' : '❌空',
          '| botBizId:', botBizId || 'EMPTY');
        // 继续执行降级方案
      }
    }

    // ===== 方案 B：File Share 服务上传（COS 未配置时的降级方案）=====
    const fileShareBaseUrl = getAuthServer()?.toolkitUrl;
    const fileShareApiKey = remoteConfig?.file_share?.api_key
      || getSetting('file_share_api_key')
      || DEFAULT_FILE_SHARE_API_KEY;

    let fileUrl = null;
    if (fileShareBaseUrl && fileShareApiKey && att.buffer) {
      try {
        console.log('[ADP Chat] Uploading file to File Share (fallback):', att.name, 'size:', att.size);
        const FormData = require('form-data');
        const form = new FormData();
        let fileBuffer;
        // 优先处理普通数组（IPC 传输后的格式）
        if (Array.isArray(att.buffer)) {
          fileBuffer = Buffer.from(att.buffer);
        } else if (att.buffer instanceof ArrayBuffer || (att.buffer?.buffer instanceof ArrayBuffer)) {
          fileBuffer = Buffer.from(att.buffer instanceof ArrayBuffer ? att.buffer : att.buffer.buffer);
        } else if (att.buffer?.length > 0) {
          fileBuffer = Buffer.from(att.buffer);
        } else {
          console.warn('[ADP Chat] File Share: buffer empty for', att.name);
          throw new Error(`Empty buffer for ${att.name}`);
        }

        if (fileBuffer.length === 0) {
          throw new Error(`Zero-length buffer for ${att.name}`);
        }
        form.append('file', fileBuffer, {
          filename: att.name,
          contentType: att.mimeType || 'application/octet-stream'
        });
        form.append('description', `Memora 客户端上传 - ${att.name}`);
        form.append('expire_days', '1');

        const uploadRes = await fetch(`${fileShareBaseUrl}/api/file-share/upload`, {
          method: 'POST',
          headers: {
            'X-API-Key': fileShareApiKey,
            ...form.getHeaders()
          },
          body: form,
          signal: AbortSignal.timeout(30000)
        });

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          if (uploadData.success && uploadData.data?.download_url) {
            fileUrl = uploadData.data.download_url;
            console.log('[ADP Chat] File Share upload OK:', att.name, '->', fileUrl);
          } else {
            console.warn('[ADP Chat] File Share upload response not successful:', uploadData.error || 'unknown');
          }
        } else {
          console.warn('[ADP Chat] File Share upload HTTP error:', uploadRes.status);
        }
      } catch (uploadErr) {
        console.warn('[ADP Chat] File Share upload failed:', att.name, uploadErr.message);
      }
    }

    if (fileUrl) {
      // File Share 上传成功 — Claw 模式统一用 Markdown 格式
      if (isImage) {
        contents.push({
          Type: 'text',
          Text: `![](${fileUrl})`
        });
        console.log('[ADP Chat] ✅ Added image as Markdown (Claw mode, File Share):', att.name);
        continue;
      } else {
        contents.push({
          Type: 'text',
          Text: `[${att.name}](${fileUrl})\n\n请阅读以上文档链接中的内容并据此回答。`
        });
        console.log('[ADP Chat] ✅ Added file as Markdown link (Claw mode, File Share):', att.name);
        continue;
      }
    }

    // ===== 方案 C：图片 base64 内联（File Share 也不可用时的最后降级）=====
    if (isImage && att.base64) {
      contents.push({
        Type: 'image',
        Image: { Url: `data:${att.mimeType};base64,${att.base64}` }
      });
      console.log('[ADP Chat] Added image (base64 inline):', att.name, att.mimeType);
      continue;
    }
    if (isImage) continue; // 图片无 base64 也无任何上传方式，跳过

    // 所有上传方式都失败：文件无法传给 ADP
    // 🔧 修复：不能将文件二进制内容当文本发送给 ADP（会导致 InvalidRequest）
    // 降级策略 1：如果有 textContent，直接注入文本（适用于 PDF 等可提取文本的文件）
    if (att.textContent && att.textContent.trim()) {
      const maxLen = 50000;
      const textContent = att.textContent.length > maxLen
        ? att.textContent.substring(0, maxLen) + '\n...（文件过长，已截断）'
        : att.textContent;
      contents.push({
        Type: 'text',
        Text: `【附件文件：${att.name}】\n\`\`\`\n${textContent}\n\`\`\``
      });
      console.log('[ADP Chat] ✅ Fallback: injected file text content (upload failed):', att.name, 'length:', textContent.length);
      continue;
    }

    // 降级策略 2：告知用户文件未上传成功
    console.warn('[ADP Chat] All upload methods failed for file:', att.name,
      '- COS creds:', hasADPCOSCreds ? 'available' : 'NOT configured',
      '- File Share:', fileUrl ? 'ok' : 'failed');
    
    if (isImage) continue; // 图片跳过
    
    // 文件：添加提示文本，告知用户文件未上传
    contents.push({
      Type: 'text',
      Text: `[系统提示：文件 "${att.name}" 未能上传到 ADP。${!hasADPCOSCreds ? '请在设置中配置腾讯云 SecretId/SecretKey/BotBizId 以启用文件上传功能。' : '文件上传服务暂时不可用，请稍后重试。'}]`
    });
  }

  // 文档处理结束，通知前端收起上传/解析状态
  if (docAttachments.length > 0) {
    sendUploadProgress({ phase: 'complete', total: docAttachments.length, message: '文档处理完成，正在请求智能体…' });
  }

  // 3. 添加用户消息文本
  contents.push({ Type: 'text', Text: message });

  // 🔧 诊断：发送前校验 Contents 结构（Claw 模式：所有文件/图片都走 Markdown 链接嵌入 Type:text）
  const _diagFileCount = contents.filter(c => c.Type === 'file').length;
  const _diagImageCount = contents.filter(c => c.Type === 'image').length;
  const _diagTextCount = contents.filter(c => c.Type === 'text').length;
  const _diagMarkdownLinks = contents.filter(c => c.Type === 'text' && c.Text?.match(/\[.*\]\(https?:\/\/.*\)/)).length;
  const _diagMarkdownImages = contents.filter(c => c.Type === 'text' && c.Text?.match(/!\[.*\]\(https?:\/\/.*\)/)).length;
  console.log(`[ADP Chat] 📊 Contents summary (Claw mode): ${_diagFileCount} files, ${_diagImageCount} images, ${_diagTextCount} texts (incl. ${_diagMarkdownLinks} md-links, ${_diagMarkdownImages} md-images)`);
  for (const c of contents) {
    if (c.Type === 'file') {
      console.log(`[ADP Chat] 📎 File: "${c.File?.FileName}" FileType=${c.File?.FileType} DocId=${c.File?.DocId || 'NONE'}`);
    } else if (c.Type === 'image') {
      console.log(`[ADP Chat] 🖼 Image URL: ${(c.Image?.Url || '').substring(0, 80)}...`);
    } else if (c.Type === 'text' && c.Text?.match(/!\[.*\]\(https?:\/\/.*\)/)) {
      console.log(`[ADP Chat] 🖼 Markdown Image: ${c.Text.substring(0, 80)}...`);
    } else if (c.Type === 'text' && c.Text?.match(/\[.*\]\(https?:\/\/.*\)/)) {
      console.log(`[ADP Chat] 📎 Markdown Link: ${c.Text.substring(0, 80)}...`);
    }
  }

  // v3.1: 统一上下文层 — 自动向量检索并注入（非专家模式）
  let _vectorSources = [];
  let _adpVectorMeta = null;
  if (unifiedContextLayer && message && !expertAppKey) {
    try {
      const ctxResult = await unifiedContextLayer.retrieve(message, { mode: 'adp' });
      if (ctxResult.context) {
        localSystemRole = localSystemRole
          ? `${localSystemRole}\n\n${ctxResult.context}`
          : ctxResult.context;
        _vectorSources = ctxResult.sources || [];
        _adpVectorMeta = ctxResult.retrieval_meta || null;
        // v3.1: 更新记忆活跃度
        const memoryIds = _vectorSources.filter(s => s.source_type === 'memory').map(s => s.source_id);
        if (memoryIds.length > 0 && memoryActivation) {
          memoryActivation.onRetrievalHit(memoryIds, message);
        }
        // 通知前端展示引用来源
        event.sender.send('context:sources', { sources: _vectorSources, meta: ctxResult.retrieval_meta });
      }
    } catch (e) {
      console.warn('[Vector] ADP context injection failed:', e.message);
    }
  }
  const _adpTraceId = _adpVectorMeta?.trace_id || `adp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const requestBody = {
    RequestId: requestId,
    ConversationId: convId,
    AppKey: appKey.trim(),
    VisitorId: getDeviceFingerprint(),  // 🔧 ADP V2 对话接口官方字段名是 VisitorId
    VisitorBizId: getDeviceFingerprint(),  // 🔧 官方 Python SDK 文件对话示例用 VisitorBizId，双字段兼容
    Contents: contents,
    Incremental: true,
    Stream: 'enable',
    StreamingThrottle: 5,
    ...(localSystemRole ? { SystemRole: localSystemRole } : {}),  // v2.7: 本地上下文注入
  };

  // 调试：打印完整请求体结构（脱敏 AppKey，文件 URL 截断）
  console.log('[ADP Chat] >>> Request body:', JSON.stringify({
    ...requestBody,
    AppKey: requestBody.AppKey.substring(0, 8) + '...',
    Contents: requestBody.Contents.map(c => {
      if (c.Type === 'file') return { Type: 'file', File: { ...c.File, FileUrl: (c.File.FileUrl || '').substring(0, 60) + '...' } };
      if (c.Type === 'image') return { Type: 'image', Image: { Url: (c.Image?.Url || '').substring(0, 60) + '...' } };
      if (c.Type === 'text') return { Type: 'text', Text: (c.Text || '').substring(0, 50) };
      return c;
    }),
  }));

  try {
    const httpUrl = normalizeADPUrl(url).replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');

    const controller = new AbortController();
    if (_taskId) { taskControllers.set(_taskId, controller); } else { activeChatADPController = controller; }

    const response = await fetch(httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      _clearCtrl();
      // 审计日志：HTTP 错误
      if (auditLogger) {
        auditLogger.record({
          module: 'adp_chat',
          model: _adpChatModel,
          skill: _skillHint || null,
          baseUrl: httpUrl,
          adpAppKey: _adpChatAppKey,
          input: { systemPromptLen: 0, userPromptLen: message.length, userPrompt: message },
          output: { status: response.status, contentLen: 0, content: '', finishReason: null },
          tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          latencyMs: Date.now(),
          error: `HTTP ${response.status}`,
          traceId: _adpTraceId,
          vectorSources: _vectorSources.map(s => ({ source_type: s.source_type, source_id: s.source_id, title: s.title, score: s.score })),
        });
      }
      return { success: false, error: `ADP请求失败: HTTP ${response.status}`, configSource };
    }

    // 立即返回成功，后续通过 IPC 事件流式推送每个 SSE event
    // 异步处理 SSE 流
    const _adpChatStartTime = Date.now();
    let _adpChatFullText = '';
    let _firstDeltaLogged = false;  // 🔧 首个 text.delta 诊断日志（便于排查文件对话是否生效）
    let _firstErrorLogged = false;  // 🔧 首个 error 事件诊断日志
    (async () => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let currentData = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.replace(/\r$/, '');
            if (trimmed.startsWith(':')) continue; // 心跳注释
            else if (trimmed.startsWith('event:')) {
              currentEvent = trimmed.substring(6).trim();
            }
            else if (trimmed.startsWith('data:')) {
              currentData += trimmed.substring(5).trim();
            }
            else if (trimmed === '') {
              // SSE 事件边界
              if (currentData) {
                if (currentData === '[DONE]') {
                  // 审计日志：ADP 聊天完成
                  if (auditLogger) {
                    auditLogger.record({
                      module: 'adp_chat',
                      model: _adpChatModel,
                      skill: _skillHint || null,
                      baseUrl: httpUrl,
                      adpAppKey: _adpChatAppKey,
                      input: { systemPromptLen: 0, userPromptLen: message.length, userPrompt: message },
                      output: { status: 200, contentLen: _adpChatFullText.length, content: _adpChatFullText, finishReason: 'completed' },
                      tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                      latencyMs: Date.now() - _adpChatStartTime,
                      traceId: _adpTraceId,
                      vectorSources: _vectorSources.map(s => ({ source_type: s.source_type, source_id: s.source_id, title: s.title, score: s.score })),
                    });
                  }
                  _sendEvent({ event: 'done', data: null, configSource });
                  _clearCtrl();
                  return;
                }
                try {
                  const parsed = JSON.parse(currentData);
                  // 累积完整文本用于审计日志
                  const deltaText = parsed.Text || parsed.Content?.[0]?.Text || parsed.payload?.content?.[0]?.text || '';
                  if (deltaText && (currentEvent === 'text.delta' || currentEvent === 'message.added' || currentEvent === 'content.added')) {
                    // 增量检测：如果新文本以已累积文本为前缀，说明是累积模式，替换而非追加
                    if (_adpChatFullText && deltaText.startsWith(_adpChatFullText)) {
                      _adpChatFullText = deltaText;
                    } else {
                      _adpChatFullText += deltaText;
                    }
                    // 🔧 诊断日志：首个 text.delta（判断 ADP 是否正确读取了文档）
                    if (!_firstDeltaLogged) {
                      _firstDeltaLogged = true;
                      console.log('[ADP Chat] 🔤 First text.delta:', deltaText.substring(0, 120), '| event:', currentEvent);
                    }
                  }
                  // 🔧 诊断日志：首个 error 事件
                  if (currentEvent === 'error' && !_firstErrorLogged) {
                    _firstErrorLogged = true;
                    console.error('[ADP Chat] ❌ First error event:', JSON.stringify(parsed).substring(0, 300));
                  }
                  // 推送完整的 {event, data} 给前端，让前端处理渲染
                  _sendEvent({
                    event: currentEvent || parsed.Type || '',
                    data: parsed,
                    configSource
                  });
                } catch (e) {
                  // 非 JSON 忽略
                }
                currentEvent = '';
                currentData = '';
              }
            }
          }
        }

        // 流结束，发送兜底 done
        if (currentData && currentData !== '[DONE]') {
          try {
            const parsed = JSON.parse(currentData);
            _sendEvent({
              event: currentEvent || parsed.Type || '',
              data: parsed,
              configSource
            });
          } catch (e) {}
        }
        // 审计日志：流自然结束（非 [DONE]）
        if (_adpChatFullText && auditLogger) {
          auditLogger.record({
            module: 'adp_chat',
            model: _adpChatModel,
            skill: _skillHint || null,
            baseUrl: httpUrl,
            adpAppKey: _adpChatAppKey,
            input: { systemPromptLen: 0, userPromptLen: message.length, userPrompt: message },
            output: { status: 200, contentLen: _adpChatFullText.length, content: _adpChatFullText, finishReason: 'stream_end' },
            tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            latencyMs: Date.now() - _adpChatStartTime,
            traceId: _adpTraceId,
            vectorSources: _vectorSources.map(s => ({ source_type: s.source_type, source_id: s.source_id, title: s.title, score: s.score })),
          });
        }
        _sendEvent({ event: 'done', data: null, configSource });
      } catch (e) {
        if (e.name === 'AbortError') {
          // 审计日志：用户中止
          if (auditLogger) {
            auditLogger.record({
              module: 'adp_chat',
              model: _adpChatModel,
              skill: _skillHint || null,
              baseUrl: httpUrl,
              adpAppKey: _adpChatAppKey,
              input: { systemPromptLen: 0, userPromptLen: message.length, userPrompt: message },
              output: { status: 200, contentLen: _adpChatFullText.length, content: _adpChatFullText, finishReason: 'aborted' },
              tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
              latencyMs: Date.now() - _adpChatStartTime,
              traceId: _adpTraceId,
              vectorSources: _vectorSources.map(s => ({ source_type: s.source_type, source_id: s.source_id, title: s.title, score: s.score })),
            });
          }
          _sendEvent({ event: 'done', data: null, configSource, aborted: true });
        } else {
          _sendEvent({ event: 'error', data: { Error: { Message: e.message } }, configSource });
        }
      }
      _clearCtrl();
    })();

    return { success: true, streaming: true, configSource, conversationId: convId };
  } catch (error) {
    _clearCtrl();
    if (error.name === 'AbortError') {
      return { success: false, error: '请求超时', configSource };
    }
    return { success: false, error: error.message || '连接失败', configSource };
  }
});

// 停止 ADP 聊天流
ipcMain.handle('adp:stop-message', async () => {
  if (activeChatADPController) {
    activeChatADPController.abort();
    activeChatADPController = null;
    return { success: true };
  }
  return { success: false, error: '没有进行中的请求' };
});

// v3.1 多任务并发：停止指定任务
ipcMain.handle('task:stop', async (event, { taskId }) => {
  if (!taskId) return { success: false, error: '缺少 taskId' };
  const controller = taskControllers.get(taskId);
  if (controller) {
    controller.abort();
    taskControllers.delete(taskId);
    return { success: true };
  }
  return { success: false, error: '任务不存在或已完成' };
});

// v3.1 多任务并发：列出活跃任务
ipcMain.handle('task:list', async (event, { sessionId }) => {
  const tasks = [];
  for (const [taskId, controller] of taskControllers) {
    if (!controller.signal.aborted) {
      tasks.push({ taskId, aborted: false });
    }
  }
  return { success: true, tasks };
});

// ===== 专家系统 IPC 通道 =====
const EXPERTS_FILE = path.join(app.getPath('userData'), 'experts.json');

function _loadExpertsData() {
  try {
    if (fs.existsSync(EXPERTS_FILE)) {
      const data = fs.readFileSync(EXPERTS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[Experts] Failed to load experts data:', e);
  }
  return { experts: [], groups: [], version: '2.6.0' };
}

function _saveExpertsData(data) {
  try {
    fs.writeFileSync(EXPERTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[Experts] Failed to save experts data:', e);
    return false;
  }
}

// Migration: create default experts from hardcoded cards
function _migrateDefaultExperts() {
  const data = _loadExpertsData();
  if (data.experts && data.experts.length > 0) return data;
  
  const now = new Date().toISOString();
  let globalAppKey = getSetting('adp_app_key') || DEFAULT_ADP_APP_KEY;
  if (authState.isLoggedIn && remoteConfig?.adp?.app_key) {
    globalAppKey = remoteConfig.adp.app_key;
  }
  
  data.experts = [
    {
      id: 'expert_default_task',
      name: '智能任务分析',
      intro: '帮你分析和管理待办事项',
      icon: '📝',
      adpUrl: '',
      appKey: globalAppKey,
      quickAccesses: [
        { id: 'qa_1', icon: '🎯', label: '今日排程', prompt: '今天该做什么？帮我排个优先级' },
        { id: 'qa_2', icon: '📊', label: '生成日报', prompt: '生成今天的工作日报' },
        { id: 'qa_3', icon: '📚', label: '整理笔记', prompt: '帮我整理一下最近的笔记' },
        { id: 'qa_4', icon: '🧠', label: '整理记忆', prompt: '帮我整理一下记忆，看看哪些需要保留' },
        { id: 'qa_5', icon: '🔥', label: '紧急事项', prompt: '最紧急的事项是什么？' },
        { id: 'qa_6', icon: '⏰', label: '时间建议', prompt: '给我一些时间管理建议' },
      ],
      sortOrder: 0,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'expert_default_bidding',
      name: '招投标支持',
      intro: '招投标文档智能生成',
      icon: '📋',
      adpUrl: '',
      appKey: globalAppKey,
      quickAccesses: [
        { id: 'qa_1', icon: '📊', label: '技术偏离表', prompt: '请帮我生成技术偏离表' },
        { id: 'qa_2', icon: '📄', label: '技术标书', prompt: '请帮我生成技术标书' },
        { id: 'qa_3', icon: '📋', label: '投标方案PPT', prompt: '请帮我生成投标方案PPT' },
        { id: 'qa_4', icon: '✅', label: '点对点应答', prompt: '请帮我生成点对点应答' },
        { id: 'qa_5', icon: '📝', label: 'SOW', prompt: '请帮我生成SOW（工作说明书）' },
        { id: 'qa_6', icon: '✔️', label: '验收标准', prompt: '请帮我生成验收标准' },
        { id: 'qa_7', icon: '🏢', label: '私有化部署方案', prompt: '请帮我生成私有化部署方案' },
      ],
      sortOrder: 1,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'expert_default_knowledge',
      name: '知识助手',
      intro: '产品知识与助销资料',
      icon: '📚',
      adpUrl: '',
      appKey: globalAppKey,
      quickAccesses: [
        { id: 'qa_1', icon: '📄', label: '文档列表', prompt: '获取文档列表' },
        { id: 'qa_2', icon: '🚀', label: '产品升级规划', prompt: 'ADP 产品升级规划等产品知识' },
        { id: 'qa_3', icon: '💡', label: '产品功能介绍', prompt: '介绍一下 ADP 平台的核心功能' },
        { id: 'qa_4', icon: '🔧', label: '技术架构', prompt: 'ADP 的技术架构是怎样的？' },
        { id: 'qa_5', icon: '📖', label: '最佳实践', prompt: 'ADP 项目实施的最佳实践有哪些？' },
        { id: 'qa_6', icon: '❓', label: '常见问题', prompt: 'ADP 常见问题及解决方案' },
      ],
      sortOrder: 2,
      createdAt: now,
      updatedAt: now
    }
  ];
  
  _saveExpertsData(data);
  console.log('[Experts] Migrated 3 default experts');
  return data;
}

ipcMain.handle('experts:get-all', async () => {
  const data = _migrateDefaultExperts();
  return { success: true, experts: data.experts || [], groups: data.groups || [] };
});

ipcMain.handle('experts:save', async (event, expert) => {
  const data = _loadExpertsData();
  if (!data.experts) data.experts = [];
  
  if (expert.id) {
    const idx = data.experts.findIndex(e => e.id === expert.id);
    if (idx !== -1) {
      data.experts[idx] = { ...data.experts[idx], ...expert, updatedAt: new Date().toISOString() };
    } else {
      data.experts.push(expert);
    }
  } else {
    expert.id = 'expert_' + Date.now();
    expert.createdAt = new Date().toISOString();
    expert.updatedAt = expert.createdAt;
    data.experts.push(expert);
  }
  
  _saveExpertsData(data);
  return { success: true, expert };
});

ipcMain.handle('experts:delete', async (event, expertId) => {
  const data = _loadExpertsData();
  data.experts = (data.experts || []).filter(e => e.id !== expertId);
  if (data.groups) {
    data.groups.forEach(g => {
      g.expertIds = (g.expertIds || []).filter(id => id !== expertId);
      if (g.hostExpertId === expertId) {
        g.hostExpertId = g.expertIds[0] || null;
      }
    });
  }
  _saveExpertsData(data);
  return { success: true };
});

ipcMain.handle('experts:reorder', async (event, orderedIds) => {
  const data = _loadExpertsData();
  const idOrder = {};
  orderedIds.forEach((id, idx) => idOrder[id] = idx);
  data.experts.sort((a, b) => (idOrder[a.id] ?? 999) - (idOrder[b.id] ?? 999));
  data.experts.forEach((e, idx) => e.sortOrder = idx);
  _saveExpertsData(data);
  return { success: true };
});

ipcMain.handle('expert-groups:get-all', async () => {
  const data = _loadExpertsData();
  return { success: true, groups: data.groups || [] };
});

ipcMain.handle('expert-groups:save', async (event, group) => {
  const data = _loadExpertsData();
  if (!data.groups) data.groups = [];
  
  if (group.id) {
    const idx = data.groups.findIndex(g => g.id === group.id);
    if (idx !== -1) {
      data.groups[idx] = { ...data.groups[idx], ...group, updatedAt: new Date().toISOString() };
    } else {
      data.groups.push(group);
    }
  } else {
    group.id = 'group_' + Date.now();
    group.createdAt = new Date().toISOString();
    group.updatedAt = group.createdAt;
    data.groups.push(group);
  }
  
  _saveExpertsData(data);
  return { success: true, group };
});

ipcMain.handle('expert-groups:delete', async (event, groupId) => {
  const data = _loadExpertsData();
  data.groups = (data.groups || []).filter(g => g.id !== groupId);
  _saveExpertsData(data);
  return { success: true };
});

ipcMain.handle('expert-groups:reorder', async (event, orderedIds) => {
  const data = _loadExpertsData();
  const idOrder = {};
  orderedIds.forEach((id, idx) => idOrder[id] = idx);
  data.groups.sort((a, b) => (idOrder[a.id] ?? 999) - (idOrder[b.id] ?? 999));
  data.groups.forEach((g, idx) => g.sortOrder = idx);
  _saveExpertsData(data);
  return { success: true };
});

// ===== 专家 Excel 导入/导出 =====
ipcMain.handle('experts:import-xlsx', async () => {
  const XLSX = require('xlsx');
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    title: '选择专家 Excel 文件',
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false, cancelled: true };

  try {
    const workbook = XLSX.readFile(result.filePaths[0]);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) return { success: false, error: 'Excel 文件为空' };

    const now = new Date().toISOString();
    const existingData = _loadExpertsData();
    const existingKeys = new Set((existingData.experts || []).map(e => e.appKey));
    const existingNames = new Set((existingData.experts || []).map(e => e.name));
    let imported = 0, skipped = 0;

    for (const row of rows) {
      const name = String(row['应用名称'] || row['名称'] || row['name'] || '').trim();
      const appKey = String(row['App Key'] || row['appKey'] || row['app_key'] || '').trim();
      const desc = String(row['应用描述'] || row['描述'] || row['intro'] || row['description'] || '').trim();
      const icon = String(row['图标'] || row['icon'] || '🤖').trim();
      const adpUrl = String(row['访问地址'] || row['adpUrl'] || row['adp_url'] || '').trim();

      if (!name || !appKey) { skipped++; continue; }
      if (existingKeys.has(appKey) || existingNames.has(name)) { skipped++; continue; }

      // 解析快捷问题（支持多种列名格式）
      const quickAccesses = [];
      for (let i = 1; i <= 10; i++) {
        const label = String(row[`快捷问题${i}`] || row[`快捷${i}`] || row[`qa_${i}`] || '').trim();
        const prompt = String(row[`提示词${i}`] || row[`prompt_${i}`] || '').trim();
        const qaIcon = String(row[`图标${i}`] || '💬').trim();
        if (label && prompt) {
          quickAccesses.push({ id: `qa_${i}`, icon: qaIcon, label, prompt });
        }
      }

      const expert = {
        id: `expert_import_${Date.now()}_${imported}`,
        name, appKey, intro: desc.substring(0, 50), icon, adpUrl,
        expertType: 'claw',
        quickAccesses,
        sortOrder: existingData.experts.length + imported,
        createdAt: now,
        updatedAt: now
      };
      existingData.experts.push(expert);
      existingKeys.add(appKey);
      existingNames.add(name);
      imported++;
    }

    _saveExpertsData(existingData);
    return { success: true, imported, skipped, total: rows.length };
  } catch (err) {
    console.error('[Experts] Import xlsx error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('experts:export-xlsx', async (event, experts) => {
  const XLSX = require('xlsx');
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog({
    title: '导出专家列表',
    defaultPath: `Memora专家_${new Date().toISOString().slice(0, 10)}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (result.canceled) return { success: false, cancelled: true };

  try {
    const rows = (experts || []).map((e, i) => ({
      '序号': i + 1,
      '图标': e.icon || '🤖',
      '应用名称': e.name || '',
      '应用描述': e.intro || '',
      'App Key': e.appKey || '',
      '访问地址': e.adpUrl || '',
      '专家类型': e.expertType || 'claw',
      ...(() => {
        const qaCols = {};
        (e.quickAccesses || []).forEach((qa, j) => {
          qaCols[`快捷问题${j + 1}`] = qa.label || '';
          qaCols[`提示词${j + 1}`] = qa.prompt || '';
          qaCols[`图标${j + 1}`] = qa.icon || '';
        });
        return qaCols;
      })()
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    // 设置列宽
    ws['!cols'] = [
      { wch: 5 },  // 序号
      { wch: 5 },  // 图标
      { wch: 20 }, // 应用名称
      { wch: 40 }, // 应用描述
      { wch: 80 }, // App Key
      { wch: 40 }, // 访问地址
      { wch: 10 }, // 专家类型
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '专家列表');
    XLSX.writeFile(wb, result.filePath);

    return { success: true, count: rows.length, path: result.filePath };
  } catch (err) {
    console.error('[Experts] Export xlsx error:', err);
    return { success: false, error: err.message };
  }
});
// 主进程管理群聊状态机，即使渲染进程切走页面也继续执行
const _groupChatEngines = new Map(); // chatId → GroupChatEngine

class GroupChatEngine {
  constructor(chatId, config) {
    this.chatId = chatId;
    this.config = config; // { groupId, groupName, expertIds, hostExpertId, hostPrompt, executionStrategy, experts: Map<id, {appKey,adpUrl,name,icon,intro}> }
    this.phase = 'idle'; // 'idle' | 'host_analysis' | 'experts_exec' | 'host_summary' | 'complete' | 'error'
    this.messages = [];
    this.abortController = null;
    this.startedAt = new Date().toISOString();
    this.userMessage = '';
  }

  // 调用单个专家（流式输出，实时推送到前端）
  async _callExpert(prompt, expertId, phase) {
    const expert = this.config.experts[expertId];
    if (!expert) throw new Error(`专家 ${expertId} 不存在`);

    console.log(`[GroupChatEngine] _callExpert: expertId=${expertId}, name=${expert.name}, phase=${phase}`);

    let appKey = expert.appKey;
    let url = expert.adpUrl ? normalizeADPUrl(expert.adpUrl) : 'https://wss.lke.cloud.tencent.com/adp/v2/chat';

    if (!appKey) {
      const adpConfig = getSetting('adp_config') || {};
      appKey = adpConfig.app_key || DEFAULT_ADP_APP_KEY;
      if (authState.isLoggedIn && remoteConfig?.adp?.app_key) appKey = remoteConfig.adp.app_key;
      url = adpConfig.url ? normalizeADPUrl(adpConfig.url) : url;
    }

    // 🔧 修复：ConversationId 必须匹配 ^[a-zA-Z0-9_-]{2,64}$
    const sanitizeId = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const conversationId = `grp_${sanitizeId(this.config.groupId)}_${phase}_${Date.now()}`;
    const visitorId = `memora_exp_${sanitizeId(expertId)}`;
    const requestBody = {
      AppKey: appKey,
      ConversationId: conversationId,
      VisitorId: visitorId,
      Contents: [{ Type: 'text', Text: prompt }],
      RequestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 64),
      Stream: 'enable'
    };

    const controller = new AbortController();
    // 🔧 修复：并行模式下 abortController 互相覆盖，改用 Map 存储
    if (!this._abortControllers) this._abortControllers = new Map();
    this._abortControllers.set(expertId + '_' + phase, controller);
    this.abortController = controller; // 兼容：cancel() 方法仍用最新值

    // 发送"开始处理"事件
    const isHost = (expertId === this.config.hostExpertId);
    this._sendEvent('expert-start', {
      expertId,
      expertName: expert.name,
      expertIcon: expert.icon,
      isHost,
      phase,
      message: isHost ? '⭐ 主持人正在分析...' : `${expert.icon} ${expert.name} 正在处理...`
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 收集完整文本，同时流式推送增量到前端
      let fullText = '';
      let thinkingText = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let lastStreamPush = 0;
      let firstDeltaLogged = false;

      console.log(`[GroupChatEngine] SSE stream started for ${expert.name} (${phase})`);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (!dataStr || dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              // 🔧 关键修复：ADP V2 text.delta 字段格式与一对一聊天一致
              // 支持：parsed.Text / parsed.Content[0].Text / parsed.payload.content[0].text
              let deltaText = '';
              if (currentEvent === 'text.delta') {
                deltaText = parsed.Text || (parsed.Content && parsed.Content[0] && parsed.Content[0].Text) || parsed.payload?.content?.[0]?.text || '';
              } else if (currentEvent === 'message.added' || currentEvent === 'content.added') {
                deltaText = (parsed.Content && parsed.Content[0] && parsed.Content[0].Text) || parsed.Text || parsed.payload?.content?.[0]?.text || '';
              } else if (currentEvent === 'text.replace' && parsed.Text) {
                // text.replace：用新文本替换旧内容
                fullText = parsed.Text;
                deltaText = '';
              } else if (currentEvent === 'thought') {
                const thoughtText = parsed.Text || parsed.Content || parsed.payload?.content?.[0]?.text || '';
                if (thoughtText) thinkingText += thoughtText;
              } else if (currentEvent === 'message.done') {
                const doneText = (parsed.Message && parsed.Message.Content && parsed.Message.Content[0] && parsed.Message.Content[0].Text) || parsed.Text || '';
                if (doneText && !fullText) fullText = doneText;
              } else if (currentEvent === 'error') {
                throw new Error(parsed.Message || parsed.message || parsed.error?.message || 'ADP 调用错误');
              }

              if (deltaText) {
                fullText += deltaText;
                // 🔧 诊断日志：首个 delta
                if (!firstDeltaLogged) {
                  firstDeltaLogged = true;
                  console.log(`[GroupChatEngine] 🔤 First delta for ${expert.name} (${phase}):`, deltaText.substring(0, 100), '| event:', currentEvent);
                }
                // 流式推送：每 80ms 或每 30 字符推送一次，更丝滑的流式体验
                const now = Date.now();
                if (now - lastStreamPush > 80 || fullText.length % 30 === 0) {
                  this._sendEvent('expert-stream', {
                    expertId,
                    expertName: expert.name,
                    expertIcon: expert.icon,
                    isHost,
                    phase,
                    incremental: deltaText,
                    fullText
                  });
                  lastStreamPush = now;
                }
              }
            } catch (e) {
              if (e.message && (e.message.includes('ADP 调用错误') || e.message.includes('ADP 返回错误'))) throw e;
            }
          }
        }
      }

      // 最终流式推送
      this._sendEvent('expert-stream', {
        expertId,
        expertName: expert.name,
        expertIcon: expert.icon,
        isHost,
        phase,
        incremental: '',
        fullText: fullText || thinkingText
      });

      console.log(`[GroupChatEngine] ✅ SSE stream completed for ${expert.name} (${phase}), fullText length: ${fullText.length}, thinkingText length: ${thinkingText.length}`);

      return fullText || thinkingText || '（无输出）';
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('已取消');
      throw e;
    } finally {
      this.abortController = null;
      // 清理对应专家的 abortController
      if (this._abortControllers) this._abortControllers.delete(expertId + '_' + phase);
    }
  }

  // 发送事件到渲染进程
  _sendEvent(eventType, data = {}) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('expert-chat:event', {
        chatId: this.chatId,
        type: eventType,
        ...data,
        // 🔧 修复：如果 data 中已有 phase（来自 _callExpert 的精确 phase），不覆盖
        // 只有没有 phase 时才用 this.phase（如 phase-start 等全局事件）
        phase: data.phase || this.phase,
        timestamp: new Date().toISOString()
      });
    }
  }

  // 解析主持人分配（增强版：支持精确匹配+名称模糊匹配+兜底全分配）
  _parseHostAssignments(hostResult) {
    const nonHostIds = this.config.expertIds.filter(id => id !== this.config.hostExpertId);

    try {
      const jsonMatch = hostResult.match(/\{[\s\S]*"assignments"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.assignments && Array.isArray(parsed.assignments) && parsed.assignments.length > 0) {
          const assignments = [];
          const assignedIds = new Set();

          for (const a of parsed.assignments) {
            let expertId = a.expert_id;
            let matched = false;

            // 1. 精确 ID 匹配
            if (expertId && nonHostIds.includes(expertId)) {
              matched = true;
            }

            // 2. 名称模糊匹配
            if (!matched && a.expert_id) {
              for (const eid of nonHostIds) {
                const expert = this.config.experts[eid];
                if (expert && (expert.name === a.expert_id || expert.name.includes(a.expert_id) || a.expert_id.includes(expert.name))) {
                  expertId = eid;
                  matched = true;
                  break;
                }
              }
            }

            if (matched && expertId) {
              assignments.push({ expertId, task: a.task || '请协助处理用户请求' });
              assignedIds.add(expertId);
            }
          }

          // 3. 如果有专家没被分配到任务，但主持人建议了分配，自动补上
          for (const eid of nonHostIds) {
            if (!assignedIds.has(eid)) {
              const expert = this.config.experts[eid];
              assignments.push({
                expertId: eid,
                task: `请从你的专业角度（${expert?.name || '专家'}）协助处理用户请求`
              });
            }
          }

          if (assignments.length > 0) return assignments;
        }
      }
    } catch (e) {
      console.warn('[GroupChatEngine] Failed to parse host assignments:', e);
    }

    // 兜底：分配给所有非主持人专家
    console.log('[GroupChatEngine] Fallback: assigning all experts');
    return nonHostIds.map(id => ({
      expertId: id,
      task: '请协助处理用户的请求'
    }));
  }

  // 运行完整群聊流程
  async execute(userMessage) {
    this.userMessage = userMessage;
    const hostExpert = this.config.experts[this.config.hostExpertId];
    if (!hostExpert) {
      this.phase = 'error';
      this._sendEvent('error', { message: '主持人不存在' });
      return;
    }

    try {
      // 阶段一：主持人分析
      this.phase = 'host_analysis';
      this._sendEvent('phase-start', { message: '⭐ 主持人正在分析...' });

      const memberExperts = this.config.expertIds
        .filter(id => id !== this.config.hostExpertId)
        .map(id => this.config.experts[id])
        .filter(Boolean);

      const customPrompt = this.config.hostPrompt?.trim();
      const strategy = this.config.executionStrategy === 'parallel' ? '并行' : '串行';

      // 构建专家能力详情
      const buildCap = (e, role) => {
        const intro = e.intro || '暂无介绍';
        return `### ${e.icon} ${e.name}（${role}）\n专业领域：${intro}\nID：${e.id}`;
      };
      const hostCapabilities = buildCap(hostExpert, '主持人');
      const memberCapabilities = memberExperts.map(m => buildCap(m, '成员')).join('\n');

      const defaultPrompt = `你是专家团「${this.config.groupName}」的主持人，负责协调团队处理用户请求。

## 执行策略：${strategy}

## 团队能力
${hostCapabilities}

${memberCapabilities}

## 用户的请求
${userMessage}

## 你的任务
1. 深入分析用户请求，拆解为具体子任务
2. 根据每位专家的专业领域，精准匹配子任务——每个子任务只分配给最擅长的专家
3. 为每个专家编写详细任务指令，包含：上下文背景、具体要求、期望输出格式
4. 不需要参与的专家不要分配任务（避免浪费调用）
5. 以你的专业角度先给出初步判断和分析框架

⚠️ 任务分配关键规则：
- 你必须在 assignments 中使用上面列出的精确 expert_id（如"${this.config.expertIds.filter(id => id !== this.config.hostExpertId)[0] || ''}"）
- 每个专家的 task 必须具体、可执行，包含足够的上下文让专家独立完成
- 不要给专家分配超出其专业领域的任务
- 如果某位专家的专业领域完全不相关，不要强行分配
- 如果所有专家都需要参与，就全部列出
- 不要遗漏任何应该参与的专家
- task 描述应包含：用户的具体需求点 + 你对该需求的分析 + 你期望该专家输出的内容/格式

输出格式（必须严格遵循，只输出JSON，禁止markdown和解释）：
{
  "analysis": "你对用户请求的深度分析，包括核心需求拆解、关键问题识别",
  "initial_thought": "你的初步判断、建议方向和整体策略",
  "assignments": [
    {"expert_id": "精确的专家ID", "task": "具体任务描述：背景是什么，需要你做什么，输出什么格式的结果"}
  ]
}`;
      const hostPrompt = customPrompt ? `${customPrompt}\n\n${defaultPrompt}` : defaultPrompt;

      const hostResult = await this._callExpert(hostPrompt, this.config.hostExpertId, 'host_analysis');
      
      const hostMsg = {
        expertId: this.config.hostExpertId,
        expertName: hostExpert.name,
        expertIcon: hostExpert.icon,
        isHost: true,
        phase: 'host_analysis',
        content: hostResult
      };
      this.messages.push(hostMsg);
      this._sendEvent('expert-complete', hostMsg);

      // 解析分配
      const assignments = this._parseHostAssignments(hostResult);

      // 阶段二：专家执行
      this.phase = 'experts_exec';

      if (this.config.executionStrategy === 'parallel') {
        // 并行模式
        const promises = assignments.map(a => {
          const memberExpert = this.config.experts[a.expertId];
          if (!memberExpert) return Promise.resolve(null);
          const memberPrompt = `你是专家「${memberExpert.name}」，专业领域：${memberExpert.intro || '通用'}。

专家团主持人「${hostExpert.name}」根据你的专业能力，分配给你以下任务：

${a.task}

用户的原始请求：${userMessage}

请根据你的专业领域和上面的任务要求，完成你的工作。输出要具体、完整、可直接使用。`;
          return this._callExpert(memberPrompt, a.expertId, 'member_exec')
            .then(result => ({ assignment: a, expert: memberExpert, result }))
            .catch(err => ({ assignment: a, expert: memberExpert, result: null, error: err }));
        });

        const results = await Promise.allSettled(promises);
        const expertResults = [];

        for (const settled of results) {
          if (settled.status === 'fulfilled' && settled.value) {
            const { assignment, expert, result, error } = settled.value;
            const msg = {
              expertId: assignment.expertId,
              expertName: expert.name,
              expertIcon: expert.icon,
              isHost: false,
              phase: 'member_exec',
              content: result || `⚠️ 调用失败：${error?.message || '未知错误'}`,
              isError: !result
            };
            this.messages.push(msg);
            this._sendEvent('expert-complete', msg);
            if (result) {
              expertResults.push({ expertId: assignment.expertId, expertName: expert.name, expertIcon: expert.icon, result });
            }
          }
        }

        // 阶段三：主持人总结
        await this._runHostSummary(userMessage, expertResults, hostExpert);

      } else {
        // 串行模式
        const expertResults = [];
        for (const assignment of assignments) {
          const memberExpert = this.config.experts[assignment.expertId];
          if (!memberExpert) continue;

          this._sendEvent('phase-start', { message: `${memberExpert.icon} ${memberExpert.name} 正在处理...` });

          const memberPrompt = `你是专家「${memberExpert.name}」，专业领域：${memberExpert.intro || '通用'}。

专家团主持人「${hostExpert.name}」根据你的专业能力，分配给你以下任务：

${assignment.task}

用户的原始请求：${userMessage}

请根据你的专业领域和上面的任务要求，完成你的工作。输出要具体、完整、可直接使用。`;

          try {
            const result = await this._callExpert(memberPrompt, assignment.expertId, 'member_exec');
            const msg = {
              expertId: assignment.expertId,
              expertName: memberExpert.name,
              expertIcon: memberExpert.icon,
              isHost: false,
              phase: 'member_exec',
              content: result
            };
            this.messages.push(msg);
            this._sendEvent('expert-complete', msg);
            expertResults.push({ expertId: assignment.expertId, expertName: memberExpert.name, expertIcon: memberExpert.icon, result });
          } catch (e) {
            const msg = {
              expertId: assignment.expertId,
              expertName: memberExpert.name,
              expertIcon: memberExpert.icon,
              isHost: false,
              phase: 'member_exec',
              content: `⚠️ 调用失败：${e.message}`,
              isError: true
            };
            this.messages.push(msg);
            this._sendEvent('expert-complete', msg);
          }
        }

        // 阶段三：主持人总结
        await this._runHostSummary(userMessage, expertResults, hostExpert);
      }

      this.phase = 'complete';
      this._sendEvent('chat-complete', { userMessage, messages: this.messages });

    } catch (e) {
      this.phase = 'error';
      this._sendEvent('error', { message: e.message });
    } finally {
      _groupChatEngines.delete(this.chatId);
    }
  }

  // 主持人总结
  async _runHostSummary(userMessage, expertResults, hostExpert) {
    this.phase = 'host_summary';
    this._sendEvent('phase-start', { message: '⭐ 主持人正在汇总...' });

    const resultsSummary = expertResults.map(r => `${r.expertIcon} ${r.expertName}：${r.result || '（无输出）'}`).join('\n\n');
    const failedExperts = expertResults.filter(r => r.isError);
    const failedNote = failedExperts.length > 0 
      ? `\n\n⚠️ 注意：以下专家调用失败：${failedExperts.map(e => e.expertName).join('、')}，以下结论缺少他们的输入。`
      : '';

    const summaryPrompt = `以下是各专家的工作结果：
${resultsSummary}
${failedNote}

请你：
1. 综合各专家结果，整理成结构化总结
2. 检查是否有遗漏或冲突
3. 给出最终结论
4. 判断任务是否已完成：如果用户的问题已经得到完整回答，明确声明"任务已完成"；如果需要进一步讨论，说明还需要什么
5. 如果专家输出中包含文件/文档，在总结末尾列出"📋 产出文件清单"，每行格式：[文件名](文件链接)

⚠️ 作为主持人，你有权判断任务是否结束。如果所有专家的输出已经充分回答了用户的问题，请在结论中明确写出"✅ 任务已完成"。`;

    try {
      const result = await this._callExpert(summaryPrompt, this.config.hostExpertId, 'host_summary');
      const msg = {
        expertId: this.config.hostExpertId,
        expertName: hostExpert.name,
        expertIcon: hostExpert.icon,
        isHost: true,
        phase: 'host_summary',
        content: result
      };
      this.messages.push(msg);
      this._sendEvent('expert-complete', msg);
    } catch (e) {
      const msg = {
        expertId: this.config.hostExpertId,
        expertName: hostExpert.name,
        expertIcon: hostExpert.icon,
        isHost: true,
        phase: 'host_summary',
        content: `⚠️ 汇总失败：${e.message}`,
        isError: true
      };
      this.messages.push(msg);
      this._sendEvent('expert-complete', msg);
    }
  }

  // 取消执行
  cancel() {
    // 🔧 修复：并行模式下需要取消所有进行中的请求
    if (this._abortControllers && this._abortControllers.size > 0) {
      for (const controller of this._abortControllers.values()) {
        try { controller.abort(); } catch (_) {}
      }
      this._abortControllers.clear();
    }
    if (this.abortController) {
      try { this.abortController.abort(); } catch (_) {}
    }
    this.phase = 'idle';
    _groupChatEngines.delete(this.chatId);
  }
}

// 启动群聊后台执行
ipcMain.handle('expert-chat:start', async (event, { chatId, config, userMessage, attachments: rawAttachments }) => {
  if (_groupChatEngines.has(chatId)) {
    return { success: false, error: '该群聊已在执行中' };
  }

  // 🔧 关键修复：处理附件 — 复用 send-adp-message 的文件上传流程
  // 将附件通过 COS/Claw 上传获取 URL，注入到消息文本中
  let enrichedMessage = userMessage || '';
  const attachments = rawAttachments || [];

  if (attachments.length > 0) {
    console.log('[GroupChat] Processing', attachments.length, 'attachments for group chat');

    // 获取 COS 上传凭证
    const tcSecretId = remoteConfig?.tencent_cloud?.secret_id || getSetting('adp_tc_secret_id') || '';
    const tcSecretKey = remoteConfig?.tencent_cloud?.secret_key || getSetting('adp_tc_secret_key') || '';
    const botBizId = remoteConfig?.tencent_cloud?.bot_biz_id || getSetting('adp_bot_biz_id') || '';
    const hasADPCOSCreds = !!(tcSecretId && tcSecretKey && botBizId);

    // File Share 降级方案
    const fileShareBaseUrl = getAuthServer()?.toolkitUrl;
    const fileShareApiKey = remoteConfig?.file_share?.api_key || getSetting('file_share_api_key') || DEFAULT_FILE_SHARE_API_KEY;

    const IMG_EXTS = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'heic', 'heif'];
    const TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'log', 'json', 'yaml', 'yml'];

    for (const att of attachments) {
      const ext = (att.name.split('.').pop() || '').toLowerCase();
      const isImage = IMG_EXTS.includes(ext);
      const isPlainText = TEXT_EXTS.includes(ext);

      // 方案 0：纯文本文件直接注入（最稳妥）
      if (isPlainText && att.textContent && att.textContent.trim()) {
        const maxLen = 50000;
        const textContent = att.textContent.length > maxLen
          ? att.textContent.substring(0, maxLen) + '\n...（文件过长，已截断）'
          : att.textContent;
        enrichedMessage += `\n\n【附件文件：${att.name}】\n\`\`\`\n${textContent}\n\`\`\``;
        console.log('[GroupChat] ✅ Plain text injected:', att.name);
        continue;
      }

      // 方案 A：COS 上传（Claw 模式 Markdown 链接）
      if (hasADPCOSCreds && att.buffer) {
        try {
          let fileBuffer;
          if (Array.isArray(att.buffer)) {
            fileBuffer = Buffer.from(att.buffer);
          } else if (att.buffer instanceof ArrayBuffer || (att.buffer?.buffer instanceof ArrayBuffer)) {
            fileBuffer = Buffer.from(att.buffer instanceof ArrayBuffer ? att.buffer : att.buffer.buffer);
          } else if (att.buffer?.length > 0) {
            fileBuffer = Buffer.from(att.buffer);
          } else {
            throw new Error(`Empty buffer for ${att.name}`);
          }

          if (fileBuffer.length === 0) throw new Error(`Zero-length buffer for ${att.name}`);

          const fileTypeMap = { pdf: 'pdf', doc: 'doc', docx: 'docx', ppt: 'ppt', pptx: 'pptx', xls: 'xls', xlsx: 'xlsx', txt: 'txt', md: 'md', png: 'png', jpg: 'jpg', jpeg: 'jpeg', gif: 'gif', bmp: 'bmp', webp: 'webp' };
          const adpFileType = fileTypeMap[ext] || ext;
          const cosResult = await uploadFileToADPCOS(fileBuffer, att.name, adpFileType, att.size, botBizId, tcSecretId, tcSecretKey);
          const fileUrl = cosResult.fileUrl || `https://${cosResult.bucket}.${cosResult.type || 'cos'}.${cosResult.region}.myqcloud.com${cosResult.uploadPath}`;

          if (isImage) {
            enrichedMessage += `\n\n![](${fileUrl})`;
          } else {
            enrichedMessage += `\n\n[${att.name}](${fileUrl})\n\n请阅读以上文档链接中的内容并据此回答。`;
          }
          console.log('[GroupChat] ✅ COS uploaded (Claw mode):', att.name, 'URL:', fileUrl.substring(0, 80) + '...');
          continue;
        } catch (cosErr) {
          console.warn('[GroupChat] COS upload failed:', cosErr.message);
        }
      }

      // 方案 B：File Share 上传
      if (fileShareBaseUrl && fileShareApiKey && att.buffer) {
        try {
          let fileBuffer;
          if (Array.isArray(att.buffer)) fileBuffer = Buffer.from(att.buffer);
          else if (att.buffer instanceof ArrayBuffer || (att.buffer?.buffer instanceof ArrayBuffer)) fileBuffer = Buffer.from(att.buffer instanceof ArrayBuffer ? att.buffer : att.buffer.buffer);
          else if (att.buffer?.length > 0) fileBuffer = Buffer.from(att.buffer);

          if (fileBuffer && fileBuffer.length > 0) {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('file', fileBuffer, { filename: att.name, contentType: att.mimeType || 'application/octet-stream' });
            const shareRes = await fetch(`${fileShareBaseUrl}/api/file-share/upload`, {
              method: 'POST', headers: { 'X-API-Key': fileShareApiKey, ...form.getHeaders() }, body: form, signal: AbortSignal.timeout(30000)
            });
            if (shareRes.ok) {
              const shareData = await shareRes.json();
              const fileUrl = shareData.url || shareData.fileUrl;
              if (fileUrl) {
                if (isImage) {
                  enrichedMessage += `\n\n![](${fileUrl})`;
                } else {
                  enrichedMessage += `\n\n[${att.name}](${fileUrl})\n\n请阅读以上文档链接中的内容并据此回答。`;
                }
                console.log('[GroupChat] ✅ File Share uploaded:', att.name);
                continue;
              }
            }
          }
        } catch (fsErr) {
          console.warn('[GroupChat] File Share upload failed:', fsErr.message);
        }
      }

      // 方案 C：文本内容注入降级（适用于 PDF 等可提取文本的文件）
      if (att.textContent && att.textContent.trim()) {
        const maxLen = 50000;
        const textContent = att.textContent.length > maxLen
          ? att.textContent.substring(0, maxLen) + '\n...（文件过长，已截断）'
          : att.textContent;
        enrichedMessage += `\n\n【附件文件：${att.name}】\n\`\`\`\n${textContent}\n\`\`\``;
        console.log('[GroupChat] ✅ Fallback: text content injected:', att.name);
        continue;
      }

      // 方案 D：所有方式失败，告知用户
      if (!isImage) {
        enrichedMessage += `\n\n[系统提示：文件 "${att.name}" 未能上传。${!hasADPCOSCreds ? '请在设置中配置腾讯云 SecretId/SecretKey/BotBizId 以启用文件上传功能。' : '文件上传服务暂时不可用，请稍后重试。'}]`;
      }
    }
  }

  const engine = new GroupChatEngine(chatId, config);
  _groupChatEngines.set(chatId, engine);

  // 异步执行，不阻塞 IPC 返回
  engine.execute(enrichedMessage).catch(e => {
    console.error('[GroupChatEngine] Unhandled error:', e);
  });

  return { success: true, chatId };
});

// 获取群聊执行状态
ipcMain.handle('expert-chat:get-status', async (event, { chatId }) => {
  const engine = _groupChatEngines.get(chatId);
  if (!engine) return { success: true, status: 'not_found' };
  return {
    success: true,
    status: engine.phase,
    chatId: engine.chatId,
    messageCount: engine.messages.length,
    startedAt: engine.startedAt
  };
});

// 取消群聊执行
ipcMain.handle('expert-chat:cancel', async (event, { chatId }) => {
  const engine = _groupChatEngines.get(chatId);
  if (!engine) return { success: false, error: '群聊不存在' };
  engine.cancel();
  return { success: true };
});

// 群聊记录持久化（存储在 experts.json 中）
ipcMain.handle('expert-chat:save-record', async (event, { record }) => {
  const data = _loadExpertsData();
  if (!data.chatRecords) data.chatRecords = [];
  record.id = record.id || `cr_${Date.now()}`;
  record.savedAt = new Date().toISOString();
  data.chatRecords.unshift(record);
  // 保留最近 200 条
  if (data.chatRecords.length > 200) data.chatRecords = data.chatRecords.slice(0, 200);
  _saveExpertsData(data);
  return { success: true, id: record.id };
});

ipcMain.handle('expert-chat:get-records', async (event, { groupId }) => {
  const data = _loadExpertsData();
  let records = data.chatRecords || [];
  if (groupId) records = records.filter(r => r.groupId === groupId);
  return { success: true, records };
});

ipcMain.handle('expert-chat:delete-record', async (event, { recordId }) => {
  const data = _loadExpertsData();
  if (data.chatRecords) {
    data.chatRecords = data.chatRecords.filter(r => r.id !== recordId);
    _saveExpertsData(data);
  }
  return { success: true };
});

// v2.6: LLM 优化主持人 Prompt
ipcMain.handle('experts:optimize-host-prompt', async (event, { basePrompt, groupName, groupIntro }) => {
  // 获取 ADP 配置（复用现有逻辑）
  let appKey, url;
  if (authState.isLoggedIn && remoteConfig?.adp && !authState.forceLocalConfig) {
    appKey = remoteConfig.adp.app_key;
    url = remoteConfig.adp.url || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  } else {
    appKey = getSetting('adp_app_key');
    url = getSetting('adp_url') || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  }
  url = normalizeADPUrl(url);

  if (!appKey) {
    return { success: false, error: '未配置 ADP AppKey，无法使用 AI 优化' };
  }

  const optimizeSystemPrompt = `你是一位专业的 AI Prompt 工程师。你的任务是将以下专家团主持人的基础 Prompt 优化为更专业、更精准的版本。

优化要求：
1. 保留所有专家的 ID、名称和核心能力描述，不可遗漏
2. 根据每个专家的专业领域，给出更具体的协同建议（哪些类型的任务适合分配给哪个专家）
3. 如果专家团有简介，结合简介深化主持人的角色定位
4. 优化任务分配策略的描述，让主持人更清楚如何拆解不同类型的用户请求
5. 保持输出格式约束不变（JSON 格式要求）
6. Prompt 语言简洁有力，避免冗余，总长度不超过 1500 字

只输出优化后的 Prompt 文本，不要加任何解释、注释或 markdown 格式。`;

  const conversationId = `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const visitorId = 'memora_prompt_optimizer';
  const requestId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

  const requestBody = {
    AppKey: appKey,
    ConversationId: conversationId,
    VisitorId: visitorId,
    Contents: [{ Type: 'text', Text: basePrompt }],
    RequestId: requestId,
    Stream: 'enable',
    SystemRole: optimizeSystemPrompt
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
      return { success: false, error: `ADP 请求失败: ${response.status}` };
    }

    // 非流式读取完整响应
    const fullText = await _collectSSEText(response);
    if (!fullText || fullText.trim().length < 50) {
      return { success: false, error: 'AI 返回内容过短，请重试' };
    }

    return { success: true, optimizedPrompt: fullText.trim() };
  } catch (err) {
    console.error('[Experts] Optimize host prompt failed:', err);
    return { success: false, error: `优化失败: ${err.message}` };
  }
});

// 辅助：收集 SSE 流式响应的完整文本
async function _collectSSEText(response) {
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data === '[DONE]') return fullText;
        try {
          const json = JSON.parse(data);
          // V2 格式
          if (json.type === 'text.delta' && json.data?.text) {
            fullText += json.data.text;
          } else if (json.type === 'message.done' || json.type === 'response.completed') {
            return fullText;
          }
          // V1 格式兼容
          if (json.event === 'reply' && json.payload?.content) {
            fullText += json.payload.content;
            if (json.payload.is_final) return fullText;
          }
        } catch (e) { /* 忽略非 JSON 行 */ }
      }
    }
  }
  return fullText;
}

// 记忆系统相关
ipcMain.handle('get-memories', async (event, options) => {
  if (!memoryStore) return { memories: [] };
  return { memories: memoryStore.getMemories(options || {}) };
});

ipcMain.handle('add-memory', async (event, memory) => {
  if (!memoryStore) return { success: false };
  const result = memoryStore.addMemory(memory);
  // v3.1: 异步向量化
  if (result) vectorQueue?.enqueue('upsert', 'memories', result);
  return { success: true, memory: result };
});

ipcMain.handle('update-memory', async (event, id, updates) => {
  if (!memoryStore) return { success: false };
  const result = memoryStore.updateMemory(id, updates);
  // v3.1: 异步向量化更新
  if (result) vectorQueue?.enqueue('upsert', 'memories', result);
  return { success: true, memory: result };
});

ipcMain.handle('delete-memory', async (event, id) => {
  if (!memoryStore) return { success: false };
  memoryStore.deleteMemory(id);
  // v3.1: 异步删除向量
  vectorQueue?.enqueue('delete', 'memories', { id });
  return { success: true };
});

// 清空所有记忆
ipcMain.handle('clear-all-memories', async () => {
  if (!memoryStore) return { success: false };
  memoryStore.clearAll();
  return { success: true };
});

ipcMain.handle('get-memory-stats', async () => {
  if (!memoryStore) return {};
  return memoryStore.getStats();
});

ipcMain.handle('get-entity-graph', async () => {
  if (!memoryStore) return {};
  return memoryStore.getEntityGraph();
});

ipcMain.handle('search-related-memories', async (event, content) => {
  if (!memoryStore) return { memories: [] };
  return { memories: memoryStore.searchRelated(content) };
});

// === AI 整理单条记忆 ===
ipcMain.handle('memory:ai-organize', async (event, content) => {
  try {
    if (!canMakeAICall()) return { success: false, error: '每日调用次数已达上限' };

    // 获取相关历史记忆做参照
    const relatedMemories = memoryStore ? memoryStore.searchRelated(content, 5) : [];
    const relatedText = relatedMemories.length > 0
      ? relatedMemories.map(m => `- [${m.type}/${m.business_category || 'other'}] ${m.content}`).join('\n')
      : '无';

    const systemPrompt = `你是忆境 Memora 的记忆整理 AI。整理用户输入的记忆，输出严格 JSON：
{
  "organized_content": "整理后的简洁摘要",
  "memory_type": "instant|short|long",
  "business_category": "product|project|case|work|bidding|consulting|solution|problem|badcase|requirement|customer|personal|other",
  "category": "knowledge|preference|fact|skill|experience",
  "confidence": 0.0-1.0,
  "related_actions": {
    "should_merge_with": "需合并的历史记忆内容或null",
    "should_replace": "需覆盖的历史记忆内容或null",
    "should_link_to": ["需关联的记忆内容"],
    "action_reason": "原因或null"
  },
  "tags": ["标签"],
  "key_points": ["要点"]
}
分类：instant=临时, short=近期, long=长期有价值。只输出JSON。`;

    const { response } = await callAI({
      module: 'memory_extract',
      category: 'highvol',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `记忆内容：${content}\n\n相关历史记忆：\n${relatedText}` }
      ],
      fetchOptions: { temperature: 0.1, max_tokens: 4096 },
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      return { success: false, error: `AI 请求失败: ${response.status} ${errBody.substring(0, 200)}` };
    }
    incrementAICallCount();

    const data = await response.json();
    let aiContent = data.choices?.[0]?.message?.content || '';
    
    // 检查是否被截断
    const finishReason = data.choices?.[0]?.finish_reason;
    if (finishReason === 'length') {
      return { success: false, error: 'AI 输出被截断，请缩短记忆内容后重试' };
    }
    
    aiContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(aiContent);
    } catch (e) {
      // 尝试提取 JSON 对象
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          return { success: false, error: `AI 返回 JSON 解析失败，原始内容前200字符: ${aiContent.substring(0, 200)}` };
        }
      } else {
        return { success: false, error: `AI 未返回有效 JSON，原始内容前200字符: ${aiContent.substring(0, 200)}` };
      }
    }

    // 执行关联操作
    if (memoryStore && parsed.related_actions) {
      const actions = parsed.related_actions;

      // 如果需要覆盖旧记忆
      if (actions.should_replace) {
        const oldMemories = memoryStore.searchRelated(actions.should_replace, 1);
        if (oldMemories.length > 0) {
          memoryStore.updateMemory(oldMemories[0].id, {
            content: parsed.organized_content,
            type: parsed.memory_type,
            business_category: parsed.business_category,
            category: parsed.category,
            confidence: parsed.confidence,
            metadata: { ...oldMemories[0].metadata, tags: parsed.tags, key_points: parsed.key_points, reorganized_at: new Date().toISOString() }
          });
          return { success: true, organized: parsed, action: 'replaced', replaced_id: oldMemories[0].id };
        }
      }

      // 如果需要合并旧记忆
      if (actions.should_merge_with) {
        const oldMemories = memoryStore.searchRelated(actions.should_merge_with, 1);
        if (oldMemories.length > 0) {
          const mergedContent = oldMemories[0].content + '；' + parsed.organized_content;
          memoryStore.updateMemory(oldMemories[0].id, {
            content: mergedContent,
            type: parsed.memory_type,
            business_category: parsed.business_category,
            confidence: Math.max(oldMemories[0].confidence || 0.5, parsed.confidence),
            metadata: { ...oldMemories[0].metadata, tags: parsed.tags, key_points: parsed.key_points, merged_at: new Date().toISOString() }
          });
          return { success: true, organized: parsed, action: 'merged', merged_id: oldMemories[0].id };
        }
      }
    }

    // 无需覆盖/合并，直接作为新记忆添加
    return { success: true, organized: parsed, action: 'new' };

  } catch (error) {
    console.error('[Memory] AI organize failed:', error);
    return { success: false, error: error.message };
  }
});

// === AI 批量整理记忆 ===
ipcMain.handle('memory:ai-batch-organize', async () => {
  try {
    if (!canMakeAICall()) return { success: false, error: '每日调用次数已达上限' };
    if (!canMakeAICall()) return { success: false, error: '每日调用次数已达上限' };

    if (!memoryStore) return { success: false, error: '记忆系统未初始化' };

    // 取最近的记忆
    const memories = memoryStore.getMemories({ limit: 30 });
    if (memories.length === 0) return { success: false, error: '没有记忆可以整理' };

    const memoriesText = memories.map((m, i) =>
      `[${i+1}] (${m.type}/${m.business_category || 'other'}) ${m.content}`
    ).join('\n');

    const systemPrompt = `你是忆境 Memora 的记忆批量整理 AI。分析用户提供的记忆条目，输出整理建议JSON：
{
  "merge_groups": [{"indices":[1,3],"merged_content":"合并后内容","type":"short|long","business_category":"...","reason":"原因"}],
  "replacements": [{"old_index":2,"new_content":"更新内容","reason":"原因"}],
  "reclassify": [{"index":5,"old_type":"short","new_type":"long","old_biz":"other","new_biz":"work","reason":"原因"}],
  "associations": [{"from_index":1,"to_index":4,"relation":"关联描述"}],
  "summary": "分析总结"
}
规则：合并保留最完整信息；覆盖仅在新信息完全取代旧信息时用；只输出JSON。`;

    const { response } = await callAI({
      module: 'memory_organize',
      category: 'highvol',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: memoriesText }
      ],
      fetchOptions: { temperature: 0.1, max_tokens: 4096 },
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      return { success: false, error: `AI 请求失败: ${response.status} ${errBody.substring(0, 200)}` };
    }
    incrementAICallCount();

    const data = await response.json();
    let aiContent = data.choices?.[0]?.message?.content || '';
    
    // 检查是否被截断
    const finishReason = data.choices?.[0]?.finish_reason;
    if (finishReason === 'length') {
      return { success: false, error: 'AI 输出被截断（记忆太多），请减少记忆数量后重试' };
    }
    
    aiContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(aiContent);
    } catch (e) {
      // 尝试提取 JSON 对象
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          return { success: false, error: `AI 返回 JSON 解析失败，原始内容前200字符: ${aiContent.substring(0, 200)}` };
        }
      } else {
        return { success: false, error: `AI 未返回有效 JSON，原始内容前200字符: ${aiContent.substring(0, 200)}` };
      }
    }

    // 将 index 映射回 memory id
    const indexMap = memories.map((m, i) => ({ index: i + 1, id: m.id, content: m.content }));

    const mergeGroups = (parsed.merge_groups || []).map(g => ({
      ...g,
      memoryIds: g.indices.map(idx => indexMap.find(m => m.index === idx)?.id).filter(Boolean)
    }));

    const replacements = (parsed.replacements || []).map(r => ({
      ...r,
      memoryId: indexMap.find(m => m.index === r.old_index)?.id
    })).filter(r => r.memoryId);

    const reclassify = (parsed.reclassify || []).map(r => ({
      ...r,
      memoryId: indexMap.find(m => m.index === r.index)?.id
    })).filter(r => r.memoryId);

    return {
      success: true,
      result: {
        merge_groups: mergeGroups,
        replacements: replacements,
        reclassify: reclassify,
        associations: parsed.associations || [],
        summary: parsed.summary || '',
        total_analyzed: memories.length
      }
    };

  } catch (error) {
    console.error('[Memory] AI batch organize failed:', error);
    return { success: false, error: error.message };
  }
});

// 清空已处理的剪切板哈希记录（用于测试）
ipcMain.handle('clear-clipboard-hashes', async () => {
  processedClipboardHashes.clear();
  // 同时清除 scheduler 的 lastClipboardText，允许重新检测
  const scheduler = getScheduler();
  if (scheduler) {
    scheduler.lastClipboardText = '';
    scheduler.clearProcessedHashes();
  }
  console.log('[Clipboard] Hashes cleared (包括 scheduler 缓存)');
  return { success: true };
});

// 获取已处理的剪切板数量
ipcMain.handle('get-clipboard-hash-count', async () => {
  return processedClipboardHashes.size;
});

// 获取剪贴板监控配置
ipcMain.handle('clipboard:get-config', async () => {
  return {
    buffer_enabled: getSetting('clipboard_buffer_enabled') !== false,
    freq_enabled: getSetting('clipboard_freq_enabled') !== false,
    association_enabled: getSetting('clipboard_association_enabled') !== false,
    split_prompt_enabled: getSetting('clipboard_split_prompt_enabled') !== false,
    pause_on_lock: getSetting('clipboard_pause_on_lock') !== false,
    stable_timeout_normal: parseInt(getSetting('clipboard_stable_timeout_normal')) || 3000,
    stable_timeout_highfreq: parseInt(getSetting('clipboard_stable_timeout_highfreq')) || 5000,
    stable_timeout_ultrafreq: parseInt(getSetting('clipboard_stable_timeout_ultrafreq')) || 8000,
    max_fragments: parseInt(getSetting('clipboard_max_fragments')) || 20,
    max_total_length: parseInt(getSetting('clipboard_max_total_length')) || 3000,
    // 频率配置
    freq_active: parseInt(getSetting('clipboard_freq_active')) || 200,
    freq_normal: parseInt(getSetting('clipboard_freq_normal')) || 800,
    freq_idle: parseInt(getSetting('clipboard_freq_idle')) || 15000,
    freq_disabled: parseInt(getSetting('clipboard_freq_disabled')) || 10000,
    active_threshold: parseInt(getSetting('clipboard_active_threshold')) || 10000,
    idle_threshold: parseInt(getSetting('clipboard_idle_threshold')) || 60000,
  };
});

// 更新剪贴板监控配置
ipcMain.handle('clipboard:update-config', async (event, config) => {
  const allowedKeys = [
    'clipboard_buffer_enabled', 'clipboard_freq_enabled', 'clipboard_association_enabled',
    'clipboard_split_prompt_enabled', 'clipboard_pause_on_lock',
    'clipboard_stable_timeout_normal', 'clipboard_stable_timeout_highfreq',
    'clipboard_stable_timeout_ultrafreq', 'clipboard_max_fragments', 'clipboard_max_total_length',
    'clipboard_freq_active', 'clipboard_freq_normal', 'clipboard_freq_idle', 'clipboard_freq_disabled',
    'clipboard_active_threshold', 'clipboard_idle_threshold'
  ];
  for (const [key, value] of Object.entries(config)) {
    if (allowedKeys.includes(key)) {
      setSetting(key, value);
    }
  }
  console.log('[Clipboard] Config updated:', config);
  // 通知 scheduler 更新频率配置（实时生效，无需重启）
  const scheduler = getScheduler();
  if (scheduler && scheduler.updateFreqConfig) {
    scheduler.updateFreqConfig();
  }
  return { success: true };
});

// 🔧 剪贴板自诊断命令（DevTools 中调用: await window.electronAPI.clipboardDiagnostic()）
ipcMain.handle('clipboard:diagnostic', async () => {
  const diag = {
    timestamp: new Date().toISOString(),
    scheduler: null,
    clipboard: null,
    apiConfig: null,
    aiCalls: null,
    settings: null
  };

  // 1. Scheduler 状态
  const scheduler = getScheduler();
  if (scheduler) {
    diag.scheduler = {
      isRunning: scheduler.isRunning,
      isAnalyzing: scheduler.isAnalyzing,
      lastClipboardText: scheduler.lastClipboardText?.substring(0, 80),
      processedHashesCount: scheduler.processedHashes.size,
      pendingAnalysisCount: scheduler.pendingAnalysis.length,
      bufferFragments: scheduler.buffer.fragmentCount,
      bufferTotalLength: scheduler.buffer.totalLength,
      bufferIsStable: scheduler.buffer.isStable,
      stateDetectorPaused: scheduler.stateDetector.isPaused,
      freqControllerActive: scheduler.freqController.isActive(),
      computedInterval: scheduler.freqController.computeInterval(),
      bufferEnabled: scheduler._isEnabled('clipboard_buffer_enabled'),
      freqEnabled: scheduler._isEnabled('clipboard_freq_enabled'),
    };
  } else {
    diag.scheduler = '❌ Scheduler 不存在！initClipboardWatcher 可能失败了';
  }

  // 2. 当前剪贴板内容
  try {
    const currentText = clipboard.readText();
    diag.clipboard = {
      currentText: currentText?.substring(0, 100) || '(空)',
      length: currentText?.length || 0,
      hash: currentText ? getClipboardHash(currentText) : null,
      isProcessed: currentText ? processedClipboardHashes.has(getClipboardHash(currentText)) : null,
    };
  } catch (e) {
    diag.clipboard = `❌ 读取失败: ${e.message}`;
  }

  // 3. API 配置
  try {
    const config = getAPIConfig();
    diag.apiConfig = {
      baseUrl: config.baseUrl,
      model: config.model,
      hasApiKey: !!config.apiKey,
      isCustomKey: config.isCustomKey,
      dailyLimit: config.dailyLimit,
    };
  } catch (e) {
    diag.apiConfig = `❌ 获取失败: ${e.message}`;
  }

  // 4. AI 调用计数
  initAICallCount();
  diag.aiCalls = {
    count: parseInt(getSetting(AI_CALLS_KEY) || '0'),
    date: getSetting(AI_CALLS_DATE_KEY),
    canCall: canMakeAICall(),
  };

  // 4.5 聚类调用统计
  diag.clusteringCalls = getClusteringCallStats();

  // 5. 关键设置
  diag.settings = {
    clipboard_buffer_enabled: getSetting('clipboard_buffer_enabled'),
    clipboard_freq_enabled: getSetting('clipboard_freq_enabled'),
    clipboard_association_enabled: getSetting('clipboard_association_enabled'),
    api_key: getSetting('api_key') ? '(已设置)' : '(未设置)',
    api_base_url: getSetting('api_base_url'),
    api_model: getSetting('api_model'),
  };

  console.log('[Diagnostic] 🔍 完整诊断结果:', JSON.stringify(diag, null, 2));
  return diag;
});

// 🔧 强制分析当前剪贴板内容（绕过所有缓存和去重）
ipcMain.handle('clipboard:force-analyze', async () => {
  const text = clipboard.readText();
  if (!text) return { error: '剪贴板为空' };
  
  // 清除所有缓存
  processedClipboardHashes.clear();
  const scheduler = getScheduler();
  if (scheduler) {
    scheduler.lastClipboardText = '';
    scheduler.clearProcessedHashes();
    scheduler.isAnalyzing = false;
  }
  
  console.log(`[Diagnostic] 🔨 强制分析: "${text.substring(0, 80)}..." (${text.length}字)`);
  
  // 直接调用分析
  try {
    await analyzeClipboardText(text);
    return { success: true, textLength: text.length };
  } catch (e) {
    return { error: e.message };
  }
});

// ========== AI 审计日志 IPC ==========

ipcMain.handle('audit:query', async (event, options) => {
  if (!auditLogger) return { records: [], total: 0, page: 1, pageSize: 20, totalPages: 0, stats: null };
  return auditLogger.query(options);
});

ipcMain.handle('audit:modules', async () => {
  if (!auditLogger) return [];
  return auditLogger.getModules();
});

ipcMain.handle('audit:daily-stats', async (event, days) => {
  if (!auditLogger) return [];
  return auditLogger.getDailyStats(days || 7);
});

ipcMain.handle('audit:cleanup', async () => {
  if (!auditLogger) return;
  auditLogger.cleanup();
  return { success: true };
});

// ========== v3.1: 向量数据库 IPC ==========

/**
 * 启动时一致性检查：检测向量索引与原始数据的差异
 */
async function _checkVectorConsistency() {
  if (!vectorIndex || !vectorIndex.initialized) return;
  try {
    const status = vectorIndex.getStatus();
    const noteCount = notebook ? notebook.getAllNotes().length : 0;
    const memoryCount = memoryStore ? (memoryStore.memories?.length || 0) : 0;
    const taskCount = db?.data?.tasks?.length || 0;
    const indexedNoteCount = status.collections.notes?.docCount || 0;
    const indexedMemoryCount = status.collections.memories?.docCount || 0;
    const indexedTaskCount = status.collections.tasks?.docCount || 0;

    const totalDataCount = noteCount + memoryCount + taskCount;
    const totalIndexedCount = indexedNoteCount + indexedMemoryCount + indexedTaskCount;

    // 如果索引为0但有数据，或索引量与数据量差异超过20%，全量重建
    if (totalDataCount > 0 && (totalIndexedCount === 0 || totalIndexedCount < totalDataCount * 0.8)) {
      console.log(`[Vector] Consistency check: data=${totalDataCount} vs indexed=${totalIndexedCount}, auto-rebuilding...`);
      const notes = notebook ? notebook.getAllNotes() : [];
      const memories = memoryStore ? (memoryStore.memories || []) : [];
      const tasks = db?.data?.tasks || [];
      const result = await vectorIndex.rebuildAll(notes, memories, tasks, []);
      console.log('[Vector] Auto-rebuild complete:', result);
    } else {
      console.log(`[Vector] Consistency check passed: notes=${noteCount}/${indexedNoteCount}, memories=${memoryCount}/${indexedMemoryCount}, tasks=${taskCount}/${indexedTaskCount}`);
    }
  } catch (e) {
    console.error('[Vector] Consistency check failed:', e.message);
  }
}

// 混合语义搜索
ipcMain.handle('vector:search', async (event, { query, sources, category, timeRange, limit, topK }) => {
  if (!vectorIndex || !vectorIndex.initialized) {
    return { success: false, error: 'Vector index not initialized', results: [] };
  }
  try {
    const results = await vectorIndex.hybridSearch(query, { sources, category, timeRange, limit, topK });
    return { success: true, results };
  } catch (e) {
    console.error('[Vector] search failed:', e.message);
    return { success: false, error: e.message, results: [] };
  }
});

// 笔记语义搜索
ipcMain.handle('vector:search-notes', async (event, { query, category, limit }) => {
  if (!vectorIndex || !vectorIndex.initialized) {
    return { success: false, error: 'Vector index not initialized', results: [] };
  }
  try {
    const results = await vectorIndex.hybridSearch(query, { sources: ['notes'], category, limit: limit || 20, topK: limit || 20 });
    return { success: true, results };
  } catch (e) {
    return { success: false, error: e.message, results: [] };
  }
});

// RAG 上下文检索
ipcMain.handle('vector:retrieve-rag', async (event, { query, intent, mode }) => {
  if (!unifiedContextLayer) {
    return { success: false, error: 'Context layer not initialized', context: '', sources: [] };
  }
  try {
    const result = await unifiedContextLayer.retrieve(query, { intent, mode: mode || 'adp' });
    return { success: true, ...result };
  } catch (e) {
    console.error('[Vector] RAG retrieve failed:', e.message);
    return { success: false, error: e.message, context: '', sources: [] };
  }
});

// CC 模式上下文检索
ipcMain.handle('vector:retrieve-cc', async (event, { query, workdir }) => {
  if (!unifiedContextLayer) {
    return { success: false, error: 'Context layer not initialized', context: '', sources: [] };
  }
  try {
    const result = await unifiedContextLayer.retrieve(query, {
      mode: 'cc',
      topK: 5,
      tokenBudget: 1000,
      sources: ['memories', 'notes'],
    });
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.message, context: '', sources: [] };
  }
});

// 全量重建索引
ipcMain.handle('vector:rebuild', async () => {
  if (!vectorIndex || !vectorIndex.initialized) {
    return { success: false, error: 'Vector index not initialized' };
  }
  try {
    const notes = notebook ? notebook.getAllNotes() : [];
    const memories = memoryStore ? (memoryStore.memories || []) : [];
    const tasks = db?.data?.tasks || [];
    const result = await vectorIndex.rebuildAll(notes, memories, tasks, []);
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 索引状态
ipcMain.handle('vector:status', async () => {
  if (!vectorIndex) return { success: false, initialized: false };
  return {
    success: true,
    ...vectorIndex.getStatus(),
    queue: vectorQueue?.getStats(),
    // v3.1.2: 诊断信息
    embeddingProvider: embeddingService?.getProvider?.() || 'unknown',
    embeddingDim: embeddingService?.getDimension?.() || 0,
    contextLayerReady: !!unifiedContextLayer,
    contextLayerSkipped: unifiedContextLayer ? null : 'unifiedContextLayer is null (vectorIndex init may have failed)',
  };
});

// 浏览向量库内容（分页查看）
ipcMain.handle('vector:browse', async (event, { collection, limit, offset }) => {
  if (!vectorIndex || !vectorIndex.initialized) {
    return { success: false, error: 'Vector index not initialized', docs: [] };
  }
  const col = vectorIndex.collections[collection];
  if (!col) return { success: false, error: 'Collection not found: ' + collection, docs: [] };

  try {
    const stats = col.stats;
    const topk = Math.min(limit || 50, 200);
    // 用空 filter 查询所有，利用 topk 限制
    const results = col.querySync({ topk, filter: '' });
    const start = offset || 0;
    const paged = results.slice(start, start + topk);

    return {
      success: true,
      collection,
      total: stats.docCount,
      docs: paged.map(doc => {
        const f = doc.fields || {};
        return {
          id: doc.id,
          score: doc.score,
          title: f.title || f.content?.substring(0, 60) || f.note_id || f.memory_id || f.task_id || f.atom_id || doc.id,
          content: f.content?.substring(0, 200) || '',
          category: f.category || '',
          type: f.type || '',
          status: f.status || '',
          created_at: f.created_at ? new Date(f.created_at).toLocaleString('zh-CN') : '',
          source_id: f.note_id || f.memory_id || f.task_id || f.atom_id || '',
        };
      }),
    };
  } catch (e) {
    return { success: false, error: e.message, docs: [] };
  }
});

// 向量库搜索测试
ipcMain.handle('vector:debug-search', async (event, { query, collection, topK }) => {
  if (!vectorIndex || !vectorIndex.initialized) {
    return { success: false, error: 'Vector index not initialized', results: [] };
  }
  try {
    const sources = collection ? [collection] : ['notes', 'memories', 'tasks', 'knowledge'];
    const results = await vectorIndex.hybridSearch(query, { sources, topK: topK || 10, limit: topK || 10 });
    return { success: true, query, results };
  } catch (e) {
    return { success: false, error: e.message, results: [] };
  }
});

// 队列状态
ipcMain.handle('vector:queue-status', async () => {
  if (!vectorQueue) return { success: false };
  return { success: true, ...vectorQueue.getStats() };
});

// v3.1.2: 诊断 — 测试统一上下文层检索（从 DevTools 调用）
ipcMain.handle('vector:diagnose-context', async (event, { query }) => {
  const result = {
    embeddingProvider: embeddingService?.getProvider?.() || 'unknown',
    embeddingDim: embeddingService?.getDimension?.() || 0,
    vectorIndexInitialized: !!vectorIndex?.initialized,
    contextLayerReady: !!unifiedContextLayer,
  };

  if (!unifiedContextLayer) {
    result.error = 'unifiedContextLayer is null — vectorIndex.init() may have failed. Check main process logs for [Vector] errors.';
    return result;
  }

  try {
    const retrieveResult = await unifiedContextLayer.retrieve(query || '测试查询', {
      mode: 'cc',
      topK: 5,
      sources: ['notes', 'memories', 'tasks'],
    });
    result.retrieve = {
      context_length: retrieveResult.context?.length || 0,
      sources_count: retrieveResult.sources?.length || 0,
      sources: retrieveResult.sources?.map(s => ({ type: s.source_type, title: (s.title || '').substring(0, 30), score: s.score?.toFixed(4) })),
      meta: retrieveResult.retrieval_meta,
    };
    if (retrieveResult.context) {
      result.context_preview = retrieveResult.context.substring(0, 200);
    }
  } catch (e) {
    result.error = 'Retrieve failed: ' + e.message;
  }

  return result;
});

// v3.1: 记忆利用率统计
ipcMain.handle('memory:utilization', async () => {
  if (!memoryActivation) return { success: false };
  return { success: true, ...memoryActivation.getUtilizationStats() };
});

// v3.1: 记忆晋升检查（手动触发）
ipcMain.handle('memory:check-promotion', async () => {
  if (!memoryActivation) return { success: false };
  const result = await memoryActivation.checkPromotion();
  return { success: true, ...result };
});

// v3.1: 记忆遗忘检查（手动触发）
ipcMain.handle('memory:check-forgetting', async () => {
  if (!memoryActivation) return { success: false };
  const result = await memoryActivation.checkForgetting();
  return { success: true, ...result };
});

// v3.1: Prompt 优化器审计日志
ipcMain.handle('audit:log-prompt-optimization', async (event, data) => {
  if (!auditLogger) return { success: false };
  try {
    auditLogger.log({
      module: 'prompt_optimization',
      action: 'optimize',
      input: {
        prompt_module: data.module,
        old_version: data.old_version,
        bad_cases_count: data.bad_cases_count,
        old_pass_rate: data.old_pass_rate,
      },
      output: {
        new_version: data.new_version,
        new_pass_rate: data.new_pass_rate,
        improvement: data.improvement,
        failure_patterns: data.failure_patterns,
        improvements: data.improvements,
        applied: data.applied,
      },
      timestamp: new Date().toISOString(),
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});


// 渲染进程同步日志（用于在崩溃前精确定位位置）
ipcMain.on('sync-log', (event, msg) => {
  console.log('[Renderer]', msg);
});

// ========== 语音 ASR 实时识别 IPC 处理器 ==========

const { ASREngine } = require('./src/scripts/asr-engine');

let asrEngine = null;
let asrWebContents = null;

// macOS 麦克风权限检查
ipcMain.handle('asr:check-mic-permission', async () => {
  try {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      console.log('[ASR] macOS microphone permission status:', status);
      if (status === 'not-determined') {
        // 请求权限
        const result = await systemPreferences.askForMediaAccess('microphone');
        console.log('[ASR] askForMediaAccess result:', result);
        return { granted: result, status: result ? 'granted' : 'denied' };
      }
      return { granted: status === 'granted', status };
    }
    // 非 macOS 默认有权限
    return { granted: true, status: 'granted' };
  } catch (e) {
    console.error('[ASR] check-mic-permission error:', e);
    return { granted: false, status: 'error', error: e.message };
  }
});

// ASR 配置读写
ipcMain.handle('asr:get-config', async () => {
  return {
    provider: getSetting('asr_provider') || 'volcano',
    volcano: {
      appId: getSetting('asr_volcano_appId') || '',
      token: getSetting('asr_volcano_token') || '',
      cluster: getSetting('asr_volcano_cluster') || 'volcengine_streaming_common',
    },
    tencent: {
      appId: getSetting('asr_tencent_appId') || '',
      secretId: getSetting('asr_tencent_secretId') || '',
      secretKey: getSetting('asr_tencent_secretKey') || '',
      engineModelType: getSetting('asr_tencent_engineModelType') || '16k_zh_en',
    },
  };
});

ipcMain.handle('asr:set-config', async (event, config) => {
  if (config.provider !== undefined) setSetting('asr_provider', config.provider);
  if (config.volcano) {
    if (config.volcano.appId !== undefined) setSetting('asr_volcano_appId', config.volcano.appId);
    if (config.volcano.token !== undefined) setSetting('asr_volcano_token', config.volcano.token);
    if (config.volcano.cluster !== undefined) setSetting('asr_volcano_cluster', config.volcano.cluster);
  }
  if (config.tencent) {
    if (config.tencent.appId !== undefined) setSetting('asr_tencent_appId', config.tencent.appId);
    if (config.tencent.secretId !== undefined) setSetting('asr_tencent_secretId', config.tencent.secretId);
    if (config.tencent.secretKey !== undefined) setSetting('asr_tencent_secretKey', config.tencent.secretKey);
    if (config.tencent.engineModelType !== undefined) setSetting('asr_tencent_engineModelType', config.tencent.engineModelType);
  }
  return { success: true };
});

// 启动 ASR 识别
ipcMain.handle('asr:start', async (event, params) => {
  // 清理上次的资源
  _stopFfmpegPipe();
  if (asrEngine) {
    await asrEngine.stop();
    asrEngine = null;
  }

  asrWebContents = event.sender;
  const provider = params.provider || getSetting('asr_provider') || 'volcano';
  let providerConfig;

  if (provider === 'volcano') {
    providerConfig = {
      appId: getSetting('asr_volcano_appId') || '',
      token: getSetting('asr_volcano_token') || '',
      cluster: getSetting('asr_volcano_cluster') || 'volcengine_streaming_common',
    };
    if (!providerConfig.appId || !providerConfig.token) {
      return { success: false, error: '火山引擎 ASR 未配置，请在设置中填写 AppID 和 Token' };
    }
  } else if (provider === 'tencent') {
    providerConfig = {
      appId: (getSetting('asr_tencent_appId') || '').trim(),
      secretId: (getSetting('asr_tencent_secretId') || '').trim(),
      secretKey: (getSetting('asr_tencent_secretKey') || '').trim(),
      engineModelType: getSetting('asr_tencent_engineModelType') || '16k_zh_en',
    };
    if (!providerConfig.appId || !providerConfig.secretId || !providerConfig.secretKey) {
      return { success: false, error: '腾讯云 ASR 未配置，请在设置中填写 AppID、SecretID 和 SecretKey' };
    }
  } else {
    return { success: false, error: `不支持的 ASR 供应商: ${provider}` };
  }

  try {
    asrEngine = new ASREngine(provider, providerConfig);

    asrEngine.onResult = (text, isFinal, accumulatedText) => {
      if (asrWebContents && !asrWebContents.isDestroyed()) {
        asrWebContents.send('asr:result', { text, isFinal, accumulatedText });
      }
    };
    asrEngine.onError = (err) => {
      console.error('[ASR] Error:', err.message);
      if (asrWebContents && !asrWebContents.isDestroyed()) {
        asrWebContents.send('asr:error', { message: err.message });
      }
    };
    asrEngine.onStart = () => {
      if (asrWebContents && !asrWebContents.isDestroyed()) {
        asrWebContents.send('asr:started', { provider });
      }
    };

    await asrEngine.connect();
    return { success: true, provider };
  } catch (e) {
    asrEngine = null;
    return { success: false, error: e.message };
  }
});

// ── WebM→PCM 转换管道（使用 ffmpeg）
let ffmpegProc = null;
let ffmpegPcmBuffer = Buffer.alloc(0);

function _startFfmpegPipe() {
  if (ffmpegProc) return;
  const { spawn } = require('child_process');
  const path = require('path');
  const fs = require('fs');
  // 优先使用打包的 ffmpeg，回退到系统安装
  let ffmpegPath = process.env.FFMPEG_PATH;
  if (!ffmpegPath) {
    const arch = process.arch; // 'arm64' or 'x64'
    const bundledName = arch === 'arm64' ? 'ffmpeg-arm64' : 'ffmpeg-x64';

    // 尝试多个可能的路径
    const candidates = [];
    if (app.isPackaged) {
      // asarUnpack 模式：resources/** 解包到 app.asar.unpacked/resources/
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'bin', bundledName));
      // extraResources 模式（如果配置了 extraResources）
      candidates.push(path.join(process.resourcesPath, 'bin', bundledName));
      // 直接在 resourcesPath 下
      candidates.push(path.join(process.resourcesPath, 'resources', 'bin', bundledName));
    }
    // 开发模式
    candidates.push(path.join(__dirname, 'resources', 'bin', bundledName));
    // 回退：PATH 中的 ffmpeg
    candidates.push('ffmpeg');

    ffmpegPath = null;
    for (const candidate of candidates) {
      try {
        if (candidate === 'ffmpeg') {
          // 检查系统 PATH 中是否有 ffmpeg
          const { execSync } = require('child_process');
          execSync('which ffmpeg', { stdio: 'pipe' });
          ffmpegPath = 'ffmpeg';
          console.log('[FFmpeg] Using system PATH');
          break;
        }
        // 检查文件存在
        fs.accessSync(candidate, fs.constants.F_OK);
        // 确保有执行权限（打包后可能丢失）
        try {
          fs.chmodSync(candidate, 0o755);
        } catch (e) {
          console.warn('[FFmpeg] chmod failed:', candidate, e.message);
        }
        // 再次验证可执行
        fs.accessSync(candidate, fs.constants.X_OK);
        ffmpegPath = candidate;
        console.log('[FFmpeg] Using bundled:', ffmpegPath);
        break;
      } catch (e) {
        console.log('[FFmpeg] Candidate not usable:', candidate, e.message);
      }
    }

    if (!ffmpegPath) {
      console.error('[FFmpeg] No ffmpeg found in any candidate path');
      // 最后回退，即使可能失败
      ffmpegPath = candidates[candidates.length - 2] || candidates[0];
    }
  }
  ffmpegProc = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'webm',         // 输入格式
    '-i', 'pipe:0',       // 从 stdin 读
    '-f', 's16le',        // 输出原始 PCM (signed 16-bit little-endian)
    '-ar', '16000',       // 采样率 16kHz
    '-ac', '1',           // 单声道
    'pipe:1'              // 输出到 stdout
  ]);

  ffmpegProc.stdout.on('data', (pcmChunk) => {
    if (!asrEngine) return;
    // 分成 6400 字节的小包（16kHz * 16bit * 200ms = 6400 bytes）发送
    ffmpegPcmBuffer = Buffer.concat([ffmpegPcmBuffer, pcmChunk]);
    const chunkSize = 6400;
    while (ffmpegPcmBuffer.length >= chunkSize) {
      asrEngine.sendAudioChunk(ffmpegPcmBuffer.slice(0, chunkSize));
      ffmpegPcmBuffer = ffmpegPcmBuffer.slice(chunkSize);
    }
  });

  ffmpegProc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.error('[FFmpeg]', msg);
  });

  ffmpegProc.on('close', (code) => {
    console.log('[FFmpeg] process closed, code:', code);
    ffmpegProc = null;
    ffmpegPcmBuffer = Buffer.alloc(0);
  });

  ffmpegProc.on('error', (err) => {
    console.error('[FFmpeg] spawn error:', err.message, 'path was:', ffmpegPath);
    ffmpegProc = null;
  });
}

function _stopFfmpegPipe() {
  if (ffmpegProc) {
    try { ffmpegProc.stdin.end(); } catch (_) {}
    ffmpegProc = null;
  }
  ffmpegPcmBuffer = Buffer.alloc(0);
}

// 发送音频片段（WebM/Opus → ffmpeg → PCM → ASR）
ipcMain.handle('asr:audio-chunk', async (event, data) => {
  if (!asrEngine) return { success: false };
  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    // 启动 ffmpeg 管道（首次调用时）
    if (!ffmpegProc) {
      _startFfmpegPipe();
    }

    // 把 WebM 数据写入 ffmpeg stdin
    if (ffmpegProc && ffmpegProc.stdin.writable) {
      ffmpegProc.stdin.write(buffer);
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 停止 ASR 识别
ipcMain.handle('asr:stop', async () => {
  // 先停止 ffmpeg 管道（flush 剩余数据）
  _stopFfmpegPipe();

  if (!asrEngine) return { success: true, text: '' };
  try {
    // 等待 ffmpeg 输出完成（给点时间让剩余 PCM 发出去）
    await new Promise(resolve => setTimeout(resolve, 300));
    const text = await asrEngine.stop();
    const result = { success: true, text: text || asrEngine.getAccumulatedText() };
    asrEngine = null;
    return result;
  } catch (e) {
    asrEngine = null;
    return { success: false, error: e.message };
  }
});

// ========== 记事本相关IPC处理器 ==========

ipcMain.handle('notebook-add-note', async (event, note) => {
  if (!notebook) return { success: false };
  const result = notebook.addNote(note);
  // addNote 返回 null 表示当天重复内容
  if (!result) return { success: true, duplicate: true, note: null };
  // v3.1: 异步向量化
  vectorQueue?.enqueue('upsert', 'notes', result);
  return { success: true, note: result };
});

ipcMain.handle('notebook-search', async (event, query) => {
  if (!notebook) return { notes: [] };
  return { notes: notebook.searchNotes(query) };
});

ipcMain.handle('notebook-get-notes', async (event, category) => {
  if (!notebook) return { notes: [] };
  return { notes: notebook.getNotesByCategory(category) };
});

// 读取记事本图片（返回 base64 data URL，前端直接用 <img src=...>）
ipcMain.handle('notebook:get-image', async (event, imagePath) => {
  try {
    if (!imagePath || imagePath.includes('..')) return { success: false, error: 'Invalid path' };

    // 服务端路径格式: "user_xxx/filename.png" → 尝试读取本地缓存 images/sync_filename.png
    let localImagePath = imagePath;
    if (isServerImagePath(imagePath)) {
      const localFilename = serverPathToLocalFilename(imagePath);
      localImagePath = `images/${localFilename}`;

      // 如果本地缓存不存在，尝试从服务端下载
      const fullLocalPath = path.join(app.getPath('userData'), 'notebook', localImagePath);
      if (!fs.existsSync(fullLocalPath)) {
        if (authState.isLoggedIn) {
          let downloaded = false;
          const server = getAuthServer();
          const baseUrl = server.configUrl || server.authUrl;

          // 方式1：通过静态 URL 直接下载（无需认证，express.static 公开访问）
          try {
            const staticUrl = `${baseUrl}/memora/uploads/note-images/${imagePath}`;
            console.log('[Notebook] Downloading image from server (static):', staticUrl.substring(0, 80) + '...');
            const res = await fetch(staticUrl, { signal: AbortSignal.timeout(15000) });
            if (res.ok) {
              const buffer = Buffer.from(await res.arrayBuffer());
              if (buffer.length > 100) {  // 忽略损坏的小文件
                fs.mkdirSync(path.dirname(fullLocalPath), { recursive: true });
                fs.writeFileSync(fullLocalPath, buffer);
                console.log('[Notebook] ✅ Image downloaded (static):', imagePath, `(${(buffer.length / 1024).toFixed(1)}KB)`);
                downloaded = true;
              } else {
                console.warn('[Notebook] Downloaded image too small (likely corrupted):', buffer.length, 'bytes');
              }
            } else {
              console.warn('[Notebook] Static download failed:', res.status, '- trying authenticated API...');
            }
          } catch (downloadErr) {
            console.warn('[Notebook] Static download error:', downloadErr.message, '- trying authenticated API...');
          }

          // 方式2：静态 URL 404 时，fallback 到带认证的 download API
          // 通过 server_path 查询图片 ID，再通过 /notes/images/:id/download 下载
          if (!downloaded) {
            try {
              console.log('[Notebook] Trying authenticated API for image:', imagePath);
              // 先通过 server_path 查找图片元数据
              const listResult = await syncApiRequest(`/notes/images?limit=50`);
              if (listResult.ok && listResult.images) {
                const imgMeta = listResult.images.find(img => img.server_path === imagePath);
                if (imgMeta) {
                  // 通过 image_id + JWT 认证下载
                  const downloadUrl = `${baseUrl}/memora/sync/notes/images/${imgMeta.id}/download`;
                  const downloadRes = await fetch(downloadUrl, {
                    headers: { 'Authorization': `Bearer ${authState.token}` },
                    signal: AbortSignal.timeout(15000)
                  });
                  if (downloadRes.ok) {
                    const buffer = Buffer.from(await downloadRes.arrayBuffer());
                    if (buffer.length > 100) {
                      fs.mkdirSync(path.dirname(fullLocalPath), { recursive: true });
                      fs.writeFileSync(fullLocalPath, buffer);
                      console.log('[Notebook] ✅ Image downloaded (authenticated API):', imagePath, `(${(buffer.length / 1024).toFixed(1)}KB)`);
                      downloaded = true;
                    }
                  } else {
                    console.warn('[Notebook] Authenticated API download failed:', downloadRes.status);
                  }
                } else {
                  console.warn('[Notebook] Image metadata not found on server:', imagePath);
                }
              }
            } catch (apiErr) {
              console.warn('[Notebook] Authenticated API download error:', apiErr.message);
            }
          }

          if (!downloaded) {
            return { success: false, error: 'Image download failed (static + API)', isServerPath: true };
          }
        } else {
          console.warn('[Notebook] Image not cached and not logged in:', imagePath);
          return { success: false, error: 'Image not cached, sync first', isServerPath: true };
        }
      }
    }

    const fullPath = path.join(app.getPath('userData'), 'notebook', localImagePath);
    if (!fs.existsSync(fullPath)) return { success: false, error: 'File not found' };
    const buffer = fs.readFileSync(fullPath);
    const base64 = buffer.toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;
    return { success: true, dataUrl, size: buffer.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('notebook-get-note', async (event, id) => {
  if (!notebook) return { note: null };
  const note = notebook.getNoteById(id);
  return { note: note };
});

ipcMain.handle('notebook-update-note', async (event, id, updates) => {
  if (!notebook) return { success: false };
  const result = notebook.updateNote(id, updates);
  // 反馈闭环：分类变更记录
  if (result && feedbackLogger && updates.category) {
    const note = notebook.getNoteById(id);
    if (note && note.analysis) {
      feedbackLogger.recordFeedback({
        module: 'clipboard_analysis',
        action: 'edit',
        trace_id: note.analysis.traceId || null,
        ai_output: {
          category: note.analysis.tags ? note.analysis.tags.join(',') : '',
          is_task: note.analysis.isTask,
          needs_recommendation: note.analysis.needsRecommendation
        },
        user_final: { category: updates.category },
        context: { source_input: note.content?.substring(0, 100) },
        reason: updates.category !== (note.analysis.isTask ? 'task' : 'general') ? '用户调整了分类' : '更新笔记'
      });
    }
  }
  // v3.1: 异步向量化更新
  if (result) vectorQueue?.enqueue('upsert', 'notes', result);
  return { success: result !== null, note: result };
});

ipcMain.handle('notebook-delete-note', async (event, id, reason) => {
  if (!notebook) return { success: false };
  // 反馈闭环：删除笔记 = AI 判定有误
  const note = notebook.getNoteById(id);
  if (note && feedbackLogger && note.analysis) {
    feedbackLogger.recordFeedback({
      module: 'clipboard_analysis',
      action: 'reject',
      trace_id: note.analysis.traceId || null,
      ai_output: {
        is_valid_info: true,
        is_task: note.analysis.isTask,
        category: note.category,
        needs_recommendation: note.analysis.needsRecommendation,
        tags: note.analysis.tags
      },
      user_final: { is_valid_info: false },
      context: { source_input: note.content?.substring(0, 100) },
      reason: reason || '用户删除了该笔记（AI 不应保存此内容）'
    });
    console.log('[Feedback] Note deleted - recorded as negative example');
  }

  // 图片笔记：同时删除服务端图片
  if (note && (note.category === 'image' || note.imagePath)) {
    try {
      if (isServerImagePath(note.imagePath)) {
        // 服务端路径，需要通过 API 查找图片 ID 并删除
        const imgListResult = await syncApiRequest(`/notes/images?note_id=${id}&limit=1`, { method: 'GET' });
        if (imgListResult.ok && imgListResult.images?.length > 0) {
          const imgId = imgListResult.images[0].id;
          await deleteNoteImage(imgId);
          console.log('[Sync] Server image deleted for note', id, 'imageId:', imgId);
        }
      }
      // 删除本地图片文件
      if (note.imagePath) {
        const localAbsPath = path.join(app.getPath('userData'), 'notebook', note.imagePath);
        if (fs.existsSync(localAbsPath)) {
          fs.unlinkSync(localAbsPath);
          console.log('[Sync] Local image deleted:', note.imagePath);
        }
      }
    } catch (e) {
      console.warn('[Sync] Failed to delete image for note', id, ':', e.message);
    }
  }

  const result = notebook.deleteNote(id);
  // v3.1: 异步删除向量
  vectorQueue?.enqueue('delete', 'notes', { id });
  return { success: result !== null };
});

ipcMain.handle('notebook-delete-notes-by-category', async (event, category) => {
  if (!notebook) return { success: false };
  const deletedCount = notebook.deleteNotesByCategory(category);
  return { success: true, deletedCount };
});

// 获取 userData 路径（供渲染进程构造本地文件路径）
ipcMain.handle('get-user-data-path', async () => {
  return app.getPath('userData');
});

// ============= Agent 产物系统 =============
const ARTIFACTS_CONFIG_KEY = 'agentArtifactsBasePath';

function getArtifactsBasePath() {
  const customPath = getSetting(ARTIFACTS_CONFIG_KEY);
  if (customPath && fs.existsSync(customPath)) return customPath;
  // 默认：userData/agent-artifacts/
  const defaultPath = path.join(app.getPath('userData'), 'agent-artifacts');
  if (!fs.existsSync(defaultPath)) fs.mkdirSync(defaultPath, { recursive: true });
  return defaultPath;
}

// 获取保存目录
ipcMain.handle('artifacts:get-base-path', async () => {
  return { path: getArtifactsBasePath() };
});

// 更改保存目录
ipcMain.handle('artifacts:change-dir', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Agent 产物保存目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths?.[0]) return { path: null };
  const chosenPath = result.filePaths[0];
  setSetting(ARTIFACTS_CONFIG_KEY, chosenPath);
  return { path: chosenPath };
});

// 在 Finder 中打开保存目录
ipcMain.handle('artifacts:open-dir', async () => {
  const { shell } = require('electron');
  const dirPath = getArtifactsBasePath();
  shell.openPath(dirPath);
});

// 列出所有产物（按日期子目录扫描）
ipcMain.handle('artifacts:list', async () => {
  const basePath = getArtifactsBasePath();
  const artifacts = [];

  try {
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(basePath, entry.name);
      if (entry.isDirectory()) {
        // 日期子目录，如 2026-06-12
        const dateFolder = entry.name;
        try {
          const files = fs.readdirSync(fullPath);
          for (const file of files) {
            // 过滤隐藏文件（以 . 开头）
            if (file.startsWith('.')) continue;
            const filePath = path.join(fullPath, file);
            try {
              const stat = fs.statSync(filePath);
              if (stat.isFile()) {
                const ext = file.split('.').pop()?.toLowerCase() || '';
                artifacts.push({
                  name: file,
                  ext,
                  path: filePath,
                  size: stat.size,
                  created_at: stat.birthtime?.toISOString() || stat.mtime?.toISOString() || '',
                  dateFolder
                });
              }
            } catch {}
          }
        } catch {}
      } else if (entry.isFile()) {
        // 过滤隐藏文件
        if (entry.name.startsWith('.')) continue;
        // 根目录下的文件（兼容旧数据）
        const ext = entry.name.split('.').pop()?.toLowerCase() || '';
        try {
          const stat = fs.statSync(fullPath);
          artifacts.push({
            name: entry.name,
            ext,
            path: fullPath,
            size: stat.size,
            created_at: stat.birthtime?.toISOString() || stat.mtime?.toISOString() || '',
            dateFolder: '未分类'
          });
        } catch {}
      }
    }
  } catch (err) {
    console.error('[Artifacts] List error:', err);
  }

  // 按 created_at 倒序排序，同一任务的文件（时间相近）自然临近
  artifacts.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  return { artifacts };
});

// 读取产物文件内容
ipcMain.handle('artifacts:read', async (event, { filePath }) => {
  try {
    // 安全检查：文件路径必须在 basePath 下
    const basePath = getArtifactsBasePath();
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(basePath))) {
      return { success: false, error: '非法路径' };
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 删除产物文件
ipcMain.handle('artifacts:delete', async (event, { filePath }) => {
  try {
    const basePath = getArtifactsBasePath();
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(basePath))) {
      return { success: false, error: '非法路径' };
    }
    fs.unlinkSync(resolved);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 在 Finder 中显示文件
ipcMain.handle('artifacts:show-in-folder', async (event, { filePath }) => {
  try {
    const { shell } = require('electron');
    const basePath = getArtifactsBasePath();
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(basePath))) return;
    shell.showItemInFolder(resolved);
  } catch {}
});

// 读取 src/data/ 目录下的数据文件（供渲染进程加载图谱数据）
ipcMain.handle('read-data-file', async (event, fileName) => {
  try {
    const dataPath = path.join(__dirname, 'src', 'data', fileName);
    if (fs.existsSync(dataPath)) {
      const content = fs.readFileSync(dataPath, 'utf-8');
      return content;
    }
    return null;
  } catch (e) {
    console.error('[read-data-file] Error:', e.message);
    return null;
  }
});

// ===== 图谱语义检索 (GraphRAG) =====

// 图谱文件导入：读取文件内容并提取文本
ipcMain.handle('graph:read-file', async (event, filePath) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    if (['.txt', '.md', '.csv', '.json'].includes(ext)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, text: content, fileName, ext: ext.slice(1) };
    }

    if (['.xlsx', '.xls'].includes(ext)) {
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(filePath);
      const sheets = [];
      workbook.SheetNames.forEach(name => {
        const ws = workbook.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        // 转为文本表格
        const text = rows.map(r => r.map(c => String(c || '')).join('\t')).join('\n');
        sheets.push(`=== 工作表: ${name} ===\n${text}`);
      });
      return { success: true, text: sheets.join('\n\n'), fileName, ext: ext.slice(1) };
    }

    if (ext === '.docx') {
      // .docx 是 zip 文件，提取 word/document.xml 中的文本
      const { execSync } = require('child_process');
      try {
        // 尝试用 unzip 提取
        const tmpXml = `/tmp/docx_extract_${Date.now()}.xml`;
        execSync(`unzip -p "${filePath}" word/document.xml > "${tmpXml}"`);
        const xml = fs.readFileSync(tmpXml, 'utf-8');
        fs.unlinkSync(tmpXml);
        // 从 XML 中提取文本节点
        const text = xml
          .replace(/<w:p[^>]*>/g, '\n')
          .replace(/<w:tab[^>]*\/>/g, '\t')
          .replace(/<[^>]+>/g, '')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return { success: true, text, fileName, ext: 'docx' };
      } catch (extractErr) {
        return { success: false, error: `无法解析 .docx 文件: ${extractErr.message}` };
      }
    }

    if (ext === '.pdf') {
      // PDF 文本提取：尝试用 pdftotext（系统命令）
      const { execSync } = require('child_process');
      try {
        const tmpTxt = `/tmp/pdf_extract_${Date.now()}.txt`;
        execSync(`pdftotext "${filePath}" "${tmpTxt}" 2>/dev/null`, { stdio: 'pipe' });
        const text = fs.readFileSync(tmpTxt, 'utf-8');
        fs.unlinkSync(tmpTxt);
        return { success: true, text, fileName, ext: 'pdf' };
      } catch {
        return { success: false, error: 'PDF 解析需要安装 pdftotext（poppler）。请将 PDF 内容复制为文本后粘贴导入。' };
      }
    }

    if (ext === '.doc') {
      return { success: false, error: '不支持 .doc 旧格式，请另存为 .docx 或复制文本后粘贴导入。' };
    }

    // 其他格式尝试作为文本读取
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, text: content, fileName, ext: ext.slice(1) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 图谱 AI 生成：从文本中提取实体和关系，返回结构化图谱数据
ipcMain.handle('graph:generate-from-text', async (event, { text, existingContext }) => {
  try {
    // 限制输入文本长度（避免超出 Token 限制）
    const maxChars = 50000;
    const truncatedText = text.length > maxChars ? text.substring(0, maxChars) + '\n\n[... 文本已截断，仅分析前 ' + maxChars + ' 字符 ...]' : text;

    const prompt = `你是一个人脉关系图谱分析专家。请从以下文本中提取所有人物、组织、行业、区域、产品等实体，以及它们之间的关系。

## 已有图谱上下文（用于去重参考）
${existingContext || '（无已有数据）'}

## 文本内容
${truncatedText}

## 提取要求
请提取以下类型的实体和关系，返回**纯JSON格式**（不要markdown代码块，不要解释文字）：

{
  "nodes": [
    {
      "label": "实体类型（必须是以下之一：Architect, Region, Industry, Customer, Sales, Case, Product, Partner, Channel, City）",
      "name": "实体名称",
      "properties": { "该实体的其他属性，如 role/tier/industryL1/industryL2/region 等" }
    }
  ],
  "edges": [
    {
      "type": "关系类型（必须是以下之一：BELONGS_TO, COVERS, SUPPORTS, LEADS, LOCATED_IN, CROSS_REGION, COOPERATES, FOR, IN, USES, CUSTOMER_IN, CONTAINS, SOLD_BY, VIA_CHANNEL, PARTNER_WITH）",
      "source": "源实体名称（必须与 nodes 中的 name 对应）",
      "target": "目标实体名称（必须与 nodes 中的 name 对应）",
      "properties": {}
    }
  ]
}

## 关系类型说明
- BELONGS_TO: 架构师→区域（架构师属于某区域）
- COVERS: 架构师→行业（架构师覆盖某行业）
- SUPPORTS: 架构师→客户（架构师支持某客户）
- LEADS: 架构师→案例（架构师主导某案例）
- LOCATED_IN: 架构师→城市（架构师位于某城市）
- CUSTOMER_IN: 客户→行业/区域（客户属于某行业或区域）
- SOLD_BY: 客户→销售（客户由某销售负责）
- VIA_CHANNEL: 客户→通路（客户通过某通路）
- PARTNER_WITH: 客户→伙伴（客户与伙伴合作）
- FOR: 案例→客户（案例属于某客户）
- IN: 案例→行业（案例属于某行业）
- USES: 案例→产品（案例使用某产品）
- CONTAINS: 区域→城市（区域包含某城市）

## 注意
1. 只提取文本中明确提到的实体和关系，不要编造
2. 实体名称用全称，不要缩写
3. 如果文本是表格数据（如 Excel），每一行可能代表一个客户及其属性
4. 如果已有图谱中存在同名实体，仍然提取它（后续合并时会自动去重）
5. 返回纯 JSON，不要有任何 markdown 格式或解释文字`;

    const { response } = await callAI({
      module: 'graph_import',
      category: 'lowvol',
      messages: [
        { role: 'system', content: '你是一个图谱数据提取专家，只输出纯JSON格式数据，不包含任何markdown或解释文字。' },
        { role: 'user', content: prompt }
      ],
      structured: true
    });

    if (!response || !response.ok) {
      return { success: false, error: 'AI 调用失败，请检查网络或 API 配置' };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (!content) {
      return { success: false, error: 'AI 返回内容为空' };
    }

    // 解析 JSON（兼容 AI 可能返回 markdown 代码块的情况）
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    // 移除可能的前后多余文本
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }

    const graphData = JSON.parse(jsonStr);
    if (!graphData.nodes || !Array.isArray(graphData.nodes)) {
      return { success: false, error: 'AI 返回的数据格式不正确：缺少 nodes 数组' };
    }

    console.log(`[Graph Import] AI extracted ${graphData.nodes?.length || 0} nodes, ${graphData.edges?.length || 0} edges`);
    return { success: true, graphData };
  } catch (e) {
    console.error('[graph:generate-from-text] Error:', e);
    return { success: false, error: e.message };
  }
});

// 图谱实体提取 — 从自然语言查询中提取实体
ipcMain.handle('graph:extract-entities', async (event, query) => {
  try {
    const extractPrompt = `你是一个实体提取助手。从用户的问题中提取以下实体类型，返回纯JSON格式（不要markdown，不要解释）：

{
  "architects": ["架构师姓名，如：邱毅、马磊"],
  "regions": ["区域名称，如：华东、华北、华南"],
  "industries": ["行业名称，如：金融、教育、能源"],
  "customers": ["客户名称，如：重工集团、中国移动"],
  "intent": "问题的核心意图，简短描述"
}

规则：
1. 模糊匹配：用户说"重工集团"可能指"中国重工集团"等，提取原词即可
2. 只提取明确提到的实体，不要猜测
3. 如果没有某类实体，对应数组为空
4. 意图描述不超过20字

用户问题：${query}`;

    const { response } = await callAI({
      module: 'graph_entity_extract',
      category: 'highvol',
      messages: [
        { role: 'system', content: '你是一个精确的实体提取助手，只输出纯JSON。' },
        { role: 'user', content: extractPrompt }
      ],
      fetchOptions: { temperature: 0.1, response_format: { type: 'json_object' } },
    });

    if (response && response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      const entities = JSON.parse(content);
      return { success: true, entities };
    }
    return { success: false, error: 'LLM调用失败', entities: { architects: [], regions: [], industries: [], customers: [], intent: query } };
  } catch (e) {
    console.error('[graph:extract-entities] Error:', e);
    return { success: false, error: e.message, entities: { architects: [], regions: [], industries: [], customers: [], intent: query } };
  }
});

// 图谱语义检索 ADP 流式输出
ipcMain.handle('graph:semantic-search', async (event, { query, graphContext }) => {
  try {
    // 使用统一的 ADP 配置获取
    const adpConfig = await getADPConfigInternal();
    const appKey = adpConfig.appKey;
    const url = adpConfig.url;
    const configSource = appKey ? (authState.isLoggedIn && remoteConfig?.adp ? 'cloud' : 'local') : 'default';

    const sendSSE = (payload) => {
      // 只通过 event.sender 发送（避免双通道导致前端收到重复事件）
      try { event.sender.send('graph:sse-event', payload); } catch (e) {}
    };

    if (!appKey || appKey.trim() === '') {
      console.warn('[GraphRAG] No ADP AppKey configured, returning error');
      sendSSE({ type: 'error', error: '未配置 ADP AppKey，无法进行智能分析。请在设置中配置 ADP AppKey。' });
      return { success: false, error: 'No ADP AppKey' };
    }

    const convId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    const requestId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

    const systemRole = `你是一个人脉图谱分析助手。根据以下图谱数据回答用户的问题。

## 图谱数据
${graphContext}

## 要求
1. 基于图谱数据中的实际信息回答，不要编造
2. 回答使用 Markdown 格式，支持表格、列表、标题
3. 如果数据不足以回答，明确说明"图谱中暂无相关数据"
4. 对于客户列表、架构师列表等结构化信息，优先使用 Markdown 表格展示
5. 回答简洁专业，突出关键信息`;

    const body = {
      AppKey: appKey,
      ConversationId: convId,
      VisitorId: 'memora_graph_user',
      Contents: [{ Type: 'text', Text: query }],
      RequestId: requestId,
      Incremental: true,
      Stream: 'enable',
      SystemRole: systemRole,
    };

    console.log(`[GraphRAG] Starting ADP stream, configSource=${configSource}, url=${url}`);

    const fetchResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!fetchResponse.ok) {
      const errText = await fetchResponse.text();
      sendSSE({ type: 'error', error: `ADP请求失败: ${fetchResponse.status} ${errText}` });
      return { success: false, error: 'ADP request failed' };
    }

    // 立即返回成功，后续通过 IPC 事件流式推送每个 SSE event（与 AI 助手相同模式）
    // 异步处理 SSE 流
    (async () => {
      const reader = fetchResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let currentData = '';
      let fullText = '';
      let firstDeltaLogged = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.replace(/\r$/, '');

            // 跳过 SSE 注释/心跳行
            if (trimmed.startsWith(':')) continue;

            if (trimmed.startsWith('event:')) {
              currentEvent = trimmed.substring(6).trim();
            } else if (trimmed.startsWith('data:')) {
              // 累积 data（支持多行 data: 拼接）
              currentData += trimmed.substring(5).trim();
            } else if (trimmed === '') {
              // SSE 事件边界（空行）— 完整事件处理
              if (!currentData) {
                currentEvent = '';
                continue;
              }

              if (currentData === '[DONE]') {
                console.log(`[GraphRAG] Stream done [DONE], total text: ${fullText.length}`);
                sendSSE({ type: 'done' });
                return;
              }

              try {
                const parsed = JSON.parse(currentData);
                const evt = currentEvent || parsed.Type || parsed.event || '';

                // ADP V2 文本提取（仅 PascalCase，与 AI 助手一致）
                const extractDeltaText = (obj) => {
                  return obj.Text
                    || obj.Content?.[0]?.Text
                    || obj.payload?.content?.[0]?.text
                    || obj.content?.[0]?.text
                    || '';
                };

                // 完成事件
                if (evt === 'message.done' || evt === 'response.completed' || evt === 'done') {
                  console.log(`[GraphRAG] Done event: ${evt}, total text: ${fullText.length}`);
                  sendSSE({ type: 'done' });
                  return;
                }

                // 错误事件
                if (evt === 'error') {
                  const errMsg = parsed.Error?.Message || parsed.error?.message || parsed.message || 'ADP错误';
                  console.error(`[GraphRAG] Error event: ${errMsg}`);
                  sendSSE({ type: 'error', error: errMsg });
                }
                // text.replace 事件 — 替换全部内容
                else if (evt === 'text.replace') {
                  const replaceText = extractDeltaText(parsed);
                  if (replaceText && !replaceText.startsWith('{"')) {
                    fullText = replaceText;
                    sendSSE({ type: 'replace', text: replaceText });
                  }
                }
                // 增量文本事件（仅这些事件类型包含需要追加的文本，与 AI 助手 line 6032 一致）
                else if (evt === 'text.delta' || evt === 'content.added' || evt === 'message.added') {
                  const deltaText = extractDeltaText(parsed);
                  if (deltaText) {
                    fullText += deltaText;
                    if (!firstDeltaLogged) {
                      firstDeltaLogged = true;
                      console.log(`[GraphRAG] First text.delta: "${deltaText.substring(0, 120)}" | event: ${evt}`);
                    }
                    sendSSE({ type: 'text', text: deltaText });
                  }
                }
                // 其他事件（request_ack, response.created, response.processing, quote_info.added 等）不提取文本
              } catch (e) {
                // 非 JSON，忽略
              }

              // 重置当前事件
              currentEvent = '';
              currentData = '';
            }
          }
        }

        // 流自然结束（reader done），处理残留数据
        if (currentData && currentData !== '[DONE]') {
          try {
            const parsed = JSON.parse(currentData);
            const deltaText = parsed.Text
              || parsed.Content?.[0]?.Text
              || parsed.payload?.content?.[0]?.text
              || parsed.content?.[0]?.text
              || '';
            if (deltaText && !deltaText.startsWith('{"')) {
              sendSSE({ type: 'text', text: deltaText });
              fullText += deltaText;
            }
          } catch (e) {}
        }

        console.log(`[GraphRAG] Stream ended naturally, total text: ${fullText.length}`);
        sendSSE({ type: 'done' });
      } catch (err) {
        console.error('[GraphRAG] SSE stream error:', err);
        sendSSE({ type: 'error', error: err.message });
      }
    })();

    // 立即返回（SSE 流在后台异步推送）
    return { success: true };
  } catch (e) {
    console.error('[graph:semantic-search] Error:', e);
    const sendSSE = (payload) => {
      try { event.sender.send('graph:sse-event', payload); } catch (err) {}
    };
    sendSSE({ type: 'error', error: e.message });
    return { success: false, error: e.message };
  }
});

// 保存产物（从 AI 对话中调用）
ipcMain.handle('artifacts:save', async (event, { content, fileName, source }) => {
  try {
    const basePath = getArtifactsBasePath();
    // 按日期创建子目录
    const now = new Date();
    const dateFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dateDir = path.join(basePath, dateFolder);
    if (!fs.existsSync(dateDir)) fs.mkdirSync(dateDir, { recursive: true });

    // 确保文件名安全
    let safeName = (fileName || 'artifact').replace(/[<>:"/\\|?*]/g, '_');
    // 如果文件名没有扩展名，根据内容推断
    if (!path.extname(safeName)) {
      if (content?.trim()?.startsWith('<!DOCTYPE') || content?.trim()?.startsWith('<html')) {
        safeName += '.html';
      } else if (content?.trim()?.startsWith('{') || content?.trim()?.startsWith('[')) {
        safeName += '.json';
      } else {
        safeName += '.txt';
      }
    }

    const filePath = path.join(dateDir, safeName);
    fs.writeFileSync(filePath, content, 'utf-8');

    console.log(`[Artifacts] Saved: ${filePath}`);
    return { success: true, path: filePath, dateFolder, name: safeName };
  } catch (err) {
    console.error('[Artifacts] Save error:', err);
    return { success: false, error: err.message };
  }
});

// 从 URL 下载文件并保存到 Agent 产物目录
ipcMain.handle('artifacts:download-and-save', async (event, { url, fileName }) => {
  try {
    const basePath = getArtifactsBasePath();
    const now = new Date();
    const dateFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dateDir = path.join(basePath, dateFolder);
    if (!fs.existsSync(dateDir)) fs.mkdirSync(dateDir, { recursive: true });

    // 从 URL 或 fileName 推断文件名
    let safeName = fileName || url.split('/').pop()?.split('?')[0] || 'download';
    // URL decode
    try { safeName = decodeURIComponent(safeName); } catch {}
    safeName = safeName.replace(/[<>:"/\\|?*]/g, '_');

    const filePath = path.join(dateDir, safeName);

    // 下载文件
    const https = require('https');
    const http = require('http');
    const protocol = url.startsWith('https') ? https : http;

    const downloadFile = () => new Promise((resolve, reject) => {
      const request = protocol.get(url, { timeout: 30000 }, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadFileAtUrl(res.headers.location, dateDir, safeName).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const stream = fs.createWriteStream(filePath);
        res.pipe(stream);
        stream.on('finish', () => {
          stream.close();
          resolve(filePath);
        });
        stream.on('error', reject);
      });
      request.on('error', reject);
      request.on('timeout', () => { request.destroy(); reject(new Error('下载超时')); });
    });

    // 递归处理重定向
    const downloadFileAtUrl = (targetUrl, dir, name) => new Promise((resolve, reject) => {
      const p = targetUrl.startsWith('https') ? https : http;
      const req = p.get(targetUrl, { timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadFileAtUrl(res.headers.location, dir, name).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const fp = path.join(dir, name);
        const stream = fs.createWriteStream(fp);
        res.pipe(stream);
        stream.on('finish', () => { stream.close(); resolve(fp); });
        stream.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
    });

    const savedPath = await downloadFile();
    console.log(`[Artifacts] Downloaded & saved: ${savedPath}`);
    return { success: true, path: savedPath, dateFolder, name: safeName };
  } catch (err) {
    console.error('[Artifacts] Download error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('notebook-get-stats', async () => {
  if (!notebook) return {};
  return notebook.getStats();
});

// 自定义分类配置
ipcMain.handle('notebook-get-categories', async () => {
  if (!notebook) return { categories: {} };
  return { categories: notebook.getCustomCategories() };
});

ipcMain.handle('notebook-save-categories', async (event, categories) => {
  if (!notebook) return { success: false };
  notebook.saveCustomCategories(categories);
  return { success: true };
});

// 笔记导出为 Markdown
ipcMain.handle('notebook-export-markdown', async (event, { noteIds, defaultName }) => {
  try {
    const { dialog } = require('electron');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出笔记为 Markdown',
      defaultPath: defaultName || 'notes.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled) return { success: false, canceled: true };

    // 收集笔记数据
    const notes = [];
    for (const id of noteIds) {
      const note = notebook.getNoteById(id);
      if (note) notes.push(note);
    }

    if (notes.length === 0) return { success: false, error: '未找到笔记' };

    // 生成 Markdown 内容
    let md = '';
    if (notes.length === 1) {
      // 单条笔记
      const n = notes[0];
      md = `# ${n.title || '无标题'}\n\n`;
      md += n.content + '\n\n';
      md += `---\n`;
      md += `- 分类：${n.category || '未分类'}\n`;
      md += `- 创建时间：${new Date(n.createdAt).toLocaleString('zh-CN')}\n`;
      if (n.tags && n.tags.length) md += `- 标签：${n.tags.join(', ')}\n`;
    } else {
      // 多条笔记合并
      md = `# 笔记合集（${notes.length} 条）\n\n`;
      md += `> 导出时间：${new Date().toLocaleString('zh-CN')}\n\n`;
      md += `---\n\n`;
      notes.forEach((n, i) => {
        md += `## ${i + 1}. ${n.title || '无标题'}\n\n`;
        md += n.content + '\n\n';
        md += `*分类：${n.category || '未分类'} | 创建：${new Date(n.createdAt).toLocaleString('zh-CN')}*\n\n`;
        if (i < notes.length - 1) md += `---\n\n`;
      });
    }

    fs.writeFileSync(result.filePath, md, 'utf-8');
    return { success: true, filePath: result.filePath, count: notes.length };
  } catch (e) {
    console.error('[Notebook] Export error:', e);
    return { success: false, error: e.message };
  }
});

// ========== 知识萃取IPC处理器 ==========

// 知识原子
ipcMain.handle('knowledge:get-atoms', async (event, filter) => {
  if (!knowledgeStore) return { atoms: [] };
  return { atoms: knowledgeStore.getAtoms(filter) };
});

ipcMain.handle('knowledge:get-atom-by-id', async (event, id) => {
  if (!knowledgeStore) return { atom: null };
  return { atom: knowledgeStore.getAtomById(id) };
});

ipcMain.handle('knowledge:add-atom', async (event, atom) => {
  if (!knowledgeStore) return { success: false };
  const result = knowledgeStore.addAtom(atom);
  return { success: !!result, atom: result };
});

ipcMain.handle('knowledge:delete-atom', async (event, id) => {
  if (!knowledgeStore) return { success: false };
  const result = knowledgeStore.deleteAtom(id);
  return { success: !!result };
});

ipcMain.handle('knowledge:update-atom', async (event, id, updates) => {
  if (!knowledgeStore) return { success: false };
  const result = knowledgeStore.updateAtom(id, updates);
  return { success: !!result, atom: result };
});

// 知识簇
ipcMain.handle('knowledge:get-clusters', async (event, filter) => {
  if (!knowledgeStore) return { clusters: [] };
  return { clusters: knowledgeStore.getClusters(filter) };
});

ipcMain.handle('knowledge:get-cluster-by-id', async (event, id) => {
  if (!knowledgeStore) return { cluster: null, atoms: [] };
  const cluster = knowledgeStore.getClusterById(id);
  if (!cluster) return { cluster: null, atoms: [] };
  const atoms = (cluster.atom_ids || []).map(aid => knowledgeStore.getAtomById(aid)).filter(Boolean);
  return { cluster, atoms };
});

ipcMain.handle('knowledge:create-cluster', async (event, cluster) => {
  if (!knowledgeStore) return { success: false };
  const result = knowledgeStore.addCluster(cluster);
  return { success: !!result, cluster: result };
});

ipcMain.handle('knowledge:update-cluster', async (event, id, updates) => {
  if (!knowledgeStore) return { success: false };
  const result = knowledgeStore.updateCluster(id, updates);
  return { success: !!result, cluster: result };
});

ipcMain.handle('knowledge:delete-cluster', async (event, id, atomAction) => {
  if (!knowledgeStore) return { success: false };
  const result = knowledgeStore.deleteCluster(id, atomAction || 'release');
  return { success: !!result };
});

ipcMain.handle('knowledge:cluster-atom', async (event, atomId, clusterId) => {
  if (!knowledgeStore) return { success: false };
  const result = knowledgeStore.clusterAtom(atomId, clusterId);
  return { success: !!result };
});

ipcMain.handle('knowledge:auto-cluster', async () => {
  if (!knowledgeStore) return { started: false, message: '知识库未初始化' };

  // 登录检查：聚类功能需要登录
  if (!authState.isLoggedIn) {
    return { started: false, message: '聚类功能需要登录后使用', needLogin: true };
  }

  // 防止重复启动
  if (clusteringRunning) {
    return { started: false, message: '聚类正在进行中，请等待完成或取消' };
  }

  // 每日调用限制检查
  if (!canMakeClusteringCall()) {
    const stats = getClusteringCallStats();
    return { started: false, message: `今日聚类次数已达上限（${stats.count}/${stats.limit}），明天再试` };
  }

  // 先合并相似簇和清理空簇
  const mergeResult = knowledgeStore.mergeSimilarClusters();
  const cleanupResult = knowledgeStore.cleanupEmptyClusters();
  // 更新簇状态
  for (const cluster of knowledgeStore.getClusters()) {
    if (cluster.status === 'growing' && cluster.atom_ids.length >= 3) {
      knowledgeStore.updateCluster(cluster.id, { status: 'mature' });
    }
  }
  const unclustered = knowledgeStore.getAtoms({ unclustered: true });

  // 异步执行聚类，IPC 立即返回
  clusteringRunning = true;
  autoClusterAtoms().then(result => {
    clusteringRunning = false;
    // 推送完成事件（包含最终结果）
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('knowledge:clustering-complete', {
        ...result,
        unclusteredBefore: unclustered.length,
        message: result.message || null
      });
    }
  }).catch(e => {
    clusteringRunning = false;
    console.error('[Knowledge] Async clustering error:', e);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('knowledge:clustering-complete', {
        clustersCreated: 0, atomsAssigned: 0,
        unclusteredBefore: unclustered.length,
        message: `聚类出错：${e.message}`
      });
    }
  });

  incrementClusteringCallCount();
  return { started: true };
});

// 取消正在进行的聚类
ipcMain.handle('knowledge:cancel-clustering', async () => {
  clusteringAborted = true;
  console.log('[Knowledge] Clustering cancelled by user');
  return { success: true };
});

// 获取聚类调用统计
ipcMain.handle('knowledge:clustering-stats', async () => {
  return getClusteringCallStats();
});

// 知识文章
ipcMain.handle('knowledge:get-articles', async (event, filter) => {
  if (!knowledgeStore) return { articles: [] };
  return { articles: knowledgeStore.getArticles(filter) };
});

ipcMain.handle('knowledge:get-article', async (event, id) => {
  if (!knowledgeStore) return { article: null };
  return { article: knowledgeStore.getArticleById(id) };
});

ipcMain.handle('knowledge:generate-article', async (event, clusterId) => {
  return await generateArticle(clusterId);
});

ipcMain.handle('knowledge:update-article', async (event, id, updates) => {
  if (!knowledgeStore) return { success: false };
  const result = knowledgeStore.updateArticle(id, updates);
  return { success: !!result, article: result };
});

ipcMain.handle('knowledge:delete-article', async (event, id) => {
  if (!knowledgeStore) return { success: false };
  const result = knowledgeStore.deleteArticle(id);
  return { success: !!result };
});

// 统计与领域
ipcMain.handle('knowledge:get-stats', async () => {
  if (!knowledgeStore) return {};
  return knowledgeStore.getStats();
});

ipcMain.handle('knowledge:get-domains', async () => {
  if (!knowledgeStore) return { domains: [] };
  return { domains: knowledgeStore.getDomains() };
});

// 一键萃取：提取+聚类+合成（异步，通过事件推送结果）
ipcMain.handle('knowledge:distill-all', async () => {
  if (!knowledgeStore) return { started: false, message: '知识库未初始化' };

  // 登录检查：聚类功能需要登录
  if (!authState.isLoggedIn) {
    return { started: false, message: '聚类功能需要登录后使用', needLogin: true };
  }

  // 防止重复启动
  if (clusteringRunning) {
    return { started: false, message: '聚类正在进行中，请等待完成或取消' };
  }

  // 每日调用限制检查
  if (!canMakeClusteringCall()) {
    const stats = getClusteringCallStats();
    return { started: false, message: `今日聚类次数已达上限（${stats.count}/${stats.limit}），明天再试` };
  }

  // 异步执行
  clusteringRunning = true;
  (async () => {
    try {
      // 先合并相似簇和清理空簇
      knowledgeStore.mergeSimilarClusters();
      knowledgeStore.cleanupEmptyClusters();
      // 更新簇状态（合并后可能有新 mature 簇）
      for (const cluster of knowledgeStore.getClusters()) {
        if (cluster.status === 'growing' && cluster.atom_ids.length >= 3) {
          knowledgeStore.updateCluster(cluster.id, { status: 'mature' });
        }
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('knowledge:clustering-progress', {
          currentBatch: 0, totalBatches: 1, atomsAssigned: 0,
          message: '正在智能聚类...'
        });
      }

      const clusterResult = await autoClusterAtoms();

      // 自动合成成熟簇的文章
      const matureClusters = knowledgeStore.getClusters({ status: 'mature' });
      const articlesGenerated = [];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('knowledge:clustering-progress', {
          currentBatch: 1, totalBatches: 1, atomsAssigned: clusterResult.atomsAssigned || 0,
          message: `聚类完成，正在生成 ${matureClusters.filter(c => !c.article_id).length} 篇文章...`
        });
      }

      for (const cluster of matureClusters) {
        if (!cluster.article_id) {
          const result = await generateArticle(cluster.id);
          if (result.success) articlesGenerated.push(result.article);
        }
      }

      const distillResult = {
        success: true,
        clustersCreated: clusterResult.clustersCreated,
        atomsAssigned: clusterResult.atomsAssigned,
        articlesGenerated: articlesGenerated.length,
        articles: articlesGenerated,
        cancelled: clusterResult.cancelled || false,
        message: clusterResult.message || null
      };

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('knowledge:clustering-complete', distillResult);
      }
    } catch (e) {
      console.error('[Knowledge] Distill-all error:', e);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('knowledge:clustering-complete', {
          success: false,
          clustersCreated: 0, atomsAssigned: 0,
          articlesGenerated: 0, articles: [],
          message: `萃取出错：${e.message}`
        });
      }
    } finally {
      clusteringRunning = false;
    }
  })();

  incrementClusteringCallCount();
  return { started: true };
});

// 从指定笔记提取原子
ipcMain.handle('knowledge:extract-atoms', async (event, noteId) => {
  if (!knowledgeStore || !notebook) return { success: false };
  const note = notebook.getNoteById(noteId);
  if (!note) return { success: false, error: '笔记不存在' };
  await extractKnowledgeAtoms(note.content, noteId, note.tags || []);
  return { success: true };
});

// ========== 知识图谱 IPC ==========

// 图谱构建/获取
ipcMain.handle('graph:build', async (event, { forceRefresh } = {}) => {
  if (!graphDb) return { stats: { nodeCount: 0 }, error: 'GraphDB 未初始化' };

  try {
    // 非强制刷新时：检查缓存
    if (!forceRefresh) {
      const stats = graphDb.getStats();
      if (stats.nodeCount > 0 && !graphDb.isStale()) {
        const builtAt = graphDb.getBuiltAt();
        if (builtAt) {
          const age = Date.now() - new Date(builtAt).getTime();
          if (age < 24 * 3600 * 1000) {
            console.log('[Graph] Using cached graph, age:', Math.floor(age/3600000), 'hours');
            return { source: 'cache', stats: { ...stats, builtAt } };
          }
        }
      }
    }

    // 检查每日构建限制
    const buildLimit = _checkGraphBuildLimit();
    if (!buildLimit.allowed) {
      return { stats: graphDb.getStats(), error: buildLimit.reason };
    }

    console.log('[Graph] Starting graph build, forceRefresh:', forceRefresh);

    // 调用 ADP 构建
    const summary = _buildGraphSummary();
    const prompt = _buildGraphPrompt(summary);
    console.log('[Graph] Summary: atoms=' + summary.atomCount + ' clusters=' + summary.clusterCount + ' domains=' + Object.keys(summary.domains).length);

    // 标记本次构建已发起（即使后续失败也算一次）
    _recordGraphBuild();

    const graphData = await _callADPForGraph(prompt);

    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
      console.warn('[Graph] ADP returned empty data');
      return { stats: graphDb.getStats(), error: 'ADP 返回数据为空，请稍后再试' };
    }

    console.log('[Graph] Writing to DB: nodes=' + graphData.nodes.length + ' edges=' + (graphData.edges?.length || 0));

    // 写入 SQLite
    graphDb.upsertNodes(graphData.nodes);
    graphDb.upsertEdges(graphData.edges || []);

    // 保存体检报告
    if (graphData.health_report) {
      graphDb.saveHealthReport({
        report_type: 'full',
        built_at: new Date().toISOString(),
        node_count: graphData.nodes.length,
        edge_count: (graphData.edges || []).length,
        ...graphData.health_report
      });
    }

    // 保存已构建的知识源 ID（用于增量构建）
    _saveBuiltKnowledgeSnapshot(summary);

    graphDb.clearStale();
    const stats = graphDb.getStats();
    console.log('[Graph] Build complete: nodes=' + stats.nodeCount + ' edges=' + stats.edgeCount);
    return { source: 'adp', stats: { ...stats, builtAt: new Date().toISOString() } };
  } catch (e) {
    console.error('[Graph] Build error:', e);
    return { stats: graphDb.getStats(), error: e.message };
  }
});

// 查询构建限制
ipcMain.handle('graph:build-limit', async () => {
  const limit = _checkGraphBuildLimit();
  const today = new Date().toISOString().split('T')[0];
  const count = parseInt(getSetting('graph_build_count') || '0', 10);
  const stored = getSetting('graph_build_date');
  return {
    allowed: limit.allowed,
    reason: limit.reason || '',
    usedToday: stored === today ? count : 0,
    dailyLimit: GRAPH_BUILD_DAILY_LIMIT,
  };
});

// 查询节点
ipcMain.handle('graph:get-nodes', async (event, filter) => {
  if (!graphDb) return { nodes: [] };
  return { nodes: graphDb.getNodes(filter || {}) };
});

// 查询边
ipcMain.handle('graph:get-edges', async (event, filter) => {
  if (!graphDb) return { edges: [] };
  return { edges: graphDb.getEdges(filter || {}) };
});

// 全文搜索
ipcMain.handle('graph:search', async (event, { query, limit }) => {
  if (!graphDb) return { nodes: [] };
  return { nodes: graphDb.searchNodes(query, limit || 20) };
});

// 图遍历
ipcMain.handle('graph:neighbors', async (event, { nodeId, depth }) => {
  if (!graphDb) return { nodes: [] };
  return { nodes: graphDb.getNeighbors(nodeId, depth || 1) };
});

// 子图
ipcMain.handle('graph:subgraph', async (event, { nodeId }) => {
  if (!graphDb) return { nodes: [], edges: [] };
  return graphDb.getSubgraph(nodeId);
});

// 缺口详情
ipcMain.handle('graph:gap-detail', async (event, { gapId }) => {
  if (!graphDb) return {};
  const node = graphDb.getNodeById(gapId);
  if (!node) return {};

  const profile = _loadProfile();
  const promptText = fs.readFileSync(path.join(__dirname, 'prompts', 'graph_gap.md'), 'utf8')
    .replace('{{gap_detail}}', JSON.stringify(node))
    .replace('{{user_role}}', profile.role || '')
    .replace('{{industries}}', (profile.industries || []).join(','))
    .replace('{{active_projects}}', (profile.active_projects || []).join(','));

  const result = await _callADPForGraph(promptText);
  return result || {};
});

// 冲突解决
ipcMain.handle('graph:conflict-resolve', async (event, { conflictId, action }) => {
  if (!graphDb) return { success: false };
  // 标记相关节点健康状态
  if (action === 'keep_both') {
    // 找到冲突边并标记为场景差异
    const edges = graphDb.getEdges({ type: 'conflicts_with' });
    // 更新节点健康状态
    graphDb.updateNode(conflictId, { health: 'healthy', health_detail: { reason: '已确认：场景差异，不冲突' } });
  } else if (action === 'merge') {
    graphDb.updateNode(conflictId, { health: 'healthy', health_detail: { reason: '已合并' } });
  }
  graphDb.clearStale();
  return { success: true };
});

// AI 仲裁冲突
ipcMain.handle('graph:conflict-arbitrate', async (event, { conflictId }) => {
  if (!graphDb) return {};
  const node = graphDb.getNodeById(conflictId);
  if (!node) return {};

  const promptText = fs.readFileSync(path.join(__dirname, 'prompts', 'graph_conflict.md'), 'utf8')
    .replace('{{conflict_detail}}', JSON.stringify(node.health_detail || node));

  const result = await _callADPForGraph(promptText);
  return { resolution: result };
});

// 体检报告
ipcMain.handle('graph:health-report', async () => {
  if (!graphDb) return { report: null };
  const report = graphDb.getLatestHealthReport();
  return { report };
});

// 过时知识复审
ipcMain.handle('graph:outdated-review', async (event, { nodeId, action }) => {
  if (!graphDb) return { success: false };
  if (action === 'ignore') {
    graphDb.updateNode(nodeId, { health: 'healthy', health_detail: { reason: '用户确认仍然有效' } });
  } else if (action === 'review') {
    graphDb.updateNode(nodeId, { health: 'healthy', health_detail: { reason: '已复审' } });
  }
  graphDb.clearStale();
  return { success: true };
});

// 图谱统计
ipcMain.handle('graph:stats', async () => {
  if (!graphDb) return { nodeCount: 0, edgeCount: 0 };
  const stats = graphDb.getStats();
  const builtAt = graphDb.getBuiltAt();
  return { ...stats, builtAt };
});

// ========== 图谱辅助函数 ==========

function _buildGraphSummary() {
  const summary = {
    domains: {},
    clusters: [],
    topEntities: [],
    personSummary: [],
    questionList: [],
    outdatedAtoms: [],
    profileProjects: [],
    atomCount: knowledgeStore.atoms.length,
    memoryCount: memoryStore?.memories?.length || 0,
    clusterCount: knowledgeStore.clusters.length
  };

  // 领域分布
  knowledgeStore.atoms.forEach(a => {
    const d = a.domain || '未分类';
    if (!summary.domains[d]) summary.domains[d] = { atomCount: 0, clusterCount: 0, atomTypes: {} };
    summary.domains[d].atomCount++;
    summary.domains[d].atomTypes[a.type] = (summary.domains[d].atomTypes[a.type] || 0) + 1;
  });
  knowledgeStore.clusters.forEach(c => {
    const d = c.domain || '未分类';
    if (!summary.domains[d]) summary.domains[d] = { atomCount: 0, clusterCount: 0, atomTypes: {} };
    summary.domains[d].clusterCount++;
  });

  // 知识簇摘要
  summary.clusters = knowledgeStore.clusters.map(c => ({
    id: c.id, name: c.name, domain: c.domain,
    atomCount: c.atom_ids?.length || 0,
    status: c.status, keywords: c.keywords,
    daysSinceUpdate: Math.floor((Date.now() - new Date(c.updated_at).getTime()) / 86400000)
  }));

  // 高频实体
  if (memoryStore?.entityGraph) {
    summary.topEntities = Object.entries(memoryStore.entityGraph)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 50)
      .map(([name, info]) => ({ name, type: info.type, count: info.count, related: (info.related || []).slice(0, 5) }));
    summary.personSummary = Object.entries(memoryStore.entityGraph)
      .filter(([_, info]) => info.type === 'person' || info.count >= 3)
      .slice(0, 30)
      .map(([name, info]) => ({ name, count: info.count, related: (info.related || []).slice(0, 5) }));
  }

  // 问题
  summary.questionList = knowledgeStore.atoms
    .filter(a => a.type === 'question' || a.type === 'problem')
    .map(a => ({ id: a.id, content: a.content.substring(0, 100), domain: a.domain }));

  // 过时检测
  const ninetyDaysAgo = Date.now() - 90 * 86400000;
  summary.outdatedAtoms = knowledgeStore.atoms
    .filter(a => new Date(a.updated_at).getTime() < ninetyDaysAgo)
    .map(a => ({ id: a.id, content: a.content.substring(0, 80), domain: a.domain, daysSince: Math.floor((Date.now() - new Date(a.updated_at).getTime()) / 86400000) }));

  // 画像
  const profile = _loadProfile();
  summary.profileProjects = (profile.active_projects || []).map(p => typeof p === 'string' ? p : p.name);

  return summary;
}

function _buildGraphPrompt(summary) {
  const template = fs.readFileSync(path.join(__dirname, 'prompts', 'graph_build.md'), 'utf8');
  return template.replace('{{summary_json}}', JSON.stringify(summary, null, 2));
}

// ========== 图谱构建限制 & 增量构建 ==========

const GRAPH_BUILD_DAILY_LIMIT = 1; // 每天最多全量构建 1 次

function _checkGraphBuildLimit() {
  const today = new Date().toISOString().split('T')[0];
  const stored = getSetting('graph_build_date');
  const count = parseInt(getSetting('graph_build_count') || '0', 10);

  if (stored === today && count >= GRAPH_BUILD_DAILY_LIMIT) {
    return { allowed: false, reason: `今日全量构建已使用 ${count}/${GRAPH_BUILD_DAILY_LIMIT} 次，明天再来吧` };
  }
  return { allowed: true };
}

function _recordGraphBuild() {
  const today = new Date().toISOString().split('T')[0];
  const stored = getSetting('graph_build_date');
  let count = parseInt(getSetting('graph_build_count') || '0', 10);

  if (stored !== today) {
    count = 1;
  } else {
    count++;
  }

  setSetting('graph_build_date', today);
  setSetting('graph_build_count', String(count));
  console.log('[Graph] Build recorded: date=' + today + ' count=' + count);
}

function _saveBuiltKnowledgeSnapshot(summary) {
  // 记录本次构建涉及的知识 ID，用于后续增量构建
  const snapshot = {
    built_at: new Date().toISOString(),
    atom_ids: (knowledgeStore?.atoms || []).map(a => a.id),
    cluster_ids: (knowledgeStore?.clusters || []).map(c => c.id),
    atom_count: summary.atomCount,
    cluster_count: summary.clusterCount,
    domain_count: Object.keys(summary.domains).length,
  };
  setSetting('graph_build_snapshot', JSON.stringify(snapshot));
}

function _getBuiltKnowledgeSnapshot() {
  try {
    const raw = getSetting('graph_build_snapshot');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function _loadProfile() {
  try {
    const profilePath = path.join(app.getPath('userData'), 'profile.json');
    if (fs.existsSync(profilePath)) {
      return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    }
  } catch (e) {}
  return {};
}

async function _callADPForGraph(prompt) {
  // v2.3: LLM 模式下改用 LLM 调用
  if (getGlobalAIMode() === 'llm') {
    return await _callLLMForGraph(prompt);
  }

  // 获取图谱专用 ADP 配置（graphAppKey）
  let graphAppKey, url;
  if (authState.isLoggedIn && remoteConfig?.adp && !authState.forceLocalConfig) {
    graphAppKey = remoteConfig.adp.graph_app_key || '';
    url = remoteConfig.adp.url || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  } else {
    graphAppKey = getSetting('adp_graph_app_key') || '';
    url = getSetting('adp_url') || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  }
  // 回退到 knowledge key
  if (!graphAppKey || graphAppKey.trim() === '') {
    graphAppKey = DEFAULT_ADP_KNOWLEDGE_APP_KEY;
  }

  if (!graphAppKey) {
    throw new Error('ADP Graph AppKey 未配置');
  }

  const _startTime = Date.now();

  try {
    console.log('[Graph] Calling ADP V2 for graph build, prompt length:', prompt.length,
      '| graphAppKey:', graphAppKey.substring(0, 10) + '...',
      '| url:', url);

    const convId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    const requestId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

    const requestBody = {
      RequestId: requestId,
      ConversationId: convId,
      AppKey: graphAppKey.trim(),
      VisitorId: getDeviceFingerprint(),
      Contents: [{ Type: 'text', Text: prompt }],
      Incremental: true,
      Stream: 'enable',
      StreamingThrottle: 5
    };

    const httpUrl = normalizeADPUrl(url).replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');

    const response = await fetch(httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    console.log('[Graph] ADP response status:', response.status, response.ok);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[Graph] ADP error response:', errText.substring(0, 300));
      throw new Error(`ADP 调用失败 (${response.status})`);
    }

    // 解析 SSE 流，收集完整文本
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let currentEvent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.substring(6).trim();
          continue;
        }

        if (line.startsWith('data:')) {
          const data = line.substring(5).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            const eventName = currentEvent || parsed.event || '';

            let deltaText = '';
            if (eventName === 'text.delta') {
              deltaText = parsed.Text || parsed.payload?.content?.[0]?.text || parsed.payload?.content?.text || parsed.content?.text || parsed.payload?.text || '';
            } else if (eventName === 'message.added' || eventName === 'content.added') {
              deltaText = parsed.Content?.[0]?.Text || parsed.Text || parsed.payload?.content?.[0]?.text || parsed.payload?.content?.text || parsed.content?.text || '';
            } else if (eventName === 'message.done') {
              const doneText = parsed.Message?.Content?.[0]?.Text || parsed.Text || '';
              if (doneText && !fullText) {
                fullText = doneText;
              }
              break;
            } else if (eventName === 'response.completed') {
              break;
            } else if (eventName === 'error' || parsed.error) {
              console.error('[Graph] ADP SSE error:', parsed.error || parsed);
              throw new Error(`ADP 返回错误: ${parsed.error?.message || JSON.stringify(parsed.error || parsed)}`);
            }

            if (deltaText) {
              fullText += deltaText;
            }
          } catch (e) {
            if (e.message.startsWith('ADP 返回错误')) throw e;
            // 非 JSON 数据，跳过
          }
        }

        if (line.trim() === '') {
          currentEvent = '';
        }
      }
    }

    console.log('[Graph] ADP fullText length:', fullText.length, 'preview:', fullText.substring(0, 100));

    if (!fullText) throw new Error('ADP 返回内容为空');

    // 从 fullText 中提取 JSON
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('ADP 返回格式异常，无 JSON');

    const graphData = JSON.parse(jsonMatch[0]);
    console.log('[Graph] Parsed graph data: nodes=', graphData.nodes?.length, 'edges=', graphData.edges?.length);

    // 兼容：source/target → source_id/target_id
    if (graphData.edges) {
      graphData.edges = graphData.edges.map(e => ({
        ...e,
        source_id: e.source_id || e.source,
        target_id: e.target_id || e.target,
      }));
    }

    // 兼容：health 值映射（needs_attention → unhealthy）
    if (graphData.nodes) {
      graphData.nodes = graphData.nodes.map(n => ({
        ...n,
        health: n.health === 'needs_attention' ? 'unhealthy' : (n.health || 'healthy'),
      }));
    }

    // 异步记录审计日志
    if (auditLogger) {
      try {
        auditLogger.record({
          id: `graph_${Date.now()}`,
          module: 'graph_build',
          model: 'adp_v2',
          baseUrl: httpUrl,
          adpAppKey: graphAppKey,
          input: { userPromptLen: prompt.length },
          output: { status: response.status, contentLen: fullText.length, finishReason: 'completed' },
          tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          latencyMs: Date.now() - _startTime,
          error: null,
          timestamp: new Date().toISOString(),
        });
      } catch (_) {}
    }

    return graphData;
  } catch (e) {
    console.error('[Graph] ADP call error:', e);
    return {
      nodes: [], edges: [],
      health_report: { summary: {}, gaps: [], outdated: [], conflicts: [], duplicates: [], orphans: [] },
      overview: { totalNodes: 0, totalEdges: 0, densityDistribution: {}, healthDistribution: {}, topDomains: [], weakestAreas: [], knowledgeScore: 0 }
    };
  }
}

// LLM 模式下的图谱构建（替代 _callADPForGraph）
async function _callLLMForGraph(prompt) {
  const startTime = Date.now();
  try {
    console.log('[Graph] Calling LLM for graph build (LLM mode), prompt length:', prompt.length);
    const { response } = await callAI({
      module: 'graph_build',
      category: 'lowvol',
      messages: [{ role: 'user', content: prompt }],
      fetchOptions: { temperature: 0.3, max_tokens: 8000 },
    });

    if (!response || !response.ok) {
      throw new Error('LLM 调用失败');
    }

    let fullText = '';
    // callAI 在 agent 模式下返回 fakeResponse，有 fullContent 属性
    if (response._fullContent) {
      fullText = response._fullContent;
    } else {
      const data = await response.json();
      fullText = data.choices?.[0]?.message?.content || '';
    }

    if (!fullText) throw new Error('LLM 返回内容为空');

    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM 返回格式异常，无 JSON');

    const graphData = JSON.parse(jsonMatch[0]);
    // 兼容处理（同 _callADPForGraph）
    if (graphData.edges) {
      graphData.edges = graphData.edges.map(e => ({
        ...e,
        source_id: e.source_id || e.source,
        target_id: e.target_id || e.target,
      }));
    }
    if (graphData.nodes) {
      graphData.nodes = graphData.nodes.map(n => ({
        ...n,
        health: n.health === 'needs_attention' ? 'unhealthy' : (n.health || 'healthy'),
      }));
    }

    if (auditLogger) {
      try {
        auditLogger.record({
          id: `graph_${Date.now()}`,
          module: 'graph_build_llm',
          model: getAPIConfig().model,
          baseUrl: getAPIConfig().baseUrl,
          input: { userPromptLen: prompt.length },
          output: { status: 200, contentLen: fullText.length, finishReason: 'completed' },
          tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          latencyMs: Date.now() - startTime,
          error: null,
          timestamp: new Date().toISOString(),
        });
      } catch (_) {}
    }

    return graphData;
  } catch (e) {
    console.error('[Graph] LLM call error:', e);
    return {
      nodes: [], edges: [],
      health_report: { summary: {}, gaps: [], outdated: [], conflicts: [], duplicates: [], orphans: [] },
      overview: { totalNodes: 0, totalEdges: 0, densityDistribution: {}, healthDistribution: {}, topDomains: [], weakestAreas: [], knowledgeScore: 0 }
    };
  }
}

ipcMain.handle('get-memory-prompt', async () => {
  return getCurrentMemoryPrompt();
});

ipcMain.handle('set-memory-prompt', async (event, prompt) => {
  setSetting('memory_prompt', prompt);
  return { success: true };
});

ipcMain.handle('reset-memory-prompt', async () => {
  deleteSetting('memory_prompt');
  return { success: true, prompt: DEFAULT_MEMORY_EXTRACTION_PROMPT };
});

// 提炼记忆
ipcMain.handle('extract-memory', async (event, content) => {
  try {
    const apiConfig = getAPIConfig();
    console.log('[Memory] API Config:', {
      baseUrl: apiConfig.baseUrl,
      model: apiConfig.model,
      hasApiKey: !!apiConfig.apiKey
    });
    
    if (!canMakeAICall()) {
      return { success: false, error: '每日调用次数已达上限' };
    }
    
    const prompt = getCurrentMemoryPrompt();
    
    console.log('[Memory] Calling API with content length:', content.length);
    
    const { response } = await callAI({
      module: 'memory_extract_ipc',
      category: 'highvol',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: content }
      ],
    });

    console.log('[Memory] API Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Memory] API Error response:', errorText);
      return { success: false, error: `API调用失败 (${response.status}): ${errorText}` };
    }
    
    incrementAICallCount();
    
    const data = await response.json();
    console.log('[Memory] API Response data:', data);
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      let result = JSON.parse(data.choices[0].message.content);
      
      console.log('[Memory] AI result:', result);
      
      // 添加到记忆系统
      if (memoryStore) {
        const bizCat = classifyBusinessContext(content);
        memoryStore.addMemory({
          type: result.memory_type || 'short',
          category: result.category || 'knowledge',
          business_category: result.business_category || (bizCat.length > 0 ? bizCat[0] : BUSINESS_CATEGORIES.OTHER),
          content: result.summary || content.substring(0, 100),
          metadata: {
            persons: result.persons || [],
            topics: result.topics || [],
            entities: result.entities || []
          },
          confidence: 0.8
        });
      }
      
      return { success: true, memory: result };
    } else {
      console.error('[Memory] Invalid API response format:', data);
      return { success: false, error: 'API返回格式错误' };
    }
  } catch (error) {
    console.error('[Memory] Extraction failed:', error);
    return { success: false, error: error.message };
  }
  
  return { success: false, error: '提炼失败' };
});

// 记录用户反馈（用于持续优化）
let feedbackStore = [];

ipcMain.handle('record-feedback', async (event, feedback) => {
  feedbackStore.push({
    ...feedback,
    id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9)
  });
  
  // 限制反馈存储数量
  if (feedbackStore.length > 100) {
    feedbackStore = feedbackStore.slice(-100);
  }
  
  // 自动触发优化（每收集10条反馈自动优化一次）
  if (feedbackStore.length % 10 === 0) {
    optimizePrompts();
  }
  
  return { success: true };
});

// 优化Prompt
async function optimizePrompts() {
  if (feedbackStore.length < 5) return;
  
  try {
    if (!canMakeAICall()) return;

    const feedbackSummary = feedbackStore.slice(-20).map(f => ({
      type: f.type,
      content: f.content.substring(0, 100) + (f.content.length > 100 ? '...' : ''),
      manual: f.manual || false
    }));
    
    const optimizationPrompt = `
      你是一个Prompt优化专家。请根据以下用户反馈记录，优化任务识别和记忆提炼的Prompt。
      
      当前任务识别Prompt存在的问题：
      1. 可能误识别或漏识别某些类型的内容
      2. 需要更好地区分待办任务和普通笔记
      
      当前记忆提炼Prompt存在的问题：
      1. 可能没有正确提取关键实体
      2. 记忆分类可能不准确
      
      用户反馈记录：
      ${JSON.stringify(feedbackSummary, null, 2)}
      
      请分析这些反馈，给出优化建议：
      1. 任务识别Prompt的优化建议
      2. 记忆提炼Prompt的优化建议
      3. 识别规则的改进建议
      
      请以JSON格式输出：
      {
        "task_prompt_suggestions": ["建议1", "建议2", ...],
        "memory_prompt_suggestions": ["建议1", "建议2", ...],
        "rules_improvements": ["规则1", "规则2", ...]
      }
    `;
    
    const { response } = await callAI({
      module: 'optimize_prompts',
      category: 'lowvol',
      messages: [
        { role: 'system', content: '你是一个AI助手，擅长优化Prompt和识别规则。' },
        { role: 'user', content: optimizationPrompt }
      ],
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        try {
          const suggestions = JSON.parse(data.choices[0].message.content);
          console.log('[AI] Prompt优化建议:', suggestions);
          
          // 可以根据建议自动更新Prompt，或者记录下来供用户参考
          if (suggestions.task_prompt_suggestions && suggestions.task_prompt_suggestions.length > 0) {
            const currentPrompt = getSetting('ai_prompt', DEFAULT_TASK_ANALYSIS_PROMPT);
            let newPrompt = currentPrompt;
            
            // 简单的自动优化：添加用户反馈中常见的模式
            suggestions.task_prompt_suggestions.forEach(suggestion => {
              if (!currentPrompt.includes(suggestion.substring(0, 20))) {
                newPrompt += '\n\n优化建议: ' + suggestion;
              }
            });
            
            if (newPrompt !== currentPrompt) {
              setSetting('ai_prompt', newPrompt);
              console.log('[AI] 任务识别Prompt已优化');
            }
          }
        } catch (e) {
          console.error('[AI] 解析优化建议失败:', e);
        }
      }
    }
    
    incrementAICallCount();
  } catch (error) {
    console.error('[AI] Prompt优化失败:', error);
  }
}

ipcMain.handle('optimize-prompts', async () => {
  await optimizePrompts();
  return { success: true };
});

ipcMain.on('window-minimize', () => {
  mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow.hide();
});

// 当第二个实例尝试启动时，聚焦已有窗口
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  console.log('[App] Starting 忆境 Memora...');

  // 设置麦克风/摄像头权限处理器（getUserMedia 需要）
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  // 设置应用名（影响 macOS 系统通知显示的标题归属）
  app.setName('忆境 Memora');
  // Windows 通知需要 AppUserModelId
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.memora.app');
  }
  console.log('[App] Notification supported:', Notification.isSupported());

  // 加载持久化设置（auth_token, custom_server_urls 等）
  loadSettings();
  console.log('[Settings] Loaded from disk');
  
  // 初始化数据库层（同步）
  db = new Database(app.getPath('userData'));
  db.init();
  console.log('[Database] Database initialized');

  // 初始化 AI 审计日志
  auditLogger = new AIAuditLogger(app.getPath('userData'));
  auditLogger.cleanup(); // 清理过期日志
  console.log('[Audit] AI audit logger initialized');
  
  // 初始化 prompts 目录（从内置目录复制到 userData，确保可写）
  initPrompts();
  console.log('[Prompts] Prompt directory initialized:', PROMPT_DIR);
  
  // 初始化 memory/notebook 数据目录（打包后需要从 ASAR 内迁移已有数据到 userData）
  initDataDirectories();
  console.log('[Data] Data directories initialized');
  
  // 初始化 i18n
  const savedLocale = db.getSettings().locale || 'zh-CN';
  I18n.init(savedLocale);
  console.log('[i18n] Locale set to:', savedLocale);
  
  // 初始化记忆系统
  memoryStore = new MemoryStore();
  console.log('[Memory] Memory store initialized');
  
  // 初始化记事本系统
  notebook = new Notebook();
  console.log('[Notebook] Notebook initialized');

  // 启动时修复被错误设为服务端路径的 imagePath（上传成功后本地笔记 imagePath 不应改为服务端路径）
  _fixCorruptedImagePaths();

  // 初始化知识萃取系统
  const { KnowledgeStore } = require('./src/scripts/knowledgeStore');
  knowledgeStore = new KnowledgeStore();
  console.log('[KnowledgeStore] Knowledge distillation store initialized');

  // 初始化知识图谱数据库
  const { GraphDB } = require('./src/scripts/graph/graphDb');
  graphDb = new GraphDB(app.getPath('userData'));
  global.graphDb = graphDb;
  graphDb.init().then(() => {
    console.log('[GraphDB] Knowledge graph database initialized');
  }).catch(err => {
    console.error('[GraphDB] Initialization failed:', err);
  });

  // 初始化反馈系统
  feedbackLogger = new FeedbackLogger();
  console.log('[Feedback] Feedback logger initialized');
  
  // v3.1: 初始化向量数据库服务
  const EmbeddingService = require('./src/services/embeddingService');
  const VectorIndexManager = require('./src/services/vectorIndexManager');
  const VectorizationQueue = require('./src/services/vectorQueue');
  const UnifiedContextLayer = require('./src/services/unifiedContextLayer');
  
  embeddingService = new EmbeddingService();
  vectorIndex = new VectorIndexManager(embeddingService);
  vectorQueue = new VectorizationQueue(vectorIndex, embeddingService);
  
  // 异步初始化（不阻塞应用启动）
  (async () => {
    try {
      await embeddingService.init();
      const ok = await vectorIndex.init(app.getPath('userData'));
      if (ok) {
        unifiedContextLayer = new UnifiedContextLayer(vectorIndex, embeddingService);
        const MemoryActivationService = require('./src/services/memoryActivation');
        memoryActivation = new MemoryActivationService(memoryStore, vectorIndex);
        console.log('[Vector] Vector database services initialized');
        // 启动时一致性检查
        _checkVectorConsistency();
      } else {
        console.warn('[Vector] Vector database init failed, vector search disabled');
      }
    } catch (e) {
      console.error('[Vector] Init error:', e.message);
    }
  })();
  
  createWindow();
  console.log('[App] Window created');
  // Set mainWindow for SubTaskPoller
  subTaskPoller.setMainWindow(mainWindow);
  // Run config migration
  migrateOldCCConfig();
  createTray();
  console.log('[App] Tray created');
  initClipboardWatcher();
  console.log('[App] Clipboard watcher started');
  
  // v2.0: 加载自定义服务器地址，然后自动登录
  loadCustomServerUrls();
  autoLogin().then(() => {
    console.log('[Auth] Auto login process completed');
    // 登录成功后启动配置定期同步
    startConfigPolling();
  }).catch(err => {
    console.error('[Auth] Auto login error:', err);
  });
  
  // 自动备份（每天凌晨3点）
  startAutoBackup();
  console.log('[App] Auto backup scheduled');

  // Phase 3: 每周优化器检查
  checkWeeklyOptimizer();
  // 每小时检查一次是否需要运行优化器
  weeklyOptimizerTimer = setInterval(checkWeeklyOptimizer, 60 * 60 * 1000);

  app.on('activate', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  // 使用新的剪贴板调度器停止方法
  stopClipboardWatcher();
  // 清理 CC 子进程（避免僵尸进程）
  if (ccAbortController) {
    try { ccAbortController.abort(); } catch (_) {}
    ccAbortController = null;
  }
  // v3.1: 清理所有多任务控制器
  for (const [id, ctrl] of taskControllers) {
    try { ctrl.abort(); } catch (_) {}
  }
  taskControllers.clear();
  // 清理 OpenRouter 代理
  if (anthropicProxy) {
    anthropicProxy.stop();
    anthropicProxy = null;
  }
  // 清理子任务轮询器
  subTaskPoller.stopAll();
  if (ccMemorySyncTimer) {
    clearInterval(ccMemorySyncTimer);
    ccMemorySyncTimer = null;
  }
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
  }
  if (weeklyOptimizerTimer) {
    clearInterval(weeklyOptimizerTimer);
  }
  if (widgetSyncTimer) {
    clearInterval(widgetSyncTimer);
  }
  // 清理配置轮询和通知轮询定时器
  stopConfigPolling();
  stopNotificationPolling();
  // 保存数据库
  if (db) {
    try { db.save(); } catch (e) { console.error('[Database] Save on quit failed:', e); }
  }
  // 退出应用时：上报登出活动
  if (authState.isLoggedIn && authState.token) {
    reportLogoutActivity();
  }
  // 退出应用时：如果未勾选"记住登录"，清除 token
  if (getSetting('auth_remember_me') === '0' && authState.isLoggedIn) {
    console.log('[Auth] App quitting, remember me disabled - clearing token');
    deleteSetting('auth_token');
    deleteSetting('auth_user');
  }
});

// ========== 自动备份 ==========
function startAutoBackup() {
  // 每天凌晨3点执行备份（检查间隔30分钟）
  autoBackupTimer = setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() < 30) {
      if (db) {
        const result = await db.createBackup();
        console.log('[Backup] Auto backup result:', result.success ? 'success' : result.error);
      }
    }
  }, 30 * 60 * 1000);
  // 启动 CC 记忆定时同步
  startCCMemorySync();
  // 启动时立即同步一次 CLAUDE.md
  syncCLAUDEMdToCC();
}

// ========== 数据库 IPC 处理器 ==========
ipcMain.handle('db-get-tasks', async () => {
  if (!db) return [];
  return db.getTasks();
});

ipcMain.handle('db-save-tasks', async (event, tasks) => {
  if (!db) return { success: false };
  // v3.1: 检测任务变更，异步向量化
  const oldTaskIds = new Set((db.data?.tasks || []).map(t => t.id));
  const newTaskIds = new Set(tasks.map(t => t.id));
  // 新增/更新的任务
  for (const task of tasks) {
    if (!oldTaskIds.has(task.id) || JSON.stringify(task) !== JSON.stringify(db.data.tasks.find(t => t.id === task.id))) {
      vectorQueue?.enqueue('upsert', 'tasks', task);
    }
  }
  // 删除的任务
  for (const oldId of oldTaskIds) {
    if (!newTaskIds.has(oldId)) {
      vectorQueue?.enqueue('delete', 'tasks', { id: oldId });
    }
  }
  db.data.tasks = tasks;
  db.save();
  return { success: true };
});

ipcMain.handle('db-get-stats', async () => {
  if (!db) return {};
  return db.getStats();
});

ipcMain.handle('db-create-backup', async () => {
  if (!db) return { success: false, error: 'Database not initialized' };
  return db.createBackup();
});

ipcMain.handle('db-list-backups', async () => {
  if (!db) return [];
  return db.listBackups();
});

ipcMain.handle('db-restore-backup', async (event, backupPath) => {
  if (!db) return { success: false, error: 'Database not initialized' };
  return db.restoreBackup(backupPath);
});

ipcMain.handle('db-export-data', async () => {
  if (!db) return '';
  return db.exportData();
});

ipcMain.handle('db-import-data', async (event, jsonString) => {
  if (!db) return { success: false, error: 'Database not initialized' };
  return db.importData(jsonString);
});

// ========== 多窗口支持 ==========
let childWindows = new Map();

function createChildWindow(type, options = {}) {
  const iconPath = getResourcePath('resources/icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch (e) {
    icon = nativeImage.createEmpty();
  }

  const titles = {
    notebook: I18n.t('nav.notebook'),
    calendar: I18n.t('nav.month'),
    pomodoro: I18n.t('pomodoro.title')
  };

  const sizes = {
    notebook: { width: 800, height: 600 },
    calendar: { width: 900, height: 700 },
    pomodoro: { width: 400, height: 500 }
  };

  const size = sizes[type] || { width: 800, height: 600 };

  const childWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 400,
    minHeight: 300,
    title: titles[type] || 'Memora',
    parent: mainWindow,
    backgroundColor: '#f5f5f7',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: icon
  });

  // 加载对应的页面视图
  childWindow.loadFile(path.join(__dirname, 'src', 'index.html'), {
    hash: type
  });

  childWindow.on('closed', () => {
    childWindows.delete(type);
  });

  childWindows.set(type, childWindow);
  return childWindow;
}

ipcMain.handle('open-child-window', async (event, type) => {
  const existing = childWindows.get(type);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { success: true };
  }
  createChildWindow(type);
  return { success: true };
});

// ========== i18n IPC 处理器 ==========
ipcMain.handle('i18n-get-locale', async () => {
  return I18n.getLocale();
});

ipcMain.handle('i18n-set-locale', async (event, locale) => {
  const result = I18n.setLocale(locale);
  if (result && db) {
    const settings = db.getSettings();
    settings.locale = locale;
    db.saveSettings(settings);
    await db.save();
  }
  return { success: result };
});

ipcMain.handle('i18n-get-translations', async () => {
  return I18n.translations;
});

ipcMain.handle('i18n-t', async (event, key, params) => {
  return I18n.t(key, params);
});

// === v1.1 Feedback + Profile + Agent IPC ===
ipcMain.handle('ai:newTraceId', () => feedbackLogger.newTraceId());
ipcMain.handle('ai:recordTrace', (_, trace) => { feedbackLogger.recordTrace(trace); return true; });
ipcMain.handle('feedback:record', (_, feedback) => feedbackLogger.recordFeedback(feedback));
ipcMain.handle('feedback:query', (_, options) => feedbackLogger.queryFeedback(options || {}));

ipcMain.handle('profile:get', () => {
  const profilePath = path.join(app.getPath('userData'), 'profile.json');
  try {
    if (fs.existsSync(profilePath)) return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  } catch (e) {}
  return getDefaultProfile();
});

ipcMain.handle('profile:update', (_, updates) => {
  const profilePath = path.join(app.getPath('userData'), 'profile.json');
  let profile = getDefaultProfile();
  try {
    if (fs.existsSync(profilePath)) profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  } catch (e) {}
  profile = { ...profile, ...updates, updatedAt: new Date().toISOString() };
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');
  return profile;
});

ipcMain.handle('agent:invoke', async (event, { query, agentType, attachments, model: userSelectedModel }) => {
  try {
    let apiConfig = getAPIConfig();
    // 🔧 如果用户在 UI 选择了特定模型，覆盖默认配置
    if (userSelectedModel) {
      apiConfig = { ...apiConfig, model: userSelectedModel };
      console.log('[Agent] User selected model override:', userSelectedModel);
    }
    if (!canMakeAICall()) return { success: false, error: '每日调用次数已达上限' };

    const profile = loadProfile();
    let intent = agentType || classifyIntent(query);
    const context = await retrieveContext(query, intent, profile);

    // v3.1: 统一上下文层 — 向量检索增强（叠加在现有 retrieveContext 之上）
    let _agentVectorSources = [];
    if (unifiedContextLayer && query) {
      try {
        const ctxResult = await unifiedContextLayer.retrieve(query, { mode: 'llm', intent: { need_notebook: true, need_memory: true, need_tasks: true } });
        if (ctxResult.context) {
          // 向量检索结果追加到现有 context
          context.vector_context = ctxResult.context;
          _agentVectorSources = ctxResult.sources || [];
          event.sender.send('context:sources', { sources: _agentVectorSources, meta: ctxResult.retrieval_meta });
        }
      } catch (e) {
        console.warn('[Vector] Agent context injection failed:', e.message);
      }
    }

    const positiveExamples = getFeedbackExamples(intent, 'accept', 3);
    const negativeExamples = getFeedbackExamples(intent, 'reject', 2);

    const traceId = feedbackLogger.newTraceId();
    const systemPrompt = buildAgentPrompt(intent, profile, context, positiveExamples, negativeExamples, traceId);

    // Build user message content - support attachments
    let userContent = query;
    if (attachments && attachments.length > 0) {
      const hasImages = attachments.some(a => a.type === 'image');
      if (hasImages && !query.toLowerCase().includes('图片') && !query.toLowerCase().includes('image')) {
        // If images attached but user didn't mention them, adjust intent
      }
      // Build text portion with file info
      const fileTextParts = [];
      for (const att of attachments) {
        if (att.type === 'image' && att.base64) {
          fileTextParts.push(`[图片: ${att.name}]`);
        } else if (att.textContent) {
          fileTextParts.push(`[文件: ${att.name}]\n${att.textContent}`);
        } else {
          fileTextParts.push(`[文件: ${att.name}, 类型: ${att.mimeType}, 大小: ${att.size}]`);
        }
      }
      userContent = fileTextParts.join('\n\n') + '\n\n' + query;
    }

    // Build messages array - support multimodal for images
    const messages = [{ role: 'system', content: systemPrompt }];
    
    if (attachments && attachments.some(a => a.type === 'image' && a.base64)) {
      // Multimodal message format for images
      const content = [];
      // Add text content first
      content.push({ type: 'text', text: userContent });
      // Add images
      for (const att of attachments) {
        if (att.type === 'image' && att.base64) {
          content.push({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.base64}` } });
        }
      }
      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: 'user', content: userContent });
    }

    const startTs = Date.now();
    console.log('[Agent] Invoke (streaming) - intent:', intent, 'mode:', getGlobalAIMode(), 'model:', apiConfig.model, 'baseUrl:', apiConfig.baseUrl);
    const { response } = await auditedDeepSeekCall({
      module: 'agent',
      apiConfig,
      messages,
      fetchOptions: {
        temperature: 0.5, stream: true,
        ...(intent === 'chat' ? {} : (attachments?.length ? {} : { response_format: { type: 'json_object' } }))
      },
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[Agent] API error:', response.status, errText);
      return { success: false, error: `AI调用失败(${response.status}): ${errText.substring(0, 200)}` };
    }
    incrementAICallCount();

    // 流式读取 SSE，逐块推送给渲染进程
    let fullContent = '';
    let usage = null;

    (async () => {
      try {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') {
              // 流结束
              mainWindow.webContents.send('agent:stream', { event: 'done', agentType: intent, traceId, fullContent, usage });
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                fullContent += delta.content;
                mainWindow.webContents.send('agent:stream', {
                  event: 'delta',
                  content: delta.content,
                  agentType: intent,
                  fullContent
                });
              }
              if (parsed.usage) usage = parsed.usage;
              // 处理推理内容（如 deepseek-r1 思考过程）
              if (delta?.reasoning_content) {
                mainWindow.webContents.send('agent:stream', {
                  event: 'reasoning',
                  content: delta.reasoning_content,
                  agentType: intent
                });
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }

        // 流结束时确保发送 done（防止 [DONE] 未被解析到的情况）
        mainWindow.webContents.send('agent:stream', { event: 'done', agentType: intent, traceId, fullContent, usage });

        // 记录反馈追踪
        feedbackLogger.recordTrace({
          trace_id: traceId, ts: new Date(startTs).toISOString(),
          module: `agent_${intent}`, prompt_version: `${intent}_v2.0`,
          model: apiConfig.model,
          input: { text: query, attachments: attachments ? attachments.map(a => ({ name: a.name, type: a.type, size: a.size })) : [], injected_vars: { positive_ids: positiveExamples.map(p => p.fb_id), negative_ids: negativeExamples.map(n => n.fb_id) } },
          output: fullContent, latency_ms: Date.now() - startTs,
          tokens: usage
        });
        console.log('[Agent] Stream done - length:', fullContent.length, 'latency:', Date.now() - startTs, 'ms');
      } catch (e) {
        console.error('[Agent] Stream error:', e.message);
        mainWindow.webContents.send('agent:stream', { event: 'error', error: e.message, agentType: intent, fullContent });
      }
    })();

    // 立即返回，后续通过 agent:stream 事件推送
    return { success: true, streaming: true, agentType: intent, traceId };
  } catch (error) { return { success: false, error: error.message }; }
});

// === 加载用户画像 ===
function loadProfile() {
  const profilePath = path.join(app.getPath('userData'), 'profile.json');
  try {
    if (fs.existsSync(profilePath)) return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  } catch (e) {}
  return getDefaultProfile();
}

// === 增强意图识别（关键词加权评分） ===
function classifyIntent(query) {
  const q = query.toLowerCase();
  const scores = { priority: 0, knowledge: 0, memory: 0, report: 0, chat: 0 };

  // 优先级规划关键词
  const priorityKW = { '今天': 2, '今日': 2, '重点': 3, '优先': 3, '排程': 3, '日程': 2, '先做': 3, '重要': 2, '紧急': 2, '安排': 1, '做什么': 2 };
  // 知识梳理关键词
  const knowledgeKW = { '整理': 2, '梳理': 3, '归类': 3, '合并': 2, '笔记': 2, '知识': 2, '聚类': 3, '主题': 1, '分类': 2 };
  // 记忆整理关键词
  const memoryKW = { '记忆': 3, '记住': 2, '忘了': 2, '回忆': 2, '提取': 2, '保留': 2, '过期': 2, '晋升': 2, '降级': 2 };
  // 日报/周报关键词
  const reportKW = { '日报': 3, '周报': 3, '总结': 2, '汇报': 2, '完成情况': 2, '进度': 1, '工作汇报': 3 };

  for (const [kw, score] of Object.entries(priorityKW)) { if (q.includes(kw)) scores.priority += score; }
  for (const [kw, score] of Object.entries(knowledgeKW)) { if (q.includes(kw)) scores.knowledge += score; }
  for (const [kw, score] of Object.entries(memoryKW)) { if (q.includes(kw)) scores.memory += score; }
  for (const [kw, score] of Object.entries(reportKW)) { if (q.includes(kw)) scores.report += score; }

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore < 2) return 'chat';
  return Object.entries(scores).find(([_, s]) => s === maxScore)[0];
}

// === 业务分类自动检测 ===
function classifyBusinessContext(query) {
  const q = query.toLowerCase();
  const scores = {};

  for (const [bizCat, keywords] of Object.entries(BUSINESS_KEYWORDS)) {
    scores[bizCat] = 0;
    for (const kw of keywords) {
      if (q.includes(kw.toLowerCase())) {
        scores[bizCat] += (kw.length >= 3 ? 2 : 1); // 长关键词权重更高
      }
    }
  }

  // 返回得分 >= 2 的所有业务分类
  const matched = Object.entries(scores)
    .filter(([_, s]) => s >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, _]) => cat);

  return matched;
}

// === 增强 RAG 检索 ===
async function retrieveContext(query, intent, profile) {
  const ctx = { tasks: null, memories: [], notes: [], entities: [] };

  try {
    if (db?.data?.tasks) {
      const t = db.data.tasks;
      ctx.tasks = {
        pending: t.filter(x => x.status !== 'completed').slice(0, 20).map(t => ({
          id: t.id, title: t.title, priority: t.priority,
          due: t.dueDate ? new Date(t.dueDate).toLocaleString('zh-CN') : '无',
          dueDate: t.dueDate, duration: t.estimatedDuration || 60,
          linked_persons: [], linked_projects: []
        })),
        completed: t.filter(x => x.status === 'completed').slice(0, 10).map(t => ({
          id: t.id, title: t.title, priority: t.priority,
          completed_at: t.completedAt ? new Date(t.completedAt).toLocaleString('zh-CN') : ''
        })),
        total: t.length
      };
    }
  } catch (e) {}

  try {
    if (memoryStore) {
      // 检测查询中的业务分类
      const bizCategories = classifyBusinessContext(query);
      const bizCatLabels = {
        product: '产品', project: '项目', case: '案例', work: '工作',
        bidding: '投标', consulting: '咨询', solution: '方案', problem: '问题',
        badcase: 'badcase', requirement: '需求', customer: '客户情况',
        personal: '个人情况', other: '其他'
      };
      const limit = intent === 'memory' ? 20 : 5;
      ctx.memories = memoryStore.searchRelated(query, limit, bizCategories).map(m => ({
        content: m.content, type: m.type, type_label: { instant: '瞬时', short: '短期', long: '长期' }[m.type] || m.type,
        category: m.category, business_category: m.business_category || 'other',
        business_category_label: bizCatLabels[m.business_category || 'other'] || '其他',
        importance: m.importance || 'normal',
        created_at: m.createdAt, last_accessed: m.lastAccessed || m.createdAt
      }));

      // 如果检测到业务分类，额外补充该分类下的记忆
      if (bizCategories.length > 0) {
        const existingIds = new Set(ctx.memories.map(m => m.content));
        for (const bizCat of bizCategories.slice(0, 2)) { // 最多取前2个业务分类
          const bizMemories = memoryStore.getMemories({ business_category: bizCat, limit: 3 });
          for (const m of bizMemories) {
            if (!existingIds.has(m.content)) {
              ctx.memories.push({
                content: m.content, type: m.type, type_label: { instant: '瞬时', short: '短期', long: '长期' }[m.type] || m.type,
                category: m.category, business_category: m.business_category || 'other',
                business_category_label: bizCatLabels[m.business_category || 'other'] || '其他',
                importance: m.importance || 'normal',
                created_at: m.createdAt, last_accessed: m.lastAccessed || m.createdAt
              });
              existingIds.add(m.content);
            }
          }
        }
      }

      // 附加实体图谱
      const graph = memoryStore.getEntityGraph();
      ctx.entities = Object.entries(graph || {}).slice(0, 20).map(([name, info]) => ({
        name, type: info.type, count: info.count, last_seen: info.lastSeen
      }));
    }
  } catch (e) {}

  try {
    if (notebook) {
      const noteLimit = intent === 'knowledge' ? 20 : 5;
      ctx.notes = notebook.searchNotes(query).slice(0, noteLimit).map(n => ({
        title: n.title, content: (n.content || '').substring(0, 300), category: n.category
      }));
    }
  } catch (e) {}

  return ctx;
}

// === 获取反馈样本（正/负） ===
function getFeedbackExamples(module, action, limit) {
  try {
    return feedbackLogger.queryFeedback({ module: `agent_${module}`, action, limit }) || [];
  } catch { return []; }
}

// === 用 PromptEngine 模板渲染 Agent Prompt ===
function buildAgentPrompt(intent, profile, ctx, positiveExamples, negativeExamples, traceId) {
  const templateMap = {
    priority: 'priority_agent',
    knowledge: 'knowledge_agent',
    memory: 'memory_agent',
    report: 'report_agent',
    chat: 'chat_agent'
  };

  const templateName = templateMap[intent] || 'chat_agent';
  const templatePath = path.join(PROMPT_DIR, `${templateName}.md`);

  // 如果模板文件存在，使用模板引擎渲染
  if (fs.existsSync(templatePath)) {
    try {
      const templateText = fs.readFileSync(templatePath, 'utf8');
      const vars = buildTemplateVars(intent, profile, ctx, positiveExamples, negativeExamples);
      let rendered = promptEngine.render(templateText, vars);
      rendered = rendered.replace(/__TRACE_ID__/g, traceId);
      return rendered;
    } catch (e) {
      console.error('[Agent] Template render error:', e);
      // fallback 到内联 prompt
    }
  }

  // Fallback：内联 prompt
  return buildInlinePrompt(intent, profile, ctx);
}

// === 构建模板变量 ===
function buildTemplateVars(intent, profile, ctx, positiveExamples, negativeExamples) {
  const vars = {
    user_profile: profile.user || {},
    frequent_persons: profile.frequent_persons || [],
    active_projects: profile.active_projects || [],
    priority_signals: profile.preferences?.priority_signals || [],
    low_priority_signals: profile.preferences?.low_priority_signals || [],
    current_time: new Date().toLocaleString('zh-CN'),
    positive_examples: positiveExamples.map(p => ({
      input_text: p.context?.source_input || '',
      user_final: typeof p.user_final === 'string' ? p.user_final : JSON.stringify(p.user_final),
      note: p.reason || ''
    })),
    negative_examples: negativeExamples.map(n => ({
      input_text: n.context?.source_input || '',
      ai_output: typeof n.ai_output === 'string' ? n.ai_output : JSON.stringify(n.ai_output),
      reject_reason: n.reason || ''
    }))
  };

  // v3.1: 向量检索增强上下文
  if (ctx.vector_context) {
    vars.vector_context = ctx.vector_context;
  }

  // 根据意图注入特定变量
  switch (intent) {
    case 'priority':
      vars.tasks = (ctx.tasks?.pending || []).map((t, i) => ({
        id: t.id || i + 1, title: t.title, priority: t.priority,
        due: t.due || '无', linked_persons: (t.linked_persons || []).join(', '),
        duration: t.duration || 60
      }));
      vars.tasks_count = (ctx.tasks?.pending || []).length;
      vars.user_profile.work_patterns = profile.work_patterns || {};
      vars.memories = ctx.memories || [];
      break;
    case 'knowledge':
      vars.notes = (ctx.notes || []).map((n, i) => ({
        index: i, category: n.category, title: n.title, content: n.content
      }));
      vars.memories = ctx.memories || [];
      vars.known_entities = ctx.entities || [];
      break;
    case 'memory':
      vars.memories = (ctx.memories || []).map((m, i) => ({
        index: i, type: m.type, type_label: m.type_label, category: m.category,
        content: m.content, created_at: m.created_at, last_accessed: m.last_accessed,
        importance: m.importance
      }));
      vars.entities = ctx.entities || [];
      break;
    case 'report':
      vars.report_type = '日报';
      vars.completed_tasks = ctx.tasks?.completed || [];
      vars.completed_count = (ctx.tasks?.completed || []).length;
      vars.pending_tasks = ctx.tasks?.pending || [];
      vars.pending_count = (ctx.tasks?.pending || []).length;
      vars.new_memories = ctx.memories || [];
      vars.new_memories_count = (ctx.memories || []).length;
      vars.feedback_entries = [];
      vars.weekly_completed = 0;
      vars.pomodoro_count = 0;
      vars.ai_calls = 0;
      break;
    case 'chat':
      vars.memories = (ctx.memories || []).slice(0, 5);
      vars.pending_tasks = (ctx.tasks?.pending || []).slice(0, 10).map(t => ({
        title: t.title, priority: t.priority, due_date: t.due || '无'
      }));
      vars.pending_count = (ctx.tasks?.pending || []).length;
      vars.notes = (ctx.notes || []).slice(0, 5);
      break;
  }

  return vars;
}

// === Fallback 内联 Prompt ===
function buildInlinePrompt(intent, profile, ctx) {
  const name = profile.user?.name || '用户';
  switch (intent) {
    case 'priority': {
      const tasks = ctx.tasks?.pending || [];
      return `你是${name}的优先级规划Agent。\n时间：${new Date().toLocaleString('zh-CN')}\n# 待排程(${tasks.length}条)\n${tasks.slice(0,20).map((t,i) => `[${i+1}] ${t.title}|${t.priority}|截止:${t.due||'无'}`).join('\n')||'暂无'}\n输出JSON：{today_top5:[{task_id:"...",scheduled_at:"09:30-10:30",reason:"..."}],highlight:"...",deferred:[],tips:["..."]}`;
    }
    case 'knowledge': {
      return `你是${name}的知识梳理Agent。\n# 近期笔记\n${(ctx.notes||[]).map((n,i)=>`[${i+1}][${n.category}]${n.title}:${n.content}`).join('\n')||'暂无'}\n输出JSON：{clusters:[{theme:"...",note_indices:[],summary:"..."}],duplicates:[],insights:["..."],actions:[]}`;
    }
    case 'memory': {
      return `你是${name}的记忆整理Agent。\n# 相关记忆\n${(ctx.memories||[]).map((m,i)=>`[${i+1}][${m.type}]${m.content}`).join('\n')||'暂无'}\n输出JSON：{promote:[{memory_index:0,from:"short",to:"long",reason:"..."}],demote:[],expire:[],merge:[],insights:["..."]}`;
    }
    case 'report': {
      const c = ctx.tasks?.completed||[], p = ctx.tasks?.pending||[];
      return `你是${name}的日报Agent。\n已完成(${c.length}): ${c.slice(0,10).map(t=>t.title).join('、')||'无'}\n待办(${p.length}): ${p.slice(0,10).map(t=>t.title+'('+t.priority+')').join('、')||'无'}\n输出JSON：{title:"📅 日报",completed_section:{items:[...]},pending_section:{items:[...]},insights:{items:[...]},tomorrow_plan:{items:[...]},summary:"..."}`;
    }
    default: {
      let extra = '';
      if (ctx.memories?.length) extra += `\n# 相关记忆\n${ctx.memories.map(m => `- [${m.type}] ${m.content}`).join('\n')}`;
      if (ctx.tasks?.pending?.length) extra += `\n# 待办(${ctx.tasks.pending.length}条)\n${ctx.tasks.pending.slice(0,10).map(t => `- ${t.title}(${t.priority})`).join('\n')}`;
      return `你是「忆境 Memora」AI助手，服务${name}。简洁实用、可操作、中文回答。\n\n## 行为准则\n1. 用自然语言回复，支持简单 markdown 格式（如加粗、列表）\n2. 不要输出 JSON 格式\n3. 优先引用上述记忆/任务中的信息\n4. 主动发现问题并提建议\n5. 如果不确定，说明情况\n${extra}`;
    }
  }
}

// === Prompt 文件管理 IPC ===
const PROMPT_META = [
  { file: 'task_recognition_v2.0.md', name: '任务识别 v2.0 (单体/降级)', icon: '📋', desc: '从剪贴板/输入文本识别待办事项（单体 Prompt，拆分模式降级时使用）', used_in: '剪贴板检测降级 + AI任务分析' },
  { file: 'clipboard_classify.md', name: '剪贴板意图分类 (L1)', icon: '🏷️', desc: 'Level 1 轻量意图分类，判断 chat/task/info/question，决定后续路由', used_in: '剪贴板检测 Level 1（高频）' },
  { file: 'clipboard_task_create.md', name: '任务创建 (L2a)', icon: '✅', desc: 'Level 2a 任务详情提取：时间解析/SMART/优先级/周期性', used_in: '剪贴板检测 Level 2a（L1判定为task时）' },
  { file: 'clipboard_info_extract.md', name: '信息提取+记忆提炼 (L2b)', icon: '📝', desc: 'Level 2b 有效信息提取+结构化记忆提炼：标题/分类/SMART/人物/主题/关键观点/实体/情感/重要性/TTL（合并 memory_extraction_v2.0 功能）', used_in: '剪贴板检测 Level 2b（L1判定为info时）' },
  { file: 'clipboard_recommend.md', name: '推荐分类 (L2c)', icon: '💡', desc: 'Level 2c 推荐意图分类：疑问/技术问题/求证', used_in: '剪贴板检测 Level 2c（L1判定为question时）' },
  { file: 'memory_extraction_v2.0.md', name: '记忆提取 v2.0 (降级备选)', icon: '🧠', desc: '从文本中提取结构化记忆（人物/主题/关键观点/实体/SMART/TTL等）。⚠️ v3.1 起已合并到 L2b (clipboard_info_extract.md)，本文件仅在拆分模式降级时作为独立 AI 调用使用', used_in: '剪贴板记忆提取（降级模式独立调用）' },
  { file: 'priority_agent.md', name: '优先级规划 Agent', icon: '🎯', desc: '今日排程和任务优先级排序，生成 Top 5 和时间分配建议', used_in: 'Agent 对话（今日排程/优先级）' },
  { file: 'knowledge_agent.md', name: '知识梳理 Agent', icon: '📚', desc: '笔记聚类、重复检测和知识整理，发现主题和关联', used_in: 'Agent 对话（整理笔记/知识梳理）' },
  { file: 'memory_agent.md', name: '记忆整理 Agent', icon: '🔄', desc: '记忆晋升/降级/淘汰/合并建议，保持记忆系统健康', used_in: 'Agent 对话（整理记忆/记忆管理）' },
  { file: 'report_agent.md', name: '日报周报 Agent', icon: '📊', desc: '生成工作日报和周报，总结完成/待办/洞察和明日计划', used_in: 'Agent 对话（生成日报/周报）' },
  { file: 'chat_agent.md', name: '通用对话 Agent', icon: '💬', desc: '日常聊天和通用问答，作为其他 Agent 的兜底', used_in: 'Agent 对话（通用聊天）' },
];

ipcMain.handle('prompt:list-files', async () => {
  return PROMPT_META.map(m => {
    const filePath = path.join(PROMPT_DIR, m.file);
    let exists = false, size = 0, modifiedAt = null;
    try {
      const stat = fs.statSync(filePath);
      exists = true; size = stat.size; modifiedAt = stat.mtime.toISOString();
    } catch {}
    return { ...m, exists, size, modifiedAt };
  });
});

ipcMain.handle('prompt:read-file', async (_, filename) => {
  // 安全检查：只允许读取 prompts/ 目录下的 .md 文件
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.md')) return { success: false, error: '只允许读取 .md 文件' };
  const filePath = path.join(PROMPT_DIR, safeName);
  if (!filePath.startsWith(PROMPT_DIR)) return { success: false, error: '路径非法' };
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content, filename: safeName };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('prompt:write-file', async (_, filename, content) => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.md')) return { success: false, error: '只允许写入 .md 文件' };
  // 支持主目录和 candidates 子目录
  let filePath = path.join(PROMPT_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    const candPath = path.join(PROMPT_DIR, 'candidates', safeName);
    if (fs.existsSync(candPath)) filePath = candPath;
  }
  if (!filePath.startsWith(PROMPT_DIR)) return { success: false, error: '路径非法' };
  try {
    // 先备份
    const backupDir = path.join(PROMPT_DIR, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    if (fs.existsSync(filePath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(filePath, path.join(backupDir, `${safeName}.${ts}.bak`));
    }
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('prompt:reset-file', async (_, filename) => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.md')) return { success: false, error: '只允许重置 .md 文件' };
  const filePath = path.join(PROMPT_DIR, safeName);
  try {
    // 从备份恢复，或者删除文件让系统重新生成
    const backupDir = path.join(PROMPT_DIR, 'backups');
    if (fs.existsSync(backupDir)) {
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(safeName) && f.endsWith('.bak'))
        .sort();
      if (backups.length > 0) {
        fs.copyFileSync(path.join(backupDir, backups[0]), filePath);
        return { success: true, method: 'backup', backupFile: backups[0] };
      }
    }
    return { success: false, error: '无备份文件可恢复，请手动编辑或重新下载' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 列出指定 Prompt 的所有备份版本
ipcMain.handle('prompt:list-backups', async (_, filename) => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.md')) return { success: false, error: '只允许 .md 文件' };
  try {
    const backupDir = path.join(PROMPT_DIR, 'backups');
    if (!fs.existsSync(backupDir)) return { success: true, backups: [] };
    
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith(safeName) && f.endsWith('.bak'))
      .sort()
      .reverse() // 最新的排前面
      .map(f => {
        // 从文件名提取时间戳：task_recognition_v2.0.md.2025-01-15T03-00-00-000Z.bak
        const tsMatch = f.match(/\.(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.bak$/);
        const timestamp = tsMatch ? tsMatch[1].replace(/-/g, (m, i) => i > 10 ? ':' : m) : '';
        const stat = fs.statSync(path.join(backupDir, f));
        return {
          filename: f,
          timestamp,
          size: stat.size,
          date: stat.mtime.toISOString()
        };
      });
    return { success: true, backups };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 恢复到指定备份版本
ipcMain.handle('prompt:restore-backup', async (_, filename, backupFilename) => {
  const safeName = path.basename(filename);
  const safeBackup = path.basename(backupFilename);
  if (!safeName.endsWith('.md')) return { success: false, error: '只允许 .md 文件' };
  try {
    const filePath = path.join(PROMPT_DIR, safeName);
    const backupPath = path.join(PROMPT_DIR, 'backups', safeBackup);
    if (!fs.existsSync(backupPath)) return { success: false, error: '备份文件不存在' };
    
    // 先备份当前版本
    const backupDir = path.join(PROMPT_DIR, 'backups');
    if (fs.existsSync(filePath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(filePath, path.join(backupDir, `${safeName}.${ts}.bak`));
    }
    
    // 恢复指定备份
    fs.copyFileSync(backupPath, filePath);
    return { success: true, restoredFrom: safeBackup };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 初始化为内置 Prompt（重置到出厂设置）
ipcMain.handle('prompt:reset-to-builtin', async (_, filename) => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.md')) return { success: false, error: '只允许 .md 文件' };
  try {
    const builtinPath = path.join(__dirname, 'prompts', safeName);
    if (!fs.existsSync(builtinPath)) return { success: false, error: '内置 Prompt 文件不存在' };
    
    const filePath = path.join(PROMPT_DIR, safeName);
    // 先备份当前版本
    const backupDir = path.join(PROMPT_DIR, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    if (fs.existsSync(filePath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(filePath, path.join(backupDir, `${safeName}.${ts}.bak`));
    }
    
    // 复制内置版本
    fs.copyFileSync(builtinPath, filePath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('prompt:download-file', async (_, filename) => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.md')) return { success: false, error: '只允许下载 .md 文件' };
  const filePath = path.join(PROMPT_DIR, safeName);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content, filename: safeName };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('prompt:upload-file', async (_, filename, content) => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.md')) return { success: false, error: '只允许上传 .md 文件' };
  const filePath = path.join(PROMPT_DIR, safeName);
  if (!filePath.startsWith(PROMPT_DIR)) return { success: false, error: '路径非法' };
  try {
    // 备份旧文件
    const backupDir = path.join(PROMPT_DIR, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    if (fs.existsSync(filePath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(filePath, path.join(backupDir, `${safeName}.${ts}.bak`));
    }
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// === Prompt 变量预览 IPC ===
ipcMain.handle('prompt:get-variables', async (_, filename) => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.md')) return { success: false, error: '只允许读取 .md 文件' };
  const filePath = path.join(PROMPT_DIR, safeName);
  if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const profile = loadProfile();
    // 提取模板中用到的变量
    const varRegex = /\{\{(#each\s+)?(#if\s+)?([a-zA-Z0-9_.]+)\}\}/g;
    const vars = new Set();
    let match;
    while ((match = varRegex.exec(content)) !== null) {
      if (match[3] && !match[3].startsWith('@') && match[3] !== 'this' && match[3] !== 'else') {
        vars.add(match[3]);
      }
    }
    // 每个变量标记来源
    const varInfo = [...vars].map(v => {
      let source = 'auto'; // auto = 自动填充, profile = 来自画像, custom = 可自定义
      let currentValue = null;
      let label = v;
      if (v.startsWith('user_profile.')) {
        source = 'profile';
        const key = v.replace('user_profile.', '');
        currentValue = profile.user?.[key] ?? null;
        const labels = { name: '姓名', english_name: '英文名', role: '角色', industries: '行业' };
        label = labels[key] || key;
      } else if (v === 'current_time') {
        source = 'auto';
        currentValue = new Date().toLocaleString('zh-CN');
        label = '当前时间';
      } else if (v === 'source_meta.app' || v === 'source_meta.type') {
        source = 'auto';
        label = v === 'source_meta.app' ? '来源应用' : '来源类型';
        currentValue = '运行时自动填充';
      } else if (v === 'input_text') {
        source = 'auto';
        label = '输入文本';
        currentValue = '运行时自动填充';
      } else if (['frequent_persons', 'active_projects', 'priority_signals', 'low_priority_signals'].includes(v)) {
        source = 'profile';
        const map = { frequent_persons: '高频人物', active_projects: '活跃项目', priority_signals: '高优先级触发词', low_priority_signals: '低优先级触发词' };
        label = map[v];
        currentValue = profile[v] || profile.preferences?.[v] || [];
      } else if (['positive_examples', 'negative_examples'].includes(v)) {
        source = 'auto';
        label = v === 'positive_examples' ? '正样本（历史）' : '负样本（历史）';
        currentValue = '运行时从反馈日志加载';
      } else if (['tasks', 'tasks_count', 'memories', 'notes', 'entities', 'known_entities'].includes(v)) {
        source = 'auto';
        const map = { tasks: '任务列表', tasks_count: '任务数量', memories: '记忆列表', notes: '笔记列表', entities: '实体列表', known_entities: '已知实体' };
        label = map[v] || v;
        currentValue = '运行时从数据库加载';
      } else if (['report_type', 'completed_tasks', 'completed_count', 'pending_tasks', 'pending_count', 'new_memories', 'new_memories_count', 'feedback_entries', 'weekly_completed', 'pomodoro_count', 'ai_calls'].includes(v)) {
        source = 'auto';
        const map = { report_type: '报告类型', completed_tasks: '已完成任务', completed_count: '完成数量', pending_tasks: '待办任务', pending_count: '待办数量', new_memories: '新记忆', new_memories_count: '新记忆数量', feedback_entries: '反馈日志', weekly_completed: '本周完成', pomodoro_count: '番茄钟数', ai_calls: 'AI调用数' };
        label = map[v] || v;
        currentValue = '运行时自动填充';
      }
      return { name: v, label, source, currentValue };
    });
    return { success: true, variables: varInfo };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// === 优化器历史记录 IPC ===
ipcMain.handle('optimizer:history', async () => {
  const candidatesDir = path.join(PROMPT_DIR, 'candidates');
  if (!fs.existsSync(candidatesDir)) return { history: [] };
  try {
    const files = fs.readdirSync(candidatesDir);
    const reports = files.filter(f => f.endsWith('.report.json'));
    const history = reports.map(f => {
      try {
        const report = JSON.parse(fs.readFileSync(path.join(candidatesDir, f), 'utf8'));
        report.reportFile = f;
        report.promptFile = f.replace('.report.json', '.md');
        return report;
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return { history };
  } catch (e) {
    return { history: [], error: e.message };
  }
});

ipcMain.handle('optimizer:read-report', async (_, filename) => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.report.json')) return { success: false, error: '只允许读取 .report.json 文件' };
  const filePath = path.join(PROMPT_DIR, 'candidates', safeName);
  try {
    const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { success: true, report };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('optimizer:read-candidate', async (_, filename) => {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.md')) return { success: false, error: '只允许读取 .md 文件' };
  const filePath = path.join(PROMPT_DIR, 'candidates', safeName);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('optimizer:apply-to-main', async (_, candidateFilename) => {
  const safeName = path.basename(candidateFilename);
  if (!safeName.endsWith('.md')) return { success: false, error: '只允许 .md 文件' };
  const candidatePath = path.join(PROMPT_DIR, 'candidates', safeName);
  if (!fs.existsSync(candidatePath)) return { success: false, error: '候选文件不存在' };
  try {
    // 从文件名提取模块名
    const moduleName = safeName.split('_').slice(0, -1).join('_') || 'task_recognition';
    const targetPath = path.join(PROMPT_DIR, `${moduleName}_v2.0.md`);
    // 备份
    const backupDir = path.join(PROMPT_DIR, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    if (fs.existsSync(targetPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(targetPath, path.join(backupDir, `${moduleName}_v2.0.md.${ts}.bak`));
    }
    // 复制候选到主文件
    fs.copyFileSync(candidatePath, targetPath);
    return { success: true, module: moduleName, targetFile: `${moduleName}_v2.0.md` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// === Phase 3: Prompt 优化器 IPC ===
ipcMain.handle('optimizer:list-candidates', async () => {
  const candidatesDir = path.join(PROMPT_DIR, 'candidates');
  if (!fs.existsSync(candidatesDir)) return { candidates: [] };
  try {
    const files = fs.readdirSync(candidatesDir).filter(f => f.endsWith('.md'));
    const reports = fs.readdirSync(candidatesDir).filter(f => f.endsWith('.report.json'));
    return {
      candidates: files.map(f => {
        const name = f.replace('.md', '');
        const reportFile = reports.find(r => r.startsWith(name));
        let report = null;
        if (reportFile) {
          try { report = JSON.parse(fs.readFileSync(path.join(candidatesDir, reportFile), 'utf8')); } catch {}
        }
        return { name, filename: f, report };
      })
    };
  } catch { return { candidates: [] }; }
});

ipcMain.handle('optimizer:apply-candidate', async (_, filename) => {
  try {
    const candidatesDir = path.join(PROMPT_DIR, 'candidates');
    const candidatePath = path.join(candidatesDir, filename);
    if (!fs.existsSync(candidatePath)) return { success: false, error: '候选文件不存在' };

    // 从文件名提取模块名
    const moduleName = filename.split('_').slice(0, -1).join('_') || 'task_recognition';
    const activeLink = path.join(PROMPT_DIR, `${moduleName}_active.md`);
    if (fs.existsSync(activeLink)) fs.unlinkSync(activeLink);
    fs.symlinkSync(candidatePath, activeLink);
    console.log(`[Optimizer] Active prompt switched to: ${filename}`);
    return { success: true, module: moduleName };
  } catch (error) { return { success: false, error: error.message }; }
});

// ========== 知识跟随模块 ==========

// 知识项数据存储
const KNOWLEDGE_DIR = path.join(app.getPath('userData'), 'knowledge');
if (!fs.existsSync(KNOWLEDGE_DIR)) {
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
}

const KNOWLEDGE_ITEMS_FILE = path.join(KNOWLEDGE_DIR, 'knowledge-items.json');
const KNOWLEDGE_RECOMMENDATIONS_FILE = path.join(KNOWLEDGE_DIR, 'recommendations.json');

function loadKnowledgeItems() {
  try {
    if (fs.existsSync(KNOWLEDGE_ITEMS_FILE)) {
      return JSON.parse(fs.readFileSync(KNOWLEDGE_ITEMS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Knowledge] Load items error:', e);
  }
  return [];
}

function saveKnowledgeItems(items) {
  try {
    fs.writeFileSync(KNOWLEDGE_ITEMS_FILE, JSON.stringify(items, null, 2));
  } catch (e) {
    console.error('[Knowledge] Save items error:', e);
  }
}

function loadKnowledgeRecommendations() {
  try {
    if (fs.existsSync(KNOWLEDGE_RECOMMENDATIONS_FILE)) {
      return JSON.parse(fs.readFileSync(KNOWLEDGE_RECOMMENDATIONS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Knowledge] Load recommendations error:', e);
  }
  return [];
}

function saveKnowledgeRecommendations(recs) {
  try {
    fs.writeFileSync(KNOWLEDGE_RECOMMENDATIONS_FILE, JSON.stringify(recs, null, 2));
  } catch (e) {
    console.error('[Knowledge] Save recommendations error:', e);
  }
}

// 设备指纹
let cachedDeviceFingerprint = null;
let syncDeviceId = null; // 同步引擎的 device_id（从渲染进程传入，用于图片上传等场景）
function getDeviceFingerprint() {
  if (cachedDeviceFingerprint) return cachedDeviceFingerprint;

  let mac = 'unknown';
  let ip = 'unknown';

  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
          mac = iface.mac;
          break;
        }
      }
      if (mac !== 'unknown') break;
    }
    // 获取本机IP
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ip = iface.address;
          break;
        }
      }
      if (ip !== 'unknown') break;
    }
  } catch (e) {
    console.error('[Knowledge] Device fingerprint error:', e);
  }

  const hash = crypto.createHash('sha256').update(`${mac}_${ip}`).digest('hex').substring(0, 16);
  cachedDeviceFingerprint = `mac_${hash.substring(0, 8)}_ip_${hash.substring(8, 16)}`;
  return cachedDeviceFingerprint;
}

// 构建剪贴板分析的 system prompt（注入动态数据 + 反馈样本）
function buildClipboardAnalysisPrompt(traceId) {
  const templatePath = path.join(PROMPT_DIR, 'task_recognition_v2.0.md');
  if (!fs.existsSync(templatePath)) {
    return getCurrentAIPrompt(); // 回退
  }
  
  let template = fs.readFileSync(templatePath, 'utf8');
  const profile = loadProfile();
  
  // 获取最近的正负样本
  const positiveExamples = (feedbackLogger ? feedbackLogger.queryFeedback({ module: 'clipboard_analysis', action: 'accept', limit: 3 }) : [])
    .map(p => ({
      input_text: p.context?.source_input || '',
      user_final: typeof p.user_final === 'string' ? p.user_final : JSON.stringify(p.user_final),
      note: p.reason || ''
    }));
  const negativeExamples = (feedbackLogger ? feedbackLogger.queryFeedback({ module: 'clipboard_analysis', action: 'reject', limit: 3 }) : [])
    .map(n => ({
      input_text: n.context?.source_input || '',
      ai_output: typeof n.ai_output === 'string' ? n.ai_output : JSON.stringify(n.ai_output),
      reject_reason: n.reason || ''
    }));
  
  // 获取自定义分类
  const customCategories = notebook ? notebook.getCustomCategories() : {};
  
  const vars = {
    'user_profile.name': profile.user?.name || '用户',
    'user_profile.english_name': profile.user?.english_name || '',
    'user_profile.role': profile.user?.role || '',
    'user_profile.industries': profile.user?.industries || [],
    current_time: (() => {
      const now = new Date();
      const dow = ['日','一','二','三','四','五','六'][now.getDay()];
      const h = now.getHours();
      const period = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 18 ? '下午' : '晚上';
      return `${now.toLocaleString('zh-CN')} 周${dow} ${period}`;
    })(),
    source_meta: { app: 'clipboard', type: '其他' },
    frequent_persons: profile.frequent_persons || [],
    active_projects: profile.active_projects || [],
    priority_signals: profile.preferences?.priority_signals || [],
    low_priority_signals: profile.preferences?.low_priority_signals || [],
    positive_examples: positiveExamples,
    negative_examples: negativeExamples,
    custom_categories: customCategories,
    input_text: '' // 由 user message 提供
  };
  
  let rendered = promptEngine.render(template, vars);
  // 注入 trace_id
  rendered = rendered.replace(/__TRACE_ID__/g, traceId);
  
  return rendered;
}

// ===== v3.1: 拆分 Prompt 构建函数 =====

function _getCurrentTimeStr() {
  const now = new Date();
  const dow = ['日','一','二','三','四','五','六'][now.getDay()];
  const h = now.getHours();
  const period = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 18 ? '下午' : '晚上';
  return `${now.toLocaleString('zh-CN')} 周${dow} ${period}`;
}

function _getProfileVars() {
  const profile = loadProfile();
  return {
    profile,
    frequent_persons: profile.frequent_persons || [],
    active_projects: profile.active_projects || [],
    priority_signals: profile.preferences?.priority_signals || [],
    low_priority_signals: profile.preferences?.low_priority_signals || [],
    custom_categories: notebook ? notebook.getCustomCategories() : {},
    frequent_persons_names: (profile.frequent_persons || []).map(p => p.name).join(', '),
  };
}

function _getFeedbackExamples(module, limit = 3) {
  if (!feedbackLogger) return { positive: [], negative: [] };
  return {
    positive: feedbackLogger.queryFeedback({ module, action: 'accept', limit })
      .map(p => ({
        input_text: p.context?.source_input || '',
        user_final: typeof p.user_final === 'string' ? p.user_final : JSON.stringify(p.user_final),
        note: p.reason || ''
      })),
    negative: feedbackLogger.queryFeedback({ module, action: 'reject', limit })
      .map(n => ({
        input_text: n.context?.source_input || '',
        ai_output: typeof n.ai_output === 'string' ? n.ai_output : JSON.stringify(n.ai_output),
        reject_reason: n.reason || ''
      })),
  };
}

// Level 1: 轻量意图分类
function buildClassifyPrompt(traceId) {
  const templatePath = path.join(PROMPT_DIR, 'clipboard_classify.md');
  if (!fs.existsSync(templatePath)) return null;
  const template = fs.readFileSync(templatePath, 'utf8');
  const { profile, frequent_persons_names } = _getProfileVars();
  const vars = {
    'user_profile.name': profile.user?.name || '用户',
    'user_profile.english_name': profile.user?.english_name || '',
    current_time: _getCurrentTimeStr(),
    frequent_persons_names: frequent_persons_names || '（无）',
    input_text: '',
  };
  let rendered = promptEngine.render(template, vars);
  return rendered.replace(/__TRACE_ID__/g, traceId);
}

// Level 2a: 任务创建
function buildTaskCreatePrompt(traceId) {
  const templatePath = path.join(PROMPT_DIR, 'clipboard_task_create.md');
  if (!fs.existsSync(templatePath)) return null;
  const template = fs.readFileSync(templatePath, 'utf8');
  const { profile, frequent_persons, active_projects, priority_signals, low_priority_signals, custom_categories } = _getProfileVars();
  const examples = _getFeedbackExamples('clipboard_analysis', 3);
  const vars = {
    'user_profile.name': profile.user?.name || '用户',
    'user_profile.english_name': profile.user?.english_name || '',
    'user_profile.role': profile.user?.role || '',
    current_time: _getCurrentTimeStr(),
    frequent_persons,
    active_projects,
    priority_signals,
    low_priority_signals,
    custom_categories,
    positive_examples: examples.positive,
    negative_examples: examples.negative,
    input_text: '',
  };
  let rendered = promptEngine.render(template, vars);
  return rendered.replace(/__TRACE_ID__/g, traceId);
}

// Level 2b: 信息提取 + 记忆提炼（合并 memory_extraction_v2.0 功能）
function buildInfoExtractPrompt(traceId) {
  const templatePath = path.join(PROMPT_DIR, 'clipboard_info_extract.md');
  if (!fs.existsSync(templatePath)) return null;
  const template = fs.readFileSync(templatePath, 'utf8');
  const { profile, frequent_persons, active_projects, custom_categories } = _getProfileVars();
  const examples = _getFeedbackExamples('clipboard_analysis', 3);

  // 加载已知实体库（从 entity-graph.json）
  let known_entities = [];
  try {
    if (memoryStore) {
      const graph = memoryStore.getEntityGraph();
      known_entities = Object.entries(graph || {})
        .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
        .slice(0, 30)
        .map(([name, info]) => ({ id: name, name, type: info.type || 'unknown' }));
    }
  } catch (_) {}

  const vars = {
    'user_profile.name': profile.user?.name || '用户',
    'user_profile.english_name': profile.user?.english_name || '',
    'user_profile.role': profile.user?.role || '',
    current_time: _getCurrentTimeStr(),
    frequent_persons,
    active_projects,
    known_entities,
    custom_categories,
    positive_examples: examples.positive,
    negative_examples: examples.negative,
    input_text: '',
  };
  let rendered = promptEngine.render(template, vars);
  return rendered.replace(/__TRACE_ID__/g, traceId);
}

// Level 2c: 推荐分类
function buildRecommendPrompt(traceId) {
  const templatePath = path.join(PROMPT_DIR, 'clipboard_recommend.md');
  if (!fs.existsSync(templatePath)) return null;
  const template = fs.readFileSync(templatePath, 'utf8');
  const vars = { input_text: '' };
  let rendered = promptEngine.render(template, vars);
  return rendered.replace(/__TRACE_ID__/g, traceId);
}

/**
 * v3.1: 拆分式剪贴板分析
 * Level 1 分类 → Level 2 并行提取 → 合并结果
 * 降级：Level 1 失败或低置信度时回退到单体 Prompt
 */
async function analyzeClipboardSplit(text, traceId, userPrompt, isBufferMerged, preResult) {
  // Level 1: 轻量意图分类
  const classifyPrompt = buildClassifyPrompt(traceId);
  if (!classifyPrompt) {
    _sendLog('[AI] ⚠️ classify prompt 不存在，降级为单体 Prompt');
    return null; // 降级信号
  }

  const classifyStartTime = Date.now();
  let classification;
  try {
    const { response } = await callAI({
      module: 'clipboard_classify',
      category: 'highvol',
      messages: [
        { role: 'system', content: classifyPrompt },
        { role: 'user', content: text }
      ],
      fetchOptions: { temperature: 0.1, max_tokens: 200 },
      traceId,
      structured: true,
    });

    if (!response.ok) {
      _sendLog('[AI] ⚠️ Level 1 分类失败，降级为单体 Prompt');
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    incrementAICallCount();

    // 解析 JSON
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    classification = JSON.parse(jsonStr);

    const classifyDuration = Date.now() - classifyStartTime;
    _sendLog(`[AI] 🏷️ L1 分类: intent=${classification.intent} confidence=${classification.confidence} (${classifyDuration}ms)`);

    // 审计日志
    if (auditLogger) {
      auditLogger.log({
        module: 'clipboard_classify',
        action: 'classify',
        input: { text_preview: text.substring(0, 100), text_length: text.length },
        output: classification,
        latencyMs: classifyDuration,
        traceId,
      });
    }
  } catch (e) {
    _sendLog(`[AI] ⚠️ Level 1 解析失败: ${e.message}，降级为单体 Prompt`);
    return null;
  }

  // 高置信度闲聊 → 直接丢弃，不调后续 AI
  if (classification.intent === 'chat' && classification.confidence > 0.85) {
    _sendLog('[AI] 🚫 L1 判定为闲聊 (confidence>' + classification.confidence + ')，跳过后续分析');
    return {
      skipped: true,
      reason: 'chat',
      classification,
      is_task: false,
      is_valid_info: false,
      needs_recommendation: false,
    };
  }

  // 判断需要哪些 Level 2
  const needTask = classification.is_task;
  const needInfo = classification.is_valid_info;
  const needRecommend = classification.needs_recommendation;

  // 如果全为 false 且置信度不高 → 降级
  if (!needTask && !needInfo && !needRecommend) {
    if (classification.confidence < 0.85) {
      _sendLog('[AI] ⚠️ L1 全 false 且低置信度，降级为单体 Prompt');
      return null;
    }
    // 高置信度全 false → 当作闲聊
    return {
      skipped: true,
      reason: 'all_false_high_confidence',
      classification,
      is_task: false,
      is_valid_info: false,
      needs_recommendation: false,
    };
  }

  // Level 2: 并行调用
  _sendLog(`[AI] 🔀 L2 路由: task=${needTask} info=${needInfo} recommend=${needRecommend}`);
  const level2Promises = [];

  if (needTask) {
    const taskPrompt = buildTaskCreatePrompt(traceId);
    if (taskPrompt) {
      level2Promises.push(
        callAI({
          module: 'clipboard_task_create',
          category: 'highvol',
          messages: [
            { role: 'system', content: taskPrompt },
            { role: 'user', content: userPrompt }
          ],
          fetchOptions: { temperature: 0.1 },
          traceId,
          structured: true,
        }).then(({ response }) => response.ok ? response.json() : null).then(data => {
          if (!data) return null;
          const content = data.choices?.[0]?.message?.content || '';
          let jsonStr = content;
          const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (m) jsonStr = m[1].trim();
          try { return { type: 'task', data: JSON.parse(jsonStr) }; }
          catch { return { type: 'task', data: null, error: 'parse_failed' }; }
        }).catch(e => ({ type: 'task', data: null, error: e.message }))
      );
      incrementAICallCount();
    }
  }

  if (needInfo) {
    const infoPrompt = buildInfoExtractPrompt(traceId);
    if (infoPrompt) {
      level2Promises.push(
        callAI({
          module: 'clipboard_info_extract',
          category: 'highvol',
          messages: [
            { role: 'system', content: infoPrompt },
            { role: 'user', content: text }
          ],
          fetchOptions: { temperature: 0.1 },
          traceId,
          structured: true,
        }).then(({ response }) => response.ok ? response.json() : null).then(data => {
          if (!data) return null;
          const content = data.choices?.[0]?.message?.content || '';
          let jsonStr = content;
          const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (m) jsonStr = m[1].trim();
          try { return { type: 'info', data: JSON.parse(jsonStr) }; }
          catch { return { type: 'info', data: null, error: 'parse_failed' }; }
        }).catch(e => ({ type: 'info', data: null, error: e.message }))
      );
      incrementAICallCount();
    }
  }

  if (needRecommend) {
    const recommendPrompt = buildRecommendPrompt(traceId);
    if (recommendPrompt) {
      level2Promises.push(
        callAI({
          module: 'clipboard_recommend',
          category: 'highvol',
          messages: [
            { role: 'system', content: recommendPrompt },
            { role: 'user', content: text }
          ],
          fetchOptions: { temperature: 0.1, max_tokens: 200 },
          traceId,
          structured: true,
        }).then(({ response }) => response.ok ? response.json() : null).then(data => {
          if (!data) return null;
          const content = data.choices?.[0]?.message?.content || '';
          let jsonStr = content;
          const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (m) jsonStr = m[1].trim();
          try { return { type: 'recommend', data: JSON.parse(jsonStr) }; }
          catch { return { type: 'recommend', data: null, error: 'parse_failed' }; }
        }).catch(e => ({ type: 'recommend', data: null, error: e.message }))
      );
      incrementAICallCount();
    }
  }

  // 等待所有 Level 2 完成
  const level2Results = await Promise.all(level2Promises);

  // 合并结果为与原单体 Prompt 兼容的格式（含记忆提取字段）
  const merged = {
    trace_id: traceId,
    is_task: false,
    is_valid_info: false,
    needs_recommendation: false,
    confidence: classification.confidence,
    title: null,
    description: null,
    time: { raw: null, normalized: null, is_all_day: false },
    priority: null,
    task_type: 'manual',
    recurrence: null,
    tags: [],
    linked_persons: [],
    linked_projects: [],
    recommendation_intent: null,
    recommendation_query: null,
    category: null,
    smart_level: null,
    smart_missing: [],
    smart_optimized: false,
    // 记忆提取字段（由 L2b 合并提供，覆盖 memory_extraction_v2.0 功能）
    memory_type: null,
    memory_category: null,
    summary: null,
    persons: [],
    topics: [],
    key_points: [],
    sentiment: 'neutral',
    importance: 'medium',
    entities: [],
    linked_known_persons: [],
    linked_known_projects: [],
    ttl_hint: null,
    reason: classification.quick_reason || '',
    reasoning_steps: [`L1: intent=${classification.intent} (${classification.confidence})`],
    _split_mode: true,
  };

  let allFailed = true;
  for (const result of level2Results) {
    if (!result || !result.data) continue;
    allFailed = false;

    if (result.type === 'task' && result.data) {
      merged.is_task = true;
      merged.title = result.data.title || merged.title;
      merged.description = result.data.description || merged.description;
      merged.time = result.data.time || merged.time;
      merged.priority = result.data.priority || 'medium';
      merged.task_type = result.data.task_type || 'manual';
      merged.recurrence = result.data.recurrence || null;
      merged.tags = result.data.tags || merged.tags;
      merged.linked_persons = result.data.linked_persons || merged.linked_persons;
      merged.linked_projects = result.data.linked_projects || merged.linked_projects;
      merged.category = result.data.category || merged.category;
      merged.smart_level = result.data.smart_level || merged.smart_level;
      merged.smart_missing = result.data.smart_missing || merged.smart_missing;
      merged.smart_optimized = result.data.smart_optimized || merged.smart_optimized;
      merged.reasoning_steps.push('L2a: task extracted');
    }

    if (result.type === 'info' && result.data) {
      merged.is_valid_info = true;
      if (!merged.title) merged.title = result.data.title;
      if (!merged.description) merged.description = result.data.description;
      merged.tags = [...new Set([...merged.tags, ...(result.data.tags || [])])];
      merged.linked_persons = [...new Set([...merged.linked_persons, ...(result.data.linked_persons || [])])];
      merged.linked_projects = [...new Set([...merged.linked_projects, ...(result.data.linked_projects || [])])];
      if (!merged.category) merged.category = result.data.category;
      if (!merged.smart_level) merged.smart_level = result.data.smart_level;
      if (!merged.smart_missing?.length) merged.smart_missing = result.data.smart_missing || [];
      merged.smart_optimized = merged.smart_optimized || result.data.smart_optimized;
      // 记忆提取字段（L2b 合并了 memory_extraction_v2.0 功能）
      merged.memory_type = result.data.memory_type || null;
      merged.memory_category = result.data.memory_category || null;
      merged.summary = result.data.summary || null;
      merged.persons = [...new Set([...merged.persons, ...(result.data.persons || [])])];
      merged.topics = [...new Set([...merged.topics, ...(result.data.topics || [])])];
      merged.key_points = [...new Set([...merged.key_points, ...(result.data.key_points || [])])];
      merged.sentiment = result.data.sentiment || 'neutral';
      merged.importance = result.data.importance || 'medium';
      merged.entities = [...merged.entities, ...(result.data.entities || [])];
      merged.linked_known_persons = [...new Set([...merged.linked_known_persons, ...(result.data.linked_known_persons || [])])];
      merged.linked_known_projects = [...new Set([...merged.linked_known_projects, ...(result.data.linked_known_projects || [])])];
      merged.ttl_hint = result.data.ttl_hint || null;
      merged.reasoning_steps.push('L2b: info + memory extracted');
    }

    if (result.type === 'recommend' && result.data) {
      merged.needs_recommendation = true;
      merged.recommendation_intent = result.data.recommendation_intent || null;
      merged.recommendation_query = result.data.recommendation_query || null;
      merged.reasoning_steps.push('L2c: recommend classified');
    }
  }

  // 如果所有 L2 都失败 → 降级
  if (allFailed) {
    _sendLog('[AI] ⚠️ 所有 L2 调用失败，降级为单体 Prompt');
    return null;
  }

  // 如果 task 或 info 任一成功，标记 is_valid_info
  if (merged.is_task && !merged.is_valid_info) {
    merged.is_valid_info = true; // task 同时也是有效信息
  }

  _sendLog(`[AI] ✅ 拆分分析完成: task=${merged.is_task} info=${merged.is_valid_info} recommend=${merged.needs_recommendation}`);
  return merged;
}

function classifyClipboardIntent(text, aiResult) {
  if (!text || text.trim().length === 0) return null;

  const intentPatterns = {
    search_knowledge: [
      /搜索|查找|寻找|什么是|how to|了解|学习|研究|看看.*是什么/i,
      /怎么用|如何使用|怎么操作|教程|指南|入门/i
    ],
    get_document: [
      /API文档|使用手册|开发指南|参考文档|SDK文档/i,
      /在哪找|哪里有|下载地址|仓库地址|官方文档/i
    ],
    query_question: [
      // 故障/报错类
      /为什么|怎么解决|报错|error|异常|failed|问题/i,
      /为什么.*不|怎么.*不行|无法|不能|失败/i,
      // 中文疑问词（核心扩展）
      /是否有|有没有|能不能|会不会|可不可以|是不是/i,
      /能否|可否|是否支持|是否可以|是否能够/i,
      /怎么.*？|如何.*？|什么.*？|哪里.*？/i,
      // 疑问语气词
      /[吗呢吧嘛啊呀]？\s*$/i,
      // 计划/打算类疑问
      /是否有.*计划|是否有.*打算|后续.*是否|将来.*是否/i,
      // 差异/比较类疑问
      /有什么区别|有什么不同|哪个更好|怎么选择/i,
      // 原因/方案类疑问
      /原因是什么|怎么办|如何处理|怎么应对/i
    ],
    doubt: [
      /不确定|好像|似乎|应该.*吧/i,
      /\?{2,}/,
      /还是说|或者说|不太确定|不太清楚/i
    ]
  };

  const scores = {};
  for (const [intent, patterns] of Object.entries(intentPatterns)) {
    scores[intent] = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) scores[intent] += 1;
    }
  }

  // 通用疑问句检测：文本以问号结尾，给 query_question 额外加分
  const trimmed = text.trim();
  if (/[？?]\s*$/.test(trimmed)) {
    scores.query_question += 0.5;
    // 如果文本超过15字且以问号结尾，大概率是正式问题而非随意闲聊
    if (trimmed.length > 15) {
      scores.query_question += 0.5;
    }
  }

  // 如果 AI 分析结果中有 is_valid_info，增加推荐倾向
  if (aiResult && aiResult.is_valid_info) {
    // 不管是不是任务，有效信息都可能需要知识推荐
    if (!aiResult.is_task) {
      scores.query_question += 1;
    } else {
      // 即使是任务，如果是关于技术/产品的提问，也值得推荐
      scores.query_question += 0.3;
    }
  }
  // 如果 AI 分析的 tags 中包含问题相关标签
  if (aiResult && aiResult.tags) {
    const questionTags = ['问题', '反馈', '技术', '需求', '方案', '设计', '架构', '配置', '部署', '调试', '优化', '安全', '性能', '存储', '计划', '支持'];
    for (const tag of aiResult.tags) {
      if (questionTags.some(qt => tag.includes(qt))) {
        scores.query_question += 0.5;
        break;
      }
    }
  }

  // 意图优先级调整：当 query_question 与其他意图同分时，问题类优先
  // 因为"文档中出现的问题"更可能是提问而非单纯找文档
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return null;

  // 如果 query_question 和其他意图同分，优先返回 query_question
  const maxIntents = Object.entries(scores).filter(([_, s]) => s === maxScore);
  if (maxIntents.length > 1 && scores.query_question === maxScore) {
    return 'query_question';
  }
  return maxIntents[0][0];
}

// ========== 知识萃取系统 ==========

// 知识原子提取：从笔记内容中提取知识原子
async function extractKnowledgeAtoms(content, sourceNoteId, tags) {
  try {
    const promptPath = path.join(PROMPT_DIR, 'knowledge_atom_extraction.md');
    let promptTemplate;
    try {
      promptTemplate = fs.readFileSync(promptPath, 'utf8');
    } catch (e) {
      // Prompt 文件不存在，使用内置模板
      promptTemplate = `从以下笔记内容中提取1-3个知识原子（最小可复用知识单元）。

规则：
- 每个原子是一句独立的、可脱离原文理解的知识点
- 类型：fact(事实)/rule(规则)/insight(洞察)/procedure(步骤)/question(未解决问题)
- 如果笔记中有疑问或未解决的问题，务必提取为 question 类型
- 领域分类：技术-ADP/技术-部署/技术-数据库/技术-前端/技术-后端/技术-网络/产品-智能体/产品-知识库/项目-管理/商务-招投标/通用
- 重要度 0-1（关键规则0.9+，重要事实0.7+，有用信息0.5+，辅助0.3+）

输出严格JSON：
{"atoms":[{"content":"...","type":"fact","domain":"技术-XX","importance":0.8}]}

笔记内容：
{content}`;
    }

    const prompt = promptTemplate
      .replace('{title}', '')
      .replace('{content}', content.substring(0, 1500));

    const { response } = await callAI({
      module: 'knowledge_extract_atoms',
      category: 'lowvol',
      messages: [{ role: 'user', content: prompt }],
      fetchOptions: { temperature: 0.3, max_tokens: 1000 },
    });

    if (!response.ok) {
      console.error('[Knowledge] Atom extraction API error:', response.status);
      return;
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    // 解析 JSON
    let parsed;
    try {
      const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[Knowledge] Atom extraction parse error:', e, 'raw:', rawText.substring(0, 200));
      return;
    }

    if (!parsed.atoms || !Array.isArray(parsed.atoms)) return;

    // 保存提取的原子
    const savedAtoms = [];
    for (const atomData of parsed.atoms) {
      if (!atomData.content || atomData.content.trim().length < 5) continue;
      const atom = knowledgeStore.addAtom({
        content: atomData.content.trim(),
        source_note_ids: [sourceNoteId],
        domain: atomData.domain || '通用',
        type: atomData.type || 'fact',
        importance: atomData.importance ?? 0.5
      });
      if (atom) savedAtoms.push(atom);
    }

    if (savedAtoms.length > 0) {
      console.log('[Knowledge] Extracted', savedAtoms.length, 'atoms from note:', sourceNoteId);
      // 通知前端知识图谱更新
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('knowledge:atoms-updated', { count: savedAtoms.length });
      }
    }
  } catch (e) {
    console.error('[Knowledge] extractKnowledgeAtoms error:', e);
  }
}

// ========== 知识聚类配置 ==========
const CLUSTERING_CONFIG = {
  BATCH_SIZE: 80,                    // 每批最大原子数
  SINGLE_CALL_THRESHOLD: 80,         // 单次调用阈值
  ATOM_CONTENT_MAX_LENGTH: 60,       // 原子内容截断长度（省 token：从80降到60）
  CLUSTER_INFO_MAX_COUNT: 20,        // 已有簇最大展示数（省 token：从30降到20）
  MAX_TOKENS_BATCH: 3000,            // 分批模式输出 token 上限（省 token：从4000降到3000）
  MAX_TOKENS_SINGLE: 1500,           // 单次模式输出 token 上限（省 token：从2000降到1500）
  TEMPERATURE: 0.3,                  // 聚类温度
  BATCH_DELAY_MS: 500,               // 批次间隔（避免 QPS 限制）
  MAX_RETRIES: 2,                    // 单批最大重试次数
  DAILY_LIMIT: 1,                    // 每日聚类调用次数上限（省 token）
  MIN_ATOMS_FOR_CLUSTERING: 3,       // 最少需要多少个未聚类原子才触发 AI 聚类
};

let clusteringAborted = false;
let clusteringRunning = false;

// 聚类每日调用计数
const CLUSTERING_CALLS_KEY = 'memora_clustering_calls_count';
const CLUSTERING_CALLS_DATE_KEY = 'memora_clustering_calls_date';

function canMakeClusteringCall() {
  const today = new Date().toISOString().split('T')[0];
  const storedDate = getSetting(CLUSTERING_CALLS_DATE_KEY);
  if (storedDate !== today) {
    setSetting(CLUSTERING_CALLS_KEY, '0');
    setSetting(CLUSTERING_CALLS_DATE_KEY, today);
    return true;
  }
  const count = parseInt(getSetting(CLUSTERING_CALLS_KEY) || '0');
  return count < CLUSTERING_CONFIG.DAILY_LIMIT;
}

function incrementClusteringCallCount() {
  const today = new Date().toISOString().split('T')[0];
  const storedDate = getSetting(CLUSTERING_CALLS_DATE_KEY);
  if (storedDate !== today) {
    setSetting(CLUSTERING_CALLS_KEY, '1');
    setSetting(CLUSTERING_CALLS_DATE_KEY, today);
  } else {
    const count = parseInt(getSetting(CLUSTERING_CALLS_KEY) || '0');
    setSetting(CLUSTERING_CALLS_KEY, (count + 1).toString());
  }
}

function getClusteringCallStats() {
  const today = new Date().toISOString().split('T')[0];
  const storedDate = getSetting(CLUSTERING_CALLS_DATE_KEY);
  if (storedDate !== today) return { count: 0, limit: CLUSTERING_CONFIG.DAILY_LIMIT, remaining: CLUSTERING_CONFIG.DAILY_LIMIT };
  const count = parseInt(getSetting(CLUSTERING_CALLS_KEY) || '0');
  return { count, limit: CLUSTERING_CONFIG.DAILY_LIMIT, remaining: Math.max(0, CLUSTERING_CONFIG.DAILY_LIMIT - count) };
}

// 原子内容压缩：保留核心语义，截断过长内容
function compressAtomContent(atom) {
  let content = atom.content || '';
  const maxLen = CLUSTERING_CONFIG.ATOM_CONTENT_MAX_LENGTH;
  if (content.length > maxLen) {
    content = content.substring(0, Math.floor(maxLen * 0.75)) + '...' + content.substring(content.length - Math.floor(maxLen * 0.25));
  }
  return content;
}

// 簇信息精简：只保留 ID + 名称 + 关键词
function compressClusterInfo(cluster) {
  const kw = (cluster.keywords || []).slice(0, 3).join('/');
  return `ID:${cluster.id} | ${cluster.name} | ${kw}`;
}

// 分批逻辑
function splitIntoBatches(atoms, batchSize = CLUSTERING_CONFIG.BATCH_SIZE) {
  const batches = [];
  for (let i = 0; i < atoms.length; i += batchSize) {
    batches.push(atoms.slice(i, i + batchSize));
  }
  return batches;
}

// 加载聚类 prompt 模板
function loadClusteringPromptTemplate() {
  const promptPath = path.join(PROMPT_DIR, 'knowledge_clustering.md');
  try {
    return fs.readFileSync(promptPath, 'utf8');
  } catch (e) {
    return `将以下知识原子按主题聚类。

重要规则：
1. 优先归入已有簇，只有确实无法归入时才新建簇
2. 同一主题的原子应归入同一个簇，不要拆分到多个新建簇
3. 尽量减少新建簇的数量，宁可归入稍相关的已有簇
4. 新建簇时确保名称不与已有簇重复

已有知识簇：
{existing_clusters}

待聚类原子：
{unclustered_atoms}

输出严格JSON：
{"assignments":[{"atom_id":"...","cluster_id":"已有簇ID或null","new_cluster_name":"新建时","new_cluster_description":"新建时","new_cluster_keywords":["新建时"]}],"mature_cluster_ids":[]}`;
  }
}

// 构建聚类 prompt（使用压缩内容）
function buildClusteringPrompt(existingClusters, batchAtoms, promptTemplate) {
  // 已有簇：按原子数排序取前 N 个
  const sortedClusters = [...existingClusters]
    .sort((a, b) => (b.atom_ids?.length || 0) - (a.atom_ids?.length || 0))
    .slice(0, CLUSTERING_CONFIG.CLUSTER_INFO_MAX_COUNT);

  const clusterStr = sortedClusters.map(c => compressClusterInfo(c)).join('\n');
  const atomStr = batchAtoms.map(a =>
    `ID:${a.id} | ${compressAtomContent(a)} | ${a.type} | ${a.domain}`
  ).join('\n');

  return promptTemplate
    .replace('{existing_clusters}', clusterStr || '（暂无）')
    .replace('{unclustered_atoms}', atomStr);
}

// 获取聚类用的 ADP 配置
function getClusteringADPConfig() {
  let clusteringAppKey, url;
  if (authState.isLoggedIn && remoteConfig?.adp && !authState.forceLocalConfig) {
    clusteringAppKey = remoteConfig.adp.clustering_app_key || '';
    url = remoteConfig.adp.url || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  } else {
    clusteringAppKey = getSetting('adp_clustering_app_key') || '';
    url = getSetting('adp_url') || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  }
  // 回退到 knowledge key
  if (!clusteringAppKey || clusteringAppKey.trim() === '') {
    clusteringAppKey = DEFAULT_ADP_CLUSTERING_APP_KEY;
  }
  return { clusteringAppKey: clusteringAppKey.trim(), url: normalizeADPUrl(url) };
}

// 单批 AI 调用 + 解析（使用 ADP SSE 接口）
// v2.3: LLM 模式下自动切换为 LLM 调用
async function processClusteringBatch(batchAtoms, existingClusters, promptTemplate, retryCount = 0) {
  const prompt = buildClusteringPrompt(existingClusters, batchAtoms, promptTemplate);

  // v2.3: LLM 模式下走 LLM
  if (getGlobalAIMode() === 'llm') {
    return await _processClusteringBatchLLM(batchAtoms, existingClusters, promptTemplate, prompt, retryCount);
  }

  // 登录检查
  if (!authState.isLoggedIn) {
    return { success: false, error: '聚类功能需要登录后使用', assignments: [] };
  }

  const { clusteringAppKey, url } = getClusteringADPConfig();
  const convId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  const requestId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

  const requestBody = {
    RequestId: requestId,
    ConversationId: convId,
    AppKey: clusteringAppKey,
    VisitorId: getDeviceFingerprint(),
    Contents: [{ Type: 'text', Text: prompt }],
    Incremental: true,
    Stream: 'enable',
    StreamingThrottle: 5
  };

  const startTime = Date.now();

  try {
    const httpUrl = normalizeADPUrl(url).replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
    console.log('[Knowledge] Clustering via ADP, url:', httpUrl, 'appKey:', clusteringAppKey.substring(0, 10) + '...');

    const response = await fetch(httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      // 429 限流
      if (response.status === 429 && retryCount < CLUSTERING_CONFIG.MAX_RETRIES) {
        console.warn('[Knowledge] ADP rate limited, retrying in 5s...');
        await new Promise(r => setTimeout(r, 5000));
        return processClusteringBatch(batchAtoms, existingClusters, promptTemplate, retryCount + 1);
      }
      const errBody = await response.text().catch(() => '');
      console.error('[Knowledge] ADP API error:', response.status, errBody.substring(0, 300));

      // 记录审计日志
      if (auditLogger) {
        auditLogger.record({
          module: 'knowledge_clustering',
          model: 'adp',
          baseUrl: url,
          adpAppKey: clusteringAppKey,
          input: { systemPromptLen: 0, userPromptLen: prompt.length, userPrompt: prompt },
          output: { status: response.status, contentLen: 0, content: '', finishReason: null },
          tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          latencyMs: Date.now() - startTime,
          error: `HTTP ${response.status}: ${errBody.substring(0, 200)}`,
        });
      }

      return { success: false, error: `ADP 服务调用失败（${response.status}）`, assignments: [] };
    }

    // 读取 SSE 流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let currentEvent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (clusteringAborted) {
        reader.cancel();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.substring(6).trim();
          continue;
        }

        if (line.startsWith('data:')) {
          const data = line.substring(5).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            const eventName = currentEvent || parsed.event || '';

            let deltaText = '';
            if (eventName === 'text.delta') {
              deltaText = parsed.Text || parsed.payload?.content?.[0]?.text || parsed.content?.text || '';
            } else if (eventName === 'message.added' || eventName === 'content.added') {
              deltaText = parsed.Content?.[0]?.Text || parsed.Text || '';
            } else if (eventName === 'message.done') {
              const doneText = parsed.Message?.Content?.[0]?.Text || parsed.Text || '';
              if (doneText && !fullText) fullText = doneText;
              break;
            } else if (eventName === 'response.completed') {
              break;
            } else if (eventName === 'error' || parsed.error) {
              const errMsg = parsed.error?.message || parsed.error?.code || JSON.stringify(parsed.error || parsed);
              console.error('[Knowledge] Clustering ADP error:', errMsg);

              if (auditLogger) {
                auditLogger.record({
                  module: 'knowledge_clustering',
                  model: 'adp',
                  baseUrl: url,
                  adpAppKey: clusteringAppKey,
                  input: { systemPromptLen: 0, userPromptLen: prompt.length, userPrompt: prompt },
                  output: { status: response.status, contentLen: fullText.length, content: fullText, finishReason: 'error' },
                  tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                  latencyMs: Date.now() - startTime,
                  error: errMsg,
                });
              }

              return { success: false, error: `ADP 错误：${errMsg}`, assignments: [] };
            }

            if (deltaText) fullText += deltaText;
          } catch (_) {
            // 非 JSON 数据，跳过
          }
        }

        if (line.trim() === '') {
          currentEvent = '';
        }
      }
    }

    // 记录审计日志（成功）
    if (auditLogger) {
      auditLogger.record({
        module: 'knowledge_clustering',
        model: 'adp',
        baseUrl: url,
        adpAppKey: clusteringAppKey,
        input: { systemPromptLen: 0, userPromptLen: prompt.length, userPrompt: prompt },
        output: { status: 200, contentLen: fullText.length, content: fullText, finishReason: 'completed' },
        tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        latencyMs: Date.now() - startTime,
      });
    }

    // 解析 ADP 返回的 JSON
    let parsed;
    try {
      // ADP 可能返回 markdown 包裹的 JSON
      const jsonStr = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      // 提取 JSON 部分（ADP 可能在 JSON 前后有额外文字）
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(jsonStr);
      }
    } catch (e) {
      // JSON 解析失败，重试
      if (retryCount < CLUSTERING_CONFIG.MAX_RETRIES) {
        console.warn('[Knowledge] Clustering parse error (ADP), retrying...', retryCount + 1, 'Raw:', fullText.substring(0, 200));
        await new Promise(r => setTimeout(r, 1000));
        return processClusteringBatch(batchAtoms, existingClusters, promptTemplate, retryCount + 1);
      }
      console.error('[Knowledge] Clustering parse error after retries:', e, 'Raw:', fullText.substring(0, 200));
      return { success: false, error: 'ADP 返回格式异常，无法解析聚类结果', assignments: [] };
    }

    return { success: true, assignments: parsed.assignments || [], mature_cluster_ids: parsed.mature_cluster_ids || [] };
  } catch (e) {
    if (retryCount < CLUSTERING_CONFIG.MAX_RETRIES) {
      console.warn('[Knowledge] Batch error (ADP), retrying...', retryCount + 1, e.message);
      await new Promise(r => setTimeout(r, 1000));
      return processClusteringBatch(batchAtoms, existingClusters, promptTemplate, retryCount + 1);
    }
    return { success: false, error: e.message, assignments: [] };
  }
}

// 应用聚类结果（创建簇 + 归属原子）
function applyClusteringAssignments(assignments, unclustered) {
  let clustersCreated = 0;
  let atomsAssigned = 0;

  for (const assignment of assignments) {
    let clusterId = assignment.cluster_id;

    // 新建簇前检查：是否已有同名簇？如有则直接归入
    if (!clusterId && assignment.new_cluster_name) {
      const existingCluster = knowledgeStore.getClusters().find(
        c => c.name === assignment.new_cluster_name
      );
      if (existingCluster) {
        clusterId = existingCluster.id;
        console.log('[Knowledge] Reusing existing cluster:', existingCluster.name);
      } else {
        const cluster = knowledgeStore.addCluster({
          name: assignment.new_cluster_name,
          description: assignment.new_cluster_description || '',
          keywords: assignment.new_cluster_keywords || [],
          atom_ids: [],
          domain: unclustered.find(a => a.id === assignment.atom_id)?.domain || '通用'
        });
        if (cluster) {
          clusterId = cluster.id;
          clustersCreated++;
        }
      }
    }

    // 归入簇
    if (clusterId) {
      const result = knowledgeStore.clusterAtom(assignment.atom_id, clusterId);
      if (result) atomsAssigned++;
    }
  }

  return { clustersCreated, atomsAssigned };
}

// 本地关键词预聚类：基于已有簇的关键词，把明显匹配的原子直接归入，减少 AI 调用量
function localKeywordPreCluster(unclustered) {
  if (!knowledgeStore) return { assigned: 0, remaining: unclustered };
  
  const existingClusters = knowledgeStore.getClusters();
  if (existingClusters.length === 0) return { assigned: 0, remaining: unclustered };
  
  let assigned = 0;
  const stillUnclustered = [];
  
  for (const atom of unclustered) {
    let bestMatch = null;
    let bestScore = 0;
    const atomContent = (atom.content || '').toLowerCase();
    const atomDomain = (atom.domain || '').toLowerCase();
    
    for (const cluster of existingClusters) {
      const keywords = (cluster.keywords || []).map(k => k.toLowerCase());
      const clusterName = (cluster.name || '').toLowerCase();
      const clusterDomain = (cluster.domain || '').toLowerCase();
      
      let score = 0;
      // 关键词命中
      for (const kw of keywords) {
        if (kw.length >= 2 && atomContent.includes(kw)) {
          score += 2;
        }
      }
      // 簇名命中
      if (clusterName.length >= 2 && atomContent.includes(clusterName)) {
        score += 3;
      }
      // 同领域加分
      if (atomDomain && clusterDomain && atomDomain === clusterDomain) {
        score += 1;
      }
      
      if (score > bestScore && score >= 3) {
        bestScore = score;
        bestMatch = cluster;
      }
    }
    
    if (bestMatch) {
      const result = knowledgeStore.clusterAtom(atom.id, bestMatch.id);
      if (result) {
        assigned++;
        console.log(`[Knowledge] Local pre-cluster: atom "${atom.content?.substring(0, 30)}..." → cluster "${bestMatch.name}" (score=${bestScore})`);
      } else {
        stillUnclustered.push(atom);
      }
    } else {
      stillUnclustered.push(atom);
    }
  }
  
  return { assigned, remaining: stillUnclustered };
}

// 知识聚类：将未归簇的原子智能分组（支持分批处理）
// LLM 模式下的聚类批次处理
async function _processClusteringBatchLLM(batchAtoms, existingClusters, promptTemplate, prompt, retryCount = 0) {
  try {
    console.log('[Knowledge] Clustering via LLM (LLM mode), atoms:', batchAtoms.length);
    const { response } = await callAI({
      module: 'knowledge_clustering',
      category: 'lowvol',
      messages: [{ role: 'user', content: prompt }],
      fetchOptions: { temperature: 0.3, max_tokens: 4000, response_format: { type: 'json_object' } },
    });

    if (!response || !response.ok) {
      if (retryCount < CLUSTERING_CONFIG.MAX_RETRIES) {
        console.warn('[Knowledge] LLM clustering failed, retrying...', retryCount + 1);
        await new Promise(r => setTimeout(r, 2000));
        return processClusteringBatch(batchAtoms, existingClusters, promptTemplate, retryCount + 1);
      }
      return { success: false, error: 'LLM 调用失败', assignments: [] };
    }

    let fullText = '';
    if (response._fullContent) {
      fullText = response._fullContent;
    } else {
      const data = await response.json();
      fullText = data.choices?.[0]?.message?.content || '';
    }

    if (!fullText) {
      if (retryCount < CLUSTERING_CONFIG.MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000));
        return processClusteringBatch(batchAtoms, existingClusters, promptTemplate, retryCount + 1);
      }
      return { success: false, error: 'LLM 返回内容为空', assignments: [] };
    }

    // 解析 JSON
    try {
      const jsonStr = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      incrementClusteringCallCount();
      return { success: true, assignments: parsed.assignments || [], mature_cluster_ids: parsed.mature_cluster_ids || [] };
    } catch (e) {
      if (retryCount < CLUSTERING_CONFIG.MAX_RETRIES) {
        console.warn('[Knowledge] Clustering parse error (LLM), retrying...', retryCount + 1);
        await new Promise(r => setTimeout(r, 1000));
        return processClusteringBatch(batchAtoms, existingClusters, promptTemplate, retryCount + 1);
      }
      return { success: false, error: 'JSON 解析失败', assignments: [] };
    }
  } catch (e) {
    if (retryCount < CLUSTERING_CONFIG.MAX_RETRIES) {
      console.warn('[Knowledge] Batch error (LLM), retrying...', retryCount + 1, e.message);
      await new Promise(r => setTimeout(r, 1000));
      return processClusteringBatch(batchAtoms, existingClusters, promptTemplate, retryCount + 1);
    }
    return { success: false, error: e.message, assignments: [] };
  }
}

async function autoClusterAtoms() {
  try {
    let unclustered = knowledgeStore.getAtoms({ unclustered: true });
    if (unclustered.length < CLUSTERING_CONFIG.MIN_ATOMS_FOR_CLUSTERING) {
      console.log('[Knowledge] Too few unclustered atoms for clustering:', unclustered.length);
      return {
        clustersCreated: 0,
        atomsAssigned: 0,
        message: unclustered.length === 0
          ? '没有待聚类的知识原子，所有原子都已归入知识簇'
          : `待聚类原子仅 ${unclustered.length} 个，至少需要 ${CLUSTERING_CONFIG.MIN_ATOMS_FOR_CLUSTERING} 个才能进行智能聚类`
      };
    }

    // 本地关键词预聚类：减少需要发往 AI 的原子数量（省 token）
    const preResult = localKeywordPreCluster(unclustered);
    let localAssigned = preResult.assigned;
    unclustered = preResult.remaining;
    
    if (localAssigned > 0) {
      console.log(`[Knowledge] Local pre-cluster assigned ${localAssigned} atoms, ${unclustered.length} remaining for AI`);
      // 通知前端预聚类结果
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('knowledge:clustering-progress', {
          currentBatch: 0, totalBatches: 1, atomsAssigned: localAssigned,
          message: `本地预聚类 ${localAssigned} 个原子，剩余 ${unclustered.length} 个需要 AI 智能聚类...`
        });
      }
    }
    
    // 如果预聚类后剩余原子不足，直接返回
    if (unclustered.length < CLUSTERING_CONFIG.MIN_ATOMS_FOR_CLUSTERING) {
      return {
        clustersCreated: 0,
        atomsAssigned: localAssigned,
        message: localAssigned > 0
          ? `本地关键词聚类 ${localAssigned} 个原子，无需 AI 聚类`
          : '没有待聚类的知识原子'
      };
    }

    clusteringAborted = false;
    const adpConfig = getClusteringADPConfig();
    console.log('[Knowledge] autoClusterAtoms starting:', {
      unclusteredCount: unclustered.length,
      adpUrl: adpConfig.url,
      clusteringAppKey: adpConfig.clusteringAppKey ? `${adpConfig.clusteringAppKey.substring(0, 10)}...` : 'MISSING',
      isLoggedIn: authState.isLoggedIn,
    });
    const promptTemplate = loadClusteringPromptTemplate();
    const existingClusters = knowledgeStore.getClusters();

    let totalClustersCreated = 0;
    let totalAtomsAssigned = localAssigned; // 包含本地预聚类数量
    const failedBatches = [];
    let wasAborted = false;

    // 判断是否需要分批
    if (unclustered.length <= CLUSTERING_CONFIG.SINGLE_CALL_THRESHOLD) {
      // 单次调用模式（原子数 ≤ 阈值）
      console.log('[Knowledge] Single-batch clustering:', unclustered.length, 'atoms');

      // 通知前端开始
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('knowledge:clustering-progress', {
          currentBatch: 1, totalBatches: 1, atomsAssigned: 0,
          message: '正在智能聚类...'
        });
      }

      const result = await processClusteringBatch(unclustered, existingClusters, promptTemplate);

      if (result.success) {
        const applyResult = applyClusteringAssignments(result.assignments, unclustered);
        totalClustersCreated = applyResult.clustersCreated;
        totalAtomsAssigned = applyResult.atomsAssigned;

        // 更新成熟簇状态
        for (const clusterId of (result.mature_cluster_ids || [])) {
          const cluster = knowledgeStore.getClusterById(clusterId);
          if (cluster && cluster.status === 'growing') {
            knowledgeStore.updateCluster(clusterId, { status: 'mature' });
          }
        }
      } else {
        return { clustersCreated: 0, atomsAssigned: 0, message: result.error || '聚类失败' };
      }
    } else {
      // 分批模式
      const batches = splitIntoBatches(unclustered);
      console.log('[Knowledge] Batch clustering:', unclustered.length, 'atoms in', batches.length, 'batches');

      // 通知前端分批开始
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('knowledge:clustering-progress', {
          currentBatch: 0, totalBatches: batches.length, atomsAssigned: 0,
          message: `共 ${batches.length} 批，准备开始...`
        });
      }

      for (let i = 0; i < batches.length; i++) {
        // 检查取消
        if (clusteringAborted) {
          console.log('[Knowledge] Clustering aborted at batch', i + 1);
          wasAborted = true;
          break;
        }

        const batch = batches[i];
        // 每批都获取最新的簇列表（前批可能新建了簇）
        const currentClusters = knowledgeStore.getClusters();

        // 通知前端进度
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('knowledge:clustering-progress', {
            currentBatch: i + 1, totalBatches: batches.length, atomsAssigned: totalAtomsAssigned,
            message: `正在聚类第 ${i + 1}/${batches.length} 批（${batch.length} 个原子）...`
          });
        }

        const result = await processClusteringBatch(batch, currentClusters, promptTemplate);

        if (result.success) {
          const applyResult = applyClusteringAssignments(result.assignments, batch);
          totalClustersCreated += applyResult.clustersCreated;
          totalAtomsAssigned += applyResult.atomsAssigned;

          // 更新成熟簇状态
          for (const clusterId of (result.mature_cluster_ids || [])) {
            const cluster = knowledgeStore.getClusterById(clusterId);
            if (cluster && cluster.status === 'growing') {
              knowledgeStore.updateCluster(clusterId, { status: 'mature' });
            }
          }
        } else {
          failedBatches.push({ batch: i + 1, error: result.error });
          console.warn('[Knowledge] Batch', i + 1, 'failed:', result.error);
        }

        // 批间延迟（避免 QPS 限制）
        if (i < batches.length - 1) {
          await new Promise(r => setTimeout(r, CLUSTERING_CONFIG.BATCH_DELAY_MS));
        }
      }
    }

    // 合并相似簇 + 清理空簇
    const mergeResult = knowledgeStore.mergeSimilarClusters();
    const cleanupResult = knowledgeStore.cleanupEmptyClusters();

    // 合并后再检查 mature 状态
    for (const cluster of knowledgeStore.getClusters()) {
      if (cluster.status === 'growing' && cluster.atom_ids.length >= 3) {
        knowledgeStore.updateCluster(cluster.id, { status: 'mature' });
      }
    }

    console.log('[Knowledge] Clustering done:', totalClustersCreated, 'clusters created,',
      totalAtomsAssigned, 'atoms assigned,', mergeResult.mergeCount, 'merged,',
      cleanupResult.removed, 'emptied');

    // 通知前端完成
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('knowledge:clusters-updated', {
        clustersCreated: totalClustersCreated, atomsAssigned: totalAtomsAssigned
      });
      mainWindow.webContents.send('knowledge:clustering-progress', {
        currentBatch: -1, totalBatches: 0, atomsAssigned: totalAtomsAssigned,
        message: '聚类完成', done: true,
        clustersCreated: totalClustersCreated, failedBatches: failedBatches.length
      });
    }

    const message = wasAborted
      ? `聚类已取消（已处理 ${totalAtomsAssigned} 个原子）`
      : failedBatches.length > 0
        ? `${failedBatches.length} 批失败（${failedBatches.map(f => `第${f.batch}批`).join('、')}），其余已完成`
        : null;

    return { clustersCreated: totalClustersCreated, atomsAssigned: totalAtomsAssigned, message, cancelled: wasAborted };
  } catch (e) {
    console.error('[Knowledge] autoClusterAtoms error:', e);
    return { clustersCreated: 0, atomsAssigned: 0, message: `聚类出错：${e.message}` };
  }
}

// 知识文章合成：从簇中生成文章
async function generateArticle(clusterId) {
  try {
    const cluster = knowledgeStore.getClusterById(clusterId);
    if (!cluster) return { success: false, error: '簇不存在' };

    const atoms = (cluster.atom_ids || []).map(id => knowledgeStore.getAtomById(id)).filter(Boolean);
    if (atoms.length === 0) return { success: false, error: '簇内无知识原子' };

    // 检查簇是否已有文章，如有则返回已有文章（避免重复生成）
    if (cluster.article_id) {
      const existingArticle = knowledgeStore.getArticleById(cluster.article_id);
      if (existingArticle) {
        console.log('[Knowledge] Cluster already has article, returning existing:', existingArticle.title);
        return { success: true, article: existingArticle, isExisting: true };
      }
    }

    const promptPath = path.join(PROMPT_DIR, 'knowledge_article_synthesis.md');
    let promptTemplate;
    try {
      promptTemplate = fs.readFileSync(promptPath, 'utf8');
    } catch (e) {
      promptTemplate = `根据以下知识原子合成一篇结构化的Markdown知识文章。

簇名称：{cluster_name}
领域：{cluster_domain}

知识原子：
{atoms}

输出严格JSON：
{"title":"...","content":"# Markdown文章","tags":["..."]}`;
    }

    const atomsStr = atoms.map(a =>
      `[${a.id}] [${a.type}] [重要度:${a.importance}] ${a.content}`
    ).join('\n');

    const prompt = promptTemplate
      .replace('{cluster_name}', cluster.name)
      .replace('{cluster_description}', cluster.description || '')
      .replace('{cluster_domain}', cluster.domain || '通用')
      .replace('{atoms}', atomsStr);

    const { response } = await callAI({
      module: 'knowledge_article',
      category: 'lowvol',
      messages: [{ role: 'user', content: prompt }],
      fetchOptions: { temperature: 0.4, max_tokens: 3000 },
    });

    if (!response.ok) return { success: false, error: 'API调用失败' };

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[Knowledge] Article synthesis parse error:', e);
      return { success: false, error: 'AI返回格式错误' };
    }

    if (!parsed.title || !parsed.content) {
      return { success: false, error: 'AI返回内容不完整' };
    }

    // 统计来源笔记数
    const sourceNoteIds = new Set();
    for (const atom of atoms) {
      for (const nid of (atom.source_note_ids || [])) sourceNoteIds.add(nid);
    }

    const article = knowledgeStore.addArticle({
      cluster_id: clusterId,
      title: parsed.title,
      content: parsed.content,
      tags: parsed.tags || cluster.keywords || [],
      atom_count: atoms.length,
      source_note_count: sourceNoteIds.size,
      version: 1
    });

    if (!article) return { success: false, error: '文章保存失败' };

    console.log('[Knowledge] Article generated:', article.title);

    // 通知前端
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('knowledge:article-generated', { article });
    }

    return { success: true, article };
  } catch (e) {
    console.error('[Knowledge] generateArticle error:', e);
    return { success: false, error: e.message };
  }
}

// 知识跟随：基于剪贴板意图异步触发 ADP 推荐搜索
async function triggerKnowledgeRecommendation(text, intent) {
  try {
    // v2.0: 登录状态优先使用服务器配置（除非用户强制使用本地配置）
    let searchAppKey, knowledgeAppKey, generalAppKey, url;
    if (authState.isLoggedIn && remoteConfig?.adp && !authState.forceLocalConfig) {
      searchAppKey = remoteConfig.adp.search_app_key || '';
      knowledgeAppKey = remoteConfig.adp.knowledge_app_key || '';
      generalAppKey = remoteConfig.adp.app_key || '';
      url = remoteConfig.adp.url || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
    } else {
      searchAppKey = getSetting('adp_search_app_key');
      knowledgeAppKey = getSetting('adp_knowledge_app_key');
      generalAppKey = getSetting('adp_app_key');
      url = getSetting('adp_url') || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
    }
    // 优先级：knowledgeAppKey > searchAppKey > generalAppKey > default（推荐功能用 knowledgeKey）
    let appKeySource = 'default';
    let appKey = DEFAULT_ADP_KNOWLEDGE_APP_KEY;
    if (knowledgeAppKey && knowledgeAppKey.trim()) { appKey = knowledgeAppKey.trim(); appKeySource = 'knowledge'; }
    else if (searchAppKey && searchAppKey.trim()) { appKey = searchAppKey.trim(); appKeySource = 'search'; }
    else if (generalAppKey && generalAppKey.trim()) { appKey = generalAppKey.trim(); appKeySource = 'general'; }

    console.log('[Knowledge] 推荐触发 - AppKey来源:', appKeySource,
      '| knowledge:', (knowledgeAppKey || '').substring(0, 10) + '...',
      '| search:', (searchAppKey || '').substring(0, 10) + '...',
      '| general:', (generalAppKey || '').substring(0, 10) + '...',
      '| 最终使用:', appKey.substring(0, 10) + '...',
      '| isLoggedIn:', authState.isLoggedIn,
      '| forceLocal:', authState.forceLocalConfig);

    const convId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    const requestId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

    // 根据意图构建不同的搜索 query
    let query = text.substring(0, 200);
    if (intent === 'search_knowledge') {
      query = `请搜索相关知识：${text.substring(0, 100)}`;
    } else if (intent === 'get_document') {
      query = `请提供相关文档链接和摘要：${text.substring(0, 100)}`;
    } else if (intent === 'query_question') {
      query = `请回答以下问题：${text.substring(0, 100)}`;
    } else if (intent === 'doubt') {
      query = `请解释澄清：${text.substring(0, 100)}`;
    }

    const requestBody = {
      RequestId: requestId,
      ConversationId: convId,
      AppKey: appKey.trim(),
      VisitorId: getDeviceFingerprint(),
      Contents: [{ Type: 'text', Text: query }],
      Incremental: true,
      Stream: 'enable',
      StreamingThrottle: 5
    };

    const httpUrl = normalizeADPUrl(url).replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');

    console.log('[Knowledge] Calling ADP for recommendation, url:', httpUrl, 'appKey source:', appKeySource, 'appKey:', appKey.substring(0, 10) + '...', 'query:', query.substring(0, 60));

    const _recStartTime = Date.now();
    const response = await fetch(httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      console.error('[Knowledge] Recommendation ADP failed:', response.status, await response.text().catch(() => ''));
      return;
    }

    console.log('[Knowledge] ADP response OK, reading SSE stream...');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let currentEvent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.substring(6).trim();
          continue;
        }

        if (line.startsWith('data:')) {
          const data = line.substring(5).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            const eventName = currentEvent || parsed.event || '';

            // ADP V2 文本提取：兼容两种数据结构
            // 格式1（嵌套）：{ payload: { content: { text: "..." } } }
            // 格式2（扁平）：{ Text: "..." }  ← ADP V2 实际格式
            let deltaText = '';
            if (eventName === 'text.delta') {
              deltaText = parsed.Text || parsed.payload?.content?.[0]?.text || parsed.payload?.content?.text || parsed.content?.text || parsed.payload?.text || '';
            } else if (eventName === 'message.added' || eventName === 'content.added') {
              deltaText = parsed.Content?.[0]?.Text || parsed.Text || parsed.payload?.content?.[0]?.text || parsed.payload?.content?.text || parsed.content?.text || '';
            } else if (eventName === 'message.done') {
              // message.done 可能包含完整消息文本
              const doneText = parsed.Message?.Content?.[0]?.Text || parsed.Text || '';
              if (doneText && !fullText) {
                fullText = doneText;
              }
              break;
            } else if (eventName === 'response.completed') {
              break;
            } else if (eventName === 'error' || parsed.error) {
              console.error('[Knowledge] Recommendation ADP error:', parsed.error || parsed);
              return;
            }
            
            if (deltaText) {
              fullText += deltaText;
            }
          } catch (e) {
            // 非 JSON 数据，跳过
          }
        }

        if (line.trim() === '') {
          currentEvent = '';
        }
      }
    }

    // 保存推荐结果并通知前端
    console.log('[Knowledge] ADP recommendation completed, fullText length:', fullText.length, 'preview:', fullText.substring(0, 100));
    if (fullText) {
      const recs = loadKnowledgeRecommendations();
      const newRec = {
        id: 'kr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
        device_fingerprint: getDeviceFingerprint(),
        clipboard_hash: crypto.createHash('md5').update(text).digest('hex'),
        clipboard_preview: text.substring(0, 50),
        title: text.substring(0, 50),
        content: fullText,
        source: 'adp_recommend',
        intent: intent,
        is_read: false,
        is_saved: false,
        created_at: new Date().toISOString()
      };
      recs.unshift(newRec);
      if (recs.length > 100) recs.length = 100;
      saveKnowledgeRecommendations(recs);

      // 通知前端有新推荐
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('knowledge:recommendation-new', { recommendation: newRec });
      }
      console.log('[Knowledge] Recommendation saved and pushed to frontend');
    }

    // 审计日志：知识推荐完成
    if (auditLogger) {
      auditLogger.record({
        module: 'knowledge_recommend',
        model: 'adp',
        baseUrl: httpUrl,
        adpAppKey: appKey,
        input: { systemPromptLen: 0, userPromptLen: query.length, userPrompt: query },
        output: { status: 200, contentLen: fullText.length, content: fullText, finishReason: 'completed' },
        tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        latencyMs: Date.now() - _recStartTime,
      });
    }
  } catch (e) {
    console.error('[Knowledge] triggerKnowledgeRecommendation error:', e);
  }
}

// ADP SSE 流式请求管理
let activeADPController = null;

// 打开外部链接
ipcMain.handle('open-external', async (event, url) => {
  const { shell } = require('electron');
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (e) {
    console.error('[App] openExternal error:', e);
    return { success: false, error: e.message };
  }
});

// 知识跟随：ADP 搜索（SSE 流式）
// v2.3: LLM 模式下改用 LLM 流式替代
ipcMain.handle('knowledge:search-adp', async (event, { query, intent, conversationId }) => {
  // v2.3: LLM 模式下走 LLM 流式
  if (getGlobalAIMode() === 'llm') {
    return await _knowledgeSearchLLM(event, { query, intent, conversationId });
  }

  // v2.0: 登录状态优先使用服务器配置（除非用户强制使用本地配置）
  let searchAppKey, knowledgeAppKey, generalAppKey, url;
  if (authState.isLoggedIn && remoteConfig?.adp && !authState.forceLocalConfig) {
    searchAppKey = remoteConfig.adp.search_app_key || '';
    knowledgeAppKey = remoteConfig.adp.knowledge_app_key || '';
    generalAppKey = remoteConfig.adp.app_key || '';
    url = remoteConfig.adp.url || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  } else {
    searchAppKey = getSetting('adp_search_app_key');
    knowledgeAppKey = getSetting('adp_knowledge_app_key');
    generalAppKey = getSetting('adp_app_key');
    url = getSetting('adp_url') || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  }
  const appKey = (searchAppKey && searchAppKey.trim()) || (knowledgeAppKey && knowledgeAppKey.trim()) || (generalAppKey && generalAppKey.trim()) || DEFAULT_ADP_KNOWLEDGE_APP_KEY;
  const appKeySource = (searchAppKey && searchAppKey.trim()) ? 'search' : (knowledgeAppKey && knowledgeAppKey.trim()) ? 'knowledge' : (generalAppKey && generalAppKey.trim()) ? 'general' : 'default';

  console.log('[Knowledge] 搜索触发 - AppKey来源:', appKeySource,
    '| search:', (searchAppKey || '').substring(0, 10) + '...',
    '| knowledge:', (knowledgeAppKey || '').substring(0, 10) + '...',
    '| general:', (generalAppKey || '').substring(0, 10) + '...',
    '| 最终使用:', appKey.substring(0, 10) + '...',
    '| isLoggedIn:', authState.isLoggedIn,
    '| forceLocal:', authState.forceLocalConfig);

  const convId = conversationId || Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  const requestId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

  const requestBody = {
    RequestId: requestId,
    ConversationId: convId,
    AppKey: appKey.trim(),
    VisitorId: getDeviceFingerprint(),
    Contents: [{ Type: 'text', Text: query }],
    Incremental: true,
    Stream: 'enable',
    StreamingThrottle: 5
  };

  // 创建 AbortController 用于取消请求
  const controller = new AbortController();
  activeADPController = controller;
  const _searchStartTime = Date.now();

  try {
    const https = require('https');
    const httpUrl = normalizeADPUrl(url).replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');

    const response = await fetch(httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      // 审计日志：HTTP 错误
      if (auditLogger) {
        auditLogger.record({
          module: 'knowledge_search',
          model: 'adp',
          baseUrl: httpUrl,
          adpAppKey: appKey,
          input: { systemPromptLen: 0, userPromptLen: query.length, userPrompt: query },
          output: { status: response.status, contentLen: 0, content: '', finishReason: null },
          tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          latencyMs: Date.now() - _searchStartTime,
          error: `HTTP ${response.status}`,
        });
      }
      return { success: false, error: `ADP请求失败: ${response.status}`, conversationId: convId };
    }

    // 异步处理 SSE 流
    (async () => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let currentEvent = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 保留不完整的行

          for (const line of lines) {
            // 解析 SSE event: 行
            if (line.startsWith('event:')) {
              currentEvent = line.substring(6).trim();
              continue;
            }

            // 解析 SSE data: 行
            if (line.startsWith('data:')) {
              const data = line.substring(5).trim();
              if (data === '[DONE]') {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('knowledge:adp-chunk', { text: '', done: true, conversationId: convId });
                }
                currentEvent = '';
                break;
              }

              try {
                const parsed = JSON.parse(data);
                // V2 API: 事件名来自 event: 行 或 data 中的 Type 字段
                const eventName = currentEvent || parsed.Type || parsed.event || '';
                let text = '';

                // V2 text.delta: { Type: "text.delta", MessageId, ContentIndex, Text }
                if (eventName === 'text.delta') {
                  text = parsed.Text || parsed.payload?.content?.text || parsed.content?.text || '';
                }
                // V2 content.added: { Type: "content.added", Content: { Type: "text", Text: "..." } }
                else if (eventName === 'content.added') {
                  text = parsed.Content?.Text || parsed.payload?.content?.text || '';
                }
                // V2 text.replace: { Type: "text.replace", Text: "完整替换文本" }
                else if (eventName === 'text.replace') {
                  const replaceText = parsed.Text || parsed.payload?.content?.text || '';
                  if (replaceText) {
                    fullText = replaceText;
                    if (mainWindow && !mainWindow.isDestroyed()) {
                      mainWindow.webContents.send('knowledge:adp-chunk', { text: '', done: false, replace: true, fullText: fullText, conversationId: convId });
                    }
                  }
                  currentEvent = '';
                  continue;
                }
                // V2 message.done / response.completed: 流结束
                else if (eventName === 'response.completed' || eventName === 'message.done') {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('knowledge:adp-chunk', { text: '', done: true, conversationId: convId });
                  }
                  currentEvent = '';
                  break;
                }
                // V2 error: { Type: "error", Error: { Code, Message } }
                else if (eventName === 'error' || parsed.Error || parsed.error) {
                  const errMsg = parsed.Error?.Message || parsed.error?.message || (typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.Error || parsed.error));
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('knowledge:adp-chunk', { text: '', done: true, error: errMsg, conversationId: convId });
                  }
                  currentEvent = '';
                  break;
                }

                if (text) {
                  fullText += text;
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('knowledge:adp-chunk', { text, done: false, conversationId: convId });
                  }
                }
              } catch (parseErr) {
                // 非 JSON 数据，忽略
              }
            }

            // 空行重置 event
            if (line.trim() === '') {
              currentEvent = '';
            }
          }
        }

        // 流结束，如果没有发送过 done 信号则发送
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('knowledge:adp-chunk', { text: '', done: true, conversationId: convId });
        }

        // 保存搜索结果到推荐列表
        if (fullText) {
          const recs = loadKnowledgeRecommendations();
          const newRec = {
            id: 'kr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
            device_fingerprint: getDeviceFingerprint(),
            clipboard_hash: '',
            clipboard_preview: query.substring(0, 50),
            title: query.substring(0, 50),
            content: fullText,
            source: 'adp_search',
            intent: intent || 'search_knowledge',
            is_read: false,
            is_saved: false,
            created_at: new Date().toISOString()
          };
          recs.unshift(newRec);
          if (recs.length > 100) recs.length = 100; // 限制数量
          saveKnowledgeRecommendations(recs);
        }

        // 审计日志：知识搜索完成
        if (auditLogger) {
          auditLogger.record({
            module: 'knowledge_search',
            model: 'adp',
            baseUrl: httpUrl,
            adpAppKey: appKey,
            input: { systemPromptLen: 0, userPromptLen: query.length, userPrompt: query },
            output: { status: 200, contentLen: fullText.length, content: fullText, finishReason: 'completed' },
            tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            latencyMs: Date.now() - _searchStartTime,
          });
        }
      } catch (readErr) {
        if (readErr.name !== 'AbortError') {
          console.error('[Knowledge] SSE read error:', readErr);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('knowledge:adp-chunk', { text: '', done: true, error: readErr.message, conversationId: convId });
          }
        }
      }
    })();

    return { success: true, conversationId: convId };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: '请求已取消', conversationId: convId };
    }
    console.error('[Knowledge] ADP fetch error:', error);
    // 审计日志：异常
    if (auditLogger) {
      auditLogger.record({
        module: 'knowledge_search',
        model: 'adp',
        baseUrl: url,
        adpAppKey: appKey,
        input: { systemPromptLen: 0, userPromptLen: query.length, userPrompt: query },
        output: { status: null, contentLen: 0, content: '', finishReason: null },
        tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        latencyMs: Date.now() - _searchStartTime,
        error: error.message,
      });
    }
    return { success: false, error: error.message, conversationId: convId };
  }
});

// LLM 模式下的知识搜索（替代 ADP SSE）
async function _knowledgeSearchLLM(event, { query, intent, conversationId }) {
  try {
    const apiConfig = getHighVolLLMConfig(); // 搜索可能频繁，使用大用量配置
    const systemPrompt = '你是一个知识助手，帮助用户搜索和整理知识。根据用户的查询，提供相关知识和深入分析。';
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
    ];

    const { response } = await auditedDeepSeekCall({
      module: 'knowledge_search_llm',
      apiConfig,
      messages,
      fetchOptions: { temperature: 0.5, stream: true },
    });

    if (!response.ok) {
      return { success: false, error: `LLM 调用失败 (${response.status})` };
    }

    // 流式读取并推送
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') {
          mainWindow.webContents.send('knowledge:adp-chunk', {
            event: 'done', content: fullContent, isFinal: true,
          });
          break;
        }
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullContent += delta;
            mainWindow.webContents.send('knowledge:adp-chunk', {
              event: 'text.delta', content: delta, isFinal: false,
            });
          }
        } catch (_) {}
      }
    }

    return { success: true, streaming: true, source: 'llm' };
  } catch (e) {
    console.error('[Knowledge] LLM search error:', e);
    return { success: false, error: e.message };
  }
}

// 停止 ADP 流式输出
ipcMain.handle('knowledge:stop-adp', async () => {
  if (activeADPController) {
    activeADPController.abort();
    activeADPController = null;
  }
  return { success: true };
});

// 知识跟随：本地搜索
ipcMain.handle('knowledge:search-local', async (event, { query, limit }) => {
  const results = [];

  // 搜索记忆
  if (memoryStore) {
    const memories = memoryStore.searchRelated(query, 20);
    memories.forEach(m => {
      const score = calculateLocalRelevance(query, m.content);
      results.push({
        type: 'memory',
        id: m.id,
        title: m.content.substring(0, 50),
        content: m.content,
        category: m.category,
        memoryType: m.type,
        createdAt: m.createdAt,
        score,
        source: 'local_memory'
      });
    });
  }

  // 搜索笔记
  if (notebook) {
    const notes = notebook.searchNotes(query);
    notes.forEach(n => {
      const score = calculateLocalRelevance(query, n.content || n.title || '');
      results.push({
        type: 'notebook',
        id: n.id,
        title: n.title || n.content.substring(0, 30),
        content: n.content,
        category: n.category,
        createdAt: n.createdAt,
        score,
        source: 'local_notebook'
      });
    });
  }

  return { results: results.sort((a, b) => b.score - a.score).slice(0, limit || 3) };
});

function calculateLocalRelevance(query, content) {
  if (!query || !content) return 0;
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (keywords.length === 0) return 0;
  const lower = content.toLowerCase();
  let score = 0;
  keywords.forEach(kw => {
    if (lower.includes(kw)) score += 1;
    const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = lower.match(regex);
    if (matches) score += matches.length * 0.3;
  });
  return Math.min(score / keywords.length, 1.0);
}

// 知识跟随：保存知识项
ipcMain.handle('knowledge:save-item', async (event, item) => {
  const items = loadKnowledgeItems();

  if (item.id) {
    // 更新已有项的保存状态
    const idx = items.findIndex(i => i.id === item.id);
    if (idx !== -1) {
      items[idx].is_saved = true;
      items[idx].updated_at = new Date().toISOString();
      saveKnowledgeItems(items);
      return { success: true, item: items[idx] };
    }

    // 可能是推荐项的 ID
    const recs = loadKnowledgeRecommendations();
    const recIdx = recs.findIndex(r => r.id === item.id);
    if (recIdx !== -1) {
      recs[recIdx].is_saved = true;
      saveKnowledgeRecommendations(recs);
    }
  }

  // 创建新知识项
  const newItem = {
    id: 'ki_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
    title: item.title || '知识项',
    content: item.content || '',
    source: item.source || 'manual',
    source_id: item.source_id || null,
    query: item.query || '',
    intent: item.intent || null,
    device_fingerprint: getDeviceFingerprint(),
    tags: item.tags || [],
    is_saved: true,
    adp_conversation_id: item.adpConversationId || null,
    relevance_score: item.relevanceScore || 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  items.unshift(newItem);
  if (items.length > 500) items.length = 500;
  saveKnowledgeItems(items);

  return { success: true, item: newItem };
});

// 知识跟随：删除知识项
ipcMain.handle('knowledge:delete-item', async (event, { id }) => {
  let items = loadKnowledgeItems();
  items = items.filter(i => i.id !== id);
  saveKnowledgeItems(items);

  // 同时从推荐列表删除
  let recs = loadKnowledgeRecommendations();
  recs = recs.filter(r => r.id !== id);
  saveKnowledgeRecommendations(recs);

  return { success: true };
});

// 知识跟随：获取推荐列表
ipcMain.handle('knowledge:get-recommendations', async (event, { deviceFingerprint }) => {
  const recs = loadKnowledgeRecommendations();
  const fingerprint = deviceFingerprint || getDeviceFingerprint();
  const filtered = recs.filter(r => !deviceFingerprint || r.device_fingerprint === fingerprint);
  return { recommendations: filtered.slice(0, 20) };
});

// 知识跟随：获取搜索历史
ipcMain.handle('knowledge:get-history', async (event, { limit, offset }) => {
  const items = loadKnowledgeItems();
  return {
    items: items.slice(offset || 0, (offset || 0) + (limit || 20)),
    total: items.length
  };
});

// 知识跟随：AI 提炼搜索关键词（语义→关键词，用于本地搜索和公开API搜索）
ipcMain.handle('knowledge:extract-keywords', async (event, { query }) => {
  if (!query || query.trim().length === 0) return { keywords: query };

  try {
    // v2.0: 登录状态优先使用服务器配置（与 getAPIConfig() 逻辑一致）
    let apiKey, baseUrl, model;
    if (authState.isLoggedIn && remoteConfig?.api && !authState.forceLocalConfig) {
      apiKey = remoteConfig.api.api_key;
      baseUrl = remoteConfig.api.base_url;
      model = remoteConfig.api.model;
    } else {
      apiKey = getSetting('api_key') || DEFAULT_API_KEY;
      baseUrl = getSetting('api_base_url') || DEFAULT_BASE_URL;
      model = getSetting('api_model') || DEFAULT_MODEL;
    }

    const { response } = await callAI({
      module: 'search_keyword',
      category: 'highvol',
      messages: [
        { role: 'system', content: '你是一个关键词提取专家。从用户的语义化搜索语句中提取出唯一的核心关键词。只输出1个核心关键词，不超过7个字，不要有其他内容。去除虚词、语气词和修饰语，保留最能代表搜索意图的核心词。例如："如何优化数据库查询性能" → "数据库"，"最近在研究的前端框架有什么推荐" → "前端框架"，"React中useState的使用方法" → "useState"，"机器学习中的梯度下降算法" → "梯度下降"' },
        { role: 'user', content: query }
      ],
      fetchOptions: { max_tokens: 100, temperature: 0.1 },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn('[Knowledge] Keyword extraction API failed:', response.status);
      return { keywords: query };
    }

    const data = await response.json();
    const keywords = data.choices?.[0]?.message?.content?.trim() || query;
    console.log('[Knowledge] Extracted keywords:', query, '→', keywords);
    return { keywords };
  } catch (error) {
    console.warn('[Knowledge] Keyword extraction failed:', error.message);
    return { keywords: query };
  }
});

// 知识跟随：剪贴板意图分类
ipcMain.handle('knowledge:classify-intent', async (event, { text }) => {
  const intent = classifyClipboardIntent(text);
  return { intent };
});

// 知识跟随：获取设备指纹
ipcMain.handle('knowledge:get-device-fingerprint', async () => {
  return { fingerprint: getDeviceFingerprint() };
});

ipcMain.handle('optimizer:run', async (_, options = {}) => {
  try {
    const module = options.module || 'task_recognition';
    const badCases = options.badCases || 30;
    const { spawn } = require('child_process');
    const apiKey = getAPIConfig().apiKey;

    return new Promise((resolve) => {
      // 使用 ELECTRON_RUN_AS_NODE=1 让 Electron 以 Node.js 模式运行，避免启动新窗口
      const nodeBin = process.execPath;
      const scriptPath = getScriptPath('scripts/prompt_optimizer.js');
      const proc = spawn(nodeBin, [
        scriptPath,
        '--module', module,
        '--bad-cases', String(badCases)
      ], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1',
          DEEPSEEK_API_KEY: apiKey,
          MEMORA_DATA_DIR: path.join(app.getPath('userData'), 'feedback'),
          MEMORA_PROMPT_DIR: PROMPT_DIR }
      });

      let output = '';
      proc.stdout.on('data', d => { output += d.toString(); console.log('[Optimizer]', d.toString().trim()); });
      proc.stderr.on('data', d => { output += d.toString(); });
      proc.on('close', (code) => {
        resolve({ success: code === 0, output: output.substring(output.length - 2000) });
      });
      proc.on('error', (err) => { resolve({ success: false, error: err.message }); });
    });
  } catch (error) { return { success: false, error: error.message }; }
});

// === Phase 3: 用户画像更新建议 ===
ipcMain.handle('profile:suggestions', async () => {
  try {
    const profile = loadProfile();
    const suggestions = [];

    // 从记忆和任务中提取可能遗漏的人物
    if (memoryStore) {
      const graph = memoryStore.getEntityGraph();
      const knownPersons = (profile.frequent_persons || []).map(p => p.name);
      for (const [name, info] of Object.entries(graph || {})) {
        if (info.type === 'person' && !knownPersons.includes(name) && info.count >= 3) {
          suggestions.push({ type: 'add_person', name, count: info.count, reason: `实体图中出现${info.count}次，建议添加为高频人物` });
        }
      }
    }

    // 从任务中提取可能遗漏的项目
    if (db?.data?.tasks) {
      const tasks = db.data.tasks;
      const projectKeywords = {};
      tasks.forEach(t => {
        if (t.tags) t.tags.forEach(tag => {
          if (['工作', '客户', '技术', '生活'].includes(tag)) return;
          projectKeywords[tag] = (projectKeywords[tag] || 0) + 1;
        });
      });
      const knownProjects = (profile.active_projects || []).map(p => p.name);
      for (const [keyword, count] of Object.entries(projectKeywords)) {
        if (count >= 3 && !knownProjects.some(p => keyword.includes(p) || p.includes(keyword))) {
          suggestions.push({ type: 'add_project', name: keyword, count, reason: `任务标签中出现${count}次，可能是活跃项目` });
        }
      }
    }

    // 检查优先级触发词覆盖度
    const recentFeedback = feedbackLogger.queryFeedback({ action: 'reject', limit: 10 });
    const commonRejectReasons = {};
    recentFeedback.forEach(f => {
      if (f.reason) { const r = f.reason.substring(0, 20); commonRejectReasons[r] = (commonRejectReasons[r] || 0) + 1; }
    });
    for (const [reason, count] of Object.entries(commonRejectReasons)) {
      if (count >= 3) {
        suggestions.push({ type: 'add_priority_signal', reason, count, suggestion: `多次出现拒绝原因"${reason}"，建议调整优先级触发词` });
      }
    }

    return { suggestions, generatedAt: new Date().toISOString() };
  } catch (error) { return { suggestions: [], error: error.message }; }
});

// === AI 批量导入画像 ===
ipcMain.handle('profile:import-ai', async (event, text) => {
  try {
    if (!canMakeAICall()) return { success: false, error: '每日调用次数已达上限' };

    const profile = loadProfile();
    const systemPrompt = `你是忆境 Memora 的画像解析 AI。从用户文本中提取结构化信息，输出严格JSON：
{
  "persons": [{"name":"姓名","relation":"关系","company":"公司","responsibilities":"职责"}],
  "projects": [{"name":"项目名","alias":["别名"],"status":"active/paused/completed","description":"描述"}],
  "industries": ["行业"],
  "regions": ["区域"]
}
规则：提取所有人物并推断关系(领导/同事/下属/客户/合作伙伴)；项目状态根据描述推断；只输出JSON，不输出markdown。内容尽量精简，name和description要简短。`;

    const { response } = await callAI({
      module: 'profile_import',
      category: 'lowvol',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      fetchOptions: { temperature: 0.1, max_tokens: 8192 },
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      return { success: false, error: `AI 请求失败: ${response.status} ${errBody.substring(0, 200)}` };
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    
    // 检查是否因 max_tokens 被截断
    const finishReason = data.choices?.[0]?.finish_reason;
    if (finishReason === 'length') {
      return { success: false, error: 'AI 输出被截断（内容太长），请缩短输入文本后重试' };
    }
    
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // 尝试提取 JSON 对象（处理前后有多余文字的情况）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          return { success: false, error: `AI 返回 JSON 解析失败，原始内容前200字符: ${content.substring(0, 200)}` };
        }
      } else {
        return { success: false, error: `AI 未返回有效 JSON，原始内容前200字符: ${content.substring(0, 200)}` };
      }
    }

    // 合并到现有画像（不覆盖，只追加新项）
    const existingPersons = profile.frequent_persons || [];
    const existingProjects = profile.active_projects || [];
    const existingIndustries = profile.user?.industries || [];

    const newPersons = (parsed.persons || []).filter(np =>
      !existingPersons.some(ep => ep.name === np.name)
    ).map(np => ({
      name: np.name,
      relation: np.relation || '',
      company: np.company || '',
      responsibilities: np.responsibilities || '',
      freq: 1
    }));

    const newProjects = (parsed.projects || []).filter(np =>
      !existingProjects.some(ep => ep.name === np.name)
    ).map(np => ({
      name: np.name,
      alias: np.alias || [],
      status: np.status || 'active',
      description: np.description || ''
    }));

    const newIndustries = (parsed.industries || []).filter(ni =>
      !existingIndustries.includes(ni)
    );

    return {
      success: true,
      preview: {
        persons: newPersons,
        projects: newProjects,
        industries: newIndustries,
        regions: parsed.regions || []
      },
      stats: {
        personsAdded: newPersons.length,
        projectsAdded: newProjects.length,
        industriesAdded: newIndustries.length,
        personsSkipped: (parsed.persons || []).length - newPersons.length,
        projectsSkipped: (parsed.projects || []).length - newProjects.length
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 确认导入画像预览数据
ipcMain.handle('profile:import-confirm', async (event, previewData) => {
  try {
    const profilePath = path.join(app.getPath('userData'), 'profile.json');
    let profile = getDefaultProfile();
    try {
      if (fs.existsSync(profilePath)) profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    } catch (e) {}

    // 追加人物
    if (previewData.persons?.length) {
      profile.frequent_persons = [...(profile.frequent_persons || []), ...previewData.persons];
    }
    // 追加项目
    if (previewData.projects?.length) {
      profile.active_projects = [...(profile.active_projects || []), ...previewData.projects];
    }
    // 追加行业
    if (previewData.industries?.length) {
      profile.user = profile.user || {};
      const existing = profile.user.industries || [];
      profile.user.industries = [...new Set([...existing, ...previewData.industries])];
    }

    profile.updatedAt = new Date().toISOString();
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');
    return { success: true, profile };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// === Phase 3: 每周定时优化（cron 替代方案：启动时检查） ===
let lastOptimizerRun = null;
function checkWeeklyOptimizer() {
  const now = new Date();
  // 每周日 03:00 执行（或启动时如果上次运行超过7天）
  if (lastOptimizerRun && (now - new Date(lastOptimizerRun)) < 7 * 24 * 60 * 60 * 1000) return;
  if (now.getDay() !== 0 && now.getHours() !== 3) {
    // 不是周日3点，但如果是首次运行或超7天，也执行
    if (lastOptimizerRun) return;
  }
  console.log('[Optimizer] Weekly check triggered');
  lastOptimizerRun = now.toISOString();

  // 异步运行，不阻塞
  const apiKey = getAPIConfig().apiKey;
  if (!apiKey) return;
  const { spawn } = require('child_process');
  // 使用 ELECTRON_RUN_AS_NODE=1 让 Electron 以 Node.js 模式运行，避免启动新窗口
  const nodeBin = process.execPath;
  const scriptPath = getScriptPath('scripts/prompt_optimizer.js');
  const proc = spawn(nodeBin, [
    scriptPath,
    '--module', 'task_recognition', '--bad-cases', '30'
  ], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1',
      DEEPSEEK_API_KEY: apiKey,
      MEMORA_DATA_DIR: path.join(app.getPath('userData'), 'feedback'),
      MEMORA_PROMPT_DIR: PROMPT_DIR },
    stdio: 'ignore', detached: true
  });
  proc.unref();
}

// ===== 本地文件索引服务 =====
const LOCAL_INDEX_PATH = path.join(app.getPath('userData'), 'local-file-index.json');
const CUSTOM_DIRS_PATH = path.join(app.getPath('userData'), 'custom-dirs.json');
// 安全获取系统路径，不支持的名称返回 null
function getSafeSystemPath(name) {
  try { return app.getPath(name); } catch { return null; }
}

// macOS/Linux 影片目录：home 下的 Movies 或 Videos
function getMoviesPath() {
  const p = getSafeSystemPath('movies');
  if (p) return p;
  const home = getSafeSystemPath('home');
  if (!home) return null;
  // macOS: Movies, Linux: Videos
  for (const dir of ['Movies', 'Videos']) {
    const candidate = path.join(home, dir);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const DIRECTORY_MAP = {
  desktop: { label: '🖥 桌面', path: () => getSafeSystemPath('desktop') },
  downloads: { label: '📥 下载', path: () => getSafeSystemPath('downloads') },
  documents: { label: '📝 文档', path: () => getSafeSystemPath('documents') },
  pictures: { label: '🖼 图片', path: () => getSafeSystemPath('pictures') },
  movies: { label: '🎬 影片', path: () => getMoviesPath() },
  home: { label: '🏠 主目录', path: () => getSafeSystemPath('home') },
};

/** 加载自定义目录列表 */
function loadCustomDirs() {
  try {
    if (fs.existsSync(CUSTOM_DIRS_PATH)) {
      return JSON.parse(fs.readFileSync(CUSTOM_DIRS_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('[LocalFiles] Failed to load custom dirs:', e);
  }
  return [];
}

/** 保存自定义目录列表 */
function saveCustomDirs(dirs) {
  try {
    fs.writeFileSync(CUSTOM_DIRS_PATH, JSON.stringify(dirs, null, 2), 'utf-8');
  } catch (e) {
    console.error('[LocalFiles] Failed to save custom dirs:', e);
  }
}

const FILE_TYPE_MAP = {
  document: { label: '文档', icon: '📄', exts: ['pdf','doc','docx','txt','rtf','odt','pages','md'] },
  spreadsheet: { label: '表格', icon: '📊', exts: ['xls','xlsx','csv','numbers'] },
  presentation: { label: '演示', icon: '📑', exts: ['ppt','pptx','key'] },
  image: { label: '图片', icon: '🖼', exts: ['jpg','jpeg','png','gif','webp','svg','heic','bmp','tiff'] },
  video: { label: '影片', icon: '🎬', exts: ['mp4','mov','avi','mkv','wmv','flv'] },
  code: { label: '代码', icon: '💻', exts: ['js','ts','py','java','go','html','css','json','xml','yaml','yml','sh','rb','c','cpp','h','rs','swift','kt'] },
  archive: { label: '压缩包', icon: '📦', exts: ['zip','rar','7z','tar','gz','bz2','dmg'] },
  audio: { label: '音频', icon: '🎵', exts: ['mp3','wav','aac','flac','m4a','ogg'] },
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '__pycache__', '.Trash', '.cache',
  'Library', '.npm', '.cache', '.vscode', '.idea', 'dist', 'build',
  '.next', '.nuxt', 'coverage', '.DS_Store', 'target', 'vendor',
  'Applications', '.local', '.docker', '.cursor', '.cursor-tutor',
  '.gradle', '.m2', '.cargo', '.rustup', '.pub-cache', '.yarn',
  'VirtualBox VMs', 'Android', '.android', '.nuget', '.dotnet',
  '.tooling', 'go', '.conda', '.pyenv', '.jenv', '.sdkman',
  '.cache', '.iterm2', '.putty', '.ssh', '.gnupg', '.config'
]);

// home 目录下只扫描这些子目录（避免扫描整个 home 导致超时和重复索引）
const HOME_SCAN_SUBDIRS = new Set([
  'Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music',
  'Videos' // Linux 下影片目录
]);

let localFileIndex = null; // 内存缓存

function getFileType(ext) {
  ext = ext.toLowerCase().replace(/^\./, '');
  for (const [type, config] of Object.entries(FILE_TYPE_MAP)) {
    if (config.exts.includes(ext)) return type;
  }
  return 'other';
}

function loadLocalFileIndex() {
  if (localFileIndex) return localFileIndex;
  try {
    if (fs.existsSync(LOCAL_INDEX_PATH)) {
      localFileIndex = JSON.parse(fs.readFileSync(LOCAL_INDEX_PATH, 'utf-8'));
      return localFileIndex;
    }
  } catch (e) {
    console.error('[LocalFiles] Failed to load index:', e);
  }
  localFileIndex = { version: 1, lastUpdated: null, directories: {}, files: [] };
  return localFileIndex;
}

function saveLocalFileIndex() {
  try {
    fs.writeFileSync(LOCAL_INDEX_PATH, JSON.stringify(localFileIndex, null, 2), 'utf-8');
  } catch (e) {
    console.error('[LocalFiles] Failed to save index:', e);
  }
}

function scanDirectory(dirPath, maxDepth = 3, currentDepth = 0, maxFiles = 5000, isHome = false) {
  const files = [];
  if (currentDepth > maxDepth) return files;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name) || entry.name.startsWith('~$')) continue;

      // home 目录根层只扫描指定子目录，跳过其他目录避免扫描量爆炸
      if (isHome && currentDepth === 0 && entry.isDirectory() && !HOME_SCAN_SUBDIRS.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...scanDirectory(fullPath, maxDepth, currentDepth + 1, maxFiles - files.length, isHome));
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size === 0) continue;
          const ext = path.extname(entry.name).replace(/^\./, '');
          files.push({
            path: fullPath,
            name: entry.name,
            ext: ext,
            size: stat.size,
            createdAt: stat.birthtime ? stat.birthtime.toISOString() : stat.mtime.toISOString(),
            modifiedAt: stat.mtime.toISOString(),
            type: getFileType(ext)
          });
        } catch (e) { /* skip inaccessible files */ }
      }
    }
  } catch (e) { /* skip inaccessible dirs */ }
  return files;
}

ipcMain.handle('local-files:index', async (event, { directories, forceRebuild }) => {
  try {
    const index = loadLocalFileIndex();
    const dirsToScan = directories || Object.keys(DIRECTORY_MAP);
    let newFiles = [];
    let scannedCount = 0;

    // 先扫描非 home 目录，再扫描 home（home 可能包含重复）
    const sortedDirs = dirsToScan.filter(d => d !== 'home').concat(dirsToScan.filter(d => d === 'home'));

    for (const dirKey of sortedDirs) {
      const dirConfig = DIRECTORY_MAP[dirKey];
      if (!dirConfig) {
        // 自定义目录：key 格式为 custom:<absPath>
        if (dirKey.startsWith('custom:')) {
          const dirPath = dirKey.slice(7);
          if (!dirPath || !fs.existsSync(dirPath)) continue;

          const dirMeta = index.directories[dirKey];
          if (!forceRebuild && dirMeta && dirMeta.lastScanned) continue;

          const files = scanDirectory(dirPath, 3, 0, 5000, false);
          files.forEach(f => f.directory = dirKey);
          newFiles = newFiles.concat(files);
          scannedCount += files.length;

          index.files = index.files.filter(f => f.directory !== dirKey);
          index.directories[dirKey] = {
            lastScanned: new Date().toISOString(),
            fileCount: files.length
          };
        }
        continue;
      }
      const dirPath = dirConfig.path();
      if (!dirPath || !fs.existsSync(dirPath)) continue;

      const dirMeta = index.directories[dirKey];
      // 增量索引：如果目录已索引且不强制重建，跳过
      if (!forceRebuild && dirMeta && dirMeta.lastScanned) {
        continue;
      }

      // home 目录标记 isHome，限制扫描范围
      const isHome = dirKey === 'home';
      const files = scanDirectory(dirPath, isHome ? 2 : 3, 0, 5000, isHome);
      // 给文件标记归属目录
      files.forEach(f => f.directory = dirKey);
      newFiles = newFiles.concat(files);
      scannedCount += files.length;

      // 从总索引中移除该目录旧文件，加入新文件
      index.files = index.files.filter(f => f.directory !== dirKey);
      index.directories[dirKey] = {
        lastScanned: new Date().toISOString(),
        fileCount: files.length
      };
    }

    // 去重：home 目录可能与其他目录重复，保留非 home 的记录
    const pathSet = new Set();
    const dedupedFiles = [];
    // 先放非 home 的文件
    for (const f of index.files) {
      if (f.directory !== 'home') {
        pathSet.add(f.path);
        dedupedFiles.push(f);
      }
    }
    // 再放 home 的文件（跳过已存在的路径）
    for (const f of index.files) {
      if (f.directory === 'home' && !pathSet.has(f.path)) {
        pathSet.add(f.path);
        dedupedFiles.push(f);
      }
    }
    index.files = dedupedFiles.concat(newFiles.filter(f => !pathSet.has(f.path)));
    index.lastUpdated = new Date().toISOString();
    saveLocalFileIndex();

    return {
      success: true,
      totalFiles: index.files.length,
      newScanned: scannedCount,
      directories: index.directories
    };
  } catch (e) {
    console.error('[LocalFiles] Index failed:', e);
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('local-files:search', async (event, { keyword, directory, timeRange, fileType, page, pageSize }) => {
  const index = loadLocalFileIndex();
  let results = [...index.files];

  // 目录筛选
  if (directory && directory !== 'all') {
    results = results.filter(f => f.directory === directory);
  }

  // 文件类型筛选
  if (fileType && fileType !== 'all') {
    results = results.filter(f => f.type === fileType);
  }

  // 时间筛选
  if (timeRange && timeRange !== 'all') {
    const now = new Date();
    let cutoff;
    switch (timeRange) {
      case 'today':
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }
    if (cutoff) results = results.filter(f => new Date(f.modifiedAt) >= cutoff);
  }

  // 关键词搜索（文件名匹配）
  if (keyword && keyword.trim()) {
    const kw = keyword.toLowerCase().trim();
    results = results.filter(f =>
      f.name.toLowerCase().includes(kw) ||
      f.path.toLowerCase().includes(kw)
    );
  }

  // 按修改时间倒序
  results.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

  // 分页
  const p = page || 1;
  const ps = pageSize || 50;
  const total = results.length;
  const start = (p - 1) * ps;
  const paginated = results.slice(start, start + ps);

  return {
    success: true,
    files: paginated,
    total,
    page: p,
    pageSize: ps,
    hasMore: start + ps < total
  };
});

ipcMain.handle('local-files:index-status', async () => {
  const index = loadLocalFileIndex();
  return {
    success: true,
    totalFiles: index.files.length,
    lastUpdated: index.lastUpdated,
    directories: index.directories
  };
});

ipcMain.handle('local-files:open', async (event, filePath) => {
  try {
    const { shell } = require('electron');
    await shell.openPath(filePath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('local-files:reveal', async (event, filePath) => {
  try {
    const { shell } = require('electron');
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 选择文件夹对话框
ipcMain.handle('local-files:select-directory', async () => {
  try {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '选择文件夹'
    });
    if (result.canceled || !result.filePaths.length) {
      return { success: false, canceled: true };
    }
    const dirPath = result.filePaths[0];
    const dirName = path.basename(dirPath);
    return { success: true, path: dirPath, name: dirName };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 获取自定义目录列表
ipcMain.handle('local-files:get-custom-dirs', async () => {
  return { success: true, dirs: loadCustomDirs() };
});

// 添加自定义目录
ipcMain.handle('local-files:add-custom-dir', async (event, { dirPath, dirName }) => {
  const dirs = loadCustomDirs();
  const key = 'custom:' + dirPath;
  // 检查是否已存在
  if (dirs.some(d => d.path === dirPath)) {
    return { success: false, error: '该文件夹已添加' };
  }
  const newDir = { key, path: dirPath, name: dirName || path.basename(dirPath) };
  dirs.push(newDir);
  saveCustomDirs(dirs);
  // 立即索引该目录
  localFileIndex = null; // 清缓存，强制重新加载
  return { success: true, dir: newDir };
});

// 删除自定义目录
ipcMain.handle('local-files:remove-custom-dir', async (event, { dirPath }) => {
  let dirs = loadCustomDirs();
  const key = 'custom:' + dirPath;
  dirs = dirs.filter(d => d.path !== dirPath);
  saveCustomDirs(dirs);
  // 从索引中移除该目录的文件
  const index = loadLocalFileIndex();
  const removedCount = index.files.filter(f => f.directory === key).length;
  index.files = index.files.filter(f => f.directory !== key);
  delete index.directories[key];
  try {
    fs.writeFileSync(LOCAL_INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
  } catch (e) { /* ignore */ }
  localFileIndex = null;
  return { success: true, removedCount };
});

// === v2.3 洞察模块 IPC ===

// 洞察异步任务管理器
const insightTaskManager = {
  tasks: new Map(),       // taskType -> { status, taskId, startedAt, result, error }
  cache: new Map(),       // taskType -> { result, completedAt }

  start(taskType) {
    const taskId = `insight_${taskType}_${Date.now()}`;
    const task = { status: 'running', taskId, startedAt: Date.now(), result: null, error: null };
    this.tasks.set(taskType, task);
    return taskId;
  },

  complete(taskType, result) {
    const task = this.tasks.get(taskType);
    if (task) {
      task.status = 'completed';
      task.result = result;
    }
    this.cache.set(taskType, { result, completedAt: Date.now() });
  },

  fail(taskType, error) {
    const task = this.tasks.get(taskType);
    if (task) {
      task.status = 'failed';
      task.error = error;
    }
  },

  getStatus(taskType) {
    const task = this.tasks.get(taskType);
    return task ? { status: task.status, taskId: task.taskId, startedAt: task.startedAt } : { status: 'none' };
  },

  getCachedResult(taskType) {
    return this.cache.get(taskType) || null;
  },

  isRunning(taskType) {
    const task = this.tasks.get(taskType);
    return task && task.status === 'running';
  },

  // 注入缓存数据（用于测试数据或离线数据恢复）
  injectCache(taskType, result) {
    this.cache.set(taskType, { result, completedAt: Date.now() });
    console.log(`[Insight] Cache injected for: ${taskType}`);
  }
};

// 获取知识活化推荐（同步接口 — 读取缓存）
ipcMain.handle('insight:get-activations', async () => {
  try {
    if (!authState.isLoggedIn) {
      return { items: [], error: '需要登录后使用' };
    }
    // 优先返回缓存
    const cached = insightTaskManager.getCachedResult('activations');
    if (cached) return cached.result;
    return { items: [] };
  } catch (err) {
    return { items: [], error: err.message };
  }
});

// 知识活化后台执行逻辑
async function _runActivationTask() {
  const userDataPath = app.getPath('userData');

  // 收集最近7天的记忆作为上下文
  const memoryDataPath = path.join(userDataPath, 'memory', 'memories.json');
  let recentMemories = [];
  if (fs.existsSync(memoryDataPath)) {
    try {
      const all = JSON.parse(fs.readFileSync(memoryDataPath, 'utf8'));
      const sevenDaysAgo = Date.now() - 7 * 86400000;
      recentMemories = (all.memories || all || []).filter(m => {
        const ts = new Date(m.created_at || m.createdAt || 0).getTime();
        return ts > sevenDaysAgo;
      }).slice(0, 20);
    } catch (_) {}
  }

  // 收集知识原子摘要
  const atomsPath = path.join(userDataPath, 'knowledge', 'atoms.json');
  let atomsSummary = [];
  if (fs.existsSync(atomsPath)) {
    try {
      const all = JSON.parse(fs.readFileSync(atomsPath, 'utf8'));
      atomsSummary = (all.atoms || all || []).slice(0, 30).map(a => ({
        id: a.id, content: (a.content || '').substring(0, 100), domain: a.domain
      }));
    } catch (_) {}
  }

  // 收集实体图谱
  const entityPath = path.join(userDataPath, 'memory', 'entity-graph.json');
  let topEntities = [];
  if (fs.existsSync(entityPath)) {
    try {
      const graph = JSON.parse(fs.readFileSync(entityPath, 'utf8'));
      const entities = graph.entities || {};
      topEntities = Object.entries(entities)
        .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
        .slice(0, 15)
        .map(([name, info]) => ({ name, type: info.type, count: info.count }));
    } catch (_) {}
  }

  // 调用 ADP
  const config = getInsightADPConfig('activation');
  const promptTemplate = loadPromptTemplate('knowledge_activation');
  const contextStr = JSON.stringify({
    recentMemories: recentMemories.map(m => ({ content: (m.content || '').substring(0, 200), category: m.category, layer: m.layer })),
    atoms: atomsSummary,
    topEntities,
    userRole: authState.user?.role || '未知'
  });
  const result = await callADPForInsight(config, promptTemplate, contextStr, 'knowledge_activation');
  return { items: result.activations || [], summary: result.summary || '' };
}

// 知识缺口分析后台执行逻辑
async function _runGapAnalysisTask() {
  const userDataPath = app.getPath('userData');

  const entityPath = path.join(userDataPath, 'memory', 'entity-graph.json');
  let topEntities = [];
  if (fs.existsSync(entityPath)) {
    try {
      const graph = JSON.parse(fs.readFileSync(entityPath, 'utf8'));
      const entities = graph.entities || {};
      topEntities = Object.entries(entities)
        .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
        .slice(0, 20)
        .map(([name, info]) => ({ name, type: info.type, count: info.count }));
    } catch (_) {}
  }

  const atomsPath = path.join(userDataPath, 'knowledge', 'atoms.json');
  let atomContents = [];
  if (fs.existsSync(atomsPath)) {
    try {
      const all = JSON.parse(fs.readFileSync(atomsPath, 'utf8'));
      atomContents = (all.atoms || all || []).map(a => (a.content || '').substring(0, 100));
    } catch (_) {}
  }

  const gaps = topEntities.filter(e => e.count >= 3 && !atomContents.some(c => c.includes(e.name))).map(e => ({
    entity: e.name,
    type: e.type,
    mentionCount: e.count,
    reason: `"${e.name}" 最近被提及 ${e.count} 次，但知识库中无相关记录`,
    suggestedActions: [`搜索关于"${e.name}"的资料`, `记录你对"${e.name}"的理解`]
  }));

  if (gaps.length > 0) {
    try {
      const config = getInsightADPConfig('activation');
      const promptTemplate = loadPromptTemplate('knowledge_activation');
      const contextStr = JSON.stringify({ gaps: gaps.slice(0, 10), atomCount: atomContents.length, entityCount: topEntities.length });
      const result = await callADPForInsight(config, promptTemplate, contextStr, 'gap_analysis');
      return { gaps, suggestions: result.summary || '' };
    } catch (_) {
      return { gaps, suggestions: '' };
    }
  }

  return { gaps: [], suggestions: '知识库状态良好，未发现明显缺口。' };
}

// 知识演化后台执行逻辑
async function _runEvolutionTask() {
  const userDataPath = app.getPath('userData');

  const articlesPath = path.join(userDataPath, 'knowledge', 'articles');
  let articles = [];
  if (fs.existsSync(articlesPath)) {
    try {
      const files = fs.readdirSync(articlesPath).filter(f => f.endsWith('.json'));
      articles = files.slice(0, 10).map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(articlesPath, f), 'utf8'));
          return { title: data.title || '', created_at: data.created_at || '', cluster_id: data.cluster_id || '' };
        } catch (_) { return null; }
      }).filter(Boolean);
    } catch (_) {}
  }

  const clustersPath = path.join(userDataPath, 'knowledge', 'clusters.json');
  let clusters = [];
  if (fs.existsSync(clustersPath)) {
    try {
      const all = JSON.parse(fs.readFileSync(clustersPath, 'utf8'));
      clusters = (all.clusters || all || []).slice(0, 15).map(c => ({
        id: c.id, name: c.name, atomCount: (c.atom_ids || []).length, status: c.status, updated_at: c.updated_at || c.created_at
      }));
    } catch (_) {}
  }

  // 记忆增长趋势
  const memoryDataPath = path.join(userDataPath, 'memory', 'memories.json');
  let memoryGrowth = [];
  if (fs.existsSync(memoryDataPath)) {
    try {
      const all = JSON.parse(fs.readFileSync(memoryDataPath, 'utf8'));
      const mems = all.memories || all || [];
      const byDate = {};
      mems.forEach(m => {
        const d = (m.created_at || m.createdAt || '').substring(0, 10);
        byDate[d] = (byDate[d] || 0) + 1;
      });
      memoryGrowth = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).slice(-7).map(([d, c]) => ({ date: d, count: c }));
    } catch (_) {}
  }

  const config = getInsightADPConfig('evolution');
  const promptTemplate = loadPromptTemplate('knowledge_evolution');
  const contextStr = JSON.stringify({ articles, clusters, memoryGrowth, totalArticles: articles.length, totalClusters: clusters.length });
  const result = await callADPForInsight(config, promptTemplate, contextStr, 'knowledge_evolution');

  const localEvolutions = [];
  clusters.filter(c => c.status === 'distilled').forEach(c => {
    localEvolutions.push({
      type: 'merge',
      content: `知识簇"${c.name}"已完成蒸馏，包含 ${c.atomCount} 个知识原子`,
      detail: `自动合并为知识文章`,
      timeAgo: formatTimeAgo(c.updated_at),
      impact: 'medium'
    });
  });

  return { items: [...localEvolutions, ...(result.evolutions || [])], trends: result.trends || {} };
}

// 冲突检测后台执行逻辑
async function _runConflictDetectionTask() {
  const userDataPath = app.getPath('userData');

  const memoryDataPath = path.join(userDataPath, 'memory', 'memories.json');
  const entityPath = path.join(userDataPath, 'memory', 'entity-graph.json');

  let entities = {};
  let memoriesByEntity = {};

  if (fs.existsSync(entityPath)) {
    try { entities = JSON.parse(fs.readFileSync(entityPath, 'utf8')).entities || {}; } catch (_) {}
  }

  if (fs.existsSync(memoryDataPath)) {
    try {
      const all = JSON.parse(fs.readFileSync(memoryDataPath, 'utf8'));
      const mems = all.memories || all || [];
      Object.keys(entities).forEach(entityName => {
        memoriesByEntity[entityName] = mems.filter(m =>
          (m.content || '').includes(entityName)
        ).slice(0, 10).map(m => ({
          content: (m.content || '').substring(0, 200),
          category: m.category,
          created_at: m.created_at || m.createdAt
        }));
      });
    } catch (_) {}
  }

  const candidateEntities = Object.entries(entities)
    .filter(([_, info]) => (info.count || 0) >= 3)
    .filter(([name]) => (memoriesByEntity[name] || []).length >= 2)
    .slice(0, 5);

  const allConflicts = [];
  const config = getInsightADPConfig('conflict');

  for (const [entityName] of candidateEntities) {
    try {
      const promptTemplate = loadPromptTemplate('knowledge_conflict_detection');
      const contextStr = JSON.stringify({
        entity: entityName,
        memories: memoriesByEntity[entityName] || []
      });
      const result = await callADPForInsight(config, promptTemplate, contextStr, 'conflict_detection');
      if (result.hasConflict && result.conflicts) {
        allConflicts.push(...result.conflicts.map(c => ({ ...c, entity: c.entity || entityName })));
      }
    } catch (_) { continue; }
  }

  // 保存到本地
  const insightDir = path.join(userDataPath, 'insight');
  if (!fs.existsSync(insightDir)) fs.mkdirSync(insightDir, { recursive: true });
  fs.writeFileSync(path.join(insightDir, 'conflicts.json'), JSON.stringify({ conflicts: allConflicts, updatedAt: new Date().toISOString() }, null, 2));

  return { items: allConflicts };
}

// 发起异步任务
ipcMain.handle('insight:start-task', async (event, { taskType }) => {
  try {
    if (!authState.isLoggedIn) {
      return { success: false, error: '需要登录后使用' };
    }

    // 如果同类型任务正在运行，返回当前状态
    if (insightTaskManager.isRunning(taskType)) {
      return { success: true, taskId: insightTaskManager.getStatus(taskType).taskId, status: 'already_running' };
    }

    const taskId = insightTaskManager.start(taskType);
    console.log(`[Insight] Task started: ${taskType} (${taskId})`);

    // 异步执行，不阻塞 IPC 返回
    setImmediate(async () => {
      try {
        let result;
        switch (taskType) {
          case 'activations': result = await _runActivationTask(); break;
          case 'gap_analysis': result = await _runGapAnalysisTask(); break;
          case 'evolutions': result = await _runEvolutionTask(); break;
          case 'conflict_detection': result = await _runConflictDetectionTask(); break;
          default: throw new Error(`Unknown task type: ${taskType}`);
        }

        insightTaskManager.complete(taskType, result);
        console.log(`[Insight] Task completed: ${taskType}`);

        // 推送结果到渲染进程
        try {
          event.sender.send('insight:task-complete', { taskType, taskId, result, completedAt: Date.now() });
        } catch (sendErr) {
          console.warn('[Insight] Failed to send task result:', sendErr.message);
        }
      } catch (err) {
        insightTaskManager.fail(taskType, err.message);
        console.error(`[Insight] Task failed: ${taskType}`, err.message);
        try {
          event.sender.send('insight:task-complete', { taskType, taskId, error: err.message, completedAt: Date.now() });
        } catch (_) {}
      }
    });

    return { success: true, taskId, status: 'started' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 获取缓存结果
ipcMain.handle('insight:get-cached-result', async (event, { taskType }) => {
  const cached = insightTaskManager.getCachedResult(taskType);
  return cached;
});

// 注入测试数据到缓存（开发调试用，不调 AI 直接展示）
ipcMain.handle('insight:inject-test-data', async (event, { taskType, result }) => {
  try {
    insightTaskManager.injectCache(taskType, result);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 获取任务状态
ipcMain.handle('insight:get-task-status', async (event, { taskType }) => {
  return insightTaskManager.getStatus(taskType);
});

// 旧接口兼容：读取缓存结果
ipcMain.handle('insight:analyze-gaps', async () => {
  const cached = insightTaskManager.getCachedResult('gap_analysis');
  if (cached) return cached.result;
  return { gaps: [], suggestions: '' };
});

ipcMain.handle('insight:get-evolutions', async () => {
  const cached = insightTaskManager.getCachedResult('evolutions');
  if (cached) return cached.result;
  return { items: [] };
});

ipcMain.handle('insight:get-conflicts', async () => {
  try {
    const userDataPath = app.getPath('userData');
    const conflictsPath = path.join(userDataPath, 'insight', 'conflicts.json');
    if (fs.existsSync(conflictsPath)) {
      const data = JSON.parse(fs.readFileSync(conflictsPath, 'utf8'));
      return { items: data.conflicts || [] };
    }
    return { items: [] };
  } catch (err) {
    return { items: [], error: err.message };
  }
});

ipcMain.handle('insight:detect-conflicts', async () => {
  const cached = insightTaskManager.getCachedResult('conflict_detection');
  if (cached) return cached.result;
  return { items: [] };
});

// 解决冲突
ipcMain.handle('insight:resolve-conflict', async (event, data) => {
  try {
    const userDataPath = app.getPath('userData');
    const conflictsPath = path.join(userDataPath, 'insight', 'conflicts.json');
    if (fs.existsSync(conflictsPath)) {
      const file = JSON.parse(fs.readFileSync(conflictsPath, 'utf8'));
      file.conflicts = (file.conflicts || []).filter(c => c.entity !== data.entity);
      fs.writeFileSync(conflictsPath, JSON.stringify(file, null, 2));
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// === v2.5 关系人脉图谱 IPC ===

// 关系人脉数据路径
// 画像关系文本 → 图谱关系类型映射
function _mapProfileRelationToType(relation) {
  if (!relation) return 'colleague';
  const r = relation.toLowerCase();
  if (['老板', '领导', '上级', '总监', 'vp', '经理', '主管', 'boss', 'manager', 'director'].some(k => r.includes(k))) return 'leader';
  if (['下属', '组员', '徒弟', '下级', 'subordinate', 'report'].some(k => r.includes(k))) return 'subordinate';
  if (['客户', '甲方', '买方', 'customer', 'client'].some(k => r.includes(k))) return 'client';
  if (['朋友', '同学', '好友', 'friend', 'classmate'].some(k => r.includes(k))) return 'friend';
  if (['家人', '亲属', '父母', '兄弟', '姐妹', '配偶', 'family'].some(k => r.includes(k))) return 'family';
  if (['自己', '本人', '我'].some(k => r.includes(k))) return 'self';
  return 'colleague';
}

function getRelationshipPath() {
  const userDataPath = app.getPath('userData');
  const relPath = path.join(userDataPath, 'relationship');
  if (!fs.existsSync(relPath)) fs.mkdirSync(relPath, { recursive: true });
  return relPath;
}

// 从实体图谱和记忆系统构建人脉数据
function buildPersonData() {
  const userDataPath = app.getPath('userData');
  const persons = [];
  const relations = [];

  // 1. 从实体图谱提取人物
  const entityPath = path.join(userDataPath, 'memory', 'entity-graph.json');
  let entityGraph = {};
  try {
    if (fs.existsSync(entityPath)) {
      const raw = JSON.parse(fs.readFileSync(entityPath, 'utf8'));
      entityGraph = raw.entities || raw || {};
    }
  } catch (_) {}

  // 2. 从记忆中提取人物相关数据
  const memoriesPath = path.join(userDataPath, 'memory', 'memories.json');
  let memories = [];
  try {
    if (fs.existsSync(memoriesPath)) {
      memories = JSON.parse(fs.readFileSync(memoriesPath, 'utf8'));
    }
  } catch (_) {}

  // 3. 从用户画像获取高频人物
  const profilePath = path.join(userDataPath, 'profile.json');
  let profile = {};
  try {
    if (fs.existsSync(profilePath)) {
      profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    }
  } catch (_) {}

  // 4. 从任务中提取人物
  const dataPath = path.join(userDataPath, 'memora-data.json');
  let tasks = [];
  try {
    if (fs.existsSync(dataPath)) {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      tasks = data.tasks || [];
    }
  } catch (_) {}

  // 5. 从笔记中提取人物
  const notesPath = path.join(userDataPath, 'notebook', 'notes.json');
  let notes = [];
  try {
    if (fs.existsSync(notesPath)) {
      notes = JSON.parse(fs.readFileSync(notesPath, 'utf8'));
    }
  } catch (_) {}

  // 构建人物映射
  const personMap = {};

  // 从实体图谱提取 type=person 或 count>=3 的实体
  Object.entries(entityGraph).forEach(([name, info]) => {
    if (info.type === 'person' || (info.count >= 2 && name.length <= 10 && /^[\u4e00-\u9fff\w\s·.]+$/.test(name))) {
      personMap[name] = {
        name,
        type: info.type === 'person' ? 'person' : 'entity',
        interactionCount: info.count || 0,
        lastInteraction: info.lastSeen || null,
        related: info.related || [],
        role: '',
        company: '',
        projects: [],
        recentMemories: []
      };
    }
  });

  // 从高频人物补充
  const userName = profile.user?.name || ''; // 用户本人姓名
  const frequentPersons = profile.frequent_persons || [];
  frequentPersons.forEach(p => {
    if (!personMap[p.name]) {
      personMap[p.name] = {
        name: p.name,
        type: 'person',
        interactionCount: 0,
        lastInteraction: null,
        related: [],
        role: p.role || '',
        company: p.company || '',
        projects: p.projects || [],
        recentMemories: []
      };
    } else {
      // 补充画像信息
      personMap[p.name].role = personMap[p.name].role || p.role || '';
      personMap[p.name].company = personMap[p.name].company || p.company || '';
      if (p.projects) {
        p.projects.forEach(pr => {
          if (!personMap[p.name].projects.includes(pr)) personMap[p.name].projects.push(pr);
        });
      }
    }
    // 从画像中标记关系类型和是否为"我自己"
    if (personMap[p.name]) {
      if (p.relation) personMap[p.name].profileRelation = p.relation;
      if (userName && p.name === userName) personMap[p.name].isSelf = true;
    }
  });

  // 标记用户本人：如果画像中有用户名，且 personMap 中存在同名人物
  if (userName && personMap[userName]) {
    personMap[userName].isSelf = true;
    personMap[userName].type = 'self';
  }

  // 从记忆中补充交互信息
  memories.forEach(m => {
    const content = (m.content || '').toLowerCase();
    Object.keys(personMap).forEach(name => {
      if (content.includes(name.toLowerCase())) {
        personMap[name].interactionCount = (personMap[name].interactionCount || 0) + 1;
        if (m.createdAt && (!personMap[name].lastInteraction || new Date(m.createdAt) > new Date(personMap[name].lastInteraction))) {
          personMap[name].lastInteraction = m.createdAt;
        }
        if (personMap[name].recentMemories.length < 5) {
          personMap[name].recentMemories.push({
            content: m.content,
            createdAt: m.createdAt,
            category: m.category
          });
        }
      }
      // 从记忆的 metadata.person 字段
      if (m.metadata?.person === name) {
        personMap[name].interactionCount = (personMap[name].interactionCount || 0) + 1;
      }
      // 从记忆的 metadata.project 字段补充项目
      if (m.metadata?.project && !personMap[name].projects.includes(m.metadata.project)) {
        if (content.includes(name.toLowerCase())) {
          personMap[name].projects.push(m.metadata.project);
        }
      }
    });
  });

  // 从任务中补充项目关联
  tasks.forEach(t => {
    const title = (t.title || '').toLowerCase();
    Object.keys(personMap).forEach(name => {
      if (title.includes(name.toLowerCase())) {
        if (t.project && !personMap[name].projects.includes(t.project)) {
          personMap[name].projects.push(t.project);
        }
      }
    });
  });

  // 构建关系边：同项目 → 共事关系，同记忆出现 → 协作关系，画像关系 → 精确关系
  const relMap = {};
  Object.values(personMap).forEach(p => {
    // "我自己"跳过同项目同事推断（自己不是自己的同事）
    if (p.isSelf) return;

    // 同项目 → 共事关系
    (p.projects || []).forEach(proj => {
      Object.values(personMap).forEach(other => {
        if (other.name !== p.name && !other.isSelf && (other.projects || []).includes(proj)) {
          const key = [p.name, other.name].sort().join('→');
          if (!relMap[key]) {
            relMap[key] = { source: p.name, target: other.name, type: 'colleague', strength: 0.5, projects: [] };
          }
          if (!relMap[key].projects.includes(proj)) relMap[key].projects.push(proj);
          relMap[key].strength = Math.min(1, relMap[key].strength + 0.2);
        }
      });
    });

    // 实体图谱关联 → 协作关系
    (p.related || []).forEach(relName => {
      if (personMap[relName] && relName !== p.name) {
        const key = [p.name, relName].sort().join('→');
        if (!relMap[key]) {
          relMap[key] = { source: p.name, target: relName, type: 'collaboration', strength: 0.3, projects: [] };
        }
        relMap[key].strength = Math.min(1, relMap[key].strength + 0.1);
      }
    });

    // 画像中标记的关系 → 精确关系类型
    if (p.profileRelation && userName && personMap[userName]) {
      const key = [p.name, userName].sort().join('→');
      const relationType = _mapProfileRelationToType(p.profileRelation);
      if (!relMap[key]) {
        relMap[key] = { source: userName, target: p.name, type: relationType, strength: 0.8, projects: [], label: p.profileRelation };
      } else {
        // 画像关系优先级更高，覆盖自动推断的类型
        relMap[key].type = relationType;
        relMap[key].label = p.profileRelation;
        relMap[key].strength = Math.max(relMap[key].strength, 0.8);
      }
    }
  });

  // 转换为数组
  const personList = Object.values(personMap).sort((a, b) => (b.interactionCount || 0) - (a.interactionCount || 0));
  const relationList = Object.values(relMap);

  // 统计
  const now = Date.now();
  const stats = {
    total: personList.length,
    frequent: personList.filter(p => (p.interactionCount || 0) >= 5).length,
    recent: personList.filter(p => p.lastInteraction && (now - new Date(p.lastInteraction).getTime()) < 7 * 86400000).length,
    stale: personList.filter(p => !p.lastInteraction || (now - new Date(p.lastInteraction).getTime()) > 30 * 86400000).length
  };

  // 保存缓存
  try {
    const relDir = getRelationshipPath();
    fs.writeFileSync(path.join(relDir, 'persons.json'), JSON.stringify({ persons: personList, relations: relationList, stats, updatedAt: new Date().toISOString() }, null, 2));
  } catch (_) {}

  return { persons: personList, relations: relationList, stats };
}

// 获取所有人脉数据（优先读缓存）
ipcMain.handle('relationship:get-all', async () => {
  try {
    // 先尝试读取缓存
    const relDir = getRelationshipPath();
    const cachePath = path.join(relDir, 'persons.json');
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const age = Date.now() - new Date(cache.updatedAt || 0).getTime();
      // 缓存 10 分钟内有效
      if (age < 600000 && cache.persons && cache.persons.length > 0) {
        return cache;
      }
    }
    // 重新构建
    return buildPersonData();
  } catch (err) {
    return { persons: [], relations: [], stats: { total: 0, frequent: 0, recent: 0, stale: 0 }, error: err.message };
  }
});

// AI 分析人脉网络
ipcMain.handle('relationship:ai-analyze', async (event) => {
  try {
    if (!authState.isLoggedIn) {
      return { error: '需要登录后使用' };
    }

    // 重新构建（确保最新数据）
    const data = buildPersonData();
    
    if (data.persons.length === 0) {
      return { ...data, aiAnalysis: { analysis: '暂无人脉数据，请在日常使用中复制或记录包含人名的信息，Memora 会自动积累人脉关系。' } };
    }

    const stalePersons = data.persons.filter(p => {
      if (!p.lastInteraction) return true;
      return (Date.now() - new Date(p.lastInteraction).getTime()) > 30 * 86400000;
    });

    // 构建 messages 数组（符合 callAI 签名）
    const systemPrompt = `你是一个人脉关系分析专家。根据用户的人脉数据，分析关系网络并提供洞察。

⚠️ 输出格式：纯 JSON，不要 markdown 代码块，不要解释文字。

请输出 JSON：
{
  "analysis": "整体人脉网络分析（2-3句话）",
  "recommendations": [
    { "person": "人名", "reason": "推荐原因", "suggestedAction": "建议行动" }
  ],
  "staleContactSuggestions": [
    { "person": "人名", "lastTopic": "上次讨论的话题", "suggestedMessage": "建议的开场白" }
  ],
  "networkInsight": "网络洞察（如关键桥接人、孤立节点等）"
}`;

    const userPrompt = `分析以下人脉数据：
- 总人数: ${data.stats.total}
- 高频人物: ${data.stats.frequent}
- 需联系: ${data.stats.stale}
- 人物列表: ${data.persons.slice(0, 30).map(p => `${p.name}(${p.interactionCount}次, ${p.role || '未知角色'}${p.company ? ',' + p.company : ''}${p.projects.length ? ',项目:' + p.projects.join('/') : ''})`).join('; ')}
- 关系列表: ${data.relations.slice(0, 20).map(r => `${r.source}↔${r.target}(${r.type},强度${r.strength.toFixed(1)})`).join('; ')}
- 长期未联系人: ${stalePersons.map(p => p.name).join(', ') || '无'}`;

    const { response } = await callAI({
      module: 'relationship_analysis',
      category: 'lowvol',
      structured: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    // 解析 AI 返回的 JSON
    let aiResult = null;
    if (response && response.ok) {
      try {
        const respData = await response.json();
        let content = respData?.choices?.[0]?.message?.content || '';
        // 兼容 markdown 代码块包裹的 JSON
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) content = jsonMatch[1];
        aiResult = JSON.parse(content.trim());
      } catch (parseErr) {
        console.warn('[Relationship] AI result parse error:', parseErr.message);
      }
    } else {
      const errText = response ? await response.text().catch(() => '') : 'no response';
      console.warn('[Relationship] AI API error:', response?.status, errText.substring(0, 200));
    }

    // 将 AI 建议回填到人物数据
    if (aiResult?.recommendations) {
      aiResult.recommendations.forEach(rec => {
        const person = data.persons.find(p => p.name === rec.person);
        if (person) person.aiRecommendation = rec.reason + ' → ' + rec.suggestedAction;
      });
    }
    if (aiResult?.staleContactSuggestions) {
      aiResult.staleContactSuggestions.forEach(sug => {
        const person = data.persons.find(p => p.name === sug.person);
        if (person && !person.aiRecommendation) {
          person.aiRecommendation = `久未联系建议：${sug.suggestedMessage}`;
        }
      });
    }

    // 更新缓存
    try {
      const relDir = getRelationshipPath();
      fs.writeFileSync(path.join(relDir, 'persons.json'), JSON.stringify({ ...data, aiAnalysis: aiResult, updatedAt: new Date().toISOString() }, null, 2));
    } catch (_) {}

    return data;
  } catch (err) {
    console.error('[Relationship] AI analyze error:', err);
    // 即使 AI 失败，也返回基础数据
    return buildPersonData();
  }
});

// AI 推荐话题
ipcMain.handle('relationship:ai-suggest', async (event, { personName }) => {
  try {
    if (!authState.isLoggedIn) {
      return { suggestion: '需要登录后使用' };
    }

    const data = buildPersonData();
    const person = data.persons.find(p => p.name === personName);
    if (!person) {
      return { suggestion: '未找到此人信息' };
    }

    const relatedRelations = data.relations.filter(r => r.source === personName || r.target === personName);
    const recentMemories = person.recentMemories || [];

    const systemPrompt2 = '你是一个人脉关系顾问。根据人物信息，推荐下次联系时的话题。输出一段简洁的推荐文字（50-100字），包含：1) 建议的沟通话题 2) 开场白建议。不要输出 JSON，直接输出纯文本。';
    const userPrompt2 = `人物：${person.name}
角色：${person.role || '未知'}
公司：${person.company || '未知'}
交互次数：${person.interactionCount || 0}
关联项目：${(person.projects || []).join('、') || '无'}
相关人脉：${relatedRelations.map(r => (r.source === personName ? r.target : r.source)).join('、') || '无'}
最近记录：${recentMemories.slice(0, 3).map(m => m.content?.substring(0, 50)).join('；') || '无'}`;

    const { response } = await callAI({
      module: 'relationship_suggest',
      category: 'lowvol',
      structured: false,
      messages: [
        { role: 'system', content: systemPrompt2 },
        { role: 'user', content: userPrompt2 }
      ]
    });

    let suggestion = '无法生成推荐';
    if (response && response.ok) {
      try {
        const respData = await response.json();
        suggestion = respData?.choices?.[0]?.message?.content?.trim() || suggestion;
      } catch (_) {}
    }

    return { suggestion };
  } catch (err) {
    return { suggestion: 'AI 推荐生成失败: ' + err.message };
  }
});

// AI 推测人物关系（结合记忆+画像，走 callAI 自动适配 agent/LLM 模式）
ipcMain.handle('relationship:ai-infer-relations', async (event) => {
  try {
    if (!authState.isLoggedIn) {
      return { error: '需要登录后使用' };
    }

    const data = buildPersonData();
    if (data.persons.length < 2) {
      return { ...data, inferredRelations: [], message: '人物数量不足，至少需要2个人物才能推测关系' };
    }

    const profile = loadProfile();
    const userName = profile.user?.name || '用户';

    // 构建人物摘要（含画像关系信息）
    const personSummaries = data.persons.slice(0, 30).map(p => {
      const parts = [p.name];
      if (p.isSelf) parts.push('是用户本人');
      if (p.role) parts.push(`角色:${p.role}`);
      if (p.company) parts.push(`公司:${p.company}`);
      if (p.profileRelation) parts.push(`与用户关系:${p.profileRelation}`);
      if (p.projects?.length) parts.push(`项目:${p.projects.join('/')}`);
      parts.push(`交互${p.interactionCount || 0}次`);
      return parts.join(',');
    });

    // 已知关系
    const knownRelations = data.relations.slice(0, 20).map(r =>
      `${r.source}↔${r.target}(${r.type}${r.label ? '/' + r.label : ''},强度${r.strength.toFixed(1)})`
    );

    // 最近记忆中的人物提及
    const recentMemories = [];
    data.persons.slice(0, 10).forEach(p => {
      (p.recentMemories || []).slice(0, 2).forEach(m => {
        recentMemories.push(`${p.name}: ${m.content?.substring(0, 60)}`);
      });
    });

    const systemPrompt = `你是一个人脉关系推理专家。根据用户的人物数据、画像信息和记忆记录，推测人物之间可能的关系。

重要规则：
1. "${userName}"是用户本人，不应该被当作"同事"，应该标记为"本人"
2. 用户与其他人的关系应该从画像中获取（如"老板"、"同事"、"客户"等），而不是统称为"同事"
3. 推测非用户本人之间的人物关系时，考虑：同公司→同事、同项目→协作、角色差异→上下级
4. 如果信息不足，不要强行推测，标注"未知"

⚠️ 输出格式：纯 JSON，不要 markdown 代码块，不要解释文字。

输出 JSON：
{
  "inferredRelations": [
    {
      "source": "人物A",
      "target": "人物B",
      "type": "关系类型(leader/subordinate/colleague/client/friend/family/self)",
      "label": "关系标签(如：直属上级、同组同事、甲方客户)",
      "strength": 0.0-1.0,
      "confidence": 0.0-1.0,
      "reason": "推测依据"
    }
  ],
  "selfPerson": "用户本人的姓名（如果在人物列表中）",
  "insights": ["关于人脉网络的整体洞察（1-3条）"]
}`;

    const userPrompt = `用户姓名：${userName}
人物列表（最多30人）：
${personSummaries.join('\n')}

已知关系：
${knownRelations.join('\n') || '无'}

最近记忆中的人物提及：
${recentMemories.slice(0, 15).join('\n') || '无'}

请推测人物之间更精确的关系，特别是：
1. 标注用户本人（${userName}）与每个人的关系（不要统称"同事"）
2. 推测非用户本人之间可能存在的上下级、同组等关系
3. 标记每条推测的置信度`;

    const { response } = await callAI({
      module: 'relationship_infer',
      category: 'lowvol',
      structured: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    let inferResult = null;
    if (response && response.ok) {
      try {
        const respData = await response.json();
        let content = respData?.choices?.[0]?.message?.content || '';
        // 兼容 markdown 代码块包裹的 JSON
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) content = jsonMatch[1];
        inferResult = JSON.parse(content.trim());
      } catch (parseErr) {
        console.warn('[Relationship] AI infer parse error:', parseErr.message);
      }
    } else {
      const errText = response ? await response.text().catch(() => '') : 'no response';
      console.warn('[Relationship] AI infer API error:', response?.status, errText.substring(0, 200));
    }

    // 将推断结果合并到关系数据
    if (inferResult?.inferredRelations) {
      inferResult.inferredRelations.forEach(inf => {
        const existingRel = data.relations.find(r =>
          (r.source === inf.source && r.target === inf.target) ||
          (r.source === inf.target && r.target === inf.source)
        );
        if (existingRel) {
          // 更新已有关系：AI 推断的类型和标签优先
          if (inf.type && inf.confidence >= 0.7) {
            existingRel.type = inf.type;
            existingRel.label = inf.label || inf.type;
            existingRel.aiInferred = true;
            existingRel.confidence = inf.confidence;
            existingRel.reason = inf.reason || '';
          }
        } else if (inf.confidence >= 0.5) {
          // 新增推测关系
          data.relations.push({
            source: inf.source,
            target: inf.target,
            type: inf.type || 'unknown',
            strength: inf.strength || 0.3,
            label: inf.label || inf.type,
            projects: [],
            aiInferred: true,
            confidence: inf.confidence,
            reason: inf.reason || ''
          });
        }
      });
    }

    // 标记用户本人
    if (inferResult?.selfPerson) {
      const selfPerson = data.persons.find(p => p.name === inferResult.selfPerson);
      if (selfPerson) selfPerson.isSelf = true;
    }

    // 保存缓存
    try {
      const relDir = getRelationshipPath();
      fs.writeFileSync(path.join(relDir, 'persons.json'), JSON.stringify({ ...data, aiInferred: true, updatedAt: new Date().toISOString() }, null, 2));
    } catch (_) {}

    return {
      ...data,
      inferredRelations: inferResult?.inferredRelations || [],
      insights: inferResult?.insights || [],
      selfPerson: inferResult?.selfPerson || userName
    };
  } catch (err) {
    console.error('[Relationship] AI infer error:', err);
    return buildPersonData();
  }
});

// v2.7: 导入文本 → AI 提取人物和关系
ipcMain.handle('relationship:import-text', async (event, { text }) => {
  try {
    if (!text || text.trim().length < 10) {
      return { success: false, error: '文本过短，请输入至少10个字符' };
    }
    if (text.length > 5000) {
      text = text.substring(0, 5000);
    }

    // 读取 Prompt 模板
    const promptPath = path.join(__dirname, 'prompts', 'relationship-extract.md');
    let systemPrompt = '';
    try {
      systemPrompt = fs.readFileSync(promptPath, 'utf8');
    } catch (e) {
      console.error('[Relationship] Failed to read extract prompt:', e);
      return { success: false, error: '系统 Prompt 加载失败' };
    }

    // 注入用户姓名
    const profile = loadProfile();
    const userName = profile.user?.name || '用户';
    systemPrompt = systemPrompt.replace('{{userName}}', userName);

    const { response } = await callAI({
      module: 'relationship_extract',
      category: 'lowvol',
      structured: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ]
    });

    if (!response || !response.ok) {
      const errText = response ? await response.text().catch(() => '') : 'no response';
      console.warn('[Relationship] Extract API error:', response?.status, errText.substring(0, 200));
      return { success: false, error: 'AI 解析失败，请重试' };
    }

    const data = await response.json();
    let content = data?.choices?.[0]?.message?.content || '';
    // 兼容 markdown 代码块包裹的 JSON
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) content = jsonMatch[1];

    let extractResult;
    try {
      extractResult = JSON.parse(content.trim());
    } catch (parseErr) {
      console.warn('[Relationship] Extract JSON parse error:', parseErr.message, content.substring(0, 200));
      return { success: false, error: 'AI 返回格式错误，请重试' };
    }

    incrementAICallCount();

    const persons = (extractResult.persons || []).map(p => ({
      name: p.name,
      role: p.role || '',
      company: p.company || '',
      department: p.department || '',
      projects: p.projects || [],
      relation_to_user: p.relation_to_user || null,
      interactionCount: 1,
      recentMemories: [],
      isSelf: false
    }));

    const relations = (extractResult.relations || []).map(r => ({
      source: r.source,
      target: r.target,
      type: r.type || 'collaboration',
      label: r.label || '',
      strength: r.strength || 0.5,
      confidence: r.confidence || 0.7,
      aiInferred: false
    }));

    return { success: true, persons, relations };
  } catch (err) {
    console.error('[Relationship] Import text error:', err);
    return { success: false, error: err.message || '解析失败' };
  }
});

// v2.7: 合并导入的人物和关系到图谱
ipcMain.handle('relationship:merge-imported', async (event, { persons, relations }) => {
  try {
    const relDir = getRelationshipPath();
    const existingPath = path.join(relDir, 'persons.json');
    let existingData = { persons: [], relations: [] };
    if (fs.existsSync(existingPath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
      } catch (_) {}
    }

    // 合并人物（去重规则：同名合并，角色/公司取非空值）
    const personMap = {};
    existingData.persons.forEach(p => { personMap[p.name] = p; });
    persons.forEach(p => {
      const key = p.name.trim();
      if (personMap[key]) {
        // 合并：补充空字段
        if (p.role && !personMap[key].role) personMap[key].role = p.role;
        if (p.company && !personMap[key].company) personMap[key].company = p.company;
        if (p.department && !personMap[key].department) personMap[key].department = p.department;
        if (p.relation_to_user && !personMap[key].profileRelation) personMap[key].profileRelation = p.relation_to_user;
        // 并集合并项目
        const existingProjects = personMap[key].projects || [];
        const newProjects = p.projects || [];
        const projectSet = new Set([...existingProjects, ...newProjects]);
        personMap[key].projects = [...projectSet];
        personMap[key].interactionCount = (personMap[key].interactionCount || 0) + 1;
      } else {
        personMap[key] = {
          ...p,
          name: key,
          interactionCount: p.interactionCount || 1,
          projects: p.projects || [],
          recentMemories: [],
          isSelf: false
        };
      }
    });

    // 合并关系（去重：source+target 相同则取 strength 更高的）
    const relMap = {};
    existingData.relations.forEach(r => {
      const key = [r.source, r.target].sort().join('→');
      relMap[key] = r;
    });
    relations.forEach(r => {
      const key = [r.source, r.target].sort().join('→');
      if (relMap[key]) {
        if ((r.strength || 0) > (relMap[key].strength || 0)) {
          relMap[key] = r; // 更高置信度的覆盖
        }
      } else {
        relMap[key] = r;
      }
    });

    // 写回文件
    existingData.persons = Object.values(personMap);
    existingData.relations = Object.values(relMap);
    existingData.updatedAt = new Date().toISOString();

    // 重建统计
    const stats = {
      total: existingData.persons.length,
      frequent: existingData.persons.filter(p => (p.interactionCount || 0) >= 5).length,
      recent: existingData.persons.filter(p => {
        if (!p.lastInteraction) return false;
        return (Date.now() - new Date(p.lastInteraction).getTime()) < 7 * 86400000;
      }).length,
      stale: existingData.persons.filter(p => {
        if (!p.lastInteraction) return true;
        return (Date.now() - new Date(p.lastInteraction).getTime()) > 30 * 86400000;
      }).length,
    };
    existingData.stats = stats;

    fs.writeFileSync(existingPath, JSON.stringify(existingData, null, 2));

    return { success: true, merged: { persons: Object.keys(personMap).length, relations: Object.keys(relMap).length }, data: existingData };
  } catch (err) {
    console.error('[Relationship] Merge imported error:', err);
    return { success: false, error: err.message };
  }
});

// 清空人脉图谱数据
ipcMain.handle('relationship:clear', async () => {
  try {
    const relDir = getRelationshipPath();
    const cachePath = path.join(relDir, 'persons.json');
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
    return { success: true };
  } catch (err) {
    console.error('[Relationship] Clear error:', err);
    return { success: false, error: err.message };
  }
});

// === v2.3 多模态知识库 IPC ===

// 多模态存储路径
function getMultimodalPath() {
  const userDataPath = app.getPath('userData');
  const mmPath = path.join(userDataPath, 'multimodal');
  if (!fs.existsSync(mmPath)) fs.mkdirSync(mmPath, { recursive: true });
  if (!fs.existsSync(path.join(mmPath, 'assets'))) fs.mkdirSync(path.join(mmPath, 'assets'), { recursive: true });
  if (!fs.existsSync(path.join(mmPath, 'assets', 'images'))) fs.mkdirSync(path.join(mmPath, 'assets', 'images'), { recursive: true });
  if (!fs.existsSync(path.join(mmPath, 'assets', 'audio'))) fs.mkdirSync(path.join(mmPath, 'assets', 'audio'), { recursive: true });
  if (!fs.existsSync(path.join(mmPath, 'assets', 'video'))) fs.mkdirSync(path.join(mmPath, 'assets', 'video'), { recursive: true });
  if (!fs.existsSync(path.join(mmPath, 'assets', 'documents'))) fs.mkdirSync(path.join(mmPath, 'assets', 'documents'), { recursive: true });
  if (!fs.existsSync(path.join(mmPath, 'transcripts'))) fs.mkdirSync(path.join(mmPath, 'transcripts'), { recursive: true });
  if (!fs.existsSync(path.join(mmPath, 'books'))) fs.mkdirSync(path.join(mmPath, 'books'), { recursive: true });
  return mmPath;
}

function loadMultimodalIndex() {
  const mmPath = getMultimodalPath();
  const indexPath = path.join(mmPath, 'index.json');
  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (_) {}
  }
  return { version: 1, assets: [], books: [] };
}

function saveMultimodalIndex(data) {
  const mmPath = getMultimodalPath();
  fs.writeFileSync(path.join(mmPath, 'index.json'), JSON.stringify(data, null, 2));
}

// 导入多模态文件
ipcMain.handle('multimodal:import', async (event, options) => {
  try {
    const mmPath = getMultimodalPath();
    const srcPath = options.filePath;
    if (!fs.existsSync(srcPath)) return { success: false, error: '文件不存在' };

    const ext = path.extname(srcPath).toLowerCase();
    const typeMap = {
      '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.webp': 'image', '.bmp': 'image', '.svg': 'image',
      '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.aac': 'audio', '.ogg': 'audio', '.flac': 'audio',
      '.mp4': 'video', '.mov': 'video', '.avi': 'video', '.mkv': 'video', '.webm': 'video',
      '.pdf': 'document', '.doc': 'document', '.docx': 'document', '.ppt': 'document', '.pptx': 'document', '.xls': 'document', '.xlsx': 'document', '.txt': 'document', '.md': 'document', '.csv': 'document'
    };
    const assetType = options.type || typeMap[ext] || 'document';
    const subDir = assetType === 'image' ? 'images' : assetType === 'audio' ? 'audio' : assetType === 'video' ? 'video' : 'documents';

    const fileName = `mm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}${ext}`;
    const destDir = path.join(mmPath, 'assets', subDir);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, fileName);

    fs.copyFileSync(srcPath, destPath);
    const stats = fs.statSync(destPath);

    const index = loadMultimodalIndex();
    const asset = {
      id: `mm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: assetType,
      title: options.title || path.basename(srcPath, ext),
      description: '',
      filePath: `assets/${subDir}/${fileName}`,
      fileName: path.basename(srcPath),
      fileSize: stats.size,
      mimeType: options.mimeType || `application/octet-stream`,
      thumbnailPath: null,
      ocrText: null,
      transcript: null,
      transcriptPath: null,
      duration: null,
      pageCount: null,
      atomIds: [],
      clusterIds: [],
      entityNames: [],
      tags: options.tags || [],
      source: options.source || 'import',
      sourceDetail: options.sourceDetail || '',
      url: options.url || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processingStatus: 'pending'
    };

    index.assets.unshift(asset);
    saveMultimodalIndex(index);
    return { success: true, asset };
  } catch (err) {
    console.error('[Multimodal] Import error:', err.message);
    return { success: false, error: err.message };
  }
});

// 保存 URL
ipcMain.handle('multimodal:save-url', async (event, options) => {
  try {
    const index = loadMultimodalIndex();
    const asset = {
      id: `mm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: 'url',
      title: options.title || options.url,
      description: options.description || '',
      filePath: '',
      fileName: '',
      fileSize: 0,
      mimeType: 'text/html',
      thumbnailPath: null,
      ocrText: null,
      transcript: null,
      transcriptPath: null,
      url: options.url,
      atomIds: [],
      clusterIds: [],
      entityNames: [],
      tags: options.tags || [],
      source: 'url',
      sourceDetail: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processingStatus: 'completed'
    };

    index.assets.unshift(asset);
    saveMultimodalIndex(index);
    return { success: true, asset };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 保存腾讯会议转译
ipcMain.handle('multimodal:save-meeting', async (event, options) => {
  try {
    const mmPath = getMultimodalPath();
    const index = loadMultimodalIndex();

    // 保存转写文本
    const transcriptFileName = `meeting_${Date.now()}.txt`;
    const transcriptPath = path.join(mmPath, 'transcripts', transcriptFileName);
    fs.writeFileSync(transcriptPath, options.transcript || '', 'utf8');

    const asset = {
      id: `mm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: 'meeting',
      title: options.title || `腾讯会议 ${new Date().toLocaleDateString('zh-CN')}`,
      description: options.description || '腾讯会议录屏及转译文本',
      filePath: '',
      fileName: '',
      fileSize: (options.transcript || '').length,
      mimeType: 'text/plain',
      thumbnailPath: null,
      ocrText: null,
      transcript: (options.transcript || '').substring(0, 5000),
      transcriptPath: `transcripts/${transcriptFileName}`,
      duration: options.duration || null,
      meetingUrl: options.meetingUrl || '',
      atomIds: [],
      clusterIds: [],
      entityNames: [],
      tags: options.tags || ['腾讯会议'],
      source: 'meeting',
      sourceDetail: options.meetingId || '',
      url: options.meetingUrl || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processingStatus: 'completed'
    };

    index.assets.unshift(asset);
    saveMultimodalIndex(index);
    return { success: true, asset };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 列表查询
ipcMain.handle('multimodal:list', async (event, options) => {
  try {
    const index = loadMultimodalIndex();
    let assets = [...index.assets];

    if (options?.type && options.type !== 'all') {
      assets = assets.filter(a => a.type === options.type);
    }
    if (options?.keyword) {
      const q = options.keyword.toLowerCase();
      assets = assets.filter(a =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q) ||
        (a.ocrText || '').toLowerCase().includes(q) ||
        (a.transcript || '').toLowerCase().includes(q) ||
        (a.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }

    const page = options?.page || 1;
    const pageSize = options?.pageSize || 20;
    const start = (page - 1) * pageSize;
    const paginated = assets.slice(start, start + pageSize);

    return { assets: paginated, total: assets.length, page, pageSize };
  } catch (err) {
    return { assets: [], total: 0, error: err.message };
  }
});

// 获取详情
ipcMain.handle('multimodal:get', async (event, id) => {
  try {
    const index = loadMultimodalIndex();
    const asset = index.assets.find(a => a.id === id);
    if (!asset) return { asset: null, error: '未找到' };

    // 读取完整转写文本
    if (asset.transcriptPath) {
      const mmPath = getMultimodalPath();
      const fullPath = path.join(mmPath, asset.transcriptPath);
      if (fs.existsSync(fullPath)) {
        asset.transcript = fs.readFileSync(fullPath, 'utf8');
      }
    }

    return { asset };
  } catch (err) {
    return { asset: null, error: err.message };
  }
});

// 删除资产
ipcMain.handle('multimodal:delete', async (event, id) => {
  try {
    const mmPath = getMultimodalPath();
    const index = loadMultimodalIndex();
    const asset = index.assets.find(a => a.id === id);
    if (!asset) return { success: false, error: '未找到' };

    // 删除文件
    if (asset.filePath) {
      const fullPath = path.join(mmPath, asset.filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    if (asset.transcriptPath) {
      const fullPath = path.join(mmPath, asset.transcriptPath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }

    index.assets = index.assets.filter(a => a.id !== id);
    saveMultimodalIndex(index);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 更新元数据
ipcMain.handle('multimodal:update', async (event, id, updates) => {
  try {
    const index = loadMultimodalIndex();
    const asset = index.assets.find(a => a.id === id);
    if (!asset) return { success: false, error: '未找到' };

    if (updates.title !== undefined) asset.title = updates.title;
    if (updates.tags !== undefined) asset.tags = updates.tags;
    if (updates.description !== undefined) asset.description = updates.description;
    asset.updatedAt = new Date().toISOString();

    saveMultimodalIndex(index);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 统计
ipcMain.handle('multimodal:stats', async () => {
  try {
    const index = loadMultimodalIndex();
    const assets = index.assets;
    return {
      total: assets.length,
      byType: {
        image: assets.filter(a => a.type === 'image').length,
        audio: assets.filter(a => a.type === 'audio').length,
        video: assets.filter(a => a.type === 'video').length,
        document: assets.filter(a => a.type === 'document').length,
        url: assets.filter(a => a.type === 'url').length,
        meeting: assets.filter(a => a.type === 'meeting').length
      },
      totalSize: assets.reduce((sum, a) => sum + (a.fileSize || 0), 0),
      bookCount: (index.books || []).length
    };
  } catch (err) {
    return { total: 0, byType: {}, totalSize: 0, bookCount: 0 };
  }
});

// AI 处理资产（OCR/转写/摘要）
ipcMain.handle('multimodal:process', async (event, id) => {
  try {
    if (!authState.isLoggedIn) return { success: false, error: '需要登录后使用 AI 处理' };

    const mmPath = getMultimodalPath();
    const index = loadMultimodalIndex();
    const asset = index.assets.find(a => a.id === id);
    if (!asset) return { success: false, error: '未找到' };

    asset.processingStatus = 'processing';
    saveMultimodalIndex(index);

    // 准备上下文（包含更丰富的资产信息）
    const assetInfo = {
      type: asset.type,
      title: asset.title || asset.original_name || '',
      originalName: asset.original_name || '',
      description: asset.description || '',
      url: asset.url || '',
      tags: asset.tags || [],
      transcript: (asset.transcript || '').substring(0, 3000),
      ocrText: asset.ocrText || '',
      fileSize: asset.file_size || 0,
      createdAt: asset.created_at || ''
    };
    // 尽量提取更多文本内容
    let textContent = '';
    if (asset.type === 'url') {
      textContent = asset.url || asset.description || '';
    } else if (asset.type === 'meeting') {
      textContent = asset.transcript || asset.description || '';
    } else if (asset.type === 'image') {
      textContent = asset.ocrText || asset.description || '';
    } else {
      textContent = asset.transcript || asset.ocrText || asset.description || '';
    }
    assetInfo.textContent = textContent.substring(0, 3000);
    contextStr = JSON.stringify(assetInfo);

    // 调用 ADP 处理
    const config = await getInsightADPConfig('activation');
    const processPrompt = `你是一个多模态知识处理助手。对以下资产进行分析，返回 JSON：
{
  "title": "更精确的标题",
  "description": "200字以内的摘要描述",
  "tags": ["标签1", "标签2"],
  "entities": ["实体1", "实体2"],
  "keyPoints": ["要点1", "要点2"]
}

资产信息：
${contextStr}`;

    const result = await callADPForInsight(config, processPrompt, contextStr, 'multimodal_process');

    let updated = false;
    if (result.title && result.title !== asset.title) { asset.title = result.title; updated = true; }
    if (result.description) { asset.description = result.description; updated = true; }
    if (result.tags && Array.isArray(result.tags)) { asset.tags = result.tags; updated = true; }
    if (result.entities) asset.entityNames = result.entities;
    asset.processingStatus = 'completed';
    asset.updatedAt = new Date().toISOString();
    saveMultimodalIndex(index);

    return { success: true, asset, updated };
  } catch (err) {
    // 标记失败
    try {
      const index = loadMultimodalIndex();
      const asset = index.assets.find(a => a.id === id);
      if (asset) {
        asset.processingStatus = 'failed';
        saveMultimodalIndex(index);
      }
    } catch (_) {}
    return { success: false, error: err.message };
  }
});

// 生成知识书本
ipcMain.handle('multimodal:generate-book', async (event, options) => {
  try {
    if (!authState.isLoggedIn) return { success: false, error: '需要登录后使用' };

    const index = loadMultimodalIndex();
    const assets = index.assets;
    const knowledgeAtoms = knowledgeStore ? knowledgeStore.atoms : [];
    const clusters = knowledgeStore ? knowledgeStore.clusters : [];

    // 构建知识概要（包含实际内容）
    const summary = {
      totalAssets: assets.length,
      assetTypes: {},
      totalAtoms: knowledgeAtoms.length,
      totalClusters: clusters.length,
      recentAssets: assets.slice(0, 15).map(a => ({
        type: a.type,
        title: a.title || a.original_name || '',
        description: a.description || '',
        tags: a.tags || []
      })),
      // 包含知识原子实际内容（最多 20 条，每条截取 200 字）
      atomContents: knowledgeAtoms.slice(0, 20).map(a => ({
        content: (a.content || '').substring(0, 200),
        domain: a.domain || '未分类',
        type: a.type || 'fact'
      })),
      // 包含知识簇信息
      clusterInfo: clusters.slice(0, 10).map(c => ({
        name: c.name,
        atomCount: (c.atom_ids || []).length,
        status: c.status
      })),
      topDomains: {},
      topEntities: []
    };

    assets.forEach(a => { summary.assetTypes[a.type] = (summary.assetTypes[a.type] || 0) + 1; });
    knowledgeAtoms.forEach(a => { const d = a.domain || '未分类'; summary.topDomains[d] = (summary.topDomains[d] || 0) + 1; });

    if (memoryStore?.entityGraph) {
      summary.topEntities = Object.entries(memoryStore.entityGraph)
        .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
        .slice(0, 20)
        .map(([name, info]) => ({ name, type: info.type, count: info.count }));
    }

    // 调用 LLM 生成知识书本大纲（v2.4: 统一走 callAI，保证 JSON 格式）
    const bookPrompt = `你是一个知识体系整理专家。根据用户的知识库数据，生成一本结构化的知识书本。

⚠️ **title 命名规则（非常重要）**：
- 标题必须反映知识库的实际内容领域，不要用泛泛的"我的知识体系"
- 格式示例："AI与云计算知识体系"、"产品设计与用户体验知识库"、"金融科技与合规知识体系"
- 根据知识库中占比最高的领域来命名
- 如果知识库覆盖多个领域，取 TOP 2-3 个领域组合命名

返回 JSON：
{
  "title": "根据内容生成的具体标题（不要用'我的知识体系'这种泛泛名称）",
  "chapters": [
    {
      "title": "第一章：领域名",
      "summary": "本章概要（50-100字）",
      "sections": [
        { "title": "1.1 小节名", "content": "该小节的核心知识点描述（100-200字，要有实质内容）" }
      ]
    }
  ],
  "generatedAt": "生成时间"
}

知识库数据：
${JSON.stringify(summary)}`;

    const config = getInsightADPConfig('activation');
    const result = await callADPForInsight(config, bookPrompt, JSON.stringify(summary), 'book_generation');

    console.log('[Multimodal] Generate book AI raw result:', JSON.stringify(result).substring(0, 500));

    console.log('[Multimodal] Generate book AI result:', {
      hasTitle: !!result.title,
      hasChapters: !!(result.chapters && result.chapters.length),
      chaptersCount: result.chapters?.length || 0,
      resultKeys: Object.keys(result || {})
    });

    // 智能默认标题：如果 AI 没有返回好标题，基于知识库内容生成
    let bookTitle = result.title;
    if (!bookTitle || bookTitle === '我的知识体系' || bookTitle === '未命名') {
      // 根据知识库域名生成默认标题
      const topDomains = Object.entries(summary.topDomains || {}).sort((a, b) => b[1] - a[1]);
      const topDomainNames = topDomains.slice(0, 2).map(d => d[0]).filter(d => d !== '未分类');
      if (topDomainNames.length > 0) {
        bookTitle = `${topDomainNames.join('与')}知识体系`;
      } else {
        const date = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
        bookTitle = `知识体系 ${date}`;
      }
    }

    const book = {
      id: `book_${Date.now()}`,
      title: bookTitle || '我的知识体系',
      chapters: result.chapters || [],
      generatedAt: new Date().toISOString(),
      assetCount: assets.length,
      atomCount: knowledgeAtoms.length,
      clusterCount: clusters.length
    };

    // 保存书本
    const mmPath = getMultimodalPath();
    const bookFileName = `book_${Date.now()}.json`;
    fs.writeFileSync(path.join(mmPath, 'books', bookFileName), JSON.stringify(book, null, 2));

    if (!index.books) index.books = [];
    index.books.unshift({ id: book.id, title: book.title, generatedAt: book.generatedAt, fileName: bookFileName });
    saveMultimodalIndex(index);

    return { success: true, book };
  } catch (err) {
    console.error('[Multimodal] Generate book error:', err.message);
    return { success: false, error: err.message };
  }
});

// 获取知识书本列表
ipcMain.handle('multimodal:get-books', async () => {
  try {
    const index = loadMultimodalIndex();
    const mmPath = getMultimodalPath();
    const books = (index.books || []).map(b => {
      try {
        const fullPath = path.join(mmPath, 'books', b.fileName);
        if (fs.existsSync(fullPath)) {
          const bookData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          console.log('[Multimodal] get-books: loaded', b.id, 'chapters:', bookData.chapters?.length || 0);
          return bookData;
        } else {
          console.warn('[Multimodal] get-books: file not found:', fullPath);
        }
      } catch (e) {
        console.warn('[Multimodal] get-books: parse error for', b.id, e.message);
      }
      return b;
    });
    return { books };
  } catch (err) {
    return { books: [], error: err.message };
  }
});

// 打开文件
ipcMain.handle('multimodal:open-file', async (event, id) => {
  try {
    const mmPath = getMultimodalPath();
    const index = loadMultimodalIndex();
    const asset = index.assets.find(a => a.id === id);
    if (!asset || !asset.filePath) return { success: false, error: '无文件路径' };

    const fullPath = path.join(mmPath, asset.filePath);
    if (!fs.existsSync(fullPath)) return { success: false, error: '文件不存在' };

    shell.openPath(fullPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 选择文件对话框
ipcMain.handle('multimodal:pick-files', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp3', 'wav', 'm4a', 'mp4', 'mov', 'pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'txt', 'md', 'csv'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled) return { files: [] };
    return { files: result.filePaths };
  } catch (err) {
    return { files: [], error: err.message };
  }
});

// 拖拽导入：从 Buffer 导入文件
ipcMain.handle('multimodal:import-buffer', async (event, options) => {
  try {
    const mmPath = getMultimodalPath();
    const fileName = options.name || `file_${Date.now()}`;
    const ext = path.extname(fileName).toLowerCase();
    const baseName = path.basename(fileName, ext);

    // 确定资产类型
    let assetType = 'document';
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) assetType = 'image';
    else if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext)) assetType = 'audio';
    else if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) assetType = 'video';

    // 保存文件到对应目录
    const subDir = assetType === 'image' ? 'images' : assetType === 'audio' ? 'audio' : assetType === 'video' ? 'video' : 'documents';
    const destDir = path.join(mmPath, 'assets', subDir);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const destFileName = `${Date.now()}_${fileName}`;
    const destPath = path.join(destDir, destFileName);

    // 写入 buffer（支持 ArrayBuffer / Uint8Array / 普通数组）
    let buffer;
    if (options.buffer instanceof ArrayBuffer) {
      buffer = Buffer.from(options.buffer);
    } else if (ArrayBuffer.isView(options.buffer)) {
      buffer = Buffer.from(options.buffer.buffer, options.buffer.byteOffset, options.buffer.byteLength);
    } else if (Array.isArray(options.buffer)) {
      buffer = Buffer.from(options.buffer);
    } else {
      buffer = Buffer.from(options.buffer);
    }
    fs.writeFileSync(destPath, buffer);

    const stats = fs.statSync(destPath);
    const relativePath = path.relative(mmPath, destPath);

    // 更新索引
    const index = loadMultimodalIndex();
    const asset = {
      id: `mm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: assetType,
      title: baseName,
      filePath: relativePath,
      fileSize: stats.size,
      mimeType: options.type || '',
      tags: [],
      entities: [],
      processingStatus: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!index.assets) index.assets = [];
    index.assets.unshift(asset);
    saveMultimodalIndex(index);

    return { success: true, asset };
  } catch (err) {
    console.error('[Multimodal] Import buffer error:', err.message);
    return { success: false, error: err.message };
  }
});

// === v2.3 洞察辅助函数（原有） ===

function getInsightADPConfig(type) {
  const adpUrl = normalizeADPUrl(getSetting('adp_url') || (remoteConfig?.adp?.url) || 'https://wss.lke.cloud.tencent.com/adp/v2/chat');

  let appKey;
  switch (type) {
    case 'activation':
      appKey = getSetting('adp_activation_app_key') || (remoteConfig?.adp?.activation_app_key) || DEFAULT_ADP_ACTIVATION_APP_KEY;
      break;
    case 'evolution':
      appKey = getSetting('adp_evolution_app_key') || (remoteConfig?.adp?.evolution_app_key) || DEFAULT_ADP_EVOLUTION_APP_KEY;
      break;
    case 'conflict':
      appKey = getSetting('adp_conflict_app_key') || (remoteConfig?.adp?.conflict_app_key) || DEFAULT_ADP_CONFLICT_APP_KEY;
      break;
    default:
      appKey = DEFAULT_ADP_KNOWLEDGE_APP_KEY;
  }

  return { appKey: appKey.trim(), url: adpUrl };
}

// 加载 Prompt 模板
function loadPromptTemplate(name) {
  const promptPath = path.join(__dirname, 'prompts', `${name}.md`);
  if (fs.existsSync(promptPath)) {
    return fs.readFileSync(promptPath, 'utf8');
  }
  return '';
}

// 调用 ADP 进行洞察分析（非流式，同步等待结果）
// v2.3: LLM 模式下自动切换为 LLM 调用
// v2.4: Agent 模式下也走 LLM（洞察分析需要结构化 JSON，ADP 智能体无法保证 JSON 格式）
async function callADPForInsight(config, promptTemplate, contextStr, module) {
  // v2.4: LLM 和 Agent 模式都走 LLM（结构化 JSON 输出必须走 LLM）
  const mode = getGlobalAIMode();
  // cc / llm / agent 模式都走 LLM（结构化 JSON 输出必须走 LLM）
  if (mode === 'llm' || mode === 'agent' || mode === 'cc') {
    return await _callLLMForInsight(promptTemplate, contextStr, module);
  }

  const https = require('https');
  const http = require('http');

  const convId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  const requestId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  const visitorId = `insight_${authState.user?.id || 'local'}_${Date.now()}`;

  const requestBody = {
    AppKey: config.appKey,
    ConversationId: convId,
    VisitorId: visitorId,
    Contents: [{ Type: 'text', Text: `${promptTemplate}\n\n## 当前知识库数据\n\n${contextStr}` }],
    RequestId: requestId,
    Stream: 'disable'
  };

  const urlObj = new URL(config.url);
  const isHttps = urlObj.protocol === 'https:';
  const requester = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = requester.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      }
    }, (res) => {
      let fullText = '';
      res.on('data', (chunk) => { fullText += chunk.toString(); });
      res.on('end', () => {
        try {
          // 尝试从 SSE 事件中提取 JSON
          let jsonStr = '';
          const lines = fullText.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const data = line.substring(5).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) jsonStr += parsed.content;
              } catch (_) {}
            }
          }
          // 如果没有从 SSE 提取到内容，尝试直接解析
          if (!jsonStr) {
            try {
              const parsed = JSON.parse(fullText);
              jsonStr = parsed.content || parsed.text || fullText;
            } catch (_) {
              jsonStr = fullText;
            }
          }

          // 从文本中提取 JSON（兼容 markdown 代码块包裹）
          let cleanJsonStr = jsonStr.trim();
          const mdMatch = cleanJsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
          if (mdMatch) cleanJsonStr = mdMatch[1].trim();

          // 尝试直接解析
          try {
            const result = JSON.parse(cleanJsonStr);
            auditLogger.log({
              module: `insight_${module}`,
              action: 'adp_call',
              inputTokens: contextStr.length,
              status: 'success'
            });
            resolve(result);
          } catch (_) {}

          // 回退：正则提取
          const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            auditLogger.log({
              module: `insight_${module}`,
              action: 'adp_call',
              inputTokens: contextStr.length,
              status: 'success'
            });
            resolve(result);
          } else {
            resolve({ summary: jsonStr.substring(0, 500) });
          }
        } catch (e) {
          console.error('[Insight] Parse ADP response error:', e.message);
          resolve({ summary: '分析完成，但结果格式异常' });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.setTimeout(300000, () => { req.destroy(); reject(new Error('ADP 请求超时')); });
    req.write(JSON.stringify(requestBody));
    req.end();
  });
}

// LLM 模式下的洞察分析（替代 callADPForInsight）
async function _callLLMForInsight(promptTemplate, contextStr, module) {
  try {
    console.log('[Insight] Calling LLM for insight, module:', module);
    const isBookGen = module === 'book_generation';
    const { response } = await callAI({
      module: `insight_${module}`,
      category: isBookGen ? 'highvol' : 'lowvol',
      messages: [
        { role: 'user', content: `${promptTemplate}\n\n## 当前知识库数据\n\n${contextStr}` }
      ],
      fetchOptions: {
        temperature: 0.3,
        max_tokens: isBookGen ? 8000 : 4000,
        // 结构化输出：强制 JSON 格式（避免 LLM 包裹 markdown 代码块）
        ...(isBookGen ? { response_format: { type: 'json_object' } } : {})
      },
    });

    if (!response || !response.ok) {
      console.error('[Insight] LLM response not ok:', response?.status);
      return { summary: 'LLM 调用失败，请稍后重试' };
    }

    let fullText = '';
    // 优先使用 auditedDeepSeekCall 已解析的 _fullContent（避免重复读取 body）
    if (response._fullContent) {
      fullText = response._fullContent;
      console.log('[Insight] Using _fullContent from audit, length:', fullText.length);
    } else {
      try {
        const data = await response.json();
        fullText = data.choices?.[0]?.message?.content || '';
        console.log('[Insight] Using response.json(), length:', fullText.length);
      } catch (bodyErr) {
        console.error('[Insight] response.json() failed (body may be consumed):', bodyErr.message);
        return { summary: '分析失败: 无法读取 LLM 响应' };
      }
    }

    if (!fullText || fullText.trim().length === 0) {
      console.error('[Insight] LLM returned empty content');
      return { summary: 'LLM 返回内容为空' };
    }

    console.log('[Insight] LLM raw response length:', fullText.length, 'first 200:', fullText.substring(0, 200));

    // 提取 JSON：1) 先剥离 markdown 代码块  2) 尝试直接解析  3) 回退到正则提取
    let cleanText = fullText.trim();

    // 剥离 markdown 代码块包裹（```json ... ``` 或 ``` ... ```）
    const mdMatch = cleanText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (mdMatch) {
      cleanText = mdMatch[1].trim();
      console.log('[Insight] Stripped markdown code block, new length:', cleanText.length);
    }

    // 尝试直接解析
    try {
      const result = JSON.parse(cleanText);
      console.log('[Insight] Direct JSON parse success, keys:', Object.keys(result));
      if (auditLogger) {
        auditLogger.log({
          module: `insight_${module}_llm`,
          action: 'llm_call',
          inputTokens: contextStr.length,
          status: 'success'
        });
      }
      return result;
    } catch (directErr) {
      console.warn('[Insight] Direct JSON parse failed:', directErr.message);
    }

    // 回退：正则提取第一个完整的 JSON 对象
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        console.log('[Insight] Regex-extracted JSON parse success, keys:', Object.keys(result));
        if (auditLogger) {
          auditLogger.log({
            module: `insight_${module}_llm`,
            action: 'llm_call',
            inputTokens: contextStr.length,
            status: 'success'
          });
        }
        return result;
      } catch (regexErr) {
        console.error('[Insight] Regex-extracted JSON parse also failed:', regexErr.message);
        // 尝试修复常见问题：截断的 JSON（找到最后一个完整的 } ）
        const lastBrace = jsonMatch[0].lastIndexOf('}');
        if (lastBrace > 0) {
          try {
            const truncatedJson = jsonMatch[0].substring(0, lastBrace + 1);
            const result = JSON.parse(truncatedJson);
            console.log('[Insight] Truncated JSON repair success, keys:', Object.keys(result));
            if (auditLogger) {
              auditLogger.log({
                module: `insight_${module}_llm`,
                action: 'llm_call',
                inputTokens: contextStr.length,
                status: 'success'
              });
            }
            return result;
          } catch (_) {}
        }
      }
    }

    console.error('[Insight] All JSON extraction methods failed. Raw text (first 500):', fullText.substring(0, 500));
    return { summary: fullText.substring(0, 500) };
  } catch (e) {
    console.error('[Insight] LLM call error:', e.message);
    return { summary: '分析失败: ' + e.message };
  }
}

// 时间格式化
function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}个月前`;
}

// === 数据导出/导入（加密） ===

/**
 * 从密码派生 AES-256 密钥（PBKDF2 + 固定 salt）
 * 使用固定 salt 保证同一密码能解密（牺牲了一定安全性，但对本地数据迁移足够）
 */
function deriveKeyFromPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
}

/**
 * AES-256-GCM 加密
 */
function encryptData(data, password) {
  const salt = crypto.randomBytes(16);
  const key = deriveKeyFromPassword(password, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // 格式: salt(16) + iv(12) + authTag(16) + encrypted
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

/**
 * AES-256-GCM 解密
 */
function decryptData(encryptedBuffer, password) {
  const salt = encryptedBuffer.subarray(0, 16);
  const iv = encryptedBuffer.subarray(16, 28);
  const authTag = encryptedBuffer.subarray(28, 44);
  const encrypted = encryptedBuffer.subarray(44);
  const key = deriveKeyFromPassword(password, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * 收集所有需要导出的数据
 */
function collectExportData() {
  const userDataPath = app.getPath('userData');
  const exportData = {
    _meta: {
      version: '2.4.0',
      exportedAt: new Date().toISOString(),
      app: 'Memora',
      checksum: '' // 后面填充
    }
  };

  // 辅助：安全读取 JSON 文件
  function safeReadJSON(relativePath) {
    const fullPath = path.join(userDataPath, relativePath);
    try {
      if (fs.existsSync(fullPath)) {
        return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      }
    } catch (e) {
      console.warn(`[Export] Failed to read ${relativePath}:`, e.message);
    }
    return null;
  }

  // 辅助：安全读取目录下所有文件
  function safeReadDir(relativeDirPath, extensions) {
    const dirPath = path.join(userDataPath, relativeDirPath);
    const result = {};
    try {
      if (!fs.existsSync(dirPath)) return result;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          if (extensions && !extensions.some(ext => file.endsWith(ext))) continue;
          result[file] = fs.readFileSync(fullPath, 'utf8');
        }
      }
    } catch (e) {
      console.warn(`[Export] Failed to read dir ${relativeDirPath}:`, e.message);
    }
    return result;
  }

  // 1. 核心数据
  exportData.core = {
    'memora-data.json': safeReadJSON('memora-data.json'),       // 任务+设置+番茄钟
    'settings.json': safeReadJSON('settings.json'),              // API/ADP配置
    'profile.json': safeReadJSON('profile.json'),                // 用户画像
    'local-file-index.json': safeReadJSON('local-file-index.json') // 本地文件索引
  };

  // 2. 记忆系统
  exportData.memory = {
    'memories.json': safeReadJSON('memory/memories.json'),
    'entity-graph.json': safeReadJSON('memory/entity-graph.json')
  };

  // 3. 记事本
  exportData.notebook = {
    'notes.json': safeReadJSON('notebook/notes.json'),
    'categories.json': safeReadJSON('notebook/categories.json')
  };

  // 4. 知识图谱
  exportData.knowledge = {
    'atoms.json': safeReadJSON('knowledge/atoms.json'),
    'clusters.json': safeReadJSON('knowledge/clusters.json'),
    'articles-index.json': safeReadJSON('knowledge/articles/articles.json'),
    'knowledge-items.json': safeReadJSON('knowledge/knowledge-items.json'),
    'recommendations.json': safeReadJSON('knowledge/recommendations.json'),
    'articles': safeReadDir('knowledge/articles', ['.md'])
  };

  // 5. Prompt 模板（可选，用户可能自定义了）
  exportData.prompts = {
    templates: safeReadDir('prompts', ['.md']),
    backups: safeReadDir('prompts/backups', ['.md']),
    candidates: safeReadDir('prompts/candidates', ['.md'])
  };

  // 6. 反馈日志（可选）
  exportData.feedback = {};
  const feedbackDir = path.join(userDataPath, 'feedback');
  if (fs.existsSync(feedbackDir)) {
    try {
      for (const file of fs.readdirSync(feedbackDir)) {
        if (file.endsWith('.jsonl')) {
          exportData.feedback[file] = fs.readFileSync(path.join(feedbackDir, file), 'utf8');
        }
      }
    } catch (e) {}
  }

  // 计算校验和（先临时移除 checksum 字段，计算后再填充，保证导出和导入的校验逻辑一致）
  const metaForChecksum = { ...exportData._meta };
  delete exportData._meta;
  const dataString = JSON.stringify(exportData);
  const checksum = crypto.createHash('sha256').update(dataString).digest('hex');
  exportData._meta = { ...metaForChecksum, checksum };

  return exportData;
}

ipcMain.handle('data:export', async (event, { password }) => {
  try {
    if (!password || password.length < 4) {
      return { success: false, error: '密码至少4位' };
    }

    const exportData = collectExportData();

    // 统计数据量
    const stats = {
      tasks: exportData.core?.['memora-data.json']?.tasks?.length || 0,
      memories: exportData.memory?.['memories.json']?.length || 0,
      notes: exportData.notebook?.['notes.json']?.length || 0,
      atoms: exportData.knowledge?.['atoms.json']?.length || 0,
      clusters: exportData.knowledge?.['clusters.json']?.length || 0,
      articles: Object.keys(exportData.knowledge?.articles || {}).length,
      persons: exportData.core?.['profile.json']?.frequent_persons?.length || 0,
      projects: exportData.core?.['profile.json']?.active_projects?.length || 0
    };

    // 加密
    const jsonString = JSON.stringify(exportData);
    const encrypted = encryptData(jsonString, password);

    // 让用户选择保存路径
    const { dialog } = require('electron');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 Memora 数据',
      defaultPath: `memora-backup-${new Date().toISOString().slice(0,10)}.memora`,
      filters: [{ name: 'Memora 备份文件', extensions: ['memora'] }]
    });

    if (result.canceled) return { success: false, error: '用户取消' };

    fs.writeFileSync(result.filePath, encrypted);
    const fileSizeMB = (encrypted.length / 1024 / 1024).toFixed(2);

    return {
      success: true,
      filePath: result.filePath,
      fileSize: fileSizeMB + ' MB',
      stats
    };
  } catch (error) {
    console.error('[Export] Failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('data:import', async (event, { password, filePath }) => {
  try {
    if (!password || password.length < 4) {
      return { success: false, error: '密码至少4位' };
    }

    if (!filePath) {
      // 让用户选择文件
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '导入 Memora 数据',
        filters: [{ name: 'Memora 备份文件', extensions: ['memora'] }],
        properties: ['openFile']
      });
      if (result.canceled) return { success: false, error: '用户取消' };
      filePath = result.filePaths[0];
    }

    // 读取加密文件
    const encrypted = fs.readFileSync(filePath);

    // 解密
    let jsonString;
    try {
      jsonString = decryptData(encrypted, password);
    } catch (e) {
      return { success: false, error: '密码错误或文件已损坏' };
    }

    // 解析
    let importData;
    try {
      importData = JSON.parse(jsonString);
    } catch (e) {
      return { success: false, error: '数据格式异常，文件可能已损坏' };
    }

    // 验证
    if (!importData._meta || importData._meta.app !== 'Memora') {
      return { success: false, error: '不是有效的 Memora 备份文件' };
    }

    // 校验 checksum（与导出时一致：先移除 _meta 再计算）
    const savedChecksum = importData._meta?.checksum;
    const metaBackup = importData._meta;
    delete importData._meta;
    const currentChecksum = crypto.createHash('sha256').update(JSON.stringify(importData)).digest('hex');
    importData._meta = metaBackup;
    if (savedChecksum && savedChecksum !== currentChecksum) {
      return { success: false, error: '数据校验失败，文件可能已被篡改或损坏' };
    }

    // 统计将要导入的数据
    const stats = {
      tasks: importData.core?.['memora-data.json']?.tasks?.length || 0,
      memories: importData.memory?.['memories.json']?.length || 0,
      notes: importData.notebook?.['notes.json']?.length || 0,
      atoms: importData.knowledge?.['atoms.json']?.length || 0,
      clusters: importData.knowledge?.['clusters.json']?.length || 0,
      articles: Object.keys(importData.knowledge?.articles || {}).length,
      persons: importData.core?.['profile.json']?.frequent_persons?.length || 0,
      projects: importData.core?.['profile.json']?.active_projects?.length || 0,
      exportedAt: importData._meta?.exportedAt || '未知'
    };

    return { success: true, importData, stats };
  } catch (error) {
    console.error('[Import] Failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('data:import-confirm', async (event, { importData, mergeMode }) => {
  try {
    const userDataPath = app.getPath('userData');

    // 辅助：安全写 JSON
    function safeWriteJSON(relativePath, data) {
      const fullPath = path.join(userDataPath, relativePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
    }

    // 辅助：安全写文本
    function safeWriteText(relativePath, content) {
      const fullPath = path.join(userDataPath, relativePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
    }

    if (mergeMode === 'replace') {
      // === 全量替换模式 ===

      // 1. 核心数据
      if (importData.core) {
        if (importData.core['memora-data.json']) safeWriteJSON('memora-data.json', importData.core['memora-data.json']);
        if (importData.core['settings.json']) safeWriteJSON('settings.json', importData.core['settings.json']);
        if (importData.core['profile.json']) safeWriteJSON('profile.json', importData.core['profile.json']);
        if (importData.core['local-file-index.json']) safeWriteJSON('local-file-index.json', importData.core['local-file-index.json']);
      }

      // 2. 记忆系统
      if (importData.memory) {
        if (importData.memory['memories.json'] !== null) safeWriteJSON('memory/memories.json', importData.memory['memories.json']);
        if (importData.memory['entity-graph.json'] !== null) safeWriteJSON('memory/entity-graph.json', importData.memory['entity-graph.json']);
      }

      // 3. 记事本
      if (importData.notebook) {
        if (importData.notebook['notes.json'] !== null) safeWriteJSON('notebook/notes.json', importData.notebook['notes.json']);
        if (importData.notebook['categories.json'] !== null) safeWriteJSON('notebook/categories.json', importData.notebook['categories.json']);
      }

      // 4. 知识图谱
      if (importData.knowledge) {
        if (importData.knowledge['atoms.json'] !== null) safeWriteJSON('knowledge/atoms.json', importData.knowledge['atoms.json']);
        if (importData.knowledge['clusters.json'] !== null) safeWriteJSON('knowledge/clusters.json', importData.knowledge['clusters.json']);
        if (importData.knowledge['articles-index.json'] !== null) safeWriteJSON('knowledge/articles/articles.json', importData.knowledge['articles-index.json']);
        if (importData.knowledge['knowledge-items.json'] !== null) safeWriteJSON('knowledge/knowledge-items.json', importData.knowledge['knowledge-items.json']);
        if (importData.knowledge['recommendations.json'] !== null) safeWriteJSON('knowledge/recommendations.json', importData.knowledge['recommendations.json']);
        // 文章 Markdown 文件
        if (importData.knowledge.articles) {
          for (const [filename, content] of Object.entries(importData.knowledge.articles)) {
            if (filename.endsWith('.md')) {
              safeWriteText(`knowledge/articles/${filename}`, content);
            }
          }
        }
      }

      // 5. Prompt 模板
      if (importData.prompts) {
        if (importData.prompts.templates) {
          for (const [filename, content] of Object.entries(importData.prompts.templates)) {
            safeWriteText(`prompts/${filename}`, content);
          }
        }
        if (importData.prompts.backups) {
          for (const [filename, content] of Object.entries(importData.prompts.backups)) {
            safeWriteText(`prompts/backups/${filename}`, content);
          }
        }
        if (importData.prompts.candidates) {
          for (const [filename, content] of Object.entries(importData.prompts.candidates)) {
            safeWriteText(`prompts/candidates/${filename}`, content);
          }
        }
      }

      // 6. 反馈日志
      if (importData.feedback) {
        for (const [filename, content] of Object.entries(importData.feedback)) {
          safeWriteText(`feedback/${filename}`, content);
        }
      }

    } else {
      // === 合并模式（追加，不覆盖已有数据） ===
      const userDataPath2 = app.getPath('userData');

      function readLocalJSON(relPath) {
        try {
          const p = path.join(userDataPath2, relPath);
          if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (e) {}
        return null;
      }

      // 辅助：确保值为数组
      const ensureArray = (val) => Array.isArray(val) ? val : [];

      // 记忆：追加（按 id 去重）
      if (importData.memory?.['memories.json']) {
        const importArr = ensureArray(importData.memory['memories.json']);
        const existing = ensureArray(readLocalJSON('memory/memories.json'));
        const existingIds = new Set(existing.map(m => m.id));
        const newMemories = importArr.filter(m => !existingIds.has(m.id));
        safeWriteJSON('memory/memories.json', [...existing, ...newMemories]);
      }

      // 实体图谱：合并
      if (importData.memory?.['entity-graph.json']) {
        const existing = readLocalJSON('memory/entity-graph.json') || {};
        const imported = importData.memory['entity-graph.json'];
        const merged = typeof imported === 'object' && !Array.isArray(imported)
          ? { ...imported, ...existing }
          : existing;
        safeWriteJSON('memory/entity-graph.json', merged);
      }

      // 笔记：追加（按 id 去重）
      if (importData.notebook?.['notes.json']) {
        const importArr = ensureArray(importData.notebook['notes.json']);
        const existing = ensureArray(readLocalJSON('notebook/notes.json'));
        const existingIds = new Set(existing.map(n => n.id));
        const newNotes = importArr.filter(n => !existingIds.has(n.id));
        safeWriteJSON('notebook/notes.json', [...existing, ...newNotes]);
      }

      // 笔记分类：合并（categories.json 是对象格式 {key: {label: ...}}）
      if (importData.notebook?.['categories.json']) {
        const imported = importData.notebook['categories.json'];
        const existing = readLocalJSON('notebook/categories.json') || {};
        // 两者都是对象，按键合并（导入的覆盖同名键）
        if (typeof imported === 'object' && !Array.isArray(imported)) {
          safeWriteJSON('notebook/categories.json', { ...existing, ...imported });
        } else if (Array.isArray(imported)) {
          // 兼容旧格式：如果是数组，转为对象后合并
          const importedObj = {};
          imported.forEach(c => {
            if (c && c.key) importedObj[c.key] = { label: c.label || c.key };
          });
          safeWriteJSON('notebook/categories.json', { ...existing, ...importedObj });
        }
      }

      // 知识原子：追加
      if (importData.knowledge?.['atoms.json']) {
        const importArr = ensureArray(importData.knowledge['atoms.json']);
        const existing = ensureArray(readLocalJSON('knowledge/atoms.json'));
        const existingIds = new Set(existing.map(a => a.id));
        const newAtoms = importArr.filter(a => !existingIds.has(a.id));
        safeWriteJSON('knowledge/atoms.json', [...existing, ...newAtoms]);
      }

      // 知识簇：追加
      if (importData.knowledge?.['clusters.json']) {
        const importArr = ensureArray(importData.knowledge['clusters.json']);
        const existing = ensureArray(readLocalJSON('knowledge/clusters.json'));
        const existingIds = new Set(existing.map(c => c.id));
        const newClusters = importArr.filter(c => !existingIds.has(c.id));
        safeWriteJSON('knowledge/clusters.json', [...existing, ...newClusters]);
      }

      // 知识文章索引：追加
      if (importData.knowledge?.['articles-index.json']) {
        const importArr = ensureArray(importData.knowledge['articles-index.json']);
        const existing = ensureArray(readLocalJSON('knowledge/articles/articles.json'));
        const existingIds = new Set(existing.map(a => a.id));
        const newArticles = importArr.filter(a => !existingIds.has(a.id));
        safeWriteJSON('knowledge/articles/articles.json', [...existing, ...newArticles]);
        // 写入文章 MD 文件
        if (importData.knowledge.articles) {
          for (const [filename, content] of Object.entries(importData.knowledge.articles)) {
            const fullPath = path.join(userDataPath2, 'knowledge/articles', filename);
            if (!fs.existsSync(fullPath)) {
              safeWriteText(`knowledge/articles/${filename}`, content);
            }
          }
        }
      }

      // 知识项：追加
      if (importData.knowledge?.['knowledge-items.json']) {
        const importArr = ensureArray(importData.knowledge['knowledge-items.json']);
        const existing = ensureArray(readLocalJSON('knowledge/knowledge-items.json'));
        const existingIds = new Set(existing.map(i => i.id));
        const newItems = importArr.filter(i => !existingIds.has(i.id));
        safeWriteJSON('knowledge/knowledge-items.json', [...existing, ...newItems]);
      }

      // 推荐记录：追加
      if (importData.knowledge?.['recommendations.json']) {
        const importArr = ensureArray(importData.knowledge['recommendations.json']);
        const existing = ensureArray(readLocalJSON('knowledge/recommendations.json'));
        const existingIds = new Set(existing.map(r => r.id));
        const newRecs = importArr.filter(r => !existingIds.has(r.id));
        safeWriteJSON('knowledge/recommendations.json', [...existing, ...newRecs]);
      }

      // 设置：不覆盖（合并模式保留本地设置）
      // 本地文件索引：追加（按路径去重）
      if (importData.core?.['local-file-index.json']) {
        const localIndex = readLocalJSON('local-file-index.json') || {};
        const importIndex = importData.core['local-file-index.json'] || {};
        // 合并，本地优先
        for (const [key, val] of Object.entries(importIndex)) {
          if (!localIndex[key]) localIndex[key] = val;
        }
        safeWriteJSON('local-file-index.json', localIndex);
      }

      // 任务：追加
      if (importData.core?.['memora-data.json']?.tasks) {
        const localData = readLocalJSON('memora-data.json') || { tasks: [], settings: {}, pomodoro: {} };
        const importTasks = ensureArray(importData.core['memora-data.json'].tasks);
        const existingIds = new Set((localData.tasks || []).map(t => t.id));
        const newTasks = importTasks.filter(t => !existingIds.has(t.id));
        localData.tasks = [...(localData.tasks || []), ...newTasks];
        safeWriteJSON('memora-data.json', localData);
      }

      // 画像：合并人物和项目
      if (importData.core?.['profile.json']) {
        const localProfile = readLocalJSON('profile.json') || {};
        const importProfile = importData.core['profile.json'];
        // 追加人物（去重 by name）
        if (importProfile.frequent_persons) {
          const localPersonNames = new Set((localProfile.frequent_persons || []).map(p => p.name));
          const newPersons = importProfile.frequent_persons.filter(p => !localPersonNames.has(p.name));
          localProfile.frequent_persons = [...(localProfile.frequent_persons || []), ...newPersons];
        }
        // 追加项目
        if (importProfile.active_projects) {
          const localProjectNames = new Set((localProfile.active_projects || []).map(p => p.name));
          const newProjects = importProfile.active_projects.filter(p => !localProjectNames.has(p.name));
          localProfile.active_projects = [...(localProfile.active_projects || []), ...newProjects];
        }
        // 合并行业
        if (importProfile.user?.industries) {
          const localIndustries = new Set(localProfile.user?.industries || []);
          importProfile.user.industries.forEach(i => localIndustries.add(i));
          if (!localProfile.user) localProfile.user = {};
          localProfile.user.industries = [...localIndustries];
        }
        safeWriteJSON('profile.json', localProfile);
      }
    }

    // 重新加载内存中的数据
    if (memoryStore) {
      try {
        const { MemoryStore } = require('./src/scripts/memory');
        memoryStore = new MemoryStore();
      } catch (e) {
        console.warn('[Import] Failed to reload MemoryStore:', e.message);
      }
    }
    if (knowledgeStore) {
      try {
        const { KnowledgeStore } = require('./src/scripts/knowledgeStore');
        knowledgeStore = new KnowledgeStore();
      } catch (e) {
        console.warn('[Import] Failed to reload KnowledgeStore:', e.message);
      }
    }
    if (notebook) {
      try {
        const { Notebook } = require('./src/scripts/notebook');
        notebook = new Notebook();
      } catch (e) {
        console.warn('[Import] Failed to reload Notebook:', e.message);
      }
    }
    if (db) {
      try {
        db = new Database(userDataPath);
      } catch (e) {
        console.warn('[Import] Failed to reload Database:', e.message);
      }
    }

    return { success: true, mergeMode };
  } catch (error) {
    console.error('[Import Confirm] Failed:', error);
    return { success: false, error: error.message };
  }
});

// === v2.5 macOS Widget 数据同步 ===
// 将任务和番茄钟状态写入共享目录，供 WidgetKit 读取

const WIDGET_SYNC_INTERVAL = 5 * 60 * 1000; // 5 分钟
let widgetSyncTimer = null;

/** 同步 Widget 数据到共享文件 */
function syncWidgetData() {
  try {
    const userDataPath = app.getPath('userData');
    const tasks = db?.data?.tasks || [];
    
    // 今日待办 Top 3（未完成 + 按优先级排序）
    const today = new Date().toISOString().split('T')[0];
    const pendingTasks = tasks
      .filter(t => !t.completed && (!t.dueDate || t.dueDate <= today || t.dueDate === today))
      .sort((a, b) => {
        const pOrder = { high: 0, medium: 1, low: 2 };
        return (pOrder[a.priority] || 2) - (pOrder[b.priority] || 2);
      })
      .slice(0, 3)
      .map(t => ({
        id: t.id || String(Math.random()),
        title: (t.title || '').substring(0, 40),
        priority: t.priority || 'medium',
        dueDate: t.dueDate || null,
        isCompleted: !!t.completed
      }));
    
    // 番茄钟状态
    const pomodoroStatePath = path.join(userDataPath, 'pomodoro-state.json');
    let pomodoro = null;
    if (fs.existsSync(pomodoroStatePath)) {
      try {
        const pomoData = JSON.parse(fs.readFileSync(pomodoroStatePath, 'utf8'));
        if (pomoData.isRunning) {
          pomodoro = {
            isRunning: true,
            remainingSeconds: Math.max(0, Math.floor(((pomoData.endTime || 0) - Date.now()) / 1000)),
            currentTask: pomoData.taskTitle || null
          };
        }
      } catch (_) {}
    }
    
    const widgetData = {
      tasks: pendingTasks,
      pomodoro,
      lastUpdated: new Date().toISOString()
    };
    
    // 写入 App Group 共享目录
    // macOS: ~/Library/Group Containers/group.com.memora.app/
    const appGroupID = 'group.com.memora.app';
    const groupPath = path.join(process.env.HOME || '/tmp', 'Library', 'Group Containers', appGroupID);
    if (!fs.existsSync(groupPath)) {
      try { fs.mkdirSync(groupPath, { recursive: true }); } catch (_) {}
    }
    
    const widgetDataPath = path.join(groupPath, 'widgetData.json');
    fs.writeFileSync(widgetDataPath, JSON.stringify(widgetData, null, 2));
    
    console.log(`[Widget] Synced: ${pendingTasks.length} tasks, pomodoro=${pomodoro?.isRunning ? 'running' : 'idle'}`);
  } catch (err) {
    console.warn('[Widget] Sync error:', err.message);
  }
}

/** 启动 Widget 定时同步 */
function startWidgetSync() {
  if (widgetSyncTimer) return;
  syncWidgetData(); // 立即同步一次
  widgetSyncTimer = setInterval(syncWidgetData, WIDGET_SYNC_INTERVAL);
  console.log('[Widget] Sync started (interval: 5min)');
}

// 应用就绪后启动 Widget 同步
app.whenReady().then(() => {
  setTimeout(startWidgetSync, 5000);
});