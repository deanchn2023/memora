const App = {
  pendingClipboardTask: null,
  editingTask: null,
  autoSaveTimer: null,
  countdownDisplay: null,
  remainingTime: 10,
  newNoteCount: 0, // 记事本角标：不在记事本页时新笔记的累加计数
  dbSyncTimer: null, // 数据库同步定时器
  _chatAttachments: [], // 聊天文件附件列表
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
  _adpReplyMsgId: '',        // reply 消息的 MessageId，用于区分 text.delta 归属
  _aiTaskEditor: null,       // AI任务输入富文本编辑器实例
  _noteEditor: null,         // 新建/编辑笔记富文本编辑器实例
  _noteEditorMode: 'add',    // 笔记编辑器模式：'add' 或 'edit'
  _noteEditorTargetId: null, // 编辑笔记时的目标 ID
  // 对话会话管理
  _chatSessions: [],        // 所有对话会话
  _activeSessionId: null,   // 当前活跃的会话ID

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

    try {
      Audit.init();
      console.log('[App] Audit.init() completed');
    } catch (e) {
      console.error('[App] Audit.init() failed:', e);
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

    // 延迟检查更新（不阻塞初始化）
    setTimeout(() => this._checkForUpdate(), 3000);
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

  bindEvents() {
    document.getElementById('addTaskBtn')?.addEventListener('click', () => this.showTaskModal());
    
    document.getElementById('createTaskBtn')?.addEventListener('click', () => this.createTaskFromClipboard());
    document.getElementById('editTaskBtn')?.addEventListener('click', () => this.editClipboardTask());
    document.getElementById('ignoreBtn')?.addEventListener('click', () => this.hideClipboardDetector());
    document.getElementById('saveToNoteBtn')?.addEventListener('click', () => this.saveClipboardToNote());
    document.getElementById('saveToMemoryBtn')?.addEventListener('click', () => this.saveClipboardToMemory());
    document.getElementById('saveAsQuestionBtn')?.addEventListener('click', () => this.saveClipboardAsQuestion());
    
    document.getElementById('closeModal')?.addEventListener('click', () => this.hideTaskModal());
    document.getElementById('cancelTask')?.addEventListener('click', () => this.hideTaskModal());
    document.getElementById('saveTask')?.addEventListener('click', () => this.saveTask());
    
    // AI分析按钮
    document.getElementById('aiAnalyzeBtn')?.addEventListener('click', () => this.analyzeTaskInput());
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
    
    document.querySelector('.modal-overlay')?.addEventListener('click', () => this.hideTaskModal());
    
    document.addEventListener('showTaskModal', (e) => this.showTaskModal(e.detail));
    
    // 初始化 AI 任务输入富文本编辑器
    const aiEditorContainer = document.getElementById('aiTaskInputEditor');
    if (aiEditorContainer && window.RichEditor) {
      this._aiTaskEditor = new window.RichEditor(aiEditorContainer, {
        placeholder: '输入任务描述，例如：明天下午给客户发报价，需要准备PPT和合同...',
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

        // 只在洞察视图时处理
        const insightView = document.getElementById('insightView');
        if (insightView && !insightView.classList.contains('hidden') && window.Insight) {
          for (const file of files) {
            await window.electronAPI?.multimodalImport?.({ filePath: file.path, title: file.name });
          }
          Insight.loadMultimodal();
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

    // 监听全局模式变更
    if (window.electronAPI?.onGlobalAIModeChanged) {
      window.electronAPI.onGlobalAIModeChanged((mode) => {
        this._aiAssistantMode = mode;
        document.querySelectorAll('.ai-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
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
        // Ctrl+Enter 或 Cmd+Enter 换行
        if (e.ctrlKey || e.metaKey) return;
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
      if (tabName === 'memory') this.loadMemories();
      if (tabName === 'profile') this.loadProfileEditor();
      if (tabName === 'prompt') this.loadPromptFiles();
      if (tabName === 'appearance') this._loadAppearanceSettings();
      if (tabName === 'sync') this._loadSyncSettings();
    }
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
      
      // 显示详细配置来源信息
      const src = config.configSource || {};
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
          // 云端配置时自动展开显示已同步的值
          if (isServerSource) {
            cosCard.classList.add('expanded');
          }
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
          cosCard.classList.add('expanded'); // 未配置时自动展开提示用户
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
            document.getElementById('profileName').value = state.user.name || '';
            document.getElementById('profileNickname').value = state.user.nickname || '';
            document.getElementById('profileEmail').value = state.user.email || '';
            document.getElementById('profileMobile').value = state.user.mobile || '';
          }
        });
      }
    }
    section.classList.toggle('hidden');
  },

  async saveProfileEdit() {
    const name = document.getElementById('profileName').value.trim();
    const nickname = document.getElementById('profileNickname').value.trim();
    const email = document.getElementById('profileEmail').value.trim();
    const mobile = document.getElementById('profileMobile').value.trim();
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

    try {
      const result = await window.electronAPI.authUpdateProfile({ name, nickname, email, mobile });
      if (result.success) {
        this.showToast('个人信息已更新');
        this.toggleProfileEdit();
        // 刷新用户显示
        if (result.user) {
          document.getElementById('orgUserName').textContent = result.user.name || result.user.username || '-';
          this._updateHeaderUserBadge(true, result.user);
        }
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

    // 点击标记已读
    body.querySelectorAll('.notification-item.unread').forEach(el => {
      el.addEventListener('click', async (e) => {
        // 忽略删除按钮的点击
        if (e.target.classList.contains('notification-item-delete')) return;
        const id = el.dataset.id;
        if (window.electronAPI?.notificationsMarkRead) {
          await window.electronAPI.notificationsMarkRead(id);
        }
        el.classList.remove('unread');
        el.classList.add('read');
        // 更新 badge
        const currentBadge = document.getElementById('notificationBadge');
        const count = Math.max(0, parseInt(currentBadge?.textContent || '0') - 1);
        if (currentBadge) {
          if (count > 0) {
            currentBadge.textContent = count;
          } else {
            currentBadge.classList.add('hidden');
          }
        }
      });
    });

    // 删除按钮
    body.querySelectorAll('.notification-item-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        // 乐观更新：先移除 DOM
        const item = btn.closest('.notification-item');
        if (item) {
          item.style.transition = 'opacity 0.15s, transform 0.15s';
          item.style.opacity = '0';
          item.style.transform = 'translateX(20px)';
          setTimeout(() => {
            item.remove();
            // 如果列表为空，显示空状态
            if (body.querySelectorAll('.notification-item').length === 0) {
              body.innerHTML = `<div class="notification-empty">${window.i18n?.t('notification.empty') || '暂无通知'}</div>`;
            }
          }, 150);
        }
        // 更新 badge
        const currentBadge = document.getElementById('notificationBadge');
        const unreadItems = body.querySelectorAll('.notification-item.unread');
        const unreadCount = Math.max(0, unreadItems.length - 1);
        if (currentBadge) {
          if (unreadCount > 0) {
            currentBadge.textContent = unreadCount;
            currentBadge.classList.remove('hidden');
          } else {
            currentBadge.classList.add('hidden');
          }
        }
        // 后台异步标记已读
        if (window.electronAPI?.notificationsMarkRead) {
          window.electronAPI.notificationsMarkRead(id).catch(() => {});
        }
      });
    });
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
    let server = 'http://121.5.164.126:3450'; // fallback
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

    // 更新 AI 模式切换按钮可见性
    this._updateAIModeToggle();

    // 功能卡片点击切换快捷问题
    this._initFeatureCards();

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
        this._aiAssistantMode = result.mode || 'agent';
        toggle.querySelectorAll('.ai-mode-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.mode === this._aiAssistantMode);
        });
      });
    } else {
      this._aiAssistantMode = 'agent';
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
      const category = card.dataset.category;
      if (!category) return;
      // 切换 active 状态
      container.querySelectorAll('.feature-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      this._switchQuickQuestions(category);
    });
  },

  /** 根据分类切换快捷问题 */
  _switchQuickQuestions(category) {
    const container = document.getElementById('quickCapsules');
    if (!container) return;

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

  async sendAIMessage(forceMode) {
    const input = document.getElementById('aiChatInput');
    const message = input.value.trim();
    
    // 需要有消息或附件
    if (!message && this._chatAttachments.length === 0) return;

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
    assistantMessage.innerHTML = `
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
      
      // 根据 AI 助手模式决定调用路径：
      // - agent 模式：使用 ADP 智能体（工具调用、多步推理等）
      // - llm 模式：使用已配置的大模型 API 直接对话（简单聊天）
      // - forceMode: 'adp' 强制走 ADP，'agent' 强制走本地 Agent
      const isAgentMode = this._aiAssistantMode !== 'llm';
      
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

        // 启动流式请求 — 传递结构化数据（message + attachments）
        result = await window.electronAPI.sendADPMessage({
          message: message,
          attachments: attachmentData
        });

        // 文档解析阶段已结束，移除上传进度监听并隐藏状态行
        window.electronAPI.removeADPUploadListeners?.();
        const _uploadStatusEl = document.getElementById('adpUploadStatus');
        // 解析失败时保留提示（由进度回调的 6s 定时器收起），成功则立即隐藏
        if (_uploadStatusEl && !_docParseHadError) _uploadStatusEl.style.display = 'none';
        
        if (result.success && result.streaming) {
          // 流式模式：监听 SSE 事件
          this._adpStreaming = true;
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
          this._adpTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this._adpTimerStart) / 1000);
            const el = document.getElementById('adpProgressTimer');
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
      } else if (window.electronAPI?.agent?.invoke) {
        // Agent 或 LLM 模式：使用本地 AI 流式输出
        const agentType = this._aiAssistantMode === 'llm' ? 'chat' : undefined;

        // 先注册流式监听器（防止竞态：invoke 返回前主进程可能已开始推送事件）
        this._agentStreamBuffer = [];
        this._agentStreamListening = true;
        window.electronAPI.onAgentStream((evt) => {
          if (this._agentStreamListening) {
            this._agentStreamBuffer.push(evt);
          }
        });

        result = await window.electronAPI.agent.invoke(message, agentType, attachmentData);
        
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
          // 绑定按钮事件
          const copyBtn = messageContent.querySelector('.copy-btn');
          if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyAssistantMessage(copyBtn, messageContent));
          }
          const feedbackDiv = messageContent.querySelector('.agent-feedback');
          if (feedbackDiv) {
            const tid = feedbackDiv.dataset.traceId;
            feedbackDiv.querySelector('.feedback-accept')?.addEventListener('click', () => {
              window.electronAPI?.feedback?.accept(tid, result.result);
              feedbackDiv.innerHTML = '<span class="feedback-done">✓ 感谢反馈</span>';
            });
            feedbackDiv.querySelector('.feedback-reject')?.addEventListener('click', () => {
              window.electronAPI?.feedback?.reject(tid, '用户标记无用');
              feedbackDiv.innerHTML = '<span class="feedback-done">✓ 已记录</span>';
            });
          }
          messageContent.querySelectorAll('.agent-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              const action = e.currentTarget.dataset.action;
              this.handleAgentAction(action, result.result, result.agentType);
            });
          });
          // 绑定 Agent 产物保存按钮
          this._bindArtifactSaveButtons(messageContent);
          messageContent.querySelectorAll('.agent-task-card').forEach(card => {
            card.addEventListener('click', () => {
              const title = card.dataset.title;
              const schedule = card.dataset.schedule;
              if (title) {
                this.showTaskModal({ title, description: `排程时间：${schedule || ''}`, estimatedDuration: 60, priority: 'high' });
              }
            });
          });
        } else {
          this._agentStreamListening = false;
          this._agentStreamBuffer = [];
          window.electronAPI?.removeAgentListeners?.();
          throw new Error(result.error || 'Agent 调用失败');
        }
      }
    } catch (error) {
      console.error('[AI] Error:', error);
      this._agentStreamListening = false;
      this._agentStreamBuffer = [];
      window.electronAPI?.removeAgentListeners?.();
      const messageContent = assistantMessage.querySelector('.message-content');
      messageContent.innerHTML = `<p class="error-text">抱歉，发生了错误：${this.escapeHtml(error.message)}</p>
        <p class="error-hint">请检查 API 配置或网络连接</p>`;
    }
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  // === 复制按钮 ===
  async copyAssistantMessage(btn, messageContent) {
    // 获取纯文本内容，排除复制按钮、反馈按钮等非内容元素
    const clone = messageContent.cloneNode(true);
    // 移除不需要复制的元素
    clone.querySelectorAll('.copy-btn, .agent-feedback, .agent-badge, .adp-config-source, .adp-progress, .adp-thinking-section, .adp-files-section, .message-time, .agent-save-artifact-btn, .agent-task-card, .adp-step-detail, .msg-action-btn, .user-msg-actions').forEach(el => el.remove());
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

  // === 绑定用户消息操作按钮（复制+编辑） ===
  _bindUserMsgActions(msgContent) {
    if (!msgContent) return;
    const copyBtn = msgContent.querySelector('.copy-user-msg');
    const editBtn = msgContent.querySelector('.edit-user-msg');

    // 提取消息完整文本（含附件信息）
    const _getFullText = () => {
      const p = msgContent.querySelector('p');
      let text = p ? p.textContent : '';
      // 收集附件信息
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
    };

    if (copyBtn) {
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const btn = e.currentTarget;
        const text = _getFullText();
        if (!text) { this.showToast('没有可复制的内容', 'error'); return; }
        try {
          // 优先通过主进程写入，确保写入纯文本
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
          btn.style.color = '#34C759';
          this.showToast('已复制到剪贴板', 'success');
          setTimeout(() => { btn.style.color = ''; }, 1500);
        } catch (err) {
          console.error('[Copy] User msg copy failed:', err);
          this.showToast('复制失败: ' + (err.message || ''), 'error');
        }
      });
    }

    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const text = _getFullText();
        const inputEl = document.getElementById('aiChatInput');
        if (inputEl && text) {
          inputEl.value = text;
          inputEl.style.height = 'auto';
          inputEl.style.height = inputEl.scrollHeight + 'px';
          inputEl.focus();
          this.showToast('已加载到输入框，可直接发送', 'success');
        }
      });
    }
  },

  // === 重新绑定恢复消息的事件处理器 ===
  _bindRestoredMessageActions() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    // 重新绑定用户消息的复制和编辑按钮
    chatMessages.querySelectorAll('.message.user').forEach(msg => {
      const msgContent = msg.querySelector('.message-content');
      if (msgContent && !msg.dataset._actionsBound) {
        this._bindUserMsgActions(msgContent);
        msg.dataset._actionsBound = 'true';
      }
    });

    // 重新绑定助手消息的复制按钮
    chatMessages.querySelectorAll('.message.assistant .copy-btn').forEach(btn => {
      if (!btn.dataset._bound) {
        btn.addEventListener('click', () => this.copyAssistantMessage(btn, btn.closest('.message-content')));
        btn.dataset._bound = 'true';
      }
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

    // 🔧 绑定链接点击事件（Agent 模式也需要）
    messageContent.querySelectorAll('.adp-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const url = link.dataset.url || link.getAttribute('href');
        if (url) {
          window.electronAPI?.openExternal(url);
        }
      });
    });
    messageContent.querySelectorAll('.adp-file-card').forEach(card => {
      card.addEventListener('click', () => {
        const url = card.dataset.url;
        const name = card.dataset.name;
        if ((url && url !== '#') || card.dataset.filepath) {
          this._downloadFileToArtifacts(url, name, card);
        }
      });
    });

    // 绑定按钮事件
    const copyBtn = messageContent.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.copyAssistantMessage(copyBtn, messageContent));
    }
    const feedbackDiv = messageContent.querySelector('.agent-feedback');
    if (feedbackDiv) {
      const tid = feedbackDiv.dataset.traceId;
      feedbackDiv.querySelector('.feedback-accept')?.addEventListener('click', () => {
        window.electronAPI?.feedback?.accept(tid, parsed || { text: fullText });
        feedbackDiv.innerHTML = '<span class="feedback-done">✓ 感谢反馈</span>';
      });
      feedbackDiv.querySelector('.feedback-reject')?.addEventListener('click', () => {
        window.electronAPI?.feedback?.reject(tid, '用户标记无用');
        feedbackDiv.innerHTML = '<span class="feedback-done">✓ 已记录</span>';
      });
    }

    // 绑定 Agent 操作按钮事件
    messageContent.querySelectorAll('.agent-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        this.handleAgentAction(action, parsed, agentType);
      });
    });

    // 绑定 Agent 产物保存按钮
    this._bindArtifactSaveButtons(messageContent);

    // 绑定可点击任务卡片
    messageContent.querySelectorAll('.agent-task-card').forEach(card => {
      card.addEventListener('click', () => {
        const title = card.dataset.title;
        const schedule = card.dataset.schedule;
        if (title) {
          this.showTaskModal({ title, description: `排程时间：${schedule || ''}`, estimatedDuration: 60, priority: 'high' });
        }
      });
    });

    // 绑定思考过程折叠/展开（Agent 流式输出时生成）
    messageContent.querySelectorAll('.adp-thinking-header').forEach(header => {
      header.addEventListener('click', () => {
        header.parentElement.classList.toggle('expanded');
        const toggle = header.querySelector('.adp-thinking-toggle');
        if (toggle) toggle.textContent = header.parentElement.classList.contains('expanded') ? '▼' : '▶';
      });
    });

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  // ===== ADP SSE 流式渲染（参考 ADP Agent SDK） =====

  _addCopyButton(messageContent) {
    const copyBtnHtml = '<button class="copy-btn" title="复制"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>';
    messageContent.insertAdjacentHTML('beforeend', copyBtnHtml);
    const copyBtn = messageContent.querySelector('.copy-btn:last-child');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.copyAssistantMessage(copyBtn, messageContent));
    }
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
                      <span class="adp-file-icon">${ic}</span><span class="adp-file-name">${this.escapeHtml(fn)}</span><span class="adp-file-open">💾 保存</span></div>`;
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
          stepInfo.textBuffer = (stepInfo.textBuffer || '') + text;
          // 实时更新步骤详情（追加模式）
          this._updateADPStepDetailStreaming(msgId, stepInfo.textBuffer);
        } else {
          // reply 消息或未知消息 → 追加到主回复
          if (!this._adpCurrentBubble) this._startADPReply(messageContent);
          this._adpCurrentText += text;
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

      // 绑定文件卡片点击事件
      this._adpCurrentBubble.querySelectorAll('.adp-file-card').forEach(card => {
        card.addEventListener('click', () => {
          const url = card.dataset.url;
          const name = card.dataset.name;
          if ((url && url !== '#') || card.dataset.filepath) {
            this._downloadFileToArtifacts(url, name, card);
          }
        });
      });

      // 🔧 绑定链接点击事件（替代 inline onclick，更安全可靠）
      this._adpCurrentBubble.querySelectorAll('.adp-link').forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const url = link.dataset.url || link.getAttribute('href');
          if (url) {
            window.electronAPI?.openExternal(url);
          }
        });
      });

      // 绑定思考过程折叠/展开
      this._adpCurrentBubble.querySelectorAll('.adp-thinking-header').forEach(header => {
        header.addEventListener('click', () => {
          header.parentElement.classList.toggle('expanded');
          const toggle = header.querySelector('.adp-thinking-toggle');
          if (toggle) toggle.textContent = header.parentElement.classList.contains('expanded') ? '▼' : '▶';
        });
      });

      // 绑定 Agent 产物保存按钮
      this._bindArtifactSaveButtons(this._adpCurrentBubble);
    }

    // 如果有文件输出，添加文件卡片区域
    if (this._adpFileItems.length > 0) {
      const filesHtml = this._adpFileItems.map(f => {
        const fn = f.file_path?.split('/').pop() || '文件';
        const ext = fn.split('.').pop()?.toLowerCase();
        const iconMap = { html: '🌐', pdf: '📖', xlsx: '📊', csv: '📋', png: '🖼', jpg: '🖼' };
        const ic = iconMap[ext] || '📄';
        return `<div class="adp-file-card" data-url="${this.escapeHtml(f.url || '#')}" data-name="${this.escapeHtml(fn)}">
          <span class="adp-file-icon">${ic}</span><span class="adp-file-name">${this.escapeHtml(fn)}</span><span class="adp-file-open">💾 保存</span></div>`;
      }).join('');
      const filesEl = document.createElement('div');
      filesEl.className = 'adp-files-section';
      filesEl.innerHTML = filesHtml;
      filesEl.querySelectorAll('.adp-file-card').forEach(card => {
        card.addEventListener('click', () => {
          const url = card.dataset.url;
          const name = card.dataset.name;
          if ((url && url !== '#') || card.dataset.filepath) this._downloadFileToArtifacts(url, name, card);
        });
      });
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
    this._adpCurrentBubble = null;
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
        const textEl = messageContent.querySelector('.adp-response-text, .message-text, p');
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
    const stepsEl = document.getElementById('adpProgressSteps');
    if (!stepsEl) return;
    this._adpToolStepCount++;
    const progressEl = document.getElementById('adpProgress');
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
      // 绑定文件卡片事件
      detailEl.querySelectorAll('.adp-file-card').forEach(card => {
        card.addEventListener('click', () => {
          const url = card.dataset.url;
          const name = card.dataset.name;
          if ((url && url !== '#') || card.dataset.filepath) this._downloadFileToArtifacts(url, name, card);
        });
      });
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
    const progressEl = document.getElementById('adpProgress');
    if (!progressEl) return;
    progressEl.classList.add('collapsed');
    const stepsEl = document.getElementById('adpProgressSteps');
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
    const timerEl = document.getElementById('adpProgressTimer');
    if (timerEl) timerEl.textContent = `${Math.floor((Date.now() - this._adpTimerStart) / 1000)}s`;
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

    let html = this.escapeHtml(text);

    // 还原 Markdown 链接
    // 🔧 修复：不使用 inline onclick（Electron contextIsolation 下可能不生效），
    // 改用 data-url 属性 + 事件委托（和 adp-file-card 同模式）
    mdLinks.forEach((link, idx) => {
      const ph = `__MDLINK_${idx}__`, su = this.escapeHtml(link.url), sd = this.escapeHtml(link.display);
      html = html.replace(ph, link.isHtml
        ? `<div class="adp-file-card" data-url="${su}" data-name="${this.escapeHtml(link.fileName)}"><span class="adp-file-icon">🌐</span><span class="adp-file-name">${sd}</span><span class="adp-file-open">↗ 打开</span></div>`
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
          return `<div class="adp-file-card" data-url="${this.escapeHtml(f.url || '#')}" data-name="${this.escapeHtml(fn)}"><span class="adp-file-icon">${im[ext] || '📄'}</span><span class="adp-file-name">${this.escapeHtml(fn)}</span><span class="adp-file-open">💾 保存</span></div>`;
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
      html = html.replace(ph, `<div class="adp-file-card" data-url="#" data-name="${this.escapeHtml(fp.name)}" data-filepath="${this.escapeHtml(fp.path)}"><span class="adp-file-icon">${im[ext] || '📄'}</span><span class="adp-file-name">${this.escapeHtml(fp.name)}</span><span class="adp-file-open">💾 保存</span></div>`);
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
      const isHtml = lang.toLowerCase() === 'html' || lang.toLowerCase() === 'htm';
      const isDocument = isHtml || ['json', 'xml', 'svg', 'css', 'md', 'markdown'].includes(lang.toLowerCase());
      const saveBtn = isDocument
        ? `<button class="agent-save-artifact-btn" data-action="save-artifact" data-lang="${this.escapeHtml(lang)}" data-filename="" title="保存到 Agent 产物">💾 保存</button>`
        : '';
      return `<pre><code>${code.trim()}</code></pre>${saveBtn}`;
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
    
    // 绑定移除按钮
    container.querySelectorAll('.attachment-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx);
        this._chatAttachments.splice(idx, 1);
        this.renderChatAttachments();
      });
    });

    // 绑定文件名点击下载
    container.querySelectorAll('.attachment-name').forEach(nameEl => {
      nameEl.style.cursor = 'pointer';
      nameEl.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx);
        const att = this._chatAttachments[idx];
        if (!att) return;
        this.downloadAttachment(att);
      });
    });
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
    this.renderChatAttachments();
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
        // 没有激活记录，默认选第一个（最新的）
        this._activeSessionId = this._chatSessions[0].id;
        if (this._chatSessions[0].conversationId) {
          window.electronAPI?.setADPConversationId?.(this._chatSessions[0].conversationId);
        }
      }
    } catch (e) {
      console.error('[Chat] Failed to load sessions:', e);
      this._chatSessions = [];
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

    listEl.innerHTML = sorted.map(session => `
      <div class="chat-session-item${session.id === this._activeSessionId ? ' active' : ''}" data-session-id="${session.id}">
        <span class="chat-session-icon">💬</span>
        <span class="chat-session-title">${this.escapeHtml(session.title || '新对话')}</span>
        <button class="chat-session-delete" data-session-id="${session.id}" title="删除对话">×</button>
      </div>
    `).join('');
  },

  createNewChatSession() {
    // 如果正在流式，先停止
    if (this._adpStreaming) {
      this.stopADPGeneration();
    }

    // 保存当前对话消息
    this._saveCurrentSessionMessages();

    // 通知主进程重置 ConversationId
    window.electronAPI?.newADPChat?.();

    // 创建新会话
    const sessionId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const session = {
      id: sessionId,
      title: '新对话',
      messageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
    if (this._adpStreaming) {
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

  _saveCurrentSessionMessages() {
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
    if (!this._adpStreaming) return;

    this._adpStreaming = false;
    if (this._adpTimerInterval) { clearInterval(this._adpTimerInterval); this._adpTimerInterval = null; }
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
      const adpKnowledgeAppKey = document.getElementById('adpKnowledgeAppKey').value;
      const adpSearchAppKey = document.getElementById('adpSearchAppKey').value;
      const adpClusteringAppKey = document.getElementById('adpClusteringAppKey').value;
      const adpGraphAppKey = document.getElementById('adpGraphAppKey').value;
      const adpActivationAppKey = document.getElementById('adpActivationAppKey').value;
      const adpEvolutionAppKey = document.getElementById('adpEvolutionAppKey').value;
      const adpConflictAppKey = document.getElementById('adpConflictAppKey').value;
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
      
      // Phase 3: 保存用户画像
      await this.saveProfileFromEditor();
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
          ? `<button class="note-btn note-btn-download" data-action="download" title="下载图片">📥</button>
             <button class="note-btn note-btn-danger" data-action="delete" title="删除笔记">🗑️</button>`
          : `<button class="note-btn note-btn-download" data-action="download" title="下载为 Markdown">📥</button>
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
    const status = note.analysis.status;
    if (!status) {
      // 兼容旧数据：根据已有字段推断状态
      if (note.analysis.hasRecommendation) return '<span class="note-status-tag tag-recommended">已推荐知识</span>';
      if (note.analysis.isTask) return '<span class="note-status-tag tag-task">已创建待办</span>';
      if (note.analyzed) return '<span class="note-status-tag tag-analyzed">已分析</span>';
      return '';
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
    return `<span class="${cls}">${status}</span>`;
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

  // 绑定侧边栏分类事件（含新增、编辑、删除、拖放）
  bindCategoryEvents() {
    // 分类点击（使用 closest 确保 div 内子元素点击也能触发）
    document.querySelectorAll('.category-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const catItem = e.target.closest('.category-item');
        if (!catItem) return;
        document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
        catItem.classList.add('active');
        this.loadNotes(catItem.dataset.category);
      });
    });

    // 删除按钮
    document.querySelectorAll('.category-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const category = e.target.dataset.category;
        this.deleteNotesByCategory(category);
      });
    });

    // 编辑（重命名）按钮
    document.querySelectorAll('.category-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const category = e.target.dataset.category;
        this.renameCategory(category);
      });
    });

    // 新增分类按钮
    const addBtn = document.querySelector('.category-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.addCustomCategory();
      });
    }

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
    this.showNoteEditorModal('新建笔记', '');
  },
  
  showNoteEditorModal(title, content) {
    document.getElementById('noteEditorTitle').textContent = title || '新建笔记';
    const container = document.getElementById('noteEditorContainer');
    
    // 初始化编辑器
    if (this._noteEditor) {
      this._noteEditor.destroy();
    }
    if (window.RichEditor) {
      this._noteEditor = new window.RichEditor(container, {
        placeholder: '输入笔记内容，支持富文本格式...',
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
    
    try {
      if (window.electronAPI) {
        if (this._noteEditorMode === 'add') {
          const category = this.autoClassifyNote(text);
          const result = await window.electronAPI.notebookAddNote({
            content: text,
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
          await this.updateNoteContent(this._noteEditorTargetId, text, html);
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
      
      overlay.querySelectorAll('.delete-reason-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          overlay.remove();
          resolve(btn.dataset.reason);
        });
      });
      
      overlay.querySelector('.delete-reason-cancel').addEventListener('click', () => {
        overlay.remove();
        resolve(null);
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

  // 绑定笔记项拖拽事件
  bindNoteDragEvents() {
    const noteItems = document.querySelectorAll('.note-item[draggable="true"]');
    noteItems.forEach(item => {
      item.addEventListener('dragstart', (e) => {
        // 复选框区域不触发拖拽
        if (e.target.classList.contains('note-checkbox')) {
          e.preventDefault();
          return;
        }
        this._dragNoteId = item.dataset.id;
        this._dragNoteCategory = item.dataset.category;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.id);

        // 创建缩小版拖拽预览
        const title = item.querySelector('.note-title')?.textContent || '';
        const category = item.querySelector('.note-category')?.textContent || '';
        const ghost = document.createElement('div');
        ghost.className = 'note-drag-ghost';
        ghost.innerHTML = `<span class="ghost-category">${category}</span><span class="ghost-title">${title}</span>`;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 8, 12);

        // 需要延迟添加，否则拖拽预览也会半透明
        requestAnimationFrame(() => {
          item.classList.add('dragging-active');
          // 清理 ghost 元素
          requestAnimationFrame(() => ghost.remove());
        });
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging', 'dragging-active');
        this._dragNoteId = null;
        this._dragNoteCategory = null;
        // 清除所有分类高亮（包括 wrapper 和 category-item）
        document.querySelectorAll('.category-item, .category-item-wrapper').forEach(c => {
          c.classList.remove('drop-target', 'drop-hover');
        });
      });
    });
  },

  // 绑定侧边栏分类为拖放目标
  bindCategoryDropTargets() {
    // 绑定到 .category-item-wrapper（包含按钮的整行区域，更可靠的 drop 目标）
    // 和独立的 .category-item（如"全部"）
    const dropTargets = document.querySelectorAll('.category-item-wrapper, .category-item:not(.category-item-wrapper .category-item)');
    dropTargets.forEach(target => {
      const categoryKey = target.dataset.category;
      if (!categoryKey) return;

      target.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
      });

      target.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 只高亮非当前分类（"全部"分类不可拖入）
        if (categoryKey !== 'all' && categoryKey !== this._dragNoteCategory) {
          target.classList.add('drop-hover');
          // 同时高亮内部的 category-item
          const innerItem = target.querySelector('.category-item');
          if (innerItem) innerItem.classList.add('drop-hover');
        }
      });

      target.addEventListener('dragleave', (e) => {
        // 只在真正离开目标时移除高亮
        if (!target.contains(e.relatedTarget)) {
          target.classList.remove('drop-hover');
          const innerItem = target.querySelector('.category-item');
          if (innerItem) innerItem.classList.remove('drop-hover');
        }
      });

      target.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        target.classList.remove('drop-hover');
        const innerItem = target.querySelector('.category-item');
        if (innerItem) innerItem.classList.remove('drop-hover');

        const noteId = this._dragNoteId;
        const targetCategory = categoryKey;
        const oldCategory = this._dragNoteCategory;

        if (!noteId || !targetCategory || targetCategory === 'all' || targetCategory === oldCategory) {
          return;
        }

        try {
          if (window.electronAPI) {
            const result = await window.electronAPI.notebookUpdateNote(noteId, {
              category: targetCategory
            });
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
    });
  },

  // ===== 记事本批量选择与发送给 ADP =====

  // 绑定记事项复选框事件
  bindNoteCheckboxEvents() {
    const checkboxes = document.querySelectorAll('.note-checkbox');
    checkboxes.forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const noteItem = cb.closest('.note-item');
        if (cb.checked) {
          noteItem.classList.add('note-selected');
        } else {
          noteItem.classList.remove('note-selected');
        }
        this.updateNotebookBatchBar();
      });
      // 阻止复选框的点击冒泡到 note-item（避免展开预览）
      cb.addEventListener('click', (e) => e.stopPropagation());
    });
  },

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

    // 处理分类选择
    popup.querySelectorAll('.category-popup-item').forEach(btn => {
      btn.addEventListener('click', async (e) => {
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

    // 保存原始内容用于取消
    const originalHTML = previewContent.innerHTML;
    const originalText = previewContent.textContent;

    // 隐藏原始内容
    previewContent.style.display = 'none';

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
        // 保存富文本内容
        this.updateNoteContent(noteId, text, html);
      }
      // 恢复原始显示
      editor.destroy();
      editorWrapper.remove();
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
  
  async updateNoteContent(noteId, newContent, htmlContent) {
    if (window.electronAPI) {
      try {
        const updates = { 
          content: newContent, 
          title: this.extractNoteTitle(newContent)
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
    // 先尝试内联编辑（双击展开后的笔记）
    const previewContent = document.querySelector(`.note-preview-content[data-note-id="${id}"]`);
    if (previewContent && previewContent.closest('.note-preview') && !previewContent.closest('.note-preview').classList.contains('hidden')) {
      this.enterEditMode(id);
    } else {
      // 使用弹窗编辑
      if (window.electronAPI) {
        const result = await window.electronAPI.notebookGetNote(id);
        if (result.note) {
          this._noteEditorMode = 'edit';
          this._noteEditorTargetId = id;
          this.showNoteEditorModal('编辑笔记', result.note.htmlContent || result.note.content);
        }
      }
    }
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
                rawText: result.note.content
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
    
    const result = await window.electronAPI.notebookSearch(query);
    const noteList = document.getElementById('notebookList');
    
    if (result.notes && result.notes.length > 0) {
      noteList.innerHTML = result.notes.map(note => {
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
      isDraft: true
    });
    
    task.reminders = Reminder.calculateReminders(task);
    Store.updateTask(task.id, { reminders: task.reminders });
    
    this.hideClipboardDetector();
    this.renderTaskList();
    Calendar.render();
    
    this.showToast('已自动保存为草稿');
  },

  showClipboardDetector() {
    document.getElementById('clipboardDetector')?.classList.remove('hidden');
  },

  hideClipboardDetector() {
    document.getElementById('clipboardDetector')?.classList.add('hidden');
    this.pendingClipboardTask = null;
    
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    
    const countdownEl = document.getElementById('countdownDisplay');
    if (countdownEl) {
      countdownEl.remove();
    }
  },

  async saveClipboardToNote() {
    if (!this.pendingClipboardTask) return;
    
    const content = this.pendingClipboardTask.rawText;
    
    try {
      if (window.electronAPI) {
        const category = this.autoClassifyNote(content);
        
        const result = await window.electronAPI.notebookAddNote({
          content: content,
          category: category
        });
        
        if (result.success) {
          if (result.duplicate) {
            this.showToast('今天已有相同内容，已跳过', 'info');
          } else {
            this.incrementNewNoteCount();
            this.showToast(`已保存到笔记（${this.getNoteCategoryLabel(category)}）`);
          }
          this.hideClipboardDetector();
        }
      }
    } catch (error) {
      console.error('保存到笔记失败:', error);
      this.showToast('保存到笔记失败', 'error');
    }
  },

  async saveClipboardToMemory() {
    if (!this.pendingClipboardTask) return;
    
    const content = this.pendingClipboardTask.rawText;
    
    try {
      if (window.electronAPI) {
        const memoryResult = await window.electronAPI.extractMemory(content);
        
        if (memoryResult.success && memoryResult.memory) {
          this.showToast('已保存到记忆');
          this.hideClipboardDetector();
        } else {
          this.showToast('保存到记忆失败', 'error');
        }
      }
    } catch (error) {
      console.error('保存到记忆失败:', error);
      this.showToast('保存到记忆失败', 'error');
    }
  },

  async saveClipboardAsQuestion() {
    if (!this.pendingClipboardTask) return;
    const content = this.pendingClipboardTask.rawText;

    try {
      if (window.electronAPI?.knowledgeAddAtom) {
        const result = await window.electronAPI.knowledgeAddAtom({
          content: content.trim(),
          domain: '通用',
          type: 'question',
          importance: 0.7
        });
        if (result.success) {
          this.showToast('❓ 问题已记录到知识库');
          this.hideClipboardDetector();
        } else {
          this.showToast('记录问题失败');
        }
      }
    } catch (error) {
      console.error('记录问题失败:', error);
      this.showToast('记录问题失败');
    }
  },

  createTaskFromClipboard() {
    if (!this.pendingClipboardTask) return;
    
    const taskData = this.pendingClipboardTask.task;
    const dueDate = taskData.dueDate ? new Date(taskData.dueDate) : this.getDefaultDueDate();
    
    const task = Store.addTask({
      title: taskData.title,
      description: taskData.description || '',
      estimatedDuration: taskData.estimatedDuration || 60,
      priority: taskData.priority || 'medium',
      dueDate: dueDate.toISOString(),
      source: 'clipboard',
      rawText: this.pendingClipboardTask.rawText
    });
    
    task.reminders = Reminder.calculateReminders(task);
    Store.updateTask(task.id, { reminders: task.reminders });
    
    if (document.getElementById('syncCalendar').checked && window.electronAPI) {
      window.electronAPI.addToCalendar(task);
    }
    
    this.hideClipboardDetector();
    this.renderTaskList();
    Calendar.render();
    
    this.showToast('任务已创建');
  },

  editClipboardTask() {
    if (!this.pendingClipboardTask) return;
    
    const taskData = this.pendingClipboardTask.task;
    const dueDate = taskData.dueDate ? new Date(taskData.dueDate) : this.getDefaultDueDate();
    
    this.showTaskModal({
      title: taskData.title,
      description: taskData.description || '',
      estimatedDuration: taskData.estimatedDuration || 60,
      priority: taskData.priority || 'medium',
      dueDate: dueDate.toISOString()
    });
    
    this.hideClipboardDetector();
  },

  getDefaultDueDate() {
    const now = new Date();
    const hour = now.getHours();
    
    // 默认截止时间：根据当前时间推算下一个合理时段
    if (hour < 12) {
      // 上午 → 默认今天下午17:00
      now.setHours(17, 0, 0, 0);
    } else if (hour < 18) {
      // 下午 → 默认今天晚上20:00
      now.setHours(20, 0, 0, 0);
    } else {
      // 晚上 → 默认明天上午10:00
      now.setDate(now.getDate() + 1);
      now.setHours(10, 0, 0, 0);
    }
    return now;
  },

  // 将 Date 对象格式化为 datetime-local 输入框所需的本地时间字符串 (YYYY-MM-DDTHH:mm)
  formatDateTimeLocal(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  showTaskModal(task = null) {
    console.log('[App] showTaskModal called with:', task);
    this.editingTask = task;
    
    const modal = document.getElementById('taskModal');
    const titleInput = document.getElementById('taskTitle');
    const descInput = document.getElementById('taskDesc');
    const dueInput = document.getElementById('taskDue');
    const durationInput = document.getElementById('taskDuration');
    const priorityInput = document.getElementById('taskPriority');
    
    if (task && task.id) {
      document.getElementById('modalTitle').textContent = '编辑任务';
      titleInput.value = task.title;
      descInput.value = task.description || '';
      
      if (task.dueDate) {
        dueInput.value = this.formatDateTimeLocal(new Date(task.dueDate));
      }
      
      durationInput.value = task.estimatedDuration;
      priorityInput.value = task.priority;
    } else {
      document.getElementById('modalTitle').textContent = '新建任务';
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
    }
    
    modal.classList.remove('hidden');
    titleInput.focus();
  },

  hideTaskModal() {
    document.getElementById('taskModal')?.classList.add('hidden');
    this.editingTask = null;
    // 清除 AI 编辑器内容
    if (this._aiTaskEditor) this._aiTaskEditor.clear();
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

    // 点击切换关联
    container.querySelectorAll('.linked-person-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
      });
    });
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
    
    const taskData = {
      title: title,
      description: descInput.value.trim(),
      estimatedDuration: parseInt(durationInput.value) || 60,
      priority: priorityInput.value,
      dueDate: dueInput.value ? new Date(dueInput.value).toISOString() : null,
      linkedPersons: this._getAutoLinkedPersons(title, descInput.value.trim())
    };
    
    if (this.editingTask && this.editingTask.id) {
      const updatedTask = Store.updateTask(this.editingTask.id, taskData);
      updatedTask.reminders = Reminder.calculateReminders(updatedTask);
      Store.updateTask(updatedTask.id, { reminders: updatedTask.reminders });
      
      if (syncCalendarInput.checked && window.electronAPI) {
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
      
      if (syncCalendarInput.checked && window.electronAPI) {
        window.electronAPI.addToCalendar(newTask);
      }
      
      this.showToast('任务已创建');
    }
    
    this.hideTaskModal();
    this.renderTaskList();
    Calendar.render();
  },
  
  // AI分析任务输入
  async analyzeTaskInput() {
    const input = this._aiTaskEditor ? this._aiTaskEditor.getText().trim() : (document.getElementById('aiTaskInput')?.value?.trim() || '');
    if (!input) {
      this.showToast('请输入任务描述', 'error');
      return;
    }
    
    try {
      if (window.electronAPI) {
        this.showToast('正在分析...', 'info');
        
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
          
          // AI 识别到的人物 → 自动关联
          if (result.task.linked_persons && result.task.linked_persons.length > 0) {
            this._renderTaskLinkedPersons(result.task.linked_persons.map(name => ({ name })));
          }
          
          // 显示分析结果
          document.getElementById('aiAnalysisResult')?.classList.remove('hidden');
          document.getElementById('analysisConfidence').textContent = `置信度: ${Math.round(result.task.confidence * 100)}%`;
          
          let analysisHtml = `<div style="margin-top: 8px;">`;
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
          
          document.getElementById('analysisContent').innerHTML = analysisHtml;
          
          // 自动计算番茄钟
          this.updatePomodoroHint();
          
          this.showToast('AI分析完成');
        } else {
          this.showToast('分析失败，请重试', 'error');
        }
      }
    } catch (error) {
      console.error('AI分析失败:', error);
      this.showToast('分析失败，请重试', 'error');
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
      return;
    }
    
    // 排序：默认按截止时间，可切换按优先级
    const sortBy = this._taskSortBy || 'dueDate';
    const sortedTasks = tasks.sort((a, b) => {
      if (sortBy === 'priority') {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        // 优先级相同时按截止时间
        if (a.dueDate && b.dueDate) {
          return new Date(a.dueDate) - new Date(b.dueDate);
        }
        return 0;
      } else {
        // 默认：按截止时间排序（临近的在前）
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        if (aDate !== bDate) return aDate - bDate;
        // 截止时间相同时按优先级
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
    });
    
    container.innerHTML = sortedTasks.map(task => this.renderTaskItem(task)).join('');
    
    // 绑定排序切换按钮
    const sortToggle = document.getElementById('taskSortToggle');
    if (sortToggle) {
      sortToggle.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this._taskSortBy = btn.dataset.sort;
          sortToggle.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.renderTaskList();
        });
      });
    }
    
    container.querySelectorAll('.task-item').forEach(item => {
      const taskId = item.dataset.id;
      
      // hover 预览浮层
      item.addEventListener('mouseenter', (e) => {
        this._showTaskHoverPreview(item, e);
      });
      item.addEventListener('mouseleave', () => {
        this._hideTaskHoverPreview();
      });
      item.addEventListener('mousemove', (e) => {
        this._moveTaskHoverPreview(e);
      });
      
      item.querySelector('.task-checkbox').addEventListener('click', (e) => {
        e.stopPropagation();
        this.completeTask(taskId);
      });
      
      item.addEventListener('click', () => {
        const task = Store.getTasks().find(t => t.id === taskId);
        if (task) this.showTaskModal(task);
      });
      
      item.querySelector('.start-pomodoro').addEventListener('click', (e) => {
        e.stopPropagation();
        const task = Store.getTasks().find(t => t.id === taskId);
        if (task) {
          // 每次点击增加一个计划番茄数
          const plannedCount = Pomodoro.addPlannedSession(taskId, task.title);
          this.showToast(`已添加番茄钟（计划${plannedCount}个）`);
          
          // 如果番茄钟未运行，立即启动
          if (!Pomodoro.state.isRunning) {
            Pomodoro.start(taskId);
          }
        }
      });
      
      item.querySelector('.delete-task-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const task = Store.getTasks().find(t => t.id === taskId);
        if (task) {
          const confirmed = await this.showConfirmDialog('删除确认', `确定要删除任务"${task.title}"吗？`);
          if (confirmed) {
            Store.deleteTask(taskId);
            this.renderTaskList();
          }
        }
      });
    });
  },

  renderTaskItem(task) {
    const dueDate = task.dueDate ? new Date(task.dueDate) : null;
    const relativeTime = dueDate ? this.getRelativeTime(dueDate) : '无截止时间';
    const priorityBadge = `<span class="priority-badge ${task.priority}">${task.priority === 'high' ? '高' : task.priority === 'medium' ? '中' : '低'}</span>`;
    const draftBadge = task.isDraft ? `<span class="draft-badge">草稿</span>` : '';
    // 计算该任务已完成的番茄数
    const completedPomodoros = (task.pomodoroSessions || []).filter(s => s.type === 'work' && s.completed).length;
    const pomodoroCountHtml = completedPomodoros > 0 ? `<span class="pomodoro-count">🍅×${completedPomodoros}</span>` : '';
    
    // 构造 hover 预览内容
    const dueDateStr = dueDate ? dueDate.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '无截止时间';
    const priorityLabel = { high: '🔴 高', medium: '🟡 中', low: '🟢 低' }[task.priority] || '🟡 中';
    const descPreview = task.description ? task.description.substring(0, 200) + (task.description.length > 200 ? '...' : '') : '';
    const hoverContent = `${task.title}\n⏰ ${dueDateStr}\n🔥 优先级: ${priorityLabel}\n⏱ 预计: ${task.estimatedDuration || 60}分钟${descPreview ? '\n\n' + descPreview : ''}`;
    
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
      <div class="task-item${task.isDraft ? ' draft-item' : ''}" data-id="${task.id}" data-hover-content="${this.escapeHtml(hoverContent)}">
        <div class="task-checkbox"></div>
        <div class="task-info">
          <div class="title">${task.title} ${draftBadge}</div>
          <div class="meta">
            ${priorityBadge}
            <span>${relativeTime}</span>
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
    Store.completeTask(taskId);
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

  // 自定义输入弹窗（替代 prompt()，在 Electron contextIsolation 下 prompt 不可用）
  showInputDialog(title, message, defaultValue = '') {
    return new Promise((resolve) => {
      // 移除已有弹窗
      const existing = document.querySelector('.input-dialog-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.className = 'input-dialog-overlay';
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
        <div style="padding: 20px 24px 8px; font-size: 17px; font-weight: 600; color: var(--text-primary);">${title}</div>
        <div style="padding: 4px 24px 16px; font-size: 13px; color: var(--text-secondary);">${message}</div>
        <div style="padding: 0 24px 20px;">
          <input type="text" class="input-dialog-field" value="${defaultValue.replace(/"/g, '&quot;')}"
            style="width: 100%; padding: 10px 14px; border: 1.5px solid var(--border-color);
            border-radius: 10px; font-size: 14px; outline: none; font-family: inherit;
            color: var(--text-primary); background: var(--bg-input);
            transition: border-color 0.2s, box-shadow 0.2s;"
            placeholder="请输入..." />
        </div>
        <div style="display: flex; border-top: 0.5px solid var(--border-light);">
          <button class="input-dialog-cancel" style="flex:1; padding: 14px; border: none; background: transparent;
            font-size: 14px; font-weight: 500; color: var(--text-secondary); cursor: pointer;
            border-right: 0.5px solid var(--border-light); transition: background 0.15s;">取消</button>
          <button class="input-dialog-confirm" style="flex:1; padding: 14px; border: none; background: transparent;
            font-size: 14px; font-weight: 600; color: var(--primary-color); cursor: pointer;
            transition: background 0.15s;">确定</button>
        </div>
      `;

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const input = dialog.querySelector('.input-dialog-field');
      const cancelBtn = dialog.querySelector('.input-dialog-cancel');
      const confirmBtn = dialog.querySelector('.input-dialog-confirm');

      // 聚焦输入框
      setTimeout(() => { input.focus(); input.select(); }, 50);

      // 输入框聚焦样式
      input.addEventListener('focus', () => {
        input.style.borderColor = 'var(--primary-color)';
        input.style.boxShadow = '0 0 0 3px var(--input-focus-glow)';
        input.style.background = 'var(--bg-input)';
      });
      input.addEventListener('blur', () => {
        input.style.borderColor = 'var(--border-color)';
        input.style.boxShadow = 'none';
        input.style.background = 'var(--bg-input)';
      });

      const cleanup = () => {
        overlay.style.animation = 'fadeOut 0.15s ease';
        setTimeout(() => overlay.remove(), 150);
      };

      const onConfirm = () => {
        const val = input.value.trim();
        cleanup();
        resolve(val || null);
      };

      const onCancel = () => {
        cleanup();
        resolve(null);
      };

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onConfirm();
        if (e.key === 'Escape') onCancel();
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) onCancel();
      });

      // hover 样式
      cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = 'var(--bg-tertiary)'; });
      cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'transparent'; });
      confirmBtn.addEventListener('mouseenter', () => { confirmBtn.style.background = 'rgba(79,142,247,0.06)'; });
      confirmBtn.addEventListener('mouseleave', () => { confirmBtn.style.background = 'transparent'; });
    });
  },

  // 自定义确认弹窗（替代 confirm()）
  showConfirmDialog(title, message) {
    return new Promise((resolve) => {
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
        width: 340px; max-width: 90%; background: var(--bg-card);
        border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        overflow: hidden; animation: panelFadeIn 0.25s cubic-bezier(0.2,0.8,0.2,1);
      `;

      dialog.innerHTML = `
        <div style="padding: 20px 24px 8px; font-size: 17px; font-weight: 600; color: var(--text-primary);">${title}</div>
        <div style="padding: 4px 24px 20px; font-size: 13px; color: var(--text-secondary); line-height: 1.6;">${message}</div>
        <div style="display: flex; border-top: 0.5px solid var(--border-light);">
          <button class="confirm-dialog-cancel" style="flex:1; padding: 14px; border: none; background: transparent;
            font-size: 14px; font-weight: 500; color: var(--text-secondary); cursor: pointer;
            border-right: 0.5px solid var(--border-light); transition: background 0.15s;">取消</button>
          <button class="confirm-dialog-ok" style="flex:1; padding: 14px; border: none; background: transparent;
            font-size: 14px; font-weight: 600; color: var(--danger-color); cursor: pointer;
            transition: background 0.15s;">确定</button>
        </div>
      `;

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const cancelBtn = dialog.querySelector('.confirm-dialog-cancel');
      const okBtn = dialog.querySelector('.confirm-dialog-ok');

      const cleanup = () => {
        overlay.style.animation = 'fadeOut 0.15s ease';
        setTimeout(() => overlay.remove(), 150);
      };

      cancelBtn.addEventListener('click', () => { cleanup(); resolve(false); });
      okBtn.addEventListener('click', () => { cleanup(); resolve(true); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); resolve(false); } });
      document.addEventListener('keydown', function handler(e) {
        if (e.key === 'Escape') { cleanup(); resolve(false); document.removeEventListener('keydown', handler); }
        if (e.key === 'Enter') { cleanup(); resolve(true); document.removeEventListener('keydown', handler); }
      });

      cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = 'var(--bg-tertiary)'; });
      cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'transparent'; });
      okBtn.addEventListener('mouseenter', () => { okBtn.style.background = 'rgba(255,59,48,0.06)'; });
      okBtn.addEventListener('mouseleave', () => { okBtn.style.background = 'transparent'; });
    });
  },

  // === Agent 产物保存按钮绑定 ===
  _bindArtifactSaveButtons(container) {
    if (!container) return;
    container.querySelectorAll('.agent-save-artifact-btn').forEach(btn => {
      if (btn._artifactBound) return;
      btn._artifactBound = true;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pre = btn.previousElementSibling;
        if (!pre) return;
        const codeEl = pre.querySelector('code');
        if (!codeEl) return;
        const content = codeEl.textContent || '';
        const lang = btn.dataset.lang || '';
        // 推断文件名
        let fileName = '';
        const lowerLang = lang.toLowerCase();
        if (lowerLang === 'html' || lowerLang === 'htm') {
          // 尝试从 HTML 中提取 <title>
          const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
          fileName = titleMatch ? titleMatch[1].trim().replace(/[<>:"/\\|?*]/g, '_') + '.html' : 'page.html';
        } else if (lowerLang === 'json') {
          fileName = 'data.json';
        } else if (lowerLang === 'css') {
          fileName = 'style.css';
        } else if (lowerLang === 'xml') {
          fileName = 'data.xml';
        } else if (lowerLang === 'svg') {
          fileName = 'image.svg';
        } else if (lowerLang === 'md' || lowerLang === 'markdown') {
          fileName = 'document.md';
        } else {
          fileName = `artifact.${lowerLang || 'txt'}`;
        }
        if (window.electronAPI?.artifactsSave) {
          btn.textContent = '⏳ 保存中...';
          btn.disabled = true;
          try {
            const result = await window.electronAPI.artifactsSave({ content, fileName, source: 'ai-assistant' });
            if (result.success) {
              btn.textContent = '✅ 已保存';
              btn.disabled = true;
              this.showToast(`已保存到 Agent 产物: ${result.name}`, 'success');
            } else {
              btn.textContent = '💾 保存';
              btn.disabled = false;
              this.showToast('保存失败: ' + (result.error || ''), 'error');
            }
          } catch (err) {
            btn.textContent = '💾 保存';
            btn.disabled = false;
            this.showToast('保存出错: ' + err.message, 'error');
          }
        } else {
          this.showToast('产物保存功能不可用', 'error');
        }
      });
    });
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
    const openSpan = cardEl?.querySelector('.adp-file-open');
    const originalText = openSpan?.textContent || '';
    if (openSpan) openSpan.textContent = '⏳ 下载中...';

    try {
      const result = await window.electronAPI.artifactsDownloadAndSave({ url, fileName });
      if (result.success) {
        if (openSpan) openSpan.textContent = '✅ 已保存';
        this.showToast(`已保存到 Agent 产物: ${result.name}`, 'success');
      } else {
        if (openSpan) openSpan.textContent = originalText;
        this.showToast('下载失败: ' + (result.error || ''), 'error');
      }
    } catch (err) {
      if (openSpan) openSpan.textContent = originalText;
      this.showToast('下载出错: ' + err.message, 'error');
    }
  },

  // 保存容器内文件路径引用（文件在 ADP 容器中，本地无法直接下载）
  async _saveFilePathReference(filePath, fileName, cardEl) {
    if (!window.electronAPI?.artifactsSave) {
      this.showToast('产物保存功能不可用', 'error');
      return;
    }
    const openSpan = cardEl?.querySelector('.adp-file-open');
    const originalText = openSpan?.textContent || '';
    if (openSpan) openSpan.textContent = '⏳ 保存中...';

    try {
      // 保存为引用文件，包含文件路径和来源信息
      const refContent = `文件路径引用\n============\n文件名: ${fileName}\n容器路径: ${filePath}\n来源: ADP 智能体\n时间: ${new Date().toLocaleString('zh-CN')}\n\n注意: 此文件位于 ADP 智能体容器内，请在 ADP 对话中通过文件卡片下载。`;
      const result = await window.electronAPI.artifactsSave({
        content: refContent,
        fileName: `${fileName}.引用.txt`,
        source: 'adp-container-ref'
      });
      if (result.success) {
        if (openSpan) openSpan.textContent = '✅ 已保存';
        this.showToast(`已保存引用到 Agent 产物: ${result.name}`, 'success');
      } else {
        if (openSpan) openSpan.textContent = originalText;
        this.showToast('保存失败: ' + (result.error || ''), 'error');
      }
    } catch (err) {
      if (openSpan) openSpan.textContent = originalText;
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
    profile.user.name = document.getElementById('profileName').value.trim() || profile.user.name;
    profile.user.english_name = document.getElementById('profileEnglishName').value.trim() || profile.user.english_name;
    profile.user.role = document.getElementById('profileRole').value.trim() || profile.user.role;
    profile.user.industries = document.getElementById('profileIndustries').value.split(',').map(s => s.trim()).filter(Boolean);
    profile.preferences = profile.preferences || {};
    profile.preferences.priority_signals = document.getElementById('prioritySignals').value.split(',').map(s => s.trim()).filter(Boolean);
    profile.preferences.low_priority_signals = document.getElementById('lowPrioritySignals').value.split(',').map(s => s.trim()).filter(Boolean);
    await window.electronAPI.profile.update(profile);
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

  // === Prompt 文件管理 ===
  _currentPromptFile: null,

  async loadPromptFiles() {
    if (!window.electronAPI?.promptFiles?.list) {
      console.error('[PromptFiles] electronAPI.promptFiles.list not available');
      return;
    }
    const listEl = document.getElementById('promptFileList');
    if (!listEl) {
      console.error('[PromptFiles] promptFileList element not found');
      return;
    }

    try {
      const files = await window.electronAPI.promptFiles.list();
      console.log('[PromptFiles] Loaded', files?.length, 'files');
      if (!files || files.length === 0) {
        listEl.innerHTML = '<div class="empty-state">暂无 Prompt 模板文件</div>';
        return;
      }

      listEl.innerHTML = files.map(f => {
        const sizeStr = f.exists ? `${(f.size / 1024).toFixed(1)} KB` : '未创建';
        const modStr = f.modifiedAt ? `修改于 ${new Date(f.modifiedAt).toLocaleString('zh-CN')}` : '';
        return `
          <div class="prompt-file-card" data-filename="${this.escapeHtml(f.file)}">
            <div class="prompt-file-icon">${f.icon}</div>
            <div class="prompt-file-info">
              <div class="prompt-file-name">${this.escapeHtml(f.name)}</div>
              <div class="prompt-file-filename">${this.escapeHtml(f.file)}</div>
              <div class="prompt-file-desc">${this.escapeHtml(f.desc)}</div>
              <span class="prompt-file-used">用于：${this.escapeHtml(f.used_in)}</span>
              <div class="prompt-file-meta">${sizeStr}${modStr ? ' · ' + modStr : ''}</div>
            </div>
            <div class="prompt-file-actions">
              <button class="prompt-action-btn primary" data-action="edit-prompt" data-filename="${this.escapeHtml(f.file)}" title="在线编辑">✏️ 编辑</button>
              <button class="prompt-action-btn" data-action="view-vars" data-filename="${this.escapeHtml(f.file)}" title="查看变量映射">🔖 变量</button>
              <button class="prompt-action-btn" data-action="download-prompt" data-filename="${this.escapeHtml(f.file)}" title="下载文件">⬇️ 下载</button>
              <button class="prompt-action-btn" data-action="upload-prompt" data-filename="${this.escapeHtml(f.file)}" title="上传替换">⬆️ 上传</button>
              <button class="prompt-action-btn danger" data-action="reset-prompt" data-filename="${this.escapeHtml(f.file)}" title="恢复备份">🔄 恢复</button>
            </div>
          </div>
        `;
      }).join('');

      // 事件委托
      listEl.onclick = (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const filename = btn.dataset.filename;
        console.log('[PromptFiles] Action clicked:', action, filename);
        switch (action) {
          case 'edit-prompt': this.openPromptEditor(filename); break;
          case 'view-vars': this.loadPromptVariables(filename); break;
          case 'download-prompt': this.downloadPromptFile(filename); break;
          case 'upload-prompt': this.triggerPromptUpload(filename); break;
          case 'reset-prompt': this.resetPromptFile(filename); break;
        }
      };

      // 同时加载优化器历史
      this.loadOptimizerHistory();
    } catch (error) {
      listEl.innerHTML = `<div class="empty-state">加载失败：${this.escapeHtml(error.message)}</div>`;
    }
  },

  async openPromptEditor(filename) {
    if (!window.electronAPI?.promptFiles?.read) return;
    this._currentPromptFile = filename;

    const result = await window.electronAPI.promptFiles.read(filename);
    if (!result.success) {
      this.showToast('读取文件失败：' + result.error, 'error');
      return;
    }

    // 找到对应的 meta 信息
    const meta = await window.electronAPI.promptFiles.list();
    const fileMeta = meta.find(m => m.file === filename) || {};

    document.getElementById('promptEditorTitle').textContent = `${fileMeta.icon || '📝'} ${fileMeta.name || filename}`;
    document.getElementById('promptEditorInfo').innerHTML = `
      <strong>文件：</strong>${filename} · <strong>用途：</strong>${this.escapeHtml(fileMeta.desc || '')} · <strong>使用场景：</strong>${this.escapeHtml(fileMeta.used_in || '')}
    `;
    document.getElementById('promptFileContent').value = result.content;
    document.getElementById('promptEditorOverlay')?.classList.remove('hidden');
  },

  hidePromptEditor() {
    document.getElementById('promptEditorOverlay')?.classList.add('hidden');
    this._currentPromptFile = null;
  },

  async savePromptFile() {
    if (!this._currentPromptFile || !window.electronAPI?.promptFiles?.write) return;
    const content = document.getElementById('promptFileContent').value;

    const result = await window.electronAPI.promptFiles.write(this._currentPromptFile, content);
    if (result.success) {
      this.showToast('Prompt 已保存（已自动备份旧版本）');
      this.hidePromptEditor();
      this.loadPromptFiles();
    } else {
      this.showToast('保存失败：' + result.error, 'error');
    }
  },

  async downloadPromptFile(filename) {
    if (!window.electronAPI?.promptFiles?.download) return;
    const result = await window.electronAPI.promptFiles.download(filename);
    if (result.success) {
      // 创建下载链接
      const blob = new Blob([result.content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(`已下载 ${filename}`);
    } else {
      this.showToast('下载失败：' + result.error, 'error');
    }
  },

  triggerPromptUpload(filename) {
    this._currentPromptFile = filename;
    const input = document.getElementById('promptFileUploadInput');
    input.value = '';
    input.click();
  },

  async handlePromptFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !this._currentPromptFile) return;

    try {
      const content = await file.text();
      const result = await window.electronAPI.promptFiles.upload(this._currentPromptFile, content);
      if (result.success) {
        this.showToast(`已上传替换 ${this._currentPromptFile}（已自动备份）`);
        this.loadPromptFiles();
      } else {
        this.showToast('上传失败：' + result.error, 'error');
      }
    } catch (error) {
      this.showToast('读取文件失败：' + error.message, 'error');
    }
    this._currentPromptFile = null;
  },

  async resetPromptFile(filename) {
    // 弹出版本选择弹窗
    const overlay = document.getElementById('promptVersionOverlay');
    const listEl = document.getElementById('promptVersionList');
    const titleEl = document.getElementById('promptVersionTitle');
    if (!overlay) return;

    titleEl.textContent = `${filename} - 版本管理`;
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">加载中...</div>';
    overlay.classList.remove('hidden');

    // 加载备份列表
    const result = await window.electronAPI.promptFiles.listBackups(filename);
    if (!result.success) {
      listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-tertiary);">无备份记录</div>`;
      return;
    }

    let html = '';
    // 当前版本
    html += `
      <div class="prompt-version-item current">
        <div class="version-info">
          <span class="version-label">当前版本</span>
          <span class="version-detail">正在使用</span>
        </div>
        <div class="version-actions">
          <button class="btn small secondary" onclick="App.openPromptEditor('${filename}')">编辑</button>
        </div>
      </div>`;

    // 内置版本（初始化选项）
    html += `
      <div class="prompt-version-item builtin">
        <div class="version-info">
          <span class="version-label">出厂初始版本</span>
          <span class="version-detail">恢复到应用内置的初始 Prompt</span>
        </div>
        <div class="version-actions">
          <button class="btn small danger" onclick="App.resetPromptToBuiltin('${filename}')">恢复初始</button>
        </div>
      </div>`;

    // 备份版本列表
    if (result.backups && result.backups.length > 0) {
      html += '<div class="version-divider">历史备份版本</div>';
      for (const backup of result.backups) {
        const dateStr = backup.date ? new Date(backup.date).toLocaleString('zh-CN') : '未知时间';
        const sizeStr = backup.size ? `${(backup.size / 1024).toFixed(1)} KB` : '';
        html += `
          <div class="prompt-version-item backup">
            <div class="version-info">
              <span class="version-label">${dateStr}</span>
              <span class="version-detail">${sizeStr}</span>
            </div>
            <div class="version-actions">
              <button class="btn small" onclick="App.restorePromptBackup('${filename}', '${backup.filename}')">恢复此版本</button>
            </div>
          </div>`;
      }
    }

    listEl.innerHTML = html;
  },

  async restorePromptBackup(filename, backupFilename) {
    const confirmed = await this.showConfirmDialog('恢复确认', `确定要恢复到该备份版本吗？当前版本会自动备份。`);
    if (!confirmed) return;
    const result = await window.electronAPI.promptFiles.restoreBackup(filename, backupFilename);
    if (result.success) {
      this.showToast(`已恢复到备份版本`);
      this.hidePromptVersionOverlay();
      this.loadPromptFiles();
    } else {
      this.showToast('恢复失败：' + (result.error || ''), 'error');
    }
  },

  async resetPromptToBuiltin(filename) {
    const confirmed = await this.showConfirmDialog('初始化确认', `确定要恢复到出厂初始版本吗？当前版本会自动备份。`);
    if (!confirmed) return;
    const result = await window.electronAPI.promptFiles.resetToBuiltin(filename);
    if (result.success) {
      this.showToast(`已恢复到出厂初始版本`);
      this.hidePromptVersionOverlay();
      this.loadPromptFiles();
    } else {
      this.showToast('恢复失败：' + (result.error || ''), 'error');
    }
  },

  hidePromptVersionOverlay() {
    const overlay = document.getElementById('promptVersionOverlay');
    if (overlay) overlay.classList.add('hidden');
  },

  // === Prompt 变量预览 ===
  async loadPromptVariables(filename) {
    console.log('[PromptVars] loadPromptVariables called for:', filename);
    if (!window.electronAPI?.promptFiles?.getVariables) {
      console.error('[PromptVars] electronAPI.promptFiles.getVariables not available');
      return;
    }
    const section = document.getElementById('promptVarsSection');
    const listEl = document.getElementById('promptVarsList');
    if (!section || !listEl) {
      console.error('[PromptVars] DOM elements not found:', { section: !!section, listEl: !!listEl });
      return;
    }

    section.classList.remove('hidden');
    listEl.innerHTML = '<div style="color: var(--text-tertiary); font-size: 12px;">加载变量中...</div>';

    try {
      const result = await window.electronAPI.promptFiles.getVariables(filename);
      console.log('[PromptVars] IPC result:', result);
      if (!result.success) {
        listEl.innerHTML = `<div style="color: var(--danger-color); font-size: 12px;">加载失败：${this.escapeHtml(result.error)}</div>`;
        return;
      }

      const vars = result.variables || [];
      if (vars.length === 0) {
        listEl.innerHTML = '<div style="color: var(--text-tertiary); font-size: 12px;">此模板不包含变量</div>';
        return;
      }

      const profileVars = vars.filter(v => v.source === 'profile');
      const autoVars = vars.filter(v => v.source === 'auto');

      let html = '';
      if (profileVars.length > 0) {
        html += `<div style="grid-column: 1/-1; font-size:12px; font-weight:600; color: var(--text-primary); margin-top:4px;">
          👤 来自用户画像 <span style="font-weight:400; color: var(--text-tertiary);">（在「用户画像」标签页修改）</span>
        </div>`;
        profileVars.forEach(v => {
          const displayVal = Array.isArray(v.currentValue) ? v.currentValue.join(', ') || '(空)' :
            (v.currentValue === null ? '(未设置)' : String(v.currentValue));
          html += `
            <div class="prompt-var-item">
              <span class="prompt-var-name">${this.escapeHtml(v.name)}</span>
              <span class="prompt-var-label">${this.escapeHtml(v.label)}</span>
              <span class="var-badge profile">画像</span>
              <span class="prompt-var-value">${this.escapeHtml(displayVal)}</span>
            </div>`;
        });
      }
      if (autoVars.length > 0) {
        html += `<div style="grid-column: 1/-1; font-size:12px; font-weight:600; color: var(--text-primary); margin-top:8px;">
          ⚙️ 自动填充 <span style="font-weight:400; color: var(--text-tertiary);">（运行时从系统数据生成）</span>
        </div>`;
        autoVars.forEach(v => {
          const displayVal = Array.isArray(v.currentValue) ? v.currentValue.join(', ') || '(空)' :
            (v.currentValue === null ? '(运行时填充)' : String(v.currentValue));
          html += `
            <div class="prompt-var-item">
              <span class="prompt-var-name">${this.escapeHtml(v.name)}</span>
              <span class="prompt-var-label">${this.escapeHtml(v.label)}</span>
              <span class="var-badge auto">自动</span>
              <span class="prompt-var-value">${this.escapeHtml(displayVal)}</span>
            </div>`;
        });
      }
      listEl.innerHTML = html;
    } catch (error) {
      listEl.innerHTML = `<div style="color: var(--danger-color); font-size: 12px;">加载失败：${this.escapeHtml(error.message)}</div>`;
    }
  },

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
  },

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
    if (!window.SyncEngine?.isSyncing?.() === undefined) return; // SyncEngine 未加载
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

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

window.App = App;