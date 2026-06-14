# Memora 记事本图文同步 API 文档

> 版本: 1.0 | 更新: 2026-06-10
> 基于现有 Memora v3 同步架构扩展，新增记事本分类图片和图文结合支持
> 服务端版本: Memora Extension Service v3.1

---

## 1. 概述

### 1.1 背景

Memora 记事本原先只支持纯文本笔记（`user_notes` 表只有 `title` + `content`）。本次更新：

1. **记事本新增分类**：`category` 字段区分 `text`（文本笔记）和 `image`（图片笔记）
2. **图文结合**：`user_notes` 表新增图片元数据字段（路径/哈希/尺寸），支持一条笔记关联一张图片
3. **图片文件同步**：新增 `note_images` 表和完整的图片上传/下载/绑定/删除 API
4. **跨端图片迁移**：图片文件通过独立 API 上传下载，元数据通过 push/pull 同步

### 1.2 架构设计

```
┌───────────────────────┐                    ┌─────────────────────────────┐
│   Memora PC (Electron) │                    │   ADPToolkit Config Server   │
│                        │                    │   (121.5.164.126:3450)       │
│  1. 创建图片笔记        │─── upload ───────► │  存储: uploads/note-images/  │
│  2. 本地保存 PNG        │                    │  元数据: note_images 表      │
│  3. 上传图片文件        │                    │  笔记: user_notes 表         │
│  4. push 笔记元数据     │─── push ─────────► │  写入 image_* 字段           │
│                        │                    │                              │
│                        │◄── download ────── │  图片文件服务                 │
│                        │◄── pull ────────── │  笔记+图片元数据              │
└───────────────────────┘                    └──────────┬──────────────────┘
                                                        │
                                             ┌──────────▼──────────────────┐
                                             │   MemoraMobile (Flutter)     │
                                             │                              │
                                             │  1. pull 笔记元数据           │
                                             │  2. pull 图片元数据           │
                                             │  3. 逐个下载图片文件          │
                                             │  4. 本地存储到 App Documents  │
                                             └──────────────────────────────┘
```

### 1.3 同步流程（完整）

```
Step 1: 上传图片文件
  POST /memora/sync/notes/images/upload (multipart/form-data)
  → 服务端存储文件 + 记录元数据到 note_images 表
  → 返回 image_id, server_path, image_hash, width, height

Step 2: 创建图片笔记（或更新已有笔记）
  POST /memora/sync/push
  changes.notes = [{
    id: "note_xxx",
    category: "image",
    image_path: "{userId}/{filename}",     ← 来自 Step 1 的 server_path
    image_hash: "sha256_hash",             ← 来自 Step 1 的 image_hash
    image_width: 1920,                     ← 来自 Step 1 的 width
    image_height: 1080,                    ← 来自 Step 1 的 height
    title: "图片笔记标题",
    content: "图片描述文字..."
  }]
  → 笔记元数据同步到服务端

Step 3: 绑定图片到笔记（可选，建议 Step 2 已包含图片字段则跳过）
  PUT /memora/sync/notes/images/{imageId}/bind
  { note_id: "note_xxx" }
  → 自动更新 user_notes 的 image_* 字段

Step 4: 另一端拉取
  POST /memora/sync/full → 获取笔记元数据（含 image_* 字段）
  POST /memora/sync/notes/images/sync-pull → 获取图片元数据列表
  GET /memora/sync/notes/images/{imageId}/download → 下载图片文件

Step 5: 删除图片笔记
  POST /memora/sync/push changes.notes = [{ id, _deleted: true }]
  DELETE /memora/sync/notes/images/{imageId} → 删除图片文件+元数据
```

### 1.4 权限矩阵

| 操作 | PC(electron) | 移动端(flutter) | 小程序 | Web |
|------|:---:|:---:|:---:|:---:|
| 上传图片 | ✓ | ✓ | ❌ | ❌ |
| 下载图片 | ✓ | ✓ | ✓ | ✓ |
| 删除图片 | ✓ | ✓ | ❌ | ❌ |
| 绑定图片到笔记 | ✓ | ✓ | ❌ | ❌ |
| push/push 笔记元数据 | ✓ | ✓ | 只读 | 只读 |

