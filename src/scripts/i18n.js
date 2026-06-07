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
    'about.description': 'AI 驱动的个人记忆与事项管理助手，让每一天的想法、任务和知识都有迹可循。',
    'about.features': '✨ 核心特色',
    'about.feature.memory': '智能记忆',
    'about.feature.memory.desc': '自动沉淀对话、笔记与知识，构建专属记忆图谱',
    'about.feature.schedule': '日程管理',
    'about.feature.schedule.desc': '日历视图整合待办与番茄钟，高效掌控时间',
    'about.feature.knowledge': '知识跟随',
    'about.feature.knowledge.desc': '智能搜索与推荐，知识图谱实时追踪关联',
    'about.feature.ai': 'AI 助手',
    'about.feature.ai.desc': '基于 ADP 智能体，对话即服务，任务识别自动化',
    'about.feature.profile': '用户画像',
    'about.feature.profile.desc': '个性化偏好与人物关系，AI 越用越懂你',
    'about.feature.org': '组织协作',
    'about.feature.org.desc': '云端配置同步，团队知识共享与权限管理',
    'about.changelog': '📋 版本说明',
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
    'about.description': 'AI-powered personal memory and task management assistant. Track every idea, task, and insight.',
    'about.features': '✨ Key Features',
    'about.feature.memory': 'Smart Memory',
    'about.feature.memory.desc': 'Auto-capture conversations, notes & knowledge into a personal memory graph',
    'about.feature.schedule': 'Schedule',
    'about.feature.schedule.desc': 'Calendar view with tasks and Pomodoro timer for time management',
    'about.feature.knowledge': 'Knowledge Follow',
    'about.feature.knowledge.desc': 'Smart search & recommendations with real-time knowledge graph tracking',
    'about.feature.ai': 'AI Assistant',
    'about.feature.ai.desc': 'ADP-powered agent: conversation as a service with automated task recognition',
    'about.feature.profile': 'User Profile',
    'about.feature.profile.desc': 'Personalized preferences and relationships — AI learns as you use it',
    'about.feature.org': 'Team Collaboration',
    'about.feature.org.desc': 'Cloud config sync, team knowledge sharing and permission management',
    'about.changelog': '📋 Changelog',
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
