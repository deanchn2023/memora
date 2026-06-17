const Reminder = {
  timer: null,
  reminders: [],
  settings: null,
  _overdueCheckInterval: null,
  _inAppNotifyTimeout: null,

  // 默认提醒设置（含各类提醒开关）
  defaultSettings: {
    notificationEnabled: true,      // 系统通知
    soundEnabled: true,             // 提示音
    enoughTimeBeforeDue: 120,       // 提前 N 分钟提醒（预留时间）
    nearDeadlineTime: 30,           // 到期前 N 分钟紧急提醒
    overdueReminderEnabled: true,   // 逾期任务持续提醒
    overdueReminderInterval: 60,    // 逾期提醒间隔（分钟）
    startupCheckEnabled: true,      // 启动时检查逾期任务
    inAppNotifyEnabled: true,       // 应用内弹窗提醒
  },

  init() {
    this.settings = { ...this.defaultSettings, ...(Store.getSettings().reminder || {}) };
    this.loadReminders();
    this.startChecker();

    // 启动时检查逾期任务
    if (this.settings.startupCheckEnabled) {
      setTimeout(() => this.checkOverdueTasks(), 2000);
    }

    // 逾期任务定期提醒
    if (this.settings.overdueReminderEnabled) {
      this._overdueCheckInterval = setInterval(() => {
        this.checkOverdueTasks();
      }, (this.settings.overdueReminderInterval || 60) * 60000);
    }
  },

  loadReminders() {
    this.reminders = Store.getUpcomingReminders();
  },

  startChecker() {
    this.timer = setInterval(() => this.checkReminders(), 60000);
    this.checkReminders();
  },

  checkReminders() {
    const now = new Date();
    
    this.reminders.forEach(reminder => {
      const reminderTime = new Date(reminder.time);
      const diff = reminderTime.getTime() - now.getTime();
      
      if (diff <= 60000 && diff > 0) {
        this.triggerReminder(reminder);
      }
    });
    
    this.loadReminders();
  },

  triggerReminder(reminder) {
    const message = this.getReminderMessage(reminder);
    
    if (this.settings.notificationEnabled) {
      this.showNotification('忆境 Memora 提醒', message);
    }

    if (this.settings.inAppNotifyEnabled) {
      this.showInAppNotification(message, reminder.type);
    }
    
    this.markReminderTriggered(reminder.taskId, reminder.time);
  },

  getReminderMessage(reminder) {
    switch (reminder.type) {
      case 'enough_time':
        return `任务「${reminder.taskTitle}」即将到期，请预留足够时间完成`;
      case 'near_deadline':
        return `任务「${reminder.taskTitle}」将在30分钟内到期！`;
      case 'overdue':
        return `任务「${reminder.taskTitle}」已逾期，请尽快处理！`;
      default:
        return `任务「${reminder.taskTitle}」提醒`;
    }
  },

  showNotification(title, body) {
    if (window.electronAPI) {
      window.electronAPI.showNotification(title, body);
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification(title, { body });
        }
      });
    }
  },

  /** 应用内弹窗通知 */
  showInAppNotification(message, type = 'info') {
    // 清除上一个
    if (this._inAppNotifyTimeout) {
      clearTimeout(this._inAppNotifyTimeout);
    }
    const existing = document.getElementById('inAppReminderNotify');
    if (existing) existing.remove();

    const icons = {
      enough_time: '⏰',
      near_deadline: '🔥',
      overdue: '🚨',
      info: '🔔'
    };
    const colors = {
      enough_time: '#007AFF',
      near_deadline: '#FF9500',
      overdue: '#FF3B30',
      info: '#007AFF'
    };

    const notify = document.createElement('div');
    notify.id = 'inAppReminderNotify';
    notify.style.cssText = `
      position: fixed; top: 16px; right: 16px; z-index: 99999;
      background: rgba(255,255,255,0.95); backdrop-filter: blur(20px);
      border: 0.5px solid ${colors[type] || colors.info};
      border-left: 3px solid ${colors[type] || colors.info};
      border-radius: 10px; padding: 12px 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      max-width: 340px; font-size: 13px; color: #1d1d1f;
      animation: reminderSlideIn 0.3s ease;
      cursor: pointer;
    `;
    notify.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <span style="font-size:18px;">${icons[type] || icons.info}</span>
        <div style="flex:1;">
          <div style="font-weight:600;margin-bottom:2px;">忆境 Memora 提醒</div>
          <div style="color:#86868b;line-height:1.4;">${message}</div>
        </div>
        <button onclick="this.closest('#inAppReminderNotify').remove()" style="background:none;border:none;cursor:pointer;font-size:16px;color:#aeaeb2;padding:0;">×</button>
      </div>
    `;
    // 点击通知跳转到任务列表
    notify.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      if (window.Calendar?.showCalendarView) {
        window.Calendar.showCalendarView();
      }
      notify.remove();
    });
    document.body.appendChild(notify);

    // 注入动画
    if (!document.getElementById('reminderNotifyStyle')) {
      const style = document.createElement('style');
      style.id = 'reminderNotifyStyle';
      style.textContent = `
        @keyframes reminderSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    this._inAppNotifyTimeout = setTimeout(() => {
      notify.style.transition = 'opacity 0.3s, transform 0.3s';
      notify.style.opacity = '0';
      notify.style.transform = 'translateX(100%)';
      setTimeout(() => notify.remove(), 300);
    }, 8000);
  },

  /** 检查逾期任务并提醒 */
  checkOverdueTasks() {
    if (!this.settings.overdueReminderEnabled) return;

    const tasks = Store.getTasks();
    const now = new Date();
    const overdueTasks = [];

    tasks.forEach(task => {
      if (task.status === 'completed' || !task.dueDate) return;
      const dueDate = new Date(task.dueDate);
      if (dueDate < now) {
        // 检查是否已提醒过（用 _lastOverdueRemind 控制频率）
        const lastRemind = task._lastOverdueRemind ? new Date(task._lastOverdueRemind) : null;
        const interval = (this.settings.overdueReminderInterval || 60) * 60000;
        if (!lastRemind || (now.getTime() - lastRemind.getTime()) >= interval) {
          overdueTasks.push(task);
        }
      }
    });

    if (overdueTasks.length > 0) {
      const message = overdueTasks.length === 1
        ? `任务「${overdueTasks[0].title}」已逾期，请尽快处理！`
        : `你有 ${overdueTasks.length} 个逾期任务待处理！`;

      if (this.settings.notificationEnabled) {
        this.showNotification('🚨 逾期任务提醒', message);
      }
      if (this.settings.inAppNotifyEnabled) {
        this.showInAppNotification(message, 'overdue');
      }

      // 更新提醒时间
      const allTasks = Store.getTasks();
      overdueTasks.forEach(ot => {
        const task = allTasks.find(t => t.id === ot.id);
        if (task) {
          task._lastOverdueRemind = now.toISOString();
        }
      });
      Store.saveTasks(allTasks);
    }
  },

  /** 更新提醒设置 */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    const currentSettings = Store.getSettings();
    currentSettings.reminder = this.settings;
    Store.saveSettings(currentSettings);

    // 重启逾期检查
    if (this._overdueCheckInterval) {
      clearInterval(this._overdueCheckInterval);
      this._overdueCheckInterval = null;
    }
    if (this.settings.overdueReminderEnabled) {
      this._overdueCheckInterval = setInterval(() => {
        this.checkOverdueTasks();
      }, (this.settings.overdueReminderInterval || 60) * 60000);
    }
  },

  markReminderTriggered(taskId, time) {
    const tasks = Store.getTasks();
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      task.reminders.push(new Date(time).toISOString());
      Store.saveTasks(tasks);
    }
  },

  calculateReminders(task) {
    if (!task.dueDate) return [];
    
    const dueDate = new Date(task.dueDate);
    const reminders = [];
    
    const enoughTime = new Date(dueDate.getTime() - task.reminderSettings.enoughTime * 60000);
    reminders.push(enoughTime.toISOString());
    
    const nearDeadline = new Date(dueDate.getTime() - task.reminderSettings.nearDeadline * 60000);
    reminders.push(nearDeadline.toISOString());
    
    return reminders;
  },

  /** 获取逾期任务列表 */
  getOverdueTasks() {
    const tasks = Store.getTasks();
    const now = new Date();
    return tasks.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < now);
  },

  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (this._overdueCheckInterval) {
      clearInterval(this._overdueCheckInterval);
    }
  }
};

window.Reminder = Reminder;