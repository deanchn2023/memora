# 前端性能优化规则

> 适用于所有前端项目（Electron / Web / Hybrid），从项目初始化即遵循。
> 基于 Memora v3.0 重构经验总结。

---

## 一、事件委托（Event Delegation）

### 规则 1.1：禁止在渲染方法中对动态元素逐个 addEventListener

```javascript
// ❌ 错误：每次渲染绑定 N×7 个监听器
container.querySelectorAll('.task-item').forEach(item => {
  const taskId = item.dataset.id;
  item.addEventListener('mouseenter', (e) => { ... });
  item.addEventListener('mouseleave', () => { ... });
  item.addEventListener('mousemove', (e) => { ... });
  item.querySelector('.task-checkbox').addEventListener('click', (e) => { ... });
  item.addEventListener('click', () => { ... });
  item.querySelector('.start-pomodoro').addEventListener('click', (e) => { ... });
  item.querySelector('.delete-task-btn').addEventListener('click', (e) => { ... });
});

// ✅ 正确：在初始化时绑定一次委托，渲染方法只负责 innerHTML
// bindEvents() 中（只执行一次）：
container.addEventListener('click', (e) => this._handleTaskListClick(e));
container.addEventListener('mouseover', (e) => this._handleTaskListMouseOver(e));
container.addEventListener('mouseout', (e) => this._handleTaskListMouseOut(e));
container.addEventListener('mousemove', (e) => this._handleTaskListMouseMove(e));

// renderTaskList() 中（每次渲染）：
container.innerHTML = sortedTasks.map(task => this.renderTaskItem(task)).join('');
// 无需绑定事件，委托自动处理
```

### 规则 1.2：点击事件统一用 `e.target.closest()` 分发

```javascript
_handleTaskListClick(e) {
  const item = e.target.closest('.task-item');
  if (!item) return;
  const taskId = item.dataset.id;

  if (e.target.closest('.task-checkbox')) {
    e.stopPropagation();
    this.completeTask(taskId);
    return;
  }
  if (e.target.closest('.start-pomodoro')) {
    e.stopPropagation();
    // ... pomodoro 逻辑
    return;
  }
  if (e.target.closest('.delete-task-btn')) {
    e.stopPropagation();
    // ... delete 逻辑
    return;
  }
  // 默认：点击任务项 → 打开编辑
  const task = Store.getTasks().find(t => t.id === taskId);
  if (task) this.showTaskModal(task);
}
```

### 规则 1.3：hover 效果用 CSS `:hover`，不要用 JS `mouseenter/mouseleave`

```javascript
// ❌ 错误：JS 控制 hover 样式
btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--bg-tertiary)'; });
btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });

// ✅ 正确：CSS :hover
// CSS:
//   .dialog-btn:hover { background: var(--bg-tertiary); }
// JS: 无需任何代码
```

### 规则 1.4：输入框聚焦样式用 CSS `:focus`，不要用 JS `focus/blur`

```javascript
// ❌ 错误
input.addEventListener('focus', () => {
  input.style.borderColor = 'var(--primary-color)';
  input.style.boxShadow = '0 0 0 3px var(--input-focus-glow)';
});
input.addEventListener('blur', () => {
  input.style.borderColor = 'var(--border-color)';
  input.style.boxShadow = 'none';
});

// ✅ 正确：CSS :focus
// .input-field:focus {
//   border-color: var(--primary-color);
//   box-shadow: 0 0 0 3px var(--input-focus-glow);
// }
```

### 规则 1.5：临时弹窗内按钮也用容器级委托

```javascript
// ❌ 错误：弹窗 forEach + addEventListener
popup.querySelectorAll('.category-item').forEach(btn => {
  btn.addEventListener('click', async (e) => { ... });
});
popup.querySelector('.cancel-btn').addEventListener('click', () => { ... });

// ✅ 正确：弹窗容器委托
popup.addEventListener('click', async (e) => {
  const btn = e.target.closest('.category-item');
  if (btn) { ... return; }
  if (e.target.closest('.cancel-btn')) { ... return; }
});
```

### 规则 1.6：数据关联用 `dataset` 或 `WeakMap`，不要用闭包

