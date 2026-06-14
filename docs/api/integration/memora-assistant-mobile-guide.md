# Memora AI 助手 — 移动端对接开发指南

> 版本: 1.0 | 更新: 2026-06-10
> 面向: MemoraMobile (Flutter) 开发团队
> 基于: Memora PC Electron 端已实现的 AI 助手功能，完整梳理对接规范

---

## 目录

1. [架构概览](#1-架构概览)
2. [ADP V2 SSE 协议对接](#2-adp-v2-sse-协议对接)
3. [SSE 事件全解析](#3-sse-事件全解析)
4. [工具调用进度条与结果解析](#4-工具调用进度条与结果解析)
5. [会话管理（Session）](#5-会话管理session)
6. [停止生成与错误处理](#6-停止生成与错误处理)
7. [会话历史同步](#7-会话历史同步)
8. [UI 设计规范](#8-ui-设计规范)
9. [Markdown 渲染规范](#9-markdown-渲染规范)
10. [附件/文件上传](#10-附件文件上传)
11. [关键陷阱与踩坑记录](#11-关键陷阱与踩坑记录)
12. [完整交互流程图](#12-完整交互流程图)

---

## 1. 架构概览

### 1.1 整体数据流

```
移动端 (Flutter)                    服务端                          ADP 智能体平台
┌─────────────┐                 ┌──────────────┐               ┌──────────────────┐
│  用户输入     │──SSE POST──────▶│ Config Server │──转发──────▶│ ADP V2 API       │
│  (文本/附件)  │                 │  :3450        │              │ wss.lke.cloud... │
│              │◀──SSE Stream────│  (JWT 鉴权)    │◀──SSE 流────│                  │
│  实时渲染     │                 │               │              │  智能体处理       │
│              │                 │               │              │  工具调用         │
│  会话同步     │──REST API──────▶│ 同步路由       │              │  文件生成         │
│              │◀──JSON Response─│ /memora/sync/*│              │                  │
└─────────────┘                 └──────────────┘               └──────────────────┘
```

### 1.2 移动端职责

| 职责 | 说明 |
|------|------|
| **SSE 流式对话** | 直接向 ADP V2 API 发起 HTTP POST + SSE 流式读取（或通过自建后端代理） |
| **会话历史同步** | 通过 Config Server v3 同步协议 push/pull 会话和消息 |
| **UI 渲染** | Markdown、思考过程、工具步骤、文件卡片、引用来源 |
| **会话保持** | 复用 ADP `ConversationId` 保持多轮上下文连贯 |
| **停止生成** | 中断 SSE 流，保存已接收内容 |

### 1.3 双模式架构

PC 端支持两种 AI 模式，移动端**只需实现 Agent 模式**：

| 模式 | 说明 | 移动端支持 |
|------|------|:---:|
| `agent` | 走 ADP 智能体（工具调用、多步推理、文件生成） | ✅ 必须 |
| `llm` | 走本地 LLM（DeepSeek OpenAI 兼容接口） | ❌ 不需要 |

---

## 2. ADP V2 SSE 协议对接

### 2.1 请求格式

**端点**: `POST https://wss.lke.cloud.tencent.com/adp/v2/chat`

**请求头**:
```
Content-Type: application/json
```

**请求体**（PascalCase）:
```json
{
  "RequestId": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",   // 32位随机 [a-z0-9]
  "ConversationId": "4hqptq1drnb4672bgvpr8x85iv5mq0sk", // 32位，首次生成后复用
  "AppKey": "EvcCHxUUYyxxxxxx",                         // ADP 应用密钥，走 Body 不走 Header
  "VisitorId": "mobile_ios_abc123",                      // 设备指纹，各端独立
  "Contents": [                                          // 内容数组，按顺序排列
    { "Type": "text", "Text": "用户消息内容" }
  ],
  "Incremental": true,    // 增量模式，text.delta 是追加不是替换
  "Stream": "enable",     // 必须，启用 SSE 流式
  "StreamingThrottle": 5  // 流式节流（秒），控制推送频率
}
```

**Contents 类型**:

| Type | 格式 | 说明 |
|------|------|------|
| `text` | `{ "Type": "text", "Text": "内容" }` | 纯文本消息 |
| `image` | `{ "Type": "image", "Image": { "Url": "https://..." } }` | 图片（URL，非 base64） |
| `file` | `{ "Type": "file", "File": { "FileName": "a.pdf", "FileSize": "1024", "FileUrl": "https://...", "FileType": "pdf", "DocId": "xxx" } }` | 文件（需先上传到 ADP COS） |

### 2.2 SSE 流解析

SSE 响应是标准 `text/event-stream` 格式：

```
event: request_ack
data: {"RequestId":"xxx","ConversationId":"yyy"}

event: response.created
data: {"Response":{"Id":"resp_xxx","Status":"processing"}}

event: message.added
data: {"MessageId":"msg_xxx","Message":{"Type":"tool_call","ExtraInfo":{"ToolName":"search"}}}

event: text.delta
data: {"Text":"你好"}

event: text.delta
data: {"Text":"，我是"}

event: message.done
data: {"MessageId":"msg_xxx","Message":{"Type":"tool_call","Contents":[{"Text":"搜索结果..."}]}}

event: text.delta
data: {"Text":"根据搜索结果..."}

event: response.completed
data: {"Response":{"StatInfo":{"InputTokens":512,"OutputTokens":1024}}}

data: [DONE]
```

### 2.3 Flutter SSE 客户端实现要点

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class ADPSSEClient {
  String? _conversationId;
  String? _appKey;
  
  /// 发送消息并接收 SSE 流
  Stream<ADPEvent> chat({
    required String message,
    String? conversationId,
    List<ADPContent> contents = const [],
  }) async* {
    // 生成或复用 ConversationId
    _conversationId = conversationId ?? _generateConversationId();
    
    final requestId = _generateRequestId();
    
    // 构建请求体
    final body = {
      'RequestId': requestId,
      'ConversationId': _conversationId,
      'AppKey': _appKey,
      'VisitorId': _visitorId,
      'Contents': [
        ...contents.map((c) => c.toJson()),
        {'Type': 'text', 'Text': message},
      ],
      'Incremental': true,
      'Stream': 'enable',
      'StreamingThrottle': 5,
    };
    
    final request = http.Request('POST', Uri.parse(adpUrl));
    request.headers['Content-Type'] = 'application/json';
    request.body = jsonEncode(body);
    
    final client = http.Client();
    try {
      final response = await client.send(request);
      
      String buffer = '';
      String currentEvent = '';
      
      await for (final chunk in response.stream.transform(utf8.decoder)) {
        buffer += chunk;
        final lines = buffer.split('\n');
        buffer = lines.removeLast(); // 保留不完整行
        
        for (final line in lines) {
          final trimmed = line.replaceAll(RegExp(r'\r$'), '');
          if (trimmed.startsWith(':')) continue; // 心跳注释
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.substring(6).trim();
          } else if (trimmed.startsWith('data:')) {
            final data = trimmed.substring(5).trim();
            if (data == '[DONE]') {
              yield ADPEvent(event: 'done', data: null);
              return;
            }
            try {
              final parsed = jsonDecode(data);
              yield ADPEvent(
                event: currentEvent.isNotEmpty ? currentEvent : (parsed['Type'] ?? ''),
                data: parsed,
              );
            } catch (_) {}
            currentEvent = ''; // 重置
          }
        }
      }
    } finally {
      client.close();
    }
  }
  
  /// 生成 32 位随机 ConversationId
  String _generateConversationId() {
    final chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return List.generate(32, (_) => chars[DateTime.now().microsecond % chars.length]).join();
    // 实际应用更安全的随机：Random().nextInt(chars.length)
  }
  
  /// 生成 32 位 RequestId
  String _generateRequestId() => _generateConversationId();
}

class ADPEvent {
  final String event;
  final dynamic data;
  ADPEvent({required this.event, this.data});
}
```

---

## 3. SSE 事件全解析

### 3.1 事件时序图

```
客户端请求 ──────▶ ADP
                  │
    ◀─────────────│ event: request_ack          (请求已确认)
    ◀─────────────│ event: response.created      (响应开始)
    ◀─────────────│ event: message.added         (工具调用开始)
    ◀─────────────│ event: message.processing    (工具执行中)
    ◀─────────────│ event: message.done          (工具完成，含结果)
    ◀─────────────│ ... (可能多轮工具调用) ...
    ◀─────────────│ event: message.added         (type=reply，AI 开始回复)
    ◀─────────────│ event: text.delta            (流式文本片段)
    ◀─────────────│ event: text.delta            (流式文本片段)
    ◀─────────────│ ... (持续追加) ...
    ◀─────────────│ event: response.completed    (响应完成，含 token 统计)
    ◀─────────────│ data: [DONE]                 (流结束)
```

### 3.2 事件详细说明

| 事件 | data 结构 | 处理方式 |
|------|----------|---------|
| `request_ack` | `{RequestId, ConversationId}` | 添加进度步骤：📤 "请求已发送" ✓ |
| `response.created` | `{Response: {Id, Status}}` | 添加进度步骤：🤖 "智能体已接收" ✓ |
| `response.processing` | `{Response: {StatusDesc}}` | 可选：更新状态文字 |
| `message.added` | `{MessageId, Message: {Type, Name, ExtraInfo}}` | 见下方分支处理 |
| `message.processing` | `{MessageId, Message: {Type, Contents}}` | 工具执行中的中间结果 |
| `message.done` | `{MessageId, Message: {Type, Contents, ExtraInfo}}` | 工具完成，解析结果 |
| `content.added` | - | 辅助事件，表示有内容开始 |
| `text.delta` | `{Text: "增量文本", MessageId}` | **核心**：追加到当前回复文本 |
| `text.replace` | `{Text: "替换全文", MessageId}` | 替换当前回复文本（修正模式） |
| `response.completed` | `{Response: {StatInfo: {InputTokens, OutputTokens}}}` | token 统计，可展示 |
| `thought` | `{Text: "思考内容"}` 或 `{Content: "思考内容"}` | AI 思考链（DeepSeek-R1 等推理模型） |
| `error` | `{Error: {Code, Message}}` | 显示错误信息 |
| `done` | 无 data | 流结束 |

### 3.3 `message.added` 分支处理

```dart
void handleMessageAdded(ADPEvent evt) {
  final msg = evt.data['Message'] ?? {};
  final msgId = evt.data['MessageId'] ?? msg['MessageId'] ?? '';
  
  if (msg['Type'] == 'tool_call') {
    // 工具调用开始
    final toolName = msg['ExtraInfo']?['ToolName'] ?? '工具';
    addProgressStep(
      msgId: msgId,
      icon: getToolIcon(toolName),
      label: getToolLabel(toolName),
      status: StepStatus.active, // 转圈中
    );
  } else if (msg['Type'] == 'reply' || msg['Name'] == 'reply') {
    // AI 开始正式回复
    collapseProgressBar(); // 折叠进度条
    startReplyBubble();    // 创建回复气泡
  }
}
```

### 3.4 `message.done` 工具结果解析

```dart
void handleMessageDone(ADPEvent evt) {
  final msg = evt.data['Message'] ?? {};
  final msgId = evt.data['MessageId'] ?? msg['MessageId'] ?? '';
  
  if (msg['Type'] == 'tool_call') {
    final toolName = msg['ExtraInfo']?['ToolName'] ?? '工具';
    
    // 更新步骤状态为完成
    updateProgressStep(msgId, '${getToolLabel(toolName)} ✓', StepStatus.done);
    
    // 解析工具返回内容
    final resultText = msg['Contents']?[0]?['Text'];
    if (resultText != null) {
      if (toolName == 'FileToURL') {
        // 文件生成工具：解析文件卡片
        try {
          final result = jsonDecode(resultText);
          if (result['files'] != null) {
            for (final f in result['files']) {
              fileItems.add(FileItem(
                url: f['url'],
                fileName: f['file_path']?.split('/').last ?? '文件',
              ));
            }
            addStepDetail(msgId, buildFileCards(result['files']), ContentType.file);
          }
        } catch (_) {
          addStepDetail(msgId, resultText, ContentType.json);
        }
      } else {
        // 其他工具：显示 JSON 结果
        addStepDetail(msgId, resultText, ContentType.json);
      }
    }
  }
}
```

### 3.5 `text.delta` 流式文本处理

```dart
String currentText = '';
String thinkingText = '';

void handleTextDelta(ADPEvent evt) {
  final text = evt.data['Text'] ?? '';
  if (text.isEmpty) return;
  
  // ⚠️ 关键：过滤 ADP 偶尔混入的 JSON 内容
  if (RegExp(r'^\{"content":\[', caseSensitive: false).hasMatch(text)) {
    return; // 跳过，这是 ADP 内部格式泄漏
  }
  
  currentText += text;
  renderReplyBubble(currentText, thinkingText); // 用 requestAnimationFrame 节流渲染
}
```

### 3.6 `thought` 事件（推理模型思考链）

DeepSeek-R1、Hunyuan-T1 等推理模型会产生 `thought` 事件，包含 AI 的思考过程：

```dart
void handleThought(ADPEvent evt) {
  final text = evt.data['Text'] ?? evt.data['Content'] ?? '';
  thinkingText += text;
  // 思考内容不追加到 currentText，单独渲染为可折叠区域
}
```

同时也需要处理 `<think/>` 标签（部分模型在文本中内嵌思考内容）：

```dart
// 在 text.delta 中可能包含 <think/> 标签
final thinkRegex = RegExp(r'<think([\s\S]*?)</think?>');
currentText = currentText.replaceAllMapped(thinkRegex, (match) {
  thinkingText += match.group(1) ?? '';
  return ''; // 从正文中移除
});
```

---

## 4. 工具调用进度条与结果解析

### 4.1 进度条 UI 结构

```
┌─────────────────────────────────────────────┐
│ 🔄 智能体处理中                    12s      │  ← 标题栏 + 计时器
│ ┌─────────────────────────────────────────┐ │
│ │ 📤 请求已发送                   ✓       │ │  ← 已完成步骤
│ │ 🤖 智能体已接收                 ✓       │ │
│ │ 🔍 联网搜索                     ●       │ │  ← 进行中步骤（转圈）
│ │ 📊 渲染图表                             │ │  ← 等待中步骤
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘

AI 开始回复后折叠为：
┌─────────────────────────────────────────────┐
│ ▶ 已完成 3 个步骤                            │  ← 可点击展开
└─────────────────────────────────────────────┘
```

### 4.2 步骤状态流转

```
active (转圈中) ──▶ done (✓) 或 failed (✗)
```

### 4.3 工具图标映射

```dart
String getToolIcon(String toolName) {
  const icons = {
    'get_feature_rates': '📊',
    'get_brand_summary': '📋',
    'render_chart': '📈',
    'write': '📝',
    'FileToURL': '🔗',
    'search': '🔍',
  };
  return icons[toolName] ?? '🔧';
}

String getToolLabel(String toolName) {
  const labels = {
    'get_feature_rates': '查询标配率',
    'get_brand_summary': '查询概览',
    'render_chart': '渲染图表',
    'write': '生成报告',
    'FileToURL': '获取文件链接',
    'search': '搜索',
  };
  return labels[toolName] ?? toolName;
}
```

### 4.4 步骤详情（可展开）

每个工具步骤完成后，可以点击展开查看返回结果：

| 内容类型 | 渲染方式 |
|---------|---------|
| `json` | 格式化显示 JSON（截断显示前 200 字） |
| `file` | 渲染为文件卡片列表（图标 + 文件名 + 下载按钮） |
| `text` | 纯文本显示 |

### 4.5 文件卡片数据结构

ADP `FileToURL` 工具返回的 JSON 格式：

```json
{
  "files": [
    {
      "file_path": "/reports/2026-06/sales_report.html",
      "url": "https://sandbox.adp.cloud.tencent.com/..."
    }
  ]
}
```

渲染为文件卡片：

```
┌────────────────────────────────┐
│ 🌐 sales_report.html   ↗ 下载  │
│ 📊 data.xlsx           ↗ 下载  │
└────────────────────────────────┘
```

文件图标映射：

```dart
String getFileIcon(String extension) {
  const icons = {
    'html': '🌐', 'pdf': '📖', 'xlsx': '📊',
    'csv': '📋', 'png': '🖼', 'jpg': '🖼',
  };
  return icons[extension] ?? '📄';
}
```

---

## 5. 会话管理（Session）

### 5.1 核心概念

| 概念 | 说明 |
|------|------|
| **Session ID** | 客户端生成的会话 ID，格式 `chat_<timestamp>_<random>`，用于本地管理和云端同步 |
| **ConversationId** | ADP 分配/客户端生成的 32 位 `[a-z0-9]` 字符串，**跨端复用保持上下文** |
| **VisitorId** | 设备指纹，各端独立，ADP 不强制跨端一致 |

### 5.2 会话生命周期

```
创建会话 → 发送首条消息 → 生成 ConversationId → 多轮对话 → 归档/删除
```

**关键规则**：
1. **首次发消息时生成 ConversationId**，之后同一会话内所有消息复用
2. **切换会话时**，必须通知 ADP 层切换到目标会话的 ConversationId
3. **新建会话时**，清空 ConversationId，让 ADP 在首次发消息时生成新的
4. **从云端拉取的会话**，使用其携带的 `conversation_id` 字段作为 ConversationId

### 5.3 ConversationId 跨端复用

```
PC 端首次发消息：
  1. 主进程生成 convId-A = "4hqptq1drnb4672bgvpr8x85iv5mq0sk"
  2. 存入 assistant_conversations.conversation_id
  3. Push 到云端

移动端 Pull：
  4. 收到会话记录，本地保存 conversation_id = convId-A
  5. 在该会话发消息时，使用 convId-A 作为 ConversationId
  6. ADP 视为同一会话延续 → 上下文连贯 ✅
```

**约束**：
- AppKey 必须跨端一致（不同 AppKey = 不同应用 = 不同上下文）
- ConversationId 格式必须是 `[a-z0-9]{32}`

### 5.4 会话切换交互

```dart
void switchSession(String sessionId) {
  // 1. 如果正在流式，先停止
  if (isStreaming) stopGeneration();
  
  // 2. 保存当前会话消息到本地
  saveCurrentSessionMessages();
  
  // 3. 切换活跃会话
  activeSessionId = sessionId;
  
  // 4. 恢复目标会话的消息
  final session = sessions.firstWhere((s) => s.id == sessionId);
  if (session.isFromCloud && !hasLocalMessages(sessionId)) {
    // 云端会话且本地无缓存：从服务端加载消息
    loadCloudMessages(sessionId);
  } else {
    // 本地会话：从本地存储恢复
    restoreSessionMessages(sessionId);
  }
  
  // 5. 切换 ADP ConversationId
  if (session.conversationId != null) {
    setADPConversationId(session.conversationId!);  // 恢复上下文
  } else {
    setADPConversationId(null);  // 新会话，等首次发消息生成
  }
}
```

### 5.5 会话数据结构（本地）

```dart
class ChatSession {
  String id;              // chat_<timestamp>_<random>
  String title;           // 首条用户消息前30字，默认"新对话"
  int messageCount;       // 消息数量缓存
  DateTime createdAt;
  DateTime updatedAt;
  String? conversationId; // ADP ConversationId，跨端复用
  bool isFromCloud;       // 是否来自云端同步
  int revision;           // 云端同步版本号
}
```

---

## 6. 停止生成与错误处理

### 6.1 停止生成

用户点击"停止生成"按钮时：

```dart
void stopGeneration() {
  if (!isStreaming) return;
  
  // 1. 中断 SSE 连接（关闭 HTTP Client / abort 请求）
  sseClient?.close();
  
  // 2. 保存已接收的内容
  if (currentText.isNotEmpty) {
    saveAssistantMessage(
      content: currentText,
      thoughts: thinkingText,
      status: 'aborted',  // 标记为已中止
    );
  }
  
  // 3. 清理状态
  isStreaming = false;
  
  // 4. 更新 UI
  hideStopButton();
  showSendButton();
  
  // 5. 推送已接收的消息到云端
  pushMessagesToCloud();
}
```

### 6.2 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| **网络超时** | 显示"网络连接超时，请重试"，提供重试按钮 |
| **ADP HTTP 4xx/5xx** | 显示 `HTTP {status}` 错误，含 ADP 返回的 error message |
| **SSE 流中断** | 保存已接收内容，标记 status=aborted |
| **JSON 解析失败** | 跳过该事件，继续处理后续事件 |
| **460004 应用不存在** | 检查 AppKey 是否正确 |
| **460011 模型 QPM 超限** | 显示"服务繁忙，请稍后重试" |
| **460034 输入过长** | 提示用户缩短输入 |

### 6.3 流式中止后的消息保存

中止的消息**仍然要保存并同步**，但 `status` 标记为 `aborted` 而非 `completed`：

```dart
final message = AssistantMessage(
  id: 'msg_${DateTime.now().millisecondsSinceEpoch}_${randomSuffix}',
  conversationId: activeSessionId,
  role: 'assistant',
  content: currentText,       // 已接收的文本
  thoughts: thinkingText,     // 已接收的思考过程
  toolSteps: collectedSteps,  // 已完成的工具步骤
  references: collectedRefs,  // 已收集的引用
  status: 'aborted',          // ← 关键：不是 completed
  messageIndex: nextMessageIndex,
);
```

---

## 7. 会话历史同步

### 7.1 同步架构

会话和消息通过 Config Server v3 同步协议同步，复用现有的 `push/pull/full` 机制：

| API | 方法 | 说明 |
|-----|------|------|
| `/memora/sync/push` | POST | 推送本地变更到云端 |
| `/memora/sync/pull` | POST | 拉取云端变更到本地 |
| `/memora/sync/full` | POST | 全量双向同步 |
| `/memora/sync/conversations` | GET | 获取会话列表（分页） |
| `/memora/sync/conversations/:id/messages` | GET | 获取会话消息列表 |
| `/memora/sync/conversations/:id/messages` | POST | 追加消息 |
| `/memora/sync/conversations/:id` | PUT | 更新会话元数据 |
| `/memora/sync/conversations/:id` | DELETE | 删除会话（软删除+级联） |

### 7.2 数据模型

#### assistant_conversations（会话表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | `chat_<timestamp>_<random>` |
| `title` | TEXT | 会话标题，默认"新对话" |
| `conversation_id` | TEXT | **ADP ConversationId，跨端复用** |
| `message_count` | INTEGER | 消息数量缓存 |
| `source` | TEXT | 来源：manual / clipboard / knowledge |
| `agent_mode` | TEXT | AI 模式：agent / llm |
| `model` | TEXT | AI 模型名 |
| `is_pinned` | INTEGER | 是否置顶 |
| `archived` | INTEGER | 是否归档 |
| `revision` | INTEGER | 乐观锁版本号 |
| `origin_device_id` | TEXT | 创建该记录的设备 ID |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |
| `deleted_at` | TEXT | 软删除时间 |

#### assistant_messages（消息表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | `msg_<timestamp>_<random>` |
| `conversation_id` | TEXT FK | 所属会话 ID |
| `role` | TEXT | user / assistant / system |
| `content` | TEXT | **Markdown 原文**（≤100KB） |
| `thoughts` | TEXT | AI 思考链 |
| `attachments` | TEXT JSON | 附件数组 |
| `tool_steps` | TEXT JSON | 工具调用步骤数组 |
| `references` | TEXT JSON | 引用来源数组 |
| `status` | TEXT | completed / aborted / failed |
| `content_type` | TEXT | text / markdown / code |
| `model` | TEXT | AI 模型名 |
| `elapsed_ms` | INTEGER | AI 响应耗时 |
| `token_usage` | TEXT JSON | `{prompt_tokens, completion_tokens, total_tokens}` |
| `message_index` | INTEGER | **排序用此字段，而非 created_at** |
| `revision` | INTEGER | 乐观锁版本号 |

### 7.3 同步时机

| 场景 | 操作 |
|------|------|
| 打开 AI 助手 Tab | pull 最新会话列表 |
| 点击进入会话 | 如果是云端会话，pull 该会话消息 |
| 发送消息 | 本地保存 user message + push |
| AI 流式完成 | 保存完整 assistant message + push |
| 停止生成 | 保存已接收内容 (status=aborted) + push |
| 编辑会话标题/置顶 | push 更新 |
| 删除会话 | push 带 `_deleted: true`（级联删除消息） |
| 从后台返回 | pull 最新 |
| 下拉刷新 | full sync |

### 7.4 Push 数据格式

```json
POST /memora/sync/push
{
  "device_id": "mobile_ios_abc123",
  "request_id": "req_xxx",
  "changes": {
    "assistant_conversations": [
      {
        "id": "chat_1781062970000_a4f9d2",
        "_base_revision": 0,
        "title": "如何优化同步性能",
        "conversation_id": "4hqptq1drnb4672bgvpr8x85iv5mq0sk",
        "message_count": 4,
        "agent_mode": "agent",
        "is_pinned": 0,
        "archived": 0
      }
    ],
    "assistant_messages": [
      {
        "id": "msg_1781062970100_b3e8c1",
        "_base_revision": 0,
        "conversation_id": "chat_1781062970000_a4f9d2",
        "role": "user",
        "content": "Memora 同步怎么改成增量？",
        "message_index": 0,
        "status": "completed"
      },
      {
        "id": "msg_1781062976500_c7d2f4",
        "_base_revision": 0,
        "conversation_id": "chat_1781062970000_a4f9d2",
        "role": "assistant",
        "content": "可以基于 since 时间过滤...",
        "thoughts": "用户问的是同步优化...",
        "tool_steps": [{"name":"代码搜索","icon":"🔍","status":"completed","duration_ms":856}],
        "references": [{"type":2,"title":"v3 同步协议","url":"https://..."}],
        "content_type": "markdown",
        "model": "deepseek-v4-flash",
        "elapsed_ms": 6543,
        "token_usage": {"prompt_tokens":512,"completion_tokens":1024,"total_tokens":1536},
        "message_index": 1,
        "status": "completed"
      }
    ]
  }
}
```

### 7.5 Pull 响应格式

```json
POST /memora/sync/pull
{
  "device_id": "mobile_ios_abc123",
  "data_types": ["assistant_conversations", "assistant_messages"],
  "since_revision": 42
}

// 响应：
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

### 7.6 流式响应保存策略

**核心原则：流式中间态不入库，完成后一次性保存**

```
1. 用户发送消息 → 本地保存 user message (status=completed) → push 到云端
2. AI 开始流式响应 → 本地实时渲染（不保存到 DB，不入 streaming 状态）
3. AI 流式完成 → 本地保存完整 assistant message (status=completed) → push 到云端
4. 或使用 POST /sync/conversations/:id/messages 一次性保存
```

> ⚠️ 服务端**不接受** `status=streaming` 的消息

### 7.7 tool_steps 数据结构

```json
[
  {
    "name": "联网搜索",
    "icon": "🔍",
    "args": {"query": "Memora 同步设计"},
    "result": "找到 5 条结果",
    "result_full": "...",
    "status": "completed",
    "started_at": "2026-06-10T13:00:00.000Z",
    "duration_ms": 1234
  }
]
```

### 7.8 references 数据结构

```json
[
  {
    "type": 1,           // 1=问答, 2=文档, 4=联网
    "title": "Memora 官方文档",
    "url": "https://...",
    "snippet": "节选内容...",
    "score": 0.92
  }
]
```

### 7.9 attachments 数据结构

```json
[
  {
    "type": "image",     // image | document | audio | video | url
    "name": "screenshot.png",
    "url": "https://...",
    "size": 102400,
    "mime": "image/png",
    "ocr_text": "提取的文字（可选）",
    "thumbnail_url": "https://...",
    "duration_sec": 0
  }
]
```

> ⚠️ 附件**不存 base64**，必须先上传获取 URL

---

## 8. UI 设计规范

### 8.1 整体布局（Apple Design Language）

```
┌────────────────────────────────────────────────┐
│  ← AI 助手            [模式切换] [新建对话 +]    │  ← 导航栏
├────────────────────────────────────────────────┤
│  ┌──────────┐                                  │
│  │ 💬 会话1  │◄──── 左侧会话列表（可收起）        │
│  │ 💬 会话2  │                                  │
│  │ 💬 会话3* │◄──── * 当前活跃                   │
│  │          │                                  │
│  └──────────┘                                  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ 👤 你                                    │  │  ← 用户消息（右侧）
│  │    如何优化 React 性能？                  │  │
│  │                              14:30       │  │
│  ├──────────────────────────────────────────┤  │
│  │ 🤖 Memora                               │  │  ← AI 消息（左侧）
│  │    🤖 ADP 智能体                         │  │  ← agent badge
│  │                                          │  │
│  │    ▶ 已完成 3 个步骤                     │  │  ← 折叠的进度条
│  │                                          │  │
│  │    根据搜索结果，以下是优化建议...          │  │  ← 回复内容（Markdown）
│  │    1. 使用 React.memo...                 │  │
│  │    2. 虚拟列表...                        │  │
│  │                                          │  │
│  │    🌐 report.html ↗ 打开                 │  │  ← 文件卡片
│  │                                          │  │
│  │    ☁️ 云端配置                           │  │  ← 配置来源标识
│  │    📋 复制                              │  │  ← 操作按钮
│  │                     14:30 → 14:32        │  │  ← 耗时
│  └──────────────────────────────────────────┘  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ 📎  输入消息...              [⏹ 停止]     │  │  ← 输入区
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

### 8.2 颜色体系

| 用途 | 颜色 | 值 |
|------|------|-----|
| 主色 | Apple Blue | `#007AFF` |
| 用户消息背景 | 浅蓝 | `#E8F0FE` |
| AI 消息背景 | 白色 | `#FFFFFF` |
| 文本主色 | 深灰 | `#1D1D1F` |
| 文本次要 | 中灰 | `#86868B` |
| 文本第三级 | 浅灰 | `#AEAEB2` |
| 背景色 | 米白 | `#F5F5F7` |
| 成功 | 绿 | `#34C759` |
| 警告 | 橙 | `#FF9500` |
| 错误 | 红 | `#FF3B30` |

### 8.3 停止/发送按钮切换

| 状态 | 发送按钮 | 停止按钮 |
|------|---------|---------|
| 空闲 | ✅ 可见 | ❌ 隐藏 |
| 流式中 | ❌ 隐藏 | ✅ 可见（红色脉冲动画） |
| 停止后 | ✅ 可见 | ❌ 隐藏 |

### 8.4 空状态设计

新会话初始状态显示：
- 欢迎语："你好！我是你的 AI 助手。有什么我可以帮助你的吗？"
- 功能卡片（横向滚动）：💡 智能问答、📊 数据分析、📝 报告生成、🔍 知识检索
- 快捷问题按钮：预设 3-4 个常见问题

### 8.5 会话列表设计

- 按更新时间倒序排列
- 每项显示：💬 图标 + 标题（截断 30 字）
- 活跃会话高亮
- 左滑删除（移动端手势）
- 下拉刷新

---

## 9. Markdown 渲染规范

### 9.1 支持的 Markdown 元素

| 元素 | 渲染方式 |
|------|---------|
| `**粗体**` | `<strong>` |
| `*斜体*` | `<em>` |
| `` `代码` `` | `<code>` |
| ` ```代码块``` ` | `<pre><code>` |
| `[链接](url)` | `<a>` 可点击跳转 |
| 裸链接 `https://...` | `<a>` 显示截断 URL |
| 换行 `\n` | `<br>` |
| 段落 `\n\n` | `</p><p>` |

### 9.2 特殊内容渲染

| 内容类型 | 检测方式 | 渲染方式 |
|---------|---------|---------|
| **思考过程** | `<think/>` 标签 或 `thought` 事件 | 可折叠区域，默认折叠，显示前 80 字预览 |
| **文件卡片** | `{"files": [...]}` JSON | 图标 + 文件名 + 下载/打开按钮 |
| **Markdown 链接指向 .html** | 链接 URL 以 `.html` 结尾 | 渲染为文件卡片而非链接 |
| **ADP JSON 泄漏** | `{"content":[{"type":"text"...}]}` | 过滤，不显示 |

### 9.3 思考过程渲染

```
┌────────────────────────────────────────┐
│ 💭 思考过程                    ▶       │  ← 可折叠标题
│ 根据用户的提问，我需要先搜索...          │  ← 前 80 字预览
│────────────────────────────────────────│  ← 展开后
│ 根据用户的提问，我需要先搜索相关的技术   │
│ 文档。React 性能优化主要涉及几个方面：  │
│ 1. 组件渲染优化...                     │
│ 2. 状态管理优化...                     │
└────────────────────────────────────────┘
```

---

## 10. 附件/文件上传

### 10.1 上传流程（三级降级）

```
方案 A: ADP COS 上传（官方规范）
  │ 需要 adp_tc_secret_id + adp_tc_secret_key + adp_bot_biz_id
  │ 1. 获取临时凭证
  │ 2. 上传到 COS
  │ 3. （文件类型）调用 docParse 获取 DocId
  │ 4. 将 URL/DocId 放入 Contents 数组
  ▼
方案 B: File Share 服务上传（降级）
  │ 需要 file_share_api_key
  │ 1. 上传到 File Share API
  │ 2. 获取 download_url
  │ 3. 将 URL 放入 Contents 数组
  ▼
方案 C: base64 内联（最后降级）
  │ 仅图片可用
  │ 1. 将 base64 编码的图片放入 Image.Url
  │ 2. 格式：data:image/png;base64,xxxx
  ▼
方案 D: 文本嵌入（全部失败）
  │ 将文件名和可选文本内容嵌入消息
  │ Contents.push({Type:'text', Text:'[文件: xxx.pdf] 内容...'})
```

### 10.2 移动端建议

移动端推荐使用**自建后端代理**方案：
1. 移动端将文件上传到 Config Server 的文件上传接口
2. 后端代理完成 ADP COS 上传/DocId 获取
3. 返回 URL 给移动端
4. 移动端将 URL 放入 Contents 数组

这样可以避免在移动端暴露 COS 凭证。

---

## 11. 关键陷阱与踩坑记录

### 11.1 SSE 流解析陷阱

| 陷阱 | 解决方案 |
|------|---------|
| **跨 chunk 事件**：一个 SSE 事件可能被拆到两个 TCP chunk | 行缓冲拼接：`buffer += chunk; lines = buffer.split('\n'); buffer = lines.pop()` |
| **`text.delta` 中混入 JSON**：ADP 偶尔在文本流中夹杂 `{"content":[{"type":"text"...}]}` | 正则过滤：`/^\{"content":\[/i` 检测后跳过 |
| **Node.js 默认超时 72s**：长工具调用会断连 | 设置 `keepAliveTimeout: 300000, requestTimeout: 0` |
| **心跳注释行**：SSE 流中以 `:` 开头的行 | 解析时跳过 `trimmed.startsWith(':')` |
| **`data:` 多行拼接**：一个事件可能有多个 `data:` 行 | 累加 `currentData += ...`，空行时重置 |

### 11.2 ConversationId 陷阱

| 陷阱 | 解决方案 |
|------|---------|
| **切换会话后 convId 串台** | 切换会话时必须立即设置目标会话的 ConversationId，发消息前再次确认 |
| **新会话未清空旧 convId** | 新建会话后必须清空主进程的 ConversationId |
| **云端会话无 convId** | 使用 pull 获取的 `conversation_id` 字段，如果为空则首次发消息时生成 |

### 11.3 进度条陷阱

| 陷阱 | 解决方案 |
|------|---------|
| **重复 ID 元素**：旧对话 DOM 残留同 ID 进度指示器 | 创建前先清除旧元素 |
| **折叠时机错误**：在 `startReply` 前不应折叠 | 只在 `message.added(type=reply)` 或 `text.delta` 首次到达时折叠 |
| **步骤计数不准** | 折叠时用实际 DOM 步骤数而非变量 |

### 11.4 消息同步陷阱

| 陷阱 | 解决方案 |
|------|---------|
| **推送 streaming 状态** | 服务端拒绝 status=streaming，只推送 completed/aborted/failed |
| **消息排序用 created_at** | 必须用 `message_index` 排序，不同设备时钟不一致 |
| **删除会话不级联** | 删除会话必须同时删除所有消息（服务端自动级联） |
| **content 超过 100KB** | 服务端拒绝，客户端需截断后重传 |
| **origin_device_id 防回声** | pull 时跳过自己 push 的数据 |

---

## 12. 完整交互流程图

### 12.1 发送消息流程

```
用户输入消息 + 点击发送
        │
        ▼
┌───────────────────────┐
│ 1. 创建 user message  │
│    本地保存            │
│    渲染用户气泡        │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ 2. 创建 assistant 占位 │
│    显示"智能分析中..." │
│    替换为进度指示器     │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ 3. 构建 ADP 请求体     │
│    - ConversationId   │
│    - AppKey           │
│    - Contents         │
│    - Stream=enable    │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ 4. POST 到 ADP V2     │
│    启动计时器          │
│    显示停止按钮        │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────────────────────┐
│ 5. SSE 事件循环                       │
│   ┌─────────────────────────────────┐│
│   │ request_ack     → 步骤 "已发送" ││
│   │ response.created→ 步骤 "已接收" ││
│   │ message.added   → 工具步骤/回复 ││
│   │ message.done    → 步骤完成+结果 ││
│   │ text.delta      → 追加文本      ││
│   │ thought         → 追加思考链    ││
│   │ error           → 显示错误      ││
│   └─────────────────────────────────┘│
└──────────┬────────────────────────────┘
           │
           ▼
┌───────────────────────┐
│ 6. 流结束 (done)       │
│    - 停止计时器        │
│    - 最终渲染 Markdown │
│    - 绑定文件卡片点击  │
│    - 绑定思考过程展开  │
│    - 显示配置来源标识  │
│    - 显示复制按钮      │
│    - 显示耗时          │
│    - 隐藏停止按钮      │
│    - 显示发送按钮      │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ 7. 保存消息到云端      │
│    - user message     │
│    - assistant message│
│    - status=completed │
│    - tool_steps       │
│    - references       │
│    - token_usage      │
│    Push 到云端        │
└───────────────────────┘
```

### 12.2 停止生成流程

```
用户点击"停止"按钮
        │
        ▼
┌───────────────────────┐
│ 1. 中断 SSE 连接      │
│    abort HTTP 请求    │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ 2. 保存已接收内容      │
│    status = 'aborted' │
│    保存到本地 + 推送   │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ 3. 清理 UI 状态       │
│    隐藏停止按钮        │
│    显示发送按钮        │
│    聚焦输入框          │
└───────────────────────┘
```

### 12.3 会话切换流程

```
用户点击另一个会话
        │
        ▼
┌───────────────────────┐
│ 1. 如果正在流式，停止  │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ 2. 保存当前会话消息    │
│    到本地存储          │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ 3. 切换 activeSession │
│    更新 updatedAt      │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────────────┐
│ 4. 加载目标会话消息            │
│   ├─ 本地有 → 从本地恢复       │
│   └─ 云端会话 → API 加载消息   │
│       GET /conversations/:id   │
│           /messages             │
└──────────┬────────────────────┘
           │
           ▼
┌───────────────────────┐
│ 5. 设置 ADP convId    │
│    恢复上下文连贯      │
└───────────────────────┘
```

---

## 附录 A: AppKey 获取方式

AppKey 通过 Config Server 的组织配置下发，获取优先级：

```
1. 云端配置（登录后从 Config Server 拉取）
   → remoteConfig.adp.app_key

2. 本地设置（用户手动配置）
   → localStorage adp_app_key

3. 内置默认值
   → DEFAULT_ADP_APP_KEY（硬编码在应用中）
```

移动端登录后从 Config Server 获取配置：

```
POST /auth/login → JWT Token
GET  /memora/config → { adp: { app_key, url }, ... }
```

---

## 附录 B: 服务端地址

| 环境 | 地址 |
|------|------|
| Config Server | `http://121.5.164.126:3450` |
| ADPToolkit (认证) | `http://121.5.164.126:3010` |
| ADP V2 API | `https://wss.lke.cloud.tencent.com/adp/v2/chat` |

---

## 附录 C: Flutter 推荐依赖

| 包名 | 用途 |
|------|------|
| `flutter_markdown` | Markdown 渲染 |
| `http` | HTTP 请求 + SSE 流读取 |
| `shared_preferences` | 本地键值存储 |
| `sqflite` | 本地 SQLite 数据库 |
| `provider` / `riverpod` | 状态管理 |
| `dio` | HTTP 客户端（可选，替代 http） |

---

## 附录 D: 完整 SSE 事件参考

```json
// request_ack
{"RequestId":"xxx","ConversationId":"yyy"}

// response.created
{"Response":{"Id":"resp_xxx","Status":"processing"}}

// message.added (工具调用)
{"MessageId":"msg_xxx","Message":{"Type":"tool_call","ExtraInfo":{"ToolName":"search"}}}

// message.added (AI 回复)
{"MessageId":"msg_xxx","Message":{"Type":"reply","Name":"reply"}}

// message.processing
{"MessageId":"msg_xxx","Message":{"Type":"tool_call","Contents":[{"Text":"执行中..."}]}}

// message.done (工具完成)
{"MessageId":"msg_xxx","Message":{"Type":"tool_call","Contents":[{"Text":"结果内容"}],"ExtraInfo":{"ToolName":"search"}}}

// text.delta
{"Text":"增量文本","MessageId":"msg_xxx"}

// text.replace
{"Text":"替换全文","MessageId":"msg_xxx"}

// response.completed
{"Response":{"Id":"resp_xxx","Status":"completed","StatInfo":{"InputTokens":512,"OutputTokens":1024}}}

// thought (思考链)
{"Text":"思考内容"} 或 {"Content":"思考内容"}

// error
{"Error":{"Code":"460011","Message":"模型 QPM 超限"}}

// 流结束
data: [DONE]
```
