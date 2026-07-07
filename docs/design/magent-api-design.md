# Memora M-Agent API 设计方案

## 一、需求概述

### 1.1 核心目标

为外部 AI Agent（M-Agent）提供访问 Memora 全部功能的 REST API 接口，覆盖以下模块：

| 模块 | 描述 |
|------|------|
| 待办管理 | 标记完成、批量完成、创建/删除/修改任务 |
| 记事本操作 | 修改分类、读取所有笔记、重新分类、提炼文章 |
| 记忆操作 | 读取/搜索/创建/更新记忆 |
| 智能分析 | 基于数据生成报告、总结、分类建议 |
| AI 配置 | API 密钥管理、模型配置、Prompt 管理 |
| 专家系统 | 专家管理、群聊后台执行 |
| 知识系统 | 知识萃取、图谱检索、聚类分析 |
| 向量数据库 | 向量检索、RAG、重建索引 |
| 剪贴板 | 剪贴板监控、配置管理 |
| 多模态 | 图片、URL、会议记录管理 |
| 关系图谱 | 人脉关系管理、AI 分析 |

### 1.2 设计原则

1. **最小侵入**：直接调用主进程业务逻辑，复用现有 IPC 通道实现
2. **本地优先**：默认只允许 localhost 访问，保证安全
3. **RESTful**：标准 REST API 设计，易于理解和使用
4. **实时同步**：API 操作后自动通知 UI 更新
5. **全面覆盖**：开放所有现有 IPC 通道功能

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron 主进程                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │  现有 IPC 通道    │  │  Local HTTP    │  │  业务逻辑    │  │
│  │  (preload.js)   │  │  Server        │  │  (notebook, │  │
│  │                 │  │  (Express)     │  │   db, etc)  │  │
│  └────────┬────────┘  └────────┬────────┘  └───────┬───────┘  │
│           │                    │                    │          │
│           │ 调用               │ 直接调用（同一进程） │          │
│           ▼                    ▼                    │          │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │               统一服务层（共用业务逻辑）                   │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP (localhost:3001)
                              ▼
                    ┌─────────────────┐
                    │   M-Agent       │
                    │ (外部 AI Agent) │
                    └─────────────────┘
```

### 2.2 技术选型

| 层次 | 技术 | 理由 |
|------|------|------|
| HTTP Server | Express | 轻量、成熟、与 Electron 兼容 |
| 路由 | Express Router | 模块化路由管理 |
| 响应格式 | JSON | 标准、易解析 |
| 安全 | CORS + API Key | 本地访问 + 简单认证 |
| 异步任务 | Job Queue + SSE | 长耗时 AI 任务非阻塞 |

---

## 三、API 设计

### 3.1 基础信息

| 项目 | 值 |
|------|------|
| 基础路径 | `http://localhost:3001/api/v1` |
| 认证 | API Key（`X-API-Key` 头） |
| 响应格式 | `{ "success": true/false, "data": ..., "error": ... }` |
| 端口配置 | 环境变量 `MEMORA_API_PORT`，默认 3001 |
| API Key | 环境变量 `MEMORA_API_KEY`，默认 `memora-local-key` |

### 3.2 认证机制

请求头中携带 API Key：

```
X-API-Key: memora-local-key
```

配置方式（二选一）：
1. 环境变量：`MEMORA_API_KEY=your-secret-key`
2. 配置文件：`~/.memora/config.json` 中设置 `apiKey`

---

## 四、API 接口总览

| 模块 | 接口数 | 基础路径 |
|------|--------|----------|
| 系统控制 | 12 | `/api/v1/system` |
| AI 配置 | 10 | `/api/v1/ai` |
| Claude Code | 20 | `/api/v1/cc` |
| Skill 管理 | 12 | `/api/v1/skills` |
| ADP 配置 | 8 | `/api/v1/adp` |
| 专家系统 | 18 | `/api/v1/experts` |
| 认证系统 | 15 | `/api/v1/auth` |
| 知识系统 | 24 | `/api/v1/knowledge` |
| 记忆系统 | 18 | `/api/v1/memories` |
| 记事本 | 14 | `/api/v1/notes` |
| 向量数据库 | 11 | `/api/v1/vector` |
| Agent 产物 | 9 | `/api/v1/artifacts` |
| 会话管理 | 4 | `/api/v1/sessions` |
| 反馈系统 | 8 | `/api/v1/feedback` |
| Profile | 5 | `/api/v1/profile` |
| Agent 助手 | 4 | `/api/v1/agent` |
| Prompt 优化器 | 7 | `/api/v1/optimizer` |
| Prompt 文件 | 11 | `/api/v1/prompts` |
| 剪贴板 | 7 | `/api/v1/clipboard` |
| AI 审计日志 | 5 | `/api/v1/audit` |
| 知识图谱 | 14 | `/api/v1/graph` |
| 数据库操作 | 9 | `/api/v1/db` |
| 本地文件 | 9 | `/api/v1/files` |
| 洞察模块 | 10 | `/api/v1/insight` |
| 多模态 | 14 | `/api/v1/multimodal` |
| 关系图谱 | 7 | `/api/v1/relationship` |
| 数据同步 | 22 | `/api/v1/sync` |
| 语音 ASR | 8 | `/api/v1/asr` |
| 多任务并发 | 4 | `/api/v1/tasks` |
| 智能分析 | 5 | `/api/v1/analyze` |

---

## 五、详细 API 设计

### 5.1 系统控制 API

#### 5.1.1 获取窗口焦点状态

```
GET /api/v1/system/window/focus-state
```

#### 5.1.2 闪烁窗口提醒

```
POST /api/v1/system/window/flash-attention
```

#### 5.1.3 聚焦窗口

```
POST /api/v1/system/window/focus
```

#### 5.1.4 最小化窗口

```
POST /api/v1/system/window/minimize
```

#### 5.1.5 最大化窗口

```
POST /api/v1/system/window/maximize
```

#### 5.1.6 关闭窗口

```
POST /api/v1/system/window/close
```

#### 5.1.7 获取剪贴板文本

```
GET /api/v1/system/clipboard/text
```

#### 5.1.8 写入剪贴板文本

```
POST /api/v1/system/clipboard/text
```

**请求体**：
```json
{
  "text": "要复制的文本"
}
```

#### 5.1.9 显示通知

```
POST /api/v1/system/notification
```

**请求体**：
```json
{
  "title": "通知标题",
  "body": "通知内容"
}
```

#### 5.1.10 估计任务时长

```
POST /api/v1/system/task/duration
```

**请求体**：
```json
{
  "task": "任务描述"
}
```

#### 5.1.11 添加到日历

