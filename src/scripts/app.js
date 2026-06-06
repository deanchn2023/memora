const App = {
  pendingClipboardTask: null,
  editingTask: null,
  autoSaveTimer: null,
  countdownDisplay: null,
  remainingTime: 10,
  newNoteCount: 0, // 记事本角标：不在记事本页时新笔记的累加计数
  dbSyncTimer: null, // 数据库同步定时器
  _chatAttachments: [], // 聊天文件附件列表
  _userAvatarSvg: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="uBg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F0E6FF"/><stop offset="1" stop-color="#E0F0FF"/></linearGradient></defs><circle cx="20" cy="20" r="20" fill="url(#uBg)"/><circle cx="20" cy="14.5" r="6.5" fill="#C4B5FD"/><ellipse cx="20" cy="30" rx="10.5" ry="8" fill="#C4B5FD"/><circle cx="17.5" cy="13.8" r="1" fill="#7C3AED"/><circle cx="22.5" cy="13.8" r="1" fill="#7C3AED"/><path d="M18.5 16.2 Q20 17.8 21.5 16.2" stroke="#7C3AED" stroke-width="0.9" fill="none" stroke-linecap="round"/><circle cx="15" cy="15" r="1.8" fill="#DDD6FE" opacity="0.7"/><circle cx="25" cy="15" r="1.8" fill="#DDD6FE" opacity="0.7"/><circle cx="12" cy="19" r="1.2" fill="#DDD6FE" opacity="0.5"/><circle cx="28" cy="19" r="1.2" fill="#DDD6FE" opacity="0.5"/></svg>`,
  _assistantAvatarSvg: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="aBg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4F8EF7"/><stop offset="1" stop-color="#6C63FF"/></linearGradient></defs><rect width="40" height="40" rx="14" fill="url(#aBg)"/><text x="20" y="26" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="20" font-weight="700" fill="white">M</text></svg>`,

  // ADP SSE 流式状态
  _adpStreaming: false,
  _adpCurrentText: '',
  _adpThinkingText: '',
  _adpStepMap: {},
  _adpToolStepCount: 0,
  _adpFileItems: [],
  _adpTimerStart: 0,
  _adpTimerInterval: null,
  _adpCurrentBubble: null,
  _adpRenderPending: false,
  _adpConfigSource: '',

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

    // 恢复视觉偏好（主题、字体大小、效果开关）
    this._restoreVisualPrefs();
    
    // v2.0: 监听认证状态变化
    try {
      if (window.electronAPI?.onAuthChanged) {
        window.electronAPI.onAuthChanged((data) => {
          console.log('[App] Auth state changed:', data.isLoggedIn ? 'logged in' : 'logged out');
          this._updateOrgUI(data);
          if (data.isLoggedIn) {
            this._updateConfigServerHints(true);
          } else {
            this._updateConfigServerHints(false);
          }
        });
      }
    } catch (e) {
      console.error('[App] Auth listener setup failed:', e);
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
    document.getElementById('addTaskBtn').addEventListener('click', () => this.showTaskModal());
    
    document.getElementById('createTaskBtn').addEventListener('click', () => this.createTaskFromClipboard());
    document.getElementById('editTaskBtn').addEventListener('click', () => this.editClipboardTask());
    document.getElementById('ignoreBtn').addEventListener('click', () => this.hideClipboardDetector());
    document.getElementById('saveToNoteBtn').addEventListener('click', () => this.saveClipboardToNote());
    document.getElementById('saveToMemoryBtn').addEventListener('click', () => this.saveClipboardToMemory());
    document.getElementById('saveAsQuestionBtn').addEventListener('click', () => this.saveClipboardAsQuestion());
    
    document.getElementById('closeModal').addEventListener('click', () => this.hideTaskModal());
    document.getElementById('cancelTask').addEventListener('click', () => this.hideTaskModal());
    document.getElementById('saveTask').addEventListener('click', () => this.saveTask());
    
    // AI分析按钮
    document.getElementById('aiAnalyzeBtn').addEventListener('click', () => this.analyzeTaskInput());
    document.getElementById('aiSaveToNoteBtn').addEventListener('click', () => this.saveAIToNote());
    document.getElementById('aiExtractMemoryBtn').addEventListener('click', () => this.extractAIMemory());
    document.getElementById('aiSaveAsQuestionBtn').addEventListener('click', () => this.saveAIAsQuestion());
    
    // 番茄钟选择器
    document.querySelectorAll('.pomodoro-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.pomodoro-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById('taskPomodoros').value = e.target.dataset.pomodoros;
        
        // 更新提示信息
        this.updatePomodoroHint();
      });
    });
    
    // 时长变化时更新番茄钟提示
    document.getElementById('taskDuration').addEventListener('input', () => {
      this.updatePomodoroHint();
    });
    
    // 全天任务选择
    document.getElementById('isAllDay').addEventListener('change', (e) => {
      if (e.target.checked) {
        // 全天任务自动分配8个番茄钟（约4小时专注时间）
        document.getElementById('taskPomodoros').value = 'auto';
        document.querySelectorAll('.pomodoro-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-pomodoros="auto"]').classList.add('active');
        document.getElementById('taskDuration').value = 480; // 8小时
        this.updatePomodoroHint();
      }
    });
    
    document.querySelector('.modal-overlay').addEventListener('click', () => this.hideTaskModal());
    
    document.addEventListener('showTaskModal', (e) => this.showTaskModal(e.detail));
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideTaskModal();
        this.hideClipboardDetector();
        this.hideSettingsModal();
        this.hidePromptEditor();
        this.hideOptimizerDetail();
      }
    });
    
    // 设置相关事件
    document.getElementById('openSettingsBtn').addEventListener('click', () => this.showSettingsModal());
    document.getElementById('closeSettingsBtn').addEventListener('click', () => this.hideSettingsModal());
    document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveSettings());

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
      const emailLabel = document.querySelector('label[for="loginEmail"]');
      const emailInput = document.getElementById('loginEmail');

      if (env === 'production') {
        if (hint) hint.textContent = '正式环境：ADPToolkit';
        if (emailLabel) emailLabel.textContent = '用户名';
        if (emailInput) emailInput.placeholder = '输入用户名';
      } else {
        if (hint) hint.textContent = '测试环境：config-server';
        if (emailLabel) emailLabel.textContent = '邮箱';
        if (emailInput) emailInput.placeholder = '输入邮箱';
      }
    });
    document.getElementById('resetPromptBtn').addEventListener('click', () => this.resetAIPrompt());
    document.getElementById('clearClipboardHashesBtn').addEventListener('click', () => this.clearClipboardHashes());
    document.getElementById('clearAPIKeyBtn').addEventListener('click', () => this.clearAPIKey());
    document.getElementById('refreshMemoriesBtn').addEventListener('click', () => this.loadMemories());
    document.getElementById('clearAllMemoriesBtn').addEventListener('click', () => this.clearAllMemories());
    document.getElementById('addManualMemoryBtn').addEventListener('click', () => this.addManualMemory());
    document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportAllData());
    document.getElementById('importDataBtn')?.addEventListener('click', () => this.importDataFile());
    document.getElementById('importConfirmBtn')?.addEventListener('click', () => this.confirmImportData());
    document.getElementById('importCancelBtn')?.addEventListener('click', () => this.cancelImportData());
    document.getElementById('aiOrganizeMemoryBtn')?.addEventListener('click', () => this.aiOrganizeAndAddMemory());
    document.getElementById('aiBatchOrganizeBtn')?.addEventListener('click', () => this.aiBatchOrganizeMemories());
    document.getElementById('memoryTypeFilter')?.addEventListener('change', () => this.loadMemories());
    document.getElementById('memoryBusinessFilter')?.addEventListener('change', () => this.loadMemories());
    document.getElementById('loadMoreMemoriesBtn')?.addEventListener('click', () => {
      this._memoryPage++;
      this.loadMemories(true);
    });
    
    // AI助手相关事件
    document.getElementById('openAIAssistantBtn').addEventListener('click', () => this.showAIAssistantView());

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
    document.getElementById('sendAIMessageBtn').addEventListener('click', () => this.sendAIMessage());
    document.getElementById('aiChatInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendAIMessage();
      }
    });
    document.getElementById('clearChatBtn').addEventListener('click', () => this.clearChat());
    
    // 文件上传
    document.getElementById('chatFileUploadBtn').addEventListener('click', () => {
      document.getElementById('chatFileInput').click();
    });
    document.getElementById('chatFileInput').addEventListener('change', (e) => this.handleChatFileSelect(e));

    // 输入框粘贴文件和图片支持
    document.getElementById('aiChatInput').addEventListener('paste', (e) => this.handleChatPaste(e));

    // 搜索知识按钮（剪贴板检测弹窗中）
    document.getElementById('searchKnowledgeBtn').addEventListener('click', () => {
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
      tab.addEventListener('click', (e) => this.switchSettingsTab(e.target.dataset.tab));
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
    document.getElementById('notebookSearchInput').addEventListener('input', () => this.searchNotes());
    
    // 加载自定义分类并渲染侧边栏
    this.loadCustomCategories().then(() => {
      this.renderCategoryList();
    });
    
    // 记事本列表事件委托（处理动态生成的按钮）
    document.getElementById('notebookList').addEventListener('click', (e) => {
      const noteItem = e.target.closest('.note-item');
      if (!noteItem) return;
      
      const noteId = noteItem.dataset.id;
      console.log('[App] Notebook item clicked, noteId:', noteId);
      

      // 如果点击的是分类标签，弹出分类修改
      const categorySpan = e.target.closest('.note-category-clickable');
      if (categorySpan) {
        e.stopPropagation();
        this.changeNoteCategory(noteId, categorySpan.dataset.category);
        return;
      }

      const button = e.target.closest('.note-btn');
      const previewContent = e.target.closest('.note-preview-content');
      
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
          case 'delete':
            this.deleteNote(noteId);
            break;
        }
      } 
      // 如果点击的是预览内容区域，复制内容
      else if (previewContent) {
        e.stopPropagation();
        this.copyNoteFromPreview(noteId);
      }
      else {
        // 点击笔记项展开/收起预览
        this.toggleNotePreview(noteId);
      }
    });
    
    // 双击预览内容区域进入编辑模式
    document.getElementById('notebookList').addEventListener('dblclick', (e) => {
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
    document.querySelectorAll('.settings-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
    document.querySelectorAll('.settings-panel').forEach(panel => panel.classList.add('hidden'));
    document.getElementById(`${tabName}Panel`)?.classList.remove('hidden');
    
    // 延迟加载：只在首次切换到标签时加载数据
    if (!this._settingsTabLoaded[tabName]) {
      this._settingsTabLoaded[tabName] = true;
      if (tabName === 'api') this._loadApiConfig();
      if (tabName === 'adp') this._loadAdpConfig();
      if (tabName === 'memory') this.loadMemories();
      if (tabName === 'profile') this.loadProfileEditor();
      if (tabName === 'prompt') this.loadPromptFiles();
      if (tabName === 'appearance') this._loadAppearanceSettings();
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
      
      // v2.0: 登录状态时 API 面板显示提示
      this._updateConfigServerHints(config.fromServer);
    });
  },

  _loadAdpConfig() {
    if (!window.electronAPI) return;
    window.electronAPI.getADPConfig().then(config => {
      document.getElementById('adpAppKey').value = config.appKey || '';
      document.getElementById('adpKnowledgeAppKey').value = config.knowledgeAppKey || '';
      document.getElementById('adpSearchAppKey').value = config.searchAppKey || '';
      document.getElementById('adpUrl').value = config.url || '';
      document.getElementById('adpAgentName').value = config.agentName || '';
      
      // 显示详细配置来源信息
      const src = config.configSource || {};
      const sourceLabel = { server: '🏢 组织配置', custom: '✏️ 自定义', default: '📦 内置默认' };
      const appKeySrc = sourceLabel[src.appKey] || '未知';
      const knowledgeSrc = sourceLabel[src.knowledgeAppKey] || '未知';
      const searchSrc = sourceLabel[src.searchAppKey] || '未知';
      document.getElementById('adpConfigStatus').textContent = `通用Key: ${appKeySrc} | 知识Key: ${knowledgeSrc} | 搜索Key: ${searchSrc}`;
      
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

      // 更新头部用户徽章
      this._updateHeaderUserBadge(true, state.user);
    } else {
      loginSection.classList.remove('hidden');
      loggedInSection.classList.add('hidden');

      // 更新头部用户徽章
      this._updateHeaderUserBadge(false);
    }
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
    const apiPanel = document.getElementById('apiPanel');
    const adpPanel = document.getElementById('adpPanel');
    
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
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const env = document.getElementById('loginEnv')?.value || 'beta';
    const rememberMe = document.getElementById('loginRememberMe')?.checked !== false;
    const errorEl = document.getElementById('loginError');
    const btn = document.getElementById('orgLoginBtn');

    if (!email || !password) {
      errorEl.textContent = '请输入账号和密码';
      errorEl.classList.remove('hidden');
      return;
    }

    errorEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = '登录中...';

    try {
      const result = await window.electronAPI.authLogin(email, password, env, rememberMe);

      if (result.success) {
        this._updateOrgUI({ isLoggedIn: true, user: result.user, env: result.env, forceLocalConfig: false });
        this._loadOrgConfigSummary();
        this._updateConfigServerHints(true);
        this._updateHeaderUserBadge(true, result.user);
        this._updateLoginProfileEnv(result.env);
        this.showToast('登录成功，已同步组织配置');

        // 系统通知
        if (window.electronAPI?.showNotification) {
          window.electronAPI.showNotification('忆境 Memora', `欢迎回来，${result.user?.name || result.user?.email || ''}！`);
        }

        // 刷新 API 和 ADP 配置显示
        this._settingsTabLoaded.api = false;
        this._settingsTabLoaded.adp = false;
      } else {
        errorEl.textContent = result.error || '登录失败';
        errorEl.classList.remove('hidden');
      }
    } catch (err) {
      errorEl.textContent = '网络错误，请检查连接';
      errorEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = '登 录';
    }
  },

  async handleOrgLogout() {
    if (!window.electronAPI) return;

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
      body.innerHTML = '<div class="notification-empty">暂无通知</div>';
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
              body.innerHTML = '<div class="notification-empty">暂无通知</div>';
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
    if (body) body.innerHTML = '<div class="notification-empty">暂无通知</div>';
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
    const existing = document.getElementById('updateModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'updateModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:420px;">
        <div class="modal-header">
          <h3>🚀 发现新版本</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
        </div>
        <div class="modal-body" style="padding:20px;">
          <div style="text-align:center;margin-bottom:16px;">
            <span style="font-size:48px;">🎉</span>
            <h2 style="margin:8px 0 4px;font-size:22px;">v${updateInfo.latest_version}</h2>
            <p style="color:var(--text-secondary);font-size:13px;">当前版本 v${updateInfo.current_version || ''}</p>
          </div>
          ${updateInfo.release_notes ? `
            <div style="background:var(--bg-secondary);border-radius:12px;padding:14px;margin-bottom:16px;">
              <h4 style="margin:0 0 8px;font-size:13px;color:var(--text-primary);">更新内容</h4>
              <div style="font-size:12px;color:var(--text-secondary);white-space:pre-line;line-height:1.6;">${updateInfo.release_notes}</div>
            </div>
          ` : ''}
          ${updateInfo.file_size ? `<p style="font-size:12px;color:#aeaeb2;text-align:center;">文件大小：${(updateInfo.file_size / 1024 / 1024).toFixed(1)} MB</p>` : ''}
        </div>
        <div class="modal-footer" style="display:flex;gap:10px;padding:0 20px 20px;">
          <button class="modal-btn secondary" onclick="this.closest('.modal-overlay').remove()" style="flex:1;">稍后提醒</button>
          ${updateInfo.download_url ? `<button class="modal-btn primary" style="flex:1;" onclick="App._downloadUpdate('${updateInfo.download_url}')">立即下载</button>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
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

  _downloadUpdate(downloadUrl) {
    // 通过 IPC 用外部浏览器打开下载链接
    const server = 'http://121.5.164.126:3450';
    const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : server + downloadUrl;
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(fullUrl);
    }
    // 关闭弹窗
    document.getElementById('updateModal')?.remove();
    this.showToast('正在浏览器中下载...');
  },

  showLoginModal() {
    const modal = document.getElementById('loginModal');
    modal.classList.remove('hidden');
    this._loadOrgConfig();
  },

  hideLoginModal() {
    document.getElementById('loginModal').classList.add('hidden');
  },

  showSettingsModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('hidden');
    
    // 只加载当前活跃标签页的数据（延迟加载其他标签）
    if (window.electronAPI) {
      const activeTab = document.querySelector('.settings-tab.active');
      const tabName = activeTab?.dataset.tab || 'api';
      this.switchSettingsTab(tabName);
    }
  },

  hideSettingsModal() {
    document.getElementById('settingsModal').classList.add('hidden');
  },

  showAIAssistantView() {
    // 隐藏其他视图
    document.getElementById('calendarView')?.classList.add('hidden');
    document.getElementById('notebookView').classList.add('hidden');
    document.getElementById('knowledgeView').classList.add('hidden');
    document.getElementById('documentsView')?.classList.add('hidden');
    
    // 显示AI助手视图
    document.getElementById('aiAssistantView').classList.remove('hidden');
    document.getElementById('aiChatInput').focus();

    // 功能卡片点击切换快捷问题
    this._initFeatureCards();
  },

  /** 功能卡片切换快捷问题 */
  _initFeatureCards() {
    const cards = document.querySelectorAll('.feature-card');
    cards.forEach(card => {
      if (card._boundClick) return; // 避免重复绑定
      card._boundClick = true;
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const category = card.dataset.category;
        this._switchQuickQuestions(category);
      });
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
    // 隐藏其他视图
    document.getElementById('calendarView')?.classList.add('hidden');
    document.getElementById('notebookView').classList.add('hidden');
    document.getElementById('aiAssistantView').classList.add('hidden');
    document.getElementById('documentsView')?.classList.add('hidden');
    
    // 显示知识跟随视图
    document.getElementById('knowledgeView').classList.remove('hidden');
    
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

    const chatMessages = document.getElementById('chatMessages');
    const attachments = [...this._chatAttachments]; // 复制附件列表
    
    // 添加用户消息
    const userMessage = document.createElement('div');
    userMessage.className = 'message user';
    
    // 附件 HTML
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
      </div>
    `;
    chatMessages.appendChild(userMessage);
    
    input.value = '';
    this.clearChatAttachments();
    chatMessages.scrollTop = chatMessages.scrollHeight;

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
      
      // 优先使用 Agent 系统（本地 AI），回退到 ADP
      // forceMode: 'adp' 强制走 ADP，'agent' 强制走本地 Agent
      if (forceMode !== 'adp' && window.electronAPI?.agent?.invoke) {
        result = await window.electronAPI.agent.invoke(message, undefined, attachmentData);
        
        if (result.success) {
          const messageContent = assistantMessage.querySelector('.message-content');
          const agentType = result.agentType;
          const agentLabels = { priority: '🎯 优先级规划', knowledge: '📚 知识梳理', memory: '🧠 记忆整理', report: '📊 日报生成', chat: '💬 智能对话' };
          
          let html = `<div class="agent-badge">${agentLabels[agentType] || '💬 对话'}</div>`;
          
          if (result.result && typeof result.result === 'object') {
            html += this.renderAgentResult(result.result, agentType);
          } else {
            html += `<p>${this.escapeHtml(result.result?.text || JSON.stringify(result.result))}</p>`;
          }
          
          // 反馈按钮
          if (result.traceId) {
            html += `<div class="agent-feedback" data-trace-id="${result.traceId}">
              <button class="feedback-btn feedback-accept" title="有用">👍</button>
              <button class="feedback-btn feedback-reject" title="没用">👎</button>
            </div>`;
          }
          
          // 添加复制按钮
          html += '<button class="copy-btn" title="复制"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>';

          // 添加时间戳
          const sendTime = assistantMessage.dataset.sendTime;
          const timeLabel = sendTime
            ? `${this._formatChatTime(new Date(sendTime))} → ${this._formatChatTime(new Date())}`
            : this._formatChatTime(new Date());
          html += `<span class="message-time assistant-time">${timeLabel}</span>`;

          messageContent.innerHTML = html;
          
          // 绑定复制按钮事件
          const copyBtn = messageContent.querySelector('.copy-btn');
          if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyAssistantMessage(copyBtn, messageContent));
          }
          
          // 绑定反馈按钮事件
          const feedbackDiv = messageContent.querySelector('.agent-feedback');
          if (feedbackDiv) {
            const traceId = feedbackDiv.dataset.traceId;
            feedbackDiv.querySelector('.feedback-accept')?.addEventListener('click', () => {
              window.electronAPI?.feedback?.accept(traceId, result.result);
              feedbackDiv.innerHTML = '<span class="feedback-done">✓ 感谢反馈</span>';
            });
            feedbackDiv.querySelector('.feedback-reject')?.addEventListener('click', () => {
              window.electronAPI?.feedback?.reject(traceId, '用户标记无用');
              feedbackDiv.innerHTML = '<span class="feedback-done">✓ 已记录</span>';
            });
          }
          
          // 绑定 Agent 操作按钮事件
          messageContent.querySelectorAll('.agent-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              const action = e.currentTarget.dataset.action;
              this.handleAgentAction(action, result.result, agentType);
            });
          });
          
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
        } else {
          throw new Error(result.error || 'Agent 调用失败');
        }
      } else {
        // ADP 流式消息 — 参考 ADP Agent SDK 渲染
        // 将附件信息加入消息
        let fullMessage = message;
        if (attachmentData.length > 0) {
          const fileInfos = attachmentData.map(a => {
            if (a.textContent) return `[文件: ${a.name}]\n${a.textContent}`;
            return `[文件: ${a.name}, 类型: ${a.mimeType}, 大小: ${a.size}]`;
          });
          fullMessage = fileInfos.join('\n\n') + '\n\n' + message;
        }
        
        // 替换占位符为进度指示器
        const messageContent = assistantMessage.querySelector('.message-content');
        messageContent.innerHTML = `
          <div class="adp-progress" id="adpProgress">
            <div class="adp-progress-header">
              <div class="adp-progress-spinner"></div>
              <span class="adp-progress-title">智能体处理中</span>
              <span class="adp-progress-timer" id="adpProgressTimer">0s</span>
            </div>
            <div class="adp-progress-steps" id="adpProgressSteps"></div>
          </div>`;

        // 启动流式请求
        result = await window.electronAPI.sendADPMessage(fullMessage);
        
        if (result.success && result.streaming) {
          // 流式模式：监听 SSE 事件
          this._adpStreaming = true;
          this._adpCurrentText = '';
          this._adpThinkingText = '';
          this._adpStepMap = {};
          this._adpToolStepCount = 0;
          this._adpFileItems = [];
          this._adpCurrentBubble = null;
          this._adpRenderPending = false;
          this._adpConfigSource = result.configSource || '';
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
      }
    } catch (error) {
      console.error('[AI] Error:', error);
      const messageContent = assistantMessage.querySelector('.message-content');
      messageContent.innerHTML = `<p class="error-text">抱歉，发生了错误：${this.escapeHtml(error.message)}</p>
        <p class="error-hint">请检查 API 配置或网络连接</p>`;
    }
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  // === 复制按钮 ===
  copyAssistantMessage(btn, messageContent) {
    // 获取文本内容，排除复制按钮、反馈按钮等非内容元素
    const clone = messageContent.cloneNode(true);
    // 移除不需要复制的元素
    clone.querySelectorAll('.copy-btn, .agent-feedback, .agent-badge, .adp-config-source, .adp-progress, .adp-thinking-section').forEach(el => el.remove());
    const text = clone.innerText || clone.textContent || '';
    navigator.clipboard.writeText(text.trim()).then(() => {
      btn.classList.add('copied');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      this.showToast('已复制到剪贴板', 'success');
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      }, 2000);
    }).catch(err => {
      console.error('[Copy] Failed:', err);
      this.showToast('复制失败', 'error');
    });
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

    // 错误
    if (event === 'error') {
      const errMsg = data?.Error?.Message || data?.error?.message || '未知错误';
      this._addErrorToADP(messageContent, errMsg);
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
          const toolName = msg.ExtraInfo?.ToolName || '工具';
          const icon = this._getADPToolIcon(toolName);
          const label = this._getADPToolLabel(toolName);
          this._addADPProgressStep(msgId, icon, label, 'active');
        } else if (msg.Type === 'reply' || msg.Name === 'reply') {
          this._startADPReply(messageContent);
        }
        break;
      }

      case 'message.processing': {
        const msg = data?.Message || {};
        if (msg.Type === 'tool_call' && msg.Contents?.[0]?.Text?.trim()) {
          const msgId = data?.MessageId || msg.MessageId || '';
          this._addADPStepDetail(msgId, msg.Contents[0].Text, 'text');
        }
        break;
      }

      case 'message.done': {
        const msg = data?.Message || {};
        const msgId = data?.MessageId || msg.MessageId || '';
        if (msg.Type === 'tool_call') {
          const toolName = msg.ExtraInfo?.ToolName || '工具';
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
                      <span class="adp-file-icon">${ic}</span><span class="adp-file-name">${this.escapeHtml(fn)}</span><span class="adp-file-open">↗ 下载</span></div>`;
                  }).join('');
                  this._addADPStepDetail(msgId, cards, 'file');
                }
              } catch (e) { this._addADPStepDetail(msgId, resultText, 'json'); }
            } else {
              this._addADPStepDetail(msgId, resultText, 'json');
            }
          }
        }
        break;
      }

      case 'content.added':
        if (!this._adpCurrentBubble) this._startADPReply(messageContent);
        break;

      case 'text.delta':
        if (data?.Text) {
          if (!this._adpCurrentBubble) this._startADPReply(messageContent);
          // 过滤混入的 JSON 内容
          const text = data.Text;
          if (!/^\{"content":\[/i.test(text)) {
            this._adpCurrentText += text;
            this._renderADPBubble();
          }
        }
        break;

      case 'text.replace':
        if (data?.Text) {
          this._adpCurrentText = data.Text;
          this._renderADPBubble();
        }
        break;

      case 'response.completed':
        if (data?.Response?.StatInfo) {
          const stat = data.Response.StatInfo;
          // 可选：显示 token 统计
        }
        break;

      case 'thought':
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

    // 折叠进度区域
    this._collapseADPProgress();

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
          if (url && url !== '#') {
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
    }

    // 如果有文件输出，添加文件卡片区域
    if (this._adpFileItems.length > 0) {
      const filesHtml = this._adpFileItems.map(f => {
        const fn = f.file_path?.split('/').pop() || '文件';
        const ext = fn.split('.').pop()?.toLowerCase();
        const iconMap = { html: '🌐', pdf: '📖', xlsx: '📊', csv: '📋', png: '🖼', jpg: '🖼' };
        const ic = iconMap[ext] || '📄';
        return `<div class="adp-file-card" data-url="${this.escapeHtml(f.url || '#')}" data-name="${this.escapeHtml(fn)}">
          <span class="adp-file-icon">${ic}</span><span class="adp-file-name">${this.escapeHtml(fn)}</span><span class="adp-file-open">↗ 下载</span></div>`;
      }).join('');
      const filesEl = document.createElement('div');
      filesEl.className = 'adp-files-section';
      filesEl.innerHTML = filesHtml;
      filesEl.querySelectorAll('.adp-file-card').forEach(card => {
        card.addEventListener('click', () => {
          const url = card.dataset.url;
          if (url && url !== '#') window.electronAPI?.openExternal(url);
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
    window.electronAPI?.removeADPListeners?.();
    if (this._adpStreamResolve) {
      this._adpStreamResolve();
      this._adpStreamResolve = null;
    }

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  _addErrorToADP(messageContent, errMsg) {
    const errEl = document.createElement('div');
    errEl.className = 'adp-error-text';
    errEl.textContent = `❌ ${errMsg}`;
    messageContent.appendChild(errEl);
  },

  // ---- 进度步骤 ----

  _addADPProgressStep(msgId, icon, text, status) {
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
    stepEl.innerHTML = `
      <div class="adp-step-row">
        <span class="adp-step-icon">${icon}</span>
        <span class="adp-step-text">${this.escapeHtml(text)}</span>
        <span class="adp-step-status">${status === 'active' ? '<span class="adp-step-loading"></span>' : status === 'done' ? '✓' : ''}</span>
        <span class="adp-step-expand" style="display:none">▶</span>
      </div>
      <div class="adp-step-detail"></div>`;
    stepsEl.appendChild(stepEl);
    if (msgId) this._adpStepMap[msgId] = { el: stepEl, detailEl: stepEl.querySelector('.adp-step-detail') };

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
          if (url && url !== '#') window.electronAPI?.openExternal(url);
        });
      });
    } else {
      detailEl.innerHTML = `<div class="adp-step-detail-text">${this.escapeHtml(content).replace(/\n/g, '<br>')}</div>`;
    }

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

    let html = this.escapeHtml(text);

    // 还原 Markdown 链接
    mdLinks.forEach((link, idx) => {
      const ph = `__MDLINK_${idx}__`, su = this.escapeHtml(link.url), sd = this.escapeHtml(link.display);
      html = html.replace(ph, link.isHtml
        ? `<div class="adp-file-card" data-url="${su}" data-name="${this.escapeHtml(link.fileName)}"><span class="adp-file-icon">🌐</span><span class="adp-file-name">${sd}</span><span class="adp-file-open">↗ 打开</span></div>`
        : `<a href="${su}" class="adp-link" onclick="event.preventDefault();window.electronAPI?.openExternal('${su}')">${sd}</a>`);
    });

    // 还原文件卡片
    fileCards.forEach((files, idx) => {
      const ph = `__FILE_CARD_${idx}__`;
      if (files && files.length > 0) {
        html = html.replace(ph, files.map(f => {
          const fn = f.file_path?.split('/').pop() || '文件';
          const ext = fn.split('.').pop()?.toLowerCase();
          const im = { html: '🌐', pdf: '📖', xlsx: '📊', csv: '📋', png: '🖼', jpg: '🖼' };
          return `<div class="adp-file-card" data-url="${this.escapeHtml(f.url || '#')}" data-name="${this.escapeHtml(fn)}"><span class="adp-file-icon">${im[ext] || '📄'}</span><span class="adp-file-name">${this.escapeHtml(fn)}</span><span class="adp-file-open">↗ 下载</span></div>`;
        }).join(''));
      } else html = html.replace(ph, '');
    });

    // 还原裸链接
    links.forEach((link, idx) => {
      const ph = `__LINK_${idx}__`;
      html = html.replace(ph, `<a href="${this.escapeHtml(link.url)}" class="adp-link" onclick="event.preventDefault();window.electronAPI?.openExternal('${this.escapeHtml(link.url)}')">${this.escapeHtml(link.display)}</a>`);
    });

    // Markdown 基础格式
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code.trim()}</code></pre>`);
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
      search: '搜索数据'
    };
    return labels[toolName] || `调用 ${toolName}`;
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
    const ext = filename.split('.').pop().toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    const textExts = ['txt', 'md', 'csv'];
    
    if (imageExts.includes(ext) || mimeType.startsWith('image/')) return 'image';
    if (textExts.includes(ext) || mimeType.startsWith('text/')) return 'text';
    if (ext === 'pdf') return 'pdf';
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
        <span class="attachment-name" title="${this.escapeHtml(att.name)}">${this.escapeHtml(att.name)}</span>
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
        } else if (att.type === 'text') {
          // 文本文件读取内容
          data.textContent = await att.file.text();
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
    const chatMessages = document.getElementById('chatMessages');
    
    // 清空附件
    this.clearChatAttachments();

    // 停止 ADP 流式
    if (this._adpStreaming) {
      this._adpStreaming = false;
      if (this._adpTimerInterval) { clearInterval(this._adpTimerInterval); this._adpTimerInterval = null; }
      window.electronAPI?.stopADPMessage?.();
      window.electronAPI?.removeADPListeners?.();
      if (this._adpStreamResolve) { this._adpStreamResolve(); this._adpStreamResolve = null; }
    }
    
    // 保留功能提示卡片和快捷问题胶囊，只清空对话消息
    const featureCards = chatMessages.querySelector('.feature-cards');
    const quickQuestions = chatMessages.querySelector('.quick-questions');
    
    chatMessages.innerHTML = '';
    
    if (featureCards) {
      chatMessages.appendChild(featureCards);
    }
    
    if (quickQuestions) {
      chatMessages.appendChild(quickQuestions);
    }
    
    chatMessages.innerHTML += `
      <div class="message assistant">
        <div class="message-avatar">${this._assistantAvatarSvg}</div>
        <div class="message-content">
          <p>你好！我是你的AI助手。有什么我可以帮助你的吗？</p>
          <span class="message-time assistant-time">${this._formatChatTime(new Date())}</span>
        </div>
      </div>
    `;
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
        apiKey: apiKey || null,
        baseUrl: baseUrl || null,
        model: model || null,
        dailyLimit: dailyLimit || null
      });
      
      // 保存ADP配置
      const adpAppKey = document.getElementById('adpAppKey').value;
      const adpKnowledgeAppKey = document.getElementById('adpKnowledgeAppKey').value;
      const adpSearchAppKey = document.getElementById('adpSearchAppKey').value;
      const adpUrl = document.getElementById('adpUrl').value;
      const adpAgentName = document.getElementById('adpAgentName').value;
      
      await window.electronAPI.setADPConfig({
        appKey: adpAppKey || null,
        knowledgeAppKey: adpKnowledgeAppKey || '',
        searchAppKey: adpSearchAppKey || '',
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
    }
    this.showToast('API配置已清空，将使用内置密钥');
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
        if (resultEl) resultEl.innerHTML += `<div style="margin-top:12px;padding:12px;background:rgba(52,199,89,0.1);border-radius:8px;color:var(--success-color);">✅ 数据${modeLabel}导入成功！建议重启应用以刷新所有数据。</div>`;
        confirmArea.innerHTML = '';
        this.showToast(`数据${modeLabel}导入成功，建议重启应用`);
        this._pendingImportData = null;
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
    document.querySelector('#memoryStats .stat-item:nth-child(1) .stat-value').textContent = stats.total || 0;
    document.querySelector('#memoryStats .stat-item:nth-child(2) .stat-value').textContent = stats.byType?.short || 0;
    document.querySelector('#memoryStats .stat-item:nth-child(3) .stat-value').textContent = stats.byType?.long || 0;
    document.querySelector('#memoryStats .stat-item:nth-child(4) .stat-value').textContent = stats.entityCount || 0;
    
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
      memoryList.innerHTML = '<div class="empty-state">暂无记忆记录</div>';
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
      noteList.innerHTML = result.notes.map(note => `
        <div class="note-item" data-id="${note.id}" data-category="${note.category}" draggable="true">
          <div class="note-drag-handle" title="拖拽到左侧分类可修改分类">⠿</div>
          <div class="note-body">
            <div class="note-header">
              <h3 class="note-title">${note.title}</h3>
              <span class="note-category note-category-clickable" data-id="${note.id}" data-category="${note.category}" title="点击修改分类">${this.getNoteCategoryLabel(note.category)}</span>
            </div>
            <p class="note-content">${note.content.substring(0, 200)}${note.content.length > 200 ? '...' : ''}</p>
            <div class="note-preview hidden" id="note-preview-${note.id}">
              <div class="note-preview-content" contenteditable="false" data-note-id="${note.id}">${note.content}</div>
              <div class="note-preview-hint">点击复制 | 双击编辑</div>
            </div>
            <div class="note-footer">
              <span class="note-date">${new Date(note.createdAt).toLocaleString()}</span>
              ${note.analyzed ? '<span class="note-analyzed">已分析</span>' : ''}
              ${this.getAnalysisStatusTag(note)}
              <div class="note-actions">
                <button class="note-btn note-btn-primary" data-action="convert" title="转为待办任务">✅</button>
                <button class="note-btn note-btn-secondary" data-action="extract" title="提炼记忆">🧠</button>
                <button class="note-btn note-btn-danger" data-action="delete" title="删除笔记">🗑️</button>
              </div>
            </div>
          </div>
        </div>
      `).join('');
      this.bindNoteDragEvents();
    } else {
      noteList.innerHTML = '<div class="empty-state">暂无笔记</div>';
    }
  },
  
  // 切换笔记预览展开/收起
  toggleNotePreview(noteId) {
    const preview = document.getElementById(`note-preview-${noteId}`);
    if (preview) {
      preview.classList.toggle('hidden');
    }
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
    const defaultLabels = {
      meeting: '会议记录',
      feedback: '问题反馈',
      task: '待办任务',
      idea: '想法创意',      general: '其他'
    };
    return defaultLabels[category] || category;
  },

  // 获取所有分类列表（合并默认 + 自定义）
  getAllCategories() {
    const defaults = [
      { key: 'meeting', label: '会议记录' },
      { key: 'feedback', label: '问题反馈' },
      { key: 'task', label: '待办任务' },
      { key: 'idea', label: '想法创意' },
      { key: 'general', label: '其他' }
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

    const allCategories = this.getAllCategories();
    const activeItem = document.querySelector('.category-item.active');
    const activeCategory = activeItem ? activeItem.dataset.category : 'all';

    let html = `<button class="category-item ${activeCategory === 'all' ? 'active' : ''}" data-category="all">全部</button>`;
    allCategories.forEach(cat => {
      html += `
        <div class="category-item-wrapper">
          <button class="category-item ${activeCategory === cat.key ? 'active' : ''}" data-category="${cat.key}">${cat.label}</button>
          <button class="category-edit" data-category="${cat.key}" title="重命名">✏️</button>
          <button class="category-delete" data-category="${cat.key}" title="删除所有${cat.label}笔记">🗑️</button>
        </div>`;
    });
    html += `<button class="category-add-btn" title="新增分类">＋ 新增分类</button>`;
    categoryListEl.innerHTML = html;

    // 重新绑定事件
    this.bindCategoryEvents();
  },

  // 绑定侧边栏分类事件（含新增、编辑、删除、拖放）
  bindCategoryEvents() {
    // 分类点击
    document.querySelectorAll('.category-item').forEach(item => {
      item.addEventListener('click', (e) => {
        document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
        e.target.classList.add('active');
        this.loadNotes(e.target.dataset.category);
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
    const content = prompt('请输入笔记内容：');
    if (!content || !content.trim()) return;
    
    try {
      if (window.electronAPI) {
        // 自动分类
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
            this.showToast(`笔记已添加（${this.getNoteCategoryLabel(category)}）`);
          }
        }
      }
    } catch (error) {
      console.error('添加笔记失败:', error);
      this.showToast('添加笔记失败');
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
        // 清除所有分类高亮
        document.querySelectorAll('.category-item').forEach(c => {
          c.classList.remove('drop-target', 'drop-hover');
        });
      });
    });
  },

  // 绑定侧边栏分类为拖放目标
  bindCategoryDropTargets() {
    const categoryItems = document.querySelectorAll('.category-item');
    categoryItems.forEach(item => {
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });

      item.addEventListener('dragenter', (e) => {
        e.preventDefault();
        const targetCategory = item.dataset.category;
        // 只高亮非当前分类（"全部"分类不可拖入）
        if (targetCategory !== 'all' && targetCategory !== this._dragNoteCategory) {
          item.classList.add('drop-hover');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drop-hover');
      });

      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        item.classList.remove('drop-hover');

        const noteId = this._dragNoteId;
        const targetCategory = item.dataset.category;
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
        navigator.clipboard.writeText(result.note.content);
        this.showToast('笔记内容已复制到剪贴板');
      }
    }
  },
  
  async copyNoteFromPreview(noteId) {
    if (window.electronAPI) {
      const result = await window.electronAPI.notebookGetNote(noteId);
      if (result.note) {
        navigator.clipboard.writeText(result.note.content);
        this.showToast('已复制到剪贴板');
      }
    }
  },
  
  enterEditMode(noteId) {
    const previewContent = document.querySelector(`.note-preview-content[data-note-id="${noteId}"]`);
    if (previewContent) {
      previewContent.contentEditable = true;
      previewContent.focus();
      previewContent.classList.add('editing');
      
      // 监听编辑完成（失去焦点或按Ctrl+Enter）
      const finishEdit = () => {
        previewContent.contentEditable = false;
        previewContent.classList.remove('editing');
        previewContent.removeEventListener('blur', finishEdit);
        previewContent.removeEventListener('keydown', handleKeydown);
        
        const newContent = previewContent.textContent;
        this.updateNoteContent(noteId, newContent);
      };
      
      const handleKeydown = (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          finishEdit();
        }
      };
      
      previewContent.addEventListener('blur', finishEdit);
      previewContent.addEventListener('keydown', handleKeydown);
    }
  },
  
  async updateNoteContent(noteId, newContent) {
    if (window.electronAPI) {
      try {
        await window.electronAPI.notebookUpdateNote(noteId, { 
          content: newContent, 
          title: this.extractNoteTitle(newContent) 
        });
        this.showToast('笔记已更新');
      } catch (error) {
        console.error('更新笔记失败:', error);
        this.showToast('更新笔记失败', 'error');
      }
    }
  },
  
  async editNote(id) {
    if (window.electronAPI) {
      const result = await window.electronAPI.notebookGetNote(id);
      if (result.note) {
        const newContent = prompt('编辑笔记内容:', result.note.content);
        if (newContent !== null) {
          await window.electronAPI.notebookUpdateNote(id, { content: newContent, title: this.extractNoteTitle(newContent) });
          this.loadNotes();
          this.showToast('笔记已更新');
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
      noteList.innerHTML = result.notes.map(note => `
        <div class="note-item" data-id="${note.id}" data-category="${note.category}" draggable="true">
          <div class="note-drag-handle" title="拖拽到左侧分类可修改分类">⠿</div>
          <div class="note-body">
            <div class="note-header">
              <h3 class="note-title">${note.title}</h3>
              <span class="note-category note-category-clickable" data-id="${note.id}" data-category="${note.category}" title="点击修改分类">${this.getNoteCategoryLabel(note.category)}</span>
            </div>
            <p class="note-content">${note.content.substring(0, 200)}${note.content.length > 200 ? '...' : ''}</p>
            <div class="note-preview hidden" id="note-preview-${note.id}">
              <div class="note-preview-content" contenteditable="false" data-note-id="${note.id}">${note.content}</div>
              <div class="note-preview-hint">点击复制 | 双击编辑</div>
            </div>
            <div class="note-footer">
              <span class="note-date">${new Date(note.createdAt).toLocaleString()}</span>
              ${note.analyzed ? '<span class="note-analyzed">已分析</span>' : ''}
              ${this.getAnalysisStatusTag(note)}
              <div class="note-actions">
                <button class="note-btn note-btn-primary" data-action="convert" title="转为待办任务">✅</button>
                <button class="note-btn note-btn-secondary" data-action="extract" title="提炼记忆">🧠</button>
                <button class="note-btn note-btn-danger" data-action="delete" title="删除笔记">🗑️</button>
              </div>
            </div>
          </div>
        </div>
      `).join('');
      this.bindNoteDragEvents();
    } else {
      noteList.innerHTML = '<div class="empty-state">未找到匹配的笔记</div>';
    }
  },

  setupClipboardListener() {
    if (window.electronAPI) {
      window.electronAPI.onClipboardTaskDetected((data) => {
        this.handleClipboardTask(data);
      });
      
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
    document.getElementById('clipboardDetector').classList.remove('hidden');
  },

  hideClipboardDetector() {
    document.getElementById('clipboardDetector').classList.add('hidden');
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
      // 渲染已关联人物
      this._renderTaskLinkedPersons(task.linkedPersons || []);
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
      // 渲染 AI 识别到的人物或空
      this._renderTaskLinkedPersons(task?.linkedPersons || []);
    }
    
    modal.classList.remove('hidden');
    titleInput.focus();
  },

  hideTaskModal() {
    document.getElementById('taskModal').classList.add('hidden');
    this.editingTask = null;
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

  // 获取当前任务关联的人物
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
      linkedPersons: this._getTaskLinkedPersons()
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
    const input = document.getElementById('aiTaskInput').value.trim();
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
          document.getElementById('aiAnalysisResult').classList.remove('hidden');
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
    const input = document.getElementById('aiTaskInput').value.trim();
    if (!input) {
      this.showToast('请输入内容', 'error');
      return;
    }
    
    try {
      if (window.electronAPI) {
        const category = this.autoClassifyNote(input);
        
        const result = await window.electronAPI.notebookAddNote({
          content: input,
          category: category
        });
        
        if (result.success) {
          if (result.duplicate) {
            this.showToast('今天已有相同内容，已跳过', 'info');
          } else {
            this.incrementNewNoteCount();
            this.showToast(`已保存到记事本（${this.getNoteCategoryLabel(category)}）`);
          }
          document.getElementById('aiTaskInput').value = '';
        }
      }
    } catch (error) {
      console.error('保存到记事本失败:', error);
      this.showToast('保存到记事本失败', 'error');
    }
  },
  
  async extractAIMemory() {
    const input = document.getElementById('aiTaskInput').value.trim();
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
          document.getElementById('aiTaskInput').value = '';
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
    const input = document.getElementById('aiTaskInput').value.trim();
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
          document.getElementById('aiTaskInput').value = '';
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
          <p>暂无待办事项</p>
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
        if (result) navigator.clipboard.writeText(JSON.stringify(result, null, 2)).then(() => this.showToast('已复制到剪贴板'));
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
    document.getElementById('promptEditorOverlay').classList.remove('hidden');
  },

  hidePromptEditor() {
    document.getElementById('promptEditorOverlay').classList.add('hidden');
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

      document.getElementById('optimizerDetailOverlay').classList.remove('hidden');
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
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

window.App = App;