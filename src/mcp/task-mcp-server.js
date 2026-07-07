/**
 * 待办任务 MCP Server
 * 提供待办任务的增删改查工具
 */

const MCPBaseServer = require('./mcp-base');

class TaskMCPServer extends MCPBaseServer {
  constructor(version = '1.0.0') {
    super('memora-tasks', version);
    this.db = null;
    this.vectorQueue = null;
  }

  setDependencies(db, vectorQueue) {
    this.db = db;
    this.vectorQueue = vectorQueue;
  }

  registerTools() {
    this.registerTool(
      {
        name: 'get_tasks',
        description: '获取所有待办任务列表',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: '任务状态过滤：pending/completed/all', default: 'all', enum: ['pending', 'completed', 'all'] },
            limit: { type: 'number', description: '返回数量限制', default: 50 },
          },
          required: [],
        },
      },
      async (args) => {
        if (!this.db) return this.errorResult('数据库未初始化');
        
        const status = args.status || 'all';
        const limit = args.limit || 50;
        
        let tasks = this.db.getTasks() || [];
        
        if (status !== 'all') {
          tasks = tasks.filter(t => t.status === status);
        }
        
        tasks = tasks.slice(0, limit);
        
        return this.jsonResult({ success: true, tasks });
      }
    );

    this.registerTool(
      {
        name: 'get_task',
        description: '获取单个任务详情',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '任务 ID', required: true },
          },
          required: ['id'],
        },
      },
      async (args) => {
        if (!this.db) return this.errorResult('数据库未初始化');
        
        const tasks = this.db.getTasks() || [];
        const task = tasks.find(t => t.id === args.id);
        
        if (!task) {
          return this.errorResult('任务不存在');
        }
        
        return this.jsonResult({ success: true, task });
      }
    );

    this.registerTool(
      {
        name: 'create_task',
        description: '创建新任务',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '任务标题', required: true },
            description: { type: 'string', description: '任务描述' },
            priority: { type: 'string', description: '优先级：low/medium/high', default: 'medium', enum: ['low', 'medium', 'high'] },
            dueDate: { type: 'string', description: '截止日期 (ISO格式)' },
            estimatedDuration: { type: 'number', description: '预计时长(分钟)', default: 60 },
            status: { type: 'string', description: '状态：pending/completed', default: 'pending', enum: ['pending', 'completed'] },
          },
          required: ['title'],
        },
      },
      async (args) => {
        if (!this.db) return this.errorResult('数据库未初始化');
        
        const newTask = {
          id: Date.now().toString(),
          title: args.title,
          description: args.description || '',
          priority: args.priority || 'medium',
          dueDate: args.dueDate || '',
          estimatedDuration: args.estimatedDuration || 60,
          status: args.status || 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        
        const tasks = this.db.getTasks() || [];
        tasks.push(newTask);
        
        this.vectorQueue?.enqueue('upsert', 'tasks', newTask);
        this.db.data.tasks = tasks;
        this.db.save();
        
        return this.jsonResult({ success: true, task: newTask });
      }
    );

    this.registerTool(
      {
        name: 'update_task',
        description: '更新任务',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '任务 ID', required: true },
            title: { type: 'string', description: '任务标题' },
            description: { type: 'string', description: '任务描述' },
            priority: { type: 'string', description: '优先级：low/medium/high', enum: ['low', 'medium', 'high'] },
            dueDate: { type: 'string', description: '截止日期 (ISO格式)' },
            estimatedDuration: { type: 'number', description: '预计时长(分钟)' },
            status: { type: 'string', description: '状态：pending/completed', enum: ['pending', 'completed'] },
          },
          required: ['id'],
        },
      },
      async (args) => {
        if (!this.db) return this.errorResult('数据库未初始化');
        
        const tasks = this.db.getTasks() || [];
        const index = tasks.findIndex(t => t.id === args.id);
        
        if (index === -1) {
          return this.errorResult('任务不存在');
        }
        
        const updates = { ...args };
        delete updates.id;
        
        const oldTask = { ...tasks[index] };
        const updatedTask = { ...tasks[index], ...updates, updatedAt: new Date().toISOString() };
        
        tasks[index] = updatedTask;
        
        if (JSON.stringify(oldTask) !== JSON.stringify(updatedTask)) {
          this.vectorQueue?.enqueue('upsert', 'tasks', updatedTask);
        }
        
        this.db.data.tasks = tasks;
        this.db.save();
        
        return this.jsonResult({ success: true, task: updatedTask });
      }
    );

    this.registerTool(
      {
        name: 'delete_task',
        description: '删除任务',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '任务 ID', required: true },
          },
          required: ['id'],
        },
      },
      async (args) => {
        if (!this.db) return this.errorResult('数据库未初始化');
        
        const tasks = this.db.getTasks() || [];
        const index = tasks.findIndex(t => t.id === args.id);
        
        if (index === -1) {
          return this.errorResult('任务不存在');
        }
        
        const deletedTask = tasks[index];
        tasks.splice(index, 1);
        
        this.vectorQueue?.enqueue('delete', 'tasks', { id: args.id });
        this.db.data.tasks = tasks;
        this.db.save();
        
        return this.jsonResult({ success: true, task: deletedTask });
      }
    );

    this.registerTool(
      {
        name: 'complete_task',
        description: '标记任务为完成',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '任务 ID', required: true },
          },
          required: ['id'],
        },
      },
      async (args) => {
        if (!this.db) return this.errorResult('数据库未初始化');
        
        const tasks = this.db.getTasks() || [];
        const task = tasks.find(t => t.id === args.id);
        
        if (!task) {
          return this.errorResult('任务不存在');
        }
        
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
        task.updatedAt = new Date().toISOString();
        
        this.vectorQueue?.enqueue('upsert', 'tasks', task);
        this.db.data.tasks = tasks;
        this.db.save();
        
        return this.jsonResult({ success: true, task });
      }
    );

    this.registerTool(
      {
        name: 'complete_all_tasks',
        description: '标记所有任务为完成',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        if (!this.db) return this.errorResult('数据库未初始化');
        
        const tasks = this.db.getTasks() || [];
        const now = new Date().toISOString();
        
        tasks.forEach(task => {
          if (task.status !== 'completed') {
            task.status = 'completed';
            task.completedAt = now;
            task.updatedAt = now;
            this.vectorQueue?.enqueue('upsert', 'tasks', task);
          }
        });
        
        this.db.data.tasks = tasks;
        this.db.save();
        
        return this.jsonResult({ success: true, completedCount: tasks.length });
      }
    );

    this.registerTool(
      {
        name: 'get_task_stats',
        description: '获取任务统计信息',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        if (!this.db) return this.errorResult('数据库未初始化');
        
        const tasks = this.db.getTasks() || [];
        const stats = {
          total: tasks.length,
          pending: tasks.filter(t => t.status === 'pending').length,
          completed: tasks.filter(t => t.status === 'completed').length,
          highPriority: tasks.filter(t => t.priority === 'high' && t.status === 'pending').length,
          mediumPriority: tasks.filter(t => t.priority === 'medium' && t.status === 'pending').length,
          lowPriority: tasks.filter(t => t.priority === 'low' && t.status === 'pending').length,
        };
        
        return this.jsonResult({ success: true, stats });
      }
    );
  }
}

if (require.main === module) {
  const server = new TaskMCPServer();
  server.registerTools();
  const mode = process.env.MCP_MODE || 'stdio';
  const port = parseInt(process.env.MCP_PORT) || 3002;
  server.start(mode, port);
}

module.exports = TaskMCPServer;