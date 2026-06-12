# ADP 文档/文件提交说明

> 适用于 Memora 的 ADP 智能体对话文件上传功能

---

## 1. 完整流程

用户在 AI 助手中发送消息时附带文件（图片/PDF/Word/Excel 等），文件会通过以下流程上传到 ADP：

```
用户选择文件 → 前端读取 Buffer → IPC 传到主进程 → 上传到 COS → (可选)docParse → V2 Chat 请求
```

### 1.1 流程图

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌───────────────┐
│ 用户选择文件  │────▶│ 前端读取Buffer │────▶│ 主进程上传到COS   │────▶│ docParse解析   │
│ (app.js)     │     │ (preload.js)  │     │ (main.js)        │     │ (main.js)     │
└─────────────┘     └──────────────┘     └──────────────────┘     └───────┬───────┘
                                                                          │
                                                    ┌─────────────────────▼──────────────────┐
                                                    │ ADP V2 Chat 请求（含 FileInfo）          │
                                                    │ POST https://wss.lke.cloud.tencent.com │
                                                    │ /adp/v2/chat                           │
                                                    └────────────────────────────────────────┘
```

---

## 2. 上传方式

### 方案 A：COS 直传（优先，推荐）

**前提条件**：Config Server 的 `tencent_cloud` 配置中包含 `secret_id` 和 `secret_key`

**流程**：
1. **DescribeStorageCredential** — 调用腾讯云 API 获取临时上传凭证
2. **PUT 到 COS** — 使用 UploadUrl 或临时密钥直接上传文件到 COS
3. **docParse**（可选）— 文档类文件调用 docParse 获取 DocId
4. **V2 Chat** — 在 Contents 中传入 File 对象

#### 2.1 DescribeStorageCredential

```javascript
// 腾讯云 API 3.0 鉴权（TC3-HMAC-SHA256）
const body = JSON.stringify({
  FileType: 'pdf',          // 文件后缀
  BotBizId: botBizId,       // 应用业务ID
  IsPublic: false,          // 图片=true，文件=false
  TypeKey: 'realtime'       // 实时文档类型
});

// POST https://lke.tencentcloudapi.com
// Headers: X-TC-Action: DescribeStorageCredential
// 返回：Credentials(临时密钥) + UploadPath + Bucket + Region + Type
```

#### 2.2 上传到 COS

```javascript
// 方式A：使用预签名 UploadUrl（推荐）
const uploadRes = await fetch(cred.UploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/octet-stream' },
  body: fileBuffer
});

// 方式B：使用临时密钥 + COS SDK
// 需要：Credentials.TmpSecretId, TmpSecretKey, SessionToken
// 拼接 URL：https://{Bucket}.{Type}.{Region}.myqcloud.com{UploadPath}
```

#### 2.3 docParse（文档解析）

```javascript
// 仅文档类文件（pdf/doc/docx/xlsx等）需要
// 关键：docParse 的 session_id 必须和后续 chat 请求的 ConversationId 一致！

POST https://wss.lke.cloud.tencent.com/v1/qbot/chat/docParse
Body: {
  bot_app_key: appKey,
  file_name: "文档名.pdf",
  file_url: "https://bucket.cos.region.myqcloud.com/path",
  file_type: "pdf",
  request_id: "xxx",
  session_id: conversationId  // ⚠️ 必须与 Chat 的 ConversationId 一致
}

// SSE 流式返回，提取 payload.doc_id
// 状态：PROCESSING → COMPLETED(成功) / FAILED(失败)
```

#### 2.4 V2 Chat 请求

```javascript
// 图片
contents.push({
  Type: 'image',
  Image: { Url: imageUrl }
});

// 文件
contents.push({
  Type: 'file',
  File: {
    FileName: '文档.pdf',
    FileSize: '12345',
    FileUrl: 'https://bucket.cos.region.myqcloud.com/path',
    FileType: 'pdf',
    DocId: docId,       // 标准模式必填（docParse 返回）
    DocBizId: docId     // Python SDK 用这个字段，双字段保险
  }
});
```

### 方案 B：File Share 服务（降级方案）

**前提条件**：ADPToolkit 的 File Share API 已配置

当 COS 上传失败时（缺少腾讯云密钥等），自动降级到 File Share 服务：

```javascript
// POST {toolkitUrl}/api/file-share/upload
// FormData: file=文件Buffer
// Header: X-API-Key: file_share_api_key

