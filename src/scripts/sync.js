/**
 * Memora 云端同步引擎 v3
 * 基于 revision 乐观锁的增量双向同步
 *
 * 架构：
 *   SyncEngine (渲染进程) ←→ IPC ←→ main.js (主进程，网络请求)
 *
 * 核心机制：
 *   - revision 乐观锁（不依赖时钟）
 *   - 防回声（origin_device_id）
 *   - 幂等性（request_id）
 *   - 增量同步（since + 本地变更检测）
 */

const SyncEngine = {
  // ===== 状态 =====
  _deviceId: null,
  _isSyncing: false,
  _syncTimer: null,
  _lastSyncAt: null,       // ISO string，上次成功同步时间
  _pendingChanges: {       // 待推送的变更（变更时收集）
    tasks: [],
    notes: [],
    knowledge_nodes: [],
    knowledge_edges: [],
    clipboard_memories: []
  },
  _conflicts: [],          // 未解决的冲突
  _initialized: false,

  // ===== 初始化 =====

  init() {
    console.log('[Sync] Initializing...');
    const settings = this._getSettings();
    if (!settings.enabled) {
      console.log('[Sync] Cloud sync disabled');
      return;
    }
    this._ensureDeviceId();
    this._lastSyncAt = settings.lastSyncAt || null;
    this._initialized = true;
    console.log('[Sync] Initialized, deviceId:', this._deviceId);
  },

  /**
   * 启用同步（用户打开开关时调用）
   */
  async enable() {
    this._ensureDeviceId();
    const settings = this._getSettings();
    settings.enabled = true;
    this._saveSettings(settings);

    // 1. 注册设备
    try {
      await this.registerDevice();
    } catch (err) {
      console.error('[Sync] Device registration failed:', err.message);
      // 注册失败不阻断，后续同步会重试
    }

    // 2. 首次全量同步
    await this.fullSync();
    this._initialized = true;

    // 3. 启动定时同步
    this._startAutoSync();
  },

  /**
   * 禁用同步（用户关闭开关时调用）
   */
  disable() {
    const settings = this._getSettings();
    settings.enabled = false;
    this._saveSettings(settings);
    this._stopAutoSync();
    this._initialized = false;
    console.log('[Sync] Disabled');
  },

  // ===== 设备管理 =====

  _ensureDeviceId() {
    if (this._deviceId) return;
    let deviceId = localStorage.getItem('memora_sync_device_id');
    if (!deviceId) {
      // 格式：pc_{hostname}_{userIdHash}
      const hostname = (navigator.userAgent.match(/\(([^)]+)\)/) || ['unknown'])[1]
        .replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
      const random = Math.random().toString(36).substring(2, 8);
      deviceId = `pc_${hostname}_${random}`;
      localStorage.setItem('memora_sync_device_id', deviceId);
    }
    this._deviceId = deviceId;
  },

  async registerDevice() {
    this._ensureDeviceId();
    const appVersion = window.App?.APP_VERSION || '2.1.0';
    const result = await window.electronAPI.syncRegisterDevice({
      device_id: this._deviceId,
      platform: 'electron',
      device_name: `PC (${navigator.platform})`,
      app_version: appVersion
    });

    if (result && result.registered) {
      console.log('[Sync] Device registered, capabilities:', result.capabilities);
      const settings = this._getSettings();
      settings.capabilities = result.capabilities;
      this._saveSettings(settings);
    }
    return result;
  },

  async getDeviceList() {
    return await window.electronAPI.syncGetDeviceList();
  },

  async deactivateDevice(deviceId) {
    return await window.electronAPI.syncDeactivateDevice({ device_id: deviceId });
  },

  // ===== 同步核心 =====

  /**
   * 全量双向同步（推荐入口）
   * POST /memora/sync/full
   */
  async fullSync() {
    if (this._isSyncing) {
      console.log('[Sync] Already syncing, skip');
      return { ok: false, reason: 'already_syncing' };
    }

    const settings = this._getSettings();
    if (!settings.enabled) {
      return { ok: false, reason: 'sync_disabled' };
    }

    this._isSyncing = true;
    this._emitStatus('syncing');

    try {
      // 1. 收集本地变更
      const changes = this._collectChanges();

      // 2. 确定 since 时间
      const since = this._lastSyncAt || '1970-01-01T00:00:00.000Z';

      // 3. 发起 full sync 请求
      const result = await window.electronAPI.syncFull({
        device_id: this._deviceId,
        platform: 'electron',
        request_id: this._generateRequestId(),
        since: since,
        changes: changes,
        profile: null  // TODO: profile 同步
      });

      if (!result) {
        throw new Error('Network error');
      }

      // 4. 处理 pull 结果（写入本地）
      if (result.pulled) {
        this._applyPulledData(result.pulled);
      }

      // 5. 处理冲突
      if (result.conflicts && result.conflicts.length > 0) {
        this._handleConflicts(result.conflicts);
      }

      // 6. 处理权限拒绝
      if (result.permission_denied && result.permission_denied.length > 0) {
        console.warn('[Sync] Permission denied:', result.permission_denied);
      }

      // 7. 更新同步时间
      this._lastSyncAt = result.server_time || new Date().toISOString();
      const s = this._getSettings();
      s.lastSyncAt = this._lastSyncAt;
      this._saveSettings(s);

      // 8. 清空待推送缓存
      this._clearPendingChanges();

      // 9. 更新统计
      const stats = this._getStats();
      stats.totalSyncs = (stats.totalSyncs || 0) + 1;
      stats.lastSyncAt = this._lastSyncAt;
      stats.lastPushedCount = Object.values(result.pushed || {}).reduce((a, b) => a + b, 0);
      stats.lastPulledCount = this._countPulled(result.pulled);
      this._saveStats(stats);

      this._emitStatus('idle', { pushed: stats.lastPushedCount, pulled: stats.lastPulledCount });

      console.log('[Sync] Full sync done: pushed', stats.lastPushedCount, ', pulled', stats.lastPulledCount,
                  ', conflicts', (result.conflicts || []).length);

      return { ok: true, pushed: stats.lastPushedCount, pulled: stats.lastPulledCount, conflicts: (result.conflicts || []).length };
    } catch (err) {
      console.error('[Sync] Full sync failed:', err.message);
      this._emitStatus('error', { error: err.message });
      return { ok: false, reason: err.message };
    } finally {
      this._isSyncing = false;
    }
  },

  /**
   * 仅推送（操作后实时同步用）
   * POST /memora/sync/push
   */
  async push(changes) {
    const settings = this._getSettings();
    if (!settings.enabled) return { ok: false, reason: 'sync_disabled' };

    try {
      const result = await window.electronAPI.syncPush({
        device_id: this._deviceId,
        platform: 'electron',
        request_id: this._generateRequestId(),
        changes: changes || this._collectChanges()
      });

      if (result && result.conflicts && result.conflicts.length > 0) {
        this._handleConflicts(result.conflicts);
      }

      return result;
    } catch (err) {
      console.error('[Sync] Push failed:', err.message);
      return { ok: false, reason: err.message };
    }
  },

  /**
   * 仅拉取
   * POST /memora/sync/pull
   */
  async pull(dataTypes) {
    const settings = this._getSettings();
    if (!settings.enabled) return { ok: false, reason: 'sync_disabled' };

    try {
      const result = await window.electronAPI.syncPull({
        device_id: this._deviceId,
        platform: 'electron',
        since: this._lastSyncAt || '1970-01-01T00:00:00.000Z',
        data_types: dataTypes || this._getEnabledDataTypes()
      });

      if (result && result.pulled) {
        this._applyPulledData(result.pulled);
        this._lastSyncAt = result.server_time || new Date().toISOString();
        const s = this._getSettings();
        s.lastSyncAt = this._lastSyncAt;
        this._saveSettings(s);
      }

      return result;
    } catch (err) {
      console.error('[Sync] Pull failed:', err.message);
      return { ok: false, reason: err.message };
    }
  },

  /**
   * 解决冲突
   * POST /memora/sync/resolve
   */
  async resolveConflict(resolutions) {
    try {
      const result = await window.electronAPI.syncResolve({
        device_id: this._deviceId,
        platform: 'electron',
        request_id: this._generateRequestId(),
        resolutions: resolutions
      });

      // 移除已解决的冲突
      this._conflicts = this._conflicts.filter(c =>
        !resolutions.some(r => r.type === c.type && r.id === c.id)
      );

      return result;
    } catch (err) {
      console.error('[Sync] Resolve conflict failed:', err.message);
      return { ok: false, reason: err.message };
    }
  },

  /**
   * 获取同步状态
   * GET /memora/sync/status
   */
  async getStatus() {
    try {
      return await window.electronAPI.syncGetStatus();
    } catch (err) {
      console.error('[Sync] Get status failed:', err.message);
      return null;
    }
  },

  // ===== 变更收集 =====

  /**
   * 标记某条记录被修改，加入待推送队列
   * 在 Store.updateTask / Store.addTask 等操作后调用
   */
  markDirty(dataType, record) {
    if (!this._getSettings().enabled) return;

    const settings = this._getSettings();
    if (!this._isDataTypeEnabled(dataType, settings)) return;

    const pending = this._pendingChanges[dataType];
    if (!pending) return;

    // 替换已有的同 id 记录
    const idx = pending.findIndex(r => r.id === record.id);
    const item = this._toPushFormat(record);
    if (idx >= 0) {
      pending[idx] = item;
    } else {
      pending.push(item);
    }

    // 实时模式：立即推送
    const freq = settings.frequency || 'realtime';
    if (freq === 'realtime' && !this._isSyncing) {
      this._debouncedPush();
    }
  },

  /**
   * 标记删除（软删除）
   */
  markDeleted(dataType, record) {
    if (!this._getSettings().enabled) return;
    const item = this._toPushFormat(record);
    item.deleted_at = new Date().toISOString();
    this.markDirty(dataType, { ...record, deleted_at: item.deleted_at });
  },

  /**
   * 从本地数据收集所有变更
   */
  _collectChanges() {
    const changes = {};
    const settings = this._getSettings();

    // 1. 先加入 pending changes
    for (const [type, items] of Object.entries(this._pendingChanges)) {
      if (items.length > 0 && this._isDataTypeEnabled(type, settings)) {
        changes[type] = [...items];
      }
    }

    // 2. 扫描本地数据中 lastSyncAt 之后更新的记录
    const since = this._lastSyncAt;
    if (since) {
      this._collectLocalChanges(changes, since, settings);
    } else {
      // 首次同步：全量上传
      this._collectAllLocalData(changes, settings);
    }

    return changes;
  },

  _collectLocalChanges(changes, since, settings) {
    const sinceMs = new Date(since).getTime();

    // Tasks
    if (this._isDataTypeEnabled('tasks', settings) && !changes.tasks) {
      const tasks = (typeof Store !== 'undefined' ? Store.getTasks() : [])
        .filter(t => new Date(t.updatedAt || t.createdAt).getTime() > sinceMs)
        .map(t => this._toPushFormat(t));
      if (tasks.length > 0) changes.tasks = tasks;
    }

    // Notes (via notebook API)
    if (this._isDataTypeEnabled('notes', settings) && !changes.notes) {
      // notes 在主进程管理，这里通过 IPC 获取
      // 暂时跳过，由 fullSync 时主进程补充
    }

    // Knowledge nodes/edges
    if (this._isDataTypeEnabled('knowledge_nodes', settings) && !changes.knowledge_nodes) {
      // knowledge 在主进程管理，由 fullSync 时主进程补充
    }
  },

  _collectAllLocalData(changes, settings) {
    // Tasks - 全量
    if (this._isDataTypeEnabled('tasks', settings) && !changes.tasks) {
      const tasks = (typeof Store !== 'undefined' ? Store.getTasks() : [])
        .map(t => this._toPushFormat(t));
      if (tasks.length > 0) changes.tasks = tasks;
    }
    // Notes, Knowledge 等由主进程在 fullSync 时补充
  },

  _toPushFormat(record) {
    return {
      id: record.id,
      base_revision: record.revision || 0,
      // 复制所有业务字段
      ...record,
      // 确保 revision 相关字段正确
      revision: undefined,  // 不发送 revision，服务端自己管理
    };
  },

  _clearPendingChanges() {
    this._pendingChanges = {
      tasks: [],
      notes: [],
      knowledge_nodes: [],
      knowledge_edges: [],
      clipboard_memories: []
    };
  },

  // ===== 拉取数据应用 =====

  _applyPulledData(pulled) {
    let appliedCount = 0;

    // Tasks
    if (pulled.tasks && pulled.tasks.length > 0) {
      const localTasks = typeof Store !== 'undefined' ? Store.getTasks() : [];
      const localMap = new Map(localTasks.map(t => [t.id, t]));

      for (const serverTask of pulled.tasks) {
        const local = localMap.get(serverTask.id);
        // 跳过自己发出的（防回声）
        if (serverTask.origin_device_id === this._deviceId) continue;

        if (!local) {
          // 新记录：添加到本地
          const task = this._fromPullFormat('tasks', serverTask);
          localTasks.push(task);
          appliedCount++;
        } else if ((serverTask.revision || 0) > (local.revision || 0)) {
          // 服务端版本更新：更新本地
          const idx = localTasks.findIndex(t => t.id === serverTask.id);
          if (idx >= 0) {
            localTasks[idx] = this._fromPullFormat('tasks', serverTask, local);
            appliedCount++;
          }
        }
        // 本地版本 >= 服务端版本：跳过
      }

      if (typeof Store !== 'undefined' && appliedCount > 0) {
        Store.saveTasks(localTasks);
      }
    }

    // Notes, Knowledge 等：通过事件通知主进程写入
    // 简化实现：先发事件让 UI 刷新
    if (appliedCount > 0) {
      this._emitDataChanged();
    }

    return appliedCount;
  },

  _fromPullFormat(dataType, serverRecord, localRecord) {
    // 将服务端格式转为本地格式
    const base = localRecord || {};

    switch (dataType) {
      case 'tasks':
        return {
          ...base,
          id: serverRecord.id,
          title: serverRecord.title ?? base.title,
          description: serverRecord.description ?? base.description ?? '',
          status: serverRecord.status ?? base.status ?? 'pending',
          priority: serverRecord.priority ?? base.priority ?? 'medium',
          dueDate: serverRecord.due_date ?? base.dueDate,
          source: serverRecord.source ?? base.source ?? 'sync',
          rawText: serverRecord.raw_text ?? base.rawText ?? '',
          estimatedDuration: serverRecord.estimated_duration ?? base.estimatedDuration ?? 60,
          actualDuration: serverRecord.actual_duration ?? base.actualDuration ?? 0,
          pomodoroSessions: this._safeParseJSON(serverRecord.pomodoro_sessions, base.pomodoroSessions || []),
          reminders: this._safeParseJSON(serverRecord.reminders, base.reminders || []),
          reminderSettings: base.reminderSettings || { enoughTime: 120, nearDeadline: 30 },
          calendarEventId: serverRecord.calendar_event_id ?? base.calendarEventId,
          completedAt: serverRecord.completed_at ?? base.completedAt,
          revision: serverRecord.revision ?? (base.revision || 0) + 1,
          originDeviceId: serverRecord.origin_device_id,
          createdAt: serverRecord.created_at ?? base.createdAt,
          updatedAt: serverRecord.updated_at ?? new Date().toISOString(),
          deletedAt: serverRecord.deleted_at ?? null,
        };

      case 'notes':
        return {
          ...base,
          id: serverRecord.id,
          title: serverRecord.title ?? base.title,
          content: serverRecord.content ?? base.content ?? '',
          category: serverRecord.category ?? base.category ?? 'default',
          tags: this._safeParseJSON(serverRecord.tags, base.tags || []),
          revision: serverRecord.revision ?? (base.revision || 0) + 1,
          originDeviceId: serverRecord.origin_device_id,
          createdAt: serverRecord.created_at ?? base.createdAt,
          updatedAt: serverRecord.updated_at ?? new Date().toISOString(),
          deletedAt: serverRecord.deleted_at ?? null,
        };

      default:
        return {
          ...base,
          ...serverRecord,
          revision: serverRecord.revision ?? (base.revision || 0) + 1,
        };
    }
  },

  _safeParseJSON(str, fallback) {
    if (Array.isArray(str)) return str;
    if (typeof str === 'string') {
      try { return JSON.parse(str); } catch { return fallback; }
    }
    return fallback;
  },

  // ===== 冲突处理 =====

  _handleConflicts(conflicts) {
    console.warn('[Sync] Conflicts detected:', conflicts.length);
    this._conflicts.push(...conflicts);

    // 通知 UI 展示冲突解决界面
    this._emitConflicts(conflicts);

    // 自动解决策略：对于非关键冲突，默认 server_wins
    for (const conflict of conflicts) {
      if (conflict.reason === 'revision_mismatch') {
        // 对于任务状态同步，默认取最新版本（server_wins）
        // 用户可在 UI 中覆盖
        console.log(`[Sync] Conflict on ${conflict.type}/${conflict.id}: server_revision=${conflict.server_revision}, client_base=${conflict.client_base_revision}`);
      }
    }
  },

  getConflicts() {
    return this._conflicts;
  },

  // ===== 自动同步 =====

  _startAutoSync() {
    this._stopAutoSync();
    const settings = this._getSettings();
    const freq = settings.frequency || 'realtime';

    if (freq === 'manual') return;

    const intervalMs = freq === 'realtime' ? 60 * 1000 : 5 * 60 * 1000;  // 实时1分钟/定时5分钟
    this._syncTimer = setInterval(async () => {
      if (!this._isSyncing) {
        await this.fullSync();
      }
    }, intervalMs);

    console.log('[Sync] Auto sync started, interval:', intervalMs / 1000, 's');
  },

  _stopAutoSync() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
  },

  _debounceTimer: null,
  _debouncedPush() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(async () => {
      if (!this._isSyncing) {
        const changes = this._collectChanges();
        const hasChanges = Object.values(changes).some(arr => arr && arr.length > 0);
        if (hasChanges) {
          await this.push(changes);
          this._clearPendingChanges();
        }
      }
    }, 2000);  // 2秒防抖
  },

  // ===== 辅助方法 =====

  _getSettings() {
    try {
      const raw = localStorage.getItem('memora_sync_settings');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      enabled: false,
      serverUrl: '',
      scope: { tasks: true, notes: true, knowledge: true, clipboard: true },
      frequency: 'realtime',
      lastSyncAt: null,
      capabilities: null
    };
  },

  _saveSettings(settings) {
    localStorage.setItem('memora_sync_settings', JSON.stringify(settings));
  },

  _getStats() {
    try {
      const raw = localStorage.getItem('memora_sync_stats');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { totalSyncs: 0, lastSyncAt: null, lastPushedCount: 0, lastPulledCount: 0, lastError: null };
  },

  _saveStats(stats) {
    localStorage.setItem('memora_sync_stats', JSON.stringify(stats));
  },

  _isDataTypeEnabled(dataType, settings) {
    const scopeMap = {
      tasks: 'tasks',
      notes: 'notes',
      knowledge_nodes: 'knowledge',
      knowledge_edges: 'knowledge',
      clipboard_memories: 'clipboard'
    };
    const key = scopeMap[dataType];
    return key ? (settings.scope[key] !== false) : true;
  },

  _getEnabledDataTypes() {
    const settings = this._getSettings();
    const types = [];
    if (settings.scope.tasks) types.push('tasks');
    if (settings.scope.notes) types.push('notes');
    if (settings.scope.knowledge) { types.push('knowledge_nodes'); types.push('knowledge_edges'); }
    if (settings.scope.clipboard) types.push('clipboard_memories');
    return types;
  },

  _generateRequestId() {
    return 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
  },

  _countPulled(pulled) {
    if (!pulled) return 0;
    let count = 0;
    for (const arr of Object.values(pulled)) {
      if (Array.isArray(arr)) count += arr.length;
    }
    return count;
  },

  // ===== 事件系统 =====

  _listeners: {},

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  },

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  },

  _emit(event, data) {
    if (!this._listeners[event]) return;
    for (const cb of this._listeners[event]) {
      try { cb(data); } catch (e) { console.error('[Sync] Event listener error:', e); }
    }
  },

  _emitStatus(status, detail) {
    this._emit('status', { status, ...detail });
    // 同时更新 DOM 中的同步状态
    this._updateSyncUI(status, detail);
  },

  _emitConflicts(conflicts) {
    this._emit('conflicts', conflicts);
  },

  _emitDataChanged() {
    this._emit('data-changed', {});
    // 通知 App 刷新视图
    if (typeof App !== 'undefined' && App.refreshCalendarView) {
      try { App.refreshCalendarView(); } catch (e) {}
    }
  },

  _updateSyncUI(status, detail) {
    const btn = document.getElementById('syncNowBtn');
    const lastSyncEl = document.getElementById('lastSyncTime');
    const pendingPushEl = document.getElementById('pendingPushCount');
    const pendingPullEl = document.getElementById('pendingPullCount');
    const syncDirEl = document.getElementById('syncDirection');

    if (status === 'syncing' && btn) {
      btn.disabled = true;
      btn.textContent = '⏳ 同步中...';
    } else if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 立即同步';
    }

    if (lastSyncEl && this._lastSyncAt) {
      lastSyncEl.textContent = this._formatRelativeTime(this._lastSyncAt);
    }

    if (detail) {
      if (syncDirEl) {
        if (detail.pushed > 0 && detail.pulled > 0) syncDirEl.textContent = '↑↓ 双向';
        else if (detail.pushed > 0) syncDirEl.textContent = '↑ 上传';
        else if (detail.pulled > 0) syncDirEl.textContent = '↓ 下载';
        else syncDirEl.textContent = '—';
      }
      // 更新待上传/待下载（简化）
      if (pendingPushEl) pendingPushEl.textContent = '0 条';
      if (pendingPullEl) pendingPullEl.textContent = '0 条';
    }

    // 错误提示
    if (status === 'error' && detail?.error) {
      if (typeof App !== 'undefined' && App._showToast) {
        App._showToast('同步失败：' + detail.error, 'error');
      }
    }
  },

  _formatRelativeTime(isoStr) {
    if (!isoStr) return '从未';
    const now = Date.now();
    const then = new Date(isoStr).getTime();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
  },

  // ===== 供 App.js 调用的公共方法 =====

  isSyncing() {
    return this._isSyncing;
  },

  getLastSyncAt() {
    return this._lastSyncAt;
  },

  getDeviceInfo() {
    return {
      deviceId: this._deviceId,
      platform: 'electron',
      isInitialized: this._initialized
    };
  },

  /**
   * 关闭前全量同步
   */
  async syncBeforeClose() {
    if (!this._getSettings().enabled) return;
    console.log('[Sync] Syncing before close...');
    await this.fullSync();
  }
};

window.SyncEngine = SyncEngine;
