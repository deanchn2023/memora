/**
 * 忆境 Memora - 数据持久化层
 * 使用原生 fs 实现 JSON 文件存储，替代 localStorage
 * 自动备份、数据导入导出
 */
const path = require('path');
const fs = require('fs');

class Database {
  constructor(userDataPath) {
    this.dbPath = path.join(userDataPath, 'memora-data.json');
    this.backupDir = path.join(userDataPath, 'backups');
    this.data = null;
    this.defaults = {
      tasks: [],
      settings: {},
      pomodoro: {
        isRunning: false,
        currentSession: 0,
        totalSessions: 0,
        currentTaskId: null,
        startTime: null,
        type: 'work'
      },
      version: '1.0.0'
    };
  }

  init() {
    // 确保 backups 目录存在
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
    
    // 读取或创建数据库文件
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        this.data = JSON.parse(raw);
        // 合并缺失的默认字段
        this.data = { ...this.defaults, ...this.data };
      } catch (e) {
        console.error('[Database] Read error, using defaults:', e.message);
        this.data = JSON.parse(JSON.stringify(this.defaults));
      }
    } else {
      this.data = JSON.parse(JSON.stringify(this.defaults));
      this.save();
    }
    
    console.log('[Database] Initialized at:', this.dbPath);
    return this;
  }

  // ========== 任务操作 ==========
  getTasks() {
    return this.data.tasks || [];
  }

  addTask(task) {
    if (!this.data.tasks) this.data.tasks = [];
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
      isDraft: task.isDraft || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };
    this.data.tasks.push(newTask);
    return newTask;
  }

  updateTask(taskId, updates) {
    if (!this.data.tasks) return null;
    const index = this.data.tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      this.data.tasks[index] = {
        ...this.data.tasks[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      return this.data.tasks[index];
    }
    return null;
  }

  deleteTask(taskId) {
    if (!this.data.tasks) return false;
    this.data.tasks = this.data.tasks.filter(t => t.id !== taskId);
    return true;
  }

  completeTask(taskId) {
    return this.updateTask(taskId, {
      status: 'completed',
      completedAt: new Date().toISOString()
    });
  }

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
  }

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
  }

  getTasksByMonth(year, month) {
    const tasks = this.getTasks();
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);
    return tasks.filter(task => {
      if (!task.dueDate) return false;
      const dueDate = new Date(task.dueDate);
      return dueDate >= start && dueDate < end;
    });
  }

  addPomodoroSession(taskId, session) {
    if (!this.data.tasks) return;
    const index = this.data.tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      if (!this.data.tasks[index].pomodoroSessions) {
        this.data.tasks[index].pomodoroSessions = [];
      }
      this.data.tasks[index].pomodoroSessions.push({
        id: `pomo_${Date.now()}`,
        taskId,
        type: session.type,
        duration: session.duration,
        startTime: session.startTime,
        endTime: session.endTime,
        completed: session.completed,
        interrupted: session.interrupted || false
      });
      this.data.tasks[index].actualDuration += session.duration;
    }
  }

  // ========== 设置操作 ==========
  getSettings() {
    return this.data.settings || {};
  }

  saveSettings(settings) {
    this.data.settings = { ...this.data.settings, ...settings };
  }

  // ========== 番茄钟状态 ==========
  getPomodoroState() {
    return this.data.pomodoro || {
      isRunning: false,
      currentSession: 0,
      totalSessions: 0,
      currentTaskId: null,
      startTime: null,
      type: 'work'
    };
  }

  savePomodoroState(state) {
    this.data.pomodoro = state;
  }

  // ========== 持久化 ==========
  save() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[Database] Save error:', e);
      return false;
    }
  }

  // ========== 自动备份 ==========
  createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.backupDir, `memora-backup-${timestamp}.json`);
    
    try {
      const data = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(backupPath, data, 'utf8');
      
      // 保留最近10个备份
      this.cleanOldBackups(10);
      
      console.log('[Database] Backup created:', backupPath);
      return { success: true, path: backupPath };
    } catch (error) {
      console.error('[Database] Backup failed:', error);
      return { success: false, error: error.message };
    }
  }

  cleanOldBackups(keepCount) {
    try {
      const backups = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('memora-backup-') && f.endsWith('.json'))
        .sort()
        .reverse();
      
      if (backups.length > keepCount) {
        backups.slice(keepCount).forEach(f => {
          fs.unlinkSync(path.join(this.backupDir, f));
        });
      }
    } catch (error) {
      console.error('[Database] Cleanup error:', error);
    }
  }

  listBackups() {
    try {
      if (!fs.existsSync(this.backupDir)) return [];
      return fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('memora-backup-') && f.endsWith('.json'))
        .sort()
        .reverse()
        .map(f => {
          const stat = fs.statSync(path.join(this.backupDir, f));
          return {
            filename: f,
            path: path.join(this.backupDir, f),
            size: stat.size,
            createdAt: stat.mtime.toISOString()
          };
        });
    } catch (error) {
      return [];
    }
  }

  restoreBackup(backupPath) {
    try {
      const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      this.data = data;
      this.save();
      console.log('[Database] Restored from backup:', backupPath);
      return { success: true };
    } catch (error) {
      console.error('[Database] Restore failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ========== 数据导出 ==========
  exportData() {
    return JSON.stringify(this.data, null, 2);
  }

  importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      this.data = data;
      this.save();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ========== 统计 ==========
  getStats() {
    const tasks = this.getTasks();
    const completed = tasks.filter(t => t.status === 'completed');
    const pending = tasks.filter(t => t.status !== 'completed');
    return {
      totalTasks: tasks.length,
      completedTasks: completed.length,
      pendingTasks: pending.length,
      dataSize: JSON.stringify(this.data).length
    };
  }
}

module.exports = { Database };
