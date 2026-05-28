const { app, BrowserWindow, ipcMain, clipboard, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');

let mainWindow;
let tray;
let clipboardWatcher;
let lastClipboardText = '';
let isAnalyzing = false; // 防止并发分析
let processedClipboardHashes = new Set();
const MAX_CLIPBOARD_HASHES = 500; // 限制哈希记录数量防止内存膨胀

// 数据库层（lowdb）
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

// 记忆系统
const { MemoryStore, MEMORY_TYPES, MEMORY_CATEGORIES } = require('./src/scripts/memory');
let memoryStore;

// 记事本系统
const { Notebook } = require('./src/scripts/notebook');
let notebook;

// Prompt 引擎
const PromptEngine = require('./src/scripts/promptEngine');
const promptEngine = new PromptEngine();

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

只有满足以下条件才识别为任务：
1. 存在明确行动（如：发送、完成、回复、处理、联系等）
2. 存在未来时间或隐含待办
3. 用户可能希望被提醒

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
  "reason": "包含明确行动和时间"
}

如果不是任务：
{
  "is_task": false,
  "confidence": 0.95,
  "reason": "只是普通聊天"
}

规则：
- title要简短，不超过20字
- 不要虚构时间
- 时间不明确时normalized为null
- confidence必须0~1之间
- 只输出JSON，不要有其他内容

示例1（输入）：明天下午三点提醒我给客户发合同
示例1（输出）：{"is_task":true,"confidence":0.98,"title":"给客户发合同","description":"提醒用户给客户发送合同","time":{"raw":"明天下午三点","normalized":null,"is_all_day":false},"priority":"high","tags":["工作"],"reason":"存在明确行动与具体时间"}

示例2（输入）：下周找房东续租
示例2（输出）：{"is_task":true,"confidence":0.91,"title":"联系房东续租","description":"用户需要处理续租事项","time":{"raw":"下周","normalized":null,"is_all_day":false},"priority":"medium","tags":["生活"],"reason":"存在未来待办事项"}

示例3（输入）：特朗普访问中国可能利好稀土板块
示例3（输出）：{"is_task":false,"confidence":0.96,"reason":"新闻观点，不是用户待办"}

示例4（输入）：周五之前把PPT做完
示例4（输出）：{"is_task":true,"confidence":0.97,"title":"完成PPT","description":"用户需要在周五前完成PPT","time":{"raw":"周五之前","normalized":null,"is_all_day":false},"priority":"high","tags":["工作"],"reason":"明确待办和截止时间"}

示例5（输入）：下午有2份PPT：1、我们专场：ADP 4.0升级+demo+跨行业案例 2、katy行业专场：ADP 4.0升级+demo+零售+四部案例
示例5（输出）：{"is_task":true,"confidence":0.95,"title":"准备2份PPT材料","description":"下午需要准备两份PPT：我们专场和katy行业专场","time":{"raw":"下午","normalized":null,"is_all_day":false},"priority":"high","tags":["工作","PPT"],"reason":"包含明确待办事项"}

