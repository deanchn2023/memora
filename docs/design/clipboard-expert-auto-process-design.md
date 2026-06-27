# 剪贴板待办任务智能路由到专家 Agent 设计方案

**版本**: v1.0  
**日期**: 2026-06-27  
**状态**: 设计中

---

## 一、功能概述

当剪贴板识别到待办任务时，进一步判断该任务是否可由已配置的专家 Agent 自动处理。如果匹配到合适的专家，则：

1. 自动用该专家处理任务
2. 将处理结果与记事本中的待办事项关联
3. 可从记事本跳转到专家会话列表查看结果

### 核心价值

- **AI 原生**：从"识别待办 → 人工处理"升级为"识别待办 → AI 自动处理 → 人工确认"
- **零摩擦**：用户复制文本 → 自动识别任务 → 自动匹配专家 → 自动执行 → 结果关联到记事本
- **可追溯**：记事本中的待办项可直接跳转到专家会话查看处理过程和结果

---

## 二、现有架构分析

### 2.1 剪贴板任务识别流程

```
剪贴板变化 → preClassify 预分类 → ClipboardBuffer 缓冲聚合
    ↓
analyzeClipboardText() → L1 意图分类 → L2a 任务详情提取
    ↓
AI 返回 JSON: { is_task, title, description, time, priority, tags }
    ↓
创建待办任务 + 保存到记事本
```

**当前输出**：只识别任务，不判断是否可由 AI 处理

### 2.2 专家系统数据结构

```javascript
// 专家对象
{
  id: "expert_xxx",
  name: "产品知识助手",
  icon: "🤖",
  intro: "负责产品功能咨询、竞品分析、需求评估",  // ← 核心能力描述
  appKey: "EvcCHxUUz...",
  adpUrl: "https://wss.lke.cloud.tencent.com/adp/v2/chat",
  modes: ["agent"],           // agent=ADP, cc=M-Agent, llm=本地LLM
  quickAccesses: [            // ← 擅长场景
    { id, icon, label: "产品对比", prompt: "..." },
    { id, icon, label: "需求评估", prompt: "..." }
  ]
}
```

**能力描述来源**：
- `expert.intro`：专业领域介绍
- `expert.quickAccesses[].label`：擅长场景列表

### 2.3 记事本数据结构

```javascript
// 笔记对象
{
  id: "note_xxx",
  title: "收集整理流程问题并简化",
  content: "@Dean 找大家收集流程上的问题...",
  category: "work",
  createdAt: "2026-06-27T...",
  updatedAt: "2026-06-27T...",
  imagePath: null,
  // 新增字段：
  linkedTaskId: null,       // 关联的待办任务 ID
  linkedSessionId: null,    // 关联的专家会话 ID
  linkedExpertId: null,     // 处理该任务的专家 ID
  agentProcessed: false,    // 是否已由 Agent 处理
}
```

---

## 三、设计方案

### 3.1 整体流程

```
剪贴板内容 → AI 识别为待办任务（现有逻辑）
    ↓
新增 L3：专家匹配判断
    ├─ 匹配到专家 → 自动调用专家 Agent 处理
    │   ├─ 创建专家会话
    │   ├─ 发送任务描述
    │   ├─ 等待 Agent 响应
    │   └─ 结果关联到记事本
    └─ 未匹配到专家 → 按现有逻辑保存为普通待办
```

### 3.2 L3 专家匹配 Prompt 设计

在现有 L2a（任务详情提取）之后，新增 L3 专家匹配判断。

**Prompt 文件**: `prompts/clipboard_expert_match.md`

