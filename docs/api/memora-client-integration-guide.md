# Memora 客户端对接说明文档

> 面向客户端开发人员，说明如何对接 Memora 配置服务、使用不同 AppKey 调用 ADP 智能体、调用 DeepSeek LLM API。

---

## 一、整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                     Memora 客户端（Electron）                  │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ AI 助手   │  │ 知识跟随  │  │ 图谱构建  │  │ 搜索问答  │     │
│  │          │  │          │  │          │  │          │     │
│  │ app_key  │  │knowledge │  │ graph_   │  │ search_  │     │
│  │          │  │_app_key  │  │ app_key  │  │ app_key  │     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
│       │             │             │             │            │
│       └─────────────┴──────┬──────┴─────────────┘            │
│                            │                                  │
│                   ADP SSE V2 接口                             │
│                            │                                  │
├────────────────────────────┼──────────────────────────────────┤
│                            ▼                                  │
│     ┌──────────────────────────────────────────────┐          │
│     │        ADPToolkit 配置服务                      │          │
│     │  GET /memora/config → 返回组织配置              │          │
│     │  (DeepMerge: 新字段自动填充旧配置)              │          │
│     └──────────────────────────────────────────────┘          │
│                            │                                  │
│       ┌────────────────────┴────────────────────┐             │
│       ▼                                         ▼             │
│  ┌──────────┐                          ┌──────────┐          │
│  │ 腾讯云    │                          │ DeepSeek  │          │
│  │ ADP 智能体│                          │ LLM API  │          │
│  │ (SSE)    │                          │ (REST)   │          │
│  └──────────┘                          └──────────┘          │
└──────────────────────────────────────────────────────────────┘
```

---

## 二、对接流程（3 步）

```
1. 登录 → 拿到 Token + 用户信息
2. 获取配置 → 拿到 adp/app_key, knowledge_app_key, graph_app_key, search_app_key + api/api_key
3. 按功能使用对应的 AppKey 调用 ADP，或用 api_key 调用 LLM
```

### 2.1 登录

```
POST {BASE_URL}/api/auth/login
Body: { "username": "xxx", "password": "xxx" }
Response: { "token": "eyJ...", "user": { "id": "u-xxx", "organization": "xxx", ... } }
```

### 2.2 获取组织配置

```
GET {BASE_URL}/memora/config
Header: Authorization: Bearer {token}
```

**响应结构（重点）：**

```json
{
  "api": {
    "api_key": "sk-xxx",
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "daily_limit": 500
  },
  "adp": {
    "app_key": "主 AppKey（AI 助手对话用）",
    "knowledge_app_key": "智能推荐 AppKey（知识跟随用）",
    "graph_app_key": "图谱构建 AppKey（图谱生成用）",
    "search_app_key": "搜索问答 AppKey（联网搜索用）",
    "url": "https://wss.lke.cloud.tencent.com",
    "agent_name": "我的AI助手"
  },
  "prompts": {
    "ai_prompt": "AI 对话系统提示词",
    "memory_prompt": "记忆提取提示词",
    "clipboard_prompt": "剪贴板处理提示词"
  },
  "policies": {
    "lock_config": false,
    "allow_local_override": true
  },
  "_meta": {
    "organization": "云智能 ADP 产品中心",
    "updated_at": "2026-06-07T14:30:00.000Z",
    "updated_by": "admin"
  }
}
```

---

## 三、AppKey 使用规则（核心）

### 3.1 四个 AppKey 的分工

| AppKey 字段 | 用途 | 功能场景 | ADP 应用类型 |
|-------------|------|---------|-------------|
| `adp.app_key` | **AI 助手通用对话** | 主对话框、AI助手、剪贴板处理、记忆提取 | 通用对话应用 |
| `adp.knowledge_app_key` | **智能推荐** | 知识跟随、文档推荐、相关内容推送 | 知识库应用（绑定知识库） |
| `adp.graph_app_key` | **图谱构建** | 知识图谱生成、实体关系抽取、图谱可视化 | 图谱应用（配置图谱构建能力） |
| `adp.search_app_key` | **搜索问答** | 联网搜索、实时信息查询、网络资源检索 | 搜索应用（开启联网搜索） |

### 3.2 精确使用原则

**每个功能必须使用其对应的 AppKey，不要混用。** 原因：

1. **权限隔离**：不同 AppKey 对应不同 ADP 应用，配置了不同的工具/知识库/联网权限
2. **计费分离**：不同应用的 Token 消耗独立计量
3. **知识库绑定**：`knowledge_app_key` 绑定了组织专属知识库，用其他 AppKey 会导致知识推荐失效
4. **联网权限**：`search_app_key` 开启了联网搜索，其他 AppKey 未开启

### 3.3 Fallback 策略（兼容旧配置）

服务端使用 **深层合并（DeepMerge）** 机制：如果组织数据库中没有 `graph_app_key`，会自动从默认配置继承。因此客户端收到的配置**一定包含所有字段**。

但为了防御性编程，建议客户端读取时做 fallback：

```javascript
// 推荐的配置读取方式
const config = await loadConfig();

