# 本地上下文注入设计（Local Context Injection）

> 目标：用户与 AI 助手对话时，先用 LLM 对问题做意图分类，判断需要携带哪些本地数据（记事本、记忆、画像、待办、知识文章等）及时间维度，再自动检索并注入到发送给 ADP 的消息中，让 AI 回答更精准。

---

## 一、整体架构

```
用户输入问题，如果没有选择专家卡片，就走本地 LLM 分析看是否需要带本地数据，然后调用默认 adp 助手。如果选择了专家卡片则直接走 adp
    │
    ▼
┌─────────────────────────────┐
│  Phase 1: LLM 意图分类      │  ← 本地 LLM（DeepSeek Flash，低延迟）
│  输出: JSON 分类结果         │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Phase 2: 本地数据检索       │  ← 根据 Phase 1 结果并行拉取
│  - 记事本 (notebook)         │
│  - 记忆 (memory)             │
│  - 画像 (profile)            │
│  - 待办任务 (tasks)          │
│  - 知识文章 (knowledge)      │
│  - 人脉 (relationship)       │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Phase 3: 上下文组装         │  ← 拼装 System Prompt / 附加消息
│  注入到 ADP 请求的           │
│  system_role 或前置消息      │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Phase 4: 发送给 ADP 执行    │  ← 现有 sendADPMessage 流程
└─────────────────────────────┘
```

---

## 二、Phase 1 — LLM 意图分类

### 2.1 分类 Prompt

调用本地 LLM（`highvol` 配置，用于高频低延迟场景），要求返回严格 JSON：

```json
{
  "need_notebook": true,          // 是否需要记事本内容
  "notebook_query": "项目进度",    // 记事本搜索关键词（空则取最近）
  "notebook_time_range": "7d",    // 时间范围：1d/7d/30d/90d/all

  "need_memory": true,            // 是否需要记忆
  "memory_query": "客户偏好",      // 记忆搜索关键词
  "memory_time_range": "30d",

  "need_profile": true,           // 是否需要用户画像
  "profile_fields": ["role","projects","persons"],  // 需要的画像字段

  "need_tasks": true,             // 是否需要待办任务
  "task_filter": "pending",       // pending/all/overdue/completed
  "task_time_range": "7d",        // 截止时间在 N 天内的

  "need_knowledge": true,         // 是否需要知识文章
  "knowledge_query": "ADP 接入",  // 知识搜索关键词
  "knowledge_limit": 3,           // 最多返回几篇

  "need_relationship": false,     // 是否需要人脉数据

  "intent_summary": "用户想了解项目进展和相关待办"  // 一句话意图
}
```

### 2.2 调用方式

- **IPC 通道**: 新增 `context:classify-intent`
- **模型**: 使用 `highvol` 配置（DeepSeek Flash / 低延迟模型）
- **参数**: `temperature: 0.1`（分类任务需要确定性输出）
- **超时**: 3 秒（分类失败则走默认兜底策略 — 只带 profile + 最近 3 条任务）

### 2.3 兜底策略

当 LLM 分类失败（超时/错误/格式不对）时：
- 默认带 `profile`（轻量，始终有价值）
- 默认带最近 3 条 `pending` 任务（最常用上下文）
- 不带记事本和记忆（数据量大，避免 token 浪费）

---

## 三、Phase 2 — 本地数据检索

### 3.1 数据源映射表

| 数据源 | IPC / API | 检索方式 | 数据量控制 |
|--------|-----------|----------|-----------|
| 记事本 | `notebook-search(query)` | 关键词搜索 + 时间过滤 | 最多 5 条，每条截取前 500 字 |
| 记忆 | `knowledgeSearchLocal(query)` | 关键词搜索 | 最多 5 条，每条截取前 300 字 |
| 画像 | `profile.get()` | 全量获取（数据量小） | 压缩为摘要（~200 token） |
| 待办任务 | `Store.getTasks()` | 状态过滤 + 截止时间过滤 | 最多 10 条，只取 title/dueDate/priority |
| 知识文章 | `knowledgeGetArticles(filter)` | 关键词搜索 | 最多 3 篇，每篇截取前 300 字 |
| 人脉 | `relationship` | 关键词搜索 | 最多 3 人，只取 name/company/relation |

### 3.2 并行检索

所有数据源并行拉取（`Promise.all`），总耗时取决于最慢的数据源。

### 3.3 Token 预算

| 数据类型 | Token 预算 | 优先级 |
|----------|-----------|--------|
| 用户画像摘要 | ~200 | P0（必带） |
| 待办任务 | ~300 | P1 |
| 记事本 | ~500 | P2 |
| 记忆 | ~400 | P2 |
| 知识文章 | ~400 | P3 |
| 人脉 | ~200 | P3 |
| **总计** | **~2000** | |

超过预算时按优先级截断。

---

## 四、Phase 3 — 上下文组装

### 4.1 注入方式

**方案 A（推荐）**: 注入到 ADP 请求的 `SystemRole` 字段

