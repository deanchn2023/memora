# Memora 综合优化设计方案

## 一、项目概述

### 1.1 项目背景

Memora 是一款基于 Electron 的 AI 驱动个人记忆与事项管理助手，当前版本为 **v3.1.0**。本方案整合了以下三大核心需求：

| 需求维度 | 核心目标 |
|----------|----------|
| **Web应用转换** | 将桌面应用迁移到浏览器，降低使用门槛 |
| **市场调研** | 分析用户痛点，明确产品差异化定位 |
| **产品优化** | 从被动搜索转向主动智能，提升用户体验 |

### 1.2 核心痛点与优化方向

基于市场调研分析，当前产品存在以下核心痛点：

| 痛点 | 优化方向 | 优先级 |
|------|----------|--------|
| AI帮你"制造数字垃圾"，整理成本高 | 主动记忆推送，AI自动整理 | **P0** |
| 记了上千条笔记，需要时一条也找不到 | 记忆分层管理，精准检索 | **P0** |
| 信息分散在多平台，收集困难 | 企业微信Bot + 浏览器扩展 | **P1** |
| AI只是"搜索框"，不是"大脑" | Agentic工作流，智能任务执行 | **P2** |

### 1.3 设计原则

1. **Capture优先**：降低记录门槛，整理交给AI
2. **主动智能**：从"被动存储+主动搜索"转向"主动捕获+主动推送"
3. **本地优先**：数据隐私保护，离线可用
4. **渐进增强**：基于现有代码演进，而非重写
5. **合规安全**：绝不暴露API Key，使用企业微信合规方案

### 1.4 优化路径图

```
阶段1 (P0)                    阶段2 (P1)                  阶段3 (P2)
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│ 主动记忆推送     │  →      │ 企业微信Bot收集  │  →      │ Agentic工作流    │
│ Right Panel     │          │ 浏览器扩展      │          │ 智能任务执行     │
├─────────────────┤          └─────────────────┘          └─────────────────┘
│ 记忆分层管理     │
│ 事实/工作/偏好   │
└─────────────────┘
```

---

## 二、市场分析与产品定位

### 2.1 市场规模与增长

| 市场 | 2025年 | 2030年预测 | CAGR |
|------|--------|-----------|------|
| AI个人知识库 | 16.5亿美元 | 61.5亿美元 | 30.3% |
| AI笔记软件 | 252.3亿元 | 597.4亿元 | 13.0% |
| 智能知识管理 | 480亿美元(2023) | 1120亿美元(2027) | 23.5% |

**关键洞察**：市场正处于高速增长期，复合年增长率超过20%，AI驱动的知识管理工具需求强劲。

### 2.2 用户核心痛点

**核心矛盾**："AI越能干，你的知识管理越崩"

| 痛点 | 描述 |
|------|------|
| 产出增加 | AI帮你干活的同时，也帮你"制造了更多数字垃圾" |
| 整理成本高 | 分类体系需要持续维护，三个月后分类废弃 |
| 期望被抬高 | 习惯了AI对话的自然语言搜索，回到文件夹会失望 |
| 找不到信息 | "记了上千条笔记，需要时一条也找不到" |

### 2.3 竞品差异化定位

| 产品 | 定位 | 局限 | Memora优势 |
|------|------|------|------------|
| Notion AI | 全能工作空间 | 太重，离线无法用 | ✅ 本地优先，轻量 |
| Obsidian | 本地优先笔记 | 配置门槛高 | ✅ AI原生，开箱即用 |
| Mem | AI原生笔记 | 编辑器功能弱 | ✅ 剪贴板自动监控 |
| Evernote | 老牌笔记 | 功能迭代慢 | ✅ 知识图谱+多模态 |

### 2.4 Memora 独特价值

- ✅ 剪贴板自动监控（主动捕获）
- ✅ 多模态支持（文字、语音、文件）
- ✅ 本地嵌入模型（BGE，不依赖云端）
- ✅ 知识图谱（实体关系可视化）
- ✅ 专家系统（AI Agent角色扮演）
- ✅ 番茄钟等效率工具集成

---

## 三、架构设计

### 3.1 当前架构（Electron桌面应用）

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

### 3.2 目标架构（Web应用）

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端层 (Web App)                          │
│  ┌─────────────────┐ ┌─────────────────┐ ┌───────────────────┐  │
│  │  原生HTML/CSS/JS │ │  HTTP/WebSocket │ │  状态管理          │  │
│  │  (复用80-90%)   │ │  API 调用       │ │  (store.js适配)   │  │
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

### 3.3 技术栈选择

**推荐方案：无框架迁移（低成本、高复用）**

