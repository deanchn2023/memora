# Memora 助手会话历史同步 API 文档

> 版本: 2.0 | 更新: 2026-06-10
> 基于现有 Memora v3 同步架构扩展，新增 `assistant_conversations` 和 `assistant_messages` 两种数据类型
> 设计参考：`docs/memora-chat-sync-design.md`

---

## 1. 概述

### 1.1 目标

实现 AI 助手会话历史在三端（PC Electron / Mobile Flutter / Web）之间的实时同步，确保：
- **PC 端**发起的对话，移动端可以查看和继续
- **移动端**发起的对话，PC 端可以看到和回顾
- **Web 端**可只读查看所有会话历史
- **ADP ConversationId 跨端复用**：多端共享同一 conversation_id，让 ADP 智能体保持上下文连贯

### 1.2 权限矩阵

| 数据类型 | PC(electron) | 移动端(flutter) | 小程序(miniprogram) | Web |
|----------|:---:|:---:|:---:|:---:|
| **assistant_conversations** | 读写✓ | 读写✓ | 只读 | 只读 |
| **assistant_messages** | 读写✓ | 读写✓ | 只读 | 只读 |

### 1.3 关键设计原则

| 原则 | 说明 |
|------|------|
| **复用 v3 同步协议** | 不新建一套同步逻辑，仅扩充 data_type |
| **会话+消息分两张表** | 会话元数据高频小变更，消息一次写入很少改 |
| **冲突使用 LWW** | AI 对话场景几乎不会真冲突，简化处理 |
| **消息原子化存储** | 每条消息一行，不存 HTML，多端各自渲染 Markdown |
| **message_index 排序** | 消息按 message_index 排序（而非 created_at），避免不同设备时钟不一致 |
| **流式中间态不入库** | 只接受 status=completed 的消息，streaming 不推送 |
| **会话级联软删除** | 删除会话自动级联软删除所有消息 |
| **消息大小上限** | 单条 content ≤ 100KB，超限拒绝 |

---

## 2. 数据模型

### 2.1 assistant_conversations（会话表）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `id` | TEXT PK | ✓ | 客户端生成，格式 `chat_<timestamp>_<random>` |
| `user_id` | TEXT | ✓ | 用户 ID（服务端自动填充） |
| `title` | TEXT | | 会话标题，默认 `'新对话'`（首条用户消息前 30 字自动提取） |
| `summary` | TEXT | | 会话摘要（AI 生成或手动填写） |
| `conversation_id` | TEXT | **关键** | ADP ConversationId（32位字符），**跨端复用保持上下文**，详见 §7 |
| `message_count` | INTEGER | | 缓存消息数（避免每次 COUNT(*)），追加消息时自动 +1 |
| `source` | TEXT | | 来源：`manual` / `clipboard` / `knowledge` |
| `agent_mode` | TEXT | | AI 模式：`agent`（走 ADP 智能体）/ `llm`（走本地 LLM） |
| `model` | TEXT | | 使用的 AI 模型名（如 `deepseek-v4-flash`、`hunyuan-turbos`） |
| `app_key_hash` | TEXT | | ADP AppKey 哈希（前8位），便于审计 |
| `is_pinned` | INTEGER | | 是否置顶：0=否，1=是 |
| `archived` | INTEGER | | 是否归档：0=否，1=是（隐藏但保留） |
| `tags` | TEXT | | 标签 JSON 数组，如 `["技术","React"]` |
| `extra` | TEXT | | 扩展字段 JSON |
| `origin_device_id` | TEXT | | 创建该记录的设备 ID（服务端自动填充） |
| `revision` | INTEGER | | 乐观锁版本号，初始 1，每次更新 +1 |
| `created_at` | TEXT | | 创建时间 ISO 8601 |
| `updated_at` | TEXT | | 更新时间 ISO 8601 |
| `deleted_at` | TEXT | | 软删除时间，非 NULL 表示已删除 |

