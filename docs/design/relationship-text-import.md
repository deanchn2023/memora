# 人脉图谱 — 文本导入设计

## 1. 需求背景

当前人脉图谱数据来源有限（实体图谱自动提取 + 画像手动配置），用户有大量结构化/半结构化的人际关系文本无法利用：

- **会议纪要**："参会人员：张三（产品总监）、李四（技术负责人）、王五（客户侧 PM）"
- **组织架构描述**："CEO 赵六，下辖 CTO 孙七、CFO 周八。孙七管理前端组（钱九、吴十）和后端组（郑十一）"
- **项目通讯录**："项目 A：甲方对接人-陈总，乙方项目经理-林经理，开发-黄工、杨工"
- **邮件/聊天记录**：包含多人的对话上下文

## 2. 交互设计

### 2.1 入口

在人脉图谱工具栏（`.relationship-toolbar`）已有按钮旁，新增 **「📝 导入文本」** 按钮：

```
[🔍 搜索框]  [全部][高频][近期][需联系]  [AI 分析] [AI 推测关系] [📝 导入文本]
```

### 2.2 导入弹窗

点击后弹出 Modal，Apple Design 风格：

```
┌─────────────────────────────────────────────────────────┐
│  📝 导入人脉文本                                    ✕   │
│─────────────────────────────────────────────────────────│
│                                                         │
│  粘贴包含人名和关系的文本，AI 将自动提取人物和关系：  │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ 参会人员：张三（产品总监）、李四（技术负责人）、    ││
│  │ 王五（客户侧 PM）                                   ││
│  │                                                     ││
│  │ CEO 赵六，下辖 CTO 孙七、CFO 周八                   ││
│  │ 项目A：甲方对接-陈总，乙方PM-林经理                  ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  💡 提示：支持会议纪要、组织架构描述、项目通讯录等格式 │
│                                                         │
│  ─── 预览区 ───                                        │
│  提取到 5 个人物，2 条关系                              │
│  👤 张三 · 产品总监    👤 李四 · 技术负责人             │
│  👤 王五 · 客户侧PM    👤 赵六 · CEO                    │
│  👤 孙七 · CTO                                         │
│  🔗 赵六 → 孙七 (上下级)   赵六 → 周八 (上下级)       │
│                                                         │
│              [取消]  [确认导入]                          │
└─────────────────────────────────────────────────────────┘
```

### 2.3 流程

```
用户粘贴文本 → 点击"解析" → ADP 通用助手提取 JSON → 前端渲染预览 → 用户确认 → 合并到图谱
```

1. **粘贴文本**：用户在 textarea 中输入/粘贴文本
2. **AI 解析**：点击「解析」按钮，调用 ADP 通用助手（SSE 流式），Prompt 指导提取人物和关系
3. **预览确认**：AI 返回结构化 JSON 后，在预览区展示提取结果（人物卡片 + 关系列表），用户可手动增删
4. **确认导入**：将提取结果合并到现有 `personMap` 和 `relations`，去重规则：同名合并、角色/公司取非空值

## 3. 技术设计

### 3.1 Prompt 模板

新建 `prompts/relationship-extract.md`：