```markdown
# ROLE
你是 Memora 的任务路由 AI，负责判断待办任务是否可以由已配置的专家 Agent 自动处理。

# 待办任务
- 标题：{{task.title}}
- 描述：{{task.description}}
- 标签：{{task.tags}}

# 可用专家列表
{{#each experts}}
### {{this.icon}} {{this.name}}
- 专业领域：{{this.intro}}
- 擅长场景：{{#each this.quickAccesses}}{{this.label}}{{#unless @last}}、{{/unless}}{{/each}}
- ID：{{this.id}}
{{/each}}

# 判断规则

## 可自动处理的任务特征
- 产品咨询、功能查询、竞品分析 → 产品知识助手
- 需求评估、方案设计、工作量评估 → 需求分析专家
- 文档生成、报告撰写、文案起草 → 文档生成专家
- 代码审查、技术方案评估 → 技术专家
- 数据分析、报表生成 → 数据分析专家

## 不可自动处理的任务特征
- 需要人工沟通（打电话、开会、面谈）
- 需要物理操作（寄快递、签合同）
- 需要人工决策（审批、确认、拍板）
- 涉及敏感信息（薪资、人事）
- 时间驱动型（提醒、跟进），非内容处理型

# 输出格式（严格 JSON）

匹配到专家：
```json
{
  "can_auto_process": true,
  "expert_id": "expert_xxx",
  "expert_name": "产品知识助手",
  "confidence": 0.85,
  "reason": "任务涉及产品功能咨询，匹配产品知识助手的能力范围",
  "suggested_prompt": "用户需要评估以下需求的实现工作量：..."
}
```

未匹配到专家：
```json
{
  "can_auto_process": false,
  "confidence": 0.9,
  "reason": "任务需要人工沟通，不适合 AI 自动处理"
}
```

只输出 JSON，不要其他内容。
```

### 3.3 主进程实现

#### 3.3.1 新增 IPC 通道

```javascript
// main.js 新增

// 获取所有专家的能力描述（供剪贴板匹配使用）
ipcMain.handle('experts:get-capabilities', async () => {
  const experts = await getExperts(); // 从 expertStore 获取
  return experts.map(e => ({
    id: e.id,
    name: e.name,
    icon: e.icon,
    intro: e.intro || '',
    quickAccesses: (e.quickAccesses || []).map(qa => ({ label: qa.label })),
  }));
});

// 剪贴板任务匹配专家
ipcMain.handle('clipboard:match-expert', async (event, { task }) => {
  // 1. 获取所有专家能力描述
  const experts = await getExperts();
  if (!experts || experts.length === 0) {
    return { can_auto_process: false, reason: '未配置专家' };
  }

  // 2. 构建 L3 匹配 Prompt
  const prompt = buildExpertMatchPrompt(task, experts);

  // 3. 调用 AI（走 callAI 统一路由，structured=true）
  const { response } = await callAI({
    module: 'clipboard_expert_match',
    category: 'highvol',
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `任务标题：${task.title}\n描述：${task.description}\n标签：${(task.tags || []).join('、')}` }
    ],
    fetchOptions: { temperature: 0.1, max_tokens: 500 },
  });

  if (!response.ok) {
    return { can_auto_process: false, reason: 'AI 匹配失败' };
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // 4. 解析结果
  try {
    const match = JSON.parse(content.trim());
    return match;
  } catch {
    return { can_auto_process: false, reason: '解析失败' };
  }
});
```

#### 3.3.2 修改 analyzeClipboardText

```javascript
// main.js analyzeClipboardText() 中，在 is_task=true 后新增

if (result.is_task) {
  // 创建待办任务（现有逻辑）
  const task = {
    id: 'task_' + Date.now(),
    title: result.title,
    description: result.description,
    time: result.time,
    priority: result.priority,
    tags: result.tags,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  // 新增：L3 专家匹配
  if (getSetting('clipboard_expert_auto_process') !== false) {
    try {
      const matchResult = await matchExpertForTask(task);
      
      if (matchResult.can_auto_process && matchResult.confidence >= 0.7) {
        // 通知前端：匹配到专家，正在自动处理
        mainWindow?.webContents?.send('clipboard:expert-matched', {
          task,
          expert: {
            id: matchResult.expert_id,
            name: matchResult.expert_name,
          },
          confidence: matchResult.confidence,
          reason: matchResult.reason,
        });

        // 自动创建专家会话并发送任务
        const sessionResult = await autoProcessWithExpert(task, matchResult);
        
        // 更新任务状态
        task.status = 'agent_processing';
        task.linkedSessionId = sessionResult.sessionId;
        task.linkedExpertId = matchResult.expert_id;
        task.agentProcessed = true;
      }
    } catch (e) {
      console.warn('[Clipboard] Expert match failed:', e.message);
    }
  }

  // 保存任务到数据库
  saveTask(task);
}
```

