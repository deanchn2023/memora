# Memora Web 应用转换设计方案

## 一、项目现状分析

### 1.1 架构概览

当前 Memora 是一个基于 Electron 的桌面应用，采用经典的主进程-渲染进程架构：

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron 主进程 (main.js)               │
│  ┌─────────────────┐ ┌─────────────────┐ ┌───────────────┐  │
│  │  文件系统操作     │ │  SQLite 数据库   │ │  剪贴板监控    │  │
│  │  (fs/exec)      │ │  (sql.js)       │ │  (clipboard)  │  │
│  └────────┬────────┘ └────────┬────────┘ └───────┬───────┘  │
│  ┌────────┴────────┐ ┌────────┴────────┐ ┌───────┴───────┐  │
│  │  BGE 嵌入模型    │ │  ZVec 向量索引   │ │  Claude Agent │  │
│  │  (transformers) │ │  (@zvec/zvec)   │ │  SDK          │  │
│  └────────┬────────┘ └────────┬────────┘ └───────┬───────┘  │
│           └───────────────────┼───────────────────┘          │
│                               │ IPC 通道                     │
└───────────────────────────────┼─────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────┐
│                   渲染进程 (src/index.html + app.js)          │
│  ┌─────────────────┐ ┌─────────────────┐ ┌───────────────┐  │
│  │  UI 组件        │ │  业务逻辑        │ │  状态管理      │  │
│  │  (HTML/CSS)     │ │  (app.js)       │ │  (store.js)   │  │
│  └─────────────────┘ └─────────────────┘ └───────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 核心依赖分析

| 依赖 | 用途 | Web 兼容性 | 迁移方案 |
|------|------|-----------|----------|
| `electron` | 桌面环境 | ❌ 不兼容 | 完全移除 |
| `@xenova/transformers` | BGE 本地嵌入 | ⚠️ 部分兼容 | 迁移到服务端或使用 WASM |
| `@zvec/zvec` | 向量索引 | ❌ 不兼容 | 替换为服务端向量数据库 |
| `sql.js` | SQLite | ⚠️ 部分兼容 | 替换为 PostgreSQL |
| `@anthropic-ai/claude-agent-sdk` | Claude Agent | ✅ 兼容 | **服务端代理调用，绝不暴露 API Key** |
| `form-data` | 文件上传 | ✅ 兼容 | 保留 |
| `ws` | WebSocket | ✅ 兼容 | 保留 |
| `uuid` | 唯一ID | ✅ 兼容 | 保留 |

### 1.3 IPC 通道统计

从 `preload.js` 统计，共有 **150+** 个 IPC 通道，按功能分类：

| 模块 | 通道数量 | 复杂度 |
|------|---------|--------|
| 认证 (auth) | 12 | 高 |
| 记忆 (memory) | 15 | 中 |
| 记事本 (notebook) | 14 | 中 |
| 知识图谱 (knowledge) | 30+ | 高 |
| 向量数据库 (vector) | 12 | 高 |
| 专家系统 (experts) | 15 | 中 |
| 剪贴板 (clipboard) | 10 | 中 |
| 同步 (sync) | 25+ | 高 |
| AI/Agent | 20+ | 高 |

---

## 二、架构设计

### 2.1 目标架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端层 (Web App)                          │
│  ┌─────────────────┐ ┌─────────────────┐ ┌───────────────────┐  │
│  │  React/Vue 组件  │ │  HTTP/WebSocket │ │  状态管理          │  │
│  │  (原HTML/CSS)   │ │  API 调用       │ │  (Pinia/Zustand)  │  │
│  └────────┬────────┘ └────────┬────────┘ └─────────┬───────────┘  │
└───────────┼───────────────────┼─────────────────────┼─────────────┘
            │                   │                     │
            ▼                   ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API 网关 (Nginx/Caddy)                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  HTTPS 终止 / WebSocket 代理 / 静态文件服务 / 限流        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    认证服务      │ │   API 服务       │ │  向量嵌入服务    │