```markdown
你是一个人脉关系提取专家。从用户提供的文本中，提取所有人物实体和他们之间的关系。

输出严格 JSON 格式（不要 markdown 代码块，不要解释文字）：
{
  "persons": [
    {
      "name": "人物姓名",
      "role": "职位/角色（如：产品总监、CTO、甲方PM）",
      "company": "公司/组织（如能识别）",
      "department": "部门（如能识别）",
      "projects": ["相关项目名"],
      "relation_to_user": "与用户本人的关系（如能推断：领导/同事/客户/下属/朋友等，否则 null）"
    }
  ],
  "relations": [
    {
      "source": "人物A姓名",
      "target": "人物B姓名",
      "type": "leader|subordinate|colleague|client|friend|family|collaboration",
      "label": "关系描述（如：直属上级、同组同事、甲方客户）",
      "strength": 0.0-1.0,
      "confidence": 0.0-1.0
    }
  ]
}

提取规则：
1. 人物姓名：中文2-4字、英文全名/简称，只提取真实人名，不要提取代词（他/她/我）
2. 角色/职位：从括号、冒号、职衔后缀等提取（如 "张三（产品总监）" → role="产品总监"）
3. 公司：从上下文推断（如 "腾讯的张三" → company="腾讯"）
4. 关系类型映射：
   - "下辖/管理/带领/带队" → type=leader
   - "汇报/向XX汇报/下属" → type=subordinate
   - "同事/同组/队友/一起" → type=colleague
   - "客户/甲方/对接方" → type=client
   - "朋友/同学" → type=friend
   - "家人/亲属" → type=family
   - 其他协作 → type=collaboration
5. 关系强度推断：
   - 明确上下级 → 0.8-0.9
   - 同组协作 → 0.5-0.7
   - 仅提及共事 → 0.3-0.4
6. 如果文本中出现"我"或用户自述，用 relation_to_user 标记
7. 宁可漏识不可误识：不确定的不要提取

当前用户姓名：{{userName}}
```

### 3.2 后端 IPC

**新增 IPC Handler** `relationship:import-text`：

```javascript
ipcMain.handle('relationship:import-text', async (event, { text }) => {
  // 1. 读取 Prompt 模板
  const promptPath = path.join(__dirname, 'prompts', 'relationship-extract.md');
  let systemPrompt = fs.readFileSync(promptPath, 'utf8');
  
  // 2. 注入用户姓名
  const profile = loadProfile();
  const userName = profile.user?.name || '用户';
  systemPrompt = systemPrompt.replace('{{userName}}', userName);
  
  // 3. 调用 ADP 通用助手（structured=true，需要严格 JSON 输出）
  const { response } = await callAI({
    module: 'relationship_extract',
    category: 'lowvol',
    structured: true,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ]
  });
  
  // 4. 解析 JSON 响应
  // ... (与现有 relationship:ai-infer-relations 类似的 JSON 解析逻辑)
  
  // 5. 返回提取结果（不直接写入数据，由前端确认后合并）
  return { success: true, persons, relations };
});
```

**新增 IPC Handler** `relationship:merge-imported`：

```javascript
ipcMain.handle('relationship:merge-imported', async (event, { persons, relations }) => {
  // 1. 读取现有 persons.json
  const relDir = getRelationshipPath();
  const existingPath = path.join(relDir, 'persons.json');
  let existingData = { persons: [], relations: [] };
  if (fs.existsSync(existingPath)) {
    existingData = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
  }
  
  // 2. 合并人物（去重规则：同名合并，角色/公司取非空值）
  const personMap = {};
  existingData.persons.forEach(p => { personMap[p.name] = p; });
  persons.forEach(p => {
    if (personMap[p.name]) {
      // 合并：补充空字段
      if (p.role && !personMap[p.name].role) personMap[p.name].role = p.role;
      if (p.company && !personMap[p.name].company) personMap[p.name].company = p.company;
      // ... 其他字段类似
      personMap[p.name].interactionCount = (personMap[p.name].interactionCount || 0) + 1;
    } else {
      personMap[p.name] = { ...p, interactionCount: 1, projects: p.projects || [], recentMemories: [] };
    }
  });
  
  // 3. 合并关系（去重：source+target 相同则取 strength 更高的）
  const relMap = {};
  existingData.relations.forEach(r => {
    const key = [r.source, r.target].sort().join('→');
    relMap[key] = r;
  });
  relations.forEach(r => {
    const key = [r.source, r.target].sort().join('→');
    if (relMap[key]) {
      if ((r.strength || 0) > (relMap[key].strength || 0)) {
        relMap[key] = r; // 更高置信度的覆盖
      }
    } else {
      relMap[key] = r;
    }
  });
  
  // 4. 写回文件
  existingData.persons = Object.values(personMap);
  existingData.relations = Object.values(relMap);
  existingData.updatedAt = new Date().toISOString();
  fs.writeFileSync(existingPath, JSON.stringify(existingData, null, 2));
  
  return { success: true, merged: { persons: Object.keys(personMap).length, relations: Object.keys(relMap).length } };
});
```