#### 3.3.3 自动调用专家处理

```javascript
// main.js 新增

async function autoProcessWithExpert(task, matchResult) {
  const expert = await getExpertById(matchResult.expert_id);
  if (!expert) throw new Error('Expert not found');

  // 通知前端创建专家会话
  mainWindow?.webContents?.send('clipboard:auto-create-expert-session', {
    expertId: expert.id,
    expertName: expert.name,
    expertIcon: expert.icon,
    task,
    suggestedPrompt: matchResult.suggested_prompt || task.description,
  });

  // 前端会：
  // 1. 切换到 AI 助手视图
  // 2. 选中对应专家
  // 3. 创建新会话
  // 4. 自动发送 suggestedPrompt
  // 5. 会话完成后关联到记事本

  return {
    sessionId: null, // 前端创建后回传
    expertId: expert.id,
  };
}
```

### 3.4 渲染进程实现

#### 3.4.1 监听专家匹配事件

```javascript
// src/scripts/app.js init() 中新增

// 剪贴板任务匹配到专家
window.electronAPI?.onClipboardExpertMatched?.((data) => {
  const { task, expert, confidence, reason } = data;
  
  // 显示通知
  this._showExpertMatchNotification(task, expert, confidence, reason);
});

// 自动创建专家会话
window.electronAPI?.onAutoCreateExpertSession?.((data) => {
  const { expertId, expertName, expertIcon, task, suggestedPrompt } = data;
  
  // 1. 切换到 AI 助手视图
  document.querySelector('.view-tab[data-view="ai-assistant"]')?.click();
  
  // 2. 选中对应专家
  if (window.ExpertSystem) {
    window.ExpertSystem._activeExpertId = expertId;
    window.ExpertSystem._updateExpertUI();
  }
  
  // 3. 创建新会话
  this.createNewChatSession();
  
  // 4. 填入建议 Prompt 并自动发送
  const input = document.getElementById('aiChatInput');
  if (input) {
    input.value = suggestedPrompt;
    this.sendAIMessage();
  }
  
  // 5. 标记当前会话与记事本任务关联
  if (this._activeSessionId) {
    this._linkSessionToNote(this._activeSessionId, task.id);
  }
});
```

#### 3.4.2 专家匹配通知 UI

```javascript
_showExpertMatchNotification(task, expert, confidence, reason) {
  // 创建浮动通知卡片
  const notification = document.createElement('div');
  notification.className = 'expert-match-notification';
  notification.innerHTML = `
    <div class="expert-match-header">
      <span class="expert-match-icon">${expert.icon || '🤖'}</span>
      <span class="expert-match-title">⚡ AI 自动处理</span>
      <span class="expert-match-confidence">${Math.round(confidence * 100)}% 匹配</span>
    </div>
    <div class="expert-match-body">
      <div class="expert-match-task">📋 ${this.escapeHtml(task.title)}</div>
      <div class="expert-match-expert">→ ${this.escapeHtml(expert.name)} 正在处理</div>
      <div class="expert-match-reason">${this.escapeHtml(reason)}</div>
    </div>
    <div class="expert-match-actions">
      <button class="expert-match-btn view" data-action="view">查看进度</button>
      <button class="expert-match-btn dismiss" data-action="dismiss">知道了</button>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // 5 秒后自动消失
  setTimeout(() => notification.classList.add('fade-out'), 5000);
  setTimeout(() => notification.remove(), 5500);
  
  // 按钮事件
  notification.querySelector('[data-action="view"]')?.addEventListener('click', () => {
    document.querySelector('.view-tab[data-view="ai-assistant"]')?.click();
    notification.remove();
  });
  notification.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
    notification.remove();
  });
}
```

#### 3.4.3 记事本关联与跳转

```javascript
/**
 * 关联会话到记事本任务
 */
