const Reminder = {
  timer: null,
  reminders: [],
  settings: null,

  init() {
    this.settings = Store.getSettings().reminder;
    this.loadReminders();
    this.startChecker();
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
    
    this.markReminderTriggered(reminder.taskId, reminder.time);
  },

  getReminderMessage(reminder) {
    switch (reminder.type) {
      case 'enough_time':
        return `任务「${reminder.taskTitle}」即将到期，请预留足够时间完成`;
      case 'near_deadline':
        return `任务「${reminder.taskTitle}」将在30分钟内到期！`;
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

  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
};

window.Reminder = Reminder;