---

## 2. 数据模型变更

### 2.1 user_notes 表新增字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `category` | TEXT | `'text'` | 记事本分类：`text`（纯文本）/ `image`（图片笔记） |
| `image_path` | TEXT | `''` | 服务端相对路径，格式 `{userId}/{filename}` |
| `image_hash` | TEXT | `''` | 图片文件 SHA256 哈希，用于去重和校验 |
| `image_width` | INTEGER | `0` | 图片宽度（px） |
| `image_height` | INTEGER | `0` | 图片高度（px） |

**迁移说明**：服务端启动时自动 ALTER TABLE 添加这 5 个字段，已有笔记的 `category` 默认为 `'text'`。

### 2.2 note_images 表（新建）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `id` | TEXT PK | ✓ | 服务端生成，格式 `img_{timestamp}_{random8}` |
| `user_id` | TEXT | ✓ | 用户 ID（服务端自动填充） |
| `note_id` | TEXT | | 关联的笔记 ID，空字符串表示未绑定 |
| `filename` | TEXT | ✓ | 服务端文件名，格式 `{timestamp}_{random8}.png` |
| `original_name` | TEXT | | 客户端原始文件名 |
| `server_path` | TEXT | ✓ | 服务端相对路径：`{userId}/{filename}` |
| `file_size` | INTEGER | | 文件大小（字节） |
| `mime_type` | TEXT | | MIME 类型，如 `image/png`、`image/jpeg` |
| `image_hash` | TEXT | | SHA256 哈希 |
| `width` | INTEGER | | 图片宽度（px） |
| `height` | INTEGER | | 图片高度（px） |
| `origin_device_id` | TEXT | | 上传设备 ID |
| `revision` | INTEGER | | 乐观锁版本号 |
| `created_at` | TEXT | | 创建时间 ISO 8601 |
| `updated_at` | TEXT | | 更新时间 ISO 8601 |
| `deleted_at` | TEXT | | 软删除时间 |

---

## 3. API 端点

### 3.1 POST /memora/sync/notes/images/upload

上传记事本图片文件（multipart/form-data）。

**鉴权**：JWT Token + Active 设备

**请求**：
- Content-Type: `multipart/form-data`
- 字段名：`images`（支持多文件，最多 5 个）

**限制**：
- 单文件最大 **10MB**
- 单次最多 **5 张**
- 格式：**PNG / JPEG / GIF / WebP / BMP**

**示例（curl）**：
```bash
curl -X POST http://121.5.164.126:3450/memora/sync/notes/images/upload \
  -H "Authorization: Bearer {token}" \
  -F "images=@/path/to/photo1.png" \
  -F "images=@/path/to/photo2.jpg"
```

**示例（Dart/Flutter）**：
```dart
final request = http.MultipartRequest(
  'POST',
  Uri.parse('$baseUrl/memora/sync/notes/images/upload'),
);
request.headers['Authorization'] = 'Bearer $token';
request.files.addAll(
  imagePaths.map((p) => http.MultipartFile.fromPath('images', p)),
);
final response = await request.send();
final result = jsonDecode(await response.stream.bytesToString());
```

**示例（Electron/Node.js）**：
```javascript
const FormData = require('form-data');
const fs = require('fs');
const form = new FormData();
form.append('images', fs.createReadStream('/path/to/photo.png'));

const response = await fetch('http://121.5.164.126:3450/memora/sync/notes/images/upload', {
  method: 'POST',
  headers: { ...form.getHeaders(), 'Authorization': `Bearer ${token}` },
  body: form,
});
```

**响应**：
```json
{
  "ok": true,
  "uploaded": [
    {
      "id": "img_1718012345678_a1b2c3d4",
      "filename": "1718012345678_a1b2c3d4.png",
      "original_name": "screenshot.png",
      "server_path": "user_001/1718012345678_a1b2c3d4.png",
      "download_url": "/memora/sync/notes/images/img_1718012345678_a1b2c3d4/download",
      "file_size": 245678,
      "mime_type": "image/png",
      "image_hash": "a3f5b8c1d2e4f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
      "width": 1920,
      "height": 1080
    }
  ],
  "count": 1
}
```

