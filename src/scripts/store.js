const Store = {
  TASKS_KEY: 'taskflow_tasks',
  SETTINGS_KEY: 'taskflow_settings',
  POMODORO_KEY: 'taskflow_pomodoro',

  init() {
    console.log('[Store] Initialized');
  },

  defaultSettings: {
    pomodoro: {
      workDuration: 25,
      shortBreakDuration: 5,
      longBreakDuration: 15,
      sessionsBeforeLongBreak: 4
    },
    reminder: {
      enoughTimeBeforeDue: 120,
      nearDeadlineTime: 30,
      soundEnabled: true,
      notificationEnabled: true
    },
    clipboard: {
      watchEnabled: true,
      watchInterval: 2000,
      autoAnalyze: true
    },
    calendar: {
      syncEnabled: true,
      calendarName: 'TaskFlow'
    }
  },

  getTasks() {
    try {
      const data = localStorage.getItem(this.TASKS_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('获取任务失败:', error);
      return [];
    }
  },

  saveTasks(tasks) {
    try {
      localStorage.setItem(this.TASKS_KEY, JSON.stringify(tasks));
      // 通知同步引擎
      if (typeof SyncEngine !== 'undefined' && SyncEngine._getSettings?.().enabled) {
        const recentChanges = tasks.filter(t => {
          const updated = new Date(t.updatedAt || t.createdAt).getTime();
          return Date.now() - updated < 5000;  // 5秒内更新的
        });
        recentChanges.forEach(t => SyncEngine.markDirty('tasks', t));
      }
      return true;
    } catch (error) {
      console.error('保存任务失败:', error);
      return false;
    }
  },

  addTask(task) {
    const tasks = this.getTasks();
    const newTask = {
      id: `task_${Date.now()}`,
      title: task.title,
      description: task.description || '',
      estimatedDuration: task.estimatedDuration || 60,
      actualDuration: 0,
      priority: task.priority || 'medium',
      status: 'pending',
      dueDate: task.dueDate || null,
      reminderSettings: {
        enoughTime: task.reminderSettings?.enoughTime || 120,
        nearDeadline: task.reminderSettings?.nearDeadline || 30
      },
      reminders: [],
      pomodoroSessions: [],
      calendarEventId: null,
      source: task.source || 'manual',
      rawText: task.rawText || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };
    tasks.push(newTask);
    this.saveTasks(tasks);
    return newTask;
  },

  updateTask(taskId, updates) {
    const tasks = this.getTasks();
    const index = tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      tasks[index] = {
        ...tasks[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this.saveTasks(tasks);
      return tasks[index];
    }
    return null;
  },

  deleteTask(taskId) {
    const tasks = this.getTasks();
    const filtered = tasks.filter(t => t.id !== taskId);
    this.saveTasks(filtered);
    return true;
  },

  completeTask(taskId) {
    return this.updateTask(taskId, {
      status: 'completed',
      completedAt: new Date().toISOString()
    });
  },

  getSettings() {
    try {
      const data = localStorage.getItem(this.SETTINGS_KEY);
      return data ? { ...this.defaultSettings, ...JSON.parse(data) } : this.defaultSettings;
    } catch (error) {
      console.error('获取设置失败:', error);
      return this.defaultSettings;
    }
  },

  saveSettings(settings) {
    try {
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch (error) {
      console.error('保存设置失败:', error);
      return false;
    }
  },

  getPomodoroState() {
    try {
      const data = localStorage.getItem(this.POMODORO_KEY);
      return data ? JSON.parse(data) : {
        isRunning: false,
        currentSession: 0,
        totalSessions: 0,
        currentTaskId: null,
        startTime: null,
        type: 'work'
      };
    } catch (error) {
      console.error('获取番茄钟状态失败:', error);
      return {
        isRunning: false,
        currentSession: 0,
        totalSessions: 0,
        currentTaskId: null,
        startTime: null,
        type: 'work'
      };
    }
  },

  savePomodoroState(state) {
    try {
      localStorage.setItem(this.POMODORO_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.error('保存番茄钟状态失败:', error);
      return false;
    }
  },

  addPomodoroSession(taskId, session) {
    const tasks = this.getTasks();
    const index = tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      tasks[index].pomodoroSessions.push({
        id: `pomo_${Date.now()}`,
        taskId: taskId,
        type: session.type,
        duration: session.duration,
        startTime: session.startTime,
        endTime: session.endTime,
        completed: session.completed,
        interrupted: session.interrupted || false
      });
      tasks[index].actualDuration += session.duration;
      this.saveTasks(tasks);
    }
  },

  getTasksByDate(date) {
    const tasks = this.getTasks();
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);
    
    return tasks.filter(task => {
      if (!task.dueDate) return false;
      const dueDate = new Date(task.dueDate);
      return dueDate >= targetDate && dueDate < nextDate;
    });
  },

  getTasksByWeek(startDate) {
    const tasks = this.getTasks();
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    
    return tasks.filter(task => {
      if (!task.dueDate) return false;
      const dueDate = new Date(task.dueDate);
      return dueDate >= start && dueDate < end;
    });
  },

  getTasksByMonth(year, month) {
    const tasks = this.getTasks();
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);
    
    return tasks.filter(task => {
      if (!task.dueDate) return false;
      const dueDate = new Date(task.dueDate);
      return dueDate >= start && dueDate < end;
    });
  },

  getUpcomingReminders() {
    const tasks = this.getTasks();
    const now = new Date();
    const reminders = [];
    
    tasks.forEach(task => {
      if (task.status === 'completed' || !task.dueDate) return;
      
      const dueDate = new Date(task.dueDate);
      const enoughTime = new Date(dueDate.getTime() - task.reminderSettings.enoughTime * 60000);
      const nearDeadline = new Date(dueDate.getTime() - task.reminderSettings.nearDeadline * 60000);
      
      if (enoughTime > now && !task.reminders.includes(enoughTime.toISOString())) {
        reminders.push({
          taskId: task.id,
          taskTitle: task.title,
          time: enoughTime,
          type: 'enough_time'
        });
      }
      
      if (nearDeadline > now && !task.reminders.includes(nearDeadline.toISOString())) {
        reminders.push({
          taskId: task.id,
          taskTitle: task.title,
          time: nearDeadline,
          type: 'near_deadline'
        });
      }
    });
    
    return reminders.sort((a, b) => a.time - b.time);
  }
};

window.Store = Store;