// 返回：{ url: "https://..." }
// 文件 URL 可直接用于 ADP V2 Chat
```

---

## 3. 文件类型与处理规则

| 文件类型 | 后缀 | is_public | 需要 docParse | Content Type |
|----------|------|-----------|---------------|-------------|
| 图片 | jpg, jpeg, png, bmp, webp | ✅ true | ❌ | `image` |
| PDF | pdf | ❌ false | ✅ | `file` |
| Word | doc, docx | ❌ false | ✅ | `file` |
| Excel | xls, xlsx | ❌ false | ✅ | `file` |
| PPT | ppt, pptx | ❌ false | ✅ | `file` |
| 文本 | txt, md, csv | ❌ false | ⬜ 可选 | `file` |

### 文件大小限制

- **单文件**：最大 100MB
- **多文件**：单个 ≤ 20MB，最多 5 个

---

## 4. 凭证来源

| 凭证 | 来源 | 获取方式 |
|------|------|---------|
| AppKey | Config Server `/memora/config` | `remoteConfig.adp.app_key` |
| BotBizId | Config Server `tencent_cloud.bot_biz_id` | `remoteConfig.tencent_cloud.bot_biz_id` |
| SecretId | Config Server `tencent_cloud.secret_id` | `remoteConfig.tencent_cloud.secret_id` |
| SecretKey | Config Server `tencent_cloud.secret_key` | `remoteConfig.tencent_cloud.secret_key` |
| File Share Key | Config Server `file_share.api_key` | `remoteConfig.file_share.api_key` |

---

## 5. 关键注意事项

### 5.1 DocId 双字段

```javascript
// 官方文档（标准模式）要求 DocId
// Python SDK 使用 DocBizId
// 实测：同时传两个字段最稳定
if (docId) {
  fileInfo.DocId = docId;
  fileInfo.DocBizId = docId;
}
```

### 5.2 docParse 的 session_id

```javascript
// ⚠️ docParse 的 session_id 必须与后续 V2 Chat 的 ConversationId 一致
// 否则 ADP 无法关联文档与对话
const sessionId = conversationId;
```

### 5.3 COS URL 拼接

```javascript
// IsPublic=false 时 DescribeStorageCredential 不返回公网 FileUrl
// 需要自己拼接：
const fileUrl = `https://${bucket}.${type || 'cos'}.${region}.myqcloud.com${uploadPath}`;
```

### 5.3.1 ⚠️⚠️ docParse 的 cos_url 必须用 UploadPath（仅路径！）

> **重要更正（2026-06-12）**：之前本节写"cos_url 必须用完整 URL"是**错误的**！
> 对照官方 Python SDK（`docs/pythonsdk/chat_with_file_or_img_python/main.py:307`）确认：

```javascript
// 官方 Python SDK main.py:307
//   "cos_url": credentials['UploadPath']   ← docParse 用的是 UploadPath（仅路径）！

// ✅ 正确：docParse 的 cos_url 用 UploadPath（仅路径）
cos_url: cosResult.uploadPath   // 如：/0ddf388a-f8bd-87bc-537f-xxx.docx

// ❌ 错误：传完整 URL → docParse 报 Invalid-URL / COS AccessDenied
cos_url: cosResult.fileUrl      // 如：https://bucket.cos.ap-guangzhou.myqcloud.com/xxx.docx
```

**关键区别**：
- `docParse` 的 `cos_url` → 用 **`UploadPath`（仅路径）**
- V2 Chat 的 `File.FileUrl` → 用 **完整 URL（`cos_final_url`）**
- 两者语义不同，**绝不能混用**！

### 5.3.2 ⚠️ 文档严禁用 isPublic=true 重传（AccessDenied 根因！）

> **重要更正（2026-06-12）**：之前的"docParse 失败 → isPublic=true 重新上传"降级策略是**错误根源**！

```javascript
// ❌ 错误降级（已移除）：把文档用 isPublic=true 传到 /public/ 路径
// 导致文档落到 /public/{...}/image/xxx.md 路径，与 docParse 要求的私有路径冲突
// → 触发 COS AccessDenied（错误 Resource 路径就是 /public/.../image/xxx.md）

