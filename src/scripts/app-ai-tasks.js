/**
 * AI 小助手任务模块 — 从 app.js 提取
 * 包含：定时任务调度、本地上下文检索与注入、任务执行
 * 通过 Object.assign 合并到 App 对象
 */
Object.assign(App, {
  _aiTaskTimers: {},

  /** AI 小助手任务：注册定时执行 */
  _scheduleAITask(task) {
    if (!task.dueDate || task.taskType !== 'ai_scheduled') return;

    const currentTask = Store.getTasks().find(t => t.id === task.id);
    if (!currentTask || currentTask.status === 'completed') {
      console.log(`[AI Task] Task "${task.title}" already completed or deleted, skip scheduling`);
      return;
    }

    const dueDate = new Date(currentTask.dueDate);
    const now = new Date();
    const delay = dueDate.getTime() - now.getTime();

    if (delay <= 0) {
      const overdueMs = -delay;
      const overdueMinutes = Math.round(overdueMs / 60000);
      console.log(`[AI Task] Task "${currentTask.title}" is ${overdueMinutes}min overdue, marking as overdue instead of auto-executing`);

      if (overdueMinutes <= 5) {
        this._executeAITask(currentTask);
      } else {
        this.showToast(`AI 任务「${currentTask.title}」已过期 ${overdueMinutes} 分钟，请手动执行`, 'warning');
      }
      return;
    }

    if (this._aiTaskTimers[task.id]) {
      clearTimeout(this._aiTaskTimers[task.id]);
    }

    const maxDelay = 24 * 60 * 60 * 1000;
    const actualDelay = Math.min(delay, maxDelay);

    this._aiTaskTimers[task.id] = setTimeout(() => {
      const latestTask = Store.getTasks().find(t => t.id === task.id);
      if (!latestTask || latestTask.status === 'completed') return;

      if (latestTask.taskType === 'ai_scheduled') {
        const remaining = new Date(latestTask.dueDate).getTime() - Date.now();
        if (remaining <= 60000) {
          this._executeAITask(latestTask);
        } else {
          this._scheduleAITask(latestTask);
        }
      }
    }, actualDelay);

    console.log(`[AI Task] Scheduled task "${currentTask.title}" in ${Math.round(actualDelay / 60000)} minutes`);
  },

  /**
   * 本地上下文注入：检索本地数据并组装 SystemRole
   */
  async _retrieveLocalContext(classification) {
    const sources = [];
    const parts = [];

    const filterByTimeRange = (items, timeRange, dateField = 'createdAt') => {
      if (timeRange === 'all') return items;
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart.getTime() + 86400000);

      let rangeStart, rangeEnd;
      switch (timeRange) {
        case 'today':
          rangeStart = todayStart; rangeEnd = todayEnd; break;
        case 'yesterday':
          rangeStart = new Date(todayStart.getTime() - 86400000); rangeEnd = todayStart; break;
        case 'tomorrow':
          rangeStart = todayEnd; rangeEnd = new Date(todayEnd.getTime() + 86400000); break;
        case 'this_week': {
          const day = now.getDay() || 7;
          rangeStart = new Date(todayStart.getTime() - (day - 1) * 86400000);
          rangeEnd = todayEnd; break;
        }
        case 'last_week': {
          const day = now.getDay() || 7;
          rangeEnd = new Date(todayStart.getTime() - (day - 1) * 86400000);
          rangeStart = new Date(rangeEnd.getTime() - 7 * 86400000); break;
        }
        case 'last_month': {
          rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          rangeEnd = new Date(now.getFullYear(), now.getMonth(), 1); break;
        }
        default: {
          const msMap = { '1d': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 };
          const ms = msMap[timeRange] || msMap['7d'];
          rangeStart = new Date(now.getTime() - ms);
          rangeEnd = now; break;
        }
      }

      return items.filter(item => {
        const dateFieldToUse = dateField || 'createdAt';
        const d = new Date(item[dateFieldToUse]);
        if (isNaN(d)) return false;
        return d >= rangeStart && d < rangeEnd;
      });
    };

    const filterTasksByTimeRange = (tasks, timeRange) => {
      if (timeRange === 'all') return tasks;
      if (timeRange === 'pending') return tasks.filter(t => t.status !== 'completed');
      if (timeRange === 'overdue') return tasks.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < new Date());
      if (timeRange === 'completed') return tasks.filter(t => t.status === 'completed');
      return filterByTimeRange(tasks, timeRange, 'dueDate');
    };

    const promises = {};

    if (classification?.need_notebook) {
      promises.notebook = (async () => {
        try {
          const query = classification.notebook_query || '';
          const result = await window.electronAPI.notebookSearch(query);
          let notes = result?.notes || [];
          if (classification.notebook_time_range) {
            notes = filterByTimeRange(notes, classification.notebook_time_range, 'createdAt');
          }
          return notes.slice(0, 5).map(n => ({
            title: n.title || '',
            content: (n.content || '').substring(0, 500),
            createdAt: n.createdAt
          }));
        } catch (e) { console.warn('[Context] notebook search failed:', e); return []; }
      })();
    }

    if (classification?.need_memory) {
      promises.memory = (async () => {
        try {
          const query = classification.memory_query || '';
          const result = await window.electronAPI.knowledgeSearchLocal({ query, limit: 5 });
          let memories = result?.results || result?.items || [];
          if (classification.memory_time_range) {
            memories = filterByTimeRange(memories, classification.memory_time_range, 'createdAt');
          }
          return memories.slice(0, 5).map(m => ({
            content: (m.content || m.text || '').substring(0, 300),
            category: m.category || '',
            createdAt: m.createdAt
          }));
        } catch (e) { console.warn('[Context] memory search failed:', e); return []; }
      })();
    }

    if (classification?.need_profile) {
      promises.profile = (async () => {
        try {
          const profile = await window.electronAPI.profile.get();
          return profile || {};
        } catch (e) { console.warn('[Context] profile get failed:', e); return {}; }
      })();
    }

    if (classification?.need_tasks) {
      promises.tasks = (async () => {
        try {
          const tasks = Store.getTasks();
          const filter = classification.task_filter || 'pending';
          let filtered;
          if (['today', 'yesterday', 'tomorrow', 'this_week', 'last_week'].includes(filter)) {
            filtered = filterTasksByTimeRange(tasks, filter);
          } else if (filter === 'pending') {
            filtered = tasks.filter(t => t.status !== 'completed');
          } else if (filter === 'overdue') {
            filtered = tasks.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < new Date());
          } else if (filter === 'completed') {
            filtered = tasks.filter(t => t.status === 'completed');
          } else {
            filtered = tasks;
          }
          if (classification.task_time_range && classification.task_time_range !== filter) {
            filtered = filterTasksByTimeRange(filtered, classification.task_time_range);
          }
          return filtered.slice(0, 10).map(t => ({
            title: t.title || '',
            description: (t.description || '').substring(0, 200),
            dueDate: t.dueDate || '',
            priority: t.priority || 'medium',
            status: t.status || 'pending'
          }));
        } catch (e) { console.warn('[Context] tasks get failed:', e); return []; }
      })();
    }

    if (classification?.need_knowledge) {
      promises.knowledge = (async () => {
        try {
          const query = classification.knowledge_query || '';
          const limit = classification.knowledge_limit || 3;
          const result = await window.electronAPI.knowledgeGetArticles({});
          let articles = result?.articles || [];
          if (query) {
            const q = query.toLowerCase();
            articles = articles.filter(a =>
              (a.title || '').toLowerCase().includes(q) ||
              (a.content || '').toLowerCase().includes(q) ||
              (a.summary || '').toLowerCase().includes(q)
            );
          }
          if (classification.knowledge_time_range) {
            articles = filterByTimeRange(articles, classification.knowledge_time_range, 'createdAt');
          }
          return articles.slice(0, limit).map(a => ({
            title: a.title || '',
            content: (a.content || a.summary || '').substring(0, 300),
            domain: a.domain || '',
            createdAt: a.createdAt
          }));
        } catch (e) { console.warn('[Context] knowledge get failed:', e); return []; }
      })();
    }

    if (classification?.need_relationship) {
      promises.relationship = (async () => {
        try {
          const result = await window.electronAPI.relationshipGetAll();
          const allPersons = result?.persons || [];
          const allRelations = result?.relations || [];

          const personNames = classification.relationship_person_names || [];
          let persons = allPersons;
          if (personNames.length > 0) {
            const nameSet = new Set(personNames.map(n => n.toLowerCase()));
            persons = allPersons.filter(p => nameSet.has(p.name.toLowerCase()));
            const relatedNames = new Set(personNames);
            allRelations.forEach(r => {
              if (nameSet.has(r.source.toLowerCase())) relatedNames.add(r.target);
              if (nameSet.has(r.target.toLowerCase())) relatedNames.add(r.source);
            });
            persons = allPersons.filter(p => relatedNames.has(p.name));
          }

          return {
            persons: persons.slice(0, 8).map(p => ({
              name: p.name || '',
              role: p.role || '',
              company: p.company || '',
              projects: p.projects || [],
              relation: p.profileRelation || p.relation_to_user || '',
              interactionCount: p.interactionCount || 0,
              recentMemories: (p.recentMemories || []).slice(0, 2).map(m => m.content?.substring(0, 80))
            })),
            relations: allRelations.filter(r =>
              persons.some(p => p.name === r.source) || persons.some(p => p.name === r.target)
            ).slice(0, 10).map(r => ({
              source: r.source,
              target: r.target,
              type: r.type || '',
              label: r.label || '',
              strength: r.strength
            }))
          };
        } catch (e) { console.warn('[Context] relationship get failed:', e); return { persons: [], relations: [] }; }
      })();
    }

    const results = {};
    await Promise.all(
      Object.entries(promises).map(async ([key, promise]) => {
        try { results[key] = await promise; } catch (e) { results[key] = null; }
      })
    );

    if (results.notebook?.length) {
      sources.push(`记事本×${results.notebook.length}`);
      parts.push('【记事本】\n' + results.notebook.map((n, i) =>
        `${i + 1}. ${n.title}\n${n.content}`
      ).join('\n'));
    }

    if (results.memory?.length) {
      sources.push(`记忆×${results.memory.length}`);
      parts.push('【记忆】\n' + results.memory.map((m, i) =>
        `${i + 1}. ${m.category ? `[${m.category}] ` : ''}${m.content}`
      ).join('\n'));
    }

    if (results.profile && Object.keys(results.profile).length > 0) {
      sources.push('画像');
      const p = results.profile;
      const profileParts = [];
      if (p.name) profileParts.push(`姓名: ${p.name}`);
      if (p.role) profileParts.push(`角色: ${p.role}`);
      if (p.company) profileParts.push(`公司: ${p.company}`);
      if (p.projects?.length) profileParts.push(`项目: ${p.projects.join(', ')}`);
      if (p.skills?.length) profileParts.push(`技能: ${p.skills.join(', ')}`);
      if (p.preferences) profileParts.push(`偏好: ${typeof p.preferences === 'string' ? p.preferences : JSON.stringify(p.preferences)}`);
      if (profileParts.length) parts.push('【用户画像】\n' + profileParts.join('\n'));
    }

    if (results.tasks?.length) {
      sources.push(`任务×${results.tasks.length}`);
      parts.push('【待办任务】\n' + results.tasks.map((t, i) => {
        let line = `${i + 1}. ${t.title}${t.dueDate ? ` (截止: ${t.dueDate.substring(0, 16).replace('T', ' ')})` : ''} [${t.priority}/${t.status}]`;
        if (t.description) line += `\n   备注: ${t.description}`;
        return line;
      }).join('\n'));
    }

    if (results.knowledge?.length) {
      sources.push(`知识×${results.knowledge.length}`);
      parts.push('【知识文章】\n' + results.knowledge.map((k, i) =>
        `${i + 1}. ${k.title}${k.domain ? ` [${k.domain}]` : ''}\n${k.content}`
      ).join('\n'));
    }

    if (results.relationship?.persons?.length) {
      sources.push(`人脉×${results.relationship.persons.length}`);
      const relParts = ['【人脉图谱】'];
      relParts.push('### 人物信息');
      results.relationship.persons.forEach((p, i) => {
        let line = `${i + 1}. **${p.name}**`;
        if (p.role) line += ` · ${p.role}`;
        if (p.company) line += ` @ ${p.company}`;
        if (p.relation) line += ` (与用户: ${p.relation})`;
        if (p.projects?.length) line += ` [项目: ${p.projects.join('/')}]`;
        if (p.interactionCount) line += ` (${p.interactionCount}次交互)`;
        relParts.push(line);
        if (p.recentMemories?.length) {
          p.recentMemories.forEach(m => relParts.push(`   - ${m}`));
        }
      });
      if (results.relationship.relations?.length) {
        relParts.push('### 人物关系');
        results.relationship.relations.forEach(r => {
          const strength = r.strength ? ` (强度${r.strength.toFixed(1)})` : '';
          relParts.push(`- ${r.source} ↔ ${r.target}: ${r.label || r.type}${strength}`);
        });
      }
      parts.push(relParts.join('\n'));
    }

    let systemRole = parts.join('\n\n');
    const MAX_CHARS = 6000;
    if (systemRole.length > MAX_CHARS) {
      systemRole = systemRole.substring(0, MAX_CHARS) + '\n...(上下文过长，已截断)';
    }

    if (systemRole) {
      systemRole = `[用户本地上下文]\n${systemRole}\n\n请基于以上用户上下文回答问题。如果上下文中没有相关信息，请如实说明。`;
    }

    return { systemRole, sources };
  },

  async _retrieveLocalContextFallback() {
    const sources = [];
    const parts = [];

    try {
      const profile = await window.electronAPI.profile.get();
      if (profile && Object.keys(profile).length > 0) {
        sources.push('画像');
        const profileParts = [];
        if (profile.name) profileParts.push(`姓名: ${profile.name}`);
        if (profile.role) profileParts.push(`角色: ${profile.role}`);
        if (profile.company) profileParts.push(`公司: ${profile.company}`);
        if (profile.projects?.length) profileParts.push(`项目: ${profile.projects.join(', ')}`);
        if (profileParts.length) parts.push('【用户画像】\n' + profileParts.join('\n'));
      }
    } catch (e) { /* ignore */ }

    try {
      const tasks = Store.getTasks().filter(t => t.status !== 'completed').slice(0, 3);
      if (tasks.length) {
        sources.push(`任务×${tasks.length}`);
        parts.push('【待办任务】\n' + tasks.map((t, i) =>
          `${i + 1}. ${t.title}${t.dueDate ? ` (截止: ${t.dueDate.substring(0, 10)})` : ''}`
        ).join('\n'));
      }
    } catch (e) { /* ignore */ }

    let systemRole = parts.join('\n\n');
    if (systemRole) {
      systemRole = `[用户本地上下文]\n${systemRole}\n\n请基于以上用户上下文回答问题。如果上下文中没有相关信息，请如实说明。`;
    }
    return { systemRole, sources };
  },

  async _executeAITask(task) {
    console.log('[AI Task] Executing scheduled task:', task.title);

    const forcedClassification = {
      need_profile: true,
      need_tasks: true,
      task_filter: 'pending',
      task_time_range: '7d',
      need_notebook: true,
      notebook_query: '',
      notebook_time_range: 'today',
      need_memory: false,
      need_knowledge: false,
      need_relationship: false,
      intent_summary: `定时任务：${task.title}`
    };

    let localContextSystemRole = '';
    let localContextSources = [];
    try {
      const contextData = await this._retrieveLocalContext(forcedClassification);
      localContextSystemRole = contextData.systemRole;
      localContextSources = contextData.sources;
      console.log('[AI Task] Local context retrieved, sources:', localContextSources.join(', '));
    } catch (e) {
      console.warn('[AI Task] _retrieveLocalContext failed, trying fallback:', e.message);
      try {
        const fallbackData = await this._retrieveLocalContextFallback();
        localContextSystemRole = fallbackData.systemRole;
        localContextSources = fallbackData.sources;
      } catch (e2) {
        console.error('[AI Task] Fallback context also failed:', e2.message);
      }
    }

    // v3.1: 向量检索增强 — 用任务标题检索语义相关上下文
    if (window.electronAPI?.vectorRetrieveRAG) {
      try {
        const ragResult = await window.electronAPI.vectorRetrieveRAG({
          query: task.title,
          intent: forcedClassification,
          mode: 'scheduled',
        });
        if (ragResult.success && ragResult.context) {
          localContextSystemRole = localContextSystemRole
            ? `${localContextSystemRole}\n\n${ragResult.context}`
            : ragResult.context;
          localContextSources = [...localContextSources, ...(ragResult.sources?.map(s => `vector:${s.source_type}`) || [])];
          console.log('[AI Task] Vector RAG enhanced, sources:', ragResult.sources?.length || 0);
        }
      } catch (e) {
        console.warn('[AI Task] Vector RAG failed:', e.message);
      }
    }

    const basePrompt = task.description
      ? `${task.title}\n\n${task.description}`
      : task.title;

    this.showAIAssistantView();
    this.createNewChatSession();

    const session = this._chatSessions.find(s => s.id === this._activeSessionId);
    if (session) {
      session.taskType = 'scheduled';
      session.taskId = task.id;
      session.title = `⏰ ${task.title}`;
      if (task.expertId) {
        session.expertId = task.expertId;
        session.expertName = task.expertName || '';
      }
      this._saveChatSessions();
      this._renderChatSessionList();
    }

    const expertId = task.expertId;
    if (expertId && window.ExpertSystem) {
      const expert = window.ExpertSystem.getExpertById?.(expertId);
      if (expert) {
        window.ExpertSystem._activeExpertId = expertId;
        window.ExpertSystem._activeGroupId = null;
        window.ExpertSystem._groupChatActive = false;
        document.querySelectorAll('.feature-card').forEach(c => c.classList.remove('active'));
        const cardEl = document.querySelector(`.feature-card[data-type="expert"][data-id="${expertId}"]`);
        if (cardEl) cardEl.classList.add('active');
        if (typeof window.ExpertSystem._renderQuickAccess === 'function') {
          window.ExpertSystem._renderQuickAccess(expert.quickAccesses || []);
        }
        if (typeof window.ExpertSystem._updateChatHeader === 'function') {
          window.ExpertSystem._updateChatHeader(expert.name || 'AI 助手', false);
        }
        if (this._activeSessionId) {
          const curSession = this._chatSessions?.find(s => s.id === this._activeSessionId);
          if (curSession && !curSession.isGroupChat) {
            curSession.expertId = expertId;
            curSession.expertName = expert.name || '';
            curSession.taskType = 'scheduled';
            this._saveChatSessions?.();
          }
        }
      }
    } else {
      if (window.ExpertSystem) {
        window.ExpertSystem._activeExpertId = null;
        window.ExpertSystem._activeGroupId = null;
        document.querySelectorAll('.feature-card.active').forEach(c => c.classList.remove('active'));
        if (typeof window.ExpertSystem._renderQuickAccess === 'function') {
          window.ExpertSystem._renderQuickAccess(window.ExpertSystem._getDefaultQuickAccesses());
        }
        if (typeof window.ExpertSystem._updateChatHeader === 'function') {
          window.ExpertSystem._updateChatHeader('通用 AI 助手', false);
        }
      }
    }

    const input = document.getElementById('aiChatInput');
    if (input) {
      input.value = basePrompt;
    } else {
      console.error('[AI Task] Chat input not found, cannot send message');
      return;
    }

    try {
      await Promise.race([
        this.sendAIMessage(undefined, { systemRole: localContextSystemRole, sources: localContextSources }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI 响应超时（5分钟）')), 300000))
      ]);
    } catch (e) {
      console.error('[AI Task] sendAIMessage failed or timed out:', e);
      if (this._adpStreaming) this.stopADPGeneration();
    }

    Store.updateTask(task.id, {
      status: 'completed',
      completedAt: new Date().toISOString()
    });
    this.renderTaskList();
    Calendar.render();
  },

  _restoreAITaskSchedulers() {
    const tasks = Store.getTasks().filter(t =>
      t.status !== 'completed' &&
      t.taskType === 'ai_scheduled' &&
      t.dueDate
    );
    tasks.forEach(task => this._scheduleAITask(task));
    if (tasks.length > 0) {
      console.log(`[AI Task] Restored ${tasks.length} scheduled AI tasks`);
    }
  },

  async _buildAITaskLocalContext(task) {
    const parts = [];

    try {
      const profile = await window.electronAPI?.profile?.get?.();
      if (profile && Object.keys(profile).length > 0) {
        const profileParts = [];
        if (profile.name) profileParts.push(`姓名: ${profile.name}`);
        if (profile.role) profileParts.push(`角色: ${profile.role}`);
        if (profile.company) profileParts.push(`公司: ${profile.company}`);
        if (profile.projects?.length) profileParts.push(`项目: ${profile.projects.join(', ')}`);
        if (profileParts.length) parts.push('【用户画像】\n' + profileParts.join('\n'));
      }
    } catch (e) { /* ignore */ }

    try {
      const allTasks = Store.getTasks();
      const today = new Date().toISOString().split('T')[0];
      const todayTasks = allTasks.filter(t => {
        if (t.status === 'completed' || t.id === task.id) return false;
        if (!t.dueDate) return false;
        return t.dueDate.startsWith(today);
      });
      const pendingTasks = allTasks.filter(t => t.status !== 'completed' && t.id !== task.id).slice(0, 5);
      const taskList = todayTasks.length > 0 ? todayTasks : pendingTasks;
      if (taskList.length > 0) {
        parts.push('【当前待办任务】\n' + taskList.map((t, i) =>
          `${i + 1}. ${t.title}${t.dueDate ? ` (截止: ${t.dueDate.substring(0, 16).replace('T', ' ')})` : ''} [${t.priority || '中'}优先级]`
        ).join('\n'));
      }
    } catch (e) { /* ignore */ }

    try {
      const notes = Store.getNotes().slice(0, 3);
      if (notes.length > 0) {
        parts.push('【最近笔记】\n' + notes.map((n, i) =>
          `${i + 1}. ${n.title || '无标题'} (${n.createdAt?.substring(0, 10) || ''})`
        ).join('\n'));
      }
    } catch (e) { /* ignore */ }

    if (parts.length === 0) return '';
    return `[当前用户本地上下文]\n${parts.join('\n\n')}\n\n请基于以上上下文信息来回答用户的问题。`;
  },
});