```javascript
const systemRole = `[用户上下文]
${profileSummary}
${taskSummary}
${notebookSummary}
${memorySummary}
${knowledgeSummary}
${relationshipSummary}

请基于以上用户上下文回答问题。如果上下文中没有相关信息，请如实说明。`;
```

ADP V2 接口支持 `SystemRole` 字段，直接传入即可。

### 4.2 注入位置

在 `sendADPMessage` 的数据构造处（app.js ~2397 行），将 `systemRole` 追加到 `adpMessageData`：

```javascript
const adpMessageData = {
  message: message,
  attachments: attachmentData,
  systemRole: localContextSystemRole,  // ← 新增
};
```

主进程 `send-adp-message` handler 需要将 `systemRole` 传入 ADP 请求的 `SystemRole` 字段。

---

## 五、Phase 4 — 发送给 ADP

复用现有 `sendADPMessage` 流程，唯一变化是多了 `systemRole` 字段。

---

## 六、实现步骤

### Step 1: 新增 IPC — 意图分类
- `main.js`: 新增 `context:classify-intent` handler
  - 接收用户消息文本
  - 调用 LLM（`highvol` 配置，structured JSON 输出）
  - 返回分类结果 JSON
  - 失败时返回 `null`（兜底策略由渲染进程处理）

### Step 2: 新增渲染进程方法 — 本地数据检索
- `app.js`: 新增 `_retrieveLocalContext(classification)` 方法
  - 根据 Phase 1 的分类结果，并行调用各 IPC 接口
  - 每个 IPC 返回截断后的摘要数据
  - 组装为 `systemRole` 字符串
  - 返回 `{ systemRole, sources: string[] }` （sources 用于 UI 展示"已参考: 记事本×3, 任务×5"）

### Step 3: 修改 sendAIMessage — 注入上下文
- 在 `sendAIMessage()` 中，发送消息前先调用分类 + 检索
  - 非流式（同步等待分类结果）
  - UI 上显示"🧠 正在检索本地数据..."进度提示
  - 将 `systemRole` 注入到 `adpMessageData`

### Step 4: 修改主进程 — 支持 SystemRole
- `main.js`: `send-adp-message` handler 读取 `systemRole` 字段
  - ADP V2: 注入到请求 Body 的 `SystemRole`
  - ADP V1: 注入到请求 Body 的 `system_role`

### Step 5: 新增 Prompt 文件
- `prompts/context-classify.md`: 意图分类的完整 Prompt 模板

### Step 6: UI 增强
- 发送消息时底部显示 "🧠 已参考: 画像, 任务×3, 记事本×2"
- 设置中可开关此功能（默认开启）

---

## 七、关键设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 分类用什么模型 | highvol（DeepSeek Flash） | 低延迟，JSON 输出稳定 |
| 上下文注入方式 | SystemRole | 不污染用户消息，不占对话轮次 |
| 分类失败兜底 | profile + 最近任务 | 最小可用上下文，几乎零延迟 |
| Token 预算 | ~2000 | 留足空间给 ADP 长回复（通常 4K context） |
| 是否缓存分类结果 | 否（每条消息独立分类） | 用户对话意图可能快速切换 |
| 用户是否可关闭 | 是（设置开关） | 避免每次都多一次 LLM 调用 |

---

## 八、时序图

```
用户点击发送
    │
    ├─ 1. 显示 "🧠 检索本地上下文..."
    │
    ├─ 2. IPC → context:classify-intent(message)
    │      └─ main.js → LLM highvol → JSON 分类结果
    │         └─ 3s 超时兜底
    │
    ├─ 3. Promise.all([
    │      notebookSearch(query),
    │      knowledgeSearchLocal(query),
    │      Store.getTasks(filter),
    │      profile.get(),
    │    ])
    │
    ├─ 4. 组装 systemRole (~2000 token)
    │
    ├─ 5. 注入到 adpMessageData.systemRole
    │
    ├─ 6. 隐藏 "检索中..." 提示
    │      显示 "已参考: 画像, 任务×3..."
    │
    └─ 7. sendADPMessage(adpMessageData) → 现有流式流程
```

---

## 九、预估性能

| 阶段 | 耗时 | 说明 |
|------|------|------|
| LLM 分类 | 0.5-1.5s | DeepSeek Flash，短输入 |
| 本地数据检索 | 0.1-0.3s | 全部本地，并行 |
| 上下文组装 | <0.05s | 纯字符串拼接 |
| **总增量** | **0.6-1.8s** | 用户感知为发送前短暂延迟 |

---

## 十、风险与对策

| 风险 | 对策 |
|------|------|
| LLM 分类增加延迟 | 3s 超时兜底 + 设置可关闭 |
| 注入上下文占用 token 预算 | 2000 token 上限 + 优先级截断 |
| 敏感数据泄露给 ADP | 画像/记忆等本地数据通过 systemRole 发给 ADP，走现有 HTTPS 通道；用户可关闭 |
| LLM 返回非 JSON | 正则提取 + 失败兜底 |
| 分类不准导致带错数据 | 多带总比少带好；SystemRole 中声明"如果上下文无关请忽略" |
