# Memora 性能分析与优化建议

> 基于代码审查，日期 2026-06-14

---

## 📊 总览

| 维度 | 现状 | 风险等级 |
|------|------|---------|
| 主进程同步 I/O | 59处 readFileSync + 32处 writeFileSync | 🔴 严重 |
| JSON 解析开销 | 88+ 处 JSON.parse，含大文件全量解析 | 🔴 严重 |
| 主进程行数 | ~13,700 行单文件 | 🟡 中等 |
| Canvas 力导向图 | 无 requestAnimationFrame 清理 | 🟡 中等 |
| CSS 性能 | 大量 backdrop-filter 毛玻璃 | 🟡 中等 |
| IPC 处理器数量 | 200+ 个 | 🟡 中等 |
| 定时器泄漏 | 2处未清理 | 🟡 中等 |

---

## 🔴 严重问题

### 1. 主进程同步 I/O 阻塞

**根因**：Electron 主进程是 Node.js 单线程，任何 `fs.readFileSync`/`fs.writeFileSync` 都会阻塞窗口渲染、IPC 响应和剪贴板监控。

**热点**：

| 位置 | 操作 | 影响 |
|------|------|------|
| `main.js:1688` | `JSON.parse(fs.readFileSync(settingsPath))` | 每次读设置都同步读磁盘 |
| `main.js:1707` | `fs.writeFileSync(settingsPath, ...)` | 每次改设置都同步写磁盘 |
| `main.js:11517-11648` | 洞察模块连续 5+ 次 `readFileSync` | 打开洞察标签时串行读 5 个 JSON 文件 |
| `main.js:11625` | 循环中逐文件 `readFileSync` | N 篇文章 = N 次同步 I/O |
| `main.js:6378` | `fs.readFileSync(fullPath)` 图片读取 | 大图长时间阻塞主进程 |
| `main.js:584/631` | `fs.appendFileSync(...)` 审计日志 | 高频场景累积阻塞 |
| `main.js:8165/8336` | 重复读取 `profile.json` | 多处代码各自读取同一文件 |

**优化方案**：

```javascript
// ❌ 当前：同步阻塞
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// ✅ 优化：异步 + 内存缓存
const fileCache = new Map();
async function readJsonCached(filePath, ttlMs = 60000) {
  const cached = fileCache.get(filePath);
  if (cached && Date.now() - cached.ts < ttlMs) return cached.data;
  const raw = await fs.promises.readFile(filePath, 'utf8');
  const data = JSON.parse(raw);
  fileCache.set(filePath, { data, ts: Date.now() });
  return data;
}

// ❌ 当前：每次修改立即写
setSetting(key, value) { ... fs.writeFileSync(...) }

// ✅ 优化：防抖写入
let saveTimer = null;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await fs.promises.writeFile(settingsPath, JSON.stringify(settingsCache, null, 2));
  }, 100);
}
```

### 2. 洞察模块串行读取 5+ 个 JSON 文件

**位置**：`main.js:11517-11648`（知识活化、缺口分析、冲突检测）

**当前流程**：
```
readFileSync(memories.json) → parse → 
readFileSync(atoms.json) → parse → 
readFileSync(entity-graph.json) → parse → 
readFileSync(article-1.json) → parse → ...
```

**优化方案**：
```javascript
// 并行读取 + 缓存
const [memories, atoms, graph] = await Promise.all([
  readJsonCached(memoriesPath),
  readJsonCached(atomsPath),
  readJsonCached(entityPath)
]);
```

### 3. 审计日志高频同步写入

**位置**：`main.js:584/631` — `fs.appendFileSync()`

**优化方案**：改为批量写入
```javascript
let logBuffer = [];
let logFlushTimer = null;

function bufferedLog(line) {
  logBuffer.push(line);
  if (!logFlushTimer) {
    logFlushTimer = setTimeout(async () => {
      const batch = logBuffer.join('\n') + '\n';
      logBuffer = [];
      logFlushTimer = null;
      await fs.promises.appendFile(logPath, batch);
    }, 1000);
  }
}
```

---

## 🟡 中等问题

### 4. 关系图谱 Canvas 力导向模拟

**位置**：`src/scripts/relationship.js:321-379`

**问题**：
- `requestAnimationFrame` 动画循环在标签切换后没有清理（`animId` 是局部变量）
- 120 帧模拟后停止，但 Canvas 点击事件触发的 `_drawGraph` 会重新启动
- 30+ 人物节点时 O(n²) 斥力计算

