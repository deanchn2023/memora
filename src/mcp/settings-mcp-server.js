/**
 * 设置 MCP Server
 * 提供应用设置的读写工具
 */

const MCPBaseServer = require('./mcp-base');

class SettingsMCPServer extends MCPBaseServer {
  constructor(version = '1.0.0') {
    super('memora-settings', version);
    this.getSetting = null;
    this.setSetting = null;
    this.deleteSetting = null;
    this.settingsCache = null;
    this.authState = null;
  }

  setDependencies(getSetting, setSetting, deleteSetting, settingsCache, authState) {
    this.getSetting = getSetting;
    this.setSetting = setSetting;
    this.deleteSetting = deleteSetting;
    this.settingsCache = settingsCache;
    this.authState = authState;
  }

  registerTools() {
    this.registerTool(
      {
        name: 'get_setting',
        description: '获取单个设置项',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '设置项键名', required: true },
          },
          required: ['key'],
        },
      },
      async (args) => {
        if (!this.getSetting) return this.errorResult('设置系统未初始化');
        
        const value = this.getSetting(args.key);
        
        return this.jsonResult({ success: true, key: args.key, value });
      }
    );

    this.registerTool(
      {
        name: 'set_setting',
        description: '设置单个设置项',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '设置项键名', required: true },
            value: { type: ['string', 'number', 'boolean', 'object'], description: '设置项值', required: true },
          },
          required: ['key', 'value'],
        },
      },
      async (args) => {
        if (!this.setSetting) return this.errorResult('设置系统未初始化');
        
        this.setSetting(args.key, args.value);
        
        return this.jsonResult({ success: true, key: args.key, value: args.value });
      }
    );

    this.registerTool(
      {
        name: 'delete_setting',
        description: '删除设置项',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '设置项键名', required: true },
          },
          required: ['key'],
        },
      },
      async (args) => {
        if (!this.deleteSetting) return this.errorResult('设置系统未初始化');
        
        this.deleteSetting(args.key);
        
        return this.jsonResult({ success: true, key: args.key });
      }
    );

    this.registerTool(
      {
        name: 'list_settings',
        description: '列出所有设置项（过滤敏感信息）',
        inputSchema: {
          type: 'object',
          properties: {
            prefix: { type: 'string', description: '按前缀过滤' },
          },
          required: [],
        },
      },
      async (args) => {
        if (!this.settingsCache) return this.errorResult('设置系统未初始化');
        
        const sensitiveKeys = ['api_key', 'auth_token', 'password', 'secret', 'key'];
        const prefix = args.prefix || '';
        
        const filtered = {};
        for (const [key, value] of Object.entries(this.settingsCache)) {
          if (!key.startsWith(prefix)) continue;
          
          const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk));
          filtered[key] = isSensitive ? '***' : value;
        }
        
        return this.jsonResult({ success: true, settings: filtered, count: Object.keys(filtered).length });
      }
    );

    this.registerTool(
      {
        name: 'get_ai_config',
        description: '获取 AI 相关配置',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        if (!this.getSetting) return this.errorResult('设置系统未初始化');
        
        const config = {
          apiKey: '***',
          model: this.getSetting('ai_model') || '',
          baseUrl: this.getSetting('ai_base_url') || '',
          dailyLimit: parseInt(this.getSetting('ai_daily_limit')) || 0,
          globalAiMode: this.getSetting('global_ai_mode') || 'auto',
        };
        
        return this.jsonResult({ success: true, config });
      }
    );

    this.registerTool(
      {
        name: 'set_ai_config',
        description: '设置 AI 相关配置',
        inputSchema: {
          type: 'object',
          properties: {
            apiKey: { type: 'string', description: 'API Key' },
            model: { type: 'string', description: '模型名称' },
            baseUrl: { type: 'string', description: '基础 URL' },
            dailyLimit: { type: 'number', description: '每日限额' },
            globalAiMode: { type: 'string', description: '全局 AI 模式', enum: ['auto', 'manual', 'off'] },
          },
          required: [],
        },
      },
      async (args) => {
        if (!this.setSetting) return this.errorResult('设置系统未初始化');
        
        if (args.apiKey) this.setSetting('ai_api_key', args.apiKey);
        if (args.model) this.setSetting('ai_model', args.model);
        if (args.baseUrl) this.setSetting('ai_base_url', args.baseUrl);
        if (args.dailyLimit !== undefined) this.setSetting('ai_daily_limit', args.dailyLimit.toString());
        if (args.globalAiMode) this.setSetting('global_ai_mode', args.globalAiMode);
        
        return this.jsonResult({ success: true });
      }
    );

    this.registerTool(
      {
        name: 'get_clipboard_config',
        description: '获取剪贴板监控配置',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        if (!this.getSetting) return this.errorResult('设置系统未初始化');
        
        const config = {
          enabled: this.getSetting('clipboard_enabled') === 'true',
          interval: parseInt(this.getSetting('clipboard_interval')) || 2000,
          minLength: parseInt(this.getSetting('clipboard_min_length')) || 10,
        };
        
        return this.jsonResult({ success: true, config });
      }
    );

    this.registerTool(
      {
        name: 'set_clipboard_config',
        description: '设置剪贴板监控配置',
        inputSchema: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', description: '是否启用' },
            interval: { type: 'number', description: '监控间隔(毫秒)' },
            minLength: { type: 'number', description: '最小文本长度' },
          },
          required: [],
        },
      },
      async (args) => {
        if (!this.setSetting) return this.errorResult('设置系统未初始化');
        
        if (args.enabled !== undefined) this.setSetting('clipboard_enabled', args.enabled ? 'true' : 'false');
        if (args.interval) this.setSetting('clipboard_interval', args.interval.toString());
        if (args.minLength) this.setSetting('clipboard_min_length', args.minLength.toString());
        
        return this.jsonResult({ success: true });
      }
    );

    this.registerTool(
      {
        name: 'get_auth_state',
        description: '获取认证状态',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        if (!this.authState) return this.errorResult('认证系统未初始化');
        
        const state = {
          isLoggedIn: this.authState.isLoggedIn || false,
          user: this.authState.user ? {
            id: this.authState.user.id,
            name: this.authState.user.name,
            email: this.authState.user.email,
            role: this.authState.user.role,
          } : null,
          forceLocalConfig: this.authState.forceLocalConfig || false,
        };
        
        return this.jsonResult({ success: true, state });
      }
    );

    this.registerTool(
      {
        name: 'get_cc_config',
        description: '获取 Claude Code 配置',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        if (!this.getSetting) return this.errorResult('设置系统未初始化');
        
        const config = {
          enabled: this.getSetting('cc_enabled') === 'true',
          provider: this.getSetting('cc_provider') || '',
          baseUrl: this.getSetting('cc_base_url') || '',
        };
        
        return this.jsonResult({ success: true, config });
      }
    );

    this.registerTool(
      {
        name: 'get_adp_config',
        description: '获取 ADP 配置',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        if (!this.getSetting) return this.errorResult('设置系统未初始化');
        
        const config = {
          enabled: this.getSetting('adp_enabled') === 'true',
          appKey: '***',
          baseUrl: this.getSetting('adp_base_url') || '',
        };
        
        return this.jsonResult({ success: true, config });
      }
    );
  }
}

if (require.main === module) {
  const server = new SettingsMCPServer();
  server.registerTools();
  const mode = process.env.MCP_MODE || 'stdio';
  const port = parseInt(process.env.MCP_PORT) || 3004;
  server.start(mode, port);
}

module.exports = SettingsMCPServer;