**错误响应**：
```json
{
  "ok": false,
  "uploaded": [...],
  "errors": [
    { "filename": "large.gif", "error": "不支持的图片格式: image/tiff" }
  ]
}
```

---

### 3.2 GET /memora/sync/notes/images/:imageId/download

下载记事本图片文件。

**鉴权**：JWT Token

**请求**：
- Method: GET
- URL: `/memora/sync/notes/images/{imageId}/download`

**响应**：
- Content-Type: 对应的 `mime_type`
- Content-Disposition: `inline; filename="{original_name}"`
- Cache-Control: `public, max-age=86400`（浏览器缓存 24 小时）
- Body: 图片二进制数据

**示例（Dart/Flutter 下载并保存）**：
```dart
final response = await http.get(
  Uri.parse('$baseUrl/memora/sync/notes/images/$imageId/download'),
  headers: {'Authorization': 'Bearer $token'},
);

if (response.statusCode == 200) {
  // 保存到应用文档目录
  final appDir = await getApplicationDocumentsDirectory();
  final localPath = '${appDir.path}/note_images/$serverPath';
  await File(localPath).parent.create(recursive: true);
  await File(localPath).writeAsBytes(response.bodyBytes);
}
```

**错误**：
- 404: 图片不存在 / 图片文件丢失

---

### 3.3 GET /memora/sync/notes/images/:imageId

获取图片元数据（不含文件内容）。

**鉴权**：JWT Token

**响应**：
```json
{
  "ok": true,
  "image": {
    "id": "img_1718012345678_a1b2c3d4",
    "user_id": "user_001",
    "note_id": "note_xxx",
    "filename": "1718012345678_a1b2c3d4.png",
    "original_name": "screenshot.png",
    "server_path": "user_001/1718012345678_a1b2c3d4.png",
    "file_size": 245678,
    "mime_type": "image/png",
    "image_hash": "a3f5b8c1d2e4...",
    "width": 1920,
    "height": 1080,
    "revision": 1,
    "created_at": "2026-06-10T10:00:00.000Z",
    "download_url": "/memora/sync/notes/images/img_xxx/download"
  }
}
```

---

### 3.4 GET /memora/sync/notes/images

获取用户所有图片列表（分页）。

**鉴权**：JWT Token

**查询参数**：
| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | integer | 1 | 页码 |
| `limit` | integer | 50 | 每页数量 |
| `note_id` | string | — | 筛选指定笔记的图片 |

**响应**：
```json
{
  "ok": true,
  "total": 15,
  "page": 1,
  "limit": 50,
  "images": [
    {
      "id": "img_xxx",
      "note_id": "note_001",
      "filename": "...",
      "server_path": "...",
      "download_url": "/memora/sync/notes/images/img_xxx/download",
      ...
    }
  ]
}
```

---

### 3.5 POST /memora/sync/notes/images/batch-download

批量获取图片元数据和下载状态（用于检查哪些图片需要下载）。

**鉴权**：JWT Token

**请求**：
```json
{
  "image_ids": ["img_001", "img_002", "img_003"]
}
```

**限制**：单次最多 50 个 ID

**响应**：
```json
{
  "ok": true,
  "images": [
    {
      "id": "img_001",
      "server_path": "user_001/1718012345678_a1b2c3d4.png",
      "download_url": "/memora/sync/notes/images/img_001/download",
      "file_size": 245678,
      "image_hash": "a3f5b8c1d2e4...",
      ...
    }
  ]
}
```

---

### 3.6 PUT /memora/sync/notes/images/:imageId/bind

将图片绑定到指定笔记（自动更新 `user_notes` 的 `image_*` 字段）。

**鉴权**：JWT Token + Active 设备

**请求**：
```json
{
  "note_id": "note_xxx"
}
```

**响应**：
```json
{
  "ok": true,
  "revision": 2
}
```

**说明**：绑定后自动将 `user_notes` 表对应记录的 `category` 设为 `'image'`，并填充 `image_path`、`image_hash`、`image_width`、`image_height`。

---

### 3.7 DELETE /memora/sync/notes/images/:imageId

删除图片（软删除元数据 + 删除实际文件）。

