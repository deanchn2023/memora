# 剪贴板监控系统优化设计 v2

## 1. 现状分析

### 当前实现（main.js L926-L945）
- **固定轮询间隔**: 10秒（`setInterval`）
- **简单去重**: 仅与 `lastClipboardText` 比较 + `processedClipboardHashes` Set（500条）
- **立即处理**: 检测到变化直接调用 `analyzeClipboardText()`
- **管线流程**: `preClassify → 去重 → AI配额 → AI调用 → 解析JSON → 保存记事本 → 知识萃取 → 记忆提取 → 意图分类 → 知识推荐 → IPC推送`

### 存在的问题
1. **聊天场景碎片复制**: 用户从聊天软件逐条复制消息（可能每秒一条），每次都触发独立 AI 分析，产生大量碎片结果
2. **无法拼接完整上下文**: 用户无法一次性复制整段对话，只能一条一段复制，10秒间隔导致中间态被独立分析
3. **静态频率**: 无论用户是否活跃都是10秒轮询
4. **无人操作时浪费**: 屏幕锁定或用户离开时仍在监控
5. **`clipboard-candidate-detected` 事件无人消费**: 主进程发出但前端未监听
6. **`String.prototype.hashCode` 污染全局原型**: 应改为工具函数

---

## 2. 优化方案

### 2.1 核心设计原则
- **时间窗口暂存**: 聚合短时间内的多次复制，等用户"复制完毕"再整体分析
- **AI 判断关联**: 语义相关性、与已处理内容的关联，全部交给 AI API，不用规则硬判
- **高频延长策略**: 检测到高频复制时**延长等待**（而非加快检测），让暂存器聚合更多片段
- **状态感知**: 检测屏幕锁定/用户离开状态，节省资源
- **回退安全**: 一键切回简单模式

---

### 2.2 系统架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                     剪贴板监控系统（主进程）                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │  内容暂存器        │  │  频率控制器       │  │  状态检测器    │  │
│  │ (ClipboardBuffer) │  │ (FreqController)  │  │ (StateDetect)  │  │
│  └────────┬───────────┘  └────────┬─────────┘  └───────┬────────┘  │
│           │                       │                     │           │
│           └───────────┬───────────┴───────────┬─────────┘           │
│                       │                       │                     │
│                       ▼                       ▼                     │
│               ┌─────────────────────────────────────────┐          │
│               │          调度引擎                       │          │
│               │     (ClipboardScheduler)                │          │
│               └──────────────┬──────────────────────────┘          │
│                              │                                      │
│                              ▼                                      │
│                  ┌──────────────────────┐                          │
│                  │  现有分析管线        │                          │
│                  │  analyzeClipboardText │                          │
│                  │  + 关联检测（AI）    │                          │
│                  └──────────────────────┘                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

> **关键**: 所有模块运行在 Electron **主进程**（非渲染进程），因为需要访问 `clipboard.readText()` 和 `powerMonitor`。

---

## 3. 模块详细设计

### 3.1 内容暂存器 (ClipboardBuffer)

#### 设计目标
- 聚合短时间内的多次复制操作（聊天场景核心需求）
- 判断内容是否"稳定"（用户复制完毕）
- 合并后整体交给 AI，而非逐条分析

#### 数据结构
```javascript
class ClipboardBuffer {
  fragments: Array<{
    text: string;          // 原始片段
    timestamp: number;     // 复制时间
    preClassifyResult: object; // 预分类结果（入场时就做）
  }>;
  lastUpdateTime: number;     // 最后更新时间戳
  stableTimer: NodeJS.Timeout | null; // 稳定计时器
  isStable: boolean;          // 是否已稳定
  maxFragments: number;       // 最大片段数（防内存膨胀，默认 20）
  maxTotalLength: number;     // 合并后最大总长度（默认 3000 字符）
}
```

#### 核心逻辑

**入场条件**（每次轮询检测到新内容时）:
1. 先做轻量 `preClassify()` — 不通过的立即丢弃，不进入暂存
2. 通过 → 追加到 `fragments`，重置稳定计时器
3. 片段数 ≥ `maxFragments` → 提前稳定（防内存膨胀）
4. 合并总长度 ≥ `maxTotalLength` → 提前稳定

**稳定判定**（核心改动）:
| 条件 | 超时 | 说明 |
|------|------|------|
| 正常模式（低频复制） | 3 秒 | 单次复制后等待 |
| 高频模式（5秒内复制 ≥ 2次） | 5 秒 | 延长等待，让用户复制完更多片段 |
| 超高频模式（2秒内复制 ≥ 3次） | 8 秒 | 正在密集从聊天复制，给足时间 |
| 片段数/长度达到上限 | 立即 | 防内存膨胀 |

> **关键**: 高频复制 → **延长等待**，而非加快检测。用户在快速复制时，我们要等他"复制完"，而不是更频繁地截获中间态。

