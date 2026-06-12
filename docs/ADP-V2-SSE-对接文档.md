# ADP V2 对话端接口文档（HTTP SSE）

> 来源：https://cloud.tencent.com/document/product/1759/129202
> 最近更新：2026-06-01

---

## 1. 接口请求

- **请求地址**：`https://wss.lke.cloud.tencent.com/adp/v2/chat`
- **请求方式**：POST
- **Content-Type**：application/json
- **注意**：触发对话接口前，需要有已发布的应用

### 1.1 请求参数（放 HTTP Body，JSON 格式）

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `RequestId` | String | 否 | 请求ID，用于标识一个请求（建议必填）。长度 32-64 字符，正则 `^[a-zA-Z0-9_-]{32,64}$`，可用 UUID 生成 |
| `ConversationId` | String | **是** | 会话ID，不同用户必须不同。长度 32-64 字符，正则同上，UUID 生成 |
| `AppKey` | String | **是** | 应用密钥（放在 Body 中，不放 Header/Query） |
| `VisitorId` | String | **是** | 访客ID（外部输入，建议唯一，标识当前用户） |
| `Contents` | Array of Content | **是** | 消息内容信息列表 |
| `StreamingThrottle` | Number | 否 | 流式回复频率控制，值越小回包越频繁。默认 5，建议最大 100 |
| `SystemRole` | String | 否 | 角色指令/提示词，为空用应用默认 |
| `Incremental` | Boolean | 否 | true=text.delta 增量返回，false=text.replace 替换返回。默认 false |
| `SearchNetwork` | String | 否 | 联网搜索：空字符串=跟随配置，`enable`=开启，`disable`=关闭 |
| `ModelName` | String | 否 | 指定模型，同 ConversationId 不同模型可保持上下文关联 |
| `Stream` | String | 否 | 流式传输：空字符串=跟随配置，`enable`=流式，`disable`=非流式 |
| `WorkflowStatus` | String | 否 | 工作流：空字符串=跟随配置（默认开启），`enable`=开启，`disable`=关闭 |
| `EnableMultiIntent` | Boolean | 否 | 是否开启多意图 |
| `GenerateAgain` | Boolean | 否 | 是否重新生成请求 |

### 1.2 支持的自定义模型

| ModelName | 说明 |
|-----------|------|
| `Youtu/youtu-mrc-pro` | 精调知识大模型高级版 |
| `Youtu/youtu-mrc-standard` | 精调知识大模型标准版 |
| `Hunyuan/hunyuan` | 混元大模型高级版 |
| `Hunyuan/hunyuan-standard` | 混元大模型标准版 |
| `Hunyuan/hunyuan-turbo` | 混元大模型 Turbo 版 |
| `Hunyuan/hunyuan-standard-256k` | 混元大模型长文本版 |
| `Hunyuan/hunyuan-role` | 混元大模型角色扮演版 |
| `Hunyuan/hunyuan-t1` | 混元大模型 T1 版 |
| `Hunyuan/hunyuan-turbos` | 混元大模型 Turbos 版 |
| `Hunyuan/hunyuan-2.0-thinking-251109` | 混元大模型 2.0-Think |
| `Hunyuan/hunyuan-2.0-instruct-251111` | 混元大模型 2.0-Instruct |
| `Deepseek/deepseek-r1-250528` | DeepSeek-R1 模型最新版 |
| `Deepseek/deepseek-v3-250324` | DeepSeek-V3 模型最新版 |
| `Deepseek/deepseek-v3.1` | DeepSeek-V3.1 模型 |
| `Deepseek/deepseek-v3.2` | DeepSeek-V3.2 模型 |
| `TCADP/glm-5` | 智谱 GLM-5 |
| `TCADP/kimi-k2.5` | Kimi K2.5 |
| `TCADP/minimax-m2.5` | MiniMax M2.5 |

### 1.3 curl 调用示例

