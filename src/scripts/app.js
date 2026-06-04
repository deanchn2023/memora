const App = {
  pendingClipboardTask: null,
  editingTask: null,
  autoSaveTimer: null,
  countdownDisplay: null,
  remainingTime: 10,
  newNoteCount: 0, // 记事本角标：不在记事本页时新笔记的累加计数
  dbSyncTimer: null, // 数据库同步定时器
  _chatAttachments: [], // 聊天文件附件列表

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
    
    setTimeout(() => this.updateInitTest(''), 2000);
    console.log('[App] init() finished');
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
    
    document.getElementById('closeModal').addEventListener('click', () => this.hideTaskModal());
    document.getElementById('cancelTask').addEventListener('click', () => this.hideTaskModal());
    document.getElementById('saveTask').addEventListener('click', () => this.saveTask());
    
    // AI分析按钮
    document.getElementById('aiAnalyzeBtn').addEventListener('click', () => this.analyzeTaskInput());
    document.getElementById('aiSaveToNoteBtn').addEventListener('click', () => this.saveAIToNote());
    document.getElementById('aiExtractMemoryBtn').addEventListener('click', () => this.extractAIMemory());
    
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
    document.getElementById('resetPromptBtn').addEventListener('click', () => this.resetAIPrompt());
    document.getElementById('clearClipboardHashesBtn').addEventListener('click', () => this.clearClipboardHashes());
    document.getElementById('clearAPIKeyBtn').addEventListener('click', () => this.clearAPIKey());
    document.getElementById('refreshMemoriesBtn').addEventListener('click', () => this.loadMemories());
    document.getElementById('clearAllMemoriesBtn').addEventListener('click', () => this.clearAllMemories());
    document.getElementById('addManualMemoryBtn').addEventListener('click', () => this.addManualMemory());
    document.getElementById('memoryTypeFilter')?.addEventListener('change', () => this.loadMemories());
    document.getElementById('memoryBusinessFilter')?.addEventListener('change', () => this.loadMemories());
    document.getElementById('loadMoreMemoriesBtn')?.addEventListener('click', () => {
      this._memoryPage++;
      this.loadMemories(true);
    });
    
    // AI助手相关事件
    document.getElementById('openAIAssistantBtn').addEventListener('click', () => this.showAIAssistantView());
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
      
      // 自动触发 ADP 搜索
      if (rawText && window.knowledgeFollow) {
        setTimeout(() => {
          window.knowledgeFollow.handleADPSearch(intent);
        }, 300);
      }
    });
    
    // 快捷问题胶囊点击事件
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('quick-capsule')) {
        const question = e.target.dataset.question;
        if (question) {
          document.getElementById('aiChatInput').value = question;
          this.sendAIMessage();
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
            window.knowledgeFollow.handleADPSearch(intent);
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
    }
  },

  _loadApiConfig() {
    if (!window.electronAPI) return;
    window.electronAPI.getAPIConfig().then(config => {
      document.getElementById('apiBaseUrl').value = config.baseUrl || '';
      document.getElementById('apiModel').value = config.model || '';
      document.getElementById('apiDailyLimit').value = config.dailyLimit || 1000;
      document.getElementById('currentKeyType').textContent = `当前使用: ${config.isCustomKey ? '自定义密钥' : '内置密钥'}`;
      document.getElementById('currentDailyLimit').textContent = `每日限制: ${config.dailyLimit}次`;
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
      document.getElementById('adpConfigStatus').textContent = `当前状态: ${config.appKey ? '已配置通用Key' : '未配置'}${config.knowledgeAppKey ? ' | 知识推荐Key已配置' : ''}${config.searchAppKey ? ' | 搜索Key已配置' : ''}`;
    });
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
    document.getElementById('dayView').classList.add('hidden');
    document.getElementById('weekView').classList.add('hidden');
    document.getElementById('monthView').classList.add('hidden');
    document.getElementById('notebookView').classList.add('hidden');
    document.getElementById('knowledgeView').classList.add('hidden');
    
    // 显示AI助手视图
    document.getElementById('aiAssistantView').classList.remove('hidden');
    document.getElementById('aiChatInput').focus();
  },

  showKnowledgeView() {
    // 隐藏其他视图
    document.getElementById('dayView').classList.add('hidden');
    document.getElementById('weekView').classList.add('hidden');
    document.getElementById('monthView').classList.add('hidden');
    document.getElementById('notebookView').classList.add('hidden');
    document.getElementById('aiAssistantView').classList.add('hidden');
    
    // 显示知识跟随视图
    document.getElementById('knowledgeView').classList.remove('hidden');
    
    // 初始化知识跟随模块
    if (window.knowledgeFollow) {
      window.knowledgeFollow.init();
      window.knowledgeFollow.onShow();
    }
  },

  async sendAIMessage() {
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
      <div class="message-avatar">👤</div>
      <div class="message-content">
        <p>${this.escapeHtml(message || '发送了文件')}</p>
        ${attachmentsHtml}
      </div>
    `;
    chatMessages.appendChild(userMessage);
    
    input.value = '';
    this.clearChatAttachments();
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // 添加助手消息占位符（带加载动画）
    const assistantMessage = document.createElement('div');
    assistantMessage.className = 'message assistant';
    assistantMessage.innerHTML = `
      <div class="message-avatar">🤖</div>
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
      if (window.electronAPI?.agent?.invoke) {
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
        // 回退：ADP 消息
        // 将附件信息加入消息
        let fullMessage = message;
        if (attachmentData.length > 0) {
          const fileInfos = attachmentData.map(a => {
            if (a.textContent) return `[文件: ${a.name}]\n${a.textContent}`;
            return `[文件: ${a.name}, 类型: ${a.mimeType}, 大小: ${a.size}]`;
          });
          fullMessage = fileInfos.join('\n\n') + '\n\n' + message;
        }
        
        result = await window.electronAPI.sendADPMessage(fullMessage);
        if (result.success) {
          const messageContent = assistantMessage.querySelector('.message-content');
          messageContent.innerHTML = `<p>${this.escapeHtml(result.content)}</p>`;
          // 添加复制按钮
          const copyBtnHtml = '<button class="copy-btn" title="复制"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>';
          messageContent.insertAdjacentHTML('beforeend', copyBtnHtml);
          const copyBtn = messageContent.querySelector('.copy-btn');
          if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyAssistantMessage(copyBtn, messageContent));
          }
        } else {
          throw new Error(result.error || '发送失败');
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
    // 获取文本内容，排除复制按钮本身
    const clone = messageContent.cloneNode(true);
    const copyBtnInClone = clone.querySelector('.copy-btn');
    if (copyBtnInClone) copyBtnInClone.remove();
    const text = clone.innerText || clone.textContent || '';
    navigator.clipboard.writeText(text.trim()).then(() => {
      btn.classList.add('copied');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      }, 2000);
    }).catch(err => {
      console.error('[Copy] Failed:', err);
    });
  },

  // === 文件上传处理 ===
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
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <p>你好！我是你的AI助手。有什么我可以帮助你的吗？</p>
        </div>
      </div>
    `;
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
            <button class="memory-delete" data-memory-id="${memory.id}">删除</button>
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

    // 事件委托：删除按钮
    memoryList.onclick = (e) => {
      const delBtn = e.target.closest('.memory-delete');
      if (delBtn) this.deleteMemory(delBtn.dataset.memoryId);
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
    
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.addMemory({
          content: input,
          type: type,
          category: 'knowledge',
          business_category: business_category,
          confidence: 1.0,
          metadata: {
            source: 'manual',
            createdAt: new Date().toISOString()
          }
        });
        
        if (result.success) {
          this.showToast('记忆已添加');
          document.getElementById('manualMemoryInput').value = '';
          this.loadMemories();
        } else {
          this.showToast('添加记忆失败', 'error');
        }
      }
    } catch (error) {
      console.error('添加记忆失败:', error);
      this.showToast('添加记忆失败', 'error');
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
          // 不在记事本页时增加角标，否则刷新列表
          this.incrementNewNoteCount();
          
          this.showToast(`笔记已添加（${this.getNoteCategoryLabel(category)}）`);
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
          // 不在记事本页时增加角标，否则刷新列表
          this.incrementNewNoteCount();
          
          this.showToast(`已保存到笔记（${this.getNoteCategoryLabel(category)}）`);
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
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(17, 0, 0, 0);
    return date;
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
    document.getElementById('taskModal').classList.add('hidden');
    this.editingTask = null;
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
      dueDate: dueInput.value ? new Date(dueInput.value).toISOString() : null
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
          // 不在记事本页时增加角标，否则刷新列表
          this.incrementNewNoteCount();
          
          this.showToast(`已保存到记事本（${this.getNoteCategoryLabel(category)}）`);
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
    
    const sortedTasks = tasks.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate) - new Date(b.dueDate);
      }
      return 0;
    });
    
    container.innerHTML = sortedTasks.map(task => this.renderTaskItem(task)).join('');
    
    container.querySelectorAll('.task-item').forEach(item => {
      const taskId = item.dataset.id;
      
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
    
    return `
      <div class="task-item${task.isDraft ? ' draft-item' : ''}" data-id="${task.id}">
        <div class="task-checkbox"></div>
        <div class="task-info">
          <div class="title">${task.title} ${draftBadge}</div>
          <div class="meta">
            ${priorityBadge}
            <span>${relativeTime}</span>
            <span>${task.estimatedDuration}分钟</span>
            ${pomodoroCountHtml}
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
        width: 380px; max-width: 90%; background: white;
        border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        overflow: hidden; animation: panelFadeIn 0.25s cubic-bezier(0.2,0.8,0.2,1);
      `;

      dialog.innerHTML = `
        <div style="padding: 20px 24px 8px; font-size: 17px; font-weight: 600; color: #1a1a2e;">${title}</div>
        <div style="padding: 4px 24px 16px; font-size: 13px; color: #6b7280;">${message}</div>
        <div style="padding: 0 24px 20px;">
          <input type="text" class="input-dialog-field" value="${defaultValue.replace(/"/g, '&quot;')}"
            style="width: 100%; padding: 10px 14px; border: 1.5px solid rgba(0,0,0,0.1);
            border-radius: 10px; font-size: 14px; outline: none; font-family: inherit;
            transition: border-color 0.2s, box-shadow 0.2s; background: #f8f9fc;"
            placeholder="请输入..." />
        </div>
        <div style="display: flex; border-top: 0.5px solid rgba(0,0,0,0.06);">
          <button class="input-dialog-cancel" style="flex:1; padding: 14px; border: none; background: transparent;
            font-size: 14px; font-weight: 500; color: #6b7280; cursor: pointer;
            border-right: 0.5px solid rgba(0,0,0,0.06); transition: background 0.15s;">取消</button>
          <button class="input-dialog-confirm" style="flex:1; padding: 14px; border: none; background: transparent;
            font-size: 14px; font-weight: 600; color: #4F8EF7; cursor: pointer;
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
        input.style.borderColor = '#4F8EF7';
        input.style.boxShadow = '0 0 0 3px rgba(79,142,247,0.15)';
        input.style.background = 'white';
      });
      input.addEventListener('blur', () => {
        input.style.borderColor = 'rgba(0,0,0,0.1)';
        input.style.boxShadow = 'none';
        input.style.background = '#f8f9fc';
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
      cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = '#f5f5f7'; });
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
        width: 340px; max-width: 90%; background: white;
        border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        overflow: hidden; animation: panelFadeIn 0.25s cubic-bezier(0.2,0.8,0.2,1);
      `;

      dialog.innerHTML = `
        <div style="padding: 20px 24px 8px; font-size: 17px; font-weight: 600; color: #1a1a2e;">${title}</div>
        <div style="padding: 4px 24px 20px; font-size: 13px; color: #6b7280; line-height: 1.6;">${message}</div>
        <div style="display: flex; border-top: 0.5px solid rgba(0,0,0,0.06);">
          <button class="confirm-dialog-cancel" style="flex:1; padding: 14px; border: none; background: transparent;
            font-size: 14px; font-weight: 500; color: #6b7280; cursor: pointer;
            border-right: 0.5px solid rgba(0,0,0,0.06); transition: background 0.15s;">取消</button>
          <button class="confirm-dialog-ok" style="flex:1; padding: 14px; border: none; background: transparent;
            font-size: 14px; font-weight: 600; color: #FF3B30; cursor: pointer;
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

      cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = '#f5f5f7'; });
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
            if (r.success) this.showToast('已保存到笔记');
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
      else { resultsEl.innerHTML = `<p class="error-text">优化器运行失败：${this.escapeHtml(result.error || '')}</p><pre style="font-size:11px; max-height:200px; overflow:auto; background:#f5f5f7; padding:10px; border-radius:8px;">${this.escapeHtml(result.output || '')}</pre>`; }
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
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

window.App = App;