**鉴权**：JWT Token + Active 设备

**响应**：
```json
{
  "ok": true,
  "deleted": true
}
```

---

### 3.8 POST /memora/sync/notes/images/sync-pull

移动端拉取图片元数据（类似 notes 的 pull，基于 revision 增量拉取）。

**鉴权**：JWT Token

**请求**：
```json
{
  "device_id": "mobile_ios_abc123",
  "since_revision": 0
}
```

**响应**：
```json
{
  "ok": true,
  "images": [
    {
      "id": "img_xxx",
      "note_id": "note_001",
      "filename": "...",
      "server_path": "user_001/xxx.png",
      "file_size": 245678,
      "mime_type": "image/png",
      "image_hash": "a3f5b8...",
      "width": 1920,
      "height": 1080,
      "revision": 3,
      "download_url": "/memora/sync/notes/images/img_xxx/download",
      "created_at": "2026-06-10T10:00:00.000Z",
      "updated_at": "2026-06-10T10:05:00.000Z"
    }
  ],
  "deleted_ids": [
    { "id": "img_yyy", "revision": 5 }
  ],
  "count": 1,
  "max_revision": 5
}
```

**流程**：
1. 客户端调用此 API 获取图片元数据列表
2. 对比本地已有的图片（通过 `image_hash` 判断是否需要下载）
3. 逐个调用 `GET /notes/images/{id}/download` 下载新图片文件
4. 删除 `deleted_ids` 中列出的本地图片文件

---

## 4. 客户端对接指南

### 4.1 PC 端 (Electron) - 创建图片笔记

```javascript
// 1. 上传图片文件
const formData = new FormData();
formData.append('images', fs.createReadStream(localImagePath));

const uploadRes = await fetch(`${syncBaseUrl}/notes/images/upload`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData,
});
const { uploaded } = await uploadRes.json();
const imageInfo = uploaded[0];

// 2. 创建笔记（push 时包含图片字段）
await fetch(`${syncBaseUrl}/push`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    device_id: deviceId,
    changes: {
      notes: [{
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        _base_revision: 0,
        title: '图片笔记标题',
        content: '这是图片的描述文字...',
        category: 'image',
        image_path: imageInfo.server_path,
        image_hash: imageInfo.image_hash,
        image_width: imageInfo.width,
        image_height: imageInfo.height,
        tags: JSON.stringify(['图片']),
      }]
    }
  })
});
```

### 4.2 PC 端 - addNote 函数修改