**合并策略**:
- **第一版（简单可靠）**: 片段用换行分隔拼接 `\n\n---\n\n`
- 不做"智能合并"（去重复前缀后缀等），这些算法容易出错，交给 AI 理解即可

**合并后输出**:
```
[以下是从剪贴板分 3 次复制的内容，按时间顺序拼接]

片段1内容

---

片段2内容

---

片段3内容
```

---

### 3.2 动态频率控制器 (FreqController)

#### 频率档位
| 档位 | 轮询间隔 | 触发条件 | 稳定超时 |
|------|----------|----------|----------|
| 中频 | 2s | 默认状态 | 3s |
| 低频 | 15s | 60秒无任何复制操作 | 3s |
| 暂停 | - | 屏幕锁定/屏保 | - |

> **注意**: 不设"高频1s"模式。轮询频率只需要"不漏检"即可，2秒已足够。核心优化在**稳定超时**的动态调整，而非轮询频率。

#### 实现方式
```javascript
class FrequencyController {
  currentInterval: number;       // 当前轮询间隔
  lastCopyTimestamps: number[];  // 最近N次复制时间（最多50条）
  stableTimeout: number;        // 当前稳定超时

  // 记录一次复制事件，返回建议的稳定超时
  recordCopy(): number;

  // 计算当前轮询间隔
  computeInterval(): number;

  // 清理超过1小时的历史
  cleanup(): void;
}
```

#### 高频检测 → 延长稳定超时
```javascript
recordCopy() {
  const now = Date.now();
  this.lastCopyTimestamps.push(now);
  // 只保留最近 50 条
  if (this.lastCopyTimestamps.length > 50) this.lastCopyTimestamps.shift();

  // 统计最近 5 秒内的复制次数
  const recent5s = this.lastCopyTimestamps.filter(t => now - t < 5000);
  // 统计最近 2 秒内的复制次数
  const recent2s = this.lastCopyTimestamps.filter(t => now - t < 2000);

  if (recent2s.length >= 3) return 8000;  // 超高频：8秒
  if (recent5s.length >= 2) return 5000;  // 高频：5秒
  return 3000;                            // 正常：3秒
}
```

---

### 3.3 状态检测器 (StateDetect)

#### 检测方式 (Electron 主进程 API)
```javascript
// 屏幕锁定检测（零成本，事件驱动）
powerMonitor.on('lock-screen', () => { /* 暂停监控 */ });
powerMonitor.on('unlock-screen', () => { /* 恢复监控，检查期间剪贴板 */ });

// 系统空闲检测（用于降频，非轮询）
// powerMonitor.getSystemIdleState() 只在频率控制器计算间隔时调用
```

---

### 3.4 调度引擎 (ClipboardScheduler)

#### 核心流程
```
1. 轮询检测到剪贴板变化
   ↓
2. 轻量 preClassify → 不通过则丢弃
   ↓
3. 追加到暂存器 + 重置稳定计时器
   ↓
4. 高频检测 → 动态调整稳定超时
   ↓
5. 稳定后 → 合并片段
   ↓
6. 调用 analyzeClipboardText(mergedText)（复用现有管线）
   ↓
7. AI 分析结果中新增"关联检测"维度
   ↓
8. 如有关联 → 更新已有知识/待办
```

#### 状态转换图
```
[空闲] → (检测到变化) → [暂存中] → (稳定) → [分析中] → (完成) → [空闲]
           ↑                               ↓
           └── (新内容追加，重置计时器) ─────┘
```

#### 与现有管线衔接

暂存器合并后的文本，直接传入现有的 `analyzeClipboardText(mergedText)`。管线不变：
```
preClassify（已提前在入场时做） → 去重 → AI配额 → AI调用 → 
解析JSON → 保存记事本 → 知识萃取 → 记忆提取 → 意图分类 → 知识推荐 → IPC推送
```

**衔接细节**:
- `preClassify` 在入场时已做，但 `analyzeClipboardText` 内部还会再次调用——不冲突，第二次直接通过
- 合并文本长度可能超过原 `FILTER_CONFIG.maxLength`——需要在暂存阶段使用独立的 `maxTotalLength`（默认3000），而非1000
- `isClipboardProcessed` 去重检查使用合并后的整体文本 hash，与逐条 hash 不冲突

---

## 4. AI 关联检测（核心新增）

### 4.1 设计目标

当新内容（合并后）进入 AI 分析时，不仅分析其自身，还要判断是否与**已处理过的内容**有关联，从而：
- 更新已有待办的优先级/状态
- 补充已有知识的上下文
- 合并重复的知识原子

### 4.2 实现方案

在现有 `analyzeClipboardText` 的 AI prompt 中新增关联检测维度。

