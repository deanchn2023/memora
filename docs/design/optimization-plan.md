# Memora 产品优化设计方案

## 一、优化概述

### 1.1 优化目标

基于市场调研结果，本方案针对以下核心痛点进行优化：

| 痛点 | 优化方向 | 优先级 |
|------|----------|--------|
| AI帮你"制造数字垃圾"，整理成本高 | 主动记忆推送，AI自动整理 | **P0** |
| 记了上千条笔记，需要时一条也找不到 | 记忆分层管理，精准检索 | **P0** |
| 信息分散在多平台，收集困难 | 企业微信Bot + 浏览器扩展 | **P1** |
| AI只是"搜索框"，不是"大脑" | Agentic工作流，智能任务执行 | **P2** |

### 1.2 设计原则

1. **Capture优先**：降低记录门槛，整理交给AI
2. **主动智能**：从"被动存储+主动搜索"转向"主动捕获+主动推送"
3. **本地优先**：数据隐私保护，离线可用
4. **渐进增强**：基于现有代码演进，而非重写

### 1.3 优化路径图

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

### 1.4 与Web应用转换方案的依赖关系

| 优化项 | 依赖Web转换阶段 | 说明 |
|--------|-----------------|------|
| 主动记忆推送 | 独立（可先行） | 基于现有向量搜索能力 |
| 记忆分层管理 | 独立（可先行） | 数据库schema升级 |
| 企业微信Bot | Phase 2（REST API） | 需要服务端API支持 |
| 浏览器扩展 | Phase 2（REST API） | 需要服务端API支持 |
| Agentic工作流 | Phase 3（AI代理） | 需要服务端AI代理支持 |

---

## 二、P0：主动记忆推送（Right Panel）

### 2.1 当前状态分析

**现状**：用户需要主动搜索才能找到相关记忆，类似传统笔记工具的"搜索框模式"。

**现有能力**：
- ✅ 向量搜索（`vectorSearch`, `vectorRetrieveRAG`）— 通过IPC通道
- ✅ 剪贴板专家匹配（`clipboard_expert_match`）
- ✅ 聊天会话管理（`_chatSessions`, `_activeSessionId`）— app.js:36-38
- ✅ 上下文来源监听（`onContextSources`）— app.js:115-122
- ❌ 缺少主动推送机制

**关键文件**：
- `src/scripts/app.js`：聊天会话管理、消息渲染、ADP流式处理
- `src/scripts/store.js`：状态管理
- `preload.js`：向量搜索IPC通道

### 2.2 目标状态

**设计理念**：参考 Mem 的 Right Panel 和 Granola 的 bullets-to-prompts 模式，在用户输入时主动推送相关记忆。

**交互流程**：
```
用户在聊天输入框输入 → AI分析上下文 → 向量检索相关记忆 → Right Panel展示
                                              ↓
                                    用户点击记忆 → 自动插入到对话中
```

### 2.3 技术设计

#### 2.3.1 数据模型

**相关记忆卡片**（复用现有Memory对象，扩展字段）：
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

#### 2.3.2 API 接口

**复用现有向量搜索IPC通道，增加上下文参数**：

```javascript
// preload.js - 扩展现有通道（第3行附近）
contextBridge.exposeInMainWorld('electronAPI', {
  // 新增：基于上下文的主动检索
  vectorSearchContext: (query, context, limit = 5) => 
    ipcRenderer.invoke('vector:search-context', { query, context, limit }),
  
  // 新增：实时上下文监听（用于推送）
  onContextUpdate: (callback) => {
    ipcRenderer.on('vector:context-update', (event, results) => callback(results));
  },
  
  // ... 其他现有通道保持不变
});
```

#### 2.3.3 前端组件设计

**Right Panel 组件结构**（集成到现有聊天布局）：

```html
<!-- src/index.html - 在聊天区域右侧添加 -->
<div id="chat-container" class="chat-container">
  <!-- 现有聊天区域 -->
  <div class="chat-area">...</div>
  
  <!-- 新增：上下文面板 -->
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
    
    <div class="context-list" id="context-list">
      <!-- 动态生成记忆卡片 -->
    </div>
    
    <div class="context-empty" id="context-empty">
      <svg class="empty-icon">...</svg>
      <span>暂无相关记忆</span>
    </div>
  </div>
</div>
```

#### 2.3.4 业务逻辑

**主动推送触发时机**：

