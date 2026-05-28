/**
 * 忆境 Memora - lowdb 数据持久化层
 * 替代 localStorage，支持大容量存储和自动备份
 */
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const fs = require('fs');

class Database {
  constructor(userDataPath) {
    this.dbPath = path.join(userDataPath, 'memora-data.json');
    this.backupDir = path.join(userDataPath, 'backups');
    this.adapter = new JSONFile(this.dbPath);
    this.db = null;
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

  async init() {
    this.db = new Low(this.adapter, this.defaults);
    await this.db.read();
    
    // 确保 backups 目录存在
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
    
    console.log('[Database] Initialized at:', this.dbPath);
    return this;
  }

  // ========== 任务操作 ==========
  getTasks() {
    return this.db.data.tasks || [];
  }

  addTask(task) {
    if (!this.db.data.tasks) this.db.data.tasks = [];
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
    this.db.data.tasks.push(newTask);
    return newTask;
  }

  updateTask(taskId, updates) {
    if (!this.db.data.tasks) return null;
    const index = this.db.data.tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      this.db.data.tasks[index] = {
        ...this.db.data.tasks[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      return this.db.data.tasks[index];
    }
    return null;
  }

  deleteTask(taskId) {
    if (!this.db.data.tasks) return false;
    this.db.data.tasks = this.db.data.tasks.filter(t => t.id !== taskId);
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
    if (!this.db.data.tasks) return;
    const index = this.db.data.tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      if (!this.db.data.tasks[index].pomodoroSessions) {
        this.db.data.tasks[index].pomodoroSessions = [];
      }
      this.db.data.tasks[index].pomodoroSessions.push({
        id: `pomo_${Date.now()}`,
        taskId,
        type: session.type,
        duration: session.duration,
        startTime: session.startTime,
        endTime: session.endTime,
        completed: session.completed,
        interrupted: session.interrupted || false
      });
      this.db.data.tasks[index].actualDuration += session.duration;
    }
  }

  // ========== 设置操作 ==========
  getSettings() {
    return this.db.data.settings || {};
  }

  saveSettings(settings) {
    this.db.data.settings = { ...this.db.data.settings, ...settings };
  }

  // ========== 番茄钟状态 ==========
  getPomodoroState() {
    return this.db.data.pomodoro || {
      isRunning: false,
      currentSession: 0,
      totalSessions: 0,
      currentTaskId: null,
      startTime: null,
      type: 'work'
    };
  }

  savePomodoroState(state) {
    this.db.data.pomodoro = state;
  }

  // ========== 持久化 ==========
  async save() {
    await this.db.write();
  }

  // ========== 自动备份 ==========
  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.backupDir, `memora-backup-${timestamp}.json`);
    
    try {
      const data = JSON.stringify(this.db.data, null, 2);
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
        console.log(`[Database] Cleaned ${backups.length - keepCount} old backups`);
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

  async restoreBackup(backupPath) {
    try {
      const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      this.db.data = data;
      await this.db.write();
      console.log('[Database] Restored from backup:', backupPath);
      return { success: true };
    } catch (error) {
      console.error('[Database] Restore failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ========== 数据导出 ==========
  async exportData() {
    return JSON.stringify(this.db.data, null, 2);
  }

  async importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      this.db.data = data;
      await this.db.write();
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
      dataSize: JSON.stringify(this.db.data).length
    };
  }
}

module.exports = { Database };