#### Prompt 增量
```
你在分析用户剪贴板内容时，还需要检测与已有内容是否有关联。

已有相关内容（最近处理的5条）：
{recent_processed_items}

如果新内容与已有内容有关联，在 JSON 结果中增加 associated_with 字段：
{
  ...原有字段...,
  "associated_with": {
    "has_association": true,
    "target_id": "已有内容的ID",
    "association_type": "supplement" | "update" | "duplicate" | "related",
    "reason": "关联原因说明"
  }
}

关联类型说明：
- supplement: 新内容是已有内容的补充信息
- update: 新内容更新了已有内容（如任务状态变化）
- duplicate: 新内容与已有内容重复
- related: 主题相关但独立
```

#### 关联处理逻辑
```javascript
// 在 analyzeClipboardText 解析 AI 结果后
if (result.associated_with?.has_association) {
  switch (result.associated_with.association_type) {
    case 'supplement':
      // 将新内容追加到已有记事本条目的补充信息
      notebook.appendToNote(result.associated_with.target_id, text);
      break;
    case 'update':
      // 更新已有待办的状态/优先级
      notebook.updateNote(result.associated_with.target_id, {
        status: result.status,
        priority: result.priority,
        updatedAt: new Date()
      });
      break;
    case 'duplicate':
      // 跳过，不重复记录
      return;
    case 'related':
      // 独立创建，但标记关联
      notebook.addNote({ ...noteData, relatedTo: result.associated_with.target_id });
      break;
  }
}
```

#### 已处理内容检索

为 AI 提供的"已有相关内容"来源：
```javascript
// 从记事本获取最近 5 条（按时间倒序）
const recentItems = notebook.getNotes({ limit: 5, sort: 'desc' });

// 格式化供 AI 参考
const recentProcessed = recentItems.map(item => 
  `ID: ${item.id} | 类型: ${item.category} | 标题: ${item.title} | 摘要: ${item.content.substring(0, 100)}`
).join('\n');
```

> **为什么用 AI 而非规则做关联**: 用户明确提出"复杂的判断都交给大模型 API"。规则判断语义关联极不可靠（同义词、上下文指代、隐含关系），而 AI 只需在现有 prompt 中增加一个维度，成本几乎不增（输出 token 多 50-100 个），效果远超规则。

---

## 5. 配置参数

### 可配置项 (Settings)
```javascript
{
  // 暂存相关
  clipboard_buffer_enabled: true,              // 是否启用暂存
  clipboard_stable_timeout_normal: 3000,       // 正常稳定超时（毫秒）
  clipboard_stable_timeout_highfreq: 5000,     // 高频复制稳定超时
  clipboard_stable_timeout_ultrafreq: 8000,    // 超高频复制稳定超时
  clipboard_max_fragments: 20,                 // 最大暂存片段数
  clipboard_max_total_length: 3000,            // 合并后最大总长度
  
  // 频率相关
  clipboard_freq_enabled: true,                // 是否启用动态频率
  clipboard_freq_normal: 2000,                 // 正常间隔（毫秒）
  clipboard_freq_idle: 15000,                  // 空闲间隔（毫秒）
  clipboard_idle_threshold: 60000,             // 空闲判定阈值
  
  // 关联检测
  clipboard_association_enabled: true,         // 是否启用关联检测
  clipboard_association_recent_count: 5,       // 提供给AI的最近条目数
  
  // 状态检测相关
  clipboard_pause_on_lock: true,               // 屏幕锁定时暂停
}
```

---

## 6. 用户界面

### 6.1 设置面板
在设置中增加"剪贴板监控"选项卡：

```
┌─────────────────────────────────────────────────────┐
│  剪贴板监控设置                                      │
├─────────────────────────────────────────────────────┤
│  ☑️ 启用智能暂存                                    │
│     正常等待时间: [ 3 秒]                            │
│     高频复制等待时间: [ 5 秒] ⏱️                     │
│     超高频复制等待时间: [ 8 秒] ⏱️                   │
│     最大片段数: [ 20 ]                               │
│                                                     │
│  ☑️ 动态调整检测频率                                 │
│     正常时: [ 2 秒]                                  │
│     空闲时（60秒无复制）: [ 15 秒]                    │
│                                                     │
│  ☑️ 智能关联检测                                     │
│     自动检测与已处理内容的关联                         │
│     关联时自动更新已有待办/知识                        │
│                                                     │
│  ☑️ 屏幕锁定时暂停监控                               │
│                                                     │
│  [重置为默认]                                        │
└─────────────────────────────────────────────────────┘
```

### 6.2 暂存状态提示
- 暂存中: `⏳ 正在聚合内容（3/20 片段）...`
- 分析中: `🧠 正在分析...`
- 关联更新: `🔗 已更新相关待办「xxx」`

