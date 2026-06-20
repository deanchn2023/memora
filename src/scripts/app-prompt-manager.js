/**
 * Prompt 管理模块 — 从 app.js 提取
 * 包含：Prompt 文件列表、在线编辑、上传/下载、版本管理、变量预览
 * 通过 Object.assign 合并到 App 对象
 */
Object.assign(App, {
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
});
