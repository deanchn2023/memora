# Memora 版本升级 API

Memora 客户端对接自动更新/版本检查的完整接口文档。

**基础地址**：`http://<host>:3450/memora`

**鉴权方式**：版本检查和下载接口为**公开接口**，无需 Token。管理员接口需要 JWT Token。

---

## 1. 检查更新

客户端启动时调用，检查当前平台是否有新版本。

```
GET /memora/updates/check?platform=darwin&arch=arm64&version=2.1.0
```

**鉴权**：无需登录（公开接口）

**查询参数**：

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| version | ✅ | string | 当前客户端版本号（如 `2.1.0`） |
| platform | ❌ | string | 操作系统：`darwin`（macOS）/ `win32`（Windows）/ `linux`，默认 `darwin` |
| arch | ❌ | string | 架构：`arm64` / `x64`，默认 `arm64` |

**有更新时响应**：

```json
{
  "has_update": true,
  "latest_version": "2.2.0",
  "release_notes": "1. 新增 AI 对话功能\n2. 优化搜索性能\n3. 修复登录超时问题",
  "download_url": "/memora/updates/download/Memora-2.2.0-file.dmg",
  "file_size": 89456640,
  "sha256": "a1b2c3d4e5f6...",
  "released_at": "2026-06-04T18:00:00.000Z",
  "install_guide": "下载完成后双击 DMG 文件，将 Memora 拖入应用程序文件夹即可"
}
```

**无更新时响应**：

```json
{
  "has_update": false
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| has_update | boolean | 是否有新版本 |
| latest_version | string | 最新版本号 |
| release_notes | string | 更新日志（`\n` 换行） |
| download_url | string | 下载路径（相对地址，需拼接基础地址） |
| file_size | number | 文件大小（字节） |
| sha256 | string | 文件 SHA256 校验值 |
| released_at | string | 发布时间（ISO 8601） |
| install_guide | string | 安装指引 |

**版本比较规则**：
- 采用语义化版本比较（SemVer），按 `.` 分段逐位比较
- 前缀 `v` 会被自动忽略
- 示例：`2.2.0 > 2.1.9`，`3.0.0 > 2.9.9`

**客户端对接建议**：
- 应用启动时自动调用一次
- `has_update = true` 时弹出更新提示弹窗
- 展示 `release_notes` 让用户了解更新内容
- 下载后用 `sha256` 校验文件完整性
- 使用完整下载地址：`http://<host>:3450${download_url}`

---

## 2. 下载更新文件

下载指定版本的安装包。

```
GET /memora/updates/download/:filename
```

**鉴权**：无需登录（公开接口）

**路径参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| filename | string | 文件名（从 check 接口的 `download_url` 获取） |

**响应**：
- `Content-Type: application/octet-stream`
- `Content-Disposition: attachment; filename*=UTF-8''<filename>`
- `Content-Length: <文件大小>`

**错误码**：

| 状态码 | 说明 |
|--------|------|
| 400 | 非法文件名（含路径穿越字符） |
| 404 | 文件不存在 |

**客户端对接建议**：
- 支持断点续传（Range 请求）
- 下载进度回调展示进度条
- 下载完成后校验 SHA256
- 校验通过后自动打开安装包或提示用户手动安装

---

## 3. 管理员接口

以下接口需要管理员权限（`super_admin` 或 `regional_admin`）。

### 3.1 上传新版本

```
POST /memora/admin/updates/upload
```

**Content-Type**：`multipart/form-data`

**鉴权**：需要管理员 Token

**表单字段**：

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| file | ✅ | File | 安装包文件（.dmg / .zip / .exe / .AppImage） |
| version | ✅ | string | 版本号（如 `2.2.0`） |
| platform | ❌ | string | 操作系统，默认 `darwin` |
| arch | ❌ | string | 架构，默认 `arm64` |
| release_notes | ❌ | string | 更新日志 |

**文件限制**：最大 500MB

**响应**：

```json
{
  "success": true,
  "id": "ver-a1b2c3d4e5",
  "sha256": "a1b2c3d4e5f6789..."
}
```

**上传流程**：
1. 管理员在后台选择文件并填写版本信息
2. 服务端自动计算 SHA256 校验值
3. 文件存储在服务器 `memora-updates/` 目录
4. 版本记录写入数据库