```javascript
// 之前：只有 category === 'image' 时才保存图片字段
// 现在：所有图片笔记都应该保存图片字段
function addNote(noteData) {
  const stmt = db.prepare(`
    INSERT INTO user_notes (id, title, content, category, image_path, image_hash, image_width, image_height, tags, folder, extra, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
  `);
  stmt.run(
    noteData.id,
    noteData.title || '',
    noteData.content || '',
    noteData.category || 'text',
    noteData.image_path || '',       // ← 新增
    noteData.image_hash || '',       // ← 新增
    noteData.image_width || 0,       // ← 新增
    noteData.image_height || 0,      // ← 新增
    JSON.stringify(noteData.tags || []),
    noteData.folder || '',
    JSON.stringify(noteData.extra || {}),
  );
}
```

### 4.3 移动端 (Flutter) - 拉取图片笔记

```dart
// 1. 常规 pull 获取笔记元数据（含 image_* 字段）
final syncResult = await http.post(
  Uri.parse('$baseUrl/memora/sync/full'),
  headers: {'Authorization': 'Bearer $token'},
  body: jsonEncode({
    'device_id': deviceId,
    'since_revision': lastSyncRevision,
    'changes': {},
  }),
);

// 2. 检查笔记中的图片笔记
final notes = syncResult['pull']['results']['notes']['records'];
final imageNotes = notes.where((n) => n['category'] == 'image' && n['image_path'] != '');

// 3. 拉取图片元数据
final imageSyncResult = await http.post(
  Uri.parse('$baseUrl/memora/sync/notes/images/sync-pull'),
  headers: {'Authorization': 'Bearer $token'},
  body: jsonEncode({
    'device_id': deviceId,
    'since_revision': lastImageRevision,
  }),
);

// 4. 对比本地已有图片，下载缺失的
for (final img in imageSyncResult['images']) {
  final localPath = await _getLocalImagePath(img['server_path']);
  
  // 通过 hash 检查是否需要下载
  if (!await File(localPath).exists() || await _getFileHash(localPath) != img['image_hash']) {
    await _downloadImage(img['id'], localPath);
  }
}

// 5. 保存笔记到本地数据库
for (final note in imageNotes) {
  await localDb.insert('notes', {
    'id': note['id'],
    'title': note['title'],
    'content': note['content'],
    'category': note['category'] ?? 'text',
    'image_path': note['image_path'] ?? '',
    'image_hash': note['image_hash'] ?? '',
    'image_width': note['image_width'] ?? 0,
    'image_height': note['image_height'] ?? 0,
    'revision': note['revision'],
  });
}
```

### 4.4 移动端 - 上传图片笔记

```dart
// 1. 上传图片文件
final request = http.MultipartRequest(
  'POST',
  Uri.parse('$baseUrl/memora/sync/notes/images/upload'),
);
request.headers['Authorization'] = 'Bearer $token';
request.files.add(await http.MultipartFile.fromPath('images', localImagePath));

final streamResponse = await request.send();
final uploadResult = jsonDecode(await streamResponse.stream.bytesToString());
final imageInfo = uploadResult['uploaded'][0];

// 2. 创建笔记并 push
final noteId = 'note_${DateTime.now().millisecondsSinceEpoch}_${Random().nextString(8)}';
await http.post(
  Uri.parse('$baseUrl/memora/sync/push'),
  headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'},
  body: jsonEncode({
    'device_id': deviceId,
    'changes': {
      'notes': [{
        'id': noteId,
        '_base_revision': 0,
        'title': '手机拍照笔记',
        'content': '拍摄的照片...',
        'category': 'image',
        'image_path': imageInfo['server_path'],
        'image_hash': imageInfo['image_hash'],
        'image_width': imageInfo['width'],
        'image_height': imageInfo['height'],
      }]
    }
  }),
);
```

---

## 5. 数据库 SQL（服务端新增部分）

```sql
-- user_notes 新增 5 个字段
ALTER TABLE user_notes ADD COLUMN category TEXT DEFAULT 'text';
ALTER TABLE user_notes ADD COLUMN image_path TEXT DEFAULT '';
ALTER TABLE user_notes ADD COLUMN image_hash TEXT DEFAULT '';
ALTER TABLE user_notes ADD COLUMN image_width INTEGER DEFAULT 0;
ALTER TABLE user_notes ADD COLUMN image_height INTEGER DEFAULT 0;

-- note_images 表（新建）
CREATE TABLE IF NOT EXISTS note_images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note_id TEXT DEFAULT '',
  filename TEXT NOT NULL,
  original_name TEXT DEFAULT '',
  server_path TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  mime_type TEXT DEFAULT 'image/png',
  image_hash TEXT DEFAULT '',
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  origin_device_id TEXT DEFAULT '',
  revision INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (note_id) REFERENCES user_notes(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_noteimg_user ON note_images(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_noteimg_note ON note_images(user_id, note_id);
CREATE INDEX IF NOT EXISTS idx_noteimg_hash ON note_images(user_id, image_hash);
```

---

## 6. 客户端本地数据库变更

### 6.1 Electron (better-sqlite3 / sql.js)

```sql
-- user_notes 表增加字段
ALTER TABLE user_notes ADD COLUMN category TEXT DEFAULT 'text';
ALTER TABLE user_notes ADD COLUMN image_path TEXT DEFAULT '';
ALTER TABLE user_notes ADD COLUMN image_hash TEXT DEFAULT '';
ALTER TABLE user_notes ADD COLUMN image_width INTEGER DEFAULT 0;
ALTER TABLE user_notes ADD COLUMN image_height INTEGER DEFAULT 0;
```

**本地图片存储路径**：
- macOS: `~/Library/Application Support/Memora/note-images/{userId}/{filename}`
- Windows: `%APPDATA%/Memora/note-images/{userId}/{filename}`

### 6.2 Flutter (SQLite)

```sql
-- user_notes 表增加字段
ALTER TABLE user_notes ADD COLUMN category TEXT DEFAULT 'text';
ALTER TABLE user_notes ADD COLUMN image_path TEXT DEFAULT '';
ALTER TABLE user_notes ADD COLUMN image_hash TEXT DEFAULT '';
ALTER TABLE user_notes ADD COLUMN image_width INTEGER DEFAULT 0;
ALTER TABLE user_notes ADD COLUMN image_height INTEGER DEFAULT 0;
```

**本地图片存储路径**：
- iOS/Android: `(getApplicationDocumentsDirectory())/note-images/{serverPath}`

---

## 7. 端到端数据流

### 7.1 创建图片笔记（PC → 服务端 → 移动端）

```
PC 端操作:
  1. 用户截图/粘贴图片 → 保存到本地 /note-images/user_xxx/photo.png
  2. 创建笔记 → 本地 DB: { category: "image", image_path: "local/path", ... }
  3. 同步: 上传图片 → POST /notes/images/upload → 获得 server_path
  4. 同步: push 笔记 → POST /sync/push → image_path 更新为 server_path

服务端:
  5. 存储: 图片文件在 uploads/note-images/{userId}/{filename}
  6. 元数据: note_images 表 + user_notes 表

移动端:
  7. pull 笔记 → POST /sync/full → 获得笔记（含 image_path）
  8. pull 图片 → POST /notes/images/sync-pull → 获得图片元数据
  9. 下载图片 → GET /notes/images/{id}/download → 保存到本地
  10. 展示: 读取本地图片文件，配合笔记内容渲染
```

### 7.2 创建图片笔记（移动端 → 服务端 → PC）

```
移动端操作:
  1. 用户拍照/选择相册图片
  2. 上传图片 → POST /notes/images/upload
  3. 创建笔记 → push 时 category="image" + image_* 字段

PC 端:
  4. pull 获得笔记元数据
  5. 检查 image_path，下载缺失图片
  6. 展示
```

---

## 8. 限制与 TODO

| 项目 | 当前状态 | 说明 |
|------|---------|------|
| 图片文件大小 | 单文件 ≤ 10MB | multer 限制，可调整 |
| 单次上传数量 | ≤ 5 张 | 避免大请求阻塞 |
| 图片去重 | 通过 image_hash 检测 | 相同 hash 的图片不重复下载 |
| 图片缩略图 | ❌ 未实现 | TODO: 上传时自动生成缩略图（缩小到 300px） |
| 离线展示 | 本地缓存 | 首次需联网下载，之后使用本地缓存 |
| 批量下载 | 逐个下载 | TODO: 支持 ZIP 打包批量下载 |
| 图片压缩 | ❌ 未实现 | TODO: 上传时自动压缩（JPEG quality 0.8） |

---

## 9. 错误码

| HTTP | 场景 | 说明 |
|------|------|------|
| 400 | 上传空文件 | `未提供图片文件` |
| 400 | 格式不支持 | `不支持的图片格式: image/tiff` |
| 400 | 批量查询超限 | `单次最多查询 50 个图片` |
| 403 | 设备停用 | 设备已停用，无法上传/删除 |
| 404 | 图片不存在 | ID 错误或已删除 |
| 404 | 图片文件丢失 | 元数据存在但文件被清理 |
| 413 | 文件过大 | 超过 10MB 限制 |

---

## 10. API 端点汇总

| Method | URL | 说明 |
|--------|-----|------|
| POST | `/memora/sync/notes/images/upload` | 上传图片（multipart） |
| GET | `/memora/sync/notes/images/:id/download` | 下载图片文件 |
| GET | `/memora/sync/notes/images/:id` | 获取图片元数据 |
| GET | `/memora/sync/notes/images` | 图片列表（分页） |
| POST | `/memora/sync/notes/images/batch-download` | 批量查询图片元数据 |
| PUT | `/memora/sync/notes/images/:id/bind` | 绑定图片到笔记 |
| DELETE | `/memora/sync/notes/images/:id` | 删除图片 |
| POST | `/memora/sync/notes/images/sync-pull` | 增量拉取图片元数据 |
