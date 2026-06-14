# ADP Toolkit 公开资源 API 文档

> **Base URL**: `http://21.91.29.59:3000`
> 
> 所有公开接口无需鉴权（JWT），直接调用即可。

---

## 目录

| 接口 | 方法 | 说明 |
|------|------|------|
| 搜索文档 | GET | 公开文档列表 + 关键词搜索 |
| 搜索案例 | GET | 公开案例列表 + 关键词搜索 |
| 搜索 Demo | GET | 公开 Demo 列表 + 关键词搜索 |
| 搜索学习材料 | GET | 学习材料列表 + 关键词搜索 |
| 文档详情 | GET | 获取单个公开文档详情 |
| 案例详情 | GET | 获取单个公开案例详情 |
| Demo 详情 | GET | 获取单个公开 Demo 详情 |
| 下载资源 | GET/POST | 触发文件下载或获取链接 |
| 产品更新时间轴 | GET | 按年月分组的更新日志 |

---

## 1. 搜索 / 列表

### 1.1 搜索文档

```
GET /api/public/documents
```

**Query 参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| keyword | string | 否 | - | 关键词，模糊匹配标题和描述 |
| category | string | 否 | - | 分类过滤 |
| industry | string | 否 | - | 行业过滤 |
| page | number | 否 | 1 | 页码 |
| page_size | number | 否 | 20 | 每页数量 |

**响应示例 (200)：**

```json
{
  "data": [
    {
      "id": "doc-xxx",
      "title": "ADP 架构设计指南",
      "description": "基于 ADP 平台的架构设计最佳实践",
      "category": "技术文档",
      "industry": "金融",
      "author_name": "张三",
      "view_count": 128,
      "download_count": 45,
      "file_url": "/uploads/guide.pdf",
      "file_name": "adp-architecture-guide.pdf",
      "file_type": ".pdf",
      "created_at": "2026-05-20T10:00:00Z",
      "updated_at": "2026-05-25T14:30:00Z"
    }
  ],
  "total": 15
}
```

**请求示例：**

```bash
# 搜索关键词"架构"
curl "http://21.91.29.59:3000/api/public/documents?keyword=架构&page_size=10"

# 按分类筛选
curl "http://21.91.29.59:3000/api/public/documents?category=技术文档"

# 组合条件
curl "http://21.91.29.59:3000/api/public/documents?keyword=金融&industry=金融&page=1&page_size=5"
```

---

### 1.2 搜索案例

```
GET /api/public/cases
```

**Query 参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| keyword | string | 否 | - | 关键词，匹配标题和客户名 |
| industry | string | 否 | - | 行业过滤 |
| page | number | 否 | 1 | 页码 |
| page_size | number | 否 | 20 | 每页数量 |

**响应示例 (200)：**

```json
{
  "data": [
    {
      "id": "case-xxx",
      "title": "某银行智能客服项目",
      "client_name": "某银行",
      "industry": "金融",
      "description": "基于 ADP 的智能客服解决方案",
      "thumbnail_url": "/uploads/thumb.jpg",
      "doc_url": "",
      "demo_url": "https://demo.example.com/bank",
      "view_count": 89,
      "download_count": 23,
      "created_at": "2026-05-15T08:00:00Z",
      "updated_at": "2026-05-22T11:00:00Z"
    }
  ],
  "total": 8
}
```

---

### 1.3 搜索 Demo

```
GET /api/public/demos
```

**Query 参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| keyword | string | 否 | - | 关键词，匹配名称和描述 |
| category | string | 否 | - | 分类过滤 |
| industry | string | 否 | - | 行业过滤（JSON 数组内包含） |
| page | number | 否 | 1 | 页码 |
| page_size | number | 否 | 20 | 每页数量 |

> 注意：Demo 默认按点击量倒序排序（`click_count DESC`）。

**响应示例 (200)：**

```json
{
  "data": [
    {
      "id": "demo-xxx",
      "name": "智能工作台演示",
      "description": "ADP Smart Workbench 功能演示",
      "category": "产品演示",
      "thumbnail_url": "/uploads/demo-thumb.png",
      "access_url": "https://demo.example.com/workbench",
      "doc_url": "/uploads/demo-guide.pdf",
      "click_count": 256,
      "download_count": 34,
      "created_at": "2026-04-10T16:00:00Z",
      "updated_at": "2026-05-18T09:00:00Z"
    }
  ],
  "total": 12
}
```

---

### 1.4 搜索学习材料

```
GET /api/public/learning
```

**Query 参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| keyword | string | 否 | - | 关键词，匹配标题、描述、标签 |
| category | string | 否 | - | 分类过滤 |
| page | number | 否 | 1 | 页码 |
| page_size | number | 否 | 50 | 每页数量（默认50） |

**响应示例 (200)：**

```json
{
  "data": [
    {
      "id": "learn-xxx",
      "title": "ADP Skill 开发入门",
      "description": "从零开始开发 ADP Skill 插件",
      "category": "入门教程",
      "tags": ["Skill", "开发", "入门"],
      "html_url": "/public/skill-dev-guide.html",
      "cover_url": "/uploads/cover.jpg",
      "author_name": "李四",
      "view_count": 312,
      "download_count": 67,
      "sort_order": 1,
      "created_at": "2026-03-01T12:00:00Z",
      "updated_at": "2026-05-20T17:00:00Z"
    }
  ],
  "total": 20
}
```

