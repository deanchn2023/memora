# OpenRouter 集成方案对比设计

## 1. 背景

在 M-Agent 模式下接入 OpenRouter 多模型能力。当前 M-Agent 使用 `@anthropic-ai/claude-agent-sdk`（Claude Code Agent SDK），通过环境变量 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL` 指向一个 Anthropic 兼容 API 端点。

SDK 内部管理完整的 Agent Loop：工具调用、流式渲染、上下文管理、会话恢复、Skill 加载、MCP 连接器等。

OpenRouter 使用 OpenAI 兼容格式（`/v1/chat/completions`），不提供 Anthropic 兼容端点。

### 用户要求
- **不想更改 harness 层 / agent loop**
- 想保持使用 Claude Code Agent SDK（Anthropic 持续维护更新）
- 不想自己开发 agent loop（无人维护更新）
- 先设计，不开发

## 2. 方案概览

### 方案 A：自建 Agent Loop（原设计）
自己实现 OpenAI 格式的 Agent Loop，独立于 CC SDK。

### 方案 B：Anthropic 兼容代理（新方案）
构建一个本地代理服务，将 Anthropic Messages API 格式翻译为 OpenAI Chat Completions 格式，转发给 OpenRouter，SDK 不做任何改动。

---

## 3. 方案 A：自建 Agent Loop

### 3.1 架构

```
用户发送消息
    │
    ├─ 未选 OpenRouter 模型 → cc:invoke（现有路径）
    │   └─ Claude Code Agent SDK → Coding Plan 服务
    │       （完整功能：工具链、Skill、MCP、会话恢复）
    │
    └─ 选择了 OpenRouter 模型 → openrouter:invoke（新增路径）
        └─ 自建 Agent Loop → OpenRouter API
            （OpenAI 格式，本地实现工具调用循环）
```

### 3.2 核心实现

需要在 `main.js` 中新增一个完整的 Agent Loop：

```javascript
// 伪代码
for (let turn = 0; turn < maxTurns; turn++) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, tools, stream: true })
  });

  // 解析 SSE 流
  // text delta → cc:stream 推送前端
  // tool_calls → 执行工具 → 追加结果到 messages → 继续循环
  // 无 tool_calls → 结束
}
```

### 3.3 需要自行实现的功能

| 功能 | 说明 | 复杂度 |
|------|------|--------|
| 工具执行循环 | Read/Write/Edit/Bash/Grep/Glob/WebSearch | 高 |
| SSE 流式解析 | OpenAI delta 格式 → cc:stream 事件映射 | 中 |
| 工具权限控制 | permissionMode + allowedTools 过滤 | 中 |
| 上下文管理 | 消息历史、token 限制、截断 | 高 |
| 会话恢复 | session_id 管理（需自建） | 高 |
| Skill 加载 | 扫描 .claude/skills/ 目录并注入 prompt | 中 |
| MCP 连接器 | 启动 MCP Server 子进程 + 工具注册 | 极高 |
| 思考链（thinking） | 部分模型支持，需自行处理 | 中 |

### 3.4 优缺点

**优点：**
- 完全自主可控
- 可以精确控制每一步行为
- 不依赖外部代理服务

**缺点：**
- ❌ **需要自行维护整个 Agent Loop**，Anthropic 更新 SDK 后需手动跟进
- ❌ **无法复用 CC SDK 的 Skill / MCP / 会话恢复等高级功能**
- ❌ **开发量大**（预估 ~9h，实际可能更多）
- ❌ **长期维护负担**：Agent Loop 逻辑复杂，bug 修复和功能更新无人保证
- ❌ **两套代码路径**：Coding Plan 走 SDK，OpenRouter 走自建 Loop，行为可能不一致

---

## 4. 方案 B：Anthropic 兼容代理

### 4.1 核心思路

构建一个轻量级本地 HTTP 代理服务，**在 Anthropic Messages API 和 OpenAI Chat Completions API 之间做格式翻译**。SDK 指向这个代理，代理再转发给 OpenRouter。

```
Claude Code Agent SDK
    │
    │  ANTHROPIC_BASE_URL = http://localhost:3999
    │  ANTHROPIC_AUTH_TOKEN = dummy (代理注入真实 Key)
    │  ANTHROPIC_MODEL = anthropic/claude-sonnet-4 (OpenRouter slug)
    │
    ▼