```
POST /api/v1/system/calendar/add
```

**请求体**：
```json
{
  "task": "任务描述"
}
```

#### 5.1.12 从日历移除

```
POST /api/v1/system/calendar/remove
```

**请求体**：
```json
{
  "taskTitle": "任务标题"
}
```

---

### 5.2 AI 配置 API

#### 5.2.1 获取 AI 统计

```
GET /api/v1/ai/stats
```

#### 5.2.2 设置每日限额

```
POST /api/v1/ai/daily-limit
```

**请求体**：
```json
{
  "limit": 1000000
}
```

#### 5.2.3 获取 AI Prompt

```
GET /api/v1/ai/prompt
```

#### 5.2.4 设置 AI Prompt

```
POST /api/v1/ai/prompt
```

**请求体**：
```json
{
  "prompt": "自定义 prompt"
}
```

#### 5.2.5 重置 AI Prompt

```
POST /api/v1/ai/prompt/reset
```

#### 5.2.6 获取 API 配置

```
GET /api/v1/ai/config
```

#### 5.2.7 设置 API 配置

```
POST /api/v1/ai/config
```

**请求体**：
```json
{
  "apiKey": "your-api-key",
  "model": "claude-3-5-sonnet-20240620",
  "baseUrl": "https://api.anthropic.com"
}
```

#### 5.2.8 清除 API Key

```
POST /api/v1/ai/config/clear-key
```

#### 5.2.9 测试 LLM 连接

```
POST /api/v1/ai/config/test
```

**请求体**：
```json
{
  "apiKey": "your-api-key",
  "model": "claude-3-5-sonnet-20240620"
}
```

#### 5.2.10 获取全局 AI 模式

```
GET /api/v1/ai/mode
```

#### 5.2.11 设置全局 AI 模式

```
POST /api/v1/ai/mode
```

**请求体**：
```json
{
  "mode": "auto"
}
```

---

### 5.3 Claude Code API

#### 5.3.1 调用 CC 工具

```
POST /api/v1/cc/invoke
```

**请求体**：
```json
{
  "data": {
    "tool": "search_memory",
    "args": {"query": "关键词"}
  }
}
```

#### 5.3.2 停止 CC 会话

```
POST /api/v1/cc/stop
```

#### 5.3.3 新建 CC 会话

```
POST /api/v1/cc/new-session
```

#### 5.3.4 测试 CC 连接

```
POST /api/v1/cc/test-connection
```

**请求体**：
```json
{
  "params": {"apiKey": "your-key"}
}
```

#### 5.3.5 获取 CC 配置

```
GET /api/v1/cc/config
```

#### 5.3.6 设置 CC 配置

```
POST /api/v1/cc/config
```

#### 5.3.7 选择目录

```
POST /api/v1/cc/pick-directory
```

#### 5.3.8 检查环境

```
POST /api/v1/cc/check-env
```

**请求体**：
```json
{
  "workdir": "/path/to/workdir"
}
```

#### 5.3.9 安装工具

```
POST /api/v1/cc/install-tool
```

**请求体**：
```json
{
  "params": {"toolName": "tool-name"}
}
```

#### 5.3.10 获取供应商列表

```
GET /api/v1/cc/providers
```

#### 5.3.11 测试供应商

```
POST /api/v1/cc/test-provider
```

**请求体**：
```json
{
  "params": {"providerId": "provider-id"}
}
```

#### 5.3.12 解析模型

```
POST /api/v1/cc/parse-models
```

**请求体**：
```json
{
  "params": {"providerId": "provider-id"}
}
```

#### 5.3.13 同步 CC 记忆

```
POST /api/v1/cc/sync-memory
```

#### 5.3.14 获取 OpenRouter 模型

```
GET /api/v1/cc/openrouter/models
```

#### 5.3.15 测试 OpenRouter

```
POST /api/v1/cc/openrouter/test
```

**请求体**：
```json
{
  "params": {"apiKey": "your-key"}
}
```

#### 5.3.16 停止 OpenRouter 代理

```
POST /api/v1/cc/openrouter/stop-proxy
```

#### 5.3.17 获取 AFP 用量

```
GET /api/v1/cc/ark/afp-usage/:providerId
```

#### 5.3.18 执行命令

```
POST /api/v1/cc/execute-command
```

**请求体**：
```json
{
  "data": {
    "command": "ls -la",
    "workdir": "/path/to/workdir"
  }
}
```

---

### 5.4 Skill 管理 API

#### 5.4.1 上传 Skill

```
POST /api/v1/skills/upload
```

**请求体**：
```json
{
  "data": {"skillData": {...}}
}
```

#### 5.4.2 获取 Skill 列表

```
GET /api/v1/skills
```

#### 5.4.3 获取 Skill 状态列表

```
POST /api/v1/skills/status
```

**请求体**：
```json
{
  "data": {"filter": {...}}
}
```

#### 5.4.4 删除 Skill

```
POST /api/v1/skills/delete
```

**请求体**：
```json
{
  "data": {"skillId": "skill-id"}
}
```

#### 5.4.5 安装到 CC

```
POST /api/v1/skills/install-to-cc
```

**请求体**：
```json
{
  "data": {"skillId": "skill-id"}
}
```

#### 5.4.6 从 CC 卸载

```
POST /api/v1/skills/uninstall-from-cc
```

**请求体**：
```json
{
  "data": {"skillId": "skill-id"}
}
```

#### 5.4.7 从工作目录导入

```
POST /api/v1/skills/import-from-workdir
```

**请求体**：
```json
{
  "data": {"path": "/path/to/skill"}
}
```

#### 5.4.8 从工作目录删除

```
POST /api/v1/skills/delete-from-workdir
```

**请求体**：
```json
{
  "data": {"path": "/path/to/skill"}
}
```

#### 5.4.9 获取 Skill 详情

```
POST /api/v1/skills/detail
```

**请求体**：
```json
{
  "data": {"skillId": "skill-id"}
}
```

#### 5.4.10 SkillHub 检查

```
GET /api/v1/skills/skillhub/check
```

#### 5.4.11 SkillHub 安装 CLI

```
POST /api/v1/skills/skillhub/install-cli
```

#### 5.4.12 SkillHub 搜索

```
POST /api/v1/skills/skillhub/search
```

**请求体**：
```json
{
  "data": {"query": "关键词"}
}
```

#### 5.4.13 SkillHub 安装

```
POST /api/v1/skills/skillhub/install
```

**请求体**：
```json
{
  "data": {"skillName": "skill-name"}
}
```

#### 5.4.14 SkillHub 列表

```
POST /api/v1/skills/skillhub/list
```

#### 5.4.15 SkillHub 卸载