│  (Auth Service) │ │ (REST API)      │ │ (Embedding)     │
│  JWT/OAuth2     │ │ Express/Fastify │ │  BGE Model      │
└─────────────────┘ └────────┬────────┘ └────────┬────────┘
                             │                   │
            ┌────────────────┴───────────────────┴─────────┐
            ▼                                              ▼
    ┌──────────────┐                              ┌──────────────┐
    │ PostgreSQL   │                              │ 向量数据库    │
    │ (主数据)     │                              │ (pgvector)   │
    └──────────────┘                              └──────────────┘
            │                                              │
            ▼                                              ▼
    ┌──────────────┐                              ┌──────────────┐
    │ 对象存储      │                              │ Redis 缓存    │
    │ (S3/MinIO)   │                              │ (会话/索引)   │
    └──────────────┘                              └──────────────┘
```

### 2.2 技术栈选择

**推荐方案 A：无框架迁移（低成本、高复用）**

| 层次 | 技术 | 理由 |
|------|------|------|
| 前端 | **原生 HTML/CSS/JS** | 当前代码为原生 JS，直接复用 80-90% |
| HTTP 客户端 | Axios | 轻量，支持拦截器 |
| 路由 | 简单的 SPA 路由（自定义） | 无需复杂路由框架 |
| 状态管理 | 现有 store.js 适配 | 最小改动 |

**方案 B：Vue 3 框架（推荐用于长期维护）**

| 层次 | 技术 | 理由 |
|------|------|------|
| 前端框架 | Vue 3 + Vite | 渐进式迁移，组件化管理 |
| 状态管理 | Pinia | 轻量，与 Vue 3 无缝集成 |
| 路由 | Vue Router | 单页应用路由 |
| HTTP 客户端 | Axios | 支持拦截器、取消请求 |

**服务端（两种方案共用）**

| 层次 | 技术 | 理由 |
|------|------|------|
| 服务端 | Node.js + Express | 保持 JS 技术栈一致，学习成本低 |
| 主数据库 | PostgreSQL + pgvector | 支持向量检索，生态成熟 |
| 向量存储 | pgvector | 与主数据库统一，简化部署 |
| 缓存 | Redis | 会话管理、热点数据缓存 |
| 对象存储 | MinIO/S3 | 图片、文件存储 |
| 部署 | Docker + Docker Compose | 开发/生产环境一致 |

**推荐策略**：优先选择方案 A（无框架）完成 MVP，后续根据需要逐步引入 Vue 3 进行组件化重构。

---

## 三、核心模块迁移方案

### 3.1 剪贴板监控（最大挑战）

**问题**：浏览器无法直接访问系统剪贴板

**解决方案**：

#### 方案 A：浏览器扩展（推荐）

```
┌─────────────────────────────────────────────────────────┐
│  浏览器环境                                               │
│  ┌──────────────┐    Clipboard API    ┌──────────────┐  │
│  │  Web App     │◄───────────────────►│  Browser     │  │
│  │              │   WebSocket 推送    │  Extension   │  │
│  └──────────────┘                     └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**优点**：
- 用户体验好，自动监控
- 可访问剪贴板内容
- 可检测系统空闲状态

**缺点**：
- 需要额外安装扩展
- 浏览器兼容性需要测试

#### 方案 B：手动粘贴模式（基础）

**优点**：
- 零依赖，开箱即用
- 跨浏览器兼容

**缺点**：
- 需要用户手动粘贴
- 无法自动监控

#### 方案 C：桌面伴侣程序（完整）

```
┌──────────────┐      WebSocket      ┌──────────────┐
│  桌面伴侣     │◄──────────────────►│  Web App     │
│  (Electron)  │   剪贴板数据推送    │  (Browser)   │
└──────────────┘                     └──────────────┘
```

**优点**：
- 保留完整剪贴板功能
- 可检测系统状态

**缺点**：
- 需要用户安装桌面程序
- 增加部署复杂度

**推荐策略**：先实现方案 B（MVP），再逐步推出方案 A 和方案 C

### 3.2 BGE 本地嵌入模型

**问题**：`@xenova/transformers` 在浏览器中可用但性能受限

**解决方案**：

| 方案 | 架构 | 适用场景 |
|------|------|----------|
| 服务端推理 | 模型部署在后端 | 生产环境，需要稳定性 |
| WASM 浏览器推理 | 模型加载到浏览器 | 离线使用，隐私敏感 |
| 混合模式 | 优先服务端，离线时降级到 WASM | 最佳体验 |

**推荐方案**：服务端推理 + WASM 离线支持

### 3.3 SQLite → PostgreSQL 迁移

**数据库结构映射**：