| 触发时机 | 场景 | 检索策略 |
|----------|------|----------|
| 输入框变化 | 用户输入3个以上字符 | 实时向量搜索 |
| 新建会话 | 用户打开新聊天 | 推荐历史相关记忆 |
| 消息发送 | 用户发送消息后 | 基于对话上下文检索 |
| 剪贴板变化 | 用户复制内容 | 基于剪贴板内容匹配 |

**实现代码**（扩展app.js）：

```javascript
// src/scripts/app.js - 在App类中添加ContextPanel逻辑

class App {
  // ... 现有属性
  
  // 上下文面板状态
  _contextPanelOpen = false;
  _contextResults = [];
  _contextSearchTimeout = null;
  
  init() {
    // ... 现有初始化代码
    
    // 初始化上下文面板
    this._initContextPanel();
  }
  
  _initContextPanel() {
    const panel = document.getElementById('context-panel');
    const toggleBtn = document.getElementById('context-toggle-btn');
    
    if (!panel || !toggleBtn) return;
    
    // 切换按钮事件
    toggleBtn.addEventListener('click', () => {
      this._contextPanelOpen = !this._contextPanelOpen;
      panel.classList.toggle('hidden', !this._contextPanelOpen);
    });
    
    // 输入框实时搜索
    const input = document.getElementById('chat-input');
    if (input) {
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
    
    // 剪贴板变化触发（复用现有setupClipboardListener逻辑）
    // 在setupClipboardListener中添加上下文搜索调用
    
    // 卡片点击事件委托
    const list = document.getElementById('context-list');
    if (list) {
      list.addEventListener('click', (e) => {
        const card = e.target.closest('.context-card');
        if (card) {
          const action = e.target.dataset.action;
          const memId = card.dataset.id;
          this._handleContextCardClick(memId, action);
        }
      });
    }
  }
  
  async _searchContext(query) {
    const currentSession = this._chatSessions.find(
      s => s.id === this._activeSessionId
    );
    
    const context = currentSession?.messages?.slice(-5) || [];
    
    try {
      const results = await window.electronAPI.vectorSearchContext(
        query, 
        context, 
        5
      );
      this._contextResults = results;
      this._renderContextPanel(results);
    } catch (error) {
      console.error('[ContextPanel] 搜索失败:', error);
    }
  }
  
  _renderContextPanel(results) {
    const list = document.getElementById('context-list');
    const empty = document.getElementById('context-empty');
    
    if (!list || !empty) return;
    
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
  
  async _handleContextCardClick(memId, action) {
    if (action === 'insert') {
      const mem = await window.electronAPI.getMemoryById(memId);
      if (mem) {
        const input = document.getElementById('chat-input');
        const currentValue = input.value;
        input.value = `${currentValue}\n\n引用: ${mem.title}\n${mem.content.slice(0, 200)}...`;
        input.focus();
      }
    } else if (action === 'view') {
      this.openMemoryDetail(memId);
    }
  }
  
  _getTypeLabel(type) {
    const labels = {
      memory: '记忆',
      notebook: '记事本',
      task: '任务',
      clipboard: '剪贴板'
    };
    return labels[type] || type;
  }
  
  // ... 其他现有方法
}
```

### 2.4 实现步骤

| 步骤 | 内容 | 涉及文件 | 预估工时 |
|------|------|----------|----------|
| 1 | 扩展向量搜索IPC通道，增加上下文参数 | `preload.js`, `main.js` | 2天 |
| 2 | 实现Right Panel UI组件 | `src/index.html`, `src/styles/context-panel.css` | 2天 |
| 3 | 实现上下文检索逻辑（扩展app.js） | `src/scripts/app.js` | 3天 |
| 4 | 集成剪贴板变化触发 | `src/scripts/app.js` | 1天 |
| 5 | 测试与优化 | - | 2天 |

**总计：10天**

---

## 三、P0：记忆分层管理

### 3.1 当前状态分析

**现状**：所有记忆统一存储，不分类型，导致：
- 过期信息污染知识库
- AI给出错误建议
- 用户难以找到特定类型的记忆

**现有数据模型**（简化）：
```json
{
  "id": "mem-xxx",
  "content": "记忆内容",
  "createdAt": "2026-06-27",
  "updatedAt": "2026-06-27",
  "tags": [],
  "source": "clipboard"
}
```