_linkSessionToNote(sessionId, taskId) {
  // 找到对应的笔记（通过 taskId 关联）
  const notes = notebook?.notes || [];
  const note = notes.find(n => n.linkedTaskId === taskId);
  if (note) {
    note.linkedSessionId = sessionId;
    note.agentProcessed = true;
    note.updatedAt = new Date().toISOString();
    // 保存
    window.electronAPI?.notebookUpdateNote(note.id, {
      linkedSessionId: sessionId,
      agentProcessed: true,
    });
  }
}

/**
 * 从记事本跳转到专家会话
 */
jumpToExpertSession(noteId) {
  const note = notebook?.notes?.find(n => n.id === noteId);
  if (!note?.linkedSessionId) {
    this.showToast('该待办未关联专家会话', 'info');
    return;
  }
  
  // 切换到 AI 助手视图
  document.querySelector('.view-tab[data-view="ai-assistant"]')?.click();
  
  // 切换到关联的会话
  this.switchChatSession(note.linkedSessionId);
  
  this.showToast(`已跳转到专家会话`, 'success');
}
```

### 3.5 记事本 UI 改造

在记事本列表中，对于已关联专家会话的待办项，添加状态标识和跳转按钮：

```
┌─────────────────────────────────────────────────┐
│ 📋 收集整理流程问题并简化                    [⋮] │
│ @Dean 找大家收集流程上的问题...                  │
│ 🤖 产品知识助手已处理 · 2小时前                   │
│ [📋 查看专家处理结果]                             │
└─────────────────────────────────────────────────┘
```

```javascript
// 记事本渲染中新增
if (note.agentProcessed && note.linkedSessionId) {
  html += `
    <div class="note-agent-badge">
      <span class="note-agent-icon">🤖</span>
      <span class="note-agent-text">已由 AI 专家处理</span>
      <button class="note-agent-jump" data-note-id="${note.id}">查看结果 →</button>
    </div>
  `;
}
```

### 3.6 CSS 样式

```css
/* 专家匹配通知 */
.expert-match-notification {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 340px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
  padding: 16px;
  z-index: 15000;
  animation: slideUp 0.3s ease;
  transition: opacity 0.3s;
}

.expert-match-notification.fade-out {
  opacity: 0;
}

.expert-match-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.expert-match-icon {
  font-size: 20px;
}

.expert-match-title {
  font-size: 14px;
  font-weight: 600;
  color: #1d1d1f;
  flex: 1;
}

.expert-match-confidence {
  font-size: 11px;
  color: #34C759;
  background: rgba(52, 199, 89, 0.1);
  padding: 2px 8px;
  border-radius: 6px;
}

.expert-match-body {
  font-size: 13px;
  color: #1d1d1f;
  margin-bottom: 12px;
}

.expert-match-task {
  font-weight: 500;
  margin-bottom: 4px;
}

.expert-match-expert {
  color: #007AFF;
  margin-bottom: 4px;
}

.expert-match-reason {
  font-size: 12px;
  color: #86868b;
}

.expert-match-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.expert-match-btn {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  border: none;
  transition: background 0.2s;
}

.expert-match-btn.view {
  background: #007AFF;
  color: white;
}

.expert-match-btn.view:hover {
  background: #0051D5;
}

.expert-match-btn.dismiss {
  background: rgba(0, 0, 0, 0.06);
  color: #86868b;
}

/* 记事本中的 Agent 处理标识 */
.note-agent-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 6px 10px;
  background: rgba(0, 122, 255, 0.06);
  border-radius: 8px;
  font-size: 12px;
}

.note-agent-icon {
  font-size: 14px;
}

.note-agent-text {
  color: #007AFF;
  font-weight: 500;
}