### 6.3 修复 `clipboard-candidate-detected`
当前主进程发出此事件但前端未监听。方案：
- `preload.js` 添加 `onClipboardCandidateDetected` 监听
- 前端接收后以"待确认卡片"形式展示在知识蒸馏页面
- 用户可手动确认或忽略

---

## 7. 边缘情况处理

| 场景 | 处理策略 |
|------|----------|
| 用户复制同一内容多次 | `processedClipboardHashes` 去重，仅处理第一次 |
| 用户复制→取消→重新复制 | 稳定计时器重置，暂存器追加新片段 |
| 聊天消息逐条复制（1秒1条） | 高频检测→稳定超时延长到8秒→等复制完毕后合并分析 |
| 复制代码片段 → 复制自然语言 | preClassify 在入场时过滤代码，自然语言单独暂存 |
| 屏保启动 → 用户返回 | 暂停→恢复，检查期间剪贴板是否有新内容 |
| 应用在后台时复制 | 暂存，用户切换回前台后稳定触发分析 |
| 合并文本超长（>3000字） | 达到 `maxTotalLength` 立即稳定，分批处理 |
| 新内容与已处理内容关联 | AI 关联检测→自动补充/更新已有条目 |
| 新内容与已处理内容重复 | AI 关联检测→标记 duplicate→跳过 |
| 暂存器已满（20片段） | 立即稳定，不再追加 |

---

## 8. 实现步骤

### Phase 1: 基础框架 + 暂存机制
- [x] 从 `main.js` 抽取剪贴板监控代码到 `clipboard/` 目录（主进程侧）
- [x] 实现 `ClipboardBuffer` 暂存器（时间窗口聚合 + preClassify 入场过滤）
- [x] 实现动态稳定超时（高频→延长等待）
- [x] 合并后调用现有 `analyzeClipboardText(mergedText)`
- [x] 修复 `String.prototype.hashCode` → 改为 `getClipboardHash()` 工具函数
- [x] 修复 `clipboard-candidate-detected` 无人消费问题

### Phase 2: 动态频率 + 状态感知
- [x] 实现 `FrequencyController`（2档：正常/空闲）
- [x] 集成 `powerMonitor` 屏幕锁定检测
- [x] 屏幕解锁后检查剪贴板是否有新内容

### Phase 3: AI 关联检测
- [x] 修改 AI 分析 prompt，增加关联检测维度
- [x] 实现关联处理逻辑（supplement/update/duplicate/related）
- [x] 记事本增加 supplements/updates 字段支持

### Phase 4: UI & 配置
- [x] 添加配置获取/更新 IPC（clipboard:get-config / clipboard:update-config）
- [x] 添加暂存状态提示（clipboard-buffer-status 事件）
- [x] 添加候选事件处理（clipboard-candidate-detected）
- [x] 添加关联通知（clipboard-association-detected）
- [x] 回退方案：配置开关控制（clipboard_buffer_enabled / clipboard_freq_enabled / clipboard_association_enabled）
- [ ] 设置面板 UI（后续迭代）

---

## 9. 代码结构

```
clipboard/                    # 主进程侧（非 src/scripts/）
├── ClipboardBuffer.js       # 内容暂存器
├── FreqController.js        # 频率控制器
├── StateDetector.js         # 状态检测器（powerMonitor）
├── ClipboardScheduler.js    # 调度引擎
├── associationHandler.js    # AI 关联检测处理
├── hashUtils.js             # 哈希工具函数（替代原型污染）
└── index.js                 # 主入口，导出 startClipboardWatcher()
```

> **重要**: 这些模块在 Electron **主进程**中运行，因为需要访问 `clipboard.readText()`、`powerMonitor` 等主进程 API。`src/scripts/` 是渲染进程代码，无法使用这些 API。

---

## 10. 性能分析

### 资源占用
| 操作 | CPU | 说明 |
|------|-----|------|
| 2秒轮询读取剪贴板 | <0.05% | 单次 `clipboard.readText()` 极轻量 |
| preClassify 入场过滤 | <0.01% | 纯正则匹配 |
| 15秒空闲轮询 | <0.01% | 几乎无消耗 |
| 暂存器内存 | <50KB | 最多20片段×1.5KB |

### AI 调用优化
| 优化点 | 效果 |
|--------|------|
| 暂存合并 | 3条碎片→1次AI调用（原3次） |
| preClassify 入场 | 无效内容不入暂存，减少AI调用 |
| 关联检测增量 | 仅增加50-100输出token，效果远超规则 |

---

## 11. 回退方案

1. `clipboard_buffer_enabled: false` → 关闭暂存，回到"检测即分析"模式
2. `clipboard_freq_enabled: false` → 回到固定10秒轮询
3. `clipboard_association_enabled: false` → 关闭关联检测
4. 保留原有代码路径，配置开关控制走新/旧逻辑
