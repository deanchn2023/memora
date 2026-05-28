const App = {
  pendingClipboardTask: null,
  editingTask: null,
  autoSaveTimer: null,
  countdownDisplay: null,
  remainingTime: 10,

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
    
    // AI助手相关事件
    document.getElementById('openAIAssistantBtn').addEventListener('click', () => this.showAIAssistantView());
    document.getElementById('sendAIMessageBtn').addEventListener('click', () => this.sendAIMessage());
    document.getElementById('aiChatInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendAIMessage();
      }
    });
    document.getElementById('clearChatBtn').addEventListener('click', () => this.clearChat());
    
    // 快捷问题胶囊点击事件
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('quick-capsule')) {
        const question = e.target.dataset.question;
        if (question) {
          document.getElementById('aiChatInput').value = question;
          this.sendAIMessage();
        }
      }
    });
    
    // 设置标签页切换
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', (e) => this.switchSettingsTab(e.target.dataset.tab));
    });
    
    // 记事本相关事件
    document.getElementById('notebookSearchInput').addEventListener('input', () => this.searchNotes());
    document.querySelectorAll('.category-item').forEach(item => {
      item.addEventListener('click', (e) => {
        document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
        e.target.classList.add('active');
        this.loadNotes(e.target.dataset.category);
      });
    });
    
    // 类别删除按钮事件
    document.querySelectorAll('.category-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const category = e.target.dataset.category;
        this.deleteNotesByCategory(category);
      });
    });
    
    // 记事本列表事件委托（处理动态生成的按钮）
    document.getElementById('notebookList').addEventListener('click', (e) => {
      const noteItem = e.target.closest('.note-item');
      if (!noteItem) return;
      
      const noteId = noteItem.dataset.id;
      console.log('[App] Notebook item clicked, noteId:', noteId);
      
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

  switchSettingsTab(tabName) {
    // 切换标签状态
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    // 切换面板显示
    document.querySelectorAll('.settings-panel').forEach(panel => {
      panel.classList.add('hidden');
    });
    document.getElementById(`${tabName}Panel`).classList.remove('hidden');
    
    // 如果切换到记忆面板，加载记忆列表
    if (tabName === 'memory') {
      this.loadMemories();
    }
  },

  showSettingsModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('hidden');
    
    // 加载当前设置
    if (window.electronAPI) {
      // 加载API配置
      window.electronAPI.getAPIConfig().then(config => {
        document.getElementById('apiBaseUrl').value = config.baseUrl || '';
        document.getElementById('apiModel').value = config.model || '';
        document.getElementById('apiDailyLimit').value = config.dailyLimit || 1000;
        document.getElementById('currentKeyType').textContent = `当前使用: ${config.isCustomKey ? '自定义密钥' : '内置密钥'}`;
        document.getElementById('currentDailyLimit').textContent = `每日限制: ${config.dailyLimit}次`;
      });
      
      // 加载ADP配置
      window.electronAPI.getADPConfig().then(config => {
        document.getElementById('adpAppKey').value = config.appKey || '';
        document.getElementById('adpUrl').value = config.url || '';
        document.getElementById('adpAgentName').value = config.agentName || '';
        document.getElementById('adpConfigStatus').textContent = `当前状态: ${config.appKey ? '已配置' : '未配置'}`;
      });
      
      // 加载Prompt配置
      window.electronAPI.getAIPrompt().then(prompt => {
        document.getElementById('aiPromptEditor').value = prompt;
      });
      
      // 加载记忆提取Prompt配置
      window.electronAPI.getMemoryPrompt().then(prompt => {
        document.getElementById('memoryPromptEditor').value = prompt;
      });
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
    
    // 显示AI助手视图
    document.getElementById('aiAssistantView').classList.remove('hidden');
    document.getElementById('aiChatInput').focus();
  },

  async sendAIMessage() {
    const input = document.getElementById('aiChatInput');
    const message = input.value.trim();
    if (!message) return;

    const chatMessages = document.getElementById('chatMessages');
    
    // 添加用户消息
    const userMessage = document.createElement('div');
    userMessage.className = 'message user';
    userMessage.innerHTML = `
      <div class="message-avatar">👤</div>
      <div class="message-content">
        <p>${this.escapeHtml(message)}</p>
      </div>
    `;
    chatMessages.appendChild(userMessage);
    
    input.value = '';
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // 添加助手消息占位符
    const assistantMessage = document.createElement('div');
    assistantMessage.className = 'message assistant';
    assistantMessage.innerHTML = `
      <div class="message-avatar">🤖</div>
      <div class="message-content">
        <p>正在思考...</p>
      </div>
    `;
    chatMessages.appendChild(assistantMessage);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      // 通过主进程发送ADP消息（避免CORS限制）
      const result = await window.electronAPI.sendADPMessage(message);
      console.log('[ADP] Result:', result);
      
      if (result.success) {
        const messageContent = assistantMessage.querySelector('.message-content');
        messageContent.innerHTML = `<p>${this.escapeHtml(result.content)}</p>`;
        chatMessages.scrollTop = chatMessages.scrollHeight;
      } else {
        throw new Error(result.error || '发送失败');
      }
    } catch (error) {
      console.error('[ADP] API error:', error);
      const messageContent = assistantMessage.querySelector('.message-content');
      messageContent.innerHTML = `<p>抱歉，发生了错误：${this.escapeHtml(error.message)}</p>`;
    }
  },

  clearChat() {
    const chatMessages = document.getElementById('chatMessages');
    
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
      
      // 保存Prompt
      const prompt = document.getElementById('aiPromptEditor').value;
      await window.electronAPI.setAIPrompt(prompt);
      
      // 保存记忆提取Prompt
      const memoryPrompt = document.getElementById('memoryPromptEditor').value;
      await window.electronAPI.setMemoryPrompt(memoryPrompt);
      
      // 保存ADP配置
      const adpAppKey = document.getElementById('adpAppKey').value;
      const adpUrl = document.getElementById('adpUrl').value;
      const adpAgentName = document.getElementById('adpAgentName').value;
      
      await window.electronAPI.setADPConfig({
        appKey: adpAppKey || null,
        url: adpUrl || null,
        agentName: adpAgentName || null
      });
    }
    
    this.hideSettingsModal();
    this.showToast('设置已保存');
  },

  async resetAIPrompt() {
    if (window.electronAPI) {
      const result = await window.electronAPI.resetAIPrompt();
      document.getElementById('aiPromptEditor').value = result.prompt;
    }
    this.showToast('Prompt已重置为默认');
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

  async loadMemories() {
    if (!window.electronAPI) return;
    
    // 加载统计信息
    const stats = await window.electronAPI.getMemoryStats();
    document.querySelector('#memoryStats .stat-item:nth-child(1) .stat-value').textContent = stats.total || 0;
    document.querySelector('#memoryStats .stat-item:nth-child(2) .stat-value').textContent = stats.byType?.short || 0;
    document.querySelector('#memoryStats .stat-item:nth-child(3) .stat-value').textContent = stats.byType?.long || 0;
    document.querySelector('#memoryStats .stat-item:nth-child(4) .stat-value').textContent = stats.entityCount || 0;
    
    // 加载记忆列表
    const result = await window.electronAPI.getMemories({ limit: 50 });
    const memoryList = document.getElementById('memoryList');
    
    if (result.memories && result.memories.length > 0) {
      memoryList.innerHTML = result.memories.map(memory => {
        const confidence = memory.confidence !== undefined ? Math.round(memory.confidence * 100) : 0;
        const isTask = memory.metadata?.isTask || memory.category === 'task';
        const taskTitle = memory.metadata?.taskTitle;
        const reason = memory.metadata?.reason || memory.metadata?.preClassification?.reason;
        
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
              <div class="memory-confidence">
                <span class="confidence-label">信心值:</span>
                <span class="confidence-value" style="color: ${this.getConfidenceColor(memory.confidence)}">${confidence}%</span>
              </div>
              <span class="memory-date">${new Date(memory.createdAt).toLocaleString()}</span>
            </div>
            <button class="memory-delete" onclick="App.deleteMemory('${memory.id}')">删除</button>
          </div>
        `;
      }).join('');
    } else {
      memoryList.innerHTML = '<div class="empty-state">暂无记忆记录</div>';
    }
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
    if (confirm('确定要清空所有记忆吗？此操作不可撤销！')) {
      if (window.electronAPI) {
        await window.electronAPI.clearAllMemories();
        this.loadMemories();
        this.showToast('所有记忆已清空');
      }
    }
  },
  
  async addManualMemory() {
    const input = document.getElementById('manualMemoryInput').value.trim();
    if (!input) {
      this.showToast('请输入记忆内容', 'error');
      return;
    }
    
    const type = document.getElementById('manualMemoryType').value;
    
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.addMemory({
          content: input,
          type: type,
          category: 'knowledge',
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
    
    // 更新记事本标签徽章
    this.updateNotebookBadge(stats.total || 0);
    
    // 加载笔记列表
    const result = await window.electronAPI.notebookGetNotes(category);
    const noteList = document.getElementById('notebookList');
    
    if (result.notes && result.notes.length > 0) {
      noteList.innerHTML = result.notes.map(note => `
        <div class="note-item" data-id="${note.id}">
          <div class="note-header">
            <h3 class="note-title">${note.title}</h3>
            <span class="note-category">${this.getNoteCategoryLabel(note.category)}</span>
          </div>
          <p class="note-content">${note.content.substring(0, 200)}${note.content.length > 200 ? '...' : ''}</p>
          <div class="note-preview hidden" id="note-preview-${note.id}">
            <div class="note-preview-content" contenteditable="false" data-note-id="${note.id}">${note.content}</div>
            <div class="note-preview-hint">点击复制 | 双击编辑</div>
          </div>
          <div class="note-footer">
            <span class="note-date">${new Date(note.createdAt).toLocaleString()}</span>
            ${note.analyzed ? '<span class="note-analyzed">已分析</span>' : ''}
            <div class="note-actions">
              <button class="note-btn note-btn-primary" data-action="convert" title="转为待办任务">✅</button>
              <button class="note-btn note-btn-secondary" data-action="extract" title="提炼记忆">🧠</button>
              <button class="note-btn note-btn-danger" data-action="delete" title="删除笔记">🗑️</button>
            </div>
          </div>
        </div>
      `).join('');
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

  getNoteCategoryLabel(category) {
    const labels = {
      meeting: '会议记录',
      feedback: '问题反馈',
      task: '待办任务',
      idea: '想法创意',
      general: '其他'
    };
    return labels[category] || category;
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
          // 更新记事本标签徽章数量
          const stats = await window.electronAPI.notebookGetStats();
          this.updateNotebookBadge(stats.total || 0);
          
          this.loadNotes();
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
    if (window.electronAPI) {
      await window.electronAPI.notebookDeleteNote(id);
      this.loadNotes();
      this.showToast('笔记已删除');
    }
  },
  
  async deleteNotesByCategory(category) {
    if (confirm(`确定要删除所有"${this.getNoteCategoryLabel(category)}"类别的笔记吗？此操作不可撤销！`)) {
      if (window.electronAPI) {
        const result = await window.electronAPI.notebookDeleteNotesByCategory(category);
        if (result.success) {
          this.loadNotes();
          this.showToast(`已删除所有${this.getNoteCategoryLabel(category)}笔记`);
        } else {
          this.showToast('删除失败', 'error');
        }
      }
    }
  },
  
  updateNotebookBadge(count) {
    const badge = document.getElementById('notebookBadge');
    if (badge) {
      console.log('[Notebook] Updating badge count:', count);
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    } else {
      console.log('[Notebook] Badge element not found');
    }
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
              // 填充任务表单并显示任务创建模态框
              document.getElementById('taskTitle').value = analysis.task.title || result.note.title;
              document.getElementById('taskDesc').value = analysis.task.description || result.note.content;
              
              if (analysis.task.dueDate) {
                const date = new Date(analysis.task.dueDate);
                document.getElementById('taskDue').value = date.toISOString().slice(0, 16);
              }
              
              document.getElementById('taskPriority').value = analysis.task.priority || 'medium';
              document.getElementById('taskDuration').value = analysis.task.estimatedDuration || 60;
              
              // 显示分析结果
              document.getElementById('aiAnalysisResult').classList.remove('hidden');
              document.getElementById('analysisConfidence').textContent = `置信度: ${Math.round(analysis.task.confidence * 100)}%`;
              
              // 记录用户反馈，用于优化prompt
              await window.electronAPI.recordFeedback({
                type: 'convert_to_task',
                content: result.note.content,
                result: analysis.task,
                timestamp: new Date().toISOString()
              });
              
              // 显示任务创建模态框
              document.getElementById('modalTitle').textContent = '新建任务（来自笔记）';
              document.getElementById('taskModal').classList.remove('hidden');
              
              this.showToast('笔记已转为待办任务');
            } else {
              // 如果AI分析失败，手动创建任务
              console.log('[App] AI analysis failed, creating manual task');
              document.getElementById('taskTitle').value = result.note.title;
              document.getElementById('taskDesc').value = result.note.content;
              document.getElementById('modalTitle').textContent = '新建任务（来自笔记）';
              document.getElementById('taskModal').classList.remove('hidden');
              
              // 记录反馈
              await window.electronAPI.recordFeedback({
                type: 'convert_to_task',
                content: result.note.content,
                manual: true,
                timestamp: new Date().toISOString()
              });
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
        <div class="note-item" data-id="${note.id}">
          <div class="note-header">
            <h3 class="note-title">${note.title}</h3>
            <span class="note-category">${this.getNoteCategoryLabel(note.category)}</span>
          </div>
          <p class="note-content">${note.content.substring(0, 200)}${note.content.length > 200 ? '...' : ''}</p>
          <div class="note-footer">
            <span class="note-date">${new Date(note.createdAt).toLocaleString()}</span>
            ${note.analyzed ? '<span class="note-analyzed">已分析</span>' : ''}
            <button class="note-delete" onclick="App.deleteNote('${note.id}')">删除</button>
          </div>
        </div>
      `).join('');
    } else {
      noteList.innerHTML = '<div class="empty-state">未找到匹配的笔记</div>';
    }
  },

  // ========== 记忆提取Prompt配置方法 ==========
  
  async loadMemoryPrompt() {
    if (window.electronAPI) {
      const prompt = await window.electronAPI.getMemoryPrompt();
      document.getElementById('memoryPromptEditor').value = prompt;
    }
  },

  async saveMemoryPrompt() {
    const prompt = document.getElementById('memoryPromptEditor').value;
    if (window.electronAPI) {
      await window.electronAPI.setMemoryPrompt(prompt);
      this.showToast('记忆提取Prompt已保存');
    }
  },

  async resetMemoryPrompt() {
    if (window.electronAPI) {
      const result = await window.electronAPI.resetMemoryPrompt();
      document.getElementById('memoryPromptEditor').value = result.prompt;
    }
    this.showToast('记忆提取Prompt已重置');
  },

  setupClipboardListener() {
    if (window.electronAPI) {
      window.electronAPI.onClipboardTaskDetected((data) => {
        this.handleClipboardTask(data);
      });
      
      window.electronAPI.onStartPomodoro(() => {
        Pomodoro.start();
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
          // 更新记事本标签徽章数量
          const stats = await window.electronAPI.notebookGetStats();
          this.updateNotebookBadge(stats.total || 0);
          
          // 如果当前在记事本视图，刷新笔记列表
          const currentView = document.querySelector('.view-tab.active')?.dataset.view;
          if (currentView === 'notebook') {
            this.loadNotes();
          }
          
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
        const date = new Date(task.dueDate);
        dueInput.value = date.toISOString().slice(0, 16);
      }
      
      durationInput.value = task.estimatedDuration;
      priorityInput.value = task.priority;
    } else {
      document.getElementById('modalTitle').textContent = '新建任务';
      titleInput.value = task?.title || '';
      descInput.value = task?.description || '';
      
      if (task?.dueDate) {
        const date = new Date(task.dueDate);
        dueInput.value = date.toISOString().slice(0, 16);
      } else {
        const defaultDate = this.getDefaultDueDate();
        dueInput.value = defaultDate.toISOString().slice(0, 16);
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
          // 更新记事本标签徽章数量
          const stats = await window.electronAPI.notebookGetStats();
          this.updateNotebookBadge(stats.total || 0);
          
          // 如果当前在记事本视图，刷新笔记列表
          const currentView = document.querySelector('.view-tab.active')?.dataset.view;
          if (currentView === 'notebook') {
            this.loadNotes();
          }
          
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
          Pomodoro.setCurrentTask(taskId, task.title);
          Pomodoro.start(taskId);
        }
      });
      
      item.querySelector('.delete-task-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const task = Store.getTasks().find(t => t.id === taskId);
        if (task && confirm(`确定要删除任务"${task.title}"吗？`)) {
          Store.deleteTask(taskId);
          this.renderTaskList();
        }
      });
    });
  },

  renderTaskItem(task) {
    const dueDate = task.dueDate ? new Date(task.dueDate) : null;
    const relativeTime = dueDate ? this.getRelativeTime(dueDate) : '无截止时间';
    const priorityBadge = `<span class="priority-badge ${task.priority}">${task.priority === 'high' ? '高' : task.priority === 'medium' ? '中' : '低'}</span>`;
    const draftBadge = task.isDraft ? `<span class="draft-badge">草稿</span>` : '';
    
    return `
      <div class="task-item${task.isDraft ? ' draft-item' : ''}" data-id="${task.id}">
        <div class="task-checkbox"></div>
        <div class="task-info">
          <div class="title">${task.title} ${draftBadge}</div>
          <div class="meta">
            <span>${relativeTime}</span>
            <span>${task.estimatedDuration}分钟</span>
            ${priorityBadge}
            <button class="start-pomodoro" title="开始番茄钟">🍅</button>
            <button class="delete-task-btn" title="删除任务">🗑</button>
          </div>
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
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

window.App = App;