/**
 * Memora v2.6 专家系统模块
 * 管理专家配置、专家团配置、卡片渲染、群聊引擎
 * v2.6.1: 增加并行执行、IPC后台任务、群聊记录本地保存/恢复
 */
const ExpertSystem = {
  _experts: [],
  _groups: [],
  _activeExpertId: null,
  _activeGroupId: null,
  _initialized: false,

  // 群聊状态
  _groupChatActive: false,
  _groupChatPhase: 'idle', // 'idle' | 'host_analysis' | 'experts_exec' | 'host_summary'
  _groupChatMessages: [],  // 当前群聊轮次的所有消息
  _groupChatRound: 0,
  _groupChatSupplementCount: 0,
  _groupChatNoMoreReminder: false, // 本会话不再费用提醒
  _groupChatAbortController: null,
  _groupChatCurrentStep: null,
  _groupChatExecutingInBackground: false, // 是否在后台执行

  // 群聊记录持久化
  _chatRecords: [],  // 所有群聊记录（从 localStorage 加载）

  // 初始化
  async init() {
    console.log('[ExpertSystem] Initializing...');
    await this._loadFromStore();
    this._loadChatRecords();
    this._bindIPCEvents();
    this._initialized = true;
    console.log(`[ExpertSystem] Loaded ${this._experts.length} experts, ${this._groups.length} groups, ${this._chatRecords.length} chat records`);
  },

  async _loadFromStore() {
    try {
      const result = await window.electronAPI?.expertsGetAll?.();
      if (result?.success) {
        this._experts = result.experts || [];
        this._groups = result.groups || [];
      }
    } catch (e) {
      console.error('[ExpertSystem] Failed to load:', e);
    }
  },

  // ===== 专家 CRUD =====
  async saveExpert(expert) {
    const result = await window.electronAPI?.expertsSave?.(expert);
    if (result?.success) {
      await this._loadFromStore();
    }
    return result;
  },

  async deleteExpert(expertId) {
    const result = await window.electronAPI?.expertsDelete?.(expertId);
    if (result?.success) {
      await this._loadFromStore();
    }
    return result;
  },

  async reorderExperts(orderedIds) {
    const result = await window.electronAPI?.expertsReorder?.(orderedIds);
    if (result?.success) {
      await this._loadFromStore();
    }
    return result;
  },

  // ===== 专家团 CRUD =====
  async saveGroup(group) {
    const result = await window.electronAPI?.expertGroupsSave?.(group);
    if (result?.success) {
      await this._loadFromStore();
    }
    return result;
  },

  async deleteGroup(groupId) {
    const result = await window.electronAPI?.expertGroupsDelete?.(groupId);
    if (result?.success) {
      await this._loadFromStore();
    }
    return result;
  },

  async reorderGroups(orderedIds) {
    const result = await window.electronAPI?.expertGroupsReorder?.(orderedIds);
    if (result?.success) {
      await this._loadFromStore();
    }
    return result;
  },

  // ===== 获取数据 =====
  getExperts() { return this._experts; },
  getGroups() { return this._groups; },
  
  getExpertById(id) { return this._experts.find(e => e.id === id); },
  getGroupById(id) { return this._groups.find(g => g.id === id); },

  getActiveExpert() { return this._activeExpertId ? this.getExpertById(this._activeExpertId) : null; },
  getActiveGroup() { return this._activeGroupId ? this.getGroupById(this._activeGroupId) : null; },

  isGroupChatActive() { return this._groupChatActive; },
  isExecutingInBackground() { return this._groupChatExecutingInBackground; },

  /**
   * 根据专家团的成员信息自动生成主持人 Prompt（基础版，供 LLM 优化的输入）
   * @param {Object} group - 专家团配置 { name, intro, hostExpertId, expertIds, executionStrategy }
   * @returns {string} 自动生成的 hostPrompt
   */
  generateHostPrompt(group) {
    if (!group) return '';
    const hostExpert = this.getExpertById(group.hostExpertId);
    const members = (group.expertIds || [])
      .filter(id => id !== group.hostExpertId)
      .map(id => this.getExpertById(id))
      .filter(Boolean);

    if (!hostExpert) return '';

    const strategy = group.executionStrategy === 'parallel' ? '并行' : '串行';
    const groupName = group.name || '未命名';
    const groupIntro = group.intro?.trim();

    // 生成专家能力描述
    const hostCapabilities = this._buildExpertCapabilities(hostExpert, '主持人');
    const memberCapabilities = members.map(m => this._buildExpertCapabilities(m, '成员')).join('\n\n');

    const introSection = groupIntro ? `\n## 专家团简介\n${groupIntro}\n` : '';

    const prompt = `你是专家团「${groupName}」的主持人，负责协调团队成员高效处理用户请求。
${introSection}
## 团队执行策略
当前采用${strategy}执行模式。${strategy === '并行' ? '各专家同时执行任务，互不等待，适合独立子任务。' : '各专家按分配顺序依次执行，后执行的专家可参考前面的结果，适合需要上下文关联的任务。'}

## 主持人职责
作为主持人，你需要：
1. **分析用户请求**：准确理解用户意图，拆解为可执行的子任务
2. **合理分配任务**：根据每位专家的专长领域分配最适合的任务
3. **给出初步判断**：以你自己的专业角度先给出见解和分析框架
4. **避免重复**：确保不同专家的任务边界清晰，不重叠不遗漏

## 你的能力领域
${hostCapabilities}

## 团队成员能力
${memberCapabilities}

## 协同指导
- 优先分配给专长最匹配的专家，不要让所有专家都参与
- 如果某个子任务涉及多个领域，明确说明需要哪个视角
- 可以跳过不需要的专家（不是每个请求都需要所有专家参与）
- 分配任务时描述要具体明确，包含上下文和期望输出格式`;

    return prompt;
  },

  /**
   * 构建单个专家的能力描述
   */
  _buildExpertCapabilities(expert, role) {
    const intro = expert.intro || '暂无介绍';
    const quickAccesses = (expert.quickAccesses || []).map(qa => qa.label).filter(Boolean);
    const capabilitiesText = quickAccesses.length > 0
      ? `\n擅长场景：${quickAccesses.join('、')}`
      : '';

    return `### ${expert.icon} ${expert.name}（${role}）
专业领域：${intro}${capabilitiesText}
ID：${expert.id}`;
  },

  // ===== 群聊记录持久化 =====
  _loadChatRecords() {
    try {
      const data = localStorage.getItem('memora_expert_chat_records');
      this._chatRecords = data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[ExpertSystem] Failed to load chat records:', e);
      this._chatRecords = [];
    }
  },

  _saveChatRecords() {
    try {
      localStorage.setItem('memora_expert_chat_records', JSON.stringify(this._chatRecords));
    } catch (e) {
      console.error('[ExpertSystem] Failed to save chat records:', e);
    }
  },

  getChatRecords(groupId) {
    if (groupId) return this._chatRecords.filter(r => r.groupId === groupId);
    return this._chatRecords;
  },

  saveChatRecord(record) {
    record.id = record.id || `cr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    record.createdAt = record.createdAt || new Date().toISOString();
    this._chatRecords.unshift(record);
    // 保留最近 200 条
    if (this._chatRecords.length > 200) {
      this._chatRecords = this._chatRecords.slice(0, 200);
    }
    this._saveChatRecords();
    return record;
  },

  deleteChatRecord(recordId) {
    this._chatRecords = this._chatRecords.filter(r => r.id !== recordId);
    this._saveChatRecords();
  },

  // ===== AI 助手页面卡片渲染 =====
  renderCards() {
    const container = document.querySelector('.feature-cards');
    if (!container) return;

    // 获取当前 AI 模式，按模式过滤专家
    const currentMode = window.App?._aiAssistantMode || 'agent';

    const allItems = [
      ...this._experts.map(e => ({ ...e, _type: 'expert' })),
      ...this._groups.map(g => ({ ...g, _type: 'group' }))
    ].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    // 按模式过滤：专家通过 modes 字段过滤，专家团暂全部显示（或可扩展）
    const filteredItems = allItems.filter(item => {
      if (item._type === 'expert') {
        const modes = item.modes || ['agent']; // 兼容旧数据默认 agent
        return modes.includes(currentMode);
      }
      // 专家团：如果所有成员都不支持当前模式则隐藏
      return true;
    });

    if (filteredItems.length === 0) {
      container.classList.remove('has-experts', 'feature-cards-scroll-hint');
      // 无匹配专家时隐藏卡片区域
      container.style.display = 'none';
      return;
    }

    // 显示专家卡片区域
    container.style.display = '';

    // 添加专家卡片专属类，启用紧凑两行滚动布局
    container.classList.add('has-experts');

    container.innerHTML = filteredItems.map(item => {
      if (item._type === 'expert') {
        return this._renderExpertCard(item);
      } else {
        return this._renderGroupCard(item);
      }
    }).join('');

    // 检测内容是否超出两行，添加滚动提示
    this._setupScrollHint(container);

    // 恢复选中状态
    if (this._activeExpertId || this._activeGroupId) {
      const activeId = this._activeExpertId || this._activeGroupId;
      const activeType = this._activeExpertId ? 'expert' : 'group';
      const activeCard = container.querySelector(`.feature-card[data-type="${activeType}"][data-id="${activeId}"]`);
      if (activeCard) {
        activeCard.classList.add('active');
      } else {
        this._activeExpertId = null;
        this._activeGroupId = null;
      }
    }
    // 渲染快捷访问
    if (this._activeExpertId) {
      this._renderQuickAccess(this.getExpertById(this._activeExpertId)?.quickAccesses || []);
    } else if (this._activeGroupId) {
      this._renderQuickAccess(this.getGroupById(this._activeGroupId)?.quickAccesses || []);
    } else {
      this._renderQuickAccess(this._getDefaultQuickAccesses());
    }
  },

  _setupScrollHint(container) {
    // 检测是否需要滚动
    requestAnimationFrame(() => {
      const needsScroll = container.scrollHeight > container.clientHeight + 2;
      if (needsScroll) {
        container.classList.add('feature-cards-scroll-hint');
        // 滚动到底部时移除渐变遮罩
        container.addEventListener('scroll', () => {
          const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
          container.classList.toggle('scrolled-to-bottom', atBottom);
        }, { passive: true });
      } else {
        container.classList.remove('feature-cards-scroll-hint');
      }
    });
  },

  _renderExpertCard(expert) {
    return `
      <div class="feature-card expert-card ${this._activeExpertId === expert.id ? 'active' : ''}" 
           data-type="expert" data-id="${expert.id}" data-category="${expert.id}" title="${expert.name}">
        <div class="feature-icon">${expert.icon || '🤖'}</div>
        <div class="feature-content">
          <h4>${this._escapeHtml(expert.name)}</h4>
          <p>${this._escapeHtml(expert.intro || '')}</p>
        </div>
        <div class="card-type-badge expert-badge">专家</div>
      </div>`;
  },

  _renderGroupCard(group) {
    const expertAvatars = (group.expertIds || []).slice(0, 4).map(eid => {
      const exp = this.getExpertById(eid);
      return exp ? `<span class="group-member-avatar">${exp.icon || '🤖'}</span>` : '';
    }).join('');
    const extraCount = (group.expertIds || []).length > 4 ? `<span class="group-member-extra">+${group.expertIds.length - 4}</span>` : '';
    const strategy = group.executionStrategy === 'parallel' ? '⚡' : '🔄';

    return `
      <div class="feature-card group-card ${this._activeGroupId === group.id ? 'active' : ''}" 
           data-type="group" data-id="${group.id}" data-category="${group.id}" title="${group.name}">
        <div class="feature-icon">${group.icon || '🏆'}</div>
        <div class="feature-content">
          <h4>${this._escapeHtml(group.name)}</h4>
          <p>${this._escapeHtml(group.intro || '')}</p>
        </div>
        <div class="group-members-row">${expertAvatars}${extraCount}</div>
        <div class="card-type-badge group-badge">${strategy} 专家团</div>
      </div>`;
  },

  // ===== 快捷访问渲染 =====
  _renderQuickAccess(quickAccesses) {
    const container = document.getElementById('quickCapsules');
    if (!container) return;
    
    if (!quickAccesses || quickAccesses.length === 0) {
      container.innerHTML = '<span style="color:var(--text-tertiary);font-size:12px;">暂无快捷访问</span>';
      return;
    }

    container.innerHTML = quickAccesses.map(qa => 
      `<button class="quick-capsule" data-question="${this._escapeHtml(qa.prompt)}">${qa.icon || '💬'} ${this._escapeHtml(qa.label)}</button>`
    ).join('');
  },

  // ===== 卡片点击处理 =====
  handleCardClick(cardEl) {
    const type = cardEl.dataset.type;
    const id = cardEl.dataset.id;

    // 如果正在群聊中，不允许切换
    if (this._groupChatActive && type === 'expert') {
      return;
    }

    // 🔧 v2.7: 点击已激活的卡片 → 取消选中，回到通用助手
    if (cardEl.classList.contains('active')) {
      cardEl.classList.remove('active');
      this._activeExpertId = null;
      this._activeGroupId = null;
      this._renderQuickAccess(this._getDefaultQuickAccesses());
      this._updateChatHeader('通用 AI 助手', false);
      // 清除对话会话关联的专家
      const appRef = window.App;
      if (appRef?._activeSessionId) {
        const session = appRef._chatSessions?.find(s => s.id === appRef._activeSessionId);
        if (session) {
          session.expertId = null;
          session.expertName = '';
          appRef._saveChatSessions?.();
        }
      }
      return;
    }

    // 更新选中状态
    document.querySelectorAll('.feature-card').forEach(c => c.classList.remove('active'));
    cardEl.classList.add('active');

    if (type === 'expert') {
      this._activeExpertId = id;
      this._activeGroupId = null;
      this._groupChatActive = false;
      const expert = this.getExpertById(id);
      this._renderQuickAccess(expert?.quickAccesses || []);
      this._updateChatHeader(expert?.name || 'AI 助手', false);
      // 标记当前对话会话关联的专家
      const appRef = window.App;
      if (appRef?._activeSessionId) {
        const session = appRef._chatSessions?.find(s => s.id === appRef._activeSessionId);
        if (session && !session.isGroupChat) {
          session.expertId = id;
          session.expertName = expert?.name || '';
          session.taskType = 'chat';
          appRef._saveChatSessions?.();
        }
      }
    } else {
      this._activeGroupId = id;
      this._activeExpertId = null;
      const group = this.getGroupById(id);
      this._renderQuickAccess(group?.quickAccesses || []);
      const memberCount = (group?.expertIds || []).length;
      this._updateChatHeader(`${group?.name || '专家团'}（${memberCount}位专家）`, true);
    }
  },

  _updateChatHeader(title, isGroup) {
    const chatHeader = document.getElementById('chatHeader');
    if (chatHeader) {
      chatHeader.style.display = isGroup ? 'flex' : 'none';
    }
    const chatHeaderTitle = document.getElementById('chatHeaderTitle');
    if (chatHeaderTitle) {
      chatHeaderTitle.textContent = title;
      chatHeaderTitle.classList.toggle('group-chat', isGroup);
    }
    const exitBtn = document.getElementById('exitGroupChatBtn');
    if (exitBtn) {
      exitBtn.style.display = isGroup ? 'inline-flex' : 'none';
    }
    const terminateBtn = document.getElementById('terminateGroupChatBtn');
    if (terminateBtn) {
      terminateBtn.style.display = isGroup ? 'inline-flex' : 'none';
    }
  },

  /** 通用助手快捷访问（无专家选中时显示） */
  _getDefaultQuickAccesses() {
    return [
      { icon: '📋', label: '今天的日报', prompt: '整理今天的日报' },
      { icon: '📊', label: '本周周报', prompt: '整理本周的周报' },
      { icon: '📝', label: '明天任务', prompt: '整理明天的任务' },
      { icon: '🧠', label: '帮我回忆', prompt: '帮我回忆一下最近的重要事项' },
      { icon: '💡', label: '知识回顾', prompt: '总结今天记录的知识点' },
    ];
  },

  // ===== 获取当前专家的 ADP 配置 =====
  getActiveADPConfig() {
    const expert = this.getActiveExpert();
    if (expert) {
      return {
        appKey: expert.appKey,
        url: expert.adpUrl || null,
        expertName: expert.name,
        expertIcon: expert.icon
      };
    }
    return null;
  },

  // ===== 绑定 IPC 事件 =====
  _bindIPCEvents() {
    // 🔧 修复：不再在 ExpertSystem 中注册 onExpertChatEvent，
    // 统一由 app.js._startBackgroundGroupChat() 注册并按 chatId 过滤，
    // 避免双重监听导致消息重复处理
  },

  // ===== 群聊引擎 =====

  /**
   * 启动群聊流程
   * @param {string} userMessage - 用户消息
   * @param {object} appRef - App 对象引用
   * @returns {boolean} 是否已启动群聊
   */
  async startGroupChat(userMessage, appRef) {
    const group = this.getActiveGroup();
    if (!group) return false;

    const expertIds = group.expertIds || [];
    if (expertIds.length === 0) {
      appRef._showToast?.('专家团没有成员，请先配置', 'error');
      return false;
    }

    const hostExpert = this.getExpertById(group.hostExpertId);
    if (!hostExpert) {
      appRef._showToast?.('主持人不存在，请在设置中指定主持人', 'error');
      return false;
    }

    // 费用提醒
    if (!this._groupChatNoMoreReminder) {
      const callCount = 1 + (expertIds.length - 1) + 1; // 主持人 + 专家 + 总结
      const confirmed = await this._showCostReminder(callCount, expertIds.length);
      if (!confirmed) return false;
    }

    this._groupChatActive = true;
    this._groupChatRound++;
    this._groupChatMessages = [];
    this._groupChatPhase = 'host_analysis';
    this._groupChatExecutingInBackground = false;

    // 标记当前会话为群聊模式
    this._markChatSessionAsGroup(group, appRef);

    // 保存用户消息到群聊记录
    this._groupChatMessages.push({
      expertId: 'user',
      expertName: '用户',
      expertIcon: '👤',
      isHost: false,
      phase: 'user_input',
      content: userMessage
    });

    try {
      const strategy = group.executionStrategy || 'serial';

      // 阶段一：主持人分析
      const hostResult = await this._callHostAnalysis(userMessage, group, hostExpert, appRef);
      if (!hostResult) {
        this._groupChatActive = false;
        return false;
      }

      // 解析主持人分配
      const assignments = this._parseHostAssignments(hostResult, expertIds);
      
      // 阶段二：分发任务给专家
      this._groupChatPhase = 'experts_exec';
      let expertResults;

      if (strategy === 'parallel') {
        expertResults = await this._executeExpertsParallel(userMessage, assignments, group, hostExpert, appRef);
      } else {
        expertResults = await this._executeExpertsSerial(userMessage, assignments, group, hostExpert, appRef);
      }

      // 阶段三：主持人总结
      this._groupChatPhase = 'host_summary';
      await this._callHostSummary(userMessage, expertResults, group, hostExpert, appRef);

    } catch (e) {
      console.error('[ExpertSystem] Group chat error:', e);
      appRef._showToast?.('群聊过程出错：' + e.message, 'error');
    } finally {
      this._groupChatActive = false;
      this._groupChatPhase = 'idle';
      this._groupChatExecutingInBackground = false;
      // 保存群聊记录
      this._persistChatRecord(userMessage);
    }

    return true;
  },

  // ===== 标记会话为群聊 =====
  _markChatSessionAsGroup(group, appRef) {
    if (!appRef._activeSessionId) return;
    const session = appRef._chatSessions?.find(s => s.id === appRef._activeSessionId);
    if (session) {
      session.isGroupChat = true;
      session.groupId = group.id;
      session.groupName = group.name;
      session.taskType = 'group';
    }
    // 立即持久化，确保群聊标记不会丢失
    appRef._saveChatSessions?.();
  },

  // ===== 持久化群聊记录 =====
  _persistChatRecord(userMessage) {
    if (this._groupChatMessages.length === 0) return;
    const group = this.getActiveGroup();
    if (!group) return;

    const record = {
      groupId: group.id,
      groupName: group.name,
      groupIcon: group.icon,
      userMessage: userMessage,
      messages: this._groupChatMessages.map(m => ({
        expertId: m.expertId,
        expertName: m.expertName,
        expertIcon: m.expertIcon,
        isHost: m.isHost,
        phase: m.phase,
        content: m.content,
        isError: m.isError || false
      })),
      round: this._groupChatRound,
      strategy: group.executionStrategy || 'serial'
    };
    this.saveChatRecord(record);
  },

  // ===== 串行执行 =====
  async _executeExpertsSerial(userMessage, assignments, group, hostExpert, appRef) {
    const expertResults = [];
    
    for (const assignment of assignments) {
      const memberExpert = this.getExpertById(assignment.expertId);
      if (!memberExpert) continue;

      const memberResult = await this._callExpertMember(
        userMessage, assignment.task, group, hostExpert, memberExpert, appRef
      );

      if (memberResult) {
        expertResults.push({
          expertId: assignment.expertId,
          expertName: memberExpert.name,
          expertIcon: memberExpert.icon,
          result: memberResult
        });

        // 检测专家是否指向其他专家
        const forwardTarget = this._detectExpertForward(memberResult, memberExpert.name);
        if (forwardTarget) {
          const targetExpert = this._experts.find(e => 
            e.id !== memberExpert.id && 
            (e.name === forwardTarget || e.name.includes(forwardTarget))
          );
          if (targetExpert && (group.expertIds || []).includes(targetExpert.id)) {
            const forwardResult = await this._callExpertMember(
              userMessage, 
              `${memberExpert.name}的输出需要你继续处理：${memberResult.substring(0, 500)}`,
              group, hostExpert, targetExpert, appRef
            );
            if (forwardResult) {
              expertResults.push({
                expertId: targetExpert.id,
                expertName: targetExpert.name,
                expertIcon: targetExpert.icon,
                result: forwardResult
              });
            }
          }
        }
      }
    }
    return expertResults;
  },

  // ===== 并行执行 =====
  async _executeExpertsParallel(userMessage, assignments, group, hostExpert, appRef) {
    const chatMessages = document.getElementById('chatMessages');

    // 先为所有专家添加 loading 气泡
    const bubbleMap = new Map();
    for (const assignment of assignments) {
      const memberExpert = this.getExpertById(assignment.expertId);
      if (!memberExpert) continue;
      const bubbleEl = this._addExpertMessageBubble(
        chatMessages, memberExpert, false,
        `${memberExpert.icon} ${memberExpert.name} 正在并行处理...`
      );
      bubbleMap.set(assignment.expertId, { el: bubbleEl, expert: memberExpert, assignment });
    }

    // 并行调用
    const promises = assignments.map(assignment => {
      const memberExpert = this.getExpertById(assignment.expertId);
      if (!memberExpert) return Promise.resolve(null);
      return this._callExpertMemberParallel(
        userMessage, assignment.task, group, hostExpert, memberExpert
      ).then(result => ({ assignment, memberExpert, result }))
        .catch(err => ({ assignment, memberExpert, result: null, error: err }));
    });

    const results = await Promise.allSettled(promises);
    const expertResults = [];

    for (const settled of results) {
      if (settled.status === 'fulfilled' && settled.value) {
        const { assignment, memberExpert, result, error } = settled.value;
        const bubbleInfo = bubbleMap.get(assignment.expertId);
        
        if (result && bubbleInfo) {
          this._updateExpertMessageBubble(bubbleInfo.el, result);
          this._groupChatMessages.push({
            expertId: memberExpert.id,
            expertName: memberExpert.name,
            expertIcon: memberExpert.icon,
            isHost: false,
            phase: 'member_exec',
            content: result
          });
          expertResults.push({
            expertId: assignment.expertId,
            expertName: memberExpert.name,
            expertIcon: memberExpert.icon,
            result
          });
        } else if (error && bubbleInfo) {
          const errorMsg = `⚠️ 调用失败：${error.message}`;
          this._updateExpertMessageBubble(bubbleInfo.el, errorMsg, true);
          this._groupChatMessages.push({
            expertId: memberExpert.id,
            expertName: memberExpert.name,
            expertIcon: memberExpert.icon,
            isHost: false,
            phase: 'member_exec',
            content: errorMsg,
            isError: true
          });
          expertResults.push({
            expertId: assignment.expertId,
            expertName: memberExpert.name,
            expertIcon: memberExpert.icon,
            result: null,
            isError: true
          });
        }
      }
    }

    return expertResults;
  },

  // ===== 并行模式下的专家调用（不创建DOM，只返回结果）=====
  async _callExpertMemberParallel(userMessage, task, group, hostExpert, memberExpert) {
    const memberPrompt = `你是专家「${memberExpert.name}」。
专家团主持人「${hostExpert.name}」分配给你的任务是：
${task}

用户的原始请求：${userMessage}

请完成你的任务。`;

    return this._sendExpertADPMessage(memberPrompt, memberExpert, group, 'member_exec', null);
  },

  // 主持人分析
  async _callHostAnalysis(userMessage, group, hostExpert, appRef) {
    const memberExperts = (group.expertIds || [])
      .filter(id => id !== group.hostExpertId)
      .map(id => this.getExpertById(id))
      .filter(Boolean);

    const strategy = group.executionStrategy === 'parallel' ? '并行' : '按顺序';
    const customPrompt = group.hostPrompt?.trim();

    // 构建专家能力详情（供主持人参考）
    const hostCapabilities = this._buildExpertCapabilities(hostExpert, '主持人');
    const memberCapabilities = memberExperts.map(m => this._buildExpertCapabilities(m, '成员')).join('\n');

    const defaultPrompt = `你是专家团「${group.name}」的主持人，负责协调团队处理用户请求。

## 执行策略：${strategy}

## 团队能力
${hostCapabilities}

${memberCapabilities}

## 用户的请求
${userMessage}

## 你的任务
1. 分析用户请求的核心需求
2. 判断需要哪些专家参与（不需要的可以跳过）
3. 为每个需要的专家分配具体、明确的任务
4. 以你的专业角度先给出初步判断和分析框架

输出格式（必须严格遵循，只输出JSON，禁止markdown和解释）：
{
  "analysis": "你对用户请求的分析",
  "initial_thought": "你的初步判断和建议方向",
  "assignments": [
    {"expert_id": "专家ID", "task": "具体任务描述，包含上下文和期望输出"}
  ]
}`;

    const systemPrompt = customPrompt ? `${customPrompt}\n\n${defaultPrompt}` : defaultPrompt;

    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return null;

    const hostMsgEl = this._addExpertMessageBubble(chatMessages, hostExpert, true, '⭐ 主持人正在分析...');

    try {
      const result = await this._sendExpertADPMessage(
        systemPrompt, hostExpert, group, 'host_analysis', appRef
      );

      this._updateExpertMessageBubble(hostMsgEl, result);
      this._groupChatMessages.push({
        expertId: hostExpert.id,
        expertName: hostExpert.name,
        expertIcon: hostExpert.icon,
        isHost: true,
        phase: 'host_analysis',
        content: result
      });

      return result;
    } catch (e) {
      this._updateExpertMessageBubble(hostMsgEl, `⚠️ 调用失败：${e.message}`, true);
      return null;
    }
  },

  // 调用专家成员（串行模式，含DOM操作）
  async _callExpertMember(userMessage, task, group, hostExpert, memberExpert, appRef) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return null;

    const memberPrompt = `你是专家「${memberExpert.name}」。
专家团主持人「${hostExpert.name}」分配给你的任务是：
${task}

用户的原始请求：${userMessage}

请完成你的任务。`;

    const memberMsgEl = this._addExpertMessageBubble(chatMessages, memberExpert, false, `${memberExpert.icon} ${memberExpert.name} 正在处理...`);

    try {
      const result = await this._sendExpertADPMessage(
        memberPrompt, memberExpert, group, 'member_exec', appRef
      );

      this._updateExpertMessageBubble(memberMsgEl, result);
      this._groupChatMessages.push({
        expertId: memberExpert.id,
        expertName: memberExpert.name,
        expertIcon: memberExpert.icon,
        isHost: false,
        phase: 'member_exec',
        content: result
      });

      return result;
    } catch (e) {
      const errorMsg = `⚠️ 调用失败：${e.message}`;
      this._updateExpertMessageBubble(memberMsgEl, errorMsg, true);
      this._groupChatMessages.push({
        expertId: memberExpert.id,
        expertName: memberExpert.name,
        expertIcon: memberExpert.icon,
        isHost: false,
        phase: 'member_exec',
        content: errorMsg,
        isError: true
      });
      return null;
    }
  },

  // 主持人总结
  async _callHostSummary(userMessage, expertResults, group, hostExpert, appRef) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const resultsSummary = expertResults.map(r => 
      `${r.expertIcon} ${r.expertName}：${r.result || '（无输出）'}`
    ).join('\n\n');

    const failedExperts = expertResults.filter(r => r.isError);
    const failedNote = failedExperts.length > 0 
      ? `\n\n⚠️ 注意：以下专家调用失败：${failedExperts.map(e => e.expertName).join('、')}，以下结论缺少他们的输入。` 
      : '';

    const summaryPrompt = `以下是各专家的工作结果：
${resultsSummary}
${failedNote}

请你：
1. 综合各专家结果
2. 检查是否有遗漏或冲突
3. 给出最终结论`;

    const hostMsgEl = this._addExpertMessageBubble(chatMessages, hostExpert, true, '⭐ 主持人正在汇总...');

    try {
      const result = await this._sendExpertADPMessage(
        summaryPrompt, hostExpert, group, 'host_summary', appRef
      );

      this._updateExpertMessageBubble(hostMsgEl, result);
      this._groupChatMessages.push({
        expertId: hostExpert.id,
        expertName: hostExpert.name,
        expertIcon: hostExpert.icon,
        isHost: true,
        phase: 'host_summary',
        content: result
      });
    } catch (e) {
      this._updateExpertMessageBubble(hostMsgEl, `⚠️ 汇总失败：${e.message}`, true);
    }
  },

  // 多轮上下文构建
  buildMultiTurnContext(group) {
    if (this._groupChatMessages.length === 0) return '';
    
    return '上一轮对话结果：\n' + this._groupChatMessages.map(m => 
      `${m.isHost ? '⭐ 主持人' : m.expertIcon + ' ' + m.expertName}：${m.content}`
    ).join('\n\n');
  },

  // ===== ADP 消息发送（群聊专用）=====
  async _sendExpertADPMessage(prompt, expert, group, phase, appRef) {
    const appKey = expert.appKey;
    let url = expert.adpUrl;
    
    if (!appKey) {
      const adpConfig = await window.electronAPI?.getADPConfig?.();
      if (adpConfig?.app_key) {
        url = url || adpConfig.url;
      }
    }

    if (!url) {
      url = 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
    }

    const conversationId = `grp_${group.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}_${phase}_${Date.now()}`;
    const visitorId = `memora_exp_${expert.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}`;

    const body = {
      AppKey: appKey,
      ConversationId: conversationId,
      VisitorId: visitorId,
      Contents: [{ Type: 'text', Text: prompt }],
      RequestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      Stream: 'enable'
    };

    // 使用主进程的 sendADPMessage（已在主进程运行，即使切走页面也继续）
    return new Promise((resolve, reject) => {
      let fullText = '';
      let thinkingText = '';
      const timeout = setTimeout(() => {
        window.electronAPI?.removeADPListeners?.();
        reject(new Error('专家响应超时（5分钟）'));
      }, 300000);

      const onSSEEvent = (data) => {
        try {
          if (data.event === 'text.delta' && data.data?.Content) {
            fullText += data.data.Content;
          } else if (data.event === 'thought' && data.data?.Content) {
            thinkingText += data.data.Content;
          } else if (data.event === 'message.done' || data.event === 'response.completed') {
            clearTimeout(timeout);
            window.electronAPI?.removeADPListeners?.();
            resolve(fullText || thinkingText || '（无输出）');
          } else if (data.event === 'error') {
            clearTimeout(timeout);
            window.electronAPI?.removeADPListeners?.();
            reject(new Error(data.data?.Message || data.data?.message || 'ADP 调用失败'));
          } else if (data.event === 'done') {
            clearTimeout(timeout);
            window.electronAPI?.removeADPListeners?.();
            resolve(fullText || thinkingText || '（无输出）');
          }
        } catch (e) {
          console.error('[ExpertSystem] SSE event parse error:', e);
        }
      };

      window.electronAPI?.onADPSSEEvent?.(onSSEEvent);

      window.electronAPI?.sendADPMessage?.({
        message: prompt,
        appKey: appKey,
        adpUrl: url,
        _expertMode: true
      }).then(result => {
        if (result?.text) {
          clearTimeout(timeout);
          window.electronAPI?.removeADPListeners?.();
          resolve(result.text);
        }
      }).catch(err => {
        clearTimeout(timeout);
        window.electronAPI?.removeADPListeners?.();
        reject(err);
      });
    });
  },

  // ===== 后台任务 IPC 事件处理 =====
  _handleBackgroundChatEvent(data) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) {
      // 页面不可见，记录到待渲染队列
      this._pendingBackgroundEvents = this._pendingBackgroundEvents || [];
      this._pendingBackgroundEvents.push(data);
      return;
    }

    const { type, expertId, expertName, expertIcon, isHost, content, phase, isError } = data;

    if (type === 'expert-message') {
      const expert = this.getExpertById(expertId);
      const msgEl = this._addExpertMessageBubble(
        chatMessages,
        { id: expertId, name: expertName, icon: expertIcon },
        isHost,
        isHost ? '⭐ 主持人正在分析...' : `${expertIcon} ${expertName} 正在处理...`
      );

      if (content) {
        this._updateExpertMessageBubble(msgEl, content, isError);
      }

      this._groupChatMessages.push({
        expertId, expertName, expertIcon, isHost, phase, content, isError
      });
    } else if (type === 'expert-complete') {
      this._updateExpertMessageBubble(
        chatMessages.querySelector(`[data-expert-id="${expertId}"]:last-child`),
        content, isError
      );
    } else if (type === 'chat-complete') {
      this._groupChatActive = false;
      this._groupChatPhase = 'idle';
      this._persistChatRecord(data.userMessage);
    }
  },

  // ===== 渲染待处理的后台事件 =====
  renderPendingBackgroundEvents() {
    if (!this._pendingBackgroundEvents?.length) return;
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    for (const data of this._pendingBackgroundEvents) {
      this._handleBackgroundChatEvent(data);
    }
    this._pendingBackgroundEvents = [];
  },

  // ===== 从群聊记录恢复 =====
  restoreChatFromRecord(recordId, appRef) {
    const record = this._chatRecords.find(r => r.id === recordId);
    if (!record) return false;

    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return false;

    // 清空当前消息
    chatMessages.innerHTML = '';

    // 渲染每条消息
    for (const msg of record.messages) {
      if (msg.expertId === 'user') {
        // 用户消息 - 使用 App 的渲染方法
        const userMsgEl = document.createElement('div');
        userMsgEl.className = 'message user';
        userMsgEl.dataset.sendTime = new Date().toISOString();
        userMsgEl.innerHTML = `<div class="message-content"><p>${this._escapeHtml(msg.content)}</p></div>`;
        chatMessages.appendChild(userMsgEl);
      } else {
        const expert = { id: msg.expertId, name: msg.expertName, icon: msg.expertIcon };
        const msgEl = this._addExpertMessageBubble(chatMessages, expert, msg.isHost, '');
        this._updateExpertMessageBubble(msgEl, msg.content, msg.isError);
      }
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
    return true;
  },

  // ===== 解析主持人分配 =====
  _parseHostAssignments(hostResult, expertIds) {
    try {
      const jsonMatch = hostResult.match(/\{[\s\S]*"assignments"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.assignments && Array.isArray(parsed.assignments)) {
          return parsed.assignments.filter(a => 
            a.expert_id && expertIds.includes(a.expert_id)
          ).map(a => ({
            expertId: a.expert_id,
            task: a.task || '请协助处理用户请求'
          }));
        }
      }
    } catch (e) {
      console.warn('[ExpertSystem] Failed to parse host assignments:', e);
    }

    // 解析失败，默认分配给所有非主持人专家
    return expertIds.map(id => ({
      expertId: id,
      task: '请协助处理用户的请求'
    }));
  },

  // ===== 检测专家间转发 =====
  _detectExpertForward(result, fromExpertName) {
    const patterns = [
      /@([^\s，。,]+)/,
      /请([^\s，。,]+?)(?:处理|分析|看看|协助)/,
      /交给([^\s，。,]+)/,
      /转给([^\s，。,]+)/,
      /由([^\s，。,]+?)(?:负责|完成|处理)/
    ];
    
    for (const pattern of patterns) {
      const match = result.match(pattern);
      if (match && match[1] !== fromExpertName) {
        return match[1].trim();
      }
    }
    return null;
  },

  // ===== UI 辅助方法 =====

  _addExpertMessageBubble(chatMessages, expert, isHost, placeholder) {
    const msgEl = document.createElement('div');
    msgEl.className = `message assistant expert-message ${isHost ? 'host-message' : 'member-message'}`;
    msgEl.dataset.expertId = expert.id;
    msgEl.dataset.sendTime = new Date().toISOString();

    const hostBadge = isHost ? '<span class="expert-role-badge host-badge">⭐ 主持人</span>' : '';
    
    msgEl.innerHTML = `
      <div class="expert-msg-header">
        <span class="expert-avatar">${expert.icon || '🤖'}</span>
        <span class="expert-name">${this._escapeHtml(expert.name)}</span>
        ${hostBadge}
      </div>
      <div class="message-content">
        <div class="expert-msg-loading">
          <div class="thinking-dots"><span></span><span></span><span></span></div>
          <span>${this._escapeHtml(placeholder)}</span>
        </div>
      </div>`;
    
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgEl;
  },

  _updateExpertMessageBubble(msgEl, content, isError = false) {
    if (!msgEl) return;
    const contentEl = msgEl.querySelector('.message-content');
    if (!contentEl) return;

    if (isError) {
      contentEl.innerHTML = `<div class="expert-msg-error">${this._escapeHtml(content)}</div>`;
    } else {
      // 🔧 修复1：检测主持人返回的 JSON 并解析渲染
      const isHost = msgEl.classList.contains('host-message');
      let renderedHtml;
      if (isHost && content.trim().startsWith('{')) {
        renderedHtml = this._renderHostJsonContent(content);
      } else {
        renderedHtml = this._renderMarkdown(content);
      }
      contentEl.innerHTML = `<div class="expert-msg-text">${renderedHtml}</div>`;

      // 🔧 修复3：检测文件链接并添加保存/打开按钮
      this._bindExpertFileLinks(contentEl);
    }

    // 为专家消息添加复制按钮和时间戳
    const copyBtnHtml = '<button class="copy-btn expert-copy-btn" title="复制"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>';
    contentEl.insertAdjacentHTML('beforeend', copyBtnHtml);
    const copyBtn = contentEl.querySelector('.expert-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const text = contentEl.querySelector('.expert-msg-text')?.textContent || contentEl.querySelector('.expert-msg-error')?.textContent || '';
        if (!text) return;
        try {
          if (window.electronAPI?.writeClipboardText) {
            await window.electronAPI.writeClipboardText(text);
          } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
          }
          copyBtn.style.color = '#34C759';
          const App = window.App;
          App?._showToast?.('已复制到剪贴板', 'success');
          setTimeout(() => { copyBtn.style.color = ''; }, 1500);
        } catch (err) {
          console.error('[ExpertCopy] Failed:', err);
        }
      });
    }

    // 时间戳
    const sendTime = msgEl.dataset.sendTime;
    const timeLabel = sendTime
      ? `${new Date(sendTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} → ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
      : new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    contentEl.insertAdjacentHTML('beforeend', `<span class="message-time assistant-time">${timeLabel}</span>`);
    
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  },

  /**
   * 🔧 修复1：解析主持人返回的 JSON 并渲染为可读格式
   * 主持人返回格式：{ analysis, initial_thought, assignments: [{expert_id, task}] }
   */
  _renderHostJsonContent(content) {
    try {
      // 尝试提取 JSON（可能包裹在 markdown 代码块中）
      let jsonStr = content.trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*"assignments"[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      
      const parsed = JSON.parse(jsonStr);
      let html = '';
      
      // 渲染分析部分
      if (parsed.analysis) {
        html += `<div class="host-analysis-section">
          <div class="host-section-label">📋 需求分析</div>
          <div class="host-section-content">${this._renderMarkdown(parsed.analysis)}</div>
        </div>`;
      }
      
      // 渲染初步判断
      if (parsed.initial_thought) {
        html += `<div class="host-analysis-section">
          <div class="host-section-label">💡 初步判断</div>
          <div class="host-section-content">${this._renderMarkdown(parsed.initial_thought)}</div>
        </div>`;
      }
      
      // 渲染任务分配
      if (parsed.assignments && Array.isArray(parsed.assignments) && parsed.assignments.length > 0) {
        html += `<div class="host-analysis-section">
          <div class="host-section-label">📌 任务分配</div>
          <div class="host-assignments-list">`;
        for (const a of parsed.assignments) {
          const expert = this.getExpertById(a.expert_id);
          const expertName = expert?.name || a.expert_id;
          const expertIcon = expert?.icon || '🤖';
          html += `<div class="host-assignment-item">
            <span class="host-assignment-expert">${expertIcon} ${this._escapeHtml(expertName)}</span>
            <span class="host-assignment-task">${this._renderMarkdown(a.task || '待分配')}</span>
          </div>`;
        }
        html += `</div></div>`;
      }
      
      return html || this._renderMarkdown(content);
    } catch (e) {
      // JSON 解析失败，退回普通渲染
      console.warn('[ExpertSystem] Host JSON parse failed, fallback to markdown:', e);
      return this._renderMarkdown(content);
    }
  },

  /**
   * 🔧 修复3：检测专家消息中的文件链接，转换为文件卡片（保存/打开按钮）
   * 支持格式：Markdown [name](url) 或裸 URL（含文件扩展名）
   */
  _bindExpertFileLinks(contentEl) {
    const msgTextEl = contentEl.querySelector('.expert-msg-text');
    if (!msgTextEl) return;

    // 查找所有 <a> 标签（由 _renderMarkdown 或 Markdown 渲染生成）
    const links = msgTextEl.querySelectorAll('a');
    const fileExtensions = /\.(html?|pdf|xlsx?|docx?|pptx?|csv|png|jpe?g|gif|svg|zip|rar|json|xml|txt|md|mp[34]|wav|py|js|ts|css)$/i;
    const fileLinks = [];

    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      const text = link.textContent || '';
      if (fileExtensions.test(href) || fileExtensions.test(text)) {
        fileLinks.push({ el: link, url: href, name: text || href.split('/').pop() || '文件' });
      }
    });

    if (fileLinks.length === 0) return;

    // 创建文件卡片区域
    const filesContainer = document.createElement('div');
    filesContainer.className = 'adp-files-section expert-files-section';
    
    for (const fl of fileLinks) {
      const fn = fl.name.split('/').pop() || '文件';
      const ext = fn.split('.').pop()?.toLowerCase();
      const iconMap = { html: '🌐', htm: '🌐', pdf: '📖', xlsx: '📊', xls: '📊', docx: '📝', doc: '📝', pptx: '📊', ppt: '📊', csv: '📋', png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', svg: '🖼', zip: '📦', json: '📋', md: '📄', txt: '📄', mp3: '🎵', mp4: '🎬' };
      const ic = iconMap[ext] || '📄';
      
      const card = document.createElement('div');
      card.className = 'adp-file-card';
      card.dataset.url = fl.url;
      card.dataset.name = fn;
      card.innerHTML = `<span class="adp-file-icon">${ic}</span><span class="adp-file-name">${this._escapeHtml(fn)}</span><span class="adp-file-save-btn" data-action="save">💾 保存</span><span class="adp-file-open-btn" data-action="open">↗ 打开</span>`;
      filesContainer.appendChild(card);
      
      // 隐藏原始链接文字
      fl.el.style.display = 'none';
    }

    msgTextEl.appendChild(filesContainer);

    // 绑定文件卡片按钮事件
    const App = window.App;
    if (App?._bindFileCardActions) {
      App._bindFileCardActions(filesContainer);
    }
  },

  _renderMarkdown(text) {
    if (!text) return '';
    let html = this._escapeHtml(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 渲染 Markdown 链接 [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/\n/g, '<br>');
    return html;
  },

  // 费用提醒弹窗
  _showCostReminder(callCount, expertCount) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'expert-modal-overlay';
      overlay.innerHTML = `
        <div class="expert-modal cost-reminder-modal">
          <div class="expert-modal-header">
            <h3>⚠️ 费用提醒</h3>
          </div>
          <div class="expert-modal-body">
            <p>此群聊将调用 <strong>${expertCount}</strong> 位专家：</p>
            <div class="cost-breakdown">
              <div class="cost-item">1 次主持人分析</div>
              <div class="cost-item">${expertCount - 1} 次专家调用</div>
              <div class="cost-item">1 次主持人汇总</div>
              <div class="cost-total">= 共 <strong>${callCount}</strong> 次 AI 调用</div>
            </div>
            <p style="font-size:12px;color:var(--text-tertiary);margin-top:8px;">
              如需补充轮次，可能额外增加调用次数。
            </p>
            <label class="cost-no-reminder">
              <input type="checkbox" id="costNoReminder"> 本会话不再提醒
            </label>
          </div>
          <div class="expert-modal-footer">
            <button class="btn secondary" id="costCancelBtn">取消</button>
            <button class="btn primary" id="costConfirmBtn">继续，我了解了</button>
          </div>
        </div>`;
      
      document.body.appendChild(overlay);
      
      overlay.querySelector('#costCancelBtn').onclick = () => {
        overlay.remove();
        resolve(false);
      };
      overlay.querySelector('#costConfirmBtn').onclick = () => {
        const noReminder = document.getElementById('costNoReminder')?.checked;
        if (noReminder) this._groupChatNoMoreReminder = true;
        overlay.remove();
        resolve(true);
      };
    });
  },

  // 后台任务指示器
  showBackgroundIndicator(status) {
    let indicator = document.getElementById('expertBackgroundIndicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'expertBackgroundIndicator';
      indicator.className = 'expert-background-indicator';
      document.body.appendChild(indicator);
    }
    indicator.innerHTML = `
      <div class="background-indicator-content">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span>专家团正在后台处理...</span>
        <span class="background-indicator-status">${this._escapeHtml(status || '')}</span>
      </div>`;
    indicator.style.display = 'flex';
  },

  hideBackgroundIndicator() {
    const indicator = document.getElementById('expertBackgroundIndicator');
    if (indicator) indicator.style.display = 'none';
  },

  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

// 导出为全局对象
window.ExpertSystem = ExpertSystem;
