# Memora 项目长期记忆

## 图片同步关键原则（2026-06-12 更新）
- 笔记 `imagePath` **始终指向本地文件**（`images/xxx.png`），服务端路径仅在同步 payload 中使用
- Node.js `fetch`（undici）与 `form-data` npm 包的 stream body 不兼容 → multipart/form-data 上传必须用 http 模块 + form.pipe(req)
- "上传失败就不推送元数据"是错误策略 → 应始终推送元数据，图片文件单独重试
- **服务器端 multipart API 必须带 `device_id`**：`requireActiveDevice` 中间件检查 `req.body.device_id`，缺失返回 400。所有 FormData 上传必须 `form.append('device_id', getDeviceFingerprint())`
- **推送笔记时 `imagePath` 不能用本地路径兜底**：上传失败用空字符串（`serverImagePath || ''`），本地格式路径（如 `images/xxx.png`）到服务器端无法解析，导致图片 404
- **本地 workspace 的 `config-server/` 与服务器部署代码可能不同步**：排查服务器问题必须检查实际部署代码（`/root/memora-modular/`），不能只看本地代码
- **Electron 修改 main.js 后必须重启应用**才能生效，否则运行的是旧代码

## ADP 文件上传 COS AccessDenied 根因（2026-06-12 关键）
对照官方 Python SDK（docs/pythonsdk/chat_with_file_or_img_python/main.py）得出的铁律：
- **docParse 的 `cos_url` 用 `UploadPath`（仅路径，如 `/xxx.md`），不是完整 URL！** 官方 SDK main.py:307 `"cos_url": credentials['UploadPath']`。之前误传完整 URL 导致 docParse 报 Invalid-URL / COS AccessDenied
- **V2 Chat 的 `File.FileUrl` 才用完整 URL**（`cos_final_url` = `https://{Bucket}.{Type}.{Region}.myqcloud.com{UploadPath}`）。两者语义不同，绝不能混用
- **图片公网直传（is_public=true）只支持 jpg/jpeg/png/bmp**（官方 SDK `is_public = ext in ["jpg","jpeg","png","bmp"]`）。gif/webp/heic 会被当私有文件传到 /private/，用 Type:'image' 发送会因 ADP 无法访问私有 URL 失败 → 这些格式按普通文件处理
- **文档严禁用 is_public=true 重传降级**：之前"docParse 失败→is_public=true 重新上传到 /public/"逻辑是错误根源，文档被传到 `/public/.../image/xxx.md` 与 docParse 要求的私有路径冲突，触发 AccessDenied（错误 Resource 路径就是这个）。文档应只走标准 docParse（is_public=false 私有路径）
- **纯文本文件（txt/md/csv/json 等 ≤50000 字符）直接注入文本内容**到对话 Contents（Type:'text'），完全绕过 COS 上传，是 claw 模式最稳妥方式。前端已读取 att.textContent
- claw 模式不强制 DocId，docParse 失败也可仅带 File.FileUrl 发送（但 claw 应用拿不到 DocId 就读不懂文件内容，必须拿到 DocId 才能解析）
- **DocId 是 ADP V2 文件对话的命脉**（2026-06-12 实测 4 模式验证）：只传 DocBizId 不传 DocId → ADP 完全读不到文档（模式 D 失败）；DocId + DocBizId 双字段同时传 → 最佳效果（模式 A）。Python SDK 用 DocBizId 而非 DocId 可能是 SDK bug
- **docParse 失败的降级策略**：不带 DocId 仅传 Type:file + FileUrl → ADP 读不到文档（实测）。应改用 Markdown 链接 `[文件名](URL)` 放入 Type:text 作为最终降级，部分 claw 应用可识别公网 URL
- **docParse 是 SSE 流式接口，绝不能用 `res.text()`/`res.json()` 读取！** `res.text()` 会一直等到整个连接关闭，而服务端发完 `is_final` 后连接不立即关闭 → 请求挂起到超时被 abort（错误：The operation was aborted due to timeout）。必须用 `res.body.getReader()` + TextDecoder + 行缓冲流式读取，逐行解析 SSE `data:` 事件，拿到 `is_final` 立即 break 并 `reader.cancel()`（对照官方 Python SDK 的 sseclient 逐事件处理）

## Electron 安全与性能（跨项目通用）
- preload.js 用 contextBridge 白名单暴露 API，不暴露 require/process
- IPC 返回值必须可序列化，错误通过 {error:message} 传递
- 巨型单文件要拆分，CSS/JS/HTML 必须分离
- backdrop-filter 毛玻璃大量使用影响滚动性能

## ADP Claw 模式关键知识（2026-06-12 验证成功）
- **Claw 模式 vs 标准模式文件传递差异（核心！）**：Claw 模式用 Markdown 链接嵌入 Type:text（文档 `[文件名](COS_URL)\n\n请阅读以上文档`，图片 `![](COS_URL)`）；标准模式用 Type:file + DocId（需 docParse）。Claw 模式**不需要 docParse**！不需要 DocId！不需要等待解析！
- **Claw 模式文件上传完整流程**：DescribeStorageCredential(BotBizId) → PUT COS → Markdown 链接嵌入 Contents Type:text → 发送 V2 Chat。图片 IsPublic=true，文档 IsPublic=false。
- **三级别降级**：方案0（纯文本≤50000字符直接注入）→ 方案A（COS上传+Markdown链接）→ 方案B（File Share+Markdown链接）→ 方案C（base64内联仅图片）
- **官方 V2 图片对话 curl 示例用 Type:image + Image.Url**，但实测 Claw 模式下 Markdown `![](url)` 也有效。如有问题可尝试切换。
- **Widget 渲染**：ADP V2 Content 支持 Widget 类型（WidgetId/WidgetRunId/State/View），官方 ADP-Widget SDK 基于 Web Components 标准。Widget 交互回传用 Type:widget_action。
- **完整报告**：docs/ADP-Claw模式文件对话实现报告.md
- 参考文档：https://cloud.tencent.com/document/product/1759/107908, https://cloud.tencent.com/document/product/1759/129202
