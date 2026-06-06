这是一个多模态知识系统的设计任务，涉及知识图谱、多模态数据处理、数据可视化等多个方面。让我先搜索一下相关的设计方法和工具。
基于你的 Memora 现有架构和扩展需求，我来设计一个完整的多模态知识系统方案。

---

## 📐 多模态知识系统设计方案

### 一、多模态知识存储架构

**核心思路**：保持"数据在本地，智能在云端"原则，多模态文件本地存储，向量索引和元数据上传 ADP。

```
memora-data/
├── knowledge/          # 知识库根目录
│   ├── text/          # 文本知识（现有）
│   ├── images/        # 图片（截图、图表、照片）
│   ├── audio/         # 音频（会议录音、语音备忘录）
│   ├── video/         # 视频（演示录像、培训视频）
│   ├── documents/     # 文档（PDF、Word、PPT）
│   └── metadata/      # 统一元数据索引
│       ├── embeddings.jsonl   # 向量索引（本地缓存）
│       ├── relations.jsonl    # 实体关系图
│       └── timeline.jsonl    # 时间线索引
```

**技术选型**：
- **图片处理**：Sharp（缩略图生成）+ OCR（Tesseract / 腾讯云OCR）
- **音频处理**：Whisper（本地）+ FFmpeg（格式转换）
- **视频处理**：FFmpeg（关键帧提取）+ Whisper（字幕生成）
- **文档处理**：pdf-parse + mammoth + python-pptx（复用现有技能）

---

### 二、知识图谱数据模型设计

**实体类型扩展**（在现有三层记忆基础上）：

```typescript
interface KnowledgeNode {
  id: string;
  type: 'person' | 'project' | 'document' | 'task' | 'concept' | 'image' | 'audio';
  contentType: 'text' | 'image' | 'audio' | 'video' | 'document';
  title: string;
  content: string;  // 文本内容或多模态的描述/转录
  embedding: number[];  // 向量表示（本地缓存，完整版在ADP）
  metadata: {
    source: string;  // 来源（微信、邮件、剪贴板等）
    timestamp: number;
    filePath?: string;  // 多模态文件本地路径
    thumbnail?: string;  // 图片/视频缩略图路径
    duration?: number;  // 音频/视频时长
    ocrText?: string;  // 图片OCR结果
    transcript?: string;  // 音频转写文本
    entities: string[];  // 提取的实体（人物、项目、技术等）
    tags: string[];
    confidence: number;  // AI提取置信度
  };
  relations: Relation[];  // 与其他节点的关系
  memoryLevel: 'working' | 'short' | 'long';  // 三层记忆
  accessCount: number;  // 访问次数（用于记忆衰减计算）
  lastAccessed: number;
}

interface Relation {
  targetId: string;
  type: 'related' | 'depends_on' | 'mentioned_with' | 'similar_to' | 'part_of';
  strength: number;  // 关系强度 0-1
  createdAt: number;
}
```

---

### 三、功能模块详细设计

#### 3.1 自动关联推荐

**触发时机**：
- 用户打开某个知识节点
- 用户复制新内容到剪贴板
- 用户搜索某个关键词

**实现流程**：
```
1. 提取当前节点的实体和向量
   ↓
2. 本地数据库查询相似节点（基于embedding + 实体匹配）
   ↓
3. 调用ADP知识图谱API，获取深层关联
   ↓
4. 按关联强度排序，过滤低质量关联
   ↓
5. 流式展示推荐结果（利用稳定的SSE）
```

**展示设计**：
```typescript
// 推荐结果卡片组件
interface RecommendationCard {
  node: KnowledgeNode;
  relationType: string;  // "你之前处理过类似问题"
  relevanceScore: number;
  previewText: string;  // 相关内容预览
  multimodalPreview?: string;  // 图片缩略图/音频波形
}
```

---

#### 3.2 人物关系网络

**数据模型**：
```typescript
interface PersonNode extends KnowledgeNode {
  type: 'person';
  metadata: {
    name: string;
    role?: string;  // 职位/角色
    company?: string;
    projects: string[];  // 参与的项目ID列表
    lastContact?: number;
    communicationChannels: ('wechat' | 'email' | 'meeting')[];
  };
}

interface ProjectNode extends KnowledgeNode {
  type: 'project';
  metadata: {
    name: string;
    members: string[];  // 成员ID列表
    status: 'active' | 'completed' | 'paused';
    startDate: number;
    endDate?: number;
  };
}
```

**关系提取Pipeline**：
```
文本/转录 → NLP实体识别 → 人物-项目关联 → 关系强度计算 → 图谱更新
```

**可视化方案**：
- 使用 D3.js 或 Cytoscape.js 渲染力导向图
- 节点大小 = 交互频率
- 边的粗细 = 关系强度
- 点击节点 → 展示该人物的所有相关知识

---

#### 3.3 冲突检测

**检测维度**：
1. **事实冲突**：同一实体的不同属性值（"康院负责FMEA" vs "王老师负责FMEA"）
2. **时间冲突**：同一时间段的不同安排
3. **状态冲突**：任务状态不一致