```
POST /api/v1/skills/skillhub/uninstall
```

**请求体**：
```json
{
  "data": {"skillName": "skill-name"}
}
```

---

### 5.5 ADP 配置 API

#### 5.5.1 获取 ADP 配置

```
GET /api/v1/adp/config
```

#### 5.5.2 设置 ADP 配置

```
POST /api/v1/adp/config
```

**请求体**：
```json
{
  "config": {...}
}
```

#### 5.5.3 发送 ADP 消息

```
POST /api/v1/adp/message
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.5.4 停止 ADP 消息

```
POST /api/v1/adp/message/stop
```

#### 5.5.5 新建 ADP 聊天

```
POST /api/v1/adp/new-chat
```

#### 5.5.6 设置 ADP 会话 ID

```
POST /api/v1/adp/conversation-id
```

**请求体**：
```json
{
  "convId": "conversation-id"
}
```

#### 5.5.7 清除 ADP 配置

```
POST /api/v1/adp/config/clear
```

---

### 5.6 专家系统 API

#### 5.6.1 获取所有专家

```
GET /api/v1/experts
```

#### 5.6.2 保存专家

```
POST /api/v1/experts
```

**请求体**：
```json
{
  "expert": {...}
}
```

#### 5.6.3 删除专家

```
DELETE /api/v1/experts/:expertId
```

#### 5.6.4 重排专家

```
POST /api/v1/experts/reorder
```

**请求体**：
```json
{
  "orderedIds": ["id1", "id2", "id3"]
}
```

#### 5.6.5 获取专家组

```
GET /api/v1/experts/groups
```

#### 5.6.6 保存专家组

```
POST /api/v1/experts/groups
```

**请求体**：
```json
{
  "group": {...}
}
```

#### 5.6.7 删除专家组

```
DELETE /api/v1/experts/groups/:groupId
```

#### 5.6.8 重排专家组

```
POST /api/v1/experts/groups/reorder
```

**请求体**：
```json
{
  "orderedIds": ["id1", "id2", "id3"]
}
```

#### 5.6.9 开始专家聊天

```
POST /api/v1/experts/chat/start
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.6.10 获取专家聊天状态

```
POST /api/v1/experts/chat/status
```

**请求体**：
```json
{
  "data": {"chatId": "chat-id"}
}
```

#### 5.6.11 取消专家聊天

```
POST /api/v1/experts/chat/cancel
```

**请求体**：
```json
{
  "data": {"chatId": "chat-id"}
}
```

#### 5.6.12 保存专家聊天记录

```
POST /api/v1/experts/chat/save-record
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.6.13 获取专家聊天记录

```
POST /api/v1/experts/chat/records
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.6.14 删除专家聊天记录

```
POST /api/v1/experts/chat/delete-record
```

**请求体**：
```json
{
  "data": {"recordId": "record-id"}
}
```

#### 5.6.15 优化主机 Prompt

```
POST /api/v1/experts/optimize-host-prompt
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.6.16 导入 Excel

```
POST /api/v1/experts/import-xlsx
```

#### 5.6.17 导出 Excel

```
POST /api/v1/experts/export-xlsx
```

**请求体**：
```json
{
  "experts": [...]
}
```

---

### 5.7 认证系统 API

#### 5.7.1 登录

```
POST /api/v1/auth/login
```

**请求体**：
```json
{
  "account": "username",
  "password": "password",
  "env": "production",
  "rememberMe": true
}
```

#### 5.7.2 登出

```
POST /api/v1/auth/logout
```

#### 5.7.3 获取认证状态

```
GET /api/v1/auth/state
```

#### 5.7.4 发送验证码

```
POST /api/v1/auth/send-code
```

**请求体**：
```json
{
  "mobile": "13800138000"
}
```

#### 5.7.5 注册

```
POST /api/v1/auth/register
```

**请求体**：
```json
{
  "account": "username",
  "password": "password",
  "mobile": "13800138000",
  "code": "123456"
}
```

#### 5.7.6 更新用户信息

```
POST /api/v1/auth/profile
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.7.7 获取服务器 URL

```
GET /api/v1/auth/server-urls
```

#### 5.7.8 设置服务器 URL

```
POST /api/v1/auth/server-urls
```

**请求体**：
```json
{
  "urls": {...}
}
```

#### 5.7.9 重置服务器 URL

```
POST /api/v1/auth/server-urls/reset
```

**请求体**：
```json
{
  "env": "production"
}
```

#### 5.7.10 同步配置

```
POST /api/v1/config/sync
```

#### 5.7.11 设置配置来源

```
POST /api/v1/config/source
```

**请求体**：
```json
{
  "forceLocal": false
}
```

#### 5.7.12 获取配置来源

```
GET /api/v1/config/source
```

#### 5.7.13 获取通知

```
GET /api/v1/notifications
```

#### 5.7.14 获取未读通知数

```
GET /api/v1/notifications/unread-count
```

#### 5.7.15 标记通知已读

```
POST /api/v1/notifications/mark-read/:id
```

#### 5.7.16 标记所有通知已读

```
POST /api/v1/notifications/mark-all-read
```

#### 5.7.17 检查更新

```
GET /api/v1/updates/check
```

---

### 5.8 知识系统 API

#### 5.8.1 搜索 ADP 知识

```
POST /api/v1/knowledge/search-adp
```

**请求体**：
```json
{
  "params": {"query": "关键词"}
}
```

#### 5.8.2 停止 ADP 搜索

```
POST /api/v1/knowledge/search-adp/stop
```

#### 5.8.3 本地搜索

```
POST /api/v1/knowledge/search-local
```

**请求体**：
```json
{
  "params": {"query": "关键词"}
}
```

#### 5.8.4 提取关键词

```
POST /api/v1/knowledge/extract-keywords
```

**请求体**：
```json
{
  "params": {"text": "文本内容"}
}
```

#### 5.8.5 保存知识项

```
POST /api/v1/knowledge/item
```

**请求体**：
```json
{
  "item": {...}
}
```

#### 5.8.6 删除知识项

```
POST /api/v1/knowledge/item/delete
```

**请求体**：
```json
{
  "params": {"id": "item-id"}
}
```

#### 5.8.7 获取推荐

```
POST /api/v1/knowledge/recommendations
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.8.8 获取历史

```
POST /api/v1/knowledge/history
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.8.9 分类意图

```
POST /api/v1/knowledge/classify-intent
```

**请求体**：
```json
{
  "params": {"text": "文本内容"}
}
```

#### 5.8.10 获取设备指纹

```
GET /api/v1/knowledge/device-fingerprint
```

#### 5.8.11 获取 Atoms

