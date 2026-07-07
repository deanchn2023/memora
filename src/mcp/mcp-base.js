/**
 * MCP Server 基类
 * 支持 JSON-RPC over stdio / HTTP / SSE 三种传输方式
 * 子类只需定义 tools 和 execute 方法
 */
class MCPBaseServer {
  constructor(serverName, version = '1.0.0') {
    this.serverName = serverName;
    this.version = version;
    this.tools = [];
    this.httpServer = null;
  }

  registerTool(tool, handler) {
    this.tools.push({ ...tool, handler });
  }

  _validateArgs(tool, args) {
    if (!tool.inputSchema || !tool.inputSchema.properties) return null;
    
    const errors = [];
    const properties = tool.inputSchema.properties;
    const required = tool.inputSchema.required || [];
    
    for (const propName of required) {
      if (args[propName] === undefined || args[propName] === null) {
        errors.push(`缺少必填参数: ${propName}`);
      }
    }
    
    for (const [propName, propSchema] of Object.entries(properties)) {
      const value = args[propName];
      if (value === undefined) continue;
      
      if (propSchema.type === 'string' && typeof value !== 'string') {
        errors.push(`${propName} 必须是字符串类型`);
      } else if (propSchema.type === 'number' && typeof value !== 'number') {
        errors.push(`${propName} 必须是数字类型`);
      } else if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
        errors.push(`${propName} 必须是布尔类型`);
      } else if (propSchema.type === 'array' && !Array.isArray(value)) {
        errors.push(`${propName} 必须是数组类型`);
      } else if (propSchema.type === 'object' && typeof value !== 'object') {
        errors.push(`${propName} 必须是对象类型`);
      }
      
      if (propSchema.enum && !propSchema.enum.includes(value)) {
        errors.push(`${propName} 必须是以下值之一: ${propSchema.enum.join(', ')}`);
      }
    }
    
    return errors.length > 0 ? errors.join('; ') : null;
  }

  async _handleToolCall(toolName, args) {
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) {
      return this.errorResult(`工具不存在: ${toolName}`);
    }
    
    const validationError = this._validateArgs(tool, args || {});
    if (validationError) {
      return this.errorResult(`参数校验失败: ${validationError}`);
    }
    
    try {
      return await tool.handler(args || {});
    } catch (err) {
      return this.errorResult(err.message);
    }
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
        result = await this._handleToolCall(name, args);
      } else {
        this._sendError(id, -32601, `Method not found: ${method}`);
        return;
      }

      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return { jsonrpc: '2.0', id, error: { code: -32603, message: err.message } };
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

  textResult(text) {
    return { content: [{ type: 'text', text }] };
  }

  jsonResult(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }

  errorResult(message) {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }

  startStdio() {
    let buffer = '';

    process.stdin.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this._handleMessage(msg).then(result => {
            if (result) this._send(result);
          });
        } catch (e) {
          console.error(`[${this.serverName}] Parse error:`, e.message);
        }
      }
    });

    process.stdin.on('end', () => {
      process.exit(0);
    });

    this._send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  }

  startHttp(port = 3002) {
    const http = require('http');
    
    this.httpServer = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
      }

      if (req.method === 'GET') {
        if (req.url === '/') {
          res.end(JSON.stringify({
            name: this.serverName,
            version: this.version,
            tools: this.tools.map(t => ({ name: t.name, description: t.description })),
          }));
          return;
        } else if (req.url === '/tools') {
          const result = {
            tools: this.tools.map(t => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          };
          res.end(JSON.stringify(result));
          return;
        }
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const msg = JSON.parse(body);
            const result = await this._handleMessage(msg);
            res.end(JSON.stringify(result));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    this.httpServer.listen(port, () => {
      console.log(`[${this.serverName}] HTTP Server started on port ${port}`);
    });

    return this.httpServer;
  }

  startSse(port = 3003) {
    const http = require('http');
    
    this.httpServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
      }

      if (req.url === '/sse') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const clientId = Date.now();
        console.log(`[${this.serverName}] SSE client connected: ${clientId}`);

        req.on('close', () => {
          console.log(`[${this.serverName}] SSE client disconnected: ${clientId}`);
        });

        res.write(`event: initialized\ndata: ${JSON.stringify({ name: this.serverName, version: this.version })}\n\n`);
        return;
      }

      if (req.method === 'POST' && req.url === '/call') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const msg = JSON.parse(body);
            const result = await this._handleMessage(msg);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    this.httpServer.listen(port, () => {
      console.log(`[${this.serverName}] SSE Server started on port ${port}`);
    });

    return this.httpServer;
  }

  start(mode = 'stdio', port = 3002) {
    switch (mode) {
      case 'http':
        return this.startHttp(port);
      case 'sse':
        return this.startSse(port);
      case 'stdio':
      default:
        return this.startStdio();
    }
  }

  stop() {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
}

module.exports = MCPBaseServer;