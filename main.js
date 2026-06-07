const { app, BrowserWindow, ipcMain, clipboard, Notification, Tray, Menu, nativeImage, powerMonitor } = require('electron');

// 防止 EPIPE 崩溃：stdout/stderr 管道关闭时（如终端关闭），console.log 写入会抛出 EPIPE
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); });
process.stderr.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); });

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

// 剪贴板智能监控系统
const { startClipboardWatcher, stopClipboardWatcher, getScheduler } = require('./clipboard');
const { getClipboardHash } = require('./clipboard/hashUtils');

let mainWindow;
let tray;
let clipboardWatcher;
let lastClipboardText = '';
let isAnalyzing = false; // 防止并发分析
let processedClipboardHashes = new Set();
const MAX_CLIPBOARD_HASHES = 500; // 限制哈希记录数量防止内存膨胀

// 数据库层（JSON文件存储）
const { Database } = require('./src/scripts/database');
let db;

// i18n
const { I18n } = require('./src/scripts/i18n');

// 自动备份定时器
let autoBackupTimer = null;

// 默认内置API Key（用户未配置时使用，限制10次/天）
const DEFAULT_API_KEY = 'sk-b4116cb788d64e3fb20e8e5bd1333168';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';

// 默认限制（使用内置Key时）
const DEFAULT_DAILY_LIMIT_FOR_BUILTIN_KEY = 10;

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

// 环境配置（默认值）
const DEFAULT_AUTH_SERVERS = {
  beta: {
    name: 'Beta 版本（测试）',
    authUrl: 'http://121.5.164.126:3450',    // config-server（v2.0 自建认证）
    configUrl: 'http://121.5.164.126:3450',   // 配置服务
    toolkitUrl: 'http://121.5.164.126:3010',  // ADPToolkit 资源服务器（文档/案例/Demo）
    loginPath: '/auth/login',                  // 登录路径
    loginField: 'email',                       // 使用 email 登录
    configPath: '/config',                     // 配置路径
    validatePath: '/auth/validate'             // 验证路径
  },
  production: {
    name: '正式版本',
    authUrl: 'http://21.91.29.59:3000',       // ADPToolkit（username 登录）
    configUrl: 'http://121.5.164.126:3450',   // 配置仍走 config-server
    toolkitUrl: 'http://21.91.29.59:3000',    // ADPToolkit 资源服务器（与认证同一地址）
    loginPath: '/api/auth/login',              // ADPToolkit 登录路径
    loginField: 'username',                    // 使用 username 登录
    configPath: '/memora/config',              // v2.1 配置路径
    validatePath: '/api/auth/me'               // ADPToolkit 验证路径
  }
};

// 深拷贝默认配置作为运行时配置
let AUTH_SERVERS = JSON.parse(JSON.stringify(DEFAULT_AUTH_SERVERS));

