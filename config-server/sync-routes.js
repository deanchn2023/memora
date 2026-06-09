/**
 * Memora 数据同步 API 路由 v3
 * 基于 revision 乐观锁的增量双向同步
 * 
 * 核心：设备注册、push/pull/full sync、冲突解决、权限矩阵、幂等性、审计
 */

const { v4: uuidv4 } = require('uuid');

// ===== 权限矩阵 =====
const PLATFORM_CAPABILITIES = {
  electron: {
    tasks: { read: true, write: true, own: true },
    notes: { read: true, write: true, own: true },
    knowledge_nodes: { read: true, write: true, own: true },
    knowledge_edges: { read: true, write: true, own: true },
    clipboard_memories: { read: true, write: true, own: true },
    profile: { read: true, write: true }
  },
  flutter: {
    tasks: { read: true, write: true, own: true },
    notes: { read: true, write: true, own: true },
    knowledge_nodes: { read: true, write: false, own: false },
    knowledge_edges: { read: true, write: false, own: false },
    clipboard_memories: { read: true, write: false, own: false },
    profile: { read: true, write: true }
  },
  miniprogram: {
    tasks: { read: true, write: true, own: true },
    notes: { read: true, write: false, own: false },
    knowledge_nodes: { read: true, write: false, own: false },
    knowledge_edges: { read: true, write: false, own: false },
    clipboard_memories: { read: false, write: false, own: false },
    profile: { read: true, write: false }
  },
  web: {
    tasks: { read: true, write: false, own: false },
    notes: { read: true, write: false, own: false },
    knowledge_nodes: { read: true, write: false, own: false },
    knowledge_edges: { read: true, write: false, own: false },
    clipboard_memories: { read: true, write: false, own: false },
    profile: { read: true, write: false }
  }
};

// 数据类型对应的表名
const DATA_TYPE_TABLES = {
  tasks: 'user_tasks',
  notes: 'user_notes',
  knowledge_nodes: 'knowledge_nodes',
  knowledge_edges: 'knowledge_edges',
  clipboard_memories: 'clipboard_memories'
};

// 数据类型字段定义（push 时允许写入的字段）
const DATA_TYPE_FIELDS = {
  tasks: ['title', 'description', 'status', 'priority', 'due_date', 'source', 'raw_text',
    'estimated_duration', 'actual_duration', 'pomodoro_sessions', 'reminders',
    'calendar_event_id', 'completed_at', 'extra', 'deleted_at'],
  notes: ['title', 'content', 'category', 'tags', 'color', 'pinned', 'deleted_at'],
  knowledge_nodes: ['name', 'type', 'domain', 'health', 'extra', 'deleted_at'],
  knowledge_edges: ['source_id', 'target_id', 'type', 'weight', 'extra', 'deleted_at'],
  clipboard_memories: ['content', 'memory_type', 'business_category', 'confidence', 'source', 'deleted_at']
};

// 设备注册字段校验
const DEVICE_ID_REGEX = /^[a-zA-Z0-9_-]{2,64}$/;

