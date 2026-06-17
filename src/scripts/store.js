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
      notificationEnabled: true,
      overdueReminderEnabled: true,
      overdueReminderInterval: 60,
      startupCheckEnabled: true,
      inAppNotifyEnabled: true
    },
    clipboard: {
      watchEnabled: true,
      watchInterval: 2000,
      autoAnalyze: true
    },
    calendar: {
      syncEnabled: true,
      calendarName: 'TaskFlow'
    },
    localContextEnabled: true
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
      taskType: task.taskType || 'manual',
      expertId: task.expertId || null,
      expertName: task.expertName || null,
      recurrence: task.recurrence || null,
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

  deleteRecurringAll(parentId) {
    const tasks = this.getTasks();
    const filtered = tasks.filter(t => !(t.recurrence && t.recurrence.parentId === parentId));
    this.saveTasks(filtered);
    return true;
  },

  getRecurringInstances(parentId) {
    const tasks = this.getTasks();
    return tasks.filter(t => t.recurrence && t.recurrence.parentId === parentId);
  },

  getNextRecurrenceDate(dueDate, recurrence) {
    if (!dueDate || !recurrence || recurrence.type === 'none') return null;
    const date = new Date(dueDate);
    const type = recurrence.type;

    if (type === 'daily') {
      date.setDate(date.getDate() + 1);
    } else if (type === 'weekdays') {
      date.setDate(date.getDate() + 1);
      while (date.getDay() === 0 || date.getDay() === 6) {
        date.setDate(date.getDate() + 1);
      }
    } else if (type === 'weekly') {
      const days = recurrence.daysOfWeek || [date.getDay()];
      const currentDay = date.getDay();
      const sortedDays = [...days].sort((a, b) => a - b);
      const nextDay = sortedDays.find(d => d > currentDay);
      if (nextDay !== undefined) {
        date.setDate(date.getDate() + (nextDay - currentDay));
      } else {
        const firstDay = sortedDays[0];
        const daysUntilNext = (7 - currentDay) + firstDay;
        date.setDate(date.getDate() + daysUntilNext);
      }
    } else if (type === 'biweekly') {
      date.setDate(date.getDate() + 14);
    } else if (type === 'monthly') {
      date.setMonth(date.getMonth() + 1);
    } else if (type === 'custom') {
      const interval = recurrence.interval || 2;
      const unit = recurrence.unit || 'day';
      if (unit === 'day') date.setDate(date.getDate() + interval);
      else if (unit === 'week') date.setDate(date.getDate() + interval * 7);
      else if (unit === 'month') date.setMonth(date.getMonth() + interval);
    }
    return date;
  },

  createNextRecurrenceInstance(task) {
    if (!task.recurrence || task.recurrence.type === 'none') return null;
    if (!task.recurrence.parentId && !task.recurrence.isTemplate) return null;

    const nextDate = this.getNextRecurrenceDate(task.dueDate, task.recurrence);
    if (!nextDate) return null;

    // 检查是否超过结束日期
    if (task.recurrence.endDate && nextDate > new Date(task.recurrence.endDate)) return null;

    const parentId = task.recurrence.parentId || task.id;
    const newTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: task.title,
      description: task.description || '',
      estimatedDuration: task.estimatedDuration || 60,
      actualDuration: 0,
      priority: task.priority || 'medium',
      status: 'pending',
      dueDate: nextDate.toISOString(),
      reminderSettings: task.reminderSettings || { enoughTime: 120, nearDeadline: 30 },
      reminders: [],
      pomodoroSessions: [],
      calendarEventId: null,
      source: task.source || 'manual',
      rawText: '',
      taskType: task.taskType || 'manual',
      expertId: task.expertId || null,
      expertName: task.expertName || null,
      recurrence: {
        ...task.recurrence,
        parentId: parentId,
        isInstance: true,
        isTemplate: false
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };

    const tasks = this.getTasks();
    tasks.push(newTask);
    this.saveTasks(tasks);
    return newTask;
  },

  getRecurrenceLabel(recurrence) {
    if (!recurrence || recurrence.type === 'none') return '';
    const labels = {
      daily: '每天',
      weekdays: '工作日',
      weekly: '每周',
      biweekly: '隔周',
      monthly: '每月',
      custom: '自定义'
    };
    let label = labels[recurrence.type] || '重复';
    if (recurrence.type === 'custom' && recurrence.interval) {
      const unitLabels = { day: '天', week: '周', month: '月' };
      label = `每${recurrence.interval}${unitLabels[recurrence.unit || 'day'] || '天'}`;
    }
    if (recurrence.type === 'weekly' && recurrence.daysOfWeek?.length) {
      const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
      const daysStr = recurrence.daysOfWeek.map(d => '周' + dayNames[d]).join('、');
      label = `每周 ${daysStr}`;
    }
    return label;
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