| Electron 存储 | Web 存储 | 说明 |
|--------------|---------|------|
| `memora-data.json` | PostgreSQL `memories` 表 | 记忆数据 |
| `notes.json` | PostgreSQL `notes` 表 | 记事本数据 |
| `knowledge-graph.db` | PostgreSQL `graph_nodes/edges` 表 | 知识图谱 |
| `vector_db/` | PostgreSQL `pgvector` 扩展 | 向量索引 |
| `user-data/` | 对象存储 (MinIO) | 文件、图片 |

**多租户设计**：
- 每张业务表添加 `user_id` 字段
- 数据库层面行级隔离
- API 层面自动注入用户上下文

### 3.4 IPC 通道 → REST API 映射

**150+ IPC 通道 → ~30 个 REST 资源端点**

通过资源分组，大幅简化 API 设计：

| 资源 | 端点 | 覆盖 IPC 通道 |
|------|------|---------------|
| `/api/auth` | POST /login, POST /register, GET /profile | auth:* (12个) |
| `/api/memories` | GET/POST/PUT/DELETE | memory:* (15个) |
| `/api/notes` | GET/POST/PUT/DELETE, GET /categories | notebook:* (14个) |
| `/api/knowledge/atoms` | CRUD + cluster | knowledge:* atoms (10个) |
| `/api/knowledge/clusters` | CRUD + auto-cluster | knowledge:* clusters (8个) |
| `/api/knowledge/articles` | CRUD + generate | knowledge:* articles (5个) |
| `/api/vectors` | POST /search, POST /rebuild | vector:* (12个) |
| `/api/experts` | CRUD + chat | experts:* (15个) |
| `/api/graph` | POST /build, GET /nodes, GET /edges | graph:* (15个) |
| `/api/clipboard` | POST /analyze, GET /config | clipboard:* (10个) |
| `/api/ai/agent` | POST /invoke | agent:* (5个) |
| `/api/ai/llm` | POST /chat, POST /analyze | AI/LLM 调用 (10个) |
| `/api/sync` | POST /push, POST /pull | sync:* (8个) |
| `/api/audit` | GET /logs, GET /stats | audit:* (5个) |

**映射规则**：

```javascript
// IPC 调用模式
window.electronAPI.getMemories().then(data => { ... })

// REST API 调用模式
api.get('/api/memories').then(res => { ... })
```

**API 设计规范**：

| HTTP 方法 | 路径 | 对应 IPC |
|-----------|------|----------|
| GET | `/api/memories` | `get-memories` |
| POST | `/api/memories` | `add-memory` |
| PUT | `/api/memories/:id` | `update-memory` |
| DELETE | `/api/memories/:id` | `delete-memory` |

**流式数据处理**（如 AI 响应）：
- 使用 Server-Sent Events (SSE)
- 保持与原 IPC 事件驱动一致的体验

---

## 四、工作量评估

### 4.1 模块迁移工作量

| 模块 | 工作量 | 优先级 | 说明 |
|------|--------|--------|------|
| **认证系统** | 1-2 天 | P0 | **复用 v2.0-auth 分支现有认证系统**，无需重新开发 |
| **用户数据存储** | 5-7 天 | P0 | PostgreSQL 表设计、数据迁移 |
| **向量数据库** | 3-4 天 | P0 | pgvector 配置、嵌入服务 |
| **REST API 层** | **5-7 天** | P0 | **~30 个资源端点**（原 150+ IPC 通道分组合并） |
| **前端适配** | **3-5 天** | P0 | **无框架方案**：API 适配器 + store.js 改造 |
| **剪贴板功能** | 5-7 天 | P1 | 手动粘贴 + 扩展方案 |
| **AI/Agent 调用** | 3-4 天 | P1 | **服务端代理调用**，保护 API Key |
| **文件上传/下载** | 2-3 天 | P1 | 对象存储集成 |
| **实时同步** | 5-7 天 | P2 | WebSocket/SSE 推送 |
| **部署配置** | 2-3 天 | P2 | Docker、CI/CD |

### 4.2 总计工作量

| 阶段 | 时间 | 产出 |
|------|------|------|
| Phase 1: 基础架构 | 1-2 周 | 认证（复用）、数据库、API 框架 |
| Phase 2: 核心功能 | 1-2 周 | 记忆、记事本、知识图谱（API 分组合并） |
| Phase 3: AI 能力 | 1-2 周 | 向量检索、AI 调用（服务端代理） |
| Phase 4: 高级功能 | 1-2 周 | 剪贴板、实时同步 |
| Phase 5: 部署上线 | 1 周 | Docker、CI/CD、测试 |
| **总计** | **4-8 周** | 完整 Web 应用（优化后） |