```
POST /api/v1/knowledge/atoms
```

**请求体**：
```json
{
  "filter": {...}
}
```

#### 5.8.12 获取 Atom 详情

```
GET /api/v1/knowledge/atoms/:id
```

#### 5.8.13 添加 Atom

```
POST /api/v1/knowledge/atoms
```

**请求体**：
```json
{
  "atom": {...}
}
```

#### 5.8.14 删除 Atom

```
DELETE /api/v1/knowledge/atoms/:id
```

#### 5.8.15 更新 Atom

```
PUT /api/v1/knowledge/atoms/:id
```

**请求体**：
```json
{
  "updates": {...}
}
```

#### 5.8.16 获取 Clusters

```
POST /api/v1/knowledge/clusters
```

**请求体**：
```json
{
  "filter": {...}
}
```

#### 5.8.17 获取 Cluster 详情

```
GET /api/v1/knowledge/clusters/:id
```

#### 5.8.18 创建 Cluster

```
POST /api/v1/knowledge/clusters
```

**请求体**：
```json
{
  "cluster": {...}
}
```

#### 5.8.19 更新 Cluster

```
PUT /api/v1/knowledge/clusters/:id
```

**请求体**：
```json
{
  "updates": {...}
}
```

#### 5.8.20 删除 Cluster

```
DELETE /api/v1/knowledge/clusters/:id
```

**请求体**：
```json
{
  "atomAction": "move"
}
```

#### 5.8.21 聚类 Atom

```
POST /api/v1/knowledge/atoms/:atomId/cluster/:clusterId
```

#### 5.8.22 自动聚类

```
POST /api/v1/knowledge/clusters/auto
```

#### 5.8.23 取消聚类

```
POST /api/v1/knowledge/clusters/cancel
```

#### 5.8.24 获取文章

```
POST /api/v1/knowledge/articles
```

**请求体**：
```json
{
  "filter": {...}
}
```

#### 5.8.25 获取文章详情

```
GET /api/v1/knowledge/articles/:id
```

#### 5.8.26 生成文章

```
POST /api/v1/knowledge/articles/generate/:clusterId
```

#### 5.8.27 更新文章

```
PUT /api/v1/knowledge/articles/:id
```

**请求体**：
```json
{
  "updates": {...}
}
```

#### 5.8.28 删除文章

```
DELETE /api/v1/knowledge/articles/:id
```

#### 5.8.29 获取统计

```
GET /api/v1/knowledge/stats
```

#### 5.8.30 获取领域

```
GET /api/v1/knowledge/domains
```

#### 5.8.31 萃取全部

```
POST /api/v1/knowledge/distill-all
```

#### 5.8.32 获取聚类统计

```
GET /api/v1/knowledge/clustering-stats
```

#### 5.8.33 从笔记提取 Atoms

```
POST /api/v1/knowledge/extract-atoms/:noteId
```

---

### 5.9 记忆系统 API

#### 5.9.1 获取记忆列表

```
GET /api/v1/memories
```

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `layer` | string | 记忆层：`fact`/`work`/`preference` |

#### 5.9.2 添加记忆

```
POST /api/v1/memories
```

**请求体**：
```json
{
  "memory": {
    "content": "记忆内容",
    "layer": "fact",
    "tags": ["标签1", "标签2"],
    "source": "clipboard"
  }
}
```

#### 5.9.3 更新记忆

```
PUT /api/v1/memories/:id
```

**请求体**：
```json
{
  "updates": {
    "tags": ["新标签"],
    "layer": "work"
  }
}
```

#### 5.9.4 删除记忆

```
DELETE /api/v1/memories/:id
```

#### 5.9.5 清除所有记忆

```
POST /api/v1/memories/clear-all
```

#### 5.9.6 获取记忆统计

```
GET /api/v1/memories/stats
```

#### 5.9.7 获取实体图谱

```
GET /api/v1/memories/entity-graph
```

#### 5.9.8 搜索相关记忆

```
POST /api/v1/memories/search
```

**请求体**：
```json
{
  "content": "搜索关键词",
  "limit": 5
}
```

#### 5.9.9 获取记忆 Prompt

```
GET /api/v1/memories/prompt
```

#### 5.9.10 设置记忆 Prompt

```
POST /api/v1/memories/prompt
```

**请求体**：
```json
{
  "prompt": "自定义 prompt"
}
```

#### 5.9.11 重置记忆 Prompt

```
POST /api/v1/memories/prompt/reset
```

#### 5.9.12 提取记忆

```
POST /api/v1/memories/extract
```

**请求体**：
```json
{
  "content": "文本内容"
}
```

#### 5.9.13 AI 整理记忆

```
POST /api/v1/memories/ai-organize
```

**请求体**：
```json
{
  "content": "文本内容"
}
```

#### 5.9.14 AI 批量整理记忆

```
POST /api/v1/memories/ai-batch-organize
```

#### 5.9.15 分析任务

```
POST /api/v1/memories/analyze-task
```

**请求体**：
```json
{
  "text": "任务文本"
}
```

#### 5.9.16 分析剪贴板

```
POST /api/v1/memories/analyze-clipboard
```

**请求体**：
```json
{
  "text": "剪贴板文本"
}
```

#### 5.9.17 优化剪贴板 Prompt

```
POST /api/v1/memories/optimize-clipboard-prompt
```

**请求体**：
```json
{
  "feedback": {...}
}
```

#### 5.9.18 分类意图

```
POST /api/v1/memories/classify-intent
```

**请求体**：
```json
{
  "messageText": "消息文本"
}
```

#### 5.9.19 AI 续写

```
POST /api/v1/memories/continue-writing
```

**请求体**：
```json
{
  "context": {...}
}
```

---

### 5.10 记事本 API

#### 5.10.1 获取笔记列表

```
GET /api/v1/notes
```

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `category` | string | 分类筛选 |
| `limit` | number | 返回数量限制 |

#### 5.10.2 获取笔记详情

```
GET /api/v1/notes/:id
```

#### 5.10.3 创建笔记

```
POST /api/v1/notes
```

**请求体**：
```json
{
  "note": {
    "title": "笔记标题",
    "content": "笔记内容",
    "category": "work",
    "tags": ["标签1", "标签2"]
  }
}
```

#### 5.10.4 更新笔记

```
PUT /api/v1/notes/:id
```

**请求体**：
```json
{
  "updates": {
    "category": "personal",
    "tags": ["新标签"]
  }
}
```

#### 5.10.5 删除笔记

```
DELETE /api/v1/notes/:id
```

#### 5.10.6 修改笔记分类

```
POST /api/v1/notes/:id/change-category
```

**请求体**：
```json
{
  "category": "new_category"
}
```