### 3.2 获取版本列表

```
GET /memora/admin/versions
```

**鉴权**：需要管理员 Token

**响应**：版本数组

```json
[
  {
    "id": "ver-a1b2c3d4e5",
    "version": "2.2.0",
    "platform": "darwin",
    "arch": "arm64",
    "release_notes": "新增 AI 对话功能",
    "file_path": "/data/server/memora-updates/Memora-2.2.0-file.dmg",
    "file_size": 89456640,
    "file_size_formatted": "85.3 MB",
    "sha256": "a1b2c3d4e5f6...",
    "file_exists": true,
    "created_by": "u-admin-001",
    "created_at": "2026-06-04T18:00:00.000Z"
  }
]
```

### 3.3 删除版本

```
DELETE /memora/admin/versions/:id
```

**鉴权**：需要管理员 Token

**响应**：

```json
{
  "success": true
}
```

删除操作会同时删除数据库记录和物理文件。

---

## 客户端对接示例（Electron）

```javascript
const MEMORA_API = 'http://21.91.29.59:3450/memora';

class MemoraUpdater {
  constructor(currentVersion, platform = 'darwin', arch = 'arm64') {
    this.currentVersion = currentVersion;
    this.platform = platform;
    this.arch = arch;
  }

  /** 检查更新 */
  async checkForUpdate() {
    const url = `${MEMORA_API}/updates/check?version=${this.currentVersion}&platform=${this.platform}&arch=${this.arch}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`检查更新失败: ${res.status}`);
    return res.json();
  }

  /** 下载更新 */
  async downloadUpdate(downloadUrl, onProgress) {
    const fullUrl = `${MEMORA_API.replace('/memora', '')}${downloadUrl}`;
    const res = await fetch(fullUrl);

    if (!res.ok) throw new Error(`下载失败: ${res.status}`);

    const contentLength = parseInt(res.headers.get('Content-Length') || '0');
    const reader = res.body.getReader();
    const chunks = [];
    let receivedLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedLength += value.length;
      if (onProgress && contentLength) {
        onProgress(receivedLength / contentLength);
      }
    }

    return Buffer.concat(chunks);
  }

  /** 校验 SHA256 */
  async verifySHA256(fileBuffer, expectedHash) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    return hash === expectedHash;
  }

  /** 完整更新流程 */
  async runUpdate(onProgress) {
    // 1. 检查更新
    const updateInfo = await this.checkForUpdate();
    if (!updateInfo.has_update) {
      return { updated: false, message: '已是最新版本' };
    }

    // 2. 下载
    const fileBuffer = await this.downloadUpdate(
      updateInfo.download_url,
      onProgress
    );

    // 3. 校验
    if (updateInfo.sha256) {
      const valid = await this.verifySHA256(fileBuffer, updateInfo.sha256);
      if (!valid) throw new Error('文件校验失败，SHA256 不匹配');
    }

    return {
      updated: true,
      version: updateInfo.latest_version,
      releaseNotes: updateInfo.release_notes,
      installGuide: updateInfo.install_guide,
      fileBuffer
    };
  }
}
```

## 数据库表结构（参考）

```sql
-- 版本表
CREATE TABLE app_versions (
  id TEXT PRIMARY KEY,           -- 版本记录ID (ver-xxxxxxxxxx)
  version TEXT NOT NULL,         -- 版本号 (2.2.0)
  platform TEXT NOT NULL,        -- 操作系统 (darwin / win32 / linux)
  arch TEXT NOT NULL,            -- 架构 (arm64 / x64)
  release_notes TEXT,            -- 更新日志
  file_path TEXT NOT NULL,       -- 服务器文件路径
  file_size INTEGER,             -- 文件大小（字节）
  sha256 TEXT,                   -- SHA256 校验值
  created_by TEXT NOT NULL,      -- 上传者
  created_at TEXT                -- 创建时间
);
```

## 支持的平台与架构

| 平台 | 值 | 架构 | 文件格式 |
|------|------|------|----------|
| macOS | `darwin` | `arm64` (Apple Silicon) | `.dmg` |
| macOS | `darwin` | `x64` (Intel) | `.dmg` |
| Windows | `win32` | `x64` | `.exe` |
| Linux | `linux` | `x64` | `.AppImage` |