**关键文件**：
- `src/scripts/store.js`：记忆存储逻辑
- `src/sql/schema.sql`：数据库schema
- `src/components/memory-list.html`：记忆列表UI

### 3.2 目标状态

**三层记忆模型**：

| 类型 | 说明 | 特征 | 处理策略 |
|------|------|------|----------|
| **事实记忆** | 稳定可引用（人名、事件、项目背景） | 长期有效，不随时间变化 | 长期存储，定期强化，不自动删除 |
| **工作记忆** | 短期项目状态（当前任务、进度） | 动态更新，项目结束后失效 | 动态更新，项目结束归档，3个月后提示清理 |
| **偏好策略** | 个人决策规则（工作习惯、风格偏好） | 持续学习，逐步完善 | 持续学习，个性化推荐，不删除 |

### 3.3 技术设计

#### 3.3.1 数据模型升级

**数据库schema变更**：

```sql
-- 新增 layer 字段
ALTER TABLE memories ADD COLUMN layer TEXT DEFAULT 'work';

-- 新增 expiration_date 字段（工作记忆专用）
ALTER TABLE memories ADD COLUMN expiration_date DATETIME;

-- 新增 usage_count 字段（用于热度排序）
ALTER TABLE memories ADD COLUMN usage_count INTEGER DEFAULT 0;

-- 新增 last_accessed_at 字段（用于遗忘检测）
ALTER TABLE memories ADD COLUMN last_accessed_at DATETIME;

-- 创建索引
CREATE INDEX idx_memories_layer ON memories(layer);
CREATE INDEX idx_memories_expiration ON memories(expiration_date);
CREATE INDEX idx_memories_usage ON memories(usage_count DESC);
```

**内存数据模型**（扩展store.js）：
```javascript
// src/scripts/store.js - 扩展记忆对象
class Memory {
  constructor(data) {
    this.id = data.id;
    this.content = data.content;
    this.layer = data.layer || 'work'; // fact | work | preference
    this.expirationDate = data.expirationDate;
    this.usageCount = data.usageCount || 0;
    this.lastAccessedAt = data.lastAccessedAt;
    this.tags = data.tags || [];
    this.source = data.source;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
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

#### 3.3.2 UI设计

**记忆列表分层展示**（扩展现有记忆列表）：

```html
<!-- src/components/memory-list.html - 扩展 -->
<div id="memory-list-container">
  <!-- 分层标签 -->
  <div class="layer-tabs">
    <button class="layer-tab active" data-layer="all">全部</button>
    <button class="layer-tab" data-layer="fact">
      <svg class="fact-icon">...</svg>
      事实记忆
      <span class="layer-count">12</span>
    </button>
    <button class="layer-tab" data-layer="work">
      <svg class="work-icon">...</svg>
      工作记忆
      <span class="layer-count">45</span>
    </button>
    <button class="layer-tab" data-layer="preference">
      <svg class="pref-icon">...</svg>
      偏好策略
      <span class="layer-count">8</span>
    </button>
  </div>

  <!-- 记忆列表（现有结构，增加layer属性） -->
  <div class="memory-list" id="memory-list">
    <!-- 动态生成 -->
    <div class="memory-item" data-layer="fact">
      <div class="item-header">
        <span class="layer-badge fact">事实</span>
        <span class="item-date">2026-06-27</span>
      </div>
      <div class="item-content">张经理的邮箱是 zhang@example.com</div>
      <div class="item-meta">
        <span class="usage">使用 5 次</span>
        <span class="last-access">最近使用: 2天前</span>
      </div>
    </div>
  </div>
</div>
```

#### 3.3.3 智能分类逻辑

**AI自动分类**（扩展app.js）：

```javascript
// src/scripts/app.js - 记忆分类服务（作为App类的静态方法）

class App {
  // ... 现有方法
  