### 2.2 assistant_messages（消息表）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `id` | TEXT PK | ✓ | 客户端生成，格式 `msg_<timestamp>_<random>` |
| `user_id` | TEXT | ✓ | 用户 ID（服务端自动填充） |
| `conversation_id` | TEXT | ✓ | 所属会话 ID（外键 → assistant_conversations.id） |
| `role` | TEXT | ✓ | 消息角色：`user` / `assistant` / `system` |
| `content` | TEXT | ✓ | **Markdown 原文**，不存 HTML，多端各自渲染（≤100KB） |
| `thoughts` | TEXT | | AI 思考链（DeepSeek-R1、Hunyuan-T1 等推理模型才有） |
| `attachments` | TEXT | | 附件 JSON 数组，详见 §2.3 |
| `tool_steps` | TEXT | | AI 工具调用步骤 JSON，详见 §2.4 |
| `references` | TEXT | | 引用来源 JSON，详见 §2.5 |
| `status` | TEXT | | `completed` / `aborted` / `failed`（**不接受 streaming**） |
| `content_type` | TEXT | | 内容类型：`text` / `markdown` / `code` / `image_url` |
| `model` | TEXT | | AI 回复使用的模型名（仅 role=assistant） |
| `elapsed_ms` | INTEGER | | AI 响应耗时（毫秒，仅 role=assistant） |
| `token_usage` | TEXT | | Token 用量 JSON：`{prompt_tokens, completion_tokens, total_tokens}` |
| `message_index` | INTEGER | **关键** | 会话内消息顺序号（0 起），客户端分配，**排序用此字段而非 created_at** |
| `parent_id` | TEXT | | 父消息 ID（支持分支对话） |
| `extra` | TEXT | | 扩展字段 JSON |
| `origin_device_id` | TEXT | | 创建该记录的设备 ID |
| `revision` | INTEGER | | 乐观锁版本号 |
| `created_at` | TEXT | | 创建时间 |
| `updated_at` | TEXT | | 更新时间 |
| `deleted_at` | TEXT | | 软删除时间 |

### 2.3 attachments 数组 schema

```json
[
  {
    "type": "image",                          // 'image' | 'document' | 'audio' | 'video' | 'url'
    "name": "screenshot.png",
    "url": "https://files.adp.tencent.com/u/xxx/yyy.png",
    "size": 102400,
    "mime": "image/png",
    "ocr_text": "提取的文字内容（可选）",
    "thumbnail_url": "https://...",            // 预览图
    "duration_sec": 0                          // 音视频时长（可选）
  }
]
```

> ⚠️ 附件**不存 base64**，必须先调 ADP 文件上传接口，存 URL。

### 2.4 tool_steps 数组 schema

```json
[
  {
    "name": "联网搜索",
    "icon": "🔍",
    "args": {"query": "Memora 同步设计"},
    "result": "找到 5 条结果",
    "result_full": "...",
    "status": "completed",                    // 'running' | 'completed' | 'failed'
    "started_at": "2026-06-10T13:00:00.000Z",
    "duration_ms": 1234
  }
]
```

### 2.5 references 数组 schema

```json
[
  {
    "type": 1,                                // 1=问答, 2=文档, 4=联网（与 ADP V1 一致）
    "title": "Memora 官方文档",
    "url": "https://memora.example.com/...",
    "snippet": "节选内容...",
    "score": 0.92
  }
]
```

---

## 3. 同步机制

### 3.1 标准同步（通过 v3 push/pull/full）

会话和消息作为新增数据类型接入现有 v3 同步框架，完全复用：
- **revision 乐观锁**：防止并发修改冲突
- **origin_device_id 防回声**：pull 时不拉回自己 push 的数据
- **幂等性**：request_id 去重
- **设备注册**：新数据类型自动纳入游标管理

#### Push 示例

```json
POST /memora/sync/push
{
  "device_id": "pc_macbook_zhangsan",
  "request_id": "req-xxx",
  "changes": {
    "assistant_conversations": [
      {
        "id": "chat_1781062970000_a4f9d2",
        "_base_revision": 0,
        "title": "如何优化 Memora 同步性能",
        "conversation_id": "4hqptq1drnb4672bgvpr8x85iv5mq0sk",
        "message_count": 4,
        "agent_mode": "agent",
        "app_key_hash": "EvcCHxUU",
        "pinned": 0,
        "archived": 0
      }
    ],
    "assistant_messages": [
      {
        "id": "msg_1781062970100_b3e8c1",
        "_base_revision": 0,
        "conversation_id": "chat_1781062970000_a4f9d2",
        "role": "user",
        "content": "Memora 同步现在每次都全量上传，怎么改成增量？",
        "message_index": 0,
        "status": "completed"
      },
      {
        "id": "msg_1781062976500_c7d2f4",
        "_base_revision": 0,
        "conversation_id": "chat_1781062970000_a4f9d2",
        "role": "assistant",
        "content": "可以基于 since 时间过滤本地变更...",
        "thoughts": "用户问的是同步优化...",
        "tool_steps": [{"name": "代码搜索", "icon": "🔍", "status": "completed", "duration_ms": 856}],
        "references": [{"type": 2, "title": "v3 同步协议文档", "url": "https://..."}],
        "elapsed_ms": 6543,
        "token_usage": {"prompt_tokens": 512, "completion_tokens": 1024, "total_tokens": 1536},
        "message_index": 1,
        "status": "completed"
      }
    ]
  }
}
```