| 层次 | 技术 | 理由 |
|------|------|------|
| 前端 | **原生 HTML/CSS/JS** | 当前代码为原生 JS，直接复用 80-90% |
| HTTP 客户端 | Axios | 轻量，支持拦截器 |
| 路由 | 简单的 SPA 路由（自定义） | 无需复杂路由框架 |
| 状态管理 | 现有 store.js 适配 | 最小改动 |
| 服务端 | Node.js + Express | 保持 JS 技术栈一致 |
| 主数据库 | PostgreSQL + pgvector | 支持向量检索，生态成熟 |
| 缓存 | Redis | 会话管理、热点数据缓存 |
| 对象存储 | MinIO/S3 | 图片、文件存储 |
| 部署 | Docker + Docker Compose | 开发/生产环境一致 |

### 3.4 核心依赖迁移方案

| 依赖 | 用途 | Web兼容性 | 迁移方案 |
|------|------|-----------|----------|
| `electron` | 桌面环境 | ❌ | 完全移除 |
| `@xenova/transformers` | BGE本地嵌入 | ⚠️ | 服务端推理 + WASM离线 |
| `@zvec/zvec` | 向量索引 | ❌ | 替换为pgvector |
| `sql.js` | SQLite | ⚠️ | 替换为PostgreSQL |
| `@anthropic-ai/claude-agent-sdk` | Claude Agent | ✅ | **服务端代理调用，绝不暴露API Key** |

---

## 四、核心优化模块设计

### 4.1 P0：主动记忆推送（Right Panel）

#### 4.1.1 设计理念

参考 Mem 的 Right Panel 和 Granola 的 bullets-to-prompts 模式，在用户输入时主动推送相关记忆。

**交互流程**：
```
用户在聊天输入框输入 → AI分析上下文 → 向量检索相关记忆 → Right Panel展示
                                              ↓
                                    用户点击记忆 → 自动插入到对话中
```

#### 4.1.2 数据模型

```json
{
  "id": "mem-xxx",
  "type": "memory|notebook|task|clipboard",
  "title": "记忆标题",
  "preview": "内容预览（前100字）",
  "score": 0.95,
  "source": "clipboard|manual|wechat",
  "createdAt": "2026-06-27T10:00:00Z",
  "tags": ["项目A", "会议"],
  "layer": "fact|work|preference"
}
```

#### 4.1.3 API接口（扩展IPC通道）

```javascript
// preload.js - 扩展现有通道
contextBridge.exposeInMainWorld('electronAPI', {
  vectorSearchContext: (query, context, limit = 5) => 
    ipcRenderer.invoke('vector:search-context', { query, context, limit }),
  
  onContextUpdate: (callback) => {
    ipcRenderer.on('vector:context-update', (event, results) => callback(results));
  },
});
```

#### 4.1.4 前端组件设计

```html
<!-- src/index.html - 在聊天区域右侧添加 -->
<div id="chat-container" class="chat-container">
  <div class="chat-area">...</div>
  
  <div id="context-panel" class="context-panel hidden">
    <div class="context-header">
      <span class="context-title">相关记忆</span>
      <button class="context-toggle" id="context-toggle-btn">
        <svg class="icon">...</svg>
      </button>
    </div>
    
    <div class="context-filter">
      <button class="filter-btn active" data-filter="all">全部</button>
      <button class="filter-btn" data-filter="memory">记忆</button>
      <button class="filter-btn" data-filter="notebook">记事本</button>
      <button class="filter-btn" data-filter="task">任务</button>
    </div>
    
    <div class="context-list" id="context-list"></div>
    <div class="context-empty" id="context-empty">
      <svg class="empty-icon">...</svg>
      <span>暂无相关记忆</span>
    </div>
  </div>
</div>
```

#### 4.1.5 业务逻辑

**主动推送触发时机**：

| 触发时机 | 场景 | 检索策略 |
|----------|------|----------|
| 输入框变化 | 用户输入3个以上字符 | 实时向量搜索（300ms防抖） |
| 新建会话 | 用户打开新聊天 | 推荐历史相关记忆 |
| 消息发送 | 用户发送消息后 | 基于对话上下文检索 |
| 剪贴板变化 | 用户复制内容 | 基于剪贴板内容匹配 |

**实现代码**（扩展app.js）：

