# Memora 多模态知识系统设计方案 v2.1

> 基于现有架构深度扩展，保持"数据在本地，智能在云端"核心理念

---

## 一、现状分析与设计原则

### 1.1 现有架构概览

| 层级 | 现状 | 存储 |
|------|------|------|
| **记忆系统** | 三层记忆（瞬时/短期/长期）+ 实体图谱 | `userData/memory/` (memories.json + entity-graph.json) |
| **知识萃取** | 知识原子 → 知识簇 → 文章 | `userData/knowledge/` (atoms.json + clusters.json + articles/) |
| **剪贴板** | 文本监控 → 暂存聚合 → AI 分析 → 记忆/待办/推荐 | clipboard/ (Buffer + Scheduler + FreqController) |
| **知识跟随** | ADP 搜索 + 本地搜索 + 公开资源 | SSE 流式，无独立存储 |
| **文档中心** | ADP Toolkit 公开资源 + 本地文件索引 | 远程 API + 本地 fs 扫描 |
| **AI 能力** | DeepSeek API + 腾讯云 ADP（3 个 AppKey） | 审计日志 `auditLogger.js` |

### 1.2 设计原则

1. **渐进式扩展**：新模块可独立开关，不影响现有文本处理链路
2. **存储一致性**：多模态元数据沿用 JSON 文件存储（与 atoms/clusters/memories 同体系），大文件独立目录
3. **AI 统一入口**：所有 AI 调用走 `auditedDeepSeekCall()` 或 ADP SSE，不新增第三方 API
4. **Electron 友好**：利用 Node.js 原生能力处理文件，轻量依赖，避免重型 ML 库
5. **Apple Design**：遵循现有 UI 风格规范（毛玻璃、圆角、弹性动效）

---

## 二、多模态存储架构

### 2.1 目录结构

在现有 `userData` 目录下扩展，保持与 knowledge/、memory/ 平级：

```
~/Library/Application Support/memora/
├── memory/                    # 现有：三层记忆 + 实体图谱
│   ├── memories.json
│   └── entity-graph.json
├── knowledge/                 # 现有：知识萃取
│   ├── atoms.json
│   ├── clusters.json
│   └── articles/
├── multimodal/                # 新增：多模态资产
│   ├── assets/                # 原始文件存储
│   │   ├── images/            # 图片（截图、照片、图表）
│   │   ├── audio/             # 音频（录音、语音备忘）
│   │   ├── video/             # 视频（录屏、会议录像）
│   │   └── documents/         # 文档（PDF、Word、PPT）
│   ├── thumbnails/            # 缩略图（图片/视频封面）
│   ├── transcripts/           # 转写文本（音频/视频）
│   └── index.json             # 统一元数据索引
├── audit/                     # 现有：AI 审计日志
└── config/                    # 现有：用户配置
```

### 2.2 元数据索引模型 (index.json)

```typescript
interface MultimodalAsset {
  id: string;                          // 格式：mm_{timestamp}_{random}
  type: 'image' | 'audio' | 'video' | 'document';
  title: string;                       // 文件名或 AI 生成标题
  description: string;                 // AI 生成的描述/摘要

  // 文件信息
  filePath: string;                    // 相对于 assets/ 的路径
  fileName: string;                    // 原始文件名
  fileSize: number;                    // 字节数
  mimeType: string;                    // MIME 类型
  thumbnailPath?: string;              // 缩略图相对路径

  // 多模态特征
  ocrText?: string;                    // 图片 OCR 结果
  transcript?: string;                 // 音频/视频转写文本
  transcriptPath?: string;             // 转写文件相对路径（长文本独立存储）
  keyFrames?: string[];                // 视频关键帧缩略图路径列表
  duration?: number;                   // 音频/视频时长（秒）
  dimensions?: { width: number; height: number }; // 图片/视频尺寸
  pageCount?: number;                  // 文档页数

  // 关联系统
  atomIds: string[];                   // 关联的知识原子 ID
  clusterIds: string[];               // 关联的知识簇 ID
  memoryIds: string[];                // 关联的记忆 ID
  entityNames: string[];              // 提取的实体名称（人物、项目等）
  tags: string[];                      // 标签

  // 来源追踪
  source: 'clipboard' | 'drag-drop' | 'import' | 'screenshot' | 'recording';
  sourceDetail?: string;               // 具体来源描述

  // 元信息
  createdAt: string;                   // ISO 8601
  updatedAt: string;
  accessedAt: string;
  accessCount: number;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processingError?: string;
}
```

### 2.3 与现有系统的数据桥接

**核心思路**：多模态资产不是独立孤岛，而是作为知识原子的一种扩展载体。