#### 5.10.7 批量修改分类

```
POST /api/v1/notes/batch/change-category
```

**请求体**：
```json
{
  "ids": ["note_123", "note_456"],
  "category": "new_category"
}
```

#### 5.10.8 搜索笔记

```
GET /api/v1/notes/search?q=关键词
```

#### 5.10.9 获取分类列表

```
GET /api/v1/notes/categories
```

#### 5.10.10 保存分类

```
POST /api/v1/notes/categories
```

**请求体**：
```json
{
  "categories": {...}
}
```

#### 5.10.11 获取统计

```
GET /api/v1/notes/stats
```

#### 5.10.12 删除分类下所有笔记

```
POST /api/v1/notes/delete-by-category/:category
```

#### 5.10.13 导出 Markdown

```
POST /api/v1/notes/export-markdown
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.10.14 获取用户数据路径

```
GET /api/v1/notes/user-data-path
```

---

### 5.11 向量数据库 API

#### 5.11.1 向量搜索

```
POST /api/v1/vector/search
```

**请求体**：
```json
{
  "params": {"query": "关键词", "limit": 5}
}
```

#### 5.11.2 搜索笔记

```
POST /api/v1/vector/search-notes
```

**请求体**：
```json
{
  "params": {"query": "关键词"}
}
```

#### 5.11.3 RAG 检索

```
POST /api/v1/vector/retrieve-rag
```

**请求体**：
```json
{
  "params": {"query": "关键词"}
}
```

#### 5.11.4 CC 检索

```
POST /api/v1/vector/retrieve-cc
```

**请求体**：
```json
{
  "params": {"query": "关键词"}
}
```

#### 5.11.5 重建索引

```
POST /api/v1/vector/rebuild
```

#### 5.11.6 获取状态

```
GET /api/v1/vector/status
```

#### 5.11.7 获取队列状态

```
GET /api/v1/vector/queue-status
```

#### 5.11.8 浏览向量

```
POST /api/v1/vector/browse
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.11.9 调试搜索

```
POST /api/v1/vector/debug-search
```

**请求体**：
```json
{
  "params": {"query": "关键词"}
}
```

#### 5.11.10 诊断上下文

```
POST /api/v1/vector/diagnose-context
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.11.11 内存利用率

```
GET /api/v1/vector/memory-utilization
```

#### 5.11.12 检查晋升

```
POST /api/v1/vector/check-promotion
```

#### 5.11.13 检查遗忘

```
POST /api/v1/vector/check-forgetting
```

---

### 5.12 Agent 产物 API

#### 5.12.1 获取基础路径

```
GET /api/v1/artifacts/base-path
```

#### 5.12.2 更改目录

```
POST /api/v1/artifacts/change-dir
```

#### 5.12.3 打开目录

```
POST /api/v1/artifacts/open-dir
```

#### 5.12.4 列出文件

```
GET /api/v1/artifacts
```

#### 5.12.5 读取文件

```
GET /api/v1/artifacts/read
```

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `filePath` | string | 文件路径 |

#### 5.12.6 删除文件

```
POST /api/v1/artifacts/delete
```

**请求体**：
```json
{
  "filePath": "/path/to/file"
}
```

#### 5.12.7 在文件夹中显示

```
POST /api/v1/artifacts/show-in-folder
```

**请求体**：
```json
{
  "filePath": "/path/to/file"
}
```

#### 5.12.8 保存文件

```
POST /api/v1/artifacts/save
```

**请求体**：
```json
{
  "data": {
    "filePath": "/path/to/file",
    "content": "文件内容"
  }
}
```

#### 5.12.9 下载并保存

```
POST /api/v1/artifacts/download-and-save
```

**请求体**：
```json
{
  "data": {...}
}
```

---

### 5.13 会话管理 API

#### 5.13.1 导出会话

```
POST /api/v1/sessions/export
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.13.2 导入会话

```
POST /api/v1/sessions/import
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.13.3 打开对话框

```
POST /api/v1/sessions/dialog-open
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.13.4 读取数据文件

```
GET /api/v1/sessions/data-file/:fileName
```

---

### 5.14 反馈系统 API

#### 5.14.1 记录反馈

```
POST /api/v1/feedback
```

**请求体**：
```json
{
  "feedback": {...}
}
```

#### 5.14.2 优化 Prompt

```
POST /api/v1/feedback/optimize-prompts
```

#### 5.14.3 新建 Trace ID

```
POST /api/v1/feedback/trace-id
```

#### 5.14.4 记录 Trace

```
POST /api/v1/feedback/trace
```

**请求体**：
```json
{
  "trace": {...}
}
```

#### 5.14.5 查询反馈

```
POST /api/v1/feedback/query
```

**请求体**：
```json
{
  "options": {...}
}
```

#### 5.14.6 接受反馈

```
POST /api/v1/feedback/accept
```

**请求体**：
```json
{
  "traceId": "trace-id",
  "finalOutput": "最终输出"
}
```

#### 5.14.7 拒绝反馈

```
POST /api/v1/feedback/reject
```

**请求体**：
```json
{
  "traceId": "trace-id",
  "reason": "拒绝原因"
}
```

#### 5.14.8 编辑反馈

```
POST /api/v1/feedback/edit
```

**请求体**：
```json
{
  "traceId": "trace-id",
  "before": "编辑前",
  "after": "编辑后",
  "reason": "编辑原因"
}
```

---

### 5.15 Profile API

#### 5.15.1 获取 Profile

```
GET /api/v1/profile
```

#### 5.15.2 更新 Profile

```
PUT /api/v1/profile
```

**请求体**：
```json
{
  "updates": {...}
}
```

#### 5.15.3 AI 导入

```
POST /api/v1/profile/import-ai
```

**请求体**：
```json
{
  "text": "文本内容"
}
```

#### 5.15.4 确认导入

```
POST /api/v1/profile/import-confirm
```

**请求体**：
```json
{
  "previewData": {...}
}
```

#### 5.15.5 获取建议

```
GET /api/v1/profile/suggestions
```

---

### 5.16 Agent 助手 API

#### 5.16.1 调用 Agent

```
POST /api/v1/agent/invoke
```

**请求体**：
```json
{
  "query": "查询内容",
  "agentType": "default",
  "attachments": [],
  "model": "claude-3-5-sonnet"
}
```

#### 5.16.2 停止 Agent

```
POST /api/v1/agent/stop
```

---

### 5.17 Prompt 优化器 API

#### 5.17.1 获取候选列表

```
GET /api/v1/optimizer/candidates
```

#### 5.17.2 应用候选

```
POST /api/v1/optimizer/apply-candidate
```