```javascript
class App {
  _contextPanelOpen = false;
  _contextResults = [];
  _contextSearchTimeout = null;
  
  init() {
    this._initContextPanel();
  }
  
  _initContextPanel() {
    const panel = document.getElementById('context-panel');
    const toggleBtn = document.getElementById('context-toggle-btn');
    
    toggleBtn.addEventListener('click', () => {
      this._contextPanelOpen = !this._contextPanelOpen;
      panel.classList.toggle('hidden', !this._contextPanelOpen);
    });
    
    const input = document.getElementById('chat-input');
    input.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (query.length >= 3) {
        clearTimeout(this._contextSearchTimeout);
        this._contextSearchTimeout = setTimeout(() => {
          this._searchContext(query);
        }, 300);
      }
    });
  }
  
  async _searchContext(query) {
    const currentSession = this._chatSessions.find(
      s => s.id === this._activeSessionId
    );
    const context = currentSession?.messages?.slice(-5) || [];
    
    const results = await window.electronAPI.vectorSearchContext(query, context, 5);
    this._contextResults = results;
    this._renderContextPanel(results);
  }
  
  _renderContextPanel(results) {
    const list = document.getElementById('context-list');
    const empty = document.getElementById('context-empty');
    
    if (!results || results.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    
    empty.style.display = 'none';
    list.innerHTML = results.map(mem => `
      <div class="context-card" data-id="${mem.id}">
        <div class="card-header">
          <span class="card-type">${this._getTypeLabel(mem.type)}</span>
          <span class="card-score">${Math.round(mem.score * 100)}%</span>
        </div>
        <div class="card-title">${mem.title}</div>
        <div class="card-preview">${mem.preview}</div>
        <div class="card-tags">
          ${mem.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
        <div class="card-actions">
          <button class="action-btn" data-action="insert">插入</button>
          <button class="action-btn" data-action="view">查看</button>
        </div>
      </div>
    `).join('');
  }
}
```

#### 4.1.6 实现步骤

| 步骤 | 内容 | 涉及文件 | 预估工时 |
|------|------|----------|----------|
| 1 | 扩展向量搜索IPC通道 | `preload.js`, `main.js` | 2天 |
| 2 | 实现Right Panel UI组件 | `src/index.html`, `src/styles/context-panel.css` | 2天 |
| 3 | 实现上下文检索逻辑 | `src/scripts/app.js` | 3天 |
| 4 | 集成剪贴板变化触发 | `src/scripts/app.js` | 1天 |
| 5 | 测试与优化 | - | 2天 |

**总计：10天**

---

### 4.2 P0：记忆分层管理

#### 4.2.1 设计理念

**三层记忆模型**：

| 类型 | 说明 | 特征 | 处理策略 |
|------|------|------|----------|
| **事实记忆** | 稳定可引用（人名、事件、项目背景） | 长期有效，不随时间变化 | 长期存储，定期强化 |
| **工作记忆** | 短期项目状态（当前任务、进度） | 动态更新，项目结束后失效 | 动态更新，项目结束归档，3个月后提示清理 |
| **偏好策略** | 个人决策规则（工作习惯、风格偏好） | 持续学习，逐步完善 | 持续学习，个性化推荐 |

#### 4.2.2 数据模型升级

**数据库schema变更**：

```sql
ALTER TABLE memories ADD COLUMN layer TEXT DEFAULT 'work';
ALTER TABLE memories ADD COLUMN expiration_date DATETIME;
ALTER TABLE memories ADD COLUMN usage_count INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN last_accessed_at DATETIME;

CREATE INDEX idx_memories_layer ON memories(layer);
CREATE INDEX idx_memories_expiration ON memories(expiration_date);
CREATE INDEX idx_memories_usage ON memories(usage_count DESC);
```

**内存数据模型**（扩展store.js）：

```javascript
class Memory {
  constructor(data) {
    this.id = data.id;
    this.content = data.content;
    this.layer = data.layer || 'work';
    this.expirationDate = data.expirationDate;
    this.usageCount = data.usageCount || 0;
    this.lastAccessedAt = data.lastAccessedAt;
    this.tags = data.tags || [];
    this.source = data.source;
  }

  isExpired() {
    if (this.layer !== 'work') return false;
    return this.expirationDate && new Date(this.expirationDate) < new Date();
  }

  incrementUsage() {
    this.usageCount++;
    this.lastAccessedAt = new Date().toISOString();
  }
}
```

#### 4.2.3 智能分类逻辑

**规则匹配 + AI分类**：

```javascript
class App {
  static _memoryClassifier = {
    async classify(content, tags = []) {
      const ruleResult = this.ruleBasedClassify(content, tags);
      if (ruleResult) return ruleResult;
      return await this.aiClassify(content);
    },
    
    ruleBasedClassify(content, tags) {
      const factPatterns = [
        /^[\u4e00-\u9fa5a-zA-Z0-9]+的(邮箱|电话|手机号|地址)$/,
        /^(定义|概念|公式|定理):/,
      ];
      const workPatterns = [
        /^(任务|待办|Todo):/,
        /^(项目|会议):/,
        /^(截止|Deadline):/,
      ];
      const prefPatterns = [
        /^(偏好|喜欢|习惯):/,
        /^(规则|原则):/,
        /^(总是|从不):/,
      ];
      
      for (const pattern of factPatterns) {
        if (pattern.test(content)) return 'fact';
      }
      for (const pattern of workPatterns) {
        if (pattern.test(content)) return 'work';
      }
      for (const pattern of prefPatterns) {
        if (pattern.test(content)) return 'preference';
      }
      
      return null;
    },
    
    async aiClassify(content) {
      const prompt = `将内容分类为：fact（事实记忆）、work（工作记忆）、preference（偏好策略）。只返回分类结果。\n内容：${content}`;
      
      const response = await window.electronAPI.invokeLLM({
        prompt,
        model: 'claude-3-haiku'
      });
      
      const result = response.trim().toLowerCase();
      return ['fact', 'work', 'preference'].includes(result) ? result : 'work';
    }
  };
}
```

#### 4.2.4 遗忘检测与提醒

**基于艾宾浩斯遗忘曲线的提醒机制**：

```javascript
class App {
  _memoryReminder = {
    checkExpiredMemories: () => {
      const memories = Store.getMemoriesByLayer('work');
      const expired = memories.filter(m => m.isExpired());
      
      if (expired.length > 0) {
        Store.showNotification('过期记忆提醒', `${expired.length}条工作记忆已过期`);
      }
    },
    
    checkForgottenMemories: () => {
      const now = new Date();
      const threshold = 30 * 24 * 60 * 60 * 1000;
      
      const memories = Store.getAllMemories();
      const forgotten = memories.filter(m => {
        if (!m.lastAccessedAt) return false;
        const diff = now - new Date(m.lastAccessedAt);
        return diff > threshold && m.usageCount > 0;
      });
      
      if (forgotten.length > 0) {
        const top3 = forgotten.sort((a, b) => b.usageCount - a.usageCount).slice(0, 3);
        App.instance._renderContextPanel(top3);
      }
    },
    
    scheduleChecks: () => {
      setInterval(() => {
        const hour = new Date().getHours();
        if (hour === 9) {
          this.checkExpiredMemories();
          this.checkForgottenMemories();
        }
      }, 60 * 60 * 1000);
    }
  };
}
```

#### 4.2.5 实现步骤

| 步骤 | 内容 | 涉及文件 | 预估工时 |
|------|------|----------|----------|
| 1 | 数据库schema升级 | `src/sql/schema.sql`, `src/scripts/store.js` | 2天 |
| 2 | 记忆数据模型扩展 | `src/scripts/store.js` | 1天 |
| 3 | 智能分类服务实现 | `src/scripts/app.js` | 3天 |
| 4 | UI分层展示改造 | `src/components/memory-list.html`, `src/styles/memory-list.css` | 2天 |
| 5 | 遗忘检测与提醒 | `src/scripts/app.js` | 2天 |
| 6 | 数据迁移脚本 | `src/scripts/migration.js` | 1天 |
| 7 | 测试与优化 | - | 2天 |

**总计：13天**

---

### 4.3 P1：企业微信Bot快速收集

#### 4.3.1 设计理念

通过企业微信机器人API，让用户在微信中即可完成信息收集。

**⚠️ 合规警告**：
- **不建议使用个人微信机器人（如Wechaty）**：存在账号封禁风险，违反微信用户协议
- **推荐使用企业微信API**：官方支持，合规安全

#### 4.3.2 技术设计

**架构设计**：
```
┌──────────────┐    HTTP/HTTPS    ┌────────────────┐    REST API    ┌──────────────┐
│  企业微信用户  │ ←─────────────── │  Memora服务端   │ ←─────────── │  Web应用      │
│  (客户端)     │ ───────────────→ │  Webhook处理    │ ───────────→ │  REST API    │
└──────────────┘                  └────────────────┘               └──────────────┘
```

**服务端实现**：

```javascript
// server/bots/wecom-bot.js
const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const WECOM_TOKEN = process.env.WECOM_TOKEN;
const WECOM_ENCODING_AES_KEY = process.env.WECOM_ENCODING_AES_KEY;
const WECOM_CORP_ID = process.env.WECOM_CORP_ID;

router.get('/wecom/webhook', (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query;
  
  if (verifySignature(msg_signature, timestamp, nonce, echostr)) {
    res.send(decrypt(echostr));
  } else {
    res.status(401).send('Invalid signature');
  }
});

router.post('/wecom/webhook', async (req, res) => {
  const { msg_signature, timestamp, nonce } = req.query;
  const { encrypt } = req.body;
  
  if (!verifySignature(msg_signature, timestamp, nonce, encrypt)) {
    return res.status(401).send('Invalid signature');
  }
  
  const decrypted = decrypt(encrypt);
  const message = JSON.parse(decrypted);
  
  try {
    await handleWecomMessage(message);
    res.json({ errcode: 0, errmsg: 'success' });
  } catch (error) {
    res.status(500).json({ errcode: -1, errmsg: '处理失败' });
  }
});

async function handleWecomMessage(message) {
  const content = message.Content;
  const userId = message.FromUserName;
  
  if (!content || content.startsWith('!')) return;
  
  const layer = await App._memoryClassifier.classify(content);
  
  await fetch(`${process.env.MEMORA_API_URL}/api/memories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MEMORA_API_TOKEN}`
    },
    body: JSON.stringify({
      content,
      layer,
      source: 'wecom',
      tags: ['企业微信'],
      userId
    })
  });
}

function verifySignature(msgSignature, timestamp, nonce, encrypt) {
  const raw = [WECOM_TOKEN, timestamp, nonce, encrypt].sort().join('');
  const signature = crypto.createHash('sha1').update(raw).digest('hex');
  return signature === msgSignature;
}

module.exports = router;
```