// 从持久化存储加载自定义服务器地址
function loadCustomServerUrls() {
  try {
    const custom = getSetting('custom_server_urls');
    if (custom && typeof custom === 'string') {
      const parsed = JSON.parse(custom);
      for (const env of ['beta', 'production']) {
        if (parsed[env]) {
          if (parsed[env].authUrl) AUTH_SERVERS[env].authUrl = parsed[env].authUrl;
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

// 记忆系统
const { MemoryStore, MEMORY_TYPES, MEMORY_CATEGORIES, BUSINESS_CATEGORIES, BUSINESS_KEYWORDS } = require('./src/scripts/memory');
let memoryStore;

// 记事本系统
const { Notebook } = require('./src/scripts/notebook');
let notebook;

// 知识萃取系统
let knowledgeStore;

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
  const asarSrc = __dirname; // ASAR 内部路径（只读）
  
  // 迁移 memory 目录
  const memoryDest = path.join(userData, 'memory');
  const memorySrc = path.join(asarSrc, 'src', 'scripts', 'memory');
  if (!fs.existsSync(memoryDest) && fs.existsSync(memorySrc)) {
    try {
      fs.mkdirSync(memoryDest, { recursive: true });
      const files = fs.readdirSync(memorySrc);
      for (const file of files) {
        const srcFile = path.join(memorySrc, file);
        const destFile = path.join(memoryDest, file);
        if (fs.statSync(srcFile).isFile() && !fs.existsSync(destFile)) {
          fs.copyFileSync(srcFile, destFile);
          console.log('[Data] Migrated memory file:', file);
        }
      }
    } catch (e) { console.error('[Data] Failed to migrate memory:', e); }
  }
  
  // 迁移 notebook 目录
  const notebookDest = path.join(userData, 'notebook');
  const notebookSrc = path.join(asarSrc, 'src', 'scripts', 'notebook');
  if (!fs.existsSync(notebookDest) && fs.existsSync(notebookSrc)) {
    try {
      fs.mkdirSync(notebookDest, { recursive: true });
      const files = fs.readdirSync(notebookSrc);
      for (const file of files) {
        const srcFile = path.join(notebookSrc, file);
        const destFile = path.join(notebookDest, file);
        if (fs.statSync(srcFile).isFile() && !fs.existsSync(destFile)) {
          fs.copyFileSync(srcFile, destFile);
          console.log('[Data] Migrated notebook file:', file);
        }
      }
    } catch (e) { console.error('[Data] Failed to migrate notebook:', e); }
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

// === 用户画像 ===
function getDefaultProfile() {
  return {
    user: { name: '朱从坤', english_name: 'Dean', role: '产品经理 & 全栈开发者', industries: ['AI', 'SaaS', '企业服务'] },
    frequent_persons: [],
    active_projects: [],
    preferences: {
      priority_signals: ['老板', '紧急', 'ASAP', '立即', '今天', '务必'],
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
    return {
      apiKey: remoteConfig.api.api_key,
      baseUrl: remoteConfig.api.base_url,
      model: remoteConfig.api.model,
      dailyLimit: remoteConfig.api.daily_limit || 500,
      isCustomKey: false  // 组织Key
    };
  }
  
  const userApiKey = getSetting('api_key');
  const userBaseUrl = getSetting('api_base_url');
  const userModel = getSetting('api_model');
  const userDailyLimit = parseInt(getSetting('api_daily_limit'));
  
  return {
    apiKey: userApiKey || DEFAULT_API_KEY,
    baseUrl: userBaseUrl || DEFAULT_BASE_URL,
    model: userModel || DEFAULT_MODEL,
    dailyLimit: userDailyLimit || (userApiKey ? 1000 : DEFAULT_DAILY_LIMIT_FOR_BUILTIN_KEY),
    isCustomKey: !!userApiKey
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
  
  // 2. 长度检查
  if (text.length > FILTER_CONFIG.maxLength) {
    return { shouldAnalyze: false, reason: `内容过长（${text.length}字 > ${FILTER_CONFIG.maxLength}字）` };
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

function startClipboardWatcher() {
  console.log('[Clipboard] Starting smart clipboard scheduler...');
  
  const scheduler = startClipboardWatcher({
    clipboard,
    powerMonitor,
    preClassifyFn: preClassify,
    analyzeFn: analyzeClipboardText,
    mainWindow,
    notebook,
    getSettingFn: getSetting,
    processedHashes: processedClipboardHashes,
    maxHashes: MAX_CLIPBOARD_HASHES
  });

  // 保存引用以便清理
  clipboardWatcher = scheduler;

  console.log('[Clipboard] Smart scheduler started (buffer + dynamic freq + state detect)');
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
  const count = parseInt(getSetting(AI_CALLS_KEY) || '0');
  const config = getAPIConfig();
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

async function analyzeClipboardText(text) {
  if (!text || text.trim().length === 0) return;
  
  // 防止并发分析
  if (isAnalyzing) {
    console.log('[AI] Previous analysis still in progress, skipping');
    return;
  }
  isAnalyzing = true;

  try {
    console.log('[AI] Analyzing clipboard text...');
    
    // 1. 先去重检查
    if (isClipboardProcessed(text)) {
      console.log('[AI] Duplicate content detected, skipping AI call');
      isAnalyzing = false;
      return;
    }
    
    // 2. 预分类器检查（在调用AI之前先过滤）
    const preResult = preClassify(text);
    
    // 保存到记忆系统（调试期：保存所有剪切板内容）
    let analysisResult = null;
    let confidence = 0;
    let isTask = false;
    let taskTitle = null;
    
    if (!preResult.shouldAnalyze) {
      console.log('[AI] Pre-classification rejected:', preResult.reason);
      // 闲聊/无效内容不入记事本，仅记录日志
      console.log('[Notebook] Skipped: pre-classification rejected -', preResult.reason);
      isAnalyzing = false;
      return;
    }
    console.log('[AI] Pre-classification passed:', preResult.reason);
    
    // 3. 检查AI调用次数限制
    if (!canMakeAICall()) {
      console.log('[AI] Daily limit reached, skipping analysis');
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
      isAnalyzing = false;
      return;
    }
    
    // 获取API配置
    const apiConfig = getAPIConfig();
    
    // 生成 trace_id 用于反馈闭环
    const traceId = feedbackLogger ? feedbackLogger.newTraceId() : `tr_${Date.now()}_local`;
    
    // 构建用户提示词，附带预分类信号和当前时间
    const now = new Date();
    const currentDayOfWeek = ['日','一','二','三','四','五','六'][now.getDay()];
    const currentHour = now.getHours();
    const timePeriod = currentHour < 6 ? '凌晨' : currentHour < 12 ? '上午' : currentHour < 18 ? '下午' : '晚上';
    let userPrompt = `[当前时间：${now.toLocaleString('zh-CN')} 周${currentDayOfWeek} ${timePeriod}]\n\n分析以下文本：\n\n${text}`;
    if (preResult.hasAtMention) {
      userPrompt += '\n\n[预分类信号：检测到@提及，这通常是强待办信号]';
    }
    if (preResult.hasNumberedList) {
      userPrompt += '\n\n[预分类信号：检测到编号列表，这通常是任务列表]';
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
    const systemPrompt = buildClipboardAnalysisPrompt(traceId);
    
    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ]
      })
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
      isAnalyzing = false;
      return;
    }

    // 4. 调用成功后增加计数并标记内容为已处理
    incrementAICallCount();
    markClipboardProcessed(text);
    
    const data = await response.json();
    console.log('[AI] Response received:', JSON.stringify(data).substring(0, 200));
    
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
        console.log('[AI] Parsed result:', JSON.stringify({
          is_valid_info: result.is_valid_info,
          is_task: result.is_task,
          needs_recommendation: result.needs_recommendation,
          recommendation_intent: result.recommendation_intent,
          recommendation_query: result.recommendation_query,
          confidence: result.confidence
        }));
      } catch (e) {
        console.error('[AI] Failed to parse response:', e, 'Raw:', data.choices[0].message.content?.substring(0, 200));
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
        isAnalyzing = false;
        return;
      }
      
      // 保存到记事本 —— 仅保存有效信息（闲聊/无效内容不入记事本）
      // 动态匹配分类：优先使用 AI 返回的 category，再根据 tags 匹配
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
        isAnalyzing = false;
        return;
      }

      // 仅有效信息保存到记事本
      let savedNoteId = null;
      if (result.is_valid_info && notebook) {
        const noteData = {
          content: text,
          category: noteCategory,
          analyzed: true,
          analysis: {
            traceId: traceId,
            isTask: result.is_task,
            taskTitle: result.title,
            taskPriority: result.priority,
            tags: result.tags,
            reason: result.reason,
            time: result.time,
            description: result.description,
            confidence: confidence,
            needsRecommendation: result.needs_recommendation || false,
            recommendationIntent: result.recommendation_intent || null
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
          extractKnowledgeAtoms(text, savedNoteId, result.tags).catch(err => {
            console.error('[Knowledge] Atom extraction error:', err);
          });
        }
      } else {
        console.log('[Notebook] Skipped: not valid info -', result.reason);
      }
      
      // 提取结构化记忆（只保存提炼后的有效信息）
      if (memoryStore && result.is_valid_info && (result.is_task || confidence >= 0.7)) {
        // 调用记忆提取Prompt
        try {
          const memoryResponse = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiConfig.apiKey}`
            },
            body: JSON.stringify({
              model: apiConfig.model,
              messages: [
                {
                  role: 'system',
                  content: getCurrentMemoryPrompt()
                },
                {
                  role: 'user',
                  content: `从以下文本中提取结构化记忆：\n\n${text}`
                }
              ]
            })
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
                  extractedFrom: 'clipboard'
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
        // 时间语义校验：确保 AI 解析的小时与原始文本中的上午/下午语义一致
        let dueDateISO = result.time?.normalized ? new Date(result.time.normalized).toISOString() : null;
        if (dueDateISO && result.time?.raw) {
          dueDateISO = validateTimeSemantic(result.time.raw, dueDateISO);
        }
        
        mainWindow.webContents.send('clipboard-task-detected', {
          rawText: text,
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
        mainWindow.webContents.send('clipboard-candidate-detected', {
          rawText: text,
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
    console.error('[AI] Analysis failed:', error);
  } finally {
    isAnalyzing = false;
  }
}

async function estimateTaskDuration(task) {
  try {
    const apiConfig = getAPIConfig();
    
    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          {
            role: 'system',
            content: '你是一个时间管理专家，能够准确预估任务所需时间。只返回数字（分钟数）。'
          },
          {
            role: 'user',
            content: `预估以下任务需要多少分钟完成：\n\n任务：${task.title}\n描述：${task.description || '无'}`
          }
        ]
      })
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

function showNotification(title, body) {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title,
      body: body,
      icon: getResourcePath('resources/icon.png'),
      sound: 'default'
    });
    notification.show();
  }
}

ipcMain.handle('estimate-duration', async (event, task) => {
  return await estimateTaskDuration(task);
});

// AI分析任务输入
ipcMain.handle('analyze-task', async (event, text) => {
  try {
    const apiConfig = getAPIConfig();
    
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
    
    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          {
            role: 'system',
            content: getCurrentAIPrompt()
          },
          {
            role: 'user',
            content: userPrompt
          }
        ]
      })
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
          reason: result.reason || ''
        }
      };
    }
  } catch (error) {
    console.error('[AI] Task analysis failed:', error);
    return { success: false, error: error.message };
  }
  
  return { success: false, error: '分析失败' };
});

ipcMain.handle('analyze-clipboard', async (event, text) => {
  try {
    const apiConfig = getAPIConfig();
    
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

    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          {
            role: 'system',
            content: clipboardPrompt
          },
          {
            role: 'user',
            content: text
          }
        ],
        temperature: 0.3
      })
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

ipcMain.handle('optimize-clipboard-prompt', async (event, feedback) => {
  try {
    const currentPrompt = getSetting('clipboard_prompt') || '';
    
    const optimizePrompt = `你是一个Prompt优化专家。根据用户的反馈，优化以下剪切板识别Prompt：

当前Prompt：
${currentPrompt}

用户反馈：
${feedback}

请返回优化后的完整Prompt，保持原有格式和结构，但根据反馈调整判断逻辑。`;

    const apiConfig = getAPIConfig();
    
    if (!canMakeAICall()) {
      return { success: false, error: '每日调用次数已达上限' };
    }
    
    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          {
            role: 'user',
            content: optimizePrompt
          }
        ],
        temperature: 0.5
      })
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

ipcMain.handle('show-notification', async (event, title, body) => {
  showNotification(title, body);
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
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    dailyLimit: config.dailyLimit,
    isCustomKey: config.isCustomKey,
    fromServer: authState.isLoggedIn && !!remoteConfig?.api && !authState.forceLocalConfig,  // v2.0: 标记是否来自服务器
    forceLocalConfig: authState.forceLocalConfig || false
    // 不返回apiKey，防止泄露
  };
});

ipcMain.handle('set-api-config', async (event, config) => {
  if (config.apiKey) {
    setSetting('api_key', config.apiKey);
  }
  if (config.baseUrl) {
    setSetting('api_base_url', config.baseUrl);
  }
  if (config.model) {
    setSetting('api_model', config.model);
  }
  if (config.dailyLimit) {
    setSetting('api_daily_limit', config.dailyLimit.toString());
  }
  return { success: true };
});

ipcMain.handle('clear-api-key', async () => {
  setSetting('api_key', '');
  setSetting('api_base_url', '');
  setSetting('api_model', '');
  setSetting('api_daily_limit', '');
  return { success: true };
});

// ADP配置相关
const DEFAULT_ADP_APP_KEY = 'EvcCHxUUzJxtLABspxBFjoVTpJOByUUYUgozjvursQwChNZqkEVGXrvGroXLNDTMSWKWabnkhGqjxIttpGLqPqqUefOIkPVQUEYyPTtHbbfoltrSajKxQnSjQDfFVcnm';
// 知识推荐和知识搜索使用的专用 AppKey（与通用 ADP 助手不同）
const DEFAULT_ADP_KNOWLEDGE_APP_KEY = 'VnIvLvjBTdjXFNmqBnQFsAhDdHPuzELARwKgYwZwvEqBRiIViQamZAGgKXBbOqZNwMbvFvIYwIkYxgkjmtrcaUUqdXsMPXnNbqTxOJohdOXHzLNCYKloszFwrcEKSDcK';

ipcMain.handle('get-adp-config', async () => {
  // v2.0: 登录状态优先使用服务器配置（除非用户强制使用本地配置）
  if (authState.isLoggedIn && remoteConfig?.adp && !authState.forceLocalConfig) {
    const serverAppKey = remoteConfig.adp.app_key || '';
    const serverKnowledgeAppKey = remoteConfig.adp.knowledge_app_key || '';
    const serverSearchAppKey = remoteConfig.adp.search_app_key || '';
    return {
      appKey: serverAppKey || DEFAULT_ADP_APP_KEY,
      url: remoteConfig.adp.url || 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
      agentName: remoteConfig.adp.agent_name || '我的AI助手',
      knowledgeAppKey: serverKnowledgeAppKey || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
      searchAppKey: serverSearchAppKey || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
      fromServer: true,
      // 详细标注每个 Key 的真实来源：server=服务器配置, default=本地默认值, custom=用户自定义
      configSource: {
        appKey: serverAppKey ? 'server' : 'default',
        knowledgeAppKey: serverKnowledgeAppKey ? 'server' : 'default',
        searchAppKey: serverSearchAppKey ? 'server' : 'default',
      }
    };
  }

  const localAppKey = getSetting('adp_app_key') || '';
  const localKnowledgeAppKey = getSetting('adp_knowledge_app_key') || '';
  const localSearchAppKey = getSetting('adp_search_app_key') || '';
  return {
    appKey: localAppKey || DEFAULT_ADP_APP_KEY,
    url: getSetting('adp_url') || 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
    agentName: getSetting('adp_agent_name') || '我的AI助手',
    knowledgeAppKey: localKnowledgeAppKey || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
    searchAppKey: localSearchAppKey || DEFAULT_ADP_KNOWLEDGE_APP_KEY,
    fromServer: false,
    configSource: {
      appKey: localAppKey ? 'custom' : 'default',
      knowledgeAppKey: localKnowledgeAppKey ? 'custom' : 'default',
      searchAppKey: localSearchAppKey ? 'custom' : 'default',
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
  return { success: true };
});

ipcMain.handle('clear-adp-config', async () => {
  setSetting('adp_app_key', '');
  setSetting('adp_url', '');
  setSetting('adp_agent_name', '');
  setSetting('adp_knowledge_app_key', '');
  setSetting('adp_search_app_key', '');
  return { success: true };
});

// ===== v2.0 认证与远程配置 IPC =====

// 拉取远程配置到内存（不写磁盘）
async function fetchRemoteConfig() {
  if (!authState.isLoggedIn || !authState.token) return;

  const server = getAuthServer();
  try {
    const res = await fetch(`${server.configUrl}${server.configPath}`, {
      headers: { 'Authorization': `Bearer ${authState.token}` }
    });

    if (res.ok) {
      const data = await res.json();
      // 仅存内存，不写磁盘，退出登录即消失
      remoteConfig = data;
      console.log('[Auth] Remote config fetched, keys:', Object.keys(data));
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
      }
      console.log('[Auth] ADP config - app_key:', (data.adp?.app_key || '').substring(0, 10) + '...',
        '| knowledge_app_key:', (data.adp?.knowledge_app_key || '').substring(0, 10) + '...',
        '| search_app_key:', (data.adp?.search_app_key || '').substring(0, 10) + '...');
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
  authState = { isLoggedIn: false, token: null, user: null, env, forceLocalConfig: false };
  remoteConfig = null;  // 清空内存中的服务器配置

  if (clearToken) {
    // 清除持久化的 token
    deleteSetting('auth_token');
    deleteSetting('auth_user');
    deleteSetting('auth_remember_me');
  }

  // 通知渲染进程
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:changed', { isLoggedIn: false });
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

  try {
    const res = await fetch(`${server.authUrl}${server.validatePath}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      authState.isLoggedIn = true;
      authState.token = token;
      authState.user = data.user || data;
      await fetchRemoteConfig();
      console.log('[Auth] Auto login success:', authState.user?.email || authState.user?.username);
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

// 登录（支持双环境）
ipcMain.handle('auth:login', async (event, { email, password, env, rememberMe }) => {
  try {
    // 设置环境
    authState.env = env || 'beta';
    const server = getAuthServer();

    // 根据环境构建登录请求
    const loginBody = server.loginField === 'username'
      ? { username: email, password }  // 正式环境用 username
      : { email, password };           // Beta 环境用 email

    const res = await fetch(`${server.authUrl}${server.loginPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginBody)
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, error: data.message || data.error || '登录失败' };
    }

    // 保存认证状态到内存
    authState.isLoggedIn = true;
    authState.token = data.token;
    authState.user = data.user;
    authState.forceLocalConfig = false;  // 新登录默认使用云端配置

    // 持久化 token 和环境
    setSetting('auth_token', data.token);
    setSetting('auth_user', JSON.stringify(data.user));
    setSetting('auth_env', authState.env);
    setSetting('auth_force_local', '0');
    setSetting('auth_remember_me', rememberMe !== false ? '1' : '0');  // 记住登录状态

    // 拉取服务器配置到内存
    await fetchRemoteConfig();

    // 通知渲染进程
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:changed', { isLoggedIn: true, user: data.user, env: authState.env });
    }

    console.log('[Auth] Login success:', data.user?.email || data.user?.username, 'env:', authState.env);
    // 上报登录活动
    await reportLoginActivity(!!remoteConfig);
    // 拉取服务端通知并显示
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
    // 启动通知轮询
    startNotificationPolling();
    // 检查更新
    const updateInfo = await checkForUpdate();
    if (updateInfo.has_update && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', updateInfo);
    }
    return { success: true, user: data.user, env: authState.env };
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return { success: false, error: '网络错误，请检查连接' };
  }
});

// 退出登录
ipcMain.handle('auth:logout', async () => {
  await handleLogout();
  return { success: true };
});

// 获取当前认证状态
ipcMain.handle('auth:get-state', async () => {
  const server = getAuthServer();
  return {
    isLoggedIn: authState.isLoggedIn,
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
      AUTH_SERVERS[env] = JSON.parse(JSON.stringify(DEFAULT_AUTH_SERVERS[env]));
    } else {
      AUTH_SERVERS = JSON.parse(JSON.stringify(DEFAULT_AUTH_SERVERS));
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
  return { success: true };
});

// ADP消息发送（流式SSE推送，参考 knowledge:search-adp 架构）
let activeChatADPController = null;

ipcMain.handle('send-adp-message', async (event, message) => {
  // v2.0: 登录状态优先使用服务器配置（除非用户强制使用本地配置）
  let appKey, url, configSource = 'default';
  if (authState.isLoggedIn && remoteConfig?.adp && !authState.forceLocalConfig) {
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
  
  console.log('[ADP Chat] send-adp-message called, configSource:', configSource);
  
  const convId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  const requestId = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

  const requestBody = {
    RequestId: requestId,
    ConversationId: convId,
    AppKey: appKey.trim(),
    VisitorId: getDeviceFingerprint(),
    Contents: [{ Type: 'text', Text: message }],
    Incremental: true,
    Stream: 'enable',
    StreamingThrottle: 5
  };
  
  try {
    const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');

    const controller = new AbortController();
    activeChatADPController = controller;

    const response = await fetch(httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      activeChatADPController = null;
      return { success: false, error: `ADP请求失败: HTTP ${response.status}`, configSource };
    }

    // 立即返回成功，后续通过 IPC 事件流式推送每个 SSE event
    // 异步处理 SSE 流
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
                  mainWindow.webContents.send('adp:sse-event', { event: 'done', data: null, configSource });
                  activeChatADPController = null;
                  return;
                }
                try {
                  const parsed = JSON.parse(currentData);
                  // 推送完整的 {event, data} 给前端，让前端处理渲染
                  mainWindow.webContents.send('adp:sse-event', {
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
            mainWindow.webContents.send('adp:sse-event', {
              event: currentEvent || parsed.Type || '',
              data: parsed,
              configSource
            });
          } catch (e) {}
        }
        mainWindow.webContents.send('adp:sse-event', { event: 'done', data: null, configSource });
      } catch (e) {
        if (e.name === 'AbortError') {
          mainWindow.webContents.send('adp:sse-event', { event: 'done', data: null, configSource, aborted: true });
        } else {
          mainWindow.webContents.send('adp:sse-event', { event: 'error', data: { Error: { Message: e.message } }, configSource });
        }
      }
      activeChatADPController = null;
    })();

    return { success: true, streaming: true, configSource };
  } catch (error) {
    activeChatADPController = null;
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

// 记忆系统相关
ipcMain.handle('get-memories', async (event, options) => {
  if (!memoryStore) return { memories: [] };
  return { memories: memoryStore.getMemories(options || {}) };
});

ipcMain.handle('add-memory', async (event, memory) => {
  if (!memoryStore) return { success: false };
  const result = memoryStore.addMemory(memory);
  return { success: true, memory: result };
});

ipcMain.handle('update-memory', async (event, id, updates) => {
  if (!memoryStore) return { success: false };
  const result = memoryStore.updateMemory(id, updates);
  return { success: true, memory: result };
});

ipcMain.handle('delete-memory', async (event, id) => {
  if (!memoryStore) return { success: false };
  memoryStore.deleteMemory(id);
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
    const apiConfig = getAPIConfig();
    if (!apiConfig.apiKey) return { success: false, error: '请先配置 AI API Key' };
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

    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `记忆内容：${content}\n\n相关历史记忆：\n${relatedText}` }
        ],
        temperature: 0.1,
        max_tokens: 4096
      })
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
    const apiConfig = getAPIConfig();
    if (!apiConfig.apiKey) return { success: false, error: '请先配置 AI API Key' };
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

    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: memoriesText }
        ],
        temperature: 0.1,
        max_tokens: 4096
      })
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
  console.log('[Clipboard] Hashes cleared');
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
    pause_on_lock: getSetting('clipboard_pause_on_lock') !== false,
    stable_timeout_normal: parseInt(getSetting('clipboard_stable_timeout_normal')) || 3000,
    stable_timeout_highfreq: parseInt(getSetting('clipboard_stable_timeout_highfreq')) || 5000,
    stable_timeout_ultrafreq: parseInt(getSetting('clipboard_stable_timeout_ultrafreq')) || 8000,
    max_fragments: parseInt(getSetting('clipboard_max_fragments')) || 20,
    max_total_length: parseInt(getSetting('clipboard_max_total_length')) || 3000,
    freq_normal: parseInt(getSetting('clipboard_freq_normal')) || 2000,
    freq_idle: parseInt(getSetting('clipboard_freq_idle')) || 15000,
    idle_threshold: parseInt(getSetting('clipboard_idle_threshold')) || 60000,
  };
});

// 更新剪贴板监控配置
ipcMain.handle('clipboard:update-config', async (event, config) => {
  const allowedKeys = [
    'clipboard_buffer_enabled', 'clipboard_freq_enabled', 'clipboard_association_enabled',
    'clipboard_pause_on_lock', 'clipboard_stable_timeout_normal', 'clipboard_stable_timeout_highfreq',
    'clipboard_stable_timeout_ultrafreq', 'clipboard_max_fragments', 'clipboard_max_total_length',
    'clipboard_freq_normal', 'clipboard_freq_idle', 'clipboard_idle_threshold'
  ];
  for (const [key, value] of Object.entries(config)) {
    if (allowedKeys.includes(key)) {
      setSetting(key, value);
    }
  }
  console.log('[Clipboard] Config updated:', config);
  return { success: true };
});

// ========== 记事本相关IPC处理器 ==========

ipcMain.handle('notebook-add-note', async (event, note) => {
  if (!notebook) return { success: false };
  const result = notebook.addNote(note);
  // addNote 返回 null 表示当天重复内容
  if (!result) return { success: true, duplicate: true, note: null };
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
  const result = notebook.deleteNote(id);
  return { success: result !== null };
});

ipcMain.handle('notebook-delete-notes-by-category', async (event, category) => {
  if (!notebook) return { success: false };
  const deletedCount = notebook.deleteNotesByCategory(category);
  return { success: true, deletedCount };
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

  // 防止重复启动
  if (clusteringRunning) {
    return { started: false, message: '聚类正在进行中，请等待完成或取消' };
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

  return { started: true };
});

// 取消正在进行的聚类
ipcMain.handle('knowledge:cancel-clustering', async () => {
  clusteringAborted = true;
  console.log('[Knowledge] Clustering cancelled by user');
  return { success: true };
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

  // 防止重复启动
  if (clusteringRunning) {
    return { started: false, message: '聚类正在进行中，请等待完成或取消' };
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
    
    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: content }
        ]
      })
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
    const apiConfig = getAPIConfig();
    
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
    
    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          { role: 'system', content: '你是一个AI助手，擅长优化Prompt和识别规则。' },
          { role: 'user', content: optimizationPrompt }
        ]
      })
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
  
  // 加载持久化设置（auth_token, custom_server_urls 等）
  loadSettings();
  console.log('[Settings] Loaded from disk');
  
  // 初始化数据库层（同步）
  db = new Database(app.getPath('userData'));
  db.init();
  console.log('[Database] Database initialized');
  
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
  
  // 初始化知识萃取系统
  const { KnowledgeStore } = require('./src/scripts/knowledgeStore');
  knowledgeStore = new KnowledgeStore();
  console.log('[KnowledgeStore] Knowledge distillation store initialized');

  // 初始化反馈系统
  feedbackLogger = new FeedbackLogger();
  console.log('[Feedback] Feedback logger initialized');
  
  createWindow();
  console.log('[App] Window created');
  createTray();
  console.log('[App] Tray created');
  startClipboardWatcher();
  console.log('[App] Clipboard watcher started');
  
  // v2.0: 加载自定义服务器地址，然后自动登录
  loadCustomServerUrls();
  autoLogin().then(() => {
    console.log('[Auth] Auto login process completed');
  }).catch(err => {
    console.error('[Auth] Auto login error:', err);
  });
  
  // 自动备份（每天凌晨3点）
  startAutoBackup();
  console.log('[App] Auto backup scheduled');

  // Phase 3: 每周优化器检查
  checkWeeklyOptimizer();
  // 每小时检查一次是否需要运行优化器
  setInterval(checkWeeklyOptimizer, 60 * 60 * 1000);

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
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
  }
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
}

// ========== 数据库 IPC 处理器 ==========
ipcMain.handle('db-get-tasks', async () => {
  if (!db) return [];
  return db.getTasks();
});

ipcMain.handle('db-save-tasks', async (event, tasks) => {
  if (!db) return { success: false };
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

ipcMain.handle('agent:invoke', async (event, { query, agentType, attachments }) => {
  try {
    const apiConfig = getAPIConfig();
    if (!canMakeAICall()) return { success: false, error: '每日调用次数已达上限' };

    const profile = loadProfile();
    let intent = agentType || classifyIntent(query);
    const context = await retrieveContext(query, intent, profile);
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
    console.log('[Agent] Invoke (streaming) - intent:', intent, 'model:', apiConfig.model, 'baseUrl:', apiConfig.baseUrl);
    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
      body: JSON.stringify({
        model: apiConfig.model, messages, temperature: 0.5, stream: true,
        // chat 模式（LLM直接对话）不强制 JSON 格式，让模型自然回复
        // 其他 agent 模式且无图片附件时强制 JSON 格式
        ...(intent === 'chat' ? {} : (attachments?.length ? {} : { response_format: { type: 'json_object' } }))
      })
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
  { file: 'task_recognition_v2.0.md', name: '任务识别 v2.0', icon: '📋', desc: '从剪贴板/输入文本识别待办事项，用于智能任务分析和剪贴板检测', used_in: '剪贴板检测 + AI任务分析 + Agent系统' },
  { file: 'memory_extraction_v2.0.md', name: '记忆提取 v2.0', icon: '🧠', desc: '从文本中提取结构化记忆（人物/主题/关键观点/实体等）', used_in: '记忆提炼 + 剪贴板记忆提取' },
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

// 剪贴板意图分类（作为 AI 判断的降级备选方案）
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
    const apiConfig = getAPIConfig();
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

    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1000
      })
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
  ATOM_CONTENT_MAX_LENGTH: 80,       // 原子内容截断长度
  CLUSTER_INFO_MAX_COUNT: 30,        // 已有簇最大展示数
  MAX_TOKENS_BATCH: 4000,            // 分批模式输出 token 上限
  MAX_TOKENS_SINGLE: 2000,           // 单次模式输出 token 上限
  TEMPERATURE: 0.3,                  // 聚类温度
  BATCH_DELAY_MS: 500,               // 批次间隔（避免 QPS 限制）
  MAX_RETRIES: 2,                    // 单批最大重试次数
};

let clusteringAborted = false;
let clusteringRunning = false;

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

// 单批 AI 调用 + 解析
async function processClusteringBatch(batchAtoms, existingClusters, promptTemplate, apiConfig, retryCount = 0) {
  const prompt = buildClusteringPrompt(existingClusters, batchAtoms, promptTemplate);
  const maxTokens = batchAtoms.length <= CLUSTERING_CONFIG.SINGLE_CALL_THRESHOLD
    ? CLUSTERING_CONFIG.MAX_TOKENS_SINGLE
    : CLUSTERING_CONFIG.MAX_TOKENS_BATCH;

  try {
    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: CLUSTERING_CONFIG.TEMPERATURE,
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      // 429 限流
      if (response.status === 429 && retryCount < CLUSTERING_CONFIG.MAX_RETRIES) {
        console.warn('[Knowledge] Rate limited, retrying in 5s...');
        await new Promise(r => setTimeout(r, 5000));
        return processClusteringBatch(batchAtoms, existingClusters, promptTemplate, apiConfig, retryCount + 1);
      }
      const errBody = await response.text().catch(() => '');
      console.error('[Knowledge] AI API error:', response.status, errBody.substring(0, 300));
      return { success: false, error: `AI 服务调用失败（${response.status}）`, assignments: [] };
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      // JSON 解析失败，重试
      if (retryCount < CLUSTERING_CONFIG.MAX_RETRIES) {
        console.warn('[Knowledge] Clustering parse error, retrying...', retryCount + 1);
        await new Promise(r => setTimeout(r, 1000));
        return processClusteringBatch(batchAtoms, existingClusters, promptTemplate, apiConfig, retryCount + 1);
      }
      console.error('[Knowledge] Clustering parse error after retries:', e, 'Raw:', rawText.substring(0, 200));
      return { success: false, error: 'AI 返回格式异常，无法解析聚类结果', assignments: [] };
    }

    return { success: true, assignments: parsed.assignments || [], mature_cluster_ids: parsed.mature_cluster_ids || [] };
  } catch (e) {
    if (retryCount < CLUSTERING_CONFIG.MAX_RETRIES) {
      console.warn('[Knowledge] Batch error, retrying...', retryCount + 1, e.message);
      await new Promise(r => setTimeout(r, 1000));
      return processClusteringBatch(batchAtoms, existingClusters, promptTemplate, apiConfig, retryCount + 1);
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

// 知识聚类：将未归簇的原子智能分组（支持分批处理）
async function autoClusterAtoms() {
  try {
    const unclustered = knowledgeStore.getAtoms({ unclustered: true });
    if (unclustered.length < 3) {
      console.log('[Knowledge] Too few unclustered atoms for clustering:', unclustered.length);
      return {
        clustersCreated: 0,
        atomsAssigned: 0,
        message: unclustered.length === 0
          ? '没有待聚类的知识原子，所有原子都已归入知识簇'
          : `待聚类原子仅 ${unclustered.length} 个，至少需要 3 个才能进行智能聚类`
      };
    }

    clusteringAborted = false;
    const apiConfig = getAPIConfig();
    console.log('[Knowledge] autoClusterAtoms starting:', {
      unclusteredCount: unclustered.length,
      apiKey: apiConfig.apiKey ? `${apiConfig.apiKey.substring(0, 8)}...` : 'MISSING',
      baseUrl: apiConfig.baseUrl,
      model: apiConfig.model
    });
    const promptTemplate = loadClusteringPromptTemplate();
    const existingClusters = knowledgeStore.getClusters();

    let totalClustersCreated = 0;
    let totalAtomsAssigned = 0;
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

      const result = await processClusteringBatch(unclustered, existingClusters, promptTemplate, apiConfig);

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

        const result = await processClusteringBatch(batch, currentClusters, promptTemplate, apiConfig);

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

    const apiConfig = getAPIConfig();
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

    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 3000
      })
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

    const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');

    console.log('[Knowledge] Calling ADP for recommendation, url:', httpUrl, 'appKey source:', appKeySource, 'appKey:', appKey.substring(0, 10) + '...', 'query:', query.substring(0, 60));

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
ipcMain.handle('knowledge:search-adp', async (event, { query, intent, conversationId }) => {
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

  try {
    const https = require('https');
    const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');

    const response = await fetch(httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
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
    return { success: false, error: error.message, conversationId: convId };
  }
});

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
      baseUrl = getSetting('base_url') || DEFAULT_BASE_URL;
      model = getSetting('model') || DEFAULT_MODEL;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: '你是一个关键词提取专家。从用户的语义化搜索语句中提取出唯一的核心关键词。只输出1个核心关键词，不超过7个字，不要有其他内容。去除虚词、语气词和修饰语，保留最能代表搜索意图的核心词。例如："如何优化数据库查询性能" → "数据库"，"最近在研究的前端框架有什么推荐" → "前端框架"，"React中useState的使用方法" → "useState"，"机器学习中的梯度下降算法" → "梯度下降"'
          },
          {
            role: 'user',
            content: query
          }
        ],
        max_tokens: 100,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(8000)
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
    const apiConfig = getAPIConfig();
    if (!apiConfig.apiKey) return { success: false, error: '请先配置 AI API Key' };

    const profile = loadProfile();
    const systemPrompt = `你是忆境 Memora 的画像解析 AI。从用户文本中提取结构化信息，输出严格JSON：
{
  "persons": [{"name":"姓名","relation":"关系","company":"公司","responsibilities":"职责"}],
  "projects": [{"name":"项目名","alias":["别名"],"status":"active/paused/completed","description":"描述"}],
  "industries": ["行业"],
  "regions": ["区域"]
}
规则：提取所有人物并推断关系(领导/同事/下属/客户/合作伙伴)；项目状态根据描述推断；只输出JSON，不输出markdown。内容尽量精简，name和description要简短。`;

    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.1,
        max_tokens: 8192
      })
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
      if (!dirConfig) continue;
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
      version: '2.1.0',
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