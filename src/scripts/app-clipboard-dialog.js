/**
 * app-clipboard-dialog.js
 * 从 app.js 提取的剪贴板处理 + 自定义弹窗方法
 * 使用 Object.assign(App, {...}) 模式合并到 App 对象
 */
Object.assign(App, {
  // === 剪贴板检测器 ===
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
      rawText: this.pendingClipboardTask.rawText,
      taskType: taskData.taskType || 'manual',
      recurrence: taskData.recurrence || null
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
      dueDate: dueDate.toISOString(),
      taskType: taskData.taskType || 'manual',
      recurrence: taskData.recurrence || null
    });
    
    this.hideClipboardDetector();
  },

  getDefaultDueDate(taskType) {
    const now = new Date();
    const hour = now.getHours();
    
    if (hour < 12) {
      now.setHours(17, 0, 0, 0);
    } else if (hour < 18) {
      now.setHours(20, 0, 0, 0);
    } else if (hour < 22) {
      now.setHours(22, 0, 0, 0);
    } else {
      now.setDate(now.getDate() + 1);
      now.setHours(10, 0, 0, 0);
    }
    return now;
  },

  formatDateTimeLocal(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  // === 自定义弹窗（替代 prompt/confirm）===

  showInputDialog(title, message, defaultValue = '') {
    return new Promise((resolve) => {
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

      setTimeout(() => { input.focus(); input.select(); }, 50);

      // 输入框聚焦样式 → CSS :focus
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

      // hover 样式 → CSS :hover
    });
  },

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

      // hover 样式 → CSS :hover
    });
  },
});