**实现方案**：
```typescript
async function detectConflict(newNode: KnowledgeNode): Promise<Conflict[]> {
  // 1. 实体解析：识别newNode中提到的人物/项目
  const entities = extractEntities(newNode.content);
  
  // 2. 查询历史记录
  const historicalNodes = await db.searchByEntities(entities);
  
  // 3. 属性对比
  const conflicts = compareAttributes(newNode, historicalNodes);
  
  // 4. 调用ADP进行语义级冲突检测
  const semanticConflicts = await adpClient.detectConflict({
    newNode: newNode.content,
    context: historicalNodes.map(n => n.content)
  });
  
  return mergeConflicts(conflicts, semanticConflicts);
}
```

**提醒策略**：
- 低置信度冲突 → 静默记录，用户查询时展示
- 高置信度冲突 → 弹窗提醒，提供"保留新旧两个版本"选项

---

#### 3.4 个人知识仪表盘

**数据结构**：
```typescript
interface KnowledgeDashboard {
  overview: {
    totalNodes: number;
    nodesByType: Record<string, number>;  // {text: 120, image: 45, audio: 12}
    nodesByMemoryLevel: Record<string, number>;
    growthTrend: TimeSeriesData[];  // 最近30天每天新增节点数
  };
  insights: {
    topKeywords: {word: string, count: number}[];
    knowledgeGaps: string[];  // AI识别的知识缺口
    forgottenKnowledge: string[];  // 超过30天未访问的重要知识
  };
  visualizations: {
    knowledgeMap: string;  // D3渲染的图谱SVG
    timeline: string;  // 时间线图表
    heatmap: string;  // 知识积累热力图
  };
}
```

**可视化技术栈**：
- **图谱展示**：D3.js（力导向图）
- **时间线**：Vis.js Timeline 或自定义Canvas
- **词云**：wordcloud2.js
- **热力图**：ECharts

---

#### 3.5 效率分析报告

**数据采集点**：
```typescript
interface WorkSession {
  startTime: number;
  endTime: number;
  taskId?: string;
  interruptions: {
    timestamp: number;
    source: 'wechat' | 'email' | 'meeting' | 'other';
    duration: number;
  }[];
  focusScore: number;  // 0-1，基于中断频率和任务完成度计算
}
```

**报告生成逻辑**：
```
1. 聚合最近N天的工作会话数据
   ↓
2. 计算指标：
   - 日均专注时长
   - 任务完成率
   - 中断频率和热区时间
   - 多任务切换成本
   ↓
3. 调用ADP生成洞察和建议
   ↓
4. 可视化展示 + 导出PDF
```

---

#### 3.6 知识缺口提示

**实现思路**：
```typescript
async function identifyKnowledgeGaps(): Promise<KnowledgeGap[]> {
  // 1. 分析用户的工作内容（从任务、日历、剪贴板）
  const workContext = await analyzeWorkPattern();
  
  // 2. 对比现有知识库覆盖度
  const coverage = calculateCoverage(workContext, knowledgeBase);
  
  // 3. 调用ADP识别缺口
  const gaps = await adpClient.identifyGaps({
    workContext,
    existingKnowledge: coverage.coveredTopics
  });
  
  // 4. 生成补充建议
  return gaps.map(gap => ({
    topic: gap.topic,
    reason: gap.reason,  // "你最近3次提到K8s，但知识库中没有相关记录"
    suggestedActions: gap.suggestions  // ["搜索K8s最佳实践", "记录你的K8s配置经验"]
  }));
}
```

---

### 四、技术实现关键点

#### 4.1 多模态处理Pipeline

```
文件输入 → 格式检测 → 预处理 → 特征提取 → 索引构建 → 知识图谱更新
   ↓
Image:  OCR提取文字 → 视觉特征向量 →  CLIP嵌入
Audio:  Whisper转写 → 文本向量 → 关键词提取
Video:  关键帧提取 → 逐帧OCR+CLIP → 音频转写 → 合并索引
```

#### 4.2 与现有架构集成

**修改点**：
1. **数据存储层**：`lowdb` schema 扩展，增加 `multimodal` 表
2. **剪贴板监听**：增加图片检测（截图自动保存）
3. **ADP集成**：知识库上传时包含多模态元数据
4. **UI层**：知识卡片支持多模态预览

**保持兼容**：
- 现有文本知识不动
- 新功能模块化，可独立开关
- 提供数据迁移工具

---

### 五、实施优先级建议

**Phase 1（2周）**：多模态存储架构 + 图片支持
- 实现图片存储、缩略图生成、OCR
- 扩展现有知识卡片UI

**Phase 2（2周）**：知识图谱基础 + 自动关联推荐
- 实现实体关系提取
- 基础推荐算法（基于规则和向量相似度）

**Phase 3（1周）**：冲突检测
- 实现属性对比
- 基础提醒UI

**Phase 4（2周）**：数据与洞察模块
- 知识仪表盘
- 效率分析报告

**Phase 5（1周）**：知识缺口提示 + 优化
- 集成ADP进行深度分析
- 性能优化和测试

---

需要我详细展开某个模块的实现细节吗？比如多模态处理的代码框架、知识图谱的查询优化、或者可视化组件的具体实现？