// ✅ 正确：文档严格走标准 docParse 流程（is_public=false 私有路径）
// - docParse 成功 → 带 DocId（标准模式）
// - docParse 失败 → 仅带 File.FileUrl 发送（claw 模式可接受，不强制 DocId）
// - 不做任何 isPublic=true 重传
```

### 5.3.3 ✅ 纯文本文件优先直接注入内容（最稳妥）

```javascript
// 对于 txt/md/csv/json 等纯文本（≤50000 字符），直接把内容拼进对话 Contents：
// 完全绕过 COS 上传 + docParse，根治此类文件的权限问题
if (isPlainText && att.textContent && att.textContent.length <= 50000) {
  contents.push({
    Type: 'text',
    Text: `【附件文件：${att.name}】\n\`\`\`\n${att.textContent}\n\`\`\``
  });
  continue; // 无需 COS 上传
}
```

### 5.3.4 图片公网直传仅限 jpg/jpeg/png/bmp

```javascript
// 官方 SDK：is_public = ext in ["jpg","jpeg","png","bmp"]
// gif/webp/heic 会被当私有文件传到 /private/，用 Type:'image' 发送会失败
// → 这些格式应按普通文件处理（Type:'file'）
const IMAGE_PUBLIC_EXTS = ['png', 'jpg', 'jpeg', 'bmp'];
```

### 5.4 文件 Buffer 传输

```javascript
// 前端通过 IPC 传 Buffer 到主进程
// IPC 传输后 Buffer 可能变成普通数组，需要转换：
if (Array.isArray(att.buffer)) {
  fileBuffer = Buffer.from(att.buffer);
} else if (att.buffer instanceof ArrayBuffer) {
  fileBuffer = Buffer.from(att.buffer);
}
```

### 5.5 VisitorId 字段名

```javascript
// V2 接口使用 VisitorId（不是 VisitorBizId）
// Python SDK 的 VisitorBizId 是 SDK 自行封装
const requestBody = {
  VisitorId: getDeviceFingerprint(),
  // ...
};
```

---

## 6. 代码位置

| 模块 | 文件 | 函数 | 行号 |
|------|------|------|------|
| 凭证获取 | main.js | `getADPUploadCredential()` | ~2933 |
| COS 上传 | main.js | `uploadFileToADPCOS()` | ~2989 |
| 文档解析 | main.js | `parseADPDocument()` | ~3071 |
| TC3 签名 | main.js | `signTC3()` | ~2896 |
| 文件选择 | app.js | `handleChatFileSelect()` | ~3290 |
| 发送消息 | app.js | `sendChatMessage()` | ~1900 |
| SSE 事件 | app.js | `_handleADPSSEEvent()` | ~2607 |
| 工具图标 | app.js | `_getADPToolIcon()` | ~3266 |
| 工具标签 | app.js | `_getADPToolLabel()` | ~3279 |

---

## 7. 调试技巧

### 7.1 查看上传日志

主进程日志（Console）中搜索 `[ADP Upload]` 和 `[ADP Chat]`：
- `[ADP Upload] Getting upload credential` — 凭证获取
- `[ADP Upload] Got credential` — 凭证获取成功
- `[ADP Upload] Uploading file via UploadUrl` — COS 上传
- `[ADP Upload] Got DocBizId` — docParse 成功
- `[ADP Chat] File info for ADP` — 发送给 ADP 的文件信息

### 7.2 查看请求体

主进程会打印完整的 ADP V2 Chat 请求体（AppKey 脱敏、FileUrl 截断）：
```
[ADP Chat] Request body: {"ConversationId":"xxx","AppKey":"***kEy***","Contents":[...]}
```

### 7.3 前端 SSE 事件

在 DevTools Console 中监听：
```javascript
// 查看所有 SSE 事件
window.__adpEvents = [];
const origOnEvent = window.electronAPI.onADPSSEEvent;
window.electronAPI.onADPSSEEvent((evt) => {
  window.__adpEvents.push(evt);
  console.log('[ADP Event]', evt.event, evt.data?.Type || '', evt.data?.Message?.Type || '');
});
```