  // 记忆分类服务
  static _memoryClassifier = {
    async classify(content, tags = []) {
      const ruleResult = this.ruleBasedClassify(content, tags);
      if (ruleResult) return ruleResult;
      return await this.aiClassify(content);
    },
    
    ruleBasedClassify(content, tags) {
      const factPatterns = [
        /^[\u4e00-\u9fa5a-zA-Z0-9]+的(邮箱|电话|手机号|地址|账号|密码)$/,
        /^[\u4e00-\u9fa5a-zA-Z0-9]+是[\u4e00-\u9fa5a-zA-Z0-9@.]+$/,
        /^(定义|概念|公式|定理|规则):/,
        /^[\u4e00-\u9fa5a-zA-Z0-9]+的(生日|纪念日|重要日期)$/
      ];
      
      const workPatterns = [
        /^(任务|待办|Todo|Task):/,
        /^(项目|Project|PRD|需求):/,
        /^(会议|Meeting|Call):/,
        /^(进度|进展|完成度):/,
        /^(截止|Deadline|Due):/
      ];
      
      const prefPatterns = [
        /^(偏好|喜欢|习惯):/,
        /^(规则|原则|策略):/,
        /^(总是|从不|经常):/,
        /^(最佳实践|经验|教训):/
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
      
      if (tags.some(t => ['项目', '任务', '待办'].includes(t))) return 'work';
      if (tags.some(t => ['定义', '概念', '知识'].includes(t))) return 'fact';
      if (tags.some(t => ['偏好', '习惯', '规则'].includes(t))) return 'preference';
      
      return null;
    },
    
    async aiClassify(content) {
      try {
        const prompt = `将以下内容分类为：fact（事实记忆，稳定可引用的信息）、work（工作记忆，短期项目状态）、preference（偏好策略，个人决策规则）。只返回分类结果，不要其他解释。\n\n内容：${content}`;
        
        const response = await window.electronAPI.invokeLLM({
          prompt,
          model: 'claude-3-haiku'
        });
        
        const result = response.trim().toLowerCase();
        if (['fact', 'work', 'preference'].includes(result)) {
          return result;
        }
      } catch (error) {
        console.error('[MemoryClassifier] AI分类失败:', error);
      }
      
      return 'work';
    }
  };
}
```

#### 3.3.4 遗忘检测与提醒

**基于艾宾浩斯遗忘曲线的提醒机制**（扩展app.js）：

```javascript
// src/scripts/app.js - 遗忘检测服务

class App {
  // ... 现有方法
  