#### 服务端校验规则

| 规则 | 说明 |
|------|------|
| 单条 content > 100KB | 拒绝，返回 `permission_denied: { reason: 'message_too_large' }` |
| status = streaming | 拒绝，返回 `permission_denied: { reason: 'streaming_not_allowed' }` |
| 会话级联删除 | push 会话带 `_deleted: true` 时，自动级联软删除该会话下所有消息 |

#### Pull 示例

```json
POST /memora/sync/pull
{
  "device_id": "mobile_ios_abc123",
  "data_types": ["assistant_conversations", "assistant_messages"],
  "since_revision": 42
}
```

**响应：**
```json
{
  "ok": true,
  "results": {
    "assistant_conversations": {
      "records": [...],
      "deleted_ids": [...],
      "count": 5,
      "max_revision": 50
    },
    "assistant_messages": {
      "records": [...],
      "deleted_ids": [...],
      "count": 23,
      "max_revision": 75
    }
  }
}
```

---

## 4. 专属 API（便捷接口）

### 4.1 GET /memora/sync/conversations

获取当前用户的会话列表。

**请求参数：**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | INTEGER | 1 | 页码 |
| `limit` | INTEGER | 20 | 每页数量 |
| `search` | TEXT | | 搜索关键词（匹配标题和摘要） |

**响应：**
```json
{
  "ok": true,
  "total": 15,
  "page": 1,
  "limit": 20,
  "conversations": [
    {
      "id": "chat_1781062970000_a4f9d2",
      "title": "React Hooks 学习",
      "conversation_id": "4hqptq1drnb4672bgvpr8x85iv5mq0sk",
      "message_count": 8,
      "agent_mode": "agent",
      "is_pinned": 1,
      "archived": 0,
      "last_message": {
        "role": "assistant",
        "content": "总结一下，useCallback 用于缓存函数引用..."
      },
      ...
    }
  ]
}
```

### 4.2 GET /memora/sync/conversations/:id

获取单个会话详情。

### 4.3 GET /memora/sync/conversations/:id/messages

获取指定会话的消息列表（按 `message_index` 正序，适合聊天界面渲染）。

**请求参数：**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | INTEGER | 1 | 页码 |
| `limit` | INTEGER | 50 | 每页数量 |

**响应：**
```json
{
  "ok": true,
  "total": 8,
  "page": 1,
  "limit": 50,
  "messages": [
    {
      "id": "msg_xxx",
      "conversation_id": "chat_xxx",
      "role": "user",
      "content": "什么是 useCallback？",
      "thoughts": "",
      "attachments": "[]",
      "tool_steps": "[]",
      "references": "[]",
      "status": "completed",
      "content_type": "text",
      "model": "",
      "elapsed_ms": 0,
      "token_usage": "{}",
      "message_index": 0,
      ...
    },
    {
      "id": "msg_yyy",
      "role": "assistant",
      "content": "useCallback 是 React 提供的一个 Hook...",
      "thoughts": "",
      "tool_steps": "[{\"name\":\"代码搜索\",\"status\":\"completed\"}]",
      "references": "[{\"type\":2,\"title\":\"React 官方文档\"}]",
      "status": "completed",
      "elapsed_ms": 1200,
      "token_usage": "{\"prompt_tokens\":512,\"completion_tokens\":1024,\"total_tokens\":1536}",
      "message_index": 1,
      ...
    }
  ]
}
```

### 4.4 POST /memora/sync/conversations/:id/messages

向指定会话追加消息（流式响应完成后整条保存，或移动端发送消息后保存）。

