# ADP Claw 模式文件对话实现报告

> 日期：2026-06-12  
> 项目：Memora (Electron PC端)  
> 模块：ADP Chat 文件/图片上传与对话

---

## 1. 问题背景

Memora 的 AI 助手通过 ADP V2 Chat SSE 接口与智能体通信。用户可在对话中上传文件（Word/Excel/PDF/图片等），系统将文件传给 ADP 智能体进行分析。

**初始问题**：上传 MD/TXT 纯文本文件可以正常工作，但上传 Word(.docx)、Excel(.xlsx)、图片(.png/.jpg) 后 ADP 无法读取文件内容，回复"请提供输入材料"。

---

## 2. 根因分析

### 2.1 根本原因：Claw 模式与标准模式的文件传递方式完全不同

| 对比项 | 标准模式 | **Claw 模式（我们使用的）** |
|--------|---------|---------------------------|
| 文件传递 | `Type: "file"` + `FileInfo.DocId` | **Markdown 链接 `[文件名](URL)` 嵌入 `Type: "text"`** |
| 图片传递 | `Type: "image"` + `Image.Url` | **Markdown `![](URL)` 嵌入 `Type: "text"`** |
| docParse | ✅ 必需（获取 DocId） | ❌ **不需要** |
| DocId | 标准模式必填字段 | ❌ **不使用** |
| 文件 URL | COS 路径 | **COS 预签名 URL（IsPublic=true 时）** |
| 等待时间 | docParse 后需等待解析 | **无等待** |

### 2.2 之前的错误做法

代码使用了**标准模式**的方式给 Claw 模式传文件：
1. COS 上传 → docParse 获取 DocId → `Type: "file"` + `File.DocId` 发送
2. 图片用 `Type: "image"` + `Image.Url`

但 Claw 模式**根本不支持 `Type: "file"` 和 `Type: "image"`** 来传递附件，ADP 收到这些字段后直接忽略，导致智能体"看不到"任何文件。

### 2.3 为什么 MD/TXT 之前能工作

MD/TXT 走了"纯文本直接注入"路径（方案 0），绕过了 COS 上传 + docParse 流程：
```
Contents: [{ Type: "text", Text: "【附件文件：xxx.md】\n```内容```\n" }]
```
这条路径恰好是 Claw 模式的正确用法——**纯文本嵌入 `Type: "text"`**。

### 2.4 官方文档依据

- V2 Chat 接口文档：https://cloud.tencent.com/document/product/1759/129202
- 实时文档对话文档：https://cloud.tencent.com/document/product/1759/107908
- Claw 模式文件对话示例：`Contents: [{ Type: "text", Text: "[致橡树.txt](https://...cos.../致橡树.txt)请阅读上传的文档" }]`
- Claw 模式图片对话示例：`Contents: [{ Type: "text", Text: "![](图片URL)描述图片内容" }]`

---

## 3. 修复方案

### 3.1 三级文件上传降级策略（保持不变）

| 优先级 | 方案 | 说明 | 文件传递方式 |
|--------|------|------|-------------|
| 方案 0 | 纯文本直接注入 | txt/md/csv ≤ 50000 字符 | `Type: "text"` + 文本内容 |
| 方案 A | ADP COS 上传 | 官方规范流程 | **Markdown 链接** 嵌入 `Type: "text"` |
| 方案 B | File Share 服务 | COS 未配置时的降级 | **Markdown 链接** 嵌入 `Type: "text"` |
| 方案 C | 图片 base64 内联 | 最终降级（仅图片） | `Type: "image"` + data URI |

### 3.2 关键改动：Claw 模式统一使用 Markdown 链接

#### 方案 A（COS 上传成功后）

**图片**（png/jpg/jpeg/bmp）：
```javascript
contents.push({
  Type: 'text',
  Text: `![](${fileUrl})`
});
```

**文档**（docx/xlsx/pdf 等）：
```javascript
contents.push({
  Type: 'text',
  Text: `[${att.name}](${fileUrl})\n\n请阅读以上文档链接中的内容并据此回答。`
});
```

#### 方案 B（File Share 降级）

与方案 A 相同的 Markdown 链接方式。

#### 方案 C（base64 内联 — 最终降级）

图片仍保留 `Type: "image"` + `data:` URI（这是所有上传方式都失败时的最后手段）。

### 3.3 移除的代码

| 移除项 | 原因 |
|--------|------|
| `docParse` 调用（3次重试） | Claw 模式不需要 DocId |
| `Type: "file"` + `File.DocId/DocBizId` | Claw 模式不支持 |
| `Type: "image"` + `Image.Url`（COS 路径） | Claw 模式不支持 |
| docParse 后 10 秒等待 | 无需等待解析 |
| 解析进度提示 | 无 docParse 步骤 |

### 3.4 保留的代码

| 保留项 | 原因 |
|--------|------|
| `parseADPDocument` 函数定义 | 未来标准模式应用可能需要 |
| 方案 C base64 内联 `Type: "image"` | 所有上传失败时的最后降级 |
| `uploadFileToADPCOS` 函数 | COS 上传本身没问题，只是后续传递方式变了 |
| `getADPUploadCredential` 函数 | 获取 COS 凭证仍然需要 |

---

## 4. 完整文件上传流程（修复后）