```javascript
// ❌ 错误：闭包捕获变量，且元素已删除时闭包不释放
item.querySelector('.btn').addEventListener('click', () => {
  const data = expensiveResult; // 闭包持有引用
  doSomething(data);
});

// ✅ 正确：用 dataset 存简单值，WeakMap 存对象
// 简单值：
item.dataset.id = task.id;
// 复杂对象：
this._chatMsgData = new WeakMap();
this._chatMsgData.set(messageContent, { result, agentType, fullText });
// 委托中读取：
const taskId = item.dataset.id;
const data = this._chatMsgData.get(messageContent);
```

---

## 二、模块拆分（Module Extraction）

### 规则 2.1：单文件不超过 5000 行，理想 3000 行以下

- 超过 5000 行时 IDE 加载变慢、搜索变慢、git diff 变大
- 按功能域拆分：每个功能域一个文件

### 规则 2.2：使用 `Object.assign(App, {...})` 模式提取方法

```javascript
// app-clipboard-dialog.js
Object.assign(App, {
  showClipboardDetector() { ... },
  hideClipboardDetector() { ... },
  saveClipboardToNote() { ... },
  // ...
});
```

### 规则 2.3：HTML 中按依赖顺序引入

```html
<script src="scripts/app.js"></script>                    <!-- 主对象定义 -->
<script src="scripts/app-prompt-manager.js"></script>     <!-- Prompt 管理 -->
<script src="scripts/app-ai-tasks.js"></script>           <!-- AI 任务调度 -->
<script src="scripts/app-clipboard-dialog.js"></script>   <!-- 剪贴板+弹窗 -->
```

### 规则 2.4：提取标准

| 条件 | 动作 |
|------|------|
| 方法数 > 5 且属于同一功能域 | 提取为独立文件 |
| 方法体 > 200 行 | 考虑拆分为子方法 |
| 文件总行数 > 5000 | 必须拆分 |
| 全局函数 | 禁止，必须挂在 App 对象上 |

### 规则 2.5：避免提取后的死代码

- 提取后检查原文件是否有残留的孤立代码
- 使用 `grep` 验证方法是否被调用
- 未被调用的方法直接删除，不要保留"兼容空壳"

---

## 三、CSS transition 优化

### 规则 3.1：禁止使用 `transition: all`

```css
/* ❌ 错误：触发不必要的 GPU 合成 */
.btn { transition: all 0.25s ease; }

/* ✅ 正确：只声明实际变化的属性 */
.btn {
  transition: background-color 0.25s var(--transition),
              color 0.25s var(--transition),
              border-color 0.25s var(--transition),
              box-shadow 0.25s var(--transition),
              transform 0.25s var(--transition),
              opacity 0.25s var(--transition);
}
```

### 规则 3.2：使用 CSS 变量统一 transition 曲线

```css
:root {
  --transition: cubic-bezier(0.2, 0.8, 0.2, 1);
  --transition-fast: 0.15s var(--transition);
  --transition-normal: 0.25s var(--transition);
}
```

### 规则 3.3：backdrop-filter 性能注意

- `backdrop-filter: blur(20px)` 在大量元素上使用会影响滚动性能
- 仅在弹窗、导航栏等少量固定元素上使用
- 列表项不要使用 backdrop-filter

---

## 四、DOM 操作优化

### 规则 4.1：批量 DOM 操作用 `DocumentFragment` 或 `innerHTML`

```javascript
// ❌ 错误：逐个 append（触发 N 次回流）
items.forEach(item => container.appendChild(createElement(item)));

// ✅ 正确：一次性 innerHTML 或 fragment
container.innerHTML = items.map(item => renderHTML(item)).join('');
```

### 规则 4.2：避免在滚动/鼠标移动回调中操作 DOM

```javascript
// ❌ 错误：每次 mousemove 都操作 DOM
item.addEventListener('mousemove', (e) => {
  tooltip.style.left = e.clientX + 'px';  // 触发回流
  tooltip.style.top = e.clientY + 'px';
});

// ✅ 正确：用 requestAnimationFrame 节流
let rafId = null;
item.addEventListener('mousemove', (e) => {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    tooltip.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    rafId = null;
  });
});
```

### 规则 4.3：用 `transform` 代替 `left/top` 做动画

```css
/* ❌ 错误：触发回流 */
.animated { left: 100px; top: 50px; transition: left 0.3s; }

/* ✅ 正确：仅触发合成，不回流 */
.animated { transform: translate(100px, 50px); transition: transform 0.3s; }
```