**请求：**
```json
{
  "device_id": "mobile_ios_abc123",
  "role": "assistant",
  "content": "useCallback 是 React 提供的一个 Hook...",
  "content_type": "markdown",
  "model": "deepseek-v4-flash",
  "elapsed_ms": 1200,
  "token_usage": {"prompt_tokens": 512, "completion_tokens": 1024, "total_tokens": 1536},
  "message_index": 3,
  "thoughts": "",
  "attachments": [],
  "tool_steps": [{"name": "代码搜索", "status": "completed", "duration_ms": 856}],
  "references": [{"type": 2, "title": "React 文档", "url": "https://..."}],
  "status": "completed"
}
```

**校验规则：**
- `content` 超过 100KB → 返回 413 `message_too_large`
- `status = streaming` → 返回 400 `streaming_not_allowed`
- 自动更新会话的 `updated_at` + `revision` + `message_count`

**响应：**
```json
{
  "ok": true,
  "message_id": "msg_xxx",
  "conversation_revision": 4
}
```

### 4.5 PUT /memora/sync/conversations/:id

更新会话元数据。

**可更新字段：** `title`, `summary`, `is_pinned`, `archived`, `agent_mode`, `tags`, `extra`

**响应：**
```json
{
  "ok": true,
  "revision": 5
}
```

### 4.6 DELETE /memora/sync/conversations/:id

删除会话及其所有消息（软删除 + 级联）。

**响应：**
```json
{
  "ok": true,
  "deleted": true
}
```

> 删除会话时自动级联软删除所有消息，其他端下次 pull 时通过 deleted_ids 同步删除。

---

## 5. 流式响应保存策略

PC 端发起 AI 提问时：

```
1. 用户发送消息 → 本地保存 user message (status=completed) → push 到云端
2. AI 开始流式响应 → 本地实时渲染（不保存到 DB，不入库 streaming 状态）
3. AI 流式完成 → 本地保存完整 assistant message (status=completed) → push 到云端
4. 或使用 POST /sync/conversations/:id/messages 一次性保存
```

> ⚠️ **关键**：服务端不接受 `status=streaming` 的消息。流式中间态只在客户端本地渲染，完成后才推送。

---

## 6. 客户端对接指南

### 6.1 PC 端（Electron / Memora）

#### 本地数据结构

```sql
CREATE TABLE assistant_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '新对话',
  summary TEXT DEFAULT '',
  conversation_id TEXT DEFAULT '',
  message_count INTEGER DEFAULT 0,
  source TEXT DEFAULT 'manual',
  agent_mode TEXT DEFAULT 'agent',
  model TEXT DEFAULT '',
  app_key_hash TEXT DEFAULT '',
  is_pinned INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  extra TEXT DEFAULT '{}',
  revision INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE TABLE assistant_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  thoughts TEXT DEFAULT '',
  attachments TEXT DEFAULT '[]',
  tool_steps TEXT DEFAULT '[]',
  references TEXT DEFAULT '[]',
  status TEXT DEFAULT 'completed',
  content_type TEXT DEFAULT 'text',
  model TEXT DEFAULT '',
  elapsed_ms INTEGER DEFAULT 0,
  token_usage TEXT DEFAULT '{}',
  message_index INTEGER DEFAULT 0,
  parent_id TEXT DEFAULT '',
  extra TEXT DEFAULT '{}',
  revision INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT
);
```

#### 同步时机

| 场景 | 操作 |
|------|------|
| 新建会话 | 立即 push |
| 发送消息 | 本地保存 user message + push |
| AI 流式完成 | 保存完整 assistant message + push（status=completed） |
| 编辑会话标题/置顶/归档 | 立即 push |
| 删除会话 | push 带 `_deleted: true`（自动级联消息） |
| 定时同步 | 每 5 分钟 full sync |
| 启动/切回前台 | pull 最新 |

#### 代码示例（Electron）