```
多模态文件入站
    ↓
MultimodalStore 创建 asset 记录（status: pending）
    ↓
异步处理 Pipeline（OCR/转写/特征提取）
    ↓
处理结果写回 asset（status: completed）
    ↓
自动生成知识原子 → KnowledgeStore.addAtom({
    content: asset.ocrText || asset.transcript || asset.description,
    type: 'multimodal',
    source_asset_id: asset.id,
    domain: AI自动分类
})
    ↓
实体提取 → 更新 entity-graph.json
    ↓
自动匹配知识簇 → KnowledgeStore._autoAssignCluster()
```

---

## 三、功能模块详细设计

### 3.1 剪贴板多模态捕获

**现状**：`ClipboardScheduler` 仅监听文本类型剪贴板变化。

**扩展**：

```javascript
// clipboard/ClipboardScheduler.js 扩展
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// 新增：图片剪贴板监听
_onClipboardChange(newText, imageBuffer, imageMeta) {
  if (imageBuffer) {
    // 图片截屏 → 保存到 multimodal/assets/images/ → 触发 OCR Pipeline
    this._handleImageClipboard(imageBuffer, imageMeta);
  }
  if (newText) {
    // 现有文本处理逻辑不变
    this._handleTextClipboard(newText);
  }
}

// 新增：文件路径检测（复制文件时）
_detectFilePaths(text) {
  // 检测文本中是否包含本地文件路径
  // 支持：/Users/xxx、~/Desktop、C:\Users 等
  // 匹配到文件路径 → 尝试读取文件 → 导入多模态资产
}
```

**Electron 剪贴板 API 扩展**：

```javascript
// main.js 中新增 IPC
ipcMain.handle('clipboard:read-image', () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  return image.toPNG(); // 返回 Buffer
});
```

### 3.2 多模态处理 Pipeline

采用**队列式异步处理**，避免阻塞主进程：

```
Asset 入站 → Pipeline 入队 → Worker 逐项处理 → 结果写回 → 通知渲染进程
```

#### 3.2.1 图片处理

```
图片文件 → 格式标准化 → 缩略图生成 → OCR → 描述生成 → 实体提取
```

**技术方案**：
- **缩略图**：`sharp`（npm 包，Electron 友好，无需系统依赖）
- **OCR**：优先腾讯云 OCR API（已有云 API 使用经验），备选 Tesseract.js（纯 JS，离线可用）
- **描述生成**：调用 DeepSeek Vision（`deepseek-v4-flash` + 图片 base64）或 ADP 多模态
- **实体提取**：复用现有 `memory_extraction_v2.0.md` Prompt，输入改为 OCR 文本

```javascript
// pipeline/ImageProcessor.js
class ImageProcessor {
  async process(asset, filePath) {
    // 1. 生成缩略图（最大 300x300）
    const thumbnail = await sharp(filePath)
      .resize(300, 300, { fit: 'inside' })
      .webp({ quality: 80 })
      .toBuffer();

    // 2. OCR 提取文字
    const ocrText = await this._ocr(filePath);

    // 3. AI 描述生成（有文字用 OCR 结果，无文字用视觉理解）
    const description = ocrText
      ? await this._summarizeOCRText(ocrText)
      : await this._visualDescribe(filePath);

    return { thumbnail, ocrText, description };
  }

  async _ocr(filePath) {
    // 方案A：腾讯云 OCR（需要 SecretId/SecretKey，从 remoteConfig 获取）
    // 方案B：Tesseract.js（离线，适合无网络场景）
  }

  async _visualDescribe(filePath) {
    // 调用 auditedDeepSeekCall，传入图片 base64
    // 使用 DeepSeek Vision 模型
  }
}
```

#### 3.2.2 音频处理

```
音频文件 → 格式转换 → Whisper 转写 → 文本摘要 → 实体提取
```

**技术方案**：
- **格式转换**：`ffmpeg-static` + `fluent-ffmpeg`（Electron 预编译二进制）
- **转写**：优先腾讯云 ASR（已有 StellarQS30 集成经验），备选 OpenAI Whisper API
- **摘要**：复用 `knowledge_article_synthesis.md` Prompt

```javascript
// pipeline/AudioProcessor.js
class AudioProcessor {
  async process(asset, filePath) {
    // 1. 转换为 16kHz mono WAV（Whisper 要求）
    const wavPath = await this._convertToWav(filePath);

    // 2. 转写
    const transcript = await this._transcribe(wavPath);

    // 3. 生成摘要
    const summary = await this._summarize(transcript);

    return { transcript, summary, duration: await this._getDuration(filePath) };
  }

  async _transcribe(audioPath) {
    // 方案A：腾讯云录音文件识别（异步轮询，适合长音频）
    // 方案B：OpenAI Whisper API（简单直接，有长度限制）
    // 方案C：本地 Whisper.cpp（Electron 侧载，适合离线）
  }
}
```

