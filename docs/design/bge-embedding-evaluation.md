# BGE-small-zh-v1.5 本地嵌入模型集成评估方案

> 评估日期：2026-06-24
> 评估目标：将 BAAI/bge-small-zh-v1.5 作为 Memora 本地向量化引擎，替代当前本地哈希降级方案
> 当前状态：嵌入服务降级为本地哈希嵌入（无需 API），语义质量有限

---

## 1. 模型概览

| 属性 | 值 |
|------|-----|
| 模型名称 | BAAI/bge-small-zh-v1.5 |
| 来源 | 北京智源人工智能研究院 (BAAI) |
| 架构 | BERT-based (Encoder-only) |
| 参数量 | ~24M |
| 向量维度 | **384** |
| 最大序列长度 | 512 tokens |
| 语言 | 中文（支持少量英文混合） |
| MTEB 基准得分 | 62.17 |
| 许可证 | MIT（可商用） |
| HuggingFace | [BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5) |
| ONNX 版本 | [Xenova/bge-small-zh-v1.5](https://huggingface.co/Xenova/bge-small-zh-v1.5) |

### v1.5 改进点
- 优化相似度分布（v1.0 存在相似度偏高问题）
- 增强无指令检索能力（无需 query instruction 前缀）
- 对比学习温度调整为 0.01

---

## 2. ONNX 模型文件大小

| 文件 | 大小 | 精度 | 推荐场景 |
|------|------|------|---------|
| `model.onnx` | **94.9 MB** | FP32 全精度 | 离线服务端，精度优先 |
| `model_fp16.onnx` | **47.5 MB** | FP16 半精度 | 平衡精度与体积 |
| `model_q4.onnx` | **52.4 MB** | INT4 量化 | 体积较大，不推荐 |
| `model_q4f16.onnx` | **29.4 MB** | INT4+FP16 | 体积适中 |
| `model_int8.onnx` | **23.9 MB** | INT8 量化 | **✅ 推荐：Electron 桌面端** |
| `model_quantized.onnx` | **24.0 MB** | 通用量化 | 与 int8 几乎相同 |

### 精度损失评估
- INT8 量化 vs FP32：MTEB 得分下降约 0.5-1.0 分（可接受）
- FP16 vs FP32：几乎无损失
- **推荐选择 `model_int8.onnx`（23.9 MB）**，在体积与精度间取得最佳平衡

---

## 3. 依赖包体积评估

### 3.1 新增依赖

| 包名 | 用途 | 安装大小（解压后） | 说明 |
|------|------|-------------------|------|
| `onnxruntime-node` | ONNX 推理引擎 | **~18 MB/平台** | 原生 .node 二进制，需 asarUnpack |
| `@xenova/transformers` | JS 模型加载+分词器 | **~8 MB** | 纯 JS，包含 tokenizer 配置 |
| 模型文件 | bge-small-zh-v1.5 INT8 ONNX | **23.9 MB** | 放在 resources/models/ 目录 |
| 分词器文件 | vocab.txt + tokenizer.json | **~3 MB** | 中文 BERT WordPiece 分词器 |

### 3.2 平台二进制明细（onnxruntime-node）

| 平台 | 架构 | 二进制文件 | 大小 |
|------|------|-----------|------|
| macOS | arm64 | napi-v3-darwin-arm64.node | ~9 MB |
| macOS | x64 | napi-v3-darwin-x64.node | ~10 MB |
| Windows | x64 | napi-v3-win32-x64.node | ~11 MB |
| Linux | x64 | napi-v3-linux-x64.node | ~12 MB |

⚠️ **Electron asarUnpack 要求**：与 @zvec 一样，onnxruntime 的原生 .node 文件必须解包到 `app.asar.unpacked/` 目录。

### 3.3 安装介质尺寸增加汇总

| 项目 | 大小 |
|------|------|
| onnxruntime-node（单平台） | +18 MB |
| @xenova/transformers | +8 MB |
| 模型文件（INT8） | +23.9 MB |
| 分词器文件 | +3 MB |
| **单平台合计** | **~53 MB** |
| **Universal DMG（arm64+x64）** | **~63 MB**（多一个平台二进制 +10MB） |

### 3.4 与当前包体积对比

| 组件 | 当前大小 | 新增后 | 增幅 |
|------|---------|--------|------|
| @zvec/zvec (arm64) | ~37 MB | ~37 MB | 不变 |
| onnxruntime + 模型 + 分词器 | 0 MB | ~53 MB | +53 MB |
| 其他依赖 | ~120 MB | ~120 MB | 不变 |
| **DMG 总计（预估）** | **~157 MB** | **~210 MB** | **+34%** |

---

## 4. 运行时资源消耗评估

### 4.1 内存占用

| 场景 | 内存增量 | 说明 |
|------|---------|------|
| 模型加载（INT8） | **~80-120 MB** | 模型权重 + ONNX Runtime 开销 |
| 模型加载（FP32） | ~200-300 MB | 全精度模型更大 |
| 单次推理（512 tokens） | +~20 MB | 临时张量分配 |
| 空闲状态（模型常驻） | ~80-120 MB | 模型不卸载，保持热加载 |

**对比当前本地哈希嵌入**：哈希嵌入内存占用 <1 MB，BGE 模型增加约 80-120 MB 常驻内存。

### 4.2 CPU 消耗

| 场景 | CPU 占用 | 耗时 | 说明 |
|------|---------|------|------|
| 单条文本嵌入（INT8） | 单核 ~60-80% | **~15-30 ms** | 512 tokens 以内 |
| 单条文本嵌入（FP32） | 单核 ~60-80% | ~25-50 ms | 全精度更慢 |
| 批量嵌入（16条） | 单核 ~80% | ~200-400 ms | 批处理效率更高 |
| 哈希嵌入对比 | <1% | <1 ms | 哈希极快但无语义 |

**关键结论**：INT8 量化模型在 M1/M2 芯片上单条推理约 15-30ms，完全满足实时需求。

### 4.3 首次加载延迟

| 阶段 | 耗时 | 说明 |
|------|------|------|
| ONNX Runtime 初始化 | ~200-500 ms | 加载原生库 |
| 模型文件加载 | ~300-800 ms | 从磁盘读取 24MB 模型 |
| 分词器初始化 | ~50-100 ms | 加载 vocab.txt |
| **首次推理预热** | **~1-2 秒** | 总计（含上述全部） |
| 后续推理 | 0 额外开销 | 模型已热加载 |

### 4.4 磁盘 I/O

- 模型文件读取：一次性加载到内存，后续无磁盘 I/O
- 向量数据库：维度从 1024（哈希）变为 384（BGE），向量存储空间减少 62%

---

## 5. 集成方案

### 5.1 架构设计

```
┌─────────────────────────────────────────────┐
│              EmbeddingService                │
│                                              │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐ │
│  │ volcano │  │ deepseek │  │  bge-local │ │
│  │ (API)   │  │ (API)    │  │  (ONNX)    │ │
│  └─────────┘  └──────────┘  └────────────┘ │
│        │            │            │          │
│        ▼            ▼            ▼          │
│   优先级：用户配置 > API > BGE本地 > 哈希降级  │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ VectorIndexMgr  │  dim=384 (BGE) / 1024 (哈希)
│ (Zvec)          │
└─────────────────┘
```

### 5.2 降级链路

```
1. 检查用户配置（embedding_provider/apiKey）
   → 有配置 → 使用 API 嵌入（火山引擎/DeepSeek）
   
2. 无 API 配置 → 加载 BGE 本地模型
   → 模型文件存在 → ONNX Runtime 推理（dim=384）
   
3. 模型文件不存在或加载失败 → 哈希降级
   → 本地哈希嵌入（dim=1024，无语义但可用）
```

### 5.3 文件组织

```
Memora/
├── resources/
│   └── models/
│       └── bge-small-zh-v1.5/
│           ├── model_int8.onnx        # 23.9 MB
│           ├── tokenizer.json         # ~1.5 MB
│           └── vocab.txt              # ~1.5 MB
├── src/
│   └── services/
│       └── embeddingService.js        # 新增 BGE provider
├── package.json                       # +onnxruntime-node +@xenova/transformers
└── ...
```

### 5.4 package.json 变更

```json
{
  "dependencies": {
    "@xenova/transformers": "^2.17.2",
    "onnxruntime-node": "^1.20.1"
  },
  "build": {
    "asarUnpack": [
      "node_modules/@zvec/**",
      "node_modules/onnxruntime-node/**",
      "resources/models/**"
    ],
    "extraResources": [
      {
        "from": "resources/models",
        "to": "models"
      }
    ]
  }
}
```

### 5.5 核心代码变更（embeddingService.js）

```javascript
// 新增 BGE 本地嵌入 provider
case 'bge-local':
  vector = await this._embedBGE(text);
  break;

async _embedBGE(text) {
  if (!this._bgePipeline) {
    const { pipeline } = await import('@xenova/transformers');
    this._bgePipeline = await pipeline(
      'feature-extraction',
      'Xenova/bge-small-zh-v1.5',
      {
        quantized: true,           // 使用 INT8 量化
        local_files_only: true,    // 禁止联网下载
        model_path: path.join(__dirname, '../../resources/models/bge-small-zh-v1.5'),
      }
    );
  }
  
  const output = await this._bgePipeline(text, {
    pooling: 'cls',     // BGE 使用 CLS token
    normalize: true,    // L2 归一化
  });
  
  return Array.from(output.data);  // 384 维
}
```

---

## 6. 向量维度迁移

### 6.1 维度变化影响

| 嵌入方式 | 维度 | 当前数据 |
|---------|------|---------|
| 本地哈希（当前） | 1024 | 已索引 |
| BGE-small-zh-v1.5 | 384 | 需重建 |
| API 嵌入（未来） | 1024/2048 | 视模型而定 |

### 6.2 迁移策略

1. **首次启动检测**：检查 `vector_db` 的 collection 维度与当前 embedding 维度是否匹配
2. **不匹配时**：自动删除旧 `vector_db`，用新维度重建
3. **用户提示**：在设置-向量库页面显示当前嵌入模式和维度
4. **重建进度**：批量重建时显示进度条（notes/memories/tasks 逐批处理）

---

## 7. 性能对比

### 7.1 嵌入质量

| 方式 | MTEB 得分 | 语义理解 | 中文分词 | 多义词处理 |
|------|----------|---------|---------|-----------|
| 哈希嵌入 | ~20（估计） | ❌ 无 | ❌ 字符级 | ❌ 无 |
| BGE-small-zh-v1.5 INT8 | ~61 | ✅ 好 | ✅ WordPiece | ✅ 上下文 |
| BGE-small-zh-v1.5 FP32 | ~62 | ✅ 好 | ✅ WordPiece | ✅ 上下文 |
| 火山引擎 doubao-embedding | ~68 | ✅ 优秀 | ✅ 专业 | ✅ 优秀 |

### 7.2 检索效果对比

| 查询示例 | 哈希嵌入 | BGE-small |
|---------|---------|-----------|
| "如何部署应用" → "项目上线流程" | ❌ 无匹配（词汇不重叠） | ✅ 语义匹配 |
| "会议纪要" → "讨论记录" | ❌ 无匹配 | ✅ 语义匹配 |
| "API文档" → "接口说明" | ❌ 无匹配 | ✅ 语义匹配 |
| "docker" → "docker" | ✅ 精确匹配 | ✅ 精确匹配 |

### 7.3 延迟对比

| 操作 | 哈希嵌入 | BGE INT8 | API 嵌入 |
|------|---------|----------|---------|
| 单条嵌入 | <1 ms | ~20 ms | ~200-500 ms（含网络） |
| 批量 16 条 | <5 ms | ~300 ms | ~500-1000 ms |
| 全量重建（100 条） | <50 ms | ~2 秒 | ~10-30 秒 |

---

## 8. 风险评估

| 风险 | 严重度 | 概率 | 缓解方案 |
|------|--------|------|---------|
| 安装包增大 53MB | 中 | 100% | 使用 INT8 量化模型（24MB），非必要功能按需下载 |
| 内存增加 80-120MB | 中 | 100% | 空闲超 5 分钟自动卸载模型，下次使用重新加载 |
| onnxruntime 原生模块兼容性 | 高 | 低 | macOS arm64/x64 已验证，Windows/Linux 需测试 |
| Electron 版本升级冲突 | 中 | 低 | 锁定 onnxruntime-node 版本，Electron 升级时验证 |
| 模型文件被杀毒软件误报 | 低 | 低 | 代码签名 + 白名单申报 |
| 多平台二进制打包复杂 | 中 | 中 | 使用 electron-builder 的 native rebuild 机制 |

---

## 9. 实施计划

### Phase 1：基础集成（1 天）
- [ ] 安装 `onnxruntime-node` + `@xenova/transformers`
- [ ] 下载 BGE-small-zh-v1.5 INT8 ONNX 模型到 `resources/models/`
- [ ] 实现 `_embedBGE()` 方法
- [ ] 修改 `init()` 降级链路：API → BGE 本地 → 哈希
- [ ] 维度迁移：自动检测 + 重建

### Phase 2：性能优化（0.5 天）
- [ ] 模型懒加载（首次调用 embed 时才加载）
- [ ] 空闲自动卸载（5 分钟无调用 → 释放模型内存）
- [ ] 批量推理优化（多条文本合并为一个 batch）

### Phase 3：打包验证（0.5 天）
- [ ] electron-builder 配置 asarUnpack
- [ ] macOS arm64 DMG 打包验证
- [ ] 模型文件在 asar.unpacked 中正确加载
- [ ] 安装后首次启动自动重建索引

---

## 10. 推荐方案

### ✅ 推荐方案：INT8 量化 + 懒加载

| 配置项 | 推荐值 | 理由 |
|--------|--------|------|
| 模型版本 | `model_int8.onnx` | 23.9MB，精度损失可接受 |
| 加载策略 | 懒加载 + 5分钟超时卸载 | 减少空闲内存占用 |
| 推理引擎 | onnxruntime-node | Electron 原生支持，性能最优 |
| 分词器 | @xenova/transformers 内置 | 无需额外配置 |
| 维度 | 384 | BGE-small 原生维度 |
| 批量大小 | 16 条/批 | 平衡吞吐与内存峰值 |

### 替代方案对比

| 方案 | 包增量 | 内存增量 | 语义质量 | 离线可用 | 推荐度 |
|------|--------|---------|---------|---------|--------|
| **BGE-small INT8** | **+53 MB** | **+100 MB** | **★★★★☆** | **✅** | **⭐ 推荐** |
| BGE-small FP32 | +100 MB | +250 MB | ★★★★★ | ✅ | 体积过大 |
| BGE-base-zh-v1.5 | +180 MB | +400 MB | ★★★★★ | ✅ | 过重 |
| 哈希嵌入（当前） | 0 | <1 MB | ★☆☆☆☆ | ✅ | 质量太差 |
| API 嵌入（火山引擎） | 0 | 0 | ★★★★★ | ❌ | 依赖网络 |
| FastText 本地 | +30 MB | +50 MB | ★★☆☆☆ | ✅ | 中文支持差 |

### 最终建议

**采用 BGE-small-zh-v1.5 INT8 量化方案**，理由：

1. **体积可控**：安装包增加 53MB（当前 ~157MB → ~210MB），增幅 34%，在桌面应用可接受范围
2. **质量飞跃**：从哈希嵌入（无语义）升级到 BGE（MTEB 61分），检索效果质变
3. **离线可用**：不依赖网络，隐私数据不上传，符合 Memora 本地优先架构
4. **性能足够**：INT8 推理 20ms/条，批量 300ms/16条，完全满足实时需求
5. **MIT 许可**：可商用，无法律风险
6. **降级安全**：BGE 加载失败时仍可降级到哈希嵌入，不影响基础功能

如果未来需要更高质量，可平滑升级到 BGE-base-zh-v1.5（384→768 维）或切换到 API 嵌入。
