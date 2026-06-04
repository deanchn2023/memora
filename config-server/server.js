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

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
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

// 获取当前用户的组织配置
app.get('/config', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT org_id FROM users WHERE id = ?').get(req.userId);
    if (!user || !user.org_id) {
      return res.status(404).json({ message: '未关联组织' });
    }

    const row = db.prepare('SELECT config, updated_at FROM org_configs WHERE org_id = ?').get(user.org_id);
    if (!row) {
      return res.json({ config: {}, updated_at: null });
    }

    res.json({
      ...JSON.parse(row.config),
      _meta: { updated_at: row.updated_at }
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

// ===== 管理员 API =====

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

function getDefaultConfig() {
  return {
    api: {
      api_key: 'sk-b4116cb788d64e3fb20e8e5bd1333168',
      base_url: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      daily_limit: 500
    },
    adp: {
      app_key: '',
      knowledge_app_key: '',
      search_app_key: '',
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

// ===== 启动 =====

initDefaultData();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Memora Config Server] Running on http://0.0.0.0:${PORT}`);
  console.log(`[Memora Config Server] API endpoints:`);
  console.log(`  POST /auth/login`);
  console.log(`  GET  /auth/validate`);
  console.log(`  GET  /config`);
  console.log(`  GET  /config/check`);
  console.log(`  POST /admin/orgs`);
  console.log(`  PUT  /admin/orgs/:orgId/config`);
  console.log(`  POST /admin/users`);
  console.log(`  GET  /admin/orgs`);
  console.log(`  GET  /admin/users`);
});