#### 3.2.3 视频处理

```
视频文件 → 关键帧提取 → 逐帧 OCR → 音频轨提取 → 转写 → 合并索引
```

**技术方案**：
- **关键帧**：FFmpeg 每 10 秒提取一帧
- **音频轨**：FFmpeg 提取音频 → 复用 AudioProcessor
- **帧描述**：批量调用 DeepSeek Vision（受限于 API 并发，需队列控制）

```javascript
// pipeline/VideoProcessor.js
class VideoProcessor {
  async process(asset, filePath) {
    // 1. 提取关键帧（每10秒一帧，最多30帧）
    const keyFrames = await this._extractKeyFrames(filePath);

    // 2. 提取音频轨 → 转写
    const audioPath = await this._extractAudio(filePath);
    const transcript = audioPath
      ? await this.audioProcessor._transcribe(audioPath)
      : '';

    // 3. 关键帧描述（可选，较重，可后台异步）
    // const frameDescriptions = await this._describeKeyFrames(keyFrames);

    // 4. 合成摘要
    const summary = await this._summarizeVideo(transcript, keyFrames.length);

    return { transcript, keyFrames, summary, duration: await this._getDuration(filePath) };
  }
}
```

#### 3.2.4 文档处理

```
文档文件 → 格式解析 → 文本提取 → 摘要 → 实体提取
```

**技术方案**：
- **PDF**：`pdf-parse`（纯 JS，无系统依赖）
- **Word**：`mammoth`（.docx → HTML/纯文本）
- **PPT**：复用 `minimax-xlsx` 技能中的 PPT 解析，或 `officeparser`
- **Excel**：`xlsx` 包

```javascript
// pipeline/DocumentProcessor.js
class DocumentProcessor {
  async process(asset, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let text = '';

    switch (ext) {
      case '.pdf': text = await this._parsePDF(filePath); break;
      case '.docx': text = await this._parseDocx(filePath); break;
      case '.pptx': text = await this._parsePptx(filePath); break;
      case '.xlsx': text = await this._parseXlsx(filePath); break;
      default: text = `[不支持的格式: ${ext}]`;
    }

    const summary = await this._summarize(text);
    return { transcript: text, summary, pageCount: this._countPages(text) };
  }
}
```

### 3.3 Pipeline 调度器

```javascript
// pipeline/PipelineManager.js
class PipelineManager {
  constructor(multimodalStore, knowledgeStore, memoryStore) {
    this.store = multimodalStore;
    this.knowledgeStore = knowledgeStore;
    this.memoryStore = memoryStore;
    this.queue = [];           // 处理队列
    this.processing = false;   // 是否正在处理
    this.concurrency = 1;      // 并发数（避免 API 限流）
    this.processors = {
      image: new ImageProcessor(),
      audio: new AudioProcessor(),
      video: new VideoProcessor(),
      document: new DocumentProcessor()
    };
  }

  // 入队新资产
  enqueue(assetId) {
    this.queue.push(assetId);
    this._processNext();
  }

  async _processNext() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const assetId = this.queue.shift();
    const asset = this.store.getById(assetId);

    try {
      asset.processingStatus = 'processing';
      this.store.update(asset);

      // 1. 执行对应 Pipeline
      const result = await this.processors[asset.type].process(asset, this.store.getFilePath(asset));

      // 2. 更新资产元数据
      Object.assign(asset, result);
      asset.processingStatus = 'completed';
      asset.updatedAt = new Date().toISOString();
      this.store.update(asset);

      // 3. 自动生成知识原子
      const atomContent = asset.ocrText || asset.transcript || asset.description;
      if (atomContent) {
        const atom = this.knowledgeStore.addAtom({
          content: atomContent.substring(0, 2000), // 限制长度
          type: 'multimodal',
          source_asset_id: asset.id,
          domain: '多模态'
        });

        if (atom) {
          asset.atomIds.push(atom.id);
          this.store.update(asset);
        }
      }

      // 4. 提取实体，更新图谱
      await this._extractEntities(asset);

      // 5. 通知渲染进程
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('multimodal:processed', { assetId, status: 'completed' });
      });

    } catch (err) {
      asset.processingStatus = 'failed';
      asset.processingError = err.message;
      this.store.update(asset);
      console.error(`[Pipeline] Failed to process ${assetId}:`, err);
    }

    this.processing = false;
    this._processNext();
  }

  async _extractEntities(asset) {
    const text = asset.ocrText || asset.transcript || asset.description;
    if (!text) return;

    // 复用现有实体提取逻辑（memory_extraction_v2.0 prompt）
    const result = await auditedDeepSeekCall({
      prompt: 'memory_extraction',
      content: text,
      module: 'multimodal_entity_extraction'
    });

    if (result?.entities) {
      asset.entityNames = result.entities.map(e => e.name);
      this.store.update(asset);

      // 更新全局实体图谱
      result.entities.forEach(entity => {
        this.memoryStore.addEntity(entity.name, entity.type, {
          source: `multimodal:${asset.id}`,
          assetId: asset.id
        });
      });
    }
  }
}
```