module.exports = function(db) {

  // ===== 初始化同步相关数据表 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS registered_devices (
      device_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT '',
      device_name TEXT DEFAULT '',
      app_version TEXT DEFAULT '',
      capabilities TEXT DEFAULT '{}',
      last_active_at TEXT DEFAULT (datetime('now')),
      registered_at TEXT DEFAULT (datetime('now')),
      deactivated_at TEXT,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS device_sync_cursors (
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      data_type TEXT NOT NULL,
      last_sync_revision INTEGER DEFAULT 0,
      last_sync_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, device_id, data_type)
    );

    CREATE TABLE IF NOT EXISTS user_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL DEFAULT '',
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      due_date TEXT,
      source TEXT DEFAULT 'manual',
      raw_text TEXT DEFAULT '',
      estimated_duration INTEGER DEFAULT 60,
      actual_duration INTEGER DEFAULT 0,
      pomodoro_sessions TEXT DEFAULT '[]',
      reminders TEXT DEFAULT '[]',
      calendar_event_id TEXT,
      completed_at TEXT,
      extra TEXT DEFAULT '{}',
      origin_device_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL DEFAULT '',
      content TEXT DEFAULT '',
      category TEXT DEFAULT 'default',
      tags TEXT DEFAULT '[]',
      color TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0,
      origin_device_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL DEFAULT '',
      type TEXT DEFAULT 'concept',
      domain TEXT DEFAULT '',
      health TEXT DEFAULT 'unknown',
      extra TEXT DEFAULT '{}',
      origin_device_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT DEFAULT 'related',
      weight REAL DEFAULT 1.0,
      extra TEXT DEFAULT '{}',
      origin_device_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS clipboard_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      content TEXT DEFAULT '',
      memory_type TEXT DEFAULT 'instant',
      business_category TEXT DEFAULT '',
      confidence REAL DEFAULT 0.5,
      source TEXT DEFAULT 'clipboard',
      origin_device_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      data_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'update',
      base_revision INTEGER DEFAULT 0,
      new_revision INTEGER DEFAULT 1,
      request_id TEXT DEFAULT '',
      delta TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS idempotent_requests (
      request_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      response_data TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      platform TEXT DEFAULT '',
      request_id TEXT DEFAULT '',
      last_sync_at TEXT DEFAULT (datetime('now')),
      pushed_count INTEGER DEFAULT 0,
      pulled_count INTEGER DEFAULT 0,
      conflict_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      user_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 1,
      data TEXT DEFAULT '{}',
      origin_device_id TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_devices_user ON registered_devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON user_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_rev ON user_tasks(user_id, revision);
    CREATE INDEX IF NOT EXISTS idx_notes_user ON user_notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_knodes_user ON knowledge_nodes(user_id);
    CREATE INDEX IF NOT EXISTS idx_kedges_user ON knowledge_edges(user_id);
    CREATE INDEX IF NOT EXISTS idx_clipboard_user ON clipboard_memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_sync_ops_user ON sync_operations(user_id);
    CREATE INDEX IF NOT EXISTS idx_sync_ops_record ON sync_operations(data_type, record_id);
    CREATE INDEX IF NOT EXISTS idx_idempotent_expires ON idempotent_requests(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sync_logs_user ON sync_logs(user_id);
  `);

  // ===== 幂等性检查 =====
  function checkIdempotency(requestId, userId) {
    if (!requestId) return null;
    const cached = db.prepare(
      'SELECT response_data FROM idempotent_requests WHERE request_id = ? AND user_id = ?'
    ).get(requestId, userId);
    if (cached) {
      try { return JSON.parse(cached.response_data); } catch { return null; }
    }
    return null;
  }

  function saveIdempotentResponse(requestId, userId, deviceId, responseData) {
    if (!requestId) return;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT OR REPLACE INTO idempotent_requests (request_id, user_id, device_id, response_data, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(requestId, userId, deviceId, JSON.stringify(responseData), expiresAt);
  }

  // 清理过期的幂等性缓存（每小时调用一次）
  function cleanExpiredIdempotentRequests() {
    const now = new Date().toISOString();
    const result = db.prepare('DELETE FROM idempotent_requests WHERE expires_at < ?').run(now);
    if (result.changes > 0) {
      console.log('[Sync] Cleaned', result.changes, 'expired idempotent requests');
    }
  }

  // 每小时清理一次
  setInterval(cleanExpiredIdempotentRequests, 60 * 60 * 1000);

  // ===== 设备验证 =====
  function verifyDevice(userId, deviceId) {
    const device = db.prepare(
      'SELECT * FROM registered_devices WHERE device_id = ? AND user_id = ?'
    ).get(deviceId, userId);
    if (!device) return { valid: false, error: 'Device not registered' };
    if (device.status !== 'active') return { valid: false, error: 'DEVICE_DEACTIVATED', code: 403 };
    // 更新最后活跃时间
    db.prepare(
      "UPDATE registered_devices SET last_active_at = datetime('now') WHERE device_id = ?"
    ).run(deviceId);
    return { valid: true, device };
  }

  // ===== 权限检查 =====
  function checkPermission(platform, dataType, operation) {
    const caps = PLATFORM_CAPABILITIES[platform] || PLATFORM_CAPABILITIES.web;
    const perm = caps[dataType];
    if (!perm) return false;
    return perm[operation] === true;
  }

  // ===== 核心 Push 逻辑 =====
  function processPush(userId, deviceId, platform, changes, requestId) {
    const pushed = {};
    const conflicts = [];
    const permissionDenied = [];

    for (const [dataType, records] of Object.entries(changes || {})) {
      if (!Array.isArray(records) || records.length === 0) continue;

      const tableName = DATA_TYPE_TABLES[dataType];
      if (!tableName) continue;

      // 权限检查：write
      if (!checkPermission(platform, dataType, 'write')) {
        permissionDenied.push({ type: dataType, reason: 'write_not_allowed', platform });
        continue;
      }

      let pushCount = 0;

      for (const record of records) {
        if (!record.id) continue;

        const baseRevision = record.base_revision || 0;
        const isDelete = !!record.deleted_at;
        const now = new Date().toISOString();

        // 查询服务端当前版本
        const existing = db.prepare(`SELECT * FROM ${tableName} WHERE id = ? AND user_id = ?`).get(record.id, userId);

        if (!existing) {
          // 新记录：base_revision 应为 0
          if (baseRevision > 0) {
            // 客户端以为存在，但服务端没有 → 可能被清过，仍然创建
          }

          const fields = ['id', 'user_id', 'revision', 'origin_device_id', 'created_at', 'updated_at'];
          const values = [record.id, userId, 1, deviceId, now, now];

          for (const field of (DATA_TYPE_FIELDS[dataType] || [])) {
            if (record[field] !== undefined) {
              fields.push(field);
              values.push(typeof record[field] === 'object' ? JSON.stringify(record[field]) : record[field]);
            }
          }

          // 删除标记
          if (isDelete) {
            fields.push('deleted_at');
            values.push(record.deleted_at);
          }

          const placeholders = fields.map(() => '?').join(', ');
          db.prepare(`INSERT OR IGNORE INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`).run(...values);
          pushCount++;

          // 审计
          db.prepare(
            'INSERT INTO sync_operations (user_id, device_id, data_type, record_id, operation, base_revision, new_revision, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(userId, deviceId, dataType, record.id, isDelete ? 'delete' : 'insert', 0, 1, requestId || '');

        } else {
          // 已有记录：检查 revision 冲突
          if (baseRevision > 0 && existing.revision > baseRevision) {
            // 冲突：服务端版本更新
            conflicts.push({
              type: dataType,
              id: record.id,
              reason: 'revision_mismatch',
              server_revision: existing.revision,
              client_base_revision: baseRevision,
              server_version: existing,
              client_version: record
            });

            // 审计冲突
            db.prepare(
              'INSERT INTO sync_operations (user_id, device_id, data_type, record_id, operation, base_revision, new_revision, request_id, delta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(userId, deviceId, dataType, record.id, 'conflict', baseRevision, existing.revision, requestId || '', JSON.stringify({ client_data: record }));
            continue;
          }

          // 无冲突，更新
          const newRevision = existing.revision + 1;
          const setClauses = ['revision = ?', 'origin_device_id = ?', 'updated_at = ?'];
          const values = [newRevision, deviceId, now];

          for (const field of (DATA_TYPE_FIELDS[dataType] || [])) {
            if (record[field] !== undefined) {
              setClauses.push(`${field} = ?`);
              values.push(typeof record[field] === 'object' ? JSON.stringify(record[field]) : record[field]);
            }
          }

          values.push(record.id, userId);
          db.prepare(`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
          pushCount++;

          // 审计
          db.prepare(
            'INSERT INTO sync_operations (user_id, device_id, data_type, record_id, operation, base_revision, new_revision, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(userId, deviceId, dataType, record.id, isDelete ? 'delete' : 'update', baseRevision, newRevision, requestId || '');
        }
      }

      pushed[dataType] = pushCount;
    }

    return { pushed, conflicts, permissionDenied };
  }

  // ===== 核心 Pull 逻辑 =====
  function processPull(userId, deviceId, platform, since, dataTypes) {
    const pulled = {};
    const effectiveTypes = dataTypes && dataTypes.length > 0
      ? dataTypes
      : Object.keys(DATA_TYPE_TABLES);

    for (const dataType of effectiveTypes) {
      const tableName = DATA_TYPE_TABLES[dataType];
      if (!tableName) continue;

      // 权限检查：read
      if (!checkPermission(platform, dataType, 'read')) continue;

      // 查询 since 之后更新的记录，排除自己发出的（防回声）
      let query = `SELECT * FROM ${tableName} WHERE user_id = ? AND updated_at > ?`;
      const params = [userId, since];

      // 防回声：排除 origin_device_id 等于自己的
      if (deviceId) {
        query += ` AND (origin_device_id != ? OR origin_device_id IS NULL OR origin_device_id = '')`;
        params.push(deviceId);
      }

      query += ` ORDER BY revision ASC LIMIT 500`;

      try {
        const rows = db.prepare(query).all(...params);
        if (rows.length > 0) {
          pulled[dataType] = rows;
        }
      } catch (err) {
        console.error(`[Sync] Pull error for ${dataType}:`, err.message);
      }
    }

    // Profile
    const profile = db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId);
    if (profile) {
      try {
        pulled.profile = { _revision: profile.revision, ...JSON.parse(profile.data), updated_at: profile.updated_at };
      } catch {}
    }

    return pulled;
  }

  // ===== 路由 =====
  const router = require('express').Router();

  // 所有同步路由已由 server.js 的 adpAuthMiddleware 保护
  // 这里不再需要额外认证中间件

  // ---------- 设备管理 ----------

  // POST /device/register
  router.post('/device/register', (req, res) => {
    const { device_id, platform, device_name, app_version } = req.body;
    const userId = req.userId;

    if (!device_id || !DEVICE_ID_REGEX.test(device_id)) {
      return res.status(400).json({ message: 'device_id 格式不正确（2-64字符，仅字母数字下划线连字符）' });
    }

    if (!platform || !PLATFORM_CAPABILITIES[platform]) {
      return res.status(400).json({ message: `不支持的平台: ${platform}，可选: ${Object.keys(PLATFORM_CAPABILITIES).join(', ')}` });
    }

    const capabilities = PLATFORM_CAPABILITIES[platform];

    // 检查设备是否已注册
    const existing = db.prepare('SELECT * FROM registered_devices WHERE device_id = ? AND user_id = ?').get(device_id, userId);

    if (existing) {
      if (existing.status === 'deactivated') {
        return res.status(403).json({ code: 'DEVICE_DEACTIVATED', message: '设备已停用，请联系管理员' });
      }
      // 更新活跃信息
      db.prepare(
        `UPDATE registered_devices SET last_active_at = datetime('now'), platform = ?, device_name = ?, app_version = ?, capabilities = ? WHERE device_id = ?`
      ).run(platform, device_name || existing.device_name, app_version || existing.app_version, JSON.stringify(capabilities), device_id);
    } else {
      // 检查设备数限制（每用户最多 10 台）
      const deviceCount = db.prepare('SELECT COUNT(*) as cnt FROM registered_devices WHERE user_id = ? AND status = ?').get(userId, 'active');
      if (deviceCount.cnt >= 10) {
        return res.status(400).json({ message: '已达到设备数量上限（10台），请先停用旧设备' });
      }

      db.prepare(
        'INSERT INTO registered_devices (device_id, user_id, platform, device_name, app_version, capabilities) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(device_id, userId, platform, device_name || '', app_version || '', JSON.stringify(capabilities));
    }

    // 获取活跃设备数
    const activeDevices = db.prepare('SELECT COUNT(*) as cnt FROM registered_devices WHERE user_id = ? AND status = ?').get(userId, 'active');

    res.json({
      registered: true,
      platform,
      capabilities,
      active_devices: activeDevices.cnt,
      server_time: new Date().toISOString()
    });
  });

  // GET /device/list
  router.get('/device/list', (req, res) => {
    const devices = db.prepare(
      'SELECT device_id, platform, device_name, app_version, last_active_at, registered_at, status FROM registered_devices WHERE user_id = ? ORDER BY last_active_at DESC'
    ).all(req.userId);

    res.json({ devices });
  });

  // POST /device/deactivate
  router.post('/device/deactivate', (req, res) => {
    const { device_id } = req.body;
    if (!device_id) return res.status(400).json({ message: '缺少 device_id' });

    const device = db.prepare('SELECT * FROM registered_devices WHERE device_id = ? AND user_id = ?').get(device_id, req.userId);
    if (!device) return res.status(404).json({ message: '设备不存在' });

    db.prepare(
      `UPDATE registered_devices SET status = ?, deactivated_at = datetime('now') WHERE device_id = ? AND user_id = ?`
    ).run('deactivated', device_id, req.userId);

    res.json({ success: true, message: `设备 ${device_id} 已停用` });
  });

  // ---------- 数据同步 ----------

  // POST /push
  router.post('/push', (req, res) => {
    const { device_id, platform, request_id, changes, profile } = req.body;
    const userId = req.userId;

    if (!device_id) return res.status(400).json({ message: '缺少 device_id' });

    // 设备验证
    const deviceCheck = verifyDevice(userId, device_id);
    if (!deviceCheck.valid) {
      if (deviceCheck.code === 403) return res.status(403).json({ code: deviceCheck.error, message: '设备已停用' });
      return res.status(400).json({ message: deviceCheck.error });
    }

    // 幂等性检查
    const cached = checkIdempotency(request_id, userId);
    if (cached) return res.json(cached);

    const plat = platform || 'electron';
    const result = processPush(userId, device_id, plat, changes, request_id);

    // Profile 处理
    if (profile && checkPermission(plat, 'profile', 'write')) {
      const baseRevision = profile.base_revision || 0;
      const existing = db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId);

      if (!existing) {
        db.prepare(`INSERT INTO user_profile (user_id, revision, data, origin_device_id, updated_at) VALUES (?, 1, ?, ?, datetime('now'))`)
          .run(userId, JSON.stringify(profile), device_id);
        result.profile = 1;
      } else if (existing.revision <= baseRevision || baseRevision === 0) {
        db.prepare(`UPDATE user_profile SET revision = revision + 1, data = ?, origin_device_id = ?, updated_at = datetime('now') WHERE user_id = ? AND revision = ?`)
          .run(JSON.stringify(profile), device_id, userId, existing.revision);
        result.profile = 1;
      } else {
        // Profile 冲突
        result.conflicts.push({
          type: 'profile',
          id: userId,
          reason: 'revision_mismatch',
          server_revision: existing.revision,
          client_base_revision: baseRevision,
          server_version: { _revision: existing.revision, ...JSON.parse(existing.data || '{}') }
        });
      }
    }

    const response = {
      ...result,
      server_time: new Date().toISOString()
    };

    saveIdempotentResponse(request_id, userId, device_id, response);
    res.json(response);
  });

  // POST /pull
  router.post('/pull', (req, res) => {
    const { device_id, platform, since, data_types } = req.body;
    const userId = req.userId;

    if (!device_id) return res.status(400).json({ message: '缺少 device_id' });

    const deviceCheck = verifyDevice(userId, device_id);
    if (!deviceCheck.valid) {
      if (deviceCheck.code === 403) return res.status(403).json({ code: deviceCheck.error, message: '设备已停用' });
      return res.status(400).json({ message: deviceCheck.error });
    }

    const sinceTime = since || '1970-01-01T00:00:00.000Z';
    const pulled = processPull(userId, device_id, platform || 'electron', sinceTime, data_types);

    res.json({
      pulled,
      has_more: false,
      server_time: new Date().toISOString()
    });
  });

  // POST /full ⭐ 核心端点
  router.post('/full', (req, res) => {
    const { device_id, platform, request_id, since, changes, profile } = req.body;
    const userId = req.userId;

    if (!device_id) return res.status(400).json({ message: '缺少 device_id' });

    const deviceCheck = verifyDevice(userId, device_id);
    if (!deviceCheck.valid) {
      if (deviceCheck.code === 403) return res.status(403).json({ code: deviceCheck.error, message: '设备已停用' });
      return res.status(400).json({ message: deviceCheck.error });
    }

    // 幂等性检查
    const cached = checkIdempotency(request_id, userId);
    if (cached) return res.json(cached);

    const plat = platform || 'electron';
    const sinceTime = since || '1970-01-01T00:00:00.000Z';

    // 1. Push
    const pushResult = processPush(userId, device_id, plat, changes, request_id);

    // 2. Profile push
    let profileResult = null;
    if (profile && checkPermission(plat, 'profile', 'write')) {
      const baseRevision = profile.base_revision || 0;
      const existing = db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId);
      if (!existing) {
        db.prepare(`INSERT INTO user_profile (user_id, revision, data, origin_device_id, updated_at) VALUES (?, 1, ?, ?, datetime('now'))`)
          .run(userId, JSON.stringify(profile), device_id);
        profileResult = { _revision: 1 };
      } else if (existing.revision <= baseRevision || baseRevision === 0) {
        db.prepare(`UPDATE user_profile SET revision = revision + 1, data = ?, origin_device_id = ?, updated_at = datetime('now') WHERE user_id = ?`)
          .run(JSON.stringify(profile), device_id, userId);
        profileResult = { _revision: existing.revision + 1 };
      } else {
        pushResult.conflicts.push({
          type: 'profile', id: userId, reason: 'revision_mismatch',
          server_revision: existing.revision, client_base_revision: baseRevision,
          server_version: { _revision: existing.revision, ...JSON.parse(existing.data || '{}') }
        });
      }
    }

    // 3. Pull
    const pulled = processPull(userId, device_id, plat, sinceTime, null);

    // 4. 返回 profile（最新版本）
    if (!profileResult) {
      const profileRow = db.prepare('SELECT * FROM user_profile WHERE user_id = ?').get(userId);
      if (profileRow) {
        try {
          profileResult = { _revision: profileRow.revision, ...JSON.parse(profileRow.data), updated_at: profileRow.updated_at };
        } catch {}
      }
    }

    // 5. 更新同步游标
    const syncLogId = uuidv4();
    db.prepare(
      'INSERT INTO sync_logs (id, user_id, device_id, platform, request_id, pushed_count, pulled_count, conflict_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(syncLogId, userId, device_id, plat, request_id || '',
      Object.values(pushResult.pushed).reduce((a, b) => a + b, 0),
      Object.values(pulled).reduce((a, b) => a + (Array.isArray(b) ? b.length : 0), 0),
      pushResult.conflicts.length
    );

    // 更新设备同步游标
    for (const dataType of Object.keys(DATA_TYPE_TABLES)) {
      db.prepare(
        `INSERT OR REPLACE INTO device_sync_cursors (user_id, device_id, data_type, last_sync_at) VALUES (?, ?, ?, datetime('now'))`
      ).run(userId, device_id, dataType);
    }

    const response = {
      pushed: pushResult.pushed,
      pulled,
      conflicts: pushResult.conflicts,
      permission_denied: pushResult.permissionDenied,
      profile: profileResult,
      has_more: false,
      server_time: new Date().toISOString()
    };

    saveIdempotentResponse(request_id, userId, device_id, response);
    res.json(response);
  });

  // POST /resolve
  router.post('/resolve', (req, res) => {
    const { device_id, platform, request_id, resolutions } = req.body;
    const userId = req.userId;

    if (!device_id) return res.status(400).json({ message: '缺少 device_id' });
    if (!resolutions || !Array.isArray(resolutions)) return res.status(400).json({ message: '缺少 resolutions' });

    const deviceCheck = verifyDevice(userId, device_id);
    if (!deviceCheck.valid) {
      if (deviceCheck.code === 403) return res.status(403).json({ code: deviceCheck.error, message: '设备已停用' });
      return res.status(400).json({ message: deviceCheck.error });
    }

    const plat = platform || 'electron';
    const resolved = [];
    const failed = [];

    for (const r of resolutions) {
      const { type, id, strategy, base_revision, data } = r;

      if (!type || !id || !strategy) {
        failed.push({ type, id, reason: 'missing_fields' });
        continue;
      }

      const tableName = DATA_TYPE_TABLES[type];
      if (!tableName) {
        failed.push({ type, id, reason: 'unknown_type' });
        continue;
      }

      // server_wins: 不做任何操作
      if (strategy === 'server_wins') {
        resolved.push({ type, id, strategy });
        continue;
      }

      // client_wins / merge: 用客户端数据覆盖
      if (strategy === 'client_wins' || strategy === 'merge') {
        // 检查服务端当前版本
        const existing = db.prepare(`SELECT * FROM ${tableName} WHERE id = ? AND user_id = ?`).get(id, userId);
        if (!existing) {
          failed.push({ type, id, reason: 'record_not_found' });
          continue;
        }

        // 安全检查：如果冲突解决期间又有新写入
        if (base_revision && existing.revision > base_revision) {
          failed.push({ type, id, reason: 'revision_changed_during_conflict', server_revision: existing.revision });
          continue;
        }

        const newRevision = existing.revision + 1;
        const now = new Date().toISOString();
        const setClauses = ['revision = ?', 'origin_device_id = ?', 'updated_at = ?'];
        const values = [newRevision, device_id, now];

        for (const field of (DATA_TYPE_FIELDS[type] || [])) {
          if (data && data[field] !== undefined) {
            setClauses.push(`${field} = ?`);
            values.push(typeof data[field] === 'object' ? JSON.stringify(data[field]) : data[field]);
          }
        }

        values.push(id, userId);
        db.prepare(`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);

        // 审计
        db.prepare(
          'INSERT INTO sync_operations (user_id, device_id, data_type, record_id, operation, base_revision, new_revision, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(userId, device_id, type, id, 'resolve', base_revision || existing.revision, newRevision, request_id || '');

        resolved.push({ type, id, strategy, new_revision: newRevision });
      }
    }

    res.json({
      resolved,
      failed,
      server_time: new Date().toISOString()
    });
  });

  // GET /status
  router.get('/status', (req, res) => {
    const userId = req.userId;
    const counts = {};
    const deviceBreakdown = {};

    for (const [dataType, tableName] of Object.entries(DATA_TYPE_TABLES)) {
      try {
        const active = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName} WHERE user_id = ? AND deleted_at IS NULL`).get(userId);
        const deleted = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName} WHERE user_id = ? AND deleted_at IS NOT NULL`).get(userId);
        const maxRev = db.prepare(`SELECT MAX(revision) as max_rev FROM ${tableName} WHERE user_id = ?`).get(userId);
        counts[dataType] = { active: active.cnt, deleted: deleted.cnt, max_revision: maxRev.max_rev || 0 };

        // 设备来源统计
        const origins = db.prepare(
          `SELECT origin_device_id, COUNT(*) as cnt FROM ${tableName} WHERE user_id = ? AND origin_device_id != '' GROUP BY origin_device_id`
        ).all(userId);
        if (origins.length > 0) {
          deviceBreakdown[dataType] = origins.map(o => ({ origin_device_id: o.origin_device_id, count: o.cnt }));
        }
      } catch (err) {
        counts[dataType] = { active: 0, deleted: 0, max_revision: 0 };
      }
    }

    // Profile
    const profile = db.prepare('SELECT revision, updated_at FROM user_profile WHERE user_id = ?').get(userId);

    // 设备列表
    const devices = db.prepare(
      'SELECT device_id, platform, device_name, last_active_at, status FROM registered_devices WHERE user_id = ? ORDER BY last_active_at DESC'
    ).all(userId);

    // 最近同步记录
    const recentSyncs = db.prepare(
      'SELECT * FROM sync_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'
    ).all(userId);

    res.json({
      counts,
      device_breakdown: deviceBreakdown,
      profile: profile || { revision: 0, updated_at: null },
      devices,
      recent_syncs: recentSyncs || [],
      server_time: new Date().toISOString()
    });
  });

  // DELETE /data
  router.delete('/data', (req, res) => {
    const userId = req.userId;
    const { data_types } = req.body || {};
    const types = data_types || Object.keys(DATA_TYPE_TABLES);
    const now = new Date().toISOString();
    let deletedCount = 0;

    for (const dataType of types) {
      const tableName = DATA_TYPE_TABLES[dataType];
      if (!tableName) continue;

      // 软删除：设置 deleted_at，revision+1
      const result = db.prepare(
        `UPDATE ${tableName} SET deleted_at = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND deleted_at IS NULL`
      ).run(now, now, userId);
      deletedCount += result.changes;
    }

    res.json({ success: true, soft_deleted: deletedCount, server_time: new Date().toISOString() });
  });

  // GET /capabilities（公开端点，不需要认证）
  router.get('/capabilities', (req, res) => {
    const { platform } = req.query;
    if (platform && PLATFORM_CAPABILITIES[platform]) {
      res.json({ platform, capabilities: PLATFORM_CAPABILITIES[platform] });
    } else {
      res.json({ platforms: Object.keys(PLATFORM_CAPABILITIES), capabilities: PLATFORM_CAPABILITIES });
    }
  });

  return router;
};
