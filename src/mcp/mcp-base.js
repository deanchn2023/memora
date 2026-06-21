/**
 * MCP Server 基类
 * 复用 JSON-RPC over stdio 协议，子类只需定义 tools 和 execute 方法
 */
class MCPBaseServer {
  constructor(serverName, version = '1.0.0') {
    this.serverName = serverName;
    this.version = version;
    this.tools = [];
  }

  /**
   * 注册工具
   * @param {Object} tool - { name, description, inputSchema }
   * @param {Function} handler - async (args) => { content: [{ type: 'text', text }] }
   */
  registerTool(tool, handler) {
    this.tools.push({ ...tool, handler });
  }

  /**
   * 启动 MCP Server（监听 stdin/stdout JSON-RPC）
   */
  start() {
    let buffer = '';

    process.stdin.on('data', (chunk) => {
      buffer += chunk.toString();
      // 按换行分割，处理完整的 JSON-RPC 消息
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的行

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this._handleMessage(msg);
        } catch (e) {
          console.error(`[${this.serverName}] Parse error:`, e.message);
        }
      }
    });

    process.stdin.on('end', () => {
      process.exit(0);
    });

    // 发送初始化就绪信号
    this._send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  }

  async _handleMessage(msg) {
    const { id, method, params } = msg;

    try {
      let result;

      if (method === 'initialize') {
        result = {
          protocolVersion: '2024-11-05',
          serverInfo: { name: this.serverName, version: this.version },
          capabilities: { tools: {} },
        };
      } else if (method === 'tools/list') {
        result = {
          tools: this.tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        };
      } else if (method === 'tools/call') {
        const { name, arguments: args } = params;
        const tool = this.tools.find(t => t.name === name);
        if (!tool) {
          this._sendError(id, -32601, `Tool not found: ${name}`);
          return;
        }
        result = await tool.handler(args || {});
      } else {
        this._sendError(id, -32601, `Method not found: ${method}`);
        return;
      }

      this._send({ jsonrpc: '2.0', id, result });
    } catch (err) {
      this._sendError(id, -32603, err.message);
    }
  }

  _send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
  }

  _sendError(id, code, message) {
    this._send({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
  }

  /**
   * 构造文本结果
   */
  textResult(text) {
    return { content: [{ type: 'text', text }] };
  }

  /**
   * 构造错误结果（仍然返回 200，但内容包含错误信息）
   */
  errorResult(message) {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}

module.exports = MCPBaseServer;