**请求体**：
```json
{
  "filename": "prompt-file-name"
}
```

#### 5.17.3 运行优化器

```
POST /api/v1/optimizer/run
```

**请求体**：
```json
{
  "options": {...}
}
```

#### 5.17.4 获取历史

```
GET /api/v1/optimizer/history
```

#### 5.17.5 读取报告

```
POST /api/v1/optimizer/read-report
```

**请求体**：
```json
{
  "filename": "report-file-name"
}
```

#### 5.17.6 读取候选

```
POST /api/v1/optimizer/read-candidate
```

**请求体**：
```json
{
  "filename": "candidate-file-name"
}
```

#### 5.17.7 应用到主 Prompt

```
POST /api/v1/optimizer/apply-to-main
```

**请求体**：
```json
{
  "filename": "prompt-file-name"
}
```

---

### 5.18 Prompt 文件管理 API

#### 5.18.1 列出文件

```
GET /api/v1/prompts/files
```

#### 5.18.2 读取文件

```
GET /api/v1/prompts/files/read
```

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `filename` | string | 文件名 |

#### 5.18.3 写入文件

```
POST /api/v1/prompts/files/write
```

**请求体**：
```json
{
  "filename": "prompt-file-name",
  "content": "prompt内容"
}
```

#### 5.18.4 重置文件

```
POST /api/v1/prompts/files/reset
```

**请求体**：
```json
{
  "filename": "prompt-file-name"
}
```

#### 5.18.5 下载文件

```
POST /api/v1/prompts/files/download
```

**请求体**：
```json
{
  "filename": "prompt-file-name"
}
```

#### 5.18.6 上传文件

```
POST /api/v1/prompts/files/upload
```

**请求体**：
```json
{
  "filename": "prompt-file-name",
  "content": "prompt内容"
}
```

#### 5.18.7 获取变量

```
POST /api/v1/prompts/files/variables
```

**请求体**：
```json
{
  "filename": "prompt-file-name"
}
```

#### 5.18.8 列出备份

```
POST /api/v1/prompts/files/backups
```

**请求体**：
```json
{
  "filename": "prompt-file-name"
}
```

#### 5.18.9 恢复备份

```
POST /api/v1/prompts/files/restore-backup
```

**请求体**：
```json
{
  "filename": "prompt-file-name",
  "backupFilename": "backup-file-name"
}
```

#### 5.18.10 重置为内置

```
POST /api/v1/prompts/files/reset-to-builtin
```

**请求体**：
```json
{
  "filename": "prompt-file-name"
}
```

---

### 5.19 剪贴板 API

#### 5.19.1 清除剪贴板哈希

```
POST /api/v1/clipboard/clear-hashes
```

#### 5.19.2 获取剪贴板哈希数

```
GET /api/v1/clipboard/hash-count
```

#### 5.19.3 获取剪贴板配置

```
GET /api/v1/clipboard/config
```

#### 5.19.4 更新剪贴板配置

```
POST /api/v1/clipboard/config
```

**请求体**：
```json
{
  "config": {...}
}
```

#### 5.19.5 诊断剪贴板

```
POST /api/v1/clipboard/diagnostic
```

#### 5.19.6 强制分析

```
POST /api/v1/clipboard/force-analyze
```

---

### 5.20 AI 审计日志 API

#### 5.20.1 查询审计日志

```
POST /api/v1/audit/query
```

**请求体**：
```json
{
  "options": {...}
}
```

#### 5.20.2 获取模块列表

```
GET /api/v1/audit/modules
```

#### 5.20.3 获取每日统计

```
GET /api/v1/audit/daily-stats/:days
```

#### 5.20.4 清理审计日志

```
POST /api/v1/audit/cleanup
```

#### 5.20.5 记录 Prompt 优化

```
POST /api/v1/audit/log-prompt-optimization
```

**请求体**：
```json
{
  "data": {...}
}
```

---

### 5.21 知识图谱 API

#### 5.21.1 提取实体

```
POST /api/v1/graph/extract-entities
```

**请求体**：
```json
{
  "query": "文本内容"
}
```

#### 5.21.2 语义搜索

```
POST /api/v1/graph/semantic-search
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.21.3 读取文件

```
POST /api/v1/graph/read-file
```

**请求体**：
```json
{
  "filePath": "/path/to/file"
}
```

#### 5.21.4 从文本生成

```
POST /api/v1/graph/generate-from-text
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.21.5 构建图谱

```
POST /api/v1/graph/build
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.21.6 构建限制

```
GET /api/v1/graph/build-limit
```

#### 5.21.7 获取节点

```
POST /api/v1/graph/nodes
```

**请求体**：
```json
{
  "filter": {...}
}
```

#### 5.21.8 获取边

```
POST /api/v1/graph/edges
```

**请求体**：
```json
{
  "filter": {...}
}
```

#### 5.21.9 搜索

```
POST /api/v1/graph/search
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.21.10 获取邻居

```
POST /api/v1/graph/neighbors
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.21.11 获取子图

```
POST /api/v1/graph/subgraph
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.21.12 获取差距详情

```
POST /api/v1/graph/gap-detail
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.21.13 解决冲突

```
POST /api/v1/graph/conflict-resolve
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.21.14 仲裁冲突

```
POST /api/v1/graph/conflict-arbitrate
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.21.15 健康报告

```
GET /api/v1/graph/health-report
```

#### 5.21.16 过期审查

```
POST /api/v1/graph/outdated-review
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.21.17 统计

```
GET /api/v1/graph/stats
```

---

### 5.22 数据库操作 API

#### 5.22.1 获取任务

```
GET /api/v1/db/tasks
```

#### 5.22.2 保存任务

```
POST /api/v1/db/tasks
```

**请求体**：
```json
{
  "tasks": [...]
}
```

#### 5.22.3 获取统计

```
GET /api/v1/db/stats
```

#### 5.22.4 创建备份

```
POST /api/v1/db/backup
```

#### 5.22.5 列出备份

```
GET /api/v1/db/backups
```

#### 5.22.6 恢复备份

```
POST /api/v1/db/restore-backup
```

**请求体**：
```json
{
  "backupPath": "/path/to/backup"
}
```

#### 5.22.7 导出数据

```
POST /api/v1/db/export
```

#### 5.22.8 导入数据

```
POST /api/v1/db/import
```

**请求体**：
```json
{
  "jsonString": "{...}"
}
```

#### 5.22.9 打开子窗口

```
POST /api/v1/db/open-child-window/:type
```

---

### 5.23 本地文件 API

#### 5.23.1 索引文件