**文本问答**：
```bash
curl --location --request POST 'https://wss.lke.cloud.tencent.com/adp/v2/chat' \
--header 'Content-Type: application/json' \
--data '{
    "RequestId": "4feb312a-14e9-4161-bfe2-767c43ae0524",
    "ConversationId": "362b3aac-b7eb-4d2a-a154-204f288a4727",
    "AppKey": "请自行获取应用对应的key",
    "Contents": [{"Type": "text", "Text": "你好"}],
    "VisitorId": "100015179581",
    "Incremental": true,
    "EnableMultiIntent": true,
    "Stream": "enable"
}'
```

**图文问答**：
```bash
curl --location 'https://wss.lke.cloud.tencent.com/adp/v2/chat' \
--header 'Content-Type: application/json' \
--data '{
    "RequestId": "c12560d9-fd98-416e-a42c-a939d9f18cae",
    "ConversationId": "9ce50f0c-5f7a-43f0-a2d4-713d4534de92",
    "AppKey": "请自行获取应用对应的key",
    "Contents": [
        {"Type": "text", "Text": "图片中的演员是谁"},
        {"Type": "image", "Image": {"Url": "https://example.com/image.png"}}
    ],
    "VisitorId": "100015179581",
    "Incremental": true,
    "Stream": "enable"
}'
```

---

## 2. SSE 事件返回

### 2.1 请求确认事件 — `request_ack`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `request_ack` |
| `RequestAck` | Record | 请求确认信息 |

如果请求因安全审核或超并发被拦截，不会返回此事件，而是返回 error 事件。

### 2.2 响应创建事件 — `response.created`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `response.created` |
| `Response` | Record | 响应信息，Status 为 `processing` |

### 2.3 响应处理中事件 — `response.processing`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `response.processing` |
| `Response` | Record | 响应信息，包含 StatusDesc（如"调用思考模型"、"大模型直接回复"） |

**重要**：`response.processing` 会多次返回，ExtraInfo 中的 `ReplyMethod` 字段指示回复方式：
- `ReplyMethod: 0` — 初始状态，还未确定回复方式
- `ReplyMethod: 1` — 大模型回复
- `ReplyMethod: 18` — 智能体回复
- 其他值见下方 ReplyMethod 枚举

### 2.4 消息增加事件 — `message.added`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `message.added` |
| `Message` | Message | 消息信息 |

**Message.Type 可能的值**（这是最关键的字段）：
| Type 值 | 说明 |
|---------|------|
| `reply` | 回复消息（最终输出给用户的内容） |
| `thought` | 思考消息（AI 思考过程） |
| `tool_call` | 工具调用消息（如文生图、搜索等） |
| `task_execution` | 任务执行消息 |
| `recommendation` | 推荐问消息 |
| `notice` | 中间提示消息 |

### 2.5 消息处理中事件 — `message.processing`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `message.processing` |
| `MessageId` | String | 处理中的消息 ID |
| `Message` | Message | 消息状态信息 |

### 2.6 内容增加事件 — `content.added`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `content.added` |
| `MessageId` | String | 消息 ID |
| `ContentIndex` | Number | 内容序号 |
| `Content` | Content | 内容信息 |

### 2.7 文本内容增量事件 — `text.delta`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `text.delta` |
| `MessageId` | String | 消息 ID |
| `ContentIndex` | Number | 内容序号 |
| `Text` | String | 增量文本内容 |

**注意**：仅在 `Incremental: true` 时主要使用此事件。但 ADP 后台在需要修改已返回内容时，即使 Incremental 为 true，也可能返回 text.replace 事件。

### 2.8 文本内容替换事件 — `text.replace`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `text.replace` |
| `MessageId` | String | 消息 ID |
| `ContentIndex` | Number | 内容序号 |
| `Text` | String | 替换后的完整文本内容 |

**注意**：Text 是替换后的完整文本，不是增量。需要整体替换对应 ContentIndex 的内容。

### 2.9 消息处理完成事件 — `message.done`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `message.done` |
| `MessageId` | String | 消息 ID |
| `Message` | Message | 完整消息信息，包含 Contents 数组（完整内容） |

**关键**：`message.done` 中的 `Message.Contents` 包含该消息的完整内容，可用于最终展示。