本地代理 (localhost:3999)
    │
    │  ① 接收 Anthropic 格式请求 (POST /v1/messages)
    │  ② 翻译为 OpenAI 格式 (POST /v1/chat/completions)
    │  ③ 添加 Authorization: Bearer <OpenRouter API Key>
    │  ④ 转发给 OpenRouter
    │  ⑤ 接收 OpenAI 格式响应
    │  ⑥ 翻译回 Anthropic 格式
    │
    ▼
OpenRouter API (https://openrouter.ai/api/v1)
```

**SDK 完全不需要改动**——它以为自己在和真正的 Anthropic API 通信。

### 4.2 API 格式翻译映射

#### 4.2.1 请求翻译（Anthropic → OpenAI）

| Anthropic 格式 | OpenAI 格式 | 说明 |
|----------------|-------------|------|
| `model: "anthropic/claude-sonnet-4"` | `model: "anthropic/claude-sonnet-4"` | 直接透传（OpenRouter slug 即模型名） |
| `system: "You are..."` | `messages: [{role: "system", content: "..."}]` | 系统提示词从顶层移到消息数组头部 |
| `messages: [{role, content}]` | `messages: [{role, content}]` | 基本一致 |
| `max_tokens: 8192` | `max_tokens: 8192` | 直接透传 |
| `temperature: 0.7` | `temperature: 0.7` | 直接透传 |
| `tools: [{name, description, input_schema}]` | `tools: [{type: "function", function: {name, description, parameters}}]` | `input_schema` → `parameters` |
| `tool_choice: {type: "auto"}` | `tool_choice: "auto"` | 简化格式 |
| `stream: true` | `stream: true` | 直接透传 |
| `content: [{type: "text", text}]` | `content: "text"` | content block 简化为字符串 |
| `content: [{type: "image", source: {type: "base64", media_type, data}}]` | `content: [{type: "image_url", image_url: {url: "data:...;base64,..."}}]` | 图片格式转换 |
| `content: [{type: "tool_use", id, name, input}]` | `tool_calls: [{id, type: "function", function: {name, arguments: JSON.stringify(input)}}]` | 工具调用格式转换 |
| `content: [{type: "tool_result", tool_use_id, content}]` | `{role: "tool", tool_call_id, content}` | 工具结果格式转换 |

#### 4.2.2 响应翻译（OpenAI → Anthropic）

**非流式响应：**

| OpenAI 格式 | Anthropic 格式 | 说明 |
|-------------|----------------|------|
| `id` | `id` | 直接透传 |
| `choices[0].message.content` | `content: [{type: "text", text: "..."}]` | 字符串转 content block |
| `choices[0].message.tool_calls` | `content: [{type: "tool_use", id, name, input}]` | `arguments` JSON 字符串 → `input` 对象 |
| `choices[0].finish_reason: "stop"` | `stop_reason: "end_turn"` | 映射 |
| `choices[0].finish_reason: "tool_calls"` | `stop_reason: "tool_use"` | 映射 |
| `usage.prompt_tokens` | `usage.input_tokens` | 重命名 |
| `usage.completion_tokens` | `usage.output_tokens` | 重命名 |

**流式响应（SSE 事件映射）：**

| OpenAI SSE 事件 | Anthropic SSE 事件 | 说明 |
|-----------------|-------------------|------|
| 首个 chunk | `event: message_start` `{type: "message", id, role: "assistant", ...}` | 消息开始 |
| `delta.content` | `event: content_block_delta` `{type: "text_delta", text: "..."}` | 文本增量 |
| `delta.tool_calls[].function.name` | `event: content_block_start` `{type: "tool_use", id, name}` | 工具调用开始 |
| `delta.tool_calls[].function.arguments` | `event: content_block_delta` `{type: "input_json_delta", partial_json: "..."}` | 工具参数增量 |
| (工具调用结束) | `event: content_block_stop` | 内容块结束 |
| `finish_reason: "stop"` | `event: message_delta` `{stop_reason: "end_turn"}` + `event: message_stop` | 消息结束 |
| `finish_reason: "tool_calls"` | `event: message_delta` `{stop_reason: "tool_use"}` + `event: message_stop` | 工具调用结束 |
| `[DONE]` | `event: message_stop` | 流结束 |

#### 4.2.3 需要剥离的 Anthropic 专有字段

代理在翻译时需要处理（剥离或忽略）以下 Anthropic 专有字段，避免 OpenRouter 报错：

| 字段 | 处理方式 |
|------|----------|
| `anthropic-version` header | 忽略（仅 Anthropic 需要） |
| `anthropic-beta` header | 忽略 |
| `cache_control` | 剥离（prompt caching 是 Anthropic 专有） |
| `thinking` / `extended_thinking` | 剥离（如果 SDK 发送了的话） |
| `top_k` | 透传（部分 OpenRouter 模型支持） |

### 4.3 代理实现方案

#### 4.3.1 方案 B-1：嵌入式 Node.js 代理（推荐）

在 Electron 主进程中嵌入一个轻量 HTTP 代理：

```javascript
// 伪代码 - 代理核心
const http = require('http');

function createAnthropicProxy({ openRouterApiKey, openRouterBaseUrl, port }) {
  const server = http.createServer(async (req, res) => {
    // 只处理 /v1/messages
    if (req.method === 'POST' && req.url === '/v1/messages') {
      const body = await readBody(req);
      const anthropicReq = JSON.parse(body);

      // ① 翻译为 OpenAI 格式
      const openaiReq = translateToOpenAI(anthropicReq);

      // ② 转发给 OpenRouter
      const upstream = await fetch(`${openRouterBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openRouterApiKey}`,
          'HTTP-Referer': 'https://memora.app',  // OpenRouter 归因
          'X-OpenRouter-Title': 'Memora M-Agent',
        },
        body: JSON.stringify(openaiReq),
      });

      // ③ 流式翻译响应
      if (anthropicReq.stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        // 逐 chunk 翻译 SSE 事件
        translateStream(upstream.body, res);
      } else {
        const openaiResp = await upstream.json();
        const anthropicResp = translateToAnthropic(openaiResp);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(anthropicResp));
      }
    }

    // 模型列表（OpenRouter 的 /v1/models 映射到 Anthropic 格式）
    if (req.method === 'GET' && req.url === '/v1/models') {
      // 代理 OpenRouter 模型列表
    }
  });

  server.listen(port, '127.0.0.1');
  return server;
}
```

**优点：**
- ✅ 无外部依赖（纯 Node.js，Electron 自带）
- ✅ 随 Electron 进程启动/关闭，无需额外管理
- ✅ 代理代码量小（预估 ~300-500 行）
- ✅ 可完全控制翻译逻辑

**缺点：**
- 需要自行编写翻译逻辑（但已有多个开源参考）

#### 4.3.2 方案 B-2：使用现成开源代理

已有多个成熟的开源项目实现 Anthropic ↔ OpenAI 格式转换：

| 项目 | 语言 | Stars | 特点 |
|------|------|-------|------|
| [claude-code-proxy](https://github.com/1rgs/claude-code-proxy) | Python | 3.6k | 基于 LiteLLM，专为 Claude Code 设计 |
| [@kiyo-e/claude-code-proxy](https://www.npmjs.com/package/@kiyo-e/claude-code-proxy) | TS/Bun | - | npm 包，Hono 框架 |
| [anthropic-proxy-rs](https://github.com/m0n0x41d/anthropic-proxy-rs) | Rust | - | 高性能 Rust 实现 |
| [LiteLLM](https://github.com/BerriAI/litellm) | Python | 18k+ | 最成熟的 LLM 网关，支持 100+ 提供商 |

**优点：**
- ✅ 不用自己写翻译逻辑
- ✅ 社区维护，持续更新

**缺点：**
- ❌ Python 方案需要额外运行时（Python/uv）
- ❌ 需要作为独立进程管理（启动/停止/健康检查）
- ❌ 可能不完全适配 Memora 的需求（如 OpenRouter 归因 header）
- ❌ LiteLLM 代理较重，启动慢

#### 4.3.3 推荐：B-1（嵌入式 Node.js 代理）

理由：
1. Electron 应用自带 Node.js，零额外依赖
2. 代理逻辑简单（格式映射表），参考开源项目可快速实现
3. 随主进程生命周期管理，无需运维
4. 可以精确控制代理行为（如 OpenRouter 归因、模型名映射等）

### 4.4 SDK 调用流程（方案 B）

```
用户选择 OpenRouter 模型（如 "anthropic/claude-sonnet-4"）
    │
    ▼
