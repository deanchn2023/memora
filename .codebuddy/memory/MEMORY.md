# Memora 项目长期记忆

## 图片同步关键原则（2026-06-11）
- 笔记 `imagePath` **始终指向本地文件**（`images/xxx.png`），服务端路径仅在同步 payload 中使用
- Node.js `fetch`（undici）与 `form-data` npm 包的 stream body 不兼容 → multipart/form-data 上传必须用 http 模块 + form.pipe(req)
- "上传失败就不推送元数据"是错误策略 → 应始终推送元数据，图片文件单独重试

## Electron 安全与性能（跨项目通用）
- preload.js 用 contextBridge 白名单暴露 API，不暴露 require/process
- IPC 返回值必须可序列化，错误通过 {error:message} 传递
- 巨型单文件要拆分，CSS/JS/HTML 必须分离
- backdrop-filter 毛玻璃大量使用影响滚动性能