```javascript
// 创建新会话
const convId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const convData = {
  id: convId,
  _base_revision: 0,
  title: '新对话',
  source: 'manual',
  agent_mode: 'agent',
  conversation_id: '',  // 首次发消息后由 ADP 返回，再更新
  app_key_hash: appKey.slice(0, 8),
};

// Push 到云端
await memoraSync.push({
  assistant_conversations: [convData]
});

// 发送消息
const userMsg = {
  id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  _base_revision: 0,
  conversation_id: convId,
  role: 'user',
  content: '什么是 useCallback？',
  message_index: 0,
  status: 'completed',
};

// AI 回复完成（流式结束后一次性保存）
const assistantMsg = {
  id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  _base_revision: 0,
  conversation_id: convId,
  role: 'assistant',
  content: fullResponseText,
  thoughts: thinkContent,  // DeepSeek-R1 思考链
  tool_steps: collectedToolSteps,
  references: collectedReferences,
  content_type: 'markdown',
  model: 'deepseek-v4-flash',
  elapsed_ms: 6543,
  token_usage: { prompt_tokens: 512, completion_tokens: 1024, total_tokens: 1536 },
  message_index: 1,
  status: 'completed',
};

// 一起 push
await memoraSync.push({
  assistant_messages: [userMsg, assistantMsg]
});

// 如果 ADP 返回了新的 ConversationId，更新会话
if (adpConversationId && !convData.conversation_id) {
  await memoraSync.push({
    assistant_conversations: [{ id: convId, _base_revision: 1, conversation_id: adpConversationId, message_count: 2 }]
  });
}
```

### 6.2 移动端（Flutter / MemoraMobile）

#### 同步时机

| 场景 | 操作 |
|------|------|
| 打开 AI 助手 Tab | pull 最新会话列表 |
| 点击进入会话 | pull 该会话消息 |
| 发送消息 | 本地保存 user message + push |
| AI 回复完成 | 本地保存 assistant message + push |
| 从后台返回 | pull 最新 |
| 下拉刷新 | full sync |

#### 代码示例（Flutter）

```dart
// 发送消息时，复用 conversation_id 保持 ADP 上下文
class ChatService {
  Future<void> sendMessage(String sessionId, String content) async {
    final session = await db.getChatSession(sessionId);
    final convId = session.conversationId.isEmpty
      ? generateConversationId()  // 新会话首次生成
      : session.conversationId;   // 复用已有的

    // 调 ADP
    final adpRes = await adp.chatSSE({
      'AppKey': appKey,
      'ConversationId': convId,    // 关键：复用 PC 端的 conversation_id
      'VisitorId': deviceId,
      'Contents': [{'Type': 'text', 'Text': content}],
      'Stream': 'enable'
    });

    // 保存 user message
    await db.insertChatMessage(ChatMessage(
      id: 'msg_${DateTime.now().millisecondsSinceEpoch}_xxx',
      sessionId: sessionId,
      role: 'user',
      content: content,
      messageIndex: session.messageCount,
      status: 'completed'
    ));

    // 流完成后保存 assistant message
    await db.insertChatMessage(ChatMessage(
      id: 'msg_${DateTime.now().millisecondsSinceEpoch}_yyy',
      sessionId: sessionId,
      role: 'assistant',
      content: fullResponseText,
      thoughts: thinkContent,
      toolSteps: collectedToolSteps,
      references: collectedReferences,
      messageIndex: session.messageCount + 1,
      status: 'completed',
      elapsedMs: elapsedMs,
      tokenUsage: tokenUsage,
    ));

    // 更新会话 conversation_id（首次）
    if (session.conversationId.isEmpty) {
      await db.updateChatSession(sessionId, conversationId: convId);
    }

    // Push 到云端
    await memoraSync.push(changes: {
      'assistant_conversations': [{...session, conversation_id: convId, message_count: session.messageCount + 2}],
      'assistant_messages': [userMsg, assistantMsg],
    });
  }
}
```

---

## 7. ADP ConversationId 跨端复用

### 7.1 核心机制

ADP 智能体的 `ConversationId` 决定上下文。多端要"看到同一对话且能继续聊"，**必须共享同一个 ConversationId**。

### 7.2 实现方式

1. PC 端首次发消息时，主进程生成 `convId-A`（32位小写字母+数字），写入 `assistant_conversations.conversation_id`
2. PC 端 push → 云端保存 `conversation_id = convId-A`
3. 移动端 pull → 收到会话记录，本地保存 `conversation_id`
4. 移动端用户在该会话发消息时，**读取本地的 conversation_id，作为 ConversationId 传给 ADP**
5. ADP 视为同一会话延续 → 上下文连贯

### 7.3 关键约束