**工作量优化说明**：
1. 认证系统复用现有 v2.0-auth 分支，节省 2-3 天
2. API 端点从 150+ 合并到 ~30，节省 5-7 天
3. 无框架前端方案，节省 4-5 天
4. 总计节省约 2-3 周

### 4.3 代码复用率评估

| 代码类型 | 复用率 | 说明 |
|----------|--------|------|
| HTML/CSS | 80-90% | 样式基本可直接复用 |
| 业务逻辑 | 50-60% | 需要适配 API 调用 |
| 数据模型 | 70-80% | 结构基本一致 |
| Electron 专属 | 0% | 需要完全重写 |

---

## 五、实施步骤

### 5.1 Phase 1: 基础架构（第 1-2 周）

#### 1.1 项目初始化

```bash
# 创建项目结构
mkdir memora-web && cd memora-web
npm create vite@6.5.0 . -- --template vue
npm install axios pinia vue-router

# 服务端依赖
mkdir server && cd server
npm init -y
npm install express cors pg pgvector redis jsonwebtoken bcrypt
```

#### 1.2 数据库设计

创建 PostgreSQL 表结构：
- `users` - 用户信息
- `memories` - 记忆数据
- `notes` - 记事本
- `graph_nodes` - 图谱节点
- `graph_edges` - 图谱边
- `vector_index` - 向量索引

#### 1.3 认证系统

实现 JWT 认证：
- 登录/注册接口
- 密码加密 (bcrypt)
- Token 刷新机制
- 用户上下文中间件

### 5.2 Phase 2: 核心功能（第 3-5 周）

#### 2.1 API 层实现

按模块实现 REST API：
- 记忆模块 CRUD
- 记事本模块 CRUD
- 知识图谱模块

#### 2.2 前端组件化

将原生 JS 代码迁移到 Vue 组件：
- 侧边栏导航
- 记忆列表
- 记事本列表
- 知识图谱视图

#### 2.3 API 适配器

创建统一的 API 调用层，替代 IPC：

```javascript
// src/api/index.js
import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export const memoryAPI = {
  getAll: () => api.get('/memories'),
  add: (data) => api.post('/memories', data),
  update: (id, data) => api.put(`/memories/${id}`, data),
  delete: (id) => api.delete(`/memories/${id}`),
}
```

### 5.3 Phase 3: AI 能力（第 6-7 周）

#### 3.1 向量嵌入服务

部署 BGE 模型到服务端：

```javascript
// server/services/embedding.js
import { pipeline } from '@xenova/transformers'

class EmbeddingService {
  constructor() {
    this.model = null
  }
  
  async init() {
    this.model = await pipeline(
      'feature-extraction', 
      'BAAI/bge-small-zh-v1.5'
    )
  }
  
  async embed(text) {
    if (!this.model) await this.init()
    const output = await this.model(text, { pooling: 'mean' })
    return output.data
  }
}

export const embeddingService = new EmbeddingService()
```

#### 3.2 pgvector 集成

```sql
-- 安装扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 创建向量表
CREATE TABLE memories_vec (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  embedding vector(512),
  content TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 创建索引
CREATE INDEX memories_vec_idx ON memories_vec 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

#### 3.3 Claude Agent 集成（服务端代理模式）

**安全警告**：AI 服务的 API Key 绝不能在前端暴露，必须通过服务端代理调用。

**服务端代理实现**：

```javascript
// server/routes/ai.js
import { ClaudeAgent } from '@anthropic-ai/claude-agent-sdk'

const router = express.Router()

// 从环境变量读取 API Key（绝不在前端暴露）
const agent = new ClaudeAgent({
  apiKey: process.env.CLAUDE_API_KEY,
})

// 代理 AI 调用接口
router.post('/agent/invoke', async (req, res) => {
  const { query, context } = req.body
  
  try {
    const response = await agent.invoke({
      messages: [{ role: 'user', content: query }],
      context,
    })
    res.json(response)
  } catch (error) {
    console.error('AI 调用失败:', error)
    res.status(500).json({ error: 'AI 服务暂时不可用' })
  }
})

