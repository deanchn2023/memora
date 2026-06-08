/**
 * Memora 国际化模块 (i18n)
 * 支持：中文(zh)、英文(en)
 * 
 * 双模式运行：
 * - 浏览器（渲染进程）：创建全局实例 window.i18n
 * - Node.js（主进程）：导出静态 I18n 模块供 main.js 使用
 */

const translations = {
  zh: {
    // 导航栏
    'nav.calendar': '日历',
    'nav.notebook': '记事本',
    'nav.documents': '文档',
    'nav.knowledge': '知识',
    'nav.insight': '洞察',
    'nav.today': '今天',
    'nav.month': '月视图',

    // 头部按钮
    'header.aiAssistant': 'AI助手',
    'header.settings': '设置',
    'header.notification': '通知',
    'header.login': '登录',

    // 通知面板
    'notification.title': '通知',
    'notification.markAllRead': '全部已读',
    'notification.empty': '暂无通知',

    // 番茄钟
    'pomodoro.title': '番茄钟',
    'pomodoro.start': '开始',
    'pomodoro.reset': '重置',
    'pomodoro.currentTask': '当前任务:',
    'pomodoro.noTask': '无',
    'pomodoro.pause': '暂停',
    'pomodoro.resume': '继续',

    // 待办列表
    'task.title': '待办列表',
    'task.add': '添加任务',
    'task.empty': '暂无任务',
    'task.overdue': '已过期',
    'task.today': '今天',
    'task.tomorrow': '明天',
    'task.completed': '已完成',
    'task.delete': '删除',
    'task.edit': '编辑',

    // 记事本
    'notebook.title': '记事本',
    'notebook.addNote': '新建笔记',
    'notebook.empty': '暂无笔记',
    'notebook.allNotes': '全部',
    'notebook.search': '搜索笔记...',
    'notebook.sidebar.categories': '分类',
    'notebook.sidebar.stats': '统计',
    'notebook.stats.total': '总笔记',
    'notebook.stats.analyzed': '已分析',
    'notebook.category.add': '＋ 新增分类',
    'notebook.category.edit': '重命名',
    'notebook.category.delete': '删除',
    'notebook.category.meeting': '会议记录',
    'notebook.category.feedback': '问题反馈',
    'notebook.category.task': '待办任务',
    'notebook.category.idea': '想法创意',
    'notebook.category.general': '其他',

    // 文档
    'documents.title': '文档中心',
    'documents.online': '在线文档',
    'documents.local': '本地文件',
    'documents.empty': '暂无文档',

    // 知识
    'knowledge.title': '知识跟随',
    'knowledge.search': '搜索知识...',
    'knowledge.graph': '图谱',
    'knowledge.articles': '文章',
    'knowledge.questions': '问题',
    'knowledge.searchTab': '搜索',

    // AI 助手
    'ai.title': 'AI 助手',
    'ai.placeholder': '输入消息，Shift+Enter 换行...',
    'ai.send': '发送',
    'ai.thinking': '思考中...',
    'ai.mode.agent': '🤖 Agent',
    'ai.mode.llm': '💬 LLM',

    // 设置
    'settings.title': '设置',
    'settings.save': '保存设置',
    'settings.tab.llm': 'LLM',
    'settings.tab.agent': 'Agent',
    'settings.tab.profile': '画像',
    'settings.tab.backup': '备份',
    'settings.tab.prompts': 'Prompt',
    'settings.tab.memory': '记忆',
    'settings.tab.appearance': '外观',
    'settings.tab.login': '组织登录',
    'settings.tab.server': '服务器配置',
    'settings.tab.about': '关于',

    // 数据管理
    'data.export': '一键导出全部数据',
    'data.import': '选择文件并导入',
    'data.exportPassword': '加密密码',
    'data.exportPasswordConfirm': '确认密码',
    'data.importPassword': '解密密码',

    // 登录
    'login.title': '组织登录',
    'login.email': '邮箱',
    'login.password': '密码',
    'login.submit': '登 录',
    'login.logout': '退出登录',
    'login.remember': '记住登录',

    // 记忆
    'memory.title': '记忆管理',
    'memory.empty': '暂无记忆',
    'memory.add': '添加记忆',
    'memory.search': '搜索记忆...',

    // 通用
    'common.confirm': '确认',
    'common.cancel': '取消',
    'common.delete': '删除',
    'common.edit': '编辑',
    'common.save': '保存',
    'common.close': '关闭',
    'common.loading': '加载中...',
    'common.success': '操作成功',
    'common.error': '操作失败',
    'common.noData': '暂无数据',
    'common.search': '搜索',
    'common.empty': '暂无内容',
    'common.deleteConfirm': '确认删除？此操作不可撤销',
    'common.added': '已添加',
    'common.deleted': '已删除',
    'common.saved': '已保存',

    // 日期
    'date.year': '年',
    'date.month': '月',
    'date.day': '日',
    'date.monday': '周一',
    'date.tuesday': '周二',
    'date.wednesday': '周三',
    'date.thursday': '周四',
    'date.friday': '周五',
    'date.saturday': '周六',
    'date.sunday': '周日',

    // 语言
    'lang.label': '中',
    'lang.zh': '中文',
    'lang.en': 'English',

    // 关于
    'about.description': 'AI 驱动的个人记忆与知识管理助手 — 感知、沉淀、理解、反馈、进化，让每一天的想法与知识都有迹可循。',
    'about.features': '✨ 核心特色',
    'about.feature.memory': '智能记忆',
    'about.feature.memory.desc': '五层架构自动沉淀，瞬时/短期/长期记忆智能分级',
    'about.feature.graph': '知识图谱',
    'about.feature.graph.desc': '力导向可视化 + Graph RAG，实体关系一目了然',
    'about.feature.knowledge': '知识跟随',
    'about.feature.knowledge.desc': '智能搜索、聚类分析、知识萃取，多维知识发现',
    'about.feature.ai': 'AI 助手',
    'about.feature.ai.desc': 'ADP 智能体驱动，五大 AppKey 专业分工，对话即服务',
    'about.feature.clipboard': '剪贴板监控',
    'about.feature.clipboard.desc': '智能检测 + 暂存聚合 + 动态频率，内容自动入库',
    'about.feature.org': '组织协作',
    'about.feature.org.desc': '云端配置同步 + 五大 AppKey 独立管控 + 权限管理',
    'about.changelog': '📋 版本说明',
    'about.v220.f1': '统一知识图谱 — sql.js 存储 + Canvas 力导向图 + 知识体检 + Graph RAG',
    'about.v220.f2': '知识聚类分析 — 自动分组相似内容，主题发现与智能归类',
    'about.v220.f3': '知识蒸馏系统 — 从文档中萃取核心知识点，结构化沉淀',
    'about.v220.f4': '剪贴板智能监控 v2 — 暂存聚合 + 动态频率 + 状态检测',
    'about.v220.f5': 'AI 审计日志 — 完整记录所有 AI 调用，可追溯可审查',
    'about.v220.f6': '五大 AppKey 分工 — 通用/知识/搜索/聚类/图谱独立管控',
    'about.v220.f7': '版本更新通知优化 — 右上角卡片式提醒，内容展开查看',
    'about.v230.f1': '洞察视图 — 知识仪表盘 + 记忆分布 + 统计概览',
    'about.v230.f2': '知识活化引擎 — 主动推荐被遗忘的知识，AI 扫描知识缺口',
    'about.v230.f3': '知识演化追踪 — 时间线展示知识的合并、更新、过时事件',
    'about.v230.f4': '知识冲突检测 — 自动发现矛盾信息，一键解决冲突',
    'about.v230.f5': '新增活化/演化/冲突三个 ADP AppKey 通道',
    'about.v230.f6': 'CSP 安全策略升级，支持动态服务器地址',
    'about.v240.f1': '多模态知识库 — 图片/文档/音视频/URL/会议统一管理',
    'about.v240.f2': '知识书本 — AI 自动整理知识体系生成结构化书本',
    'about.v240.f3': '腾讯会议录屏及转译文本处理',
    'about.v240.f4': 'URL 收藏与知识关联',
    'about.v240.f5': 'AI 资产处理 — 自动生成标题/描述/标签',
    'about.v240.f6': '修复仪表盘记忆显示为 0 的问题',
    'about.v210.f1': '全新多主题系统，支持日间/夜间及多彩风格切换',
    'about.v210.f2': '国际化支持，一键切换中/英文界面',
    'about.v210.f3': '文档资源服务器地址动态获取，自适应登录环境',
    'about.v210.f4': '外观设置优化，毛玻璃/光球/悬浮效果独立控制',
    'about.v210.f5': '数据导入支持合并与替换两种模式',
    'about.v210.f6': 'Prompt 自动优化器，历史版本对比与回归测试',
    'about.v200.f1': '五层智能架构：感知 → 沉淀 → 理解 → 反馈 → 进化',
    'about.v200.f2': '组织登录与云端配置同步',
    'about.v200.f3': 'AI 助手 SSE 流式对话与意图识别',
    'about.v200.f4': '知识图谱可视化与智能搜索',
    'about.v200.f5': '记忆管理系统（瞬时/短期/长期）',
    'about.v200.f6': '番茄钟专注计时与任务关联',
    'about.v200.f7': '剪贴板智能检测与自动入库',
  },

  en: {
    // Navigation
    'nav.calendar': 'Calendar',
    'nav.notebook': 'Notes',
    'nav.documents': 'Docs',
    'nav.knowledge': 'Knowledge',
    'nav.insight': 'Insight',
    'nav.today': 'Today',
    'nav.month': 'Month',

    // Header buttons
    'header.aiAssistant': 'AI Assistant',
    'header.settings': 'Settings',
    'header.notification': 'Notifications',
    'header.login': 'Login',

    // Notifications
    'notification.title': 'Notifications',
    'notification.markAllRead': 'Mark all read',
    'notification.empty': 'No notifications',

    // Pomodoro
    'pomodoro.title': 'Pomodoro',
    'pomodoro.start': 'Start',
    'pomodoro.reset': 'Reset',
    'pomodoro.currentTask': 'Current task:',
    'pomodoro.noTask': 'None',
    'pomodoro.pause': 'Pause',
    'pomodoro.resume': 'Resume',

    // Tasks
    'task.title': 'Tasks',
    'task.add': 'Add task',
    'task.empty': 'No tasks',
    'task.overdue': 'Overdue',
    'task.today': 'Today',
    'task.tomorrow': 'Tomorrow',
    'task.completed': 'Completed',
    'task.delete': 'Delete',
    'task.edit': 'Edit',

    // Notebook
    'notebook.title': 'Notes',
    'notebook.addNote': 'New note',
    'notebook.empty': 'No notes',
    'notebook.allNotes': 'All',
    'notebook.search': 'Search notes...',
    'notebook.sidebar.categories': 'Categories',
    'notebook.sidebar.stats': 'Stats',
    'notebook.stats.total': 'Total',
    'notebook.stats.analyzed': 'Analyzed',
    'notebook.category.add': '＋ Add category',
    'notebook.category.edit': 'Rename',
    'notebook.category.delete': 'Delete',
    'notebook.category.meeting': 'Meeting',
    'notebook.category.feedback': 'Feedback',
    'notebook.category.task': 'Tasks',
    'notebook.category.idea': 'Ideas',
    'notebook.category.general': 'Other',

    // Documents
    'documents.title': 'Documents',
    'documents.online': 'Online',
    'documents.local': 'Local Files',
    'documents.empty': 'No documents',

    // Knowledge
    'knowledge.title': 'Knowledge Follow',
    'knowledge.search': 'Search knowledge...',
    'knowledge.graph': 'Graph',
    'knowledge.articles': 'Articles',
    'knowledge.questions': 'Questions',
    'knowledge.searchTab': 'Search',

    // AI Assistant
    'ai.title': 'AI Assistant',
    'ai.placeholder': 'Type a message, Shift+Enter for new line...',
    'ai.send': 'Send',
    'ai.thinking': 'Thinking...',
    'ai.mode.agent': '🤖 Agent',
    'ai.mode.llm': '💬 LLM',

    // Settings
    'settings.title': 'Settings',
    'settings.save': 'Save Settings',
    'settings.tab.llm': 'LLM',
    'settings.tab.agent': 'Agent',
    'settings.tab.profile': 'Profile',
    'settings.tab.backup': 'Backup',
    'settings.tab.prompts': 'Prompt',
    'settings.tab.memory': 'Memory',
    'settings.tab.appearance': 'Appearance',
    'settings.tab.login': 'Org Login',
    'settings.tab.server': 'Server',
    'settings.tab.about': 'About',

    // Data
    'data.export': 'Export All Data',
    'data.import': 'Import from File',
    'data.exportPassword': 'Encryption password',
    'data.exportPasswordConfirm': 'Confirm password',
    'data.importPassword': 'Decryption password',

    // Login
    'login.title': 'Organization Login',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Login',
    'login.logout': 'Logout',
    'login.remember': 'Remember me',

    // Memory
    'memory.title': 'Memories',
    'memory.empty': 'No memories',
    'memory.add': 'Add memory',
    'memory.search': 'Search memories...',

    // Common
    'common.confirm': 'Confirm',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.save': 'Save',
    'common.close': 'Close',
    'common.loading': 'Loading...',
    'common.success': 'Success',
    'common.error': 'Error',
    'common.noData': 'No data',
    'common.search': 'Search',
    'common.empty': 'No content',
    'common.deleteConfirm': 'Confirm delete? This cannot be undone',
    'common.added': 'Added',
    'common.deleted': 'Deleted',
    'common.saved': 'Saved',

    // Date
    'date.year': '',
    'date.month': '',
    'date.day': '',
    'date.monday': 'Mon',
    'date.tuesday': 'Tue',
    'date.wednesday': 'Wed',
    'date.thursday': 'Thu',
    'date.friday': 'Fri',
    'date.saturday': 'Sat',
    'date.sunday': 'Sun',

    // Language
    'lang.label': 'EN',
    'lang.zh': '中文',
    'lang.en': 'English',

    // About
    'about.description': 'AI-powered personal memory & knowledge assistant — Sense, Capture, Understand, Feedback, Evolve. Track every idea and insight.',
    'about.features': '✨ Key Features',
    'about.feature.memory': 'Smart Memory',
    'about.feature.memory.desc': 'Five-layer architecture auto-capture, instant/short/long-term memory grading',
    'about.feature.graph': 'Knowledge Graph',
    'about.feature.graph.desc': 'Force-directed visualization + Graph RAG, entity relationships at a glance',
    'about.feature.knowledge': 'Knowledge Follow',
    'about.feature.knowledge.desc': 'Smart search, clustering analysis, knowledge distillation — multi-dimensional discovery',
    'about.feature.ai': 'AI Assistant',
    'about.feature.ai.desc': 'ADP-powered agent with five specialized AppKeys, conversation as a service',
    'about.feature.clipboard': 'Clipboard Monitor',
    'about.feature.clipboard.desc': 'Smart detection + staging aggregation + dynamic frequency, auto-capture content',
    'about.feature.org': 'Team Collaboration',
    'about.feature.org.desc': 'Cloud config sync + five AppKeys independent management + permissions',
    'about.changelog': '📋 Changelog',
    'about.v220.f1': 'Unified Knowledge Graph — sql.js storage + Canvas force-directed + Knowledge Health + Graph RAG',
    'about.v220.f2': 'Knowledge Clustering — auto-group similar content, topic discovery & smart categorization',
    'about.v220.f3': 'Knowledge Distillation — extract core insights from documents, structured capture',
    'about.v220.f4': 'Smart Clipboard v2 — staging aggregation + dynamic frequency + status detection',
    'about.v220.f5': 'AI Audit Log — full recording of all AI calls, traceable and auditable',
    'about.v220.f6': 'Five AppKeys — General/Knowledge/Search/Clustering/Graph independent management',
    'about.v220.f7': 'Update notification — top-right card-style alert with expandable content',
    'about.v230.f1': 'Insight View — Knowledge dashboard + Memory distribution + Statistics overview',
    'about.v230.f2': 'Knowledge Activation Engine — Proactively recommend forgotten knowledge, AI gap scanning',
    'about.v230.f3': 'Knowledge Evolution Tracking — Timeline showing merge, update, and outdated events',
    'about.v230.f4': 'Knowledge Conflict Detection — Auto-discover contradictions, one-click resolution',
    'about.v230.f5': 'New Activation/Evolution/Conflict ADP AppKey channels',
    'about.v230.f6': 'CSP security upgrade with dynamic server URL support',
    'about.v240.f1': 'Multimodal Knowledge Library — Unified management of images/docs/audio/video/URLs/meetings',
    'about.v240.f2': 'Knowledge Book — AI auto-organizes knowledge into structured books',
    'about.v240.f3': 'Tencent Meeting recording and transcript processing',
    'about.v240.f4': 'URL bookmarking with knowledge association',
    'about.v240.f5': 'AI Asset Processing — Auto-generate titles/descriptions/tags',
    'about.v240.f6': 'Fixed dashboard showing 0 memories bug',
    'about.v210.f1': 'Multi-theme system with light/dark and colorful style switching',
    'about.v210.f2': 'Internationalization support with one-click Chinese/English toggle',
    'about.v210.f3': 'Dynamic document server URL detection, adaptive to login environment',
    'about.v210.f4': 'Appearance settings with independent glass/glow/float effect controls',
    'about.v210.f5': 'Data import supporting both merge and replace modes',
    'about.v210.f6': 'Prompt auto-optimizer with version comparison and regression testing',
    'about.v200.f1': 'Five-layer intelligence: Sense → Capture → Understand → Feedback → Evolve',
    'about.v200.f2': 'Organization login and cloud config synchronization',
    'about.v200.f3': 'AI assistant with SSE streaming and intent recognition',
    'about.v200.f4': 'Knowledge graph visualization and smart search',
    'about.v200.f5': 'Memory management system (instant/short-term/long-term)',
    'about.v200.f6': 'Pomodoro focus timer with task association',
    'about.v200.f7': 'Smart clipboard detection and auto-capture',
  }
};