| 约束 | 说明 |
|------|------|
| **AppKey 必须一致** | 不同 AppKey = 不同应用 = 不同上下文，多端必须用同一 AppKey |
| **ConversationId 由首次端生成** | 符合 ADP V2 规范 `[a-z0-9]{32}` |
| **VisitorId 可不同** | 各端用自己的设备指纹，ADP 不强制一致 |
| **conversation_id 存在会话表** | 所有端 pull 时都能拿到 |

---

## 8. 同步冲突处理

### 8.1 会话冲突

场景：PC 和移动端同时修改同一会话的标题。

处理：**LWW（Last Write Wins）** — revision 高的覆盖低的，客户端极少同时编辑标题。

### 8.2 消息冲突

消息通常是**只追加不修改**的，冲突极少。如果确实冲突，走标准 resolve 机制。

### 8.3 删除冲突

一端删除会话 → 另一端发消息时会话已 `deleted_at IS NOT NULL` → 返回 404 → 客户端提示"该会话已被其他设备删除"。

---

## 9. 性能优化

| 场景 | 策略 |
|------|------|
| 单条 content > 100KB | 服务端拒绝，客户端裁剪后重传 |
| 单会话消息 > 1000 条 | 移动端分页加载（page + limit） |
| 消息排序 | 按 `message_index` 排序，不依赖 `created_at` |
| 会话列表消息数 | 使用缓存 `message_count` 字段，避免每次 COUNT(*) |
| 附件 | 不存 base64，仅存 URL |
| 流式中间态 | 不推送 streaming 状态，完成后一次性推送 |

---

## 10. 数据库 SQL（服务端）

```sql
-- 15. 助手会话表
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '新对话',
  summary TEXT DEFAULT '',
  conversation_id TEXT DEFAULT '',
  message_count INTEGER DEFAULT 0,
  source TEXT DEFAULT 'manual',
  agent_mode TEXT DEFAULT 'agent',
  model TEXT DEFAULT '',
  app_key_hash TEXT DEFAULT '',
  is_pinned INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  extra TEXT DEFAULT '{}',
  origin_device_id TEXT DEFAULT '',
  revision INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- 16. 助手消息表
CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  thoughts TEXT DEFAULT '',
  attachments TEXT DEFAULT '[]',
  tool_steps TEXT DEFAULT '[]',
  "references" TEXT DEFAULT '[]',
  status TEXT DEFAULT 'completed',
  content_type TEXT DEFAULT 'text',
  model TEXT DEFAULT '',
  elapsed_ms INTEGER DEFAULT 0,
  token_usage TEXT DEFAULT '{}',
  message_index INTEGER DEFAULT 0,
  parent_id TEXT DEFAULT '',
  extra TEXT DEFAULT '{}',
  origin_device_id TEXT DEFAULT '',
  revision INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES assistant_conversations(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_conv_user ON assistant_conversations(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_conv_origin ON assistant_conversations(user_id, origin_device_id);
CREATE INDEX IF NOT EXISTS idx_conv_conversation_id ON assistant_conversations(user_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON assistant_messages(conversation_id, message_index ASC);
CREATE INDEX IF NOT EXISTS idx_msg_user ON assistant_messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_origin ON assistant_messages(user_id, origin_device_id);
```

> 注：`references` 是 SQL 保留字，建表和查询时必须用双引号包裹。

---

## 11. 完整 API 端点汇总

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/memora/sync/push` | 已注册设备 | 标准 push（含会话和消息，级联删除+大小校验） |
| POST | `/memora/sync/pull` | 已注册设备 | 标准 pull（含会话和消息） |
| POST | `/memora/sync/full` | 已注册设备 | 全量双向同步 |
| GET | `/memora/sync/conversations` | 登录用户 | 会话列表（分页/搜索/含消息数+最后消息摘要） |
| GET | `/memora/sync/conversations/:id` | 登录用户 | 会话详情 |
| GET | `/memora/sync/conversations/:id/messages` | 登录用户 | 会话消息列表（按 message_index 正序，分页） |
| POST | `/memora/sync/conversations/:id/messages` | 已注册设备 | 追加消息（自动更新会话 revision + message_count） |
| PUT | `/memora/sync/conversations/:id` | 已注册设备 | 更新会话元数据（标题/置顶/归档/agent_mode等） |
| DELETE | `/memora/sync/conversations/:id` | 已注册设备 | 删除会话及消息（软删除+级联） |