#### 4.3.3 命令系统

| 命令 | 功能 | 示例 |
|------|------|------|
| `/help` | 显示帮助 | `/help` |
| `/list` | 列出最近5条记忆 | `/list` |
| `/search 关键词` | 搜索记忆 | `/search 项目A` |
| `/fact 内容` | 强制保存为事实记忆 | `/fact 张经理邮箱` |
| `/work 内容` | 强制保存为工作记忆 | `/work 明天下午3点开会` |
| `/pref 内容` | 强制保存为偏好策略 | `/pref 喜欢Markdown格式` |

#### 4.3.4 企业微信配置步骤

1. 注册企业微信账号（https://work.weixin.qq.com）
2. 创建自建应用
3. 获取 CorpID、Secret、AgentID
4. 配置服务器地址（Webhook URL）
5. 设置 Token 和 EncodingAESKey

#### 4.3.5 实现步骤

| 步骤 | 内容 | 涉及文件 | 预估工时 |
|------|------|----------|----------|
| 1 | 企业微信Bot服务搭建 | `server/bots/wecom-bot.js` | 3天 |
| 2 | 消息解析与分类 | `server/bots/wecom-bot.js` | 2天 |
| 3 | 命令系统实现 | `server/bots/wecom-bot.js` | 2天 |
| 4 | 企业微信配置 | 外部配置 | 1天 |
| 5 | 测试与优化 | - | 2天 |