---

## 2. 详情

### 2.1 文档详情

```
GET /api/public/documents/:id
```

> 自动增加浏览计数 `view_count + 1`。

**响应字段：** 返回文档全部字段 + 解析后的 `tags` 数组。404 表示不存在或未公开。

### 2.2 案例详情

```
GET /api/public/cases/:id
```

> 自动增加浏览计数。返回解析后的 `metrics` 和 `tags` 数组。

### 2.3 Demo 详情

```
GET /api/public/demos/:id
```

> 自动增加点击计数 `click_count + 1`。返回解析后的 `industries` 数组。

---

## 3. 下载

### 3.1 下载资源

```
GET  /api/public/download/:type/:id    ← 推荐：浏览器原生下载
POST /api/public/download/:type/:id    ← 返回文件流或 JSON
```

**路径参数：**

| 参数 | 值 | 说明 |
|------|-----|------|
| type | `document` \| `case` \| `demo` \| `learning` | 资源类型 |
| id | 资源 ID | 如 `doc-oT9cWj4ehL` |

**行为说明：**

| 场景 | 行为 |
|------|------|
| 本地文件（PDF/Word等） | 服务端流式返回文件（Content-Disposition: attachment） |
| 在线文档（外部URL） | POST 返回 JSON `{ download_url, file_name, is_online: true }` |
| 学习材料 HTML | 返回 JSON，前端新窗口打开 |
| Demo 链接 | 返回 JSON，前端新窗口打开 |

**请求示例：**

```bash
# 浏览器下载文档
curl -OJ http://21.91.29.59:3000/api/public/download/document/doc-oT9cWj4ehL

# 下载案例
curl -OJ http://21.91.29.59:3000/api/public/download/case/case-xxx

# 下载 Demo
curl -OJ http://21.91.29.59:3000/api/public/download/demo/demo-xxx

# 下载学习材料
curl -OJ http://21.91.29.59:3000/api/public/download/learning/learn-xxx
```

> 自动递增该资源的 `download_count` 计数。

---

## 4. 其他公开接口

### 4.1 产品更新时间轴

```
GET /api/public/updates/timeline
```

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | 否 | 状态过滤（如 `released`, `planned`）|
| year | string | 否 | 年份筛选（如 `2026`）|

**响应示例 (200)：**

```json
{
  "groups": [
    {
      "year": "2026",
      "month": "05",
      "items": [
        {
          "id": "upd-xxx",
          "title": "V3.4.2.5 发布",
          "content": "...",
          "type": "release",
          "status": "released",
          "event_date": "2026-05-01",
          "version": "3.4.2.5"
        }
      ]
    }
  ],
  "years": ["2026", "2025"]
}
```

---

## 错误码

| HTTP Code | 含义 | 示例响应 |
|-----------|------|----------|
| 200 | 成功 | 正常返回数据 |
| 400 | 参数错误 | `{"error": "无效的资源类型"}` |
| 404 | 资源不存在 | `{"error": "资源不存在或未公开"}` |
| 500 | 服务端错误 | `{"error": "服务器内部错误"}` |

---

## 鉴权说明

所有 `/api/public/*` 接口均在鉴权白名单中，**无需任何 Token 或认证信息**即可调用。

如需更高安全级别的受保护访问，可联系管理员配置 API Key 机制。

---

## 快速上手（其他系统集成）

### JavaScript / Node.js

```javascript
const BASE = 'http://21.91.29.59:3000';

// 搜索文档
async function searchDocs(keyword) {
  const res = await fetch(`${BASE}/api/public/documents?keyword=${encodeURIComponent(keyword)}&page_size=10`);
  return res.json(); // { data: [...], total: N }
}

// 获取详情并下载
async function downloadDoc(id) {
  const res = await fetch(`${BASE}/api/public/download/document/${id}`);
  if (!res.ok) throw new Error('下载失败');
  // 本地文件：res.body 为文件流
  // 外部URL：res.json() → { download_url, ... }
}
```

### Python

```python
import requests

BASE = 'http://21.91.29.59:3000'

def search_documents(keyword='', category=None):
    params = {'keyword': keyword, 'page_size': 20}
    if category:
        params['category'] = category
    resp = requests.get(f'{BASE}/api/public/documents', params=params)
    return resp.json()  # {'data': [...], 'total': N}

def download_resource(resource_type, resource_id):
    """resource_type: document / case / demo / learning"""
    resp = requests.get(f'{BASE}/api/public/download/{resource_type}/{resource_id}')
    if resp.status_code == 200:
        # 保存到本地
        with open(resp.headers.get('content-disposition', '').split('"')[-1], 'wb') as f:
            f.write(resp.content)
        print('下载成功')
    else:
        print(f'下载失败: {resp.json()}')
```

### cURL

```bash
# 全量搜索（所有类型）
for type in documents cases demos learning; do
  echo "=== $type ==="
  curl -s "http://21.91.29.59:3000/api/public/$type?page_size=3" | python3 -m json.tool
done
```

---

*文档生成时间：2026-06-03 | ADP Toolkit 公开资源 API v1*