**优化方案**：
```javascript
// 1. 将 animId 提升为实例属性，标签切换时清理
this._graphAnimId = null;

// 在 load() 开头清理
if (this._graphAnimId) {
  cancelAnimationFrame(this._graphAnimId);
  this._graphAnimId = null;
}

// 2. 大节点数时降低迭代次数
const maxIter = persons.length > 30 ? 60 : 120;

// 3. 使用 Web Worker 做力模拟计算（可选，30+ 节点时）
```

### 5. CSS backdrop-filter 性能

**位置**：多处 CSS 使用 `backdrop-filter: blur(20px)`

**问题**：macOS 上 `backdrop-filter` 消耗 GPU 资源，多个叠加元素在滚动时造成帧率下降。

**优化方案**：
```css
/* 仅在静态/不滚动区域使用 */
.modal-overlay { backdrop-filter: blur(20px); } /* ✅ 静态 */

/* 可滚动区域避免使用，改用半透明背景 */
.scrollable-area { background: rgba(255,255,255,0.85); } /* ✅ 性能更好 */
```

### 6. 主进程单文件过大 (13,700行)

**问题**：`main.js` 单文件超过 13,000 行，严重影响可维护性和加载速度。

**优化方案**：按模块拆分
```
main.js (入口，<200行)
├── ipc/auth.js        — 认证相关 IPC
├── ipc/clipboard.js   — 剪贴板 IPC
├── ipc/knowledge.js   — 知识相关 IPC
├── ipc/insight.js     — 洞察相关 IPC
├── ipc/relationship.js — 人脉 IPC
├── ipc/pomodoro.js    — 番茄钟 IPC
├── services/ai.js     — AI 调用路由
├── services/files.js  — 文件操作
└── utils/cache.js     — 缓存工具
```

### 7. JSON.parse(JSON.stringify()) 深拷贝

**位置**：`main.js:235`

**优化**：
```javascript
// ❌ 当前
const servers = JSON.parse(JSON.stringify(DEFAULT_AUTH_SERVERS));

// ✅ 优化
const servers = structuredClone(DEFAULT_AUTH_SERVERS);
```

### 8. 定时器泄漏

| 定时器 | 位置 | 问题 |
|--------|------|------|
| 周优化器 | `main.js:7967` | `setInterval` 未保存引用，无法清除 |
| Widget 同步 | `main.js:13736` | `widgetSyncTimer` 在 `before-quit` 中未清理 |

**修复**：
```javascript
// 保存引用
const weeklyOptimizerTimer = setInterval(checkWeeklyOptimizer, 60*60*1000);

// 在 app 'before-quit' 中清理
app.on('before-quit', () => {
  clearInterval(weeklyOptimizerTimer);
  clearInterval(widgetSyncTimer);
});
```

---

## 📈 优化优先级

| 优先级 | 优化项 | 预期收益 | 实施难度 |
|--------|--------|---------|---------|
| P0 | 同步 I/O → 异步 + 缓存 | 消除界面卡顿 | 中 |
| P0 | 洞察模块并行读取 | 洞察加载提速 3-5x | 低 |
| P1 | 设置写入防抖 | 减少磁盘 I/O 80% | 低 |
| P1 | 审计日志批量写入 | 减少高频写入阻塞 | 低 |
| P1 | Canvas 动画清理 | 消除标签切换后 CPU 占用 | 低 |
| P2 | 主进程模块拆分 | 可维护性大幅提升 | 高 |
| P2 | 图片读取异步化 | 大图加载不阻塞 | 中 |
| P3 | backdrop-filter 降级 | 滚动帧率提升 | 低 |
| P3 | structuredClone 替代 | 微小性能提升 | 极低 |

---

## 🎯 快速见效方案（可立即实施）

1. **洞察并行读取**（5分钟）：将串行 `readFileSync` 改为 `Promise.all` + `readJsonCached`
2. **设置写入防抖**（10分钟）：`setSetting` 中 `writeFileSync` 加 debounce
3. **Canvas 动画清理**（5分钟）：提升 `animId` 为实例属性，`load()` 时清除
4. **定时器泄漏修复**（5分钟）：保存引用 + `before-quit` 清理
5. **structuredClone 替代**（1分钟）：行235 一行代码