// ========== 浏览器端：实例化 I18n 类 ==========

class I18n {
  constructor() {
    this._locale = 'zh';
    this._listeners = [];
  }

  get locale() {
    return this._locale;
  }

  /** 获取翻译文本 */
  t(key) {
    return translations[this._locale]?.[key] || translations.zh?.[key] || key;
  }

  /** 切换语言 */
  setLocale(locale) {
    if (this._locale === locale) return;
    this._locale = locale;
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    }
    this._notifyListeners();
    this._persist();
  }

  /** 切换中/英 */
  toggle() {
    this.setLocale(this._locale === 'zh' ? 'en' : 'zh');
  }

  /** 注册语言变化监听 */
  onChange(callback) {
    this._listeners.push(callback);
  }

  /** 通知所有监听器 */
  _notifyListeners() {
    this._listeners.forEach(cb => {
      try { cb(this._locale); } catch (e) { console.warn('[i18n] Listener error:', e); }
    });
  }

  /** 持久化语言偏好 */
  _persist() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('memora_locale', this._locale);
      }
    } catch (e) { /* ignore */ }
  }

  /** 从持久化恢复语言偏好 */
  restore() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('memora_locale');
        if (saved && translations[saved]) {
          this._locale = saved;
          if (typeof document !== 'undefined') {
            document.documentElement.lang = saved === 'zh' ? 'zh-CN' : 'en';
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  /** 格式化日期（根据语言） */
  formatDate(date) {
    if (this._locale === 'zh') {
      return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  /** 格式化相对时间 */
  relativeTime(date) {
    const now = Date.now();
    const diff = now - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (this._locale === 'zh') {
      if (seconds < 60) return '刚刚';
      if (minutes < 60) return `${minutes}分钟前`;
      if (hours < 24) return `${hours}小时前`;
      if (days < 30) return `${days}天前`;
      return `${Math.floor(days / 30)}个月前`;
    } else {
      if (seconds < 60) return 'just now';
      if (minutes < 60) return `${minutes}m ago`;
      if (hours < 24) return `${hours}h ago`;
      if (days < 30) return `${days}d ago`;
      return `${Math.floor(days / 30)}mo ago`;
    }
  }
}

// ========== Node.js 主进程：静态模块导出 ==========

// 检测是否在 Node.js 环境
const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node;

if (isNode) {
  // 主进程模式：导出静态 I18n 模块
  let _currentLocale = 'zh-CN';

  const I18nStatic = {
    translations: translations,

    init(locale) {
      _currentLocale = locale || 'zh-CN';
      return true;
    },

    t(key, params) {
      const lang = _currentLocale.startsWith('zh') ? 'zh' : 'en';
      return translations[lang]?.[key] || translations.zh?.[key] || key;
    },

    getLocale() {
      return _currentLocale;
    },

    setLocale(locale) {
      _currentLocale = locale;
      return true;
    }
  };

  module.exports = { I18n: I18nStatic };
} else {
  // 浏览器模式：创建全局单例
  const i18n = new I18n();
  window.i18n = i18n;
}