### 3.4 MultimodalStore（存储层）

```javascript
// src/scripts/multimodalStore.js
class MultimodalStore {
  constructor() {
    this.assets = [];
    this.indexVersion = 1;
    this.loadData();
  }

  loadData() {
    const indexFile = path.join(MULTIMODAL_PATH, 'index.json');
    if (fs.existsSync(indexFile)) {
      const data = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      this.assets = data.assets || [];
    }
  }

  saveData() {
    fs.writeFileSync(
      path.join(MULTIMODAL_PATH, 'index.json'),
      JSON.stringify({ version: this.indexVersion, assets: this.assets }, null, 2)
    );
  }

  // 创建新资产（文件导入）
  createAsset(options) {
    const asset = {
      id: `mm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: options.type,
      title: options.title || options.fileName,
      description: '',
      filePath: options.filePath,        // 相对路径
      fileName: options.fileName,
      fileSize: options.fileSize,
      mimeType: options.mimeType,
      thumbnailPath: null,
      ocrText: null,
      transcript: null,
      transcriptPath: null,
      keyFrames: [],
      duration: null,
      dimensions: null,
      pageCount: null,
      atomIds: [],
      clusterIds: [],
      memoryIds: [],
      entityNames: [],
      tags: options.tags || [],
      source: options.source || 'import',
      sourceDetail: options.sourceDetail,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accessedAt: new Date().toISOString(),
      accessCount: 0,
      processingStatus: 'pending',
      processingError: null
    };

    this.assets.unshift(asset);
    this.saveData();
    return asset;
  }

  // 查询
  getById(id) { return this.assets.find(a => a.id === id); }

  search(query) {
    const q = query.toLowerCase();
    return this.assets.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.ocrText && a.ocrText.toLowerCase().includes(q)) ||
      (a.transcript && a.transcript.toLowerCase().includes(q)) ||
      (a.description && a.description.toLowerCase().includes(q)) ||
      a.entityNames.some(e => e.toLowerCase().includes(q)) ||
      a.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  getByType(type) { return this.assets.filter(a => a.type === type); }

  getByEntity(entityName) {
    return this.assets.filter(a =>
      a.entityNames.includes(entityName)
    );
  }

  // 关联操作
  linkAtom(assetId, atomId) {
    const asset = this.getById(assetId);
    if (asset && !asset.atomIds.includes(atomId)) {
      asset.atomIds.push(atomId);
      this.saveData();
    }
  }

  linkCluster(assetId, clusterId) {
    const asset = this.getById(assetId);
    if (asset && !asset.clusterIds.includes(clusterId)) {
      asset.clusterIds.push(clusterId);
      this.saveData();
    }
  }

  // 删除（同时删除文件）
  deleteAsset(id) {
    const asset = this.getById(id);
    if (!asset) return;

    // 删除原始文件
    const fullPath = path.join(MULTIMODAL_PATH, 'assets', asset.filePath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

    // 删除缩略图
    if (asset.thumbnailPath) {
      const thumbPath = path.join(MULTIMODAL_PATH, asset.thumbnailPath);
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    }

    // 删除转写文件
    if (asset.transcriptPath) {
      const tp = path.join(MULTIMODAL_PATH, asset.transcriptPath);
      if (fs.existsSync(tp)) fs.unlinkSync(tp);
    }

    // 删除关键帧
    asset.keyFrames?.forEach(kf => {
      const kfp = path.join(MULTIMODAL_PATH, kf);
      if (fs.existsSync(kfp)) fs.unlinkSync(kfp);
    });

    this.assets = this.assets.filter(a => a.id !== id);
    this.saveData();
  }

  // 统计
  getStats() {
    return {
      total: this.assets.length,
      byType: {
        image: this.assets.filter(a => a.type === 'image').length,
        audio: this.assets.filter(a => a.type === 'audio').length,
        video: this.assets.filter(a => a.type === 'video').length,
        document: this.assets.filter(a => a.type === 'document').length,
      },
      byStatus: {
        pending: this.assets.filter(a => a.processingStatus === 'pending').length,
        processing: this.assets.filter(a => a.processingStatus === 'processing').length,
        completed: this.assets.filter(a => a.processingStatus === 'completed').length,
        failed: this.assets.filter(a => a.processingStatus === 'failed').length,
      },
      totalSize: this.assets.reduce((sum, a) => sum + (a.fileSize || 0), 0)
    };
  }
}
```

### 3.5 知识图谱扩展

**现状**：`entity-graph.json` 存储实体与关系，格式为：

```json
{
  "entities": { "实体名": { "type": "person|project|...", "count": 5, "lastSeen": "..." } },
  "relations": [{ "source": "A", "target": "B", "type": "co_occurrence", "strength": 0.8 }]
}
```

**扩展方向**：

```typescript
// 新增实体类型
type EntityType = 'person' | 'project' | 'concept' | 'organization' | 'location' | 'technology' | 'event';

