# 分类反馈轻量化方案（拖拽即反馈）

> 版本：v2.0（轻量版） | 日期：2026-06-30

## 核心思路

**零新增 UI**。复用现有"拖拽改分类"和"点击分类标签改分类"操作，在分类变更时自动记录负样本，用于后续 Prompt 优化。

```
用户拖拽笔记到新分类 → 自动记录负样本 → 下次分类时注入 Prompt
```

ADP 回答不需要开发 — 知识跟随模块已支持，只要 `intent=question` 就会自动触发。

---

## 改动点（仅 1 处）

### `src/scripts/app.js` — 拖拽改分类的 drop 回调

现有代码（~1036 行）：

```javascript
const result = await window.electronAPI.notebookUpdateNote(noteId, { category: targetCategory });
if (result.success) {
  this.showToast(`已移至「${this.getNoteCategoryLabel(targetCategory)}」`, 'success');
  this.loadNotes(activeCat);
}
```

改为：

```javascript
const result = await window.electronAPI.notebookUpdateNote(noteId, { category: targetCategory });
if (result.success) {
  this.showToast(`已移至「${this.getNoteCategoryLabel(targetCategory)}」`, 'success');
  
  // 记录分类反馈（轻量）
  const note = this.notesCache?.find(n => n.id === noteId);
  if (note && oldCategory !== targetCategory) {
    window.electronAPI?.recordFeedback?.({
      type: 'classify_correction',
      content: note.content?.substring(0, 500),
      ai_output: { category: oldCategory, intent: note.analysis?.intent || null },
      user_final: { category: targetCategory },
      is_positive: false,
      reject_reason: `拖拽改分类: ${oldCategory} → ${targetCategory}`,
      metadata: {
        noteId,
        originalCategory: oldCategory,
        correctedCategory: targetCategory,
        originalIntent: note.analysis?.intent || null,
        traceId: note.analysis?._aiTraceId || null,
      },
      timestamp: new Date().toISOString()
    });
  }
  
  this.loadNotes(activeCat);
}
```

同样改动也加到 `changeNoteCategory()` 方法（点击分类标签改分类的路径）。

---

## 新增分类的动态学习

用户通过"新增分类"创建自定义分类后，该分类已通过 `notebookGetCategories` / `notebookSaveCategories` 同步到 `_customCategories`。

现有 `task_recognition_v2.0.md` 已有 `{{#each custom_categories}}` 变量注入自定义分类，新增分类自动被纳入分类 Prompt，**无需额外开发**。

---

## ADP 回答触发

知识跟随模块（`knowledgeFollow.js`）在检测到 `intent=question` / `needs_recommendation=true` 时自动触发 ADP 回答。**无需额外开发**。

要修复的是分类准确率本身 — 上述反馈记录积累后作为负样本注入，Prompt 自然会学到。

---

## 数据流

```
剪贴板 → AI分类(intent=chat, category=general) → 存入记事本
                                                    │
                                          用户拖拽到「问题」分类
                                                    │
                                          recordFeedback({
                                            type: 'classify_correction',
                                            content: 原文,
                                            ai_output: {category:'general'},
                                            user_final: {category:'feedback'},
                                            is_positive: false
                                          })
                                                    │
                                          存入 feedback 表
                                                    │
                          下次剪贴板分析时 → 读取最近N条负样本 → 注入Prompt
                                                    │
                          AI 学会: 疑问句 → intent=question, needs_recommendation=true
                                                    │
                          知识跟随自动触发 ADP 回答 ✅
```