### 2.10 响应完成事件 — `response.completed`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `response.completed` |
| `Response` | Record | 完整响应信息 |

`response.completed` 包含：
- `Messages`：所有消息列表（含 thought、tool_call、reply 等所有类型）
- `Procedures`：处理过程列表（含 Agent 执行详情、模型统计）
- `StatInfo`：总统计信息（InputTokens、OutputTokens、TotalTokens、TotalCost）
- `ExtraInfo`：包含 TraceId、ReplyMethod 等

### 2.11 角标增加事件 — `quote_info.added`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `quote_info.added` |
| `MessageId` | String | 消息 ID |
| `ContentIndex` | Number | 内容序号 |
| `QuoteInfo` | QuoteInfo | 角标信息（Position、Index） |

### 2.12 引文增加事件 — `reference.added`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `reference.added` |
| `MessageId` | String | 消息 ID |
| `ContentIndex` | Number | 内容序号 |
| `Reference` | Reference | 引文信息 |

Reference.Type 值：
- `1`：问答
- `2`：文档片段
- `4`：联网检索
- `5`：知识图谱

### 2.13 错误事件 — `error`

| 字段 | 类型 | 说明 |
|------|------|------|
| `Type` | String | 固定 `error` |
| `Error` | Error | 错误信息（Code、Message、RequestId、TraceId） |

### 2.14 结束标记 — `done`

```
event: done
data: [DONE]
```

---

## 3. 公共数据结构

### Content（消息内容）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `Type` | String | 是 | `text`/`image`/`file`/`custom_variables`/`widget_action` |
| `Text` | String | 否 | 文本内容 |
| `Image` | Image | 否 | 图片信息 |
| `File` | FileInfo | 否 | 文件信息 |
| `CustomVariables` | Map | 否 | 自定义变量 |
| `WidgetAction` | WidgetAction | 否 | Widget 动作 |
| `QuoteInfos` | Array | 否 | 引用信息 |
| `References` | Array | 否 | 参考文献信息 |
| `OptionCards` | Array | 否 | 选项卡信息 |
| `Sandbox` | Sandbox | 否 | 沙盒信息 |
| `WebSearch` | WebSearch | 否 | 网页搜索内容 |
| `FileCollection` | FileCollection | 否 | 文件收集信息 |
| `RelatedRecordId` | String | 否 | 关联的 RecordId |
| `Widget` | Widget | 否 | Widget 信息 |

### Image

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `Url` | String | 是 | 图片 URL（需使用上传到 ADP 的链接或公开可访问链接） |

### FileInfo

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `FileName` | String | 是 | 文件名称 |
| `FileSize` | String | 是 | 文件大小 |
| `FileUrl` | String | 是 | 文件 URL |
| `FileType` | String | 是 | 文件类型 |
| `DocId` | String | 否 | 实时文档解析返回的 doc_id（**标准模式文件对话时必填**） |

### Message（消息详情）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `Type` | String | 是 | 消息类型：`reply`/`thought`/`tool_call`/`task_execution`/`recommendation`/`notice` |
| `MessageId` | String | 是 | 消息唯一标识 |
| `Name` | String | 是 | 消息名称 |
| `Title` | String | 是 | 消息标题 |
| `Icon` | String | 否 | 图标 URL |
| `Status` | String | 是 | 消息状态（`processing`/`success`） |
| `StatusDesc` | String | 否 | 状态描述 |
| `Contents` | Array of Content | 否 | 内容数组 |
| `ExtraInfo` | MessageExtraInfo | 否 | 扩展信息 |

### MessageExtraInfo

| 字段 | 类型 | 说明 |
|------|------|------|
| `Elapsed` | Number | 消息持续时间 |
| `StartTime` | Number | 消息开始时间 |
| `AgentName` | String | 输出消息的智能体名称 |
| `AgentIcon` | String | 输出消息的智能体图标 |
| `ParentMessageId` | String | 父消息 ID |

### RecordExtraInfo（扩展信息）