```
POST /api/v1/files/index
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.23.2 搜索文件

```
POST /api/v1/files/search
```

**请求体**：
```json
{
  "params": {"query": "关键词"}
}
```

#### 5.23.3 获取索引状态

```
GET /api/v1/files/index-status
```

#### 5.23.4 打开文件

```
POST /api/v1/files/open
```

**请求体**：
```json
{
  "filePath": "/path/to/file"
}
```

#### 5.23.5 在文件夹中显示

```
POST /api/v1/files/reveal
```

**请求体**：
```json
{
  "filePath": "/path/to/file"
}
```

#### 5.23.6 选择目录

```
POST /api/v1/files/select-directory
```

#### 5.23.7 获取自定义目录

```
GET /api/v1/files/custom-dirs
```

#### 5.23.8 添加自定义目录

```
POST /api/v1/files/custom-dirs
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.23.9 删除自定义目录

```
POST /api/v1/files/custom-dirs/remove
```

**请求体**：
```json
{
  "data": {...}
}
```

---

### 5.24 洞察模块 API

#### 5.24.1 获取激活

```
GET /api/v1/insight/activations
```

#### 5.24.2 分析差距

```
POST /api/v1/insight/analyze-gaps
```

#### 5.24.3 获取演变

```
GET /api/v1/insight/evolutions
```

#### 5.24.4 获取冲突

```
GET /api/v1/insight/conflicts
```

#### 5.24.5 检测冲突

```
POST /api/v1/insight/detect-conflicts
```

#### 5.24.6 解决冲突

```
POST /api/v1/insight/resolve-conflict
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.24.7 开始任务

```
POST /api/v1/insight/task/start
```

**请求体**：
```json
{
  "taskType": "analyze-gaps"
}
```

#### 5.24.8 获取缓存结果

```
POST /api/v1/insight/task/cached-result
```

**请求体**：
```json
{
  "taskType": "analyze-gaps"
}
```

#### 5.24.9 获取任务状态

```
POST /api/v1/insight/task/status
```

**请求体**：
```json
{
  "taskType": "analyze-gaps"
}
```

#### 5.24.10 注入测试数据

```
POST /api/v1/insight/inject-test-data
```

**请求体**：
```json
{
  "data": {...}
}
```

---

### 5.25 多模态 API

#### 5.25.1 导入

```
POST /api/v1/multimodal/import
```

**请求体**：
```json
{
  "options": {...}
}
```

#### 5.25.2 保存 URL

```
POST /api/v1/multimodal/save-url
```

**请求体**：
```json
{
  "options": {...}
}
```

#### 5.25.3 保存会议

```
POST /api/v1/multimodal/save-meeting
```

**请求体**：
```json
{
  "options": {...}
}
```

#### 5.25.4 列出

```
POST /api/v1/multimodal/list
```

**请求体**：
```json
{
  "options": {...}
}
```

#### 5.25.5 获取详情

```
GET /api/v1/multimodal/:id
```

#### 5.25.6 删除

```
DELETE /api/v1/multimodal/:id
```

#### 5.25.7 更新

```
PUT /api/v1/multimodal/:id
```

**请求体**：
```json
{
  "updates": {...}
}
```

#### 5.25.8 获取统计

```
GET /api/v1/multimodal/stats
```

#### 5.25.9 处理

```
POST /api/v1/multimodal/:id/process
```

#### 5.25.10 生成书籍

```
POST /api/v1/multimodal/generate-book
```

**请求体**：
```json
{
  "options": {...}
}
```

#### 5.25.11 获取书籍列表

```
GET /api/v1/multimodal/books
```

#### 5.25.12 打开文件

```
POST /api/v1/multimodal/open-file/:id
```

#### 5.25.13 选择文件

```
POST /api/v1/multimodal/pick-files
```

#### 5.25.14 导入缓冲区

```
POST /api/v1/multimodal/import-buffer
```

**请求体**：
```json
{
  "options": {...}
}
```

---

### 5.26 关系人脉图谱 API

#### 5.26.1 获取所有关系

```
GET /api/v1/relationship
```

#### 5.26.2 AI 分析

```
POST /api/v1/relationship/ai-analyze
```

#### 5.26.3 AI 建议

```
POST /api/v1/relationship/ai-suggest
```

**请求体**：
```json
{
  "personName": "姓名"
}
```

#### 5.26.4 AI 推断关系

```
POST /api/v1/relationship/ai-infer-relations
```

#### 5.26.5 导入文本

```
POST /api/v1/relationship/import-text
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.26.6 合并导入

```
POST /api/v1/relationship/merge-imported
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.26.7 清除

```
POST /api/v1/relationship/clear
```

---

### 5.27 数据同步 API

#### 5.27.1 注册设备

```
POST /api/v1/sync/register-device
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.27.2 获取设备列表

```
GET /api/v1/sync/devices
```

#### 5.27.3 停用设备

```
POST /api/v1/sync/deactivate-device
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.27.4 全量同步

```
POST /api/v1/sync/full
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.27.5 推送

```
POST /api/v1/sync/push
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.27.6 拉取

```
POST /api/v1/sync/pull
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.27.7 解决冲突