### 3.3 前端实现

**`relationship.js` 新增方法**：

```javascript
/** 显示导入文本弹窗 */
_showImportDialog() {
  // 创建 Modal DOM
  // 包含：textarea、解析按钮、预览区、确认/取消按钮
}

/** 调用 AI 解析文本 */
async _parseImportText() {
  const text = document.getElementById('relImportTextarea')?.value?.trim();
  if (!text || text.length < 10) {
    this._showToast('请输入至少10个字符的文本', 'warning');
    return;
  }
  
  this._showToast('AI 正在解析文本...', 'info');
  
  try {
    const result = await window.electronAPI?.relationshipImportText?.({ text });
    if (result?.success) {
      this._importPreviewData = result; // 暂存
      this._renderImportPreview(result.persons, result.relations);
    } else {
      this._showToast('解析失败: ' + (result?.error || '未知错误'), 'error');
    }
  } catch (err) {
    this._showToast('解析失败: ' + err.message, 'error');
  }
}

/** 渲染预览区 */
_renderImportPreview(persons, relations) {
  // 在预览区展示人物卡片和关系列表
}

/** 确认导入 */
async _confirmImport() {
  if (!this._importPreviewData) return;
  
  try {
    const result = await window.electronAPI?.relationshipMergeImported?.({
      persons: this._importPreviewData.persons,
      relations: this._importPreviewData.relations
    });
    
    if (result?.success) {
      this._showToast(`已导入 ${result.merged.persons} 人物, ${result.merged.relations} 条关系`, 'success');
      this._closeImportDialog();
      this.load(); // 刷新图谱
    }
  } catch (err) {
    this._showToast('导入失败: ' + err.message, 'error');
  }
}
```

**`preload.js` 新增**：

```javascript
relationshipImportText: (data) => ipcRenderer.invoke('relationship:import-text', data),
relationshipMergeImported: (data) => ipcRenderer.invoke('relationship:merge-imported', data),
```

### 3.4 数据流

```
用户文本
  ↓
ADP 通用助手 (callAI, structured=true)
  ↓
JSON: { persons: [...], relations: [...] }
  ↓
前端预览（可手动增删）
  ↓
relationship:merge-imported IPC
  ↓
合并到 persons.json (去重: 同名合并)
  ↓
刷新图谱 UI
```

## 4. 去重与合并规则

| 字段 | 规则 |
|------|------|
| name | 同名视为同一人（忽略大小写/空格） |
| role | 保留非空值，已有值不覆盖 |
| company | 保留非空值，已有值不覆盖 |
| projects | 并集合并 |
| interactionCount | 累加 |
| relations | source+target 去重，strength 高的保留 |

## 5. 边界情况

1. **文本过短**（< 10 字）：提示用户输入更多内容
2. **AI 未识别到人物**：提示"未从文本中识别到人物，请确认文本包含人名"
3. **人物名歧义**（如"小明"可能是多人）：AI 返回 confidence < 0.7 的标记为"待确认"，预览区显示 ⚠️
4. **导入中断**：只在前端确认后才写入数据，AI 解析阶段不修改任何数据
5. **大量文本**（> 5000 字）：截取前 5000 字，提示用户"文本过长，仅解析前 5000 字"

## 6. i18n 键

| Key | 中文 | English |
|-----|------|---------|
| relationship.importText | 📝 导入文本 | 📝 Import Text |
| relationship.importTitle | 导入人脉文本 | Import Relationship Text |
| relationship.importHint | 粘贴包含人名和关系的文本，AI 将自动提取 | Paste text with names and relationships |
| relationship.importPlaceholder | 例如：参会人员：张三（产品总监）、李四（技术负责人）... | e.g., Attendees: John (PM), Jane (Tech Lead)... |
| relationship.importParse | 解析 | Parse |
| relationship.importPreview | 提取到 {n} 个人物，{m} 条关系 | Extracted {n} persons, {m} relations |
| relationship.importConfirm | 确认导入 | Confirm Import |
| relationship.importSuccess | 已导入 {n} 人物，{m} 条关系 | Imported {n} persons, {m} relations |