| 字段 | 类型 | 说明 |
|------|------|------|
| `RequestId` | String | 请求 ID |
| `TraceId` | String | 链路 ID |
| `Elapsed` | Number | 事件耗时（ms） |
| `StartTime` | Number | 事件开始时间（ms） |
| `IsFromSelf` | Boolean | 消息是否由客户端发出 |
| `IsLlmGenerated` | Boolean | 是否为模型生成内容 |
| `CanRating` | Boolean | 该消息记录是否能评价 |
| `CanFeedback` | Boolean | 该消息记录是否能反馈 |
| `ReplyMethod` | Number | 回复方式（见枚举） |
| `FromName` | String | 来源名称 |
| `FromAvatar` | String | 来源头像 |
| `HasRead` | Boolean | 是否已读 |

### ReplyMethod 枚举

| 值 | 说明 |
|----|------|
| 0 | 初始状态/未确定 |
| 1 | 大模型回复 |
| 2 | 未知问题回复 |
| 3 | 拒答问题回复 |
| 4 | 敏感回复 |
| 5 | 已采纳问答对优先回复 |
| 6 | 欢迎语回复 |
| 7 | 并发数超限回复 |
| 8 | 全局干预知识 |
| 9 | 任务流回复 |
| 10 | 任务流答案 |
| 11 | 搜索引擎回复 |
| 12 | 知识润色后回复 |
| 13 | 图片理解回复 |
| 14 | 实时文档回复 |
| 15 | 澄清确认回复 |
| 16 | 工作流回复 |
| 17 | 工作流运行结束 |
| 18 | 智能体回复 |
| 19 | 多意图回复 |

### Reference（引文信息）

| 字段 | 类型 | 说明 |
|------|------|------|
| `Index` | Number | 引用来源索引 ID |
| `Type` | Number | 类型：1=问答, 2=文档片段, 4=联网检索, 5=知识图谱 |
| `Name` | String | 参考来源名称 |
| `DocRefer` | DocRefer | 文档片段参考信息 |
| `QaRefer` | QaRefer | 问答参考信息 |
| `WebSearchRefer` | WebSearchRefer | 联网检索参考信息 |
| `GraphRAGRefer` | GraphRAGRefer | 知识图谱参考信息 |

### Agent（智能体执行详情）

| 字段 | 类型 | 说明 |
|------|------|------|
| `Input` | String | 工具/大模型输入（JSON） |
| `Output` | String | 工具/大模型输出（JSON） |
| `ModelName` | String | 模型名 |
| `Content` | String | 检索 Query |
| `System` | String | 系统 Prompt |
| `RewriteQuery` | String | 改写后 Query |

### Procedure（处理过程详情）

| 字段 | 类型 | 说明 |
|------|------|------|
| `Name` | String | 过程名称（如 `thinking_model`、`tool_call`、`large_language_model`） |
| `Title` | String | 过程标题（如"调用思考模型"、"大模型直接回复"） |
| `Status` | String | 过程状态 |
| `Type` | String | 过程类型（如 `agent`） |
| `Agent` | Agent | 智能体执行详情 |
| `StatInfos` | Array of StatInfo | 模型统计 |

### StatInfo（统计信息）

| 字段 | 类型 | 说明 |
|------|------|------|
| `InputTokens` | Number | 输入 token 数 |
| `OutputTokens` | Number | 输出 token 数 |
| `TotalTokens` | Number | 总 token 数 |
| `ModelName` | String | 使用模型名 |
| `FirstTokenCost` | Number | 首 token 耗时 |
| `TotalCost` | Number | 模型总耗时 |

### Error

| 字段 | 类型 | 说明 |
|------|------|------|
| `Code` | Number | 错误码 |
| `Message` | String | 错误消息 |
| `RequestId` | String | 关联 RequestId |
| `TraceId` | String | 错误 TraceId |
| `Elapsed` | Number | 请求耗时（ms） |
| `StartTime` | Number | 请求开始时间（ms） |

---

## 4. 错误码