main.js 检测到选择了 OpenRouter 模型
    │
    ├─ ① 确保代理已启动（localhost:3999）
    ├─ ② 设置环境变量：
    │     ANTHROPIC_BASE_URL = http://localhost:3999
    │     ANTHROPIC_AUTH_TOKEN = dummy
    │     ANTHROPIC_MODEL = anthropic/claude-sonnet-4
    │
    ▼
调用 sdk.query({ prompt, options })
    │
    ▼
SDK 发送 POST http://localhost:3999/v1/messages（Anthropic 格式）
    │
    ▼
代理翻译为 OpenAI 格式 → 转发 OpenRouter → 翻译回 Anthropic 格式
    │
    ▼
SDK 正常解析响应，执行工具调用（Read/Write/Edit/Bash/Grep/Glob/WebSearch）
    │
    ▼
SDK 通过 cc:stream 推送到前端（与现有逻辑完全一致）
```

**前端代码几乎不需要改动**——`_handleCCStreamEvent`、工具渲染、Skill/MCP 加载全部复用。

### 4.5 方案 B 优缺点

**优点：**
- ✅ **零 harness 改动**：SDK 不感知后端变化，所有逻辑（工具循环、上下文管理、会话恢复、Skill、MCP、权限模式）完全复用
- ✅ **SDK 持续更新**：Anthropic 更新 SDK 时，M-Agent 自动获得更新，无需手动跟进
- ✅ **功能完整**：Skill、MCP 连接器、会话恢复、思考链——全部可用
- ✅ **维护成本低**：仅需维护格式翻译层（~300-500 行），API 格式变化频率低
- ✅ **行为一致**：无论走 Coding Plan 还是 OpenRouter，用户体验完全一致
- ✅ **已验证方案**：claude-code-proxy（3.6k stars）等多个开源项目已验证可行

**缺点 / 风险：**
- ⚠️ 部分模型不支持 function calling → 工具调用会失败（代理无法解决，需要前端提示）
- ⚠️ 流式翻译有边界情况（跨 chunk 的 tool_calls arguments 拼接）
- ⚠️ Anthropic 专有功能（extended thinking、prompt caching）在 OpenRouter 上不可用
- ⚠️ 代理增加一层网络跳转，延迟增加 ~1-5ms（可忽略）
- ⚠️ 模型行为差异：不同模型对同一 prompt 的工具调用能力不同

---

## 5. 方案对比总表

| 维度 | 方案 A：自建 Agent Loop | 方案 B：Anthropic 兼容代理 |
|------|------------------------|--------------------------|
| **harness 改动** | 新增独立 Agent Loop 路径 | **零改动** |
| **SDK 复用** | ❌ 不复用，另建一套 | ✅ 完全复用 |
| **Skill 支持** | ❌ 需自行实现 | ✅ 自动支持 |
| **MCP 连接器** | ❌ 需自行实现 | ✅ 自动支持 |
| **会话恢复** | ❌ 需自行实现 | ✅ 自动支持 |
| **权限模式** | ❌ 需自行实现 | ✅ 自动支持 |
| **思考链** | ❌ 需自行实现 | ✅ 自动支持（若模型支持） |
| **长期维护** | ❌ 高（需跟进 SDK 更新） | ✅ 低（仅翻译层） |
| **开发量** | ~9h（预估偏乐观） | ~4-6h（代理 ~3h + UI ~1-2h） |
| **行为一致性** | ❌ 两套路径行为可能不一致 | ✅ 完全一致 |
| **模型兼容性** | 可降级为纯对话 | 部分模型不支持 function calling 时会报错 |
| **社区验证** | 无 | ✅ 多个开源项目验证 |

## 6. 推荐方案

### **推荐方案 B：Anthropic 兼容代理**

核心理由：
1. **用户明确不想改 harness / agent loop** → 方案 B 完全不改
2. **用户想保持 SDK 持续更新** → 方案 B 直接复用 SDK
3. **不想自己维护 agent loop** → 方案 B 只维护翻译层
4. **已验证可行** → claude-code-proxy 等 3.6k stars 项目已验证

### 实现建议

1. **代理位置**：嵌入 Electron 主进程，随主进程启动
2. **端口**：`127.0.0.1:3999`（仅本地访问，不暴露外网）
3. **翻译逻辑**：参考 [claude-code-proxy](https://github.com/1rgs/claude-code-proxy) 的 Python 实现，用 Node.js 重写核心翻译逻辑
4. **UI 变更**：M-Agent 对话栏增加模型选择器（与原设计一致）
5. **配置**：OpenRouter API Key 等配置放在 M-Agent 设置面板
6. **切换逻辑**：用户选了 OpenRouter 模型 → 启动代理 + 切换环境变量；未选 → 走原始 Coding Plan 配置

### 架构图

```
┌─────────────────────────────────────────────────────┐
│                    Electron 主进程                   │
│                                                      │
│  ┌──────────────┐    ┌─────────────────────────┐    │
│  │  Claude Code  │    │   Anthropic Proxy       │    │
│  │  Agent SDK    │    │   (localhost:3999)      │    │
│  │               │    │                         │    │
│  │  ANTHROPIC_   │───▶│  /v1/messages           │    │
│  │  BASE_URL     │    │    ↓ 翻译                │    │
│  │  = localhost  │    │  /v1/chat/completions    │    │
│  │  :3999        │    │    ↓ 转发                │    │
│  │               │    │  → OpenRouter API       │    │
│  │  工具执行      │    │    ↓ 翻译响应            │    │
│  │  Skill/MCP    │    │  ← Anthropic 格式        │    │
│  │  会话恢复      │    │                         │    │
│  │  权限模式      │    │  API Key 注入            │    │
│  └──────────────┘    └─────────────────────────┘    │
│         ↑                                             │
│         │ cc:stream 事件                              │
│         ↓                                             │
│  ┌──────────────┐                                    │
│  │  前端渲染层    │  ← 完全不需要改动                   │
│  │  (app.js)     │                                    │
│  └──────────────┘                                    │
└─────────────────────────────────────────────────────┘
```

## 7. 风险与缓解

| 风险 | 影响 | 缓解方案 |
|------|------|----------|
| 模型不支持 function calling | 工具调用失败，Agent Loop 报错 | 前端模型选择器标注是否支持 function calling；选中后提示用户 |
| 流式翻译边界 bug | 文本乱码 / 工具参数错误 | 参考 OpenAI SSE 规范，行缓冲 + arguments 增量拼接 |
| OpenRouter 限流 | 429 错误 | 代理层添加重试 + 指数退避 |
| 代理端口冲突 | 3999 被占用 | 启动时检测，自动分配空闲端口 |
| Anthropic SDK 升级 | API 格式变化 | 代理只做格式映射，SDK 升级影响极小 |

## 8. 开发计划（待确认后启动）

| 阶段 | 内容 | 预估工时 |
|------|------|----------|
| P1 | 设置面板：OpenRouter 配置区 | 0.5h |
| P2 | Anthropic Proxy 核心实现（请求/响应翻译） | 2h |
| P3 | Proxy 流式 SSE 翻译（含 tool_calls 增量拼接） | 1.5h |
| P4 | 主进程集成：代理启动 + 环境变量切换逻辑 | 0.5h |
| P5 | 前端：模型选择器 + 发送消息分支 | 1h |
| P6 | 测试 + 边界处理 | 1h |
| **合计** | | **~6.5h** |