// AI 助手 - 直接用 app_key，不需要 fallback
const assistantAppKey = config.adp.app_key;

// 知识跟随 - 用 knowledge_app_key，fallback 到 app_key
const knowledgeAppKey = config.adp.knowledge_app_key || config.adp.app_key;

// 图谱构建 - 用 graph_app_key，fallback 到 knowledge_app_key，再 fallback 到 app_key
const graphAppKey = config.adp.graph_app_key || config.adp.knowledge_app_key || config.adp.app_key;

// 搜索问答 - 用 search_app_key，fallback 到 app_key
const searchAppKey = config.adp.search_app_key || config.adp.app_key;
```

---

## 四、ADP SSE V2 接口对接

所有四个 AppKey 共用同一个 ADP SSE V2 接口，只是 `AppKey` 参数不同。

### 4.1 接口信息

```
URL: {config.adp.url}/adp/v2/chat
Method: POST
Content-Type: application/json
```

> **完整 URL 拼接**：`config.adp.url` 返回的是 `https://wss.lke.cloud.tencent.com`，客户端拼接 `/adp/v2/chat` 得到完整地址。

### 4.2 请求体（PascalCase）

```json
{
  "AppKey": "对应的AppKey（根据功能选择）",
  "ConversationId": "uuid-会话ID",
  "VisitorId": "用户ID（来自 user.id）",
  "Contents": [
    {
      "Type": "text",
      "Text": "用户消息内容"
    }
  ],
  "RequestId": "32-64位随机字符串",
  "Incremental": true,
  "Stream": "enable",
  "SystemRole": "可选的系统提示词",
  "ModelName": "可选指定模型"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| AppKey | string | **是** | ⚠️ 必须放在 Body 中，不在 Header/Query |
| ConversationId | string | 是 | 会话ID，2-64位，正则 `^[a-zA-Z0-9_-]{2,64}$`，同一用户多轮复用 |
| VisitorId | string | 是 | 访客ID，建议使用 `user.id` |
| Contents | array | 是 | 消息内容数组，支持 text/image/file |
| RequestId | string | 是 | 请求ID，32-64位 |
| Incremental | boolean | 否 | 增量模式（默认 true） |
| Stream | string | 是 | 固定 `"enable"` 启用 SSE |
| SystemRole | string | 否 | 系统提示词（可覆盖 ADP 应用默认配置） |
| ModelName | string | 否 | 指定模型（如 `Hunyuan/hunyuan-turbos`） |

### 4.3 SSE 事件流解析

```
event: request_ack
data: {"request_id":"xxx"}

event: response.created
data: {"conversation_id":"xxx"}

event: content.added
data: {"content_index":0}