.note-agent-jump {
  margin-left: auto;
  background: none;
  border: none;
  color: #007AFF;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
}

.note-agent-jump:hover {
  background: rgba(0, 122, 255, 0.1);
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
```

---

## 四、配置项

| 配置 Key | 默认值 | 说明 |
|----------|--------|------|
| `clipboard_expert_auto_process` | `true` | 是否开启专家自动处理 |
| `clipboard_expert_match_threshold` | `0.7` | 专家匹配置信度阈值 |
| `clipboard_expert_auto_send` | `true` | 匹配后是否自动发送，false 则只通知不自动发 |

---

## 五、数据流

```
1. 用户复制文本 "明天需要评估一下 ADP 4.0 私有化部署的工作量"
    ↓
2. 剪贴板调度器 → analyzeClipboardText()
    ↓
3. L1 分类 → is_task=true（有明确行动词"评估"）
    ↓
4. L2a 任务提取 → { title: "评估 ADP 4.0 私有化部署工作量", ... }
    ↓
5. L3 专家匹配（新增）
    ├─ 输入：任务描述 + 所有专家能力描述
    ├─ AI 判断：匹配"需求分析专家"（confidence=0.88）
    └─ 输出：{ can_auto_process: true, expert_id: "expert_xxx", suggested_prompt: "..." }
    ↓
6. 通知前端
    ├─ 显示浮动通知"⚡ AI 自动处理 - 需求分析专家正在处理"
    ├─ 切换到 AI 助手视图
    ├─ 选中需求分析专家
    ├─ 创建新会话
    ├─ 自动发送 suggested_prompt
    └─ 标记会话与记事本关联
    ↓
7. 专家 Agent 响应完成
    ↓
8. 更新记事本
    ├─ 笔记添加 🤖 已处理标识
    └─ 添加"查看专家处理结果 →"跳转按钮
    ↓
9. 用户点击跳转 → 切换到专家会话查看结果
```

---

## 六、边界条件处理

| 场景 | 处理方式 |
|------|----------|
| 未配置任何专家 | 跳过 L3，按普通待办保存 |
| 专家 AppKey 未配置 | 跳过自动处理，通知用户"专家未配置" |
| AI 匹配置信度 < 阈值 | 不自动处理，但显示"推荐专家"建议 |
| 专家处理失败 | 记事本标注"AI 处理失败"，保留原始待办 |
| 用户关闭自动处理 | 只识别任务，不调用专家 |
| 多个专家匹配 | 取置信度最高的 |
| 离线状态 | 跳过 L3，按普通待办保存，联网后不自动补处理 |

---

## 七、文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `prompts/clipboard_expert_match.md` | 新增 | L3 专家匹配 Prompt 模板 |
| `main.js` | 修改 | 新增 `clipboard:match-expert` IPC + 修改 `analyzeClipboardText` |
| `src/scripts/app.js` | 修改 | 监听匹配事件 + 自动创建会话 + 记事本关联 |
| `src/scripts/clipboard.js`（如有） | 修改 | 记事本渲染添加 Agent 标识和跳转 |
| `src/styles/components.css` | 修改 | 通知卡片 + 记事本标识样式 |
| `preload.js` | 修改 | 暴露新 IPC 通道 |

---

## 八、开发计划

### Phase 1：L3 专家匹配（2 天）
- [ ] 编写 `clipboard_expert_match.md` Prompt
- [ ] 主进程实现 `matchExpertForTask()` 函数
- [ ] 修改 `analyzeClipboardText()` 接入 L3
- [ ] 新增 IPC 通道

### Phase 2：自动处理 + 通知（2 天）
- [ ] 前端监听匹配事件
- [ ] 实现自动创建专家会话
- [ ] 浮动通知 UI
- [ ] 配置项支持

### Phase 3：记事本关联（1 天）
- [ ] 笔记数据结构扩展
- [ ] 记事本列表添加 Agent 标识
- [ ] 跳转到专家会话功能
- [ ] 端到端测试

---

**文档版本**: v1.0  
**最后更新**: 2026-06-27
