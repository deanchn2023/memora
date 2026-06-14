/**
 * Memora v2.6 专家设置面板
 * 管理专家和专家团的 CRUD 操作界面
 */
const ExpertSettings = {
  _editingExpert: null,
  _editingGroup: null,
  _dragState: null,  // 拖拽排序状态

  init() {
    this._bindEvents();
  },

  _bindEvents() {
    document.getElementById('addExpertBtn')?.addEventListener('click', () => this.showExpertEditor());
    document.getElementById('addGroupBtn')?.addEventListener('click', () => this.showGroupEditor());
    
    document.getElementById('expertList')?.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      const id = target.dataset.id;
      if (action === 'edit-expert') this.showExpertEditor(id);
      if (action === 'delete-expert') this.confirmDeleteExpert(id);
      if (action === 'set-host') this._setHostFromList(id);
    });
    
    document.getElementById('expertGroupList')?.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      const id = target.dataset.id;
      if (action === 'edit-group') this.showGroupEditor(id);
      if (action === 'delete-group') this.confirmDeleteGroup(id);
    });
    
    // 拖拽排序绑定
    this._bindDragSort('expertList', 'expert');
    this._bindDragSort('expertGroupList', 'group');
  },
  
  // ===== 拖拽排序 =====
  _bindDragSort(containerId, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.expert-list-item');
      if (!item) return;
      this._dragState = { type, draggedId: item.dataset.id, draggedEl: item };
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.id);
    });
    
    container.addEventListener('dragend', (e) => {
      const item = e.target.closest('.expert-list-item');
      if (item) item.classList.remove('dragging');
      container.querySelectorAll('.expert-list-item').forEach(el => el.classList.remove('drag-over'));
      this._dragState = null;
    });
    
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('.expert-list-item');
      if (!target || target === this._dragState?.draggedEl) return;
      container.querySelectorAll('.expert-list-item').forEach(el => el.classList.remove('drag-over'));
      target.classList.add('drag-over');
    });
    
    container.addEventListener('dragleave', (e) => {
      const target = e.target.closest('.expert-list-item');
      if (target) target.classList.remove('drag-over');
    });
    
    container.addEventListener('drop', async (e) => {
      e.preventDefault();
      const target = e.target.closest('.expert-list-item');
      if (!target || !this._dragState) return;
      target.classList.remove('drag-over');
      
      const items = Array.from(container.querySelectorAll('.expert-list-item'));
      const fromIdx = items.findIndex(el => el.dataset.id === this._dragState.draggedId);
      const toIdx = items.findIndex(el => el === target);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
      
      // 重新排列 DOM
      const orderedIds = items.map(el => el.dataset.id);
      const [moved] = orderedIds.splice(fromIdx, 1);
      orderedIds.splice(toIdx, 0, moved);
      
      // 保存排序
      if (type === 'expert') {
        await window.ExpertSystem?.reorderExperts?.(orderedIds);
      } else {
        await window.ExpertSystem?.reorderGroups?.(orderedIds);
      }
      this.render();
    });
  },
  
  // 从专家列表设置主持人
  _setHostFromList(expertId) {
    // 找到包含该专家的所有专家团，弹出选择框
    const groups = window.ExpertSystem?.getGroups?.() || [];
    const groupsWithExpert = groups.filter(g => (g.expertIds || []).includes(expertId));
    if (groupsWithExpert.length === 0) {
      this._toast('该专家未加入任何专家团');
      return;
    }
    if (groupsWithExpert.length === 1) {
      // 只有一个团，直接设置
      const group = groupsWithExpert[0];
      group.hostExpertId = expertId;
      window.ExpertSystem?.saveGroup?.(group).then(() => {
        this._toast(`已将 ${window.ExpertSystem.getExpertById(expertId)?.name} 设为「${group.name}」主持人`, 'success');
        this.render();
      });
      return;
    }
    // 多个团，选择设置哪个
    const overlay = document.createElement('div');
    overlay.className = 'expert-modal-overlay';
    overlay.id = 'setHostOverlay';
    overlay.innerHTML = `
      <div class="expert-modal" style="max-width:360px">
        <div class="expert-modal-header"><h3>选择专家团</h3><button class="modal-close" onclick="document.getElementById('setHostOverlay').remove()">×</button></div>
        <div class="expert-modal-body">
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">将 <strong>${this._esc(window.ExpertSystem.getExpertById(expertId)?.name)}</strong> 设为以下专家团的主持人：</p>
          ${groupsWithExpert.map(g => `<button class="btn secondary" style="width:100%;margin-bottom:6px;text-align:left" data-gid="${g.id}">${g.icon} ${this._esc(g.name)}</button>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-gid]').forEach(btn => btn.addEventListener('click', async (e) => {
      const gid = e.target.dataset.gid;
      const group = groupsWithExpert.find(g => g.id === gid);
      if (group) {
        group.hostExpertId = expertId;
        await window.ExpertSystem?.saveGroup?.(group);
        this._toast(`已设为「${group.name}」主持人`, 'success');
        this.render();
      }
      overlay.remove();
    }));
  },

  async render() {
    await window.ExpertSystem?._loadFromStore?.();
    this._renderExpertList();
    this._renderGroupList();
    this._renderPreview();
  },

  _renderExpertList() {
    const container = document.getElementById('expertList');
    if (!container) return;
    const experts = window.ExpertSystem?.getExperts?.() || [];
    if (experts.length === 0) {
      container.innerHTML = '<div class="expert-empty">暂无专家，点击上方"新增"添加</div>';
      return;
    }
    container.innerHTML = experts.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map(expert => {
      const isHostInAnyGroup = (window.ExpertSystem?.getGroups?.() || []).some(g => g.hostExpertId === expert.id);
      return `
      <div class="expert-list-item" draggable="true" data-id="${expert.id}">
        <div class="drag-handle" title="拖拽排序">⠿</div>
        <div class="expert-item-info">
          <span class="expert-item-icon">${expert.icon || '🤖'}</span>
          <div class="expert-item-text">
          <div class="expert-item-name">${this._esc(expert.name)}${isHostInAnyGroup ? '<span class="host-indicator">⭐ 主持人</span>' : ''}${expert.expertType && expert.expertType !== 'claw' ? `<span class="strategy-tag" style="margin-left:4px">${expert.expertType}</span>` : ''}</div>
          <div class="expert-item-intro">${this._esc(expert.intro || '')}</div>
            <div class="expert-item-qa">${(expert.quickAccesses || []).map(qa => `<span class="qa-tag">${qa.icon || '💬'} ${this._esc(qa.label)}</span>`).join('')}</div>
          </div>
        </div>
        <div class="expert-item-actions">
          <button class="btn-icon" data-action="set-host" data-id="${expert.id}" title="设为主持人">⭐</button>
          <button class="btn-icon" data-action="edit-expert" data-id="${expert.id}" title="编辑">✏️</button>
          <button class="btn-icon danger" data-action="delete-expert" data-id="${expert.id}" title="删除">🗑️</button>
        </div>
      </div>`;
    }).join('');
  },

  _renderGroupList() {
    const container = document.getElementById('expertGroupList');
    if (!container) return;
    const groups = window.ExpertSystem?.getGroups?.() || [];
    if (groups.length === 0) {
      container.innerHTML = '<div class="expert-empty">暂无专家团，点击上方"新增"添加</div>';
      return;
    }
    container.innerHTML = groups.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map(group => {
      const host = window.ExpertSystem?.getExpertById?.(group.hostExpertId);
      const members = (group.expertIds || []).map(id => window.ExpertSystem?.getExpertById?.(id)).filter(Boolean);
      const strategy = group.executionStrategy || 'serial';
      return `
        <div class="expert-list-item group-item" draggable="true" data-id="${group.id}">
          <div class="drag-handle" title="拖拽排序">⠿</div>
          <div class="expert-item-info">
            <span class="expert-item-icon">${group.icon || '🏆'}</span>
            <div class="expert-item-text">
              <div class="expert-item-name">${this._esc(group.name)}</div>
              <div class="expert-item-intro">${this._esc(group.intro || '')}</div>
              <div class="expert-item-members">
                ${host ? `<span class="host-tag">⭐ ${host.icon} ${this._esc(host.name)}</span>` : '<span class="host-tag" style="color:#FF3B30">未设主持人</span>'}
                <span class="member-icons">成员：${members.map(m => m.icon).join(' ')}</span>
                <span class="strategy-tag">${strategy === 'parallel' ? '⚡并行' : '🔄串行'}</span>
              </div>
              <div class="expert-item-qa">${(group.quickAccesses || []).map(qa => `<span class="qa-tag">${qa.icon || '💬'} ${this._esc(qa.label)}</span>`).join('')}</div>
            </div>
          </div>
          <div class="expert-item-actions">
            <button class="btn-icon" data-action="edit-group" data-id="${group.id}" title="编辑">✏️</button>
            <button class="btn-icon danger" data-action="delete-group" data-id="${group.id}" title="删除">🗑️</button>
          </div>
        </div>`;
    }).join('');
  },

  _renderPreview() {
    const container = document.getElementById('expertPreview');
    if (!container) return;
    const experts = window.ExpertSystem?.getExperts?.() || [];
    const groups = window.ExpertSystem?.getGroups?.() || [];
    const all = [...experts.map(e => ({ ...e, _type: 'expert' })), ...groups.map(g => ({ ...g, _type: 'group' }))]
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    if (all.length === 0) { container.innerHTML = '<div class="expert-empty">添加专家后这里会显示预览</div>'; return; }
    container.innerHTML = all.map(item => {
      if (item._type === 'expert') {
        return `<div class="preview-card"><span class="preview-icon">${item.icon}</span><div class="preview-name">${this._esc(item.name)}</div><div class="preview-badge expert">专家</div></div>`;
      }
      const avatars = (item.expertIds || []).slice(0, 3).map(id => { const e = window.ExpertSystem?.getExpertById?.(id); return e ? e.icon : ''; }).join('');
      return `<div class="preview-card"><span class="preview-icon">${item.icon}</span><div class="preview-name">${this._esc(item.name)}</div><div class="preview-avatars">${avatars}</div><div class="preview-badge group">专家团</div></div>`;
    }).join('');
  },

  // ===== 专家编辑器 =====
  showExpertEditor(expertId) {
    const expert = expertId ? window.ExpertSystem?.getExpertById?.(expertId) : null;
    this._editingExpert = expert ? { ...expert } : { name: '', intro: '', icon: '🤖', adpUrl: '', appKey: '', expertType: 'claw', quickAccesses: [] };
    const _e = this._editingExpert;

    const overlay = document.createElement('div');
    overlay.className = 'expert-modal-overlay';
    overlay.id = 'expertEditorOverlay';
    overlay.innerHTML = `
      <div class="expert-modal">
        <div class="expert-modal-header"><h3>${expert ? '编辑专家' : '新增专家'}</h3><button class="modal-close" id="closeExpertEditor">×</button></div>
        <div class="expert-modal-body">
          <div class="form-row">
            <div class="form-group" style="width:80px"><label>图标</label><div class="icon-picker" id="expertIconPicker"><span id="expertIconDisplay">${_e.icon}</span></div></div>
            <div class="form-group" style="flex:1"><label>名称</label><input type="text" id="expertNameInput" value="${this._esc(_e.name)}" placeholder="专家名称" maxlength="20"></div>
          </div>
          <div class="form-group"><label>介绍</label><input type="text" id="expertIntroInput" value="${this._esc(_e.intro)}" placeholder="一句话介绍" maxlength="50"></div>
          <h4 class="settings-section-title" style="margin-top:16px">🏷️ 专家类型</h4>
          <div class="form-group">
            <label>对话模式</label>
            <select id="expertTypeInput" style="width:100%">
              <option value="claw" ${(!_e.expertType || _e.expertType === 'claw') ? 'selected' : ''}>🦀 Claw 模式（默认）</option>
              <option value="standard" ${_e.expertType === 'standard' ? 'selected' : ''} disabled>📋 标准模式（暂不支持）</option>
              <option value="workflow" ${_e.expertType === 'workflow' ? 'selected' : ''} disabled>🔄 工作流模式（暂不支持）</option>
              <option value="multiagent" ${_e.expertType === 'multiagent' ? 'selected' : ''} disabled>🤝 MultiAgent 模式（暂不支持）</option>
            </select>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">Claw 模式支持文档对话和工具调用，其他模式开发中</div>
          </div>
          <h4 class="settings-section-title" style="margin-top:16px">🔌 ADP 配置</h4>
          <div class="form-group"><label>访问地址 <small style="color:var(--text-tertiary)">留空用默认</small></label><input type="text" id="expertAdpUrlInput" value="${this._esc(_e.adpUrl)}" placeholder="https://wss.lke.cloud.tencent.com/adp/v2/chat"></div>
          <div class="form-group"><label>AppKey <small style="color:var(--text-tertiary)">必填</small></label><input type="password" id="expertAppKeyInput" value="${this._esc(_e.appKey)}" placeholder="ADP AppKey"></div>
          <h4 class="settings-section-title" style="margin-top:16px">⚡ 快捷访问</h4>
          <div id="expertQAEditor"></div>
          <button class="btn secondary" id="addExpertQABtn" style="margin-top:8px">+ 添加快捷访问</button>
        </div>
        <div class="expert-modal-footer"><button class="btn secondary" id="cancelExpertBtn">取消</button><button class="btn primary" id="saveExpertBtn">保存</button></div>
      </div>`;
    document.body.appendChild(overlay);
    this._renderQAEditor(_e.quickAccesses || [], 'expertQAEditor');
    document.getElementById('closeExpertEditor')?.addEventListener('click', () => this._closeOverlay('expertEditorOverlay'));
    document.getElementById('cancelExpertBtn')?.addEventListener('click', () => this._closeOverlay('expertEditorOverlay'));
    document.getElementById('saveExpertBtn')?.addEventListener('click', () => this._saveExpert());
    document.getElementById('addExpertQABtn')?.addEventListener('click', () => this._addQARow('expertQAEditor'));
    document.getElementById('expertIconPicker')?.addEventListener('click', () => this._showEmojiPicker('expertIconDisplay'));
  },

  async _saveExpert() {
    const name = document.getElementById('expertNameInput')?.value?.trim();
    if (!name) { this._toast('请输入专家名称'); return; }
    const appKey = document.getElementById('expertAppKeyInput')?.value?.trim();
    if (!appKey) { this._toast('请输入 AppKey'); return; }
    const expert = {
      ...this._editingExpert,
      name, appKey,
      intro: document.getElementById('expertIntroInput')?.value?.trim() || '',
      icon: document.getElementById('expertIconDisplay')?.textContent || '🤖',
      adpUrl: document.getElementById('expertAdpUrlInput')?.value?.trim() || '',
      expertType: document.getElementById('expertTypeInput')?.value || 'claw',
      quickAccesses: this._collectQA('expertQAEditor')
    };
    const result = await window.ExpertSystem?.saveExpert?.(expert);
    if (result?.success) { this._toast('保存成功', 'success'); this._closeOverlay('expertEditorOverlay'); this.render(); }
    else { this._toast('保存失败', 'error'); }
  },

  async confirmDeleteExpert(id) {
    const e = window.ExpertSystem?.getExpertById?.(id);
    if (!e) return;
    if (!confirm(`确定删除专家「${e.name}」吗？`)) return;
    const result = await window.ExpertSystem?.deleteExpert?.(id);
    if (result?.success) { this._toast('已删除', 'success'); this.render(); }
  },

  // ===== 专家团编辑器 =====
  showGroupEditor(groupId) {
    const experts = window.ExpertSystem?.getExperts?.() || [];
    if (experts.length < 2) { this._toast('至少需要2个专家才能创建专家团'); return; }
    const group = groupId ? window.ExpertSystem?.getGroupById?.(groupId) : null;
    this._editingGroup = group ? { ...group } : { name: '', intro: '', icon: '🏆', expertIds: [], hostExpertId: '', hostPrompt: '', maxMembers: 5, quickAccesses: [] };
    const _g = this._editingGroup;

    const overlay = document.createElement('div');
    overlay.className = 'expert-modal-overlay';
    overlay.id = 'groupEditorOverlay';
    overlay.innerHTML = `
      <div class="expert-modal group-editor-modal">
        <div class="expert-modal-header"><h3>${group ? '编辑专家团' : '新增专家团'}</h3><button class="modal-close" id="closeGroupEditor">×</button></div>
        <div class="expert-modal-body">
          <div class="form-row">
            <div class="form-group" style="width:80px"><label>图标</label><div class="icon-picker" id="groupIconPicker"><span id="groupIconDisplay">${_g.icon}</span></div></div>
            <div class="form-group" style="flex:1"><label>名称</label><input type="text" id="groupNameInput" value="${this._esc(_g.name)}" placeholder="专家团名称" maxlength="20"></div>
          </div>
          <div class="form-group"><label>介绍</label><input type="text" id="groupIntroInput" value="${this._esc(_g.intro)}" placeholder="一句话介绍" maxlength="50"></div>
          <h4 class="settings-section-title" style="margin-top:16px">👥 成员配置</h4>
          <div id="groupMemberEditor"></div>
          <h4 class="settings-section-title" style="margin-top:16px">⚙️ 高级设置</h4>
          <div class="form-group"><label>最大成员数</label><select id="groupMaxMembers">${[2,3,4,5].map(n => `<option value="${n}" ${_g.maxMembers === n ? 'selected' : ''}>${n} 人</option>`).join('')}</select></div>
          <div class="form-group"><label>执行策略</label>
            <div class="strategy-selector">
              <label class="strategy-option ${(_g.executionStrategy || 'serial') === 'serial' ? 'active' : ''}">
                <input type="radio" name="execStrategy" value="serial" ${(_g.executionStrategy || 'serial') === 'serial' ? 'checked' : ''}>
                <span class="strategy-label">🔄 串行</span>
                <span class="strategy-desc">按顺序执行，便于控制上下文</span>
              </label>
              <label class="strategy-option ${_g.executionStrategy === 'parallel' ? 'active' : ''}">
                <input type="radio" name="execStrategy" value="parallel" ${_g.executionStrategy === 'parallel' ? 'checked' : ''}>
                <span class="strategy-label">⚡ 并行</span>
                <span class="strategy-desc">同时调用，更快但不可交叉引用</span>
              </label>
            </div>
          </div>
          <div class="form-group"><label>主持人 Prompt <small style="color:var(--text-tertiary)">根据成员自动组装，可 AI 优化</small></label><textarea id="groupHostPromptInput" rows="6" placeholder="填写名称、选择成员后自动组装...">${this._esc(_g.hostPrompt || '')}</textarea><div style="display:flex;gap:6px;margin-top:6px"><button class="btn secondary" id="regenerateHostPromptBtn" style="font-size:12px;padding:4px 10px">🔄 重新组装</button><button class="btn secondary" id="aiOptimizeHostPromptBtn" style="font-size:12px;padding:4px 10px">✨ AI 优化</button></div></div>
          <h4 class="settings-section-title" style="margin-top:16px">⚡ 快捷访问</h4>
          <div id="groupQAEditor"></div>
          <button class="btn secondary" id="addGroupQABtn" style="margin-top:8px">+ 添加快捷访问</button>
        </div>
        <div class="expert-modal-footer"><button class="btn secondary" id="cancelGroupBtn">取消</button><button class="btn primary" id="saveGroupBtn">保存</button></div>
      </div>`;
    document.body.appendChild(overlay);
    this._renderMemberEditor(experts);
    this._renderQAEditor(_g.quickAccesses || [], 'groupQAEditor');
    document.getElementById('closeGroupEditor')?.addEventListener('click', () => this._closeOverlay('groupEditorOverlay'));
    document.getElementById('cancelGroupBtn')?.addEventListener('click', () => this._closeOverlay('groupEditorOverlay'));
    document.getElementById('saveGroupBtn')?.addEventListener('click', () => this._saveGroup());
    document.getElementById('addGroupQABtn')?.addEventListener('click', () => this._addQARow('groupQAEditor'));
    document.getElementById('groupIconPicker')?.addEventListener('click', () => this._showEmojiPicker('groupIconDisplay'));
    document.getElementById('regenerateHostPromptBtn')?.addEventListener('click', () => this._assembleHostPrompt(true));
    document.getElementById('aiOptimizeHostPromptBtn')?.addEventListener('click', () => this._aiOptimizeHostPrompt());
    // 监听 hostPrompt 手动编辑
    this._hostPromptManuallyEdited = false;
    document.getElementById('groupHostPromptInput')?.addEventListener('input', () => { this._hostPromptManuallyEdited = true; });
    // 监听群名/介绍/策略变化 → 自动组装
    document.getElementById('groupNameInput')?.addEventListener('input', () => this._onGroupConfigChange());
    document.getElementById('groupIntroInput')?.addEventListener('input', () => this._onGroupConfigChange());
    document.querySelectorAll('input[name="execStrategy"]').forEach(r => r.addEventListener('change', () => this._onGroupConfigChange()));
    // 初始化时如果有足够成员，自动组装一次
    if (_g.expertIds?.length >= 2 && _g.hostExpertId && !_g.hostPrompt) {
      setTimeout(() => this._assembleHostPrompt(false), 100);
    }
  },

  _renderMemberEditor(experts) {
    const container = document.getElementById('groupMemberEditor');
    if (!container) return;
    const selectedIds = this._editingGroup.expertIds || [];
    const maxMembers = this._editingGroup.maxMembers || 5;
    // 如果没有主持人但已有选中成员，自动设置第一个为主持人
    if (!this._editingGroup.hostExpertId && selectedIds.length > 0) {
      this._editingGroup.hostExpertId = selectedIds[0];
    }
    container.innerHTML = experts.map(expert => {
      const isSelected = selectedIds.includes(expert.id);
      const isHost = this._editingGroup.hostExpertId === expert.id;
      return `<div class="member-row ${isSelected ? 'selected' : ''}" data-expert-row="${expert.id}">
        <label class="member-checkbox"><input type="checkbox" ${isSelected ? 'checked' : ''} data-mid="${expert.id}" ${!isSelected && selectedIds.length >= maxMembers ? 'disabled' : ''}><span class="member-icon">${expert.icon}</span><span class="member-name">${this._esc(expert.name)}</span></label>
        <button class="host-btn ${isHost ? 'active' : ''}" data-hid="${expert.id}" ${isSelected ? '' : 'disabled'} title="设为主持人">
          <span class="host-btn-icon">⭐</span>
          <span class="host-btn-text">${isHost ? '主持人' : '设为主持人'}</span>
        </button>
      </div>`;
    }).join('');
    container.querySelectorAll('[data-mid]').forEach(cb => cb.addEventListener('change', (e) => {
      const id = e.target.dataset.mid;
      if (e.target.checked) { if (!selectedIds.includes(id)) selectedIds.push(id); }
      else { const i = selectedIds.indexOf(id); if (i !== -1) selectedIds.splice(i, 1); if (this._editingGroup.hostExpertId === id) this._editingGroup.hostExpertId = selectedIds[0] || ''; }
      this._editingGroup.expertIds = selectedIds;
      this._renderMemberEditor(experts);
      this._onGroupConfigChange();
    }));
    container.querySelectorAll('[data-hid]').forEach(btn => btn.addEventListener('click', (e) => {
      const id = e.target.dataset.hid;
      if (selectedIds.includes(id)) { this._editingGroup.hostExpertId = id; this._renderMemberEditor(experts); this._onGroupConfigChange(); }
    }));
  },

  async _saveGroup() {
    const name = document.getElementById('groupNameInput')?.value?.trim();
    if (!name) { this._toast('请输入名称'); return; }
    const expertIds = this._editingGroup?.expertIds || [];
    if (expertIds.length < 2) { this._toast('至少2名成员'); return; }
    if (!this._editingGroup?.hostExpertId) { this._toast('请选择主持人（在成员列表中点击⭐按钮）'); return; }
    const strategyInput = document.querySelector('input[name="execStrategy"]:checked');
    const group = {
      ...this._editingGroup, name,
      intro: document.getElementById('groupIntroInput')?.value?.trim() || '',
      icon: document.getElementById('groupIconDisplay')?.textContent || '🏆',
      hostPrompt: document.getElementById('groupHostPromptInput')?.value?.trim() || '',
      maxMembers: parseInt(document.getElementById('groupMaxMembers')?.value) || 5,
      executionStrategy: strategyInput?.value || 'serial',
      quickAccesses: this._collectQA('groupQAEditor')
    };
    const result = await window.ExpertSystem?.saveGroup?.(group);
    if (result?.success) { this._toast('保存成功', 'success'); this._closeOverlay('groupEditorOverlay'); this.render(); }
    else { this._toast('保存失败', 'error'); }
  },

  async confirmDeleteGroup(id) {
    const g = window.ExpertSystem?.getGroupById?.(id);
    if (!g) return;
    if (!confirm(`确定删除专家团「${g.name}」吗？`)) return;
    const result = await window.ExpertSystem?.deleteGroup?.(id);
    if (result?.success) { this._toast('已删除', 'success'); this.render(); }
  },

  // ===== 快捷访问编辑器 =====
  _renderQAEditor(qas, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = (qas || []).map((qa, i) => `
      <div class="qa-row" data-qi="${i}">
        <input type="text" class="qa-icon" value="${this._esc(qa.icon || '💬')}" maxlength="2" style="width:40px" title="图标">
        <input type="text" class="qa-label" value="${this._esc(qa.label)}" placeholder="标签" maxlength="10" style="width:100px">
        <input type="text" class="qa-prompt" value="${this._esc(qa.prompt)}" placeholder="提示词" style="flex:1">
        <button class="btn-icon danger qa-del" title="删除">✕</button>
      </div>`).join('');
    container.querySelectorAll('.qa-del').forEach(b => b.addEventListener('click', (e) => e.target.closest('.qa-row')?.remove()));
  },

  _addQARow(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'qa-row';
    row.innerHTML = `<input type="text" class="qa-icon" value="💬" maxlength="2" style="width:40px"><input type="text" class="qa-label" placeholder="标签" maxlength="10" style="width:100px"><input type="text" class="qa-prompt" placeholder="提示词" style="flex:1"><button class="btn-icon danger qa-del" title="删除">✕</button>`;
    container.appendChild(row);
    row.querySelector('.qa-del').addEventListener('click', () => row.remove());
    row.querySelector('.qa-label')?.focus();
  },

  _collectQA(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.qa-row')).map((row, i) => ({
      id: `qa_${i + 1}`,
      icon: row.querySelector('.qa-icon')?.value?.trim() || '💬',
      label: row.querySelector('.qa-label')?.value?.trim() || '',
      prompt: row.querySelector('.qa-prompt')?.value?.trim() || ''
    })).filter(qa => qa.label && qa.prompt);
  },

  // ===== Emoji 选择器 =====
  _showEmojiPicker(targetId) {
    const emojis = ['📝','📋','📚','🤖','🏆','💡','🎯','📊','🔧','📖','🔍','🚀','⚡','🌟','🛡️','💼','🎓','🔬','🎨','📐','🖥️','📱','☁️','🔐','💰','📈','🤝','🎭','🧠','🔥','⏰','✅','📄','🏢'];
    const existing = document.querySelector('.emoji-picker-popup');
    if (existing) existing.remove();

    const picker = document.createElement('div');
    picker.className = 'emoji-picker-popup';
    picker.innerHTML = emojis.map(e => `<span class="emoji-option" data-emoji="${e}">${e}</span>`).join('');
    
    const target = document.getElementById(targetId);
    if (target) {
      const rect = target.getBoundingClientRect();
      picker.style.position = 'fixed';
      picker.style.top = (rect.bottom + 4) + 'px';
      picker.style.left = rect.left + 'px';
    }
    
    document.body.appendChild(picker);
    picker.addEventListener('click', (e) => {
      const option = e.target.closest('.emoji-option');
      if (option && target) {
        target.textContent = option.dataset.emoji;
        picker.remove();
      }
    });
    // 点击外部关闭
    setTimeout(() => {
      const handler = (e) => { if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', handler); } };
      document.addEventListener('click', handler);
    }, 100);
  },

  _closeOverlay(id) { document.getElementById(id)?.remove(); this._editingExpert = null; this._editingGroup = null; },
  _esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
  _toast(msg, type = 'info') { const App = window.App; if (App?._showToast) App._showToast(msg, type); else alert(msg); },

  // ===== 主持人 Prompt 组装与优化 =====
  _hostPromptManuallyEdited: false,

  /** 从输入框同步最新配置到 _editingGroup */
  _syncEditingGroupFromInputs() {
    if (!this._editingGroup) return;
    this._editingGroup.name = document.getElementById('groupNameInput')?.value?.trim() || this._editingGroup.name || '';
    this._editingGroup.intro = document.getElementById('groupIntroInput')?.value?.trim() || '';
    const strategyInput = document.querySelector('input[name="execStrategy"]:checked');
    if (strategyInput) this._editingGroup.executionStrategy = strategyInput.value;
  },

  /** 配置变更（名称/介绍/策略/成员/主持人）时自动组装 prompt */
  _onGroupConfigChange() {
    if (this._hostPromptManuallyEdited) return;
    this._syncEditingGroupFromInputs();
    const expertIds = this._editingGroup?.expertIds || [];
    const hostExpertId = this._editingGroup?.hostExpertId;
    // 条件不足时不组装
    if (expertIds.length < 2 || !hostExpertId || !this._editingGroup.name) return;
    this._assembleHostPrompt(false);
  },

  /**
   * 组装主持人 Prompt（纯本地，不调 LLM）
   * @param {boolean} force - true=强制覆盖（用户点击"重新组装"），false=仅当未手动编辑时覆盖
   */
  _assembleHostPrompt(force) {
    if (!force && this._hostPromptManuallyEdited) return;
    this._syncEditingGroupFromInputs();

    const expertIds = this._editingGroup?.expertIds || [];
    const hostExpertId = this._editingGroup?.hostExpertId;
    if (expertIds.length < 2) { if (force) this._toast('至少需要2名成员'); return; }
    if (!hostExpertId) { if (force) this._toast('请先选择主持人'); return; }

    const prompt = window.ExpertSystem?.generateHostPrompt?.(this._editingGroup);
    if (!prompt) { if (force) this._toast('组装失败，请检查成员配置'); return; }

    const textarea = document.getElementById('groupHostPromptInput');
    if (textarea) {
      textarea.value = prompt;
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
      if (force) {
        textarea.style.borderColor = 'var(--accent, #007AFF)';
        setTimeout(() => { textarea.style.borderColor = ''; }, 1500);
      }
    }
    this._hostPromptManuallyEdited = false;
  },

  /** AI 优化当前 textarea 中的 Prompt */
  async _aiOptimizeHostPrompt() {
    const textarea = document.getElementById('groupHostPromptInput');
    const currentPrompt = textarea?.value?.trim();
    if (!currentPrompt) { this._toast('请先组装或填写 Prompt'); return; }

    this._syncEditingGroupFromInputs();
    const btn = document.getElementById('aiOptimizeHostPromptBtn');
    if (btn) { btn.disabled = true; btn.textContent = '✨ 优化中...'; }

    try {
      const result = await window.electronAPI?.expertsOptimizeHostPrompt?.({
        basePrompt: currentPrompt,
        groupName: this._editingGroup?.name,
        groupIntro: this._editingGroup?.intro
      });

      if (result?.success && result.optimizedPrompt) {
        if (textarea) {
          textarea.value = result.optimizedPrompt;
          textarea.style.height = 'auto';
          textarea.style.height = textarea.scrollHeight + 'px';
          textarea.style.borderColor = 'var(--accent, #007AFF)';
          setTimeout(() => { textarea.style.borderColor = ''; }, 1500);
        }
        this._hostPromptManuallyEdited = false;
        this._toast('AI 已优化主持人 Prompt', 'success');
      } else if (result?.error) {
        this._toast('AI 优化失败：' + result.error, 'error');
      }
    } catch (err) {
      console.warn('[ExpertSettings] LLM optimize failed:', err);
      this._toast('AI 优化异常：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✨ AI 优化'; }
    }
  }
};

window.ExpertSettings = ExpertSettings;