**总计：10天**

---

### 4.4 P1：浏览器扩展

#### 4.4.1 设计理念

参考 Readwise Reader 和 Notion Web Clipper，一键收藏网页内容。

**通信方式**：
- **桌面应用模式**：通过 localhost HTTP 服务器与本地应用通信
- **Web应用模式**：通过 REST API 与服务端通信

#### 4.4.2 扩展结构

```
browser-extension/
├── manifest.json          # 扩展配置
├── popup.html             # 弹出窗口
├── popup.js               # 弹出窗口逻辑
├── content.js             # 网页内容脚本
├── background.js          # 后台服务
├── options.html           # 设置页面
└── styles/popup.css       # 样式
```

#### 4.4.3 Manifest配置

```json
{
  "manifest_version": 3,
  "name": "Memora Web Clipper",
  "version": "1.0",
  "description": "一键收藏网页到Memora",
  "permissions": ["activeTab", "storage", "clipboardWrite"],
  "host_permissions": ["*://*/*"],
  "action": {
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [{
    "matches": ["*://*/*"],
    "js": ["content.js"],
    "run_at": "document_end"
  }]
}
```

#### 4.4.4 弹出窗口逻辑

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  const response = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: extractPageContent
  });
  
  const pageData = response[0].result;
  
  document.getElementById('save-btn').addEventListener('click', async () => {
    const memory = {
      content: pageData.content,
      title: pageData.title,
      source: 'web',
      url: pageData.url,
      layer: 'fact'
    };
    
    await saveToMemora(memory);
  });
});

function extractPageContent() {
  const title = document.title;
  const url = window.location.href;
  const article = document.querySelector('article') || document.querySelector('main');
  const content = article ? article.innerText.slice(0, 2000) : document.body.innerText.slice(0, 1000);
  
  return { title, url, content, excerpt: content.slice(0, 300) };
}

async function saveToMemora(memory) {
  const config = await chrome.storage.local.get('memoraConfig');
  
  if (config.useLocalhost) {
    try {
      const response = await fetch(`http://localhost:${config.localhostPort || 3000}/api/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memory)
      });
      if (response.ok) return;
    } catch (error) {
      console.log('本地应用不可用，尝试云端模式');
    }
  }
  
  await fetch(`${config.apiUrl}/api/memories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiToken}`
    },
    body: JSON.stringify(memory)
  });
}
```

#### 4.4.5 本地HTTP服务器（Electron内置）

```javascript
// main.js - 添加本地HTTP服务器
const express = require('express');

function startLocalServer() {
  const app = express();
  const port = process.env.LOCAL_SERVER_PORT || 3000;
  
  app.use(express.json());
  
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });
  
  app.post('/api/memories', async (req, res) => {
    try {
      const memory = await Store.addMemory(req.body);
      res.json({ success: true, memoryId: memory.id });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.listen(port, () => {
    console.log(`[LocalServer] 启动在 http://localhost:${port}`);
  });
}