event: text.delta
data: {"content_index":0,"delta":"增量文本内容"}

event: text.replace
data: {"content_index":0,"old_text":"旧文本","new_text":"新文本"}

event: message.done
data: {}

event: reference.added
data: {"references":[...]}

event: error
data: {"error":{"code":460011,"message":"QPM超限"}}

event: done
data: [DONE]
```

**关键事件说明：**

| 事件 | 用途 | 处理方式 |
|------|------|---------|
| `text.delta` | 流式增量文本 | 拼接到当前消息末尾，实时渲染 |
| `text.replace` | 文本替换（ADP 修正输出） | 用 `new_text` 替换 `old_text` |
| `reference.added` | 引用来源 | 知识跟随/搜索场景展示引用来源 |
| `error` | 错误 | 展示错误提示，按错误码处理 |
| `done` | 流结束 | 标记消息完成，保存记录 |

### 4.4 按功能调用示例

#### AI 助手对话

```javascript
async function chatWithAssistant(message, config, userId) {
  const body = {
    AppKey: config.adp.app_key,              // ← AI 助手 AppKey
    ConversationId: crypto.randomUUID(),
    VisitorId: userId,
    Contents: [{ Type: 'text', Text: message }],
    RequestId: crypto.randomUUID().replace(/-/g, '').substring(0, 32),
    Stream: 'enable',
    SystemRole: config.prompts.ai_prompt || undefined,  // 可选系统提示词
  };
  return callADPSSE(config.adp.url, body);
}
```

#### 知识跟随（智能推荐）

```javascript
async function knowledgeFollow(query, config, userId) {
  const body = {
    AppKey: config.adp.knowledge_app_key,     // ← 智能推荐 AppKey
    ConversationId: crypto.randomUUID(),
    VisitorId: userId,
    Contents: [{ Type: 'text', Text: query }],
    RequestId: crypto.randomUUID().replace(/-/g, '').substring(0, 32),
    Stream: 'enable',
  };
  return callADPSSE(config.adp.url, body);
}
```

#### 图谱构建

```javascript
async function buildGraph(topic, config, userId) {
  const body = {
    AppKey: config.adp.graph_app_key,         // ← 图谱构建 AppKey
    ConversationId: crypto.randomUUID(),
    VisitorId: userId,
    Contents: [{ Type: 'text', Text: topic }],
    RequestId: crypto.randomUUID().replace(/-/g, '').substring(0, 32),
    Stream: 'enable',
  };
  return callADPSSE(config.adp.url, body);
}
```

#### 搜索问答

```javascript
async function searchAnswer(question, config, userId) {
  const body = {
    AppKey: config.adp.search_app_key,        // ← 搜索问答 AppKey
    ConversationId: crypto.randomUUID(),
    VisitorId: userId,
    Contents: [{ Type: 'text', Text: question }],
    RequestId: crypto.randomUUID().replace(/-/g, '').substring(0, 32),
    Stream: 'enable',
  };
  return callADPSSE(config.adp.url, body);
}
```

### 4.5 通用 SSE 解析器

```javascript
/**
 * 通用 ADP SSE 调用方法
 * @param {string} baseUrl - ADP 基础 URL（如 https://wss.lke.cloud.tencent.com）
 * @param {object} body - V2 请求体
 * @param {object} callbacks - 回调函数
 * @param {function} callbacks.onText - 收到增量文本 (delta: string)
 * @param {function} callbacks.onReplace - 收到替换指令 (oldText, newText)
 * @param {function} callbacks.onReference - 收到引用 (references: array)
 * @param {function} callbacks.onError - 收到错误 (error: object)
 * @param {function} callbacks.onDone - 流结束 ()
 */