示例6（输入）：【工作流】代码节点图片URL无法传递到大模型节点视觉输入
示例6（输出）：{"is_task":true,"confidence":0.93,"title":"处理工作流图片URL问题","description":"工作流问题：代码节点图片URL无法传递到大模型节点视觉输入","time":{"raw":null,"normalized":null,"is_all_day":false},"priority":"high","tags":["工作","技术"],"reason":"问题反馈类待办事项"}`;

// 获取当前使用的Prompt（从设置或默认）
function getCurrentAIPrompt() {
  if (db) {
    const settings = db.getSettings();
    return settings.ai_prompt || DEFAULT_AI_PROMPT;
  }
  return getSetting('ai_prompt') || DEFAULT_AI_PROMPT;
}

// 获取当前使用的记忆提取Prompt（从设置或默认）
function getCurrentMemoryPrompt() {
  if (db) {
    const settings = db.getSettings();
    return settings.memory_prompt || DEFAULT_MEMORY_EXTRACTION_PROMPT;
  }
  return getSetting('memory_prompt') || DEFAULT_MEMORY_EXTRACTION_PROMPT;
}

// 智能过滤配置
const FILTER_CONFIG = {
  maxLength: 500, // 最大字数限制
  confidenceThreshold: 0.9, // 自动弹出建议的置信度阈值
  lowConfidenceThreshold: 0.7, // 静默候选的置信度阈值
  
  // 黑名单关键词（优先过滤）
  blacklistPatterns: [
    /^https?:\/\//i, // URL链接
    /^SELECT\s+/i, // SQL查询
    /^Error:/i, // 错误信息
    /^{.*}$/, // JSON对象
    /^function\s+/i, // 函数定义
    /^const\s+/i, // 常量定义
    /^let\s+/i, // 变量定义
    /^var\s+/i, // 变量定义
    /^import\s+/i, // 导入语句
    /^export\s+/i, // 导出语句
    /^def\s+/i, // Python函数
    /^class\s+/i, // 类定义
    /^public\s+/i, // Java/C#修饰符
    /^private\s+/i, // Java/C#修饰符
    /^\/\/.*$/, // 注释
    /^#.*$/, // 注释
    /^```/, // 代码块
    /^\d{6,}/, // 长数字（股票代码等）
    /^0x[0-9a-fA-F]+$/, // 十六进制
    /^[\w-]+\.[\w-]+$/ // 域名
  ],
  
  // 白名单关键词（更可能是任务）
  whitelistPatterns: [
    /提醒/i,
    /记得/i,
    /需要/i,
    /应该/i,
    /必须/i,
    /完成/i,
    /发送/i,
    /回复/i,
    /处理/i,
    /联系/i,
    /预约/i,
    /安排/i,
    /准备/i,
    /整理/i,
    /编写/i,
    /修改/i,
    /提交/i,
    /审核/i,
    /审批/i,
    /跟进/i,
    /汇报/i,
    /开会/i,
    /会议/i,
    /周五之前/i,
    /明天/i,
    /今天/i,
    /下周/i,
    /月底/i,
    /年底/i,
    /【工作流】/i,
    /【任务】/i,
    /【待办】/i
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
  
  // 4. 检查是否看起来像任务（白名单匹配）
  let hasWhitelistMatch = false;
  for (const pattern of FILTER_CONFIG.whitelistPatterns) {
    if (pattern.test(text)) {
      hasWhitelistMatch = true;
      break;
    }
  }
  
  // 如果没有匹配任何白名单关键词，可能是普通文本
  if (!hasWhitelistMatch) {
    return { 
      shouldAnalyze: false, 
      reason: '未匹配任务相关关键词，跳过分析以节省token' 
    };
  }
  
  return { shouldAnalyze: true, reason: '通过预分类' };
}

function createWindow() {
  const iconPath = path.join(__dirname, 'resources', 'icon.png');
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
  const iconPath = path.join(__dirname, 'resources', 'icon.png');
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
    { label: '显示主窗口', click: () => mainWindow.show() },
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
    mainWindow.show();
  });
}

function startClipboardWatcher() {
  console.log('[Clipboard] Starting clipboard watcher...');
  clipboardWatcher = setInterval(() => {
    try {
      const currentText = clipboard.readText();
      if (currentText && currentText !== lastClipboardText) {
        console.log('[Clipboard] Detected change:', currentText.substring(0, 50));
        lastClipboardText = currentText;
        analyzeClipboardText(currentText);
      }
    } catch (e) {
      console.error('[Clipboard] Error reading clipboard:', e);
    }
  }, 10000);
}

