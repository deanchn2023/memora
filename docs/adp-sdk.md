# ADP Agent Chat SDK

基于腾讯云 ADP（智能体开发平台）V2 接口的 AI 助手聊天 SDK，开箱即用。

只需配置 **ADP AppKey** 和 **助手名称**，即可在任意项目中嵌入一个功能完整的 AI 对话界面：

- 流式 SSE 对话
- 工具调用进度可视化（步骤条）
- 会话持久化（localStorage，最多 30 条）
- 文件预览面板（HTML 报告 iframe 预览）
- Markdown 渲染（表格/代码块/链接/加粗等）
- 思考过程折叠展示
- Apple Design UI 风格

## 快速开始

### 1. 安装依赖

```bash
npm init -y
npm install fastify @fastify/cors @fastify/static
```

### 2. 配置

编辑 `.env` 文件：

```env
PORT=3201
ADP_APP_KEY=你的ADP应用AppKey
ADP_URL=https://wss.lke.cloud.tencent.com/adp/v2/chat
AGENT_NAME=我的AI助手
AGENT_DESC=基于腾讯云 ADP 智能体
```

### 3. 启动服务

```bash
node server.js
```

访问 `http://localhost:3201`

## 项目结构

```
ADP-Agent-SDK/
├── README.md              # 本文件
├── .env.example           # 环境变量模板
├── package.json           # 依赖声明
├── server.js              # 后端服务（仅 ADP 代理 + 文件代理）
├── public/
│   ├── index.html         # 前端入口页
│   ├── css/
│   │   └── agent-sdk.css  # 助手样式（973行，Apple Design）
│   └── js/
│       └── agent-sdk.js   # 前端 SDK 核心（可配置）
```

## 前端使用方式

### 方式一：直接引用（最简单）

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="css/agent-sdk.css">
</head>
<body>
  <div id="my-agent"></div>
  <script src="js/agent-sdk.js"></script>
  <script>
    ADPAgent.init({
      containerId: 'my-agent',
      appName: '数据分析师',
      appDesc: '智能数据分析助手',
      apiUrl: '/api/agent/chat',
      suggestions: [
        '帮我分析上季度销售趋势',
        '对比 A 品牌和 B 品牌',
        '生成月度报告'
      ]
    });
  </script>
</body>
</html>
```

### 方式二：ES Module 引入

```js
import { ADPAgent } from './js/agent-sdk.js';

ADPAgent.init({
  containerId: 'app',
  appName: '客服助手',
  appDesc: '7x24 智能客服',
  apiUrl: '/api/agent/chat',
});
```

## 可配置项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `containerId` | string | `'page-agent'` | 渲染容器的 DOM ID |
| `appName` | string | `'AI 助手'` | 助手名称（显示在标题栏） |
| `appDesc` | string | `'腾讯云 ADP 智能体 · 流式对话'` | 助手描述 |
| `apiUrl` | string | `'/api/agent/chat'` | 后端 SSE 聊天接口路径 |
| `fileProxyUrl` | string | `'/api/agent/file'` | 文件代理接口路径 |
| `storagePrefix` | string | `'adp_agent'` | localStorage 键名前缀（多实例隔离） |
| `maxStoredConvs` | number | `30` | 最大保存会话数 |
| `suggestions` | string[] | 见下方 | 空态快捷建议按钮文字 |
| `toolIcons` | object | 见下方 | 工具调用图标映射 |
| `toolLabels` | object | 见下方 | 工具调用标签映射 |

### 默认工具图标

```js
{
  get_feature_rates: '📊',    // 查询标配率
  get_brand_summary: '📋',     // 查询品牌概览
  render_chart: '📈',          // 渲染图表
  write: '📝',                  // 生成报告
  FileToURL: '🔗',             // 获取文件链接
  search: '🔍',                 // 搜索数据
  default: '🔧'                // 默认工具
}
```

你可以覆盖这些图标来匹配你的业务场景。

## 后端说明

`server.js` 仅包含两个路由，极简设计：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/chat` | ADP V2 SSE 代理（转发到腾讯云） |
| GET | `/api/agent/file?url=` | 文件代理（白名单域名，用于 iframe 预览） |

### 安全特性

- AppKey 通过环境变量配置，不硬编码
- 文件代理只允许白名单域名（ADP 域名 + Sandbox 域名）
- iframe 使用 `sandbox="allow-scripts allow-popups allow-forms"` （不含 allow-same-origin）
- Node.js HTTP keep-alive timeout 设为 5 分钟，避免长连接断开
- 服务端心跳每 15 秒一次，保持连接活跃

## 与现有项目的集成

如果你已有 Express/Fastify 项目，只需将 `server.js` 中的两个路由复制过去即可：

```js
// 在你的 Fastify/Express 应用中注册这两个路由
import { registerAgentRoutes } from './adp-agent-sdk/server-routes.js';

registerAgentRoutes(app, {
  adpAppKey: process.env.ADP_APP_KEY,
  adpUrl: process.env.ADP_URL || 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
  allowedDomains: ['https://wss.lke.cloud.tencent.com/', 'https://sandbox.adp.cloud.tencent.com/'],
});
```

## 技术细节

### SSE 事件处理

SDK 完整处理了 ADP V2 的所有事件类型：

| 事件类型 | 处理方式 |
|----------|----------|
| `request_ack` | 显示"请求已发送"步骤 |
| `response.created` | 显示"智能体已接收"步骤 |
| `message.added` | 工具调用 → 步骤条；回复 → 开始文本渲染 |
| `text.delta` | 追加流式文本 |
| `text.replace` | 替换全文（修正模式） |
| `message.done` | 标记步骤完成，解析结果（JSON/文件卡片） |
| `response.completed` | 显示 token 统计 |
| `error` | 显示错误信息 |
| `thought` / `<think/>` | 折叠展示思考过程 |
| `[DONE]` | 结束渲染，折叠进度条 |

### 会话管理

- 自动从 localStorage 加载上次对话
- 页面隐藏/关闭时自动保存
- 支持会话切换、删除、新建
- 会话标题取自首条用户消息前 50 字符
- 存储结构：元数据列表 + 各会话 HTML 快照

### 浏览器兼容性

- 现代浏览器（Chrome 90+、Firefox 88+、Safari 14+、Edge 90+）
- 使用原生 Fetch API + ReadableStream（无需额外依赖）
- 响应式布局适配 PC 和移动端

## License

MIT