```
POST /api/v1/sync/resolve
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.27.8 获取状态

```
GET /api/v1/sync/status
```

#### 5.27.9 上传笔记图片

```
POST /api/v1/sync/image/upload
```

**请求体**：
```json
{
  "localPath": "/path/to/image"
}
```

#### 5.27.10 下载笔记图片

```
POST /api/v1/sync/image/download
```

**请求体**：
```json
{
  "imageId": "image-id",
  "savePath": "/path/to/save"
}
```

#### 5.27.11 删除笔记图片

```
POST /api/v1/sync/image/delete/:imageId
```

#### 5.27.12 拉取笔记图片

```
POST /api/v1/sync/image/pull
```

**请求体**：
```json
{
  "deviceId": "device-id",
  "sinceRevision": 123
}
```

#### 5.27.13 批量获取图片元数据

```
POST /api/v1/sync/image/batch-meta
```

**请求体**：
```json
{
  "imageIds": ["id1", "id2"]
}
```

#### 5.27.14 列出笔记图片

```
POST /api/v1/sync/image/list
```

**请求体**：
```json
{
  "options": {...}
}
```

#### 5.27.15 绑定笔记图片

```
POST /api/v1/sync/image/bind
```

**请求体**：
```json
{
  "imageId": "image-id",
  "noteId": "note-id"
}
```

#### 5.27.16 同步会话

```
POST /api/v1/sync/conversations
```

**请求体**：
```json
{
  "options": {...}
}
```

#### 5.27.17 获取会话详情

```
GET /api/v1/sync/conversations/:convId
```

#### 5.27.18 获取会话消息

```
POST /api/v1/sync/conversations/:convId/messages
```

**请求体**：
```json
{
  "options": {...}
}
```

#### 5.27.19 追加会话消息

```
POST /api/v1/sync/conversations/:convId/messages/append
```

**请求体**：
```json
{
  "message": {...}
}
```

#### 5.27.20 更新会话

```
PUT /api/v1/sync/conversations/:convId
```

**请求体**：
```json
{
  "updates": {...}
}
```

#### 5.27.21 删除会话

```
DELETE /api/v1/sync/conversations/:convId
```

---

### 5.28 语音 ASR API

#### 5.28.1 获取配置

```
GET /api/v1/asr/config
```

#### 5.28.2 设置配置

```
POST /api/v1/asr/config
```

**请求体**：
```json
{
  "config": {...}
}
```

#### 5.28.3 检查麦克风权限

```
POST /api/v1/asr/check-permission
```

#### 5.28.4 开始识别

```
POST /api/v1/asr/start
```

**请求体**：
```json
{
  "params": {...}
}
```

#### 5.28.5 停止识别

```
POST /api/v1/asr/stop
```

#### 5.28.6 发送音频块

```
POST /api/v1/asr/audio-chunk
```

**请求体**：
```json
{
  "data": {...}
}
```

---

### 5.29 多任务并发 API

#### 5.29.1 开始任务

```
POST /api/v1/tasks/start
```

**请求体**：
```json
{
  "data": {...}
}
```

#### 5.29.2 停止任务

```
POST /api/v1/tasks/stop
```

**请求体**：
```json
{
  "taskId": "task-id"
}
```

#### 5.29.3 列出任务

```
GET /api/v1/tasks/list/:sessionId
```

---

### 5.30 智能分析 API

#### 5.30.1 提炼笔记生成文章

```
POST /api/v1/analyze/summarize-notes
```

**请求体**：
```json
{
  "category": "work",
  "limit": 20,
  "format": "markdown"
}
```

**响应示例**（立即返回）：
```json
{
  "success": true,
  "data": {
    "jobId": "job_summarize_1234567890",
    "status": "queued",
    "message": "任务已排队，正在生成摘要..."
  }
}
```

#### 5.30.2 查询任务状态

```
GET /api/v1/jobs/:jobId
```

#### 5.30.3 重新分类笔记

```
POST /api/v1/analyze/reclassify-notes
```

**请求体**：
```json
{
  "category": "general",
  "aiClassify": true
}
```

#### 5.30.4 分析待办任务

```
POST /api/v1/analyze/tasks
```

**请求体**：
```json
{
  "action": "prioritize",
  "limit": 10
}
```

#### 5.30.5 生成每日摘要

```
GET /api/v1/analyze/daily-summary?date=2026-07-07
```

---

## 六、安全考虑

### 6.1 访问控制

| 措施 | 说明 |
|------|------|
| CORS 限制 | 默认只允许 localhost/127.0.0.1 访问 |
| API Key | 所有请求需携带 `X-API-Key` 头 |
| 端口限制 | 默认 3001，可通过环境变量修改 |

### 6.2 数据保护

| 措施 | 说明 |
|------|------|
| 输入验证 | 所有输入进行类型和格式验证 |
| 路径安全 | 防止路径遍历攻击 |
| 速率限制 | 可配置请求频率限制 |

### 6.3 配置示例

```bash
# .env 文件
MEMORA_API_PORT=3001
MEMORA_API_KEY=your-secret-key-12345
```

---

## 七、使用示例

### 7.1 curl 示例

```bash
# 获取所有待办
curl -H "X-API-Key: memora-local-key" http://localhost:3001/api/v1/tasks

# 获取待办任务
curl -H "X-API-Key: memora-local-key" http://localhost:3001/api/v1/tasks?status=pending

# 创建任务
curl -X POST http://localhost:3001/api/v1/tasks \
  -H "X-API-Key: memora-local-key" \
  -H "Content-Type: application/json" \
  -d '{"title":"测试任务","description":"测试描述","status":"pending"}'

# 标记任务完成
curl -X POST http://localhost:3001/api/v1/tasks/task_1234567890/complete \
  -H "X-API-Key: memora-local-key"

# 获取所有笔记
curl -H "X-API-Key: memora-local-key" http://localhost:3001/api/v1/notes

# 修改笔记分类
curl -X POST http://localhost:3001/api/v1/notes/note_123/change-category \
  -H "X-API-Key: memora-local-key" \
  -H "Content-Type: application/json" \
  -d '{"category":"work"}'

# 搜索记忆
curl -X POST http://localhost:3001/api/v1/memories/search \
  -H "X-API-Key: memora-local-key" \
  -H "Content-Type: application/json" \
  -d '{"content":"项目进度","limit":5}'

# 异步生成摘要
curl -X POST http://localhost:3001/api/v1/analyze/summarize-notes \
  -H "X-API-Key: memora-local-key" \
  -H "Content-Type: application/json" \
  -d '{"category":"work","limit":10}'

# 查询任务状态
curl -H "X-API-Key: memora-local-key" http://localhost:3001/api/v1/jobs/job_summarize_1234567890
```

---

## 八、文件清单

| 文件 | 说明 |
|------|------|
| `src/server/api-server.js` | API 服务器主文件 |
| `main.js` | 启动/停止服务器 |
| `package.json` | 添加 express、cors 依赖 |

---

## 九、开发计划

### Phase 1：基础框架（2天）
- [ ] 创建 `api-server.js`
- [ ] 添加 express、cors 依赖
- [ ] 配置 CORS 和认证中间件
- [ ] 添加健康检查接口

### Phase 2：核心业务 API（3天）
- [ ] 待办任务 API
- [ ] 记事本 API
- [ ] 记忆系统 API

### Phase 3：AI/配置 API（3天）
- [ ] AI 配置 API
- [ ] Claude Code API
- [ ] Skill 管理 API
- [ ] ADP 配置 API

### Phase 4：知识/向量 API（3天）
- [ ] 知识系统 API
- [ ] 向量数据库 API
- [ ] 知识图谱 API

### Phase 5：其他模块 API（3天）
- [ ] 专家系统 API
- [ ] 认证系统 API
- [ ] 多模态 API
- [ ] 关系图谱 API

### Phase 6：智能分析与异步任务（2天）
- [ ] 异步任务队列
- [ ] 笔记摘要生成
- [ ] 重新分类
- [ ] 任务分析

### Phase 7：集成测试（2天）
- [ ] 端到端测试
- [ ] 文档完善

---

**文档版本**: v3.0  
**创建日期**: 2026-07-07  
**API 总数**: 约 260+ 个接口