| 错误码 | 说明 |
|--------|------|
| 400 | 请求参数错误 |
| 460001 | Token 校验失败 |
| 460002 | 事件处理器不存在 |
| 460004 | 应用不存在 |
| 460006 | 消息不存在或没有操作权限 |
| 460007 | 会话创建失败 |
| 460008 | Prompt 渲染失败 |
| 460009 | 访客用户不存在 |
| 460010 | 会话不存在或没有操作权限 |
| 460011 | 超出应用配置模型 QPM 并发数限制 |
| 460020 | 模型请求超时 |
| 460021 | 知识库未发布 |
| 460022 | 访客创建失败 |
| 460023 | 消息点赞点踩失败 |
| 460024 | 标签不合法 |
| 460025 | 图像识别失败 |
| 460031 | 超出应用 QPS 并发数限制 |
| 460032 | 当前应用模型余额不足 |
| 460033 | 应用不存在或没有操作权限 |
| 460034 | 输入内容过长 |
| 460035 | 计算内容过长，已经停止 |
| 460036 | 任务流程节点预览参数异常 |
| 460037 | 搜索资源已用尽，调用失败 |
| 460038 | 该 AppID 请求存在异常行为，调用失败 |
| 4505004 | APPKEY 无效 |

---

## 5. SSE 事件流程图

### 简单问答流程
```
request_ack → response.created → response.processing(×N) → message.added(reply) → content.added → text.delta(×N) → message.done → response.completed → done
```

### 智能体工具调用流程
```
request_ack
→ response.created
→ response.processing(调用思考模型)
→ message.added(thought)       ← 思考消息
→ content.added → text.delta(×N) → message.done
→ message.added(tool_call)     ← 工具调用消息
→ content.added → text.delta/json_text(×N) → message.done
→ message.added(thought)       ← 第二轮思考
→ content.added → text.delta(×N) → message.done
→ message.added(reply)         ← 最终回复
→ content.added → text.delta(×N) → message.done
→ response.completed            ← 包含所有 Messages + Procedures
→ done
```

---

## 6. 前端对接关键要点

### 6.1 字段名规范
- V2 接口所有字段名为 **PascalCase**（如 `AppKey`、`ConversationId`、`VisitorId`）
- `AppKey` 必须放在 Body 中，**不放 Header/Query**
- `VisitorId` 是 V2 接口标准字段名（Python SDK 用的 `VisitorBizId` 是 SDK 自行封装）

### 6.2 文件对话
- 标准模式文件对话时，File 对象中 `DocId` 必填（由 docParse 接口返回）
- File 完整流程：`DescribeStorageCredential` → COS putObject → `docParse` 获取 DocId → V2 Chat

### 6.3 SSE 解析
- **跨 chunk 事件**：一个 SSE 事件可能被拆到两个 TCP chunk → 必须行缓冲拼接（buffer += chunk; lines = buffer.split('\n'); buffer = lines.pop()）
- **text.delta 中可能夹杂 JSON**：ADP 在 text.delta 中可能返回 `{"content":[{"type":"text"...}]}` 格式内容 → 需正则过滤
- **Incremental=true 时仍可能有 text.replace**：ADP 发现需要修改已返回内容时会返回 text.replace

### 6.4 消息类型处理
- `thought`：思考过程，可折叠展示
- `tool_call`：工具调用，显示工具名称+状态+结果
- `reply`：最终回复，主展示区域
- `task_execution`：任务执行，可显示进度
- `recommendation`：推荐问题，可展示为可点击按钮
- `notice`：中间提示，可显示为临时提示

### 6.5 回复方式（ReplyMethod）
- 前端可根据 `response.processing` 中的 `ReplyMethod` 判断回复类型
- `ReplyMethod: 18` 表示智能体回复，通常包含 thought + tool_call + reply
- `ReplyMethod: 1` 表示大模型直接回复，通常只有 reply

### 6.6 Node.js HTTP Server 配置
- 默认 `keepAliveTimeout: 72000`（72s），长工具调用会断连
- 必须设置 `keepAliveTimeout: 300000, requestTimeout: 0`
- Nginx 代理需 `X-Accel-Buffering: no` 禁用缓冲

### 6.7 AppKey 获取
- 在应用管理界面 → 找到运行中的应用 → 点击"调用" → 弹出窗口中复制 AppKey