app.whenReady().then(() => {
  startLocalServer();
});
```

#### 4.4.6 实现步骤

| 步骤 | 内容 | 涉及文件 | 预估工时 |
|------|------|----------|----------|
| 1 | 本地HTTP服务器（Electron） | `main.js` | 2天 |
| 2 | 扩展框架搭建 | `browser-extension/manifest.json`, `popup.html` | 2天 |
| 3 | 网页内容提取 | `browser-extension/content.js` | 2天 |
| 4 | 弹出窗口UI | `browser-extension/popup.html`, `popup.css` | 2天 |
| 5 | API集成（双模式） | `browser-extension/popup.js` | 2天 |
| 6 | 设置页面 | `browser-extension/options.html` | 1天 |
| 7 | 测试与优化 | - | 2天 |

**总计：13天**

---

### 4.5 P2：Agentic工作流（基于现有ADP基础设施）

#### 4.5.1 设计理念

在现有ADP（Agentic Data Processing）流式处理能力之上构建预设工作流，让用户通过自然语言指令触发复杂任务。

**现有能力**：
- ✅ ADP流式状态管理（`_adpStreaming`, `_adpStepMap`）
- ✅ Claude Agent SDK集成（`ccInvoke`, `ccStop`）
- ✅ 多任务并发处理（`_parallelMode`, `_activeParallelTasks`）
- ✅ 工具调用支持（`_adpToolStepCount`）

#### 4.5.2 交互流程

```
用户输入"写周报" → ADP解析意图 → 调用工具链 → 自动执行 → 输出结果
                                      ↓
                          1. 查询本周记忆
                          2. 查询本周任务
                          3. 查询本周剪贴板
                          4. 生成周报
```

#### 4.5.3 工具定义

```javascript
// main.js - 工作流工具定义
const WorkflowTools = {
  searchMemory: {
    name: 'searchMemory',
    description: '搜索知识库中的记忆内容',
    parameters: {
      query: { type: 'string', required: true },
      limit: { type: 'number', default: 5 }
    },
    async execute(params) {
      return await vectorSearch(params.query, params.limit);
    }
  },

  searchTasks: {
    name: 'searchTasks',
    description: '查询任务列表',
    parameters: {
      status: { type: 'string', enum: ['pending', 'completed', 'all'], default: 'all' },
      dateRange: { type: 'string' }
    },
    async execute(params) {
      return await getTasks(params);
    }
  },

  searchCalendar: {
    name: 'searchCalendar',
    description: '查询日历事件',
    parameters: {
      dateRange: { type: 'string', required: true }
    },
    async execute(params) {
      return await getCalendarEvents(params.dateRange);
    }
  },

  searchClipboard: {
    name: 'searchClipboard',
    description: '查询剪贴板历史',
    parameters: {
      dateRange: { type: 'string', required: true }
    },
    async execute(params) {
      return await getClipboardHistory(params.dateRange);
    }
  }
};
```

#### 4.5.4 预设工作流

```javascript
// main.js - 预设工作流定义
const Workflows = {
  '写周报': {
    name: '写周报',
    description: '根据本周记忆、任务和剪贴板内容生成周报',
    steps: [
      { tool: 'searchMemory', params: { query: '本周工作', dateRange: 'this week' } },
      { tool: 'searchTasks', params: { status: 'completed', dateRange: 'this week' } },
      { tool: 'searchClipboard', params: { dateRange: 'this week' } },
      { 
        tool: 'generateReport', 
        params: { 
          template: 'weekly-report',
          sections: ['完成事项', '进行中', '下周计划', '问题与风险']
        } 
      }
    ]
  },

  '准备会议': {
    name: '准备会议',
    description: '整理会议相关资料',
    steps: [
      { tool: 'searchMemory', params: { query: '会议相关', limit: 10 } },
      { tool: 'searchCalendar', params: { dateRange: 'today' } },
      { tool: 'searchTasks', params: { status: 'pending' } }
    ]
  },

  '整理笔记': {
    name: '整理笔记',
    description: '自动分类和整理未分类笔记',
    steps: [
      { tool: 'searchMemory', params: { query: '', filter: { layer: 'unclassified' } } },
      { tool: 'classifyMemories' }
    ]
  },

  '总结文档': {
    name: '总结文档',
    description: '读取文件并生成摘要',
    steps: [
      { tool: 'readFile', params: {} },
      { tool: 'generateSummary' }
    ]
  }
};
```

#### 4.5.5 前端工作流触发

```javascript
// src/scripts/app.js - 扩展sendMessage方法
class App {
  async sendMessage(content) {
    const workflow = this._detectWorkflow(content);
    
    if (workflow) {
      return await this._executeWorkflow(workflow, content);
    }
    
    return await this._originalSendMessage(content);
  }
  
  _detectWorkflow(content) {
    const workflowNames = Object.keys(Workflows);
    for (const name of workflowNames) {
      if (content.includes(name)) {
        return name;
      }
    }
    return null;
  }
  
