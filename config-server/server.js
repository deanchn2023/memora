require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/', (req, res) => {
  res.json({ service: 'Memora Config Server', version: '1.0.0', status: 'running' });
});

// 管理后台页面
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 静态文件
app.use('/admin', express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3450;
const JWT_SECRET = process.env.JWT_SECRET || 'memora-config-secret-2026';
const DB_PATH = path.join(__dirname, 'data', 'memora-config.db');

// 确保数据目录存在
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// 初始化数据库
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS org_configs (
    org_id TEXT PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    config TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT DEFAULT '',
    role TEXT DEFAULT 'member',
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'system',
    priority TEXT NOT NULL DEFAULT 'normal',
    target_all INTEGER DEFAULT 0,
    target_organization TEXT DEFAULT '',
    target_user_id TEXT DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    is_active INTEGER DEFAULT 1,
    starts_at DATETIME,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS login_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    login_source TEXT NOT NULL,
    config_loaded INTEGER DEFAULT 0,
    app_version TEXT DEFAULT '',
    platform TEXT DEFAULT '',
    ip_address TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_versions (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'darwin',
    arch TEXT NOT NULL DEFAULT 'arm64',
    release_notes TEXT DEFAULT '',
    file_path TEXT NOT NULL DEFAULT '',
    file_size INTEGER DEFAULT 0,
    sha256 TEXT DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_active ON notifications(is_active);
  CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id);
  CREATE INDEX IF NOT EXISTS idx_login_activities_user ON login_activities(user_id);
  CREATE INDEX IF NOT EXISTS idx_app_versions_platform ON app_versions(platform, arch);
`);

// ===== 中间件 =====

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未登录' });
  }
  try {
    const decoded = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token 无效或已过期' });
  }
}

function adminMiddleware(req, res, next) {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: '需要管理员权限' });
  }
  next();
}

// ===== 工具函数（需在路由之前定义） =====

// 深度合并工具函数
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined && source[key] !== '') {
      result[key] = source[key];
    }
  }
  return result;
}

function getDefaultConfig() {
  return {
    api: {
      api_key: 'sk-b4116cb788d64e3fb20e8e5bd1333168',
      base_url: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      daily_limit: 500
    },
    adp: {
      app_key: 'EvcCHxUUzJxtLABspxBFjoVTpJOByUUYUgozjvursQwChNZqkEVGXrvGroXLNDTMSWKWabnkhGqjxIttpGLqPqqUefOIkPVQUEYyPTtHbbfoltrSajKxQnSjQDfFVcnm',
      knowledge_app_key: 'EvcCHxUUzJxtLABspxBFjoVTpJOByUUYUgozjvursQwChNZqkEVGXrvGroXLNDTMSWKWabnkhGqjxIttpGLqPqqUefOIkPVQUEYyPTtHbbfoltrSajKxQnSjQDfFVcnm',
      search_app_key: 'EvcCHxUUzJxtLABspxBFjoVTpJOByUUYUgozjvursQwChNZqkEVGXrvGroXLNDTMSWKWabnkhGqjxIttpGLqPqqUefOIkPVQUEYyPTtHbbfoltrSajKxQnSjQDfFVcnm',
      url: 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
      agent_name: '我的AI助手'
    },
    prompts: {
      ai_prompt: '',
      memory_prompt: '',
      clipboard_prompt: ''
    },
    policies: {
      lock_config: false,
      allow_local_override: true
    }
  };
}

// ===== 认证 API =====

// 登录
app.post('/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: '邮箱和密码不能为空' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ? AND status = ?').get(email, 'active');
    if (!user) {
      return res.status(401).json({ message: '邮箱或密码错误' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ message: '邮箱或密码错误' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    // 获取组织名称
    const org = db.prepare('SELECT name FROM orgs WHERE id = ?').get(user.org_id);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        org_id: user.org_id,
        org_name: org?.name || '',
        role: user.role
      }
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 验证 Token
app.get('/auth/validate', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, name, org_id, role, status FROM users WHERE id = ?').get(req.userId);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ message: '用户已禁用' });
    }
    const org = db.prepare('SELECT name FROM orgs WHERE id = ?').get(user.org_id);
    res.json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        org_id: user.org_id,
        org_name: org?.name || '',
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ===== 配置 API =====

// 获取当前用户的组织配置（与 /memora/config 逻辑对齐，合并默认配置）
app.get('/config', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT org_id FROM users WHERE id = ?').get(req.userId);
    if (!user || !user.org_id) {
      // 未关联组织，返回默认配置
      const defaultConfig = getDefaultConfig();
      return res.json({
        ...defaultConfig,
        _meta: { organization: '', updated_at: null, source: 'default' }
      });
    }

    const org = db.prepare('SELECT name FROM orgs WHERE id = ?').get(user.org_id);
    const orgName = org?.name || '';
    const defaultConfig = getDefaultConfig();

    const row = db.prepare('SELECT config, updated_at FROM org_configs WHERE org_id = ?').get(user.org_id);
    if (!row) {
      return res.json({
        ...defaultConfig,
        _meta: { organization: orgName, updated_at: null, source: 'default' }
      });
    }

    // 合并默认配置 + 组织配置（与 /memora/config 一致）
    const orgConfig = JSON.parse(row.config);
    const merged = deepMerge(defaultConfig, orgConfig);

    res.json({
      ...merged,
      _meta: { organization: orgName, updated_at: row.updated_at, source: 'org_config' }
    });
  } catch (err) {
    console.error('[Config] Get error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 检查配置是否更新（轻量）
app.get('/config/check', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT org_id FROM users WHERE id = ?').get(req.userId);
    if (!user || !user.org_id) {
      return res.status(404).json({ message: '未关联组织' });
    }

    const row = db.prepare('SELECT updated_at FROM org_configs WHERE org_id = ?').get(user.org_id);
    res.json({ updated_at: row?.updated_at || null });
  } catch (err) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ===== 客户端 API（/memora/） =====

// ADPToolkit Token 验证中间件（支持跨服务认证）
// 1. 先尝试本地 JWT 验证
// 2. 失败则解码 ADPToolkit JWT payload（内网互通，信任其 token 结构）
const ADP_AUTH_URL = 'http://21.91.29.59:3000/api/auth/me';

async function adpAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未登录' });
  }
  const token = authHeader.replace('Bearer ', '');

  // 1. 先尝试本地 JWT 验证
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.authSource = 'local';
    // 补充 orgName
    const user = db.prepare('SELECT org_id FROM users WHERE id = ?').get(req.userId);
    if (user?.org_id) {
      const org = db.prepare('SELECT name FROM orgs WHERE id = ?').get(user.org_id);
      req.orgName = org?.name || '';
    }
    return next();
  } catch (err) {
    // 本地验证失败，继续尝试 ADPToolkit 验证
  }

  // 2. 代理到 ADPToolkit 验证 token（优先远程验证）
  try {
    const adpRes = await fetch(ADP_AUTH_URL, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(3000) // 3秒超时
    });
    if (adpRes.ok) {
      const adpData = await adpRes.json();
      if (adpData.user) {
        req.userId = adpData.user.id;
        req.adpUser = adpData.user;
        req.authSource = 'adptoolkit';
        req.orgName = adpData.user.organization || '';
        return next();
      }
    }
  } catch (err) {
    // 远程验证失败（网络不可达等），降级到本地解码
  }

  // 3. 降级：解码 ADPToolkit JWT payload（不验证签名，信任内网环境）
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return res.status(401).json({ message: 'Token 无效或已过期' });
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    // 检查过期时间
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return res.status(401).json({ message: 'Token 无效或已过期' });
    }

    // 从 payload 提取用户信息
    req.userId = payload.sub || payload.userId || '';
    req.adpUser = {
      id: payload.sub || payload.userId || '',
      username: payload.username || '',
      name: payload.name || '',
      email: payload.email || '',
      role: payload.role || '',
      organization: payload.organization || ''
    };
    req.authSource = 'adptoolkit-decoded';
    req.orgName = payload.organization || '';

    if (!req.userId) {
      return res.status(401).json({ message: 'Token 无效或已过期' });
    }

    next();
  } catch (err) {
    console.error('[Auth] ADPToolkit token decode error:', err.message);
    return res.status(401).json({ message: 'Token 无效或已过期' });
  }
}

// /memora/config — 获取当前用户的组织配置（支持 ADPToolkit Token）
app.get('/memora/config', adpAuthMiddleware, async (req, res) => {
  try {
    let orgId = null;
    let orgName = '';

    if ((req.authSource === 'adptoolkit' || req.authSource === 'adptoolkit-decoded') && req.adpUser) {
      // ADPToolkit 用户：通过 organization 名称查找
      orgName = req.adpUser.organization || '';
      if (orgName) {
        const org = db.prepare('SELECT id FROM orgs WHERE name = ?').get(orgName);
        orgId = org?.id || null;
      }
    } else {
      // 本地用户：通过 userId 查 org_id
      const user = db.prepare('SELECT org_id FROM users WHERE id = ?').get(req.userId);
      orgId = user?.org_id || null;
      if (orgId) {
        const org = db.prepare('SELECT name FROM orgs WHERE id = ?').get(orgId);
        orgName = org?.name || '';
      }
    }

    // 无组织时返回默认配置
    const defaultConfig = getDefaultConfig();

    if (!orgId) {
      return res.json({
        ...defaultConfig,
        _meta: { organization: orgName, updated_at: null, source: 'default' }
      });
    }

    const row = db.prepare('SELECT config, updated_at FROM org_configs WHERE org_id = ?').get(orgId);
    if (!row) {
      return res.json({
        ...defaultConfig,
        _meta: { organization: orgName, updated_at: null, source: 'default' }
      });
    }

    // 合并默认配置 + 组织配置
    const orgConfig = JSON.parse(row.config);
    const merged = deepMerge(defaultConfig, orgConfig);

    res.json({
      ...merged,
      _meta: { organization: orgName, updated_at: row.updated_at, source: 'org_config' }
    });
  } catch (err) {
    console.error('[Memora Config] Get error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取当前用户的通知列表
app.get('/memora/notifications', adpAuthMiddleware, (req, res) => {
  try {
    // 统一使用 req.orgName（由 adpAuthMiddleware 注入）
    const orgName = req.orgName || '';

    const now = new Date().toISOString();

    // 获取匹配用户的通知：target_all=1 或 target_organization=用户组织 或 target_user_id=用户ID
    const notifications = db.prepare(`
      SELECT n.*,
        CASE WHEN nr.read_at IS NOT NULL THEN 1 ELSE 0 END as is_read
      FROM notifications n
      LEFT JOIN notification_reads nr ON n.id = nr.notification_id AND nr.user_id = ?
      WHERE n.is_active = 1
        AND (n.target_all = 1 OR n.target_organization = ? OR n.target_user_id = ?)
        AND (n.starts_at IS NULL OR n.starts_at <= ?)
        AND (n.expires_at IS NULL OR n.expires_at >= ?)
      ORDER BY
        CASE n.priority WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 ELSE 1 END DESC,
        n.created_at DESC
    `).all(req.userId, orgName, req.userId, now, now);

    // 计算未读数
    const unreadCount = notifications.filter(n => !n.is_read).length;

    // 格式化响应，对齐 API 文档
    const formatted = notifications.map(n => ({
      id: n.id,
      title: n.title,
      content: n.content,
      type: n.type,
      priority: n.priority,
      read: !!n.is_read,
      created_at: n.created_at,
      target_all: !!n.target_all,
      target_organization: n.target_organization || '',
      target_user_id: n.target_user_id || '',
      created_by: n.created_by || ''
    }));

    res.json({ notifications: formatted, unread_count: unreadCount });
  } catch (err) {
    console.error('[Notifications] Get error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 标记通知已读
app.put('/memora/notifications/:id/read', adpAuthMiddleware, (req, res) => {
  try {
    const notification = db.prepare('SELECT id FROM notifications WHERE id = ?').get(req.params.id);
    if (!notification) return res.status(404).json({ message: '通知不存在' });

    db.prepare('INSERT OR IGNORE INTO notification_reads (notification_id, user_id) VALUES (?, ?)')
      .run(req.params.id, req.userId);

    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Read error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 标记所有通知已读
app.put('/memora/notifications/read-all', adpAuthMiddleware, (req, res) => {
  try {
    const now = new Date().toISOString();
    const orgName = req.orgName || '';

    const notifications = db.prepare(`
      SELECT id FROM notifications
      WHERE is_active = 1 AND (target_all = 1 OR target_organization = ? OR target_user_id = ?)
        AND (starts_at IS NULL OR starts_at <= ?)
        AND (expires_at IS NULL OR expires_at >= ?)
    `).all(orgName, req.userId, now, now);

    const insertStmt = db.prepare('INSERT OR IGNORE INTO notification_reads (notification_id, user_id) VALUES (?, ?)');
    const insertMany = db.transaction((ids) => {
      for (const n of ids) insertStmt.run(n.id, req.userId);
    });
    insertMany(notifications);

    res.json({ success: true, count: notifications.length });
  } catch (err) {
    console.error('[Notifications] Read-all error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取未读通知数量
app.get('/memora/notifications/unread-count', adpAuthMiddleware, (req, res) => {
  try {
    const now = new Date().toISOString();
    const orgName = req.orgName || '';

    const row = db.prepare(`
      SELECT COUNT(*) as count
      FROM notifications n
      LEFT JOIN notification_reads nr ON n.id = nr.notification_id AND nr.user_id = ?
      WHERE n.is_active = 1
        AND (n.target_all = 1 OR n.target_organization = ? OR n.target_user_id = ?)
        AND (n.starts_at IS NULL OR n.starts_at <= ?)
        AND (n.expires_at IS NULL OR n.expires_at >= ?)
        AND nr.read_at IS NULL
    `).get(req.userId, orgName, req.userId, now, now);

    res.json({ unread_count: row?.count || 0 });
  } catch (err) {
    console.error('[Notifications] Unread count error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 登录活动上报
app.post('/memora/activity/login', adpAuthMiddleware, (req, res) => {
  try {
    const { login_source, config_loaded, app_version, platform } = req.body;
    if (!login_source) return res.status(400).json({ message: 'login_source 必填' });

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

    db.prepare(`
      INSERT INTO login_activities (user_id, login_source, config_loaded, app_version, platform, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.userId, login_source, config_loaded ? 1 : 0, app_version || '', platform || '', ip);

    res.json({ success: true });
  } catch (err) {
    console.error('[Activity] Login report error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 登出活动上报
app.post('/memora/activity/logout', adpAuthMiddleware, (req, res) => {
  try {
    const { login_source, app_version, platform } = req.body;

    // 记录登出（复用 login_activities 表，login_source 标记为 logout）
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

    db.prepare(`
      INSERT INTO login_activities (user_id, login_source, config_loaded, app_version, platform, ip_address)
      VALUES (?, ?, 0, ?, ?, ?)
    `).run(req.userId, `logout_${login_source || 'unknown'}`, app_version || '', platform || '', ip);

    res.json({ success: true });
  } catch (err) {
    console.error('[Activity] Logout report error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// ===== 版本更新 API =====

const multer = require('multer');
const crypto = require('crypto');

// 确保更新文件目录存在
const updatesDir = path.join(__dirname, 'data', 'memora-updates');
if (!fs.existsSync(updatesDir)) fs.mkdirSync(updatesDir, { recursive: true });

const upload = multer({
  dest: updatesDir,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

// 语义化版本比较
function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// 检查更新（公开接口，无需登录）
app.get('/memora/updates/check', (req, res) => {
  try {
    const { version, platform = 'darwin', arch = 'arm64' } = req.query;
    if (!version) return res.status(400).json({ message: 'version 参数必填' });

    // 查找该平台架构的最新版本
    const latest = db.prepare(`
      SELECT * FROM app_versions
      WHERE platform = ? AND arch = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(platform, arch);

    if (!latest || compareVersions(latest.version, version) <= 0) {
      return res.json({ has_update: false });
    }

    // 检查文件是否存在
    const fileExists = latest.file_path && fs.existsSync(latest.file_path);

    res.json({
      has_update: true,
      latest_version: latest.version,
      release_notes: latest.release_notes || '',
      download_url: fileExists ? `/memora/updates/download/${path.basename(latest.file_path)}` : '',
      file_size: latest.file_size || 0,
      sha256: latest.sha256 || '',
      released_at: latest.created_at,
      install_guide: platform === 'darwin'
        ? '下载完成后双击 DMG 文件，将 Memora 拖入应用程序文件夹即可'
        : platform === 'win32'
        ? '下载完成后双击 EXE 文件按提示安装即可'
        : '下载完成后赋予执行权限并运行即可'
    });
  } catch (err) {
    console.error('[Updates] Check error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 下载更新文件（公开接口）
app.get('/memora/updates/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    // 安全检查：禁止路径穿越
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ message: '非法文件名' });
    }

    const filePath = path.join(updatesDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: '文件不存在' });
    }

    res.download(filePath, filename);
  } catch (err) {
    console.error('[Updates] Download error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 管理员：上传新版本
app.post('/memora/admin/updates/upload', authMiddleware, adminMiddleware, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: '请上传文件' });
    const { version, platform = 'darwin', arch = 'arm64', release_notes = '' } = req.body;
    if (!version) return res.status(400).json({ message: 'version 参数必填' });

    const id = 'ver-' + uuidv4().replace(/-/g, '').substring(0, 10);

    // 计算文件 SHA256
    const fileBuffer = fs.readFileSync(req.file.path);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 重命名为有意义的文件名
    const ext = path.extname(req.file.originalname) || (platform === 'win32' ? '.exe' : platform === 'linux' ? '.AppImage' : '.dmg');
    const newFilename = `Memora-${version}-${platform}-${arch}${ext}`;
    const newPath = path.join(updatesDir, newFilename);
    fs.renameSync(req.file.path, newPath);

    db.prepare(`
      INSERT INTO app_versions (id, version, platform, arch, release_notes, file_path, file_size, sha256, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, version, platform, arch, release_notes, newPath, req.file.size, sha256, req.userId);

    res.json({ success: true, id, sha256 });
  } catch (err) {
    console.error('[Admin] Upload version error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 管理员：获取版本列表
app.get('/memora/admin/versions', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const versions = db.prepare('SELECT * FROM app_versions ORDER BY created_at DESC').all();
    const formatted = versions.map(v => ({
      ...v,
      file_size_formatted: v.file_size ? (v.file_size / (1024 * 1024)).toFixed(1) + ' MB' : '0 MB',
      file_exists: v.file_path && fs.existsSync(v.file_path)
    }));
    res.json(formatted);
  } catch (err) {
    console.error('[Admin] Get versions error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 管理员：删除版本
app.delete('/memora/admin/versions/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const version = db.prepare('SELECT * FROM app_versions WHERE id = ?').get(req.params.id);
    if (!version) return res.status(404).json({ message: '版本不存在' });

    // 删除物理文件
    if (version.file_path && fs.existsSync(version.file_path)) {
      fs.unlinkSync(version.file_path);
    }

    db.prepare('DELETE FROM app_versions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Delete version error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// ===== 通知实时推送（SSE） =====

// SSE 连接管理配置
const SSE_CONFIG = {
  MAX_CONNECTIONS: 500,         // 最大同时连接数
  MAX_PER_USER: 3,             // 每用户最大连接数（防多标签页重复）
  HEARTBEAT_INTERVAL: 30000,   // 心跳间隔 30s
  IDLE_TIMEOUT: 120000,        // 空闲超时 2 分钟（无心跳响应）
  CLEANUP_INTERVAL: 60000,     // 清理间隔 1 分钟
};

// SSE 客户端连接管理
const sseClients = new Map(); // clientId -> { res, userId, orgName, connectedAt, lastActive }

// 心跳定时器
let sseHeartbeatTimer = null;
let sseCleanupTimer = null;

function startSSEHeartbeat() {
  if (sseHeartbeatTimer) return;
  sseHeartbeatTimer = setInterval(() => {
    for (const [clientId, client] of sseClients) {
      try {
        client.res.write(': heartbeat\n\n');
        client.lastActive = Date.now();
      } catch (err) {
        sseClients.delete(clientId);
      }
    }
  }, SSE_CONFIG.HEARTBEAT_INTERVAL);

  // 定期清理僵尸连接和超时连接
  sseCleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [clientId, client] of sseClients) {
      if (now - client.lastActive > SSE_CONFIG.IDLE_TIMEOUT) {
        try { client.res.end(); } catch (e) {}
        sseClients.delete(clientId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[SSE] Cleaned ${cleaned} idle connections, active: ${sseClients.size}`);
    }
  }, SSE_CONFIG.CLEANUP_INTERVAL);
}

// 获取某用户当前连接数
function getUserConnectionCount(userId) {
  let count = 0;
  for (const [, client] of sseClients) {
    if (client.userId === userId) count++;
  }
  return count;
}

// 移除某用户最早的连接（为新连接腾位置）
function removeOldestUserConnection(userId) {
  let oldestId = null;
  let oldestTime = Infinity;
  for (const [clientId, client] of sseClients) {
    if (client.userId === userId && client.connectedAt < oldestTime) {
      oldestTime = client.connectedAt;
      oldestId = clientId;
    }
  }
  if (oldestId) {
    const client = sseClients.get(oldestId);
    try { client.res.end(); } catch (e) {}
    sseClients.delete(oldestId);
  }
}

// 向匹配的 SSE 客户端广播通知（按目标分组，避免全量遍历）
function broadcastNotification(notification) {
  let sentCount = 0;
  const deadClients = [];

  for (const [clientId, client] of sseClients) {
    // 匹配逻辑：target_all / target_organization / target_user_id
    const matchAll = notification.target_all;
    const matchOrg = notification.target_organization && client.orgName === notification.target_organization;
    const matchUser = notification.target_user_id && client.userId === notification.target_user_id;
    if (matchAll || matchOrg || matchUser) {
      try {
        client.res.write(`event: notification\ndata: ${JSON.stringify(notification)}\n\n`);
        sentCount++;
      } catch (err) {
        deadClients.push(clientId);
      }
    }
  }
  // 批量清理死连接
  deadClients.forEach(id => sseClients.delete(id));
  console.log(`[SSE] Broadcast to ${sentCount} clients (${sseClients.size} total active)`);
}

// SSE 端点：客户端订阅实时通知
app.get('/memora/notifications/stream', adpAuthMiddleware, (req, res) => {
  // 连接数上限检查
  if (sseClients.size >= SSE_CONFIG.MAX_CONNECTIONS) {
    res.status(503).json({ message: '连接数已达上限，请稍后重试' });
    return;
  }

  // 每用户连接数限制
  const userConns = getUserConnectionCount(req.userId);
  if (userConns >= SSE_CONFIG.MAX_PER_USER) {
    removeOldestUserConnection(req.userId);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const clientId = `${req.userId}-${Date.now()}`;
  const orgName = req.orgName || '';
  const now = Date.now();

  sseClients.set(clientId, { res, userId: req.userId, orgName, connectedAt: now, lastActive: now });
  console.log(`[SSE] Client connected: ${clientId} (org: ${orgName}, total: ${sseClients.size})`);

  startSSEHeartbeat();

  // 发送连接成功事件
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

  // 客户端断开
  req.on('close', () => {
    sseClients.delete(clientId);
    console.log(`[SSE] Client disconnected: ${clientId} (total: ${sseClients.size})`);
  });
});

// SSE 连接统计 API（管理员可用）
app.get('/memora/admin/sse-stats', authMiddleware, adminMiddleware, (req, res) => {
  const userMap = new Map();
  for (const [, client] of sseClients) {
    userMap.set(client.userId, (userMap.get(client.userId) || 0) + 1);
  }
  res.json({
    total_connections: sseClients.size,
    unique_users: userMap.size,
    max_connections: SSE_CONFIG.MAX_CONNECTIONS,
    max_per_user: SSE_CONFIG.MAX_PER_USER,
    top_users: [...userMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, count]) => ({ userId, connections: count }))
  });
});

// ===== 管理员 API =====

// 创建通知
app.post('/memora/admin/notifications', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { title, content, type, priority, target_all, target_organization, target_user_id } = req.body;
    if (!title) return res.status(400).json({ message: '通知标题不能为空' });

    const id = 'n-' + uuidv4().replace(/-/g, '').substring(0, 12);

    const validTypes = ['system', 'update', 'feature', 'warning'];
    const validPriorities = ['normal', 'high', 'urgent'];

    db.prepare(`
      INSERT INTO notifications (id, title, content, type, priority, target_all, target_organization, target_user_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, title, content || '',
      validTypes.includes(type) ? type : 'system',
      validPriorities.includes(priority) ? priority : 'normal',
      target_all ? 1 : 0,
      target_organization || '',
      target_user_id || '',
      req.userId
    );

    // 实时推送给 SSE 客户端
    broadcastNotification({
      id, title, content: content || '',
      type: validTypes.includes(type) ? type : 'system',
      priority: validPriorities.includes(priority) ? priority : 'normal',
      read: false,
      target_all: !!target_all,
      target_organization: target_organization || '',
      target_user_id: target_user_id || '',
      created_at: new Date().toISOString()
    });

    res.json({ success: true, id });
  } catch (err) {
    console.error('[Admin] Create notification error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 更新通知
app.put('/memora/admin/notifications/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const notification = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
    if (!notification) return res.status(404).json({ message: '通知不存在' });

    const { title, content, type, priority, target_all, target_organization, target_user_id, is_active, starts_at, expires_at } = req.body;
    const updates = [];
    const values = [];

    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (content !== undefined) { updates.push('content = ?'); values.push(content); }
    if (type !== undefined) { updates.push('type = ?'); values.push(type); }
    if (priority !== undefined) { updates.push('priority = ?'); values.push(priority); }
    if (target_all !== undefined) { updates.push('target_all = ?'); values.push(target_all ? 1 : 0); }
    if (target_organization !== undefined) { updates.push('target_organization = ?'); values.push(target_organization); }
    if (target_user_id !== undefined) { updates.push('target_user_id = ?'); values.push(target_user_id); }
    if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active ? 1 : 0); }
    if (starts_at !== undefined) { updates.push('starts_at = ?'); values.push(starts_at); }
    if (expires_at !== undefined) { updates.push('expires_at = ?'); values.push(expires_at); }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(req.params.id);
      db.prepare(`UPDATE notifications SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Update notification error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除通知
app.delete('/memora/admin/notifications/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Delete notification error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取所有通知（管理员）
app.get('/memora/admin/notifications', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { type, page = 1, page_size = 50 } = req.query;
    let notifications;
    if (type) {
      notifications = db.prepare('SELECT * FROM notifications WHERE type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(type, parseInt(page_size), (parseInt(page) - 1) * parseInt(page_size));
    } else {
      notifications = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ? OFFSET ?').all(parseInt(page_size), (parseInt(page) - 1) * parseInt(page_size));
    }
    res.json(notifications);
  } catch (err) {
    console.error('[Admin] Get notifications error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取登录活动（管理员）
app.get('/admin/activities', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { login_source, limit = 100 } = req.query;
    let activities;
    if (login_source) {
      activities = db.prepare(`
        SELECT la.*, u.email, u.name as user_name
        FROM login_activities la
        LEFT JOIN users u ON la.user_id = u.id
        WHERE la.login_source = ?
        ORDER BY la.created_at DESC
        LIMIT ?
      `).all(login_source, parseInt(limit));
    } else {
      activities = db.prepare(`
        SELECT la.*, u.email, u.name as user_name
        FROM login_activities la
        LEFT JOIN users u ON la.user_id = u.id
        ORDER BY la.created_at DESC
        LIMIT ?
      `).all(parseInt(limit));
    }
    res.json(activities);
  } catch (err) {
    console.error('[Admin] Get activities error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// ===== 原有管理员 API =====

// 创建组织
app.post('/admin/orgs', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: '组织名称不能为空' });

    const id = uuidv4();
    const code = 'MEMORA-' + Array.from({ length: 8 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('').match(/.{1,4}/g).join('-');

    db.prepare('INSERT INTO orgs (id, name, code) VALUES (?, ?, ?)').run(id, name, code);

    // 创建默认配置
    const defaultConfig = JSON.stringify(getDefaultConfig());
    db.prepare('INSERT INTO org_configs (org_id, config) VALUES (?, ?)').run(id, defaultConfig);

    res.json({ id, name, code });
  } catch (err) {
    console.error('[Admin] Create org error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 更新组织配置
app.put('/admin/orgs/:orgId/config', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { orgId } = req.params;
    const config = req.body;

    const org = db.prepare('SELECT id FROM orgs WHERE id = ?').get(orgId);
    if (!org) return res.status(404).json({ message: '组织不存在' });

    // 合并配置
    const existing = db.prepare('SELECT config FROM org_configs WHERE org_id = ?').get(orgId);
    const merged = existing ? { ...JSON.parse(existing.config), ...config } : config;

    db.prepare('INSERT OR REPLACE INTO org_configs (org_id, config, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(orgId, JSON.stringify(merged, null, 2));

    res.json({ success: true, config: merged });
  } catch (err) {
    console.error('[Admin] Update config error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 创建用户
app.post('/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { email, password, name, org_id, role } = req.body;
    if (!email || !password) return res.status(400).json({ message: '邮箱和密码不能为空' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ message: '邮箱已存在' });

    const id = uuidv4();
    const hashedPassword = bcrypt.hashSync(password, 10);

    db.prepare('INSERT INTO users (id, org_id, email, password, name, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, org_id || null, email, hashedPassword, name || '', role || 'member');

    res.json({ id, email, name, org_id, role: role || 'member' });
  } catch (err) {
    console.error('[Admin] Create user error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取组织信息
app.get('/admin/orgs/:orgId', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const org = db.prepare('SELECT * FROM orgs WHERE id = ?').get(req.params.orgId);
    if (!org) return res.status(404).json({ message: '组织不存在' });

    const configRow = db.prepare('SELECT config, updated_at FROM org_configs WHERE org_id = ?').get(org.id);
    const members = db.prepare('SELECT id, email, name, role, status, created_at FROM users WHERE org_id = ?').all(org.id);

    res.json({
      ...org,
      config: configRow ? JSON.parse(configRow.config) : {},
      config_updated_at: configRow?.updated_at,
      members
    });
  } catch (err) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取所有组织
app.get('/admin/orgs', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const orgs = db.prepare('SELECT * FROM orgs ORDER BY created_at DESC').all();
    res.json(orgs);
  } catch (err) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取所有用户
app.get('/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.status, u.created_at, o.name as org_name
      FROM users u LEFT JOIN orgs o ON u.org_id = o.id
      ORDER BY u.created_at DESC
    `).all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 更新用户
app.put('/admin/users/:userId', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { name, role, status, org_id, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
    if (!user) return res.status(404).json({ message: '用户不存在' });

    const updates = [];
    const values = [];
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (role !== undefined) { updates.push('role = ?'); values.push(role); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (org_id !== undefined) { updates.push('org_id = ?'); values.push(org_id); }
    if (password) { updates.push('password = ?'); values.push(bcrypt.hashSync(password, 10)); }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(req.params.userId);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 初始化默认管理员（首次启动时）
function initDefaultData() {
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
  if (adminCount.count === 0) {
    console.log('[Init] Creating default admin user and org...');

    const orgId = uuidv4();
    const defaultCode = 'MEMORA-' + Array.from({ length: 8 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('').match(/.{1,4}/g).join('-');

    db.prepare('INSERT INTO orgs (id, name, code) VALUES (?, ?, ?)').run(orgId, '默认组织', defaultCode);

    // 写入默认配置
    const defaultConfig = JSON.stringify(getDefaultConfig(), null, 2);
    db.prepare('INSERT INTO org_configs (org_id, config) VALUES (?, ?)').run(orgId, defaultConfig);

    const adminId = uuidv4();
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (id, org_id, email, password, name, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run(adminId, orgId, 'admin@memora.com', hashedPassword, '管理员', 'admin');

    console.log('[Init] Default org created:', defaultCode);
    console.log('[Init] Default admin: admin@memora.com / admin123');
    console.log('[Init] ⚠️  请登录后立即修改默认密码！');
  }
}

// ===== 启动 =====

initDefaultData();

// ===== 数据库迁移 =====
function runMigrations() {
  try {
    // 检查 notifications 表是否需要迁移（旧表有 org_id 和 is_global，新表有 target_all/target_organization/target_user_id/created_by）
    const columns = db.prepare("PRAGMA table_info(notifications)").all();
    const columnNames = columns.map(c => c.name);

    if (columnNames.includes('org_id') && !columnNames.includes('target_all')) {
      console.log('[Migration] Migrating notifications table...');
      // 备份旧数据
      const oldNotifs = db.prepare('SELECT * FROM notifications').all();
      const oldReads = db.prepare('SELECT * FROM notification_reads').all();

      // 删除旧表
      db.exec('DROP TABLE IF EXISTS notification_reads');
      db.exec('DROP TABLE IF EXISTS notifications');

      // 创建新表
      db.exec(`
        CREATE TABLE notifications (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL DEFAULT 'system',
          priority TEXT NOT NULL DEFAULT 'normal',
          target_all INTEGER DEFAULT 0,
          target_organization TEXT DEFAULT '',
          target_user_id TEXT DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          is_active INTEGER DEFAULT 1,
          starts_at DATETIME,
          expires_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE notification_reads (
          notification_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (notification_id, user_id)
        );
      `);

      // 迁移数据
      const insertNotif = db.prepare(`
        INSERT INTO notifications (id, title, content, type, priority, target_all, target_organization, created_by, is_active, starts_at, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const priorityMap = { 0: 'normal', 1: 'high', 2: 'urgent' };

      for (const n of oldNotifs) {
        insertNotif.run(
          n.id, n.title, n.content,
          n.type === 'info' ? 'system' : (n.type || 'system'),
          priorityMap[n.priority] || 'normal',
          n.is_global ? 1 : 0,
          '', // target_organization
          '', // target_user_id
          '', // created_by
          n.is_active || 1,
          n.starts_at, n.expires_at,
          n.created_at, n.updated_at
        );
      }

      // 恢复已读记录
      const insertRead = db.prepare('INSERT OR IGNORE INTO notification_reads (notification_id, user_id, read_at) VALUES (?, ?, ?)');
      for (const r of oldReads) {
        insertRead.run(r.notification_id, r.user_id, r.read_at);
      }

      console.log(`[Migration] Migrated ${oldNotifs.length} notifications and ${oldReads.length} read records`);
    }

    // 创建缺失的索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notifications_active ON notifications(is_active);
      CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id);
    `);

    console.log('[Migration] Database migrations completed');
  } catch (err) {
    console.error('[Migration] Error:', err);
  }
}

runMigrations();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Memora Config Server] Running on http://0.0.0.0:${PORT}`);
  console.log(`[Memora Config Server] API endpoints:`);
  console.log(`  POST /auth/login`);
  console.log(`  GET  /auth/validate`);
  console.log(`  GET  /config`);
  console.log(`  GET  /config/check`);
  console.log(`  GET  /memora/notifications`);
  console.log(`  PUT  /memora/notifications/:id/read`);
  console.log(`  PUT  /memora/notifications/read-all`);
  console.log(`  GET  /memora/notifications/unread-count`);
  console.log(`  GET  /memora/notifications/stream  (SSE实时推送)`);
  console.log(`  POST /memora/activity/login`);
  console.log(`  POST /memora/activity/logout`);
  console.log(`  GET  /memora/updates/check`);
  console.log(`  GET  /memora/updates/download/:filename`);
  console.log(`  POST /memora/admin/notifications`);
  console.log(`  GET  /memora/admin/notifications`);
  console.log(`  PUT  /memora/admin/notifications/:id`);
  console.log(`  DELETE /memora/admin/notifications/:id`);
  console.log(`  POST /memora/admin/updates/upload`);
  console.log(`  GET  /memora/admin/versions`);
  console.log(`  DELETE /memora/admin/versions/:id`);
  console.log(`  POST /admin/orgs`);
  console.log(`  PUT  /admin/orgs/:orgId/config`);
  console.log(`  POST /admin/users`);
  console.log(`  GET  /admin/orgs`);
  console.log(`  GET  /admin/users`);
  console.log(`  GET  /admin/activities`);
});