  // 遗忘检测服务
  _memoryReminder = {
    checkExpiredMemories: () => {
      const memories = Store.getMemoriesByLayer('work');
      const expired = memories.filter(m => m.isExpired());
      
      if (expired.length > 0) {
        Store.showNotification('过期记忆提醒', `${expired.length}条工作记忆已过期，建议清理或归档`);
      }
    },
    
    checkForgottenMemories: () => {
      const now = new Date();
      const threshold = 30 * 24 * 60 * 60 * 1000;
      
      const memories = Store.getAllMemories();
      const forgotten = memories.filter(m => {
        if (!m.lastAccessedAt) return false;
        const lastAccess = new Date(m.lastAccessedAt);
        const diff = now - lastAccess;
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

### 3.4 实现步骤

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

## 四、P1：企业微信Bot快速收集

### 4.1 当前状态分析

**现状**：用户需要打开Memora应用才能记录信息，存在使用门槛。

**痛点**：
- 微信中看到有用信息，需要切换到Memora记录
- 碎片化信息（群聊消息、朋友圈）难以快速收集
- 灵感转瞬即逝，打开应用的时间成本过高

### 4.2 目标状态

**设计理念**：通过企业微信机器人API，让用户在微信中即可完成信息收集。

**⚠️ 合规警告**：
- **不建议使用个人微信机器人（如Wechaty）**：存在账号封禁风险，违反微信用户协议
- **推荐使用企业微信API**：官方支持，合规安全

**交互流程**：
```
企业微信用户发送消息 → 企业微信服务器 → Memora服务端Webhook → 自动分类存储 → 推送通知
```

### 4.3 技术设计

#### 4.3.1 架构设计

```
┌──────────────┐    HTTP/HTTPS    ┌────────────────┐    REST API    ┌──────────────┐
│  企业微信用户  │ ←─────────────── │  Memora服务端   │ ←─────────── │  Web转换后    │
│  (客户端)     │ ───────────────→ │  Webhook处理    │ ───────────→ │  REST API    │
└──────────────┘                  └────────────────┘               └──────────────┘
```

#### 4.3.2 企业微信Bot服务

**使用企业微信API**（依赖Web应用转换后的REST API）：

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
    console.error('[WecomBot] 处理失败:', error);
    res.status(500).json({ errcode: -1, errmsg: '处理失败' });
  }
});

async function handleWecomMessage(message) {
  const content = message.Content;
  const userId = message.FromUserName;
  
  if (!content || content.startsWith('!')) return;
  
  const layer = await App._memoryClassifier.classify(content);
  
  // 调用Web转换后的REST API
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

function decrypt(encrypt) {
  // 企业微信AES解密逻辑
  // 使用WECOM_ENCODING_AES_KEY和WECOM_CORP_ID进行解密
  // 具体实现参考企业微信官方SDK
  return encrypt;
}

module.exports = router;
```

#### 4.3.3 命令系统

| 命令 | 功能 | 示例 |
|------|------|------|
| `/help` | 显示帮助 | `/help` |
| `/list` | 列出最近5条记忆 | `/list` |
| `/search 关键词` | 搜索记忆 | `/search 项目A` |
| `/fact 内容` | 强制保存为事实记忆 | `/fact 张经理邮箱 zhang@example.com` |
| `/work 内容` | 强制保存为工作记忆 | `/work 明天下午3点开会` |
| `/pref 内容` | 强制保存为偏好策略 | `/pref 喜欢使用Markdown格式` |

#### 4.3.4 企业微信配置步骤

1. 注册企业微信账号（https://work.weixin.qq.com）
2. 创建应用（自建应用）
3. 获取 CorpID、Secret、AgentID
4. 配置服务器地址（Webhook URL）
5. 设置 Token 和 EncodingAESKey

### 4.4 实现步骤

| 步骤 | 内容 | 涉及文件 | 预估工时 |
|------|------|----------|----------|
| 1 | 企业微信Bot服务搭建 | `server/bots/wecom-bot.js` | 3天 |
| 2 | 消息解析与分类 | `server/bots/wecom-bot.js` | 2天 |
| 3 | 命令系统实现 | `server/bots/wecom-bot.js` | 2天 |
| 4 | 企业微信配置 | 外部配置 | 1天 |
| 5 | 测试与优化 | - | 2天 |

**总计：10天**

---

## 五、P1：浏览器扩展

### 5.1 当前状态分析

**现状**：用户需要手动复制网页内容，然后粘贴到Memora中。

**痛点**：
- 网页收藏流程繁琐
- 无法自动提取关键信息
- 无法保留网页上下文

### 5.2 目标状态

**设计理念**：参考 Readwise Reader 和 Notion Web Clipper，一键收藏网页内容。

**通信方式**：
- **桌面应用模式**：通过 localhost HTTP 服务器（Electron内置）或 Native Messaging 与本地应用通信
- **Web应用模式**：通过 REST API 与服务端通信

### 5.3 技术设计

#### 5.3.1 扩展结构

```
browser-extension/
├── manifest.json          # 扩展配置
├── popup.html             # 弹出窗口
├── popup.js               # 弹出窗口逻辑
├── content.js             # 网页内容脚本
├── background.js          # 后台服务
├── options.html           # 设置页面
└── styles/
    └── popup.css          # 样式
```

#### 5.3.2 Manifest配置

```json
{
  "manifest_version": 3,
  "name": "Memora Web Clipper",
  "version": "1.0",
  "description": "一键收藏网页到Memora",
  "permissions": ["activeTab", "storage", "clipboardWrite"],
  "host_permissions": ["*://*/*"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
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

#### 5.3.3 弹出窗口逻辑

**支持两种模式**：

```javascript
// popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  const response = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: extractPageContent
  });
  
  const pageData = response[0].result;
  
  document.getElementById('page-title').value = pageData.title;
  document.getElementById('page-url').value = pageData.url;
  document.getElementById('page-excerpt').value = pageData.excerpt;
  document.getElementById('page-tags').value = pageData.tags.join(', ');
  
  document.getElementById('save-btn').addEventListener('click', async () => {
    const memory = {
      content: pageData.content,
      title: document.getElementById('page-title').value,
      source: 'web',
      tags: document.getElementById('page-tags').value.split(',').map(t => t.trim()),
      url: pageData.url,
      layer: 'fact'
    };
    
    try {
      await saveToMemora(memory);
      document.getElementById('status').textContent = '✅ 已保存';
      setTimeout(() => window.close(), 1500);
    } catch (error) {
      document.getElementById('status').textContent = '❌ 保存失败';
    }
  });
});

function extractPageContent() {
  const title = document.title;
  const url = window.location.href;
  
  const article = document.querySelector('article') || 
                  document.querySelector('.article-content') ||
                  document.querySelector('main');
  
  const content = article ? article.innerText.slice(0, 2000) : 
                            document.body.innerText.slice(0, 1000);
  
  const excerpt = content.slice(0, 300);
  
  const tags = [];
  const metaKeywords = document.querySelector('meta[name="keywords"]');
  if (metaKeywords) {
    tags.push(...metaKeywords.content.split(',').map(t => t.trim()).slice(0, 5));
  }
  
  return { title, url, content, excerpt, tags };
}

async function saveToMemora(memory) {
  const config = await chrome.storage.local.get('memoraConfig');
  
  // 优先尝试本地应用模式（localhost）
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
  
  // 云端模式（Web应用转换后）
  if (!config.apiUrl) {
    throw new Error('请先配置Memora地址');
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

#### 5.3.4 本地HTTP服务器（Electron内置）

**在main.js中添加本地服务器**：

```javascript
// main.js - 添加本地HTTP服务器
const express = require('express');

function startLocalServer() {
  const app = express();
  const port = process.env.LOCAL_SERVER_PORT || 3000;
  
  app.use(express.json());
  
  // CORS（允许浏览器扩展访问）
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });
  
  // 记忆API（复用现有store逻辑）
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

// 在app ready后启动
app.whenReady().then(() => {
  startLocalServer();
  // ... 其他初始化代码
});
```

### 5.4 实现步骤

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

## 六、P2：Agentic工作流（基于现有ADP基础设施）

### 6.1 当前状态分析

**现状**：应用已具备完整的ADP（Agentic Data Processing）流式处理能力：
- ✅ ADP流式状态管理（`_adpStreaming`, `_adpStepMap`, `_adpToolStepCount`等）— app.js:18-30
- ✅ Claude Agent SDK集成（`ccInvoke`, `ccStop`等）— preload.js:34-43
- ✅ 多任务并发处理（`_parallelMode`, `_activeParallelTasks`）— app.js:40-43
- ✅ 工具调用支持（`_adpToolStepCount`）— app.js:22
- ❌ 缺少预设工作流和工具扩展机制

**关键文件**：
- `src/scripts/app.js`：ADP流式处理、聊天逻辑
- `preload.js`：CC模式IPC通道
- `main.js`：Agent调用实现

### 6.2 目标状态

**设计理念**：在现有ADP/CC基础设施之上构建预设工作流，让用户通过自然语言指令触发复杂任务。

**交互流程**：
```
用户输入"写周报" → ADP解析意图 → 调用工具链 → 自动执行 → 输出结果
                                      ↓
                          1. 查询本周记忆
                          2. 查询本周任务
                          3. 查询本周剪贴板
                          4. 生成周报
```

### 6.3 技术设计

#### 6.3.1 工具定义（扩展现有工具链）

**在preload.js中扩展工具调用通道**：

```javascript
// preload.js - 扩展工具调用通道（第3行附近）
contextBridge.exposeInMainWorld('electronAPI', {
  // 现有工具调用
  ccInvoke: (data) => ipcRenderer.invoke('cc:invoke', data),
  
  // 新增：工作流工具
  executeWorkflow: (workflowName, params) => 
    ipcRenderer.invoke('workflow:execute', { workflowName, params }),
  
  listWorkflows: () => ipcRenderer.invoke('workflow:list'),
  
  // ... 其他现有通道
});
```

**工具定义**（扩展main.js）：

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

#### 6.3.2 预设工作流（基于ADP管道）

**在main.js中定义工作流**：

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

#### 6.3.3 工作流执行引擎（复用ADP流式处理）

**在app.js中扩展工作流触发逻辑**：

```javascript
// src/scripts/app.js - 工作流触发（扩展sendMessage方法）

class App {
  // ... 现有方法
  
  async sendMessage(content) {
    // 检测是否为工作流触发指令
    const workflow = this._detectWorkflow(content);
    
    if (workflow) {
      // 使用CC模式执行工作流
      return await this._executeWorkflow(workflow, content);
    }
    
    // 原有消息处理逻辑
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
    try {
      // 使用现有的CC模式发送工作流指令
      const result = await window.electronAPI.ccInvoke({
        type: 'workflow',
        workflowName,
        content,
        context: {
          sessionId: this._activeSessionId,
          messages: this._chatSessions.find(s => s.id === this._activeSessionId)?.messages || []
        }
      });
      
      // 复用现有ADP流式渲染逻辑
      this._renderWorkflowResult(result);
      
      return result;
    } catch (error) {
      console.error('[Workflow] 执行失败:', error);
      throw error;
    }
  }
  
  _renderWorkflowResult(result) {
    // 复用现有的消息渲染逻辑
    // 将工作流结果作为AI回复消息渲染
    this._addMessage('assistant', result.output);
  }
}
```

#### 6.3.4 工作流UI集成

**在聊天输入框下方添加工作流快捷按钮**：

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

```javascript
// src/scripts/app.js - 工作流快捷按钮事件
this._bindWorkflowShortcuts() {
  const buttons = document.querySelectorAll('.workflow-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const workflowName = btn.dataset.workflow;
      this.sendMessage(`执行工作流：${workflowName}`);
    });
  });
}
```

### 6.4 实现步骤

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

## 七、项目总览

### 7.1 优化工时汇总

| 优化项 | 优先级 | 预估工时 |
|--------|--------|----------|
| 主动记忆推送（Right Panel） | **P0** | 10天 |
| 记忆分层管理 | **P0** | 13天 |
| 企业微信Bot快速收集 | **P1** | 10天 |
| 浏览器扩展 | **P1** | 13天 |
| Agentic工作流（基于ADP） | **P2** | 18天 |
| **总计** | | **64天** |

### 7.2 关键依赖关系

```
P0: 主动记忆推送 ───┐
                    ├──→ P2: Agentic工作流（基于ADP）
P0: 记忆分层管理 ───┘
       │
       ▼
P1: 企业微信Bot ───→ 需要记忆分类服务 + REST API（Web转换Phase 2）
P1: 浏览器扩展 ──→ 需要本地HTTP服务器 + REST API（Web转换Phase 2）
```

### 7.3 技术栈不变

| 层级 | 当前技术 | 优化后 |
|------|----------|--------|
| 前端 | 原生HTML/CSS/JS | 原生HTML/CSS/JS |
| 状态管理 | store.js | store.js（扩展） |
| 数据库 | SQLite | SQLite（schema升级） |
| 向量搜索 | BGE + ZVec | BGE + ZVec（扩展） |
| AI服务 | Claude Agent SDK | Claude Agent SDK（复用ADP/CC） |
| 框架 | Electron | Electron（保持不变） |

### 7.4 预期收益

| 优化项 | 预期收益 |
|--------|----------|
| 主动记忆推送 | 用户查找信息效率提升30-50% |
| 记忆分层管理 | 过期信息减少60%，检索准确率提升20% |
| 企业微信Bot | 用户记录频率提升40% |
| 浏览器扩展 | 网页内容收集效率提升50% |
| Agentic工作流 | 复杂任务处理时间减少70% |

---

## 八、风险与应对

### 8.1 技术风险

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| AI分类准确率不足 | 记忆分层效果差 | 规则匹配优先，AI分类作为补充 |
| 向量检索性能下降 | 主动推送响应慢 | 限制返回数量（5条），使用轻量模型 |
| 企业微信API限流 | 消息丢失或延迟 | 消息队列，重试机制 |

### 8.2 合规风险

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 个人微信机器人封禁 | 服务中断 | 改用企业微信API |
| 浏览器扩展审核拒绝 | 无法发布 | 遵守Chrome Web Store政策 |

### 8.3 用户体验风险

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 主动推送过多 | 用户被打扰 | 可配置推送频率，支持开关 |
| 分类错误 | 用户困惑 | 提供手动调整入口，反馈机制 |
| 新功能学习成本 | 用户不使用 | 渐进式引导，新手教程 |

### 8.4 资源风险

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 开发资源不足 | 进度延迟 | 分阶段实施，优先P0 |
| AI调用成本增加 | 运营成本上升 | 使用轻量模型（Haiku），限制调用频率 |

---

## 九、下一步行动

### 9.1 P0 优先实施

1. **立即启动**：主动记忆推送（Right Panel）开发
2. **并行推进**：记忆分层管理数据库升级
3. **2周内完成**：两个P0功能的MVP版本

### 9.2 持续迭代

- 收集用户反馈，优化主动推送算法
- 完善记忆分类规则，提升准确率
- 根据Web应用转换进度，决定P1的开发顺序

### 9.3 与Web应用转换的协调

| Web转换阶段 | 优化项就绪状态 |
|------------|--------------|
| Phase 1（基础架构） | P0功能可独立开发 |
| Phase 2（REST API） | P1功能可启动 |
| Phase 3（AI代理） | P2功能可启动 |