```
用户选择文件
    │
    ├─ 是纯文本(txt/md/csv)且 ≤ 50000 字符？
    │   └─ ✅ 方案 0：直接注入 Type:text（绕过 COS）
    │
    ├─ 有 ADP COS 凭证(SecretId/SecretKey/BotBizId)？
    │   ├─ YES → 获取凭证(DescribeStorageCredential) → PUT COS
    │   │         ├─ 图片 → Type:text + `![](fileUrl)`
    │   │         └─ 文档 → Type:text + `[文件名](fileUrl)`
    │   └─ NO ↓
    │
    ├─ 有 File Share 服务？
    │   ├─ YES → 上传到 File Share → 获取 download_url
    │   │         ├─ 图片 → Type:text + `![](download_url)`
    │   │         └─ 文档 → Type:text + `[文件名](download_url)`
    │   └─ NO ↓
    │
    ├─ 图片有 base64？
    │   └─ Type:image + data URI（最终降级）
    │
    └─ 所有方式失败 → Type:text + 提示文本
```

---

## 5. COS 上传细节

### 5.1 获取上传凭证

```javascript
POST https://wss.lke.cloud.tencent.com/v1/qbot/describe-storage-credential
Body: {
  BotBizId: botBizId,
  FileType: fileType,        // 文件后缀（docx/xlsx/png 等）
  IsPublic: isImage,         // 图片=true，文档=false
  TypeKey: 'realtime'        // 实时文档上传
}
```

### 5.2 上传到 COS

两种方式（按凭证返回自动选择）：
- **方式 A**：直接 PUT `UploadUrl`（预签名 URL）— 更简单
- **方式 B**：临时密钥 + COS SDK `putObject` — 更可靠

### 5.3 文件 URL 拼接

```javascript
const fileUrl = cosResult.fileUrl || 
  `https://${bucket}.cos.${region}.myqcloud.com${uploadPath}`;
```

**关键**：图片 `IsPublic=true` 时，COS 返回的 `FileUrl` 是公网可访问的 URL；文档 `IsPublic=false` 时，URL 需要鉴权访问，但 ADP 后台有权限读取。

---

## 6. 诊断日志

修复后的日志格式：

```
[ADP Chat] 📊 Contents summary (Claw mode): 0 files, 0 images, 3 texts (incl. 1 md-links, 1 md-images)
[ADP Chat] 🖼 Markdown Image: ![](https://lke-realtime-1251316161.cos.ap-guangzhou.myqcloud.com/public/...
[ADP Chat] 📎 Markdown Link: [招标文件.docx](https://lke-realtime-1251316161.cos.ap-guangzhou.myqcloud.com/...
```

---

## 7. 注意事项与待优化项

### 7.1 已知限制

1. **图片格式限制**：仅 png/jpg/jpeg/bmp 支持 `IsPublic=true` 公网上传，gif/webp/heic 会被当私有文件处理
2. **私有文档 URL**：非图片文件 `IsPublic=false`，COS URL 需要鉴权，ADP 后台需有权限访问
3. **方案 C 降级**：base64 内联仍用 `Type: "image"`，在 Claw 模式下可能不被识别

### 7.2 待优化

1. **双模式支持**：当前硬编码为 Claw 模式（Markdown 链接），应支持标准模式（docParse + Type:file）
2. **应用模式自动检测**：通过 config-server 返回的配置判断当前应用是 Claw 还是标准模式
3. **Widget 渲染**：V2 接口支持 `Type: "widget"` 返回交互组件，需集成 ADP-Widget SDK（Web Components 标准）
4. **Widget 交互回传**：`Type: "widget_action"` 回传用户操作（WidgetId/WidgetRunId/ActionType/Payload）

---

## 8. V2 Chat 接口关键参数速查

| 参数 | 类型 | 说明 |
|------|------|------|
| `AppKey` | String (Body) | 应用密钥，**必须放在 Body 中** |
| `ConversationId` | String | 会话 ID（32-64 字符，UUID 格式） |
| `Contents` | Array | 消息内容列表 |
| `Contents[].Type` | String | `"text"` / `"image"` / `"file"` / `"widget"` / `"widget_action"` |
| `Contents[].Image.Url` | String | 图片 URL（需公网可访问或 ADP COS 链接） |
| `Contents[].File.DocId` | String | **标准模式**必填，docParse 返回的 doc_id |
| `Incremental` | Boolean | true=增量文本(text.delta)，false=替换(text.replace) |
| `Stream` | String | `"enable"` 开启流式 |
| `StreamingThrottle` | Number | 流式频率控制，默认 5（字符/次） |
| `EnableMultiIntent` | Boolean | 开启多意图 |

### Claw 模式 Contents 正确写法

```json
{
  "Contents": [
    { "Type": "text", "Text": "[招标文件.docx](https://lke-realtime-xxx.cos.ap-guangzhou.myqcloud.com/corp/.../xxx.docx)\n\n请阅读以上文档链接中的内容并据此回答。" },
    { "Type": "text", "Text": "![](https://lke-realtime-xxx.cos.ap-guangzhou.myqcloud.com/public/.../image.png)" },
    { "Type": "text", "Text": "请帮我分析这份招标文件" }
  ]
}
```

---

## 9. 相关文档链接

- [V2 Chat 接口文档（HTTP SSE）](https://cloud.tencent.com/document/product/1759/129202)
- [图片对话或文件对话（实时文档解析+对话）](https://cloud.tencent.com/document/product/1759/107908)
- [离线文档上传](https://cloud.tencent.com/document/product/1759/108903)
- [ADP 文档解析协议](https://cloud.tencent.com/document/product/1759/127284)
- [ADP Widget SDK](https://cloud.tencent.com/document/product/1759/129230)
- [Golang 调用示例](https://qidian-qbot-1251316161.cos.ap-guangzhou.myqcloud.com/public/chat/chat_with_file_or_img_golang_20260316.zip)
- [Python 调用示例](https://qidian-qbot-1251316161.cos.ap-guangzhou.myqcloud.com/public/chat/chat_with_file_or_img_python_20260316.zip)