---

## 五、内存管理

### 规则 5.1：动态创建的弹窗/浮层必须清理

```javascript
const cleanup = () => {
  overlay.style.animation = 'fadeOut 0.15s ease';
  setTimeout(() => overlay.remove(), 150);
};
// 同时移除 document 级监听器
document.removeEventListener('keydown', handler);
```

### 规则 5.2：用 `WeakMap` 存储元素关联数据

- `WeakMap` 不阻止垃圾回收，元素被移除时数据自动释放
- 避免在元素上挂自定义属性 `_fcBound = true` 这种 hack

### 规则 5.3：事件委托天然解决内存泄漏

- 事件委托只在容器上绑定一个监听器
- 子元素被 `innerHTML` 替换后，不需要手动 `removeEventListener`

---

## 六、代码质量检查清单

每次 PR 提交前检查：

- [ ] 渲染方法中无 `addEventListener`（用事件委托）
- [ ] 无 `transition: all`（用具体属性）
- [ ] 无 JS `mouseenter/mouseleave` 控制 hover 样式（用 CSS `:hover`）
- [ ] 无 JS `focus/blur` 控制聚焦样式（用 CSS `:focus`）
- [ ] 无 `forEach + addEventListener` 模式（用容器委托）
- [ ] 无闭包捕获大对象（用 `dataset` 或 `WeakMap`）
- [ ] 无 `_bound` 标志位 hack（用事件委托替代）
- [ ] 单文件不超过 5000 行
- [ ] 弹窗/浮层有 cleanup 函数清理 DOM 和监听器
- [ ] 动画用 `transform` 而非 `left/top`

---

## 附：Memora 优化记录

### 第一轮优化（2026-06-20 上半场）
- 221 处 `transition: all` → 具体属性（14 个 CSS 文件）
- chatMessages、skill grid、notebook categories 改为事件委托
- 提取 `app-prompt-manager.js`（328行）+ `app-ai-tasks.js`（569行）
- app.js: 15610 → 14752 行

### 第二轮优化（2026-06-20 下半场）
- 任务列表渲染：7N → 1 事件委托（click + mouseover/mouseout/mousemove）
- 排序按钮：每次渲染重复绑定 → 初始化绑定一次
- 确认/输入弹窗：8 个 hover JS → CSS `:hover`
- 输入框聚焦：2 个 focus/blur JS → CSS `:focus`
- 分类弹窗：forEach → 容器委托
- 关联人物标签：forEach → onclick 委托
- 删除原因弹窗：forEach → 容器委托
- 创建菜单 hover：JS → CSS `:hover`
- 移除死代码 `_bindArtifactSaveButtons`（~96行）
- 提取 `app-clipboard-dialog.js`（~310行）
- app.js: 14752 → 14338 行
- addEventListener: 266 → 240

### 第三轮优化（2026-06-20 晚）
- 通知面板：2N → 1 容器 click 委托（`#notificationPanelBody`）
- SkillHub 搜索结果：2N → 1 容器 click 委托（`#skillhubResults`）
- 连接器网格：3N → 2 容器委托（`#connectorGrid` click+change）
- CC 连接器列表：N → 1 容器 change 委托（`#ccConnectorList`）
- 聊天附件：2N → 1 容器 click 委托（`#chatAttachments`）
- 笔记拖拽：2N → 2 容器委托（`#notebookList` dragstart+dragend）
- 笔记复选框：2N → 1 容器 change 委托（`#notebookList`）
- 分类拖放目标：4N → 4 容器委托（`#categoryList` dragover+dragenter+dragleave+drop）
- 移除死代码 `bindNoteDragEvents` + `bindCategoryDropTargets` + `bindNoteCheckboxEvents`（~128行）
- app.js: 14338 → 14309 行
- addEventListener: 240 → 236
- **渲染方法 forEach+addEventListener：7 → 0（100% 清零）**

### 累计成果
| 指标 | 优化前 | 优化后 | 减少 |
|------|--------|--------|------|
| app.js 行数 | 15610 | 14309 | -1301 (8.3%) |
| addEventListener | ~289 | 236 | -53 (18%) |
| transition: all | 221 | 0 | -221 (100%) |
| 模块文件 | 0 | 3 | +3 |
| 渲染方法 forEach+addEventListener | ~14 | 0 | -14 (100%) |
