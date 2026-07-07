/**
 * 待办任务 MCP Server 启动脚本（stdio 模式）
 */

const TaskMCPServer = require('./task-mcp-server');

const server = new TaskMCPServer();

const dbPath = process.env.DB_PATH || '';

class SimpleDB {
  constructor() {
    this.data = { tasks: [] };
  }

  _load() {
    if (!dbPath) return;
    try {
      const fs = require('fs');
      const raw = fs.readFileSync(dbPath, 'utf8');
      this.data = JSON.parse(raw);
    } catch (_) {}
  }

  _save() {
    if (!dbPath) return;
    try {
      const fs = require('fs');
      fs.writeFileSync(dbPath, JSON.stringify(this.data, null, 2));
    } catch (_) {}
  }

  getTasks() {
    return this.data.tasks || [];
  }

  addTask(task) {
    if (!this.data.tasks) this.data.tasks = [];
    const newTask = {
      id: `task_${Date.now()}`,
      title: task.title,
      description: task.description || '',
      priority: task.priority || 'medium',
      status: 'pending',
      dueDate: task.dueDate || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };
    this.data.tasks.push(newTask);
    this._save();
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
      this._save();
      return this.data.tasks[index];
    }
    return null;
  }

  deleteTask(taskId) {
    if (!this.data.tasks) return false;
    const before = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter(t => t.id !== taskId);
    this._save();
    return this.data.tasks.length < before;
  }

  completeTask(taskId) {
    if (!this.data.tasks) return false;
    const index = this.data.tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      this.data.tasks[index].status = 'completed';
      this.data.tasks[index].completedAt = new Date().toISOString();
      this.data.tasks[index].updatedAt = new Date().toISOString();
      this._save();
      return true;
    }
    return false;
  }

  completeAllTasks() {
    if (!this.data.tasks) return false;
    let changed = false;
    for (const task of this.data.tasks) {
      if (task.status !== 'completed') {
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
        task.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this._save();
    return changed;
  }
}

const db = new SimpleDB();
db._load();

server.setDependencies(db, null);
server.registerTools();
server.start('stdio');