async function callADPSSE(baseUrl, body, callbacks = {}) {
  const url = `${baseUrl}/adp/v2/chat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`ADP 请求失败: ${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // 保留不完整的行

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const data = line.slice(6);
        handleSSEEvent(currentEvent, data, callbacks);
      }
    }
  }

  // 处理 buffer 中剩余的数据
  if (buffer.trim()) {
    const lines = buffer.split('\n');
    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const data = line.slice(6);
        handleSSEEvent(currentEvent, data, callbacks);
      }
    }
  }
}

function handleSSEEvent(event, data, callbacks) {
  // [DONE] 标记
  if (data.trim() === '[DONE]') {
    callbacks.onDone?.();
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    return; // 忽略无法解析的数据
  }

  switch (event) {
    case 'text.delta':
      // 过滤 ADP 偶尔混入的 JSON 工具结果
      const delta = parsed.delta || '';
      if (!delta.startsWith('{"content":')) {
        callbacks.onText?.(delta);
      }
      break;

    case 'text.replace':
      callbacks.onReplace?.(parsed.old_text, parsed.new_text);
      break;

    case 'reference.added':
      callbacks.onReference?.(parsed.references || []);
      break;

    case 'error':
      callbacks.onError?.(parsed.error || { message: '未知错误' });
      break;

    case 'done':
      callbacks.onDone?.();
      break;

    // request_ack, response.created, content.added, message.done 等可忽略
  }
}
```

---

## 五、DeepSeek LLM API 对接

用于客户端需要直接调用 LLM（不走 ADP 智能体）的场景，如本地文本处理、记忆提取等。

### 5.1 接口信息

```
URL: {config.api.base_url}/chat/completions
Method: POST
Content-Type: application/json
Authorization: Bearer {config.api.api_key}
```

> 兼容 OpenAI SDK 格式，可直接使用 `openai` npm 包。

### 5.2 请求示例

```javascript
import OpenAI from 'openai';

function createLLMClient(config) {
  return new OpenAI({
    apiKey: config.api.api_key,
    baseURL: config.api.base_url,
  });
}

// 流式调用
async function streamChat(config, messages, onChunk) {
  const client = createLLMClient(config);
  const stream = await client.chat.completions.create({
    model: config.api.model,
    messages: messages,
    stream: true,
  });

  let fullText = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    fullText += delta;
    onChunk(delta, fullText);
  }
  return fullText;
}
```

### 5.3 LLM vs ADP 选择指南

| 场景 | 用 LLM (`config.api`) | 用 ADP (`config.adp`) |
|------|----------------------|----------------------|
| 简单文本生成/摘要 | ✅ 延迟低 | ❌ 过重 |
| 记忆提取/剪贴板处理 | ✅ 直接处理 | ❌ 不需要工具 |
| 知识库问答 | ❌ 无知识库 | ✅ 绑定知识库 |
| 联网搜索 | ❌ 无联网能力 | ✅ 用 search_app_key |
| 图谱生成 | ❌ 需要专用工具 | ✅ 用 graph_app_key |
| 多工具编排 | ❌ 需自行实现 | ✅ ADP Agent 自动编排 |

---

## 六、多轮对话管理

### 6.1 ConversationId 复用规则

```javascript
// 每个功能模块维护独立的 ConversationId
const conversationIds = {
  assistant: null,   // AI 助手
  knowledge: null,   // 知识跟随
  graph: null,       // 图谱构建
  search: null,      // 搜索问答
};

function getOrCreateConversationId(module) {
  if (!conversationIds[module]) {
    conversationIds[module] = crypto.randomUUID();
  }
  return conversationIds[module];
}