// 新增关系类型
type RelationType =
  | 'co_occurrence'    // 共现（现有）
  | 'works_on'         // 人物→项目
  | 'belongs_to'       // 项目→组织
  | 'depends_on'       // 项目→技术
  | 'mentions'         // 文档→实体
  | 'similar_to'       // 实体→实体
  | 'part_of';         // 子项目→项目

// 扩展实体属性
interface EntityV2 {
  name: string;
  type: EntityType;
  count: number;
  lastSeen: string;
  // 新增
  aliases: string[];            // 别名（如"张三"="老张"="Zhang San"）
  assetIds: string[];           // 关联的多模态资产
  description?: string;         // AI 生成的一句话描述
  confidence: number;           // 实体识别置信度
}

// 扩展关系属性
interface RelationV2 {
  source: string;
  target: string;
  type: RelationType;
  strength: number;
  // 新增
  evidence: string;             // 关系来源证据（原文片段）
  assetId?: string;             // 来源资产 ID
  createdAt: string;
}
```

**自动关联推荐**（基于现有知识跟随模块扩展）：

```javascript
// 扩展 KnowledgeFollow.searchEngine
class KnowledgeSearch {
  // 新增：多模态感知的搜索
  async searchAll(query) {
    const [textResults, adpResults, multimodalResults] = await Promise.all([
      this.searchLocal(query),           // 现有：本地知识搜索
      this.searchADP(query),             // 现有：ADP 搜索
      this.searchMultimodal(query)       // 新增：多模态资产搜索
    ]);

    return {
      text: textResults,
      adp: adpResults,
      multimodal: multimodalResults      // 包含缩略图预览
    };
  }