  async _executeWorkflow(workflowName, content) {
    const result = await window.electronAPI.ccInvoke({
      type: 'workflow',
      workflowName,
      content,
      context: {
        sessionId: this._activeSessionId,
        messages: this._chatSessions.find(s => s.id === this._activeSessionId)?.messages || []
      }
    });
    
    this._renderWorkflowResult(result);
    return result;
  }
}
```

#### 4.5.6 工作流UI集成

```html
<!-- src/index.html - 在聊天输入框下方添加 -->
<div class="workflow-shortcuts">
  <span class="shortcuts-label">快捷工作流：</span>
  <button class="workflow-btn" data-workflow="写周报">📝 写周报</button>
  <button class="workflow-btn" data-workflow="准备会议">📅 准备会议</button>
  <button class="workflow-btn" data-workflow="整理笔记">📁 整理笔记</button>
  <button class="workflow-btn" data-workflow="总结文档">📄 总结文档</button>
</div>
```

#### 4.5.7 实现步骤

| 步骤 | 内容 | 涉及文件 | 预估工时 |
|------|------|----------|----------|
| 1 | 工作流工具定义 | `main.js` | 3天 |
| 2 | 工作流执行引擎（扩展ADP） | `main.js`, `preload.js` | 4天 |
| 3 | 预设工作流定义 | `main.js` | 3天 |
| 4 | 前端工作流触发逻辑 | `src/scripts/app.js` | 3天 |
| 5 | 工作流快捷按钮UI | `src/index.html`, `src/styles/workflow.css` | 2天 |
| 6 | 测试与优化 | - | 3天 |

**总计：18天**

---

## 五、Web应用转换核心方案

### 5.1 IPC通道 → REST API映射

**150+ IPC通道 → ~30个REST资源端点**

| 资源 | 端点 | 覆盖IPC通道 |
|------|------|-------------|
| `/api/auth` | POST /login, POST /register, GET /profile | auth:* (12个) |
| `/api/memories` | GET/POST/PUT/DELETE | memory:* (15个) |
| `/api/notes` | GET/POST/PUT/DELETE | notebook:* (14个) |
| `/api/knowledge/atoms` | CRUD + cluster | knowledge:* (10个) |
| `/api/vectors` | POST /search, POST /rebuild | vector:* (12个) |
| `/api/experts` | CRUD + chat | experts:* (15个) |
| `/api/graph` | POST /build, GET /nodes | graph:* (15个) |
| `/api/clipboard` | POST /analyze, GET /config | clipboard:* (10个) |
| `/api/ai/agent` | POST /invoke | agent:* (5个) |
| `/api/ai/llm` | POST /chat, POST /analyze | AI/LLM (10个) |

### 5.2 API适配器

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

### 5.3 Claude Agent服务端代理

**安全警告**：AI服务的API Key绝不能在前端暴露，必须通过服务端代理调用。

```javascript
// server/routes/ai.js
import { ClaudeAgent } from '@anthropic-ai/claude-agent-sdk'

const router = express.Router()

const agent = new ClaudeAgent({
  apiKey: process.env.CLAUDE_API_KEY,
})

router.post('/agent/invoke', async (req, res) => {
  const { query, context } = req.body
  
  try {
    const response = await agent.invoke({
      messages: [{ role: 'user', content: query }],
      context,
    })
    res.json(response)
  } catch (error) {
    res.status(500).json({ error: 'AI服务暂时不可用' })
  }
})

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

### 5.4 数据库迁移

**SQLite → PostgreSQL + pgvector**

| Electron存储 | Web存储 | 说明 |
|--------------|---------|------|
| `memora-data.json` | PostgreSQL `memories`表 | 记忆数据 |
| `notes.json` | PostgreSQL `notes`表 | 记事本数据 |
| `knowledge-graph.db` | PostgreSQL `graph_nodes/edges`表 | 知识图谱 |
| `vector_db/` | PostgreSQL `pgvector`扩展 | 向量索引 |
| `user-data/` | 对象存储 (MinIO) | 文件、图片 |

**多租户设计**：
- 每张业务表添加 `user_id` 字段
- 数据库层面行级隔离
- API层面自动注入用户上下文

### 5.5 剪贴板功能替代方案

| 方案 | 架构 | 优先级 |
|------|------|--------|
| 手动粘贴模式 | 零依赖，开箱即用 | P0（MVP） |
| 浏览器扩展 | 自动监控剪贴板 | P1 |
| 桌面伴侣程序 | 完整功能保留 | P2 |

---

## 六、实施步骤与工作量评估

### 6.1 优化工时汇总

| 优化项 | 优先级 | 预估工时 |
|--------|--------|----------|
| 主动记忆推送（Right Panel） | **P0** | 10天 |
| 记忆分层管理 | **P0** | 13天 |
| 企业微信Bot快速收集 | **P1** | 10天 |
| 浏览器扩展 | **P1** | 13天 |
| Agentic工作流（基于ADP） | **P2** | 18天 |
| **总计** | | **64天** |

### 6.2 Web应用转换工时汇总