// 用户点击"新对话"时重置
function resetConversation(module) {
  conversationIds[module] = null;
}
```

### 6.2 RequestId 生成

```javascript
function generateRequestId() {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 32);
}
```

---

## 七、错误处理

### 7.1 ADP 错误码

| 错误码 | 含义 | 客户端处理建议 |
|--------|------|---------------|
| 400 | 参数错误 | 检查请求体格式 |
| 460004 | 应用不存在 | 检查 AppKey 是否正确 |
| 460011 | 模型 QPM 超限 | 显示"服务繁忙，请稍后再试" |
| 460031 | 应用 QPS 超限 | 显示"请求过于频繁，请稍后再试" |
| 460034 | 输入过长 | 提示用户缩短输入 |
| 4505004 | APPKEY 无效 | 提示"配置错误，请联系管理员" |

### 7.2 LLM 错误处理

```javascript
async function safeStreamChat(config, messages, onChunk) {
  try {
    return await streamChat(config, messages, onChunk);
  } catch (error) {
    if (error.status === 429) {
      throw new Error('请求过于频繁，请稍后再试');
    } else if (error.status === 401) {
      throw new Error('API Key 无效，请联系管理员');
    } else if (error.status === 402) {
      throw new Error('API 额度已用尽，请联系管理员');
    }
    throw new Error(`AI 服务异常: ${error.message}`);
  }
}
```

---

## 八、完整客户端集成代码

```javascript
class MemoraADPClient {
  constructor(baseUrl = 'http://21.91.29.59:3000') {
    this.baseUrl = baseUrl;
    this.token = null;
    this.user = null;
    this.config = null;
    this.conversationIds = {};
  }

  // ==================== 1. 登录 ====================
  async login(username, password) {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '登录失败');
    }
    const data = await res.json();
    this.token = data.token;
    this.user = data.user;
    return data;
  }

  // ==================== 2. 加载配置 ====================
  async loadConfig() {
    const res = await fetch(`${this.baseUrl}/memora/config`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '获取配置失败');
    }
    this.config = await res.json();
    return this.config;
  }

  // ==================== 3. 获取 AppKey（带 fallback） ====================
  getAppKey(module) {
    const adp = this.config?.adp || {};
    switch (module) {
      case 'assistant':
        return adp.app_key;
      case 'knowledge':
        return adp.knowledge_app_key || adp.app_key;
      case 'graph':
        return adp.graph_app_key || adp.knowledge_app_key || adp.app_key;
      case 'search':
        return adp.search_app_key || adp.app_key;
      default:
        return adp.app_key;
    }
  }

  // ==================== 4. 调用 ADP ====================
  async callADP(module, message, options = {}) {
    const appKey = this.getAppKey(module);
    if (!appKey) throw new Error(`未配置 ${module} 的 AppKey`);

    const conversationId = this.getConversationId(module, options.newConversation);

    const body = {
      AppKey: appKey,
      ConversationId: conversationId,
      VisitorId: this.user.id,
      Contents: [{ Type: 'text', Text: message }],
      RequestId: generateRequestId(),
      Incremental: true,
      Stream: 'enable',
      ...(options.systemRole ? { SystemRole: options.systemRole } : {}),
    };

    const result = { text: '', references: [], error: null };

    await callADPSSE(this.config.adp.url, body, {
      onText: (delta) => {
        result.text += delta;
        options.onDelta?.(delta, result.text); // 实时回调
      },
      onReplace: (oldText, newText) => {
        result.text = result.text.replace(oldText, newText);
        options.onReplace?.(result.text);
      },
      onReference: (refs) => {
        result.references.push(...refs);
        options.onReference?.(refs);
      },
      onError: (error) => {
        result.error = error;
        options.onError?.(error);
      },
      onDone: () => {
        options.onDone?.(result);
      },
    });

    return result;
  }

  // ==================== 5. 便捷方法 ====================
  chat(message, options)           { return this.callADP('assistant', message, options); }
  knowledgeFollow(query, options)  { return this.callADP('knowledge', query, options); }
  buildGraph(topic, options)       { return this.callADP('graph', topic, options); }
  searchAnswer(question, options)  { return this.callADP('search', question, options); }

  // ==================== 6. LLM 调用 ====================
  async callLLM(messages, options = {}) {
    const client = createLLMClient(this.config);
    const stream = await client.chat.completions.create({
      model: this.config.api.model,
      messages,
      stream: true,
      ...options,
    });

    let fullText = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      fullText += delta;
      options.onDelta?.(delta, fullText);
    }
    return fullText;
  }

  // ==================== 7. 会话管理 ====================
  getConversationId(module, forceNew = false) {
    if (forceNew || !this.conversationIds[module]) {
      this.conversationIds[module] = crypto.randomUUID();
    }
    return this.conversationIds[module];
  }

  resetConversation(module) {
    this.conversationIds[module] = null;
  }

  resetAllConversations() {
    this.conversationIds = {};
  }

  // ==================== 8. 上报登录活动 ====================
  async reportLogin(appVersion, platform) {
    await fetch(`${this.baseUrl}/memora/activity/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        login_source: 'memora_client',
        config_loaded: !!this.config,
        app_version: appVersion,
        platform,
      }),
    });
  }

  async reportLogout() {
    await fetch(`${this.baseUrl}/memora/activity/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ login_source: 'memora_client' }),
    });
  }
}

