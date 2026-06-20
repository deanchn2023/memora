# MCP 连接器管理系统设计

## 概述

在资产页面新增"连接器"标签，管理 MCP (Model Context Protocol) Server 及其他外部工具连接器。在 CC 模式对话栏增加连接器选择入口，支持按需启用连接器。

## 架构

```
资产页面
  ├── 📚 知识库
  ├── ☁️ 云端资料
  ├── 💻 本地
  ├── 🤖 Agent 产物
  ├── 🧩 Skill
  └── 🔌 连接器 (NEW)
       ├── 连接器列表（卡片式）
       └── 添加/编辑表单

CC 模式对话栏
  ├── 📂 工作目录
  ├── 🧩 Skill 选择
  ├── 🔌 连接器选择 (NEW, 多选)
  └── 🔁 重启CC
```

## 连接器类型

Claude Agent SDK 原生支持三种 MCP Server 传输方式：

### 1. stdio（本地进程）
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "/path/to/db"],
  "env": {}
}
```

### 2. SSE（远程 HTTP SSE）
```json
{
  "type": "sse",
  "url": "http://localhost:3001/sse",
  "headers": {}
}
```

### 3. HTTP（远程 HTTP 流式）
```json
{
  "type": "http",
  "url": "http://localhost:3001/mcp",
  "headers": {}
}
```

## 数据模型

```typescript
interface Connector {
  id: string;           // UUID
  name: string;         // 显示名称
  type: 'stdio' | 'sse' | 'http';
  description: string;   // 用户备注
  enabled: boolean;      // 是否默认启用
  config: {
    // stdio
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    // sse / http
    url?: string;
    headers?: Record<string, string>;
  };
  created_at: string;
  updated_at: string;
}
```

存储：`getSetting('mcp_connectors')` → JSON 字符串数组

## IPC 通道

| 通道 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `connector:list` | `{ enabledOnly?: boolean }` | `Connector[]` | 列出所有/仅启用的连接器 |
| `connector:save` | `Connector` | `{ success, connector }` | 添加或更新（有 id 则更新） |
| `connector:delete` | `{ id }` | `{ success }` | 删除连接器 |
| `connector:toggle` | `{ id, enabled }` | `{ success }` | 启用/禁用 |

## CC SDK 集成

在 `cc:invoke` handler 中，从 `connectors` 参数构建 `mcpServers` 数组：

```javascript
// connectors 参数: ["conn-id-1", "conn-id-2"]  (用户在对话栏选中的连接器 ID 列表)
const allConnectors = getConnectors();
const selectedConnectors = allConnectors.filter(c => 
  connectors?.includes(c.id) || (c.enabled && !connectors)
);

// 构建 mcpServers（SDK 格式：对象数组，每个对象 key 为 server 名）
if (selectedConnectors.length > 0) {
  const mcpServers = selectedConnectors.map(c => {
    const config = { type: c.type };
    if (c.type === 'stdio') {
      config.command = c.config.command;
      config.args = c.config.args;
      config.env = c.config.env;
    } else {
      config.url = c.config.url;
      config.headers = c.config.headers;
    }
    return { [c.name]: config };
  });
  options.mcpServers = mcpServers;
}
```

## 前端交互

### 资产页连接器管理
- 卡片式列表，每张卡片显示：名称、类型标签、描述、启用开关、编辑/删除按钮
- "➕ 添加连接器"按钮 → 弹出表单（类型选择 → 动态字段）
- 预置常用连接器模板（SQLite、PostgreSQL、Web Search 等）

### CC 对话栏连接器选择
- 多选下拉框（checkbox 列表），显示所有已添加的连接器
- 默认勾选 `enabled=true` 的连接器
- 快捷管理按钮（⚙️ 跳转到资产页连接器标签）

## 安全考虑
- stdio 类型：command 白名单校验（禁止 rm/mv/dd/mkfs 等危险命令）
- env 变量中的 API Key 不在 UI 明文显示
- 连接器配置变更后需重启 CC 会话才生效