// SSE 流式响应接口
router.get('/agent/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  
  const { query } = req.query
  
  try {
    const stream = await agent.stream({
      messages: [{ role: 'user', content: query }],
    })
    
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`)
    res.end()
  }
})

export default router
```

**前端调用**：

```javascript
// src/api/ai.js
import axios from 'axios'

export const aiAPI = {
  invokeAgent: (query, context) => 
    axios.post('/api/ai/agent/invoke', { query, context }),
  
  streamAgent: (query) => 
    new EventSource(`/api/ai/agent/stream?query=${encodeURIComponent(query)}`),
}
```

### 5.4 Phase 4: 高级功能（第 8-9 周）

#### 4.1 剪贴板功能

实现手动粘贴模式：

```html
<!-- src/components/ClipboardInput.vue -->
<template>
  <div class="clipboard-input">
    <textarea 
      v-model="content"
      placeholder="粘贴内容到此处..."
      @paste="handlePaste"
    ></textarea>
    <button @click="analyze">分析</button>
  </div>
</template>
```

#### 4.2 实时同步

使用 WebSocket 实现实时推送：

```javascript
// server/ws.js
import WebSocket from 'ws'

const wss = new WebSocket.Server({ port: 8080 })

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    // 广播消息到所有客户端
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(data)
      }
    })
  })
})
```

### 5.5 Phase 5: 部署上线（第 10 周）

#### 5.1 Docker 部署

```yaml
# docker-compose.yml
version: '3.8'
services:
  api:
    build: ./server
    ports:
      - '3000:3000'
    depends_on:
      - db
      - redis
      - minio
  
  frontend:
    build: ./
    ports:
      - '80:80'
  
  db:
    image: ankane/pgvector
    ports:
      - '5432:5432'
    environment:
      POSTGRES_PASSWORD: postgres
  
  redis:
    image: redis:7
    ports:
      - '6379:6379'
  
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports:
      - '9000:9000'
      - '9001:9001'
```

#### 5.2 CI/CD

配置 GitHub Actions：

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install && npm run build
      - uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /opt/memora-web
            git pull
            docker-compose up -d --build
```

---

## 六、关键风险与应对策略

### 6.1 风险清单

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|----------|
| 剪贴板功能受限 | 高 | 中 | 提供多种方案，先实现手动粘贴 |
| 向量嵌入性能 | 中 | 中 | 服务端推理 + 缓存策略 |
| 数据库迁移复杂度 | 中 | 高 | 设计迁移脚本，逐步切换 |
| 前端重构工作量 | 高 | 高 | 渐进式迁移，保留原生代码 |
| 部署环境差异 | 中 | 中 | Docker 标准化环境 |

### 6.2 渐进式迁移策略

```
阶段 1: 双端并行
├── Electron 桌面端（现有）
└── Web 端（基础功能）

阶段 2: 功能对齐
├── Electron 桌面端（完整功能）
└── Web 端（核心功能对齐）

阶段 3: 统一架构
└── 共享 API 层，双端共用后端
```

---

## 七、里程碑

| 里程碑 | 时间 | 交付物 |
|--------|------|--------|
| M1 | 第 2 周 | 可登录的 Web 应用框架 |
| M2 | 第 5 周 | 核心功能可用（记忆、记事本） |
| M3 | 第 7 周 | AI 能力集成（向量检索、Agent） |
| M4 | 第 9 周 | 高级功能完成（剪贴板、同步） |
| M5 | 第 10 周 | 生产环境部署 |

---

## 八、结论

### 8.1 可行性

**转换可行**，主要挑战在于：
1. 剪贴板监控需要浏览器扩展或桌面伴侣
2. 本地嵌入模型需要迁移到服务端
3. 本地数据库需要转为多租户架构

### 8.2 推荐路径

1. **MVP 阶段**：先实现核心功能（认证、记忆、记事本），剪贴板使用手动粘贴
2. **增强阶段**：添加向量检索、AI 调用、剪贴板浏览器扩展
3. **完整阶段**：添加实时同步、桌面伴侣程序

### 8.3 预期收益

| 维度 | 收益 |
|------|------|
| 可用性 | 无需安装，浏览器直接访问 |
| 跨平台 | 任何设备均可使用 |
| 多端同步 | 数据自动同步到云端 |
| 维护成本 | 统一代码库，一次维护 |
| 扩展性 | 服务端架构更易于扩展 |