  searchMultimodal(query) {
    // 调用 MultimodalStore.search(query)
    // 返回匹配的资产列表，包含缩略图 URL
  }
}
```

### 3.6 冲突检测

**场景**：同一实体在不同来源中出现矛盾信息。

```javascript
// main.js 新增 IPC：multimodal:detect-conflict
async function detectConflict(newContent, entityNames) {
  // 1. 查询同一实体的历史记录
  const historicalMemories = memoryStore.memories.filter(m =>
    entityNames.some(e => m.content.includes(e))
  );

  // 2. 调用 AI 进行语义级冲突检测
  const result = await auditedDeepSeekCall({
    module: 'conflict_detection',
    prompt: `对比以下新旧信息，判断是否存在事实冲突：
    
新信息：${newContent}

历史记录：
${historicalMemories.map(m => `- [${m.category}] ${m.content}`).join('\n')}

如果存在冲突，返回 JSON：{ "hasConflict": true, "conflicts": [{ "field": "字段", "oldValue": "旧值", "newValue": "新值", "confidence": 0.9 }] }
如果没有冲突，返回：{ "hasConflict": false }`,
    model: 'deepseek-v4-flash'
  });

  return result;
}
```

**提醒策略**：
- 高置信度冲突（>0.8）→ 渲染进程弹出确认弹窗，提供"保留新旧两个版本"选项
- 低置信度冲突 → 静默记录到 `conflicts.json`，用户可在知识图谱中查看

### 3.7 知识仪表盘

**在现有视图体系中新增"洞察"视图**：

```
现有视图：日历 | 记事 | 知识 | 跟随 | 文档 | 审计
新增视图：日历 | 记事 | 知识 | 跟随 | 文档 | 洞察 | 审计
```

**仪表盘内容**：

```typescript
interface DashboardData {
  overview: {
    totalAtoms: number;          // 知识原子总数
    totalClusters: number;       // 知识簇总数
    totalAssets: number;         // 多模态资产总数
    totalMemories: number;       // 记忆总数
    assetsByType: Record<string, number>;  // {image: 12, audio: 3, ...}
    growthTrend: { date: string; count: number }[];  // 最近30天每日新增
  };
  insights: {
    topEntities: { name: string; type: string; count: number }[];
    topKeywords: { word: string; count: number }[];
    forgottenKnowledge: string[];    // 超30天未访问的重要知识
    knowledgeGaps: string[];         // AI 识别的知识缺口
    recentConflicts: Conflict[];     // 近期冲突
  };
  activity: {
    todayProcessed: number;          // 今日处理资产数
    todayAICalls: number;            // 今日 AI 调用次数
    storageUsed: string;             // 存储占用
  };
}
```

**可视化方案**（轻量级，不加重型图表库）：
- **增长趋势**：纯 CSS 折线图（SVG path）或 Canvas mini-chart
- **类型分布**：CSS 环形图（conic-gradient）
- **实体云**：CSS flexbox + font-size 映射（轻量词云）
- **时间线**：复用现有 Calendar 模块的日视图

### 3.8 知识缺口提示

**触发时机**：
1. 剪贴板分析时，AI 识别出频繁提及但知识库缺失的概念
2. 用户每周打开"洞察"视图时，自动运行缺口分析
3. 用户主动点击"分析缺口"按钮

```javascript
// main.js 新增 IPC：multimodal:identify-gaps
async function identifyKnowledgeGaps() {
  // 1. 统计最近7天高频实体
  const recentEntities = memoryStore.getRecentEntities(7);

  // 2. 检查每个实体是否有对应知识
  const gaps = [];
  for (const entity of recentEntities) {
    const hasKnowledge = knowledgeStore.atoms.some(a =>
      a.content.includes(entity.name)
    );
    const hasMultimodal = multimodalStore.assets.some(a =>
      a.entityNames.includes(entity.name)
    );

    if (!hasKnowledge && !hasMultimodal && entity.count >= 3) {
      gaps.push({
        entity: entity.name,
        type: entity.type,
        mentionCount: entity.count,
        reason: `"${entity.name}" 最近被提及 ${entity.count} 次，但知识库中无相关记录`,
        suggestedActions: [
          `搜索关于"${entity.name}"的资料`,
          `记录你对"${entity.name}"的理解`
        ]
      });
    }
  }

  // 3. 调用 ADP 进行深度缺口分析
  const adpGaps = await adpClient.chat({
    message: `基于以下高频但知识库缺失的实体，分析知识缺口并给出建议：${JSON.stringify(gaps.slice(0, 10))}`,
    appKey: remoteConfig.knowledge_app_key
  });

  return [...gaps, ...adpGaps];
}
```

---

## 四、UI 交互设计

### 4.1 多模态资产浏览视图

**在知识萃取视图中扩展**，新增"资产"子视图 Tab：

```
知识视图 Tab：图谱 | 文章 | 问题 | 搜索 | 资产（新增）
```

**资产列表设计**（Apple Design 风格）：

```
┌─────────────────────────────────────────────────┐
│  🖼 图片  🎵 音频  🎬 视频  📄 文档  │ 🔍 搜索  │
│─────────────────────────────────────────────────│
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐       │
│  │ 缩略 │  │ 缩略 │  │ 缩略 │  │ 缩略 │       │
│  │  图  │  │  图  │  │  图  │  │  图  │       │
│  ├──────┤  ├──────┤  ├──────┤  ├──────┤       │
│  │标题  │  │标题  │  │标题  │  │标题  │       │
│  │描述  │  │描述  │  │描述  │  │描述  │       │
│  │标签  │  │标签  │  │标签  │  │标签  │       │
│  └──────┘  └──────┘  └──────┘  └──────┘       │
│                                                 │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐       │
│  │ ...  │  │ ...  │  │ ...  │  │ ...  │       │
│  └──────┘  └──────┘  └──────┘  └──────┘       │
└─────────────────────────────────────────────────┘
```

### 4.2 多模态资产详情弹窗

点击资产卡片弹出详情（毛玻璃弹窗，复用现有 Modal 组件风格）：

```
┌───────────────────────────────────────────────────┐
│  ✕                                                 │
│  ┌─────────────────┐  📋 会议截图_20260607.png    │
│  │                 │  类型：图片 | 大小：2.3MB     │
│  │    大图预览      │  来源：剪贴板截图             │
│  │                 │  创建：3分钟前                 │
│  └─────────────────┘                               │
│                                                     │
│  📝 OCR 识别结果                                    │
│  ┌─────────────────────────────────────────────┐   │
│  │ 项目进度更新：                                │   │
│  │ - 前端开发完成 80%                           │   │
│  │ - API 联调预计下周完成                       │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  🏷 标签：项目进度 | 前端 | 开发                    │
│  🔗 关联知识原子：3个 | 关联知识簇：1个             │
│  👤 实体：张三、项目A                               │
│                                                     │
│  [📋 复制OCR文本] [🔗 查看关联] [🗑 删除]          │
└───────────────────────────────────────────────────┘
```

### 4.3 拖拽导入

支持将文件直接拖入 Memora 窗口：

```javascript
// 渲染进程
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  for (const file of files) {
    await window.electronAPI.multimodalImport(file.path);
  }
});