// 获取剪切板内容的哈希值用于去重
function getClipboardHash(text) {
  return text.trim().toLowerCase().hashCode();
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

// 简单的哈希函数
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
      // 保存到记事本
      if (notebook) {
        notebook.addNote({
          content: text,
          category: 'general',
          analyzed: false,
          analysis: {
            reason: preResult.reason
          }
        });
        console.log('[Notebook] Clipboard content saved (pre-classification rejected)');
        
        // 通知前端有新笔记
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('new-note-added', {
            source: 'clipboard',
            title: text.substring(0, 30)
          });
        }
      }
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
        });
      }
      isAnalyzing = false;
      return;
    }
    
    // 获取API配置
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
            content: getCurrentAIPrompt()
          },
          {
            role: 'user',
            content: `分析以下文本是否包含待办事项：\n\n${text}`
          }
        ]
      })
    });

    if (!response.ok) {
      console.error('[AI] API response not OK:', response.status);
      // 保存到记忆系统
      if (memoryStore) {
        memoryStore.addMemory({
          type: MEMORY_TYPES.SHORT,
          category: MEMORY_CATEGORIES.CLIPBOARD,
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
        result = JSON.parse(data.choices[0].message.content);
        analysisResult = result;
        confidence = result.confidence || 0;
        isTask = result.is_task || false;
        taskTitle = result.title || null;
      } catch (e) {
        console.error('[AI] Failed to parse response:', e);
        // 保存到记忆系统
        if (memoryStore) {
          memoryStore.addMemory({
            type: MEMORY_TYPES.SHORT,
            category: MEMORY_CATEGORIES.CLIPBOARD,
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
      
      // 保存到记事本（所有剪切板内容都保存）
      if (notebook) {
        notebook.addNote({
          content: text,
          category: result.is_task ? 'feedback' : 'general',
          analyzed: true,
          analysis: {
            isTask: result.is_task,
            taskTitle: result.title,
            taskPriority: result.priority,
            tags: result.tags,
            reason: result.reason,
            time: result.time,
            description: result.description,
            confidence: confidence
          }
        });
        console.log('[Notebook] Clipboard content saved to notebook');
        
        // 通知前端有新笔记（用于角标计数）
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('new-note-added', {
            source: 'clipboard',
            title: result.title || text.substring(0, 30)
          });
        }
      }
      
      // 提取结构化记忆（只保存提炼后的信息）
      if (memoryStore && (result.is_task || confidence >= 0.7)) {
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
              const memoryResult = JSON.parse(memoryData.choices[0].message.content);
              
              // 根据提取的信息类型保存到记忆系统
              const memoryType = memoryResult.memory_type === 'instant' ? MEMORY_TYPES.INSTANT :
                                memoryResult.memory_type === 'long' ? MEMORY_TYPES.LONG : MEMORY_TYPES.SHORT;
              
              memoryStore.addMemory({
                type: memoryType,
                category: memoryResult.category || MEMORY_CATEGORIES.KNOWLEDGE,
                content: memoryResult.summary || text.substring(0, 100),
                metadata: {
                  persons: memoryResult.persons || [],
                  topics: memoryResult.topics || [],
                  keyPoints: memoryResult.key_points || [],
                  sentiment: memoryResult.sentiment || 'neutral',
                  entities: memoryResult.entities || [],
                  originalNoteId: null, // 关联到记事本
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
      
      if (result.is_task && confidence >= FILTER_CONFIG.confidenceThreshold) {
        // 高置信度：自动弹出建议
        console.log('[AI] High confidence task detected:', result.title, 'confidence:', confidence);
        mainWindow.webContents.send('clipboard-task-detected', {
          rawText: text,
          task: {
            title: result.title,
            description: result.description,
            dueDate: result.time?.normalized ? new Date(result.time.normalized).toISOString() : null,
            priority: result.priority || 'medium',
            estimatedDuration: 60,
            tags: result.tags || [],
            confidence: confidence,
            reason: result.reason
          }
        });
      } else if (result.is_task && confidence >= FILTER_CONFIG.lowConfidenceThreshold) {
        // 中等置信度：静默加入候选
        console.log('[AI] Medium confidence task, adding to candidates:', result.title, 'confidence:', confidence);
        // 发送到前端显示（调试期）
        mainWindow.webContents.send('clipboard-candidate-detected', {
          rawText: text,
          task: {
            title: result.title,
            description: result.description,
            priority: result.priority || 'medium',
            confidence: confidence,
            reason: result.reason
          }
        });
      } else {
        console.log('[AI] No task or low confidence:', result.reason || 'confidence too low');
        // 低置信度内容只保存到记事本，不提取记忆
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
      icon: path.join(__dirname, 'resources', 'icon.png'),
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
            content: `分析以下文本是否包含待办事项：\n\n${text}`
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
必须**同时满足**：
1. 有**明确行动动词**：发送、完成、回复、处理、联系、准备、提交、修复、跟进等
2. 有**未来时间 / 隐含待办**（明天、下周、周五之前、后续、需要、记得等）
3. 属于**需要执行/跟进/提醒**的事项

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
- 遇到 **@朱从坤 / @Dean** → **is_valid_info=true**，并优先视为待办`;

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
    isCustomKey: config.isCustomKey
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
ipcMain.handle('get-adp-config', async () => {
  return {
    appKey: getSetting('adp_app_key') || '',
    url: getSetting('adp_url') || 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
    agentName: getSetting('adp_agent_name') || '我的AI助手'
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
  return { success: true };
});

ipcMain.handle('clear-adp-config', async () => {
  setSetting('adp_app_key', '');
  setSetting('adp_url', '');
  setSetting('adp_agent_name', '');
  return { success: true };
});

// ADP消息发送（主进程处理，使用WebSocket协议）
ipcMain.handle('send-adp-message', async (event, message) => {
  const appKey = getSetting('adp_app_key');
  const url = getSetting('adp_url') || 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  
  console.log('[ADP Main] send-adp-message called');
  console.log('[ADP Main] appKey exists:', !!appKey);
  console.log('[ADP Main] URL:', url);
  console.log('[ADP Main] Message:', message);
  
  if (!appKey || appKey.trim() === '') {
    console.error('[ADP Main] AppKey not configured');
    return { success: false, error: '请先配置ADP AppKey' };
  }
  
  // 将https转换为wss协议
  const wsUrl = url.replace(/^https?:\/\//, 'wss://');
  console.log('[ADP Main] WebSocket URL:', wsUrl);
  
  const requestBody = {
    RequestId: Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join(''),
    ConversationId: Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join(''),
    AppKey: appKey.trim(),
    VisitorId: Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join(''),
    Contents: [{ Type: 'text', Text: message }],
    Incremental: true,
    Stream: 'enable',
    StreamingThrottle: 5,
  };
  
  console.log('[ADP Main] Request body:', JSON.stringify(requestBody, null, 2));
  
  try {
    const WebSocket = require('ws');
    
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let fullText = '';
      let timeout = null;
      
      console.log('[ADP Main] WebSocket connecting...');
      
      ws.on('open', () => {
        console.log('[ADP Main] WebSocket connected');
        ws.send(JSON.stringify(requestBody));
        console.log('[ADP Main] Request sent');
        
        // 设置超时时间（60秒）
        timeout = setTimeout(() => {
          console.error('[ADP Main] Request timeout');
          ws.close();
          reject({ success: false, error: '请求超时' });
        }, 60000);
      });
      
      ws.on('message', (data) => {
        const messageStr = data.toString();
        console.log('[ADP Main] Message received:', messageStr.substring(0, 300));
        
        try {
          const parsed = JSON.parse(messageStr);
          
          if (parsed.event === 'message.added' && parsed.content?.text) {
            fullText += parsed.content.text;
            console.log('[ADP Main] Text received:', parsed.content.text);
          } else if (parsed.event === 'text.delta' && parsed.content?.text) {
            fullText += parsed.content.text;
            console.log('[ADP Main] Delta received:', parsed.content.text);
          } else if (parsed.event === 'message.finish' || parsed.event === 'response.completed') {
            console.log('[ADP Main] Message finished');
            clearTimeout(timeout);
            ws.close();
          } else if (parsed.error) {
            console.error('[ADP Main] Error:', parsed.error);
            clearTimeout(timeout);
            ws.close();
            reject({ success: false, error: parsed.error });
          }
        } catch (e) {
          console.error('[ADP Main] Parse error:', e);
        }
      });
      
      ws.on('error', (error) => {
        console.error('[ADP Main] WebSocket error:', error);
        clearTimeout(timeout);
        reject({ success: false, error: error.message });
      });
      
      ws.on('close', () => {
        console.log('[ADP Main] WebSocket closed');
        clearTimeout(timeout);
        resolve({ success: true, content: fullText });
      });
    });
  } catch (error) {
    console.error('[ADP Main] Error:', error);
    return { success: false, error: error.message };
  }
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

// ========== 记事本相关IPC处理器 ==========

ipcMain.handle('notebook-add-note', async (event, note) => {
  if (!notebook) return { success: false };
  const result = notebook.addNote(note);
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
  return { success: result !== null, note: result };
});

ipcMain.handle('notebook-delete-note', async (event, id) => {
  if (!notebook) return { success: false };
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

// ========== 记忆提取Prompt配置 ==========

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
    
    const prompt = getSetting('memory_prompt', DEFAULT_MEMORY_EXTRACTION_PROMPT);
    
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
        memoryStore.addMemory({
          type: result.memory_type || 'short',
          category: result.category || 'knowledge',
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

app.whenReady().then(() => {
  console.log('[App] Starting 忆境 Memora...');
  
  // 初始化数据库层（同步）
  db = new Database(app.getPath('userData'));
  db.init();
  console.log('[Database] Database initialized');
  
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
  
  // 初始化反馈系统
  feedbackLogger = new FeedbackLogger();
  console.log('[Feedback] Feedback logger initialized');
  
  createWindow();
  console.log('[App] Window created');
  createTray();
  console.log('[App] Tray created');
  startClipboardWatcher();
  console.log('[App] Clipboard watcher started');
  
  // 自动备份（每天凌晨3点）
  startAutoBackup();
  console.log('[App] Auto backup scheduled');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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
  if (clipboardWatcher) {
    clearInterval(clipboardWatcher);
  }
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
  }
  // 保存数据库
  if (db) {
    db.save().catch(e => console.error('[Database] Save on quit failed:', e));
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
  const iconPath = path.join(__dirname, 'resources', 'icon.png');
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

ipcMain.handle('agent:invoke', async (event, { query, agentType }) => {
  try {
    const apiConfig = getAPIConfig();
    if (!canMakeAICall()) return { success: false, error: '每日调用次数已达上限' };

    const profilePath = path.join(app.getPath('userData'), 'profile.json');
    let profile = getDefaultProfile();
    try { if (fs.existsSync(profilePath)) profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')); } catch (e) {}

    let intent = agentType || await classifyIntent(query);
    const context = await retrieveContext(query, intent);

    const promptBuilders = { priority: buildPriorityPrompt, knowledge: buildKnowledgePrompt, memory: buildMemoryPrompt, report: buildReportPrompt };
    const systemPrompt = (promptBuilders[intent] || buildChatPrompt)(profile, context);

    const traceId = feedbackLogger.newTraceId();
    const startTs = Date.now();

    const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
      body: JSON.stringify({ model: apiConfig.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: query }], temperature: 0.5, response_format: { type: 'json_object' } })
    });

    if (!response.ok) return { success: false, error: 'AI调用失败' };
    incrementAICallCount();

    const data = await response.json();
    let aiContent = data.choices?.[0]?.message?.content || '';

    feedbackLogger.recordTrace({ trace_id: traceId, ts: new Date(startTs).toISOString(), module: `agent_${intent}`, model: apiConfig.model, input: { text: query }, output: aiContent, latency_ms: Date.now() - startTs });

    let parsed; try { parsed = JSON.parse(aiContent); } catch { parsed = null; }
    return { success: true, agentType: intent, traceId, result: parsed || { text: aiContent } };
  } catch (error) { return { success: false, error: error.message }; }
});

async function classifyIntent(query) {
  const q = query.toLowerCase();
  if (/今天|今日|重点|优先|排程|日程|先做|重要/.test(q)) return 'priority';
  if (/整理|梳理|归类|合并|笔记|知识/.test(q)) return 'knowledge';
  if (/记忆|记住|忘了|回忆|提取/.test(q)) return 'memory';
  if (/日报|周报|总结|汇报|完成/.test(q)) return 'report';
  return 'chat';
}

async function retrieveContext(query) {
  const ctx = { tasks: null, memories: [], notes: [] };
  try { if (db?.db?.data?.tasks) { const t = db.db.data.tasks; ctx.tasks = { pending: t.filter(x => x.status !== 'completed').slice(0,20), completed: t.filter(x => x.status === 'completed').slice(0,10), total: t.length }; } } catch (e) {}
  try { if (memoryStore) ctx.memories = memoryStore.searchRelated(query, 5).map(m => ({ content: m.content, type: m.type, category: m.category })); } catch (e) {}
  try { if (notebook) ctx.notes = notebook.searchNotes(query).slice(0,5).map(n => ({ title: n.title, content: n.content.substring(0,200), category: n.category })); } catch (e) {}
  return ctx;
}

function buildChatPrompt(profile, ctx) {
  const name = profile.user?.name || '用户';
  let extra = '';
  if (ctx.memories?.length) extra += `\n# 相关记忆\n${ctx.memories.map(m => `- [${m.type}] ${m.content}`).join('\n')}`;
  if (ctx.tasks?.pending?.length) extra += `\n# 待办(${ctx.tasks.pending.length}条)\n${ctx.tasks.pending.slice(0,10).map(t => `- ${t.title}(${t.priority})`).join('\n')}`;
  return `你是「忆境 Memora」AI助手，服务${name}。简洁实用、可操作、中文回答。${extra}`;
}

function buildPriorityPrompt(profile, ctx) {
  const tasks = ctx.tasks?.pending || [];
  return `你是${profile.user?.name}的优先级规划Agent。\n时间：${new Date().toLocaleString('zh-CN')}\n# 待排程(${tasks.length}条)\n${tasks.slice(0,20).map((t,i) => `[${i+1}] ${t.title}|${t.priority}|截止:${t.dueDate||'无'}`).join('\n')||'暂无'}\n输出JSON：{today_top5:[{task_index:1,scheduled_at:"09:30-10:30",reason:"..."}],highlight:"...",deferred:[],tips:["..."]}`;
}

function buildKnowledgePrompt(profile, ctx) {
  return `你是${profile.user?.name}的知识梳理Agent。\n# 近期笔记\n${(ctx.notes||[]).map((n,i)=>`[${i+1}][${n.category}]${n.title}:${n.content}`).join('\n')||'暂无'}\n输出JSON：{clusters:[{theme:"...",note_indices:[],summary:"..."}],duplicates:[],insights:["..."],actions:[]}`;
}

function buildMemoryPrompt(profile, ctx) {
  return `你是${profile.user?.name}的记忆整理Agent。\n# 相关记忆\n${(ctx.memories||[]).map((m,i)=>`[${i+1}][${m.type}]${m.content}`).join('\n')||'暂无'}\n输出JSON：{promote:[],demote:[],expire:[],merge:[],insights:["..."]}`;
}

function buildReportPrompt(profile, ctx) {
  const c = ctx.tasks?.completed||[], p = ctx.tasks?.pending||[];
  return `你是${profile.user?.name}的日报Agent。\n已完成(${c.length}): ${c.slice(0,10).map(t=>t.title).join('、')||'无'}\n待办(${p.length}): ${p.slice(0,10).map(t=>t.title+'('+t.priority+')').join('、')||'无'}\n输出JSON：{title:"📅 日报",completed_section:{items:[...]},pending_section:{items:[...]},insights:{items:[...]},tomorrow_plan:{items:[...]},summary:"..."}`;
}