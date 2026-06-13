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
    'settings.tab.sync': '同步',
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

    // 日历子标签
    'cal.day': '日',
    'cal.week': '周',
    'cal.month': '月',

    // 待办扩展
    'task.noTasks': '暂无待办事项',
    'task.newTask': '+ 新建',
    'task.newTaskTitle': '新建任务',
    'task.editTaskTitle': '编辑任务',
    'task.title.label': '任务标题',
    'task.title.ph': '输入任务标题',
    'task.desc.label': '任务描述',
    'task.desc.ph': '输入任务描述（可选）',
    'task.due': '截止时间',
    'task.duration': '预估时长（分钟）',
    'task.pomodoros': '🍅 番茄钟数量',
    'task.pomodoroAuto': '智能分配',
    'task.pomodoroHint': '智能分配：根据任务时长自动计算番茄钟数量（每个番茄25分钟）',
    'task.priority': '优先级',
    'task.priority.low': '低',
    'task.priority.medium': '中',
    'task.priority.high': '高',
    'task.allDay': '全天任务',
    'task.syncCalendar': '同步到系统日历',
    'task.aiAnalysis': '📝 AI智能分析（输入任务描述，AI自动创建待办）',
    'task.aiAnalyze': '🤖 AI分析',
    'task.saveToNote': '📝 保存到记事本',
    'task.extractMemory': '🧠 提炼到记忆',
    'task.recordQuestion': '❓ 记录问题',
    'task.aiResult': 'AI分析结果',
    'task.confidence': '置信度',
    'task.sort.dueDate': '按截止时间排序',
    'task.sort.priority': '按优先级排序',

    // 笔记本扩展
    'notebook.selectAll': '全选',
    'notebook.selected': '已选 {n} 项',
    'notebook.download': '下载',
    'notebook.sendToAgent': '发给小助手',

    // AI助手扩展
    'ai.newChat': '新对话',
    'ai.searchChat': '搜索对话...',
    'ai.feature.task.title': '智能任务分析',
    'ai.feature.task.desc': '帮你分析和管理待办事项',
    'ai.feature.bidding.title': '招投标支持',
    'ai.feature.bidding.desc': '招投标文档智能生成',
    'ai.feature.knowledge.title': '知识助手',
    'ai.feature.knowledge.desc': '产品知识与助销资料',
    'ai.quickTitle': '💡 快捷问题',
    'ai.quick.schedule': '🎯 今日排程',
    'ai.quick.dailyReport': '📊 生成日报',
    'ai.quick.organizeNotes': '📚 整理笔记',
    'ai.quick.organizeMemory': '🧠 整理记忆',
    'ai.quick.urgent': '🔥 紧急事项',
    'ai.quick.timeAdvice': '⏰ 时间建议',
    'ai.welcome': '你好！我是你的AI助手。有什么我可以帮助你的吗？',
    'ai.inputPlaceholder': '输入你的问题...',
    'ai.stopGenerate': '停止生成',
    'ai.uploadFile': '上传文件',
    'ai.clearSearch': '清除',

    // 知识子标签
    'knowledge.sub.graph': '🧠 知识图谱',
    'knowledge.sub.globalGraph': '🗺 全局图谱',
    'knowledge.sub.articles': '📚 知识文章',
    'knowledge.sub.questions': '❓ 问题列表',
    'knowledge.sub.search': '🔍 知识搜索',
    'knowledge.stat.atoms': '知识原子',
    'knowledge.stat.clusters': '知识簇',
    'knowledge.stat.articles': '知识文章',
    'knowledge.searchCluster': '搜索知识簇...',
    'knowledge.allDomains': '全部领域',
    'knowledge.distill': '⚡ 一键萃取',
    'knowledge.newCluster': '+ 新建簇',
    'knowledge.empty.cluster': '暂无知识簇',
    'knowledge.empty.clusterHint': '复制内容到剪贴板，系统会自动提取知识原子并聚类',
    'knowledge.empty.articles': '暂无知识文章',
    'knowledge.empty.articlesHint': '知识簇成熟后可生成文章',
    'knowledge.empty.questions': '暂无待解决问题',
    'knowledge.empty.questionsHint': '记录工作中遇到的问题，后续集中解决形成知识',
    'knowledge.empty.recommend': '暂无智能推荐',
    'knowledge.empty.recommendHint': '复制含疑问的内容，系统将自动推荐知识',
    'knowledge.searchPlaceholder': '🔍 输入关键词搜索知识...',
    'knowledge.searchBtn': '🔍 搜索',
    'knowledge.recommend': '🤖 智能推荐',
    'knowledge.refresh': '🔄 刷新',
    'knowledge.searchResults': '🔎 搜索结果',
    'knowledge.close': '✕ 关闭',
    'knowledge.adpQa': '🤖 ADP 问答',
    'knowledge.thinking': '思考中',
    'knowledge.searching': '搜索中...',
    'knowledge.save': '💾 保存',
    'knowledge.copy': '📋 复制',
    'knowledge.ignore': '❌ 忽略',
    'knowledge.localMemory': '🧠 本地记忆',
    'knowledge.resourceFiles': '📄 资源文件',
    'knowledge.back': '← 返回',
    'knowledge.searchQuestions': '搜索问题...',
    'knowledge.addQuestion': '+ 记录问题',
    'knowledge.globalGraph.title': '🗺 全局知识图谱',
    'knowledge.globalGraph.searchNodes': '搜索节点...',
    'knowledge.globalGraph.autoLayout': '📐 一键布局',
    'knowledge.globalGraph.gather': '🎯 聚拢',
    'knowledge.globalGraph.scatter': '💫 扩散',
    'knowledge.globalGraph.roaming': '🧭 知识漫游',
    'knowledge.globalGraph.rebuild': '🔄 重建',
    'knowledge.globalGraph.all': '全部',
    'knowledge.globalGraph.domain': '领域',
    'knowledge.globalGraph.cluster': '知识簇',
    'knowledge.globalGraph.person': '人物',
    'knowledge.globalGraph.gap': '缺口',
    'knowledge.globalGraph.unhealthy': '⚠️ 异常',
    'knowledge.globalGraph.title2': '知识图谱',
    'knowledge.globalGraph.desc': 'AI 将分析你的知识体系，构建一张可视化图谱',
    'knowledge.globalGraph.build': '🚀 构建图谱',
    'knowledge.globalGraph.needLogin': '需要登录并配置 ADP',
    'knowledge.globalGraph.analyzing': '🗺 正在分析知识体系',
    'knowledge.globalGraph.analyzingDesc': 'AI 正在读取你的知识库，分析知识结构...',
    'knowledge.globalGraph.detail': '节点详情',

    // 文档扩展
    'documents.searchPh': '搜索文档、案例、Demo...',
    'documents.latest': '🕐 最新',
    'documents.hot': '🔥 最热',
    'documents.cloud': '☁️ 云端资料',
    'documents.local': '💻 本地',
    'documents.artifacts': '🤖 Agent 产物',
    'documents.cloudDocs': '📄 文档',
    'documents.cloudCases': '💼 案例',
    'documents.cloudDemos': '🎮 Demo',
    'documents.cloudLearning': '📚 学习材料',
    'documents.browseCloud': '浏览云端资料',
    'documents.browseCloudHint': '支持搜索文档、案例、Demo 和学习材料',
    'documents.prevPage': '上一页',
    'documents.nextPage': '下一页',
    'documents.allFiles': '📂 全部',
    'documents.desktop': '🖥 桌面',
    'documents.downloads': '📥 下载',
    'documents.docsFolder': '📝 文档',
    'documents.pictures': '🖼 图片',
    'documents.movies': '🎬 影片',
    'documents.homeDir': '🏠 主目录',
    'documents.refreshIndex': '🔄 刷新索引',
    'documents.allTypes': '全部',
    'documents.typeDoc': '📄 文档',
    'documents.typeSheet': '📊 表格',
    'documents.typePresentation': '📑 演示',
    'documents.typeImage': '🖼 图片',
    'documents.typeVideo': '🎬 影片',
    'documents.typeCode': '💻 代码',
    'documents.clickRefresh': '📊 点击「刷新索引」开始扫描本地文件',
    'documents.noFiles': '暂无文件',
    'documents.noFilesHint': '尝试切换目录或调整筛选条件',
    'documents.loadMore': '加载更多',
    'documents.artifactPath': '📂 保存目录：',
    'documents.artifactChangeDir': '更改保存目录',
    'documents.artifactOpenDir': '在 Finder 中打开',
    'documents.artifactRefresh': '刷新列表',
    'documents.noArtifacts': '暂无 Agent 产物',
    'documents.noArtifactsHint': 'AI 助手生成的文档、HTML 等交付物将保存在这里',
    'documents.addCustomDir': '添加自定义文件夹',

    // 洞察标签（emoji 由 tab-icon span 提供，翻译不含 emoji 避免重复）
    'insight.dashboard': '仪表盘',
    'insight.knowledgeBase': '知识库',
    'insight.activation': '知识活化',
    'insight.evolution': '知识演化',
    'insight.conflicts': '冲突检测',
    'insight.loadingDashboard': '加载洞察数据...',
    'insight.loadingKB': '加载知识库...',
    'insight.loadingActivation': '加载活化推荐...',
    'insight.loadingEvolution': '加载知识演化...',
    'insight.loadingConflicts': '加载冲突检测...',
    'insight.activationTitle': '⚡ 知识活化推荐',
    'insight.refreshRecommend': '刷新推荐',

    // 剪贴板检测
    'clipboard.detected': '检测到待办事项',
    'clipboard.original': '原文:',
    'clipboard.intent': '意图识别',
    'clipboard.intent.search': '🔍 搜索知识',
    'clipboard.intent.doc': '📄 获取文档',
    'clipboard.intent.question': '❓ 查询问题',
    'clipboard.intent.doubt': '🤔 有疑问',
    'clipboard.task': '任务:',
    'clipboard.due': '截止:',
    'clipboard.estimated': '预估:',
    'clipboard.priorityLevel': '优先级:',
    'clipboard.confidence': '置信度:',
    'clipboard.reason': '原因:',
    'clipboard.createTask': '创建任务',
    'clipboard.saveToNote': '保存到笔记',
    'clipboard.saveToMemory': '保存到记忆',
    'clipboard.recordQuestion': '❓ 记录问题',
    'clipboard.searchKnowledge': '🔍 搜索知识',
    'clipboard.edit': '编辑',
    'clipboard.ignore': '忽略',

    // 登录/注册扩展
    'login.account': '账户',
    'login.loginAccount': '登录账户',
    'login.loginHint': '登录后自动获取组织配置，接收通知推送',
    'login.username': '账号',
    'login.usernamePh': '用户名 / 手机号 / 邮箱',
    'login.passwordPh': '输入密码',
    'login.rememberHint': '关闭应用后自动登录',
    'login.noAccount': '还没有账号？',
    'login.registerLink': '注册新账号',
    'login.registerTitle': '注册账号',
    'login.registerHint': '创建账号后即可使用全部功能',
    'login.regUsername': '用户名',
    'login.regUsernamePh': '2-20位，字母/数字/下划线/中划线',
    'login.regMobile': '手机号',
    'login.regMobilePh': '11位手机号',
    'login.regSmsCode': '验证码',
    'login.regSmsCodePh': '6位数字验证码',
    'login.regPassword': '密码',
    'login.regPasswordPh': '至少6位',
    'login.regPasswordConfirm': '确认密码',
    'login.regPasswordConfirmPh': '再次输入密码',
    'login.sendCode': '获取验证码',
    'login.registerBtn': '注 册',
    'login.hasAccount': '已有账号？',
    'login.backToLogin': '返回登录',
    'login.required': '*',

    // 登录后配置
    'profile.model': '模型',
    'profile.quota': '额度',
    'profile.configSource': '配置来源',
    'profile.cloudConfig': '☁️ 云端配置',
    'profile.localConfig': '💻 本地配置',
    'profile.configHint': '使用组织管理员统一配置',
    'profile.serverUrls': '服务器地址',
    'profile.beta': 'Beta',
    'profile.production': '正式',
    'profile.reset': '↩ 重置',
    'profile.auth': '认证',
    'profile.config': '配置',
    'profile.saveAndVerify': '💾 保存并验证',
    'profile.resetAll': '↩ 全部重置',
    'profile.syncConfig': '🔄 同步配置',
    'profile.editProfile': '✏️ 修改资料',
    'profile.editPersonalInfo': '修改个人信息',
    'profile.name': '姓名',
    'profile.namePh': '您的姓名',
    'profile.nickname': '昵称',
    'profile.nicknamePh': '展示用名',
    'profile.email': '邮箱',
    'profile.emailPh': '选填',
    'profile.mobile': '手机号',
    'profile.mobilePh': '选填',

    // 设置 - LLM
    'settings.llm.orgConfig': '🏢 组织配置',
    'settings.llm.orgConfigHint': '当前使用组织统一配置，以下设置由管理员管理',
    'settings.llm.lowvol': '💬 小用量 LLM（通用对话、文章生成等）',
    'settings.llm.lowvolHint': '兼容所有 OpenAI 接口格式的大模型。示例：DeepSeek（api.deepseek.com）、智谱 GLM（open.bigmodel.cn/api/paas/v4）、火山方舟（ark.cn-beijing.volces.com/api/v3）等。Base URL 填写到 /v3 或 /v4 即可，系统自动拼接 /chat/completions。',
    'settings.llm.apiKeyPh': '输入对应平台的 API Key',
    'settings.llm.apiKeyHint': '不设置API Key时使用内置密钥，每日限制10次调用；设置后使用您自己的密钥。',
    'settings.llm.baseUrl': 'Base URL',
    'settings.llm.modelName': '模型名称',
    'settings.llm.testConnection': '🔗 测试连接',
    'settings.llm.highvol': '⚡ 大用量 LLM（剪贴板分析、记忆提取等高频调用）',
    'settings.llm.highvolHint': '高频调用场景可单独配置不同模型。留空则复用上方小用量 LLM 配置。⚠️ Base URL、API Key、模型名称三者必须配对（同一平台），否则鉴权失败。',
    'settings.llm.highvolApiKey': '大用量 API Key',
    'settings.llm.highvolApiKeyPh': '留空则使用上方小用量 API Key',
    'settings.llm.highvolBaseUrl': '大用量 Base URL',
    'settings.llm.highvolBaseUrlPh': '留空则使用上方小用量 Base URL',
    'settings.llm.highvolModel': '大用量模型名称',
    'settings.llm.highvolModelPh': '留空则使用上方小用量模型',
    'settings.llm.dailyLimit': '每日调用限制（设置自定义Key后生效）',
    'settings.llm.currentKey': '当前使用: 内置密钥',
    'settings.llm.dailyLimitLabel': '每日限制: 10次',

    // 设置 - Agent
    'settings.agent.appKey': 'ADP AppKey（AI助手通用）',
    'settings.agent.appKeyPh': '输入ADP应用AppKey',
    'settings.agent.appKeyHint': '腾讯云ADP智能体平台的AppKey，用于AI助手功能。配置后可以使用更强大的AI能力。',
    'settings.agent.knowledgeAppKey': '知识跟随推荐 AppKey',
    'settings.agent.searchAppKey': '搜索问答 AppKey',
    'settings.agent.clusteringAppKey': '聚类分析 AppKey',
    'settings.agent.graphAppKey': '图谱构建 AppKey',
    'settings.agent.activationAppKey': '知识活化 AppKey',
    'settings.agent.evolutionAppKey': '知识演化 AppKey',
    'settings.agent.conflictAppKey': '冲突检测 AppKey',
    'settings.agent.fileShareKey': '文件共享 API Key',
    'settings.agent.cosUpload': '☁️ 腾讯云文件上传（推荐）',
    'settings.agent.cosNotConfigured': '未配置',
    'settings.agent.cosHint': '配置后，文件将通过 ADP 官方 COS 方式上传，后端可正常接收文档。',
    'settings.agent.secretId': '腾讯云 SecretId',
    'settings.agent.secretKey': '腾讯云 SecretKey',
    'settings.agent.botBizId': 'BotBizId（应用ID）',
    'settings.agent.adpUrl': 'ADP API地址',
    'settings.agent.agentName': '助手名称',
    'settings.agent.chatNotify': '🔔 AI 回答完成提醒',
    'settings.agent.chatNotifyHint': '耗时较长（> 5 秒）的回答完成后，若你已切走窗口，自动通过系统通知和提示音提醒。',
    'settings.agent.statusNotConfigured': '当前状态: 未配置',

    // 设置 - Prompt
    'settings.prompt.title': '📝 Prompt 模板管理',
    'settings.prompt.hint': '管理 AI 系统使用的所有 Prompt 模板文件。支持在线编辑、上传下载。变量自动从用户画像和运行时数据填充。',
    'settings.prompt.editTitle': '编辑 Prompt',
    'settings.prompt.varsTitle': '🔖 变量映射预览',
    'settings.prompt.varsHint': '模板中使用的变量及其当前值。标记为',
    'settings.prompt.varsProfile': '画像',
    'settings.prompt.varsAuto': '自动',
    'settings.prompt.optimizer': '🧬 Prompt 自动优化器',
    'settings.prompt.taskRecog': '任务识别',
    'settings.prompt.memoryExtract': '记忆提取',
    'settings.prompt.runOptimizer': '▶ 运行优化',
    'settings.prompt.optimizerRunning': '优化器运行中，请稍候...',
    'settings.prompt.optimizerHint': '运行优化器将分析历史反馈数据，自动生成改进版 Prompt 并进行回归测试。',
    'settings.prompt.optimizerHistory': '📋 优化历史',
    'settings.prompt.noOptimizerHistory': '暂无优化记录',
    'settings.prompt.versionTitle': '版本管理',
    'settings.prompt.detailTitle': '优化详情',

    // 设置 - 画像
    'settings.profile.basicInfo': '👤 基本信息',
    'settings.profile.englishName': '英文名',
    'settings.profile.role': '角色',
    'settings.profile.industries': '行业（逗号分隔）',
    'settings.profile.frequentPersons': '👥 高频接触人物',
    'settings.profile.personName': '姓名',
    'settings.profile.personRelation': '关系（如：老板、同事）',
    'settings.profile.personCompany': '公司（可选）',
    'settings.profile.add': '+ 添加',
    'settings.profile.activeProjects': '📂 活跃项目',
    'settings.profile.projectName': '项目名',
    'settings.profile.projectAlias': '别名（逗号分隔）',
    'settings.profile.projectActive': '进行中',
    'settings.profile.projectPaused': '暂停',
    'settings.profile.projectCompleted': '已完成',
    'settings.profile.priorityPrefs': '⚡ 优先级偏好',
    'settings.profile.highPriorityWords': '高优先级触发词（逗号分隔）',
    'settings.profile.lowPriorityWords': '低优先级触发词（逗号分隔）',
    'settings.profile.aiImport': '🧠 AI 批量导入',
    'settings.profile.aiImportDesc': '粘贴文本描述你的同事、项目、行业等信息，AI 自动解析并填充画像',
    'settings.profile.aiImportBtn': '🧠 AI 解析并导入',
    'settings.profile.smartSuggestions': '💡 智能建议',
    'settings.profile.suggestHint': '点击下方按钮，系统将分析你的使用数据并给出画像更新建议。',
    'settings.profile.genSuggestions': '🔍 生成建议',

    // 设置 - 外观
    'settings.appearance.themes': '🎨 主题风格',
    'settings.appearance.themesDesc': '选择你喜欢的界面风格，所有主题都经过精心设计',
    'settings.appearance.effects': '✨ 视觉效果',
    'settings.appearance.glass': '毛玻璃效果',
    'settings.appearance.glassDesc': '标题栏和面板的模糊透明效果',
    'settings.appearance.orb': '背景光球',
    'settings.appearance.orbDesc': '主视图区域的渐变光球装饰',
    'settings.appearance.hover': '悬停动效',
    'settings.appearance.hoverDesc': '卡片和按钮的悬停浮起效果',
    'settings.appearance.fontSize': '🔤 字体大小',
    'settings.appearance.fontSizeSmall': '小',
    'settings.appearance.fontSizeMedium': '中',
    'settings.appearance.fontSizeLarge': '大',

    // 设置 - 记忆
    'settings.memory.total': '总记忆数',
    'settings.memory.shortTerm': '短期记忆',
    'settings.memory.longTerm': '长期记忆',
    'settings.memory.entities': '实体数量',
    'settings.memory.manualAdd': '手工添加记忆',
    'settings.memory.manualPh': '输入记忆内容，例如：我喜欢在工作时听音乐、我的常用邮箱是xxx@example.com...',
    'settings.memory.typeShort': '短期记忆',
    'settings.memory.typeLong': '长期记忆',
    'settings.memory.addBtn': '添加记忆',
    'settings.memory.aiOrganize': '🧠 AI 整理后添加',
    'settings.memory.list': '记忆列表',
    'settings.memory.allTypes': '全部类型',
    'settings.memory.typeInstant': '瞬时记忆',
    'settings.memory.allBizCategories': '全部业务分类',
    'settings.memory.refresh': '刷新',
    'settings.memory.aiBatch': '🧠 AI 批量整理',
    'settings.memory.clearAll': '清空所有记忆',
    'settings.memory.noRecords': '暂无记忆记录',
    'settings.memory.loadMore': '加载更多',

    // 设置 - 同步
    'settings.sync.title': '☁️ 云端同步',
    'settings.sync.desc': '开启后，任务、记事本、知识等数据将通过 ADPToolkit 服务器同步至云端，支持多设备访问（移动端 MemoraMobile 等）',
    'settings.sync.enable': '启用云端同步',
    'settings.sync.enableHint': '关闭时数据仅存储在本地，不会上传到云端',
    'settings.sync.server': '同步服务器',
    'settings.sync.serverPh': 'ADPToolkit 服务器地址',
    'settings.sync.serverHint': '由组织配置自动下发，无需手动设置',
    'settings.sync.scope': '同步范围',
    'settings.sync.scopeTasks': '📋 任务',
    'settings.sync.scopeNotes': '📝 记事本',
    'settings.sync.scopeKnowledge': '🧠 知识图谱',
    'settings.sync.scopeClipboard': '📋 剪贴板',
    'settings.sync.scopeConversations': '💬 会话',
    'settings.sync.scopeHint': '选择需要同步到云端的数据类型，未勾选的仅保存在本地',
    'settings.sync.frequency': '同步频率',
    'settings.sync.realtime': '⚡ 实时',
    'settings.sync.realtimeHint': '数据变更后立即同步',
    'settings.sync.interval': '⏱️ 定时',
    'settings.sync.intervalHint': '每 5 分钟自动同步一次',
    'settings.sync.manual': '👆 手动',
    'settings.sync.manualHint': '仅点击同步按钮时同步',
    'settings.sync.syncNow': '🔄 立即同步',
    'settings.sync.viewStatus': '📊 查看同步状态',
    'settings.sync.lastSync': '上次同步',
    'settings.sync.neverSynced': '从未同步',
    'settings.sync.direction': '同步方向',
    'settings.sync.pendingPush': '待上传',
    'settings.sync.pendingPull': '待下载',
    'settings.sync.disabledTitle': '🔒',
    'settings.sync.disabledHint': '云端同步已关闭，所有数据仅存储在本地',
    'settings.sync.disabledHint2': '开启后可通过 MemoraMobile 随时访问您的数据',

    // 设置 - 备份
    'settings.backup.exportTitle': '📦 数据导出',
    'settings.backup.exportDesc': '将所有数据（知识、记忆、画像、笔记、任务、配置等）导出为加密备份文件，可在其他设备上导入恢复',
    'settings.backup.exportPwd': '设置加密密码',
    'settings.backup.exportPwdPh': '至少4位密码，用于加密备份文件',
    'settings.backup.confirmPwd': '确认密码',
    'settings.backup.confirmPwdPh': '再次输入密码',
    'settings.backup.exportBtn': '📦 一键导出全部数据',
    'settings.backup.importTitle': '📥 数据导入',
    'settings.backup.importDesc': '从加密备份文件恢复数据。支持两种模式：合并（保留现有数据+追加新数据）或替换（完全覆盖）',
    'settings.backup.importPwd': '输入解密密码',
    'settings.backup.importPwdPh': '输入导出时设置的密码',

    // 业务分类
    'biz.product': '产品',
    'biz.project': '项目',
    'biz.case': '案例',
    'biz.work': '工作',
    'biz.bidding': '投标',
    'biz.consulting': '咨询',
    'biz.solution': '方案',
    'biz.problem': '问题',
    'biz.requirement': '需求',
    'biz.customer': '客户情况',
    'biz.personal': '个人情况',
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
    'settings.tab.sync': 'Sync',
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

    // Calendar sub-tabs
    'cal.day': 'Day',
    'cal.week': 'Week',
    'cal.month': 'Month',

    // Tasks extended
    'task.noTasks': 'No tasks yet',
    'task.newTask': '+ New',
    'task.newTaskTitle': 'New Task',
    'task.editTaskTitle': 'Edit Task',
    'task.title.label': 'Task Title',
    'task.title.ph': 'Enter task title',
    'task.desc.label': 'Description',
    'task.desc.ph': 'Enter description (optional)',
    'task.due': 'Due Date',
    'task.duration': 'Duration (min)',
    'task.pomodoros': '🍅 Pomodoros',
    'task.pomodoroAuto': 'Auto',
    'task.pomodoroHint': 'Auto: calculate pomodoro count based on task duration (25 min each)',
    'task.priority': 'Priority',
    'task.priority.low': 'Low',
    'task.priority.medium': 'Medium',
    'task.priority.high': 'High',
    'task.allDay': 'All-day task',
    'task.syncCalendar': 'Sync to system calendar',
    'task.aiAnalysis': '📝 AI Smart Analysis (describe task, AI auto-creates it)',
    'task.aiAnalyze': '🤖 AI Analyze',
    'task.saveToNote': '📝 Save to Notes',
    'task.extractMemory': '🧠 Extract to Memory',
    'task.recordQuestion': '❓ Record Question',
    'task.aiResult': 'AI Analysis Result',
    'task.confidence': 'Confidence',
    'task.sort.dueDate': 'Sort by due date',
    'task.sort.priority': 'Sort by priority',

    // Notebook extended
    'notebook.selectAll': 'Select All',
    'notebook.selected': '{n} selected',
    'notebook.download': 'Download',
    'notebook.sendToAgent': 'Send to Agent',

    // AI Assistant extended
    'ai.newChat': 'New Chat',
    'ai.searchChat': 'Search chats...',
    'ai.feature.task.title': 'Smart Task Analysis',
    'ai.feature.task.desc': 'Help analyze and manage your tasks',
    'ai.feature.bidding.title': 'Bidding Support',
    'ai.feature.bidding.desc': 'Smart bidding document generation',
    'ai.feature.knowledge.title': 'Knowledge Assistant',
    'ai.feature.knowledge.desc': 'Product knowledge & sales materials',
    'ai.quickTitle': '💡 Quick Questions',
    'ai.quick.schedule': '🎯 Today\'s Schedule',
    'ai.quick.dailyReport': '📊 Daily Report',
    'ai.quick.organizeNotes': '📚 Organize Notes',
    'ai.quick.organizeMemory': '🧠 Organize Memory',
    'ai.quick.urgent': '🔥 Urgent Items',
    'ai.quick.timeAdvice': '⏰ Time Advice',
    'ai.welcome': 'Hello! I\'m your AI assistant. How can I help you?',
    'ai.inputPlaceholder': 'Type your question...',
    'ai.stopGenerate': 'Stop generating',
    'ai.uploadFile': 'Upload file',
    'ai.clearSearch': 'Clear',

    // Knowledge sub-tabs
    'knowledge.sub.graph': '🧠 Graph',
    'knowledge.sub.globalGraph': '🗺 Global Graph',
    'knowledge.sub.articles': '📚 Articles',
    'knowledge.sub.questions': '❓ Questions',
    'knowledge.sub.search': '🔍 Search',
    'knowledge.stat.atoms': 'Atoms',
    'knowledge.stat.clusters': 'Clusters',
    'knowledge.stat.articles': 'Articles',
    'knowledge.searchCluster': 'Search clusters...',
    'knowledge.allDomains': 'All domains',
    'knowledge.distill': '⚡ Quick Distill',
    'knowledge.newCluster': '+ New Cluster',
    'knowledge.empty.cluster': 'No clusters',
    'knowledge.empty.clusterHint': 'Copy content to clipboard, system will auto-extract knowledge atoms and cluster them',
    'knowledge.empty.articles': 'No articles',
    'knowledge.empty.articlesHint': 'Articles can be generated from mature clusters',
    'knowledge.empty.questions': 'No pending questions',
    'knowledge.empty.questionsHint': 'Record problems at work, solve them later as knowledge',
    'knowledge.empty.recommend': 'No recommendations',
    'knowledge.empty.recommendHint': 'Copy content with questions, system will auto-recommend knowledge',
    'knowledge.searchPlaceholder': '🔍 Enter keywords to search knowledge...',
    'knowledge.searchBtn': '🔍 Search',
    'knowledge.recommend': '🤖 Recommendations',
    'knowledge.refresh': '🔄 Refresh',
    'knowledge.searchResults': '🔎 Search Results',
    'knowledge.close': '✕ Close',
    'knowledge.adpQa': '🤖 ADP Q&A',
    'knowledge.thinking': 'Thinking',
    'knowledge.searching': 'Searching...',
    'knowledge.save': '💾 Save',
    'knowledge.copy': '📋 Copy',
    'knowledge.ignore': '❌ Ignore',
    'knowledge.localMemory': '🧠 Local Memory',
    'knowledge.resourceFiles': '📄 Resource Files',
    'knowledge.back': '← Back',
    'knowledge.searchQuestions': 'Search questions...',
    'knowledge.addQuestion': '+ Record Question',
    'knowledge.globalGraph.title': '🗺 Global Knowledge Graph',
    'knowledge.globalGraph.searchNodes': 'Search nodes...',
    'knowledge.globalGraph.autoLayout': '📐 Auto Layout',
    'knowledge.globalGraph.gather': '🎯 Gather',
    'knowledge.globalGraph.scatter': '💫 Scatter',
    'knowledge.globalGraph.roaming': '🧭 Knowledge Roaming',
    'knowledge.globalGraph.rebuild': '🔄 Rebuild',
    'knowledge.globalGraph.all': 'All',
    'knowledge.globalGraph.domain': 'Domain',
    'knowledge.globalGraph.cluster': 'Cluster',
    'knowledge.globalGraph.person': 'Person',
    'knowledge.globalGraph.gap': 'Gap',
    'knowledge.globalGraph.unhealthy': '⚠️ Unhealthy',
    'knowledge.globalGraph.title2': 'Knowledge Graph',
    'knowledge.globalGraph.desc': 'AI will analyze your knowledge system and build a visual graph',
    'knowledge.globalGraph.build': '🚀 Build Graph',
    'knowledge.globalGraph.needLogin': 'Login & ADP configuration required',
    'knowledge.globalGraph.analyzing': '🗺 Analyzing knowledge system',
    'knowledge.globalGraph.analyzingDesc': 'AI is reading your knowledge base, analyzing knowledge structure...',
    'knowledge.globalGraph.detail': 'Node Details',

    // Documents extended
    'documents.searchPh': 'Search docs, cases, demos...',
    'documents.latest': '🕐 Latest',
    'documents.hot': '🔥 Hot',
    'documents.cloud': '☁️ Cloud',
    'documents.local': '💻 Local',
    'documents.artifacts': '🤖 Agent Artifacts',
    'documents.cloudDocs': '📄 Docs',
    'documents.cloudCases': '💼 Cases',
    'documents.cloudDemos': '🎮 Demos',
    'documents.cloudLearning': '📚 Learning',
    'documents.browseCloud': 'Browse cloud resources',
    'documents.browseCloudHint': 'Search docs, cases, demos and learning materials',
    'documents.prevPage': 'Previous',
    'documents.nextPage': 'Next',
    'documents.allFiles': '📂 All',
    'documents.desktop': '🖥 Desktop',
    'documents.downloads': '📥 Downloads',
    'documents.docsFolder': '📝 Documents',
    'documents.pictures': '🖼 Pictures',
    'documents.movies': '🎬 Movies',
    'documents.homeDir': '🏠 Home',
    'documents.refreshIndex': '🔄 Refresh Index',
    'documents.allTypes': 'All',
    'documents.typeDoc': '📄 Docs',
    'documents.typeSheet': '📊 Sheets',
    'documents.typePresentation': '📑 Slides',
    'documents.typeImage': '🖼 Images',
    'documents.typeVideo': '🎬 Videos',
    'documents.typeCode': '💻 Code',
    'documents.clickRefresh': '📊 Click "Refresh Index" to scan local files',
    'documents.noFiles': 'No files',
    'documents.noFilesHint': 'Try switching directories or adjusting filters',
    'documents.loadMore': 'Load More',
    'documents.artifactPath': '📂 Save Directory:',
    'documents.artifactChangeDir': 'Change save directory',
    'documents.artifactOpenDir': 'Open in Finder',
    'documents.artifactRefresh': 'Refresh list',
    'documents.noArtifacts': 'No Agent Artifacts',
    'documents.noArtifactsHint': 'Documents and HTML generated by AI assistant will be saved here',
    'documents.addCustomDir': 'Add custom folder',

    // Insight tabs (emoji provided by tab-icon span, translations without emoji to avoid duplication)
    'insight.dashboard': 'Dashboard',
    'insight.knowledgeBase': 'Knowledge Base',
    'insight.activation': 'Activation',
    'insight.evolution': 'Evolution',
    'insight.conflicts': 'Conflicts',
    'insight.loadingDashboard': 'Loading insights...',
    'insight.loadingKB': 'Loading knowledge base...',
    'insight.loadingActivation': 'Loading activation...',
    'insight.loadingEvolution': 'Loading evolution...',
    'insight.loadingConflicts': 'Loading conflicts...',
    'insight.activationTitle': '⚡ Knowledge Activation',
    'insight.refreshRecommend': 'Refresh',

    // Clipboard detector
    'clipboard.detected': 'Task detected',
    'clipboard.original': 'Original:',
    'clipboard.intent': 'Intent',
    'clipboard.intent.search': '🔍 Search Knowledge',
    'clipboard.intent.doc': '📄 Get Document',
    'clipboard.intent.question': '❓ Query Question',
    'clipboard.intent.doubt': '🤔 Doubt',
    'clipboard.task': 'Task:',
    'clipboard.due': 'Due:',
    'clipboard.estimated': 'Est.:',
    'clipboard.priorityLevel': 'Priority:',
    'clipboard.confidence': 'Confidence:',
    'clipboard.reason': 'Reason:',
    'clipboard.createTask': 'Create Task',
    'clipboard.saveToNote': 'Save to Note',
    'clipboard.saveToMemory': 'Save to Memory',
    'clipboard.recordQuestion': '❓ Record Question',
    'clipboard.searchKnowledge': '🔍 Search Knowledge',
    'clipboard.edit': 'Edit',
    'clipboard.ignore': 'Ignore',

    // Login/Register extended
    'login.account': 'Account',
    'login.loginAccount': 'Login',
    'login.loginHint': 'Login to auto-get org config and receive notifications',
    'login.username': 'Username',
    'login.usernamePh': 'Username / Phone / Email',
    'login.passwordPh': 'Enter password',
    'login.rememberHint': 'Auto-login after app close',
    'login.noAccount': 'No account?',
    'login.registerLink': 'Register',
    'login.registerTitle': 'Register',
    'login.registerHint': 'Create an account to use all features',
    'login.regUsername': 'Username',
    'login.regUsernamePh': '2-20 chars, letters/numbers/underscore/dash',
    'login.regMobile': 'Phone',
    'login.regMobilePh': '11-digit phone number',
    'login.regSmsCode': 'Verification Code',
    'login.regSmsCodePh': '6-digit code',
    'login.regPassword': 'Password',
    'login.regPasswordPh': 'At least 6 characters',
    'login.regPasswordConfirm': 'Confirm Password',
    'login.regPasswordConfirmPh': 'Re-enter password',
    'login.sendCode': 'Send Code',
    'login.registerBtn': 'Register',
    'login.hasAccount': 'Already have an account?',
    'login.backToLogin': 'Back to login',
    'login.required': '*',

    // Post-login profile
    'profile.model': 'Model',
    'profile.quota': 'Quota',
    'profile.configSource': 'Config Source',
    'profile.cloudConfig': '☁️ Cloud',
    'profile.localConfig': '💻 Local',
    'profile.configHint': 'Using org admin unified config',
    'profile.serverUrls': 'Server URLs',
    'profile.beta': 'Beta',
    'profile.production': 'Production',
    'profile.reset': '↩ Reset',
    'profile.auth': 'Auth',
    'profile.config': 'Config',
    'profile.saveAndVerify': '💾 Save & Verify',
    'profile.resetAll': '↩ Reset All',
    'profile.syncConfig': '🔄 Sync Config',
    'profile.editProfile': '✏️ Edit Profile',
    'profile.editPersonalInfo': 'Edit Personal Info',
    'profile.name': 'Name',
    'profile.namePh': 'Your name',
    'profile.nickname': 'Nickname',
    'profile.nicknamePh': 'Display name',
    'profile.email': 'Email',
    'profile.emailPh': 'Optional',
    'profile.mobile': 'Phone',
    'profile.mobilePh': 'Optional',

    // Settings - LLM
    'settings.llm.orgConfig': '🏢 Org Config',
    'settings.llm.orgConfigHint': 'Using org unified config, managed by admin',
    'settings.llm.lowvol': '💬 Low-volume LLM (general chat, article generation, etc.)',
    'settings.llm.lowvolHint': 'Compatible with all OpenAI-format models. E.g.: DeepSeek (api.deepseek.com), GLM (open.bigmodel.cn/api/paas/v4), Volcengine (ark.cn-beijing.volces.com/api/v3). Base URL up to /v3 or /v4, system auto-appends /chat/completions.',
    'settings.llm.apiKeyPh': 'Enter API Key for the platform',
    'settings.llm.apiKeyHint': 'Without API Key, built-in key is used (10 calls/day limit); with your own key, no limit.',
    'settings.llm.baseUrl': 'Base URL',
    'settings.llm.modelName': 'Model Name',
    'settings.llm.testConnection': '🔗 Test Connection',
    'settings.llm.highvol': '⚡ High-volume LLM (clipboard analysis, memory extraction, etc.)',
    'settings.llm.highvolHint': 'High-frequency scenarios can use a separate model. Leave empty to reuse the low-volume LLM config. ⚠️ Base URL, API Key, and Model Name must be from the same platform.',
    'settings.llm.highvolApiKey': 'High-volume API Key',
    'settings.llm.highvolApiKeyPh': 'Leave empty to use low-volume API Key',
    'settings.llm.highvolBaseUrl': 'High-volume Base URL',
    'settings.llm.highvolBaseUrlPh': 'Leave empty to use low-volume Base URL',
    'settings.llm.highvolModel': 'High-volume Model Name',
    'settings.llm.highvolModelPh': 'Leave empty to use low-volume model',
    'settings.llm.dailyLimit': 'Daily call limit (applies when using custom key)',
    'settings.llm.currentKey': 'Using: Built-in key',
    'settings.llm.dailyLimitLabel': 'Daily limit: 10 calls',

    // Settings - Agent
    'settings.agent.appKey': 'ADP AppKey (AI Assistant)',
    'settings.agent.appKeyPh': 'Enter ADP AppKey',
    'settings.agent.appKeyHint': 'Tencent Cloud ADP platform AppKey for AI assistant features.',
    'settings.agent.knowledgeAppKey': 'Knowledge Recommend AppKey',
    'settings.agent.searchAppKey': 'Search Q&A AppKey',
    'settings.agent.clusteringAppKey': 'Clustering AppKey',
    'settings.agent.graphAppKey': 'Graph Build AppKey',
    'settings.agent.activationAppKey': 'Activation AppKey',
    'settings.agent.evolutionAppKey': 'Evolution AppKey',
    'settings.agent.conflictAppKey': 'Conflict Detection AppKey',
    'settings.agent.fileShareKey': 'File Share API Key',
    'settings.agent.cosUpload': '☁️ Tencent Cloud Upload (Recommended)',
    'settings.agent.cosNotConfigured': 'Not configured',
    'settings.agent.cosHint': 'Once configured, files will be uploaded via ADP official COS method.',
    'settings.agent.secretId': 'Tencent Cloud SecretId',
    'settings.agent.secretKey': 'Tencent Cloud SecretKey',
    'settings.agent.botBizId': 'BotBizId (App ID)',
    'settings.agent.adpUrl': 'ADP API URL',
    'settings.agent.agentName': 'Assistant Name',
    'settings.agent.chatNotify': '🔔 AI Response Notification',
    'settings.agent.chatNotifyHint': 'When a long response (>5s) completes and you\'ve switched windows, auto-notify via system notification and sound.',
    'settings.agent.statusNotConfigured': 'Status: Not configured',

    // Settings - Prompt
    'settings.prompt.title': '📝 Prompt Template Manager',
    'settings.prompt.hint': 'Manage all Prompt templates used by AI. Supports online editing, upload & download. Variables auto-filled from user profile and runtime data.',
    'settings.prompt.editTitle': 'Edit Prompt',
    'settings.prompt.varsTitle': '🔖 Variable Mapping Preview',
    'settings.prompt.varsHint': 'Variables used in templates and their current values.',
    'settings.prompt.varsProfile': 'Profile',
    'settings.prompt.varsAuto': 'Auto',
    'settings.prompt.optimizer': '🧬 Prompt Auto-Optimizer',
    'settings.prompt.taskRecog': 'Task Recognition',
    'settings.prompt.memoryExtract': 'Memory Extraction',
    'settings.prompt.runOptimizer': '▶ Run Optimizer',
    'settings.prompt.optimizerRunning': 'Optimizer running, please wait...',
    'settings.prompt.optimizerHint': 'The optimizer analyzes feedback data, generates improved Prompts and runs regression tests.',
    'settings.prompt.optimizerHistory': '📋 Optimization History',
    'settings.prompt.noOptimizerHistory': 'No optimization records',
    'settings.prompt.versionTitle': 'Version History',
    'settings.prompt.detailTitle': 'Optimization Details',

    // Settings - Profile
    'settings.profile.basicInfo': '👤 Basic Info',
    'settings.profile.englishName': 'English Name',
    'settings.profile.role': 'Role',
    'settings.profile.industries': 'Industries (comma-separated)',
    'settings.profile.frequentPersons': '👥 Frequent Contacts',
    'settings.profile.personName': 'Name',
    'settings.profile.personRelation': 'Relation (e.g.: boss, colleague)',
    'settings.profile.personCompany': 'Company (optional)',
    'settings.profile.add': '+ Add',
    'settings.profile.activeProjects': '📂 Active Projects',
    'settings.profile.projectName': 'Project Name',
    'settings.profile.projectAlias': 'Aliases (comma-separated)',
    'settings.profile.projectActive': 'Active',
    'settings.profile.projectPaused': 'Paused',
    'settings.profile.projectCompleted': 'Completed',
    'settings.profile.priorityPrefs': '⚡ Priority Preferences',
    'settings.profile.highPriorityWords': 'High priority triggers (comma-separated)',
    'settings.profile.lowPriorityWords': 'Low priority triggers (comma-separated)',
    'settings.profile.aiImport': '🧠 AI Batch Import',
    'settings.profile.aiImportDesc': 'Paste text describing your colleagues, projects, industries, etc. AI will parse and fill the profile',
    'settings.profile.aiImportBtn': '🧠 AI Parse & Import',
    'settings.profile.smartSuggestions': '💡 Smart Suggestions',
    'settings.profile.suggestHint': 'Click the button below to analyze your usage data and get profile update suggestions.',
    'settings.profile.genSuggestions': '🔍 Generate Suggestions',

    // Settings - Appearance
    'settings.appearance.themes': '🎨 Themes',
    'settings.appearance.themesDesc': 'Choose your preferred style, all themes are carefully designed',
    'settings.appearance.effects': '✨ Visual Effects',
    'settings.appearance.glass': 'Glass Effect',
    'settings.appearance.glassDesc': 'Blur transparency for header and panels',
    'settings.appearance.orb': 'Background Orb',
    'settings.appearance.orbDesc': 'Gradient orb decoration in main view',
    'settings.appearance.hover': 'Hover Effect',
    'settings.appearance.hoverDesc': 'Hover lift effect for cards and buttons',
    'settings.appearance.fontSize': '🔤 Font Size',
    'settings.appearance.fontSizeSmall': 'Small',
    'settings.appearance.fontSizeMedium': 'Medium',
    'settings.appearance.fontSizeLarge': 'Large',

    // Settings - Memory
    'settings.memory.total': 'Total Memories',
    'settings.memory.shortTerm': 'Short-term',
    'settings.memory.longTerm': 'Long-term',
    'settings.memory.entities': 'Entities',
    'settings.memory.manualAdd': 'Manual Add',
    'settings.memory.manualPh': 'Enter memory content, e.g.: I like listening to music while working...',
    'settings.memory.typeShort': 'Short-term',
    'settings.memory.typeLong': 'Long-term',
    'settings.memory.addBtn': 'Add Memory',
    'settings.memory.aiOrganize': '🧠 AI Organize & Add',
    'settings.memory.list': 'Memory List',
    'settings.memory.allTypes': 'All Types',
    'settings.memory.typeInstant': 'Instant',
    'settings.memory.allBizCategories': 'All Categories',
    'settings.memory.refresh': 'Refresh',
    'settings.memory.aiBatch': '🧠 AI Batch Organize',
    'settings.memory.clearAll': 'Clear All Memories',
    'settings.memory.noRecords': 'No memories',
    'settings.memory.loadMore': 'Load More',

    // Settings - Sync
    'settings.sync.title': '☁️ Cloud Sync',
    'settings.sync.desc': 'When enabled, tasks, notes, knowledge, etc. will sync to cloud via ADPToolkit server, supporting multi-device access (MemoraMobile, etc.)',
    'settings.sync.enable': 'Enable Cloud Sync',
    'settings.sync.enableHint': 'When disabled, data is stored locally only',
    'settings.sync.server': 'Sync Server',
    'settings.sync.serverPh': 'ADPToolkit server URL',
    'settings.sync.serverHint': 'Auto-configured by org, no manual setup needed',
    'settings.sync.scope': 'Sync Scope',
    'settings.sync.scopeTasks': '📋 Tasks',
    'settings.sync.scopeNotes': '📝 Notes',
    'settings.sync.scopeKnowledge': '🧠 Knowledge Graph',
    'settings.sync.scopeClipboard': '📋 Clipboard',
    'settings.sync.scopeConversations': '💬 Conversations',
    'settings.sync.scopeHint': 'Select data types to sync; unchecked items are local only',
    'settings.sync.frequency': 'Sync Frequency',
    'settings.sync.realtime': '⚡ Realtime',
    'settings.sync.realtimeHint': 'Sync immediately after data changes',
    'settings.sync.interval': '⏱️ Scheduled',
    'settings.sync.intervalHint': 'Auto-sync every 5 minutes',
    'settings.sync.manual': '👆 Manual',
    'settings.sync.manualHint': 'Sync only when clicking the button',
    'settings.sync.syncNow': '🔄 Sync Now',
    'settings.sync.viewStatus': '📊 View Status',
    'settings.sync.lastSync': 'Last Sync',
    'settings.sync.neverSynced': 'Never synced',
    'settings.sync.direction': 'Direction',
    'settings.sync.pendingPush': 'Pending Push',
    'settings.sync.pendingPull': 'Pending Pull',
    'settings.sync.disabledTitle': '🔒',
    'settings.sync.disabledHint': 'Cloud sync is disabled, all data is stored locally',
    'settings.sync.disabledHint2': 'Enable to access your data via MemoraMobile anytime',

    // Settings - Backup
    'settings.backup.exportTitle': '📦 Data Export',
    'settings.backup.exportDesc': 'Export all data (knowledge, memories, profile, notes, tasks, config, etc.) as an encrypted backup file',
    'settings.backup.exportPwd': 'Encryption Password',
    'settings.backup.exportPwdPh': 'At least 4 characters for backup encryption',
    'settings.backup.confirmPwd': 'Confirm Password',
    'settings.backup.confirmPwdPh': 'Re-enter password',
    'settings.backup.exportBtn': '📦 Export All Data',
    'settings.backup.importTitle': '📥 Data Import',
    'settings.backup.importDesc': 'Restore from encrypted backup. Two modes: Merge (keep existing + add new) or Replace (full overwrite)',
    'settings.backup.importPwd': 'Decryption Password',
    'settings.backup.importPwdPh': 'Enter the password set during export',

    // Business categories
    'biz.product': 'Product',
    'biz.project': 'Project',
    'biz.case': 'Case',
    'biz.work': 'Work',
    'biz.bidding': 'Bidding',
    'biz.consulting': 'Consulting',
    'biz.solution': 'Solution',
    'biz.problem': 'Problem',
    'biz.requirement': 'Requirement',
    'biz.customer': 'Customer',
    'biz.personal': 'Personal',
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
