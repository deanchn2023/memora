/**
 * 记事本 MCP Server
 * 提供记事本的增删改查工具
 */

const MCPBaseServer = require('./mcp-base');

class NotebookMCPServer extends MCPBaseServer {
  constructor(version = '1.0.0') {
    super('memora-notebook', version);
    this.notebook = null;
    this.vectorQueue = null;
    this.feedbackLogger = null;
  }

  setDependencies(notebook, vectorQueue, feedbackLogger) {
    this.notebook = notebook;
    this.vectorQueue = vectorQueue;
    this.feedbackLogger = feedbackLogger;
  }

  registerTools() {
    this.registerTool(
      {
        name: 'get_notes',
        description: '获取笔记列表',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: '分类筛选' },
            limit: { type: 'number', description: '返回数量限制', default: 50 },
          },
          required: [],
        },
      },
      async (args) => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const category = args.category;
        const limit = args.limit || 50;
        
        let notes = [];
        if (category) {
          notes = this.notebook.getNotesByCategory(category) || [];
        } else {
          notes = this.notebook.getAllNotes ? this.notebook.getAllNotes() : [];
        }
        
        notes = notes.slice(0, limit);
        
        return this.jsonResult({ success: true, notes });
      }
    );

    this.registerTool(
      {
        name: 'get_note',
        description: '获取单个笔记详情',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '笔记 ID', required: true },
          },
          required: ['id'],
        },
      },
      async (args) => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const note = this.notebook.getNoteById(args.id);
        
        if (!note) {
          return this.errorResult('笔记不存在');
        }
        
        return this.jsonResult({ success: true, note });
      }
    );

    this.registerTool(
      {
        name: 'create_note',
        description: '创建新笔记',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '笔记标题' },
            content: { type: 'string', description: '笔记内容', required: true },
            category: { type: 'string', description: '分类', default: 'general' },
            tags: { type: 'array', description: '标签列表', items: { type: 'string' } },
          },
          required: ['content'],
        },
      },
      async (args) => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const noteData = {
          title: args.title || '',
          content: args.content,
          category: args.category || 'general',
          tags: args.tags || [],
        };
        
        const result = this.notebook.addNote(noteData);
        
        if (!result) {
          return this.jsonResult({ success: true, duplicate: true, note: null });
        }
        
        this.vectorQueue?.enqueue('upsert', 'notes', result);
        
        return this.jsonResult({ success: true, note: result });
      }
    );

    this.registerTool(
      {
        name: 'update_note',
        description: '更新笔记',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '笔记 ID', required: true },
            title: { type: 'string', description: '笔记标题' },
            content: { type: 'string', description: '笔记内容' },
            category: { type: 'string', description: '分类' },
            tags: { type: 'array', description: '标签列表', items: { type: 'string' } },
          },
          required: ['id'],
        },
      },
      async (args) => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const updates = { ...args };
        delete updates.id;
        
        const result = this.notebook.updateNote(args.id, updates);
        
        if (!result) {
          return this.errorResult('更新失败，笔记不存在');
        }
        
        if (this.feedbackLogger && updates.category) {
          const note = this.notebook.getNoteById(args.id);
          if (note && note.analysis) {
            this.feedbackLogger.recordFeedback({
              module: 'clipboard_analysis',
              action: 'edit',
              trace_id: note.analysis.traceId || null,
              ai_output: {
                category: note.analysis.tags ? note.analysis.tags.join(',') : '',
                is_task: note.analysis.isTask,
                needs_recommendation: note.analysis.needsRecommendation
              },
              user_final: { category: updates.category },
              context: { source_input: note.content?.substring(0, 100) },
              reason: updates.category !== (note.analysis.isTask ? 'task' : 'general') ? '用户调整了分类' : '更新笔记'
            });
          }
        }
        
        this.vectorQueue?.enqueue('upsert', 'notes', result);
        
        return this.jsonResult({ success: true, note: result });
      }
    );

    this.registerTool(
      {
        name: 'delete_note',
        description: '删除笔记',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '笔记 ID', required: true },
            reason: { type: 'string', description: '删除原因' },
          },
          required: ['id'],
        },
      },
      async (args) => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const note = this.notebook.getNoteById(args.id);
        
        if (!note) {
          return this.errorResult('笔记不存在');
        }
        
        if (this.feedbackLogger && note.analysis) {
          this.feedbackLogger.recordFeedback({
            module: 'clipboard_analysis',
            action: 'reject',
            trace_id: note.analysis.traceId || null,
            ai_output: {
              is_valid_info: true,
              is_task: note.analysis.isTask,
              category: note.category,
              needs_recommendation: note.analysis.needsRecommendation,
              tags: note.analysis.tags
            },
            user_final: { is_valid_info: false },
            context: { source_input: note.content?.substring(0, 100) },
            reason: args.reason || '用户删除笔记'
          });
        }
        
        const success = this.notebook.deleteNote(args.id);
        
        if (success) {
          this.vectorQueue?.enqueue('delete', 'notes', { id: args.id });
        }
        
        return this.jsonResult({ success });
      }
    );

    this.registerTool(
      {
        name: 'search_notes',
        description: '搜索笔记',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词', required: true },
            limit: { type: 'number', description: '返回数量限制', default: 20 },
          },
          required: ['query'],
        },
      },
      async (args) => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const notes = this.notebook.searchNotes(args.query) || [];
        const limited = notes.slice(0, args.limit || 20);
        
        return this.jsonResult({ success: true, notes: limited });
      }
    );

    this.registerTool(
      {
        name: 'change_note_category',
        description: '修改笔记分类',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '笔记 ID', required: true },
            category: { type: 'string', description: '新分类', required: true },
          },
          required: ['id', 'category'],
        },
      },
      async (args) => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const note = this.notebook.getNoteById(args.id);
        
        if (!note) {
          return this.errorResult('笔记不存在');
        }
        
        const result = this.notebook.updateNote(args.id, { category: args.category });
        
        if (!result) {
          return this.errorResult('更新失败');
        }
        
        if (this.feedbackLogger && note.analysis) {
          this.feedbackLogger.recordFeedback({
            module: 'clipboard_analysis',
            action: 'edit',
            trace_id: note.analysis.traceId || null,
            ai_output: {
              category: note.analysis.tags ? note.analysis.tags.join(',') : '',
              is_task: note.analysis.isTask,
              needs_recommendation: note.analysis.needsRecommendation
            },
            user_final: { category: args.category },
            context: { source_input: note.content?.substring(0, 100) },
            reason: '用户调整了分类'
          });
        }
        
        this.vectorQueue?.enqueue('upsert', 'notes', result);
        
        return this.jsonResult({ success: true, note: result });
      }
    );

    this.registerTool(
      {
        name: 'batch_change_category',
        description: '批量修改笔记分类',
        inputSchema: {
          type: 'object',
          properties: {
            ids: { type: 'array', description: '笔记 ID 列表', items: { type: 'string' }, required: true },
            category: { type: 'string', description: '新分类', required: true },
          },
          required: ['ids', 'category'],
        },
      },
      async (args) => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const results = [];
        
        for (const id of args.ids) {
          const note = this.notebook.getNoteById(id);
          if (note) {
            const result = this.notebook.updateNote(id, { category: args.category });
            if (result) {
              this.vectorQueue?.enqueue('upsert', 'notes', result);
              results.push({ id, success: true });
            } else {
              results.push({ id, success: false });
            }
          } else {
            results.push({ id, success: false, error: '笔记不存在' });
          }
        }
        
        return this.jsonResult({ success: true, results });
      }
    );

    this.registerTool(
      {
        name: 'get_categories',
        description: '获取分类列表',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const categories = this.notebook.getCategories ? this.notebook.getCategories() : [];
        
        return this.jsonResult({ success: true, categories });
      }
    );

    this.registerTool(
      {
        name: 'save_categories',
        description: '保存分类配置',
        inputSchema: {
          type: 'object',
          properties: {
            categories: { type: 'object', description: '分类配置对象', required: true },
          },
          required: ['categories'],
        },
      },
      async (args) => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const success = this.notebook.saveCategories ? this.notebook.saveCategories(args.categories) : true;
        
        return this.jsonResult({ success });
      }
    );

    this.registerTool(
      {
        name: 'get_notebook_stats',
        description: '获取记事本统计信息',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const stats = this.notebook.getStats ? this.notebook.getStats() : {};
        
        return this.jsonResult({ success: true, stats });
      }
    );

    this.registerTool(
      {
        name: 'delete_notes_by_category',
        description: '删除指定分类下的所有笔记',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: '分类名称', required: true },
          },
          required: ['category'],
        },
      },
      async (args) => {
        if (!this.notebook) return this.errorResult('记事本未初始化');
        
        const success = this.notebook.deleteNotesByCategory ? 
          this.notebook.deleteNotesByCategory(args.category) : false;
        
        return this.jsonResult({ success });
      }
    );
  }
}

if (require.main === module) {
  const server = new NotebookMCPServer();
  server.registerTools();
  const mode = process.env.MCP_MODE || 'stdio';
  const port = parseInt(process.env.MCP_PORT) || 3003;
  server.start(mode, port);
}

module.exports = NotebookMCPServer;