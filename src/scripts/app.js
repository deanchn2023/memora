const App = {
  pendingClipboardTask: null,
  editingTask: null,
  autoSaveTimer: null,
  countdownDisplay: null,
  remainingTime: 10,
  newNoteCount: 0, // 记事本角标：不在记事本页时新笔记的累加计数
  dbSyncTimer: null, // 数据库同步定时器
  _chatAttachments: [], // 聊天文件附件列表
  _chatFileRefs: {}, // 文件引用映射：📎文件名 → 完整路径
  _aiAssistantMode: null, // AI 助手模式：'agent' 或 'llm'（全局控制）
  _agentStreamTimerStart: 0, // Agent 流式计时起点
  _agentStreamTimerInterval: null, // Agent 流式计时器
  _userAvatarSvg: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="uBg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F0E6FF"/><stop offset="1" stop-color="#E0F0FF"/></linearGradient></defs><circle cx="20" cy="20" r="20" fill="url(#uBg)"/><circle cx="20" cy="14.5" r="6.5" fill="#C4B5FD"/><ellipse cx="20" cy="30" rx="10.5" ry="8" fill="#C4B5FD"/><circle cx="17.5" cy="13.8" r="1" fill="#7C3AED"/><circle cx="22.5" cy="13.8" r="1" fill="#7C3AED"/><path d="M18.5 16.2 Q20 17.8 21.5 16.2" stroke="#7C3AED" stroke-width="0.9" fill="none" stroke-linecap="round"/><circle cx="15" cy="15" r="1.8" fill="#DDD6FE" opacity="0.7"/><circle cx="25" cy="15" r="1.8" fill="#DDD6FE" opacity="0.7"/><circle cx="12" cy="19" r="1.2" fill="#DDD6FE" opacity="0.5"/><circle cx="28" cy="19" r="1.2" fill="#DDD6FE" opacity="0.5"/></svg>`,
  _assistantAvatarSvg: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="aBg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4F8EF7"/><stop offset="1" stop-color="#6C63FF"/></linearGradient></defs><rect width="40" height="40" rx="14" fill="url(#aBg)"/><text x="20" y="26" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="20" font-weight="700" fill="white">M</text></svg>`,

  // ADP SSE 流式状态
  _adpStreaming: false,
  _adpCurrentText: '',
  _adpThinkingText: '',
  _adpStepMap: {},           // msgId → { el, detailEl, type, textBuffer }
  _adpToolStepCount: 0,
  _adpFileItems: [],
  _adpTimerStart: 0,
  _adpTimerInterval: null,
  _adpCurrentBubble: null,
  _adpRenderPending: false,
  _adpConfigSource: '',
  _adpCurrentMessageEl: null,
  _adpReplyMsgId: '',        // reply 消息的 MessageId，用于区分 text.delta 归属
  _aiTaskEditor: null,       // AI任务输入富文本编辑器实例
  _noteEditor: null,         // 新建/编辑笔记富文本编辑器实例
  _noteEditorMode: 'add',    // 笔记编辑器模式：'add' 或 'edit'
  _noteEditorTargetId: null, // 编辑笔记时的目标 ID
  // 对话会话管理
  _chatSessions: [],        // 所有对话会话
  _activeSessionId: null,   // 当前活跃的会话ID
  _chatMsgData: new WeakMap(), // 聊天消息数据缓存（事件委托用，key=messageContent el）

  // v3.1 多任务并发
  _parallelMode: false,             // 并行模式开关
  _activeParallelTasks: new Map(),   // taskId → { mode, cardEl, contentEl, statusEl, timerEl, completed }
  _taskStreamRegistered: false,      // task:stream 监听器是否已注册

  init() {
    console.log('[App] init() starting...');
    this.updateInitTest('[App] Initializing...');
    
    try {
      Store.init();
      console.log('[App] Store.init() completed');
      this.updateInitTest('[App] Store initialized');
    } catch (e) {
      console.error('[App] Store.init() failed:', e);
    }
    
    // 从数据库加载数据（如果可用）
    this.initDatabaseSync();
    
    // 加载对话会话列表
    this._loadChatSessions();
    this._renderChatSessionList();

    // 加载设置（包括本地上下文开关等）
    this._settings = Store.getSettings();
    
    try {
      Pomodoro.init();
      console.log('[App] Pomodoro.init() completed');
      this.updateInitTest('[App] Pomodoro initialized');
    } catch (e) {
      console.error('[App] Pomodoro.init() failed:', e);
    }
    
    try {
      Calendar.init();
      console.log('[App] Calendar.init() completed');
      this.updateInitTest('[App] Calendar initialized');
    } catch (e) {
      console.error('[App] Calendar.init() failed:', e);
    }
    
    try {
      Reminder.init();
      console.log('[App] Reminder.init() completed');
      this.updateInitTest('[App] Reminder initialized');
    } catch (e) {
      console.error('[App] Reminder.init() failed:', e);
    }

    // 恢复 AI 小助手定时任务
    try {
      this._restoreAITaskSchedulers();
    } catch (e) {
      console.error('[App] _restoreAITaskSchedulers failed:', e);
    }

    try {
      SyncEngine.init();
      console.log('[App] SyncEngine.init() completed');
      this.updateInitTest('[App] SyncEngine initialized');
    } catch (e) {
      console.error('[App] SyncEngine.init() failed:', e);
    }

    try {
      this.bindEvents();
      console.log('[App] bindEvents() completed');
      this.updateInitTest('[App] Events bound');
    } catch (e) {
      console.error('[App] bindEvents() failed:', e);
    }

    // v3.1: 监听向量检索上下文来源
    if (window.electronAPI?.onContextSources) {
      this._pendingContextSources = null;
      window.electronAPI.onContextSources((data) => {
        this._pendingContextSources = data;
        // 动态插入 Badge 到当前助手消息前（处理异步到达的情况）
        this._renderContextSourcesBadge(data);
      });
    }
    
    try {
      this.renderTaskList();
      console.log('[App] renderTaskList() completed');
      this.updateInitTest('[App] Task list rendered');
    } catch (e) {
      console.error('[App] renderTaskList() failed:', e);
    }
    
    try {
      this.setupClipboardListener();
      console.log('[App] setupClipboardListener() completed');
      this.updateInitTest('[App] Clipboard listener setup - Ready!');
    } catch (e) {
      console.error('[App] setupClipboardListener() failed:', e);
    }

    // v3.1: 注册多任务流式事件监听
    this._registerTaskStreamListener();

    try {
      Audit.init();
      console.log('[App] Audit.init() completed');
    } catch (e) {
      console.error('[App] Audit.init() failed:', e);
    }

    // v2.6: 初始化专家系统
    try {
      if (window.ExpertSystem) {
        window.ExpertSystem.init();
        console.log('[App] ExpertSystem.init() completed');
      }
    } catch (e) {
      console.error('[App] ExpertSystem.init() failed:', e);
    }

    // 恢复视觉偏好（主题、字体大小、效果开关）
    this._restoreVisualPrefs();
    
    // 恢复全局 AI 模式（从主进程加载，始终可见）
    this._initGlobalAIMode();
    
    // i18n：恢复语言偏好 + 绑定切换 + 注册 UI 更新
    this._initI18n();
    
    // v2.0: 监听认证状态变化
    try {
      if (window.electronAPI?.onAuthChanged) {
        window.electronAPI.onAuthChanged((data) => {
          console.log('[App] Auth state changed:', data.isLoggedIn ? 'logged in' : 'logged out');
          this._updateOrgUI(data);
          if (data.isLoggedIn) {
            this._updateConfigServerHints(true);
            // 登录成功后注册设备并启动同步
            this._startSyncAfterLogin();
          } else {
            this._updateConfigServerHints(false);
          }
        });
      }
    } catch (e) {
      console.error('[App] Auth listener setup failed:', e);
    }
    
    // v2.1: 监听云端配置更新事件
    try {
      if (window.electronAPI?.onConfigUpdated) {
        window.electronAPI.onConfigUpdated((data) => {
          console.log('[App] Config updated from cloud, reason:', data.reason || 'sync');
          // 刷新设置页面的 API 和 ADP 配置显示
          this._settingsTabLoaded.api = false;
          this._settingsTabLoaded.adp = false;
          // 如果当前正在设置页面，立即刷新
          const settingsTab = document.querySelector('[data-view="settings"]');
          if (settingsTab && !settingsTab.classList.contains('hidden')) {
            this._loadApiConfig();
            this._loadAdpConfig();
          }
          // 刷新组织配置摘要
          this._loadOrgConfigSummary();
          // 刷新配置来源提示
          if (data.api || data.adp) {
            this._updateConfigServerHints(true);
          }
          // 如果是云端自动更新，显示 toast 提示
          if (data.reason === 'cloud_updated') {
            this.showToast('云端配置已更新，已自动同步', 'info');
          }
        });
      }
    } catch (e) {
      console.error('[App] Config update listener setup failed:', e);
    }
    
    // v2.0: 检查初始登录状态
    try {
      if (window.electronAPI?.authGetState) {
        window.electronAPI.authGetState().then(state => {
          if (state.isLoggedIn) {
            this._updateOrgUI(state);
            this._updateConfigServerHints(true);
          }
        });
      }
    } catch (e) {
      // ignore
    }
    
    setTimeout(() => this.updateInitTest(''), 2000);
    console.log('[App] init() finished');

    // 预加载 CC 默认工作目录（无需用户打开设置页即可使用）
    this._preloadCCDefaultWorkdir();

    // 延迟检查更新（不阻塞初始化）
    setTimeout(() => this._checkForUpdate(), 3000);
  },

  /** 预加载 CC 默认工作目录，供 SkillHub 和对话区使用 */
  _preloadCCDefaultWorkdir() {
    if (!window.electronAPI?.ccGetConfig) return;
    window.electronAPI.ccGetConfig().then(config => {
      this._ccDefaultWorkdir = config.defaultWorkdir || '';
    }).catch(() => {});
  },

  // 从数据库加载数据并同步到 Store
  async initDatabaseSync() {
    if (!window.electronAPI?.dbGetTasks) return;
    
    try {
      const dbTasks = await window.electronAPI.dbGetTasks();
      if (dbTasks && dbTasks.length > 0) {
        // 如果 localStorage 为空但数据库有数据，从数据库恢复
        const localTasks = Store.getTasks();
        if (localTasks.length === 0 && dbTasks.length > 0) {
          Store.saveTasks(dbTasks);
          console.log('[App] Restored tasks from database:', dbTasks.length);
        } else if (dbTasks.length > localTasks.length) {
          // 数据库数据更多，以数据库为准
          Store.saveTasks(dbTasks);
          console.log('[App] Synced tasks from database (more data):', dbTasks.length);
        }
      }
    } catch (error) {
      console.error('[App] Database sync failed:', error);
    }
    
    // 定期同步数据到数据库（每5分钟）
    this.dbSyncTimer = setInterval(() => this.syncToDatabase(), 5 * 60 * 1000);
  },

  // 同步 localStorage 数据到数据库
  async syncToDatabase() {
    if (!window.electronAPI?.dbSaveTasks) return;
    
    try {
      const tasks = Store.getTasks();
      await window.electronAPI.dbSaveTasks(tasks);
      console.log('[App] Synced tasks to database:', tasks.length);
    } catch (error) {
      console.error('[App] Database sync failed:', error);
    }
  },

  updateInitTest(msg) {
    const el = document.getElementById('init-test');
    if (el) el.textContent = msg || 'Done';
  },

  /**
   * v3.1.1: 紧急 UI 重置 — 强制隐藏所有 modal/overlay，确保页面可交互
   * 在全局错误或初始化失败时调用
   */
  _emergencyUIReset() {
    // 隐藏所有 modal
    document.querySelectorAll('.modal:not(.hidden)').forEach(el => el.classList.add('hidden'));
    // 隐藏所有 overlay
    document.querySelectorAll('.modal-overlay, .audit-overlay, .prompt-editor-overlay, .voice-overlay, .connector-modal-overlay, .dialog-overlay, .image-viewer-overlay').forEach(el => {
      el.classList.add('hidden');
      el.style.display = 'none';
    });
    // 隐藏独立 overlay 容器
    document.querySelectorAll('[id$="Overlay"]:not(.hidden), [id$="Modal"]:not(.hidden)').forEach(el => {
      el.classList.add('hidden');
    });
    console.log('[Emergency] UI reset — all modals/overlays hidden');
  },

  /**
   * v3.1: 动态渲染上下文来源 Badge
   * 当 context:sources 事件异步到达时，插入到当前助手消息前
   */
  _renderContextSourcesBadge(data) {
    if (!data?.sources?.length) return;

    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    // 查找最后一个助手消息
    const lastAssistant = chatMessages.querySelector('.message.assistant:last-of-type');
    if (!lastAssistant) return;

    // 如果已有 badge 则不重复插入
    if (lastAssistant.querySelector('.context-sources-badge')) return;

    const sources = data.sources;
    const icons = { notebook: '📝', memory: '🧠', tasks: '✅', knowledge: '📚' };
    const chips = sources.map(s => {
      const icon = icons[s.source_type] || '📌';
      const score = Math.round((s.score || 0) * 100);
      return `<span class="ctx-source-chip" data-source-type="${s.source_type}" data-source-id="${s.source_id}" title="${this.escapeHtml(s.title || '')} (${score}%)">${icon} ${this.escapeHtml((s.title || '').substring(0, 15))} ${score}%</span>`;
    }).join('');

    const badge = document.createElement('div');
    badge.className = 'context-sources-badge';
    badge.innerHTML = `📚 已参考 ${sources.length} 条本地数据：${chips}`;

    // 插入到助手消息内部最前面
    lastAssistant.insertBefore(badge, lastAssistant.firstChild);
  },

  bindEvents() {
    document.getElementById('addTaskBtn')?.addEventListener('click', () => this.showTaskModal());
    document.getElementById('voiceInputBtn')?.addEventListener('click', () => this._toggleMainVoiceInput());
    
    document.getElementById('createTaskBtn')?.addEventListener('click', () => this.createTaskFromClipboard());
    document.getElementById('editTaskBtn')?.addEventListener('click', () => this.editClipboardTask());
    document.getElementById('ignoreBtn')?.addEventListener('click', () => this.hideClipboardDetector());
    document.getElementById('saveToNoteBtn')?.addEventListener('click', () => this.saveClipboardToNote());
    document.getElementById('saveToMemoryBtn')?.addEventListener('click', () => this.saveClipboardToMemory());
    document.getElementById('saveAsQuestionBtn')?.addEventListener('click', () => this.saveClipboardAsQuestion());
    
    document.getElementById('closeModal')?.addEventListener('click', () => this.hideTaskModal());
    document.getElementById('cancelTask')?.addEventListener('click', () => this.hideTaskModal());
    document.getElementById('saveTask')?.addEventListener('click', () => this.saveTask());

    // 语音 ASR 设置面板
    document.getElementById('asrProviderVolcano')?.addEventListener('click', () => this._switchASRProvider('volcano'));
    document.getElementById('asrProviderTencent')?.addEventListener('click', () => this._switchASRProvider('tencent'));
    document.getElementById('saveASRConfigBtn')?.addEventListener('click', () => this._saveASRConfig());
    document.getElementById('testASRConfigBtn')?.addEventListener('click', () => this._testASRMicrophone());
    
    // AI分析按钮
    document.getElementById('aiAnalyzeBtn')?.addEventListener('click', () => this.analyzeTaskInput());
    document.getElementById('aiVoiceInputBtn')?.addEventListener('click', () => this._toggleModalVoiceInput());
    document.getElementById('modalVoiceStopBtn')?.addEventListener('click', () => this._stopVoiceInput());
    document.getElementById('aiSaveToNoteBtn')?.addEventListener('click', () => this.saveAIToNote());
    document.getElementById('aiExtractMemoryBtn')?.addEventListener('click', () => this.extractAIMemory());
    document.getElementById('aiSaveAsQuestionBtn')?.addEventListener('click', () => this.saveAIAsQuestion());
    
    // 番茄钟选择器
    document.querySelectorAll('.pomodoro-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.pomodoro-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const pomInput = document.getElementById('taskPomodoros');
        if (pomInput) pomInput.value = e.target.dataset.pomodoros;
        
        // 更新提示信息
        this.updatePomodoroHint();
      });
    });
    
    // 时长变化时更新番茄钟提示
    document.getElementById('taskDuration')?.addEventListener('input', () => {
      this.updatePomodoroHint();
    });
    
    // 全天任务选择
    document.getElementById('isAllDay')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        // 全天任务自动分配8个番茄钟（约4小时专注时间）
        const pomInput = document.getElementById('taskPomodoros');
        if (pomInput) pomInput.value = 'auto';
        document.querySelectorAll('.pomodoro-btn').forEach(b => b.classList.remove('active'));
        const autoBtn = document.querySelector('[data-pomodoros="auto"]');
        if (autoBtn) autoBtn.classList.add('active');
        const durInput = document.getElementById('taskDuration');
        if (durInput) durInput.value = 480; // 8小时
        this.updatePomodoroHint();
      }
    });

    // 任务类型切换（手动/AI小助手）
    document.getElementById('taskType')?.addEventListener('change', (e) => {
      const aiGroup = document.getElementById('aiExpertGroup');
      if (aiGroup) {
        aiGroup.classList.toggle('hidden', e.target.value !== 'ai_scheduled');
      }
      // 填充专家选择列表
      if (e.target.value === 'ai_scheduled') {
        this._populateExpertSelect();
        // AI 小助手模式默认取消同步日历
        const syncCal = document.getElementById('syncCalendar');
        if (syncCal) syncCal.checked = false;
      } else {
        // 手动待办模式默认勾选同步日历
        const syncCal = document.getElementById('syncCalendar');
        if (syncCal) syncCal.checked = true;
      }
    });
    
    // 周期性重复选项切换
    document.getElementById('taskRecurrence')?.addEventListener('change', () => this._updateRecurrenceUI());
    document.querySelectorAll('.weekday-btn').forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('active'));
    });
    document.getElementById('recurrenceEndDate')?.addEventListener('change', () => {});
    
    document.querySelector('.modal-overlay')?.addEventListener('click', () => this.hideTaskModal());
    
    document.addEventListener('showTaskModal', (e) => this.showTaskModal(e.detail));
    
    // 初始化 AI 任务输入富文本编辑器
    const aiEditorContainer = document.getElementById('aiTaskInputEditor');
    if (aiEditorContainer && window.RichEditor) {
      this._aiTaskEditor = new window.RichEditor(aiEditorContainer, {
        placeholder: '输入描述，例如：明天下午给客户发报价... 按 Tab 键 AI 续写 ✨',
        minHeight: 160,
        maxHeight: 400,
        compact: false,
      });
    }
    
    // 新建/编辑笔记弹窗
    document.getElementById('closeNoteEditorBtn')?.addEventListener('click', () => this.hideNoteEditorModal());
    document.getElementById('cancelNoteEditor')?.addEventListener('click', () => this.hideNoteEditorModal());
    document.getElementById('saveNoteEditor')?.addEventListener('click', () => this.saveNoteFromEditor());
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideTaskModal();
        this.hideClipboardDetector();
        this.hideSettingsModal();
        this.hidePromptEditor();
        this.hideOptimizerDetail();
        this.hideNoteEditorModal();
      }
    });
    
    // 设置相关事件
    document.getElementById('openSettingsBtn')?.addEventListener('click', () => this.showSettingsModal());
    document.getElementById('closeSettingsBtn')?.addEventListener('click', () => this.hideSettingsModal());
    document.getElementById('saveSettingsBtn')?.addEventListener('click', () => this.saveSettings());

    // 侧边栏收起/展开
    this._initSidebarToggle();

    // v2.4 拖拽导入多模态文件
    const mainView = document.querySelector('.main-view');
    if (mainView) {
      mainView.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      mainView.addEventListener('drop', async (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length === 0) return;

        // 只在洞察视图时处理（insightView 自身的 drop handler 会 e.stopPropagation()，
        // 所以这里只在文件直接拖到 insightView 外部区域时触发）
        const insightView = document.getElementById('insightView');
        if (insightView && !insightView.classList.contains('hidden') && window.Insight) {
          // 使用 insight 的 buffer 导入方式（file.path 在渲染进程可能为空）
          await Insight._importDroppedFiles(e.dataTransfer.files);
        }
      });
    }

    // 语言切换按钮
    document.getElementById('langToggleBtn')?.addEventListener('click', () => {
      if (window.i18n) {
        window.i18n.toggle();
      }
    });

    // 头部登录按钮：打开独立登录弹窗
    document.getElementById('headerLoginBtn')?.addEventListener('click', () => {
      this.showLoginModal();
    });

    // 头部用户徽章：点击打开独立登录弹窗
    document.getElementById('headerUserBadge')?.addEventListener('click', () => {
      this.showLoginModal();
    });

    // 登录弹窗关闭按钮
    document.getElementById('closeLoginBtn')?.addEventListener('click', () => {
      this.hideLoginModal();
    });

    // 登录弹窗 overlay 点击关闭
    document.querySelector('#loginModal .modal-overlay')?.addEventListener('click', () => {
      this.hideLoginModal();
    });

    // 环境选择变化
    document.getElementById('loginEnv')?.addEventListener('change', (e) => {
      const env = e.target.value;
      const hint = document.getElementById('loginEnvHint');
      const accountLabel = document.querySelector('label[for="loginAccount"]');
      const accountInput = document.getElementById('loginAccount');

      if (env === 'production') {
        if (hint) hint.textContent = '正式环境：ADPToolkit';
        if (accountLabel) accountLabel.textContent = '账号';
        if (accountInput) accountInput.placeholder = '用户名 / 手机号 / 邮箱';
      } else {
        if (hint) hint.textContent = '测试环境：ADPToolkit';
        if (accountLabel) accountLabel.textContent = '账号';
        if (accountInput) accountInput.placeholder = '用户名 / 手机号 / 邮箱';
      }
    });
    document.getElementById('resetPromptBtn')?.addEventListener('click', () => this.resetAIPrompt());
    document.getElementById('clearClipboardHashesBtn')?.addEventListener('click', () => this.clearClipboardHashes());
    document.getElementById('clearAPIKeyBtn')?.addEventListener('click', () => this.clearAPIKey());
    document.getElementById('testLLMBtn')?.addEventListener('click', () => this._testLLMConnection('lowvol'));
    document.getElementById('testHighvolLLMBtn')?.addEventListener('click', () => this._testLLMConnection('highvol'));
    document.getElementById('testCCBtn')?.addEventListener('click', () => this._testCCConnection());
    // OpenRouter 测试连接
    document.getElementById('testOpenRouterBtn')?.addEventListener('click', () => this._testOpenRouterConnection());
    // OpenRouter 刷新模型列表
    document.getElementById('ccOpenRouterRefreshBtn')?.addEventListener('click', () => {
      const providerId = document.getElementById('ccProviderSelect')?.value || '';
      this._updateModelSelectorForProvider(providerId);
    });
    // 滚动快捷按钮
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      // 缓存 DOM 引用，避免每次滚动都查询
      this._chatScrollEls = {
        container: chatMessages,
        topBtn: document.getElementById('chatScrollTopBtn'),
        bottomBtn: document.getElementById('chatScrollBottomBtn')
      };
      // 节流：requestAnimationFrame 合并高频滚动
      let scrollRafId = null;
      chatMessages.addEventListener('scroll', () => {
        if (scrollRafId) return;
        scrollRafId = requestAnimationFrame(() => {
          scrollRafId = null;
          this._updateScrollButtons();
        });
      });
      // MutationObserver：内容变化时节流检查（流式输出时高频触发）
      let mutRafId = null;
      const observer = new MutationObserver(() => {
        if (mutRafId) return;
        mutRafId = requestAnimationFrame(() => {
          mutRafId = null;
          this._updateScrollButtons();
        });
      });
      observer.observe(chatMessages, { childList: true, subtree: true });
      this._chatMutationObserver = observer;
    }
    document.getElementById('chatScrollTopBtn')?.addEventListener('click', () => {
      const cm = document.getElementById('chatMessages');
      if (cm) cm.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.getElementById('chatScrollBottomBtn')?.addEventListener('click', () => {
      const cm = document.getElementById('chatMessages');
      if (cm) cm.scrollTo({ top: cm.scrollHeight, behavior: 'smooth' });
    });
    // CC 手动同步记忆
    document.getElementById('ccSyncMemoryBtn')?.addEventListener('click', async () => {
      const result = await window.electronAPI?.ccSyncMemory?.();
      const resultEl = document.getElementById('ccSyncMemoryResult');
      if (resultEl) {
        resultEl.innerHTML = result?.success
          ? '<span style="color: var(--success);">✅ 记忆已同步到 CLAUDE.md</span>'
          : `<span style="color: var(--danger);">❌ 同步失败: ${result?.error || '未知错误'}</span>`;
      }
      this.showToast(result?.success ? '记忆已同步' : '同步失败', result?.success ? 'success' : 'error');
    });
    // CC 环境变量动态添加
    document.getElementById('ccAddEnvVarBtn')?.addEventListener('click', () => this._addCCEnvVarRow());
    // CC 环境变量快速预设
    document.getElementById('ccPresetPipMirror')?.addEventListener('click', () => {
      this._addCCEnvVarRow('PIP_INDEX_URL', 'https://pypi.tuna.tsinghua.edu.cn/simple');
      this._addCCEnvVarRow('PIP_TRUSTED_HOST', 'pypi.tuna.tsinghua.edu.cn');
      this.showToast('已添加 pip 清华镜像预设', 'success');
    });
    document.getElementById('ccPresetNpmMirror')?.addEventListener('click', () => {
      this._addCCEnvVarRow('npm_config_registry', 'https://registry.npmmirror.com');
      this.showToast('已添加 npm 淘宝镜像预设', 'success');
    });
    document.getElementById('ccPresetPythonpath')?.addEventListener('click', () => {
      this._addCCEnvVarRow('PYTHONPATH', '');
      this.showToast('已添加 PYTHONPATH 环境变量', 'success');
    });
    document.getElementById('ccPresetNodepath')?.addEventListener('click', () => {
      this._addCCEnvVarRow('NODE_PATH', '');
      this.showToast('已添加 NODE_PATH 环境变量', 'success');
    });
    // CC 运行环境检测
    document.getElementById('ccCheckEnvBtn')?.addEventListener('click', () => this._checkCCEnv());
    // CC 权限模式警告
    document.getElementById('ccPermissionMode')?.addEventListener('change', (e) => {
      const warnEl = document.getElementById('ccPermissionWarn');
      if (warnEl) warnEl.style.display = e.target.value === 'bypassPermissions' ? 'block' : 'none';
    });
    // CC 默认工作目录选择
    document.getElementById('ccPickWorkdirBtn')?.addEventListener('click', async () => {
      const result = await window.electronAPI?.ccPickDirectory?.();
      if (result?.success) {
        document.getElementById('ccDefaultWorkdir').value = result.path;
      }
    });
    // CC 对话工作目录切换
    document.getElementById('ccWorkdirChangeBtn')?.addEventListener('click', async () => {
      console.log('[CC] Workdir change button clicked');
      try {
        const result = await window.electronAPI?.ccPickDirectory?.();
        console.log('[CC] Pick directory result:', result);
        if (result?.success) {
          this._setCCWorkdir(result.path);
        } else if (result?.error) {
          this.showToast('选择目录失败: ' + result.error, 'error');
        }
      } catch (e) {
        console.error('[CC] Pick directory error:', e);
        this.showToast('选择目录异常: ' + e.message, 'error');
      }
    });
    document.getElementById('ccWorkdirResetBtn')?.addEventListener('click', () => {
      this._setCCWorkdir(null);
    });
    // CC Skill 管理（跳转到文档 → Skill 标签）
    document.getElementById('ccSkillManageBtn')?.addEventListener('click', () => {
      // 切换到文档视图
      document.querySelector('.view-tab[data-view="documents"]')?.click();
      // 切换到 Skill 标签
      setTimeout(() => {
        document.querySelector('.doc-cat-tab[data-type="skill"]')?.click();
      }, 100);
    });
    // CC 重启会话（不重启 memora，仅清除 ccSessionId 让下次 query 新建子进程）
    document.getElementById('ccRestartBtn')?.addEventListener('click', async () => {
      if (!confirm('重启 M-Agent 会话将清除当前对话的上下文（安装的 skill 需重启才能生效）。是否继续？')) return;
      await window.electronAPI?.ccNewSession?.();
      // 清除当前会话的 ccSessionId
      if (this._activeSessionId) {
        const session = this._chatSessions.find(s => s.id === this._activeSessionId);
        if (session) {
          session.ccSessionId = null;
          this._saveChatSessions();
        }
      }
      this.showToast('M-Agent 会话已重启，新 skill 将在下次对话生效');
    });
    // Skill 管理事件
    document.getElementById('skillUploadBtn')?.addEventListener('click', () => {
      document.getElementById('skillFileInput')?.click();
    });
    document.getElementById('skillFileInput')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await this._uploadSkill(file);
      e.target.value = ''; // 重置以便重复上传同名文件
    });
    // Skill 拖拽上传
    this._initSkillDragDrop();
    // 连接器管理事件
    this._initConnectorEvents();
    document.getElementById('refreshMemoriesBtn')?.addEventListener('click', () => this.loadMemories());
    document.getElementById('clearAllMemoriesBtn')?.addEventListener('click', () => this.clearAllMemories());
    document.getElementById('addManualMemoryBtn')?.addEventListener('click', () => this.addManualMemory());
    document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportAllData());
    document.getElementById('importDataBtn')?.addEventListener('click', () => this.importDataFile());
    document.getElementById('importConfirmBtn')?.addEventListener('click', () => this.confirmImportData());
    document.getElementById('importCancelBtn')?.addEventListener('click', () => this.cancelImportData());

    // 云同步
    document.getElementById('cloudSyncToggle')?.addEventListener('change', (e) => this._toggleCloudSync(e.target.checked));
    document.getElementById('syncNowBtn')?.addEventListener('click', () => this._syncNow());

    // AI 完成提醒开关
    const chatNotifyToggle = document.getElementById('chatNotifyToggle');
    if (chatNotifyToggle) {
      const stored = localStorage.getItem('memora_chat_notify_enabled');
      chatNotifyToggle.checked = stored !== 'false'; // 默认 true
      chatNotifyToggle.addEventListener('change', (e) => {
        localStorage.setItem('memora_chat_notify_enabled', e.target.checked ? 'true' : 'false');
        this.showToast(e.target.checked ? '🔔 AI 完成提醒已开启' : '🔕 AI 完成提醒已关闭', 'success');
      });
    }
    document.getElementById('syncStatusBtn')?.addEventListener('click', () => this._toggleSyncStatus());
    // 同步范围变更
    ['syncTasks', 'syncNotes', 'syncKnowledge', 'syncClipboard', 'syncConversations'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => this._saveSyncScope());
    });
    // 同步频率变更
    document.querySelectorAll('input[name="syncFrequency"]').forEach(radio => {
      radio.addEventListener('change', (e) => this._saveSyncFrequency(e.target.value));
    });
    document.getElementById('aiOrganizeMemoryBtn')?.addEventListener('click', () => this.aiOrganizeAndAddMemory());
    document.getElementById('aiBatchOrganizeBtn')?.addEventListener('click', () => this.aiBatchOrganizeMemories());
    document.getElementById('memoryTypeFilter')?.addEventListener('change', () => this.loadMemories());
    document.getElementById('memoryBusinessFilter')?.addEventListener('change', () => this.loadMemories());
    document.getElementById('loadMoreMemoriesBtn')?.addEventListener('click', () => {
      this._memoryPage++;
      this.loadMemories(true);
    });
    
    // AI助手相关事件
    document.getElementById('openAIAssistantBtn')?.addEventListener('click', () => this.showAIAssistantView());

    // AI 助手模式切换（Agent/LLM）→ 全局控制 v2.3
    document.getElementById('aiModeAgent')?.addEventListener('click', () => {
      this._setGlobalAIMode('agent');
    });
    document.getElementById('aiModeLLM')?.addEventListener('click', () => {
      this._setGlobalAIMode('llm');
    });
    document.getElementById('aiModeCC')?.addEventListener('click', () => {
      this._setGlobalAIMode('cc');
    });

    // 监听全局模式变更
    if (window.electronAPI?.onGlobalAIModeChanged) {
      window.electronAPI.onGlobalAIModeChanged((mode) => {
        this._aiAssistantMode = mode;
        document.querySelectorAll('.ai-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        // 同步更新 CC 工作目录栏可见性
        this._updateCCWorkdirBar();
      });
    }

    // 聊天消息事件委托：统一处理所有消息内按钮点击（合并原3个分散委托）
    document.getElementById('chatMessages')?.addEventListener('click', async (e) => {
      await this._handleChatClick(e);
    });

    // 任务列表事件委托（避免每次渲染重复绑定 N×7 个监听器）
    const taskListEl = document.getElementById('taskList');
    if (taskListEl) {
      taskListEl.addEventListener('click', (e) => this._handleTaskListClick(e));
      taskListEl.addEventListener('mouseover', (e) => this._handleTaskListMouseOver(e));
      taskListEl.addEventListener('mouseout', (e) => this._handleTaskListMouseOut(e));
      taskListEl.addEventListener('mousemove', (e) => this._handleTaskListMouseMove(e));
    }
    const sortToggleEl = document.getElementById('taskSortToggle');
    if (sortToggleEl) {
      sortToggleEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.sort-btn');
        if (!btn) return;
        this._taskSortBy = btn.dataset.sort;
        sortToggleEl.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderTaskList();
      });
    }

    // 通知铃铛
    document.getElementById('notificationBellBtn')?.addEventListener('click', () => this._toggleNotificationPanel());
    document.getElementById('notificationMarkAllBtn')?.addEventListener('click', () => this._markAllNotificationsRead());
    document.getElementById('notificationClearAllBtn')?.addEventListener('click', () => this._clearAllNotifications());

    // 点击外部关闭通知面板
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('notificationPanel');
      const bellBtn = document.getElementById('notificationBellBtn');
      if (panel && !panel.classList.contains('hidden') && !panel.contains(e.target) && !bellBtn?.contains(e.target)) {
        panel.classList.add('hidden');
      }
    });

    // 通知列表事件委托（点击标记已读 + 删除）
    document.getElementById('notificationPanelBody')?.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.notification-item-delete');
      if (delBtn) {
        e.stopPropagation();
        const id = delBtn.dataset.id;
        const body = document.getElementById('notificationPanelBody');
        const item = delBtn.closest('.notification-item');
        if (item) {
          item.style.transition = 'opacity 0.15s, transform 0.15s';
          item.style.opacity = '0';
          item.style.transform = 'translateX(20px)';
          setTimeout(() => {
            item.remove();
            if (body && body.querySelectorAll('.notification-item').length === 0) {
              body.innerHTML = `<div class="notification-empty">${window.i18n?.t('notification.empty') || '暂无通知'}</div>`;
            }
          }, 150);
        }
        const currentBadge = document.getElementById('notificationBadge');
        const unreadItems = body ? body.querySelectorAll('.notification-item.unread') : [];
        const unreadCount = Math.max(0, unreadItems.length - 1);
        if (currentBadge) {
          if (unreadCount > 0) {
            currentBadge.textContent = unreadCount;
            currentBadge.classList.remove('hidden');
          } else {
            currentBadge.classList.add('hidden');
          }
        }
        if (window.electronAPI?.notificationsMarkRead) {
          window.electronAPI.notificationsMarkRead(id).catch(() => {});
        }
        return;
      }
      const unreadItem = e.target.closest('.notification-item.unread');
      if (unreadItem) {
        if (e.target.closest('.notification-item-delete')) return;
        const id = unreadItem.dataset.id;
        if (window.electronAPI?.notificationsMarkRead) {
          await window.electronAPI.notificationsMarkRead(id);
        }
        unreadItem.classList.remove('unread');
        unreadItem.classList.add('read');
        const currentBadge = document.getElementById('notificationBadge');
        const count = Math.max(0, parseInt(currentBadge?.textContent || '0') - 1);
        if (currentBadge) {
          if (count > 0) {
            currentBadge.textContent = count;
          } else {
            currentBadge.classList.add('hidden');
          }
        }
      }
    });

    // SkillHub 搜索结果事件委托（安装/卸载/详情）
    document.getElementById('skillhubResults')?.addEventListener('click', async (e) => {
      const installBtn = e.target.closest('.skillhub-install-btn');
      if (installBtn) {
        await this._skillhubInstallSkill(installBtn.dataset.slug, installBtn);
        return;
      }
      const uninstallBtn = e.target.closest('.skillhub-uninstall-btn');
      if (uninstallBtn) {
        await this._skillhubUninstallSkill(uninstallBtn.dataset.slug, uninstallBtn);
        return;
      }
      // 已安装的 SkillHub 技能点击查看详情
      const detailTarget = e.target.closest('[data-skill-detail]');
      if (detailTarget) {
        const skillName = detailTarget.dataset.skillDetail;
        if (skillName) this._showSkillDetail(skillName);
      }
    });

    // 连接器网格事件委托（toggle/edit/delete）
    document.getElementById('connectorGrid')?.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit-id]');
      if (editBtn) { this._openConnectorModal(editBtn.dataset.editId); return; }
      const delBtn = e.target.closest('[data-delete-id]');
      if (delBtn) { this._deleteConnector(delBtn.dataset.deleteId); return; }
    });
    document.getElementById('connectorGrid')?.addEventListener('change', (e) => {
      const toggle = e.target.closest('[data-toggle-id]');
      if (toggle) { this._toggleConnector(toggle.dataset.toggleId, toggle.checked); }
    });

    // CC 连接器列表事件委托（checkbox change）
    document.getElementById('ccConnectorList')?.addEventListener('change', () => {
      this._updateCCConnectorLabel();
    });

    // 聊天附件事件委托（移除/下载）
    document.getElementById('chatAttachments')?.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.attachment-remove');
      if (removeBtn) {
        const idx = parseInt(removeBtn.dataset.idx);
        this._chatAttachments.splice(idx, 1);
        this.renderChatAttachments();
        return;
      }
      const nameEl = e.target.closest('.attachment-name');
      if (nameEl) {
        const idx = parseInt(nameEl.dataset.idx);
        const att = this._chatAttachments[idx];
        if (att) this.downloadAttachment(att);
      }
    });

    // 笔记列表拖拽事件委托（dragstart/dragend）
    document.getElementById('notebookList')?.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.note-item[draggable="true"]');
      if (!item) return;
      if (e.target.classList.contains('note-checkbox')) { e.preventDefault(); return; }
      this._dragNoteId = item.dataset.id;
      this._dragNoteCategory = item.dataset.category;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.id);
      const title = item.querySelector('.note-title')?.textContent || '';
      const category = item.querySelector('.note-category')?.textContent || '';
      const ghost = document.createElement('div');
      ghost.className = 'note-drag-ghost';
      ghost.innerHTML = `<span class="ghost-category">${category}</span><span class="ghost-title">${title}</span>`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 8, 12);
      requestAnimationFrame(() => {
        item.classList.add('dragging-active');
        requestAnimationFrame(() => ghost.remove());
      });
    });
    document.getElementById('notebookList')?.addEventListener('dragend', (e) => {
      const item = e.target.closest('.note-item[draggable="true"]');
      if (!item) return;
      item.classList.remove('dragging', 'dragging-active');
      this._dragNoteId = null;
      this._dragNoteCategory = null;
      document.querySelectorAll('.category-item, .category-item-wrapper').forEach(c => {
        c.classList.remove('drop-target', 'drop-hover');
      });
      document.querySelectorAll('.note-item.merge-drop-target').forEach(n => {
        n.classList.remove('merge-drop-target');
      });
    });

    // 笔记项之间拖拽合并：dragover / dragenter / dragleave / drop
    document.getElementById('notebookList')?.addEventListener('dragover', (e) => {
      const targetItem = e.target.closest('.note-item[draggable="true"]');
      if (!targetItem || !this._dragNoteId) return;
      // 不能拖到自己身上
      if (targetItem.dataset.id === this._dragNoteId) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'merge';
    });
    document.getElementById('notebookList')?.addEventListener('dragenter', (e) => {
      const targetItem = e.target.closest('.note-item[draggable="true"]');
      if (!targetItem || !this._dragNoteId) return;
      if (targetItem.dataset.id === this._dragNoteId) return;
      e.preventDefault();
      // 清除之前的高亮
      document.querySelectorAll('.note-item.merge-drop-target').forEach(n => {
        if (n !== targetItem) n.classList.remove('merge-drop-target');
      });
      targetItem.classList.add('merge-drop-target');
    });
    document.getElementById('notebookList')?.addEventListener('dragleave', (e) => {
      const targetItem = e.target.closest('.note-item[draggable="true"]');
      if (!targetItem) return;
      // 只在真正离开元素时移除高亮（不是进入子元素）
      const rect = targetItem.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        targetItem.classList.remove('merge-drop-target');
      }
    });
    document.getElementById('notebookList')?.addEventListener('drop', async (e) => {
      const targetItem = e.target.closest('.note-item[draggable="true"]');
      if (!targetItem || !this._dragNoteId) return;
      const targetId = targetItem.dataset.id;
      if (targetId === this._dragNoteId) return;
      e.preventDefault();
      e.stopPropagation();
      targetItem.classList.remove('merge-drop-target');
      await this.mergeNotes(this._dragNoteId, targetId);
    });

    // 笔记列表复选框事件委托
    document.getElementById('notebookList')?.addEventListener('change', (e) => {
      const cb = e.target.closest('.note-checkbox');
      if (!cb) return;
      e.stopPropagation();
      const noteItem = cb.closest('.note-item');
      if (cb.checked) noteItem?.classList.add('note-selected');
      else noteItem?.classList.remove('note-selected');
      this.updateNotebookBatchBar();
    });

    // 分类列表拖放目标事件委托（dragover/dragenter/dragleave/drop）
    document.getElementById('categoryList')?.addEventListener('dragover', (e) => {
      const target = e.target.closest('.category-item-wrapper, .category-item');
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
    });
    document.getElementById('categoryList')?.addEventListener('dragenter', (e) => {
      const target = e.target.closest('.category-item-wrapper, .category-item');
      if (!target) return;
      const categoryKey = target.dataset.category;
      if (!categoryKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (categoryKey !== 'all' && categoryKey !== this._dragNoteCategory) {
        target.classList.add('drop-hover');
        const innerItem = target.querySelector('.category-item');
        if (innerItem) innerItem.classList.add('drop-hover');
      }
    });
    document.getElementById('categoryList')?.addEventListener('dragleave', (e) => {
      const target = e.target.closest('.category-item-wrapper, .category-item');
      if (!target) return;
      if (!target.contains(e.relatedTarget)) {
        target.classList.remove('drop-hover');
        const innerItem = target.querySelector('.category-item');
        if (innerItem) innerItem.classList.remove('drop-hover');
      }
    });
    document.getElementById('categoryList')?.addEventListener('drop', async (e) => {
      const target = e.target.closest('.category-item-wrapper, .category-item');
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      target.classList.remove('drop-hover');
      const innerItem = target.querySelector('.category-item');
      if (innerItem) innerItem.classList.remove('drop-hover');
      const noteId = this._dragNoteId;
      const targetCategory = target.dataset.category;
      const oldCategory = this._dragNoteCategory;
      if (!noteId || !targetCategory || targetCategory === 'all' || targetCategory === oldCategory) return;
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.notebookUpdateNote(noteId, { category: targetCategory });
          if (result.success) {
            this.showToast(`已移至「${this.getNoteCategoryLabel(targetCategory)}」`, 'success');
            const activeCat = document.querySelector('.category-item.active')?.dataset.category || 'all';
            this.loadNotes(activeCat);
          }
        }
      } catch (error) {
        console.error('拖拽修改分类失败:', error);
        this.showToast('修改分类失败', 'error');
      }
      this._dragNoteId = null;
      this._dragNoteCategory = null;
    });

    // 监听服务端通知推送
    if (window.electronAPI) {
      window.electronAPI.onNotificationsUpdated?.((data) => {
        this._renderNotifications(data.notifications || [], data.unreadCount || 0);
      });
      // 监听版本更新
      window.electronAPI.onUpdateAvailable?.((data) => {
        if (data.has_update) this._showUpdateModal(data);
      });
    }
    // AI 聊天语音输入按钮
    document.getElementById('chatVoiceBtn')?.addEventListener('click', () => this._toggleChatVoiceInput());

    // v3.1 并行模式切换
    document.getElementById('parallelToggleBtn')?.addEventListener('click', () => this._toggleParallelMode());

    document.getElementById('sendAIMessageBtn')?.addEventListener('click', () => {
      // 用户首次交互时初始化/解锁 AudioContext（规避 autoplay policy）
      this._unlockAudioContext();
      this.sendAIMessage();
    });
    const chatInput = document.getElementById('aiChatInput');
    // IME 组合状态追踪
    let isComposing = false;
    chatInput?.addEventListener('compositionstart', () => { isComposing = true; });
    chatInput?.addEventListener('compositionend', () => { isComposing = false; });
    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        // IME 组合期间（如中文输入法输英文），回车确认输入，不发送
        if (isComposing) return;
        // Ctrl+Enter / Cmd+Enter / Shift+Enter → 显式插入换行
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          const start = chatInput.selectionStart;
          const end = chatInput.selectionEnd;
          const value = chatInput.value;
          chatInput.value = value.substring(0, start) + '\n' + value.substring(end);
          chatInput.selectionStart = chatInput.selectionEnd = start + 1;
          // 触发 input 事件以自动调整高度
          chatInput.dispatchEvent(new Event('input'));
          return;
        }
        // 普通回车发送
        e.preventDefault();
        this._unlockAudioContext();
        this.sendAIMessage();
      }
    });
    chatInput?.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = chatInput.scrollHeight + 'px';
    });
    // 停止生成按钮
    document.getElementById('stopAIMessageBtn')?.addEventListener('click', () => this.stopADPGeneration());
    // 新建对话
    document.getElementById('newChatBtn')?.addEventListener('click', () => this.createNewChatSession());
    // v2.6: 退出群聊
    document.getElementById('exitGroupChatBtn')?.addEventListener('click', () => this._exitGroupChatMode());
    document.getElementById('terminateGroupChatBtn')?.addEventListener('click', () => this._terminateGroupChat());
    // 对话搜索
    const chatSearchInput = document.getElementById('chatSearchInput');
    const chatSearchClear = document.getElementById('chatSearchClear');
    if (chatSearchInput) {
      chatSearchInput.addEventListener('input', (e) => {
        const kw = e.target.value;
        if (chatSearchClear) chatSearchClear.classList.toggle('hidden', !kw);
        this._renderChatSessionList(kw);
      });
      // 回车时也触发搜索
      chatSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          chatSearchInput.value = '';
          if (chatSearchClear) chatSearchClear.classList.add('hidden');
          this._renderChatSessionList();
        }
      });
    }
    if (chatSearchClear) {
      chatSearchClear.addEventListener('click', () => {
        if (chatSearchInput) chatSearchInput.value = '';
        chatSearchClear.classList.add('hidden');
        this._renderChatSessionList();
      });
    }
    // 对话列表点击
    document.getElementById('chatSessionList')?.addEventListener('click', (e) => {
      const item = e.target.closest('.chat-session-item');
      const deleteBtn = e.target.closest('.chat-session-delete');
      if (deleteBtn) {
        e.stopPropagation();
        const sessionId = deleteBtn.dataset.sessionId;
        this.deleteChatSession(sessionId);
        return;
      }
      if (item) {
        this.switchChatSession(item.dataset.sessionId);
      }
    });
    
    // 文件上传
    document.getElementById('chatFileUploadBtn')?.addEventListener('click', () => {
      document.getElementById('chatFileInput')?.click();
    });
    document.getElementById('chatFileInput')?.addEventListener('change', (e) => this.handleChatFileSelect(e));

    // 输入框粘贴文件和图片支持
    document.getElementById('aiChatInput')?.addEventListener('paste', (e) => this.handleChatPaste(e));

    // 搜索知识按钮（剪贴板检测弹窗中）
    document.getElementById('searchKnowledgeBtn')?.addEventListener('click', () => {
      const rawText = document.getElementById('rawText')?.textContent;
      const activeIntent = document.querySelector('.clipboard-intent-tag.active');
      const intent = activeIntent ? activeIntent.dataset.intent : null;
      
      this.hideClipboardDetector();
      this.showKnowledgeView();
      
      // 将剪贴板内容填入搜索框
      if (rawText && document.getElementById('knowledgeSearchInput')) {
        document.getElementById('knowledgeSearchInput').value = rawText;
      }
      
      // 触发综合搜索（ADP语义 + 本地关键词 + 公开API关键词）
      if (rawText && window.knowledgeFollow) {
        setTimeout(() => {
          window.knowledgeFollow.handleSearch(intent);
        }, 300);
      }
    });
    
    // 快捷问题胶囊点击事件
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('quick-capsule')) {
        const question = e.target.dataset.question;
        const category = e.target.dataset.category;
        if (question === '__GENERATE_WEEKLY_REPORT__') {
          this.generateWeeklyReport();
        } else if (question) {
          document.getElementById('aiChatInput').value = question;
          // 招投标和知识助手走 ADP，任务分析走本地 Agent
          this.sendAIMessage(category === 'bidding' || category === 'knowledge' ? 'adp' : 'agent');
        }
      }
      
      // 剪贴板意图标签点击 → 跳转知识跟随页面搜索
      if (e.target.classList.contains('clipboard-intent-tag')) {
        const intent = e.target.dataset.intent;
        const rawText = document.getElementById('rawText')?.textContent;
        this.hideClipboardDetector();
        this.showKnowledgeView();
        if (rawText && document.getElementById('knowledgeSearchInput')) {
          document.getElementById('knowledgeSearchInput').value = rawText;
        }
        if (rawText && window.knowledgeFollow) {
          setTimeout(() => {
            window.knowledgeFollow.handleSearch(intent);
          }, 300);
        }
      }
    });
    
    // 设置标签页切换
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.settings-tab');
        if (tabBtn) this.switchSettingsTab(tabBtn.dataset.tab);
      });
    });
    
    // Phase 3: Prompt 优化器
    document.getElementById('runOptimizerBtn')?.addEventListener('click', () => this.runPromptOptimizer());

    // Prompt 文件管理
    document.getElementById('closePromptEditor')?.addEventListener('click', () => this.hidePromptEditor());
    document.getElementById('promptEditorCancel')?.addEventListener('click', () => this.hidePromptEditor());
    document.getElementById('promptEditorSave')?.addEventListener('click', () => this.savePromptFile());
    document.getElementById('promptFileUploadInput')?.addEventListener('change', (e) => this.handlePromptFileUpload(e));
    document.getElementById('refreshOptimizerHistory')?.addEventListener('click', () => this.loadOptimizerHistory());
    document.getElementById('closeOptimizerDetail')?.addEventListener('click', () => this.hideOptimizerDetail());
    
    // Phase 3: 用户画像
    document.getElementById('addPersonBtn')?.addEventListener('click', () => this.addFrequentPerson());
    document.getElementById('addProjectBtn')?.addEventListener('click', () => this.addActiveProject());
    document.getElementById('generateProfileSuggestionsBtn')?.addEventListener('click', () => this.generateProfileSuggestions());
    document.getElementById('profileImportBtn')?.addEventListener('click', () => this.importProfileWithAI());
    
    // 用户画像面板 - 删除按钮事件委托
    document.getElementById('frequentPersonsList')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('item-remove')) {
        const idx = parseInt(e.target.dataset.index);
        this.removeFrequentPerson(idx);
      }
    });
    document.getElementById('activeProjectsList')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('item-remove')) {
        const idx = parseInt(e.target.dataset.index);
        this.removeActiveProject(idx);
      }
    });
    
    // 记事本相关事件
    document.getElementById('notebookSearchInput')?.addEventListener('input', () => this.searchNotes());
    document.getElementById('notebookSearchBtn')?.addEventListener('click', () => this.searchNotes());
    
    // 记事本批量操作工具栏
    document.getElementById('notebookSelectAll')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.querySelectorAll('.note-checkbox').forEach(cb => {
        cb.checked = checked;
        cb.closest('.note-item')?.classList.toggle('note-selected', checked);
      });
      this.updateNotebookBatchBar();
    });
    document.getElementById('batchSendToADP')?.addEventListener('click', () => this.sendSelectedNotesToADP());
    document.getElementById('batchDownloadMD')?.addEventListener('click', () => this.downloadSelectedNotes());
    document.getElementById('batchCancelSelect')?.addEventListener('click', () => {
      document.querySelectorAll('.note-checkbox').forEach(cb => {
        cb.checked = false;
        cb.closest('.note-item')?.classList.remove('note-selected');
      });
      this.hideNotebookBatchBar();
    });
    
    // 加载自定义分类并渲染侧边栏
    this.loadCustomCategories().then(() => {
      this.renderCategoryList();
    });
    
    // 记事本列表事件委托（处理动态生成的按钮）
    document.getElementById('notebookList')?.addEventListener('click', (e) => {
      // 复选框点击不触发预览展开
      if (e.target.classList.contains('note-checkbox')) return;
      
      const noteItem = e.target.closest('.note-item');
      if (!noteItem) return;
      
      const noteId = noteItem.dataset.id;

      // 点击图片缩略图/预览图区域：不 toggle 预览，仅靠双击打开查看器
      if (e.target.closest('.note-image-thumb') || e.target.closest('.note-preview-image')) {
        return;
      }

      // 如果点击的是分类标签，弹出分类修改
      const categorySpan = e.target.closest('.note-category-clickable');
      if (categorySpan) {
        e.stopPropagation();
        this.changeNoteCategory(noteId, categorySpan.dataset.category);
        return;
      }

      const button = e.target.closest('.note-btn');
      const previewContent = e.target.closest('.note-preview-content');
      const richEditor = e.target.closest('.note-rich-editor');
      
      // 如果点击的是富文本编辑器区域，不折叠
      if (richEditor) return;

      // 如果点击的是按钮
      if (button) {
        e.stopPropagation();
        const action = button.dataset.action;
        console.log('[App] Button clicked, action:', action, 'noteId:', noteId);
        
        switch(action) {
          case 'edit':
            this.editNote(noteId);
            break;
          case 'convert':
            this.convertToTask(noteId);
            break;
          case 'extract':
            this.extractMemory(noteId);
            break;
          case 'download':
            this.downloadNoteAsMarkdown(noteId);
            break;
          case 'delete':
            this.deleteNote(noteId);
            break;
        }
      } 
      // 如果点击的是预览内容区域，复制内容（编辑模式下不触发）
      else if (previewContent) {
        e.stopPropagation();
        const isEditing = noteItem.querySelector('.note-rich-editor');
        if (!isEditing) {
          this.copyNoteFromPreview(noteId);
        }
      }
      else {
        // 点击笔记项展开/收起预览（编辑模式下不折叠）
        const isEditing = noteItem.querySelector('.note-rich-editor');
        if (isEditing) return;
        this.toggleNotePreview(noteId);
      }
    });
    
    // 双击：图片笔记 → 全屏查看；文本笔记 → 编辑模式
    document.getElementById('notebookList')?.addEventListener('dblclick', (e) => {
      // 双击图片缩略图/预览图：全屏查看（无论笔记类型）
      const imageEl = e.target.closest('.note-image-thumb') || e.target.closest('.note-preview-image');
      if (imageEl) {
        const noteItem = e.target.closest('.note-item');
        if (noteItem && noteItem.querySelector('[data-image-path]')) {
          e.stopPropagation();
          e.preventDefault();
          this.openImageModal(noteItem.dataset.id);
          return;
        }
      }
      // 双击纯图片笔记项：全屏查看
      const noteItem = e.target.closest('.note-item');
      if (noteItem && noteItem.dataset.category === 'image') {
        e.stopPropagation();
        e.preventDefault();
        this.openImageModal(noteItem.dataset.id);
        return;
      }
      // 双击文本预览内容：进入编辑模式
      const previewContent = e.target.closest('.note-preview-content');
      if (previewContent) {
        e.stopPropagation();
        const noteId = previewContent.dataset.noteId;
        this.enterEditMode(noteId);
      }
    });
  },

  _settingsTabLoaded: {},

  switchSettingsTab(tabName) {
    if (!tabName) return;
    document.querySelectorAll('.settings-tab').forEach(tab => tab.classList.remove('active'));
    const targetTab = document.querySelector(`[data-tab="${tabName}"]`);
    if (targetTab) targetTab.classList.add('active');
    document.querySelectorAll('.settings-panel').forEach(panel => panel.classList.add('hidden'));
    const targetPanel = document.getElementById(`${tabName}Panel`);
    if (targetPanel) {
      targetPanel.classList.remove('hidden');
    } else {
      console.warn('[Settings] Panel not found:', `${tabName}Panel`);
    }
    
    // 延迟加载：只在首次切换到标签时加载数据
    if (!this._settingsTabLoaded[tabName]) {
      this._settingsTabLoaded[tabName] = true;
      if (tabName === 'llm') this._loadApiConfig();
      if (tabName === 'agent') this._loadAdpConfig();
      if (tabName === 'cc') this._loadCCConfig();
      if (tabName === 'expert') this._loadExpertSettings();
      if (tabName === 'memory') this.loadMemories();
      if (tabName === 'profile') this.loadProfileEditor();
      if (tabName === 'prompt') this.loadPromptFiles();
      if (tabName === 'appearance') this._loadAppearanceSettings();
      if (tabName === 'sync') this._loadSyncSettings();
      if (tabName === 'reminder') this._loadReminderSettings();
      if (tabName === 'context') this._loadContextSettings();
      if (tabName === 'voice') this._loadVoiceSettings();
      if (tabName === 'vector') this._loadVectorPanel();
      if (tabName === 'clipboard') this._loadClipboardConfig();
    }
  },

  // v3.1: 向量数据库面板
  async _loadVectorPanel() {
    const statusEl = document.getElementById('vectorStatusInfo');
    const resultsEl = document.getElementById('vectorResults');
    if (!statusEl) return;

    // 加载状态
    try {
      const status = await window.electronAPI?.vectorStatus?.();
      if (status?.success) {
        const cols = status.collections || {};
        const colInfo = Object.entries(cols).map(([name, info]) =>
          `${name}: ${info.docCount} 条`).join(' | ');
        statusEl.innerHTML = `
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">
            <span>📊 状态: ${status.initialized ? '✅ 已初始化' : '❌ 未初始化'}</span>
            <span>📐 维度: ${status.dimension || 'N/A'}</span>
            <span>📋 ${colInfo}</span>
            <span>⏳ 队列: ${status.queue?.pending || 0} 待处理 / ${status.queue?.totalProcessed || 0} 已完成</span>
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--text-tertiary);">
            <span>🧠 嵌入: ${status.embeddingProvider || 'unknown'} (${status.embeddingDim || 0}d)</span>
            <span>🔍 上下文层: ${status.contextLayerReady ? '✅ 就绪' : '❌ 未就绪'}</span>
            ${status.contextLayerSkipped ? `<span style="color:var(--danger);">⚠️ ${status.contextLayerSkipped}</span>` : ''}
          </div>
        `;
      } else {
        statusEl.textContent = '❌ 向量数据库未初始化';
      }
    } catch (e) {
      statusEl.textContent = '加载状态失败: ' + e.message;
    }

    // 绑定按钮（只绑一次）
    if (!resultsEl._vectorBound) {
      resultsEl._vectorBound = true;

      document.getElementById('vectorBrowseBtn')?.addEventListener('click', async () => {
        const col = document.getElementById('vectorCollectionSelect')?.value || 'notes';
        resultsEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">加载中...</div>';
        try {
          const result = await window.electronAPI?.vectorBrowse?.({ collection: col, limit: 50 });
          if (result?.success) {
            if (result.docs.length === 0) {
              resultsEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">暂无数据</div>';
              return;
            }
            resultsEl.innerHTML = `<div style="margin-bottom:8px;color:var(--text-tertiary);">共 ${result.total} 条，显示前 ${result.docs.length} 条：</div>` +
              result.docs.map((doc, i) => `
                <div style="padding:8px;margin-bottom:4px;border-bottom:1px solid var(--border-light,rgba(0,0,0,0.04));">
                  <div style="font-weight:600;color:var(--text-primary);">${i+1}. ${this.escapeHtml(doc.title)}</div>
                  ${doc.content ? `<div style="color:var(--text-secondary);margin-top:2px;">${this.escapeHtml(doc.content.substring(0, 120))}</div>` : ''}
                  <div style="color:var(--text-tertiary);font-size:11px;margin-top:2px;">
                    ${doc.category ? '分类: ' + doc.category : ''} ${doc.type ? ' | 类型: ' + doc.type : ''} ${doc.status ? ' | 状态: ' + doc.status : ''} ${doc.created_at ? ' | ' + doc.created_at : ''}
                  </div>
                </div>
              `).join('');
          } else {
            resultsEl.innerHTML = '<div style="color:var(--danger);">' + this.escapeHtml(result?.error || '加载失败') + '</div>';
          }
        } catch (e) {
          resultsEl.innerHTML = '<div style="color:var(--danger);">' + e.message + '</div>';
        }
      });

      document.getElementById('vectorSearchBtn')?.addEventListener('click', async () => {
        const query = document.getElementById('vectorSearchInput')?.value?.trim();
        if (!query) return;
        resultsEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">🔍 搜索中...</div>';
        try {
          const result = await window.electronAPI?.vectorDebugSearch?.({ query, topK: 10 });
          if (result?.success) {
            if (result.results.length === 0) {
              resultsEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">无匹配结果</div>';
              return;
            }
            resultsEl.innerHTML = `<div style="margin-bottom:8px;color:var(--text-tertiary);">查询: "${this.escapeHtml(query)}" → ${result.results.length} 条结果：</div>` +
              result.results.map((r, i) => `
                <div style="padding:8px;margin-bottom:4px;border-bottom:1px solid var(--border-light,rgba(0,0,0,0.04));">
                  <div style="font-weight:600;color:var(--text-primary);">
                    ${i+1}. [${Math.round(r.score * 100)}%] ${this.escapeHtml(r.title)}
                    <span style="font-size:10px;color:var(--text-tertiary);margin-left:4px;">${r.source_type} | ${r.match_type}</span>
                  </div>
                  ${r.content_preview ? `<div style="color:var(--text-secondary);margin-top:2px;">${this.escapeHtml(r.content_preview.substring(0, 120))}</div>` : ''}
                </div>
              `).join('');
          } else {
            resultsEl.innerHTML = '<div style="color:var(--danger);">' + this.escapeHtml(result?.error || '搜索失败') + '</div>';
          }
        } catch (e) {
          resultsEl.innerHTML = '<div style="color:var(--danger);">' + e.message + '</div>';
        }
      });

      document.getElementById('vectorRebuildBtn')?.addEventListener('click', async () => {
        if (!confirm('确认重建向量索引？这可能需要几分钟。')) return;
        resultsEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">🔄 重建中...</div>';
        try {
          const result = await window.electronAPI?.vectorRebuild?.();
          if (result?.success) {
            resultsEl.innerHTML = `<div style="color:var(--success);">✅ 重建完成: 笔记 ${result.count?.notes || 0} / 记忆 ${result.count?.memories || 0} / 待办 ${result.count?.tasks || 0}</div>`;
            this._loadVectorPanel(); // 刷新状态
          } else {
            resultsEl.innerHTML = '<div style="color:var(--danger);">' + this.escapeHtml(result?.error || '重建失败') + '</div>';
          }
        } catch (e) {
          resultsEl.innerHTML = '<div style="color:var(--danger);">' + e.message + '</div>';
        }
      });

      // 回车搜索
      document.getElementById('vectorSearchInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('vectorSearchBtn')?.click();
      });
    }
  },

  // v3.1.2: 剪贴板配置面板
  async _loadClipboardConfig() {
    if (!window.electronAPI?.clipboardGetConfig) return;
    try {
      const config = await window.electronAPI.clipboardGetConfig();
      // 功能开关
      document.getElementById('cbFreqEnabled').checked = config.freq_enabled !== false;
      document.getElementById('cbBufferEnabled').checked = config.buffer_enabled !== false;
      document.getElementById('cbAssociationEnabled').checked = config.association_enabled !== false;
      document.getElementById('cbSplitPromptEnabled').checked = config.split_prompt_enabled !== false;
      // 频率配置
      document.getElementById('cbFreqActive').value = config.freq_active ?? 200;
      document.getElementById('cbFreqNormal').value = config.freq_normal ?? 800;
      document.getElementById('cbFreqIdle').value = config.freq_idle ?? 15000;
      document.getElementById('cbFreqDisabled').value = config.freq_disabled ?? 10000;
      // 阈值
      document.getElementById('cbActiveThreshold').value = config.active_threshold ?? 10000;
      document.getElementById('cbIdleThreshold').value = config.idle_threshold ?? 60000;
      // 状态信息
      this._updateClipboardStatus(config);
    } catch (e) {
      console.error('[Clipboard Config] Load failed:', e);
    }

    // 绑定保存/重置按钮（只绑定一次）
    if (!this._cbConfigBound) {
      this._cbConfigBound = true;
      document.getElementById('cbSaveConfigBtn')?.addEventListener('click', () => this._saveClipboardConfig());
      document.getElementById('cbResetConfigBtn')?.addEventListener('click', () => this._resetClipboardConfig());
    }
  },

  async _saveClipboardConfig() {
    const config = {
      clipboard_freq_enabled: document.getElementById('cbFreqEnabled').checked,
      clipboard_buffer_enabled: document.getElementById('cbBufferEnabled').checked,
      clipboard_association_enabled: document.getElementById('cbAssociationEnabled').checked,
      clipboard_split_prompt_enabled: document.getElementById('cbSplitPromptEnabled').checked,
      clipboard_freq_active: parseInt(document.getElementById('cbFreqActive').value) || 200,
      clipboard_freq_normal: parseInt(document.getElementById('cbFreqNormal').value) || 800,
      clipboard_freq_idle: parseInt(document.getElementById('cbFreqIdle').value) || 15000,
      clipboard_freq_disabled: parseInt(document.getElementById('cbFreqDisabled').value) || 10000,
      clipboard_active_threshold: parseInt(document.getElementById('cbActiveThreshold').value) || 10000,
      clipboard_idle_threshold: parseInt(document.getElementById('cbIdleThreshold').value) || 60000,
    };
    try {
      const result = await window.electronAPI.clipboardUpdateConfig(config);
      if (result?.success) {
        this.showToast('剪贴板配置已保存，实时生效');
        this._updateClipboardStatus(config);
      } else {
        this.showToast('保存失败', 'error');
      }
    } catch (e) {
      this.showToast('保存失败: ' + e.message, 'error');
    }
  },

  _resetClipboardConfig() {
    document.getElementById('cbFreqEnabled').checked = true;
    document.getElementById('cbBufferEnabled').checked = true;
    document.getElementById('cbAssociationEnabled').checked = true;
    document.getElementById('cbSplitPromptEnabled').checked = true;
    document.getElementById('cbFreqActive').value = 200;
    document.getElementById('cbFreqNormal').value = 800;
    document.getElementById('cbFreqIdle').value = 15000;
    document.getElementById('cbFreqDisabled').value = 10000;
    document.getElementById('cbActiveThreshold').value = 10000;
    document.getElementById('cbIdleThreshold').value = 60000;
    this._saveClipboardConfig();
  },

  _updateClipboardStatus(config) {
    const el = document.getElementById('cbStatusInfo');
    if (!el) return;
    const mode = config.freq_enabled === false
      ? `🔴 频率控制已关闭（固定 ${config.freq_disabled ?? 10000}ms）`
      : `🟢 动态频率: 活跃 ${config.freq_active ?? 200}ms / 正常 ${config.freq_normal ?? 800}ms / 空闲 ${config.freq_idle ?? 15000}ms`;
    el.innerHTML = `
      <div>当前模式: ${mode}</div>
      <div style="margin-top:4px;">活跃判定: ${config.active_threshold ?? 10000}ms 内有复制 → 活跃 | ${config.idle_threshold ?? 60000}ms 无复制 → 空闲</div>
      <div style="margin-top:4px;">暂存聚合: ${config.buffer_enabled !== false ? '✅ 开启' : '❌ 关闭'} | 关联检测: ${config.association_enabled !== false ? '✅ 开启' : '❌ 关闭'} | 拆分Prompt: ${config.split_prompt_enabled !== false ? '✅ 开启' : '❌ 关闭'}</div>
    `;
  },

  _loadApiConfig() {
    if (!window.electronAPI) return;
    window.electronAPI.getAPIConfig().then(config => {
      document.getElementById('apiBaseUrl').value = config.baseUrl || '';
      document.getElementById('apiModel').value = config.model || '';
      document.getElementById('apiDailyLimit').value = config.dailyLimit || 1000;
      document.getElementById('currentKeyType').textContent = `当前使用: ${config.isCustomKey ? '✏️ 自定义密钥' : (config.fromServer ? '🏢 组织配置' : '📦 内置密钥')}`;
      document.getElementById('currentDailyLimit').textContent = `每日限制: ${config.dailyLimit}次`;

      // 大用量 LLM 配置
      document.getElementById('highvolBaseUrl').value = config.highvolBaseUrl || '';
      document.getElementById('highvolModel').value = config.highvolModel || '';
      document.getElementById('highvolApiKey').value = ''; // 不回显 key

      // v2.0: 登录状态时 API 面板显示提示
      this._updateConfigServerHints(config.fromServer);
    });
  },

  _loadCCConfig() {
    if (!window.electronAPI?.ccGetConfig) return;
    window.electronAPI.ccGetConfig().then(config => {
      document.getElementById('ccBaseUrl').value = config.baseUrl || '';
      document.getElementById('ccModel').value = config.model || '';
      document.getElementById('ccAllowedTools').value = config.allowedTools || '';
      document.getElementById('ccPermissionMode').value = config.permissionMode || 'default';
      document.getElementById('ccMaxTurns').value = config.maxTurns || 50;
      document.getElementById('ccDefaultWorkdir').value = config.defaultWorkdir || '';
      document.getElementById('ccAuthToken').value = ''; // 不回显 token

      // OpenRouter 配置
      document.getElementById('ccOpenRouterBaseUrl').value = config.openRouterBaseUrl || 'https://openrouter.ai/api/v1';
      document.getElementById('ccOpenRouterDefaultModel').value = config.openRouterDefaultModel || '';
      document.getElementById('ccOpenRouterApiKey').value = ''; // 不回显 key
      if (config.openRouterApiKey === '***configured***') {
        const orStatus = document.getElementById('testOpenRouterResult');
        if (orStatus) orStatus.textContent = '✅ API Key 已配置';
      }

      // 加载环境变量列表
      this._renderCCEnvVars(config.envVars || []);

      const statusEl = document.getElementById('ccConfigStatus');
      if (statusEl) {
        statusEl.textContent = `配置状态: ${config.authTokenConfigured ? '✅ 已配置 Token' : '⚠️ 未配置 Token'}`;
      }

      // 缓存默认工作目录，供对话区指示器使用
      this._ccDefaultWorkdir = config.defaultWorkdir || '';
      this._updateCCWorkdirBar();
      // 加载供应商配置
      if (config.providers) {
        this._loadProviderConfigs(config.providers);
      }
      // 初始化供应商选择器（复用已返回的 providers 数据，避免重复 IPC 调用）
      // _initProviderSelector → _updateModelSelectorForProvider 会根据当前供应商加载对应模型列表
      this._initProviderSelector({
        providers: config.providers,
        activeProvider: config.activeProvider,
      });
    });
  },

  /** 加载供应商配置到设置面板 */
  _loadProviderConfigs(providers) {
    for (const p of providers) {
      if (p.config) {
        for (const [key, value] of Object.entries(p.config)) {
          const input = document.getElementById(`provider_${p.id}_${key}`);
          if (input && key !== 'enabled') {
            if (input.type === 'checkbox') {
              input.checked = value === 'true' || value === true;
            } else if (input.tagName === 'SELECT') {
              input.value = value || '';
            } else if (input.type === 'password') {
              // Don't refill password fields, but show status
              input.value = '';
              input.placeholder = value ? '***已配置***' : input.placeholder;
            } else {
              input.value = value || '';
            }
          }
        }
      }
      // 从 fields 数组加载模型选项（含 AI 解析保存的模型列表）
      if (p.fields) {
        const modelField = p.fields.find(f => f.key === 'model');
        if (modelField && modelField.options) {
          this._populateProviderModelSelect(p.id, modelField.options);
          // 恢复选中的值
          const modelSelect = document.getElementById(`provider_${p.id}_model`);
          if (modelSelect && modelField.value) {
            modelSelect.value = modelField.value;
          }
        }
      }
      // 显示已解析模型数量
      if (p.fields) {
        const modelField = p.fields.find(f => f.key === 'model');
        const parseStatusEl = document.getElementById(`provider_${p.id}_parseStatus`);
        if (parseStatusEl && modelField && modelField.options && modelField.options.length > 0) {
          // 检查是否是 AI 解析的模型（非默认数量）
          const parseHint = parseStatusEl;
          if (modelField.options.length > 1 || (modelField.options.length === 1 && modelField.options[0].value !== 'auto' && modelField.options[0].value !== 'deepseek-chat' && modelField.options[0].value !== 'tc-code-latest')) {
            parseHint.textContent = `✅ 已解析 ${modelField.options.length} 个模型`;
            parseHint.style.color = 'var(--success-color, #34C759)';
          }
        }
      }
      // Update status badge
      const statusEl = document.getElementById(`providerStatus${p.id.charAt(0).toUpperCase() + p.id.slice(1)}`);
      if (statusEl) {
        if (p.configured) {
          statusEl.textContent = '✓ 已配置';
          statusEl.classList.add('configured');
        } else {
          statusEl.textContent = '未配置';
          statusEl.classList.remove('configured');
        }
      }
    }

    // Init provider card toggle events
    this._initProviderCardEvents();
    // Init model parse buttons
    this._initModelParseButtons();
  },

  /** 初始化供应商卡片折叠/展开和测试连接 */
  _initProviderCardEvents() {
    // Card header toggle
    document.querySelectorAll('.provider-card-header').forEach(header => {
      // Remove existing listeners by cloning
      const newHeader = header.cloneNode(true);
      header.parentNode.replaceChild(newHeader, header);
      newHeader.addEventListener('click', () => {
        const providerId = newHeader.dataset.provider;
        const card = newHeader.closest('.provider-card');
        const body = card.querySelector('.provider-card-body');
        if (body) {
          body.classList.toggle('hidden');
          card.classList.toggle('expanded');
        }
      });
    });

    // Test buttons
    document.querySelectorAll('.provider-test-btn').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const providerId = newBtn.dataset.provider;
        newBtn.textContent = '⏳ 测试中...';
        newBtn.disabled = true;
        try {
      // Collect current values
      await this._saveProviderConfigs();
          const result = await window.electronAPI.ccTestProvider({ providerId });
          if (result.success) {
            newBtn.textContent = '✅ 连接成功';
            this.showToast(result.message || '连接成功', 'success');
          } else {
            newBtn.textContent = '🔗 测试连接';
            this.showToast(result.error || '连接失败', 'error');
          }
        } catch (e) {
          newBtn.textContent = '🔗 测试连接';
          this.showToast(`测试失败: ${e.message}`, 'error');
        } finally {
          newBtn.disabled = false;
          setTimeout(() => { newBtn.textContent = '🔗 测试连接'; }, 3000);
        }
      });
    });
  },

  /** 初始化模型列表 AI 解析按钮 */
  _initModelParseButtons() {
    document.querySelectorAll('.provider-parse-models-btn').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const providerId = newBtn.dataset.provider;
        const textarea = document.getElementById(`provider_${providerId}_modelList`);
        const statusEl = document.getElementById(`provider_${providerId}_parseStatus`);
        if (!textarea || !textarea.value.trim()) {
          this.showToast('请先粘贴模型列表文本', 'error');
          return;
        }
        newBtn.textContent = '⏳ 解析中...';
        newBtn.disabled = true;
        if (statusEl) { statusEl.textContent = 'AI 解析中...'; statusEl.style.color = ''; }
        try {
          const result = await window.electronAPI.ccParseModels({
            providerId,
            text: textarea.value,
          });
          if (result.success && result.models) {
            // 填充模型下拉框
            this._populateProviderModelSelect(providerId, result.models);
            if (statusEl) {
              statusEl.textContent = `✅ 已解析 ${result.models.length} 个模型`;
              statusEl.style.color = 'var(--success-color, #34C759)';
            }
            this.showToast(`成功解析 ${result.models.length} 个模型`, 'success');
          } else {
            if (statusEl) {
              statusEl.textContent = `❌ ${result.error || '解析失败'}`;
              statusEl.style.color = 'var(--error-color, #FF3B30)';
            }
            this.showToast(result.error || 'AI 解析失败', 'error');
          }
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = `❌ ${err.message}`;
            statusEl.style.color = 'var(--error-color, #FF3B30)';
          }
          this.showToast(`解析失败: ${err.message}`, 'error');
        } finally {
          newBtn.textContent = '🤖 AI 解析模型';
          newBtn.disabled = false;
        }
      });
    });
  },

  /** 填充供应商模型下拉框（设置面板内） */
  _populateProviderModelSelect(providerId, models) {
    const select = document.getElementById(`provider_${providerId}_model`);
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = '';
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      select.appendChild(opt);
    }
    // 尝试恢复之前选中的值
    if (currentValue && [...select.options].some(o => o.value === currentValue)) {
      select.value = currentValue;
    }
  },
  async _saveProviderConfigs() {
    if (!window.electronAPI?.ccSetConfig) return;
    const providers = {};
    const providerIds = ['volcano', 'volcano_agent', 'deepseek', 'tencent'];
    for (const id of providerIds) {
      const config = {};
      const fields = document.querySelectorAll(`[id^="provider_${id}_"]`);
      fields.forEach(field => {
        const key = field.id.replace(`provider_${id}_`, '');
        if (!key) return;
        // 密码字段为空时跳过，避免用空字符串覆盖已保存的值
        // （页面加载时密码不回显，password 字段值为空不代表用户要清除）
        if (field.type === 'password' && !field.value.trim()) return;
        // checkbox 字段用 checked 状态
        if (field.type === 'checkbox') {
          config[key] = field.checked ? 'true' : 'false';
          return;
        }
        config[key] = field.value;
      });
      providers[id] = config;
    }
    await window.electronAPI.ccSetConfig({ providers });
  },

  /** 渲染 CC 环境变量列表 */
  _renderCCEnvVars(envVars) {
    const list = document.getElementById('ccEnvVarsList');
    if (!list) return;
    list.innerHTML = '';
    if (!envVars || envVars.length === 0) return;
    for (const v of envVars) {
      this._addCCEnvVarRow(v.key, v.value);
    }
  },

  /** 添加一行环境变量 */
  _addCCEnvVarRow(key = '', value = '') {
    const list = document.getElementById('ccEnvVarsList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'cc-env-var-row';
    row.innerHTML = `
      <input type="text" class="cc-env-var-key" placeholder="变量名（如 FIRECRAWL_API_KEY）" value="${this.escapeHtml(key)}">
      <input type="password" class="cc-env-var-value" placeholder="变量值" value="${this.escapeHtml(value)}">
      <button class="cc-env-var-del" title="删除">✕</button>
    `;
    row.querySelector('.cc-env-var-del').addEventListener('click', () => row.remove());
    list.appendChild(row);
  },

  /** 收集环境变量列表 */
  _collectCCEnvVars() {
    const list = document.getElementById('ccEnvVarsList');
    if (!list) return [];
    const rows = list.querySelectorAll('.cc-env-var-row');
    const vars = [];
    rows.forEach(row => {
      const key = row.querySelector('.cc-env-var-key')?.value.trim();
      const value = row.querySelector('.cc-env-var-value')?.value;
      if (key) vars.push({ key, value: value || '' });
    });
    return vars;
  },

  /** 检测 CC 工作目录的运行时环境 */
  async _checkCCEnv() {
    const btn = document.getElementById('ccCheckEnvBtn');
    const statusEl = document.getElementById('ccCheckEnvStatus');
    const resultEl = document.getElementById('ccEnvCheckResult');

    if (!btn || !window.electronAPI?.ccCheckEnv) {
      this.showToast('当前版本不支持环境检测');
      return;
    }

    btn.disabled = true;
    if (statusEl) statusEl.textContent = '检测中...';
    if (resultEl) resultEl.style.display = 'none';

    try {
      const workdir = document.getElementById('ccDefaultWorkdir')?.value.trim() || undefined;
      const result = await window.electronAPI.ccCheckEnv(workdir);

      if (!result?.success) {
        if (statusEl) statusEl.textContent = '检测失败';
        this.showToast('环境检测失败', 'error');
        return;
      }

      // 缓存检测结果供安装使用
      this._ccEnvResult = result;

      // 构建检测结果 HTML
      const categoryLabels = {
        python: 'Python',
        node: 'Node.js',
        java: 'Java',
        go: 'Go',
        rust: 'Rust',
        vcs: '版本控制',
        net: '网络工具',
        util: '实用工具',
        db: '数据库',
        build: '编译工具',
      };

      const missingTools = result.tools.filter(t => !t.available && t.install);

      let html = `<div class="cc-env-check">`;
      html += `<div class="cc-env-check-header">工作目录: ${this.escapeHtml(result.workdir)}</div>`;

      // 一键安装全部缺失项
      if (missingTools.length > 0) {
        html += `<div class="cc-env-check-install-all">`;
        html += `<span class="cc-env-check-missing-count">${missingTools.length} 项缺失</span>`;
        html += `<button class="cc-env-install-all-btn" id="ccInstallAllBtn">一键安装缺失项</button>`;
        html += `</div>`;
      }

      // 工具检测结果
      for (const [cat, tools] of Object.entries(result.grouped)) {
        html += `<div class="cc-env-check-group">`;
        html += `<div class="cc-env-check-group-title">${categoryLabels[cat] || cat}</div>`;
        for (const t of tools) {
          const status = t.available ? 'ok' : 'missing';
          const icon = t.available ? '✓' : '✗';
          html += `<div class="cc-env-check-tool cc-env-${status}" data-tool-name="${this.escapeHtml(t.name)}">`;
          html += `<span class="cc-env-check-icon">${icon}</span>`;
          html += `<span class="cc-env-check-name">${this.escapeHtml(t.name)}</span>`;
          if (t.available && t.version) {
            html += `<span class="cc-env-check-version">${this.escapeHtml(t.version)}</span>`;
          } else if (t.install) {
            html += `<span class="cc-env-check-version">未安装</span>`;
            html += `<button class="cc-env-install-btn" data-tool="${this.escapeHtml(t.name)}" data-brew="${this.escapeHtml(t.install.brew)}" title="${this.escapeHtml(t.install.desc)}">安装</button>`;
          } else {
            html += `<span class="cc-env-check-version">未安装（随其他工具附带）</span>`;
          }
          html += `</div>`;
        }
        html += `</div>`;
      }

      // 环境变量
      const envVarEntries = Object.entries(result.envVars || {});
      if (envVarEntries.length > 0) {
        html += `<div class="cc-env-check-group">`;
        html += `<div class="cc-env-check-group-title">关键环境变量</div>`;
        for (const [key, value] of envVarEntries) {
          const displayValue = value.length > 60 ? value.substring(0, 60) + '...' : value;
          html += `<div class="cc-env-check-envvar">`;
          html += `<span class="cc-env-check-envkey">${this.escapeHtml(key)}</span>`;
          html += `<span class="cc-env-check-envval" title="${this.escapeHtml(value)}">${this.escapeHtml(displayValue)}</span>`;
          html += `</div>`;
        }
        html += `</div>`;
      }

      // 安装日志区域
      html += `<div class="cc-env-install-log" id="ccInstallLog" style="display:none;"></div>`;

      html += `</div>`;

      if (resultEl) {
        resultEl.innerHTML = html;
        resultEl.style.display = 'block';
      }
      if (statusEl) {
        const available = result.tools.filter(t => t.available).length;
        const total = result.tools.length;
        statusEl.textContent = `检测完成: ${available}/${total} 工具可用`;
      }

      // 绑定安装按钮事件
      resultEl?.querySelectorAll('.cc-env-install-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const toolName = e.target.dataset.tool;
          const brewPkg = e.target.dataset.brew;
          this._installTool(toolName, brewPkg);
        });
      });

      // 绑定一键安装按钮
      const installAllBtn = resultEl?.querySelector('#ccInstallAllBtn');
      installAllBtn?.addEventListener('click', () => this._installAllMissing(missingTools));

    } catch (e) {
      if (statusEl) statusEl.textContent = '检测异常: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  },

  /** 安装单个工具 */
  async _installTool(toolName, brewPackage) {
    if (!window.electronAPI?.ccInstallTool) {
      this.showToast('当前版本不支持工具安装', 'error');
      return;
    }

    const workdir = document.getElementById('ccDefaultWorkdir')?.value.trim() || undefined;
    const logEl = document.getElementById('ccInstallLog');
    const installBtns = document.querySelectorAll(`.cc-env-install-btn[data-tool="${toolName}"]`);

    // 禁用按钮，显示安装中
    installBtns.forEach(b => { b.disabled = true; b.textContent = '安装中...'; });
    if (logEl) {
      logEl.style.display = 'block';
      logEl.innerHTML = `<div class="cc-env-install-log-entry"><span class="cc-env-install-log-tool">${this.escapeHtml(toolName)}</span> <span class="cc-env-install-log-status">安装中...</span></div>`;
    }

    // 监听安装进度
    let progressHandler = null;
    if (window.electronAPI?.onCCInstallProgress) {
      window.electronAPI.onCCInstallProgress((data) => {
        if (data.toolName === toolName && logEl) {
          const entry = logEl.querySelector(`.cc-env-install-log-entry[data-tool="${toolName}"]`);
          if (entry) {
            // 追加进度行
            const lines = (data.data || '').trim().split('\n').filter(l => l.trim());
            for (const line of lines.slice(-3)) {
              const lineEl = document.createElement('div');
              lineEl.className = 'cc-env-install-log-line';
              lineEl.textContent = line;
              entry.appendChild(lineEl);
            }
            entry.scrollTop = entry.scrollHeight;
          }
        }
      });
    }

    try {
      const result = await window.electronAPI.ccInstallTool({ toolName, brewPackage, workdir });
      const entry = logEl?.querySelector(`.cc-env-install-log-entry[data-tool="${toolName}"]`);
      if (result.success) {
        installBtns.forEach(b => { b.textContent = '已安装'; b.classList.add('installed'); });
        if (entry) {
          const statusEl = entry.querySelector('.cc-env-install-log-status');
          if (statusEl) { statusEl.textContent = '安装成功'; statusEl.className = 'cc-env-install-log-status cc-env-install-success'; }
        }
        this.showToast(`${toolName} 安装成功`, 'success');
      } else {
        installBtns.forEach(b => { b.disabled = false; b.textContent = '安装'; });
        if (entry) {
          const statusEl = entry.querySelector('.cc-env-install-log-status');
          if (statusEl) { statusEl.textContent = result.error || result.message || '安装失败'; statusEl.className = 'cc-env-install-log-status cc-env-install-failed'; }
        }
        this.showToast(result.error || result.message || `${toolName} 安装失败`, 'error');
      }
    } catch (e) {
      installBtns.forEach(b => { b.disabled = false; b.textContent = '安装'; });
      this.showToast(`${toolName} 安装异常: ${e.message}`, 'error');
    } finally {
      // 移除进度监听
      if (window.electronAPI?.removeCCInstallProgressListeners) {
        window.electronAPI.removeCCInstallProgressListeners();
      }
    }
  },

  /** 一键安装所有缺失工具 */
  async _installAllMissing(missingTools) {
    const installAllBtn = document.getElementById('ccInstallAllBtn');
    if (installAllBtn) { installAllBtn.disabled = true; installAllBtn.textContent = '安装中...'; }

    let successCount = 0;
    let failCount = 0;

    for (const tool of missingTools) {
      // 跳过没有安装信息的工具
      if (!tool.install) continue;

      const btns = document.querySelectorAll(`.cc-env-install-btn[data-tool="${tool.name}"]`);
      btns.forEach(b => { b.disabled = true; b.textContent = '排队中...'; });

      await this._installTool(tool.name, tool.install.brew);

      // 检查结果
      const resultBtn = document.querySelector(`.cc-env-install-btn[data-tool="${tool.name}"]`);
      if (resultBtn && resultBtn.classList.contains('installed')) {
        successCount++;
      } else {
        failCount++;
      }
    }

    if (installAllBtn) {
      installAllBtn.textContent = `完成: ${successCount} 成功, ${failCount} 失败`;
      installAllBtn.disabled = false;
    }

    if (failCount === 0) {
      this.showToast(`全部 ${successCount} 个工具安装成功`, 'success');
    } else {
      this.showToast(`${successCount} 成功, ${failCount} 失败，请查看日志`, 'warning');
    }

    // 自动重新检测
    setTimeout(() => this._checkCCEnv(), 1500);
  },

  async _testCCConnection() {
    if (!window.electronAPI?.ccTestConnection) {
      this.showToast('当前版本不支持测试连接');
      return;
    }

    const resultEl = document.getElementById('testCCResult');
    const btnEl = document.getElementById('testCCBtn');

    let baseUrl = document.getElementById('ccBaseUrl').value;
    let authToken = document.getElementById('ccAuthToken').value;
    let model = document.getElementById('ccModel').value;

    // DOM 中 token 密码框不回显已保存值，测试时主进程会自动使用已保存的 token
    if (!authToken || !baseUrl || !model) {
      try {
        const savedConfig = await window.electronAPI.ccGetConfig();
        if (!baseUrl && savedConfig.baseUrl) baseUrl = savedConfig.baseUrl;
        if (!model && savedConfig.model) model = savedConfig.model;
      } catch (e) { /* ignore */ }
    }

    if (!baseUrl || !model) {
      resultEl.innerHTML = '<span style="color: var(--danger);">⚠️ 请先配置 Base URL 和模型名称</span>';
      return;
    }

    btnEl.disabled = true;
    btnEl.textContent = '⏳ 测试中...';
    resultEl.innerHTML = '<span style="color: var(--text-secondary);">连接中...</span>';

    try {
      const result = await window.electronAPI.ccTestConnection({ baseUrl, authToken, model });
      if (result.ok) {
        resultEl.innerHTML = `<span style="color: var(--success);">✅ 连接成功 (${result.latency}ms) · 模型: ${result.model || model} · 回复: "${result.content}"</span>`;
      } else {
        resultEl.innerHTML = `<span style="color: var(--danger);">❌ 连接失败: ${this.escapeHtml(result.error)}</span>`;
      }
    } catch (err) {
      resultEl.innerHTML = `<span style="color: var(--danger);">❌ 请求异常: ${this.escapeHtml(err.message)}</span>`;
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = '🔗 测试连接';
    }
  },

  _loadExpertSettings() {
    if (!window.ExpertSettings) return;
    window.ExpertSettings.init();
    window.ExpertSettings.render();
  },

  _loadAdpConfig() {
    if (!window.electronAPI) return;
    window.electronAPI.getADPConfig().then(config => {
      console.log('[ADP Config] Loaded config, fromServer:', config.fromServer, 'tcSecretId:', config.tcSecretId ? '✅有值' : '❌空', 'botBizId:', config.botBizId ? '✅有值' : '❌空');
      document.getElementById('adpAppKey').value = config.appKey || '';
      document.getElementById('adpKnowledgeAppKey').value = config.knowledgeAppKey || '';
      document.getElementById('adpSearchAppKey').value = config.searchAppKey || '';
      document.getElementById('adpClusteringAppKey').value = config.clusteringAppKey || '';
      document.getElementById('adpGraphAppKey').value = config.graphAppKey || '';
      document.getElementById('adpActivationAppKey').value = config.activationAppKey || '';
      document.getElementById('adpEvolutionAppKey').value = config.evolutionAppKey || '';
      document.getElementById('adpConflictAppKey').value = config.conflictAppKey || '';
      document.getElementById('fileShareApiKey').value = config.fileShareApiKey || '';
      document.getElementById('adpTcSecretId').value = config.tcSecretId || '';
      document.getElementById('adpTcSecretKey').value = config.tcSecretKey || '';
      document.getElementById('adpBotBizId').value = config.botBizId || '';
      // SecretKey 不回显明文，用占位符提示是否已配置
      const secretKeyInput = document.getElementById('adpTcSecretKey');
      if (config.tcSecretKeyConfigured) {
        secretKeyInput.placeholder = '已配置（密钥不回显）';
        secretKeyInput.value = '••••••••';
      } else {
        secretKeyInput.placeholder = '在腾讯云控制台「访问管理 → API密钥管理」获取';
      }
      document.getElementById('adpUrl').value = config.url || '';
      document.getElementById('adpAgentName').value = config.agentName || '';
      
      // === 高阶配置卡片状态 ===
      const src = config.configSource || {};
      const hasCustomAgentKey = ['knowledgeAppKey','searchAppKey','clusteringAppKey','graphAppKey','activationAppKey','evolutionAppKey','conflictAppKey'].some(k => src[k] === 'custom' || src[k] === 'server');
      const advCard = document.getElementById('agentAdvancedCard');
      const advBadge = document.getElementById('agentAdvancedBadge');
      if (advCard) {
        if (hasCustomAgentKey) {
          advCard.classList.add('has-custom');
          if (advBadge) advBadge.textContent = '已自定义部分 Agent';
        } else {
          advCard.classList.remove('has-custom');
          if (advBadge) advBadge.textContent = '各 Agent 独立配置';
        }
        // 有自定义配置时自动展开，否则折叠
        if (hasCustomAgentKey) {
          advCard.classList.add('expanded');
        } else {
          advCard.classList.remove('expanded');
        }
      }
      // 显示通用 AppKey 自动应用提示
      const autoFillHint = document.getElementById('adpAutoFillHint');
      if (autoFillHint) {
        autoFillHint.style.display = (config.appKey && !hasCustomAgentKey) ? 'block' : 'none';
      }
      
      // 显示详细配置来源信息
      const sourceLabel = { server: '🏢 组织配置', custom: '✏️ 自定义', default: '📦 内置默认' };
      const appKeySrc = sourceLabel[src.appKey] || '未知';
      const knowledgeSrc = sourceLabel[src.knowledgeAppKey] || '未知';
      const searchSrc = sourceLabel[src.searchAppKey] || '未知';
      const clusteringSrc = sourceLabel[src.clusteringAppKey] || '未知';
      const graphSrc = sourceLabel[src.graphAppKey] || '未知';
      const activationSrc = sourceLabel[src.activationAppKey] || '未知';
      const evolutionSrc = sourceLabel[src.evolutionAppKey] || '未知';
      const conflictSrc = sourceLabel[src.conflictAppKey] || '未知';
      const fileShareSrc = sourceLabel[src.fileShareApiKey] || '未知';
      const tcCredsConfigured = config.tcSecretId && config.botBizId;
      const cosSrc = src.tcSecretId === 'server' ? '🏢 组织配置' : (src.tcSecretId === 'local' ? '✏️ 本地配置' : '❌ 未配置');
      document.getElementById('adpConfigStatus').textContent = `通用: ${appKeySrc} | 知识: ${knowledgeSrc} | 搜索: ${searchSrc} | 聚类: ${clusteringSrc} | 图谱: ${graphSrc} | 活化: ${activationSrc} | 演化: ${evolutionSrc} | 冲突: ${conflictSrc} | 文件共享: ${fileShareSrc} | COS上传: ${tcCredsConfigured ? '✅已配置(' + cosSrc + ')' : '❌未配置'}`;
      
      // 更新 COS 配置卡片状态
      const cosBadge = document.getElementById('cosStatusBadge');
      const cosCard = document.getElementById('cosUploadCard');
      if (cosBadge && cosCard) {
        if (tcCredsConfigured) {
          const isServerSource = src.tcSecretId === 'server';
          cosBadge.textContent = '已配置 · ' + (isServerSource ? '组织同步' : '本地');
          cosBadge.classList.add('configured');
          // 添加来源标签
          const existingLabel = cosCard.querySelector('.cos-source-label');
          if (existingLabel) existingLabel.remove();
          const sourceLabelEl = document.createElement('div');
          sourceLabelEl.className = 'cos-source-label';
          sourceLabelEl.textContent = isServerSource ? '🏢 已从组织配置同步，本地修改不会覆盖云端值' : '✏️ 使用本地配置';
          cosCard.querySelector('.cos-upload-body').prepend(sourceLabelEl);
        } else {
          cosBadge.textContent = '未配置';
          cosBadge.classList.remove('configured');
          // 移除来源标签
          const existingLabel = cosCard.querySelector('.cos-source-label');
          if (existingLabel) existingLabel.remove();
        }
      }
      
      // v2.0: 登录状态时 ADP 面板显示提示
      this._updateConfigServerHints(config.fromServer);
    });
  },

  // ===== v2.0 组织配置方法 =====

  _loadOrgConfig() {
    if (!window.electronAPI) return;
    window.electronAPI.authGetState().then(state => {
      this._updateOrgUI(state);
    });
  },

  _updateOrgUI(state) {
    const loginSection = document.getElementById('orgLoginSection');
    const loggedInSection = document.getElementById('orgLoggedInSection');
    
    if (state.isLoggedIn) {
      loginSection.classList.add('hidden');
      loggedInSection.classList.remove('hidden');
      
      // 填充用户信息
      document.getElementById('orgUserName').textContent = state.user?.name || state.user?.email || state.user?.username || '-';
      document.getElementById('orgUserOrg').textContent = state.user?.org_name ? `${state.user.org_name} · ${state.user?.email || state.user?.username}` : (state.user?.email || state.user?.username || '-');
      
      // 环境信息
      this._updateLoginProfileEnv(state.env);

      // 配置来源状态
      this._updateConfigSourceUI(state.forceLocalConfig || false);

      // 恢复记住登录状态
      const rememberCb = document.getElementById('loginRememberMe');
      if (rememberCb) rememberCb.checked = state.rememberMe !== false;

      // 加载服务器配置摘要
      this._loadOrgConfigSummary();

      // 加载服务器地址
      this._loadServerUrls();

      // 管理员显示服务器地址管理区域
      const isAdmin = state.user?.role === 'admin';
      const serverUrlsSection = document.querySelector('.server-urls-section');
      if (serverUrlsSection) {
        if (isAdmin) {
          serverUrlsSection.classList.remove('hidden');
          serverUrlsSection.style.display = '';
        } else {
          serverUrlsSection.classList.add('hidden');
          serverUrlsSection.style.display = 'none';
        }
      }
      // 管理员显示配置来源切换
      const configSourceSection = document.querySelector('.login-profile-config-source');
      if (configSourceSection) {
        if (isAdmin) {
          configSourceSection.classList.remove('hidden');
          configSourceSection.style.display = '';
        } else {
          configSourceSection.classList.add('hidden');
          configSourceSection.style.display = 'none';
        }
      }

      // 更新头部用户徽章
      this._updateHeaderUserBadge(true, state.user);
    } else {
      loginSection.classList.remove('hidden');
      loggedInSection.classList.add('hidden');

      // 确保显示登录表单，隐藏注册表单
      const registerSection = document.getElementById('registerSection');
      const loginCard = loginSection.querySelector('.org-login-card');
      if (registerSection) registerSection.classList.add('hidden');
      if (loginCard) loginCard.classList.remove('hidden');

      // 更新头部用户徽章
      this._updateHeaderUserBadge(false);
    }

    // 更新设置标签可见性
    this._updateSettingsTabVisibility(state.isLoggedIn);
  },

  /** 根据登录状态更新设置标签可见性
   * 未登录只显示：API配置、外观、数据管理、关于
   * 已登录显示全部
   */
  _updateSettingsTabVisibility(isLoggedIn) {
    const hiddenTabsWhenLoggedOut = ['agent', 'prompt', 'profile', 'memory'];
    document.querySelectorAll('.settings-tab').forEach(tab => {
      const tabName = tab.dataset.tab;
      if (hiddenTabsWhenLoggedOut.includes(tabName)) {
        tab.style.display = isLoggedIn ? '' : 'none';
      }
    });
  },

  _updateHeaderUserBadge(isLoggedIn, user) {
    const loginBtn = document.getElementById('headerLoginBtn');
    const userBadge = document.getElementById('headerUserBadge');
    const userAvatar = document.getElementById('headerUserAvatar');
    const userName = document.getElementById('headerUserName');
    const bellBtn = document.getElementById('notificationBellBtn');

    if (isLoggedIn && user) {
      loginBtn?.classList.add('hidden');
      userBadge?.classList.remove('hidden');
      bellBtn?.classList.remove('hidden');
      if (userAvatar) userAvatar.innerHTML = user.avatar ? this.escapeHtml(user.avatar) : this._userAvatarSvg;
      if (userName) userName.textContent = user.name || user.email || user.username || '-';
      // 登录后拉取通知
      this._fetchNotifications();
    } else {
      loginBtn?.classList.remove('hidden');
      userBadge?.classList.add('hidden');
      bellBtn?.classList.add('hidden');
      // 隐藏通知面板
      document.getElementById('notificationPanel')?.classList.add('hidden');
    }
  },

  _updateLoginProfileEnv(env) {
    const envEl = document.getElementById('orgUserEnv');
    if (!envEl) return;
    const serverNames = { beta: 'Beta 测试环境', production: '正式环境' };
    envEl.textContent = serverNames[env] || env || '-';
  },

  async _loadOrgConfigSummary() {
    if (!window.electronAPI) return;
    
    // 从 getAPIConfig 获取当前生效的 API 配置
    const apiConfig = await window.electronAPI.getAPIConfig();
    document.getElementById('orgApiUrl').textContent = apiConfig.baseUrl || '-';
    document.getElementById('orgApiModel').textContent = apiConfig.model || '-';
    document.getElementById('orgApiLimit').textContent = apiConfig.dailyLimit ? `${apiConfig.dailyLimit}次/天` : '-';
    
    // 从 getADPConfig 获取当前生效的 ADP 配置
    const adpConfig = await window.electronAPI.getADPConfig();
    document.getElementById('orgAdpStatus').textContent = adpConfig.appKey ? `✅ ${adpConfig.agentName || '已配置'}` : '❌ 未配置';
    
    // 同步时间
    const now = new Date();
    document.getElementById('orgSyncTime').textContent = `配置同步时间：${now.toLocaleString('zh-CN')}`;
  },

  _updateConfigServerHints(fromServer) {
    const apiHint = document.getElementById('apiServerHint');
    const adpHint = document.getElementById('adpServerHint');
    const apiPanel = document.getElementById('llmPanel');
    const adpPanel = document.getElementById('agentPanel');
    
    if (fromServer) {
      apiHint?.classList.remove('hidden');
      adpHint?.classList.remove('hidden');
      apiPanel?.classList.add('config-locked');
      adpPanel?.classList.add('config-locked');
    } else {
      apiHint?.classList.add('hidden');
      adpHint?.classList.add('hidden');
      apiPanel?.classList.remove('config-locked');
      adpPanel?.classList.remove('config-locked');
    }
  },

  async handleOrgLogin() {
    const account = document.getElementById('loginAccount').value.trim();
    const password = document.getElementById('loginPassword').value;
    const env = document.getElementById('loginEnv')?.value || 'production';
    const rememberMe = document.getElementById('loginRememberMe')?.checked !== false;
    const errorEl = document.getElementById('loginError');
    const btn = document.getElementById('orgLoginBtn');

    if (!account || !password) {
      errorEl.textContent = '请输入账号和密码';
      errorEl.classList.remove('hidden');
      return;
    }

    errorEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = '登录中...';

    try {
      const result = await window.electronAPI.authLogin(account, password, env, rememberMe);

      if (result.success) {
        this._updateOrgUI({ isLoggedIn: true, user: result.user, env: result.env, forceLocalConfig: false });
        this._loadOrgConfigSummary();
        this._updateConfigServerHints(true);
        this._updateHeaderUserBadge(true, result.user);
        this._updateLoginProfileEnv(result.env);
        this.showToast('登录成功，已同步组织配置');

        // 系统通知
        if (window.electronAPI?.showNotification) {
          window.electronAPI.showNotification('忆境 Memora', `欢迎回来，${result.user?.name || result.user?.username || ''}！`);
        }

        // 刷新 API 和 ADP 配置显示
        this._settingsTabLoaded.api = false;
        this._settingsTabLoaded.adp = false;
      } else {
        errorEl.textContent = result.error || '登录失败';
        errorEl.classList.remove('hidden');
      }
    } catch (err) {
      errorEl.textContent = `网络错误: ${err.message || '请检查连接'}`;
      errorEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = '登 录';
    }
  },

  async handleOrgLogout() {
    if (!window.electronAPI) return;

    // 先关闭个人信息编辑区
    const profileEdit = document.getElementById('profileEditSection');
    if (profileEdit) profileEdit.classList.add('hidden');

    const result = await window.electronAPI.authLogout();
    if (result.success) {
      this._updateOrgUI({ isLoggedIn: false });
      this._updateConfigServerHints(false);
      this._updateHeaderUserBadge(false);
      this.showToast('已退出登录，切换到本地配置');

      // 刷新 API 和 ADP 配置显示
      this._settingsTabLoaded.api = false;
      this._settingsTabLoaded.adp = false;
    }
  },

  // ===== 登录后同步 =====

  async _startSyncAfterLogin() {
    if (!SyncEngine) return;
    try {
      // 先注册设备（确保新用户/新设备都能同步）
      await SyncEngine.registerDevice();
      console.log('[App] Device registered after login');
    } catch (err) {
      console.warn('[App] Device registration failed:', err.message);
    }
    // 首次全量同步
    try {
      const result = await SyncEngine.fullSync();
      if (result?.ok) {
        console.log('[App] First sync after login completed');
      }
    } catch (err) {
      console.warn('[App] First sync failed:', err.message);
    }
    // 启动自动同步
    SyncEngine._startAutoSync?.();
  },

  // ===== 注册功能 =====

  showRegisterForm() {
    document.getElementById('orgLoginSection').querySelector('.org-login-card').classList.add('hidden');
    document.getElementById('registerSection').classList.remove('hidden');
    document.getElementById('registerError')?.classList.add('hidden');
  },

  showLoginForm() {
    document.getElementById('registerSection').classList.add('hidden');
    document.getElementById('orgLoginSection').querySelector('.org-login-card').classList.remove('hidden');
    document.getElementById('loginError')?.classList.add('hidden');
  },

  async sendVerifyCode() {
    const mobile = document.getElementById('regMobile').value.trim();
    const btn = document.getElementById('regSendCodeBtn');
    const errorEl = document.getElementById('registerError');

    if (!mobile) {
      errorEl.textContent = '请输入手机号';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(mobile)) {
      errorEl.textContent = '手机号格式不正确';
      errorEl.classList.remove('hidden');
      return;
    }

    errorEl.classList.add('hidden');
    btn.disabled = true;

    try {
      const result = await window.electronAPI.authSendCode(mobile);
      if (result.success) {
        this.showToast('验证码已发送');
        // 开发模式显示验证码提示
        if (result.code) {
          const hintEl = document.getElementById('regDevCodeHint');
          if (hintEl) {
            hintEl.textContent = `开发模式验证码：${result.code}`;
            hintEl.classList.remove('hidden');
          }
          // 自动填充验证码
          const codeInput = document.getElementById('regSmsCode');
          if (codeInput) codeInput.value = result.code;
        }
        // 60s 倒计时
        let countdown = 60;
        btn.textContent = `${countdown}s`;
        const timer = setInterval(() => {
          countdown--;
          if (countdown <= 0) {
            clearInterval(timer);
            btn.disabled = false;
            btn.textContent = '获取验证码';
          } else {
            btn.textContent = `${countdown}s`;
          }
        }, 1000);
      } else {
        errorEl.textContent = result.error || '发送失败';
        errorEl.classList.remove('hidden');
        btn.disabled = false;
      }
    } catch (err) {
      errorEl.textContent = `发送失败: ${err.message}`;
      errorEl.classList.remove('hidden');
      btn.disabled = false;
    }
  },

  async handleRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const mobile = document.getElementById('regMobile').value.trim();
    const smsCode = document.getElementById('regSmsCode').value.trim();
    const name = document.getElementById('regName').value.trim();
    const password = document.getElementById('regPassword').value;
    const passwordConfirm = document.getElementById('regPasswordConfirm').value;
    const nickname = document.getElementById('regNickname').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const env = document.getElementById('loginEnv')?.value || 'production';
    const errorEl = document.getElementById('registerError');
    const btn = document.getElementById('regSubmitBtn');

    // 校验
    if (!username || !mobile || !smsCode || !password) {
      errorEl.textContent = '请填写所有必填项';
      errorEl.classList.remove('hidden');
      return;
    }
    if (password !== passwordConfirm) {
      errorEl.textContent = '两次输入的密码不一致';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!/^[a-zA-Z0-9_-]{2,20}$/.test(username)) {
      errorEl.textContent = '用户名：2-20位，仅限字母/数字/下划线/中划线';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(mobile)) {
      errorEl.textContent = '手机号格式不正确';
      errorEl.classList.remove('hidden');
      return;
    }
    if (password.length < 6) {
      errorEl.textContent = '密码至少6位';
      errorEl.classList.remove('hidden');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = '邮箱格式不正确';
      errorEl.classList.remove('hidden');
      return;
    }

    errorEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = '注册中...';

    try {
      const result = await window.electronAPI.authRegister({
        username, mobile, sms_code: smsCode, name: name || username, password,
        nickname: nickname || '', email, env
      });

      if (result.success) {
        this.showToast('注册成功，已自动登录');
        // 注册成功后自动登录
        this._updateOrgUI({ isLoggedIn: true, user: result.user, env: result.env, forceLocalConfig: false });
        this._loadOrgConfigSummary();
        this._updateConfigServerHints(true);
        this._updateHeaderUserBadge(true, result.user);
        this._updateLoginProfileEnv(result.env);
        // 清空注册表单
        ['regUsername','regMobile','regSmsCode','regName','regPassword','regPasswordConfirm','regNickname','regEmail'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
        document.getElementById('regDevCodeHint')?.classList.add('hidden');
        // 切回登录视图
        this.showLoginForm();
        // 刷新 API 和 ADP 配置显示
        this._settingsTabLoaded.api = false;
        this._settingsTabLoaded.adp = false;
      } else {
        errorEl.textContent = result.error || '注册失败';
        errorEl.classList.remove('hidden');
      }
    } catch (err) {
      errorEl.textContent = `注册失败: ${err.message || '请检查网络'}`;
      errorEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = '注 册';
    }
  },

  async handleConfigSync() {
    if (!window.electronAPI) return;
    
    const result = await window.electronAPI.configSync();
    if (result.success) {
      await this._loadOrgConfigSummary();
      this.showToast('配置已同步');
    } else {
      this.showToast(result.error || '同步失败', 'error');
    }
  },

  async setConfigSource(source) {
    if (!window.electronAPI) return;

    const forceLocal = source === 'local';
    const result = await window.electronAPI.configSetSource(forceLocal);
    if (result.success) {
      this._updateConfigSourceUI(result.forceLocalConfig);
      await this._loadOrgConfigSummary();
      this.showToast(forceLocal ? '已切换到本地配置' : '已切换到云端配置');
    }
  },

  _updateConfigSourceUI(forceLocal) {
    const toggle = document.getElementById('configSourceToggle');
    const hint = document.getElementById('configSourceHint');
    const syncBtn = document.getElementById('syncConfigBtn');
    if (!toggle) return;

    toggle.querySelectorAll('.config-source-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.source === (forceLocal ? 'local' : 'cloud'));
    });

    if (hint) {
      hint.textContent = forceLocal ? '使用本地自定义配置，忽略云端设置' : '使用组织管理员统一配置';
    }

    if (syncBtn) {
      syncBtn.style.opacity = forceLocal ? '0.4' : '1';
      syncBtn.style.pointerEvents = forceLocal ? 'none' : 'auto';
    }
  },

  // ===== 服务器地址管理 =====

  async _loadServerUrls() {
    if (!window.electronAPI?.authGetServerUrls) return;
    try {
      const urls = await window.electronAPI.authGetServerUrls();
      for (const env of ['beta', 'production']) {
        const data = urls[env];
        if (!data) continue;
        const authInput = document.getElementById(`${env}AuthUrl`);
        const configInput = document.getElementById(`${env}ConfigUrl`);
        const hint = document.getElementById(`${env}CustomHint`);
        if (authInput) authInput.value = data.authUrl || '';
        if (configInput) configInput.value = data.configUrl || '';
        if (hint) {
          if (data.isCustom) {
            hint.textContent = '已自定义';
            hint.classList.add('is-custom');
          } else {
            hint.textContent = '默认';
            hint.classList.remove('is-custom');
          }
        }
      }
    } catch (err) {
      console.error('Failed to load server URLs:', err);
    }
  },

  async saveServerUrls() {
    if (!window.electronAPI?.authSetServerUrls) return;
    const btn = document.querySelector('.server-url-save-btn');
    const statusEl = document.getElementById('serverUrlStatus');

    // 收集输入值
    const urls = {};
    for (const env of ['beta', 'production']) {
      const authInput = document.getElementById(`${env}AuthUrl`);
      const configInput = document.getElementById(`${env}ConfigUrl`);
      if (!authInput || !configInput) continue;
      const authUrl = authInput.value.trim();
      const configUrl = configInput.value.trim();
      if (authUrl || configUrl) {
        urls[env] = { authUrl, configUrl };
      }
    }

    if (Object.keys(urls).length === 0) {
      this._showServerUrlStatus('没有修改', 'error');
      return;
    }

    // 显示保存中状态
    if (btn) {
      btn.textContent = '⏳ 验证中...';
      btn.classList.add('saving');
    }
    this._showServerUrlStatus('正在验证服务器连接...', '');

    try {
      const result = await window.electronAPI.authSetServerUrls(urls);
      if (result.success) {
        this._showServerUrlStatus('✅ 验证通过，服务器地址已保存（下次启动生效）', 'success');
        this.showToast('服务器地址已保存');
        // 刷新显示
        await this._loadServerUrls();
      } else {
        this._showServerUrlStatus(`❌ ${result.error}`, 'error');
        // 恢复输入框为当前实际值
        await this._loadServerUrls();
      }
    } catch (err) {
      this._showServerUrlStatus(`❌ 保存失败: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.textContent = '💾 保存并验证';
        btn.classList.remove('saving');
      }
    }
  },

  async resetServerUrls(env) {
    if (!window.electronAPI?.authResetServerUrls) return;
    const label = env === 'all' ? '全部' : (env === 'beta' ? 'Beta' : '正式');
    if (!confirm(`确定要将${label}服务器地址重置为默认值吗？`)) return;

    try {
      const result = await window.electronAPI.authResetServerUrls(env);
      if (result.success) {
        this._showServerUrlStatus('✅ 已重置为默认地址（下次启动生效）', 'success');
        this.showToast(`${label}服务器地址已重置`);
        await this._loadServerUrls();
      } else {
        this._showServerUrlStatus(`❌ 重置失败: ${result.error}`, 'error');
      }
    } catch (err) {
      this._showServerUrlStatus(`❌ 重置失败: ${err.message}`, 'error');
    }
  },

  _showServerUrlStatus(message, type) {
    const el = document.getElementById('serverUrlStatus');
    if (!el) return;
    el.textContent = message;
    el.className = `server-url-status ${type}`;
    el.classList.remove('hidden');
    // 成功消息 5 秒后自动隐藏
    if (type === 'success') {
      setTimeout(() => el.classList.add('hidden'), 5000);
    }
  },

  toggleServerUrlsEdit() {
    const area = document.getElementById('serverUrlsEditArea');
    if (!area) return;
    area.classList.toggle('expanded');
  },

  // === 个人信息编辑 ===

  toggleProfileEdit() {
    const section = document.getElementById('profileEditSection');
    if (!section) return;
    const isHidden = section.classList.contains('hidden');
    if (isHidden) {
      // 打开时填充当前用户信息
      if (window.electronAPI?.authGetState) {
        window.electronAPI.authGetState().then(state => {
          if (state.user) {
            const u = state.user;
            document.getElementById('orgProfileName').value = u.name || '';
            document.getElementById('orgProfileNickname').value = u.nickname || '';
            document.getElementById('orgProfileEmail').value = u.email || '';
            document.getElementById('orgProfileMobile').value = u.mobile || '';
            // 扩展字段
            const genderEl = document.getElementById('orgProfileGender');
            if (genderEl) genderEl.value = u.gender != null ? String(u.gender) : '';
            const birthEl = document.getElementById('orgProfileBirthDate');
            if (birthEl) birthEl.value = u.birth_date || '';
            const professionEl = document.getElementById('orgProfileProfession');
            if (professionEl) professionEl.value = u.profession || '';
            const orgEl = document.getElementById('orgProfileOrganization');
            if (orgEl) orgEl.value = u.organization || '';
            const industryEl = document.getElementById('orgProfileIndustry');
            if (industryEl) industryEl.value = u.industry || '';
            const regionEl = document.getElementById('orgProfileRegion');
            if (regionEl) regionEl.value = u.region || '';
            const addressEl = document.getElementById('orgProfileAddress');
            if (addressEl) addressEl.value = u.address || '';
            const avatarEl = document.getElementById('orgProfileAvatar');
            if (avatarEl) avatarEl.value = u.avatar || '';
          }
        });
      }
    }
    section.classList.toggle('hidden');
  },

  toggleProfileMoreFields() {
    const more = document.getElementById('orgProfileMoreFields');
    const btn = document.getElementById('orgProfileToggleMore');
    if (!more || !btn) return;
    const isHidden = more.classList.contains('hidden');
    more.classList.toggle('hidden');
    btn.textContent = isHidden ? '▲ 收起更多信息' : '▼ 更多信息';
  },

  async saveProfileEdit() {
    const name = document.getElementById('orgProfileName').value.trim();
    const nickname = document.getElementById('orgProfileNickname').value.trim();
    const email = document.getElementById('orgProfileEmail').value.trim();
    const mobile = document.getElementById('orgProfileMobile').value.trim();
    const errorEl = document.getElementById('profileEditError');

    if (mobile && !/^1[3-9]\d{9}$/.test(mobile)) {
      errorEl.textContent = '手机号格式不正确';
      errorEl.classList.remove('hidden');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = '邮箱格式不正确';
      errorEl.classList.remove('hidden');
      return;
    }

    // 收集所有字段
    const profileData = { name, nickname, email, mobile };
    const genderEl = document.getElementById('orgProfileGender');
    if (genderEl && genderEl.value !== '') profileData.gender = parseInt(genderEl.value);
    const birthEl = document.getElementById('orgProfileBirthDate');
    if (birthEl && birthEl.value) profileData.birth_date = birthEl.value;
    const professionEl = document.getElementById('orgProfileProfession');
    if (professionEl && professionEl.value.trim()) profileData.profession = professionEl.value.trim();
    const orgEl = document.getElementById('orgProfileOrganization');
    if (orgEl && orgEl.value.trim()) profileData.organization = orgEl.value.trim();
    const industryEl = document.getElementById('orgProfileIndustry');
    if (industryEl && industryEl.value.trim()) profileData.industry = industryEl.value.trim();
    const regionEl = document.getElementById('orgProfileRegion');
    if (regionEl && regionEl.value.trim()) profileData.region = regionEl.value.trim();
    const addressEl = document.getElementById('orgProfileAddress');
    if (addressEl && addressEl.value.trim()) profileData.address = addressEl.value.trim();
    const avatarEl = document.getElementById('orgProfileAvatar');
    if (avatarEl && avatarEl.value.trim()) profileData.avatar = avatarEl.value.trim();

    try {
      const result = await window.electronAPI.authUpdateProfile(profileData);
      if (result.success) {
        this.showToast('个人信息已更新');
        this.toggleProfileEdit();
        // 刷新用户显示
        if (result.user) {
          document.getElementById('orgUserName').textContent = result.user.name || result.user.username || '-';
          this._updateHeaderUserBadge(true, result.user);
        }
        // 同步到本地 profile.json，确保画像页面也能读取
        if (window.electronAPI?.profile?.update) {
          const localProfile = await window.electronAPI.profile.get();
          localProfile.user = localProfile.user || {};
          if (name) localProfile.user.name = name;
          if (nickname) localProfile.user.nickname = nickname;
          if (email) localProfile.user.email = email;
          if (mobile) localProfile.user.mobile = mobile;
          if (profileData.gender !== undefined) localProfile.user.gender = profileData.gender;
          if (profileData.birth_date) localProfile.user.birth_date = profileData.birth_date;
          if (profileData.profession) localProfile.user.profession = profileData.profession;
          if (profileData.organization) localProfile.user.organization = profileData.organization;
          if (profileData.industry) localProfile.user.industry = profileData.industry;
          if (profileData.region) localProfile.user.region = profileData.region;
          if (profileData.address) localProfile.user.address = profileData.address;
          if (profileData.avatar) localProfile.user.avatar = profileData.avatar;
          await window.electronAPI.profile.update(localProfile);
        }
        // 清除画像标签页缓存，确保下次查看时刷新
        this._settingsTabLoaded.profile = false;
      } else {
        errorEl.textContent = result.error || '更新失败';
        errorEl.classList.remove('hidden');
      }
    } catch (err) {
      errorEl.textContent = `更新失败: ${err.message}`;
      errorEl.classList.remove('hidden');
    }
  },

  async _loadServerUrlsToLogin() {
    // 登录前区域不再显示地址，此方法保留为空
  },

  async saveServerUrlsFromLogin() {
    // 登录前不再有编辑功能，此方法保留为空
  },

  // ===== 通知功能 =====

  async _fetchNotifications() {
    if (!window.electronAPI?.notificationsFetch) return;
    try {
      const notifications = await window.electronAPI.notificationsFetch();
      // 兼容 API 文档 read 字段和旧 is_read 字段
      const unreadCount = notifications.filter(n => !(n.read || n.is_read)).length;
      this._renderNotifications(notifications, unreadCount);
    } catch (e) {
      console.error('[App] Fetch notifications error:', e);
    }
  },

  _renderNotifications(notifications, unreadCount) {
    const badge = document.getElementById('notificationBadge');
    const bellBtn = document.getElementById('notificationBellBtn');
    const body = document.getElementById('notificationPanelBody');

    // 更新 badge
    if (badge) {
      if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    // 铃铛图标
    if (bellBtn) {
      bellBtn.textContent = unreadCount > 0 ? '🔔' : '🔕';
      const badgeEl = document.getElementById('notificationBadge');
      if (badgeEl && !badgeEl.parentNode) bellBtn.appendChild(badgeEl);
    }

    // 渲染通知列表
    if (!body) return;
    if (notifications.length === 0) {
      body.innerHTML = `<div class="notification-empty">${window.i18n?.t('notification.empty') || '暂无通知'}</div>`;
      return;
    }

    body.innerHTML = notifications.map(n => `
      <div class="notification-item ${(n.read || n.is_read) ? 'read' : 'unread'}" data-id="${n.id}">
        <div class="notification-item-type ${n.type}">${this._getNotifTypeIcon(n.type)}</div>
        <div class="notification-item-content">
          <div class="notification-item-title">${n.title}${n.priority === 'urgent' ? ' <span style="color:#FF3B30">[紧急]</span>' : n.priority === 'high' ? ' <span style="color:#FF9500">[重要]</span>' : ''}</div>
          ${n.content ? `<div class="notification-item-body">${n.content}</div>` : ''}
          <div class="notification-item-time">${this._formatNotifTime(n.created_at)}</div>
        </div>
        <button class="notification-item-delete" data-id="${n.id}" title="删除">✕</button>
      </div>
    `).join('');
    // 事件委托已在 bindEvents() 中绑定，无需逐元素 addEventListener
  },

  _toggleNotificationPanel() {
    const panel = document.getElementById('notificationPanel');
    if (!panel) return;
    panel.classList.toggle('hidden');
  },

  _markAllNotificationsRead() {
    // 乐观更新：先更新 UI
    const body = document.getElementById('notificationPanelBody');
    if (body) {
      body.querySelectorAll('.notification-item.unread').forEach(el => {
        el.classList.remove('unread');
        el.classList.add('read');
      });
    }
    const badge = document.getElementById('notificationBadge');
    if (badge) badge.classList.add('hidden');
    const bellBtn = document.getElementById('notificationBellBtn');
    if (bellBtn) bellBtn.textContent = '🔕';
    this.showToast('已全部标记为已读');
    // 后台异步通知服务端
    if (window.electronAPI?.notificationsMarkAllRead) {
      window.electronAPI.notificationsMarkAllRead().catch(() => {});
    }
  },

  _clearAllNotifications() {
    // 乐观更新：先清 UI，后端异步执行
    const body = document.getElementById('notificationPanelBody');
    if (body) body.innerHTML = `<div class="notification-empty">${window.i18n?.t('notification.empty') || '暂无通知'}</div>`;
    const badge = document.getElementById('notificationBadge');
    if (badge) badge.classList.add('hidden');
    const bellBtn = document.getElementById('notificationBellBtn');
    if (bellBtn) bellBtn.textContent = '🔕';
    this.showToast('已清除所有通知');
    // 后台异步通知服务端
    if (window.electronAPI?.notificationsMarkAllRead) {
      window.electronAPI.notificationsMarkAllRead().catch(() => {});
    }
  },

  _getNotifTypeIcon(type) {
    const icons = {
      system: '🔧', update: '🚀', feature: '✨', warning: '⚠️',
      info: 'ℹ️', error: '❌', success: '✅', announcement: '📢'
    };
    return icons[type] || 'ℹ️';
  },

  _formatNotifTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  },

  _showUpdateModal(updateInfo) {
    const existing = document.getElementById('updateNotification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'updateNotification';
    notification.innerHTML = `
      <div class="update-notification-header" onclick="App._toggleUpdateDetail()">
        <div class="update-notification-title">
          <span style="font-size:20px;">🚀</span>
          <div>
            <div style="font-weight:600;font-size:14px;">发现新版本 v${updateInfo.latest_version}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">当前版本 v${updateInfo.current_version || ''}</div>
          </div>
        </div>
        <div class="update-notification-actions">
          ${updateInfo.download_url ? `<button class="update-btn-download" onclick="event.stopPropagation();App._downloadUpdate('${updateInfo.download_url}')">立即下载</button>` : ''}
          <button class="update-btn-dismiss" onclick="event.stopPropagation();document.getElementById('updateNotification').remove()">✕</button>
        </div>
      </div>
      <div class="update-notification-detail" id="updateDetailPanel">
        ${updateInfo.release_notes ? `
          <div class="update-release-notes">
            <div style="font-weight:600;font-size:12px;color:var(--text-primary);margin-bottom:6px;">更新内容</div>
            <div style="font-size:12px;color:var(--text-secondary);white-space:pre-line;line-height:1.6;">${updateInfo.release_notes}</div>
          </div>
        ` : ''}
        ${updateInfo.file_size ? `<div style="font-size:11px;color:#aeaeb2;margin-top:8px;">文件大小：${(updateInfo.file_size / 1024 / 1024).toFixed(1)} MB</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="update-btn-later" onclick="document.getElementById('updateNotification').remove()">稍后提醒</button>
          ${updateInfo.download_url ? `<button class="update-btn-go" onclick="App._downloadUpdate('${updateInfo.download_url}')">前往下载</button>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(notification);

    // 触发入场动画
    requestAnimationFrame(() => {
      notification.classList.add('show');
    });

    // 15 秒后自动关闭
    setTimeout(() => {
      const el = document.getElementById('updateNotification');
      if (el) {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 400);
      }
    }, 15000);
  },

  _toggleUpdateDetail() {
    const panel = document.getElementById('updateDetailPanel');
    if (panel) {
      panel.classList.toggle('collapsed');
    }
  },

  async _checkForUpdate() {
    if (!window.electronAPI?.updatesCheck) return;
    try {
      const info = await window.electronAPI.updatesCheck();
      if (info.has_update) {
        this._showUpdateModal(info);
      }
    } catch (e) {
      console.error('[App] Check update error:', e);
    }
  },

  async _downloadUpdate(downloadUrl) {
    // 动态获取 Config Server 地址
    let server = ''; // 不硬编码，从登录状态获取
    try {
      const state = await window.electronAPI?.authGetState?.();
      if (state?.configUrl) server = state.configUrl;
    } catch (_) {}
    const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : server + downloadUrl;
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(fullUrl);
    }
    // 关闭通知
    const el = document.getElementById('updateNotification');
    if (el) { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }
    this.showToast('正在浏览器中下载...');
  },

  showLoginModal() {
    const modal = document.getElementById('loginModal');
    modal?.classList.remove('hidden');
    this._loadOrgConfig();
  },

  hideLoginModal() {
    document.getElementById('loginModal')?.classList.add('hidden');
  },

  showSettingsModal() {
    const modal = document.getElementById('settingsModal');
    modal?.classList.remove('hidden');
    
    // 更新设置标签可见性
    this._updateSettingsTabVisibility(this._isOrgLoggedIn());

    // 只加载当前活跃标签页的数据（延迟加载其他标签）
    if (window.electronAPI) {
      const activeTab = document.querySelector('.settings-tab.active');
      const tabName = activeTab?.dataset.tab || 'llm';
      this.switchSettingsTab(tabName);
    }
  },

  hideSettingsModal() {
    document.getElementById('settingsModal')?.classList.add('hidden');
  },

  // ===== 侧边栏收起/展开 =====

  /** 初始化侧边栏收起/展开 */
  _initSidebarToggle() {
    this._currentViewName = 'calendar';
    // 按视图记忆收起状态：{ viewName: isCollapsed }
    this._sidebarCollapseState = {};
    try {
      const saved = localStorage.getItem('memora_sidebar_collapse');
      if (saved) this._sidebarCollapseState = JSON.parse(saved);
    } catch (_) {}

    // 默认：AI 助手页收起，其他页展开
    if (this._sidebarCollapseState['ai'] === undefined) {
      this._sidebarCollapseState['ai'] = true;
    }

    // 绑定切换按钮
    document.getElementById('sidebarToggleBtn')?.addEventListener('click', () => {
      this._toggleSidebar();
    });

    // 收起后点击图标也可以展开
    document.getElementById('collapsedPomodoroIcon')?.addEventListener('click', () => {
      this._setSidebarCollapsed(false);
    });
    document.getElementById('collapsedTaskIcon')?.addEventListener('click', () => {
      this._setSidebarCollapsed(false);
    });

    // 应用当前视图的侧边栏状态
    this._applySidebarState();
  },

  /** 切换侧边栏收起/展开 */
  _toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.contains('collapsed');
    this._setSidebarCollapsed(!isCollapsed);
  },

  /** 设置侧边栏收起/展开状态 */
  _setSidebarCollapsed(collapsed) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    if (collapsed) {
      sidebar.classList.add('collapsed');
    } else {
      sidebar.classList.remove('collapsed');
    }
    // 记住当前视图的状态
    this._sidebarCollapseState[this._currentViewName] = collapsed;
    try {
      localStorage.setItem('memora_sidebar_collapse', JSON.stringify(this._sidebarCollapseState));
    } catch (_) {}
    // 更新收起状态下的数据
    if (collapsed) {
      this._updateCollapsedSidebar();
    }
  },

  /** 根据当前视图应用侧边栏状态 */
  _applySidebarState() {
    const isCollapsed = this._sidebarCollapseState[this._currentViewName] || false;
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
      this._updateCollapsedSidebar();
    } else {
      sidebar.classList.remove('collapsed');
    }
  },

  /** 设置当前视图名称（供视图切换时调用） */
  _setCurrentViewName(name) {
    this._currentViewName = name;
    this._applySidebarState();
  },

  /** 更新收起状态下的侧边栏数据（计时器、任务数） */
  _updateCollapsedSidebar() {
    // 更新计时器显示
    const timerDisplay = document.getElementById('timerDisplay');
    const collapsedTimer = document.getElementById('collapsedTimerDisplay');
    if (timerDisplay && collapsedTimer) {
      collapsedTimer.textContent = timerDisplay.textContent;
    }
    // 更新运行状态指示器
    const startBtn = document.getElementById('startPomodoro');
    const runningDot = document.getElementById('collapsedRunningDot');
    if (startBtn && runningDot) {
      const isRunning = startBtn.textContent.includes('暂停') || startBtn.textContent.includes('Pause');
      runningDot.classList.toggle('active', isRunning);
    }
    // 更新任务数
    const taskList = document.getElementById('taskList');
    const taskBadge = document.getElementById('collapsedTaskCount');
    if (taskList && taskBadge) {
      const tasks = taskList.querySelectorAll('.task-item');
      const count = tasks.length;
      taskBadge.textContent = count > 0 ? count : '';
      taskBadge.dataset.count = count;
    }
  },

  showAIAssistantView() {
    // 隐藏所有主视图（与 calendar.js hideOtherViews 保持一致）
    const allViews = ['calendarView', 'notebookView', 'knowledgeView', 'documentsView', 'insightView'];
    allViews.forEach(id => {
      document.getElementById(id)?.classList.add('hidden');
    });
    
    // 更新 view-tab active 状态
    document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
    
    // 显示AI助手视图
    const aiView = document.getElementById('aiAssistantView');
    if (aiView) {
      aiView.classList.remove('hidden');
    }
    
    // 隐藏日期导航栏（非日历视图时不需要）
    const dateNav = document.querySelector('.date-navigator');
    if (dateNav) dateNav.style.display = 'none';

    // 侧边栏：AI 助手页默认收起
    this._setCurrentViewName('ai');

    // 更新 AI 模式切换按钮可见性
    this._updateAIModeToggle();

    // 恢复 CC 模式 UI（工作目录栏 + skill 下拉 + 连接器下拉）
    // 切到其他标签再切回来时，ccWorkdirBar 可能未被正确恢复
    this._updateCCWorkdirBar();

    // 确保供应商选择器已初始化（首次进入 AI 助手页面时自动加载）
    const providerSelect = document.getElementById('ccProviderSelect');
    if (providerSelect && providerSelect.options.length <= 1) {
      this._initProviderSelector();
    }

    if (this._aiAssistantMode === 'cc') {
      this._refreshCCConnectorSelect();
    }

    // 功能卡片点击切换快捷问题
    this._initFeatureCards();

    // v2.6: 专家系统渲染卡片
    if (window.ExpertSystem?._initialized) {
      window.ExpertSystem.renderCards();
    }

    // 🔧 修复：切回 AI 页面时，重放暂存的群聊事件
    if (this._pendingGroupChatEvents?.length > 0) {
      setTimeout(() => this._replayPendingGroupChatEvents(), 100);
    }

    // 同步：拉取云端最新会话列表
    this._syncPullConversations();
    
    // 延迟聚焦输入框，确保视图渲染完成
    setTimeout(() => {
      document.getElementById('aiChatInput')?.focus();
    }, 100);
  },

  /** 初始化全局 AI 模式（启动时调用，从主进程恢复） */
  _initGlobalAIMode() {
    const toggle = document.getElementById('aiModeToggle');
    if (!toggle) return;

    if (window.electronAPI?.getGlobalAIMode) {
      window.electronAPI.getGlobalAIMode().then(result => {
        this._aiAssistantMode = result.mode || 'cc';
        toggle.querySelectorAll('.ai-mode-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.mode === this._aiAssistantMode);
        });
        // 恢复模式后同步显示 CC 工作目录栏
        this._updateCCWorkdirBar();
      });
    } else {
      this._aiAssistantMode = 'cc';
      this._updateCCWorkdirBar();
    }
  },

  /** 更新 AI 助手模式切换按钮 */
  _updateAIModeToggle() {
    const toggle = document.getElementById('aiModeToggle');
    if (!toggle) return;

    // 更新按钮状态（模式切换已始终可见，无需再 remove hidden）
    toggle.querySelectorAll('.ai-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this._aiAssistantMode);
    });
  },

  /** 设置全局 AI 模式 */
  async _setGlobalAIMode(mode) {
    this._aiAssistantMode = mode;
    document.querySelectorAll('.ai-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    // 持久化到主进程
    if (window.electronAPI?.setGlobalAIMode) {
      await window.electronAPI.setGlobalAIMode(mode);
    }
    // CC 模式显示工作目录栏，其他模式隐藏
    this._updateCCWorkdirBar();
    // 按模式重新渲染专家卡片（切换模式后只显示该模式适用的专家）
    if (window.ExpertSystem?._initialized) {
      // 清除当前选中的专家（不同模式专家不同）
      window.ExpertSystem._activeExpertId = null;
      window.ExpertSystem._activeGroupId = null;
      window.ExpertSystem.renderCards();
    }
  },

  /** 设置当前对话的 CC 工作目录（null=用默认） */
  async _setCCWorkdir(workdir) {
    const oldWorkdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
    const newWorkdir = workdir || this._ccDefaultWorkdir || '';

    if (this._activeSessionId) {
      const session = this._chatSessions.find(s => s.id === this._activeSessionId);
      if (session) {
        session.ccWorkdir = workdir || null; // null 表示用默认
        this._saveChatSessions();
      }
    }
    this._updateCCWorkdirBar();

    // 检查是否需要迁移技能
    if (oldWorkdir && newWorkdir && oldWorkdir !== newWorkdir) {
      await this._checkSkillMigration(oldWorkdir, newWorkdir);
    }
  },

  /** 检查旧工作目录是否有已安装技能，提示用户迁移 */
  async _checkSkillMigration(oldWorkdir, newWorkdir) {
    const oldSkillDir = `${oldWorkdir}/.claude/skills`;
    const newSkillDir = `${newWorkdir}/.claude/skills`;

    try {
      // 列出旧目录中的技能
      const listResult = await window.electronAPI?.skillhubList?.({ dir: oldSkillDir });
      if (!listResult?.success || !listResult.skills || listResult.skills.length === 0) {
        return; // 旧目录没有技能，无需迁移
      }

      const skillNames = listResult.skills.map(s => s.slug).join(', ');
      const count = listResult.skills.length;

      // 弹窗询问用户是否迁移
      const shouldMigrate = confirm(
        `检测到旧工作目录中有 ${count} 个已安装技能：\n${skillNames}\n\n` +
        `更换工作目录后，这些技能将不再对新目录生效。\n\n` +
        `是否将这些技能迁移到新工作目录？\n` +
        `（原目录中的技能不会被删除）`
      );

      if (!shouldMigrate) {
        this.showToast(
          `已切换工作目录。旧目录中有 ${count} 个技能未迁移，如需使用请在 SkillHub 市场重新安装`,
          'info'
        );
        return;
      }

      // 逐个迁移（复制到新目录）
      let successCount = 0;
      let failCount = 0;
      for (const skill of listResult.skills) {
        const installResult = await window.electronAPI?.skillhubInstall?.({
          slug: skill.slug,
          targetDir: newSkillDir
        });
        if (installResult?.success) {
          successCount++;
        } else {
          failCount++;
        }
      }

      if (failCount === 0) {
        this.showToast(`技能迁移完成：${successCount} 个技能已安装到新工作目录`, 'success');
      } else {
        this.showToast(
          `迁移完成：${successCount} 成功，${failCount} 失败。失败的可手动在 SkillHub 市场重新安装`,
          'info'
        );
      }

      // 刷新 SkillHub 已安装列表和 Skill 下拉框
      await this._refreshSkillHubInstalled();
      this._refreshCCSkillSelect();
    } catch (e) {
      console.error('[CC] Skill migration check failed:', e);
    }
  },

  /** 获取当前对话的 CC 工作目录（优先 session 级，回退默认） */
  _getCCWorkdir() {
    if (this._activeSessionId) {
      const session = this._chatSessions.find(s => s.id === this._activeSessionId);
      if (session?.ccWorkdir) return session.ccWorkdir;
    }
    return null; // null 表示用默认
  },

  /** 更新对话区 CC 工作目录指示器 */
  _updateCCWorkdirBar() {
    const bar = document.getElementById('ccWorkdirBar');
    if (!bar) return;
    // 仅 CC 模式显示
    if (this._aiAssistantMode !== 'cc') {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');

    const pathEl = document.getElementById('ccWorkdirPath');
    if (!pathEl) return;
    const workdir = this._getCCWorkdir();
    if (workdir) {
      // 对话级自定义目录
      const name = workdir.split('/').pop() || workdir;
      pathEl.textContent = name;
      pathEl.title = workdir;
      pathEl.style.color = 'var(--primary-color)';
    } else {
      // 使用默认
      pathEl.textContent = '默认';
      pathEl.title = this._ccDefaultWorkdir || '';
      pathEl.style.color = 'var(--text-secondary)';
    }

    // 同时刷新 Skill 选择器
    this._refreshCCSkillSelect();
    // 模型列表由 _updateModelSelectorForProvider 根据当前供应商自动管理，这里不需要重复加载
  },

  /** 刷新 CC Skill 选择下拉框（只显示已安装的 skill） */
  async _refreshCCSkillSelect() {
    const select = document.getElementById('ccSkillSelect');
    if (!select) return;
    // 记住当前选中
    const prevValue = select.value;
    // 加载带安装状态的 skill 列表
    const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
    const result = await window.electronAPI?.skillListWithStatus?.({ ccWorkdir: workdir });
    const skills = result?.success ? result.skills : [];
    this._ccSkills = skills;
    // 重建选项：只显示已安装的
    select.innerHTML = '<option value="">不使用 Skill</option>';
    for (const skill of skills) {
      if (skill.installed) {
        const opt = document.createElement('option');
        opt.value = skill.name;
        opt.textContent = `🧩 ${skill.name}`;
        // 鼠标悬停显示技能简介
        opt.title = skill.description ? `${skill.name}：${skill.description}` : `技能：${skill.name}`;
        select.appendChild(opt);
      }
    }
    // 恢复选中（如果仍存在）
    if (prevValue) select.value = prevValue;
  },

  /** 初始化 OpenRouter 模型选择器 */
  async _initOpenRouterModelSelector(forceRefresh = false) {
    const select = document.getElementById('ccOpenRouterSelect');
    if (!select) return;
    if (!forceRefresh && select.dataset.loaded === 'true') return;

    // 守卫：如果当前选中了直连供应商（火山引擎/DeepSeek/腾讯云），不要加载 OpenRouter 模型覆盖它
    const activeProviderId = document.getElementById('ccProviderSelect')?.value;
    if (activeProviderId && activeProviderId !== 'openrouter') {
      console.log(`[OpenRouter] Skip loading — active provider is "${activeProviderId}", not OpenRouter`);
      return;
    }

    // 保留当前选中值
    const prevValue = select.value;

    // 先检查是否有 API Key（通过已加载的配置状态判断）
    const result = await window.electronAPI?.ccOpenRouterGetModels?.();
    if (!result?.success) {
      select.innerHTML = '<option value="">默认</option>';
      if (result?.error && !result.error.includes('未配置')) {
        // 有 key 但获取失败
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = `⚠️ ${result.error.substring(0, 40)}`;
        select.appendChild(opt);
      }
      return;
    }

    const models = result.models || [];
    // 按提供商分组
    const groups = {};
    for (const m of models) {
      const provider = m.id.split('/')[0] || 'other';
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(m);
    }

    select.innerHTML = '<option value="">默认</option>';
    for (const [provider, providerModels] of Object.entries(groups).sort()) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = provider;
      for (const m of providerModels) {
        const opt = document.createElement('option');
        opt.value = m.id;
        // 显示模型名 + 价格提示
        let label = m.name || m.id;
        if (m.pricing?.prompt) {
          const price = parseFloat(m.pricing.prompt);
          if (price > 0) {
            label += ` ($${(price * 1e6).toFixed(2)}/1M)`;
          } else {
            label += ` (free)`;
          }
        }
        opt.textContent = label;
        opt.title = m.id;
        optgroup.appendChild(opt);
      }
      select.appendChild(optgroup);
    }

    // 设置默认模型（从配置读取）
    const config = await window.electronAPI?.ccGetConfig?.();
    if (config?.openRouterDefaultModel) {
      select.value = config.openRouterDefaultModel;
    } else if (prevValue) {
      select.value = prevValue;
    }

    select.dataset.loaded = 'true';
    console.log(`[OpenRouter] Loaded ${models.length} models`);
  },

  /** 测试 OpenRouter 连接 */
  async _testOpenRouterConnection() {
    const resultEl = document.getElementById('testOpenRouterResult');
    const btnEl = document.getElementById('testOpenRouterBtn');
    if (!resultEl || !btnEl) return;

    btnEl.disabled = true;
    resultEl.innerHTML = '<span style="color: var(--text-secondary);">⏳ 测试中...</span>';

    const apiKey = document.getElementById('ccOpenRouterApiKey')?.value.trim();
    const baseUrl = document.getElementById('ccOpenRouterBaseUrl')?.value.trim();

    try {
      const result = await window.electronAPI?.ccOpenRouterTest?.({
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
      });
      if (result?.ok) {
        resultEl.innerHTML = `<span style="color: var(--success);">✅ 连接成功（${result.modelCount} 个模型，${result.latency}ms）</span>`;
      } else {
        resultEl.innerHTML = `<span style="color: var(--danger);">❌ ${result?.error || '连接失败'}</span>`;
      }
    } catch (err) {
      resultEl.innerHTML = `<span style="color: var(--danger);">❌ ${err.message}</span>`;
    } finally {
      btnEl.disabled = false;
    }
  },

  /** 更新滚动快捷按钮显示状态 */
  _updateScrollButtons() {
    // 使用缓存的 DOM 引用，避免重复查询
    const els = this._chatScrollEls;
    if (!els || !els.container) return;
    const { container: chatMessages, topBtn, bottomBtn } = els;
    if (!topBtn || !bottomBtn) return;

    const { scrollTop, scrollHeight, clientHeight } = chatMessages;
    const scrollThreshold = 100;

    // 顶部按钮：当不在顶部时显示
    topBtn.style.display = scrollTop > scrollThreshold ? 'flex' : 'none';
    // 底部按钮：当不在底部时显示
    bottomBtn.style.display = (scrollHeight - scrollTop - clientHeight) > scrollThreshold ? 'flex' : 'none';
  },

  /** 判断是否已登录组织 */
  _isOrgLoggedIn() {
    const loggedInSection = document.getElementById('orgLoggedInSection');
    return loggedInSection && !loggedInSection.classList.contains('hidden');
  },

  /** 功能卡片切换快捷问题 - 使用事件委托确保 DOM 重建后仍可用 */
  _initFeatureCards() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    if (container._featureCardDelegated) return; // 只绑定一次委托
    container._featureCardDelegated = true;
    container.addEventListener('click', (e) => {
      const card = e.target.closest('.feature-card');
      if (!card) return;
      
      // v2.6: 专家系统卡片点击
      if (window.ExpertSystem) {
        window.ExpertSystem.handleCardClick(card);
        return;
      }
      
      // 兼容旧逻辑
      const category = card.dataset.category;
      if (!category) return;
      container.querySelectorAll('.feature-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      this._switchQuickQuestions(category);
    });
  },

  /** 根据分类切换快捷问题 */
  _switchQuickQuestions(category) {
    const container = document.getElementById('quickCapsules');
    if (!container) return;

    // v2.6: 如果专家系统已激活，快捷访问由专家系统管理
    if (window.ExpertSystem?.getActiveExpert() || window.ExpertSystem?.getActiveGroup()) {
      return;
    }

    const questions = {
      task: [
        { icon: '🎯', label: '今日排程', question: '今天该做什么？帮我排个优先级', cls: 'agent-priority' },
        { icon: '📊', label: '生成日报', question: '生成今天的工作日报', cls: 'agent-report' },
        { icon: '📋', label: '生成周报', question: '__GENERATE_WEEKLY_REPORT__', cls: 'agent-report' },
        { icon: '📚', label: '整理笔记', question: '帮我整理一下最近的笔记', cls: 'agent-knowledge' },
        { icon: '🧠', label: '整理记忆', question: '帮我整理一下记忆，看看哪些需要保留', cls: 'agent-memory' },
        { icon: '🔥', label: '紧急事项', question: '最紧急的事项是什么？', cls: 'agent-priority' },
        { icon: '⏰', label: '时间建议', question: '给我一些时间管理建议', cls: 'agent-report' },
      ],
      bidding: [
        { icon: '📊', label: '技术偏离表', question: '请帮我生成技术偏离表', cls: 'agent-bidding' },
        { icon: '📄', label: '技术标书', question: '请帮我生成技术标书', cls: 'agent-bidding' },
        { icon: '📋', label: '投标方案PPT', question: '请帮我生成投标方案PPT', cls: 'agent-bidding' },
        { icon: '✅', label: '点对点应答', question: '请帮我生成点对点应答', cls: 'agent-bidding' },
        { icon: '📝', label: 'SOW', question: '请帮我生成SOW（工作说明书）', cls: 'agent-bidding' },
        { icon: '✔️', label: '验收标准', question: '请帮我生成验收标准', cls: 'agent-bidding' },
        { icon: '🏢', label: '私有化部署方案', question: '请帮我生成私有化部署方案', cls: 'agent-bidding' },
      ],
      knowledge: [
        { icon: '📄', label: '文档列表', question: '获取文档列表', cls: 'agent-knowledge' },
        { icon: '🚀', label: '产品升级规划', question: 'ADP 产品升级规划等产品知识', cls: 'agent-knowledge' },
        { icon: '💡', label: '产品功能介绍', question: '介绍一下 ADP 平台的核心功能', cls: 'agent-knowledge' },
        { icon: '🔧', label: '技术架构', question: 'ADP 的技术架构是怎样的？', cls: 'agent-knowledge' },
        { icon: '📖', label: '最佳实践', question: 'ADP 项目实施的最佳实践有哪些？', cls: 'agent-knowledge' },
        { icon: '❓', label: '常见问题', question: 'ADP 常见问题及解决方案', cls: 'agent-knowledge' },
      ],
    };

    const items = questions[category] || questions.task;
    container.innerHTML = items.map(q => 
      `<button class="quick-capsule ${q.cls}" data-question="${q.question}" data-category="${category}">${q.icon} ${q.label}</button>`
    ).join('');
  },

  showKnowledgeView() {
    // 离开 AI 助手时保存当前对话
    this._saveCurrentSessionMessages();
    // 隐藏其他视图
    document.getElementById('calendarView')?.classList.add('hidden');
    document.getElementById('notebookView')?.classList.add('hidden');
    document.getElementById('aiAssistantView')?.classList.add('hidden');
    document.getElementById('documentsView')?.classList.add('hidden');
    
    // 显示知识跟随视图
    document.getElementById('knowledgeView')?.classList.remove('hidden');
    
    // 初始化知识跟随模块
    if (window.knowledgeFollow) {
      window.knowledgeFollow.init();
      window.knowledgeFollow.onShow();
    }

    // 初始化知识萃取模块
    if (window.knowledgeDistillation) {
      window.knowledgeDistillation.init();
      window.knowledgeDistillation.onShow();
    }
  },

  async sendAIMessage(forceMode, options = {}) {
    const input = document.getElementById('aiChatInput');
    const message = input.value.trim();

    // v3.1: 并行模式 — 同时调用多个 AI
    if (this._parallelMode && !forceMode) {
      return this._sendParallelMessage(message, options);
    }
    
    // 需要有消息或附件
    if (!message && this._chatAttachments.length === 0) return;

    // 解析文件引用：将 📎文件名 替换为完整路径
    const resolvedMessage = this._resolveFileRefs(message);

    // v2.6: 专家团群聊模式
    if (window.ExpertSystem?.isGroupChatActive?.() || window.ExpertSystem?.getActiveGroup?.()) {
      const group = window.ExpertSystem.getActiveGroup();
      if (group && !window.ExpertSystem.isGroupChatActive()) {
        // 首次发送，启动群聊
        input.value = '';
        input.style.height = 'auto';

        // 🔧 修复：必须先创建会话，否则 _markChatSessionAsGroup 找不到 session
        if (!this._activeSessionId) {
          this.createNewChatSession();
        }

        // 🔧 修复：群聊需要独立的 ConversationId，避免与普通对话上下文串扰
        window.electronAPI?.newADPChat?.();

        // 构建附件信息用于显示
        const attachments = [...this._chatAttachments];
        let attachmentsHtml = '';
        if (attachments.length > 0) {
          attachmentsHtml = '<div class="message-attachments">';
          for (const att of attachments) {
            const icon = this.getFileIcon(att.type, att.name);
            const filePath = att.file?.path || '';
            attachmentsHtml += `<span class="message-attachment-item" data-att-name="${this.escapeHtml(att.name)}" data-att-path="${this.escapeHtml(filePath)}"><span class="msg-att-icon">${icon}</span>${this.escapeHtml(att.name)}</span>`;
          }
          attachmentsHtml += '</div>';
        }

        // 添加用户消息到聊天区
        const chatMessages = document.getElementById('chatMessages');
        const userMsg = document.createElement('div');
        userMsg.className = 'message user';
        userMsg.dataset.sendTime = new Date().toISOString();
        const msgContent = this.escapeHtml(message || '发送了文件') + (attachmentsHtml ? `\n${attachmentsHtml}` : '');
        userMsg.innerHTML = `
          <div class="message-avatar">${this._userAvatarSvg}</div>
          <div class="message-content">
            <p>${this.escapeHtml(message || '发送了文件')}</p>
            ${attachmentsHtml}
            <div class="message-actions user-msg-actions">
              <button class="msg-action-btn copy-user-msg" title="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
              <button class="msg-action-btn edit-user-msg" title="编辑"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
            </div>
            <span class="message-time">${this._formatChatTime(new Date())}</span>
          </div>`;
        chatMessages.appendChild(userMsg);
        userMsg.dataset._actionsBound = 'true';
        this._bindUserMsgActions(userMsg.querySelector('.message-content'));
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // 🔧 关键修复：专家团模式下，附件通过 IPC 传给主进程处理
        // 主进程会走和一对一聊天相同的 COS/Claw 上传流程，获取文件 URL 后注入消息
        let attachmentData = [];
        if (attachments.length > 0) {
          attachmentData = await this.buildAttachmentData(attachments);
        }

        this.clearChatAttachments();

        // v2.6.1: 使用 IPC 后台执行引擎（传递附件数据，主进程处理上传）
        this._startBackgroundGroupChat(resolvedMessage, group, attachmentData);
        return;
      }
      // 群聊进行中，不允许发送新消息
      this._showToast?.('群聊进行中，请等待完成', 'info');
      return;
    }

    // v2.6: 单专家模式（非专家团）— 确保正确走 ADP 流程，支持文档附件
    const activeExpert = window.ExpertSystem?.getActiveExpert?.();
    if (activeExpert && !window.ExpertSystem?.getActiveGroup?.()) {
      // 继续正常的 ADP 流程（下方代码会处理）
      // 但要确保 expertConfig 被正确注入
    }

    // 对话会话管理：如果没有活跃会话，自动创建
    if (!this._activeSessionId) {
      this.createNewChatSession();
    }

    const chatMessages = document.getElementById('chatMessages');
    const attachments = [...this._chatAttachments]; // 复制附件列表

    // 🔧 关键修复：当发送文档附件（非图片）时，先重置 ADP ConversationId
    // 原因：如果旧对话上下文中 ADP 已经"误解"了文件（如当图片处理），
    // 在同一对话中重新发送文件，ADP 仍会基于旧上下文回复（继续说"请上传文件"）。
    // 重置 ConversationId 让 ADP 以全新上下文处理文件。
    const hasDocAttachment = attachments.some(a => a.type !== 'image');
    if (hasDocAttachment) {
      await window.electronAPI?.newADPChat?.();
      console.log('[Chat] 🔄 文档附件：已重置 ADP ConversationId');
    }
    
    // 添加用户消息
    const userMessage = document.createElement('div');
    userMessage.className = 'message user';
    
    // 附件 HTML
    let attachmentsHtml = '';
    if (attachments.length > 0) {
      attachmentsHtml = '<div class="message-attachments">';
      for (const att of attachments) {
        const icon = this.getFileIcon(att.type, att.name);
        const filePath = att.file?.path || '';
        attachmentsHtml += `<span class="message-attachment-item" data-att-name="${this.escapeHtml(att.name)}" data-att-path="${this.escapeHtml(filePath)}"><span class="msg-att-icon">${icon}</span>${this.escapeHtml(att.name)}</span>`;
      }
      attachmentsHtml += '</div>';
    }
    
    userMessage.innerHTML = `
      <div class="message-avatar">${this._userAvatarSvg}</div>
      <div class="message-content">
        <p>${this.escapeHtml(message || '发送了文件')}</p>
        ${attachmentsHtml}
        <div class="local-context-indicator" style="display:none;"><span class="local-context-spinner"></span><span>🧠 检索本地上下文...</span></div>
        <span class="local-context-sources" style="display:none;"></span>
        <div class="message-actions user-msg-actions">
          <button class="msg-action-btn copy-user-msg" title="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
          <button class="msg-action-btn edit-user-msg" title="编辑"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
        </div>
        <span class="message-time">${this._formatChatTime(new Date())}</span>
      </div>
    `;
    chatMessages.appendChild(userMessage);
    userMessage.dataset._actionsBound = 'true';

    // 绑定用户消息操作按钮
    const msgContent = userMessage.querySelector('.message-content');
    this._bindUserMsgActions(msgContent);

    // v2.7 保存用户消息 content 引用，供后续上下文注入使用
    this._currentUserMsgContent = msgContent;
    
    input.value = '';
    input.style.height = 'auto';
    this.clearChatAttachments();
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // 更新会话标题（从第一条用户消息）
    const session = this._chatSessions.find(s => s.id === this._activeSessionId);
    if (session && session.title === '新对话' && message) {
      session.title = message.length > 30 ? message.slice(0, 30) + '...' : message;
      session.updatedAt = new Date().toISOString();
      this._saveChatSessions();
      this._renderChatSessionList();
    }

    // 添加助手消息占位符（带加载动画）
    const assistantMessage = document.createElement('div');
    assistantMessage.className = 'message assistant';
    assistantMessage.dataset.sendTime = new Date().toISOString();

    // v3.1: 渲染上下文来源 Badge（如果向量检索有结果）
    let contextBadgeHtml = '';
    if (this._pendingContextSources?.sources?.length > 0) {
      const sources = this._pendingContextSources.sources;
      const icons = { notebook: '📝', memory: '🧠', tasks: '✅', knowledge: '📚' };
      const chips = sources.map(s => {
        const icon = icons[s.source_type] || '📌';
        const score = Math.round((s.score || 0) * 100);
        return `<span class="ctx-source-chip" data-source-type="${s.source_type}" data-source-id="${s.source_id}" title="${this.escapeHtml(s.title || '')} (${score}%)">${icon} ${this.escapeHtml((s.title || '').substring(0, 15))} ${score}%</span>`;
      }).join('');
      contextBadgeHtml = `<div class="context-sources-badge">📚 已参考 ${sources.length} 条本地数据：${chips}</div>`;
      // 清空待处理
      this._pendingContextSources = null;
    }

    assistantMessage.innerHTML = `
      ${contextBadgeHtml}
      <div class="message-avatar">${this._assistantAvatarSvg}</div>
      <div class="message-content">
        <div class="agent-thinking">
          <div class="thinking-dots"><span></span><span></span><span></span></div>
          <span class="thinking-text">智能分析中...</span>
        </div>
      </div>
    `;
    chatMessages.appendChild(assistantMessage);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      let result;
      // 构建附件数据（读取文件内容）
      const attachmentData = await this.buildAttachmentData(attachments);

      // 构建默认上下文信息（当前时间 + 用户画像），注入到发送给 AI 的消息中
      const defaultContext = await this._buildDefaultContext();
      const sendMessage = defaultContext ? (defaultContext + '\n' + resolvedMessage) : resolvedMessage;

      // v2.7 本地上下文注入：所有模式统一执行，在发送前检索本地数据
      // 如果调用方已传入 systemRole（如定时任务），则跳过 LLM 分类
      let localContextSystemRole = options.systemRole || '';
      let localContextSources = options.sources || [];
      const contextEnabled = this._settings?.localContextEnabled !== false; // 默认开启
      const userMsgEl = this._currentUserMsgContent;
      if (!localContextSystemRole && contextEnabled && message) {
        try {
          // 显示检索提示
          const contextIndicator = userMsgEl?.querySelector('.local-context-indicator');
          if (contextIndicator) contextIndicator.style.display = 'flex';

          // Phase 1: LLM 意图分类
          const classifyResult = await window.electronAPI.contextClassifyIntent(message);
          const classification = classifyResult?.classification;

          // Phase 2+3: 检索本地数据 + 组装 SystemRole
          let contextData;
          if (classification) {
            contextData = await this._retrieveLocalContext(classification);
          } else {
            // 兜底策略
            contextData = await this._retrieveLocalContextFallback();
          }
          localContextSystemRole = contextData.systemRole;
          localContextSources = contextData.sources;

          // 隐藏检索提示，显示参考数据源
          if (contextIndicator) contextIndicator.style.display = 'none';
          if (localContextSources.length > 0) {
            const sourceTag = userMsgEl?.querySelector('.local-context-sources');
            if (sourceTag) {
              sourceTag.textContent = `🧠 已参考: ${localContextSources.join(', ')}`;
              sourceTag.style.display = 'inline-block';
            }
          }

          console.log('[Chat] Local context injected, sources:', localContextSources.join(', '));
        } catch (e) {
          console.warn('[Chat] Local context injection failed:', e);
        }
      }

      // 根据 AI 助手模式决定调用路径：
      // - agent 模式：使用 ADP 智能体（工具调用、多步推理等）
      // - llm 模式：使用已配置的大模型 API 直接对话（简单聊天）
      // - cc 模式：使用 Claude Code Agent SDK（Coding Plan）
      // - forceMode: 'adp' 强制走 ADP，'agent' 强制走本地 Agent
      const isAgentMode = this._aiAssistantMode === 'agent';
      
      if (forceMode === 'adp' || isAgentMode) {
        // ADP 模式：走 ADP 智能体流式
        // 结构化传递附件信息，由后端构建 ADP V2 Contents 数组
        
        // 替换占位符为进度指示器
        const messageContent = assistantMessage.querySelector('.message-content');
        messageContent.innerHTML = `
          <div class="adp-progress" id="adpProgress">
            <div class="adp-progress-header">
              <div class="adp-progress-spinner"></div>
              <span class="adp-progress-title">智能体处理中</span>
              <span class="adp-progress-timer" id="adpProgressTimer">0s</span>
            </div>
            <div class="adp-upload-status" id="adpUploadStatus" style="display:none;">
              <span class="adp-upload-spinner"></span>
              <span class="adp-upload-text">正在上传并解析文档…</span>
            </div>
            <div class="adp-progress-steps" id="adpProgressSteps"></div>
          </div>`;

        // 🔧 文档上传/解析进度：必须在 sendADPMessage 之前注册监听，
        // 因为文档解析在主进程 IPC handler 内部完成（早于返回 streaming），晚注册会漏事件。
        const hasDocAttachment = attachmentData.some(a => a.type !== 'image');
        let _docParseHadError = false; // 记录解析是否失败，失败时保留提示更久
        if (hasDocAttachment) {
          const uploadStatusEl = messageContent.querySelector('#adpUploadStatus');
          if (uploadStatusEl) uploadStatusEl.style.display = 'flex';
          window.electronAPI.removeADPUploadListeners?.();
          window.electronAPI.onADPUploadProgress?.((p) => {
            const el = document.getElementById('adpUploadStatus');
            if (!el) return;
            const textEl = el.querySelector('.adp-upload-text');
            if (textEl && p?.message) textEl.textContent = p.message;
            if (p?.phase === 'parse_failed') _docParseHadError = true;
            // 一旦出现过失败就保持错误样式，避免后续 complete 把红色覆盖回正常色
            el.classList.toggle('is-error', _docParseHadError);
            if (p?.phase === 'complete') {
              // 解析失败时多停留 6s 让用户看清原因；成功则 400ms 后收起
              const delay = _docParseHadError ? 6000 : 400;
              setTimeout(() => { const e2 = document.getElementById('adpUploadStatus'); if (e2) e2.style.display = 'none'; }, delay);
            }
          });
        }

        // 发送前最后一次保险：把当前激活会话的 convId 同步到主进程，避免任何状态漂移
        const activeSession = this._activeSessionId
          ? this._chatSessions.find(s => s.id === this._activeSessionId)
          : null;
        if (activeSession?.conversationId) {
          await window.electronAPI?.setADPConversationId?.(activeSession.conversationId);
          console.log('[Chat] Pre-send: synced convId to main:', activeSession.conversationId);
        } else {
          console.log('[Chat] Pre-send: no convId yet, will be generated on main side');
        }

        // 启动流式请求 — 传递结构化数据（message + attachments + systemRole）
        // v2.6: 专家模式传递专家级 appKey/url
        // v2.7: 本地上下文注入 systemRole
        const expertConfig = window.ExpertSystem?.getActiveADPConfig?.();
        const adpMessageData = {
          message: sendMessage,
          attachments: attachmentData
        };
        if (expertConfig?.appKey) {
          adpMessageData.appKey = expertConfig.appKey;
          adpMessageData.adpUrl = expertConfig.url;
          adpMessageData._expertMode = true;
        }
        if (localContextSystemRole) {
          adpMessageData.systemRole = localContextSystemRole;
        }
        // 🔧 传递用户选择的 skill 和模型到 ADP（注入到 systemRole）
        const selectedSkill = document.getElementById('ccSkillSelect')?.value || '';
        const selectedModel = document.getElementById('ccOpenRouterSelect')?.value || '';
        const selectedProviderId = document.getElementById('ccProviderSelect')?.value || '';
        if (selectedSkill) {
          const skillPrefix = `\n\n[用户要求使用 Skill: ${selectedSkill}]\n请在回答中优先使用 ${selectedSkill} 这个技能来完成任务。`;
          adpMessageData.systemRole = (adpMessageData.systemRole || '') + skillPrefix;
        }
        if (selectedModel) {
          adpMessageData.modelHint = selectedModel;
        }
        if (selectedProviderId) {
          adpMessageData.providerHint = selectedProviderId;
        }
        result = await window.electronAPI.sendADPMessage(adpMessageData);

        // 文档解析阶段已结束，移除上传进度监听并隐藏状态行
        window.electronAPI.removeADPUploadListeners?.();
        const _uploadStatusEl = document.getElementById('adpUploadStatus');
        // 解析失败时保留提示（由进度回调的 6s 定时器收起），成功则立即隐藏
        if (_uploadStatusEl && !_docParseHadError) _uploadStatusEl.style.display = 'none';
        
        if (result.success && result.streaming) {
          // 流式模式：监听 SSE 事件
          this._adpStreaming = true;
          document.body.classList.add('streaming-active');
          this._adpCurrentText = '';
          this._adpThinkingText = '';
          this._adpStepMap = {};
          this._updateStreamingUI(true);
          this._adpToolStepCount = 0;
          this._adpFileItems = [];
          this._adpCurrentBubble = null;
          this._adpRenderPending = false;
          this._adpConfigSource = result.configSource || '';
          this._adpReplyMsgId = '';
          this._adpCurrentMessageEl = messageContent;
          // 保存 conversationId 到当前会话，用于切换对话时恢复（必须立即持久化）
          if (result.conversationId && this._activeSessionId) {
            const session = this._chatSessions.find(s => s.id === this._activeSessionId);
            if (session && session.conversationId !== result.conversationId) {
              session.conversationId = result.conversationId;
              this._saveChatSessions(); // 立即写入 localStorage 防止重启丢失
              console.log('[Chat] Saved convId for session', this._activeSessionId, ':', result.conversationId);
            }
          }
          this._adpTimerStart = Date.now();
          this._adpTimerEl = null; // 重置缓存
          const _timerMsgEl = messageContent;
          // 缓存 timer 元素引用，避免每秒 DOM 查询
          this._adpTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this._adpTimerStart) / 1000);
            let el = this._adpTimerEl;
            if (!el) {
              el = _timerMsgEl?.querySelector('#adpProgressTimer') || document.getElementById('adpProgressTimer');
              this._adpTimerEl = el;
            }
            if (el) el.textContent = elapsed + 's';
          }, 1000);

          // 等待流式完成
          await new Promise((resolve) => {
            this._adpStreamResolve = resolve;
            window.electronAPI.onADPSSEEvent((evt) => {
              this._handleADPSSEEvent(evt, assistantMessage);
            });
          });
        } else if (result.success && !result.streaming) {
          // 兼容旧模式（非流式返回）
          const renderedContent = this.escapeHtml(result.content).replace(/\n/g, '<br>');
          messageContent.innerHTML = `<div class="adp-response-text">${renderedContent}</div>`;
          const sourceLabels = { cloud: '☁️ 云端配置', local: '💻 本地配置', default: '📦 内置默认' };
          const sourceLabel = sourceLabels[result.configSource] || '📦 内置默认';
          messageContent.insertAdjacentHTML('beforeend', `<div class="adp-config-source">${sourceLabel}</div>`);
          this._addCopyButton(messageContent);
        } else {
          const sourceLabels = { cloud: '☁️ 云端配置', local: '💻 本地配置', default: '📦 内置默认' };
          const sourceLabel = sourceLabels[result.configSource] || '📦 内置默认';
          throw new Error(`${result.error || '发送失败'}（${sourceLabel}）`);
        }
      } else if (this._aiAssistantMode === 'cc' && window.electronAPI?.ccInvoke) {
        // M-Agent 模式：使用 Claude Code Agent SDK（Coding Plan）
        const messageContent = assistantMessage.querySelector('.message-content');

        // v3.1.2: 保存用户消息供 session 记忆使用
        this._ccLastUserMessage = sendMessage;

        // v3.1.2: 构建 session 级对话历史上下文
        const activeSessionForCtx = this._activeSessionId
          ? this._chatSessions.find(s => s.id === this._activeSessionId)
          : null;
        let sessionContext = '';
        if (activeSessionForCtx?.conversationHistory?.length > 0) {
          const history = activeSessionForCtx.conversationHistory;
          const historyText = history.map((turn, i) =>
            `【第${i + 1}轮】\n用户: ${turn.user}\n助手: ${turn.assistant.substring(0, 400)}...`
          ).join('\n\n');
          sessionContext = `\n\n[对话历史摘要]\n以下是本对话窗口中之前的对话内容摘要，请在回答时参考这些上下文：\n${historyText}\n\n[当前问题]\n`;
        }
        messageContent.innerHTML = `
          <div class="adp-progress cc-streaming-progress" id="adpProgress">
            <div class="adp-progress-header" id="ccProgressHeader">
              <div class="adp-progress-spinner"></div>
              <span class="adp-progress-title" id="ccProgressTitle">M-Agent 处理中</span>
              <span class="adp-progress-status" id="ccProgressStatus"></span>
              <span class="adp-progress-timer" id="adpProgressTimer">0s</span>
            </div>
            <div class="adp-progress-steps cc-progress-steps" id="adpProgressSteps"></div>
          </div>`;

        // 获取当前会话的 ccSessionId（用于 resume）
        const activeSession = this._activeSessionId
          ? this._chatSessions.find(s => s.id === this._activeSessionId)
          : null;
        const ccSessionId = activeSession?.ccSessionId || null;
        console.log('[CC] sendAIMessage | activeSessionId:', this._activeSessionId, '| ccSessionId:', ccSessionId, '| sessionFound:', !!activeSession);

        this._ccTimerStart = Date.now();
        this._ccLastEventTime = Date.now();
        this._ccTimerInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - this._ccTimerStart) / 1000);
          let el = this._ccTimerEl;
          if (!el) {
            el = messageContent.querySelector('#adpProgressTimer') || document.getElementById('adpProgressTimer');
            this._ccTimerEl = el;
          }
          if (el) el.textContent = elapsed + 's';
          // 心跳检测：超过 4 秒无事件，显示"思考中"状态
          const idleSecs = Math.floor((Date.now() - this._ccLastEventTime) / 1000);
          const statusEl = messageContent.querySelector('#ccProgressStatus');
          if (idleSecs >= 4 && statusEl && this._ccStreaming) {
            const stepsEl = messageContent.querySelector('#adpProgressSteps');
            const totalSteps = stepsEl ? stepsEl.querySelectorAll('.adp-progress-step').length : 0;
            const doneSteps = stepsEl ? stepsEl.querySelectorAll('.adp-progress-step.done').length : 0;
            const dots = '.'.repeat((idleSecs % 3) + 1);
            statusEl.textContent = `${doneSteps}/${totalSteps} 步骤 · 思考中${dots} (${elapsed}s)`;
          }
        }, 1000);

        // 🔧 关键修复：在 ccInvoke 之前注册流式监听器并缓冲事件
        // 原因：main.js 的 cc:invoke 在返回 result 之前就开始推送 cc:stream 事件
        // 如果在 ccResult 返回后才注册监听器，早期事件（session/init/thinking/tool_use）会丢失
        this._ccStreamBuffer = [];
        this._ccStreamListening = true;
        document.body.classList.add('streaming-active');
        this._ccCurrentText = '';
        this._ccThinkingText = '';
        this._ccRenderPending = false;
        // 重置自动批准标志（每次新对话都需要重新确认）
        this._ccAutoApproveCommands = false;
        // Clean up any previous subtask listeners before starting new message
        window.electronAPI?.removeCCSubTaskListeners?.();
        // 注册权限请求监听器
        window.electronAPI?.removeCCPermissionRequestListeners?.();
        window.electronAPI?.onCCPermissionRequest?.((data) => {
          this._showCCPermissionDialog(data);
        });
        window.electronAPI.onCCStream((evt) => {
          this._ccLastEventTime = Date.now();
          if (this._ccStreamListening) {
            this._ccStreamBuffer.push(evt);
            console.log('[CC] Buffered event:', evt.event);
          }
        });

        // 子任务事件监听（独立通道，在 CC done 后继续接收）
        window.electronAPI.onCCSubTask((evt) => {
          this._handleSubTaskEvent(evt, messageContent);
          // Update last event time to keep timer running during subtask polling
          this._ccLastEventTime = Date.now();
        });

        const ccResult = await window.electronAPI.ccInvoke({
          message: sessionContext ? sessionContext + sendMessage : sendMessage,
          attachments: attachmentData,
          sessionId: ccSessionId,
          systemRole: localContextSystemRole || options.systemRole || '',
          workdir: this._getCCWorkdir(),
          skill: document.getElementById('ccSkillSelect')?.value || '',
          connectorIds: this._getSelectedConnectorIds(),
          openRouterModel: document.getElementById('ccOpenRouterSelect')?.value || '',
          providerId: document.getElementById('ccProviderSelect')?.value || '',
        });

        if (ccResult.success && ccResult.streaming) {
          this._ccStreaming = true;
          this._updateStreamingUI(true);

          // 处理缓冲的事件
          this._ccStreamListening = false;
          document.body.classList.remove('streaming-active');
          const bufferedEvents = this._ccStreamBuffer || [];
          this._ccStreamBuffer = [];
          console.log('[CC] Processing buffered events:', bufferedEvents.length);

          for (const evt of bufferedEvents) {
            this._handleCCStreamEvent(evt, assistantMessage);
            if (evt.event === 'done' || evt.event === 'error') break;
          }

          // 如果还没完成，继续等待后续流式事件
          if (!bufferedEvents.some(e => e.event === 'done' || e.event === 'error')) {
            await new Promise((resolve) => {
              this._ccStreamResolve = resolve;
              // 移除旧监听器，注册新的直接处理模式
              window.electronAPI.removeCCListeners();
              window.electronAPI.onCCStream((evt) => {
                this._ccLastEventTime = Date.now();
                this._handleCCStreamEvent(evt, assistantMessage);
              });
            });
          }
        } else {
          // 清理监听器
          this._ccStreamListening = false;
          this._ccStreamBuffer = [];
          window.electronAPI?.removeCCListeners?.();
          throw new Error(ccResult.error || 'CC 调用失败');
        }
      } else if (window.electronAPI?.agent?.invoke) {
        // Agent 或 LLM 模式：使用本地 AI 流式输出
        const agentType = this._aiAssistantMode === 'llm' ? 'chat' : undefined;

        // 🔧 将用户选择的 skill 注入到消息中
        const _selectedSkill = document.getElementById('ccSkillSelect')?.value || '';
        const _selectedModel = document.getElementById('ccOpenRouterSelect')?.value || '';
        let _agentMessage = sendMessage;
        if (_selectedSkill) {
          _agentMessage = `[用户要求使用 Skill: ${_selectedSkill}]\n请在回答中优先使用 ${_selectedSkill} 这个技能来完成任务。\n\n${sendMessage}`;
        }
        // 注入本地上下文到消息前部
        if (localContextSystemRole) {
          _agentMessage = `${localContextSystemRole}\n\n${_agentMessage}`;
        }

        // 先注册流式监听器（防止竞态：invoke 返回前主进程可能已开始推送事件）
        this._agentStreamBuffer = [];
        this._agentStreamListening = true;
        document.body.classList.add('streaming-active');
        window.electronAPI.onAgentStream((evt) => {
          if (this._agentStreamListening) {
            this._agentStreamBuffer.push(evt);
          }
        });

        result = await window.electronAPI.agent.invoke(_agentMessage, agentType, attachmentData, _selectedModel);
        
        if (result.success && result.streaming) {
          // 流式模式：处理缓冲事件 + 后续事件
          this._agentStreaming = true;
          this._agentCurrentText = '';
          this._agentReasoningText = '';
          this._agentCurrentBubble = null;
          this._agentRenderPending = false;
          this._agentType = result.agentType;
          this._agentTraceId = result.traceId;
          this._agentStreamTimerStart = Date.now();
          this._agentStreamTimerInterval = setInterval(() => {
            this._updateAgentStreamTimer();
          }, 1000);

          // 替换占位符为流式渲染区域
          const messageContent = assistantMessage.querySelector('.message-content');
          const agentLabels = { priority: '🎯 优先级规划', knowledge: '📚 知识梳理', memory: '🧠 记忆整理', report: '📊 日报生成', chat: '🤖 LLM 对话' };
          const badgeCls = result.agentType === 'chat' ? 'agent-badge agent-badge-llm' : 'agent-badge';
          messageContent.innerHTML = `<div class="${badgeCls}">${agentLabels[result.agentType] || '💬 对话'}</div><div class="agent-stream-text" id="agentStreamText"></div>`;

          // 切换到直接监听模式，处理缓冲的事件
          this._agentStreamListening = false;
          document.body.classList.remove('streaming-active');
          const bufferedEvents = this._agentStreamBuffer || [];
          this._agentStreamBuffer = [];

          // 处理缓冲事件
          for (const evt of bufferedEvents) {
            this._handleAgentStreamEvent(evt, messageContent);
            if (evt.event === 'done') break;
          }

          // 如果还没完成，继续等待流式事件
          if (!bufferedEvents.some(e => e.event === 'done')) {
            await new Promise((resolve) => {
              this._agentStreamResolve = resolve;
              // 监听器已在前面注册，切换为直接处理模式
              window.electronAPI.removeAgentListeners();
              window.electronAPI.onAgentStream((evt) => {
                this._handleAgentStreamEvent(evt, messageContent);
              });
            });
          }
        } else if (result.success && !result.streaming) {
          // 兼容旧模式（非流式返回）— 清理预注册的监听器
          this._agentStreamListening = false;
          this._agentStreamBuffer = [];
          window.electronAPI?.removeAgentListeners?.();
          document.body.classList.remove('streaming-active');

          const messageContent = assistantMessage.querySelector('.message-content');
          const agentLabels = { priority: '🎯 优先级规划', knowledge: '📚 知识梳理', memory: '🧠 记忆整理', report: '📊 日报生成', chat: '🤖 LLM 对话' };
          const badgeCls = result.agentType === 'chat' ? 'agent-badge agent-badge-llm' : 'agent-badge';
          let html = `<div class="${badgeCls}">${agentLabels[result.agentType] || '💬 对话'}</div>`;
          if (result.result && typeof result.result === 'object') {
            html += this.renderAgentResult(result.result, result.agentType);
          } else if (typeof result.result === 'string') {
            const parsed = this._robustJSONParse(result.result);
            if (parsed && result.agentType === 'chat') {
              html += `<div class="chat-markdown-content">${this._renderChatJSONAsMarkdown(parsed)}</div>`;
            } else if (parsed) {
              html += this.renderAgentResult(parsed, result.agentType);
            } else {
              html += `<div class="chat-markdown-content">${this._renderADPMarkdown(result.result)}</div>`;
            }
          } else {
            html += `<p>${this.escapeHtml(result.result?.text || JSON.stringify(result.result))}</p>`;
          }
          if (result.traceId) {
            html += `<div class="agent-feedback" data-trace-id="${result.traceId}">
              <button class="feedback-btn feedback-accept" title="有用">👍</button>
              <button class="feedback-btn feedback-reject" title="没用">👎</button>
            </div>`;
          }
          html += '<button class="copy-btn" title="复制"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>';
          const sendTime = assistantMessage.dataset.sendTime;
          const timeLabel = sendTime
            ? `${this._formatChatTime(new Date(sendTime))} → ${this._formatChatTime(new Date())}`
            : this._formatChatTime(new Date());
          html += `<span class="message-time assistant-time">${timeLabel}</span>`;
          messageContent.innerHTML = html;
          // 事件委托：存储结果数据供 _handleChatClick 使用（无需单独 addEventListener）
          this._chatMsgData.set(messageContent, { result: result.result, agentType: result.agentType });
        } else {
          this._agentStreamListening = false;
          this._agentStreamBuffer = [];
          window.electronAPI?.removeAgentListeners?.();
          throw new Error(result.error || 'Agent 调用失败');
        }
      }
      // Agent 非流式/流式完成后保存会话消息
      this._saveCurrentSessionMessages();
      const msgContent = assistantMessage?.querySelector('.message-content');
      if (msgContent) this._syncPushCurrentConversation(msgContent);
    } catch (error) {
      console.error('[AI] Error:', error);
      this._agentStreamListening = false;
      this._agentStreamBuffer = [];
      window.electronAPI?.removeAgentListeners?.();
      // CC 模式错误清理
      this._ccStreaming = false;
      if (this._ccTimerInterval) { clearInterval(this._ccTimerInterval); this._ccTimerInterval = null; }
      this._ccTimerEl = null;
      window.electronAPI?.removeCCListeners?.();
      this._updateStreamingUI(false);
      document.body.classList.remove('streaming-active');
      const messageContent = assistantMessage.querySelector('.message-content');
      messageContent.innerHTML = `<p class="error-text">抱歉，发生了错误：${this.escapeHtml(error.message)}</p>
        <p class="error-hint">请检查 API 配置或网络连接</p>`;
      // 即使出错也保存，避免丢失之前的消息
      this._saveCurrentSessionMessages();
    }
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  // === 聊天消息事件委托处理器 ===
  // 统一处理聊天消息内所有按钮点击，替代每条消息单独 addEventListener
  async _handleChatClick(e) {
    // --- v3.1.2: 文件路径链接（打开/在 Finder 中显示）---
    const fileLink = e.target.closest('.chat-file-link');
    if (fileLink) {
      e.preventDefault();
      e.stopPropagation();
      const filePath = fileLink.dataset.filepath;
      if (!filePath) return;
      const actionBtn = e.target.closest('.chat-file-action-btn');
      const action = actionBtn?.dataset.action || 'open';
      try {
        if (action === 'reveal') {
          await window.electronAPI?.localFilesReveal?.(filePath);
          this.showToast('已在 Finder 中显示', 'info');
        } else {
          const result = await window.electronAPI?.localFilesOpen?.(filePath);
          if (result?.success === false) {
            this.showToast('打开失败: ' + (result.error || '文件不存在'), 'error');
          }
        }
      } catch (err) {
        this.showToast('操作失败: ' + err.message, 'error');
      }
      return;
    }

    // --- 复制助手消息 ---
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const messageContent = copyBtn.closest('.message-content');
      if (messageContent) {
        await this.copyAssistantMessage(copyBtn, messageContent);
      }
      return;
    }

    // --- 复制用户消息 ---
    const copyUserBtn = e.target.closest('.copy-user-msg');
    if (copyUserBtn) {
      e.stopPropagation();
      e.preventDefault();
      const mc = copyUserBtn.closest('.message-content');
      if (mc) {
        const text = this._getFullUserMessageText(mc);
        if (!text) { this.showToast('没有可复制的内容', 'error'); return; }
        try {
          if (window.electronAPI?.writeClipboardText) {
            await window.electronAPI.writeClipboardText(text);
          } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
          copyUserBtn.style.color = '#34C759';
          this.showToast('已复制到剪贴板', 'success');
          setTimeout(() => { copyUserBtn.style.color = ''; }, 1500);
        } catch (err) {
          console.error('[Copy] User msg copy failed:', err);
          this.showToast('复制失败: ' + (err.message || ''), 'error');
        }
      }
      return;
    }

    // --- 编辑用户消息 ---
    const editBtn = e.target.closest('.edit-user-msg');
    if (editBtn) {
      e.stopPropagation();
      e.preventDefault();
      const mc = editBtn.closest('.message-content');
      if (mc) {
        const text = this._getFullUserMessageText(mc);
        const inputEl = document.getElementById('aiChatInput');
        if (inputEl && text) {
          inputEl.value = text;
          inputEl.style.height = 'auto';
          inputEl.style.height = inputEl.scrollHeight + 'px';
          inputEl.focus();
          this.showToast('已加载到输入框，可直接发送', 'success');
        }
      }
      return;
    }

    // --- 反馈：有用 ---
    const feedbackAccept = e.target.closest('.feedback-accept');
    if (feedbackAccept) {
      e.stopPropagation();
      const fd = feedbackAccept.closest('.agent-feedback');
      if (fd) {
        const tid = fd.dataset.traceId;
        const mc = fd.closest('.message-content');
        const data = this._chatMsgData.get(mc);
        window.electronAPI?.feedback?.accept(tid, data?.result || data?.parsed || { text: '' });
        fd.innerHTML = '<span class="feedback-done">✓ 感谢反馈</span>';
      }
      return;
    }

    // --- 反馈：没用 ---
    const feedbackReject = e.target.closest('.feedback-reject');
    if (feedbackReject) {
      e.stopPropagation();
      const fd = feedbackReject.closest('.agent-feedback');
      if (fd) {
        const tid = fd.dataset.traceId;
        window.electronAPI?.feedback?.reject(tid, '用户标记无用');
        fd.innerHTML = '<span class="feedback-done">✓ 已记录</span>';
      }
      return;
    }

    // --- Agent 操作按钮 ---
    const actionBtn = e.target.closest('.agent-action-btn');
    if (actionBtn) {
      e.stopPropagation();
      const mc = actionBtn.closest('.message-content');
      const data = this._chatMsgData.get(mc);
      if (data) {
        this.handleAgentAction(actionBtn.dataset.action, data.result || data.parsed, data.agentType);
      }
      return;
    }

    // --- 任务卡片 ---
    const taskCard = e.target.closest('.agent-task-card');
    if (taskCard) {
      e.stopPropagation();
      const title = taskCard.dataset.title;
      const schedule = taskCard.dataset.schedule;
      if (title) {
        this.showTaskModal({ title, description: `排程时间：${schedule || ''}`, estimatedDuration: 60, priority: 'high' });
      }
      return;
    }

    // --- ADP 链接 ---
    const link = e.target.closest('.adp-link');
    if (link) {
      e.preventDefault();
      const url = link.dataset.url || link.getAttribute('href');
      if (url) window.electronAPI?.openExternal(url);
      return;
    }

    // --- 思考过程折叠/展开 ---
    const header = e.target.closest('.adp-thinking-header');
    if (header) {
      header.parentElement.classList.toggle('expanded');
      const toggle = header.querySelector('.adp-thinking-toggle');
      if (toggle) toggle.textContent = header.parentElement.classList.contains('expanded') ? '▼' : '▶';
      return;
    }

    // --- CC 执行过程展开/折叠 ---
    const ccHeader = e.target.closest('.cc-process-header');
    if (ccHeader) {
      const wrapper = ccHeader.closest('.cc-process-wrapper');
      if (wrapper) wrapper.classList.toggle('collapsed');
      return;
    }

    // --- 文件卡片保存按钮 ---
    const fileSaveBtn = e.target.closest('.adp-file-save-btn');
    if (fileSaveBtn) {
      e.stopPropagation();
      const card = fileSaveBtn.closest('.adp-file-card');
      if (card) {
        const url = card.dataset.url;
        const name = card.dataset.name;
        if ((url && url !== '#') || card.dataset.filepath) {
          this._downloadFileToArtifacts(url, name, card);
        }
      }
      return;
    }

    // --- 文件卡片打开按钮 ---
    const fileOpenBtn = e.target.closest('.adp-file-open-btn');
    if (fileOpenBtn) {
      e.stopPropagation();
      const card = fileOpenBtn.closest('.adp-file-card');
      if (card) {
        const url = card.dataset.url;
        const savedPath = card.dataset.savedPath;
        if (savedPath && window.electronAPI?.artifactsRead) {
          try {
            const result = await window.electronAPI.artifactsRead({ filePath: savedPath });
            if (result.success && result.content) {
              const ext = (card.dataset.name || '').split('.').pop()?.toLowerCase();
              if (['html', 'htm', 'svg'].includes(ext)) {
                const blob = new Blob([result.content], { type: ext === 'svg' ? 'image/svg+xml' : 'text/html' });
                const blobUrl = URL.createObjectURL(blob);
                window.electronAPI?.openExternal(blobUrl);
              } else {
                window.electronAPI?.artifactsShowInFolder?.(savedPath);
              }
              return;
            }
          } catch {}
        }
        if (url && url !== '#') {
          window.electronAPI?.openExternal(url);
        } else {
          this.showToast('请先保存后再打开', 'info');
        }
      }
      return;
    }

    // --- Agent 产物保存按钮 ---
    const artifactSaveBtn = e.target.closest('.agent-save-artifact-btn');
    if (artifactSaveBtn) {
      e.preventDefault();
      e.stopPropagation();
      const pre = artifactSaveBtn.closest('pre') || artifactSaveBtn.previousElementSibling;
      if (!pre) return;
      const codeEl = pre.querySelector('code');
      if (!codeEl) return;
      const content = codeEl.textContent || '';
      const lang = artifactSaveBtn.dataset.lang || '';
      let fileName = '';
      const lowerLang = lang.toLowerCase();
      if (lowerLang === 'html' || lowerLang === 'htm') {
        const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
        fileName = titleMatch ? titleMatch[1].trim().replace(/[<>:"/\\|?*]/g, '_') + '.html' : 'page.html';
      } else if (lowerLang === 'json') {
        fileName = 'data.json';
      } else if (lowerLang === 'css') {
        fileName = 'style.css';
      } else if (lowerLang === 'javascript' || lowerLang === 'js') {
        fileName = 'script.js';
      } else if (lowerLang === 'typescript' || lowerLang === 'ts') {
        fileName = 'script.ts';
      } else if (lowerLang === 'python' || lowerLang === 'py') {
        fileName = 'script.py';
      } else if (lowerLang === 'svg') {
        fileName = 'image.svg';
      } else if (lowerLang === 'xml') {
        fileName = 'data.xml';
      } else if (lowerLang === 'markdown' || lowerLang === 'md') {
        fileName = 'document.md';
      } else {
        fileName = `artifact-${Date.now()}.${lowerLang || 'txt'}`;
      }
      try {
        const result = await window.electronAPI?.artifactsSave?.({ content, fileName, source: 'agent' });
        if (result?.success) {
          this.showToast(`已保存: ${result.name}`);
        } else {
          this.showToast('保存失败: ' + (result?.error || '未知错误'), 'error');
        }
      } catch (err) {
        this.showToast('保存异常: ' + err.message, 'error');
      }
      return;
    }

    // --- Agent 产物打开按钮 ---
    const artifactOpenBtn = e.target.closest('.agent-open-artifact-btn');
    if (artifactOpenBtn) {
      e.preventDefault();
      e.stopPropagation();
      const savedPath = artifactOpenBtn.dataset.savedPath;
      if (savedPath) {
        window.electronAPI?.openExternal?.('file://' + savedPath);
      }
      return;
    }

    // --- CC 代码块按钮（保存/打开/预览/复制/执行/总是同意/忽略/拒绝）---
    const ccSaveBtn = e.target.closest('.cc-code-save-btn');
    const ccOpenBtn = e.target.closest('.cc-code-open-btn');
    const ccPreviewBtn = e.target.closest('.cc-code-preview-btn');
    const ccCopyBtn = e.target.closest('.cc-code-copy-btn');
    const ccExecBtn = e.target.closest('.cc-code-exec-btn');
    const ccAllowBtn = e.target.closest('.cc-code-allow-btn');
    const ccIgnoreBtn = e.target.closest('.cc-code-ignore-btn');
    const ccRejectBtn = e.target.closest('.cc-code-reject-btn');
    if (ccSaveBtn || ccOpenBtn || ccPreviewBtn || ccCopyBtn || ccExecBtn || ccAllowBtn || ccIgnoreBtn || ccRejectBtn) {
      e.preventDefault();
      e.stopPropagation();
      const clickedBtn = ccSaveBtn || ccOpenBtn || ccPreviewBtn || ccCopyBtn || ccExecBtn || ccAllowBtn || ccIgnoreBtn || ccRejectBtn;
      const toolbar = clickedBtn.closest('.cc-code-toolbar');
      const pre = toolbar?.nextElementSibling;
      const codeEl = pre?.querySelector('code');
      if (!codeEl) return;
      const codeContent = codeEl.textContent || '';
      const lang = toolbar.querySelector('.cc-code-lang')?.textContent || 'txt';
      const extMap = { html: 'html', svg: 'svg', xml: 'xml', json: 'json', md: 'md', markdown: 'md', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py', css: 'css', yaml: 'yaml', yml: 'yml', bash: 'sh', shell: 'sh', sql: 'sql', csv: 'csv' };
      const ext = extMap[lang] || 'txt';
      const fileName = `cc-output-${Date.now()}.${ext}`;

      if (ccCopyBtn) {
        try {
          await navigator.clipboard.writeText(codeContent);
          ccCopyBtn.textContent = '已复制';
          setTimeout(() => { ccCopyBtn.textContent = '复制'; }, 2000);
        } catch {
          this.showToast('复制失败', 'error');
        }
        return;
      }
      if (ccAllowBtn) {
        // 总是同意：设置自动批准标志，然后执行当前命令
        this._ccAutoApproveCommands = true;
        ccAllowBtn.textContent = '已开启';
        ccAllowBtn.disabled = true;
        this.showToast('已开启自动执行，后续命令无需确认', 'success');
        await this._executeCommandInline(ccExecBtn, pre, codeContent);
        return;
      }
      if (ccExecBtn) {
        await this._executeCommandInline(ccExecBtn, pre, codeContent);
        return;
      }
      if (ccIgnoreBtn) {
        toolbar.querySelectorAll('.cc-code-exec-btn, .cc-code-allow-btn, .cc-code-ignore-btn, .cc-code-reject-btn').forEach(b => b.remove());
        const badge = document.createElement('span');
        badge.className = 'cc-command-status cc-command-ignored';
        badge.textContent = '已忽略';
        toolbar.appendChild(badge);
        return;
      }
      if (ccRejectBtn) {
        toolbar.querySelectorAll('.cc-code-exec-btn, .cc-code-allow-btn, .cc-code-ignore-btn, .cc-code-reject-btn').forEach(b => b.remove());
        const badge = document.createElement('span');
        badge.className = 'cc-command-status cc-command-rejected';
        badge.textContent = '已拒绝';
        toolbar.appendChild(badge);
        return;
      }
      if (ccPreviewBtn) {
        this._showHTMLPreview(codeContent, ext);
        return;
      }
      if (ccSaveBtn) {
        ccSaveBtn.disabled = true;
        ccSaveBtn.textContent = '保存中...';
      }
      try {
        const result = await window.electronAPI?.artifactsSave?.({ content: codeContent, fileName, source: 'cc' });
        if (result?.success) {
          if (ccSaveBtn) { ccSaveBtn.textContent = '已保存'; ccSaveBtn.disabled = false; }
          if (ccOpenBtn || ccSaveBtn) {
            this.showToast(`已保存到 Agent 产物: ${result.name}`);
          }
          if (ccOpenBtn) {
            window.electronAPI?.openExternal?.('file://' + result.path);
          }
        } else {
          if (ccSaveBtn) { ccSaveBtn.textContent = '💾 保存'; ccSaveBtn.disabled = false; }
          this.showToast('保存失败: ' + (result?.error || '未知错误'), 'error');
        }
      } catch (err) {
        if (ccSaveBtn) { ccSaveBtn.textContent = '💾 保存'; ccSaveBtn.disabled = false; }
        this.showToast('操作异常: ' + err.message, 'error');
      }
      return;
    }
  },

  // === 提取用户消息完整文本（含附件信息）===
  _getFullUserMessageText(msgContent) {
    const p = msgContent.querySelector('p');
    let text = p ? p.textContent : '';
    const attItems = msgContent.querySelectorAll('.message-attachment-item');
    if (attItems.length > 0) {
      text += '\n';
      attItems.forEach(item => {
        const name = item.dataset.attName || item.textContent.trim();
        const path = item.dataset.attPath || '';
        if (path) {
          text += `\n📎 ${name} (${path})`;
        } else {
          text += `\n📎 ${name}`;
        }
      });
    }
    return text.trim();
  },

  async copyAssistantMessage(btn, messageContent) {
    // 获取纯文本内容，排除复制按钮、反馈按钮等非内容元素
    const clone = messageContent.cloneNode(true);
    // 移除不需要复制的元素（含 CC 代码块工具栏等）
    clone.querySelectorAll('.copy-btn, .agent-feedback, .agent-badge, .adp-config-source, .adp-progress, .adp-thinking-section, .adp-files-section, .message-time, .agent-save-artifact-btn, .agent-open-artifact-btn, .agent-artifact-btns, .adp-file-save-btn, .adp-file-open-btn, .agent-task-card, .adp-step-detail, .msg-action-btn, .user-msg-actions, .cc-code-toolbar, .cc-command-output, .agent-streaming-hint, .agent-reasoning-stream').forEach(el => el.remove());
    // 使用 textContent 获取纯文本（不含格式），再清理多余空白
    const text = (clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    console.log('[Copy] Text length:', text.length, 'Preview:', text.slice(0, 100));
    try {
      // 优先通过主进程写入，确保写入纯文本而非富文本/图片
      if (window.electronAPI?.writeClipboardText) {
        await window.electronAPI.writeClipboardText(text);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // 最终兜底：创建临时 textarea 复制
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      btn.classList.add('copied');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      this.showToast('已复制到剪贴板', 'success');
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      }, 2000);
    } catch (err) {
      console.error('[Copy] Failed:', err);
      this.showToast('复制失败: ' + (err.message || ''), 'error');
    }
  },

  // === 用户消息操作按钮（事件委托，无需单独绑定）===
  _bindUserMsgActions(msgContent) {
    // 事件委托已在 _handleChatClick 中统一处理，此方法保留为空以兼容调用点
  },

  // === 恢复消息事件（事件委托，无需重新绑定）===
  _bindRestoredMessageActions() {
    // 事件委托已在 _handleChatClick 中统一处理，无需重新绑定
  },

  // ===== M-Agent 流式渲染 =====

  _handleCCStreamEvent(evt, assistantMessage) {
    const messageContent = assistantMessage.querySelector('.message-content');
    if (!messageContent) return;

    this._ccLastEventTime = Date.now();
    const { event, content, sessionId, usage, result, name, error, aborted, level } = evt;

    // 会话 ID（用于 resume）
    if (event === 'session' && sessionId) {
      if (this._activeSessionId) {
        const session = this._chatSessions.find(s => s.id === this._activeSessionId);
        if (session && session.ccSessionId !== sessionId) {
          session.ccSessionId = sessionId;
          this._saveChatSessions();
          console.log('[CC] Saved ccSessionId for session', this._activeSessionId, ':', sessionId);
        }
      }
      this._addCCProgressStep(messageContent, '🧠', 'M-Agent 已启动', 'done');
      return;
    }

    // 信息提示（中间状态：skill 安装、通知、警告等）
    if (event === 'info' && content) {
      const icon = level === 'warning' ? '⚠️' : (level === 'suggestion' ? '💡' : 'ℹ️');
      this._addCCProgressStep(messageContent, icon, content, 'active', 'info');
      // 滚动到底部
      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }

    // 思考过程
    if (event === 'thinking' && content) {
      this._ccThinkingText = (this._ccThinkingText || '') + content;
      if (!this._ccRenderPending) {
        this._ccRenderPending = true;
        requestAnimationFrame(() => {
          this._renderCCStream(messageContent);
          this._ccRenderPending = false;
        });
      }
      return;
    }

    // 文本增量
    if (event === 'delta' && content) {
      this._ccCurrentText += content;

      if (!this._ccRenderPending) {
        this._ccRenderPending = true;
        requestAnimationFrame(() => {
          this._renderCCStream(messageContent);
          this._ccRenderPending = false;
        });
      }
      return;
    }

    // 工具调用开始
    if (event === 'tool_use' && name) {
      const toolIcon = this._getCCToolIcon(name);
      const toolLabel = this._getCCToolLabel(name);
      this._addCCProgressStep(messageContent, toolIcon, toolLabel, 'active', 'tool_call');
      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }

    // 工具执行进度（耗时更新）
    if (event === 'tool_progress' && name) {
      const steps = messageContent.querySelectorAll('.adp-progress-step.active[data-type="tool_call"]');
      if (steps.length > 0) {
        const lastStep = steps[steps.length - 1];
        const labelEl = lastStep.querySelector('.adp-step-label');
        if (labelEl && evt.elapsed != null) {
          // 更新 label 显示耗时（避免重复追加）
          const baseLabel = labelEl.dataset.baseLabel || labelEl.textContent.replace(/\s*\(\d+s\)$/, '');
          labelEl.dataset.baseLabel = baseLabel;
          labelEl.textContent = `${baseLabel} (${Math.round(evt.elapsed)}s)`;
        }
      }
      return;
    }

    // 工具调用摘要
    if (event === 'tool_summary' && content) {
      this._addCCProgressStep(messageContent, '📝', content, 'done', 'summary');
      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }

    // 工具结果
    if (event === 'tool_result') {
      // 工具完成后更新步骤状态
      const steps = messageContent.querySelectorAll('.adp-progress-step.active');
      if (steps.length > 0) {
        const lastStep = steps[steps.length - 1];
        lastStep.classList.remove('active');
        lastStep.classList.add('done');
        const labelEl = lastStep.querySelector('.adp-step-label');
        if (labelEl) {
          const baseLabel = labelEl.dataset.baseLabel || labelEl.textContent;
          labelEl.textContent = `${baseLabel} ✓`;
        }
      }
      return;
    }

    // 流结束
    if (event === 'done') {
      this._finishCCMessage(messageContent, usage, result, aborted, null, evt.cost);
      return;
    }

    // 错误
    if (event === 'error') {
      this._finishCCMessage(messageContent, null, null, false, error);
      return;
    }

    // ─── 子任务事件（SubTask Poller）───
    if (evt._subtask) {
      this._handleSubTaskEvent(evt, messageContent);
      return;
    }
  },

  _renderCCStream(messageContent) {
    const text = this._ccCurrentText || '';
    const thinking = this._ccThinkingText || '';
    // 保留进度步骤区域，更新文本区域
    let textEl = messageContent.querySelector('.cc-stream-text');
    if (!textEl) {
      textEl = document.createElement('div');
      textEl.className = 'cc-stream-text chat-markdown-content';
      messageContent.appendChild(textEl);
    }
    // 思考过程展示（折叠样式）
    const thinkingHtml = thinking ? `<div class="agent-reasoning-stream"><div class="agent-reasoning-header"><span class="thinking-dots"><span></span><span></span><span></span></span><span class="reasoning-label">💭 思考中...</span></div><div class="agent-reasoning-content">${this._renderReasoningPreview(thinking)}</div></div>` : '';
    const contentHtml = text ? this._renderADPMarkdown(text) : '';
    const hint = (text || thinking) ? '<div class="agent-streaming-hint"><span class="agent-streaming-dots">●●●</span> 正在生成...</div>' : '';
    textEl.innerHTML = `${hint}${thinkingHtml}${contentHtml}`;

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
    this._updateScrollButtons();
  },

  _addCCProgressStep(messageContent, icon, label, status, type) {
    const stepsEl = messageContent.querySelector('#adpProgressSteps');
    if (!stepsEl) return;
    const step = document.createElement('div');
    step.className = `adp-progress-step ${status}`;
    step.dataset.type = type || '';
    const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    step.innerHTML = `<span class="adp-step-icon">${icon}</span><span class="adp-step-label">${this.escapeHtml(label)}</span><span class="adp-step-time">${timeStr}</span>`;
    stepsEl.appendChild(step);
    // 更新进度计数和状态文字
    this._updateCCProgressStatus(messageContent);
    // 自动滚动到最新步骤
    if (stepsEl.parentElement) {
      stepsEl.parentElement.scrollTop = stepsEl.parentElement.scrollHeight;
    }
  },

  _updateCCProgressStatus(messageContent) {
    const stepsEl = messageContent.querySelector('#adpProgressSteps');
    if (!stepsEl) return;
    const totalSteps = stepsEl.querySelectorAll('.adp-progress-step').length;
    const doneSteps = stepsEl.querySelectorAll('.adp-progress-step.done').length;
    const activeSteps = stepsEl.querySelectorAll('.adp-progress-step.active').length;
    const statusEl = messageContent.querySelector('#ccProgressStatus');
    const titleEl = messageContent.querySelector('#ccProgressTitle');
    if (statusEl) {
      statusEl.textContent = `${doneSteps}/${totalSteps} 步骤${activeSteps > 0 ? ' · 执行中' : ''}`;
    }
    if (titleEl) {
      // 有活跃步骤时显示标题为"正在执行..."
      titleEl.textContent = activeSteps > 0 ? 'M-Agent 正在执行' : (totalSteps > 0 ? 'M-Agent 处理完成' : 'M-Agent 处理中');
    }
  },

  _getCCToolIcon(toolName) {
    const iconMap = { Read: '📖', Glob: '🔍', Grep: '🔎', WebSearch: '🌐', Write: '✏️', Edit: '📝', Bash: '⚡' };
    return iconMap[toolName] || '🔧';
  },

  _getCCToolLabel(toolName) {
    const labelMap = { Read: '读取文件', Glob: '搜索文件', Grep: '搜索内容', WebSearch: '网络搜索', Write: '写入文件', Edit: '编辑文件', Bash: '执行命令' };
    return labelMap[toolName] || toolName;
  },

  // ─── 子任务事件处理 ───
  _handleSubTaskEvent(evt, messageContent) {
    const { event, taskId, message, state, stage, progress, elapsed, result, error } = evt;

    if (event === 'subtask_start') {
      this._addCCProgressStep(messageContent, '🔬', `子任务监控已启动: ${taskId}`, 'active', 'subtask');
      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }

    if (event === 'subtask_progress') {
      const progressStr = progress != null ? ` (${progress}%)` : '';
      const elapsedStr = elapsed != null ? ` ${elapsed}s` : '';
      const stageStr = stage || message || '执行中...';
      const displayText = `${stageStr}${progressStr}${elapsedStr}`;

      // Update last subtask step or add new one
      const subtaskSteps = messageContent.querySelectorAll('.adp-progress-step[data-type="subtask"]');
      if (subtaskSteps.length > 0) {
        const lastStep = subtaskSteps[subtaskSteps.length - 1];
        const labelEl = lastStep.querySelector('.adp-step-label');
        if (labelEl) {
          labelEl.textContent = displayText;
        }
        // Update step status
        lastStep.classList.remove('done', 'error');
        lastStep.classList.add('active');
        // Update icon based on state
        const iconEl = lastStep.querySelector('.adp-step-icon');
        if (iconEl) {
          iconEl.textContent = state === 'completed' ? '✅' : (state === 'failed' ? '❌' : '⏳');
        }
      } else {
        this._addCCProgressStep(messageContent, '⏳', displayText, 'active', 'subtask');
      }

      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }

    if (event === 'subtask_done') {
      // Update last subtask step to done
      const subtaskSteps = messageContent.querySelectorAll('.adp-progress-step[data-type="subtask"]');
      if (subtaskSteps.length > 0) {
        const lastStep = subtaskSteps[subtaskSteps.length - 1];
        lastStep.classList.remove('active');
        lastStep.classList.add('done');
        const iconEl = lastStep.querySelector('.adp-step-icon');
        const labelEl = lastStep.querySelector('.adp-step-label');
        if (iconEl) iconEl.textContent = '✅';
        if (labelEl) {
          const elapsedStr = elapsed != null ? ` (${elapsed}s)` : '';
          labelEl.textContent = `子任务完成${elapsedStr}`;
        }
      } else {
        this._addCCProgressStep(messageContent, '✅', `子任务完成 (${elapsed || 0}s)`, 'done', 'subtask');
      }

      // Render result
      if (result) {
        const resultHtml = this._formatSubTaskResult(result);
        messageContent.insertAdjacentHTML('beforeend', resultHtml);
      }

      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }

    if (event === 'subtask_error' || event === 'subtask_timeout' || event === 'subtask_not_found') {
      const subtaskSteps = messageContent.querySelectorAll('.adp-progress-step[data-type="subtask"]');
      if (subtaskSteps.length > 0) {
        const lastStep = subtaskSteps[subtaskSteps.length - 1];
        lastStep.classList.remove('active');
        lastStep.classList.add('done');
        const iconEl = lastStep.querySelector('.adp-step-icon');
        const labelEl = lastStep.querySelector('.adp-step-label');
        if (iconEl) iconEl.textContent = event === 'subtask_timeout' ? '⏰' : (event === 'subtask_not_found' ? '❓' : '❌');
        if (labelEl) labelEl.textContent = error || message || '子任务异常';
      } else {
        const icon = event === 'subtask_timeout' ? '⏰' : (event === 'subtask_not_found' ? '❓' : '❌');
        this._addCCProgressStep(messageContent, icon, error || message || '子任务异常', 'done', 'subtask');
      }

      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }
  },

  _formatSubTaskResult(result) {
    // Result can be: HTML string, markdown string, or JSON object
    if (typeof result === 'string') {
      // If it looks like HTML, render as-is
      if (result.trim().startsWith('<') && result.includes('</')) {
        return `<div class="subtask-result">${result}</div>`;
      }
      // Otherwise escape and render as preformatted text
      return `<div class="subtask-result"><pre>${this.escapeHtml(result)}</pre></div>`;
    }
    // JSON object — pretty print
    try {
      const jsonStr = JSON.stringify(result, null, 2);
      return `<div class="subtask-result"><pre>${this.escapeHtml(jsonStr)}</pre></div>`;
    } catch (_) {
      return `<div class="subtask-result">${this.escapeHtml(String(result))}</div>`;
    }
  },

  // ─── 供应商选择器初始化 ───
  // cachedData 可选：如果调用方已有 providers + activeProvider 数据，直接复用，避免重复 IPC 调用
  async _initProviderSelector(cachedData) {
    const select = document.getElementById('ccProviderSelect');
    if (!select) return;

    try {
      // 如果有缓存数据直接用，否则才发 IPC 请求
      let data = cachedData;
      if (!data) {
        data = await window.electronAPI.ccGetProviders();
      }
      if (!data || !data.providers) return;

      // Clear existing options
      select.innerHTML = '';

      // Add "默认" option
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '默认';
      select.appendChild(defaultOpt);

      // Group by region
      const cnProviders = data.providers.filter(p => p.region === 'cn');
      const globalProviders = data.providers.filter(p => p.region !== 'cn');

      if (cnProviders.length > 0) {
        const group = document.createElement('optgroup');
        group.label = '── 国内 ──';
        for (const p of cnProviders) {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.icon} ${p.shortName}`;
          if (!p.configured) opt.disabled = true;
          group.appendChild(opt);
        }
        select.appendChild(group);
      }

      if (globalProviders.length > 0) {
        const group = document.createElement('optgroup');
        group.label = '── 海外 ──';
        for (const p of globalProviders) {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.icon} ${p.shortName}`;
          if (!p.configured) opt.disabled = true;
          group.appendChild(opt);
        }
        select.appendChild(group);
      }

      // Set active provider
      if (data.activeProvider) {
        select.value = data.activeProvider;
      }

      // Avoid duplicate change listeners
      if (!select.dataset.providerListenerAdded) {
        select.dataset.providerListenerAdded = 'true';
        select.addEventListener('change', () => {
          const providerId = select.value;
          console.log('[CC] Provider changed to:', providerId);
          this._updateModelSelectorForProvider(providerId);
        });
      }

      // Initialize model selector for the current active provider
      this._updateModelSelectorForProvider(select.value);
    } catch (e) {
      console.error('[CC] Failed to init provider selector:', e);
    }
  },

  async _updateModelSelectorForProvider(providerId) {
    const modelSelect = document.getElementById('ccOpenRouterSelect');
    if (!modelSelect) return;

    const labelEl = document.querySelector('.cc-openrouter-label');

    // 默认 — 重置为 OpenRouter 模型或简单默认
    if (!providerId) {
      modelSelect.innerHTML = '<option value="">默认</option>';
      if (labelEl) labelEl.textContent = '🌐 模型:';
      modelSelect.title = '';
      // 尝试加载 OpenRouter 模型列表
      this._initOpenRouterModelSelector(true);
      return;
    }

    // 获取最新的供应商数据
    let providers = [];
    try {
      const data = await window.electronAPI.ccGetProviders();
      providers = data?.providers || [];
    } catch (e) {
      console.error('[CC] Failed to fetch providers for model selector:', e);
      return;
    }

    const provider = providers.find(p => p.id === providerId);
    if (!provider) return;

    if (provider.type === 'direct') {
      // 直连供应商（火山引擎/DeepSeek/腾讯云）— 填充预设模型列表
      const modelField = provider.fields.find(f => f.key === 'model');
      modelSelect.innerHTML = '';

      if (modelField && modelField.options) {
        // select 类型 — 有预设选项
        for (const opt of modelField.options) {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = opt.label;
          if (modelField.value === opt.value) option.selected = true;
          modelSelect.appendChild(option);
        }
      } else if (modelField && modelField.value) {
        // text 类型 — 当前配置值作为唯一选项
        const option = document.createElement('option');
        option.value = modelField.value;
        option.textContent = modelField.value;
        modelSelect.appendChild(option);
      } else {
        // 兜底
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '默认';
        modelSelect.appendChild(option);
      }

      if (labelEl) labelEl.textContent = '🤖 模型:';
      modelSelect.title = `${provider.name} 模型`;

      // 避免重复添加 change 监听
      if (!modelSelect.dataset.directModelListenerAdded) {
        modelSelect.dataset.directModelListenerAdded = 'true';
        modelSelect.addEventListener('change', () => {
          const currentProviderId = document.getElementById('ccProviderSelect')?.value;
          if (!currentProviderId) return;
          // 直连供应商的模型选择实时保存到配置
          const currentProvider = providers.find(p => p.id === currentProviderId);
          if (currentProvider && currentProvider.type === 'direct') {
            const modelConfig = {};
            modelConfig[currentProviderId] = { model: modelSelect.value };
            window.electronAPI?.ccSetConfig?.({ providers: modelConfig });
            console.log(`[CC] Model saved for ${currentProvider.name}: ${modelSelect.value}`);
          }
        });
      }
    } else if (provider.type === 'proxy') {
      // 代理供应商（OpenRouter）— 加载动态模型列表
      if (labelEl) labelEl.textContent = '🌐 模型:';
      modelSelect.title = `选择 ${provider.name} 模型`;
      await this._initOpenRouterModelSelector(true);
    }
  },

  // ============ 语音 ASR 实时识别 ============

  _voiceRecording: false,
  _voiceTranscript: '',
  _voicePartialText: '',
  _voiceTimer: null,
  _voiceStartTime: 0,
  _voicePreText: '', // 录音前编辑器已有的文本

  // 主语音按钮：打开新建弹窗并开始录音
  async _toggleMainVoiceInput() {
    // 如果弹窗未打开，先打开
    const modal = document.getElementById('taskModal');
    if (!modal || modal.classList.contains('hidden')) {
      this.showTaskModal();
    }
    // 然后切换录音
    await this._toggleModalVoiceInput();
  },

  // 模态框内语音按钮：切换录音
  async _toggleModalVoiceInput() {
    if (this._voiceRecording) {
      await this._stopVoiceInput();
    } else {
      await this._startVoiceInput();
    }
  },

  async _startVoiceInput() {
    // 检查 ASR 配置
    if (!window.electronAPI?.asrGetConfig) {
      this.showToast('语音功能不可用', 'error');
      return;
    }

    // macOS 麦克风权限检查
    if (window.electronAPI?.asrCheckMicPermission) {
      try {
        const perm = await window.electronAPI.asrCheckMicPermission();
        if (!perm.granted) {
          this.showToast('麦克风权限未授权，请在系统设置 → 隐私与安全 → 麦克风中允许 Memora', 'error');
          return;
        }
      } catch (e) {
        console.error('[Voice] mic permission check failed:', e);
        // 权限检查失败不阻止流程，继续尝试
      }
    }

    const asrConfig = await window.electronAPI.asrGetConfig();
    const provider = asrConfig.provider || 'volcano';

    if (provider === 'volcano' && (!asrConfig.volcano?.appId || !asrConfig.volcano?.token)) {
      this.showToast('请先在设置中配置火山引擎 ASR', 'error');
      return;
    }
    if (provider === 'tencent' && (!asrConfig.tencent?.appId || !asrConfig.tencent?.secretId || !asrConfig.tencent?.secretKey)) {
      this.showToast('请先在设置中配置腾讯云 ASR', 'error');
      return;
    }

    // 确保弹窗已打开
    const modal = document.getElementById('taskModal');
    if (!modal || modal.classList.contains('hidden')) {
      this.showTaskModal();
    }

    // 显示模态框内录音指示器
    const indicator = document.getElementById('modalVoiceIndicator');
    if (indicator) indicator.classList.remove('hidden');

    // 重置状态
    this._voiceTranscript = '';
    this._voicePartialText = '';
    this._voiceStartTime = Date.now();
    // 保存编辑器已有文本（录音结束后追加在前面）
    this._voicePreText = this._aiTaskEditor ? this._aiTaskEditor.getText().trim() : '';

    // 更新指示器状态
    const statusEl = document.getElementById('modalVoiceStatus');
    if (statusEl) statusEl.textContent = '正在连接语音识别服务...';

    // 启动计时器
    this._voiceTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this._voiceStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      const timerEl = document.getElementById('modalVoiceTimer');
      if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    }, 1000);

    // 按钮状态
    const mainBtn = document.getElementById('voiceInputBtn');
    if (mainBtn) mainBtn.classList.add('recording');
    const modalBtn = document.getElementById('aiVoiceInputBtn');
    if (modalBtn) modalBtn.classList.add('recording');

    // 监听 ASR 事件
    window.electronAPI.onASRStart((data) => {
      if (statusEl) statusEl.textContent = `正在聆听（${data.provider === 'volcano' ? '🌋 火山引擎' : '🐧 腾讯云'}）...`;
    });

    window.electronAPI.onASRResult((data) => {
      if (data.isFinal) {
        this._voiceTranscript += data.text;
        this._voicePartialText = '';
      } else {
        this._voicePartialText = data.text;
      }
      // 实时更新 AI 编辑器内容
      this._updateAIEditorFromVoice();
    });

    window.electronAPI.onASRError((data) => {
      console.error('[Voice] ASR error:', data.message);
      if (statusEl) statusEl.textContent = `错误: ${data.message}`;
      this._stopVoiceInput();
    });

    // 启动 ASR 连接
    const result = await window.electronAPI.asrStart({ provider });
    if (!result.success) {
      if (statusEl) statusEl.textContent = '';
      clearInterval(this._voiceTimer);
      if (indicator) indicator.classList.add('hidden');
      if (mainBtn) mainBtn.classList.remove('recording');
      if (modalBtn) modalBtn.classList.remove('recording');
      window.electronAPI.removeASRListeners();
      this.showToast(result.error || 'ASR 启动失败', 'error');
      return;
    }

    // 开始录音
    this._voiceRecording = true;

    if (window.voiceRecorder) {
      window.voiceRecorder.onChunk = async (pcmBuffer) => {
        try {
          const uint8 = new Uint8Array(pcmBuffer);
          window.electronAPI.asrAudioChunk(uint8).catch(() => {});
        } catch (e) {
          console.error('[Voice] onChunk error:', e);
        }
      };
      try {
        await window.voiceRecorder.start();
      } catch (e) {
        this.showToast(`麦克风启动失败: ${e.message}`, 'error');
        this._stopVoiceInput();
      }
    }
  },

  async _stopVoiceInput() {
    if (!this._voiceRecording) return;
    this._voiceRecording = false;

    // 停止录音
    if (window.voiceRecorder) {
      window.voiceRecorder.stop();
    }

    // 停止 ASR
    let result = null;
    try {
      result = await window.electronAPI.asrStop();
    } catch (e) {
      console.error('[Voice] ASR stop error:', e);
    }

    // 移除监听
    window.electronAPI.removeASRListeners();

    // 清理 UI
    clearInterval(this._voiceTimer);
    const mainBtn = document.getElementById('voiceInputBtn');
    if (mainBtn) mainBtn.classList.remove('recording');
    const modalBtn = document.getElementById('aiVoiceInputBtn');
    if (modalBtn) modalBtn.classList.remove('recording');
    const indicator = document.getElementById('modalVoiceIndicator');
    if (indicator) indicator.classList.add('hidden');

    // 更新最终文本
    if (result && result.text) {
      this._voiceTranscript = result.text;
    }
    this._voicePartialText = '';

    // 将识别结果填充到 AI 编辑器
    const finalText = this._voiceTranscript.trim();
    if (finalText) {
      if (this._aiTaskEditor) {
        // 恢复录音前已有文本，追加最终识别结果
        if (this._voicePreText) {
          this._aiTaskEditor.setText(this._voicePreText + '\n' + finalText);
        } else {
          this._aiTaskEditor.setText(finalText);
        }
        this._aiTaskEditor.focus();
      }
      this.showToast(`已识别 ${finalText.length} 字`);
    } else {
      // 没有识别到内容，恢复之前的文本
      if (this._aiTaskEditor && this._voicePreText) {
        this._aiTaskEditor.setText(this._voicePreText);
      }
      this.showToast('未识别到语音内容', 'error');
    }

    this._voiceTranscript = '';
    this._voicePreText = '';
  },

  _cancelVoiceInput() {
    if (this._voiceRecording) {
      this._voiceRecording = false;
      if (window.voiceRecorder) window.voiceRecorder.stop();
      window.electronAPI.asrStop().catch(() => {});
      window.electronAPI.removeASRListeners();
      clearInterval(this._voiceTimer);
    }

    const indicator = document.getElementById('modalVoiceIndicator');
    if (indicator) indicator.classList.add('hidden');

    const mainBtn = document.getElementById('voiceInputBtn');
    if (mainBtn) mainBtn.classList.remove('recording');
    const modalBtn = document.getElementById('aiVoiceInputBtn');
    if (modalBtn) modalBtn.classList.remove('recording');

    this._voiceTranscript = '';
    this._voicePartialText = '';
    this._voicePreText = '';
  },

  // 实时更新 AI 编辑器内容（录音过程中）
  _updateAIEditorFromVoice() {
    if (!this._aiTaskEditor) return;
    const voiceText = this._voiceTranscript + this._voicePartialText;
    if (voiceText) {
      // 保留录音前已有文本，追加语音识别内容
      const fullText = this._voicePreText ? this._voicePreText + '\n' + voiceText : voiceText;
      this._aiTaskEditor.setText(fullText);
    }
  },

  // ============ AI 聊天语音输入 ============

  _chatVoiceRecording: false,
  _chatVoiceTranscript: '',
  _chatVoicePartial: '',
  _chatVoicePreText: '',

  async _toggleChatVoiceInput() {
    if (this._chatVoiceRecording) {
      await this._stopChatVoiceInput();
    } else {
      await this._startChatVoiceInput();
    }
  },

  async _startChatVoiceInput() {
    if (!window.electronAPI?.asrGetConfig) {
      this.showToast('语音功能不可用', 'error');
      return;
    }

    // macOS 麦克风权限检查
    if (window.electronAPI?.asrCheckMicPermission) {
      try {
        const perm = await window.electronAPI.asrCheckMicPermission();
        if (!perm.granted) {
          this.showToast('麦克风权限未授权，请在系统设置 → 隐私与安全 → 麦克风中允许 Memora', 'error');
          return;
        }
      } catch (e) {
        console.error('[ChatVoice] mic permission check failed:', e);
      }
    }

    const asrConfig = await window.electronAPI.asrGetConfig();
    const provider = asrConfig.provider || 'volcano';

    if (provider === 'volcano' && (!asrConfig.volcano?.appId || !asrConfig.volcano?.token)) {
      this.showToast('请先在设置中配置火山引擎 ASR', 'error');
      return;
    }
    if (provider === 'tencent' && (!asrConfig.tencent?.appId || !asrConfig.tencent?.secretId || !asrConfig.tencent?.secretKey)) {
      this.showToast('请先在设置中配置腾讯云 ASR', 'error');
      return;
    }

    // 重置状态
    this._chatVoiceTranscript = '';
    this._chatVoicePartial = '';
    this._chatVoicePreText = '';

    // 保存输入框已有文本
    const chatInput = document.getElementById('aiChatInput');
    if (chatInput) {
      this._chatVoicePreText = chatInput.value.trim();
    }

    // 按钮状态
    const btn = document.getElementById('chatVoiceBtn');
    if (btn) {
      btn.classList.add('recording');
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
      btn.title = '停止语音输入';
    }

    // placeholder 提示
    if (chatInput) {
      chatInput.setAttribute('placeholder', '🎤 正在聆听...');
    }

    // 监听 ASR 事件
    window.electronAPI.onASRStart(() => {
      if (chatInput) chatInput.setAttribute('placeholder', '🎤 正在聆听... 说完后点击停止');
    });

    window.electronAPI.onASRResult((data) => {
      if (data.isFinal) {
        this._chatVoiceTranscript += data.text;
        this._chatVoicePartial = '';
      } else {
        this._chatVoicePartial = data.text;
      }
      this._updateChatInputFromVoice();
    });

    window.electronAPI.onASRError((data) => {
      console.error('[ChatVoice] ASR error:', data.message);
      this.showToast(`语音识别错误: ${data.message}`, 'error');
      this._stopChatVoiceInput();
    });

    // 启动 ASR
    const result = await window.electronAPI.asrStart({ provider });
    if (!result.success) {
      if (btn) {
        btn.classList.remove('recording');
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
        btn.title = '语音输入';
      }
      if (chatInput) chatInput.setAttribute('placeholder', '输入你的问题...');
      window.electronAPI.removeASRListeners();
      this.showToast(result.error || 'ASR 启动失败', 'error');
      return;
    }

    // 开始录音
    this._chatVoiceRecording = true;

    if (window.voiceRecorder) {
      window.voiceRecorder.onChunk = async (pcmBuffer) => {
        try {
          const uint8 = new Uint8Array(pcmBuffer);
          window.electronAPI.asrAudioChunk(uint8).catch(() => {});
        } catch (e) {
          console.error('[ChatVoice] onChunk error:', e);
        }
      };
      try {
        await window.voiceRecorder.start();
      } catch (e) {
        this.showToast(`麦克风启动失败: ${e.message}`, 'error');
        this._stopChatVoiceInput();
      }
    }
  },

  async _stopChatVoiceInput() {
    if (!this._chatVoiceRecording) return;
    this._chatVoiceRecording = false;

    // 停止录音
    if (window.voiceRecorder) {
      window.voiceRecorder.stop();
    }

    // 停止 ASR
    let result = null;
    try {
      result = await window.electronAPI.asrStop();
    } catch (e) {
      console.error('[ChatVoice] ASR stop error:', e);
    }

    // 移除监听
    window.electronAPI.removeASRListeners();

    // 恢复按钮
    const btn = document.getElementById('chatVoiceBtn');
    if (btn) {
      btn.classList.remove('recording');
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
      btn.title = '语音输入';
    }

    // 更新最终文本
    if (result && result.text) {
      this._chatVoiceTranscript = result.text;
    }
    this._chatVoicePartial = '';

    // 填充到聊天输入框
    const chatInput = document.getElementById('aiChatInput');
    const finalText = this._chatVoiceTranscript.trim();
    if (finalText) {
      if (chatInput) {
        const preText = this._chatVoicePreText;
        chatInput.value = preText ? preText + ' ' + finalText : finalText;
        chatInput.style.height = 'auto';
        chatInput.style.height = chatInput.scrollHeight + 'px';
        chatInput.focus();
      }
      this.showToast(`已识别 ${finalText.length} 字`);
    } else {
      if (chatInput) {
        chatInput.value = this._chatVoicePreText;
      }
      this.showToast('未识别到语音内容', 'error');
    }

    // 恢复 placeholder
    if (chatInput) {
      chatInput.setAttribute('placeholder', '输入你的问题...');
    }

    this._chatVoiceTranscript = '';
    this._chatVoicePartial = '';
    this._chatVoicePreText = '';
  },

  _updateChatInputFromVoice() {
    const chatInput = document.getElementById('aiChatInput');
    if (!chatInput) return;
    const voiceText = this._chatVoiceTranscript + this._chatVoicePartial;
    if (voiceText) {
      const preText = this._chatVoicePreText;
      chatInput.value = preText ? preText + ' ' + voiceText : voiceText;
      chatInput.style.height = 'auto';
      chatInput.style.height = chatInput.scrollHeight + 'px';
    }
  },

  // ─── 语音 ASR 设置 ───

  _loadVoiceSettings() {
    if (!window.electronAPI?.asrGetConfig) return;

    window.electronAPI.asrGetConfig().then(config => {
      // 供应商切换
      this._switchASRProvider(config.provider || 'volcano');

      // 火山引擎
      const vAppId = document.getElementById('asrVolcanoAppId');
      const vToken = document.getElementById('asrVolcanoToken');
      const vCluster = document.getElementById('asrVolcanoCluster');
      if (vAppId) vAppId.value = config.volcano?.appId || '';
      if (vToken) vToken.value = '';
      if (vCluster) vCluster.value = config.volcano?.cluster || 'volcengine_streaming_common';

      // 显示 token 已配置状态
      if (config.volcano?.token) {
        vToken.placeholder = '已配置（输入新值覆盖）';
      }

      // 腾讯云
      const tAppId = document.getElementById('asrTencentAppId');
      const tSecretId = document.getElementById('asrTencentSecretId');
      const tSecretKey = document.getElementById('asrTencentSecretKey');
      const tEngineModel = document.getElementById('asrTencentEngineModel');
      if (tAppId) tAppId.value = config.tencent?.appId || '';
      // SecretId 脱敏显示：前4位 + 星号 + 后4位，实际值不变
      if (tSecretId) {
        tSecretId.value = '';
        if (config.tencent?.secretId) {
          const sid = config.tencent.secretId;
          if (sid.length > 12) {
            tSecretId.placeholder = sid.substring(0, 4) + '****' + sid.substring(sid.length - 4) + '（已配置，输入新值覆盖）';
          } else {
            tSecretId.placeholder = '已配置（输入新值覆盖）';
          }
        } else {
          tSecretId.placeholder = 'API 密钥管理页面获取';
        }
      }
      // SecretKey 脱敏显示
      if (tSecretKey) tSecretKey.value = '';
      if (tEngineModel) tEngineModel.value = config.tencent?.engineModelType || '16k_zh_en';

      if (config.tencent?.secretKey) {
        tSecretKey.placeholder = '已配置（输入新值覆盖）';
      }

      // 状态提示
      const statusEl = document.getElementById('asrConfigStatus');
      if (statusEl) {
        const activeProvider = config.provider || 'volcano';
        const providerName = activeProvider === 'volcano' ? '🌋 火山引擎' : '🐧 腾讯云';
        statusEl.innerHTML = `当前供应商: <strong>${providerName}</strong>`;
      }
    });
  },

  _switchASRProvider(provider) {
    document.querySelectorAll('.asr-provider-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.provider === provider);
    });

    const volcanoPanel = document.getElementById('asrVolcanoConfig');
    const tencentPanel = document.getElementById('asrTencentConfig');
    if (volcanoPanel) volcanoPanel.classList.toggle('hidden', provider !== 'volcano');
    if (tencentPanel) tencentPanel.classList.toggle('hidden', provider !== 'tencent');
  },

  async _saveASRConfig() {
    const provider = document.querySelector('.asr-provider-btn.active')?.dataset.provider || 'volcano';

    const config = {
      provider,
      volcano: {
        appId: document.getElementById('asrVolcanoAppId')?.value.trim() || '',
        token: document.getElementById('asrVolcanoToken')?.value.trim() || '',
        cluster: document.getElementById('asrVolcanoCluster')?.value.trim() || 'volcengine_streaming_common',
      },
      tencent: {
        appId: document.getElementById('asrTencentAppId')?.value.trim() || '',
        secretId: document.getElementById('asrTencentSecretId')?.value.trim() || '',
        secretKey: document.getElementById('asrTencentSecretKey')?.value.trim() || '',
        engineModelType: document.getElementById('asrTencentEngineModel')?.value.trim() || '16k_zh_en',
      },
    };

    // 空值不覆盖已配置的值
    if (!config.volcano.token) delete config.volcano.token;
    if (!config.tencent.secretId) delete config.tencent.secretId;
    if (!config.tencent.secretKey) delete config.tencent.secretKey;

    try {
      const result = await window.electronAPI.asrSetConfig(config);
      if (result.success) {
        this.showToast('语音 ASR 配置已保存');
        this._loadVoiceSettings(); // 刷新状态
      } else {
        this.showToast('保存失败', 'error');
      }
    } catch (e) {
      this.showToast(`保存失败: ${e.message}`, 'error');
    }
  },

  async _testASRMicrophone() {
    try {
      const statusEl = document.getElementById('asrConfigStatus');
      if (statusEl) statusEl.innerHTML = '🎤 正在测试麦克风... 请说话';

      // macOS 麦克风权限检查
      if (window.electronAPI?.asrCheckMicPermission) {
        try {
          const perm = await window.electronAPI.asrCheckMicPermission();
          if (!perm.granted) {
            if (statusEl) statusEl.innerHTML = '❌ 麦克风权限未授权，请在系统设置 → 隐私与安全 → 麦克风中允许 Memora';
            this.showToast('麦克风权限未授权', 'error');
            return;
          }
        } catch (e) {
          console.error('[Voice] mic permission check failed:', e);
        }
      }

      // 创建测试 UI
      let testBar = document.getElementById('asrTestBar');
      if (!testBar) {
        testBar = document.createElement('div');
        testBar.id = 'asrTestBar';
        testBar.className = 'voice-test-bar';
        testBar.innerHTML = `
          <span>🎤</span>
          <div class="mic-level"><div class="mic-level-fill" id="asrMicLevelFill"></div></div>
          <span id="asrTestStatus">测试中...</span>
        `;
        const voicePanel = document.getElementById('voicePanel');
        const configSection = voicePanel?.querySelector('.voice-config-section');
        if (configSection) {
          configSection.appendChild(testBar);
        } else {
          // fallback: 追加到保存按钮行后面
          const saveBtn = document.getElementById('saveASRConfigBtn');
          if (saveBtn?.parentElement) saveBtn.parentElement.appendChild(testBar);
        }
      }
      testBar.classList.remove('hidden');

      const fillEl = document.getElementById('asrMicLevelFill');
      const statusText = document.getElementById('asrTestStatus');

      if (!window.voiceRecorder) {
        if (statusText) statusText.textContent = '录音模块未加载';
        if (statusEl) statusEl.innerHTML = '❌ 录音模块未加载，请重启应用';
        return;
      }

      // 如果上次录音未停止，先停止
      if (window.voiceRecorder.isRecording) {
        window.voiceRecorder.stop();
      }

      await window.voiceRecorder.testMicrophone(
        (level) => {
          if (fillEl) fillEl.style.width = `${level}%`;
          if (statusText) statusText.textContent = `音量: ${level}%`;
        },
        (success, error) => {
          if (fillEl) fillEl.style.width = '0%';
          if (success) {
            if (statusText) statusText.textContent = '麦克风正常 ✓';
            if (statusEl) statusEl.innerHTML = '✅ 麦克风测试通过，可以开始使用语音功能';
            setTimeout(() => testBar.classList.add('hidden'), 2000);
          } else {
            if (statusText) statusText.textContent = '失败';
            if (statusEl) statusEl.innerHTML = `❌ 麦克风测试失败: ${error || '未知错误'}`;
          }
        },
        4000
      );
    } catch (e) {
      console.error('[Voice] Test microphone error:', e);
      const statusEl = document.getElementById('asrConfigStatus');
      if (statusEl) statusEl.innerHTML = `❌ 测试出错: ${e.message}`;
      this.showToast(`麦克风测试出错: ${e.message}`, 'error');
    }
  },

  _finishCCMessage(messageContent, usage, result, aborted, error, cost) {
    // 清理流式状态
    this._ccStreaming = false;
    this._ccThinkingText = '';
    if (this._ccTimerInterval) {
      clearInterval(this._ccTimerInterval);
      this._ccTimerInterval = null;
      this._ccTimerEl = null;
    }
    window.electronAPI?.removeCCListeners?.();
    if (this._ccStreamResolve) {
      this._ccStreamResolve();
      this._ccStreamResolve = null;
    }
    this._updateStreamingUI(false);

    // v3.1.2: 保存 session 级对话记忆（用于后续对话上下文注入）
    const finalText = result || this._ccCurrentText || '';
    if (finalText && this._activeSessionId) {
      const session = this._chatSessions.find(s => s.id === this._activeSessionId);
      if (session) {
        if (!session.conversationHistory) session.conversationHistory = [];
        // 保存本轮对话摘要（用户消息 + AI 回复摘要）
        const userMsg = this._ccLastUserMessage || '';
        const aiSummary = finalText.substring(0, 800);
        session.conversationHistory.push({
          user: userMsg.substring(0, 300),
          assistant: aiSummary,
          timestamp: new Date().toISOString(),
        });
        // 最多保留 10 轮对话
        if (session.conversationHistory.length > 10) {
          session.conversationHistory = session.conversationHistory.slice(-10);
        }
        this._saveChatSessions();
        console.log(`[CC] Session memory updated: ${session.conversationHistory.length} turns`);
      }
    }

    // 提取执行过程步骤（流式过程中积累的）
    const progressSteps = messageContent.querySelector('#adpProgressSteps');
    const stepsHtml = progressSteps ? progressSteps.innerHTML : '';
    const allSteps = progressSteps ? progressSteps.querySelectorAll('.adp-progress-step') : [];
    const totalSteps = allSteps.length;
    const doneSteps = progressSteps ? progressSteps.querySelectorAll('.adp-progress-step.done').length : 0;
    const toolSteps = progressSteps ? progressSteps.querySelectorAll('.adp-progress-step[data-type="tool_call"]').length : 0;
    const totalTime = this._ccTimerStart ? Math.floor((Date.now() - this._ccTimerStart) / 1000) : 0;

    let html = '<div class="agent-badge agent-badge-cc">🧠 M-Agent</div>';

    // 执行过程（可折叠）— 只在有步骤时显示
    if (stepsHtml) {
      const stepSummary = `${totalSteps} 个步骤` + (toolSteps > 0 ? ` · ${toolSteps} 次工具调用` : '') + ` · ${totalTime}s`;
      html += `<div class="cc-process-wrapper collapsed" id="ccProcessWrapper">
        <div class="cc-process-header">
          <span class="cc-process-toggle">▶</span>
          <span class="cc-process-title">⚡ 执行过程</span>
          <span class="cc-process-summary">${stepSummary}</span>
        </div>
        <div class="cc-process-body">
          <div class="adp-progress-steps">${stepsHtml}</div>
        </div>
      </div>`;
    }

    if (error) {
      html += `<div class="error-text">❌ ${this.escapeHtml(error)}</div>`;
      html += `<div class="error-hint" style="margin-top:4px;font-size:12px;color:var(--text-secondary);">⏱ 耗时 ${totalTime}s${totalSteps > 0 ? ` · 已执行 ${totalSteps} 步` : ''}</div>`;
    } else {
      // 优先用 result（最终结果），否则用流式累积文本
      const finalText = result || this._ccCurrentText;
      if (finalText) {
        html += `<div class="chat-markdown-content">${this._renderADPMarkdown(finalText)}</div>`;
      }
      if (aborted) {
        html += '<div class="error-text" style="color: var(--text-secondary);">⚠️ 已停止生成</div>';
      }
      // 成本与 usage 信息
      if (usage || cost != null) {
        const parts = [];
        if (usage?.input_tokens) parts.push(`输入 ${usage.input_tokens}`);
        if (usage?.output_tokens) parts.push(`输出 ${usage.output_tokens}`);
        if (cost != null && cost > 0) parts.push(`$${cost.toFixed(4)}`);
        if (totalTime > 0) parts.push(`${totalTime}s`);
        if (parts.length > 0) {
          html += `<div class="adp-config-source" style="color: var(--text-secondary);">📊 ${parts.join(' · ')}</div>`;
        }
      }
    }

    // 复制按钮（由全局事件委托处理点击）
    html += '<button class="copy-btn" title="复制"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>';

    // 时间戳
    const sendTime = messageContent.closest('.message.assistant')?.dataset.sendTime;
    const timeLabel = sendTime
      ? `${this._formatChatTime(new Date(sendTime))} → ${this._formatChatTime(new Date())}`
      : this._formatChatTime(new Date());
    html += `<span class="message-time assistant-time">${timeLabel}</span>`;

    messageContent.innerHTML = html;

    // CC 代码块：添加工具栏（事件由全局委托处理）
    this._enhanceCCCodeBlocks(messageContent);

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

    // ===== AI 完成提醒（与 ADP 模式一致：耗时长 + 用户已切走时） =====
    if (!aborted && !error) {
      const elapsedMs = this._ccTimerStart ? (Date.now() - this._ccTimerStart) : 0;
      this._notifyADPCompleted(messageContent, elapsedMs);
    }
    this._ccTimerStart = null;
  },

  /** 给 CC 输出中的代码块添加工具栏（保存/打开/预览/复制/执行按钮由全局事件委托处理） */
  _enhanceCCCodeBlocks(messageContent) {
    const codeBlocks = messageContent.querySelectorAll('pre code');
    codeBlocks.forEach((codeEl, idx) => {
      const pre = codeEl.closest('pre');
      if (!pre || pre.dataset.ccEnhanced) return;
      pre.dataset.ccEnhanced = 'true';

      // 推断语言
      const langClass = codeEl.className || '';
      const langMatch = langClass.match(/language-(\w+)/);
      let lang = langMatch ? langMatch[1] : '';

      // 无语言标记时，根据内容推断
      const rawContent = codeEl.textContent || '';
      if (!lang) {
        const trimmed = rawContent.trim();
        if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
          lang = 'html';
        } else if (trimmed.startsWith('<svg') || rawContent.includes('xmlns="http://www.w3.org/2000/svg"')) {
          lang = 'svg';
        } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          lang = 'json';
        } else if (trimmed.startsWith('<')) {
          lang = 'xml';
        } else {
          // 检测是否为文件路径：单行内容包含路径分隔符且有文件扩展名
          const isFilePath = /^\/[^\s]*\.\w+$/.test(trimmed) || /^[A-Za-z]:[\\/][^\s]*\.\w+$/.test(trimmed);
          if (isFilePath) {
            const fileExt = trimmed.split('.').pop().toLowerCase();
            const extToLang = {
              html: 'html', htm: 'html',
              svg: 'svg', xml: 'xml', json: 'json',
              md: 'md', markdown: 'md',
              js: 'javascript', mjs: 'javascript',
              ts: 'typescript', css: 'css',
              yaml: 'yaml', yml: 'yml',
              py: 'python', sql: 'sql', csv: 'csv',
              sh: 'bash', bash: 'bash',
            };
            lang = extToLang[fileExt] || 'txt';
          } else {
            lang = 'txt';
          }
        }
      }

      const extMap = { html: 'html', svg: 'svg', xml: 'xml', json: 'json', md: 'md', markdown: 'md', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py', css: 'css', yaml: 'yaml', yml: 'yml', bash: 'sh', shell: 'sh', sql: 'sql', csv: 'csv' };
      const ext = extMap[lang] || 'txt';

      // 检测是否为命令/脚本类型
      const shellLangs = ['bash', 'shell', 'sh', 'zsh', 'fish'];
      const isShell = shellLangs.includes(lang);
      // 无语言标记时检测是否像命令
      const looksLikeCommand = !lang || lang === 'txt'
        ? /^\s*(npm|npx|yarn|pnpm|git|node|python|pip|cd|ls|mkdir|cp|mv|cat|echo|curl|wget|brew|docker|sudo|chmod|grep|sed|awk|find|tar|zip|unzip|export|source|rb|ruby|go|cargo|rustc|make|cmake)\b/.test(rawContent.trim())
        : false;
      const isCommand = isShell || looksLikeCommand;

      // 创建操作栏
      const toolbar = document.createElement('div');
      toolbar.className = 'cc-code-toolbar';
      if (isCommand) toolbar.classList.add('cc-code-toolbar-command');
      // 可打开的类型（用系统默认程序）
      const canOpen = ['html', 'svg', 'json', 'md', 'txt', 'csv', 'xml'].includes(ext);
      // 可预览的类型（iframe 内嵌渲染）
      const canPreview = ['html', 'svg'].includes(ext);

      let toolbarHtml = `<span class="cc-code-lang">${lang}</span>`;
      // 复制按钮（所有代码块都有）
      toolbarHtml += `<button class="cc-code-copy-btn" title="复制代码">复制</button>`;
      // 命令类代码块：执行一次/总是同意/忽略/拒绝
      if (isCommand) {
        toolbarHtml += `<button class="cc-code-exec-btn" title="执行一次（需确认）">执行一次</button>`;
        toolbarHtml += `<button class="cc-code-allow-btn" title="总是同意执行后续命令">总是同意</button>`;
        toolbarHtml += `<button class="cc-code-ignore-btn" title="忽略此命令">忽略</button>`;
        toolbarHtml += `<button class="cc-code-reject-btn" title="拒绝">拒绝</button>`;
      }
      // 保存按钮
      toolbarHtml += `<button class="cc-code-save-btn" title="保存到 Agent 产物">保存</button>`;
      // 预览/打开
      toolbarHtml += `<button class="cc-code-preview-btn" title="预览" style="${canPreview ? '' : 'display:none'}">预览</button>`;
      toolbarHtml += `<button class="cc-code-open-btn" title="在浏览器中打开" style="${canOpen ? '' : 'display:none'}">打开</button>`;

      toolbar.innerHTML = toolbarHtml;
      pre.parentNode.insertBefore(toolbar, pre);

      // 移除 markdown 渲染注入的重复 Agent 产物按钮
      const nextSibling = pre.nextElementSibling;
      if (nextSibling?.classList?.contains('agent-artifact-btns')) {
        nextSibling.remove();
      }
    });
  },

  /** 显示 CC 工具权限请求弹窗（canUseTool 回调） */
  _showCCPermissionDialog({ requestId, toolName, input }) {
    // 避免重复弹窗
    if (document.querySelector(`.cc-permission-dialog[data-request-id="${requestId}"]`)) return;

    // 格式化工具输入信息
    let inputDesc = '';
    try {
      if (toolName === 'Bash' && input?.command) {
        inputDesc = `<div class="cc-perm-label">命令：</div><pre class="cc-perm-code">${this.escapeHtml(input.command)}</pre>`;
      } else if (toolName === 'Write' && input?.file_path) {
        inputDesc = `<div class="cc-perm-label">写入文件：</div><pre class="cc-perm-code">${this.escapeHtml(input.file_path)}</pre>`;
      } else if (toolName === 'Edit' && input?.file_path) {
        inputDesc = `<div class="cc-perm-label">编辑文件：</div><pre class="cc-perm-code">${this.escapeHtml(input.file_path)}</pre>`;
      } else if (toolName === 'Read' && input?.file_path) {
        inputDesc = `<div class="cc-perm-label">读取文件：</div><pre class="cc-perm-code">${this.escapeHtml(input.file_path)}</pre>`;
      } else {
        const inputStr = JSON.stringify(input, null, 2);
        const truncated = inputStr.length > 500 ? inputStr.substring(0, 500) + '...' : inputStr;
        inputDesc = `<div class="cc-perm-label">参数：</div><pre class="cc-perm-code">${this.escapeHtml(truncated)}</pre>`;
      }
    } catch (_) {
      inputDesc = `<pre class="cc-perm-code">${this.escapeHtml(String(input || ''))}</pre>`;
    }

    // 工具名中文映射
    const toolNameMap = {
      'Bash': '执行命令',
      'Write': '写入文件',
      'Edit': '编辑文件',
      'Read': '读取文件',
      'WebSearch': '网络搜索',
      'Glob': '文件搜索',
      'Grep': '内容搜索',
    };
    const toolLabel = toolNameMap[toolName] || toolName;
    const iconMap = { 'Bash': '⚡', 'Write': '✏️', 'Edit': '📝', 'Read': '📖', 'WebSearch': '🔍', 'Glob': '📂', 'Grep': '🔎' };
    const icon = iconMap[toolName] || '🔧';

    const overlay = document.createElement('div');
    overlay.className = 'cc-permission-dialog-overlay';
    overlay.dataset.requestId = requestId;
    overlay.innerHTML = `
      <div class="cc-permission-dialog" data-request-id="${requestId}">
        <div class="cc-perm-header">
          <span class="cc-perm-icon">${icon}</span>
          <span class="cc-perm-title">工具权限请求 — ${this.escapeHtml(toolLabel)}</span>
        </div>
        <div class="cc-perm-body">
          <div class="cc-perm-desc">M-Agent 请求执行以下操作，请确认是否允许：</div>
          ${inputDesc}
        </div>
        <div class="cc-perm-actions">
          <button class="cc-perm-btn cc-perm-allow">允许</button>
          <button class="cc-perm-btn cc-perm-always">总是允许</button>
          <button class="cc-perm-btn cc-perm-deny">拒绝</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const respond = (behavior, alwaysAllow = false) => {
      window.electronAPI?.ccPermissionResponse?.(requestId, { behavior, alwaysAllow });
      overlay.remove();
    };

    overlay.querySelector('.cc-perm-allow').addEventListener('click', () => respond('allow', false));
    overlay.querySelector('.cc-perm-always').addEventListener('click', () => respond('allow', true));
    overlay.querySelector('.cc-perm-deny').addEventListener('click', () => respond('deny', false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) respond('deny', false);
    });
  },

  /** 在对话中直接执行命令并显示输出 */
  async _executeCommandInline(execBtn, pre, command) {
    // 如果已经在执行中，不重复触发
    if (execBtn?.disabled) return;

    // 获取工具栏引用（后续按钮状态更新需要）
    const toolbar = execBtn?.closest('.cc-code-toolbar');

    // 检查是否已有输出区域
    let outputEl = pre.nextElementSibling;
    if (outputEl && outputEl.classList.contains('cc-command-output')) {
      outputEl.remove();
      outputEl = null;
    }

    // 如果未开启自动批准，显示确认弹窗
    if (!this._ccAutoApproveCommands) {
      const shortCmd = command.length > 80 ? command.substring(0, 80) + '...' : command;
      const overlay = document.createElement('div');
      overlay.className = 'cc-exec-confirm-overlay';
      overlay.innerHTML = `
        <div class="cc-exec-confirm-modal">
          <div class="cc-exec-confirm-header">
            <span class="cc-exec-confirm-icon">⚡</span>
            <span class="cc-exec-confirm-title">执行命令确认</span>
          </div>
          <div class="cc-exec-confirm-body">
            <div class="cc-exec-confirm-label">即将执行以下命令：</div>
            <pre class="cc-exec-confirm-cmd">${this.escapeHtml(command)}</pre>
            <div class="cc-exec-confirm-hint">工作目录：${this.escapeHtml(this._getCCWorkdir() || this._ccDefaultWorkdir || '默认')}</div>
          </div>
          <div class="cc-exec-confirm-actions">
            <button class="cc-exec-confirm-btn cc-exec-confirm-once">确认执行</button>
            <button class="cc-exec-confirm-btn cc-exec-confirm-always">总是同意</button>
            <button class="cc-exec-confirm-btn cc-exec-confirm-no">取消</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const confirmed = await new Promise((resolve) => {
        overlay.querySelector('.cc-exec-confirm-once').addEventListener('click', () => { overlay.remove(); resolve('once'); });
        overlay.querySelector('.cc-exec-confirm-always').addEventListener('click', () => { overlay.remove(); resolve('always'); });
        overlay.querySelector('.cc-exec-confirm-no').addEventListener('click', () => { overlay.remove(); resolve(false); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
      });

      if (!confirmed) return;
      if (confirmed === 'always') {
        this._ccAutoApproveCommands = true;
        // 更新工具栏上的"总是同意"按钮状态
        const allowBtn = toolbar?.querySelector('.cc-code-allow-btn');
        if (allowBtn) { allowBtn.textContent = '已开启'; allowBtn.disabled = true; }
        this.showToast('已开启自动执行，后续命令无需确认', 'success');
      }
    }

    // 创建输出区域
    outputEl = document.createElement('div');
    outputEl.className = 'cc-command-output';
    outputEl.innerHTML = `
      <div class="cc-command-output-header">
        <span class="cc-command-output-icon">⏳</span>
        <span class="cc-command-output-title">执行中...</span>
      </div>
      <pre class="cc-command-output-body"></pre>
    `;
    pre.after(outputEl);

    // 禁用执行按钮
    execBtn.disabled = true;
    execBtn.textContent = '执行中';

    const bodyEl = outputEl.querySelector('.cc-command-output-body');
    const titleEl = outputEl.querySelector('.cc-command-output-title');
    const iconEl = outputEl.querySelector('.cc-command-output-icon');

    try {
      const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || null;
      const result = await window.electronAPI?.ccExecuteCommand?.({ command, workdir });

      if (!result) {
        titleEl.textContent = '❌ 执行失败';
        iconEl.textContent = '❌';
        bodyEl.textContent = 'IPC 调用失败';
        execBtn.textContent = '重试';
        execBtn.disabled = false;
        outputEl.classList.add('cc-command-output-error');
        return;
      }

      const output = [];
      if (result.stdout) output.push(result.stdout);
      if (result.stderr) output.push('--- stderr ---\n' + result.stderr);
      if (!output.length) output.push('(无输出)');

      bodyEl.textContent = output.join('\n');

      if (result.success && result.exitCode === 0) {
        titleEl.textContent = `✅ 执行成功 (exit: 0)`;
        iconEl.textContent = '✅';
        outputEl.classList.add('cc-command-output-success');
        // 隐藏执行/忽略/拒绝按钮，显示已执行状态
        toolbar?.querySelectorAll('.cc-code-exec-btn, .cc-code-allow-btn, .cc-code-ignore-btn, .cc-code-reject-btn').forEach(b => b.remove());
        const badge = document.createElement('span');
        badge.className = 'cc-command-status cc-command-executed';
        badge.textContent = '已执行';
        toolbar?.appendChild(badge);
      } else {
        titleEl.textContent = `❌ 执行失败 (exit: ${result.exitCode})`;
        iconEl.textContent = '❌';
        outputEl.classList.add('cc-command-output-error');
        if (result.error && !result.stderr) {
          bodyEl.textContent = result.error;
        }
        execBtn.textContent = '重试';
        execBtn.disabled = false;
      }
    } catch (err) {
      titleEl.textContent = '❌ 执行异常';
      iconEl.textContent = '❌';
      bodyEl.textContent = err.message;
      outputEl.classList.add('cc-command-output-error');
      execBtn.textContent = '▶ 重试';
      execBtn.disabled = false;
    }

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  /** 弹出 HTML/SVG 预览窗口（iframe 沙箱） */
  _showHTMLPreview(content, ext = 'html') {
    // 移除已有预览窗
    document.getElementById('ccHtmlPreviewOverlay')?.remove();

    const titleText = ext === 'svg' ? '👁 SVG 预览' : '👁 HTML 预览';
    const overlay = document.createElement('div');
    overlay.id = 'ccHtmlPreviewOverlay';
    overlay.className = 'cc-preview-overlay';
    overlay.innerHTML = `
      <div class="cc-preview-modal">
        <div class="cc-preview-header">
          <span class="cc-preview-title">${titleText}</span>
          <div class="cc-preview-actions">
            <button class="cc-preview-save-btn" title="保存到 Agent 产物">💾 保存</button>
            <button class="cc-preview-open-link" title="保存并在浏览器中打开">🔗 浏览器打开</button>
            <button class="cc-preview-close-btn" title="关闭">✕</button>
          </div>
        </div>
        <div class="cc-preview-body">
          <iframe sandbox="allow-scripts allow-same-origin" class="cc-preview-iframe"></iframe>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 写入内容到 iframe（SVG 包装为完整 HTML）
    const iframe = overlay.querySelector('.cc-preview-iframe');
    const renderContent = ext === 'svg'
      ? `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f7} svg{max-width:100%;height:auto}</style></head><body>${content}</body></html>`
      : content;

    iframe.onload = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(renderContent);
          doc.close();
        }
      } catch (e) {
        console.error('[CC] Preview write failed:', e);
      }
    };
    iframe.src = 'about:blank';

    // 关闭按钮
    overlay.querySelector('.cc-preview-close-btn')?.addEventListener('click', () => overlay.remove());
    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    // 保存按钮
    overlay.querySelector('.cc-preview-save-btn')?.addEventListener('click', async () => {
      const fileName = `cc-${ext}-${Date.now()}.${ext}`;
      const result = await window.electronAPI?.artifactsSave?.({ content, fileName, source: 'cc' });
      if (result?.success) {
        this.showToast(`已保存到 Agent 产物: ${result.name}`);
      } else {
        this.showToast('保存失败: ' + (result?.error || '未知错误'), 'error');
      }
    });
    // 浏览器打开链接（保存后用系统默认浏览器打开）
    overlay.querySelector('.cc-preview-open-link')?.addEventListener('click', async () => {
      const fileName = `cc-${ext}-${Date.now()}.${ext}`;
      const result = await window.electronAPI?.artifactsSave?.({ content, fileName, source: 'cc' });
      if (result?.success) {
        window.electronAPI?.openExternal?.('file://' + result.path);
      } else {
        this.showToast('保存失败: ' + (result?.error || '未知错误'), 'error');
      }
    });
  },

  // ===== Skill 管理（v2.7 CC 模式） =====

  async _uploadSkill(file) {
    if (!file.name.endsWith('.zip')) {
      this.showToast('请上传 .zip 格式的 Skill 包', 'error');
      return;
    }
    this.showToast('正在上传 Skill...');
    try {
      // 直接传文件路径给主进程，避免 IPC 大小限制
      const result = await window.electronAPI?.skillUpload?.({ filePath: file.path });
      if (result?.success) {
        this.showToast(`Skill "${result.name}" 上传成功，请点击"安装到CC"后即可在对话中使用`);
        this._loadSkillList();
      } else {
        this.showToast('上传失败: ' + (result?.error || '未知错误'), 'error');
      }
    } catch (e) {
      this.showToast('上传异常: ' + e.message, 'error');
    }
  },

  async _loadSkillList() {
    // 获取带安装状态的 skill 列表
    const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
    const result = await window.electronAPI?.skillListWithStatus?.({ ccWorkdir: workdir });
    if (!result?.success) return;
    this._ccSkills = result.skills || [];
    this._renderSkillList();
    // 同时刷新对话区的 skill 下拉框
    this._refreshCCSkillSelect();
  },

  _renderSkillList() {
    const grid = document.getElementById('skillGrid');
    const empty = document.getElementById('skillEmpty');
    if (!grid || !empty) return;

    if (this._ccSkills.length === 0) {
      grid.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    grid.innerHTML = this._ccSkills.map(skill => {
      const installed = skill.installed;
      const isSkillhub = skill.source === 'skillhub';
      const isCcWorkdir = skill.source === 'cc-workdir';
      const isSymlink = skill.source === 'symlink';
      // 来源标签
      let sourceLabel, sourceIcon;
      if (isSkillhub) {
        sourceLabel = '<span class="skill-source-badge skillhub">SkillHub</span>';
        sourceIcon = '🌐';
      } else if (isCcWorkdir) {
        sourceLabel = '<span class="skill-source-badge cc-workdir">CC工作目录</span>';
        sourceIcon = '⚡';
      } else if (isSymlink) {
        sourceLabel = '<span class="skill-source-badge symlink">已链接</span>';
        sourceIcon = '🔗';
      } else {
        sourceLabel = '<span class="skill-source-badge upload">上传</span>';
        sourceIcon = '🧩';
      }
      const statusBadge = installed
        ? '<span class="skill-status-badge installed">✅ 已安装</span>'
        : '<span class="skill-status-badge not-installed">⬜ 未安装</span>';
      const installBtn = installed
        ? `<button class="skill-uninstall-btn" data-skill-name="${this.escapeHtml(skill.name)}">卸载</button>`
        : `<button class="skill-install-btn" data-skill-name="${this.escapeHtml(skill.name)}">安装到CC</button>`;
      // CC工作目录来源：显示"导入"+"删除"按钮
      // SkillHub 来源：不显示"删除"按钮
      // 上传来源：显示"删除"按钮
      // 符号链接：不显示额外按钮
      let actionBtns = '';
      if (isCcWorkdir) {
        actionBtns = `<button class="skill-import-btn" data-skill-name="${this.escapeHtml(skill.name)}" title="导入到持久存储">📥 导入</button>`;
        actionBtns += `<button class="skill-delete-workdir-btn" data-skill-name="${this.escapeHtml(skill.name)}" title="从工作目录删除">🗑 删除</button>`;
      } else if (!isSkillhub && !isSymlink) {
        actionBtns = `<button class="skill-delete-btn" data-skill-name="${this.escapeHtml(skill.name)}">🗑 删除</button>`;
      }
      const fullDesc = this.escapeHtml(skill.description || '暂无描述');
      const shortDesc = this.escapeHtml((skill.description || '暂无描述').substring(0, 80));
      return `
        <div class="skill-card" data-skill-name="${this.escapeHtml(skill.name)}" title="${fullDesc}">
          <div class="skill-card-header" data-skill-detail="${this.escapeHtml(skill.name)}">
            <span class="skill-card-icon">${sourceIcon}</span>
            <span class="skill-card-name">${this.escapeHtml(skill.name)}</span>
            ${sourceLabel}
            ${statusBadge}
          </div>
          <p class="skill-card-desc" data-skill-detail="${this.escapeHtml(skill.name)}">${shortDesc}${(skill.description || '').length > 80 ? '...' : ''}</p>
          <div class="skill-card-actions">
            ${installBtn}
            ${actionBtns}
          </div>
        </div>
      `;
    }).join('');

    // 事件委托：在 grid 上统一处理安装/卸载/删除/导入/详情按钮点击
    grid.onclick = async (e) => {
      const installBtn = e.target.closest('.skill-install-btn');
      const uninstallBtn = e.target.closest('.skill-uninstall-btn');
      const deleteBtn = e.target.closest('.skill-delete-btn');
      const importBtn = e.target.closest('.skill-import-btn');
      const deleteWorkdirBtn = e.target.closest('.skill-delete-workdir-btn');
      const detailTarget = e.target.closest('[data-skill-detail]');
      // 检查是否点击了详情区域（header 或 desc），且不是按钮
      if (detailTarget && !installBtn && !uninstallBtn && !deleteBtn && !importBtn && !deleteWorkdirBtn) {
        const skillName = detailTarget.dataset.skillDetail;
        if (skillName) this._showSkillDetail(skillName);
        return;
      }
      if (!installBtn && !uninstallBtn && !deleteBtn && !importBtn && !deleteWorkdirBtn) return;

      if (installBtn) {
        const name = installBtn.dataset.skillName;
        const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
        const result = await window.electronAPI?.skillInstallToCC?.({ skillName: name, ccWorkdir: workdir });
        if (result?.success) {
          this.showToast(`Skill "${name}" 已安装到 CC，重启 CC 后生效`);
          this._loadSkillList();
        } else {
          this.showToast('安装失败: ' + (result?.error || '未知错误'), 'error');
        }
      } else if (uninstallBtn) {
        const name = uninstallBtn.dataset.skillName;
        const card = uninstallBtn.closest('.skill-card');
        const isSkillhub = card?.querySelector('.skill-source-badge.skillhub');
        if (!confirm(`确定从 CC 卸载 Skill "${name}"？`)) return;
        const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
        const result = await window.electronAPI?.skillUninstallFromCC?.({ skillName: name, ccWorkdir: workdir });
        if (result?.success) {
          this.showToast(`Skill "${name}" 已从 CC 卸载`);
          this._loadSkillList();
          if (isSkillhub) {
            this._skillhubInstalledSlugs.delete(name);
          }
        } else {
          this.showToast('卸载失败: ' + (result?.error || '未知错误'), 'error');
        }
      } else if (importBtn) {
        // 导入 CC 工作目录中的 Skill 到持久存储
        const name = importBtn.dataset.skillName;
        const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
        const result = await window.electronAPI?.skillImportFromWorkdir?.({ skillName: name, ccWorkdir: workdir });
        if (result?.success) {
          this.showToast(`Skill "${name}" 已导入到持久存储`);
          this._loadSkillList();
        } else {
          this.showToast('导入失败: ' + (result?.error || '未知错误'), 'error');
        }
      } else if (deleteWorkdirBtn) {
        // 从 CC 工作目录删除 Skill
        const name = deleteWorkdirBtn.dataset.skillName;
        if (!confirm(`确定从工作目录删除 Skill "${name}"？`)) return;
        const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
        const result = await window.electronAPI?.skillDeleteFromWorkdir?.({ skillName: name, ccWorkdir: workdir });
        if (result?.success) {
          this.showToast(`Skill "${name}" 已从工作目录删除`);
          this._loadSkillList();
        } else {
          this.showToast('删除失败: ' + (result?.error || '未知错误'), 'error');
        }
      } else if (deleteBtn) {
        const name = deleteBtn.dataset.skillName;
        if (!confirm(`确定删除 Skill "${name}"？将同时从 CC 卸载。`)) return;
        const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
        await window.electronAPI?.skillUninstallFromCC?.({ skillName: name, ccWorkdir: workdir });
        const result = await window.electronAPI?.skillDelete?.({ name });
        if (result?.success) {
          this.showToast(`Skill "${name}" 已删除`);
          this._loadSkillList();
        } else {
          this.showToast('删除失败: ' + (result?.error || '未知错误'), 'error');
        }
      }
    };
  },

  /** 显示 Skill 详情弹窗 */
  async _showSkillDetail(skillName) {
    const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
    // 显示加载中
    const overlay = document.createElement('div');
    overlay.className = 'skill-detail-overlay';
    overlay.innerHTML = `
      <div class="skill-detail-modal">
        <div class="skill-detail-header">
          <div class="skill-detail-loading">
            <div class="spinner"></div>
            <span>加载中...</span>
          </div>
          <button class="skill-detail-close" onclick="this.closest('.skill-detail-overlay').remove()">×</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    try {
      const result = await window.electronAPI?.skillDetail?.({ name: skillName, ccWorkdir: workdir });
      if (!result?.success) {
        overlay.querySelector('.skill-detail-modal').innerHTML = `
          <div class="skill-detail-header">
            <h3 class="skill-detail-title">❌ 加载失败</h3>
            <button class="skill-detail-close" onclick="this.closest('.skill-detail-overlay').remove()">×</button>
          </div>
          <div class="skill-detail-body">
            <p class="skill-detail-error">${this.escapeHtml(result?.error || '未知错误')}</p>
          </div>`;
        return;
      }

      const meta = result.metadata || {};
      const sourceLabel = result.source === 'upload' ? '上传' : result.source === 'cc-workdir' ? 'CC工作目录' : result.source;
      const installBadge = result.installed
        ? '<span class="skill-detail-badge installed">✅ 已安装</span>'
        : '<span class="skill-detail-badge not-installed">⬜ 未安装</span>';

      // 格式化 SKILL.md 内容（简单 markdown 渲染）
      let mdHtml = '';
      if (result.skillMdContent) {
        // 去掉 YAML frontmatter
        let content = result.skillMdContent.replace(/^---\n[\s\S]*?\n---\n?/, '');
        // 简单 markdown → HTML
        mdHtml = content
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/^### (.+)$/gm, '<h4>$1</h4>')
          .replace(/^## (.+)$/gm, '<h3>$1</h3>')
          .replace(/^# (.+)$/gm, '<h2>$1</h2>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/`(.+?)`/g, '<code>$1</code>')
          .replace(/^- (.+)$/gm, '<li>$1</li>')
          .replace(/\n\n/g, '</p><p>')
          .replace(/^/, '<p>')
          .replace(/$/, '</p>');
        mdHtml = mdHtml.replace(/<li>/g, '<ul><li>').replace(/<\/li>\n(?!<li>)/g, '</li></ul>');
        // 修复嵌套 ul
        mdHtml = mdHtml.replace(/(<\/p>)?<ul><li>/g, '<ul><li>').replace(/<\/li><\/ul>(<\/p>)?/g, '</li></ul>');
      }

      // 文件列表
      const filesHtml = (result.files || []).map(f =>
        `<div class="skill-detail-file"><span class="skill-detail-file-icon">${f.type === 'dir' ? '📁' : '📄'}</span> ${this.escapeHtml(f.name)}</div>`
      ).join('');

      overlay.querySelector('.skill-detail-modal').innerHTML = `
        <div class="skill-detail-header">
          <div class="skill-detail-title-row">
            <span class="skill-detail-icon">🧩</span>
            <h3 class="skill-detail-title">${this.escapeHtml(meta.name || result.name)}</h3>
            <span class="skill-detail-source-badge">${sourceLabel}</span>
            ${installBadge}
          </div>
          <button class="skill-detail-close" onclick="this.closest('.skill-detail-overlay').remove()">×</button>
        </div>
        <div class="skill-detail-body">
          <div class="skill-detail-meta">
            ${meta.version ? `<div class="skill-detail-meta-item"><span class="meta-label">版本</span><span class="meta-value">v${this.escapeHtml(meta.version)}</span></div>` : ''}
            ${meta.author ? `<div class="skill-detail-meta-item"><span class="meta-label">作者</span><span class="meta-value">${this.escapeHtml(meta.author)}</span></div>` : ''}
            <div class="skill-detail-meta-item"><span class="meta-label">来源</span><span class="meta-value">${sourceLabel}</span></div>
            <div class="skill-detail-meta-item"><span class="meta-label">安装状态</span><span class="meta-value">${result.installed ? '已安装' : '未安装'}</span></div>
          </div>
          ${meta.description ? `<p class="skill-detail-description">${this.escapeHtml(meta.description)}</p>` : ''}
          ${mdHtml ? `<div class="skill-detail-md"><h4>📖 详细文档</h4><div class="skill-detail-md-content">${mdHtml}</div></div>` : ''}
          ${filesHtml ? `<div class="skill-detail-files"><h4>📂 文件列表</h4>${filesHtml}</div>` : ''}
          <div class="skill-detail-path">路径: ${this.escapeHtml(result.path || '')}</div>
        </div>
        <div class="skill-detail-footer">
          ${!result.installed ? `<button class="btn primary skill-detail-install-btn" data-skill-name="${this.escapeHtml(result.name)}">安装到CC</button>` : `<button class="btn secondary skill-detail-uninstall-btn" data-skill-name="${this.escapeHtml(result.name)}">从CC卸载</button>`}
          <button class="btn secondary" onclick="this.closest('.skill-detail-overlay').remove()">关闭</button>
        </div>`;

      // 绑定安装/卸载按钮
      overlay.querySelector('.skill-detail-install-btn')?.addEventListener('click', async (e) => {
        const name = e.target.dataset.skillName;
        const wd = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
        const r = await window.electronAPI?.skillInstallToCC?.({ skillName: name, ccWorkdir: wd });
        if (r?.success) {
          this.showToast(`Skill "${name}" 已安装到 CC`);
          overlay.remove();
          this._loadSkillList();
        } else {
          this.showToast('安装失败: ' + (r?.error || '未知错误'), 'error');
        }
      });
      overlay.querySelector('.skill-detail-uninstall-btn')?.addEventListener('click', async (e) => {
        const name = e.target.dataset.skillName;
        if (!confirm(`确定从 CC 卸载 Skill "${name}"？`)) return;
        const wd = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
        const r = await window.electronAPI?.skillUninstallFromCC?.({ skillName: name, ccWorkdir: wd });
        if (r?.success) {
          this.showToast(`Skill "${name}" 已从 CC 卸载`);
          overlay.remove();
          this._loadSkillList();
        } else {
          this.showToast('卸载失败: ' + (r?.error || '未知错误'), 'error');
        }
      });
    } catch (err) {
      overlay.querySelector('.skill-detail-modal').innerHTML = `
        <div class="skill-detail-header">
          <h3 class="skill-detail-title">❌ 加载异常</h3>
          <button class="skill-detail-close" onclick="this.closest('.skill-detail-overlay').remove()">×</button>
        </div>
        <div class="skill-detail-body">
          <p class="skill-detail-error">${this.escapeHtml(err.message)}</p>
        </div>`;
    }
  },

  /** 初始化 Skill 拖拽上传 */
  _initSkillDragDrop() {
    if (this._skillDragDropInit) return;
    this._skillDragDropInit = true;
    const container = document.getElementById('skillContainer');
    if (!container) return;

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.classList.add('skill-drag-active');
    });
    container.addEventListener('dragleave', (e) => {
      if (e.target === container) {
        container.classList.remove('skill-drag-active');
      }
    });
    container.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.classList.remove('skill-drag-active');

      const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.zip'));
      if (files.length === 0) {
        this.showToast('请拖入 .zip 格式的 Skill 包', 'warning');
        return;
      }
      for (const file of files) {
        await this._uploadSkill(file);
      }
    });
  },

  _skillhubInitialized: false,
  _skillhubInstalledSlugs: new Set(),

  /** 初始化 SkillHub 子标签和事件 */
  _initSkillHub() {
    if (this._skillhubInitialized) {
      this._checkSkillHubCli();
      return;
    }
    this._skillhubInitialized = true;

    // 子标签切换
    document.querySelectorAll('.skill-sub-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.skill-sub-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const subtab = tab.dataset.subtab;
        document.querySelectorAll('.skill-sub-panel').forEach(panel => {
          panel.classList.toggle('active', panel.dataset.subpanel === subtab);
        });
        if (subtab === 'market') {
          this._checkSkillHubCli();
        }
      });
    });

    // 搜索按钮
    document.getElementById('skillhubSearchBtn')?.addEventListener('click', () => {
      this._skillhubSearch();
    });
    document.getElementById('skillhubSearchInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._skillhubSearch();
    });

    // 每页数量切换
    document.getElementById('skillhubLimitSelect')?.addEventListener('change', () => {
      this._skillhubSearch();
    });

    // CLI 安装按钮
    document.getElementById('skillhubInstallCliBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('skillhubInstallCliBtn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ 安装中...'; }
      const result = await window.electronAPI?.skillhubInstallCli?.();
      if (btn) { btn.disabled = false; btn.textContent = '🔧 一键安装 CLI'; }
      if (result?.success) {
        this.showToast('SkillHub CLI 安装成功', 'success');
        this._checkSkillHubCli();
      } else {
        this.showToast('CLI 安装失败: ' + (result?.error || '未知错误'), 'error');
      }
    });

    // 首次检查 CLI
    this._checkSkillHubCli();
  },

  /** 检查 SkillHub CLI 是否已安装 */
  async _checkSkillHubCli() {
    const guide = document.getElementById('skillhubGuide');
    const searchBar = document.getElementById('skillhubSearchBar');
    if (!guide || !searchBar) return;

    const result = await window.electronAPI?.skillhubCheck?.();
    if (result?.installed) {
      guide.style.display = 'none';
      searchBar.style.display = 'flex';
      // 刷新已安装列表
      await this._refreshSkillHubInstalled();
      // 如果搜索框为空，执行一次空搜索获取热门技能
      const input = document.getElementById('skillhubSearchInput');
      if (input && !input.value) {
        this._skillhubSearch();
      }
    } else {
      guide.style.display = '';
      searchBar.style.display = 'none';
    }
  },

  /** 刷新已安装的 SkillHub 技能列表（带缓存，避免每次搜索都调 CLI） */
  async _refreshSkillHubInstalled(force = false) {
    // 5 分钟内不重复刷新（除非 force）
    if (!force && this._skillhubInstalledTs && (Date.now() - this._skillhubInstalledTs < 300000)) {
      return;
    }
    this._skillhubInstalledSlugs.clear();
    const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
    if (!workdir) return;
    const targetDir = `${workdir}/.claude/skills`;
    const result = await window.electronAPI?.skillhubList?.({ dir: targetDir });
    if (result?.success && result.skills) {
      result.skills.forEach(s => this._skillhubInstalledSlugs.add(s.slug));
      this._skillhubInstalledTs = Date.now();
    }
  },

  /** 搜索 SkillHub 市场技能 */
  async _skillhubSearch() {
    const input = document.getElementById('skillhubSearchInput');
    const limitSelect = document.getElementById('skillhubLimitSelect');
    const resultsEl = document.getElementById('skillhubResults');
    if (!resultsEl) return;

    const query = input?.value?.trim() || '';
    const limit = parseInt(limitSelect?.value || '20');

    // 显示加载中
    resultsEl.innerHTML = `
      <div class="skillhub-loading">
        <div class="spinner"></div>
        <span>搜索中...</span>
      </div>`;

    try {
      const result = await window.electronAPI?.skillhubSearch?.({ query, limit });
      if (!result?.success) {
        resultsEl.innerHTML = `
          <div class="skillhub-empty">
            <div class="empty-icon">⚠️</div>
            <p>搜索失败</p>
            <span class="empty-hint">${this.escapeHtml(result?.error || '未知错误')}</span>
          </div>`;
        return;
      }

      const skills = result.results || [];
      if (skills.length === 0) {
        resultsEl.innerHTML = `
          <div class="skillhub-empty">
            <div class="empty-icon">🔍</div>
            <p>未找到匹配的技能</p>
            <span class="empty-hint">试试其他关键词</span>
          </div>`;
        return;
      }

      // 刷新已安装列表（确保安装状态准确）
      await this._refreshSkillHubInstalled();

      resultsEl.innerHTML = `
        <div class="skillhub-info">找到 ${result.count || skills.length} 个技能${query ? `，关键词: "${this.escapeHtml(query)}"` : ''}</div>
        <div class="skillhub-grid">
          ${skills.map(s => this._renderSkillHubCard(s)).join('')}
        </div>`;
      // 事件委托已在 bindEvents() 中绑定
    } catch (e) {
      resultsEl.innerHTML = `
        <div class="skillhub-empty">
          <div class="empty-icon">⚠️</div>
          <p>搜索异常</p>
          <span class="empty-hint">${this.escapeHtml(e.message)}</span>
        </div>`;
    }
  },

  /** 渲染 SkillHub 技能卡片 */
  _renderSkillHubCard(skill) {
    const slug = this.escapeHtml(skill.slug || '');
    const name = this.escapeHtml(skill.name || skill.slug || '');
    const description = this.escapeHtml(skill.description || '暂无描述');
    const version = skill.version ? `v${this.escapeHtml(skill.version)}` : '';
    const source = this.escapeHtml(skill.source || 'community');
    const isInstalled = this._skillhubInstalledSlugs.has(skill.slug);
    const detailUrl = `https://skillhub.cn/skills/${encodeURIComponent(skill.slug || '')}`;

    const installBtn = isInstalled
      ? `<button class="skillhub-uninstall-btn" data-slug="${slug}">✅ 已安装 | 卸载</button>`
      : `<button class="skillhub-install-btn" data-slug="${slug}">📥 安装到CC</button>`;

    return `
      <div class="skillhub-card" title="${description}">
        <div class="skillhub-card-header" ${isInstalled ? `data-skill-detail="${slug}"` : ''}>
          <span class="skillhub-card-icon">🌐</span>
          <span class="skillhub-card-name" title="${name}">${name}</span>
          ${version ? `<span class="skillhub-card-version">${version}</span>` : ''}
        </div>
        <p class="skillhub-card-desc" title="${description}">${description}</p>
        <div class="skillhub-card-meta">
          <span class="skillhub-card-source">来源: ${source}</span>
          <a href="${detailUrl}" class="skillhub-card-link" onclick="event.stopPropagation(); window.electronAPI?.openExternal?.('${detailUrl}'); return false;">ℹ️ 详情</a>
        </div>
        <div class="skillhub-card-actions">
          ${installBtn}
        </div>
      </div>`;
  },

  /** 安装 SkillHub 技能到 CC 工作目录 */
  async _skillhubInstallSkill(slug, btn) {
    const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
    if (!workdir) {
      this.showToast('请先设置 CC 工作目录', 'error');
      return;
    }
    const targetDir = `${workdir}/.claude/skills`;

    if (btn) { btn.disabled = true; btn.textContent = '⏳ 安装中...'; }

    const result = await window.electronAPI?.skillhubInstall?.({ slug, targetDir });
    if (result?.success) {
      this._skillhubInstalledSlugs.add(slug);
      this.showToast(`技能 "${slug}" 安装成功`, 'success');
      // 更新按钮状态
      if (btn) {
        btn.className = 'skillhub-uninstall-btn';
        btn.textContent = '✅ 已安装 | 卸载';
        btn.disabled = false;
      }
      // 刷新 CC 对话区 skill 下拉框
      this._refreshCCSkillSelect();
      // 刷新"我的技能"列表（SkillHub 安装的技能也需要同步显示）
      this._loadSkillList();
      // 强制刷新已安装缓存（安装状态已变化）
      this._refreshSkillHubInstalled(true);
    } else {
      this.showToast('安装失败: ' + (result?.error || '未知错误'), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '📥 安装到CC'; }
    }
  },

  /** 卸载 SkillHub 技能 */
  async _skillhubUninstallSkill(slug, btn) {
    const workdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
    if (!workdir) {
      this.showToast('请先设置 CC 工作目录', 'error');
      return;
    }
    const targetDir = `${workdir}/.claude/skills`;

    if (btn) { btn.disabled = true; btn.textContent = '⏳ 卸载中...'; }

    const result = await window.electronAPI?.skillhubUninstall?.({ slug, targetDir });
    if (result?.success) {
      this._skillhubInstalledSlugs.delete(slug);
      this.showToast(`技能 "${slug}" 已卸载`, 'success');
      if (btn) {
        btn.className = 'skillhub-install-btn';
        btn.textContent = '📥 安装到CC';
        btn.disabled = false;
      }
      // 强制刷新已安装缓存（卸载状态已变化）
      this._refreshSkillHubInstalled(true);
      this._refreshCCSkillSelect();
      // 刷新"我的技能"列表
      this._loadSkillList();
    } else {
      this.showToast('卸载失败: ' + (result?.error || '未知错误'), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '✅ 已安装 | 卸载'; }
    }
  },

  // ===== MCP 连接器管理 =====

  _connectors: [],
  _ccSelectedConnectors: null, // null=使用默认启用的, []=不选, [id,...]=指定选中的

  async _loadConnectorList() {
    if (!window.electronAPI?.connectorList) return;
    try {
      this._connectors = await window.electronAPI.connectorList({});
      this._renderConnectorList();
      this._refreshCCConnectorSelect();
    } catch (e) {
      console.error('[Connector] load error:', e);
    }
  },

  _renderConnectorList() {
    const grid = document.getElementById('connectorGrid');
    const empty = document.getElementById('connectorEmpty');
    if (!grid || !empty) return;

    if (this._connectors.length === 0) {
      grid.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    const typeIcons = { stdio: '🖥️', sse: '📡', http: '🌐' };
    const typeLabels = { stdio: 'stdio', sse: 'SSE', http: 'HTTP' };

    grid.innerHTML = this._connectors.map(c => {
      const configSummary = c.type === 'stdio'
        ? `${c.config?.command || ''} ${(c.config?.args || []).join(' ')}`
        : c.config?.url || '';
      const time = this._formatRelativeTime(c.updated_at || c.created_at);
      return `
        <div class="connector-card" data-id="${c.id}">
          <div class="connector-card-header">
            <span class="connector-card-icon">${typeIcons[c.type] || '🔌'}</span>
            <span class="connector-card-name">${this._escapeHtml(c.name)}</span>
            <span class="connector-card-type">${typeLabels[c.type]}</span>
            ${c.enabled ? '<span class="connector-card-badge enabled">启用</span>' : '<span class="connector-card-badge disabled">停用</span>'}
          </div>
          <div class="connector-card-desc">${c.description ? this._escapeHtml(c.description) : '<span class="muted">无描述</span>'}</div>
          <div class="connector-card-config" title="${this._escapeHtml(configSummary)}">${this._escapeHtml(configSummary.substring(0, 80))}${configSummary.length > 80 ? '...' : ''}</div>
          <div class="connector-card-footer">
            <span class="connector-card-time">${time}</span>
            <div class="connector-card-actions">
              <label class="connector-toggle-switch">
                <input type="checkbox" ${c.enabled ? 'checked' : ''} data-toggle-id="${c.id}">
                <span class="connector-toggle-slider"></span>
              </label>
              <button class="connector-edit-btn" data-edit-id="${c.id}">✏️</button>
              <button class="connector-delete-btn" data-delete-id="${c.id}">🗑️</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
    // 事件委托已在 bindEvents() 中绑定
  },

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  },

  _formatRelativeTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 30) return `${days}天前`;
    return d.toLocaleDateString();
  },

  _openConnectorModal(editId) {
    const modal = document.getElementById('connectorModal');
    const title = document.getElementById('connectorModalTitle');
    const editIdEl = document.getElementById('connectorEditId');
    const nameEl = document.getElementById('connectorName');
    const typeEl = document.getElementById('connectorType');
    const descEl = document.getElementById('connectorDesc');
    const commandEl = document.getElementById('connectorCommand');
    const argsEl = document.getElementById('connectorArgs');
    const envEl = document.getElementById('connectorEnv');
    const urlEl = document.getElementById('connectorUrl');
    const headersEl = document.getElementById('connectorHeaders');
    const enabledEl = document.getElementById('connectorEnabled');

    // 重置
    if (editId) {
      const conn = this._connectors.find(c => c.id === editId);
      if (!conn) return;
      title.textContent = '编辑连接器';
      editIdEl.value = conn.id;
      nameEl.value = conn.name;
      typeEl.value = conn.type;
      descEl.value = conn.description || '';
      commandEl.value = conn.config?.command || '';
      argsEl.value = (conn.config?.args || []).join(' ');
      envEl.value = Object.entries(conn.config?.env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
      urlEl.value = conn.config?.url || '';
      headersEl.value = Object.entries(conn.config?.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
      enabledEl.checked = conn.enabled;
    } else {
      title.textContent = '添加连接器';
      editIdEl.value = '';
      nameEl.value = '';
      typeEl.value = 'stdio';
      descEl.value = '';
      commandEl.value = '';
      argsEl.value = '';
      envEl.value = '';
      urlEl.value = '';
      headersEl.value = '';
      enabledEl.checked = true;
    }

    this._updateConnectorTypeFields();
    modal.classList.remove('hidden');
  },

  _closeConnectorModal() {
    document.getElementById('connectorModal')?.classList.add('hidden');
  },

  _updateConnectorTypeFields() {
    const type = document.getElementById('connectorType')?.value;
    const stdioFields = document.getElementById('connectorStdioFields');
    const remoteFields = document.getElementById('connectorRemoteFields');
    if (type === 'stdio') {
      stdioFields?.classList.remove('hidden');
      remoteFields?.classList.add('hidden');
    } else {
      stdioFields?.classList.add('hidden');
      remoteFields?.classList.remove('hidden');
    }
  },

  _applyConnectorTemplate(template) {
    const templates = {
      sqlite: {
        name: 'SQLite DB', type: 'stdio',
        command: 'npx', args: '-y @modelcontextprotocol/server-sqlite --db-path ~/data.db',
        desc: '本地 SQLite 数据库查询'
      },
      postgres: {
        name: 'PostgreSQL', type: 'stdio',
        command: 'npx', args: '-y @modelcontextprotocol/server-postgres postgresql://user:pass@localhost:5432/db',
        desc: 'PostgreSQL 数据库查询'
      },
      filesystem: {
        name: '文件系统', type: 'stdio',
        command: 'npx', args: '-y @modelcontextprotocol/server-filesystem ~/Documents',
        desc: '文件系统读写访问'
      },
      websearch: {
        name: 'Web 搜索', type: 'stdio',
        command: 'npx', args: '-y @modelcontextprotocol/server-brave-search',
        env: 'BRAVE_API_KEY=your-api-key',
        desc: 'Brave 网络搜索'
      },
      github: {
        name: 'GitHub', type: 'stdio',
        command: 'npx', args: '-y @modelcontextprotocol/server-github',
        env: 'GITHUB_TOKEN=ghp_xxx',
        desc: 'GitHub 仓库/Issue/PR 操作'
      },
    };
    const t = templates[template];
    if (!t) return;
    document.getElementById('connectorName').value = t.name;
    document.getElementById('connectorType').value = t.type;
    document.getElementById('connectorDesc').value = t.desc || '';
    document.getElementById('connectorCommand').value = t.command || '';
    document.getElementById('connectorArgs').value = t.args || '';
    document.getElementById('connectorEnv').value = t.env || '';
    document.getElementById('connectorUrl').value = '';
    document.getElementById('connectorHeaders').value = '';
    this._updateConnectorTypeFields();
  },

  async _saveConnector() {
    const id = document.getElementById('connectorEditId').value;
    const name = document.getElementById('connectorName').value.trim();
    const type = document.getElementById('connectorType').value;
    const description = document.getElementById('connectorDesc').value.trim();
    const enabled = document.getElementById('connectorEnabled').checked;

    const config = {};
    if (type === 'stdio') {
      config.command = document.getElementById('connectorCommand').value.trim();
      const argsStr = document.getElementById('connectorArgs').value.trim();
      config.args = argsStr ? argsStr.split(/\s+/) : [];
      const envStr = document.getElementById('connectorEnv').value.trim();
      if (envStr) {
        config.env = {};
        envStr.split('\n').forEach(line => {
          const idx = line.indexOf('=');
          if (idx > 0) config.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        });
      }
    } else {
      config.url = document.getElementById('connectorUrl').value.trim();
      const headersStr = document.getElementById('connectorHeaders').value.trim();
      if (headersStr) {
        config.headers = {};
        headersStr.split('\n').forEach(line => {
          const idx = line.indexOf(':');
          if (idx > 0) config.headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        });
      }
    }

    const connector = { id: id || undefined, name, type, description, enabled, config };
    const result = await window.electronAPI?.connectorSave?.(connector);
    if (result?.success) {
      this.showToast(id ? '连接器已更新' : '连接器已添加', 'success');
      this._closeConnectorModal();
      this._loadConnectorList();
    } else {
      this.showToast('保存失败: ' + (result?.error || '未知错误'), 'error');
    }
  },

  async _deleteConnector(id) {
    const conn = this._connectors.find(c => c.id === id);
    if (!conn) return;
    if (!confirm(`确定删除连接器 "${conn.name}" 吗？`)) return;
    const result = await window.electronAPI?.connectorDelete?.({ id });
    if (result?.success) {
      this.showToast('连接器已删除', 'success');
      this._loadConnectorList();
    } else {
      this.showToast('删除失败: ' + (result?.error || '未知错误'), 'error');
    }
  },

  async _toggleConnector(id, enabled) {
    const result = await window.electronAPI?.connectorToggle?.({ id, enabled });
    if (result?.success) {
      // 更新本地数据
      const conn = this._connectors.find(c => c.id === id);
      if (conn) conn.enabled = enabled;
      this._refreshCCConnectorSelect();
    } else {
      this.showToast('操作失败', 'error');
      this._loadConnectorList(); // 恢复 UI
    }
  },

  // CC 模式对话栏连接器选择
  _refreshCCConnectorSelect() {
    const list = document.getElementById('ccConnectorList');
    const label = document.getElementById('ccConnectorLabel');
    if (!list) return;

    if (this._connectors.length === 0) {
      list.innerHTML = '<div class="cc-connector-empty-hint">暂无连接器，请到资产→连接器添加</div>';
      if (label) label.textContent = '无';
      return;
    }

    // 确定选中状态：首次加载时使用 enabled 默认值
    if (this._ccSelectedConnectors === null) {
      this._ccSelectedConnectors = this._connectors.filter(c => c.enabled).map(c => c.id);
    } else {
      // 移除已删除的连接器 ID
      const validIds = new Set(this._connectors.map(c => c.id));
      this._ccSelectedConnectors = this._ccSelectedConnectors.filter(id => validIds.has(id));
      // 添加新启用的连接器
      this._connectors.filter(c => c.enabled && !this._ccSelectedConnectors.includes(c.id)).forEach(c => {
        this._ccSelectedConnectors.push(c.id);
      });
    }

    const typeIcons = { stdio: '🖥️', sse: '📡', http: '🌐' };
    list.innerHTML = this._connectors.map(c => {
      const checked = this._ccSelectedConnectors.includes(c.id) ? 'checked' : '';
      return `
        <label class="cc-connector-item">
          <input type="checkbox" value="${c.id}" ${checked}>
          <span class="cc-connector-item-icon">${typeIcons[c.type] || '🔌'}</span>
          <span class="cc-connector-item-name">${c.name}</span>
          <span class="cc-connector-item-type">${c.type}</span>
        </label>
      `;
    }).join('');
    // 事件委托已在 bindEvents() 中绑定
    this._updateCCConnectorLabel();
  },

  _updateCCConnectorLabel() {
    const label = document.getElementById('ccConnectorLabel');
    if (!label) return;
    const checked = document.querySelectorAll('#ccConnectorList input[type="checkbox"]:checked');
    if (checked.length === 0) {
      label.textContent = '无';
    } else if (checked.length === this._connectors.length) {
      label.textContent = `全部 (${checked.length})`;
    } else {
      label.textContent = `已选 ${checked.length} 个`;
    }
  },

  _getSelectedConnectorIds() {
    const checked = document.querySelectorAll('#ccConnectorList input[type="checkbox"]:checked');
    return Array.from(checked).map(cb => cb.value);
  },

  _initConnectorEvents() {
    // 添加按钮
    document.getElementById('connectorAddBtn')?.addEventListener('click', () => this._openConnectorModal());
    // 弹窗关闭
    document.getElementById('connectorModalClose')?.addEventListener('click', () => this._closeConnectorModal());
    document.getElementById('connectorModalCancel')?.addEventListener('click', () => this._closeConnectorModal());
    document.querySelector('.connector-modal-overlay')?.addEventListener('click', () => this._closeConnectorModal());
    // 保存
    document.getElementById('connectorModalSave')?.addEventListener('click', () => this._saveConnector());
    // 类型切换
    document.getElementById('connectorType')?.addEventListener('change', () => this._updateConnectorTypeFields());
    // 模板按钮
    document.querySelectorAll('.connector-template-btn').forEach(btn => {
      btn.addEventListener('click', () => this._applyConnectorTemplate(btn.dataset.template));
    });

    // CC 模式对话栏连接器下拉
    const trigger = document.getElementById('ccConnectorTrigger');
    const menu = document.getElementById('ccConnectorMenu');
    trigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      menu?.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#ccConnectorDropdown')) {
        menu?.classList.add('hidden');
      }
    });

    // CC 连接器管理按钮 → 跳转到资产页连接器标签
    document.getElementById('ccConnectorManageBtn')?.addEventListener('click', () => {
      document.querySelector('.view-tab[data-view="documents"]')?.click();
      setTimeout(() => {
        document.querySelector('.doc-cat-tab[data-type="connector"]')?.click();
      }, 100);
    });
  },

  // ===== Agent 流式渲染（本地 LLM 流式输出） =====

  _handleAgentStreamEvent(evt, messageContent) {
    const { event, content, agentType, fullContent, traceId, usage, error } = evt;

    if (event === 'done') {
      this._finishAgentMessage(messageContent, fullContent || this._agentCurrentText, agentType, traceId, usage);
      return;
    }

    if (event === 'error') {
      const errEl = document.createElement('div');
      errEl.className = 'error-text';
      errEl.textContent = `❌ ${error || '未知错误'}`;
      messageContent.appendChild(errEl);
      this._finishAgentMessage(messageContent, this._agentCurrentText, agentType, traceId);
      return;
    }

    if (event === 'reasoning') {
      // 推理思考过程（如 DeepSeek-R1）—— 流式渲染思考内容
      this._agentReasoningText += content;
      if (!this._agentRenderPending) {
        this._agentRenderPending = true;
        requestAnimationFrame(() => {
          const streamEl = document.getElementById('agentStreamText');
          if (streamEl) {
            const thinking = this._agentReasoningText;
            const finalText = this._agentCurrentText;
            // 停止计时器并更新时间
            this._updateAgentStreamTimer();
            if (finalText) {
              // 已有正式回复内容，正常渲染
              streamEl.innerHTML = `<div class="agent-streaming-hint"><span class="agent-streaming-dots">●●●</span> 正在生成...</div><div class="chat-markdown-content">${this._renderADPMarkdown(finalText, thinking)}</div>`;
            } else {
              // 仅思考阶段，显示思考过程流式输出
              streamEl.innerHTML = `<div class="agent-reasoning-stream">
                <div class="agent-reasoning-header">
                  <span class="thinking-dots"><span></span><span></span><span></span></span>
                  <span class="reasoning-label">💭 思考中...</span>
                  <span class="reasoning-timer" id="agentReasoningTimer">${this._formatStreamElapsed()}</span>
                </div>
                <div class="agent-reasoning-content">${this._renderReasoningPreview(thinking)}</div>
              </div>`;
            }
          }
          this._agentRenderPending = false;
        });
      }
      return;
    }

    if (event === 'delta') {
      // 流式文本增量
      this._agentCurrentText = fullContent || (this._agentCurrentText + content);
      // 使用 requestAnimationFrame 节流渲染
      if (!this._agentRenderPending) {
        this._agentRenderPending = true;
        requestAnimationFrame(() => {
          const streamEl = document.getElementById('agentStreamText');
          if (streamEl) {
            const finalText = this._agentCurrentText;
            // 停止计时器并更新时间
            this._updateAgentStreamTimer();
            // 尝试解析为 JSON（agent 模式可能返回 JSON）
            if (agentType !== 'chat') {
              // agent 模式：无论是否 JSON，都显示加载中的提示
              streamEl.innerHTML = `<div class="agent-streaming-hint"><span class="agent-streaming-dots">●●●</span> 正在生成...</div><div class="chat-markdown-content">${this._renderADPMarkdown(finalText, this._agentReasoningText)}</div>`;
            } else {
              // chat 模式：检测是否为 JSON（模型可能仍返回 JSON）
              const trimmed = finalText.trim();
              const chatParsed = trimmed.startsWith('{') ? this._robustJSONParse(trimmed) : null;
              const thinkingHtml = this._agentReasoningText ? this._renderADPThinking(this._agentReasoningText) : '';
              if (chatParsed) {
                // JSON 解析成功，即时渲染为友好格式
                streamEl.innerHTML = `<div class="agent-streaming-hint"><span class="agent-streaming-dots">●●●</span> 正在生成...</div>${thinkingHtml}<div class="chat-markdown-content">${this._renderChatJSONAsMarkdown(chatParsed)}</div>`;
              } else if (trimmed.startsWith('{')) {
                // JSON 未完成，尝试提取 text 字段实时渲染
                const extractedText = this._extractTextFieldFromPartialJSON(trimmed);
                if (extractedText) {
                  // 有 text 内容，流式渲染
                  streamEl.innerHTML = `<div class="agent-streaming-hint"><span class="agent-streaming-dots">●●●</span> 正在生成...</div>${thinkingHtml}<div class="chat-markdown-content">${this._renderADPMarkdown(extractedText)}</div>`;
                } else {
                  // JSON 还没到 text 字段，显示加载提示
                  streamEl.innerHTML = `<div class="agent-streaming-hint"><span class="agent-streaming-dots">●●●</span> 正在生成回复...</div>${thinkingHtml}`;
                }
              } else {
                // 正常 markdown 渲染
                streamEl.innerHTML = `<div class="agent-streaming-hint"><span class="agent-streaming-dots">●●●</span> 正在生成...</div>${thinkingHtml}<div class="chat-markdown-content">${this._renderADPMarkdown(finalText, this._agentReasoningText)}</div>`;
              }
            }
          }
          this._agentRenderPending = false;
        });
      }
    }

    // 自动滚动
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  /** 格式化流式耗时 */
  _formatStreamElapsed() {
    if (!this._agentStreamTimerStart) return '';
    const s = Math.floor((Date.now() - this._agentStreamTimerStart) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
  },

  /** 更新流式计时器显示 */
  _updateAgentStreamTimer() {
    const el = document.getElementById('agentReasoningTimer');
    if (el) el.textContent = this._formatStreamElapsed();
  },

  /** 渲染思考过程预览（截取+换行处理） */
  _renderReasoningPreview(text) {
    if (!text || !text.trim()) return '';
    const trimmed = text.trim();
    // 显示最近的思考内容，最多 500 字符
    const display = trimmed.length > 500 ? '...' + trimmed.slice(-500) : trimmed;
    return this.escapeHtml(display).replace(/\n/g, '<br>');
  },

  /** 健壮解析 JSON：支持带注释、多余文本包裹等情况 */
  _robustJSONParse(text) {
    if (!text || typeof text !== 'string') return null;
    let str = text.trim();

    // 1. 直接解析
    try { const r = JSON.parse(str); if (r && typeof r === 'object') return r; } catch {}

    // 2. 去除 JS 单行注释 (// ...) 和多行注释 (/* ... */)
    const noComments = str.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    try { const r = JSON.parse(noComments); if (r && typeof r === 'object') return r; } catch {}

    // 3. 尾随逗号清理（,} → }, ,] → ]）
    const noTrail = noComments.replace(/,\s*([}\]])/g, '$1');
    try { const r = JSON.parse(noTrail); if (r && typeof r === 'object') return r; } catch {}

    // 4. 提取第一个完整的 {...} JSON 块
    const firstBrace = str.indexOf('{');
    if (firstBrace >= 0) {
      let depth = 0, inStr = false, escape = false;
      for (let i = firstBrace; i < str.length; i++) {
        const ch = str[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{') depth++;
        if (ch === '}') { depth--; if (depth === 0) {
          const extracted = str.substring(firstBrace, i + 1);
          // 递归用步骤 2-3 的清理逻辑
          const cleaned = extracted.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/,\s*([}\]])/g, '$1');
          try { const r = JSON.parse(cleaned); if (r && typeof r === 'object') return r; } catch {}
          break;
        }}
      }
    }

    return null;
  },

  /** 从部分 JSON 中提取 text 字段内容（用于流式渲染） */
  _extractTextFieldFromPartialJSON(str) {
    if (!str || typeof str !== 'string') return null;
    // 查找 "text": "..." 或 "text":"..."
    // 匹配 "text" 键后跟冒号和引号开始的内容
    const textKeyMatch = str.match(/"text"\s*:\s*"/);
    if (!textKeyMatch) return null;
    
    const startIdx = textKeyMatch.index + textKeyMatch[0].length;
    let result = '';
    let i = startIdx;
    while (i < str.length) {
      const ch = str[i];
      if (ch === '\\') {
        // 转义字符
        const next = str[i + 1];
        if (next === 'n') { result += '\n'; i += 2; }
        else if (next === 't') { result += '\t'; i += 2; }
        else if (next === '"') { result += '"'; i += 2; }
        else if (next === '\\') { result += '\\'; i += 2; }
        else if (next === 'u' && str[i + 5]) { 
          try { result += JSON.parse('"\\u' + str.substring(i + 2, i + 6) + '"'); i += 6; }
          catch { result += ch; i++; }
        }
        else { result += next || ch; i += next ? 2 : 1; }
      } else if (ch === '"') {
        // 字符串结束
        return result;
      } else {
        result += ch;
        i++;
      }
    }
    // 未闭合的字符串，返回已提取的内容（流式中间状态）
    return result || null;
  },

  /** 将 chat 模式误返回的 JSON 转为友好的 Markdown 展示 */
  _renderChatJSONAsMarkdown(obj) {
    const parts = [];

    // 主文本
    const text = obj.text || obj.content || obj.answer || obj.message;
    if (text) {
      parts.push(this._renderADPMarkdown(text, this._agentReasoningText));
    }

    // 建议列表
    const suggestions = obj.suggestions || obj.recommendations || [];
    if (suggestions.length) {
      parts.push(`<div class="chat-suggestions">`);
      parts.push(`<div class="chat-suggestions-title">💡 建议</div>`);
      suggestions.forEach(s => {
        const label = typeof s === 'string' ? s : (s.text || s.label || s.title || JSON.stringify(s));
        parts.push(`<div class="chat-suggestion-item">• ${this.escapeHtml(label)}</div>`);
      });
      parts.push(`</div>`);
    }

    // 关联任务
    const tasks = obj.related_tasks || obj.tasks || [];
    if (tasks.length) {
      parts.push(`<div class="chat-related-tasks">`);
      parts.push(`<div class="chat-related-title">📋 相关任务</div>`);
      tasks.forEach(t => {
        const label = typeof t === 'string' ? t : (t.title || t.name || JSON.stringify(t));
        parts.push(`<span class="chat-related-tag">${this.escapeHtml(label)}</span>`);
      });
      parts.push(`</div>`);
    }

    // 推理步骤
    const steps = obj.reasoning_steps || obj.steps || [];
    if (steps.length) {
      parts.push(`<div class="chat-reasoning-steps">`);
      parts.push(`<div class="chat-reasoning-title">🔍 分析过程</div>`);
      steps.forEach((s, i) => {
        const label = typeof s === 'string' ? s : (s.description || s.text || JSON.stringify(s));
        parts.push(`<div class="chat-reasoning-step"><span class="step-num">${i + 1}</span>${this.escapeHtml(label)}</div>`);
      });
      parts.push(`</div>`);
    }

    // 如果什么都没提取到，回退到原始 JSON 的 markdown 渲染
    if (!parts.length) {
      return this._renderADPMarkdown(JSON.stringify(obj, null, 2), this._agentReasoningText);
    }

    return parts.join('');
  },

  _finishAgentMessage(messageContent, fullText, agentType, traceId, usage) {
    // 清理流式状态
    this._agentStreaming = false;
    this._agentCurrentBubble = null;
    if (this._agentStreamTimerInterval) {
      clearInterval(this._agentStreamTimerInterval);
      this._agentStreamTimerInterval = null;
    }
    window.electronAPI?.removeAgentListeners?.();
    if (this._agentStreamResolve) {
      this._agentStreamResolve();
      this._agentStreamResolve = null;
    }

    const agentLabels = { priority: '🎯 优先级规划', knowledge: '📚 知识梳理', memory: '🧠 记忆整理', report: '📊 日报生成', chat: '🤖 LLM 对话' };
    const badgeCls = agentType === 'chat' ? 'agent-badge agent-badge-llm' : 'agent-badge';
    let html = `<div class="${badgeCls}">${agentLabels[agentType] || '💬 对话'}</div>`;

    // 尝试解析为 JSON（agent 模式或 chat 模式可能返回 JSON）
    let parsed = this._robustJSONParse(fullText);

    if (parsed && typeof parsed === 'object') {
      if (agentType === 'chat') {
        // chat 模式 JSON 兜底：转为友好的 Markdown 展示 + 思考过程
        const thinkingHtml = this._agentReasoningText ? this._renderADPThinking(this._agentReasoningText) : '';
        html += `${thinkingHtml}<div class="chat-markdown-content">${this._renderChatJSONAsMarkdown(parsed)}</div>`;
      } else {
        html += this.renderAgentResult(parsed, agentType);
      }
    } else {
      // 纯文本模式
      html += `<div class="chat-markdown-content">${this._renderADPMarkdown(fullText, this._agentReasoningText)}</div>`;
    }

    // 反馈按钮
    if (traceId) {
      html += `<div class="agent-feedback" data-trace-id="${traceId}">
        <button class="feedback-btn feedback-accept" title="有用">👍</button>
        <button class="feedback-btn feedback-reject" title="没用">👎</button>
      </div>`;
    }

    // 复制按钮
    html += '<button class="copy-btn" title="复制"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>';

    // 时间戳
    const assistantMsg = messageContent.closest('.message.assistant');
    const sendTime = assistantMsg?.dataset.sendTime;
    const timeLabel = sendTime
      ? `${this._formatChatTime(new Date(sendTime))} → ${this._formatChatTime(new Date())}`
      : this._formatChatTime(new Date());
    html += `<span class="message-time assistant-time">${timeLabel}</span>`;

    messageContent.innerHTML = html;

    // 事件委托：存储结果数据供 _handleChatClick 使用（无需单独 addEventListener）
    this._chatMsgData.set(messageContent, { parsed, agentType, fullText });

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

    // 流式完成后保存会话消息（与 _finishADPMessage 保持一致）
    this._saveCurrentSessionMessages();
    this._syncPushCurrentConversation(messageContent);
  },

  // ===== ADP SSE 流式渲染（参考 ADP Agent SDK） =====

  _addCopyButton(messageContent) {
    const copyBtnHtml = '<button class="copy-btn" title="复制"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>';
    messageContent.insertAdjacentHTML('beforeend', copyBtnHtml);
    // 事件委托已在 _handleChatClick 中统一处理，无需单独 addEventListener
  },

  _handleADPSSEEvent(evt, assistantMessage) {
    const { event, data, configSource, aborted } = evt;
    const messageContent = assistantMessage.querySelector('.message-content');
    if (!messageContent) return;

    if (configSource) this._adpConfigSource = configSource;

    // 完成 / 中止
    if (event === 'done') {
      this._finishADPMessage(messageContent, aborted);
      return;
    }

    // 错误（兼容多种错误结构：{Error:{Code,Message}} / {type,code,msg} / {error:{message}}）
    if (event === 'error') {
      const errMsg = data?.Error?.Message || data?.error?.message || data?.msg || data?.Message || '未知错误';
      const errCode = data?.Error?.Code || data?.code || '';
      this._addErrorToADP(messageContent, errCode ? `[${errCode}] ${errMsg}` : errMsg);
      this._finishADPMessage(messageContent);
      return;
    }

    // ---- SSE 事件分派 ----
    switch (event) {
      case 'request_ack':
        this._addADPProgressStep('', '📤', '请求已发送', 'done');
        break;

      case 'response.created':
        this._addADPProgressStep('', '🤖', '智能体已接收', 'done');
        break;

      case 'response.processing':
        if (data?.Response?.StatusDesc) {
          // 可选：更新状态文字
        }
        break;

      case 'message.added': {
        const msg = data?.Message || {};
        const msgId = data?.MessageId || msg.MessageId || '';

        if (msg.Type === 'tool_call') {
          const toolName = msg.ExtraInfo?.ToolName || msg.Name || '工具';
          const icon = this._getADPToolIcon(toolName);
          const label = this._getADPToolLabel(toolName);
          this._addADPProgressStep(msgId, icon, label, 'active', 'tool_call');
        } else if (msg.Type === 'thought') {
          const agentName = msg.ExtraInfo?.AgentName || '';
          const label = agentName ? `思考（${agentName}）` : '思考中';
          this._addADPProgressStep(msgId, '💭', label, 'active', 'thought');
        } else if (msg.Type === 'task_execution') {
          this._addADPProgressStep(msgId, '⚡', msg.Title || '任务执行', 'active', 'task_execution');
        } else if (msg.Type === 'notice') {
          this._addADPProgressStep(msgId, 'ℹ️', msg.StatusDesc || '提示', 'active', 'notice');
        } else if (msg.Type === 'reply' || msg.Name === 'reply') {
          this._adpReplyMsgId = msgId;
          // 记录到 stepMap 以便 text.delta 路由
          this._adpStepMap[msgId] = { type: 'reply', textBuffer: '' };
          this._startADPReply(messageContent);
        }
        break;
      }

      case 'message.processing': {
        const msg = data?.Message || {};
        const msgId = data?.MessageId || msg.MessageId || '';
        const stepInfo = this._adpStepMap[msgId];
        if (stepInfo && msg.Contents?.[0]?.Text?.trim()) {
          this._addADPStepDetail(msgId, msg.Contents[0].Text, 'text');
        }
        break;
      }

      case 'message.done': {
        const msg = data?.Message || {};
        const msgId = data?.MessageId || msg.MessageId || '';
        const stepInfo = this._adpStepMap[msgId];

        if (msg.Type === 'tool_call') {
          const toolName = msg.ExtraInfo?.ToolName || msg.Name || '工具';
          const doneLabel = this._getADPToolLabel(toolName) + ' ✓';
          this._updateADPProgressStep(msgId, doneLabel, 'done');
          if (msg.Contents?.[0]?.Text) {
            const resultText = msg.Contents[0].Text;
            if (toolName === 'FileToURL') {
              try {
                const result = JSON.parse(resultText);
                if (result.files) {
                  result.files.forEach(f => this._adpFileItems.push(f));
                  const cards = result.files.map(f => {
                    const fn = f.file_path?.split('/').pop() || '文件';
                    const ext = fn.split('.').pop()?.toLowerCase();
                    const iconMap = { html: '🌐', pdf: '📖', xlsx: '📊', csv: '📋', png: '🖼', jpg: '🖼' };
                    const ic = iconMap[ext] || '📄';
                    return `<div class="adp-file-card" data-url="${this.escapeHtml(f.url || '#')}" data-name="${this.escapeHtml(fn)}">
                      <span class="adp-file-icon">${ic}</span><span class="adp-file-name">${this.escapeHtml(fn)}</span><span class="adp-file-save-btn" data-action="save">💾 保存</span><span class="adp-file-open-btn" data-action="open">↗ 打开</span></div>`;
                  }).join('');
                  this._addADPStepDetail(msgId, cards, 'file');
                }
              } catch (e) { this._addADPStepDetail(msgId, resultText, 'json'); }
            } else if (this._isADPWidgetContent(resultText)) {
              try {
                const widgetData = JSON.parse(resultText);
                const widgetContainer = document.createElement('div');
                widgetContainer.className = 'adp-widget-container';
                messageContent.appendChild(widgetContainer);
                this._renderADPWidget(msgId, widgetData, widgetContainer);
              } catch (e) {
                const contentType = msg.Contents[0].Type || 'text';
                this._addADPStepDetail(msgId, resultText, contentType === 'json_text' ? 'json' : 'text');
              }
            } else {
              // ask_user_question 等工具的文本内容，用 text 类型展示更可读
              const contentText = msg.Contents[0].Text;
              const contentType = msg.Contents[0].Type || 'text';
              if (contentType === 'json_text') {
                this._addADPStepDetail(msgId, contentText, 'json');
              } else {
                this._addADPStepDetail(msgId, contentText, 'text');
              }
            }
          }
          // 如果 text.delta 有缓存文本但 message.done 没有显式 Contents，用缓存的
          if (!msg.Contents?.[0]?.Text && stepInfo?.textBuffer) {
            this._addADPStepDetail(msgId, stepInfo.textBuffer, 'text');
          }
        } else if (msg.Type === 'thought') {
          const doneLabel = (msg.ExtraInfo?.AgentName ? `思考（${msg.ExtraInfo.AgentName}）` : '思考') + ' ✓';
          this._updateADPProgressStep(msgId, doneLabel, 'done');
          if (msg.Contents?.[0]?.Text) {
            this._addADPStepDetail(msgId, msg.Contents[0].Text, 'text');
          } else if (stepInfo?.textBuffer) {
            this._addADPStepDetail(msgId, stepInfo.textBuffer, 'text');
          }
          // 将思考内容也追加到 thinkingText，供最终渲染使用
          const thoughtContent = msg.Contents?.[0]?.Text || stepInfo?.textBuffer || '';
          if (thoughtContent) this._adpThinkingText += thoughtContent;
        } else if (msg.Type === 'task_execution' || msg.Type === 'notice') {
          const doneLabel = (msg.Title || msg.StatusDesc || '完成') + ' ✓';
          this._updateADPProgressStep(msgId, doneLabel, 'done');
          if (msg.Contents?.[0]?.Text) {
            this._addADPStepDetail(msgId, msg.Contents[0].Text, 'text');
          }
        }
        break;
      }

      case 'content.added': {
        const msgId = data?.MessageId || '';
        // 如果是 reply 消息的 content.added，确保回复气泡已创建
        const stepInfo = this._adpStepMap[msgId];
        if (stepInfo?.type === 'reply' || !stepInfo) {
          if (!this._adpCurrentBubble) this._startADPReply(messageContent);
        }
        break;
      }

      case 'text.delta': {
        const msgId = data?.MessageId || '';
        const text = data?.Text || '';
        if (!text) break;
        // 过滤混入的 JSON 内容
        if (/^\{"content":\[/i.test(text)) break;

        const stepInfo = this._adpStepMap[msgId];
        if (stepInfo && stepInfo.type !== 'reply') {
          // 非 reply 消息的 text.delta → 追加到步骤详情
          // 增量检测：如果新文本以已缓存文本为前缀，说明是累积模式，替换而非追加
          if (stepInfo.textBuffer && text.startsWith(stepInfo.textBuffer)) {
            stepInfo.textBuffer = text;
          } else {
            stepInfo.textBuffer = (stepInfo.textBuffer || '') + text;
          }
          this._updateADPStepDetailStreaming(msgId, stepInfo.textBuffer);
        } else {
          // reply 消息或未知消息 → 追加到主回复
          if (!this._adpCurrentBubble) this._startADPReply(messageContent);
          // 增量检测：如果新文本以已累积文本为前缀，说明 ADP 发送的是累积文本而非增量
          // 此时应该替换而非追加，避免重复
          if (this._adpCurrentText && text.startsWith(this._adpCurrentText)) {
            this._adpCurrentText = text;
          } else if (this._adpCurrentText && this._adpCurrentText.endsWith(text)) {
            // 新文本是已累积文本的尾部 → 跳过（完全重复）
            // 不做任何操作
          } else {
            this._adpCurrentText += text;
          }
          this._renderADPBubble();
        }
        break;
      }

      case 'text.replace': {
        const msgId = data?.MessageId || '';
        const stepInfo = this._adpStepMap[msgId];
        if (stepInfo && stepInfo.type !== 'reply') {
          stepInfo.textBuffer = data?.Text || '';
          this._updateADPStepDetailStreaming(msgId, stepInfo.textBuffer);
        } else {
          if (data?.Text) {
            this._adpCurrentText = data.Text;
            this._renderADPBubble();
          }
        }
        break;
      }

      case 'response.completed':
        if (data?.Response?.StatInfo) {
          const stat = data.Response.StatInfo;
          // 可选：显示 token 统计
        }
        break;

      case 'thought':
        // 兼容旧版 thought 事件（V1 接口）
        if (data?.Text || data?.Content) {
          this._adpThinkingText += (data.Text || data.Content || '');
        }
        break;
    }

    // 自动滚动
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  _startADPReply(messageContent) {
    if (this._adpCurrentBubble) return; // 已有回复气泡

    // 不再在回复开始时立即折叠进度区域——后续可能还有工具步骤
    // 折叠移到 _finishADPMessage 中处理

    // 添加 ADP 智能体 badge
    const badgeEl = document.createElement('div');
    badgeEl.className = 'agent-badge agent-badge-adp';
    badgeEl.textContent = '🤖 ADP 智能体';
    messageContent.appendChild(badgeEl);

    // 创建回复文本区域
    const replyEl = document.createElement('div');
    replyEl.className = 'adp-response-streaming';
    replyEl.id = 'adpCurrentReply';
    messageContent.appendChild(replyEl);
    this._adpCurrentBubble = replyEl;
  },

  _renderADPBubble() {
    if (!this._adpCurrentBubble || this._adpRenderPending) return;
    this._adpRenderPending = true;
    requestAnimationFrame(() => {
      if (this._adpCurrentBubble) {
        this._adpCurrentBubble.innerHTML = this._renderADPMarkdown(this._adpCurrentText, this._adpThinkingText);
      }
      this._adpRenderPending = false;
    });
  },

  _finishADPMessage(messageContent, aborted) {
    // 停止计时器
    if (this._adpTimerInterval) {
      clearInterval(this._adpTimerInterval);
      this._adpTimerInterval = null;
    }

    // 完成时折叠进度区域（不再在 _startADPReply 中提前折叠）
    this._collapseADPProgress();

    // 如果没有回复气泡，创建一个
    if (!this._adpCurrentBubble && this._adpCurrentText) {
      this._startADPReply(messageContent);
    }

    // 最终渲染
    if (this._adpCurrentBubble) {
      this._adpCurrentBubble.classList.remove('adp-response-streaming');
      this._adpCurrentBubble.removeAttribute('id');
      this._adpCurrentBubble.innerHTML = this._renderADPMarkdown(this._adpCurrentText, this._adpThinkingText);

      // 事件委托已在 _handleChatClick 中统一处理链接、思考折叠、产物保存等
    }

    // 如果有文件输出，添加文件卡片区域
    if (this._adpFileItems.length > 0) {
      const filesHtml = this._adpFileItems.map(f => {
        const fn = f.file_path?.split('/').pop() || '文件';
        const ext = fn.split('.').pop()?.toLowerCase();
        const iconMap = { html: '🌐', pdf: '📖', xlsx: '📊', csv: '📋', png: '🖼', jpg: '🖼' };
        const ic = iconMap[ext] || '📄';
        return `<div class="adp-file-card" data-url="${this.escapeHtml(f.url || '#')}" data-name="${this.escapeHtml(fn)}">
          <span class="adp-file-icon">${ic}</span><span class="adp-file-name">${this.escapeHtml(fn)}</span><span class="adp-file-save-btn" data-action="save">💾 保存</span><span class="adp-file-open-btn" data-action="open">↗ 打开</span></div>`;
      }).join('');
      const filesEl = document.createElement('div');
      filesEl.className = 'adp-files-section';
      filesEl.innerHTML = filesHtml;
      // 事件委托已在 _handleChatClick 中统一处理文件卡片按钮
      messageContent.appendChild(filesEl);
    }

    // 配置来源标识
    const sourceLabels = { cloud: '☁️ 云端配置', local: '💻 本地配置', default: '📦 内置默认' };
    const sourceLabel = sourceLabels[this._adpConfigSource] || '📦 内置默认';
    messageContent.insertAdjacentHTML('beforeend', `<div class="adp-config-source">${sourceLabel}</div>`);

    // 复制按钮
    this._addCopyButton(messageContent);

    // 时间戳
    const assistantMsg = messageContent.closest('.message.assistant');
    const sendTime = assistantMsg?.dataset.sendTime;
    const timeLabel = sendTime
      ? `${this._formatChatTime(new Date(sendTime))} → ${this._formatChatTime(new Date())}`
      : this._formatChatTime(new Date());
    messageContent.insertAdjacentHTML('beforeend', `<span class="message-time assistant-time">${timeLabel}</span>`);

    // 清理状态
    this._adpStreaming = false;
    document.body.classList.remove('streaming-active');
    this._adpCurrentBubble = null;
    this._adpCurrentMessageEl = null;
    this._updateStreamingUI(false);
    window.electronAPI?.removeADPListeners?.();
    if (this._adpStreamResolve) {
      this._adpStreamResolve();
      this._adpStreamResolve = null;
    }

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

    // 流式完成后保存会话消息
    this._saveCurrentSessionMessages();

    // 同步：推送完整对话（user + assistant 消息）到云端
    this._syncPushCurrentConversation(messageContent);

    // ===== AI 完成提醒（耗时长 + 用户已切走时） =====
    if (!aborted) {
      const elapsedMs = this._adpTimerStart ? (Date.now() - this._adpTimerStart) : 0;
      this._notifyADPCompleted(messageContent, elapsedMs);
    }
    this._adpTimerStart = null;
  },

  /**
   * AI 回答完成提醒
   * - 耗时 < 5s 不提醒
   * - 窗口失焦/最小化 → 系统通知 + Dock 弹跳 + 提示音
   * - 窗口聚焦但 AI 助手不可见 → 应用内 toast + 提示音
   * - 窗口聚焦且在 AI 助手 → 气泡呼吸动画
   */
  async _notifyADPCompleted(messageContent, elapsedMs) {
    try {
      // 用户开关：默认开启
      const enabled = localStorage.getItem('memora_chat_notify_enabled');
      if (enabled === 'false') {
        console.log('[Notify] skip: disabled by user');
        return;
      }

      // 阈值：低于 3s 的回答不打扰（耗时短没必要提醒）
      const MIN_NOTIFY_MS = 3000;
      if (elapsedMs < MIN_NOTIFY_MS) {
        console.log('[Notify] skip: elapsed too short', elapsedMs, 'ms (<', MIN_NOTIFY_MS, ')');
        return;
      }

      // 提取摘要（前 50 字）
      let preview = '';
      try {
        const textEl = messageContent.querySelector('.adp-response-text, .chat-markdown-content, .message-text, p');
        preview = (textEl?.textContent || messageContent.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
        if (preview.length === 50) preview += '...';
      } catch {}

      const elapsedSec = Math.round(elapsedMs / 1000);
      const title = `🤖 AI 回答完成（耗时 ${elapsedSec}s）`;
      const body = preview || '点击查看 AI 的回答';

      // 检查窗口聚焦状态
      let focusState = { focused: true, visible: true, minimized: false };
      try {
        const result = await window.electronAPI?.getWindowFocusState?.();
        if (result) focusState = result;
      } catch (e) {
        console.warn('[Notify] getWindowFocusState failed:', e.message);
      }

      // 检查 AI 助手 Tab 是否可见
      const isOnAIAssistant = this._isAIAssistantVisible();
      const windowAway = !focusState.focused || focusState.minimized;

      console.log('[Notify] decision:', {
        elapsedMs,
        focused: focusState.focused,
        minimized: focusState.minimized,
        windowAway,
        isOnAIAssistant
      });

      if (windowAway) {
        // 场景 1：用户切走窗口 → 系统通知 + 应用图标提醒 + 声音
        console.log('[Notify] Scene 1: window away, send system notification');
        try {
          await window.electronAPI?.showNotification?.(title, body);
          await window.electronAPI?.flashWindowAttention?.();
        } catch (e) {
          console.warn('[Notify] system notification failed:', e.message);
        }
        this._playChatNotifySound();
      } else if (!isOnAIAssistant) {
        // 场景 2：在应用内但不在 AI 助手 → toast + 声音
        console.log('[Notify] Scene 2: app focused but not on AI assistant, show toast');
        this.showToast(`💬 ${title}：${preview || '已回答'}`, 'info');
        this._playChatNotifySound();
      } else {
        // 场景 3：在 AI 助手 → 气泡呼吸动画 + 轻声"叮"
        console.log('[Notify] Scene 3: on AI assistant, pulse animation');
        this._pulseADPMessage(messageContent);
        this._playChatNotifySound(true); // 静音模式
      }
    } catch (err) {
      console.warn('[Notify] ADP completed notify failed:', err.message);
    }
  },

  /**
   * 测试入口（DevTools Console 中执行 App._testNotify() 即可触发）
   */
  _testNotify() {
    const fakeContent = document.createElement('div');
    fakeContent.innerHTML = '<p>这是一条测试消息，用于验证 AI 完成提醒功能是否正常工作</p>';
    return this._notifyADPCompleted(fakeContent, 8000);
  },

  /** 判断 AI 助手 Tab 是否当前可见 */
  _isAIAssistantVisible() {
    try {
      // AI 助手主容器：#aiAssistantView（class .ai-assistant-view）
      const aiPage = document.getElementById('aiAssistantView') ||
                     document.querySelector('.ai-assistant-view') ||
                     document.querySelector('.ai-chat-container');
      if (!aiPage) return false;
      // 主视图通过 .hidden 类隐藏
      if (aiPage.classList.contains('hidden')) return false;
      const style = window.getComputedStyle(aiPage);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = aiPage.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  },

  /** 在用户交互时解锁 AudioContext（规避浏览器 autoplay policy）*/
  _unlockAudioContext() {
    try {
      if (!this._notifyAudioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this._notifyAudioCtx = new Ctx();
      }
      if (this._notifyAudioCtx.state === 'suspended') {
        this._notifyAudioCtx.resume().then(() => {
          console.log('[Notify] AudioContext resumed by user interaction');
        }).catch(() => {});
      }
    } catch {}
  },

  /** Web Audio 生成"叮"声（无需音频文件）
   * @param {boolean} soft 轻量模式（音量减半，用于场景 3）
   */
  _playChatNotifySound(soft = false) {
    try {
      // 复用 AudioContext，避免泄漏
      if (!this._notifyAudioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
          console.warn('[Notify] AudioContext not supported');
          return;
        }
        this._notifyAudioCtx = new Ctx();
      }
      const ctx = this._notifyAudioCtx;
      // AudioContext 在某些浏览器中默认 suspended，需要 resume
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const peakGain = soft ? 0.08 : 0.18;
      // 双音叮咚（C5 → E5）
      const playTone = (freq, startTime, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      const now = ctx.currentTime;
      playTone(523.25, now, 0.18);          // C5
      playTone(659.25, now + 0.12, 0.22);   // E5
      console.log('[Notify] Sound played (soft:', soft, ')');
    } catch (e) {
      console.warn('[Notify] play sound failed:', e.message);
    }
  },

  /** AI 消息气泡呼吸提醒动画（场景 3） */
  _pulseADPMessage(messageContent) {
    try {
      const bubble = messageContent.closest('.message.assistant') || messageContent;
      if (!bubble) return;
      bubble.classList.add('adp-completed-pulse');
      setTimeout(() => bubble.classList.remove('adp-completed-pulse'), 2000);
    } catch {}
  },

  _addErrorToADP(messageContent, errMsg) {
    const errEl = document.createElement('div');
    errEl.className = 'adp-error-text';
    errEl.textContent = `❌ ${errMsg}`;
    messageContent.appendChild(errEl);
  },

  // ---- 进度步骤 ----

  _addADPProgressStep(msgId, icon, text, status, msgType) {
    const container = this._adpCurrentMessageEl;
    const stepsEl = container?.querySelector('#adpProgressSteps') || document.getElementById('adpProgressSteps');
    if (!stepsEl) return;
    this._adpToolStepCount++;
    const progressEl = container?.querySelector('#adpProgress') || document.getElementById('adpProgress');
    if (progressEl && progressEl.classList.contains('collapsed')) {
      const titleEl = progressEl.querySelector('.adp-progress-title');
      if (titleEl) titleEl.textContent = `已完成 ${this._adpToolStepCount} 个步骤`;
    }
    const stepEl = document.createElement('div');
    stepEl.className = 'adp-progress-step' + (status === 'active' ? ' active' : status === 'done' ? ' done' : '');
    stepEl.dataset.msgId = msgId || '';
    stepEl.dataset.msgType = msgType || '';
    stepEl.innerHTML = `
      <div class="adp-step-row">
        <span class="adp-step-icon">${icon}</span>
        <span class="adp-step-text">${this.escapeHtml(text)}</span>
        <span class="adp-step-status">${status === 'active' ? '<span class="adp-step-loading"></span>' : status === 'done' ? '✓' : ''}</span>
        <span class="adp-step-expand" style="display:none">▶</span>
      </div>
      <div class="adp-step-detail"></div>`;
    stepsEl.appendChild(stepEl);
    // 记录到 stepMap：如果已有记录（如 reply 类型已提前注册），保留 type；否则用 msgType
    if (msgId) {
      const existing = this._adpStepMap[msgId];
      if (existing) {
        existing.el = stepEl;
        existing.detailEl = stepEl.querySelector('.adp-step-detail');
      } else {
        this._adpStepMap[msgId] = { el: stepEl, detailEl: stepEl.querySelector('.adp-step-detail'), type: msgType || 'tool_call', textBuffer: '' };
      }
    }

    // 点击展开/折叠详情
    const row = stepEl.querySelector('.adp-step-row');
    row.addEventListener('click', () => {
      const detail = stepEl.querySelector('.adp-step-detail');
      if (!detail || !detail.innerHTML.trim()) return;
      stepEl.classList.toggle('detail-expanded');
      const exp = stepEl.querySelector('.adp-step-expand');
      if (exp) exp.textContent = stepEl.classList.contains('detail-expanded') ? '▼' : '▶';
    });

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  _updateADPProgressStep(msgId, text, status) {
    const info = msgId ? this._adpStepMap[msgId] : null;
    if (!info?.el) return;
    if (text) info.el.querySelector('.adp-step-text').textContent = text;
    const statusEl = info.el.querySelector('.adp-step-status');
    info.el.className = 'adp-progress-step' + (status === 'active' ? ' active' : status === 'done' ? ' done' : '');
    if (status === 'done') statusEl.innerHTML = '✓';
    else if (status === 'active') statusEl.innerHTML = '<span class="adp-step-loading"></span>';
  },

  _addADPStepDetail(msgId, content, contentType) {
    const info = msgId ? this._adpStepMap[msgId] : null;
    if (!info?.detailEl) return;
    const detailEl = info.detailEl;
    const expandEl = info.el.querySelector('.adp-step-expand');
    if (expandEl) expandEl.style.display = 'inline';

    if (contentType === 'json') {
      let formatted = content;
      try {
        const parsed = JSON.parse(content);
        if (parsed.content && Array.isArray(parsed.content) && parsed.content[0]?.text) {
          try { formatted = JSON.parse(parsed.content[0].text); } catch {}
          formatted = typeof formatted === 'string' ? parsed.content[0].text : JSON.stringify(formatted, null, 2);
        } else {
          formatted = JSON.stringify(parsed, null, 2);
        }
      } catch (e) { formatted = content; }
      if (formatted.length > 2000) formatted = formatted.substring(0, 2000) + '\n... (已截断)';
      detailEl.innerHTML = `<div class="adp-step-detail-json"><pre><code>${this.escapeHtml(formatted)}</code></pre></div>`;
    } else if (contentType === 'file') {
      detailEl.innerHTML = content;
      // 事件委托已在 _handleChatClick 中统一处理文件卡片按钮
    } else {
      detailEl.innerHTML = `<div class="adp-step-detail-text">${this.escapeHtml(content).replace(/\n/g, '<br>')}</div>`;
    }

    info.el.classList.add('has-detail');
  },

  /**
   * 流式更新步骤详情（text.delta 追加模式）
   * 用于 tool_call/thought 等非 reply 消息的实时文本更新
   */
  _updateADPStepDetailStreaming(msgId, text) {
    const info = msgId ? this._adpStepMap[msgId] : null;
    if (!info?.detailEl) return;
    const detailEl = info.detailEl;
    const expandEl = info.el.querySelector('.adp-step-expand');
    if (expandEl) expandEl.style.display = 'inline';
    // 截断过长内容
    const displayText = text.length > 3000 ? text.substring(0, 3000) + '\n... (已截断)' : text;
    detailEl.innerHTML = `<div class="adp-step-detail-text">${this.escapeHtml(displayText).replace(/\n/g, '<br>')}</div>`;
    info.el.classList.add('has-detail');
  },

  _collapseADPProgress() {
    if (this._adpTimerInterval) {
      clearInterval(this._adpTimerInterval);
      this._adpTimerInterval = null;
    }
    const container = this._adpCurrentMessageEl;
    const progressEl = container?.querySelector('#adpProgress') || document.getElementById('adpProgress');
    if (!progressEl) return;
    progressEl.classList.add('collapsed');
    const stepsEl = container?.querySelector('#adpProgressSteps') || document.getElementById('adpProgressSteps');
    if (stepsEl) stepsEl.style.display = 'none';
    const titleEl = progressEl.querySelector('.adp-progress-title');
    const actualStepCount = stepsEl?.querySelectorAll('.adp-progress-step').length ?? this._adpToolStepCount;
    if (titleEl) titleEl.textContent = `已完成 ${actualStepCount} 个步骤`;
    const spinnerEl = progressEl.querySelector('.adp-progress-spinner');
    if (spinnerEl) spinnerEl.style.display = 'none';
    const headerEl = progressEl.querySelector('.adp-progress-header');
    if (headerEl) {
      headerEl.style.cursor = 'pointer';
      headerEl.onclick = () => {
        progressEl.classList.toggle('collapsed');
        const collapsed = progressEl.classList.contains('collapsed');
        if (stepsEl) stepsEl.style.display = collapsed ? 'none' : 'flex';
        const tEl = progressEl.querySelector('.adp-progress-title');
        if (tEl) tEl.textContent = collapsed ? `已完成 ${(stepsEl?.querySelectorAll('.adp-progress-step').length ?? this._adpToolStepCount)} 个步骤` : '智能体处理中';
      };
    }
    const timerEl = container?.querySelector('#adpProgressTimer') || document.getElementById('adpProgressTimer');
    if (timerEl && this._adpTimerStart) timerEl.textContent = `${Math.floor((Date.now() - this._adpTimerStart) / 1000)}s`;
  },

  /**
   * 折叠恢复的历史消息中的 ADP 进度指示器
   * 恢复的 HTML 中进度指示器仍为"智能体处理中"状态，需要统一折叠
   */
  _collapseRestoredADPProgress(container) {
    const progressEls = container.querySelectorAll('.adp-progress');
    progressEls.forEach(progressEl => {
      // 如果已经是折叠状态，跳过
      if (progressEl.classList.contains('collapsed')) return;
      progressEl.classList.add('collapsed');
      const stepsEl = progressEl.querySelector('.adp-progress-steps');
      if (stepsEl) stepsEl.style.display = 'none';
      const titleEl = progressEl.querySelector('.adp-progress-title');
      const actualStepCount = stepsEl?.querySelectorAll('.adp-progress-step').length || 0;
      if (titleEl) titleEl.textContent = actualStepCount > 0 ? `已完成 ${actualStepCount} 个步骤` : '已完成';
      const spinnerEl = progressEl.querySelector('.adp-progress-spinner');
      if (spinnerEl) spinnerEl.style.display = 'none';
      const timerEl = progressEl.querySelector('.adp-progress-timer');
      if (timerEl) timerEl.style.display = 'none';
      // 绑定展开/折叠切换
      const headerEl = progressEl.querySelector('.adp-progress-header');
      if (headerEl) {
        headerEl.style.cursor = 'pointer';
        headerEl.onclick = () => {
          progressEl.classList.toggle('collapsed');
          const collapsed = progressEl.classList.contains('collapsed');
          if (stepsEl) stepsEl.style.display = collapsed ? 'none' : 'flex';
          const tEl = progressEl.querySelector('.adp-progress-title');
          if (tEl) tEl.textContent = collapsed ? `已完成 ${(stepsEl?.querySelectorAll('.adp-progress-step').length || 0)} 个步骤` : '智能体处理中';
        };
      }
    });
  },

  // ---- ADP Markdown 渲染（简化版，参考 Agent SDK） ----

  _renderADPMarkdown(text, thinkingText) {
    if (!text && !thinkingText) return '';
    text = (text || '').replace(/\\u0026/g, '&');

    // 处理 <think/> 标签
    const LT = String.fromCharCode(60), GT = String.fromCharCode(62);
    const THINK_OPEN = LT + 'think' + GT, THINK_CLOSE = LT + '/think' + GT;
    text = text.replace(new RegExp(THINK_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\s\\S]*?)' + THINK_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (_, c) => { thinkingText = (thinkingText || '') + c; return ''; });

    // 提取 Markdown 链接
    const mdLinks = [];
    text = text.replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (match, linkText, url) => {
      const idx = mdLinks.length;
      let decodedUrl = url; try { decodedUrl = decodeURIComponent(url); } catch {}
      let fileName = linkText;
      const pathMatch = decodedUrl.match(/[?&]path=([^&]+)/);
      if (pathMatch && linkText.length > 20) try { fileName = decodeURIComponent(pathMatch[1]).split('/').pop(); } catch {}
      mdLinks.push({ url: decodedUrl, display: linkText, fileName, isHtml: decodedUrl.includes('.html') });
      return `__MDLINK_${idx}__`;
    });

    // 提取文件 JSON
    const fileCards = [];
    text = text.replace(/\{"files"\s*:\s*\[[\s\S]*?\]\}/g, (match) => {
      const idx = fileCards.length;
      try { fileCards.push(JSON.parse(match).files || []); } catch { fileCards.push(null); }
      return `\n__FILE_CARD_${idx}__\n`;
    });

    // 过滤 content JSON 混入
    text = text.replace(/\{"content"\s*:\s*\[\s*\{\s*"type"\s*:\s*"text"\s*,\s*"text"\s*:\s*"[^"]*"\s*\}\s*\]\s*\}/g, '');
    text = text.replace(/\{"content"\s*:\s*\[[\s\S]*?\]\s*\}(?=\s*[^\s{]|$)/g, (match) => {
      try { const p = JSON.parse(match); if (p.content && Array.isArray(p.content)) return ''; } catch {}
      return match;
    });

    // 🔧 提取 Markdown 表格（在 escape 前提取，避免 | 被转义）
    const tables = [];
    text = text.replace(/(?:^\|.+?\|(?:\r?\n|$))+/gm, (match) => {
      const idx = tables.length;
      tables.push(match);
      return `__TABLE_${idx}__`;
    });

    // 🔧 提取无序列表
    const ulLists = [];
    text = text.replace(/(?:^\s*[-*]\s+.+?(?:\r?\n|$))+/gm, (match) => {
      const idx = ulLists.length;
      ulLists.push(match);
      return `__ULLIST_${idx}__`;
    });

    // 🔧 提取有序列表
    const olLists = [];
    text = text.replace(/(?:^\s*\d+\.\s+.+?(?:\r?\n|$))+/gm, (match) => {
      const idx = olLists.length;
      olLists.push(match);
      return `__OLLIST_${idx}__`;
    });

    // 提取裸链接
    const links = [];
    text = text.replace(/https?:\/\/[^\s"'<>\]}|\\^`]+/g, (url) => {
      const idx = links.length;
      let du = url; try { du = decodeURIComponent(url); } catch {}
      let display = url;
      const pm = du.match(/[?&]path=([^&]+)/);
      if (pm) try { display = decodeURIComponent(pm[1]).split('/').pop(); } catch {}
      else if (url.length > 60) display = url.substring(0, 40) + '…' + url.substring(url.length - 15);
      links.push({ url: du, display });
      return `__LINK_${idx}__`;
    });

    // 提取容器内文件路径（如 /workdir/xxx.xlsx, /tmp/xxx.pdf）
    const filePaths = [];
    text = text.replace(/(?:文件路径[：:]\s*)?(\/(?:workdir|tmp|app|home|data|opt|output|files)[\/\\][^\s"'<>\]},;，；\]\)]+\.(?:xlsx?|docx?|pptx?|pdf|csv|json|html?|xml|svg|png|jpe?g|gif|zip|tar\.gz|md|txt|py|js|ts))/gi, (match, filePath) => {
      const idx = filePaths.length;
      const fileName = filePath.split('/').pop();
      filePaths.push({ path: filePath, name: fileName });
      return `__FILEPATH_${idx}__`;
    });

    // v3.1.2: 提取本地绝对路径（cc-workspace 产出物等）
    const localFilePaths = [];
    text = text.replace(/(?:^|[\s（(【\[])(\/(?:Users|home|tmp|var|opt)\/[^\s"'<>\]},;，；\]\)]+\.(?:xlsx?|docx?|pptx?|pdf|csv|json|html?|xml|svg|png|jpe?g|gif|zip|tar\.gz|md|txt|py|js|ts|css|sql|sh|yaml|yml|toml|conf|cfg|ini|env))/gm, (match, filePath) => {
      const idx = localFilePaths.length;
      const fileName = filePath.split('/').pop();
      localFilePaths.push({ path: filePath, name: fileName });
      return match.replace(filePath, `__LOCALFILE_${idx}__`);
    });

    let html = this.escapeHtml(text);

    // 还原 Markdown 链接
    // 🔧 修复：不使用 inline onclick（Electron contextIsolation 下可能不生效），
    // 改用 data-url 属性 + 事件委托（和 adp-file-card 同模式）
    mdLinks.forEach((link, idx) => {
      const ph = `__MDLINK_${idx}__`, su = this.escapeHtml(link.url), sd = this.escapeHtml(link.display);
      html = html.replace(ph, link.isHtml
        ? `<div class="adp-file-card" data-url="${su}" data-name="${this.escapeHtml(link.fileName)}"><span class="adp-file-icon">🌐</span><span class="adp-file-name">${sd}</span><span class="adp-file-save-btn" data-action="save">💾 保存</span><span class="adp-file-open-btn" data-action="open">↗ 打开</span></div>`
        : `<a href="${su}" class="adp-link" data-url="${su}">${sd}</a>`);
    });

    // 还原文件卡片
    fileCards.forEach((files, idx) => {
      const ph = `__FILE_CARD_${idx}__`;
      if (files && files.length > 0) {
        html = html.replace(ph, files.map(f => {
          const fn = f.file_path?.split('/').pop() || '文件';
          const ext = fn.split('.').pop()?.toLowerCase();
          const im = { html: '🌐', pdf: '📖', xlsx: '📊', csv: '📋', png: '🖼', jpg: '🖼' };
          return `<div class="adp-file-card" data-url="${this.escapeHtml(f.url || '#')}" data-name="${this.escapeHtml(fn)}"><span class="adp-file-icon">${im[ext] || '📄'}</span><span class="adp-file-name">${this.escapeHtml(fn)}</span><span class="adp-file-save-btn" data-action="save">💾 保存</span><span class="adp-file-open-btn" data-action="open">↗ 打开</span></div>`;
        }).join(''));
      } else html = html.replace(ph, '');
    });

    // 还原裸链接
    // 🔧 修复：同样使用 data-url + 事件委托
    links.forEach((link, idx) => {
      const ph = `__LINK_${idx}__`;
      html = html.replace(ph, `<a href="${this.escapeHtml(link.url)}" class="adp-link" data-url="${this.escapeHtml(link.url)}">${this.escapeHtml(link.display)}</a>`);
    });

    // 还原容器内文件路径（转为保存按钮）
    filePaths.forEach((fp, idx) => {
      const ph = `__FILEPATH_${idx}__`;
      const ext = fp.name.split('.').pop()?.toLowerCase();
      const im = { html: '🌐', htm: '🌐', pdf: '📖', xlsx: '📊', xls: '📊', docx: '📝', doc: '📝', pptx: '📊', csv: '📋', json: '📋', png: '🖼', jpg: '🖼', jpeg: '🖼', svg: '🖼', md: '📝' };
      // 文件路径不是可下载 URL，用 data-filepath 标记，后续可走 ADP 文件下载
      html = html.replace(ph, `<div class="adp-file-card" data-url="#" data-name="${this.escapeHtml(fp.name)}" data-filepath="${this.escapeHtml(fp.path)}"><span class="adp-file-icon">${im[ext] || '📄'}</span><span class="adp-file-name">${this.escapeHtml(fp.name)}</span><span class="adp-file-save-btn" data-action="save">💾 保存</span><span class="adp-file-open-btn" data-action="open">↗ 打开</span></div>`);
    });

    // v3.1.2: 还原本地文件路径（可点击打开/在 Finder 中显示）
    localFilePaths.forEach((fp, idx) => {
      const ph = `__LOCALFILE_${idx}__`;
      const ext = fp.name.split('.').pop()?.toLowerCase();
      const icons = { md: '📝', html: '🌐', htm: '🌐', pdf: '📖', xlsx: '📊', xls: '📊', docx: '📝', doc: '📝', pptx: '📊', csv: '📋', json: '📋', png: '🖼', jpg: '🖼', jpeg: '🖼', svg: '🖼', txt: '📄', py: '🐍', js: '📜', ts: '📜', css: '🎨', sql: '🗄', sh: '⚙️', yaml: '⚙️', yml: '⚙️' };
      const icon = icons[ext] || '📄';
      html = html.replace(ph, `<span class="chat-file-link" data-filepath="${this.escapeHtml(fp.path)}"><span class="chat-file-icon">${icon}</span>${this.escapeHtml(fp.name)}<span class="chat-file-actions"><button class="chat-file-action-btn" data-action="open">打开</button><button class="chat-file-action-btn" data-action="reveal">📁</button></span></span>`);
    });

    // 🔧 还原 Markdown 表格
    tables.forEach((table, idx) => {
      const ph = `__TABLE_${idx}__`;
      const rows = table.trim().split(/\r?\n/).filter(r => r.trim());
      if (rows.length < 2) { html = html.replace(ph, ''); return; }
      // 过滤表头分隔行（|---|---|）
      const dataRows = rows.filter(r => !r.match(/^\|?\s*[-:]+/));
      const headerRow = dataRows[0];
      const bodyRows = dataRows.slice(1);
      if (!headerRow) { html = html.replace(ph, ''); return; }
      let tableHtml = '<table class="adp-table"><thead><tr>';
      headerRow.split('|').filter(c => c.trim()).forEach(cell => {
        tableHtml += `<th>${this.escapeHtml(cell.trim())}</th>`;
      });
      tableHtml += '</tr></thead><tbody>';
      bodyRows.forEach(row => {
        tableHtml += '<tr>';
        row.split('|').filter(c => c.trim()).forEach(cell => {
          tableHtml += `<td>${this.escapeHtml(cell.trim())}</td>`;
        });
        tableHtml += '</tr>';
      });
      tableHtml += '</tbody></table>';
      html = html.replace(ph, tableHtml);
    });

    // 🔧 还原无序列表
    ulLists.forEach((list, idx) => {
      const ph = `__ULLIST_${idx}__`;
      const items = list.trim().split(/\r?\n/).filter(r => r.trim()).map(r => {
        const match = r.match(/^\s*[-*]\s+(.+)$/);
        return match ? match[1] : r.trim();
      });
      if (items.length === 0) { html = html.replace(ph, ''); return; }
      const listHtml = '<ul class="adp-list">' + items.map(item => `<li>${this.escapeHtml(item)}</li>`).join('') + '</ul>';
      html = html.replace(ph, listHtml);
    });

    // 🔧 还原有序列表
    olLists.forEach((list, idx) => {
      const ph = `__OLLIST_${idx}__`;
      const items = list.trim().split(/\r?\n/).filter(r => r.trim()).map(r => {
        const match = r.match(/^\s*\d+\.\s+(.+)$/);
        return match ? match[1] : r.trim();
      });
      if (items.length === 0) { html = html.replace(ph, ''); return; }
      const listHtml = '<ol class="adp-list">' + items.map(item => `<li>${this.escapeHtml(item)}</li>`).join('') + '</ol>';
      html = html.replace(ph, listHtml);
    });

    // Markdown 基础格式
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const langLower = lang.toLowerCase();
      const isHtml = langLower === 'html' || langLower === 'htm';
      const isDocument = isHtml || ['json', 'xml', 'svg', 'css', 'md', 'markdown'].includes(langLower);
      const artifactBtns = isDocument
        ? `<div class="agent-artifact-btns"><button class="agent-save-artifact-btn" data-action="save-artifact" data-lang="${this.escapeHtml(lang)}" data-filename="" title="保存到 Agent 产物">💾 保存</button><button class="agent-open-artifact-btn" data-action="open-artifact" data-lang="${this.escapeHtml(lang)}" title="在浏览器中打开" style="display:none;">↗ 打开</button></div>`
        : '';
      // 输出 language-xxx 类名，便于代码高亮和 CC 代码块识别
      const langClass = lang ? ` class="language-${langLower}"` : '';
      return `<pre><code${langClass}>${code.trim()}</code></pre>${artifactBtns}`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p><br><\/p>/g, '');

    // 思考过程
    if (thinkingText && thinkingText.trim()) html = this._renderADPThinking(thinkingText) + html;

    // v3.1.2: 检测 cc-workspace 文件名并转为可点击链接
    html = this._linkifyCCWorkspaceFiles(html);

    return html;
  },

  /**
   * v3.1.2: 检测 AI 回复中的文件名，关联 cc-workspace 路径，转为可点击链接
   * 检测模式：
   * 1. "文件位置：xxx.ext" / "文件: xxx.ext" / "已保存到 xxx.ext"
   * 2. 反引号包裹的文件名 `xxx.ext`
   * 3. 行末独立文件名 xxx.ext
   */
  _linkifyCCWorkspaceFiles(html) {
    // 获取 cc-workspace 路径
    const ccWorkdir = this._getCCWorkdir() || this._ccDefaultWorkdir || '';
    if (!ccWorkdir) return html;

    // 已知文件扩展名
    const extPattern = '(?:html?|md|json|csv|xlsx?|docx?|pptx?|pdf|png|jpe?g|gif|svg|txt|py|js|ts|css|sql|sh|yaml|yml|xml|toml|conf)';
    const icons = { md: '📝', html: '🌐', htm: '🌐', pdf: '📖', xlsx: '📊', xls: '📊', docx: '📝', doc: '📝', pptx: '📊', csv: '📋', json: '📋', png: '🖼', jpg: '🖼', jpeg: '🖼', svg: '🖼', txt: '📄', py: '🐍', js: '📜', ts: '📜', css: '🎨', sql: '🗄', sh: '⚙️', yaml: '⚙️', yml: '⚙️' };

    // 跳过已在 .chat-file-link / .adp-file-card / <a> 标签内的文件名
    // 用正则匹配不在 HTML 标签属性中的文件名

    // 模式1: "文件位置：xxx.ext" / "文件: xxx.ext" / "已保存到 xxx.ext" / "已创建: xxx.ext"
    html = html.replace(new RegExp(
      `(文件位置[：:]\\s*|文件[：:]\\s*|已保存到\\s*|已创建[：:]?\\s*|File:\\s*)([\\w./-]+\\.${extPattern})`,
      'gi'
    ), (match, prefix, filename) => {
      // 避免重复处理（已有链接的跳过）
      if (filename.includes('</span>') || filename.includes('class=')) return match;
      const fullPath = ccWorkdir.replace(/\/$/, '') + '/' + filename.replace(/^\.\//, '');
      const ext = filename.split('.').pop()?.toLowerCase();
      const icon = icons[ext] || '📄';
      const escapedName = this.escapeHtml(filename);
      const escapedPath = this.escapeHtml(fullPath);
      return `${prefix}<span class="chat-file-link" data-filepath="${escapedPath}"><span class="chat-file-icon">${icon}</span>${escapedName}<span class="chat-file-actions"><button class="chat-file-action-btn" data-action="open">打开</button><button class="chat-file-action-btn" data-action="reveal">📁</button></span></span>`;
    });

    // 模式2: 反引号包裹的文件名 `xxx.ext`
    html = html.replace(new RegExp(
      `(?<!class="[^"]*)\`([\\w./-]+\\.${extPattern})\``,
      'gi'
    ), (match, filename) => {
      const fullPath = ccWorkdir.replace(/\/$/, '') + '/' + filename.replace(/^\.\//, '');
      const ext = filename.split('.').pop()?.toLowerCase();
      const icon = icons[ext] || '📄';
      const escapedName = this.escapeHtml(filename);
      const escapedPath = this.escapeHtml(fullPath);
      return `<span class="chat-file-link" data-filepath="${escapedPath}"><span class="chat-file-icon">${icon}</span>${escapedName}<span class="chat-file-actions"><button class="chat-file-action-btn" data-action="open">打开</button><button class="chat-file-action-btn" data-action="reveal">📁</button></span></span>`;
    });

    return html;
  },

  _renderADPThinking(text) {
    const trimmed = text.trim();
    const preview = trimmed.length > 80 ? trimmed.substring(0, 80) + '…' : trimmed;
    return `<div class="adp-thinking-section">
      <div class="adp-thinking-header">
        <span class="adp-thinking-icon">💭</span>
        <span class="adp-thinking-label">思考过程</span>
        <span class="adp-thinking-preview">${this.escapeHtml(preview)}</span>
        <span class="adp-thinking-toggle">▶</span>
      </div>
      <div class="adp-thinking-content">${this.escapeHtml(trimmed).replace(/\n/g, '<br>')}</div>
    </div>`;
  },

  _getADPToolIcon(toolName) {
    const icons = {
      get_feature_rates: '📊',
      get_brand_summary: '📋',
      render_chart: '📈',
      write: '📝',
      FileToURL: '🔗',
      search: '🔍',
      AskUserQuestion: '❓',
      ask_user_question: '❓',
      GenerateReport: '📄',
      generate_report: '📄',
      WebSearch: '🌐',
      web_search: '🌐',
      DocParse: '📖',
      doc_parse: '📖',
      default: '🔧'
    };
    return icons[toolName] || icons.default;
  },

  _getADPToolLabel(toolName) {
    const labels = {
      get_feature_rates: '查询标配率',
      get_brand_summary: '查询概览',
      render_chart: '渲染图表',
      write: '生成报告',
      FileToURL: '获取文件链接',
      search: '搜索数据',
      AskUserQuestion: '向用户提问',
      ask_user_question: '向用户提问',
      GenerateReport: '生成报告',
      generate_report: '生成报告',
      WebSearch: '联网搜索',
      web_search: '联网搜索',
      DocParse: '文档解析',
      doc_parse: '文档解析'
    };
    return labels[toolName] || `调用 ${toolName}`;
  },

  // ===== ADP 交互式技能组件（Widget）渲染 =====

  _isADPWidgetContent(text) {
    if (!text || typeof text !== 'string' || text.length < 20) return false;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch { return false; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const keys = Object.keys(parsed);
    const widgetKeywords = ['widget', 'form', 'skill', 'question', 'interactive', 'options', 'fields', 'actions', 'buttons', 'steps', 'choices'];
    const hasWidgetKeyword = widgetKeywords.some(kw => keys.some(k => k.toLowerCase().includes(kw)));
    const hasArrayChildren = ['options', 'fields', 'actions', 'buttons', 'steps', 'choices'].some(k => Array.isArray(parsed[k]) && parsed[k].length > 0);
    const hasType = parsed.type && ['widget', 'form', 'question', 'skill', 'interactive'].includes(String(parsed.type).toLowerCase());
    return !!(hasWidgetKeyword || hasArrayChildren || hasType);
  },

  _renderADPWidget(msgId, data, container) {
    const widgetEl = document.createElement('div');
    widgetEl.className = 'adp-widget';
    widgetEl.dataset.msgId = msgId || '';

    // 标题
    const title = data.title || data.name || data.widget_title || data.skill_name || data.label || '';
    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'adp-widget-title';
      titleEl.textContent = title;
      widgetEl.appendChild(titleEl);
    }

    // 描述（支持 Markdown）
    const description = data.description || data.question || data.desc || data.prompt || data.text || '';
    if (description) {
      const descEl = document.createElement('div');
      descEl.className = 'adp-widget-description';
      descEl.innerHTML = this._renderADPMarkdown(description, '');
      widgetEl.appendChild(descEl);
    }

    // 步骤（支持多步骤）
    const steps = data.steps || data.fields || [];
    if (steps.length > 0) {
      steps.forEach((step, stepIdx) => {
        const stepEl = document.createElement('div');
        stepEl.className = 'adp-widget-step';

        const stepTitle = step.title || step.name || step.label || `步骤 ${stepIdx + 1}`;
        const stepDesc = step.description || step.question || step.desc || step.prompt || step.text || '';
        const stepOptions = step.options || step.choices || step.fields || [];

        if (stepTitle) {
          const stEl = document.createElement('div');
          stEl.className = 'adp-widget-step-title';
          stEl.textContent = stepTitle;
          stepEl.appendChild(stEl);
        }
        if (stepDesc) {
          const sdEl = document.createElement('div');
          sdEl.className = 'adp-widget-step-desc';
          sdEl.innerHTML = this._renderADPMarkdown(stepDesc, '');
          stepEl.appendChild(sdEl);
        }

        // 选项渲染
        if (stepOptions.length > 0) {
          const optsEl = document.createElement('div');
          optsEl.className = 'adp-widget-options';
          stepOptions.forEach((opt, optIdx) => {
            const label = opt.label || opt.text || opt.name || opt.title || String(optIdx + 1);
            const value = opt.value || opt.id || String(optIdx);
            const desc = opt.description || opt.desc || opt.detail || opt.subtitle || '';
            const inputType = step.type === 'checkbox' || step.multi_select || data.type === 'checkbox' || data.multi_select ? 'checkbox' : 'radio';
            const inputName = `adp-widget-${msgId}-${stepIdx}`;

            const optEl = document.createElement('label');
            optEl.className = 'adp-widget-option';
            optEl.innerHTML = `
              <input type="${inputType}" name="${inputName}" value="${this.escapeHtml(value)}" data-label="${this.escapeHtml(label)}">
              <div class="adp-widget-option-content">
                <div class="adp-widget-option-label">${this.escapeHtml(label)}</div>
                ${desc ? `<div class="adp-widget-option-desc">${this.escapeHtml(desc)}</div>` : ''}
              </div>
            `;
            optsEl.appendChild(optEl);
          });
          stepEl.appendChild(optsEl);
        }
        widgetEl.appendChild(stepEl);
      });
    } else {
      // 直接 options（没有 steps 包装）
      const options = data.options || data.choices || [];
      if (options.length > 0) {
        const optsEl = document.createElement('div');
        optsEl.className = 'adp-widget-options';
        options.forEach((opt, optIdx) => {
          const label = opt.label || opt.text || opt.name || opt.title || String(optIdx + 1);
          const value = opt.value || opt.id || String(optIdx);
          const desc = opt.description || opt.desc || opt.detail || opt.subtitle || '';
          const inputType = data.type === 'checkbox' || data.multi_select ? 'checkbox' : 'radio';
          const inputName = `adp-widget-${msgId}`;

          const optEl = document.createElement('label');
          optEl.className = 'adp-widget-option';
          optEl.innerHTML = `
            <input type="${inputType}" name="${inputName}" value="${this.escapeHtml(value)}" data-label="${this.escapeHtml(label)}">
            <div class="adp-widget-option-content">
              <div class="adp-widget-option-label">${this.escapeHtml(label)}</div>
              ${desc ? `<div class="adp-widget-option-desc">${this.escapeHtml(desc)}</div>` : ''}
            </div>
          `;
          optsEl.appendChild(optEl);
        });
        widgetEl.appendChild(optsEl);
      }
    }

    // 按钮
    const actions = data.actions || data.buttons || [];
    if (actions.length > 0) {
      const actionsEl = document.createElement('div');
      actionsEl.className = 'adp-widget-actions';
      actions.forEach(action => {
        const btn = document.createElement('button');
        const actType = (action.type || action.action || 'default').toLowerCase();
        const isPrimary = actType === 'primary' || actType === 'submit' || actType === 'confirm';
        btn.className = 'adp-widget-btn' + (isPrimary ? ' primary' : ' secondary');
        btn.textContent = action.label || action.text || action.name || '按钮';
        btn.dataset.actionType = actType;
        btn.addEventListener('click', () => {
          const inputs = widgetEl.querySelectorAll(`input[type="radio"]:checked, input[type="checkbox"]:checked`);
          const selectedValues = Array.from(inputs).map(i => i.value);
          const selectedLabels = Array.from(inputs).map(i => i.dataset.label || i.value);
          this._handleADPWidgetAction(msgId, actType, selectedValues, selectedLabels, data);
        });
        actionsEl.appendChild(btn);
      });
      widgetEl.appendChild(actionsEl);
    }

    container.appendChild(widgetEl);
  },

  _handleADPWidgetAction(msgId, actionType, values, labels, widgetData) {
    let message = '';
    if (actionType === 'skip' || actionType === 'cancel' || actionType === 'pass') {
      message = '跳过';
    } else if (values.length === 0) {
      message = '提交';
    } else if (values.length === 1) {
      message = labels[0] || values[0];
    } else {
      message = labels.join('，') || values.join('，');
    }

    // 设置输入框并发送
    const input = document.getElementById('aiChatInput');
    if (input) {
      input.value = message;
      input.style.height = 'auto';
    }
    this.sendAIMessage();

    // 禁用 widget 交互
    const widgetEl = document.querySelector(`.adp-widget[data-msg-id="${msgId}"]`);
    if (widgetEl) {
      widgetEl.querySelectorAll('.adp-widget-btn').forEach(btn => btn.disabled = true);
      widgetEl.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(inp => inp.disabled = true);
      widgetEl.classList.add('adp-widget-completed');
    }
  },

  handleChatFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    // 限制文件数量和大小：多文件单个≤20MB最多5个，单文件最大≤100MB
    const maxFiles = 5;
    const isSingleFile = (this._chatAttachments.length + files.length) <= 1;
    const maxFileSize = isSingleFile ? 100 * 1024 * 1024 : 20 * 1024 * 1024; // 单文件100MB，多文件20MB
    const maxFileSizeLabel = isSingleFile ? '100MB' : '20MB';
    
    if (this._chatAttachments.length + files.length > maxFiles) {
      alert(`最多上传 ${maxFiles} 个文件`);
      e.target.value = '';
      return;
    }
    
    for (const file of files) {
      // 判断当前总附件数决定单文件限制
      const currentIsSingle = (this._chatAttachments.length + 1) <= 1 && files.length === 1;
      const currentMaxSize = currentIsSingle ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
      const currentMaxLabel = currentIsSingle ? '100MB' : '20MB';
      if (file.size > currentMaxSize) {
        alert(`文件 ${file.name} 超过 ${currentMaxLabel} 限制`);
        continue;
      }
      
      const fileType = this.getFileType(file.name, file.type);
      this._chatAttachments.push({
        name: file.name,
        size: file.size,
        mimeType: file.type,
        type: fileType,
        file: file // 保留 File 对象，发送时读取
      });
      // 将文件路径引用插入输入框（显示为文件名，发送时替换为完整路径）
      this._insertFileRefIntoInput(file.name, file.path || '');
    }
    
    this.renderChatAttachments();
    e.target.value = ''; // 重置 input 以便重复选择同一文件
  },

  handleChatPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const maxFiles = 5;
    let hasFiles = false;
    for (const item of items) {
      if (item.kind === 'file') {
        hasFiles = true;
        const file = item.getAsFile();
        if (!file) continue;
        if (this._chatAttachments.length >= maxFiles) {
          this.showToast(`最多上传 ${maxFiles} 个文件`, 'error');
          break;
        }
        const maxSize = 20 * 1024 * 1024; // 粘贴文件 20MB 限制
        if (file.size > maxSize) {
          this.showToast(`文件 ${file.name || '粘贴内容'} 超过 20MB 限制`, 'error');
          continue;
        }
        // 粘贴的图片可能没有文件名
        const name = file.name || `粘贴图片_${new Date().toLocaleTimeString('zh-CN').replace(/:/g, '-')}.${file.type.split('/')[1] || 'png'}`;
        const fileType = this.getFileType(name, file.type);
        this._chatAttachments.push({
          name: name,
          size: file.size,
          mimeType: file.type,
          type: fileType,
          file: file
        });
        // 将文件路径引用插入输入框（显示为文件名，发送时替换为完整路径）
        this._insertFileRefIntoInput(name, file.path || '');
      }
    }
    if (hasFiles) {
      e.preventDefault(); // 阻止粘贴文件名到输入框
      this.renderChatAttachments();
      this.showToast('已添加粘贴的文件', 'success');
    }
  },

  getFileType(filename, mimeType) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    mimeType = mimeType || '';
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif'];
    const textExts = ['txt', 'md', 'markdown', 'csv', 'log', 'json', 'yaml', 'yml'];
    // 🔧 各类文档（Word/PPT/Excel 等）走文档解析流程
    const docExts = ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'rtf', 'wps', 'et', 'dps'];

    // 🔧 关键修复：已知扩展名优先于 mimeType 判定。
    // 否则当浏览器给出空或异常 mimeType 时，Word/Excel 等文档可能被错误当成图片处理。
    if (ext === 'pdf') return 'pdf';
    if (docExts.includes(ext)) return 'binary';      // 文档：走 COS 上传 + docParse 解析
    if (textExts.includes(ext)) return 'text';       // 纯文本：直接注入内容
    if (imageExts.includes(ext) || mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('text/')) return 'text';
    return 'binary';
  },

  getFileIcon(type, filename) {
    const ext = filename ? filename.split('.').pop().toLowerCase() : '';
    switch (type) {
      case 'image': return '🖼️';
      case 'text': return '📝';
      case 'pdf': return '📄';
      default:
        if (['doc', 'docx'].includes(ext)) return '📃';
        if (['xls', 'xlsx'].includes(ext)) return '📊';
        if (['ppt', 'pptx'].includes(ext)) return '📽️';
        if (['zip', 'rar'].includes(ext)) return '🗜️';
        return '📎';
    }
  },

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  renderChatAttachments() {
    const container = document.getElementById('chatAttachments');
    if (!container) return;
    
    if (this._chatAttachments.length === 0) {
      container.innerHTML = '';
      return;
    }
    
    container.innerHTML = this._chatAttachments.map((att, idx) => {
      const icon = this.getFileIcon(att.type, att.name);
      return `<div class="attachment-chip" data-idx="${idx}">
        <span class="attachment-icon">${icon}</span>
        <span class="attachment-name" data-idx="${idx}" title="${this.escapeHtml(att.name)}">${this.escapeHtml(att.name)}</span>
        <span class="attachment-size">${this.formatFileSize(att.size)}</span>
        <button class="attachment-remove" data-idx="${idx}" title="移除">&times;</button>
      </div>`;
    }).join('');
    // 事件委托已在 bindEvents() 中绑定
  },

  downloadAttachment(att) {
    try {
      let blob;
      if (att.file) {
        blob = att.file;
      } else if (typeof att.content === 'string') {
        blob = new Blob([att.content], { type: att.mimeType || 'text/plain' });
      } else {
        this.showToast('该附件无法下载', 'warning');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.name || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[App] downloadAttachment error:', err);
      this.showToast('下载失败', 'error');
    }
  },

  clearChatAttachments() {
    this._chatAttachments = [];
    this._chatFileRefs = {};
    this.renderChatAttachments();
  },

  /**
   * 将文件路径引用插入到输入框中
   * 显示为 📎文件名 格式，发送时替换为完整路径
   */
  _insertFileRefIntoInput(fileName, filePath) {
    if (!filePath) return;
    const input = document.getElementById('aiChatInput');
    if (!input) return;
    const refKey = `📎${fileName}`;
    // 存储映射
    this._chatFileRefs[refKey] = filePath;
    // 在当前光标位置插入引用
    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    const before = input.value.substring(0, start);
    const after = input.value.substring(end);
    // 如果前面有内容且不以空格/换行结尾，添加空格
    const prefix = (before && !/\s$/.test(before)) ? ' ' : '';
    const insertText = `${prefix}${refKey} `;
    input.value = before + insertText + after;
    // 调整光标位置
    const newCursorPos = start + insertText.length;
    input.setSelectionRange(newCursorPos, newCursorPos);
    // 触发 auto-resize
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    input.focus();
  },

  /**
   * 解析消息中的文件引用，将 📎文件名 替换为完整路径
   */
  _resolveFileRefs(message) {
    let resolved = message;
    for (const [refKey, filePath] of Object.entries(this._chatFileRefs)) {
      // 转义正则特殊字符
      const escapedKey = refKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      resolved = resolved.replace(new RegExp(escapedKey, 'g'), filePath);
    }
    return resolved;
  },

  /**
   * 构建默认上下文信息（当前时间 + 用户画像）
   * 注入到发送给 AI 的消息中，不影响 UI 显示
   */
  async _buildDefaultContext() {
    const parts = [];
    // 当前时间
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', { hour12: false });
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    parts.push(`当前时间: ${timeStr} 星期${weekday}`);

    // 用户画像
    try {
      const profile = await window.electronAPI?.profile?.get?.();
      if (profile) {
        const userInfo = profile.user || {};
        const profileParts = [];
        if (userInfo.name) profileParts.push(`姓名: ${userInfo.name}`);
        if (userInfo.nickname) profileParts.push(`昵称: ${userInfo.nickname}`);
        if (userInfo.profession) profileParts.push(`职业: ${userInfo.profession}`);
        if (userInfo.organization) profileParts.push(`组织: ${userInfo.organization}`);
        if (userInfo.industry) profileParts.push(`行业: ${userInfo.industry}`);
        if (userInfo.region) profileParts.push(`地区: ${userInfo.region}`);
        // 活跃项目
        const projects = profile.active_projects?.filter(p => p.status === 'active') || [];
        if (projects.length > 0) {
          profileParts.push(`活跃项目: ${projects.map(p => p.name).join(', ')}`);
        }
        // 高频人物
        const persons = (profile.frequent_persons || []).slice(0, 5);
        if (persons.length > 0) {
          profileParts.push(`高频联系人: ${persons.map(p => p.name).join(', ')}`);
        }
        if (profileParts.length > 0) {
          parts.push(`用户画像: ${profileParts.join(' | ')}`);
        }
      }
    } catch (e) { /* ignore */ }

    if (parts.length === 0) return '';
    return `[上下文信息]\n${parts.join('\n')}\n`;
  },

  /**
   * 根据时间段过滤日期
   */
  _filterByTimeRange(items, timeRange, dateField = 'createdAt') {
    if (!timeRange || timeRange === 'all') return items;
    const now = new Date();
    const ranges = {
      today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      yesterday: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
      tomorrow: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
      this_week: new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()),
      last_week: new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7),
      '7d': new Date(now.getTime() - 7 * 86400000),
      '30d': new Date(now.getTime() - 30 * 86400000),
      last_month: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      '90d': new Date(now.getTime() - 90 * 86400000),
    };
    const threshold = ranges[timeRange];
    if (!threshold) return items;
    return items.filter(item => {
      const d = new Date(item[dateField] || item.created_at || item.updatedAt || item.dueDate || 0);
      return d >= threshold;
    });
  },

  /**
   * Phase 2+3: 根据 LLM 分类结果检索本地数据并组装 SystemRole
   */
  async _retrieveLocalContext(classification) {
    const sources = [];
    const parts = [];
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', { hour12: false });
    parts.push(`当前时间: ${timeStr}`);

    const tasks = [];

    // 1. 用户画像
    if (classification.need_profile !== false) {
      tasks.push((async () => {
        try {
          const profile = await window.electronAPI?.profile?.get?.();
          if (profile) {
            const userInfo = profile.user || {};
            const profileParts = [];
            if (userInfo.name) profileParts.push(`姓名: ${userInfo.name}`);
            if (userInfo.profession) profileParts.push(`职业: ${userInfo.profession}`);
            if (userInfo.organization) profileParts.push(`组织: ${userInfo.organization}`);
            if (userInfo.industry) profileParts.push(`行业: ${userInfo.industry}`);
            const projects = profile.active_projects?.filter(p => p.status === 'active') || [];
            if (projects.length > 0) profileParts.push(`活跃项目: ${projects.map(p => p.name).join(', ')}`);
            const persons = (profile.frequent_persons || []).slice(0, 5);
            if (persons.length > 0) profileParts.push(`高频联系人: ${persons.map(p => p.name).join(', ')}`);
            if (profileParts.length > 0) {
              parts.push(`[用户画像]\n${profileParts.join('\n')}`);
              sources.push('画像');
            }
          }
        } catch (e) { /* ignore */ }
      })());
    }

    // 2. 待办任务
    if (classification.need_tasks) {
      tasks.push((async () => {
        try {
          const allTasks = await window.electronAPI?.dbGetTasks?.() || [];
          let filtered = allTasks;
          const taskFilter = classification.task_filter || 'pending';
          if (taskFilter === 'pending') {
            filtered = allTasks.filter(t => t.status !== 'completed' && !t.completedAt);
          } else if (taskFilter === 'completed') {
            filtered = allTasks.filter(t => t.status === 'completed' || t.completedAt);
          } else if (taskFilter === 'overdue') {
            const now = new Date();
            filtered = allTasks.filter(t => (t.status !== 'completed' && !t.completedAt) && t.dueDate && new Date(t.dueDate) < now);
          }
          // 时间范围过滤
          if (classification.task_time_range && classification.task_time_range !== 'all') {
            filtered = this._filterByTimeRange(filtered, classification.task_time_range, 'dueDate');
          }
          filtered = filtered.slice(0, 10);
          if (filtered.length > 0) {
            const taskLines = filtered.map(t => {
              const isDone = t.status === 'completed' || t.completedAt;
              const status = isDone ? '✅' : (t.dueDate && new Date(t.dueDate) < new Date() ? '🔴逾期' : '⬜');
              const due = t.dueDate ? ` (截止: ${new Date(t.dueDate).toLocaleDateString('zh-CN')})` : '';
              const priority = t.priority === 'high' ? '🔴' : (t.priority === 'low' ? '🟢' : '🟡');
              return `${status} ${priority} ${t.title}${due}`;
            });
            parts.push(`[待办任务]\n${taskLines.join('\n')}`);
            sources.push(`任务×${filtered.length}`);
          }
        } catch (e) { /* ignore */ }
      })());
    }

    // 3. 记事本
    if (classification.need_notebook) {
      tasks.push((async () => {
        try {
          const query = classification.notebook_query || '';
          const result = query
            ? await window.electronAPI?.notebookSearch?.(query)
            : await window.electronAPI?.notebookGetNotes?.();
          let notes = result?.notes || [];
          if (classification.notebook_time_range && classification.notebook_time_range !== 'all') {
            notes = this._filterByTimeRange(notes, classification.notebook_time_range, 'createdAt');
          }
          notes = notes.slice(0, 5);
          if (notes.length > 0) {
            const noteLines = notes.map(n => {
              const date = n.createdAt ? new Date(n.createdAt).toLocaleDateString('zh-CN') : '';
              const content = (n.content || '').substring(0, 500);
              return `📅 ${date} | ${n.title || '无标题'}\n${content}`;
            });
            parts.push(`[记事本]\n${noteLines.join('\n---\n')}`);
            sources.push(`记事本×${notes.length}`);
          }
        } catch (e) { /* ignore */ }
      })());
    }

    // 4. 记忆
    if (classification.need_memory) {
      tasks.push((async () => {
        try {
          const query = classification.memory_query || '';
          // getMemories 不支持搜索，取最近记忆后本地过滤
          const memResult = await window.electronAPI?.getMemories?.({ limit: 20 });
          let memories = memResult?.memories || [];
          if (query) {
            const lowerQ = query.toLowerCase();
            memories = memories.filter(m => m.content?.toLowerCase().includes(lowerQ));
          }
          if (classification.memory_time_range && classification.memory_time_range !== 'all') {
            memories = this._filterByTimeRange(memories, classification.memory_time_range, 'createdAt');
          }
          memories = memories.slice(0, 5);
          if (memories.length > 0) {
            const memLines = memories.map(m => {
              const cat = m.category ? `[${m.category}]` : '';
              const content = (m.content || '').substring(0, 300);
              return `${cat} ${content}`;
            });
            parts.push(`[用户记忆]\n${memLines.join('\n')}`);
            sources.push(`记忆×${memories.length}`);
          }
        } catch (e) { /* ignore */ }
      })());
    }

    // 5. 知识文章
    if (classification.need_knowledge) {
      tasks.push((async () => {
        try {
          const query = classification.knowledge_query || '';
          const limit = classification.knowledge_limit || 3;
          if (query) {
            const result = await window.electronAPI?.knowledgeSearchLocal?.({ query, limit });
            const items = result?.results || [];
            if (items.length > 0) {
              const kLines = items.map(k => {
                const content = (k.content || k.summary || '').substring(0, 300);
                return `${k.title || '无标题'} (${k.type || '知识'})\n${content}`;
              });
              parts.push(`[相关知识]\n${kLines.join('\n---\n')}`);
              sources.push(`知识×${items.length}`);
            }
          }
        } catch (e) { /* ignore */ }
      })());
    }

    // 6. 人脉
    if (classification.need_relationship) {
      tasks.push((async () => {
        try {
          const relData = await window.electronAPI?.relationshipGetAll?.() || {};
          let persons = relData.persons || [];
          const names = classification.relationship_person_names || [];
          if (names.length > 0) {
            persons = persons.filter(r => names.some(n => r.name?.includes(n)));
          }
          persons = persons.slice(0, 3);
          if (persons.length > 0) {
            const rLines = persons.map(r => {
              const p = [r.name];
              if (r.company) p.push(`公司: ${r.company}`);
              if (r.relation) p.push(`关系: ${r.relation}`);
              return p.join(' | ');
            });
            parts.push(`[人脉信息]\n${rLines.join('\n')}`);
            sources.push(`人脉×${persons.length}`);
          }
        } catch (e) { /* ignore */ }
      })());
    }

    await Promise.all(tasks);

    const systemRole = parts.length > 1
      ? `[本地上下文]\n${parts.join('\n\n')}\n\n请基于以上用户上下文回答问题。如果上下文中没有相关信息，请如实说明。`
      : '';

    return { systemRole, sources };
  },

  /**
   * 兜底策略：LLM 分类失败时，带 profile + 最近待办
   */
  async _retrieveLocalContextFallback() {
    const sources = [];
    const parts = [];
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', { hour12: false });
    parts.push(`当前时间: ${timeStr}`);

    try {
      const profile = await window.electronAPI?.profile?.get?.();
      if (profile) {
        const userInfo = profile.user || {};
        const profileParts = [];
        if (userInfo.name) profileParts.push(`姓名: ${userInfo.name}`);
        if (userInfo.profession) profileParts.push(`职业: ${userInfo.profession}`);
        if (userInfo.organization) profileParts.push(`组织: ${userInfo.organization}`);
        const projects = profile.active_projects?.filter(p => p.status === 'active') || [];
        if (projects.length > 0) profileParts.push(`活跃项目: ${projects.map(p => p.name).join(', ')}`);
        if (profileParts.length > 0) {
          parts.push(`[用户画像]\n${profileParts.join('\n')}`);
          sources.push('画像');
        }
      }
    } catch (e) { /* ignore */ }

    try {
      const allTasks = await window.electronAPI?.dbGetTasks?.() || [];
      const pending = allTasks.filter(t => t.status !== 'completed' && !t.completedAt).slice(0, 5);
      if (pending.length > 0) {
        const taskLines = pending.map(t => {
          const due = t.dueDate ? ` (截止: ${new Date(t.dueDate).toLocaleDateString('zh-CN')})` : '';
          return `⬜ ${t.title}${due}`;
        });
        parts.push(`[待办任务]\n${taskLines.join('\n')}`);
        sources.push(`任务×${pending.length}`);
      }
    } catch (e) { /* ignore */ }

    const systemRole = parts.length > 1
      ? `[本地上下文]\n${parts.join('\n\n')}\n\n请基于以上用户上下文回答问题。如果上下文中没有相关信息，请如实说明。`
      : '';

    return { systemRole, sources };
  },

  async buildAttachmentData(attachments) {
    const result = [];
    for (const att of attachments) {
      const data = {
        name: att.name,
        size: att.size,
        mimeType: att.mimeType,
        type: att.type
      };
      
      try {
        if (att.type === 'image') {
          // 图片转 base64
          const arrayBuffer = await att.file.arrayBuffer();
          const uint8 = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < uint8.length; i++) {
            binary += String.fromCharCode(uint8[i]);
          }
          data.base64 = btoa(binary);
        } else {
          // 非图片文件：读取 ArrayBuffer 并转为普通数组供 IPC 传输
          // 注意：Electron contextBridge + IPC 双重序列化可能导致 ArrayBuffer 丢失
          // 必须转为普通数组（Structured Clone 完全支持），主进程再转回 Buffer
          const arrayBuffer = await att.file.arrayBuffer();
          data.buffer = Array.from(new Uint8Array(arrayBuffer));

          // 文本文件：同时读取文本内容作为 fallback
          if (att.type === 'text') {
            data.textContent = await att.file.text();
          } else if (att.type === 'pdf' || att.type === 'binary') {
            // PDF 和其他文档：尝试读取文本内容
            try {
              data.textContent = await att.file.text();
              // 如果提取的文本几乎都是乱码（非可打印字符占比高），则丢弃
              if (data.textContent) {
                const printableRatio = (data.textContent.replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '').length) / data.textContent.length;
                if (printableRatio < 0.3) {
                  console.log('[Chat] File text mostly non-printable, discarding:', att.name);
                  delete data.textContent;
                }
              }
            } catch (e) {
              // 忽略读取失败
            }
          }
        }
      } catch (err) {
        console.error('[Chat] Failed to read file:', att.name, err);
      }
      
      result.push(data);
    }
    return result;
  },

  // 渲染 Agent 结果为 HTML
  renderAgentResult(result, agentType) {
    switch (agentType) {
      case 'priority': return this.renderPriorityResult(result);
      case 'knowledge': return this.renderKnowledgeResult(result);
      case 'memory': return this.renderMemoryResult(result);
      case 'report': return this.renderReportResult(result);
      case 'chat': {
        // LLM 聊天模式：支持 markdown 格式渲染
        const text = result.text || result.content || JSON.stringify(result, null, 2);
        return `<div class="chat-markdown-content">${this._renderADPMarkdown(text, '')}</div>`;
      }
      default: return `<p>${this.escapeHtml(result.text || JSON.stringify(result, null, 2))}</p>`;
    }
  },

  renderPriorityResult(result) {
    let html = '';
    if (result.highlight) {
      html += `<div class="agent-highlight">${this.escapeHtml(result.highlight)}</div>`;
    }
    if (result.today_top5?.length) {
      html += '<div class="agent-task-list"><h4>🎯 今日 Top 5</h4>';
      result.today_top5.forEach((item, i) => {
        html += `<div class="agent-task-card" data-action="create-task" data-title="${this.escapeHtml(item.reason || '')}" data-schedule="${this.escapeHtml(item.scheduled_at || '')}">
          <span class="task-rank">${i + 1}</span>
          <div class="task-info">
            <div class="task-title">${this.escapeHtml(item.reason || item.task_id || '')}</div>
            <div class="task-meta">${this.escapeHtml(item.scheduled_at || '')}</div>
          </div>
          <span class="create-task-icon">➕</span>
        </div>`;
      });
      html += '</div>';
    }
    if (result.deferred?.length) {
      html += `<div class="agent-tips"><h4>⏸ 可延后</h4><ul>${result.deferred.map(d => `<li>${this.escapeHtml(typeof d === 'string' ? d : d.task_id || JSON.stringify(d))}</li>`).join('')}</ul></div>`;
    }
    if (result.tips?.length) {
      html += `<div class="agent-tips"><h4>💡 提示</h4><ul>${result.tips.map(t => `<li>${this.escapeHtml(t)}</li>`).join('')}</ul></div>`;
    }
    // 可操作按钮
    html += `<div class="agent-actions">
      <button class="agent-action-btn primary" data-action="create-all-tasks">📋 一键创建排程任务</button>
      <button class="agent-action-btn" data-action="copy-result">📋 复制结果</button>
    </div>`;
    return html || `<p>${this.escapeHtml(JSON.stringify(result, null, 2))}</p>`;
  },

  renderKnowledgeResult(result) {
    let html = '';
    if (result.clusters?.length) {
      html += '<div class="agent-clusters"><h4>📂 知识聚类</h4>';
      result.clusters.forEach(c => {
        html += `<div class="cluster-item"><strong>${this.escapeHtml(c.theme)}</strong><p>${this.escapeHtml(c.summary || '')}</p></div>`;
      });
      html += '</div>';
    }
    if (result.duplicates?.length) {
      html += `<div class="agent-insights"><h4>🔄 重复笔记</h4><ul>${result.duplicates.map(d => `<li>笔记 ${d.indices?.join(' 和 ')} 可能重复：${this.escapeHtml(d.reason || '')}</li>`).join('')}</ul></div>`;
    }
    if (result.insights?.length) {
      html += `<div class="agent-insights"><h4>💡 洞察</h4><ul>${result.insights.map(i => `<li>${this.escapeHtml(i)}</li>`).join('')}</ul></div>`;
    }
    if (result.actions?.length) {
      html += '<div class="agent-actions"><h4 style="width:100%">🎬 建议操作</h4>';
      result.actions.forEach(a => {
        const typeIcon = { merge: '🔄', tag: '🏷️', create_task: '➕', save_memory: '🧠' }[a.type] || '📌';
        html += `<button class="agent-action-btn" data-action="agent-action" data-type="${a.type}" data-detail="${this.escapeHtml(a.description)}">${typeIcon} ${this.escapeHtml(a.description)}</button>`;
      });
      html += '</div>';
    }
    return html || `<p>${this.escapeHtml(JSON.stringify(result, null, 2))}</p>`;
  },

  renderMemoryResult(result) {
    let html = '';
    if (result.promote?.length) {
      html += '<div class="agent-promote"><h4>⬆️ 建议晋升</h4>';
      result.promote.forEach(p => {
        html += `<div class="promote-item">${this.escapeHtml(p.from || '?')} → ${this.escapeHtml(p.to || '?')}：${this.escapeHtml(p.reason || '')}</div>`;
      });
      html += '</div>';
    }
    if (result.demote?.length) {
      html += '<div class="agent-promote"><h4>⬇️ 建议降级</h4>';
      result.demote.forEach(p => {
        html += `<div class="promote-item">${this.escapeHtml(p.from || '?')} → ${this.escapeHtml(p.to || '?')}：${this.escapeHtml(p.reason || '')}</div>`;
      });
      html += '</div>';
    }
    if (result.expire?.length) {
      html += '<div class="agent-promote"><h4>🗑️ 建议淘汰</h4>';
      result.expire.forEach(p => {
        html += `<div class="promote-item" style="color: var(--text-secondary);">${this.escapeHtml(p.reason || '')}</div>`;
      });
      html += '</div>';
    }
    if (result.merge?.length) {
      html += '<div class="agent-promote"><h4>🔄 建议合并</h4>';
      result.merge.forEach(m => {
        html += `<div class="promote-item">记忆 ${m.source_indices?.join(' + ')}：${this.escapeHtml(m.reason || '')}</div>`;
      });
      html += '</div>';
    }
    if (result.insights?.length) {
      html += `<div class="agent-insights"><h4>💡 记忆洞察</h4><ul>${result.insights.map(i => `<li>${this.escapeHtml(i)}</li>`).join('')}</ul></div>`;
    }
    // 可操作按钮
    html += `<div class="agent-actions">
      <button class="agent-action-btn success" data-action="apply-memory-changes">✅ 应用变更</button>
      <button class="agent-action-btn" data-action="copy-result">📋 复制结果</button>
    </div>`;
    return html || `<p>${this.escapeHtml(JSON.stringify(result, null, 2))}</p>`;
  },

  renderReportResult(result) {
    let html = '';
    if (result.title) html += `<h3 class="report-title">${this.escapeHtml(result.title)}</h3>`;
    if (result.summary) html += `<div class="report-summary">${this.escapeHtml(result.summary)}</div>`;
    ['completed_section', 'pending_section', 'insights', 'tomorrow_plan'].forEach(key => {
      const section = result[key];
      if (section?.items?.length) {
        html += `<div class="report-section"><h4>${this.escapeHtml(section.title || key)}</h4><ul>${section.items.map(i => `<li>${this.escapeHtml(typeof i === 'string' ? i : JSON.stringify(i))}</li>`).join('')}</ul></div>`;
      }
    });
    if (result.highlight) html += `<div class="agent-highlight">${this.escapeHtml(result.highlight)}</div>`;
    // 可操作按钮
    html += `<div class="agent-actions">
      <button class="agent-action-btn primary" data-action="save-to-note">📝 保存为笔记</button>
      <button class="agent-action-btn" data-action="copy-result">📋 复制报告</button>
    </div>`;
    return html || `<p>${this.escapeHtml(JSON.stringify(result, null, 2))}</p>`;
  },

  clearChat() {
    // 改为创建新对话
    this.createNewChatSession();
  },

  // ============ 对话会话管理 ============

  _loadChatSessions() {
    try {
      const data = localStorage.getItem('memora_chat_sessions');
      if (data) {
        this._chatSessions = JSON.parse(data);
      }
      // 恢复上次激活的会话（用 localStorage 替代之前的 sessionStorage）
      const lastActiveId = localStorage.getItem('memora_active_session') ||
                           sessionStorage.getItem('memora_active_session');
      if (lastActiveId && this._chatSessions.find(s => s.id === lastActiveId)) {
        this._activeSessionId = lastActiveId;
        // 同步到主进程
        const session = this._chatSessions.find(s => s.id === lastActiveId);
        if (session?.conversationId) {
          window.electronAPI?.setADPConversationId?.(session.conversationId);
          console.log('[Chat] Restored active session', lastActiveId, 'with convId:', session.conversationId);
        }
      } else if (this._chatSessions.length > 0) {
        // 没有激活记录，默认选最近更新的会话（按 updatedAt 倒序取第一个）
        const sortedSessions = [...this._chatSessions].sort((a, b) =>
          new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
        );
        const latestSession = sortedSessions[0];
        this._activeSessionId = latestSession.id;
        if (latestSession.conversationId) {
          window.electronAPI?.setADPConversationId?.(latestSession.conversationId);
        }
      }
    } catch (e) {
      console.error('[Chat] Failed to load sessions:', e);
      this._chatSessions = [];
    }

    // 恢复活跃会话的消息到 DOM（初始化时必须调用，否则消息区域为空）
    if (this._activeSessionId) {
      this._restoreSessionMessages(this._activeSessionId);
      // 标记当前会话为选中状态
      this._renderChatSessionList();
    }
  },

  _saveChatSessions() {
    try {
      // 只保存元数据，不保存完整 HTML（太大）
      const toSave = this._chatSessions.map(s => ({
        id: s.id,
        title: s.title,
        messageCount: s.messageCount || 0,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt || s.createdAt,
        conversationId: s.conversationId || null, // 必须持久化 ADP 会话 ID 才能保持上下文
        _fromCloud: s._fromCloud || false,        // 来自云端的会话标记
        _revision: s._revision || 0,              // 云端同步 revision
        isGroupChat: s.isGroupChat || false,       // 群聊标记
        groupId: s.groupId || null,               // 专家团 ID
        groupName: s.groupName || null,           // 专家团名称
        taskType: s.taskType || 'chat',           // chat=对话, scheduled=定时任务, group=群聊
        expertId: s.expertId || null,             // 关联的专家 ID
        expertName: s.expertName || null,         // 关联的专家名称
        taskId: s.taskId || null,                 // 关联的定时任务 ID
      }));
      localStorage.setItem('memora_chat_sessions', JSON.stringify(toSave));
    } catch (e) {
      console.error('[Chat] Failed to save sessions:', e);
    }
  },

  _renderChatSessionList(keyword) {
    const listEl = document.getElementById('chatSessionList');
    if (!listEl) return;

    if (this._chatSessions.length === 0) {
      listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: 12px;">暂无对话</div>';
      return;
    }

    // 按更新时间倒序
    let sorted = [...this._chatSessions].sort((a, b) =>
      new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    );

    // 搜索过滤
    if (keyword && keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      const scored = sorted.map(session => {
        const title = (session.title || '新对话').toLowerCase();
        const titleMatch = title.includes(kw);
        // 标题匹配优先级更高：标题匹配=2分，内容匹配=1分
        let score = 0;
        if (titleMatch) score += 2;
        // 检查对话内容是否匹配
        const msgHtml = localStorage.getItem('memora_session_msg_' + session.id) || '';
        if (msgHtml.toLowerCase().includes(kw)) score += 1;
        return { session, score };
      }).filter(item => item.score > 0);
      // 按分数降序，同分按更新时间倒序
      scored.sort((a, b) => b.score - a.score || new Date(b.session.updatedAt || b.session.createdAt) - new Date(a.session.updatedAt || a.session.createdAt));
      sorted = scored.map(item => item.session);

      if (sorted.length === 0) {
        listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: 12px;">无匹配对话</div>';
        return;
      }
    }

    listEl.innerHTML = sorted.map(session => {
      // 根据类型选择图标和标签
      const taskType = session.taskType || (session.isGroupChat ? 'group' : 'chat');
      const agentTypes = session.agentTypes || []; // 并行任务的 Agent 类型列表
      let icon, badge;
      
      // Agent 类型图标映射
      const agentIconMap = {
        cc: '🤖',
        adp: '🤖',
        agent: '🤖',
        llm: '🤖',
      };
      
      switch (taskType) {
        case 'scheduled':
          icon = '⏰';
          badge = '<span class="chat-session-type-badge scheduled">定时</span>';
          break;
        case 'group':
          icon = '👥';
          badge = '<span class="chat-session-type-badge group">群聊</span>';
          break;
        case 'parallel':
          // 并行任务：显示多个 Agent 图标
          if (agentTypes.length > 0) {
            const agentIcons = agentTypes.slice(0, 3).map(mode => agentIconMap[mode] || '🤖').join(' ');
            icon = agentIcons;
            badge = `<span class="chat-session-type-badge parallel">并行 · ${agentTypes.length}</span>`;
          } else {
            icon = '⚡';
            badge = '<span class="chat-session-type-badge parallel">并行</span>';
          }
          break;
        default:
          // 检查是否有 Agent 类型信息
          if (agentTypes.length > 0) {
            const agentIcons = agentTypes.map(mode => agentIconMap[mode] || '🤖').join(' ');
            icon = agentIcons;
            badge = '';
          } else {
            icon = '💬';
            badge = '';
          }
      }
      return `
      <div class="chat-session-item${session.id === this._activeSessionId ? ' active' : ''}" data-session-id="${session.id}">
        <span class="chat-session-type-icon">${icon}</span>
        <span class="chat-session-title">${this.escapeHtml(session.title || '新对话')}</span>
        ${badge}
        <button class="chat-session-delete" data-session-id="${session.id}" title="删除对话">×</button>
      </div>
    `;
    }).join('');
  },

  createNewChatSession(parallelModes = null) {
    // 如果正在流式，先停止
    if (this._adpStreaming || this._ccStreaming || this._activeParallelTasks.size > 0) {
      this.stopADPGeneration();
    }

    // 保存当前对话消息
    this._saveCurrentSessionMessages();

    // 通知主进程重置 ConversationId
    window.electronAPI?.newADPChat?.();
    // 重置 CC 会话
    window.electronAPI?.ccNewSession?.();
    // 重置 OpenRouter 模型选择（新会话默认走 Coding Plan）
    const orSelect = document.getElementById('ccOpenRouterSelect');
    if (orSelect) orSelect.value = '';

    // 创建新会话
    const sessionId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const session = {
      id: sessionId,
      title: '新对话',
      messageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // 标记会话类型
      taskType: parallelModes ? 'parallel' : null,
      agentTypes: parallelModes || [], // 并行任务的 Agent 类型列表
    };

    this._chatSessions.unshift(session);
    this._activeSessionId = sessionId;
    this._saveChatSessions();
    this._renderChatSessionList();

    // 同步：推送新会话到云端
    this._syncPushConversation(session);

    // 清空聊天区域（保留功能卡片和快捷问题）
    const chatMessages = document.getElementById('chatMessages');
    const featureCards = chatMessages.querySelector('.feature-cards');
    const quickQuestions = chatMessages.querySelector('.quick-questions');

    chatMessages.innerHTML = '';

    if (featureCards) chatMessages.appendChild(featureCards);
    if (quickQuestions) chatMessages.appendChild(quickQuestions);

    chatMessages.insertAdjacentHTML('beforeend', `
      <div class="message assistant">
        <div class="message-avatar">${this._assistantAvatarSvg}</div>
        <div class="message-content">
          <p>你好！我是你的AI助手。有什么我可以帮助你的吗？</p>
          <span class="message-time assistant-time">${this._formatChatTime(new Date())}</span>
        </div>
      </div>
    `);

    this._initFeatureCards();
    // 持久化激活会话（localStorage 重启不丢）
    localStorage.setItem('memora_active_session', sessionId);
  },

  switchChatSession(sessionId) {
    if (sessionId === this._activeSessionId) return;

    // 如果正在流式，先停止
    if (this._adpStreaming || this._activeParallelTasks.size > 0) {
      this.stopADPGeneration();
    }

    // 保存当前对话消息
    this._saveCurrentSessionMessages();

    // 切换到目标会话
    this._activeSessionId = sessionId;
    // 更新该会话的 updatedAt，使其排到最前
    const targetSession = this._chatSessions.find(s => s.id === sessionId);
    if (targetSession) {
      targetSession.updatedAt = new Date().toISOString();
      this._saveChatSessions();
    }
    this._renderChatSessionList();
    localStorage.setItem('memora_active_session', sessionId);

    // CC 模式：更新工作目录指示器（每个会话可有不同 workdir）
    this._updateCCWorkdirBar();

    // 恢复目标会话的消息
    const session = this._chatSessions.find(s => s.id === sessionId);

    // 如果本地没有该会话的消息 HTML（来自云端的会话），从云端加载
    const hasLocalMessages = localStorage.getItem('memora_session_msg_' + sessionId);
    if (!hasLocalMessages && session?._fromCloud) {
      this._syncLoadCloudMessages(sessionId);
    } else {
      this._restoreSessionMessages(sessionId);
    }

    // 通知主进程切换到该会话的 ConversationId
    if (session && session.conversationId) {
      // 已有 convId：恢复到该会话
      window.electronAPI?.setADPConversationId?.(session.conversationId);
      console.log('[Chat] Switched to session', sessionId, 'with convId:', session.conversationId);
    } else {
      // 兜底：切到未发过消息的会话时，必须清空主进程，避免串台
      window.electronAPI?.setADPConversationId?.(null);
      console.log('[Chat] Switched to fresh session', sessionId, ', cleared main convId');
    }
  },

  deleteChatSession(sessionId) {
    const idx = this._chatSessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return;

    // 同步：云端软删除
    this._syncDeleteConversation(sessionId);

    // 删除 localStorage / sessionStorage 中保存的消息
    try { localStorage.removeItem('memora_session_msg_' + sessionId); } catch {}
    try { sessionStorage.removeItem('memora_session_msg_' + sessionId); } catch {}

    this._chatSessions.splice(idx, 1);
    this._saveChatSessions();

    // 如果删除的是当前会话，切换到其他会话或新建
    if (sessionId === this._activeSessionId) {
      if (this._chatSessions.length > 0) {
        this.switchChatSession(this._chatSessions[0].id);
      } else {
        this.createNewChatSession();
      }
    } else {
      this._renderChatSessionList();
    }
  },

  // v2.6: 退出群聊模式
  _exitGroupChatMode() {
    if (window.ExpertSystem) {
      window.ExpertSystem._activeGroupId = null;
      window.ExpertSystem._groupChatActive = false;
      window.ExpertSystem._groupChatPhase = 'idle';
      window.ExpertSystem._groupChatExecutingInBackground = false;
    }
    const chatHeader = document.getElementById('chatHeader');
    if (chatHeader) chatHeader.style.display = 'none';
    const exitBtn = document.getElementById('exitGroupChatBtn');
    if (exitBtn) exitBtn.style.display = 'none';
    const terminateBtn = document.getElementById('terminateGroupChatBtn');
    if (terminateBtn) terminateBtn.style.display = 'none';
    window.ExpertSystem?.hideBackgroundIndicator();
    // 🔧 修复：退出群聊时取消后台任务 + 清理监听
    if (this._activeBackgroundChatId) {
      window.electronAPI?.expertChatCancel?.({ chatId: this._activeBackgroundChatId });
      window.electronAPI?.removeExpertChatListeners?.();
      this._activeBackgroundChatId = null;
    }
    // 清理流式气泡映射
    this._expertBubbleMap?.clear();
    // 🔧 修复：重置 ADP ConversationId，避免下次普通对话串群聊上下文
    window.electronAPI?.newADPChat?.();
    // 恢复普通模式
    this._saveCurrentSessionMessages();
  },

  // 人类终止群聊任务（保留群聊模式，只终止当前执行）
  async _terminateGroupChat() {
    if (!this._activeBackgroundChatId) {
      this._showToast?.('当前没有正在执行的任务', 'info');
      return;
    }

    // 确认终止
    const confirmed = confirm('确定终止当前专家团任务吗？已完成的输出会保留。');
    if (!confirmed) return;

    // 取消后台任务
    await window.electronAPI?.expertChatCancel?.({ chatId: this._activeBackgroundChatId });
    window.electronAPI?.removeExpertChatListeners?.();

    // 添加终止提示到聊天区
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      const terminateMsg = document.createElement('div');
      terminateMsg.className = 'message assistant expert-message';
      terminateMsg.innerHTML = `
        <div class="expert-msg-header">
          <span class="expert-avatar">⏹</span>
          <span class="expert-name" style="color:#FF9500">任务已终止</span>
        </div>
        <div class="message-content">
          <div class="expert-msg-text" style="color:var(--text-secondary);font-style:italic;">用户手动终止了专家团任务，已完成的输出已保留。</div>
        </div>`;
      chatMessages.appendChild(terminateMsg);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // 重置状态但保留群聊模式（用户可以继续发消息）
    if (window.ExpertSystem) {
      window.ExpertSystem._groupChatActive = false;
      window.ExpertSystem._groupChatPhase = 'idle';
      window.ExpertSystem._groupChatExecutingInBackground = false;
    }
    this._expertBubbleMap?.clear();
    this._activeBackgroundChatId = null;
    window.ExpertSystem?.hideBackgroundIndicator();

    // 隐藏终止按钮，保留退出按钮
    const terminateBtn = document.getElementById('terminateGroupChatBtn');
    if (terminateBtn) terminateBtn.style.display = 'none';

    this._showToast?.('任务已终止', 'info');
    this._saveCurrentSessionMessages();
  },

  // v2.6.1: IPC 后台群聊执行
  _activeBackgroundChatId: null,
  _pendingGroupChatEvents: [],  // chatMessages 不在 DOM 时暂存事件

  async _startBackgroundGroupChat(userMessage, group, attachments = []) {
    // 构建专家配置映射
    const expertsMap = {};
    for (const eid of (group.expertIds || [])) {
      const expert = window.ExpertSystem?.getExpertById?.(eid);
      if (expert) {
        expertsMap[eid] = { appKey: expert.appKey, adpUrl: expert.adpUrl, name: expert.name, icon: expert.icon, intro: expert.intro };
      }
    }

    const chatId = `gc_${group.id}_${Date.now()}`;
    this._activeBackgroundChatId = chatId;
    this._pendingGroupChatEvents = [];

    // 标记群聊激活
    if (window.ExpertSystem) {
      window.ExpertSystem._groupChatActive = true;
      window.ExpertSystem._groupChatPhase = 'host_analysis';
      window.ExpertSystem._groupChatMessages = [];
      window.ExpertSystem._groupChatExecutingInBackground = true;
      window.ExpertSystem._markChatSessionAsGroup(group, this);
    }

    // 🔧 修复：先移除旧监听再注册新的，避免重复
    window.electronAPI?.removeExpertChatListeners?.();
    if (window.electronAPI?.onExpertChatEvent) {
      window.electronAPI.onExpertChatEvent((data) => {
        if (data.chatId !== this._activeBackgroundChatId) return;
        this._handleBackgroundChatEvent(data);
      });
    }

    // 启动后台执行（传递附件数据，主进程处理 COS 上传）
    const result = await window.electronAPI?.expertChatStart?.({
      chatId,
      config: {
        groupId: group.id,
        groupName: group.name,
        expertIds: group.expertIds || [],
        hostExpertId: group.hostExpertId,
        hostPrompt: group.hostPrompt || '',
        executionStrategy: group.executionStrategy || 'serial',
        experts: expertsMap
      },
      userMessage,
      attachments
    });

    if (!result?.success) {
      this._showToast?.('启动群聊失败：' + (result?.error || '未知错误'), 'error');
      if (window.ExpertSystem) {
        window.ExpertSystem._groupChatActive = false;
        window.ExpertSystem._groupChatPhase = 'idle';
        window.ExpertSystem._groupChatExecutingInBackground = false;
      }
    }
  },

  _handleBackgroundChatEvent(data) {
    const chatMessages = document.getElementById('chatMessages');
    const { type, expertId, expertName, expertIcon, isHost, content, phase, isError, message: statusMsg, incremental, fullText } = data;

    // 🔧 诊断日志
    console.log('[GroupChat] Event:', type, '| expert:', expertName, '| phase:', phase, '| hasContent:', !!content, '| hasFullText:', !!fullText);

    // 🔧 修复：chatMessages 不在 DOM 时暂存事件，等用户切回 AI 页面时重放
    if (!chatMessages && type !== 'error' && type !== 'chat-complete') {
      this._pendingGroupChatEvents.push(data);
      return;
    }

    if (type === 'phase-start') {
      // 显示后台指示器
      window.ExpertSystem?.showBackgroundIndicator(statusMsg);
      return;
    }

    // 新增：专家开始处理 — 创建消息气泡
    if (type === 'expert-start') {
      const statusMessage = statusMsg || (isHost ? '⭐ 主持人正在分析...' : `${expertIcon || '🤖'} ${expertName || '专家'} 正在处理...`);
      window.ExpertSystem?.showBackgroundIndicator(statusMessage);
      if (!chatMessages || !expertId) return;

      const expert = { id: expertId, name: expertName || '专家', icon: expertIcon || '🤖' };
      const placeholder = isHost ? '⭐ 主持人正在分析...' : `${expertIcon || '🤖'} ${expertName || '专家'} 正在处理...`;
      const msgEl = window.ExpertSystem?._addExpertMessageBubble?.(chatMessages, expert, isHost, placeholder);
      // 记录气泡元素，供后续 expert-stream 更新
      this._expertBubbleMap = this._expertBubbleMap || new Map();
      this._expertBubbleMap.set(expertId + '_' + phase, msgEl);
      return;
    }

    // 新增：专家流式输出 — 实时更新气泡内容
    if (type === 'expert-stream') {
      if (!chatMessages || !expertId) return;

      this._expertBubbleMap = this._expertBubbleMap || new Map();
      const bubbleKey = expertId + '_' + phase;
      let msgEl = this._expertBubbleMap.get(bubbleKey);

      if (msgEl && fullText) {
        // 实时更新流式文本
        const contentEl = msgEl.querySelector('.message-content');
        if (contentEl) {
          // 保留流式文本，不添加复制按钮（等 expert-complete 再加）
          const existingCopyBtn = contentEl.querySelector('.expert-copy-btn');
          const existingTime = contentEl.querySelector('.message-time');
          const renderedHtml = window.ExpertSystem?._renderMarkdown?.(fullText) || this.escapeHtml(fullText);
          contentEl.innerHTML = `<div class="expert-msg-text">${renderedHtml}</div>`;
          // 恢复复制按钮和时间戳（如果已存在）
          if (existingCopyBtn) contentEl.appendChild(existingCopyBtn);
          if (existingTime) contentEl.appendChild(existingTime);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      }
      return;
    }

    if (type === 'expert-complete') {
      window.ExpertSystem?.hideBackgroundIndicator();
      if (!chatMessages || !expertId) return;

      this._expertBubbleMap = this._expertBubbleMap || new Map();
      const bubbleKey = expertId + '_' + phase;
      const existingBubble = this._expertBubbleMap.get(bubbleKey);

      if (existingBubble) {
        // 流式模式：气泡已存在，更新最终内容并添加操作按钮
        window.ExpertSystem?._updateExpertMessageBubble?.(existingBubble, content, isError);
        this._expertBubbleMap.delete(bubbleKey);
      } else {
        // 非流式模式：创建新气泡
        const expert = { id: expertId, name: expertName || '专家', icon: expertIcon || '🤖' };
        const msgEl = window.ExpertSystem?._addExpertMessageBubble?.(chatMessages, expert, isHost, '');
        window.ExpertSystem?._updateExpertMessageBubble?.(msgEl, content, isError);
      }
      
      if (window.ExpertSystem) {
        window.ExpertSystem._groupChatMessages.push({
          expertId, expertName, expertIcon, isHost, phase, content, isError
        });
      }
      this._saveCurrentSessionMessages();
      return;
    }

    if (type === 'chat-complete') {
      window.ExpertSystem?.hideBackgroundIndicator();
      if (window.ExpertSystem) {
        window.ExpertSystem._groupChatActive = false;
        window.ExpertSystem._groupChatPhase = 'idle';
        window.ExpertSystem._groupChatExecutingInBackground = false;
        window.ExpertSystem._persistChatRecord(data.userMessage);
      }
      // 清理流式气泡映射
      this._expertBubbleMap?.clear();
      // 重放暂存事件
      this._replayPendingGroupChatEvents();
      this._saveCurrentSessionMessages();
      window.electronAPI?.removeExpertChatListeners?.();
      this._activeBackgroundChatId = null;
      // 群聊完成后隐藏终止按钮
      const terminateBtn = document.getElementById('terminateGroupChatBtn');
      if (terminateBtn) terminateBtn.style.display = 'none';
      return;
    }

    if (type === 'error') {
      window.ExpertSystem?.hideBackgroundIndicator();
      this._showToast?.('群聊出错：' + (data.message || '未知错误'), 'error');
      if (window.ExpertSystem) {
        window.ExpertSystem._groupChatActive = false;
        window.ExpertSystem._groupChatPhase = 'idle';
        window.ExpertSystem._groupChatExecutingInBackground = false;
      }
      this._expertBubbleMap?.clear();
      this._replayPendingGroupChatEvents();
      window.electronAPI?.removeExpertChatListeners?.();
      this._activeBackgroundChatId = null;
      // 隐藏终止按钮
      const terminateBtn = document.getElementById('terminateGroupChatBtn');
      if (terminateBtn) terminateBtn.style.display = 'none';
    }
  },

  // 重放暂存的群聊事件（用户切回 AI 页面时）
  _replayPendingGroupChatEvents() {
    if (!this._pendingGroupChatEvents?.length) return;
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    for (const data of this._pendingGroupChatEvents) {
      const { type, expertId, expertName, expertIcon, isHost, content, phase, isError } = data;
      if (type === 'expert-complete' && expertId) {
        const expert = { id: expertId, name: expertName || '专家', icon: expertIcon || '🤖' };
        const msgEl = window.ExpertSystem?._addExpertMessageBubble?.(chatMessages, expert, isHost, '');
        window.ExpertSystem?._updateExpertMessageBubble?.(msgEl, content, isError);
        if (window.ExpertSystem) {
          window.ExpertSystem._groupChatMessages.push({
            expertId, expertName, expertIcon, isHost, phase, content, isError
          });
        }
      }
    }
    this._pendingGroupChatEvents = [];
    chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  _saveCurrentSessionMessages() {
    if (!this._activeSessionId) return;

    // 防抖：合并短时间内的多次调用（流式完成+视图切换可能连续触发）
    if (this._saveSessionTimer) clearTimeout(this._saveSessionTimer);
    this._saveSessionTimer = setTimeout(() => {
      this._doSaveCurrentSessionMessages();
      this._saveSessionTimer = null;
    }, 500);
  },

  _doSaveCurrentSessionMessages() {
    if (!this._activeSessionId) return;

    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    // 收集所有 message 元素的 HTML
    const messages = chatMessages.querySelectorAll('.message');
    const htmlParts = [];
    messages.forEach(msg => htmlParts.push(msg.outerHTML));

    const session = this._chatSessions.find(s => s.id === this._activeSessionId);
    if (session) {
      session.messageCount = messages.length;
      session.updatedAt = new Date().toISOString();
      // 自动从第一条用户消息提取标题
      if (session.title === '新对话') {
        const firstUserMsg = chatMessages.querySelector('.message.user .message-content p');
        if (firstUserMsg) {
          session.title = firstUserMsg.textContent.trim().slice(0, 30);
          if (firstUserMsg.textContent.trim().length > 30) session.title += '...';
        }
      }
    }

    // 保存消息 HTML 到 localStorage（持久化，应用重启后仍可见）
    // 单条会话最大 2MB，超出时只保留最后 N 条消息
    const STORAGE_KEY = 'memora_session_msg_' + this._activeSessionId;
    const MAX_BYTES = 2 * 1024 * 1024; // 2MB
    let html = htmlParts.join('');
    try {
      if (html.length > MAX_BYTES) {
        // 只保留最后 50 条消息
        const lastN = Math.min(50, htmlParts.length);
        html = htmlParts.slice(-lastN).join('');
        console.warn('[Chat] Session messages too large, kept last', lastN, 'messages');
      }
      localStorage.setItem(STORAGE_KEY, html);
      // 兼容旧数据：清理 sessionStorage 同名 key
      try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
    } catch (e) {
      console.warn('[Chat] localStorage quota exceeded:', e.message);
      // 降级：尝试只保留最后 20 条
      try {
        const lastN = Math.min(20, htmlParts.length);
        localStorage.setItem(STORAGE_KEY, htmlParts.slice(-lastN).join(''));
      } catch (e2) {
        console.error('[Chat] Failed to save even truncated messages:', e2.message);
      }
    }

    this._saveChatSessions();
    this._renderChatSessionList();
  },

  _restoreSessionMessages(sessionId) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const featureCards = chatMessages.querySelector('.feature-cards');
    const quickQuestions = chatMessages.querySelector('.quick-questions');

    // 读取保存的消息（优先 localStorage，向下兼容 sessionStorage 旧数据）
    const STORAGE_KEY = 'memora_session_msg_' + sessionId;
    let savedHtml = localStorage.getItem(STORAGE_KEY);
    if (!savedHtml) {
      try {
        savedHtml = sessionStorage.getItem(STORAGE_KEY);
        // 迁移到 localStorage
        if (savedHtml) {
          try { localStorage.setItem(STORAGE_KEY, savedHtml); } catch {}
        }
      } catch {}
    }

    chatMessages.innerHTML = '';

    if (featureCards) chatMessages.appendChild(featureCards);
    if (quickQuestions) chatMessages.appendChild(quickQuestions);

    if (savedHtml) {
      chatMessages.insertAdjacentHTML('beforeend', savedHtml);
      // 🔧 修复：恢复的历史消息中，ADP 进度指示器需折叠为完成状态
      this._collapseRestoredADPProgress(chatMessages);
    } else {
      // 无保存的消息，显示欢迎语
      chatMessages.insertAdjacentHTML('beforeend', `
        <div class="message assistant">
          <div class="message-avatar">${this._assistantAvatarSvg}</div>
          <div class="message-content">
            <p>你好！我是你的AI助手。有什么我可以帮助你的吗？</p>
            <span class="message-time assistant-time">${this._formatChatTime(new Date())}</span>
          </div>
        </div>
      `);
    }

    this._initFeatureCards();
    // 重新绑定恢复消息的事件处理器（复制、编辑等按钮）
    this._bindRestoredMessageActions();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  // 停止 ADP 生成
  stopADPGeneration() {
    // v3.1: 先停止所有并行任务
    if (this._activeParallelTasks.size > 0) {
      this._stopAllParallelTasks();
      return;
    }

    // CC 模式停止
    if (this._ccStreaming) {
      this._ccStreaming = false;
      document.body.classList.remove('streaming-active');
      if (this._ccTimerInterval) { clearInterval(this._ccTimerInterval); this._ccTimerInterval = null; }
      this._ccTimerEl = null;
      window.electronAPI?.ccStop?.();
      window.electronAPI?.removeCCListeners?.();
      if (this._ccStreamResolve) { this._ccStreamResolve(); this._ccStreamResolve = null; }
      this._updateStreamingUI(false);
      document.getElementById('aiChatInput')?.focus();
      return;
    }

    if (!this._adpStreaming) return;

    this._adpStreaming = false;
    document.body.classList.remove('streaming-active');
    if (this._adpTimerInterval) { clearInterval(this._adpTimerInterval); this._adpTimerInterval = null; }
    this._adpTimerEl = null;
    window.electronAPI?.stopADPMessage?.();
    window.electronAPI?.removeADPListeners?.();
    if (this._adpStreamResolve) { this._adpStreamResolve(); this._adpStreamResolve = null; }
    this._updateStreamingUI(false);
    document.getElementById('aiChatInput')?.focus();
  },

  _updateStreamingUI(streaming) {
    const stopBtn = document.getElementById('stopAIMessageBtn');
    const sendBtn = document.getElementById('sendAIMessageBtn');
    const input = document.getElementById('aiChatInput');
    if (streaming) {
      stopBtn?.classList.remove('hidden');
      sendBtn?.classList.add('hidden');
      input?.setAttribute('placeholder', 'AI 正在思考...');
    } else {
      stopBtn?.classList.add('hidden');
      sendBtn?.classList.remove('hidden');
      input?.setAttribute('placeholder', '输入你的问题...');
    }
  },

  // ===== v3.1 多任务并发实现 =====

  /**
   * 切换并行模式
   */
  _toggleParallelMode() {
    this._parallelMode = !this._parallelMode;
    const btn = document.getElementById('parallelToggleBtn');
    if (btn) {
      btn.classList.toggle('active', this._parallelMode);
    }
    // 显示/隐藏并行模式选择面板
    this._showToast(
      this._parallelMode ? '并行模式已开启：发送消息将同时调用多个 AI' : '并行模式已关闭',
      'info'
    );
    console.log('[Parallel] Mode:', this._parallelMode ? 'ON' : 'OFF');
  },

  /**
   * 注册 task:stream 事件监听器（全局只注册一次）
   */
  _registerTaskStreamListener() {
    if (this._taskStreamRegistered) return;
    if (!window.electronAPI?.onTaskStream) return;

    window.electronAPI.onTaskStream((evt) => {
      this._handleTaskStream(evt);
    });
    this._taskStreamRegistered = true;
    console.log('[TaskStream] Listener registered');
  },

  /**
   * 处理 task:stream 事件 — 路由到对应任务
   */
  _handleTaskStream(evt) {
    const { taskId } = evt;
    if (!taskId) return;

    const taskInfo = this._activeParallelTasks.get(taskId);
    if (!taskInfo) return;

    const { mode, contentEl, cardEl, statusEl } = taskInfo;
    const event = evt.event || evt.type;

    // ADP 事件处理
    if (mode === 'adp' || mode === 'agent') {
      this._handleADPTaskEvent(taskId, taskInfo, evt, event);
      return;
    }

    // CC 事件处理
    if (mode === 'cc') {
      this._handleCCTaskEvent(taskId, taskInfo, evt, event);
      return;
    }

    // LLM 事件处理
    if (mode === 'llm') {
      this._handleLLMTaskEvent(taskId, taskInfo, evt, event);
      return;
    }
  },

  /**
   * 处理 ADP 任务事件
   */
  _handleADPTaskEvent(taskId, taskInfo, evt, event) {
    const { contentEl, cardEl, statusEl, textBuffer } = taskInfo;

    switch (event) {
      case 'text.delta':
      case 'content.added':
      case 'message.added': {
        const data = evt.data || {};
        const delta = data.Text || data.Content?.[0]?.Text || data.payload?.content?.[0]?.text || '';
        if (delta) {
          taskInfo.textBuffer = (textBuffer || '') + delta;
          this._updateTaskContent(taskId, taskInfo);
        }
        break;
      }
      case 'text.replace': {
        // 替换整个文本
        const data = evt.data || {};
        const newText = data.Text || data.Content?.[0]?.Text || '';
        if (newText) {
          taskInfo.textBuffer = newText;
          this._updateTaskContent(taskId, taskInfo);
        }
        break;
      }
      case 'thought': {
        // 思考过程（不直接显示在内容区，可扩展）
        break;
      }
      case 'done': {
        this._completeTask(taskId, evt.aborted ? 'cancelled' : 'completed');
        break;
      }
      case 'error': {
        const errMsg = evt.data?.Error?.Message || 'ADP 请求失败';
        this._failTask(taskId, errMsg);
        break;
      }
    }
  },

  /**
   * 处理 CC 任务事件
   */
  _handleCCTaskEvent(taskId, taskInfo, evt, event) {
    const { contentEl, cardEl, statusEl, textBuffer } = taskInfo;

    switch (event) {
      case 'delta':
      case 'text': {
        const delta = evt.content || '';
        if (delta) {
          taskInfo.textBuffer = (textBuffer || '') + delta;
          this._updateTaskContent(taskId, taskInfo);
        }
        break;
      }
      case 'thinking': {
        // 显示思考状态
        if (statusEl && !taskInfo.completed) {
          statusEl.innerHTML = '<span class="live-dot"></span>思考中';
        }
        break;
      }
      case 'tool_use':
      case 'tool_result': {
        // 显示工具调用步骤
        const toolName = evt.name || evt.content?.name || '工具';
        this._addTaskStep(taskId, taskInfo, `🔧 ${toolName}`);
        break;
      }
      case 'done': {
        this._completeTask(taskId, evt.aborted ? 'cancelled' : 'completed', { sessionId: evt.sessionId });
        break;
      }
      case 'error': {
        this._failTask(taskId, evt.error || 'CC 调用失败');
        break;
      }
    }
  },

  /**
   * 处理 LLM 任务事件
   */
  _handleLLMTaskEvent(taskId, taskInfo, evt, event) {
    switch (event) {
      case 'delta':
      case 'text': {
        const delta = evt.content || '';
        if (delta) {
          taskInfo.textBuffer = (taskInfo.textBuffer || '') + delta;
          this._updateTaskContent(taskId, taskInfo);
        }
        break;
      }
      case 'done': {
        this._completeTask(taskId, 'completed');
        break;
      }
      case 'error': {
        this._failTask(taskId, evt.error || 'LLM 调用失败');
        break;
      }
    }
  },

  /**
   * 更新任务卡片内容（使用 requestAnimationFrame 批量更新）
   */
  _updateTaskContent(taskId, taskInfo) {
    if (taskInfo._rafPending) return;
    taskInfo._rafPending = true;

    requestAnimationFrame(() => {
      taskInfo._rafPending = false;
      const { contentEl } = taskInfo;
      if (!contentEl) return;

      // 第一次有内容时，清除加载动画
      if (contentEl.querySelector('.agent-thinking')) {
        contentEl.innerHTML = '';
      }

      // 渲染 Markdown/文本
      const html = this._renderTaskText(taskInfo.textBuffer || '');
      contentEl.innerHTML = html;
    });
  },

  /**
   * 添加任务步骤显示
   */
  _addTaskStep(taskId, taskInfo, stepText) {
    const { contentEl } = taskInfo;
    if (!contentEl) return;

    let stepsEl = contentEl.querySelector('.task-steps');
    if (!stepsEl) {
      contentEl.insertAdjacentHTML('afterbegin', '<div class="task-steps"></div>');
      stepsEl = contentEl.querySelector('.task-steps');
    }
    stepsEl.insertAdjacentHTML('beforeend', `<div class="task-step-item">${this.escapeHtml(stepText)}</div>`);
  },

  /**
   * 渲染任务文本（简化版 Markdown）
   */
  _renderTaskText(text) {
    if (!text) return '<div class="agent-thinking"><div class="thinking-dots"><span></span><span></span><span></span></div><span class="thinking-text">等待响应...</span></div>';
    // 基础 Markdown 渲染
    let html = this.escapeHtml(text);
    // 代码块
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
    });
    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    // 加粗
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 标题
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    // 列表
    html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)/g, '<ul>$1</ul>');
    // 换行
    html = html.replace(/\n/g, '<br>');
    return `<div class="task-output-text">${html}</div>`;
  },

  /**
   * 完成任务
   */
  _completeTask(taskId, status = 'completed', extra = {}) {
    const taskInfo = this._activeParallelTasks.get(taskId);
    if (!taskInfo || taskInfo.completed) return;

    taskInfo.completed = true;
    taskInfo.status = status;
    if (taskInfo._timerInterval) {
      clearInterval(taskInfo._timerInterval);
      taskInfo._timerInterval = null;
    }

    const { cardEl, statusEl, contentEl } = taskInfo;
    if (cardEl) {
      cardEl.classList.remove('running');
      cardEl.classList.add(status === 'completed' ? 'completed' : 'error');
    }
    if (statusEl) {
      const elapsed = taskInfo._timerStart ? Math.floor((Date.now() - taskInfo._timerStart) / 1000) : 0;
      statusEl.className = `task-status ${status === 'completed' ? 'done' : 'error'}`;
      statusEl.innerHTML = `<span class="live-dot"></span>${status === 'completed' ? '已完成' : '已取消'} · ${elapsed}s`;
    }
    // 移除停止按钮
    const stopBtn = cardEl?.querySelector('.task-stop-btn');
    if (stopBtn) stopBtn.remove();

    // 如果内容为空，显示空状态
    if (contentEl && !taskInfo.textBuffer && status === 'completed') {
      contentEl.innerHTML = '<div class="task-empty">（无内容返回）</div>';
    } else if (contentEl && taskInfo.textBuffer) {
      // 最终渲染
      contentEl.innerHTML = this._renderTaskText(taskInfo.textBuffer);
    }

    // 保存 CC sessionId
    if (extra.sessionId && this._activeSessionId) {
      const session = this._chatSessions.find(s => s.id === this._activeSessionId);
      if (session) {
        session.ccSessionId = extra.sessionId;
        this._saveChatSessions();
      }
    }

    // 保存并行任务结果到对话消息（用于持久化）
    if (status === 'completed' && taskInfo.textBuffer && this._activeSessionId) {
      this._saveParallelTaskResult(taskId, taskInfo.mode, taskInfo.textBuffer);
    }

    // 检查是否所有任务都完成了
    this._checkAllTasksComplete();
  },

  /**
   * 任务失败
   */
  _failTask(taskId, errorMessage) {
    const taskInfo = this._activeParallelTasks.get(taskId);
    if (!taskInfo || taskInfo.completed) return;

    taskInfo.completed = true;
    taskInfo.status = 'error';

    if (taskInfo._timerInterval) {
      clearInterval(taskInfo._timerInterval);
      taskInfo._timerInterval = null;
    }

    const { cardEl, statusEl, contentEl } = taskInfo;
    if (cardEl) {
      cardEl.classList.remove('running');
      cardEl.classList.add('error');
    }
    if (statusEl) {
      statusEl.className = 'task-status error';
      statusEl.innerHTML = `<span class="live-dot"></span>错误`;
    }
    if (contentEl) {
      contentEl.innerHTML = `<div class="task-error-msg">❌ ${this.escapeHtml(errorMessage)}</div>`;
    }
    const stopBtn = cardEl?.querySelector('.task-stop-btn');
    if (stopBtn) stopBtn.remove();

    console.error(`[Task ${taskId}] Error:`, errorMessage);
    this._checkAllTasksComplete();
  },

  /**
   * 检查所有并行任务是否完成
   */
  _checkAllTasksComplete() {
    let allDone = true;
    for (const task of this._activeParallelTasks.values()) {
      if (!task.completed) {
        allDone = false;
        break;
      }
    }
    if (allDone) {
      this._updateStreamingUI(false);
      document.getElementById('aiChatInput')?.focus();

      // 清理已完成任务的引用（延迟，保留 UI）
      setTimeout(() => {
        for (const [id, task] of this._activeParallelTasks) {
          if (task.completed) {
            this._activeParallelTasks.delete(id);
          }
        }
      }, 5000);
    }
  },

  /**
   * 停止所有并行任务
   */
  _stopAllParallelTasks() {
    for (const [taskId, taskInfo] of this._activeParallelTasks) {
      if (!taskInfo.completed) {
        window.electronAPI?.taskStop?.(taskId);
        this._completeTask(taskId, 'cancelled');
      }
    }
    this._updateStreamingUI(false);
    document.getElementById('aiChatInput')?.focus();
  },

  /**
   * 停止单个任务
   */
  _stopTask(taskId) {
    window.electronAPI?.taskStop?.(taskId);
    this._completeTask(taskId, 'cancelled');
  },

  /**
   * 保存并行任务结果到对话消息（持久化）
   */
  _saveParallelTaskResult(taskId, mode, textBuffer) {
    if (!this._activeSessionId) return;
    
    // 找到对应的会话
    const session = this._chatSessions.find(s => s.id === this._activeSessionId);
    if (!session) return;
    
    // 标记 Agent 类型（如果还没有标记）
    if (!session.agentTypes.includes(mode)) {
      session.agentTypes.push(mode);
      this._saveChatSessions();
      this._renderChatSessionList();
    }
    
    // 将结果保存到 localStorage（与对话消息一起）
    const msgKey = `memora_session_msg_${session.id}`;
    let existingHtml = localStorage.getItem(msgKey) || '';
    
    // 添加 Agent 结果卡片到 HTML
    const modeLabels = {
      cc: 'M-Agent',
      adp: 'Agent',
      agent: 'Agent',
      llm: 'LLM',
    };
    const modeLabel = modeLabels[mode] || mode;
    
    const resultCardHtml = `
      <div class="parallel-result-card" data-mode="${mode}">
        <div class="parallel-result-header">
          <span class="parallel-result-badge ${mode}">${modeLabel}</span>
          <span class="parallel-result-time">${this._formatChatTime(new Date())}</span>
        </div>
        <div class="parallel-result-content">
          ${this._renderTaskText(textBuffer)}
        </div>
      </div>
    `;
    
    // 在最后一个用户消息后插入结果卡片
    if (!existingHtml.includes('parallel-result-card')) {
      existingHtml += resultCardHtml;
      localStorage.setItem(msgKey, existingHtml);
    }
    
    console.log(`[Parallel] Saved result for ${mode}: ${textBuffer.length} chars`);
  },

  /**
   * 发送并行消息 — 同时调用多个 AI
   */
  async _sendParallelMessage(message, options = {}) {
    const input = document.getElementById('aiChatInput');
    if (!message && this._chatAttachments.length === 0) return;

    // 解析文件引用
    const resolvedMessage = this._resolveFileRefs(message);

    // 确保有会话，并标记为并行任务会话
    const modes = this._getParallelModes();
    if (!this._activeSessionId) {
      this.createNewChatSession(modes);
    } else {
      // 标记当前会话为并行任务
      const session = this._chatSessions.find(s => s.id === this._activeSessionId);
      if (session) {
        session.taskType = 'parallel';
        session.agentTypes = [...modes];
        this._saveChatSessions();
        this._renderChatSessionList();
      }
    }

    const chatMessages = document.getElementById('chatMessages');
    const attachments = [...this._chatAttachments];

    // 添加用户消息
    const userMessage = document.createElement('div');
    userMessage.className = 'message user';
    userMessage.dataset.sendTime = new Date().toISOString();
    let attachmentsHtml = '';
    if (attachments.length > 0) {
      attachmentsHtml = '<div class="message-attachments">';
      for (const att of attachments) {
        const icon = this.getFileIcon(att.type, att.name);
        attachmentsHtml += `<span class="message-attachment-item"><span class="msg-att-icon">${icon}</span>${this.escapeHtml(att.name)}</span>`;
      }
      attachmentsHtml += '</div>';
    }
    userMessage.innerHTML = `
      <div class="message-avatar">${this._userAvatarSvg}</div>
      <div class="message-content">
        <p>${this.escapeHtml(message || '发送了文件')}</p>
        ${attachmentsHtml}
        <span class="message-time">${this._formatChatTime(new Date())}</span>
      </div>`;
    chatMessages.appendChild(userMessage);

    input.value = '';
    input.style.height = 'auto';
    this.clearChatAttachments();
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // 更新会话标题
    const session = this._chatSessions.find(s => s.id === this._activeSessionId);
    if (session && session.title === '新对话' && message) {
      session.title = message.length > 30 ? message.slice(0, 30) + '...' : message;
      session.updatedAt = new Date().toISOString();
      this._saveChatSessions();
      this._renderChatSessionList();
    }

    // 构建默认上下文
    const defaultContext = await this._buildDefaultContext();
    const sendMessage = defaultContext ? (defaultContext + '\n' + resolvedMessage) : resolvedMessage;
    const attachmentData = await this.buildAttachmentData(attachments);

    // v2.7 本地上下文注入（并行模式）
    let parallelContextSystemRole = options.systemRole || '';
    const parallelContextEnabled = this._settings?.localContextEnabled !== false;
    if (!parallelContextSystemRole && parallelContextEnabled && message) {
      try {
        const classifyResult = await window.electronAPI.contextClassifyIntent(message);
        const classification = classifyResult?.classification;
        let contextData;
        if (classification) {
          contextData = await this._retrieveLocalContext(classification);
        } else {
          contextData = await this._retrieveLocalContextFallback();
        }
        parallelContextSystemRole = contextData.systemRole;
        console.log('[Chat] Parallel context injected, sources:', contextData.sources.join(', '));
      } catch (e) {
        console.warn('[Chat] Parallel context injection failed:', e);
      }
    }

    // 确定要调用的 AI 模式（modes 已在上方声明）
    if (modes.length === 0) {
      this._showToast('请至少选择一个 AI 模式', 'warning');
      return;
    }

    // 创建并行响应组容器
    const responseGroup = document.createElement('div');
    responseGroup.className = 'message assistant ai-response-group';
    responseGroup.innerHTML = `<div class="message-avatar">${this._assistantAvatarSvg}</div><div class="ai-response-cards" style="flex:1;"></div>`;
    chatMessages.appendChild(responseGroup);
    const cardsContainer = responseGroup.querySelector('.ai-response-cards');

    // 锁定 UI
    this._updateStreamingUI(true);

    // 为每个模式创建任务卡片并启动
    const tasks = [];
    for (const mode of modes) {
      const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const cardEl = this._createTaskCard(mode, taskId, cardsContainer);
      const taskInfo = {
        mode,
        cardEl,
        contentEl: cardEl.querySelector('.task-content'),
        statusEl: cardEl.querySelector('.task-status'),
        timerEl: cardEl.querySelector('.task-timer'),
        completed: false,
        textBuffer: '',
        _rafPending: false,
        _timerStart: Date.now(),
        _timerInterval: null,
      };
      this._activeParallelTasks.set(taskId, taskInfo);

      // 启动计时器
      taskInfo._timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - taskInfo._timerStart) / 1000);
        if (taskInfo.timerEl) taskInfo.timerEl.textContent = elapsed + 's';
      }, 1000);

      tasks.push({ taskId, mode, cardEl, taskInfo });
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;

    // 并行启动所有任务
    await Promise.all(tasks.map(({ taskId, mode }) => this._startParallelTask(taskId, mode, sendMessage, attachmentData, { ...options, systemRole: parallelContextSystemRole })));
  },

  /**
   * 获取并行模式下要调用的 AI 模式列表
   */
  _getParallelModes() {
    // 默认调用 ADP + CC（如果可用）
    const modes = [];
    if (this._aiAssistantMode === 'cc' && window.electronAPI?.ccInvoke) {
      modes.push('cc');
      modes.push('adp'); // CC 模式下并行调用 ADP
    } else if (this._aiAssistantMode === 'agent') {
      modes.push('adp');
    } else if (this._aiAssistantMode === 'llm') {
      modes.push('adp');
      modes.push('llm');
    } else {
      // 默认：ADP + CC
      modes.push('adp');
      if (window.electronAPI?.ccInvoke) modes.push('cc');
    }
    return modes;
  },

  /**
   * 启动单个并行任务
   */
  async _startParallelTask(taskId, mode, message, attachmentData, options) {
    try {
      if (mode === 'adp' || mode === 'agent') {
        // ADP 模式
        const expertConfig = window.ExpertSystem?.getActiveADPConfig?.();
        const data = {
          message,
          attachments: attachmentData,
          taskId,
        };
        if (expertConfig?.appKey) {
          data.appKey = expertConfig.appKey;
          data.adpUrl = expertConfig.url;
          data._expertMode = true;
        }
        if (options.systemRole) {
          data.systemRole = options.systemRole;
        }
        const result = await window.electronAPI.sendADPMessage(data);
        if (!result.success) {
          this._failTask(taskId, result.error || 'ADP 调用失败');
        }
      } else if (mode === 'cc') {
        // CC 模式
        const activeSession = this._activeSessionId
          ? this._chatSessions.find(s => s.id === this._activeSessionId)
          : null;
        const ccSessionId = activeSession?.ccSessionId || null;
        const result = await window.electronAPI.ccInvoke({
          message,
          attachments: attachmentData,
          sessionId: ccSessionId,
          systemRole: options.systemRole || '',
          workdir: this._getCCWorkdir(),
          skill: document.getElementById('ccSkillSelect')?.value || '',
          connectorIds: this._getSelectedConnectorIds(),
          openRouterModel: document.getElementById('ccOpenRouterSelect')?.value || '',
          providerId: document.getElementById('ccProviderSelect')?.value || '',
          taskId,
        });
        if (!result.success) {
          this._failTask(taskId, result.error || 'CC 调用失败');
        }
      } else if (mode === 'llm') {
        // LLM 模式 — 复用 agent:invoke
        const result = await window.electronAPI.agent.invoke(message, 'chat', attachmentData);
        if (!result.success) {
          this._failTask(taskId, result.error || 'LLM 调用失败');
        }
        // LLM 通过 agent:stream 事件推送，需要额外处理
        // TODO: 将 agent:stream 事件也路由到 task:stream
      }
    } catch (e) {
      this._failTask(taskId, e.message || '未知错误');
    }
  },

  /**
   * 创建任务卡片 UI
   */
  _createTaskCard(mode, taskId, container) {
    const modeLabels = {
      cc: 'M-Agent',
      adp: 'Agent',
      agent: 'Agent',
      llm: 'LLM',
    };
    const modeLabel = modeLabels[mode] || mode;

    const card = document.createElement('div');
    card.className = 'task-card running';
    card.dataset.taskId = taskId;
    card.innerHTML = `
      <div class="task-header">
        <span class="task-mode-badge ${mode}">${modeLabel}</span>
        <span class="task-status running"><span class="live-dot"></span>运行中</span>
        <span class="task-timer">0s</span>
        <button class="task-stop-btn" data-task-id="${taskId}">停止</button>
      </div>
      <div class="task-content">
        <div class="agent-thinking">
          <div class="thinking-dots"><span></span><span></span><span></span></div>
          <span class="thinking-text">等待响应...</span>
        </div>
      </div>
      <div class="task-meta">
        <span class="task-token">Token: 0</span>
      </div>
    `;
    container.appendChild(card);

    // 绑定停止按钮
    const stopBtn = card.querySelector('.task-stop-btn');
    stopBtn?.addEventListener('click', () => this._stopTask(taskId));

    return card;
  },

  _formatChatTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  },

  async generateWeeklyReport() {
    const tasks = Store.getTasks();
    const now = new Date();

    // 计算本周范围（周一到周日）
    const dayOfWeek = now.getDay() || 7; // 周日=7
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOfWeek + 1);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const periodStart = monday.toISOString().slice(0, 10);
    const periodEnd = sunday.toISOString().slice(0, 10);

    // 过滤本周任务
    const weekTasks = tasks.filter(t => {
      const created = new Date(t.createdAt);
      const due = t.dueDate ? new Date(t.dueDate) : null;
      const completed = t.completedAt ? new Date(t.completedAt) : null;
      return (created >= monday && created <= sunday) ||
             (due && due >= monday && due <= sunday) ||
             (completed && completed >= monday && completed <= sunday);
    });

    // 统计
    const completed = weekTasks.filter(t => t.status === 'completed');
    const inProgress = weekTasks.filter(t => t.status === 'in-progress' || t.status === 'in_progress');
    const pending = weekTasks.filter(t => t.status === 'pending');

    // 番茄钟时长
    let focusMinutes = 0;
    weekTasks.forEach(t => {
      if (t.pomodoroSessions) {
        t.pomodoroSessions.forEach(s => {
          if (s.type === 'work' && s.completed && s.startTime) {
            const start = new Date(s.startTime);
            if (start >= monday && start <= sunday) {
              focusMinutes += s.duration || 25;
            }
          }
        });
      }
    });

    // 构造数据
    const reportData = {
      period: `${periodStart} ~ ${periodEnd}`,
      stats: {
        total: weekTasks.length,
        completed: completed.length,
        inProgress: inProgress.length,
        pending: pending.length,
        focusMinutes
      },
      tasks: weekTasks.map(t => ({
        title: t.title,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate ? t.dueDate.slice(0, 10) : null,
        tags: t.tags || [],
        actualDuration: t.pomodoroSessions
          ? t.pomodoroSessions.filter(s => s.type === 'work' && s.completed).reduce((sum, s) => sum + (s.duration || 25), 0)
          : 0
      })),
      highlights: weekTasks.filter(t => t.priority === 'high' || t.priority === 'urgent')
    };

    // 构造 prompt
    const prompt = `📋 生成周报（${periodStart} ~ ${periodEnd}）

你是一个周报生成助手。根据用户本周的工作数据，生成一份专业的周报。

要求：
1. 用 Markdown 格式输出
2. 包含以下结构：
   - 📊 本周概览（一句话总结 + 关键数据）
   - ✅ 已完成事项（按优先级排列，标注标签）
   - 🔄 进行中事项（进展描述）
   - ⏳ 待推进事项（下周重点）
   - 💡 本周洞察（从任务数据中提炼的工作模式/建议）
3. 语言简洁专业，避免空话套话
4. 如果有高优先级任务未完成，需要特别提醒

本周数据：
${JSON.stringify(reportData, null, 2)}`;

    // 设置到输入框并走 ADP 流式
    const input = document.getElementById('aiChatInput');
    input.value = prompt;
    await this.sendAIMessage('adp');
  },

  generateId(len = 32) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  async saveSettings() {
    // 保存API配置
    if (window.electronAPI) {
      const apiKey = document.getElementById('apiKey').value;
      const baseUrl = document.getElementById('apiBaseUrl').value;
      const model = document.getElementById('apiModel').value;
      let dailyLimit = parseInt(document.getElementById('apiDailyLimit').value);
      
      // 如果配置了API Key，自动设置每日使用次数为1000次
      if (apiKey && !dailyLimit) {
        dailyLimit = 1000;
        document.getElementById('apiDailyLimit').value = 1000;
      }
      
      await window.electronAPI.setAPIConfig({
        apiKey: apiKey.trim() || null,
        baseUrl: baseUrl.trim() || null,
        model: model.trim() || null,
        dailyLimit: dailyLimit || null,
        // 大用量 LLM 配置（传空字符串表示清空，不传 null）
        highvolApiKey: document.getElementById('highvolApiKey').value.trim(),
        highvolBaseUrl: document.getElementById('highvolBaseUrl').value.trim(),
        highvolModel: document.getElementById('highvolModel').value.trim(),
      });
      
      // 保存ADP配置
      const adpAppKey = document.getElementById('adpAppKey').value;
      // 各 Agent AppKey：留空时自动使用通用 AppKey
      const adpKnowledgeAppKey = document.getElementById('adpKnowledgeAppKey').value || adpAppKey;
      const adpSearchAppKey = document.getElementById('adpSearchAppKey').value || adpAppKey;
      const adpClusteringAppKey = document.getElementById('adpClusteringAppKey').value || adpAppKey;
      const adpGraphAppKey = document.getElementById('adpGraphAppKey').value || adpAppKey;
      const adpActivationAppKey = document.getElementById('adpActivationAppKey').value || adpAppKey;
      const adpEvolutionAppKey = document.getElementById('adpEvolutionAppKey').value || adpAppKey;
      const adpConflictAppKey = document.getElementById('adpConflictAppKey').value || adpAppKey;
      const fileShareApiKey = document.getElementById('fileShareApiKey').value;
      const adpTcSecretId = document.getElementById('adpTcSecretId').value;
      const adpTcSecretKey = document.getElementById('adpTcSecretKey').value;
      const adpBotBizId = document.getElementById('adpBotBizId').value;
      const adpUrl = document.getElementById('adpUrl').value;
      const adpAgentName = document.getElementById('adpAgentName').value;
      
      await window.electronAPI.setADPConfig({
        appKey: adpAppKey || null,
        knowledgeAppKey: adpKnowledgeAppKey || '',
        searchAppKey: adpSearchAppKey || '',
        clusteringAppKey: adpClusteringAppKey || '',
        graphAppKey: adpGraphAppKey || '',
        activationAppKey: adpActivationAppKey || '',
        evolutionAppKey: adpEvolutionAppKey || '',
        conflictAppKey: adpConflictAppKey || '',
        fileShareApiKey: fileShareApiKey || '',
        tcSecretId: adpTcSecretId || '',
        tcSecretKey: adpTcSecretKey || '',
        botBizId: adpBotBizId || '',
        url: adpUrl || null,
        agentName: adpAgentName || null
      });

      // 保存 CC 配置
      const ccAuthToken = document.getElementById('ccAuthToken')?.value.trim();
      const ccBaseUrl = document.getElementById('ccBaseUrl')?.value.trim();
      const ccModel = document.getElementById('ccModel')?.value.trim();
      const ccAllowedTools = document.getElementById('ccAllowedTools')?.value.trim();
      const ccPermissionMode = document.getElementById('ccPermissionMode')?.value;
      const ccMaxTurns = parseInt(document.getElementById('ccMaxTurns')?.value) || 50;
      // OpenRouter 配置
      const orApiKey = document.getElementById('ccOpenRouterApiKey')?.value.trim();
      const orBaseUrl = document.getElementById('ccOpenRouterBaseUrl')?.value.trim();
      const orDefaultModel = document.getElementById('ccOpenRouterDefaultModel')?.value.trim();
      if (window.electronAPI?.ccSetConfig) {
        await window.electronAPI.ccSetConfig({
          authToken: ccAuthToken || undefined,
          baseUrl: ccBaseUrl || undefined,
          model: ccModel || undefined,
          allowedTools: ccAllowedTools || undefined,
          permissionMode: ccPermissionMode || undefined,
          maxTurns: ccMaxTurns || undefined,
          defaultWorkdir: document.getElementById('ccDefaultWorkdir')?.value.trim() || undefined,
          envVars: this._collectCCEnvVars(),
          openRouterApiKey: orApiKey || undefined,
          openRouterBaseUrl: orBaseUrl || undefined,
          // 空字符串也需保存（用户清除配置时写入 '' 覆盖旧值）
          openRouterDefaultModel: orDefaultModel,
          // 供应商配置 + 活跃供应商
          activeProvider: document.getElementById('ccProviderSelect')?.value || undefined,
        });
        // 保存供应商配置
        await this._saveProviderConfigs();
      }

      // 更新缓存的默认工作目录
      this._ccDefaultWorkdir = document.getElementById('ccDefaultWorkdir')?.value.trim() || '';
      // 清除 OpenRouter 模型选择器缓存，确保下次刷新时重新拉取
      const orSelectEl = document.getElementById('ccOpenRouterSelect');
      if (orSelectEl) delete orSelectEl.dataset.loaded;
      this._updateCCWorkdirBar();
      
      // Phase 3: 保存用户画像
      await this.saveProfileFromEditor();
      // 清除画像标签页缓存，确保下次打开时重新加载
      this._settingsTabLoaded.profile = false;
    }
    
    this.hideSettingsModal();
    this.showToast('设置已保存');
  },

  async resetAIPrompt() {
    if (window.electronAPI?.promptFiles?.reset) {
      const result = await window.electronAPI.promptFiles.reset('task_recognition_v2.0.md');
      if (result.success) {
        this.loadPromptFiles();
        this.showToast('任务识别 Prompt 已恢复');
      } else {
        this.showToast('恢复失败：' + (result.error || '无备份'), 'error');
      }
    }
  },

  async clearClipboardHashes() {
    if (window.electronAPI) {
      await window.electronAPI.clearClipboardHashes();
    }
    this.showToast('已处理记录已清空');
  },

  async clearAPIKey() {
    if (window.electronAPI) {
      await window.electronAPI.clearAPIKey();
      document.getElementById('apiKey').value = '';
      document.getElementById('apiBaseUrl').value = '';
      document.getElementById('apiModel').value = '';
      document.getElementById('apiDailyLimit').value = '1000';
      document.getElementById('currentKeyType').textContent = '当前使用: 内置密钥';
      document.getElementById('currentDailyLimit').textContent = '每日限制: 10次';
      // 同时清空大用量配置
      document.getElementById('highvolApiKey').value = '';
      document.getElementById('highvolBaseUrl').value = '';
      document.getElementById('highvolModel').value = '';
    }
    this.showToast('API配置已清空，将使用内置密钥');
  },

  async _testLLMConnection(type) {
    if (!window.electronAPI?.testLLMConnection) {
      this.showToast('当前版本不支持测试连接');
      return;
    }

    const isHighvol = type === 'highvol';
    const resultEl = document.getElementById(isHighvol ? 'testHighvolLLMResult' : 'testLLMResult');
    const btnEl = document.getElementById(isHighvol ? 'testHighvolLLMBtn' : 'testLLMBtn');

    let baseUrl, apiKey, model;

    if (isHighvol) {
      baseUrl = document.getElementById('highvolBaseUrl').value;
      apiKey = document.getElementById('highvolApiKey').value;
      model = document.getElementById('highvolModel').value;
      // 大用量留空时回退到小用量
      if (!baseUrl) baseUrl = document.getElementById('apiBaseUrl').value;
      if (!model) model = document.getElementById('apiModel').value;
    } else {
      baseUrl = document.getElementById('apiBaseUrl').value;
      apiKey = document.getElementById('apiKey').value;
      model = document.getElementById('apiModel').value;
    }

    // DOM 中 apiKey 密码框不回显已保存值，测试时主进程会自动使用已保存的 key
    if (!apiKey || !baseUrl || !model) {
      try {
        const savedConfig = await window.electronAPI.getAPIConfig();
        if (!baseUrl && savedConfig.baseUrl) baseUrl = savedConfig.baseUrl;
        if (!model && savedConfig.model) model = savedConfig.model;
      } catch (e) { /* ignore */ }
    }

    if (!baseUrl || !model) {
      resultEl.innerHTML = '<span style="color: var(--danger);">⚠️ 请先配置 Base URL 和模型名称</span>';
      return;
    }

    btnEl.disabled = true;
    btnEl.textContent = '⏳ 测试中...';
    resultEl.innerHTML = '<span style="color: var(--text-secondary);">连接中...</span>';

    try {
      const result = await window.electronAPI.testLLMConnection({ baseUrl, apiKey, model });
      if (result.ok) {
        resultEl.innerHTML = `<span style="color: var(--success);">✅ 连接成功 (${result.latency}ms) · 模型: ${result.model || model} · 回复: "${result.content}"</span>`;
      } else {
        resultEl.innerHTML = `<span style="color: var(--danger);">❌ 连接失败: ${this.escapeHtml(result.error)}</span>`;
      }
    } catch (err) {
      resultEl.innerHTML = `<span style="color: var(--danger);">❌ 请求异常: ${this.escapeHtml(err.message)}</span>`;
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = '🔗 测试连接';
    }
  },

  // === 数据导出/导入 ===
  _pendingImportData: null,

  async exportAllData() {
    const password = document.getElementById('exportPassword')?.value;
    const confirm = document.getElementById('exportPasswordConfirm')?.value;
    const resultEl = document.getElementById('exportResult');
    
    if (!password) { this.showToast('请输入加密密码', 'error'); return; }
    if (password.length < 4) { this.showToast('密码至少4位', 'error'); return; }
    if (password !== confirm) { this.showToast('两次密码不一致', 'error'); return; }

    const btn = document.getElementById('exportDataBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 正在导出...';
    if (resultEl) { resultEl.classList.remove('hidden'); resultEl.innerHTML = '<div style="color:var(--text-secondary)">正在收集并加密数据...</div>'; }

    try {
      const result = await window.electronAPI.dataExport(password);
      if (result.success) {
        const statsHtml = `
          <div class="data-export-success">
            <div style="font-size:18px;font-weight:600;color:var(--success-color);margin-bottom:8px;">✅ 导出成功</div>
            <div style="color:var(--text-secondary);margin-bottom:12px;">文件已保存，大小 ${result.fileSize}</div>
            <div class="data-stats-grid">
              <div class="data-stat"><span class="data-stat-value">${result.stats.tasks}</span><span class="data-stat-label">任务</span></div>
              <div class="data-stat"><span class="data-stat-value">${result.stats.memories}</span><span class="data-stat-label">记忆</span></div>
              <div class="data-stat"><span class="data-stat-value">${result.stats.notes}</span><span class="data-stat-label">笔记</span></div>
              <div class="data-stat"><span class="data-stat-value">${result.stats.atoms}</span><span class="data-stat-label">知识原子</span></div>
              <div class="data-stat"><span class="data-stat-value">${result.stats.clusters}</span><span class="data-stat-label">知识簇</span></div>
              <div class="data-stat"><span class="data-stat-value">${result.stats.articles}</span><span class="data-stat-label">文章</span></div>
              <div class="data-stat"><span class="data-stat-value">${result.stats.persons}</span><span class="data-stat-label">人物</span></div>
              <div class="data-stat"><span class="data-stat-value">${result.stats.projects}</span><span class="data-stat-label">项目</span></div>
            </div>
          </div>`;
        if (resultEl) resultEl.innerHTML = statsHtml;
        this.showToast('数据导出成功');
      } else {
        if (result.error !== '用户取消') {
          if (resultEl) resultEl.innerHTML = `<div style="color:var(--danger-color)">❌ 导出失败: ${this.escapeHtml(result.error)}</div>`;
          this.showToast('导出失败: ' + result.error, 'error');
        }
      }
    } catch (error) {
      if (resultEl) resultEl.innerHTML = `<div style="color:var(--danger-color)">❌ 导出异常: ${this.escapeHtml(error.message)}</div>`;
      this.showToast('导出异常', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📦 一键导出全部数据';
    }
  },

  async importDataFile() {
    const password = document.getElementById('importPassword')?.value;
    const resultEl = document.getElementById('importPreview');
    const confirmArea = document.getElementById('importConfirmArea');
    
    if (!password) { this.showToast('请输入解密密码', 'error'); return; }
    if (password.length < 4) { this.showToast('密码至少4位', 'error'); return; }

    const btn = document.getElementById('importDataBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 解密中...';
    if (resultEl) { resultEl.classList.remove('hidden'); resultEl.innerHTML = '<div style="color:var(--text-secondary)">正在解密并解析数据...</div>'; }
    if (confirmArea) confirmArea.classList.add('hidden');

    try {
      const result = await window.electronAPI.dataImport(password);
      if (result.success) {
        this._pendingImportData = result.importData;
        const s = result.stats;
        const statsHtml = `
          <div class="data-export-success">
            <div style="font-size:18px;font-weight:600;color:var(--primary-color);margin-bottom:8px;">✅ 文件解密成功</div>
            <div style="color:var(--text-secondary);margin-bottom:4px;">备份时间: ${s.exportedAt || '未知'}</div>
            <div class="data-stats-grid">
              <div class="data-stat"><span class="data-stat-value">${s.tasks}</span><span class="data-stat-label">任务</span></div>
              <div class="data-stat"><span class="data-stat-value">${s.memories}</span><span class="data-stat-label">记忆</span></div>
              <div class="data-stat"><span class="data-stat-value">${s.notes}</span><span class="data-stat-label">笔记</span></div>
              <div class="data-stat"><span class="data-stat-value">${s.atoms}</span><span class="data-stat-label">知识原子</span></div>
              <div class="data-stat"><span class="data-stat-value">${s.clusters}</span><span class="data-stat-label">知识簇</span></div>
              <div class="data-stat"><span class="data-stat-value">${s.articles}</span><span class="data-stat-label">文章</span></div>
              <div class="data-stat"><span class="data-stat-value">${s.persons}</span><span class="data-stat-label">人物</span></div>
              <div class="data-stat"><span class="data-stat-value">${s.projects}</span><span class="data-stat-label">项目</span></div>
            </div>
          </div>`;
        if (resultEl) resultEl.innerHTML = statsHtml;
        if (confirmArea) confirmArea.classList.remove('hidden');
      } else {
        if (result.error !== '用户取消') {
          if (resultEl) resultEl.innerHTML = `<div style="color:var(--danger-color)">❌ 导入失败: ${this.escapeHtml(result.error)}</div>`;
          this.showToast('导入失败: ' + result.error, 'error');
        }
      }
    } catch (error) {
      if (resultEl) resultEl.innerHTML = `<div style="color:var(--danger-color)">❌ 导入异常: ${this.escapeHtml(error.message)}</div>`;
      this.showToast('导入异常', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📥 选择文件并导入';
    }
  },

  async confirmImportData() {
    if (!this._pendingImportData) { this.showToast('没有待导入数据', 'error'); return; }

    const mergeMode = document.querySelector('input[name="importMode"]:checked')?.value || 'merge';
    const confirmArea = document.getElementById('importConfirmArea');
    const resultEl = document.getElementById('importPreview');

    try {
      confirmArea.innerHTML = '<div style="color:var(--text-secondary)">⏳ 正在导入数据...</div>';
      const result = await window.electronAPI.dataImportConfirm(this._pendingImportData, mergeMode);
      if (result.success) {
        const modeLabel = mergeMode === 'replace' ? '替换' : '合并';
        if (resultEl) resultEl.innerHTML += `<div style="margin-top:12px;padding:12px;background:rgba(52,199,89,0.1);border-radius:8px;color:var(--success-color);">✅ 数据${modeLabel}导入成功！</div>`;
        confirmArea.innerHTML = '';
        this.showToast(`数据${modeLabel}导入成功`);
        this._pendingImportData = null;
        // 刷新所有模块数据
        try {
          await this.initDatabaseSync();
          this.renderTaskList();
          this.loadMemories();
          this.loadNotes();
          await this.loadCustomCategories();
          this.renderCategoryList();
          this.loadProfileEditor();
          if (window.knowledgeFollow?.onShow) window.knowledgeFollow.onShow();
        } catch (e) {
          console.warn('[Import] 刷新部分模块失败:', e);
        }
      } else {
        confirmArea.innerHTML = `<div style="color:var(--danger-color)">❌ 导入失败: ${this.escapeHtml(result.error)}</div>`;
        this.showToast('导入失败: ' + result.error, 'error');
      }
    } catch (error) {
      confirmArea.innerHTML = `<div style="color:var(--danger-color)">❌ 导入异常: ${this.escapeHtml(error.message)}</div>`;
      this.showToast('导入异常', 'error');
    }
  },

  cancelImportData() {
    this._pendingImportData = null;
    const confirmArea = document.getElementById('importConfirmArea');
    const resultEl = document.getElementById('importPreview');
    if (confirmArea) confirmArea.classList.add('hidden');
    if (resultEl) { resultEl.classList.add('hidden'); resultEl.innerHTML = ''; }
  },

  _memoryPage: 0,
  _memoryPageSize: 30,
  _memoryHasMore: false,

  async loadMemories(append = false) {
    if (!window.electronAPI) return;
    
    // 加载统计信息
    const stats = await window.electronAPI.getMemoryStats();
    const statValues = document.querySelectorAll('#memoryStats .stat-chip .stat-value');
    if (statValues.length >= 4) {
      statValues[0].textContent = stats.total || 0;
      statValues[1].textContent = stats.byType?.short || 0;
      statValues[2].textContent = stats.byType?.long || 0;
      statValues[3].textContent = stats.entityCount || 0;
    }
    
    if (!append) this._memoryPage = 0;

    // 获取筛选类型
    const typeFilter = document.getElementById('memoryTypeFilter')?.value || 'all';
    const bizFilter = document.getElementById('memoryBusinessFilter')?.value || 'all';
    const options = { limit: this._memoryPageSize };
    if (typeFilter !== 'all') options.type = typeFilter;
    if (bizFilter !== 'all') options.business_category = bizFilter;

    // 加载记忆列表
    const result = await window.electronAPI.getMemories(options);
    const memoryList = document.getElementById('memoryList');
    
    // 计算是否还有更多（同时考虑类型和业务分类筛选）
    let totalCount = stats.total || 0;
    if (typeFilter !== 'all' && stats.byType) totalCount = stats.byType[typeFilter] || 0;
    if (bizFilter !== 'all' && stats.byBusinessCategory) {
      const bizCount = stats.byBusinessCategory[bizFilter] || 0;
      totalCount = (typeFilter !== 'all') ? Math.min(totalCount, bizCount) : bizCount;
    }
    const loadedCount = (append ? memoryList.children.length : 0) + (result.memories?.length || 0);
    this._memoryHasMore = loadedCount < totalCount;

    if (result.memories && result.memories.length > 0) {
      const html = result.memories.map(memory => {
        const confidence = memory.confidence !== undefined ? Math.round(memory.confidence * 100) : 0;
        const isTask = memory.metadata?.isTask || memory.category === 'task';
        const taskTitle = memory.metadata?.taskTitle;
        const reason = memory.metadata?.reason || memory.metadata?.preClassification?.reason;
        const bizCat = memory.business_category || 'other';
        const bizCatLabel = this.getBusinessCategoryLabel(bizCat);
        
        return `
          <div class="memory-item" data-id="${memory.id}" ondblclick="App.editMemory('${memory.id}')">
            <div class="memory-content">
              <div class="memory-text">${memory.content.substring(0, 150)}${memory.content.length > 150 ? '...' : ''}</div>
              ${taskTitle ? `<div class="memory-task-title">识别任务: ${taskTitle}</div>` : ''}
              ${reason ? `<div class="memory-reason">${reason}</div>` : ''}
              ${memory.metadata?.tags?.length ? `<div class="memory-tags">${memory.metadata.tags.map(t => `<span class="import-tag">${this.escapeHtml(t)}</span>`).join('')}</div>` : ''}
            </div>
            <div class="memory-meta">
              <span class="memory-type ${isTask ? 'task' : ''}">${this.getMemoryTypeLabel(memory.type)}</span>
              <span class="memory-category">${this.getMemoryCategoryLabel(memory.category)}</span>
              <span class="memory-business-category biz-${bizCat}">${bizCatLabel}</span>
              <div class="memory-confidence">
                <span class="confidence-label">信心值:</span>
                <span class="confidence-value" style="color: ${this.getConfidenceColor(memory.confidence)}">${confidence}%</span>
              </div>
              <span class="memory-date">${new Date(memory.createdAt).toLocaleString()}</span>
            </div>
            <div class="memory-actions">
              <button class="memory-reorganize" data-memory-id="${memory.id}" title="AI 整理此记忆">🧠</button>
              <button class="memory-delete" data-memory-id="${memory.id}">删除</button>
            </div>
          </div>
        `;
      }).join('');

      if (append) {
        memoryList.insertAdjacentHTML('beforeend', html);
      } else {
        memoryList.innerHTML = html;
      }
    } else if (!append) {
      memoryList.innerHTML = `<div class="empty-state">${window.i18n?.t('memory.empty') || '暂无记忆记录'}</div>`;
    }

    // 显示/隐藏加载更多
    const loadMoreEl = document.getElementById('memoryLoadMore');
    const countInfoEl = document.getElementById('memoryCountInfo');
    if (loadMoreEl) {
      loadMoreEl.classList.toggle('hidden', !this._memoryHasMore);
    }
    if (countInfoEl) {
      countInfoEl.textContent = `已显示 ${loadedCount} / ${totalCount} 条`;
    }

    // 事件委托：删除和整理按钮
    memoryList.onclick = (e) => {
      const delBtn = e.target.closest('.memory-delete');
      if (delBtn) { this.deleteMemory(delBtn.dataset.memoryId); return; }
      const reorgBtn = e.target.closest('.memory-reorganize');
      if (reorgBtn) { this.aiReorganizeSingleMemory(reorgBtn.dataset.memoryId); return; }
    };
  },

  getMemoryCategoryLabel(category) {
    const labels = {
      task: '任务',
      interest: '兴趣',
      person: '人物',
      project: '项目',
      goal: '目标',
      knowledge: '知识',
      action: '行动',
      clipboard: '剪贴板'
    };
    return labels[category] || category;
  },

  getBusinessCategoryLabel(bizCat) {
    const labels = {
      product: '产品',
      project: '项目',
      case: '案例',
      work: '工作',
      bidding: '投标',
      consulting: '咨询',
      solution: '方案',
      problem: '问题',
      badcase: 'badcase',
      requirement: '需求',
      customer: '客户情况',
      personal: '个人情况',
      other: '其他'
    };
    return labels[bizCat] || bizCat;
  },

  getConfidenceColor(confidence) {
    if (confidence >= 0.9) return '#34c759'; // green
    if (confidence >= 0.7) return '#ff9500'; // orange
    if (confidence > 0) return '#ff3b30'; // red
    return '#8e8e93'; // gray
  },

  getMemoryTypeLabel(type) {
    const labels = {
      instant: '瞬时',
      short: '短期',
      long: '长期'
    };
    return labels[type] || type;
  },

  async deleteMemory(id) {
    if (window.electronAPI) {
      await window.electronAPI.deleteMemory(id);
      this.loadMemories();
      this.showToast('记忆已删除');
    }
  },
  
  async clearAllMemories() {
    const confirmed = await this.showConfirmDialog('清空确认', '确定要清空所有记忆吗？此操作不可撤销！');
    if (!confirmed) return;
    if (window.electronAPI) {
      await window.electronAPI.clearAllMemories();
      this.loadMemories();
      this.showToast('所有记忆已清空');
    }
  },
  
  async addManualMemory() {
    const input = document.getElementById('manualMemoryInput').value.trim();
    if (!input) {
      this.showToast('请输入记忆内容', 'error');
      return;
    }
    
    const type = document.getElementById('manualMemoryType').value;
    const business_category = document.getElementById('manualMemoryBusinessCategory').value || 'other';
    const btn = document.getElementById('addManualMemoryBtn');
    if (btn) { btn.disabled = true; btn.textContent = '🧠 整理中...'; }
    
    try {
      if (window.electronAPI) {
        // 先调用 AI 整理
        const orgResult = await window.electronAPI.aiOrganizeMemory(input);

        if (orgResult.success && orgResult.organized) {
          const org = orgResult.organized;
          // 使用 AI 整理后的内容，但保留用户选择的 type 和 business_category 作为优先
          const finalType = type === 'long' ? 'long' : (org.memory_type || type);
          const finalBizCat = business_category !== 'other' ? business_category : (org.business_category || business_category);

          if (orgResult.action === 'replaced' || orgResult.action === 'merged') {
            // AI 判断需要覆盖/合并已有记忆
            const actionLabel = orgResult.action === 'replaced' ? '覆盖' : '合并';
            this.showToast(`AI 整理完成：${actionLabel}旧记忆`);
          } else {
            // 新记忆
            const result = await window.electronAPI.addMemory({
              content: org.organized_content,
              type: finalType,
              category: org.category || 'knowledge',
              business_category: finalBizCat,
              confidence: org.confidence || 0.8,
              metadata: {
                source: 'manual_ai_organized',
                tags: org.tags || [],
                key_points: org.key_points || [],
                original_content: input,
                created_at: new Date().toISOString()
              }
            });
            
            if (result.success) {
              let msg = 'AI 整理后已添加记忆';
              if (org.related_actions?.action_reason) {
                msg += `（${org.related_actions.action_reason}）`;
              }
              this.showToast(msg);
            } else {
              this.showToast('添加记忆失败', 'error');
            }
          }
        } else {
          // AI 整理失败，降级为直接添加
          console.warn('[Memory] AI organize failed, fallback to direct add:', orgResult.error);
          const result = await window.electronAPI.addMemory({
            content: input,
            type: type,
            category: 'knowledge',
            business_category: business_category,
            confidence: 1.0,
            metadata: {
              source: 'manual',
              ai_organize_failed: true,
              created_at: new Date().toISOString()
            }
          });
          
          if (result.success) {
            this.showToast('记忆已添加（AI 整理不可用，已直接保存）');
          } else {
            this.showToast('添加记忆失败', 'error');
          }
        }

        document.getElementById('manualMemoryInput').value = '';
        this.loadMemories();
      }
    } catch (error) {
      console.error('添加记忆失败:', error);
      this.showToast('添加记忆失败', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '添加记忆'; }
    }
  },

  // AI 整理后添加记忆
  async aiOrganizeAndAddMemory() {
    const input = document.getElementById('manualMemoryInput').value.trim();
    if (!input) {
      this.showToast('请输入记忆内容', 'error');
      return;
    }

    const btn = document.getElementById('aiOrganizeMemoryBtn');
    if (btn) { btn.disabled = true; btn.textContent = '🧠 整理中...'; }

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.aiOrganizeMemory(input);

        if (result.success && result.organized) {
          const org = result.organized;
          let actionMsg = '';
          if (result.action === 'replaced') {
            actionMsg = `\n\n🔄 已覆盖旧记忆（ID: ${result.replaced_id?.substring(0,8)}...）`;
          } else if (result.action === 'merged') {
            actionMsg = `\n\n🔄 已合并到旧记忆（ID: ${result.merged_id?.substring(0,8)}...）`;
          }

          if (result.action === 'new') {
            // 新记忆，直接添加
            const addResult = await window.electronAPI.addMemory({
              content: org.organized_content,
              type: org.memory_type || 'short',
              category: org.category || 'knowledge',
              business_category: org.business_category || 'other',
              confidence: org.confidence || 0.8,
              metadata: {
                source: 'manual_ai_organized',
                tags: org.tags || [],
                key_points: org.key_points || [],
                original_content: input,
                created_at: new Date().toISOString()
              }
            });
            if (addResult.success) {
              this.showToast('AI 整理后已添加记忆');
            }
          } else {
            this.showToast(`AI 整理完成：${result.action === 'replaced' ? '覆盖' : '合并'}旧记忆`);
          }

          if (org.related_actions?.action_reason) {
            actionMsg += `\n💡 原因：${org.related_actions.action_reason}`;
          }

          document.getElementById('manualMemoryInput').value = '';
          this.loadMemories();
        } else {
          this.showToast('AI 整理失败: ' + (result.error || '未知错误'), 'error');
        }
      }
    } catch (error) {
      console.error('AI 整理记忆失败:', error);
      this.showToast('AI 整理记忆失败', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🧠 AI 整理后添加'; }
    }
  },

  // AI 批量整理记忆
  async aiBatchOrganizeMemories() {
    const confirmed = await this.showConfirmDialog('AI 批量整理', '将分析最近 30 条记忆，找出需要合并、覆盖、重新分类的条目。确认继续？');
    if (!confirmed) return;

    const btn = document.getElementById('aiBatchOrganizeBtn');
    if (btn) { btn.disabled = true; btn.textContent = '🧠 分析中...'; }

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.aiBatchOrganizeMemories();

        if (result.success && result.result) {
          const r = result.result;
          const mergeCount = r.merge_groups?.length || 0;
          const replaceCount = r.replacements?.length || 0;
          const reclassifyCount = r.reclassify?.length || 0;
          const totalCount = mergeCount + replaceCount + reclassifyCount;

          if (totalCount === 0) {
            this.showToast('记忆已比较整洁，无需调整');
            if (btn) { btn.disabled = false; btn.textContent = '🧠 AI 批量整理'; }
            return;
          }

          // 构建预览弹窗
          let previewHtml = `<div class="ai-organize-preview">
            <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">分析 ${r.total_analyzed} 条记忆，发现 ${totalCount} 项优化建议：</p>`;

          if (mergeCount > 0) {
            previewHtml += `<div class="ai-organize-section"><strong>🔄 合并建议（${mergeCount}组）</strong>`;
            r.merge_groups.forEach((g, i) => {
              previewHtml += `<div class="ai-organize-item">
                <span class="import-tag">合并</span>
                <span>第 ${g.indices.join('、')} 条 → "${this.escapeHtml(g.merged_content?.substring(0, 60) || '')}..."</span>
                <span style="color:var(--text-tertiary);font-size:11px;">${this.escapeHtml(g.reason || '')}</span>
              </div>`;
            });
            previewHtml += '</div>';
          }

          if (replaceCount > 0) {
            previewHtml += `<div class="ai-organize-section"><strong>🔄 覆盖建议（${replaceCount}条）</strong>`;
            r.replacements.forEach((rep, i) => {
              previewHtml += `<div class="ai-organize-item">
                <span class="import-tag">覆盖</span>
                <span>第 ${rep.old_index} 条 → "${this.escapeHtml(rep.new_content?.substring(0, 60) || '')}..."</span>
                <span style="color:var(--text-tertiary);font-size:11px;">${this.escapeHtml(rep.reason || '')}</span>
              </div>`;
            });
            previewHtml += '</div>';
          }

          if (reclassifyCount > 0) {
            previewHtml += `<div class="ai-organize-section"><strong>🏷️ 分类纠正（${reclassifyCount}条）</strong>`;
            r.reclassify.forEach((rc, i) => {
              previewHtml += `<div class="ai-organize-item">
                <span class="import-tag">重分类</span>
                <span>第 ${rc.index} 条：${rc.old_type}/${rc.old_biz} → ${rc.new_type}/${rc.new_biz}</span>
                <span style="color:var(--text-tertiary);font-size:11px;">${this.escapeHtml(rc.reason || '')}</span>
              </div>`;
            });
            previewHtml += '</div>';
          }

          if (r.summary) {
            previewHtml += `<div style="margin-top:12px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13px;">💡 ${this.escapeHtml(r.summary)}</div>`;
          }

          previewHtml += `<div style="margin-top:16px;display:flex;gap:8px;">
            <button class="btn primary small" id="applyOrganizeBtn">✅ 应用所有变更</button>
            <button class="btn secondary small" id="cancelOrganizeBtn">取消</button>
          </div></div>`;

          // 显示预览（复用 profileImportPreview 区域的样式）
          const previewEl = document.getElementById('profileImportPreview');
          if (previewEl) {
            // 找到记忆面板来展示
            const memoryPanel = document.querySelector('#memoryPanel .memory-list-container');
            if (memoryPanel) {
              const existingPreview = memoryPanel.querySelector('.ai-organize-preview');
              if (existingPreview) existingPreview.remove();

              const previewDiv = document.createElement('div');
              previewDiv.className = 'ai-organize-preview-container';
              previewDiv.innerHTML = previewHtml;
              memoryPanel.insertBefore(previewDiv, memoryPanel.firstChild);

              // 按钮事件
              document.getElementById('applyOrganizeBtn')?.addEventListener('click', async () => {
                await this._applyBatchOrganizeResult(r);
                previewDiv.remove();
              });
              document.getElementById('cancelOrganizeBtn')?.addEventListener('click', () => {
                previewDiv.remove();
              });
            }
          }

          this.showToast(`分析完成，发现 ${totalCount} 项优化建议`);
        } else {
          this.showToast('AI 批量整理失败: ' + (result.error || '未知错误'), 'error');
        }
      }
    } catch (error) {
      console.error('AI 批量整理失败:', error);
      this.showToast('AI 批量整理失败', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🧠 AI 批量整理'; }
    }
  },

  // 应用批量整理结果
  async _applyBatchOrganizeResult(result) {
    let applied = 0;

    try {
      // 处理合并
      for (const group of result.merge_groups || []) {
        if (group.memoryIds?.length >= 2) {
          // 用第一记忆保存合并内容，删除其余
          await window.electronAPI.updateMemory(group.memoryIds[0], {
            content: group.merged_content,
            type: group.type,
            business_category: group.business_category,
            metadata: { merged_at: new Date().toISOString(), merge_reason: group.reason }
          });
          for (let i = 1; i < group.memoryIds.length; i++) {
            await window.electronAPI.deleteMemory(group.memoryIds[i]);
          }
          applied++;
        }
      }

      // 处理覆盖
      for (const rep of result.replacements || []) {
        if (rep.memoryId) {
          await window.electronAPI.updateMemory(rep.memoryId, {
            content: rep.new_content,
            metadata: { replaced_at: new Date().toISOString(), replace_reason: rep.reason }
          });
          applied++;
        }
      }

      // 处理重分类
      for (const rc of result.reclassify || []) {
        if (rc.memoryId) {
          await window.electronAPI.updateMemory(rc.memoryId, {
            type: rc.new_type,
            business_category: rc.new_biz,
            metadata: { reclassified_at: new Date().toISOString(), reclassify_reason: rc.reason }
          });
          applied++;
        }
      }

      this.showToast(`已应用 ${applied} 项变更`);
      this.loadMemories();
    } catch (error) {
      console.error('应用整理结果失败:', error);
      this.showToast('应用部分变更失败', 'error');
      this.loadMemories();
    }
  },

  // AI 整理单条记忆
  async aiReorganizeSingleMemory(id) {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.getMemories({ limit: 200 });
    const memory = result.memories?.find(m => m.id === id);
    if (!memory) { this.showToast('记忆不存在', 'error'); return; }

    this.showToast('正在 AI 整理...', 'info');
    try {
      const orgResult = await window.electronAPI.aiOrganizeMemory(memory.content);
      if (orgResult.success && orgResult.organized) {
        const org = orgResult.organized;
        await window.electronAPI.updateMemory(id, {
          content: org.organized_content,
          type: org.memory_type,
          business_category: org.business_category,
          category: org.category,
          confidence: org.confidence,
          metadata: {
            ...(memory.metadata || {}),
            tags: org.tags || [],
            key_points: org.key_points || [],
            reorganized_at: new Date().toISOString()
          }
        });
        this.showToast('记忆已整理更新');
        this.loadMemories();
      } else {
        this.showToast('AI 整理失败: ' + (orgResult.error || '未知错误'), 'error');
      }
    } catch (error) {
      console.error('AI 整理记忆失败:', error);
      this.showToast('AI 整理失败', 'error');
    }
  },

  async editMemory(id) {
    if (!window.electronAPI) return;
    
    const result = await window.electronAPI.getMemories({ limit: 100 });
    const memory = result.memories?.find(m => m.id === id);
    
    if (!memory) {
      this.showToast('记忆不存在', 'error');
      return;
    }
    
    const newContent = prompt('编辑记忆内容:', memory.content);
    if (newContent === null || newContent.trim() === '') return;
    
    try {
      const updateResult = await window.electronAPI.updateMemory(id, {
        content: newContent.trim(),
        updatedAt: new Date().toISOString()
      });
      
      if (updateResult.success) {
        this.showToast('记忆已更新');
        this.loadMemories();
      } else {
        this.showToast('更新记忆失败', 'error');
      }
    } catch (error) {
      console.error('更新记忆失败:', error);
      this.showToast('更新记忆失败', 'error');
    }
  },

  // ========== 记事本方法 ==========
  
  async loadNotes(category = 'all') {
    if (!window.electronAPI) return;
    
    // 加载统计信息
    const stats = await window.electronAPI.notebookGetStats();
    document.getElementById('noteCount').textContent = stats.total || 0;
    document.getElementById('analyzedCount').textContent = stats.analyzedCount || 0;
    
    // 加载笔记列表
    const result = await window.electronAPI.notebookGetNotes(category);
    const noteList = document.getElementById('notebookList');
    
    if (result.notes && result.notes.length > 0) {
      noteList.innerHTML = result.notes.map(note => {
        // 图片检测：纯图片笔记 或 图文混合笔记
        const isPureImage = note.category === 'image';
        const hasImage = !!note.imagePath;
        const imageThumbnail = hasImage
          ? `<div class="note-image-thumb" data-image-path="${this.escapeHtml(note.imagePath)}" title="双击查看大图">
               <div class="note-image-placeholder">🖼️ 加载中...</div>
             </div>`
          : '';
        // 折叠视图：有 htmlContent 时使用富文本（含图片），否则纯文本
        const hasHtmlContent = note.htmlContent && note.htmlContent.trim();
        const contentPreview = isPureImage
          ? `<p class="note-content">${this.escapeHtml(note.content.substring(0, 200))}</p>`
          : hasHtmlContent
          ? `<div class="note-content note-rich-preview">${note.htmlContent}</div>`
          : `<p class="note-content">${this.escapeHtml(note.content.substring(0, 200))}${note.content.length > 200 ? '...' : ''}</p>`;
        // 预览区内容：优先使用 htmlContent 富文本
        const previewInnerContent = (note.htmlContent && note.htmlContent.trim())
          ? `<div class="note-rich-text">${note.htmlContent}</div>`
          : this.escapeHtml(note.content);
        // 预览区：图文混合时同时展示文本和图片
        const notePreview = isPureImage
          ? `<div class="note-preview hidden" id="note-preview-${note.id}">
               <div class="note-preview-image" data-image-path="${this.escapeHtml(note.imagePath)}"></div>
               <div class="note-preview-hint">双击图片可放大</div>
             </div>`
          : hasImage
          ? `<div class="note-preview hidden" id="note-preview-${note.id}">
               <div class="note-preview-content" contenteditable="false" data-note-id="${note.id}">${previewInnerContent}</div>
               <div class="note-preview-image" data-image-path="${this.escapeHtml(note.imagePath)}"></div>
               <div class="note-preview-hint">点击复制文本 | 双击编辑</div>
             </div>`
          : `<div class="note-preview hidden" id="note-preview-${note.id}">
               <div class="note-preview-content" contenteditable="false" data-note-id="${note.id}">${previewInnerContent}</div>
               <div class="note-preview-hint">点击复制 | 双击编辑</div>
             </div>`;
        // 纯图片笔记隐藏"转为待办"和"提炼记忆"按钮
        const imageActions = isPureImage
          ? `<button class="note-btn note-btn-edit" data-action="edit" title="编辑笔记">✏️</button>
             <button class="note-btn note-btn-download" data-action="download" title="下载图片">📥</button>
             <button class="note-btn note-btn-danger" data-action="delete" title="删除笔记">🗑️</button>`
          : `<button class="note-btn note-btn-edit" data-action="edit" title="编辑笔记">✏️</button>
             <button class="note-btn note-btn-download" data-action="download" title="下载为 Markdown">📥</button>
             <button class="note-btn note-btn-primary" data-action="convert" title="转为待办任务">✅</button>
             <button class="note-btn note-btn-secondary" data-action="extract" title="提炼记忆">🧠</button>
             <button class="note-btn note-btn-danger" data-action="delete" title="删除笔记">🗑️</button>`;

        return `
        <div class="note-item ${isPureImage ? 'note-item-image' : ''} ${hasImage ? 'note-item-has-image' : ''}" data-id="${note.id}" data-category="${note.category}" data-content-length="${note.content.length}" draggable="true">
          <input type="checkbox" class="note-checkbox" data-note-id="${note.id}">
          <div class="note-drag-handle" title="拖拽到左侧分类可修改分类">⠿</div>
          <div class="note-body">
            ${imageThumbnail}
            <div class="note-header">
              <h3 class="note-title">${this.escapeHtml(note.title)}</h3>
              <span class="note-category note-category-clickable" data-id="${note.id}" data-category="${note.category}" title="点击修改分类">${this.getNoteCategoryLabel(note.category)}</span>
            </div>
            ${contentPreview}
            ${notePreview}
            <div class="note-footer">
              <span class="note-date">${new Date(note.createdAt).toLocaleString()}</span>
              ${note.analyzed ? '<span class="note-analyzed">已分析</span>' : ''}
              ${this.getAnalysisStatusTag(note)}
              <div class="note-actions">
                ${imageActions}
              </div>
            </div>
          </div>
        </div>`;
      }).join('');
      this.bindNoteDragEvents();
      this.bindNoteCheckboxEvents();
      // 异步加载图片缩略图
      this._loadNoteImageThumbnails(noteList);
    } else {
      noteList.innerHTML = `<div class="empty-state">${window.i18n?.t('notebook.empty') || '暂无笔记'}</div>`;
      this.hideNotebookBatchBar();
    }
  },
  
  // 异步加载图片笔记缩略图（避免阻塞列表渲染）
  async _loadNoteImageThumbnails(container) {
    const thumbs = container.querySelectorAll('.note-image-thumb[data-image-path]');
    for (const thumb of thumbs) {
      try {
        const imagePath = thumb.dataset.imagePath;
        const result = await window.electronAPI?.notebookGetImage?.(imagePath);
        if (result?.success && result.dataUrl) {
          thumb.innerHTML = `<img src="${result.dataUrl}" alt="剪贴板图片" style="max-width:100%;max-height:200px;border-radius:8px;cursor:pointer;">`;
        } else {
          thumb.innerHTML = `<div class="note-image-placeholder">🖼️ 图片加载失败</div>`;
        }
      } catch (e) {
        thumb.innerHTML = `<div class="note-image-placeholder">🖼️ 加载失败</div>`;
      }
    }
    // 展开预览时也加载大图
    const previews = container.querySelectorAll('.note-preview-image[data-image-path]');
    for (const preview of previews) {
      try {
        const imagePath = preview.dataset.imagePath;
        const result = await window.electronAPI?.notebookGetImage?.(imagePath);
        if (result?.success && result.dataUrl) {
          preview.innerHTML = `<img src="${result.dataUrl}" alt="剪贴板图片" style="max-width:100%;border-radius:8px;">`;
        }
      } catch {}
    }
  },

  // 切换笔记预览展开/收起
  toggleNotePreview(noteId) {
    const preview = document.getElementById(`note-preview-${noteId}`);
    if (preview) {
      preview.classList.toggle('hidden');
    }
  },

  // 全屏查看图片笔记
  async openImageModal(noteId) {
    const note = this._findNoteById(noteId);
    if (!note || !note.imagePath) return;

    let overlay = document.getElementById('imageViewerOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'imageViewerOverlay';
      overlay.className = 'image-viewer-overlay';
      overlay.innerHTML = `
        <div class="image-viewer-backdrop"></div>
        <div class="image-viewer-container">
          <img id="imageViewerImg" class="image-viewer-img" alt="图片预览">
          <div class="image-viewer-toolbar">
            <span id="imageViewerTitle" class="image-viewer-title"></span>
            <div class="image-viewer-actions">
              <button class="image-viewer-btn" id="imageViewerZoomIn" title="放大">🔍+</button>
              <button class="image-viewer-btn" id="imageViewerZoomOut" title="缩小">🔍-</button>
              <button class="image-viewer-btn" id="imageViewerReset" title="还原">↺</button>
              <button class="image-viewer-btn image-viewer-close-btn" id="imageViewerClose" title="关闭">✕</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      // 事件绑定（只绑定一次）
      overlay.querySelector('.image-viewer-backdrop').addEventListener('click', () => this.closeImageModal());
      overlay.querySelector('#imageViewerClose').addEventListener('click', () => this.closeImageModal());
      overlay.querySelector('#imageViewerZoomIn').addEventListener('click', () => {
        const img = document.getElementById('imageViewerImg');
        img.style.transform = `scale(${Math.min(parseFloat(img.style.transform?.replace('scale(','').replace(')','') || 1) * 1.25, 5)})`;
      });
      overlay.querySelector('#imageViewerZoomOut').addEventListener('click', () => {
        const img = document.getElementById('imageViewerImg');
        img.style.transform = `scale(${Math.max(parseFloat(img.style.transform?.replace('scale(','').replace(')','') || 1) * 0.8, 0.25)})`;
      });
      overlay.querySelector('#imageViewerReset').addEventListener('click', () => {
        document.getElementById('imageViewerImg').style.transform = 'scale(1)';
      });
      // ESC 关闭
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
          this.closeImageModal();
        }
      });
    }

    // 加载图片
    const imgEl = document.getElementById('imageViewerImg');
    imgEl.style.transform = 'scale(1)';
    imgEl.src = '';
    document.getElementById('imageViewerTitle').textContent = note.title || '图片预览';

    try {
      const result = await window.electronAPI?.notebookGetImage?.(note.imagePath);
      if (result?.success && result.dataUrl) {
        imgEl.src = result.dataUrl;
      } else {
        imgEl.src = '';
        document.getElementById('imageViewerTitle').textContent = '图片加载失败';
      }
    } catch {
      document.getElementById('imageViewerTitle').textContent = '图片加载失败';
    }

    overlay.classList.remove('hidden');
  },

  closeImageModal() {
    const overlay = document.getElementById('imageViewerOverlay');
    if (overlay) overlay.classList.add('hidden');
  },

  _findNoteById(noteId) {
    // 从当前显示的笔记列表 DOM 中获取笔记数据
    const noteItem = document.querySelector(`.note-item[data-id="${noteId}"]`);
    if (!noteItem) return null;
    return {
      id: noteItem.dataset.id,
      category: noteItem.dataset.category,
      imagePath: noteItem.querySelector('[data-image-path]')?.dataset.imagePath,
      title: noteItem.querySelector('.note-title')?.textContent
    };
  },

  getAnalysisStatusTag(note) {
    if (!note.analysis) return '';
    let tags = '';
    const status = note.analysis.status;
    
    // SMART 标签（优先展示）
    const smartLevel = note.analysis.smartLevel;
    if (smartLevel === 'smart_full') {
      tags += '<span class="note-status-tag tag-smart-full" title="SMART五要素齐全">SMART</span>';
    } else if (smartLevel === 'smart_partial') {
      const missing = note.analysis.smartMissing || [];
      tags += `<span class="note-status-tag tag-smart-partial" title="缺少: ${missing.join(', ')}">待完善</span>`;
    } else if (smartLevel === 'smart_insufficient') {
      const missing = note.analysis.smartMissing || [];
      tags += `<span class="note-status-tag tag-smart-insufficient" title="缺少: ${missing.join(', ')}">信息不全</span>`;
    }
    
    if (!status) {
      // 兼容旧数据：根据已有字段推断状态
      if (note.analysis.hasRecommendation) tags += '<span class="note-status-tag tag-recommended">已推荐知识</span>';
      else if (note.analysis.isTask) tags += '<span class="note-status-tag tag-task">已创建待办</span>';
      else if (note.analyzed) tags += '<span class="note-status-tag tag-analyzed">已分析</span>';
      return tags;
    }
    const tagMap = {
      '闲聊': 'note-status-tag tag-chat',
      '无需推荐': 'note-status-tag tag-skip',
      '识别为待办': 'note-status-tag tag-task',
      '已创建待办': 'note-status-tag tag-task',
      '已推荐知识': 'note-status-tag tag-recommended',
      '已提炼记忆': 'note-status-tag tag-memory'
    };
    const cls = tagMap[status] || 'note-status-tag tag-skip';
    tags += `<span class="${cls}">${status}</span>`;
    return tags;
  },

  getNoteCategoryLabel(category) {
    const customCategories = this._customCategories || {};
    if (customCategories[category]) {
      return customCategories[category].label || category;
    }
    // 优先使用 i18n 翻译
    const i18nKey = `notebook.category.${category}`;
    const i18nText = window.i18n?.t(i18nKey);
    if (i18nText && i18nText !== i18nKey) return i18nText;
    // 回退硬编码
    const defaultLabels = {
      image: '🖼️ 图片',
      voice: '🎤 语音数据',
      meeting: '会议记录',
      feedback: '问题反馈',
      task: '待办任务',
      idea: '想法创意',
      general: '其他'
    };
    return defaultLabels[category] || category;
  },

  // 获取所有分类列表（合并默认 + 自定义）
  getAllCategories() {
    const i = window.i18n;
    const defaults = [
      { key: 'image', label: '🖼️ 图片' },
      { key: 'voice', label: '🎤 语音数据' },
      { key: 'meeting', label: i?.t('notebook.category.meeting') || '会议记录' },
      { key: 'feedback', label: i?.t('notebook.category.feedback') || '问题反馈' },
      { key: 'task', label: i?.t('notebook.category.task') || '待办任务' },
      { key: 'idea', label: i?.t('notebook.category.idea') || '想法创意' },
      { key: 'general', label: i?.t('notebook.category.general') || '其他' }
    ];
    const customCategories = this._customCategories || {};
    // 合并：默认分类可被自定义覆盖 label，自定义分类追加
    const merged = {};
    defaults.forEach(cat => {
      merged[cat.key] = { key: cat.key, label: cat.label, isDefault: true };
    });
    Object.entries(customCategories).forEach(([key, val]) => {
      if (merged[key]) {
        // 覆盖默认分类的 label
        merged[key].label = val.label;
      } else {
        merged[key] = { key, label: val.label, isDefault: false };
      }
    });
    // 保持默认顺序在前，自定义在后
    const result = [];
    defaults.forEach(cat => { result.push(merged[cat.key]); });
    Object.values(merged).filter(c => !c.isDefault).forEach(c => result.push(c));
    return result;
  },

  // 加载自定义分类配置
  async loadCustomCategories() {
    try {
      if (window.electronAPI && window.electronAPI.notebookGetCategories) {
        const result = await window.electronAPI.notebookGetCategories();
        this._customCategories = result.categories || {};
      } else {
        this._customCategories = {};
      }
    } catch (e) {
      this._customCategories = {};
    }
  },

  // 保存自定义分类配置
  async saveCustomCategories() {
    try {
      if (window.electronAPI && window.electronAPI.notebookSaveCategories) {
        await window.electronAPI.notebookSaveCategories(this._customCategories || {});
      }
    } catch (e) {
      console.error('保存分类配置失败:', e);
    }
  },

  // 重绘侧边栏分类列表
  renderCategoryList() {
    const categoryListEl = document.querySelector('.category-list');
    if (!categoryListEl) return;

    const i = window.i18n;
    const allCategories = this.getAllCategories();
    const activeItem = document.querySelector('.category-item.active');
    const activeCategory = activeItem ? activeItem.dataset.category : 'all';

    let html = `<div class="category-item ${activeCategory === 'all' ? 'active' : ''}" data-category="all" role="button" tabindex="0">${i?.t('notebook.allNotes') || '全部'}</div>`;
    allCategories.forEach(cat => {
      html += `
        <div class="category-item-wrapper" data-category="${cat.key}">
          <div class="category-item ${activeCategory === cat.key ? 'active' : ''}" data-category="${cat.key}" role="button" tabindex="0">${cat.label}</div>
          <button class="category-edit" data-category="${cat.key}" title="${i?.t('notebook.category.edit') || '重命名'}">✏️</button>
          <button class="category-delete" data-category="${cat.key}" title="${i?.t('common.delete') || '删除'}${cat.label}">🗑️</button>
        </div>`;
    });
    html += `<div class="category-add-btn" role="button" tabindex="0" title="${i?.t('notebook.category.add') || '新增分类'}">${i?.t('notebook.category.add') || '＋ 新增分类'}</div>`;
    categoryListEl.innerHTML = html;

    // 重新绑定事件
    this.bindCategoryEvents();
  },

  // 绑定侧边栏分类事件（事件委托模式，避免重新渲染时重复绑定）
  bindCategoryEvents() {
    const categoryList = document.getElementById('notebookCategoryList') || document.querySelector('.category-list');
    if (!categoryList) return;

    // 事件委托：统一处理分类点击、删除、编辑
    categoryList.onclick = (e) => {
      // 删除按钮
      const delBtn = e.target.closest('.category-delete');
      if (delBtn) {
        e.stopPropagation();
        this.deleteNotesByCategory(delBtn.dataset.category);
        return;
      }
      // 编辑按钮
      const editBtn = e.target.closest('.category-edit');
      if (editBtn) {
        e.stopPropagation();
        this.renameCategory(editBtn.dataset.category);
        return;
      }
      // 新增分类按钮
      if (e.target.closest('.category-add-btn')) {
        e.stopPropagation();
        this.addCustomCategory();
        return;
      }
      // 分类项点击
      const catItem = e.target.closest('.category-item');
      if (catItem) {
        document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
        catItem.classList.add('active');
        this.loadNotes(catItem.dataset.category);
        return;
      }
    };

    // 重新绑定拖放目标
    this.bindCategoryDropTargets();
  },

  // 新增自定义分类
  async addCustomCategory() {
    const name = await this.showInputDialog('新增分类', '请输入新分类名称：');
    if (!name || !name.trim()) return;

    const key = 'custom_' + Date.now();
    if (!this._customCategories) this._customCategories = {};
    this._customCategories[key] = { label: name.trim() };
    await this.saveCustomCategories();
    this.renderCategoryList();
    this.showToast(`已添加分类「${name.trim()}」`, 'success');
  },

  // 重命名分类
  async renameCategory(category) {
    const currentLabel = this.getNoteCategoryLabel(category);
    const newName = await this.showInputDialog('重命名分类', '请输入新的分类名称：', currentLabel);
    if (!newName || !newName.trim() || newName.trim() === currentLabel) return;

    if (!this._customCategories) this._customCategories = {};
    this._customCategories[category] = { label: newName.trim() };
    await this.saveCustomCategories();
    this.renderCategoryList();
    this.showToast(`分类已重命名为「${newName.trim()}」`, 'success');
    // 刷新笔记列表中的分类标签
    const activeCat = document.querySelector('.category-item.active')?.dataset.category || 'all';
    this.loadNotes(activeCat);
  },

  async addNote() {
    this._noteEditorMode = 'add';
    this._noteEditorTargetId = null;
    // 清空标题输入
    const titleInput = document.getElementById('noteEditorTitleInput');
    if (titleInput) titleInput.value = '';
    this.showNoteEditorModal('新建笔记', '');
  },
  
  showNoteEditorModal(title, content, noteTitle) {
    document.getElementById('noteEditorTitle').textContent = title || '新建笔记';
    // 设置标题输入框
    const titleInput = document.getElementById('noteEditorTitleInput');
    if (titleInput) {
      titleInput.value = noteTitle || '';
    }
    const container = document.getElementById('noteEditorContainer');
    
    // 初始化编辑器
    if (this._noteEditor) {
      this._noteEditor.destroy();
    }
    if (window.RichEditor) {
      this._noteEditor = new window.RichEditor(container, {
        placeholder: '输入笔记内容，按 Tab 键 AI 续写 ✨',
        minHeight: 200,
        maxHeight: 500,
      });
      if (content) {
        this._noteEditor.setText(content);
      }
    }
    
    document.getElementById('noteEditorModal')?.classList.remove('hidden');
    if (this._noteEditor) this._noteEditor.focus();
  },
  
  hideNoteEditorModal() {
    document.getElementById('noteEditorModal')?.classList.add('hidden');
    if (this._noteEditor) {
      this._noteEditor.destroy();
      this._noteEditor = null;
    }
  },
  
  async saveNoteFromEditor() {
    if (!this._noteEditor) return;
    
    const text = this._noteEditor.getText().trim();
    if (!text) {
      this.showToast('请输入笔记内容', 'error');
      return;
    }
    
    const html = this._noteEditor.getHTML();
    // 从标题输入框读取用户自定义标题，为空则用首行内容
    const titleInput = document.getElementById('noteEditorTitleInput');
    const customTitle = titleInput ? titleInput.value.trim() : '';
    const noteTitle = customTitle || this.extractNoteTitle(text);
    
    try {
      if (window.electronAPI) {
        if (this._noteEditorMode === 'add') {
          const category = this.autoClassifyNote(text);
          const result = await window.electronAPI.notebookAddNote({
            content: text,
            title: noteTitle,
            htmlContent: html,
            category: category
          });
          
          if (result.success) {
            if (result.duplicate) {
              this.showToast('今天已有相同内容，已跳过', 'info');
            } else {
              this.incrementNewNoteCount();
              this.showToast(`笔记已添加（${this.getNoteCategoryLabel(category)}）`);
            }
          }
        } else if (this._noteEditorMode === 'edit' && this._noteEditorTargetId) {
          await this.updateNoteContent(this._noteEditorTargetId, text, html, noteTitle);
        }
        this.hideNoteEditorModal();
        this.loadNotes();
      }
    } catch (error) {
      console.error('保存笔记失败:', error);
      this.showToast('保存笔记失败', 'error');
    }
  },
  
  autoClassifyNote(content) {
    // 会议相关
    if (content.includes('会议') || content.includes('讨论') || content.includes('沟通') || 
        content.includes('meeting') || content.includes('讨论记录')) {
      return 'meeting';
    }
    // 问题反馈相关
    if (content.includes('问题') || content.includes('反馈') || content.includes('bug') || 
        content.includes('报错') || content.includes('异常') || content.includes('修复')) {
      return 'feedback';
    }
    // 待办任务相关
    if (content.includes('待办') || content.includes('任务') || content.includes('需要') || 
        content.includes('应该') || content.includes('必须') || content.includes('计划')) {
      return 'task';
    }
    // 想法创意相关
    if (content.includes('想法') || content.includes('创意') || content.includes('思路') || 
        content.includes('方案') || content.includes('建议')) {
      return 'idea';
    }
    // 默认分类
    return 'general';
  },

  async deleteNote(id) {
    // 让用户选择删除原因，用于 AI prompt 持续优化
    const reasons = [
      { value: 'should_not_save', label: '不该保存（闲聊/无效内容）' },
      { value: 'wrong_category', label: '分类错误' },
      { value: 'duplicate', label: '重复内容' },
      { value: 'no_longer_needed', label: '不再需要' },
      { value: 'other', label: '其他原因' }
    ];
    const reasonLabels = reasons.map(r => r.label).join('\n');
    const note = this.notesCache ? this.notesCache.find(n => n.id === id) : null;
    const notePreview = note ? note.content?.substring(0, 30) + '...' : '';
    
    const selected = await this.showDeleteReasonDialog(notePreview, reasons);
    const reason = selected || 'no_reason';
    
    if (window.electronAPI) {
      await window.electronAPI.notebookDeleteNote(id, reason);
      this.loadNotes();
      this.showToast('笔记已删除，反馈已记录');
    }
  },
  
  showDeleteReasonDialog(notePreview, reasons) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      overlay.innerHTML = `
        <div class="dialog-card delete-reason-dialog">
          <h3>删除笔记</h3>
          ${notePreview ? `<p class="delete-note-preview">${notePreview}</p>` : ''}
          <p class="delete-reason-hint">选择删除原因，帮助 AI 更好地识别内容</p>
          <div class="delete-reason-list">
            ${reasons.map((r, i) => `
              <button class="delete-reason-btn" data-reason="${r.value}">
                ${r.label}
              </button>
            `).join('')}
          </div>
          <button class="delete-reason-cancel">取消</button>
        </div>
      `;
      
      overlay.addEventListener('click', (e) => {
        const btn = e.target.closest('.delete-reason-btn');
        if (btn) {
          overlay.remove();
          resolve(btn.dataset.reason);
          return;
        }
        if (e.target.closest('.delete-reason-cancel')) {
          overlay.remove();
          resolve(null);
        }
      });
      
      document.body.appendChild(overlay);
    });
  },
  
  async deleteNotesByCategory(category) {
    const confirmed = await this.showConfirmDialog('删除确认', `确定要删除所有"${this.getNoteCategoryLabel(category)}"类别的笔记吗？此操作不可撤销！`);
    if (!confirmed) return;
    if (window.electronAPI) {
      const result = await window.electronAPI.notebookDeleteNotesByCategory(category);
      if (result.success) {
        this.loadNotes();
        this.showToast(`已删除所有${this.getNoteCategoryLabel(category)}笔记`);
      } else {
        this.showToast('删除失败', 'error');
      }
    }
  },
  
  updateNotebookBadge(count) {
    const badge = document.getElementById('notebookBadge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  },
  
  // 增加新笔记角标计数（不在记事本页时调用）

  // 修改笔记分类
  // 修改笔记分类（浮层菜单）

  // ============ 拖拽改分类 ============

  // 当前拖拽的笔记ID
  _dragNoteId: null,
  _dragNoteCategory: null,

  // 事件委托已在 bindEvents() 中绑定，无需逐元素绑定
  bindNoteDragEvents() {},

  // 事件委托已在 bindEvents() 中绑定，无需逐元素绑定
  bindCategoryDropTargets() {},

  // ===== 记事本批量选择与发送给 ADP =====

  // 事件委托已在 bindEvents() 中绑定，无需逐元素绑定
  bindNoteCheckboxEvents() {},

  // 更新批量操作工具栏状态
  updateNotebookBatchBar() {
    const selectedCount = document.querySelectorAll('.note-checkbox:checked').length;
    const batchBar = document.getElementById('notebookBatchBar');
    const batchCount = document.getElementById('notebookBatchCount');
    const selectAllCb = document.getElementById('notebookSelectAll');

    if (selectedCount > 0) {
      batchBar?.classList.remove('hidden');
      if (batchCount) batchCount.textContent = `已选 ${selectedCount} 项`;
    } else {
      batchBar?.classList.add('hidden');
    }

    // 更新全选状态
    const totalCheckboxes = document.querySelectorAll('.note-checkbox').length;
    if (selectAllCb) {
      selectAllCb.checked = selectedCount > 0 && selectedCount === totalCheckboxes;
      selectAllCb.indeterminate = selectedCount > 0 && selectedCount < totalCheckboxes;
    }
  },

  // 隐藏批量操作工具栏
  hideNotebookBatchBar() {
    document.getElementById('notebookBatchBar')?.classList.add('hidden');
    const selectAllCb = document.getElementById('notebookSelectAll');
    if (selectAllCb) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
    }
  },

  /** 下载单条笔记为 Markdown */
  async downloadNoteAsMarkdown(noteId) {
    try {
      const result = await window.electronAPI?.notebookExportMarkdown({
        noteIds: [noteId],
        defaultName: `note-${noteId.substring(0, 8)}.md`
      });
      if (result?.canceled) return;
      if (result?.success) {
        this.showToast(`已导出到 ${result.filePath}`);
      } else {
        this.showToast(result?.error || '导出失败', 'error');
      }
    } catch (e) {
      console.error('[App] Download note error:', e);
      this.showToast('导出出错', 'error');
    }
  },

  /** 批量下载选中笔记为 Markdown */
  async downloadSelectedNotes() {
    const selectedCheckboxes = document.querySelectorAll('.note-checkbox:checked');
    if (selectedCheckboxes.length === 0) {
      this.showToast('请先选择要下载的记事项', 'warning');
      return;
    }

    const noteIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.noteId);
    try {
      const result = await window.electronAPI?.notebookExportMarkdown({
        noteIds,
        defaultName: `notes-${noteIds.length}条-${new Date().toISOString().slice(0, 10)}.md`
      });
      if (result?.canceled) return;
      if (result?.success) {
        this.showToast(`已导出 ${result.count} 条笔记到 ${result.filePath}`);
        // 清除选中状态
        selectedCheckboxes.forEach(cb => {
          cb.checked = false;
          cb.closest('.note-item')?.classList.remove('note-selected');
        });
        this.hideNotebookBatchBar();
      } else {
        this.showToast(result?.error || '导出失败', 'error');
      }
    } catch (e) {
      console.error('[App] Batch download error:', e);
      this.showToast('导出出错', 'error');
    }
  },

  // 将选中的记事项发送给 ADP 小助手
  async sendSelectedNotesToADP() {
    const selectedCheckboxes = document.querySelectorAll('.note-checkbox:checked');
    if (selectedCheckboxes.length === 0) {
      this.showToast('请先选择要发送的记事项', 'warning');
      return;
    }

    // Step 1: 先记录选中的 noteId，再清除选中状态
    const noteIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.noteId);
    console.log('[App] sendSelectedNotesToADP: selected', noteIds.length, 'notes');
    selectedCheckboxes.forEach(cb => {
      cb.checked = false;
      cb.closest('.note-item')?.classList.remove('note-selected');
    });
    this.hideNotebookBatchBar();

    // Step 2: 先异步收集笔记内容（在当前 notebook 视图下完成，避免异步问题）
    const notesData = [];
    for (const noteId of noteIds) {
      try {
        const result = await window.electronAPI.notebookGetNote(noteId);
        if (result.note) {
          notesData.push({
            id: result.note.id,
            title: result.note.title,
            content: result.note.content,
            category: result.note.category,
            createdAt: result.note.createdAt
          });
        }
      } catch (err) {
        console.error('[App] Failed to get note:', noteId, err);
      }
    }

    if (notesData.length === 0) {
      this.showToast('获取笔记内容失败', 'error');
      return;
    }

    // Step 3: 构建合并文本
    const combinedText = notesData.map(n => `## ${n.title}\n${n.content}`).join('\n\n---\n\n');
    const totalLength = combinedText.length;

    // Step 4: 准备好输入数据（短文本内容 or MD 文件附件）
    let inputText = '';
    if (totalLength <= 500) {
      inputText = `请帮我总结分析以下笔记内容：\n\n${combinedText}`;
    } else {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
      const fileName = `笔记汇总_${dateStr}_${timeStr}.md`;
      const mdContent = `# 笔记汇总\n\n> 生成时间：${now.toLocaleString('zh-CN')}\n> 来源：${notesData.length} 条记事项\n\n---\n\n${combinedText}`;
      const blob = new Blob([mdContent], { type: 'text/markdown' });
      const file = new File([blob], fileName, { type: 'text/markdown' });
      this._chatAttachments.push({
        name: fileName,
        size: blob.size,
        mimeType: 'text/markdown',
        type: 'text',
        file: file
      });
      inputText = `请帮我总结分析附件中的 ${notesData.length} 条笔记内容`;
    }

    // Step 5: 强制切换到 AI 助手视图（核心：同步、防御性操作）
    console.log('[App] sendSelectedNotesToADP: switching to AI assistant view');
    try {
      // 5a. 隐藏所有主视图（包括 aiAssistantView，先统一隐藏再单独显示）
      const allViewIds = ['calendarView', 'notebookView', 'knowledgeView', 'documentsView', 'insightView', 'aiAssistantView'];
      allViewIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.classList.add('hidden');
          el.setAttribute('data-was-shown', 'false');
        }
      });

      // 5b. 显示 AI 助手视图
      const aiView = document.getElementById('aiAssistantView');
      if (aiView) {
        aiView.classList.remove('hidden');
        aiView.setAttribute('data-was-shown', 'true');
      } else {
        console.error('[App] sendSelectedNotesToADP: aiAssistantView element NOT FOUND');
        this.showToast('找不到 AI 助手页面', 'error');
        return;
      }

      // 5c. 验证：确认只有 aiAssistantView 可见
      const visibleViews = allViewIds.filter(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
      });
      console.log('[App] sendSelectedNotesToADP: visible views after switch:', visibleViews);
      if (visibleViews.length !== 1 || visibleViews[0] !== 'aiAssistantView') {
        console.error('[App] sendSelectedNotesToADP: UNEXPECTED visible views!', visibleViews);
      }

      // 5d. 更新 view-tab 状态（无 active tab 对应 AI 助手）
      document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));

      // 5e. 隐藏日期导航栏
      const dateNav = document.querySelector('.date-navigator');
      if (dateNav) dateNav.style.display = 'none';

      // 5f. 更新 AI 模式切换按钮
      this._updateAIModeToggle();

      // 5g. 初始化功能卡片
      this._initFeatureCards();

      // 5h. 设置全局标记，防止其他代码切回视图
      this._forceAIView = true;

      // 5i. 延迟二次验证（检查是否被其他代码覆盖）
      setTimeout(() => {
        const aiViewCheck = document.getElementById('aiAssistantView');
        const notebookViewCheck = document.getElementById('notebookView');
        const aiHidden = aiViewCheck?.classList.contains('hidden');
        const nbHidden = notebookViewCheck?.classList.contains('hidden');
        const aiRect = aiViewCheck?.getBoundingClientRect();
        const nbRect = notebookViewCheck?.getBoundingClientRect();
        console.log('[App] sendSelectedNotesToADP: 500ms check - aiAssistantView.hidden=', aiHidden,
          'offsetH=', aiViewCheck?.offsetHeight, 'rect=', JSON.stringify({w: aiRect?.width, h: aiRect?.height, t: aiRect?.top, l: aiRect?.left}),
          '| notebookView.hidden=', nbHidden,
          'offsetH=', notebookViewCheck?.offsetHeight, 'rect=', JSON.stringify({w: nbRect?.width, h: nbRect?.height}));
        if (aiHidden || !nbHidden) {
          console.warn('[App] sendSelectedNotesToADP: view was overridden! Re-applying...');
          // 强制恢复
          allViewIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
          });
          if (aiViewCheck) aiViewCheck.classList.remove('hidden');
        }
        this._forceAIView = false;
      }, 500);
    } catch (viewErr) {
      console.error('[App] sendSelectedNotesToADP: view switch error:', viewErr);
    }

    // Step 6: 填充输入框和附件（视图已切换完成）
    try {
      const input = document.getElementById('aiChatInput');
      if (input) {
        input.value = inputText;
        setTimeout(() => input.focus(), 200);
      }

      // 如果有附件，渲染附件区域
      if (this._chatAttachments.length > 0) {
        this.renderChatAttachments();
      }

      this.showToast(`已准备 ${notesData.length} 条笔记，可编辑后发送`, 'success');
    } catch (fillErr) {
      console.error('[App] sendSelectedNotesToADP: fill input error:', fillErr);
      this.showToast('内容准备出错，请手动输入', 'error');
    }
  },

  async changeNoteCategory(noteId, currentCategory) {
    // 移除已存在的旧弹出菜单
    const oldPopup = document.querySelector('.category-popup');
    if (oldPopup) oldPopup.remove();

    const categories = this.getAllCategories();

    // 创建浮层菜单
    const popup = document.createElement('div');
    popup.className = 'category-popup';
    popup.innerHTML = categories.map(cat => {
      const isActive = cat.key === currentCategory;
      return `<button class="category-popup-item ${isActive ? 'active' : ''}" data-key="${cat.key}">${cat.label}${isActive ? ' ✓' : ''}</button>`;
    }).join('');

    // 定位到分类标签下方
    const target = document.querySelector(`.note-category-clickable[data-id="${noteId}"]`);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = (rect.bottom + 6) + 'px';
    const popupLeft = Math.max(0, Math.min(rect.left, window.innerWidth - 180));
    popup.style.left = popupLeft + 'px';
    popup.style.width = '160px';

    document.body.appendChild(popup);

    // 点击外部关闭
    const closePopup = (e) => {
      if (!popup.contains(e.target) && e.target !== target) {
        popup.remove();
        document.removeEventListener('click', closePopup);
      }
    };
    setTimeout(() => document.addEventListener('click', closePopup), 0);

    // 处理分类选择 → 事件委托
    popup.addEventListener('click', async (e) => {
      const btn = e.target.closest('.category-popup-item');
      if (!btn) return;
      e.stopPropagation();
      popup.remove();
      document.removeEventListener('click', closePopup);

      const newCategory = btn.dataset.key;
      if (newCategory === currentCategory) {
        this.showToast('分类未变更');
        return;
      }

      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.notebookUpdateNote(noteId, {
            category: newCategory
          });
          if (result.success) {
            this.showToast(`分类已修改为「${this.getNoteCategoryLabel(newCategory)}」`);
            const activeCat = document.querySelector('.category-item.active')?.dataset.category || 'all';
            this.loadNotes(activeCat);
          }
        }
      } catch (error) {
        console.error('修改分类失败:', error);
        this.showToast('修改分类失败', 'error');
      }
    });
  },
  incrementNewNoteCount() {
    const currentView = Calendar.currentView;
    if (currentView === 'notebook') {
      // 已在记事本页，直接刷新列表
      this.loadNotes();
      return;
    }
    this.newNoteCount++;
    this.updateNotebookBadge(this.newNoteCount);
  },
  
  // 清空角标（进入记事本页时调用）
  clearNotebookBadge() {
    this.newNoteCount = 0;
    this.updateNotebookBadge(0);
  },
  
  async copyNote(id) {
    if (window.electronAPI) {
      const result = await window.electronAPI.notebookGetNote(id);
      if (result.note) {
        await window.electronAPI?.writeClipboardText(result.note.content);
        this.showToast('笔记内容已复制到剪贴板');
      }
    }
  },
  
  // 拖拽合并两个记事项（直接合并 + 撤销）
  async mergeNotes(sourceId, targetId) {
    if (!window.electronAPI || sourceId === targetId) return;
    try {
      const [srcResult, tgtResult] = await Promise.all([
        window.electronAPI.notebookGetNote(sourceId),
        window.electronAPI.notebookGetNote(targetId),
      ]);
      const srcNote = srcResult?.note;
      const tgtNote = tgtResult?.note;
      if (!srcNote || !tgtNote) {
        this.showToast('合并失败：未找到记事项', 'error');
        return;
      }

      const srcTitle = srcNote.title || '无标题';
      const tgtTitle = tgtNote.title || '无标题';

      // 备份原始数据（用于撤销）
      const backup = {
        sourceNote: { ...srcNote },
        targetNote: { ...tgtNote },
      };

      // 直接合并（无确认弹窗）
      const mergedContent = tgtNote.content + '\n\n---\n\n' + srcNote.content;
      let mergedHtml = tgtNote.htmlContent || '';
      if (srcNote.htmlContent) {
        mergedHtml += (mergedHtml ? '<hr style="border:none;border-top:1px solid var(--border-light);margin:16px 0;">' : '') + srcNote.htmlContent;
      }
      const mergedTags = [...new Set([...(tgtNote.tags || []), ...(srcNote.tags || [])])];
      const updates = {
        content: mergedContent,
        htmlContent: mergedHtml || null,
        tags: mergedTags,
      };

      const updateResult = await window.electronAPI.notebookUpdateNote(targetId, updates);
      if (!updateResult?.success) {
        this.showToast('合并失败', 'error');
        return;
      }
      await window.electronAPI.notebookDeleteNote(sourceId, 'merged into ' + targetId);

      // 刷新列表
      const activeCat = document.querySelector('.category-item.active')?.dataset.category || 'all';
      this.loadNotes(activeCat);

      // 显示带撤销按钮的 Toast
      this._showMergeUndoToast(srcTitle, tgtTitle, backup);
    } catch (err) {
      console.error('合并记事项失败:', err);
      this.showToast('合并失败', 'error');
    }
  },

  /**
   * 显示合并成功的撤销 Toast
   */
  _showMergeUndoToast(srcTitle, tgtTitle, backup) {
    // 移除已有的撤销 toast
    document.getElementById('mergeUndoToast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'mergeUndoToast';
    toast.className = 'merge-undo-toast';
    toast.innerHTML = `
      <span class="merge-undo-text">✅ 已合并「${this.escapeHtml(srcTitle)}」到「${this.escapeHtml(tgtTitle)}」</span>
      <button class="merge-undo-btn" id="mergeUndoBtn">撤销</button>
    `;
    document.body.appendChild(toast);

    // 自动消失（10秒）
    const autoHide = setTimeout(() => toast.remove(), 10000);

    // 撤销按钮
    toast.querySelector('#mergeUndoBtn')?.addEventListener('click', async () => {
      clearTimeout(autoHide);
      toast.remove();
      await this._undoMerge(backup);
    });
  },

  /**
   * 撤销合并
   */
  async _undoMerge(backup) {
    try {
      // 恢复目标笔记原始内容
      await window.electronAPI.notebookUpdateNote(backup.targetNote.id, {
        content: backup.targetNote.content,
        htmlContent: backup.targetNote.htmlContent || null,
        tags: backup.targetNote.tags || [],
      });
      // 重新创建来源笔记（恢复删除）
      await window.electronAPI.notebookAddNote(backup.sourceNote);
      this.showToast('已撤销合并');
      const activeCat = document.querySelector('.category-item.active')?.dataset.category || 'all';
      this.loadNotes(activeCat);
    } catch (e) {
      console.error('撤销合并失败:', e);
      this.showToast('撤销失败: ' + e.message, 'error');
    }
  },

  // 合并确认弹窗
  _showMergeConfirmDialog(srcTitle, tgtTitle) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
      const dialog = document.createElement('div');
      dialog.style.cssText = 'background:var(--bg-primary);border-radius:16px;padding:28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
      dialog.innerHTML = `
        <h3 style="margin:0 0 16px;font-size:17px;font-weight:600;color:var(--text-primary);">合并记事项</h3>
        <p style="margin:0 0 8px;font-size:14px;color:var(--text-secondary);line-height:1.6;">
          将 <strong style="color:var(--text-primary);">${this.escapeHtml(srcTitle)}</strong> 的内容合并到 <strong style="color:var(--text-primary);">${this.escapeHtml(tgtTitle)}</strong> 中？
        </p>
        <p style="margin:0 0 20px;font-size:12px;color:var(--text-tertiary);">来源记事项合并后将被删除，内容以分隔线连接。</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="mergeCancelBtn" style="padding:8px 20px;border-radius:10px;border:1px solid var(--border-light);background:var(--bg-primary);color:var(--text-secondary);cursor:pointer;font-size:14px;font-weight:500;transition:all 0.15s;">取消</button>
          <button id="mergeConfirmBtn" style="padding:8px 20px;border-radius:10px;border:none;background:var(--primary-color);color:#fff;cursor:pointer;font-size:14px;font-weight:500;transition:all 0.15s;">合并</button>
        </div>
      `;
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };
      dialog.querySelector('#mergeConfirmBtn').onclick = () => close(true);
      dialog.querySelector('#mergeCancelBtn').onclick = () => close(false);
      overlay.onclick = (e) => { if (e.target === overlay) close(false); };
    });
  },

  async copyNoteFromPreview(noteId) {
    if (window.electronAPI) {
      const result = await window.electronAPI.notebookGetNote(noteId);
      if (result.note) {
        await window.electronAPI?.writeClipboardText(result.note.content);
        this.showToast('已复制到剪贴板');
      }
    }
  },
  
  enterEditMode(noteId) {
    const previewContent = document.querySelector(`.note-preview-content[data-note-id="${noteId}"]`);
    if (!previewContent) return;

    // 检查是否已有内联富文本编辑器
    if (previewContent.closest('.note-rich-editor')) return;

    const previewContainer = previewContent.closest('.note-preview');
    if (!previewContainer) return;

    // 获取当前笔记标题（从 note-header 中读取）
    const noteItem = previewContent.closest('.note-item');
    const titleEl = noteItem?.querySelector('.note-title');
    const currentTitle = titleEl ? titleEl.textContent : '';

    // 保存原始内容用于取消
    const originalHTML = previewContent.innerHTML;
    const originalText = previewContent.textContent;

    // 隐藏原始内容
    previewContent.style.display = 'none';

    // 创建标题输入框
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'note-inline-title-input';
    titleInput.value = currentTitle;
    titleInput.placeholder = '标题（留空则自动取首行内容）';
    titleInput.maxLength = 100;
    previewContainer.insertBefore(titleInput, previewContent);

    // 创建富文本编辑器容器
    const editorWrapper = document.createElement('div');
    editorWrapper.className = 'note-rich-editor';
    editorWrapper.dataset.noteId = noteId;
    previewContainer.insertBefore(editorWrapper, previewContent);

    // 初始化富文本编辑器
    const editor = new window.RichEditor(editorWrapper, {
      placeholder: '编辑笔记内容...',
      minHeight: 100,
      maxHeight: 350,
      compact: true,
    });

    // 设置内容（优先使用 innerHTML，保留富文本格式）
    if (originalHTML && originalHTML.trim()) {
      editor.setHTML(originalHTML);
    } else {
      editor.setText(originalText);
    }

    // 添加操作按钮
    const actionBar = document.createElement('div');
    actionBar.className = 'note-edit-actions';
    actionBar.innerHTML = `
      <button class="btn primary small note-edit-save" style="margin:4px;">保存 (Ctrl+Enter)</button>
      <button class="btn secondary small note-edit-cancel" style="margin:4px;">取消 (Esc)</button>
    `;
    previewContainer.insertBefore(actionBar, editorWrapper.nextSibling);

    editor.focus();

    const finishEdit = (save) => {
      if (save) {
        const html = editor.getHTML();
        const text = editor.getText();
        const newTitle = titleInput.value.trim() || this.extractNoteTitle(text);
        // 保存富文本内容和标题
        this.updateNoteContent(noteId, text, html, newTitle);
        // 同步更新列表中的标题显示
        if (titleEl) titleEl.textContent = newTitle;
      }
      // 恢复原始显示
      editor.destroy();
      editorWrapper.remove();
      titleInput.remove();
      actionBar.remove();
      previewContent.style.display = '';
      if (save) {
        // 刷新笔记列表显示更新后的内容
        this.loadNotes();
      }
    };

    actionBar.querySelector('.note-edit-save').addEventListener('click', () => finishEdit(true));
    actionBar.querySelector('.note-edit-cancel').addEventListener('click', () => finishEdit(false));

    // 键盘快捷键
    const handleKeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        finishEdit(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finishEdit(false);
      }
    };
    editorWrapper.addEventListener('keydown', handleKeydown);
  },
  
  async updateNoteContent(noteId, newContent, htmlContent, title) {
    if (window.electronAPI) {
      try {
        const updates = { 
          content: newContent, 
          title: title || this.extractNoteTitle(newContent)
        };
        // 如果有富文本内容，也保存
        if (htmlContent !== undefined) {
          updates.htmlContent = htmlContent;
        }
        await window.electronAPI.notebookUpdateNote(noteId, updates);
        this.showToast('笔记已更新');
      } catch (error) {
        console.error('更新笔记失败:', error);
        this.showToast('更新笔记失败', 'error');
      }
    }
  },
  
  async editNote(id) {
    // 内联编辑（无弹窗）：先确保预览已展开，再进入编辑模式
    const preview = document.getElementById(`note-preview-${id}`);
    if (preview && preview.classList.contains('hidden')) {
      preview.classList.remove('hidden');
    }
    // 等待 DOM 展开后再初始化编辑器
    await new Promise(r => setTimeout(r, 50));
    this.enterEditMode(id);
  },
  
  // 将笔记转为待办任务
  async convertToTask(noteId) {
    console.log('[App] convertToTask called with noteId:', noteId);
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.notebookGetNote(noteId);
        console.log('[App] notebookGetNote result:', result);
        
        if (result.note) {
          try {
            // 调用AI分析笔记内容，创建待办任务
            console.log('[App] Calling analyzeTask...');
            const analysis = await window.electronAPI.analyzeTask(result.note.content);
            console.log('[App] analyzeTask result:', analysis);
            
            if (analysis.success && analysis.task) {
              const taskData = analysis.task;
              const dueDate = taskData.dueDate ? new Date(taskData.dueDate) : this.getDefaultDueDate();
              
              // 直接创建任务
              const task = Store.addTask({
                title: taskData.title || result.note.title,
                description: taskData.description || result.note.content,
                estimatedDuration: taskData.estimatedDuration || 60,
                priority: taskData.priority || 'medium',
                dueDate: dueDate.toISOString(),
                source: 'notebook',
                rawText: result.note.content,
                taskType: taskData.taskType || 'manual',
                recurrence: taskData.recurrence || null
              });
              
              task.reminders = Reminder.calculateReminders(task);
              Store.updateTask(task.id, { reminders: task.reminders });
              
              // 更新笔记分析状态
              await window.electronAPI.notebookUpdateNote(noteId, {
                analysis: { ...result.note.analysis, status: '已创建待办', isTask: true, taskId: task.id }
              });
              
              // 记录用户反馈，用于优化prompt
              await window.electronAPI.recordFeedback({
                type: 'convert_to_task',
                content: result.note.content,
                result: taskData,
                timestamp: new Date().toISOString()
              });
              
              this.renderTaskList();
              Calendar.render();
              this.showToast('待办任务已创建');
            } else {
              // 如果AI分析失败，手动创建任务
              console.log('[App] AI analysis failed, creating manual task');
              const dueDate = this.getDefaultDueDate();
              
              const task = Store.addTask({
                title: result.note.title,
                description: result.note.content,
                estimatedDuration: 60,
                priority: 'medium',
                dueDate: dueDate.toISOString(),
                source: 'notebook',
                rawText: result.note.content
              });
              
              task.reminders = Reminder.calculateReminders(task);
              Store.updateTask(task.id, { reminders: task.reminders });
              
              await window.electronAPI.notebookUpdateNote(noteId, {
                analysis: { ...result.note.analysis, status: '已创建待办', isTask: true, taskId: task.id }
              });
              
              // 记录反馈
              await window.electronAPI.recordFeedback({
                type: 'convert_to_task',
                content: result.note.content,
                manual: true,
                timestamp: new Date().toISOString()
              });
              
              this.renderTaskList();
              Calendar.render();
              this.showToast('待办任务已创建');
            }
          } catch (error) {
            console.error('转换任务失败:', error);
            this.showToast('转换任务失败: ' + error.message, 'error');
          }
        } else {
          console.error('[App] Note not found');
          this.showToast('笔记不存在', 'error');
        }
      } catch (error) {
        console.error('[App] notebookGetNote failed:', error);
        this.showToast('获取笔记失败', 'error');
      }
    } else {
      console.error('[App] electronAPI not available');
      this.showToast('Electron API不可用', 'error');
    }
  },
  
  // 提炼记忆
  async extractMemory(noteId) {
    console.log('[App] extractMemory called with noteId:', noteId);
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.notebookGetNote(noteId);
        console.log('[App] notebookGetNote result:', result);
        
        if (result.note) {
          try {
            // 调用AI提炼记忆
            console.log('[App] Calling extractMemory...');
            const memoryResult = await window.electronAPI.extractMemory(result.note.content);
            console.log('[App] extractMemory result:', memoryResult);
            
            if (memoryResult.success && memoryResult.memory) {
              // 显示提炼结果
              const memory = memoryResult.memory;
              alert(`记忆提炼成功！\n\n类型: ${this.getMemoryTypeLabel(memory.memory_type)}\n分类: ${this.getMemoryCategoryLabel(memory.category)}\n摘要: ${memory.summary}\n\n人物: ${memory.persons?.join(', ') || '无'}\n主题: ${memory.topics?.join(', ') || '无'}`);
              
              // 记录用户反馈
              await window.electronAPI.recordFeedback({
                type: 'extract_memory',
                content: result.note.content,
                result: memory,
                timestamp: new Date().toISOString()
              });
              
              this.showToast('记忆提炼成功');
            } else {
              console.log('[App] Memory extraction failed:', memoryResult);
              const errorMsg = memoryResult.error || '未知错误';
              this.showToast('提炼记忆失败: ' + errorMsg, 'error');
            }
          } catch (error) {
            console.error('提炼记忆失败:', error);
            this.showToast('提炼记忆失败: ' + error.message, 'error');
          }
        } else {
          console.error('[App] Note not found');
          this.showToast('笔记不存在', 'error');
        }
      } catch (error) {
        console.error('[App] notebookGetNote failed:', error);
        this.showToast('获取笔记失败', 'error');
      }
    } else {
      console.error('[App] electronAPI not available');
      this.showToast('Electron API不可用', 'error');
    }
  },
  
  extractNoteTitle(content) {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length > 0) {
      return lines[0].substring(0, 50) + (lines[0].length > 50 ? '...' : '');
    }
    return '无标题';
  },

  async searchNotes() {
    const query = document.getElementById('notebookSearchInput').value;
    if (!window.electronAPI) return;
    
    const noteList = document.getElementById('notebookList');
    
    // v3.1: 优先使用向量语义搜索，降级为关键词搜索
    let notes = [];
    if (query.trim() && window.electronAPI?.vectorSearchNotes) {
      try {
        const vecResult = await window.electronAPI.vectorSearchNotes({ query, limit: 50 });
        if (vecResult.success && vecResult.results.length > 0) {
          // 从向量结果获取完整笔记数据
          const allNotes = Store.getNotes();
          const noteMap = new Map(allNotes.map(n => [n.id, n]));
          notes = vecResult.results
            .map(r => noteMap.get(r.source_id))
            .filter(Boolean);
        }
      } catch (e) {
        console.warn('[Notebook] Vector search failed, falling back to keyword:', e.message);
      }
    }
    
    // 降级：关键词搜索
    if (notes.length === 0) {
      const result = await window.electronAPI.notebookSearch(query);
      notes = result.notes || [];
    }
    
    if (notes.length > 0) {
      noteList.innerHTML = notes.map(note => {
        const hasHtmlContent = note.htmlContent && note.htmlContent.trim();
        const contentPreview = hasHtmlContent
          ? `<div class="note-content note-rich-preview">${note.htmlContent}</div>`
          : `<p class="note-content">${this.escapeHtml(note.content.substring(0, 200))}${note.content.length > 200 ? '...' : ''}</p>`;
        const previewInnerContent = hasHtmlContent
          ? `<div class="note-rich-text">${note.htmlContent}</div>`
          : this.escapeHtml(note.content);
        return `
        <div class="note-item" data-id="${note.id}" data-category="${note.category}" data-content-length="${note.content.length}" draggable="true">
          <input type="checkbox" class="note-checkbox" data-note-id="${note.id}">
          <div class="note-drag-handle" title="拖拽到左侧分类可修改分类">⠿</div>
          <div class="note-body">
            <div class="note-header">
              <h3 class="note-title">${this.escapeHtml(note.title)}</h3>
              <span class="note-category note-category-clickable" data-id="${note.id}" data-category="${note.category}" title="点击修改分类">${this.getNoteCategoryLabel(note.category)}</span>
            </div>
            ${contentPreview}
            <div class="note-preview hidden" id="note-preview-${note.id}">
              <div class="note-preview-content" contenteditable="false" data-note-id="${note.id}">${previewInnerContent}</div>
              <div class="note-preview-hint">点击复制 | 双击编辑</div>
            </div>
            <div class="note-footer">
              <span class="note-date">${new Date(note.createdAt).toLocaleString()}</span>
              ${note.analyzed ? '<span class="note-analyzed">已分析</span>' : ''}
              ${this.getAnalysisStatusTag(note)}
              <div class="note-actions">
                <button class="note-btn note-btn-edit" data-action="edit" title="编辑笔记">✏️</button>
                <button class="note-btn note-btn-download" data-action="download" title="下载为 Markdown">📥</button>
                <button class="note-btn note-btn-primary" data-action="convert" title="转为待办任务">✅</button>
                <button class="note-btn note-btn-secondary" data-action="extract" title="提炼记忆">🧠</button>
                <button class="note-btn note-btn-danger" data-action="delete" title="删除笔记">🗑️</button>
              </div>
            </div>
          </div>
        </div>
      `;
      }).join('');
      this.bindNoteDragEvents();
      this.bindNoteCheckboxEvents();
    } else {
      noteList.innerHTML = '<div class="empty-state">未找到匹配的笔记</div>';
      this.hideNotebookBatchBar();
    }
  },

  setupClipboardListener() {
    if (window.electronAPI) {
      // 主进程剪贴板日志 → DevTools Console
      if (window.electronAPI.onClipboardLog) {
        window.electronAPI.onClipboardLog((msg) => {
          console.log(msg);
        });
      }
      
      window.electronAPI.onClipboardTaskDetected((data) => {
        this.handleClipboardTask(data);
      });
      
      // 剪贴板候选事件（中等置信度任务）
      if (window.electronAPI.onClipboardCandidateDetected) {
        window.electronAPI.onClipboardCandidateDetected((data) => {
          console.log('[App] Clipboard candidate detected:', data.task?.title);
          this.handleClipboardCandidate(data);
        });
      }
      
      // 剪贴板暂存状态
      if (window.electronAPI.onClipboardBufferStatus) {
        window.electronAPI.onClipboardBufferStatus((data) => {
          this.updateClipboardBufferStatus(data);
        });
      }
      
      // 关联检测通知
      if (window.electronAPI.onClipboardAssociationDetected) {
        window.electronAPI.onClipboardAssociationDetected((data) => {
          console.log('[App] Association detected:', data.action, data.targetId);
          this.showAssociationNotification(data);
        });
      }
      
      window.electronAPI.onStartPomodoro(() => {
        Pomodoro.start();
      });
      
      // 监听后台新增笔记事件（用于角标计数）
      window.electronAPI.onNewNoteAdded((data) => {
        console.log('[App] New note added from background:', data.title);
        this.incrementNewNoteCount();
      });
    }
  },

  handleClipboardCandidate(data) {
    // 中等置信度任务：以 toast 提示，不弹弹窗
    const title = data.task?.title || '未知任务';
    const confidence = data.task?.confidence ? Math.round(data.task.confidence * 100) : '?';
    this.showToast(`📋 候选待办: ${title} (${confidence}%)`, 'info');
  },

  updateClipboardBufferStatus(data) {
    // 更新暂存状态提示（如果有UI的话）
    const statusEl = document.getElementById('clipboardBufferStatus');
    if (statusEl && !data.isStable && data.fragmentCount > 0) {
      statusEl.textContent = `⏳ 正在聚合内容（${data.fragmentCount} 片段，${data.totalLength} 字）...`;
      statusEl.style.display = 'block';
    } else if (statusEl) {
      statusEl.style.display = 'none';
    }
  },

  showAssociationNotification(data) {
    const actionText = {
      supplement: '补充了',
      update: '更新了',
      related: '关联了'
    };
    const action = actionText[data.action] || data.action;
    this.showToast(`🔗 已${action}相关条目`, 'info');
  },

  handleClipboardTask(data) {
    this.pendingClipboardTask = {
      rawText: data.rawText,
      task: data.task
    };
    
    document.getElementById('rawText').textContent = data.rawText;
    document.getElementById('previewTitle').textContent = data.task.title;
    document.getElementById('previewDue').textContent = data.task.dueDate ? new Date(data.task.dueDate).toLocaleString() : '未指定';
    document.getElementById('previewDuration').textContent = `${data.task.estimatedDuration || 60}分钟`;
    
    const priorityText = { high: '高', medium: '中', low: '低' };
    document.getElementById('previewPriority').textContent = priorityText[data.task.priority] || '中';
    
    // 显示置信度
    if (data.task.confidence !== undefined) {
      const confidenceEl = document.getElementById('previewConfidence');
      if (confidenceEl) {
        const confidencePercent = Math.round(data.task.confidence * 100);
        confidenceEl.textContent = `置信度: ${confidencePercent}%`;
        confidenceEl.style.color = data.task.confidence >= 0.9 ? '#34c759' : 
                                  data.task.confidence >= 0.7 ? '#ff9500' : '#ff3b30';
        confidenceEl.style.display = 'block';
      }
    }
    
    // 显示识别原因
    if (data.task.reason) {
      const reasonEl = document.getElementById('previewReason');
      if (reasonEl) {
        reasonEl.textContent = `识别原因: ${data.task.reason}`;
        reasonEl.style.display = 'block';
      }
    }

    // 知识跟随：显示意图识别标签
    const intentSection = document.getElementById('clipboardIntentSection');
    if (intentSection) {
      if (data.knowledgeIntent) {
        intentSection.style.display = 'block';
        // 清除所有 active 状态
        document.querySelectorAll('.clipboard-intent-tag').forEach(tag => tag.classList.remove('active'));
        // 设置当前意图为 active
        const activeTag = document.querySelector(`.clipboard-intent-tag[data-intent="${data.knowledgeIntent}"]`);
        if (activeTag) activeTag.classList.add('active');
      } else {
        intentSection.style.display = 'none';
      }
    }
    
    this.showClipboardDetector();
    this.startAutoSaveCountdown();
  },

  startAutoSaveCountdown() {
    this.remainingTime = 10;
    this.updateCountdownDisplay();
    
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    
    this.autoSaveTimer = setInterval(() => {
      this.remainingTime--;
      this.updateCountdownDisplay();
      
      if (this.remainingTime <= 0) {
        this.autoSaveAsDraft();
      }
    }, 1000);
  },

  updateCountdownDisplay() {
    let countdownEl = document.getElementById('countdownDisplay');
    if (!countdownEl) {
      countdownEl = document.createElement('div');
      countdownEl.id = 'countdownDisplay';
      countdownEl.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: var(--bg-secondary);
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 12px;
        color: var(--text-secondary);
      `;
      const detectorContent = document.querySelector('.detector-content');
      if (detectorContent) {
        detectorContent.style.position = 'relative';
        detectorContent.insertBefore(countdownEl, detectorContent.firstChild);
      }
    }
    countdownEl.textContent = `${this.remainingTime}秒后自动保存为草稿`;
  },

  autoSaveAsDraft() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    
    if (!this.pendingClipboardTask) {
      this.hideClipboardDetector();
      return;
    }
    
    const taskData = this.pendingClipboardTask.task;
    const dueDate = taskData.dueDate ? new Date(taskData.dueDate) : this.getDefaultDueDate();
    
    const task = Store.addTask({
      title: taskData.title,
      description: taskData.description || '',
      estimatedDuration: taskData.estimatedDuration || 60,
      priority: taskData.priority || 'medium',
      dueDate: dueDate.toISOString(),
      source: 'clipboard',
      rawText: this.pendingClipboardTask.rawText,
      isDraft: true,
      taskType: taskData.taskType || 'manual',
      recurrence: taskData.recurrence || null
    });
    
    task.reminders = Reminder.calculateReminders(task);
    Store.updateTask(task.id, { reminders: task.reminders });
    
    this.hideClipboardDetector();
    this.renderTaskList();
    Calendar.render();
    
    this.showToast('已自动保存为草稿');
  },

  // === 剪贴板处理 + 弹窗方法已提取到 app-clipboard-dialog.js ===


  showCreateMenu(e) {
    // 移除已有菜单
    const existing = document.getElementById('createMenuOverlay');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'createMenuOverlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.3); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      z-index: 5000; animation: fadeIn 0.15s ease;
    `;

    const menu = document.createElement('div');
    menu.style.cssText = `
      background: var(--bg-card); border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15);
      padding: 8px; min-width: 240px; max-width: 320px;
      animation: panelFadeIn 0.2s cubic-bezier(0.2,0.8,0.2,1);
    `;

    const items = [
      { id: 'task', icon: '✅', label: '新建任务', desc: '添加待办事项和提醒' },
      { id: 'note', icon: '📝', label: '新建记事本', desc: '快速记录想法和笔记' },
      { id: 'question', icon: '❓', label: '新建问题', desc: '记录需要探索的问题' },
      { id: 'memory', icon: '🧠', label: '新建记忆', desc: '保存重要信息到记忆库' }
    ];

    menu.innerHTML = items.map(item => `
      <div class="create-menu-item" data-type="${item.id}" style="
        display: flex; align-items: center; gap: 12px;
        padding: 14px 16px; border-radius: 12px; cursor: pointer;
        transition: background 0.15s ease;
      ">
        <span style="font-size: 24px; line-height: 1;">${item.icon}</span>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${item.label}</div>
          <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 2px;">${item.desc}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-quaternary)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    `).join('');

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    // hover 效果 → CSS :hover
    // 点击选项
    const close = () => overlay.remove();
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) { close(); return; }
      const menuItem = ev.target.closest('.create-menu-item');
      if (!menuItem) return;
      const type = menuItem.dataset.type;
      close();
      switch (type) {
        case 'task':
          this.showTaskModal();
          break;
        case 'note':
          this.addNote();
          break;
        case 'question':
          if (window.knowledgeDistillation) {
            window.knowledgeDistillation.showAddQuestionModal();
          } else {
            this.showQuickQuestionModal();
          }
          break;
        case 'memory':
          this.showQuickMemoryModal();
          break;
      }
    });
  },

  showQuickQuestionModal() {
    let overlay = document.getElementById('quickQuestionOverlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'quickQuestionOverlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.35); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      z-index: 5000; animation: fadeIn 0.15s ease;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      width: 420px; max-width: 90%; background: var(--bg-card);
      border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      overflow: hidden; animation: panelFadeIn 0.25s cubic-bezier(0.2,0.8,0.2,1);
    `;

    dialog.innerHTML = `
      <div style="padding: 20px 24px 8px; display: flex; align-items: center; justify-content: space-between;">
        <h3 style="font-size: 17px; font-weight: 600; color: var(--text-primary); margin: 0;">❓ 记录问题</h3>
        <button class="quick-q-close" style="background: none; border: none; font-size: 18px; color: var(--text-tertiary); cursor: pointer; padding: 4px;">✕</button>
      </div>
      <div style="padding: 8px 24px 20px;">
        <textarea id="quickQuestionInput" placeholder="输入你想记录的问题..." style="
          width: 100%; min-height: 120px; padding: 12px; border-radius: 10px;
          border: 1px solid var(--border-light); background: var(--bg-secondary);
          color: var(--text-primary); font-size: 14px; resize: vertical;
          font-family: inherit; line-height: 1.6; box-sizing: border-box;
        "></textarea>
        <div style="margin-top: 8px; display: flex; gap: 8px;">
          <input id="quickQuestionDomain" type="text" placeholder="问题领域（可选，如：技术、业务）" style="
            flex: 1; padding: 10px 12px; border-radius: 10px;
            border: 1px solid var(--border-light); background: var(--bg-secondary);
            color: var(--text-primary); font-size: 13px; box-sizing: border-box;
          ">
        </div>
      </div>
      <div style="display: flex; border-top: 0.5px solid var(--border-light);">
        <button class="quick-q-cancel" style="flex:1; padding: 14px; border: none; background: transparent;
          font-size: 14px; font-weight: 500; color: var(--text-secondary); cursor: pointer;
          border-right: 0.5px solid var(--border-light);">取消</button>
        <button class="quick-q-save" style="flex:1; padding: 14px; border: none; background: transparent;
          font-size: 14px; font-weight: 600; color: var(--primary-color); cursor: pointer;">保存</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    dialog.querySelector('.quick-q-close').addEventListener('click', close);
    dialog.querySelector('.quick-q-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    dialog.querySelector('.quick-q-save').addEventListener('click', async () => {
      const content = document.getElementById('quickQuestionInput').value.trim();
      if (!content) { this.showToast('请输入问题内容', 'error'); return; }
      const domain = document.getElementById('quickQuestionDomain').value.trim() || '未分类';

      try {
        if (window.electronAPI?.knowledgeAddAtom) {
          const result = await window.electronAPI.knowledgeAddAtom({
            content, domain, type: 'question', importance: 0.7
          });
          if (result.success) {
            this.showToast('❓ 问题已记录到知识库', 'success');
            close();
          } else {
            this.showToast('记录问题失败', 'error');
          }
        }
      } catch (err) {
        this.showToast('记录问题失败: ' + err.message, 'error');
      }
    });

    document.getElementById('quickQuestionInput')?.focus();
  },

  showQuickMemoryModal() {
    let overlay = document.getElementById('quickMemoryOverlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'quickMemoryOverlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.35); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      z-index: 5000; animation: fadeIn 0.15s ease;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      width: 420px; max-width: 90%; background: var(--bg-card);
      border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      overflow: hidden; animation: panelFadeIn 0.25s cubic-bezier(0.2,0.8,0.2,1);
    `;

    dialog.innerHTML = `
      <div style="padding: 20px 24px 8px; display: flex; align-items: center; justify-content: space-between;">
        <h3 style="font-size: 17px; font-weight: 600; color: var(--text-primary); margin: 0;">🧠 新建记忆</h3>
        <button class="quick-m-close" style="background: none; border: none; font-size: 18px; color: var(--text-tertiary); cursor: pointer; padding: 4px;">✕</button>
      </div>
      <div style="padding: 8px 24px 20px;">
        <textarea id="quickMemoryInput" placeholder="输入记忆内容..." style="
          width: 100%; min-height: 120px; padding: 12px; border-radius: 10px;
          border: 1px solid var(--border-light); background: var(--bg-secondary);
          color: var(--text-primary); font-size: 14px; resize: vertical;
          font-family: inherit; line-height: 1.6; box-sizing: border-box;
        "></textarea>
        <div style="margin-top: 8px; display: flex; gap: 8px;">
          <select id="quickMemoryType" style="
            flex: 1; padding: 10px 12px; border-radius: 10px;
            border: 1px solid var(--border-light); background: var(--bg-secondary);
            color: var(--text-primary); font-size: 13px; cursor: pointer;
          ">
            <option value="short">短期记忆</option>
            <option value="long">长期记忆</option>
          </select>
          <select id="quickMemoryCategory" style="
            flex: 1; padding: 10px 12px; border-radius: 10px;
            border: 1px solid var(--border-light); background: var(--bg-secondary);
            color: var(--text-primary); font-size: 13px; cursor: pointer;
          ">
            <option value="knowledge">知识</option>
            <option value="experience">经验</option>
            <option value="insight">洞察</option>
            <option value="fact">事实</option>
          </select>
        </div>
        <label style="display: flex; align-items: center; gap: 8px; margin-top: 12px; cursor: pointer; font-size: 13px; color: var(--text-secondary);">
          <input type="checkbox" id="quickMemoryAI" checked style="accent-color: var(--primary-color);">
          🧠 AI 自动整理后再保存
        </label>
      </div>
      <div style="display: flex; border-top: 0.5px solid var(--border-light);">
        <button class="quick-m-cancel" style="flex:1; padding: 14px; border: none; background: transparent;
          font-size: 14px; font-weight: 500; color: var(--text-secondary); cursor: pointer;
          border-right: 0.5px solid var(--border-light);">取消</button>
        <button class="quick-m-save" style="flex:1; padding: 14px; border: none; background: transparent;
          font-size: 14px; font-weight: 600; color: var(--primary-color); cursor: pointer;">保存</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    dialog.querySelector('.quick-m-close').addEventListener('click', close);
    dialog.querySelector('.quick-m-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    dialog.querySelector('.quick-m-save').addEventListener('click', async () => {
      const input = document.getElementById('quickMemoryInput').value.trim();
      if (!input) { this.showToast('请输入记忆内容', 'error'); return; }
      const type = document.getElementById('quickMemoryType').value;
      const category = document.getElementById('quickMemoryCategory').value;
      const useAI = document.getElementById('quickMemoryAI').checked;
      const saveBtn = dialog.querySelector('.quick-m-save');
      saveBtn.textContent = '⏳ 保存中...';
      saveBtn.style.pointerEvents = 'none';

      try {
        if (window.electronAPI) {
          if (useAI) {
            const orgResult = await window.electronAPI.aiOrganizeMemory(input);
            if (orgResult.success && orgResult.organized) {
              const org = orgResult.organized;
              const finalType = type === 'long' ? 'long' : (org.memory_type || type);
              await window.electronAPI.addMemory({
                content: org.organized_content,
                type: finalType,
                category: org.category || category,
                business_category: org.business_category || 'other',
                confidence: org.confidence || 0.8,
                metadata: {
                  source: 'quick_create',
                  tags: org.tags || [],
                  key_points: org.key_points || [],
                  original_content: input,
                  created_at: new Date().toISOString()
                }
              });
            } else {
              await window.electronAPI.addMemory({
                content: input, type, category, business_category: 'other',
                confidence: 1.0, metadata: { source: 'quick_create', ai_organize_failed: true, created_at: new Date().toISOString() }
              });
            }
          } else {
            await window.electronAPI.addMemory({
              content: input, type, category, business_category: 'other',
              confidence: 1.0, metadata: { source: 'quick_create', created_at: new Date().toISOString() }
            });
          }
          this.showToast('🧠 记忆已保存', 'success');
          close();
          this.loadMemories?.();
        }
      } catch (err) {
        this.showToast('保存记忆失败: ' + err.message, 'error');
        saveBtn.textContent = '保存';
        saveBtn.style.pointerEvents = '';
      }
    });

    document.getElementById('quickMemoryInput')?.focus();
  },

  showTaskModal(task = null) {
    console.log('[App] showTaskModal called with:', task);
    this.editingTask = task;
    
    const modal = document.getElementById('taskModal');
    const modalContent = modal?.querySelector('.modal-content');
    if (modalContent) {
      modalContent.style.width = '70%';
      modalContent.style.maxWidth = '900px';
    }
    const titleInput = document.getElementById('taskTitle');
    const descInput = document.getElementById('taskDesc');
    const dueInput = document.getElementById('taskDue');
    const durationInput = document.getElementById('taskDuration');
    const priorityInput = document.getElementById('taskPriority');
    const recurrenceInput = document.getElementById('taskRecurrence');
    
    if (task && task.id) {
      document.getElementById('modalTitle').textContent = '编辑任务';
      titleInput.value = task.title;
      descInput.value = task.description || '';
      
      if (task.dueDate) {
        dueInput.value = this.formatDateTimeLocal(new Date(task.dueDate));
      }
      
      durationInput.value = task.estimatedDuration;
      priorityInput.value = task.priority;
      
      // v2.1: 回填任务类型
      const taskTypeInput = document.getElementById('taskType');
      if (taskTypeInput) {
        taskTypeInput.value = task.taskType || 'manual';
        // 触发 change 事件以显示/隐藏 AI 专家选择组
        taskTypeInput.dispatchEvent(new Event('change'));
      }
      // 回填 AI 专家
      if (task.expertId) {
        const taskExpertInput = document.getElementById('taskExpert');
        if (taskExpertInput) taskExpertInput.value = task.expertId;
      }
      
      // 周期性任务回填
      const recurrence = task.recurrence;
      if (recurrence && recurrence.type && recurrence.type !== 'none') {
        recurrenceInput.value = recurrence.type;
        if (recurrence.type === 'custom') {
          document.getElementById('recurrenceInterval').value = recurrence.interval || 2;
          document.getElementById('recurrenceUnit').value = recurrence.unit || 'day';
        }
        if (recurrence.daysOfWeek?.length) {
          document.querySelectorAll('.weekday-btn').forEach(btn => {
            btn.classList.toggle('active', recurrence.daysOfWeek.includes(parseInt(btn.dataset.day)));
          });
        }
        if (recurrence.endDate) {
          document.getElementById('recurrenceEndDate').value = recurrence.endDate.split('T')[0];
        }
      } else {
        recurrenceInput.value = 'none';
      }
    } else {
      document.getElementById('modalTitle').textContent = '新建任务/记事本/问题/记忆';
      titleInput.value = task?.title || '';
      descInput.value = task?.description || '';
      
      if (task?.dueDate) {
        dueInput.value = this.formatDateTimeLocal(new Date(task.dueDate));
      } else {
        const defaultDate = this.getDefaultDueDate();
        dueInput.value = this.formatDateTimeLocal(defaultDate);
      }
      
      durationInput.value = task?.estimatedDuration || 60;
      priorityInput.value = task?.priority || 'medium';
      recurrenceInput.value = 'none';
      // v2.1: 回填任务类型（如果有传入则使用，否则默认手动待办）
      const taskTypeInput = document.getElementById('taskType');
      if (taskTypeInput) {
        taskTypeInput.value = task?.taskType || 'manual';
        taskTypeInput.dispatchEvent(new Event('change'));
      }
      // 回填 AI 专家
      if (task?.expertId) {
        const taskExpertInput = document.getElementById('taskExpert');
        if (taskExpertInput) taskExpertInput.value = task.expertId;
      }
      // 回填周期性（从剪贴板/AI 分析结果传入）
      if (task?.recurrence && task.recurrence.type && task.recurrence.type !== 'none') {
        recurrenceInput.value = task.recurrence.type;
        if (task.recurrence.daysOfWeek?.length) {
          document.querySelectorAll('.weekday-btn').forEach(btn => {
            btn.classList.toggle('active', task.recurrence.daysOfWeek.includes(parseInt(btn.dataset.day)));
          });
        }
      }
    }
    
    // 触发周期性选项显隐
    this._updateRecurrenceUI();
    
    modal.classList.remove('hidden');
    titleInput.focus();
  },

  hideTaskModal() {
    document.getElementById('taskModal')?.classList.add('hidden');
    this.editingTask = null;
    // 如果正在录音，停止录音
    if (this._voiceRecording) {
      this._cancelVoiceInput();
    }
    // 清除 AI 编辑器内容
    if (this._aiTaskEditor) this._aiTaskEditor.clear();
    // 重置周期性选项
    const recurrenceInput = document.getElementById('taskRecurrence');
    if (recurrenceInput) recurrenceInput.value = 'none';
    document.querySelectorAll('.weekday-btn').forEach(btn => btn.classList.remove('active'));
    const endDateInput = document.getElementById('recurrenceEndDate');
    if (endDateInput) endDateInput.value = '';
    // v2.1: 重置任务类型为手动待办
    const taskTypeInput = document.getElementById('taskType');
    if (taskTypeInput) taskTypeInput.value = 'manual';
    const aiExpertGroup = document.getElementById('aiExpertGroup');
    if (aiExpertGroup) aiExpertGroup.classList.add('hidden');
    const taskExpertInput = document.getElementById('taskExpert');
    if (taskExpertInput) taskExpertInput.value = '';
  },

  _updateRecurrenceUI() {
    const type = document.getElementById('taskRecurrence')?.value || 'none';
    const customRow = document.getElementById('recurrenceCustomRow');
    const weeklyDaysRow = document.getElementById('recurrenceWeeklyDaysRow');
    const endDateRow = document.getElementById('recurrenceEndDateRow');
    
    if (customRow) customRow.classList.toggle('hidden', type !== 'custom');
    if (weeklyDaysRow) weeklyDaysRow.classList.toggle('hidden', type !== 'weekly');
    if (endDateRow) endDateRow.classList.toggle('hidden', type === 'none');
  },

  _showRecurrenceDeleteDialog(task) {
    const existing = document.querySelector('.confirm-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.35); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      z-index: 5000; animation: fadeIn 0.2s ease;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      width: 380px; max-width: 90%; background: var(--bg-card);
      border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      overflow: hidden; animation: panelFadeIn 0.25s cubic-bezier(0.2,0.8,0.2,1);
    `;

    dialog.innerHTML = `
      <div style="padding: 20px 24px 8px; font-size: 17px; font-weight: 600; color: var(--text-primary);">删除周期性任务</div>
      <div style="padding: 4px 24px 8px; font-size: 13px; color: var(--text-secondary); line-height: 1.6;">"${this.escapeHtml(task.title)}" 是周期性任务</div>
      <div style="display: flex; flex-direction: column; gap: 0; border-top: 0.5px solid var(--border-light);">
        <button class="recur-delete-this" style="padding: 14px 24px; border: none; background: transparent;
          font-size: 14px; font-weight: 500; color: var(--danger-color); cursor: pointer;
          text-align: left; border-bottom: 0.5px solid var(--border-light); transition: background 0.15s;">🗑 仅删除本次</button>
        <button class="recur-delete-all" style="padding: 14px 24px; border: none; background: transparent;
          font-size: 14px; font-weight: 600; color: var(--danger-color); cursor: pointer;
          text-align: left; transition: background 0.15s;">🗑 删除全部周期性任务</button>
        <button class="recur-delete-cancel" style="padding: 14px 24px; border: none; background: transparent;
          font-size: 14px; font-weight: 500; color: var(--text-secondary); cursor: pointer;
          text-align: left; border-top: 0.5px solid var(--border-light); transition: background 0.15s;">取消</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    dialog.querySelector('.recur-delete-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    dialog.querySelector('.recur-delete-this').addEventListener('click', () => {
      Store.deleteTask(task.id);
      // 同步删除系统日历事件
      if (window.electronAPI?.removeFromCalendar) {
        window.electronAPI.removeFromCalendar(task.title);
      }
      close();
      this.renderTaskList();
      Calendar.render();
      this.showToast('已删除本次任务');
    });

    dialog.querySelector('.recur-delete-all').addEventListener('click', () => {
      const parentId = task.recurrence.parentId || task.id;
      // 删除模板和所有实例
      Store.deleteTask(parentId);
      Store.deleteRecurringAll(parentId);
      // 同步删除系统日历事件
      if (window.electronAPI?.removeFromCalendar) {
        window.electronAPI.removeFromCalendar(task.title);
      }
      close();
      this.renderTaskList();
      Calendar.render();
      this.showToast('已删除全部周期性任务');
    });
  },

  _showRecurrenceEditDialog(task, taskData) {
    const existing = document.querySelector('.confirm-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.35); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      z-index: 5000; animation: fadeIn 0.2s ease;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      width: 380px; max-width: 90%; background: var(--bg-card);
      border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      overflow: hidden; animation: panelFadeIn 0.25s cubic-bezier(0.2,0.8,0.2,1);
    `;

    dialog.innerHTML = `
      <div style="padding: 20px 24px 8px; font-size: 17px; font-weight: 600; color: var(--text-primary);">编辑周期性任务</div>
      <div style="padding: 4px 24px 8px; font-size: 13px; color: var(--text-secondary); line-height: 1.6;">"${this.escapeHtml(task.title)}" 是周期性任务</div>
      <div style="display: flex; flex-direction: column; gap: 0; border-top: 0.5px solid var(--border-light);">
        <button class="recur-edit-this" style="padding: 14px 24px; border: none; background: transparent;
          font-size: 14px; font-weight: 500; color: var(--primary-color); cursor: pointer;
          text-align: left; border-bottom: 0.5px solid var(--border-light); transition: background 0.15s;">✏️ 仅修改本次</button>
        <button class="recur-edit-all" style="padding: 14px 24px; border: none; background: transparent;
          font-size: 14px; font-weight: 600; color: var(--primary-color); cursor: pointer;
          text-align: left; transition: background 0.15s;">✏️ 修改全部周期性任务</button>
        <button class="recur-edit-cancel" style="padding: 14px 24px; border: none; background: transparent;
          font-size: 14px; font-weight: 500; color: var(--text-secondary); cursor: pointer;
          text-align: left; border-top: 0.5px solid var(--border-light); transition: background 0.15s;">取消</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    dialog.querySelector('.recur-edit-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    dialog.querySelector('.recur-edit-this').addEventListener('click', () => {
      // 仅修改本次：将此实例脱离周期性关联
      const updatedTask = Store.updateTask(task.id, {
        ...taskData,
        recurrence: null  // 脱离周期性
      });
      updatedTask.reminders = Reminder.calculateReminders(updatedTask);
      Store.updateTask(updatedTask.id, { reminders: updatedTask.reminders });
      close();
      this.hideTaskModal();
      this.renderTaskList();
      Calendar.render();
      this.showToast('仅本次已修改');
    });

    dialog.querySelector('.recur-edit-all').addEventListener('click', () => {
      // 修改全部：更新模板和所有未完成实例
      const parentId = task.recurrence.parentId;
      const template = Store.getTasks().find(t => t.id === parentId);
      if (template) {
        Store.updateTask(parentId, {
          ...taskData,
          recurrence: template.recurrence  // 保留原有周期性设置
        });
      }
      // 更新所有未完成的实例
      const instances = Store.getRecurringInstances(parentId).filter(t => t.status !== 'completed');
      instances.forEach(inst => {
        Store.updateTask(inst.id, {
          title: taskData.title,
          description: taskData.description,
          estimatedDuration: taskData.estimatedDuration,
          priority: taskData.priority,
          taskType: taskData.taskType,
          expertId: taskData.expertId,
          expertName: taskData.expertName,
        });
      });
      close();
      this.hideTaskModal();
      this.renderTaskList();
      Calendar.render();
      this.showToast('全部周期性任务已修改');
    });
  },

  // 渲染任务关联人物（来自画像）
  async _renderTaskLinkedPersons(linkedPersons = []) {
    const container = document.getElementById('taskLinkedPersons');
    if (!container) return;

    let profilePersons = [];
    if (window.electronAPI?.profile?.get) {
      try {
        const profile = await window.electronAPI.profile.get();
        profilePersons = profile.frequent_persons || [];
      } catch (e) {}
    }

    // 合并：已有关联 + 画像人物（可选）
    const linkedNames = new Set(linkedPersons.map(p => typeof p === 'string' ? p : p.name));
    const allPersons = [
      ...linkedPersons.map(p => typeof p === 'string' ? { name: p } : p),
      ...profilePersons.filter(p => !linkedNames.has(p.name))
    ];

    if (allPersons.length === 0) {
      container.innerHTML = '<span class="linked-persons-empty">暂无关联人物</span>';
      return;
    }

    container.innerHTML = allPersons.map(p => {
      const isLinked = linkedNames.has(p.name);
      const relationTag = p.relation ? `<span class="person-relation-tag ${this._getRelationClass(p.relation)}">${this.escapeHtml(p.relation)}</span>` : '';
      const responsibilitiesTag = p.responsibilities ? `<span class="person-resp-tag">${this.escapeHtml(p.responsibilities)}</span>` : '';
      return `<div class="linked-person-chip ${isLinked ? 'active' : ''}" data-name="${this.escapeHtml(p.name)}" data-relation="${this.escapeHtml(p.relation || '')}">
        <span class="person-name">${this.escapeHtml(p.name)}</span>${relationTag}${responsibilitiesTag}
      </div>`;
    }).join('');

    // 点击切换关联 → 事件委托
    container.onclick = (e) => {
      const chip = e.target.closest('.linked-person-chip');
      if (chip) chip.classList.toggle('active');
    };
  },

  _getRelationClass(relation) {
    if (!relation) return '';
    const r = relation.toLowerCase();
    if (['领导', '老板', '总监', 'vp', '经理'].some(k => r.includes(k))) return 'relation-leader';
    if (['下属', '组员', '徒弟'].some(k => r.includes(k))) return 'relation-subordinate';
    if (['同事', '同组', '队友'].some(k => r.includes(k))) return 'relation-colleague';
    if (['客户', '甲方'].some(k => r.includes(k))) return 'relation-client';
    return '';
  },

  // 自动从画像匹配关联人物（根据标题和描述中的关键词）
  _getAutoLinkedPersons(title, description) {
    try {
      const profile = Store.getProfile();
      if (!profile?.frequentPersons?.length) return [];
      const text = `${title} ${description}`.toLowerCase();
      return profile.frequentPersons
        .filter(p => p.name && text.includes(p.name.toLowerCase()))
        .map(p => ({ name: p.name, relation: p.relation || '' }));
    } catch (e) {
      return [];
    }
  },

  // 获取当前任务关联的人物（旧方法，保留兼容）
  _getTaskLinkedPersons() {
    const container = document.getElementById('taskLinkedPersons');
    if (!container) return [];
    return Array.from(container.querySelectorAll('.linked-person-chip.active')).map(chip => ({
      name: chip.dataset.name,
      relation: chip.dataset.relation || ''
    }));
  },

  saveTask() {
    const titleInput = document.getElementById('taskTitle');
    const title = titleInput.value.trim();
    
    if (!title) {
      this.showToast('请输入任务标题', 'error');
      titleInput.focus();
      return;
    }
    
    const descInput = document.getElementById('taskDesc');
    const dueInput = document.getElementById('taskDue');
    const durationInput = document.getElementById('taskDuration');
    const priorityInput = document.getElementById('taskPriority');
    const syncCalendarInput = document.getElementById('syncCalendar');
    const taskTypeInput = document.getElementById('taskType');
    const taskExpertInput = document.getElementById('taskExpert');
    const taskType = taskTypeInput?.value || 'manual';
    const expertId = taskExpertInput?.value || null;
    
    // 构建周期性重复数据
    const recurrenceType = document.getElementById('taskRecurrence')?.value || 'none';
    let recurrence = null;
    if (recurrenceType !== 'none') {
      recurrence = { type: recurrenceType };
      if (recurrenceType === 'custom') {
        recurrence.interval = parseInt(document.getElementById('recurrenceInterval')?.value) || 2;
        recurrence.unit = document.getElementById('recurrenceUnit')?.value || 'day';
      }
      if (recurrenceType === 'weekly') {
        const selectedDays = Array.from(document.querySelectorAll('.weekday-btn.active')).map(b => parseInt(b.dataset.day));
        recurrence.daysOfWeek = selectedDays.length > 0 ? selectedDays : [new Date(dueInput.value).getDay()];
      }
      const endDateVal = document.getElementById('recurrenceEndDate')?.value;
      if (endDateVal) recurrence.endDate = new Date(endDateVal + 'T23:59:59').toISOString();
    }
    
    const taskData = {
      title: title,
      description: descInput.value.trim(),
      estimatedDuration: parseInt(durationInput.value) || 60,
      priority: priorityInput.value,
      dueDate: dueInput.value ? new Date(dueInput.value).toISOString() : null,
      linkedPersons: this._getAutoLinkedPersons(title, descInput.value.trim()),
      taskType: taskType,
      expertId: expertId,
      recurrence: recurrence,
    };
    
    // AI 小助手任务必须有截止时间
    if (taskType === 'ai_scheduled' && !taskData.dueDate) {
      this.showToast('AI 小助手任务必须设置截止时间', 'error');
      dueInput.focus();
      return;
    }
    
    // 周期性任务必须有截止时间
    if (recurrence && recurrence.type !== 'none' && !taskData.dueDate) {
      this.showToast('周期性任务必须设置截止时间', 'error');
      dueInput.focus();
      return;
    }

    // AI 小助手任务：获取专家名称
    if (taskType === 'ai_scheduled' && expertId) {
      const expertOption = taskExpertInput.selectedOptions[0];
      if (expertOption) {
        taskData.expertName = expertOption.textContent.trim();
      }
    }
    
    if (this.editingTask && this.editingTask.id) {
      // 编辑周期性实例：询问修改范围
      if (this.editingTask.recurrence?.isInstance) {
        this._showRecurrenceEditDialog(this.editingTask, taskData);
        return;
      }
      
      const updatedTask = Store.updateTask(this.editingTask.id, taskData);
      updatedTask.reminders = Reminder.calculateReminders(updatedTask);
      Store.updateTask(updatedTask.id, { reminders: updatedTask.reminders });
      
      if (syncCalendarInput.checked && taskType !== 'ai_scheduled' && window.electronAPI) {
        window.electronAPI.addToCalendar(updatedTask);
      }
      
      // v1.1 反馈：编辑任务
      if (this.editingTask._aiTraceId && window.electronAPI?.feedback?.edit) {
        window.electronAPI.feedback.edit(this.editingTask._aiTraceId, this.editingTask, taskData, 'manual_edit');
      }
      
      this.showToast('任务已更新');
    } else {
      const newTask = Store.addTask(taskData);
      newTask.reminders = Reminder.calculateReminders(newTask);
      Store.updateTask(newTask.id, { reminders: newTask.reminders });
      
      // AI 小助手定时任务默认不同步到日历
      if (syncCalendarInput.checked && taskType !== 'ai_scheduled' && window.electronAPI) {
        window.electronAPI.addToCalendar(newTask);
      }
      
      // 周期性任务：标记为模板并生成未来的实例
      if (recurrence && recurrence.type !== 'none') {
        const updatedRecurrence = {
          ...recurrence,
          isTemplate: true,
          parentId: newTask.id,
          isInstance: false
        };
        Store.updateTask(newTask.id, { recurrence: updatedRecurrence });
        // 🔧 关键修复：同步更新内存中的 recurrence，否则 createNextRecurrenceInstance
        // 会因 !parentId && !isTemplate 提前返回 null，导致只创建了一条任务
        newTask.recurrence = updatedRecurrence;
        // 预生成未来实例（未来30天）
        this._generateRecurringInstances(newTask);
      }
      
      // AI 小助手任务：立即注册定时执行
      if (taskType === 'ai_scheduled') {
        this._scheduleAITask(newTask);
        this.showToast(`AI 小助手任务已创建，将在截止时间自动执行`);
      } else if (recurrence && recurrence.type !== 'none') {
        const label = Store.getRecurrenceLabel(recurrence);
        this.showToast(`周期性任务已创建（${label}）`);
      } else {
        this.showToast('任务已创建');
      }
    }
    
    this.hideTaskModal();
    this.renderTaskList();
    Calendar.render();
  },
  
  _generateRecurringInstances(templateTask) {
    if (!templateTask.recurrence || templateTask.recurrence.type === 'none') return;
    const now = new Date();
    const futureLimit = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 未来30天
    const endDate = templateTask.recurrence.endDate ? new Date(templateTask.recurrence.endDate) : null;
    const limit = endDate && endDate < futureLimit ? endDate : futureLimit;
    
    let currentDate = new Date(templateTask.dueDate);
    let count = 0;
    const maxInstances = 60; // 安全上限
    
    while (count < maxInstances) {
      const nextDate = Store.getNextRecurrenceDate(currentDate.toISOString(), templateTask.recurrence);
      if (!nextDate || nextDate > limit) break;
      
      // 检查该日期是否已有实例
      const existing = Store.getTasks().find(t =>
        t.recurrence?.parentId === templateTask.id &&
        t.dueDate && new Date(t.dueDate).toDateString() === nextDate.toDateString()
      );
      if (!existing) {
        Store.createNextRecurrenceInstance({ ...templateTask, dueDate: currentDate.toISOString() });
      }
      currentDate = nextDate;
      count++;
    }
  },
  
  // AI分析任务输入
  async analyzeTaskInput() {
    const input = this._aiTaskEditor ? this._aiTaskEditor.getText().trim() : (document.getElementById('aiTaskInput')?.value?.trim() || '');
    if (!input) {
      this.showToast('请输入任务描述', 'error');
      return;
    }
    
    const btn = document.getElementById('aiAnalyzeBtn');
    const originalText = btn?.textContent || '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '🤖 分析中...';
    }

    // 显示分析进度
    const resultArea = document.getElementById('aiAnalysisResult');
    const analysisContent = document.getElementById('analysisContent');
    if (resultArea) {
      resultArea.classList.remove('hidden');
      if (analysisContent) {
        analysisContent.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;color:var(--primary-color);">
            <div class="ai-analysis-spinner" style="width:16px;height:16px;border:2px solid var(--border-light);border-top-color:var(--primary-color);border-radius:50%;animation:aiSpin 0.8s linear infinite;"></div>
            <span>正在分析内容，识别待办事项...</span>
          </div>
          <style>@keyframes aiSpin{to{transform:rotate(360deg)}}</style>
        `;
      }
    }
    const confidenceEl = document.getElementById('analysisConfidence');
    if (confidenceEl) confidenceEl.textContent = '分析中...';

    try {
      if (window.electronAPI) {
        // 调用AI分析
        const result = await window.electronAPI.analyzeTask(input);
        
        if (result.success && result.task) {
          // 填充表单
          document.getElementById('taskTitle').value = result.task.title || '';
          document.getElementById('taskDesc').value = result.task.description || '';
          
          if (result.task.dueDate) {
            const date = new Date(result.task.dueDate);
            document.getElementById('taskDue').value = date.toISOString().slice(0, 16);
          }
          
          document.getElementById('taskPriority').value = result.task.priority || 'medium';
          document.getElementById('taskDuration').value = result.task.estimatedDuration || 60;
          
          // v2.1: AI 分析结果回填 taskType 和 recurrence
          if (result.task.taskType && result.task.taskType !== 'manual') {
            const taskTypeInput = document.getElementById('taskType');
            if (taskTypeInput) {
              taskTypeInput.value = result.task.taskType;
              // 触发 change 事件以显示/隐藏 AI 专家选择组
              taskTypeInput.dispatchEvent(new Event('change'));
            }
          }
          if (result.task.recurrence && result.task.recurrence.type && result.task.recurrence.type !== 'none') {
            const recurrenceInput = document.getElementById('taskRecurrence');
            if (recurrenceInput) {
              recurrenceInput.value = result.task.recurrence.type;
              this._updateRecurrenceUI();
              // 回填 weekly 天数
              if (result.task.recurrence.type === 'weekly' && result.task.recurrence.daysOfWeek) {
                document.querySelectorAll('.weekday-btn').forEach(btn => {
                  btn.classList.toggle('active', result.task.recurrence.daysOfWeek.includes(parseInt(btn.dataset.day)));
                });
              }
            }
          }
          
          // AI 识别到的人物 → 自动关联
          if (result.task.linked_persons && result.task.linked_persons.length > 0) {
            this._renderTaskLinkedPersons(result.task.linked_persons.map(name => ({ name })));
          }
          
          // 显示分析结果
          if (confidenceEl) confidenceEl.textContent = `置信度: ${Math.round(result.task.confidence * 100)}%`;
          
          let analysisHtml = `<div style="margin-top: 8px;">`;
          analysisHtml += `<div style="color:var(--success-color);font-weight:500;margin-bottom:6px;">✅ 分析完成</div>`;
          if (result.task.isAllDay) {
            analysisHtml += `<div>📅 识别为全天任务</div>`;
            document.getElementById('isAllDay').checked = true;
            document.getElementById('taskDuration').value = 480;
            document.getElementById('taskPomodoros').value = 'auto';
          }
          if (result.task.tags && result.task.tags.length > 0) {
            analysisHtml += `<div>🏷️ 标签: ${result.task.tags.join(', ')}</div>`;
          }
          if (result.task.reason) {
            analysisHtml += `<div>📝 分析依据: ${result.task.reason}</div>`;
          }
          analysisHtml += `</div>`;
          
          if (analysisContent) analysisContent.innerHTML = analysisHtml;
          
          // 自动计算番茄钟
          this.updatePomodoroHint();
          
          this.showToast('AI分析完成', 'success');
        } else {
          if (analysisContent) {
            analysisHtml = `<div style="color:var(--danger-color);">❌ 分析失败${result.error ? '：' + result.error : ''}，请重试</div>`;
            analysisContent.innerHTML = analysisHtml;
          }
          if (confidenceEl) confidenceEl.textContent = '分析失败';
          this.showToast('分析失败，请重试', 'error');
        }
      }
    } catch (error) {
      console.error('AI分析失败:', error);
      if (analysisContent) {
        analysisContent.innerHTML = `<div style="color:var(--danger-color);">❌ 分析出错：${error.message}</div>`;
      }
      if (confidenceEl) confidenceEl.textContent = '分析出错';
      this.showToast('分析失败，请重试', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText || '🤖 AI分析待办';
      }
    }
  },
  
  async saveAIToNote() {
    const textContent = this._aiTaskEditor ? this._aiTaskEditor.getText().trim() : (document.getElementById('aiTaskInput')?.value?.trim() || '');
    const htmlContent = this._aiTaskEditor ? this._aiTaskEditor.getHTML() : undefined;
    // 富文本可能只有图片没有文字，此时 htmlContent 有内容但 textContent 为空
    const hasContent = textContent || (htmlContent && htmlContent.trim() && htmlContent.trim() !== '<br>');
    if (!hasContent) {
      this.showToast('请输入内容', 'error');
      return;
    }
    
    try {
      if (window.electronAPI) {
        const category = this.autoClassifyNote(textContent || '图片笔记');
        
        const result = await window.electronAPI.notebookAddNote({
          content: textContent || '图片笔记',
          htmlContent: htmlContent,
          category: category
        });
        
        if (result.success) {
          if (result.duplicate) {
            this.showToast('今天已有相同内容，已跳过', 'info');
          } else {
            this.incrementNewNoteCount();
            this.showToast(`已保存到记事本（${this.getNoteCategoryLabel(category)}）`);
          }
          document.getElementById('aiTaskInput') && (document.getElementById('aiTaskInput').value = '');
          if (this._aiTaskEditor) this._aiTaskEditor.clear();
        }
      }
    } catch (error) {
      console.error('保存到记事本失败:', error);
      this.showToast('保存到记事本失败', 'error');
    }
  },
  
  async extractAIMemory() {
    const input = this._aiTaskEditor ? this._aiTaskEditor.getText().trim() : (document.getElementById('aiTaskInput')?.value?.trim() || '');
    if (!input) {
      this.showToast('请输入内容', 'error');
      return;
    }
    
    try {
      if (window.electronAPI) {
        this.showToast('正在提炼记忆...', 'info');
        
        const memoryResult = await window.electronAPI.extractMemory(input);
        
        if (memoryResult.success && memoryResult.memory) {
          this.showToast('已提炼并保存到记忆');
          document.getElementById('aiTaskInput') && (document.getElementById('aiTaskInput').value = '');
          if (this._aiTaskEditor) this._aiTaskEditor.clear();
        } else {
          this.showToast('提炼记忆失败', 'error');
        }
      }
    } catch (error) {
      console.error('提炼记忆失败:', error);
      this.showToast('提炼记忆失败', 'error');
    }
  },

  async saveAIAsQuestion() {
    const input = this._aiTaskEditor ? this._aiTaskEditor.getText().trim() : (document.getElementById('aiTaskInput')?.value?.trim() || '');
    if (!input) {
      this.showToast('请输入问题内容', 'error');
      return;
    }

    try {
      if (window.electronAPI?.knowledgeAddAtom) {
        const result = await window.electronAPI.knowledgeAddAtom({
          content: input,
          domain: '通用',
          type: 'question',
          importance: 0.7
        });
        if (result.success) {
          this.showToast('❓ 问题已记录到知识库');
          document.getElementById('aiTaskInput') && (document.getElementById('aiTaskInput').value = '');
          if (this._aiTaskEditor) this._aiTaskEditor.clear();
        } else {
          this.showToast('记录问题失败', 'error');
        }
      }
    } catch (error) {
      console.error('记录问题失败:', error);
      this.showToast('记录问题失败', 'error');
    }
  },
  
  // 更新番茄钟提示
  updatePomodoroHint() {
    const duration = parseInt(document.getElementById('taskDuration').value) || 60;
    const pomodoros = document.getElementById('taskPomodoros').value;
    
    if (pomodoros === 'auto') {
      // 智能分配：每25分钟一个番茄，加上休息时间
      const pomodoroCount = Math.ceil(duration / 25);
      const hint = `智能分配：${pomodoroCount}个番茄钟（${duration}分钟 ÷ 25分钟/番茄）`;
      document.getElementById('pomodoroHint').textContent = hint;
    } else {
      const pomodoroMinutes = parseInt(pomodoros) * 25;
      const hint = `手动设置：${pomodoros}个番茄钟（约${pomodoroMinutes}分钟专注时间）`;
      document.getElementById('pomodoroHint').textContent = hint;
    }
  },
  
  renderTaskList() {
    const tasks = Store.getTasks().filter(t => t.status !== 'completed');
    const container = document.getElementById('taskList');
    
    if (tasks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1"/>
            <path d="M9 12h6M9 16h6"/>
          </svg>
          <p>${window.i18n?.t('task.empty') || '暂无待办事项'}</p>
        </div>
      `;
      this._updateCollapsedSidebar();
      return;
    }
    
    // 排序：默认按截止时间，可切换按优先级/最新
    const sortBy = this._taskSortBy || 'dueDate';
    const sortedTasks = tasks.sort((a, b) => {
      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      const priorityOrder = { high: 0, medium: 1, low: 2 };

      if (sortBy === 'priority') {
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        // 优先级相同：按截止时间 → 创建时间（最新在前）
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        if (aDate !== bDate) return aDate - bDate;
        return bCreated - aCreated;
      } else if (sortBy === 'latest') {
        // 按创建时间倒序（最新在前）
        if (aCreated !== bCreated) return bCreated - aCreated;
        // 创建时间相同按优先级
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      } else {
        // 默认：按截止时间排序（临近的在前）
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        if (aDate !== bDate) return aDate - bDate;
        // 截止时间相同：按优先级 → 创建时间（最新在前）
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return bCreated - aCreated;
      }
    });
    
    container.innerHTML = sortedTasks.map(task => this.renderTaskItem(task)).join('');
    // 事件委托已在 bindEvents() 中绑定，无需逐元素 addEventListener
    // 更新收起状态下的任务数角标
    this._updateCollapsedSidebar();
  },

  // === 任务列表事件委托处理 ===
  _handleTaskListClick(e) {
    const item = e.target.closest('.task-item');
    if (!item) return;
    const taskId = item.dataset.id;

    // 复选框
    if (e.target.closest('.task-checkbox')) {
      e.stopPropagation();
      this.completeTask(taskId);
      return;
    }
    // 番茄钟
    if (e.target.closest('.start-pomodoro')) {
      e.stopPropagation();
      const task = Store.getTasks().find(t => t.id === taskId);
      if (task) {
        const plannedCount = Pomodoro.addPlannedSession(taskId, task.title);
        this.showToast(`已添加番茄钟（计划${plannedCount}个）`);
        if (!Pomodoro.state.isRunning) {
          Pomodoro.start(taskId);
        }
      }
      return;
    }
    // 删除
    if (e.target.closest('.delete-task-btn')) {
      e.stopPropagation();
      const task = Store.getTasks().find(t => t.id === taskId);
      if (task) {
        if (task.recurrence && (task.recurrence.isTemplate || task.recurrence.isInstance)) {
          this._showRecurrenceDeleteDialog(task);
        } else {
          this.showConfirmDialog('删除确认', `确定要删除任务"${task.title}"吗？`).then(confirmed => {
            if (confirmed) {
              Store.deleteTask(taskId);
              if (window.electronAPI?.removeFromCalendar) {
                window.electronAPI.removeFromCalendar(task.title);
              }
              this.renderTaskList();
              Calendar.render();
            }
          });
        }
      }
      return;
    }
    // 点击任务项本身 → 打开编辑
    const task = Store.getTasks().find(t => t.id === taskId);
    if (task) this.showTaskModal(task);
  },

  _handleTaskListMouseOver(e) {
    const item = e.target.closest('.task-item');
    if (!item) return;
    const related = e.relatedTarget?.closest?.('.task-item');
    if (related === item) return; // 仍在同一 item 内移动
    this._showTaskHoverPreview(item, e);
  },

  _handleTaskListMouseOut(e) {
    const item = e.target.closest('.task-item');
    if (!item) return;
    const related = e.relatedTarget?.closest?.('.task-item');
    if (related === item) return; // 仍在同一 item 内移动
    this._hideTaskHoverPreview();
  },

  _handleTaskListMouseMove(e) {
    const item = e.target.closest('.task-item');
    if (!item) return;
    this._moveTaskHoverPreview(e);
  },

  renderTaskItem(task) {
    const dueDate = task.dueDate ? new Date(task.dueDate) : null;
    const isOverdue = dueDate && dueDate < new Date() && task.status !== 'completed';
    const relativeTime = dueDate ? this.getRelativeTime(dueDate) : '无截止时间';
    const priorityBadge = `<span class="priority-badge ${task.priority}">${task.priority === 'high' ? '高' : task.priority === 'medium' ? '中' : '低'}</span>`;
    const draftBadge = task.isDraft ? `<span class="draft-badge">草稿</span>` : '';
    const overdueBadge = isOverdue ? `<span class="overdue-badge">逾期</span>` : '';
    const aiTaskBadge = task.taskType === 'ai_scheduled' ? `<span class="ai-task-badge">🤖 AI</span>` : '';
    // 周期性任务徽标
    const recurrenceLabel = Store.getRecurrenceLabel(task.recurrence);
    const recurrenceBadge = recurrenceLabel ? `<span class="recurrence-badge">🔁 ${recurrenceLabel}</span>` : '';
    // 计算该任务已完成的番茄数
    const completedPomodoros = (task.pomodoroSessions || []).filter(s => s.type === 'work' && s.completed).length;
    const pomodoroCountHtml = completedPomodoros > 0 ? `<span class="pomodoro-count">🍅×${completedPomodoros}</span>` : '';
    
    // 构造 hover 预览内容
    const dueDateStr = dueDate ? dueDate.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '无截止时间';
    const priorityLabel = { high: '🔴 高', medium: '🟡 中', low: '🟢 低' }[task.priority] || '🟡 中';
    const descPreview = task.description ? task.description.substring(0, 200) + (task.description.length > 200 ? '...' : '') : '';
    const hoverContent = `${task.title}\n⏰ ${dueDateStr}\n🔥 优先级: ${priorityLabel}\n⏱ 预计: ${task.estimatedDuration || 60}分钟${recurrenceLabel ? '\n🔁 ' + recurrenceLabel : ''}${descPreview ? '\n\n' + descPreview : ''}`;
    
    // 关联人物标签
    const linkedPersonsHtml = (task.linkedPersons && task.linkedPersons.length > 0)
      ? task.linkedPersons.map(p => {
          const name = typeof p === 'string' ? p : p.name;
          const relation = typeof p === 'string' ? '' : (p.relation || '');
          const relTag = relation ? `<span class="person-relation-tag ${this._getRelationClass(relation)}">${this.escapeHtml(relation)}</span>` : '';
          return `<span class="task-person-chip">${this.escapeHtml(name)}${relTag}</span>`;
        }).join('')
      : '';
    
    return `
      <div class="task-item${task.isDraft ? ' draft-item' : ''}${isOverdue ? ' overdue-item' : ''}" data-id="${task.id}" data-hover-content="${this.escapeHtml(hoverContent)}">
        <div class="task-checkbox"></div>
        <div class="task-info">
          <div class="title">${task.title} ${draftBadge} ${overdueBadge} ${aiTaskBadge} ${recurrenceBadge}</div>
          <div class="meta">
            ${priorityBadge}
            <span class="${isOverdue ? 'overdue-text' : ''}">${relativeTime}</span>
            <span>${task.estimatedDuration}分钟</span>
            ${pomodoroCountHtml}
            ${linkedPersonsHtml}
          </div>
        </div>
        <div class="task-actions">
          <button class="task-action-btn start-pomodoro" title="增加一个番茄钟">🍅</button>
          <button class="task-action-btn delete-task-btn" title="删除任务">🗑</button>
        </div>
      </div>
    `;
  },

  completeTask(taskId) {
    const task = Store.getTasks().find(t => t.id === taskId);
    Store.completeTask(taskId);
    
    // 周期性任务完成后，自动生成下一个实例
    if (task?.recurrence?.isInstance || task?.recurrence?.isTemplate) {
      const parentId = task.recurrence.parentId || task.id;
      const template = Store.getTasks().find(t => t.id === parentId);
      if (template) {
        // 查找该 parentId 下是否还有未完成的未来实例
        const instances = Store.getRecurringInstances(parentId).filter(t =>
          t.id !== parentId && t.status !== 'completed' && new Date(t.dueDate) > new Date()
        );
        if (instances.length === 0) {
          // 生成下一个实例
          Store.createNextRecurrenceInstance(template);
        }
      }
    }
    
    this.renderTaskList();
    Calendar.render();
    this.showToast('任务已完成');
  },

  // === 待办列表 hover 预览 ===
  _showTaskHoverPreview(item, e) {
    const content = item.dataset.hoverContent;
    if (!content) return;
    
    this._hideTaskHoverPreview();
    
    const preview = document.createElement('div');
    preview.className = 'task-hover-preview';
    preview.innerHTML = content.split('\n').map(line => {
      if (line.startsWith('⏰') || line.startsWith('🔥') || line.startsWith('⏱')) {
        return `<div class="task-preview-meta">${line}</div>`;
      }
      return `<div class="task-preview-title">${line}</div>`;
    }).join('');
    
    document.body.appendChild(preview);
    this._moveTaskHoverPreview(e);
  },

  _moveTaskHoverPreview(e) {
    const preview = document.querySelector('.task-hover-preview');
    if (!preview) return;
    
    const padding = 12;
    const previewRect = preview.getBoundingClientRect();
    let x = e.clientX + padding;
    let y = e.clientY + padding;
    
    // 防止超出视口
    if (x + previewRect.width > window.innerWidth) {
      x = e.clientX - previewRect.width - padding;
    }
    if (y + previewRect.height > window.innerHeight) {
      y = e.clientY - previewRect.height - padding;
    }
    
    preview.style.left = x + 'px';
    preview.style.top = y + 'px';
  },

  _hideTaskHoverPreview() {
    const preview = document.querySelector('.task-hover-preview');
    if (preview) preview.remove();
  },

  getRelativeTime(date) {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (diff < 0) {
      return '已过期';
    } else if (minutes < 60) {
      return `${minutes}分钟后`;
    } else if (hours < 24) {
      return `${hours}小时后`;
    } else if (days < 7) {
      return `${days}天后`;
    } else {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
  },

  showToast(message, type = 'success') {
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
      existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      padding: 12px 24px;
      background: ${type === 'error' ? '#FF3B30' : '#34C759'};
      color: white;
      border-radius: 12px;
      font-size: 14px;
      z-index: 3000;
      animation: fadeIn 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  },

  // === 自定义弹窗方法已提取到 app-clipboard-dialog.js ===

  // === 文件卡片按钮绑定（保存 + 打开）===
  _bindFileCardActions(container) {
    if (!container) return;
    container.querySelectorAll('.adp-file-card').forEach(card => {
      // 保存按钮
      const saveBtn = card.querySelector('.adp-file-save-btn');
      if (saveBtn && !saveBtn._fcBound) {
        saveBtn._fcBound = true;
        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const url = card.dataset.url;
          const name = card.dataset.name;
          if ((url && url !== '#') || card.dataset.filepath) {
            this._downloadFileToArtifacts(url, name, card);
          }
        });
      }
      // 打开按钮
      const openBtn = card.querySelector('.adp-file-open-btn');
      if (openBtn && !openBtn._fcBound) {
        openBtn._fcBound = true;
        openBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const url = card.dataset.url;
          const savedPath = card.dataset.savedPath;
          // 优先打开已保存的本地文件
          if (savedPath && window.electronAPI?.artifactsRead) {
            try {
              const result = await window.electronAPI.artifactsRead({ filePath: savedPath });
              if (result.success && result.content) {
                const ext = (card.dataset.name || '').split('.').pop()?.toLowerCase();
                if (['html', 'htm', 'svg'].includes(ext)) {
                  const blob = new Blob([result.content], { type: ext === 'svg' ? 'image/svg+xml' : 'text/html' });
                  const blobUrl = URL.createObjectURL(blob);
                  window.electronAPI?.openExternal(blobUrl);
                } else {
                  window.electronAPI?.artifactsShowInFolder?.(savedPath);
                }
                return;
              }
            } catch {}
          }
          // 其次打开 URL
          if (url && url !== '#') {
            window.electronAPI?.openExternal(url);
          } else {
            this.showToast('请先保存后再打开', 'info');
          }
        });
      }
    });
  },

  // === Agent 产物保存按钮绑定（已由 chatMessages 事件委托统一处理，此方法保留兼容空壳）===
  _bindArtifactSaveButtons(container) {
    // no-op: 由 _handleChatClick 事件委托统一处理
  },

  // === 下载文件到 Agent 产物 ===
  async _downloadFileToArtifacts(url, fileName, cardEl) {
    // 检查是否为容器内文件路径（data-filepath）
    const filePath = cardEl?.dataset?.filepath;
    if (filePath && (!url || url === '#')) {
      // 容器内文件路径，无法直接下载，保存为引用文件
      await this._saveFilePathReference(filePath, fileName, cardEl);
      return;
    }
    if (!window.electronAPI?.artifactsDownloadAndSave) {
      this.showToast('产物保存功能不可用，请重启应用', 'error');
      return;
    }
    // 更新卡片状态
    const saveSpan = cardEl?.querySelector('.adp-file-save-btn');
    const originalText = saveSpan?.textContent || '';
    if (saveSpan) saveSpan.textContent = '⏳ 下载中...';

    try {
      const result = await window.electronAPI.artifactsDownloadAndSave({ url, fileName });
      if (result.success) {
        if (saveSpan) saveSpan.textContent = '✅ 已保存';
        if (cardEl && result.path) cardEl.dataset.savedPath = result.path;
        this.showToast(`已保存到 Agent 产物: ${result.name}`, 'success');
      } else {
        if (saveSpan) saveSpan.textContent = originalText;
        this.showToast('下载失败: ' + (result.error || ''), 'error');
      }
    } catch (err) {
      if (saveSpan) saveSpan.textContent = originalText;
      this.showToast('下载出错: ' + err.message, 'error');
    }
  },

  // 保存容器内文件路径引用（文件在 ADP 容器中，本地无法直接下载）
  async _saveFilePathReference(filePath, fileName, cardEl) {
    if (!window.electronAPI?.artifactsSave) {
      this.showToast('产物保存功能不可用', 'error');
      return;
    }
    const saveSpan = cardEl?.querySelector('.adp-file-save-btn');
    const originalText = saveSpan?.textContent || '';
    if (saveSpan) saveSpan.textContent = '⏳ 保存中...';

    try {
      // 保存为引用文件，包含文件路径和来源信息
      const refContent = `文件路径引用\n============\n文件名: ${fileName}\n容器路径: ${filePath}\n来源: ADP 智能体\n时间: ${new Date().toLocaleString('zh-CN')}\n\n注意: 此文件位于 ADP 智能体容器内，请在 ADP 对话中通过文件卡片下载。`;
      const result = await window.electronAPI.artifactsSave({
        content: refContent,
        fileName: `${fileName}.引用.txt`,
        source: 'adp-container-ref'
      });
      if (result.success) {
        if (saveSpan) saveSpan.textContent = '✅ 已保存';
        if (cardEl && result.path) cardEl.dataset.savedPath = result.path;
        this.showToast(`已保存引用到 Agent 产物: ${result.name}`, 'success');
      } else {
        if (saveSpan) saveSpan.textContent = originalText;
        this.showToast('保存失败: ' + (result.error || ''), 'error');
      }
    } catch (err) {
      if (saveSpan) saveSpan.textContent = originalText;
      this.showToast('保存出错: ' + err.message, 'error');
    }
  },

  // === Phase 2: Agent 操作按钮处理 ===
  handleAgentAction(action, result, agentType) {
    switch (action) {
      case 'create-all-tasks':
        if (result?.today_top5?.length) {
          result.today_top5.forEach(item => {
            const title = item.reason || item.task_id || '排程任务';
            const task = Store.addTask({
              title: title.substring(0, 50),
              description: `排程时间：${item.scheduled_at || ''}`,
              estimatedDuration: 60, priority: 'high',
              dueDate: this.getDefaultDueDate().toISOString(),
              source: 'agent_priority'
            });
            task.reminders = Reminder.calculateReminders(task);
            Store.updateTask(task.id, { reminders: task.reminders });
          });
          this.renderTaskList(); Calendar.render();
          this.showToast(`已创建 ${result.today_top5.length} 个排程任务`);
        }
        break;
      case 'save-to-note':
        if (result && window.electronAPI) {
          window.electronAPI.notebookAddNote({ content: JSON.stringify(result, null, 2), category: 'general' }).then(r => {
            if (r.success && r.duplicate) this.showToast('今天已有相同内容，已跳过', 'info');
            else if (r.success) this.showToast('已保存到笔记');
          });
        }
        break;
      case 'copy-result':
        if (result) (window.electronAPI ? window.electronAPI.writeClipboardText(JSON.stringify(result, null, 2)) : navigator.clipboard.writeText(JSON.stringify(result, null, 2))).then(() => this.showToast('已复制到剪贴板'));
        break;
      case 'apply-memory-changes':
        if (result?.promote?.length && window.electronAPI) {
          result.promote.forEach(p => {
            window.electronAPI.feedback.record({ trace_id: 'memory_agent', action: 'promote', reason: `${p.from} → ${p.to}: ${p.reason || ''}` });
          });
          this.showToast('记忆变更已记录');
        }
        break;
      default: this.showToast(`操作：${action}`);
    }
  },

  // === Phase 3: Prompt 优化器 ===
  async runPromptOptimizer() {
    const module = document.getElementById('optimizerModule')?.value || 'task_recognition';
    const statusEl = document.getElementById('optimizerStatus');
    const resultsEl = document.getElementById('optimizerResults');
    if (!window.electronAPI?.optimizer?.run) { this.showToast('优化器功能不可用', 'error'); return; }

    statusEl.style.display = 'flex';
    resultsEl.innerHTML = '<p style="color: var(--text-secondary);">正在运行优化器...</p>';
    try {
      const result = await window.electronAPI.optimizer.run({ module, badCases: 30 });
      statusEl.style.display = 'none';
      if (result.success) { await this.loadOptimizerCandidates(); this.showToast('优化器运行完成'); }
      else { resultsEl.innerHTML = `<p class="error-text">优化器运行失败：${this.escapeHtml(result.error || '')}</p><pre style="font-size:11px; max-height:200px; overflow:auto; background:var(--bg-secondary); padding:10px; border-radius:8px;">${this.escapeHtml(result.output || '')}</pre>`; }
    } catch (error) {
      statusEl.style.display = 'none';
      resultsEl.innerHTML = `<p class="error-text">错误：${this.escapeHtml(error.message)}</p>`;
    }
  },

  async loadOptimizerCandidates() {
    if (!window.electronAPI?.optimizer?.listCandidates) return;
    const resultsEl = document.getElementById('optimizerResults');
    const result = await window.electronAPI.optimizer.listCandidates();
    if (!result.candidates?.length) {
      resultsEl.innerHTML = '<p style="color: var(--text-secondary); font-size: 13px;">暂无候选 Prompt。运行优化器后，改进版 Prompt 将出现在这里。</p>';
      return;
    }
    resultsEl.innerHTML = result.candidates.map(c => {
      const report = c.report || {};
      const improvement = report.improvement || 0;
      const badge = improvement >= 0.05 ? 'improved' : improvement >= 0 ? '' : 'declined';
      const badgeText = improvement >= 0.05 ? '✅ 建议启用' : improvement >= 0 ? '⚡ 提升不显著' : '❌ 表现下降';
      return `<div class="optimizer-candidate">
        <div class="candidate-header">
          <span class="candidate-name">${this.escapeHtml(c.name)}</span>
          <span class="candidate-badge ${badge}">${badgeText}</span>
        </div>
        <div class="candidate-stats">
          <span>旧版本：${((report.old_pass_rate || 0) * 100).toFixed(1)}%</span>
          <span>新版本：${((report.new_pass_rate || 0) * 100).toFixed(1)}%</span>
          <span>提升：${(improvement * 100).toFixed(1)}%</span>
        </div>
        <div class="candidate-actions">
          <button class="btn primary small apply-candidate-btn" data-candidate-filename="${this.escapeHtml(c.filename)}">启用此版本</button>
        </div>
      </div>`;
    }).join('');

    // 事件委托
    resultsEl.onclick = (e) => {
      const btn = e.target.closest('.apply-candidate-btn');
      if (btn) this.applyOptimizerCandidate(btn.dataset.candidateFilename);
    };
  },

  async applyOptimizerCandidate(filename) {
    if (!window.electronAPI?.optimizer?.applyCandidate) return;
    const result = await window.electronAPI.optimizer.applyCandidate(filename);
    if (result.success) { this.showToast(`已启用候选 Prompt：${filename}`); await this.loadOptimizerCandidates(); }
    else this.showToast('启用失败：' + (result.error || ''), 'error');
  },

  // === Phase 3: 用户画像编辑 ===
  async loadProfileEditor() {
    if (!window.electronAPI?.profile?.get) return;
    const profile = await window.electronAPI.profile.get();

    // 如果已登录，从远程补充本地缺失的字段（本地优先，仅本地为空时补充）
    if (window.electronAPI?.authGetState) {
      try {
        const authState = await window.electronAPI.authGetState();
        if (authState.isLoggedIn && authState.user) {
          profile.user = profile.user || {};
          const remoteUser = authState.user;
          // 仅本地为空时从远程补充，避免远程旧数据覆盖本地新数据
          if (!profile.user.name && remoteUser.name) profile.user.name = remoteUser.name;
          if (!profile.user.email && remoteUser.email) profile.user.email = remoteUser.email;
          if (!profile.user.mobile && remoteUser.mobile) profile.user.mobile = remoteUser.mobile;
          if (!profile.user.nickname && remoteUser.nickname) profile.user.nickname = remoteUser.nickname;
          if (profile.user.gender == null && remoteUser.gender != null) profile.user.gender = remoteUser.gender;
          if (!profile.user.birth_date && remoteUser.birth_date) profile.user.birth_date = remoteUser.birth_date;
          if (!profile.user.profession && remoteUser.profession) profile.user.profession = remoteUser.profession;
          if (!profile.user.organization && remoteUser.organization) profile.user.organization = remoteUser.organization;
          if (!profile.user.industry && remoteUser.industry) profile.user.industry = remoteUser.industry;
          if (!profile.user.region && remoteUser.region) profile.user.region = remoteUser.region;
        }
      } catch (e) {
        // 静默失败，使用本地数据
      }
    }

    document.getElementById('profileName').value = profile.user?.name || '';
    document.getElementById('profileEnglishName').value = profile.user?.english_name || '';
    document.getElementById('profileRole').value = profile.user?.role || '';
    document.getElementById('profileIndustries').value = (profile.user?.industries || []).join(', ');
    document.getElementById('prioritySignals').value = (profile.preferences?.priority_signals || []).join(', ');
    document.getElementById('lowPrioritySignals').value = (profile.preferences?.low_priority_signals || []).join(', ');

    const personsList = document.getElementById('frequentPersonsList');
    personsList.innerHTML = (profile.frequent_persons || []).map((p, i) =>
      `<div class="profile-item"><span class="item-name">${this.escapeHtml(p.name)}</span><span class="item-detail">${this.escapeHtml(p.relation || '')}${p.company ? ' @ ' + this.escapeHtml(p.company) : ''}</span><button class="item-remove" data-index="${i}">×</button></div>`
    ).join('') || '<p style="color:var(--text-secondary); font-size:13px;">暂无高频人物</p>';

    const projectsList = document.getElementById('activeProjectsList');
    projectsList.innerHTML = (profile.active_projects || []).map((p, i) =>
      `<div class="profile-item"><span class="item-name">${this.escapeHtml(p.name)}</span><span class="item-detail">${this.escapeHtml(p.status || 'active')}${p.alias?.length ? ' (' + p.alias.join('/') + ')' : ''}</span><button class="item-remove" data-index="${i}">×</button></div>`
    ).join('') || '<p style="color:var(--text-secondary); font-size:13px;">暂无活跃项目</p>';
  },

  async addFrequentPerson() {
    const name = document.getElementById('newPersonName').value.trim();
    const relation = document.getElementById('newPersonRelation').value.trim();
    const company = document.getElementById('newPersonCompany').value.trim();
    if (!name) { this.showToast('请输入姓名', 'error'); return; }
    const profile = await window.electronAPI.profile.get();
    profile.frequent_persons = profile.frequent_persons || [];
    profile.frequent_persons.push({ name, relation, company, freq: 1 });
    await window.electronAPI.profile.update(profile);
    document.getElementById('newPersonName').value = '';
    document.getElementById('newPersonRelation').value = '';
    document.getElementById('newPersonCompany').value = '';
    this.loadProfileEditor(); this.showToast('人物已添加');
  },

  async removeFrequentPerson(index) {
    const profile = await window.electronAPI.profile.get();
    profile.frequent_persons?.splice(index, 1);
    await window.electronAPI.profile.update(profile);
    this.loadProfileEditor(); this.showToast('人物已移除');
  },

  async addActiveProject() {
    const name = document.getElementById('newProjectName').value.trim();
    const alias = document.getElementById('newProjectAlias').value.trim().split(',').map(a => a.trim()).filter(Boolean);
    const status = document.getElementById('newProjectStatus').value;
    if (!name) { this.showToast('请输入项目名', 'error'); return; }
    const profile = await window.electronAPI.profile.get();
    profile.active_projects = profile.active_projects || [];
    profile.active_projects.push({ name, alias, status });
    await window.electronAPI.profile.update(profile);
    document.getElementById('newProjectName').value = '';
    document.getElementById('newProjectAlias').value = '';
    this.loadProfileEditor(); this.showToast('项目已添加');
  },

  async removeActiveProject(index) {
    const profile = await window.electronAPI.profile.get();
    profile.active_projects?.splice(index, 1);
    await window.electronAPI.profile.update(profile);
    this.loadProfileEditor(); this.showToast('项目已移除');
  },

  async saveProfileFromEditor() {
    if (!window.electronAPI?.profile?.update) return;
    const profile = await window.electronAPI.profile.get();
    profile.user = profile.user || {};
    const nameVal = document.getElementById('profileName').value.trim();
    const englishNameVal = document.getElementById('profileEnglishName').value.trim();
    const roleVal = document.getElementById('profileRole').value.trim();
    // 允许清空字段：输入框有内容则更新，为空也更新（清空），仅 null/undefined 时保留旧值
    if (nameVal !== '' || !profile.user.name) profile.user.name = nameVal;
    if (englishNameVal !== '' || !profile.user.english_name) profile.user.english_name = englishNameVal;
    if (roleVal !== '' || !profile.user.role) profile.user.role = roleVal;
    profile.user.industries = document.getElementById('profileIndustries').value.split(',').map(s => s.trim()).filter(Boolean);
    profile.preferences = profile.preferences || {};
    profile.preferences.priority_signals = document.getElementById('prioritySignals').value.split(',').map(s => s.trim()).filter(Boolean);
    profile.preferences.low_priority_signals = document.getElementById('lowPrioritySignals').value.split(',').map(s => s.trim()).filter(Boolean);
    await window.electronAPI.profile.update(profile);

    // 同步姓名等基础信息到远程（如果已登录），保持两端一致
    if (window.electronAPI?.authUpdateProfile && nameVal) {
      try {
        const authState = await window.electronAPI.authGetState();
        if (authState.isLoggedIn) {
          const syncData = { name: nameVal };
          if (englishNameVal) syncData.nickname = englishNameVal;
          await window.electronAPI.authUpdateProfile(syncData);
        }
      } catch (e) {
        // 静默失败，本地已保存
      }
    }
  },

  async generateProfileSuggestions() {
    console.log('[ProfileSuggestions] generateProfileSuggestions called');
    const btn = document.getElementById('generateProfileSuggestionsBtn');
    if (btn) { btn.disabled = true; btn.textContent = '🔍 分析中...'; }
    try {
      if (!window.electronAPI?.profileSuggestions) {
        console.error('[ProfileSuggestions] electronAPI.profileSuggestions not available');
        this.showToast('画像建议功能不可用', 'error');
        return;
      }
      const suggestionsEl = document.getElementById('profileSuggestions');
      if (!suggestionsEl) {
        console.error('[ProfileSuggestions] profileSuggestions element not found');
        return;
      }
      suggestionsEl.innerHTML = '<p style="color: var(--text-secondary);">正在分析使用数据...</p>';
      const result = await window.electronAPI.profileSuggestions();
      console.log('[ProfileSuggestions] IPC result:', result);
      const suggestions = result.suggestions || [];
      if (!suggestions.length) {
        suggestionsEl.innerHTML = '<p style="color: var(--text-secondary); font-size: 13px;">暂无建议，继续使用系统后将生成更多洞察。</p>';
        return;
      }
      suggestionsEl.innerHTML = suggestions.map(s => {
        const icon = { add_person: '👤', add_project: '📂', add_priority_signal: '⚡' }[s.type] || '💡';
        return `<div class="suggestion-item">
          <span class="suggestion-icon">${icon}</span>
          <span class="suggestion-text">${this.escapeHtml(s.reason || s.suggestion || '')}</span>
          ${s.name ? `<button class="suggestion-action" data-suggest-type="${this.escapeHtml(s.type)}" data-suggest-name="${this.escapeHtml(s.name)}">添加</button>` : ''}
        </div>`;
      }).join('');

      // 使用事件委托代替 inline onclick
      suggestionsEl.onclick = (e) => {
        const actionBtn = e.target.closest('.suggestion-action');
        if (!actionBtn) return;
        const type = actionBtn.dataset.suggestType;
        const name = actionBtn.dataset.suggestName;
        if (type && name) this.applySuggestion(type, name);
      };
    } catch (error) {
      console.error('[ProfileSuggestions] Error:', error);
      const suggestionsEl = document.getElementById('profileSuggestions');
      if (suggestionsEl) suggestionsEl.innerHTML = `<p class="error-text">生成建议失败：${this.escapeHtml(error.message)}</p>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔍 生成建议'; }
    }
  },

  // AI 批量导入画像
  async importProfileWithAI() {
    const text = document.getElementById('profileImportText')?.value.trim();
    if (!text) {
      this.showToast('请输入要导入的文本', 'error');
      return;
    }

    const btn = document.getElementById('profileImportBtn');
    const statusEl = document.getElementById('profileImportStatus');
    const previewEl = document.getElementById('profileImportPreview');

    if (btn) { btn.disabled = true; btn.textContent = '🧠 解析中...'; }
    if (statusEl) statusEl.textContent = '';
    if (previewEl) previewEl.classList.add('hidden');

    try {
      const result = await window.electronAPI.profile.importAI(text);
      if (!result.success) {
        this.showToast(result.error || '导入失败', 'error');
        return;
      }

      const { preview, stats } = result;

      if (stats.personsAdded === 0 && stats.projectsAdded === 0 && stats.industriesAdded === 0) {
        if (statusEl) statusEl.textContent = '未发现新的可导入信息';
        return;
      }

      // 显示预览
      if (previewEl) {
        let html = '<div class="import-preview-summary">';
        html += `<p style="font-weight:600; margin-bottom:8px;">解析结果预览：</p>`;

        if (preview.persons.length > 0) {
          html += '<div class="import-preview-section"><strong>👥 人物</strong>';
          preview.persons.forEach(p => {
            html += `<div class="import-preview-item">
              <span class="item-name">${this.escapeHtml(p.name)}</span>
              ${p.relation ? `<span class="person-relation-tag ${this._getRelationClass(p.relation)}">${this.escapeHtml(p.relation)}</span>` : ''}
              ${p.responsibilities ? `<span class="person-resp-tag">${this.escapeHtml(p.responsibilities)}</span>` : ''}
              ${p.company ? `<span style="color:var(--text-tertiary);font-size:11px;">@ ${this.escapeHtml(p.company)}</span>` : ''}
            </div>`;
          });
          html += '</div>';
        }

        if (preview.projects.length > 0) {
          html += '<div class="import-preview-section"><strong>📂 项目</strong>';
          preview.projects.forEach(p => {
            html += `<div class="import-preview-item">
              <span class="item-name">${this.escapeHtml(p.name)}</span>
              <span style="color:var(--text-tertiary);font-size:11px;">${p.status === 'active' ? '进行中' : p.status === 'paused' ? '暂停' : '已完成'}</span>
              ${p.description ? `<span class="person-resp-tag">${this.escapeHtml(p.description)}</span>` : ''}
            </div>`;
          });
          html += '</div>';
        }

        if (preview.industries.length > 0) {
          html += `<div class="import-preview-section"><strong>🏭 行业</strong> ${preview.industries.map(i => `<span class="import-tag">${this.escapeHtml(i)}</span>`).join(' ')}</div>`;
        }

        if (preview.regions.length > 0) {
          html += `<div class="import-preview-section"><strong>🌍 区域</strong> ${preview.regions.map(r => `<span class="import-tag">${this.escapeHtml(r)}</span>`).join(' ')}</div>`;
        }

        const skipped = stats.personsSkipped + stats.projectsSkipped;
        if (skipped > 0) {
          html += `<p style="color:var(--text-tertiary);font-size:11px;margin-top:8px;">（${skipped} 项已存在，自动跳过）</p>`;
        }

        html += `<div style="margin-top:12px;display:flex;gap:8px;">
          <button class="btn primary small" id="confirmImportBtn">✅ 确认导入</button>
          <button class="btn secondary small" id="cancelImportBtn">取消</button>
        </div></div>`;

        previewEl.innerHTML = html;
        previewEl.classList.remove('hidden');

        document.getElementById('confirmImportBtn')?.addEventListener('click', async () => {
          const confirmResult = await window.electronAPI.profile.importConfirm(preview);
          if (confirmResult.success) {
            this.showToast(`已导入 ${stats.personsAdded} 个人物、${stats.projectsAdded} 个项目、${stats.industriesAdded} 个行业`);
            document.getElementById('profileImportText').value = '';
            previewEl.classList.add('hidden');
            this.loadProfileEditor();
          } else {
            this.showToast(confirmResult.error || '导入失败', 'error');
          }
        });

        document.getElementById('cancelImportBtn')?.addEventListener('click', () => {
          previewEl.classList.add('hidden');
        });
      }
    } catch (error) {
      this.showToast('AI 解析失败：' + error.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🧠 AI 解析并导入'; }
    }
  },

  async applySuggestion(type, name) {
    const profile = await window.electronAPI.profile.get();
    if (type === 'add_person') {
      profile.frequent_persons = profile.frequent_persons || [];
      if (!profile.frequent_persons.find(p => p.name === name)) profile.frequent_persons.push({ name, relation: '自动识别', freq: 3 });
    } else if (type === 'add_project') {
      profile.active_projects = profile.active_projects || [];
      if (!profile.active_projects.find(p => p.name === name)) profile.active_projects.push({ name, alias: [], status: 'active' });
    } else if (type === 'add_priority_signal') {
      profile.preferences = profile.preferences || {};
      profile.preferences.priority_signals = profile.preferences.priority_signals || [];
      if (!profile.preferences.priority_signals.includes(name)) profile.preferences.priority_signals.push(name);
    }
    await window.electronAPI.profile.update(profile);
    this.loadProfileEditor();
    const typeLabel = { add_person: '人物', add_project: '项目', add_priority_signal: '优先级触发词' }[type] || '项';
    this.showToast(`已添加${typeLabel}：${name}`);
  },

  // === Prompt 文件管理（已提取到 app-prompt-manager.js）===

  // === 优化器历史记录 ===
  async loadOptimizerHistory() {
    if (!window.electronAPI?.optimizer?.history) return;
    const listEl = document.getElementById('optimizerHistoryList');
    if (!listEl) return;

    try {
      const result = await window.electronAPI.optimizer.history();
      const history = result.history || [];
      if (history.length === 0) {
        listEl.innerHTML = '<p style="color: var(--text-secondary); font-size: 13px;">暂无优化记录。运行优化器后，历史记录将出现在这里。</p>';
        return;
      }

      listEl.innerHTML = history.map(h => {
        const improvement = h.improvement || 0;
        const impClass = improvement >= 0.05 ? 'improved' : improvement >= 0 ? '' : 'declined';
        const impSign = improvement >= 0 ? '+' : '';
        const moduleLabel = { task_recognition: '任务识别', memory_extraction: '记忆提取' }[h.module] || h.module;
        const timeStr = h.timestamp ? new Date(h.timestamp).toLocaleString('zh-CN') : '';
        const failCount = (h.failure_patterns || []).length;
        const impCount = (h.improvements || []).length;
        const changeSummary = (h.improvements || []).slice(0, 2).map(i =>
          `<div class="change-item">→ [${this.escapeHtml(i.target_section || '')}] ${this.escapeHtml(i.rationale || '')}</div>`
        ).join('');

        return `
          <div class="optimizer-history-card" data-report="${this.escapeHtml(h.reportFile)}" data-prompt="${this.escapeHtml(h.promptFile)}">
            <div class="opt-history-top">
              <span class="opt-history-module">${moduleLabel} · ${this.escapeHtml(h.old_version || '')} → ${this.escapeHtml(h.new_version || '')}</span>
              <span class="opt-history-time">${timeStr}</span>
            </div>
            <div class="opt-history-stats">
              <span class="opt-stat"><span class="opt-stat-label">训练/测试：</span><span class="opt-stat-value">${h.train_size || 0}/${h.test_size || 0}</span></span>
              <span class="opt-stat"><span class="opt-stat-label">旧通过率：</span><span class="opt-stat-value">${((h.old_pass_rate || 0) * 100).toFixed(1)}%</span></span>
              <span class="opt-stat"><span class="opt-stat-label">新通过率：</span><span class="opt-stat-value ${impClass}">${((h.new_pass_rate || 0) * 100).toFixed(1)}%</span></span>
              <span class="opt-stat"><span class="opt-stat-label">提升：</span><span class="opt-stat-value ${impClass}">${impSign}${(improvement * 100).toFixed(1)}%</span></span>
              <span class="opt-stat"><span class="opt-stat-label">失败模式：</span><span class="opt-stat-value">${failCount}个</span></span>
              <span class="opt-stat"><span class="opt-stat-label">改进项：</span><span class="opt-stat-value">${impCount}项</span></span>
            </div>
            ${changeSummary ? `<div class="opt-history-changes">${changeSummary}</div>` : ''}
          </div>
        `;
      }).join('');

      listEl.onclick = (e) => {
        const card = e.target.closest('.optimizer-history-card');
        if (!card) return;
        this.showOptimizerDetail(card.dataset.report, card.dataset.prompt);
      };
    } catch (error) {
      listEl.innerHTML = `<p style="color: var(--danger-color); font-size: 13px;">加载历史失败：${this.escapeHtml(error.message)}</p>`;
    }
  },

  // === 优化器详情 ===
  _currentOptCandidate: null,

  async showOptimizerDetail(reportFile, promptFile) {
    if (!window.electronAPI?.optimizer) return;
    this._currentOptCandidate = promptFile;

    try {
      const [reportResult, candidateResult] = await Promise.all([
        window.electronAPI.optimizer.readReport(reportFile),
        promptFile ? window.electronAPI.optimizer.readCandidate(promptFile) : Promise.resolve({ success: false })
      ]);

      const report = reportResult.report || {};
      const candidateContent = candidateResult.content || '';
      const moduleLabel = { task_recognition: '任务识别', memory_extraction: '记忆提取' }[report.module] || report.module;
      const improvement = report.improvement || 0;

      document.getElementById('optimizerDetailTitle').textContent = `🧬 优化详情 · ${moduleLabel}`;

      let bodyHtml = '';

      // 输入信息
      bodyHtml += `<div class="opt-detail-section">
        <h5>📥 输入信息</h5>
        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.8;">
          <div><strong>模块：</strong>${moduleLabel}</div>
          <div><strong>旧版本：</strong>${this.escapeHtml(report.old_version || '')}</div>
          <div><strong>新版本：</strong>${this.escapeHtml(report.new_version || '')}</div>
          <div><strong>Bad Case 数量：</strong>${report.bad_cases_used || 0}（训练 ${report.train_size || 0} / 测试 ${report.test_size || 0}）</div>
          <div><strong>运行时间：</strong>${report.timestamp ? new Date(report.timestamp).toLocaleString('zh-CN') : ''}</div>
        </div>
      </div>`;

      // 失败模式
      if (report.failure_patterns?.length) {
        bodyHtml += `<div class="opt-detail-section">
          <h5>🔍 识别的失败模式</h5>
          ${report.failure_patterns.map((p, i) => `
            <div class="opt-detail-failure">
              <strong>${i + 1}. ${this.escapeHtml(p.pattern || '')}</strong>
              <div style="margin-top: 4px;">根因：${this.escapeHtml(p.root_cause || '')}</div>
            </div>
          `).join('')}
        </div>`;
      }

      // 改进项
      if (report.improvements?.length) {
        bodyHtml += `<div class="opt-detail-section">
          <h5>🔧 优化改进项</h5>
          ${report.improvements.map((imp, i) => `
            <div class="opt-detail-improvement">
              <div class="imp-section">${i + 1}. [${this.escapeHtml(imp.target_section || '')}]</div>
              <div style="margin-top: 2px;">${this.escapeHtml(imp.rationale || '')}</div>
              ${imp.old_text ? `<div style="margin-top:4px; font-size:11px; color: var(--text-tertiary);">旧：<code style="background: rgba(255,59,48,0.06); padding: 1px 4px; border-radius:3px;">${this.escapeHtml(imp.old_text.substring(0, 100))}</code></div>` : ''}
              ${imp.new_text ? `<div style="margin-top:2px; font-size:11px; color: var(--text-tertiary);">新：<code style="background: rgba(52,199,89,0.06); padding: 1px 4px; border-radius:3px;">${this.escapeHtml(imp.new_text.substring(0, 100))}</code></div>` : ''}
            </div>
          `).join('')}
        </div>`;
      }

      // 评测结果
      bodyHtml += `<div class="opt-detail-section">
        <h5>📊 评测对比</h5>
        <div style="font-size: 12px; display: flex; gap: 20px;">
          <div><strong>旧版通过率：</strong>${((report.old_pass_rate || 0) * 100).toFixed(1)}%</div>
          <div><strong>新版通过率：</strong><span style="color: ${improvement >= 0.05 ? '#34C759' : improvement >= 0 ? 'var(--text-primary)' : '#FF3B30'}">${((report.new_pass_rate || 0) * 100).toFixed(1)}%</span></div>
          <div><strong>提升：</strong><span style="color: ${improvement >= 0.05 ? '#34C759' : improvement >= 0 ? 'var(--text-primary)' : '#FF3B30'}">${improvement >= 0 ? '+' : ''}${(improvement * 100).toFixed(1)}%</span></div>
        </div>
        ${report.expected_improvements ? `<div style="margin-top: 6px; font-size: 12px; color: var(--text-secondary);"><strong>预期改进：</strong>${this.escapeHtml(report.expected_improvements)}</div>` : ''}
      </div>`;

      // 新版 Prompt（可编辑）
      if (candidateContent) {
        bodyHtml += `<div class="opt-detail-section">
          <h5>📝 优化后的 Prompt <span style="font-weight: 400; color: var(--text-tertiary); font-size: 12px;">（可直接编辑调整后应用）</span></h5>
          <textarea id="optimizerCandidateContent" style="width:100%; min-height:200px; padding:10px; border-radius:8px; border:1px solid var(--border-color); font-family:'SF Mono','Menlo',monospace; font-size:12px; line-height:1.5; resize:vertical;">${this.escapeHtml(candidateContent)}</textarea>
        </div>`;
      }

      document.getElementById('optimizerDetailBody').innerHTML = bodyHtml;

      // Footer 按钮
      const footerEl = document.getElementById('optimizerDetailFooter');
      footerEl.innerHTML = '';
      if (candidateContent) {
        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn primary';
        applyBtn.textContent = '✅ 应用到主模板';
        applyBtn.onclick = () => this.applyOptimizerToMain(promptFile);
        footerEl.appendChild(applyBtn);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn secondary';
        saveBtn.textContent = '💾 保存修改到候选';
        saveBtn.onclick = () => this.saveOptimizerCandidateEdits(promptFile);
        footerEl.appendChild(saveBtn);
      }
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn secondary';
      cancelBtn.textContent = '关闭';
      cancelBtn.onclick = () => this.hideOptimizerDetail();
      footerEl.appendChild(cancelBtn);

      document.getElementById('optimizerDetailOverlay')?.classList.remove('hidden');
    } catch (error) {
      this.showToast('加载优化详情失败：' + error.message, 'error');
    }
  },

  hideOptimizerDetail() {
    document.getElementById('optimizerDetailOverlay')?.classList.add('hidden');
    this._currentOptCandidate = null;
  },

  async applyOptimizerToMain(candidateFilename) {
    if (!window.electronAPI?.optimizer?.applyToMain) return;
    const confirmed = await this.showConfirmDialog('应用确认', '确定要将此优化版本应用到主模板文件吗？主文件将被替换（旧版本自动备份）。');
    if (!confirmed) return;

    const result = await window.electronAPI.optimizer.applyToMain(candidateFilename);
    if (result.success) {
      this.showToast(`已应用到主模板 ${result.targetFile}（旧版本已备份）`);
      this.hideOptimizerDetail();
      this.loadPromptFiles();
    } else {
      this.showToast('应用失败：' + (result.error || ''), 'error');
    }
  },

  async saveOptimizerCandidateEdits(candidateFilename) {
    if (!window.electronAPI?.promptFiles?.write) return;
    const textarea = document.getElementById('optimizerCandidateContent');
    if (!textarea) return;
    const content = textarea.value;

    // 写入候选文件
    const result = await window.electronAPI.promptFiles.write(candidateFilename, content);
    if (result.success) {
      this.showToast('候选 Prompt 已保存');
    } else {
      this.showToast('保存失败：' + (result.error || ''), 'error');
    }
  },

  // ============= 外观设置 =============
  // ===== 云同步 =====

  _loadSyncSettings() {
    const settings = this._getSyncSettings();
    const toggle = document.getElementById('cloudSyncToggle');
    const configSection = document.getElementById('syncConfigSection');
    const disabledHint = document.getElementById('syncDisabledHint');
    const syncServerUrl = document.getElementById('syncServerUrl');

    if (toggle) toggle.checked = settings.enabled;

    // 显示/隐藏
    if (settings.enabled) {
      configSection?.classList.remove('hidden');
      disabledHint?.classList.add('hidden');
    } else {
      configSection?.classList.add('hidden');
      disabledHint?.classList.remove('hidden');
    }

    // 同步服务器地址（从登录状态读取）
    if (syncServerUrl) {
      if (window.electronAPI?.authGetState) {
        window.electronAPI.authGetState().then(state => {
          if (state.isLoggedIn) {
            syncServerUrl.value = 'ADPToolkit Config Server';
          } else {
            syncServerUrl.value = '未登录';
          }
        }).catch(() => {
          syncServerUrl.value = '待配置';
        });
      } else {
        syncServerUrl.value = '待配置';
      }
    }

    // 同步范围
    document.getElementById('syncTasks').checked = settings.scope.tasks !== false;
    document.getElementById('syncNotes').checked = settings.scope.notes !== false;
    document.getElementById('syncKnowledge').checked = settings.scope.knowledge !== false;
    document.getElementById('syncClipboard').checked = settings.scope.clipboard !== false;
    document.getElementById('syncConversations').checked = settings.scope.conversations !== false;

    // 同步频率
    const freqRadio = document.querySelector(`input[name="syncFrequency"][value="${settings.frequency || 'realtime'}"]`);
    if (freqRadio) freqRadio.checked = true;

    // 同步状态
    if (settings.lastSyncAt) {
      document.getElementById('lastSyncTime').textContent = this._formatRelativeTime(settings.lastSyncAt);
    }
  },

  _getSyncSettings() {
    try {
      const raw = localStorage.getItem('memora_sync_settings');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      enabled: false,
      serverUrl: '',
      scope: { tasks: true, notes: true, knowledge: true, clipboard: true },
      frequency: 'realtime',
      lastSyncAt: null
    };
  },

  _saveSyncSettings(settings) {
    localStorage.setItem('memora_sync_settings', JSON.stringify(settings));
  },

  _toggleCloudSync(enabled) {
    const settings = this._getSyncSettings();
    settings.enabled = enabled;
    this._saveSyncSettings(settings);

    const configSection = document.getElementById('syncConfigSection');
    const disabledHint = document.getElementById('syncDisabledHint');

    if (enabled) {
      configSection?.classList.remove('hidden');
      disabledHint?.classList.add('hidden');
      // 读取服务器地址
      const server = window.electronAPI?.authGetServerUrls
        ? null : null;
      // 从 authState 获取服务器地址
      if (window.electronAPI?.authGetState) {
        window.electronAPI.authGetState().then(state => {
          const serverUrl = document.getElementById('syncServerUrl');
          if (serverUrl && state.isLoggedIn) {
            serverUrl.value = '已连接 ADPToolkit';
          } else if (serverUrl) {
            serverUrl.value = '未登录';
          }
        });
      }
      // 启用同步引擎
      SyncEngine.enable().then(() => {
        this._showToast('云端同步已开启', 'success');
        // 更新同步状态面板
        this._refreshSyncStatus();
      }).catch(err => {
        this._showToast('同步启用失败：' + err.message, 'error');
      });
    } else {
      configSection?.classList.add('hidden');
      disabledHint?.classList.remove('hidden');
      SyncEngine.disable();
      this._showToast('云端同步已关闭', 'info');
    }
  },

  async _syncNow() {
    const settings = this._getSyncSettings();
    if (!settings.enabled) {
      this.showToast('请先开启云端同步', 'warning');
      return;
    }

    // 检查是否已登录
    let isLoggedIn = false;
    try {
      const state = await window.electronAPI?.authGetState();
      isLoggedIn = state?.isLoggedIn;
    } catch (e) {}

    if (!isLoggedIn) {
      this.showToast('请先登录后再同步', 'warning');
      return;
    }

    try {
      const result = await SyncEngine.fullSync();
      if (result.ok) {
        const summary = SyncEngine.formatSyncSummary(result.pushDetail, result.pullDetail);
        this.showToast(`同步完成：${summary}`, 'success');
        this._refreshSyncStatus();
        // 刷新日历/任务视图
        this.refreshCalendarView?.();
      } else {
        this.showToast('同步失败：' + (result.reason || '未知错误'), 'error');
      }
    } catch (err) {
      this.showToast('同步失败：' + (err.message || '未知错误'), 'error');
    }
  },

  _refreshSyncStatus() {
    const stats = SyncEngine._getStats?.() || {};
    const lastSyncEl = document.getElementById('lastSyncTime');
    const syncDirEl = document.getElementById('syncDirection');
    const pendingPushEl = document.getElementById('pendingPushCount');
    const pendingPullEl = document.getElementById('pendingPullCount');

    if (lastSyncEl) {
      lastSyncEl.textContent = this._formatRelativeTime(stats.lastSyncAt || SyncEngine.getLastSyncAt());
    }
    if (syncDirEl) {
      if (stats.lastPushedCount > 0 && stats.lastPulledCount > 0) syncDirEl.textContent = '↑↓ 双向';
      else if (stats.lastPushedCount > 0) syncDirEl.textContent = '↑ 上传';
      else if (stats.lastPulledCount > 0) syncDirEl.textContent = '↓ 下载';
      else syncDirEl.textContent = '—';
    }
    if (pendingPushEl) pendingPushEl.textContent = '0 条';
    if (pendingPullEl) pendingPullEl.textContent = '0 条';
  },

  _saveSyncScope() {
    const settings = this._getSyncSettings();
    settings.scope = {
      tasks: document.getElementById('syncTasks')?.checked ?? true,
      notes: document.getElementById('syncNotes')?.checked ?? true,
      knowledge: document.getElementById('syncKnowledge')?.checked ?? true,
      clipboard: document.getElementById('syncClipboard')?.checked ?? true,
      conversations: document.getElementById('syncConversations')?.checked ?? true
    };
    this._saveSyncSettings(settings);
    // 同步到 SyncEngine
    const seSettings = SyncEngine._getSettings?.();
    if (seSettings) {
      seSettings.scope = settings.scope;
      SyncEngine._saveSettings?.(seSettings);
    }
  },

  _saveSyncFrequency(frequency) {
    const settings = this._getSyncSettings();
    settings.frequency = frequency;
    this._saveSyncSettings(settings);
    // 同步到 SyncEngine 并重启定时器
    const seSettings = SyncEngine._getSettings?.();
    if (seSettings) {
      seSettings.frequency = frequency;
      SyncEngine._saveSettings?.(seSettings);
      if (settings.enabled) {
        SyncEngine._startAutoSync?.();
      }
    }
  },

  _toggleSyncStatus() {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    el.classList.toggle('hidden');
  },

  _formatRelativeTime(isoStr) {
    if (!isoStr) return '从未';
    const now = Date.now();
    const then = new Date(isoStr).getTime();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
  },

  _loadAppearanceSettings() {
    this._renderThemeGrid();
    this._loadVisualToggles();
    this._loadFontSize();
    this._loadStartupPage();
  },

  _loadReminderSettings() {
    const settings = window.Reminder?.settings || Store.getSettings().reminder || {};
    const toggle = (id, key) => {
      const el = document.getElementById(id);
      if (el) {
        el.checked = settings[key] !== false;
        el.addEventListener('change', () => {
          if (window.Reminder) {
            window.Reminder.updateSettings({ [key]: el.checked });
          }
          const current = Store.getSettings();
          if (!current.reminder) current.reminder = {};
          current.reminder[key] = el.checked;
          Store.saveSettings(current);
        });
      }
    };
    const select = (id, key) => {
      const el = document.getElementById(id);
      if (el) {
        el.value = String(settings[key] || 60);
        el.addEventListener('change', () => {
          const val = parseInt(el.value);
          if (window.Reminder) {
            window.Reminder.updateSettings({ [key]: val });
          }
          const current = Store.getSettings();
          if (!current.reminder) current.reminder = {};
          current.reminder[key] = val;
          Store.saveSettings(current);
        });
      }
    };
    toggle('reminderNotification', 'notificationEnabled');
    toggle('reminderInApp', 'inAppNotifyEnabled');
    toggle('reminderOverdue', 'overdueReminderEnabled');
    toggle('reminderStartupCheck', 'startupCheckEnabled');
    toggle('reminderEnoughTime', 'enoughTimeBeforeDue');
    toggle('reminderNearDeadline', 'nearDeadlineTime');
    select('reminderOverdueInterval', 'overdueReminderInterval');
  },

  /** 加载智能上下文设置 */
  _loadContextSettings() {
    const settings = Store.getSettings();
    const el = document.getElementById('localContextEnabled');
    if (el) {
      el.checked = settings.localContextEnabled !== false;
      el.addEventListener('change', () => {
        const current = Store.getSettings();
        current.localContextEnabled = el.checked;
        Store.saveSettings(current);
        this._settings = current;
      });
    }
    this._settings = settings;
  },

  /** 填充专家选择列表 */
  _populateExpertSelect() {
    const selectEl = document.getElementById('taskExpert');
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">默认助手</option>';
    
    try {
      const expertsData = JSON.parse(localStorage.getItem('memora_experts') || '{}');
      const experts = expertsData.experts || [];
      experts.forEach(expert => {
        const opt = document.createElement('option');
        opt.value = expert.id;
        opt.textContent = `${expert.icon || '🤖'} ${expert.name}`;
        selectEl.appendChild(opt);
      });
    } catch (e) {
      console.warn('[Task] Failed to load experts for select:', e);
    }
  },

  // === AI 小助手任务模块（已提取到 app-ai-tasks.js）===

  _renderThemeGrid() {
    const grid = document.getElementById('themeGrid');
    if (!grid || !window.ThemeEngine) return;
    grid.innerHTML = '';

    const themes = ThemeEngine.getAllThemes();
    const current = ThemeEngine.getTheme();

    themes.forEach(theme => {
      const card = document.createElement('div');
      card.className = `theme-card${theme.id === current ? ' active' : ''}`;
      card.dataset.theme = theme.id;
      card.onclick = () => this._applyTheme(theme.id);

      // 主题预览色条
      const vars = ThemeEngine.getThemeInfo(theme.id).vars;
      const previewColors = [
        vars['--primary-color'],
        vars['--bg-secondary'],
        vars['--accent-color'],
        vars['--success-color'],
        vars['--warning-color']
      ];

      card.innerHTML = `
        <div class="theme-preview">
          ${previewColors.map(c => `<div class="theme-preview-color" style="background:${c}"></div>`).join('')}
        </div>
        <div class="theme-card-name">
          <span class="theme-card-icon">${theme.icon}</span>
          ${theme.name}
        </div>
        <div class="theme-card-desc">${theme.description}</div>
      `;

      grid.appendChild(card);
    });
  },

  _applyTheme(themeId) {
    if (!window.ThemeEngine) return;

    // 添加过渡动画
    document.body.classList.add('theme-transitioning');
    ThemeEngine.apply(themeId, true);

    // 更新选中状态
    document.querySelectorAll('.theme-card').forEach(c => {
      c.classList.toggle('active', c.dataset.theme === themeId);
    });

    // 移除过渡动画
    setTimeout(() => {
      document.body.classList.remove('theme-transitioning');
    }, 500);

    this.showToast(`已切换到 ${ThemeEngine.getThemeInfo(themeId).name} 主题`);
  },

  _loadVisualToggles() {
    const glassToggle = document.getElementById('glassEffectToggle');
    const orbToggle = document.getElementById('orbEffectToggle');
    const hoverToggle = document.getElementById('hoverEffectToggle');

    // 从 localStorage 读取
    const prefs = JSON.parse(localStorage.getItem('memora-visual-prefs') || '{}');

    if (glassToggle) {
      glassToggle.checked = prefs.glass !== false;
      glassToggle.addEventListener('change', (e) => {
        this._saveVisualPrefs('glass', e.target.checked);
        document.body.classList.toggle('no-glass', !e.target.checked);
      });
      if (prefs.glass === false) document.body.classList.add('no-glass');
    }

    if (orbToggle) {
      orbToggle.checked = prefs.orb !== false;
      orbToggle.addEventListener('change', (e) => {
        this._saveVisualPrefs('orb', e.target.checked);
        document.body.classList.toggle('no-orb', !e.target.checked);
      });
      if (prefs.orb === false) document.body.classList.add('no-orb');
    }

    if (hoverToggle) {
      hoverToggle.checked = prefs.hover !== false;
      hoverToggle.addEventListener('change', (e) => {
        this._saveVisualPrefs('hover', e.target.checked);
        document.body.classList.toggle('no-hover', !e.target.checked);
      });
      if (prefs.hover === false) document.body.classList.add('no-hover');
    }
  },

  _saveVisualPrefs(key, value) {
    const prefs = JSON.parse(localStorage.getItem('memora-visual-prefs') || '{}');
    prefs[key] = value;
    localStorage.setItem('memora-visual-prefs', JSON.stringify(prefs));
  },

  _loadFontSize() {
    const saved = localStorage.getItem('memora-font-size') || 'medium';
    document.body.classList.add(`font-${saved}`);

    document.querySelectorAll('.font-size-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.size === saved);
      btn.addEventListener('click', () => {
        const size = btn.dataset.size;
        document.body.classList.remove('font-small', 'font-medium', 'font-large');
        document.body.classList.add(`font-${size}`);
        localStorage.setItem('memora-font-size', size);
        document.querySelectorAll('.font-size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  },

  // 启动时恢复视觉偏好
  _restoreVisualPrefs() {
    const prefs = JSON.parse(localStorage.getItem('memora-visual-prefs') || '{}');
    if (prefs.glass === false) document.body.classList.add('no-glass');
    if (prefs.orb === false) document.body.classList.add('no-orb');
    if (prefs.hover === false) document.body.classList.add('no-hover');

    const fontSize = localStorage.getItem('memora-font-size') || 'medium';
    document.body.classList.add(`font-${fontSize}`);

    // 应用启动页设置
    this._applyStartupPage();
  },

  /** 应用启动页设置（在初始化后自动导航到用户选择的页面） */
  _applyStartupPage() {
    const saved = localStorage.getItem('memora-startup-page');
    if (!saved || saved === 'calendar') return; // 默认日历，无需切换

    // 延迟执行，确保所有视图和事件已初始化
    setTimeout(() => {
      if (saved === 'ai-assistant') {
        this.showAIAssistantView();
        // 如果配置了 AI 模式，同步切换
        const aiMode = localStorage.getItem('memora-startup-ai-mode');
        if (aiMode && aiMode !== this._aiAssistantMode) {
          this._setGlobalAIMode(aiMode);
        }
      } else {
        const tab = document.querySelector(`.view-tab[data-view="${saved}"]`);
        if (tab) tab.click();
      }
    }, 500);
  },

  /** 加载启动页设置 UI（外观设置面板中） */
  _loadStartupPage() {
    const savedPage = localStorage.getItem('memora-startup-page') || 'calendar';
    const savedAiMode = localStorage.getItem('memora-startup-ai-mode') || 'cc';

    document.querySelectorAll('.startup-page-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === savedPage);
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        document.querySelectorAll('.startup-page-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        localStorage.setItem('memora-startup-page', page);

        // 显示/隐藏 AI 模式选择行
        const modeRow = document.getElementById('startupAiModeRow');
        if (modeRow) {
          modeRow.style.display = page === 'ai-assistant' ? 'flex' : 'none';
        }

        this.showToast('启动页已设置，下次打开 Memora 时生效', 'success');
      });
    });

    // AI 模式选择
    document.querySelectorAll('.ai-mode-btn-mini').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === savedAiMode);
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        document.querySelectorAll('.ai-mode-btn-mini').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        localStorage.setItem('memora-startup-ai-mode', mode);
      });
    });

    // 初始显示 AI 模式行
    const modeRow = document.getElementById('startupAiModeRow');
    if (modeRow) {
      modeRow.style.display = savedPage === 'ai-assistant' ? 'flex' : 'none';
    }
  },

  // ========== 国际化 ==========

  _initI18n() {
    if (!window.i18n) return;
    // 恢复上次语言偏好
    window.i18n.restore();
    // 注册语言变化回调
    window.i18n.onChange(() => this._applyLocale());
    // 首次应用
    this._applyLocale();
  },

  /** 语言切换时更新所有 UI 文本 */
  _applyLocale() {
    const i = window.i18n;
    if (!i) return;

    // 处理 data-i18n 属性的元素
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const text = i.t(key);
      if (el.children.length === 0) {
        el.textContent = text;
      } else {
        // 有子元素时，只替换第一个文本节点
        const firstText = el.childNodes[0];
        if (firstText?.nodeType === Node.TEXT_NODE) {
          firstText.textContent = text;
        } else {
          el.insertBefore(document.createTextNode(text), el.firstChild);
        }
      }
    });

    // 处理 data-i18n-partial 属性（保留子元素如 span）
    document.querySelectorAll('[data-i18n-partial]').forEach(el => {
      const key = el.getAttribute('data-i18n-partial');
      if (!key) return;
      const text = i.t(key);
      // 保留第一个子元素（通常是 span），替换前缀文本
      const firstChild = el.childNodes[0];
      if (firstChild?.nodeType === Node.TEXT_NODE) {
        firstChild.textContent = text + ': ';
      }
    });

    // 处理 data-i18n-placeholder 属性（更新 placeholder）
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = i.t(key);
    });

    // 处理 data-i18n-title 属性（更新 title/tooltip）
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.title = i.t(key);
    });

    // 更新语言切换按钮文本
    // 语言切换按钮只更新 tooltip，SVG 图标保持不变
    // const langBtn = document.getElementById('langToggleBtn');
    // if (langBtn) langBtn.textContent = i.t('lang.label');

    // 导航标签已由 data-i18n 处理

    // 头部按钮 tooltip
    this._setTooltip('#openAIAssistantBtn', 'header.aiAssistant');
    this._setTooltip('#openSettingsBtn', 'header.settings');
    this._setTooltip('#langToggleBtn', 'lang.zh') // 简单tooltip
    this._setTooltip('#notificationBellBtn', 'header.notification');
    this._setTooltip('#headerLoginBtn', 'header.login');

    // 通知面板、番茄钟、记事本侧边栏、设置标签、待办列表等已由 data-i18n 属性处理

    // 刷新日期显示
    if (window.Calendar?.currentDate) {
      document.getElementById('currentDate').textContent = i.formatDate(window.Calendar.currentDate);
    }

    // 刷新任务列表（确保按钮等也更新）
    this.renderTaskList();
  },

  /** 安全设置元素文本（保留 badge 等子元素） */
  _setText(selector, key, preserveChildren = false) {
    const el = document.querySelector(selector);
    if (!el) return;
    const text = window.i18n.t(key);
    if (preserveChildren && el.children.length > 0) {
      // 只替换第一个文本节点
      const firstText = el.childNodes[0];
      if (firstText?.nodeType === Node.TEXT_NODE) {
        firstText.textContent = text;
      } else {
        el.insertBefore(document.createTextNode(text), el.firstChild);
      }
    } else if (el.children.length === 0) {
      el.textContent = text;
    }
  },

  /** 设置 tooltip */
  _setTooltip(selector, key) {
    const el = document.querySelector(selector);
    if (el) el.dataset.tooltip = window.i18n.t(key);
  },

  // ============ 助手会话同步 ============

  /**
   * 推送会话元数据到云端（标准 v3 push）
   */
  async _syncPushConversation(session) {
    if (typeof window.SyncEngine?.isSyncing !== 'function') return; // SyncEngine 未加载
    try {
      const deviceId = window.SyncEngine.getDeviceInfo()?.deviceId;
      if (!deviceId) return;
      const conv = {
        id: session.id,
        _base_revision: session._revision || 0,
        title: session.title || '新对话',
        message_count: session.messageCount || 0,
        source: session.source || 'manual',
        agent_mode: this._aiAssistantMode || 'agent',
        conversation_id: session.conversationId || '',
        is_pinned: session.is_pinned || 0,
        archived: session.archived || 0,
      };
      await window.SyncEngine.pushConversationsAndMessages([conv], []);
    } catch (e) {
      console.warn('[ChatSync] pushConversation failed:', e.message);
    }
  },

  /**
   * 推送当前对话的完整消息到云端
   * 在 AI 流式完成后调用，把 user + assistant 消息一起推送
   */
  async _syncPushCurrentConversation(assistantContent) {
    if (!window.SyncEngine) return;
    try {
      const session = this._chatSessions.find(s => s.id === this._activeSessionId);
      if (!session) return;

      const deviceId = window.SyncEngine.getDeviceInfo()?.deviceId;
      if (!deviceId) return;

      // 从 DOM 收集消息（比 localStorage HTML 更结构化）
      const chatMessages = document.getElementById('chatMessages');
      const msgElements = chatMessages?.querySelectorAll('.message') || [];
      const messages = [];
      let msgIndex = 0;

      msgElements.forEach(el => {
        const isUser = el.classList.contains('user');
        const isAssistant = el.classList.contains('assistant');
        if (!isUser && !isAssistant) return;

        const contentEl = el.querySelector('.message-content');
        if (!contentEl) return;

        const role = isUser ? 'user' : 'assistant';
        const content = contentEl.querySelector('p')?.textContent?.trim() || contentEl.textContent?.trim() || '';

        // 跳过初始欢迎消息（没有实际内容）
        if (role === 'assistant' && content.includes('你好！我是你的AI助手')) return;

        const msg = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${msgIndex}`,
          _base_revision: 0,
          conversation_id: session.id,
          role,
          content: content.substring(0, 100000), // 100KB 上限
          message_index: msgIndex,
          status: 'completed',
          content_type: 'text',
        };

        // assistant 消息附加元数据
        if (role === 'assistant' && msgIndex === (messages.length)) {
          msg.content_type = 'markdown';
          msg.model = this._adpConfigSource?.includes('deepseek') ? 'deepseek-v4-flash' :
                      this._adpConfigSource?.includes('hunyuan') ? 'hunyuan-turbos' : '';
          if (this._adpTimerStart) {
            msg.elapsed_ms = Date.now() - this._adpTimerStart;
          }
        }

        messages.push(msg);
        msgIndex++;
      });

      if (messages.length === 0) return;

      // 更新会话 message_count
      const convUpdate = {
        id: session.id,
        _base_revision: session._revision || 0,
        message_count: messages.length,
        conversation_id: session.conversationId || '',
      };

      // 如果标题还是"新对话"，用第一条用户消息更新
      if (session.title === '新对话') {
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          convUpdate.title = firstUserMsg.content.substring(0, 30);
        }
      }

      await window.SyncEngine.pushConversationsAndMessages([convUpdate], messages);
      console.log('[ChatSync] Pushed', messages.length, 'messages for conversation', session.id);
    } catch (e) {
      console.warn('[ChatSync] pushCurrentConversation failed:', e.message);
    }
  },

  /**
   * 云端删除会话
   */
  async _syncDeleteConversation(sessionId) {
    if (!window.SyncEngine) return;
    try {
      await window.SyncEngine.deleteConversation(sessionId);
      console.log('[ChatSync] Deleted conversation', sessionId, 'from cloud');
    } catch (e) {
      console.warn('[ChatSync] deleteConversation failed:', e.message);
    }
  },

  /**
   * 从云端拉取会话列表并合并到本地
   * 在切换到 AI 助手视图时调用
   */
  async _syncPullConversations() {
    if (!window.SyncEngine) return;
    try {
      const result = await window.SyncEngine.getConversations({ limit: 50 });
      if (!result?.ok || !result.conversations) return;

      const cloudConvs = result.conversations;
      const localIds = new Set(this._chatSessions.map(s => s.id));

      // 合并：云端有本地没有的 → 添加到本地
      let added = 0;
      for (const cloud of cloudConvs) {
        if (!localIds.has(cloud.id)) {
          // 不直接恢复 HTML，只在列表显示
          this._chatSessions.push({
            id: cloud.id,
            title: cloud.title || '新对话',
            messageCount: cloud.message_count || 0,
            createdAt: cloud.created_at || new Date().toISOString(),
            updatedAt: cloud.updated_at || new Date().toISOString(),
            conversationId: cloud.conversation_id || null,
            _fromCloud: true,  // 标记来自云端
            _revision: cloud.revision || 1,
          });
          added++;
        } else {
          // 本地已有：更新 conversationId（跨端复用 ADP 上下文）
          const local = this._chatSessions.find(s => s.id === cloud.id);
          if (local && cloud.conversation_id && !local.conversationId) {
            local.conversationId = cloud.conversation_id;
            local._revision = cloud.revision || local._revision;
          }
          // 云端消息数比本地多 → 更新 messageCount
          if (local && (cloud.message_count || 0) > (local.messageCount || 0)) {
            local.messageCount = cloud.message_count;
          }
        }
      }

      if (added > 0) {
        this._saveChatSessions();
        this._renderChatSessionList();
        console.log('[ChatSync] Merged', added, 'cloud conversations');
      }
    } catch (e) {
      console.warn('[ChatSync] pullConversations failed:', e.message);
    }
  },

  /**
   * 从云端加载会话消息（切换到云端会话时调用）
   * 渲染 Markdown 格式的消息到聊天界面
   */
  async _syncLoadCloudMessages(sessionId) {
    if (!window.SyncEngine) return;
    try {
      const result = await window.SyncEngine.getConversationMessages(sessionId, { limit: 100 });
      if (!result?.ok || !result.messages) return;

      const chatMessages = document.getElementById('chatMessages');
      if (!chatMessages) return;

      const featureCards = chatMessages.querySelector('.feature-cards');
      const quickQuestions = chatMessages.querySelector('.quick-questions');

      // 清空现有消息
      chatMessages.innerHTML = '';
      if (featureCards) chatMessages.appendChild(featureCards);
      if (quickQuestions) chatMessages.appendChild(quickQuestions);

      // 渲染每条消息
      for (const msg of result.messages) {
        const isUser = msg.role === 'user';
        const isSystem = msg.role === 'system';
        if (isSystem) continue; // 跳过系统消息

        if (isUser) {
          const msgHtml = `
            <div class="message user" data-_actions-bound="true">
              <div class="message-content">
                <p>${this.escapeHtml(msg.content)}</p>
                <div class="message-actions user-msg-actions">
                  <button class="msg-action-btn copy-user-msg" title="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
                  <button class="msg-action-btn edit-user-msg" title="编辑"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
                </div>
                <span class="message-time user-time">${this._formatChatTime(new Date(msg.created_at))}</span>
              </div>
            </div>`;
          chatMessages.insertAdjacentHTML('beforeend', msgHtml);
        } else {
          const msgHtml = `
            <div class="message assistant">
              <div class="message-avatar">${this._assistantAvatarSvg}</div>
              <div class="message-content">
                <p>${this.escapeHtml(msg.content)}</p>
                <button class="copy-btn" title="复制" data-_bound="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
                <span class="message-time assistant-time">${this._formatChatTime(new Date(msg.created_at))}</span>
              </div>
            </div>`;
          chatMessages.insertAdjacentHTML('beforeend', msgHtml);
        }
      }

      // 重新绑定事件处理器
      this._bindRestoredMessageActions();
      chatMessages.scrollTop = chatMessages.scrollHeight;
      console.log('[ChatSync] Loaded', result.messages.length, 'messages for', sessionId);
    } catch (e) {
      console.warn('[ChatSync] loadCloudMessages failed:', e.message);
    }
  },
};

// 全局错误捕获：防止未捕获异常导致渲染进程崩溃白屏
window.addEventListener('error', (e) => {
  console.error('[Global Error]', e.error || e.message, e.filename, e.lineno);
  // 阻止错误冒泡导致页面崩溃
  e.preventDefault();
  // v3.1.1: 紧急 UI 重置 — 确保所有 modal/overlay 隐藏，页面可交互
  App._emergencyUIReset?.();
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[Unhandled Rejection]', e.reason);
  e.preventDefault();
});

document.addEventListener('DOMContentLoaded', () => {
  App.init();

  // 窗口关闭/隐藏时自动保存当前会话消息，防止数据丢失
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && App._activeSessionId) {
      App._saveCurrentSessionMessages();
    }
  });
  window.addEventListener('beforeunload', () => {
    if (App._activeSessionId) {
      // beforeunload 必须同步保存，跳过防抖
      if (App._saveSessionTimer) {
        clearTimeout(App._saveSessionTimer);
        App._saveSessionTimer = null;
      }
      App._doSaveCurrentSessionMessages();
    }
  });
});

window.App = App;