| 模块 | 工作量 | 优先级 |
|------|--------|--------|
| 认证系统（复用v2.0-auth） | 1-2天 | P0 |
| 用户数据存储 | 5-7天 | P0 |
| 向量数据库 | 3-4天 | P0 |
| REST API层（~30个端点） | 5-7天 | P0 |
| 前端适配（无框架） | 3-5天 | P0 |
| 剪贴板功能 | 5-7天 | P1 |
| AI/Agent调用（服务端代理） | 3-4天 | P1 |
| 文件上传/下载 | 2-3天 | P1 |
| 实时同步 | 5-7天 | P2 |
| 部署配置 | 2-3天 | P2 |
| **总计** | **4-8周** | |

### 6.3 综合实施路线图

```
第1-2周：P0功能启动
├── 主动记忆推送（Right Panel）开发
├── 记忆分层管理数据库升级
└── Web应用基础架构搭建

第3-4周：P0功能完成
├── Right Panel MVP完成
├── 记忆分层管理UI完成
└── Web应用核心API完成

第5-6周：P1功能启动
├── 企业微信Bot开发
├── 浏览器扩展开发
└── Web应用AI能力集成

第7-8周：P1功能完成
├── 企业微信Bot上线
├── 浏览器扩展发布
└── Web应用MVP上线

第9-12周：P2功能
├── Agentic工作流开发
├── 实时同步功能
└── 性能优化与测试
```

### 6.4 代码复用率评估

| 代码类型 | 复用率 | 说明 |
|----------|--------|------|
| HTML/CSS | 80-90% | 样式基本可直接复用 |
| 业务逻辑 | 50-60% | 需要适配API调用 |
| 数据模型 | 70-80% | 结构基本一致 |
| Electron专属 | 0% | 需要完全重写 |

---

## 七、风险与应对策略

### 7.1 技术风险

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| AI分类准确率不足 | 记忆分层效果差 | 规则匹配优先，AI分类作为补充 |
| 向量检索性能下降 | 主动推送响应慢 | 限制返回数量（5条），使用轻量模型 |
| 企业微信API限流 | 消息丢失或延迟 | 消息队列，重试机制 |
| 剪贴板功能受限 | 用户体验下降 | 提供多种方案，先实现手动粘贴 |

### 7.2 合规风险

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 个人微信机器人封禁 | 服务中断 | 改用企业微信API |
| 浏览器扩展审核拒绝 | 无法发布 | 遵守Chrome Web Store政策 |
| API Key暴露 | 安全漏洞 | 服务端代理调用，绝不暴露API Key |

### 7.3 用户体验风险

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 主动推送过多 | 用户被打扰 | 可配置推送频率，支持开关 |
| 分类错误 | 用户困惑 | 提供手动调整入口，反馈机制 |
| 新功能学习成本 | 用户不使用 | 渐进式引导，新手教程 |

### 7.4 资源风险

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 开发资源不足 | 进度延迟 | 分阶段实施，优先P0 |
| AI调用成本增加 | 运营成本上升 | 使用轻量模型（Haiku），限制调用频率 |

---

## 八、预期收益

| 优化项 | 预期收益 |
|--------|----------|
| 主动记忆推送 | 用户查找信息效率提升30-50% |
| 记忆分层管理 | 过期信息减少60%，检索准确率提升20% |
| 企业微信Bot | 用户记录频率提升40% |
| 浏览器扩展 | 网页内容收集效率提升50% |
| Agentic工作流 | 复杂任务处理时间减少70% |
| Web应用转换 | 无需安装，跨平台访问，多端同步 |

---

## 九、里程碑

| 里程碑 | 时间 | 交付物 |
|--------|------|--------|
| M1 | 第2周 | P0功能启动，Web应用框架 |
| M2 | 第4周 | P0功能MVP完成 |
| M3 | 第6周 | P1功能启动，Web应用核心功能 |
| M4 | 第8周 | P1功能完成，Web应用MVP上线 |
| M5 | 第12周 | P2功能完成，完整功能发布 |

---

## 十、结论

### 10.1 技术可行性

本方案基于现有代码架构演进，主要技术点均已验证：
- ✅ BGE本地嵌入模型已有成熟实现
- ✅ Claude Agent SDK集成完成
- ✅ ADP流式处理基础设施完备
- ✅ 企业微信API合规方案明确
- ✅ 浏览器扩展双模式通信设计可行

### 10.2 合规性

- ✅ API Key通过服务端代理保护
- ✅ 企业微信Bot使用官方API，合规安全
- ✅ 浏览器扩展符合Chrome Web Store政策
- ✅ 多租户数据隔离设计确保用户数据安全

### 10.3 推荐路径

1. **P0阶段**：优先完成主动记忆推送和记忆分层管理，提升核心体验
2. **P1阶段**：完善企业微信Bot和浏览器扩展，扩展信息收集入口
3. **P2阶段**：实现Agentic工作流，深度智能化
4. **Web转换**：与产品优化并行推进，共享API层

---

**文档版本**: v1.0  
**创建日期**: 2026-06-28  
**适用版本**: Memora v3.1.0+