// ==================== 辅助函数 ====================
function generateRequestId() {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 32);
}

function createLLMClient(config) {
  // 兼容 OpenAI SDK
  const { default: OpenAI } = require('openai');
  return new OpenAI({
    apiKey: config.api.api_key,
    baseURL: config.api.base_url,
  });
}

// callADPSSE 和 handleSSEEvent 见第四章第5节
```

### 使用示例

```javascript
const client = new MemoraADPClient('http://21.91.29.59:3000');

// 1. 登录
await client.login('zhangsan', 'password123');

// 2. 加载配置
await client.loadConfig();

// 3. AI 助手对话（流式）
const result = await client.chat('帮我分析一下腾讯云的优势', {
  onDelta: (delta, fullText) => {
    updateUI(fullText); // 实时更新界面
  },
  onReference: (refs) => {
    showReferences(refs); // 展示引用来源
  },
  onDone: (result) => {
    saveMessage(result); // 保存完整消息
  },
});

// 4. 知识跟随
const knowledge = await client.knowledgeFollow('ADP 智能体开发最佳实践');

// 5. 图谱构建
const graph = await client.buildGraph('腾讯云产品体系');

// 6. 搜索问答
const search = await client.searchAnswer('2026年AI行业最新趋势');

// 7. 直接调用 LLM（不走 ADP）
const summary = await client.callLLM([
  { role: 'system', content: config.prompts.memory_prompt },
  { role: 'user', content: '提取以下文本的关键记忆...' }
]);
```

---

## 九、配置变更兼容性说明

### 9.1 服务端 DeepMerge 机制

服务端使用深层合并，新增字段自动填充到旧配置：

```
数据库配置:  { adp: { app_key: "xxx", knowledge_app_key: "yyy" } }
默认配置:    { adp: { app_key: "zzz", knowledge_app_key: "zzz", graph_app_key: "zzz", search_app_key: "zzz" } }
合并结果:    { adp: { app_key: "xxx", knowledge_app_key: "yyy", graph_app_key: "zzz", search_app_key: "zzz" } }
                                                                      ↑ 从默认配置继承
```

**客户端无需担心字段缺失**，但建议做 fallback 防御。

### 9.2 未来新增字段约定

当服务端新增 AppKey 字段时（如 `code_app_key`），遵循以下约定：

1. 服务端 `DEFAULT_CONFIG` 增加新字段和默认值
2. DeepMerge 自动为旧组织填充新字段
3. 客户端读取时做 `||` fallback 链
4. 旧客户端忽略新字段，不会报错

---

## 十、环境信息

| 环境 | Base URL | 说明 |
|------|----------|------|
| AnyDev 测试 | `http://21.91.29.59:3000` | 主部署环境 |
| Lighthouse 生产 | `http://121.5.164.126:3010` | 备用环境 |

---

*文档版本：v1.0 | 更新时间：2026-06-07 | 适用 Memora v2.1+*