// 主进程
ipcMain.handle('multimodal:import', async (event, options) => {
  const asset = multimodalStore.createAsset({
    ...options,
    source: 'drag-drop'
  });
  // 复制文件到 assets 目录
  // 入队 Pipeline 处理
  pipelineManager.enqueue(asset.id);
  return asset;
});
```

### 4.4 截屏捕获

新增全局快捷键 `Cmd+Shift+M` 截屏并导入：

```javascript
// main.js
globalShortcut.register('CommandOrControl+Shift+M', async () => {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: primaryDisplay.size
  });

  if (sources.length > 0) {
    const thumbnail = sources[0].thumbnail;
    const pngBuffer = thumbnail.toPNG();

    // 保存到 multimodal/assets/images/
    const fileName = `screenshot_${Date.now()}.png`;
    const filePath = path.join(MULTIMODAL_PATH, 'assets', 'images', fileName);
    fs.writeFileSync(filePath, pngBuffer);

    // 创建资产并入队
    const asset = multimodalStore.createAsset({
      type: 'image',
      title: `截屏 ${new Date().toLocaleString('zh-CN')}`,
      filePath: `images/${fileName}`,
      fileName,
      fileSize: pngBuffer.length,
      mimeType: 'image/png',
      source: 'screenshot'
    });
    pipelineManager.enqueue(asset.id);
  }
});
```

---

## 五、IPC 接口设计

| IPC Channel | 方向 | 参数 | 说明 |
|------------|------|------|------|
| `multimodal:import` | R→M | `{ filePath, type?, source? }` | 导入文件 |
| `multimodal:list` | R→M | `{ type?, keyword?, page?, pageSize? }` | 列表查询 |
| `multimodal:get` | R→M | `{ id }` | 获取详情 |
| `multimodal:delete` | R→M | `{ id }` | 删除资产 |
| `multimodal:search` | R→M | `{ keyword }` | 全文搜索 |
| `multimodal:update` | R→M | `{ id, title?, tags?, entityNames? }` | 更新元数据 |
| `multimodal:reprocess` | R→M | `{ id }` | 重新处理 |
| `multimodal:stats` | R→M | — | 获取统计 |
| `multimodal:open-file` | R→M | `{ id }` | 用系统默认程序打开文件 |
| `multimodal:copy-ocr` | R→M | `{ id }` | 复制 OCR 文本到剪贴板 |
| `multimodal:processed` | M→R | `{ assetId, status }` | 处理完成通知 |
| `multimodal:conflict` | M→R | `{ conflicts[] }` | 冲突检测结果 |
| `multimodal:gaps` | R→M | — | 知识缺口分析 |
| `clipboard:read-image` | R→M | — | 读取剪贴板图片 |
| `multimodal:screenshot` | R→M | — | 触发截屏 |

---

## 六、依赖管理

### 6.1 新增 npm 依赖

| 包名 | 用途 | 大小 | 必要性 |
|------|------|------|--------|
| `sharp` | 图片缩略图/格式转换 | ~10MB | Phase 1 必需 |
| `pdf-parse` | PDF 文本提取 | ~500KB | Phase 1 必需 |
| `mammoth` | Word 文档提取 | ~300KB | Phase 1 可选 |
| `ffmpeg-static` | FFmpeg 预编译二进制 | ~50MB | Phase 2 必需（音视频） |
| `fluent-ffmpeg` | FFmpeg Node.js 封装 | ~100KB | Phase 2 必需 |

### 6.2 外部 API 依赖

| API | 用途 | 费用 | 优先级 |
|-----|------|------|--------|
| 腾讯云 OCR | 图片文字识别 | 按量 | Phase 1 首选 |
| 腾讯云 ASR | 音频转写 | 按量 | Phase 2 首选 |
| DeepSeek Vision | 图片描述 | 按量 | Phase 1 备选 |
| OpenAI Whisper | 音频转写 | 按量 | Phase 2 备选 |
| Tesseract.js | 离线 OCR | 免费 | Phase 1 备选 |

### 6.3 electron-builder 配置更新

```json
{
  "build": {
    "asarUnpack": [
      "scripts/**",
      "resources/**",
      "node_modules/sharp/**",
      "node_modules/ffmpeg-static/**"
    ],
    "extraResources": [
      { "from": "node_modules/ffmpeg-static/ffmpeg", "to": "ffmpeg" }
    ]
  }
}
```

---

## 七、实施路线图

### Phase 1：基础架构 + 图片支持（1周）

**目标**：跑通多模态数据入站→处理→展示全链路

| 任务 | 涉及文件 | 优先级 |
|------|---------|--------|
| MultimodalStore 存储层 | `src/scripts/multimodalStore.js`（新建） | P0 |
| PipelineManager 调度器 | `src/scripts/pipeline/PipelineManager.js`（新建） | P0 |
| ImageProcessor 图片处理 | `src/scripts/pipeline/ImageProcessor.js`（新建） | P0 |
| 剪贴板图片监听扩展 | `clipboard/ClipboardScheduler.js`（修改） | P0 |
| 主进程 IPC 注册 | `main.js`（修改） | P0 |
| 渲染进程资产浏览 UI | `src/scripts/multimodalUI.js`（新建） | P1 |
| 资产详情弹窗 | `src/scripts/multimodalUI.js` | P1 |
| 拖拽导入支持 | `src/scripts/multimodalUI.js` + `preload.js` | P1 |
| 截屏快捷键 | `main.js` | P2 |
| knowledge/atom 关联 | `src/scripts/knowledgeStore.js`（修改） | P0 |

### Phase 2：音频/视频 + 知识图谱扩展（1周）

**目标**：支持音视频转写，知识图谱感知多模态

| 任务 | 涉及文件 | 优先级 |
|------|---------|--------|
| AudioProcessor 音频处理 | `src/scripts/pipeline/AudioProcessor.js`（新建） | P0 |
| VideoProcessor 视频处理 | `src/scripts/pipeline/VideoProcessor.js`（新建） | P1 |
| DocumentProcessor 文档处理 | `src/scripts/pipeline/DocumentProcessor.js`（新建） | P1 |
| 实体图谱扩展（V2 schema） | `src/scripts/memory.js`（修改） | P0 |
| 关系提取增强 | 新增 Prompt: `entity_relation_extraction.md` | P0 |
| 知识跟随多模态搜索 | `src/scripts/knowledgeFollow.js`（修改） | P1 |
| 本地文件导入关联 | `src/scripts/localFiles.js`（修改） | P2 |

### Phase 3：智能分析 + 仪表盘（1周）

**目标**：知识洞察、冲突检测、缺口提示

| 任务 | 涉及文件 | 优先级 |
|------|---------|--------|
| 冲突检测 | `main.js` + 新增 Prompt | P0 |
| 知识缺口分析 | `main.js` + ADP 集成 | P1 |
| 知识仪表盘视图 | `src/scripts/dashboard.js`（新建） | P1 |
| 仪表盘 UI（CSS 图表） | `src/styles/dashboard.css`（新建） | P1 |
| 导航栏新增"洞察"入口 | `src/index.html`（修改） | P1 |

### Phase 4：优化与稳定（3天）

| 任务 | 说明 |
|------|------|
| 处理进度优化 | 大文件处理时显示进度百分比 |
| 存储空间管理 | 超过阈值提醒，支持清理旧资产 |
| 搜索性能优化 | 大量资产时的索引优化 |
| 错误恢复 | Pipeline 失败自动重试（最多3次） |
| 数据迁移工具 | 从 v2.0 升级到 v2.1 的数据迁移脚本 |

---

## 八、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| FFmpeg 体积大（~50MB） | DMG 包体积翻倍 | 音视频支持作为可选模块，延迟加载 |
| OCR/ASR API 费用 | 持续使用成本 | 限制频率（复用现有半小时限流机制），离线备选 |
| 处理耗时长 | 用户体验差 | 队列式异步+进度指示，不阻塞主界面 |
| 大量资产时 JSON 性能 | index.json 膨胀 | 超过 1000 条资产时分片存储，或迁移到 SQLite |
| sharp 原生编译问题 | 安装失败 | 使用 `@img/sharp-darwin-arm64` 预编译包 |
| ASAR 打包后路径问题 | 找不到文件 | sharp/ffmpeg 加入 `asarUnpack` |

---

## 九、与现有模块的集成点汇总

| 现有模块 | 集成方式 | 改动量 |
|---------|---------|--------|
| `MemoryStore` | 扩展实体图谱 schema，新增 `aliases`、`assetIds`、`description` | 小 |
| `KnowledgeStore` | `addAtom` 支持 `source_asset_id`，新增 `type: 'multimodal'` | 小 |
| `ClipboardScheduler` | 新增图片剪贴板监听分支 | 中 |
| `KnowledgeFollow` | 搜索结果融合多模态资产 | 中 |
| `KnowledgeDistillation` | 新增"资产"子视图 Tab | 中 |
| `Documents` / `LocalFiles` | 本地文件可直接导入多模态资产 | 小 |
| `AIAuditLogger` | Pipeline 各环节调用均记录审计 | 小 |
| `app.js` | 新增多模态相关事件绑定和视图切换 | 中 |
| `preload.js` | 新增多模态 IPC 暴露 | 小 |
| `index.html` | 新增资产浏览区域、洞察视图、拖拽区域 | 中 |
| `themeEngine.js` | 多模态 UI 适配主题 | 小 |
