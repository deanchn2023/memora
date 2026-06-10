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
    clipboard_memories: [],
    assistant_conversations: [],
    assistant_messages: []
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

    // 监听主进程的同步触发事件（如剪贴板图片保存后立即推送）
    if (window.electronAPI?.onSyncTriggerPush) {
      window.electronAPI.onSyncTriggerPush((data) => {
        if (data?.dataType && data?.record) {
          console.log('[Sync] Triggered push from main process:', data.dataType, data.record.id);
          this.markDirty(data.dataType, data.record);
        }
      });
    }
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

    if (result && (result.registered || result.ok)) {
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

      if (!result.ok) {
        throw new Error(result.error || result.reason || 'Sync failed');
      }

      // 4. 适配服务端响应格式
      // 服务端返回 { ok, push: { ok, results: { tasks: { upserted, conflicted } } }, pull: { ok, results: { tasks: { records, deleted_ids, count, max_revision } } } }
      const pushedSummary = {};
      const pulledData = {};
      const allConflicts = [];

      // 解析 push 结果
      if (result.push && result.push.results) {
        for (const [type, typeResult] of Object.entries(result.push.results)) {
          if (typeResult.upserted) pushedSummary[type] = typeResult.upserted.length;
          if (typeResult.conflicted && typeResult.conflicted.length > 0) {
            for (const c of typeResult.conflicted) {
              allConflicts.push({ type, ...c });
            }
          }
        }
      }

      // 解析 pull 结果
      if (result.pull && result.pull.results) {
        for (const [type, typeResult] of Object.entries(result.pull.results)) {
          if (typeResult.records && typeResult.records.length > 0) {
            pulledData[type] = typeResult.records;
          }
        }
      }

      // 5. 处理 pull 结果（写入本地）
      if (Object.keys(pulledData).length > 0) {
        this._applyPulledData(pulledData);
      }

      // 6. 处理冲突
      if (allConflicts.length > 0) {
        this._handleConflicts(allConflicts);
      }

      // 7. 处理权限拒绝
      if (result.permission_denied && result.permission_denied.length > 0) {
        console.warn('[Sync] Permission denied:', result.permission_denied);
      }

      // 8. 更新同步时间
      this._lastSyncAt = result.server_time || new Date().toISOString();
      const s = this._getSettings();
      s.lastSyncAt = this._lastSyncAt;
      this._saveSettings(s);

      // 9. 清空待推送缓存
      this._clearPendingChanges();

      // 9.5 增量拉取图片元数据 + 下载（后台异步，不阻塞同步主流程）
      this._syncImagesAfterPull();

      // 10. 更新统计（含分类型明细）
      const totalPushed = Object.values(pushedSummary).reduce((a, b) => a + b, 0);
      const pulledSummary = this._summarizePulled(pulledData);
      const totalPulled = Object.values(pulledSummary).reduce((a, b) => a + b, 0);
      const stats = this._getStats();
      stats.totalSyncs = (stats.totalSyncs || 0) + 1;
      stats.lastSyncAt = this._lastSyncAt;
      stats.lastPushedCount = totalPushed;
      stats.lastPulledCount = totalPulled;
      stats.lastPushDetail = pushedSummary;
      stats.lastPullDetail = pulledSummary;
      this._saveStats(stats);

      this._emitStatus('idle', { pushed: totalPushed, pulled: totalPulled, pushDetail: pushedSummary, pullDetail: pulledSummary });

      console.log('[Sync] Full sync done: pushed', totalPushed, pushedSummary, ', pulled', totalPulled, pulledSummary,
                  ', conflicts', (result.conflicts || []).length);

      return { ok: true, pushed: totalPushed, pulled: totalPulled, conflicts: (result.conflicts || []).length, pushDetail: pushedSummary, pullDetail: pulledSummary };
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

      if (result && result.ok && result.results) {
        // 适配服务端格式：pull 返回 { ok, results: { tasks: { records, ... } } }
        const pulledData = {};
        for (const [type, typeResult] of Object.entries(result.results)) {
          if (typeResult.records && typeResult.records.length > 0) {
            pulledData[type] = typeResult.records;
          }
        }
        if (Object.keys(pulledData).length > 0) {
          this._applyPulledData(pulledData);
        }
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
    // 将 camelCase 字段名映射为 snake_case，并序列化数组/对象字段
    const fieldMap = {
      dueDate: 'due_date',
      estimatedDuration: 'estimated_duration',
      actualDuration: 'actual_duration',
      pomodoroSessions: 'pomodoro_sessions',
      completedAt: 'completed_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      calendarEventId: 'calendar_event_id',
      originDeviceId: 'origin_device_id',
      deletedAt: 'deleted_at',
      rawText: 'raw_text',
      memoryType: 'memory_type',
      businessCategory: 'business_category',
      sourceId: 'source_id',
      targetId: 'target_id',
      imagePath: 'image_path',
      imageHash: 'image_hash',
      imageWidth: 'image_width',
      imageHeight: 'image_height',
    };
    // 服务端 TEXT 列字段（必须为字符串，不能传数组/对象）
    const textFields = new Set([
      'pomodoro_sessions', 'reminders', 'tags', 'extra',
      'pomodoroSessions', // camelCase 兼容
    ]);

    const mapped = {
      id: record.id,
      base_revision: record.revision || 0,
    };

    for (const [key, value] of Object.entries(record)) {
      if (key === 'id' || key === 'revision' || value === undefined) continue;
      const snakeKey = fieldMap[key] || key;
      // 数组/对象字段必须序列化为 JSON 字符串
      if (textFields.has(key) || textFields.has(snakeKey)) {
        mapped[snakeKey] = (typeof value === 'string') ? value : JSON.stringify(value || (Array.isArray(record[key]) ? [] : {}));
      } else {
        mapped[snakeKey] = value;
      }
    }

    return mapped;
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

    // Notes — 图片下载 + 笔记写入（通过主进程 IPC）
    if (pulled.notes && pulled.notes.length > 0) {
      // 收集需要下载的服务端图片笔记
      const imageNotesToDownload = pulled.notes.filter(n =>
        n.imagePath && !n.imagePath.startsWith('images/') && !n.imagePath.startsWith('/')
      );

      if (imageNotesToDownload.length > 0) {
        console.log('[Sync] Downloading', imageNotesToDownload.length, 'remote note images...');
        this._downloadPendingNoteImages(imageNotesToDownload);
      }

      // 通过主进程 IPC 写入笔记到本地 notebook
      this._applyPulledNotes(pulled.notes);
      appliedCount += pulled.notes.filter(n => n.originDeviceId !== this._deviceId).length;
    }

    // Notes, Knowledge 等：通过事件通知主进程写入
    // 简化实现：先发事件让 UI 刷新
    if (appliedCount > 0) {
      this._emitDataChanged();
    }

    // Assistant conversations — 合并到 App._chatSessions
    if (pulled.assistant_conversations && pulled.assistant_conversations.length > 0) {
      if (typeof App !== 'undefined' && App._chatSessions) {
        const localIds = new Set(App._chatSessions.map(s => s.id));
        for (const conv of pulled.assistant_conversations) {
          if (conv.origin_device_id === this._deviceId) continue; // 防回声
          if (conv.deleted_at) {
            // 云端已删除：本地也删除
            const idx = App._chatSessions.findIndex(s => s.id === conv.id);
            if (idx >= 0) {
              App._chatSessions.splice(idx, 1);
              try { localStorage.removeItem('memora_session_msg_' + conv.id); } catch {}
              appliedCount++;
            }
            continue;
          }
          if (!localIds.has(conv.id)) {
            App._chatSessions.push({
              id: conv.id,
              title: conv.title || '新对话',
              messageCount: conv.message_count || 0,
              createdAt: conv.created_at || new Date().toISOString(),
              updatedAt: conv.updated_at || new Date().toISOString(),
              conversationId: conv.conversation_id || null,
              _fromCloud: true,
              _revision: conv.revision || 1,
            });
            appliedCount++;
          } else {
            // 已有：更新 revision 和 conversationId
            const local = App._chatSessions.find(s => s.id === conv.id);
            if (local && (conv.revision || 0) > (local._revision || 0)) {
              if (conv.conversation_id && !local.conversationId) local.conversationId = conv.conversation_id;
              local._revision = conv.revision;
              if (conv.title && conv.title !== '新对话') local.title = conv.title;
              if ((conv.message_count || 0) > (local.messageCount || 0)) local.messageCount = conv.message_count;
              appliedCount++;
            }
          }
        }
        if (appliedCount > 0) {
          App._saveChatSessions();
          App._renderChatSessionList();
        }
      }
    }

    // Assistant messages — 不直接应用到 UI（切换会话时按需加载）
    // 只记录统计
    if (pulled.assistant_messages && pulled.assistant_messages.length > 0) {
      appliedCount += pulled.assistant_messages.filter(m => m.origin_device_id !== this._deviceId).length;
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
          imagePath: serverRecord.image_path ?? base.imagePath ?? '',
          imageHash: serverRecord.image_hash ?? base.imageHash ?? '',
          imageWidth: serverRecord.image_width ?? base.imageWidth ?? 0,
          imageHeight: serverRecord.image_height ?? base.imageHeight ?? 0,
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
      clipboard_memories: 'clipboard',
      assistant_conversations: 'conversations',
      assistant_messages: 'conversations'
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
    if (settings.scope.conversations !== false) {
      types.push('assistant_conversations');
      types.push('assistant_messages');
    }
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

  /**
   * 按类型汇总 pull 数据量
   * @returns {Object} e.g. { tasks: 3, notes: 2, assistant_conversations: 1 }
   */
  _summarizePulled(pulled) {
    if (!pulled) return {};
    const summary = {};
    for (const [type, arr] of Object.entries(pulled)) {
      if (Array.isArray(arr) && arr.length > 0) {
        summary[type] = arr.length;
      }
    }
    return summary;
  },

  /**
   * 格式化同步结果摘要（用于 toast 提示）
   * @param {Object} pushDetail - e.g. { tasks: 2, notes: 1 }
   * @param {Object} pullDetail - e.g. { tasks: 3, knowledge_nodes: 5 }
   * @returns {string} e.g. "↑ 任务2 记事1 | ↓ 任务3 知识5"
   */
  formatSyncSummary(pushDetail, pullDetail) {
    const TYPE_LABELS = {
      tasks: '任务',
      notes: '记事',
      knowledge_nodes: '知识',
      knowledge_edges: '知识',
      clipboard_memories: '剪贴板',
      assistant_conversations: '会话',
      assistant_messages: '会话消息',
      note_images: '图片'
    };

    const formatPart = (detail) => {
      if (!detail || Object.keys(detail).length === 0) return '';
      // 合并同类（knowledge_nodes + knowledge_edges → 知识）
      const merged = {};
      for (const [type, count] of Object.entries(detail)) {
        const label = TYPE_LABELS[type] || type;
        merged[label] = (merged[label] || 0) + count;
      }
      return Object.entries(merged).map(([label, count]) => `${label}${count}`).join(' ');
    };

    const pushStr = formatPart(pushDetail);
    const pullStr = formatPart(pullDetail);

    const parts = [];
    if (pushStr) parts.push(`↑ ${pushStr}`);
    if (pullStr) parts.push(`↓ ${pullStr}`);
    return parts.length > 0 ? parts.join(' | ') : '无变更';
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
  },

  // ===== 助手会话专属 API（便捷接口） =====

  /**
   * 获取云端会话列表
   * GET /memora/sync/conversations?page=&limit=&search=
   */
  async getConversations(options = {}) {
    try {
      return await window.electronAPI.syncConversations(options);
    } catch (e) {
      console.error('[Sync] getConversations failed:', e.message);
      return { ok: false, error: e.message };
    }
  },

  /**
   * 获取单个会话详情
   * GET /memora/sync/conversations/:id
   */
  async getConversation(convId) {
    try {
      return await window.electronAPI.syncConversationDetail(convId);
    } catch (e) {
      console.error('[Sync] getConversation failed:', e.message);
      return { ok: false, error: e.message };
    }
  },

  /**
   * 获取会话消息列表
   * GET /memora/sync/conversations/:id/messages?page=&limit=
   */
  async getConversationMessages(convId, options = {}) {
    try {
      return await window.electronAPI.syncConversationMessages(convId, options);
    } catch (e) {
      console.error('[Sync] getConversationMessages failed:', e.message);
      return { ok: false, error: e.message };
    }
  },

  /**
   * 追加消息到会话（流式完成后整条保存）
   * POST /memora/sync/conversations/:id/messages
   */
  async appendMessage(convId, message) {
    try {
      const result = await window.electronAPI.syncConversationAppendMessage(convId, message);
      // 同时标记本地 pending push
      if (result?.ok) {
        this.markDirty('assistant_messages', {
          id: message.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          conversation_id: convId,
          role: message.role,
          content: message.content,
          status: message.status || 'completed',
          message_index: message.message_index,
          revision: result.conversation_revision || 1
        });
      }
      return result;
    } catch (e) {
      console.error('[Sync] appendMessage failed:', e.message);
      return { ok: false, error: e.message };
    }
  },

  /**
   * 更新会话元数据
   * PUT /memora/sync/conversations/:id
   */
  async updateConversation(convId, updates) {
    try {
      const result = await window.electronAPI.syncConversationUpdate(convId, updates);
      if (result?.ok) {
        this.markDirty('assistant_conversations', {
          id: convId,
          ...updates,
          revision: result.revision || 1
        });
      }
      return result;
    } catch (e) {
      console.error('[Sync] updateConversation failed:', e.message);
      return { ok: false, error: e.message };
    }
  },

  /**
   * 删除会话（软删除 + 级联消息）
   * DELETE /memora/sync/conversations/:id
   */
  async deleteConversation(convId) {
    try {
      const result = await window.electronAPI.syncConversationDelete(convId);
      if (result?.ok) {
        this.markDeleted('assistant_conversations', { id: convId });
      }
      return result;
    } catch (e) {
      console.error('[Sync] deleteConversation failed:', e.message);
      return { ok: false, error: e.message };
    }
  },

  /**
   * 推送助手会话和消息到云端（标准 v3 push）
   * 适合创建会话、发送消息、AI回复完成等场景
   */
  async pushConversationsAndMessages(conversations = [], messages = []) {
    const changes = {};
    if (conversations.length > 0) changes.assistant_conversations = conversations;
    if (messages.length > 0) changes.assistant_messages = messages;
    if (Object.keys(changes).length === 0) return { ok: true, pushed: 0 };

    try {
      const result = await this.push(changes);
      return result;
    } catch (e) {
      console.error('[Sync] pushConversationsAndMessages failed:', e.message);
      return { ok: false, error: e.message };
    }
  },

  // ===== 图片同步 API（v3.1 新增）=====

  /**
   * 上传图片文件到服务端
   * @param {string} localPath - 本地图片绝对路径
   * @returns {Object} { ok, uploaded: [{ id, server_path, image_hash, width, height, ... }] }
   */
  async uploadNoteImage(localPath) {
    try {
      return await window.electronAPI.syncUploadNoteImage(localPath);
    } catch (e) {
      console.error('[Sync] uploadNoteImage failed:', e.message);
      return { ok: false, error: e.message };
    }
  },

  /**
   * 从服务端下载图片文件到本地
   * @param {string} imageId - 图片 ID（img_xxx）
   * @param {string} savePath - 本地保存绝对路径
   * @returns {Object} { ok, size, path }
   */
  async downloadNoteImage(imageId, savePath) {
    try {
      return await window.electronAPI.syncDownloadNoteImage(imageId, savePath);
    } catch (e) {
      console.error('[Sync] downloadNoteImage failed:', e.message);
      return { ok: false, error: e.message };
    }
  },

  /**
   * 删除服务端图片
   * @param {string} imageId - 图片 ID
   */
  async deleteNoteImage(imageId) {
    try {
      return await window.electronAPI.syncDeleteNoteImage(imageId);
    } catch (e) {
      console.error('[Sync] deleteNoteImage failed:', e.message);
      return { ok: false, error: e.message };
    }
  },

  /**
   * 增量拉取图片元数据（基于 revision）
   * @param {number} sinceRevision - 上次拉取的最大 revision
   * @returns {Object} { ok, images: [...], deleted_ids: [...], max_revision }
   */
  async syncPullImages(sinceRevision) {
    try {
      const rev = sinceRevision ?? this._getLastImageRevision();
      return await window.electronAPI.syncPullNoteImages(this._deviceId, rev);
    } catch (e) {
      console.error('[Sync] syncPullImages failed:', e.message);
      return { ok: false, error: e.message };
    }
  },

  /**
   * 批量下载待下载的图片文件
   * 先 syncPullImages 获取元数据，再逐个下载
   * @param {Array} notesWithServerImages - 含服务端 image_path 的笔记列表
   */
  async downloadPendingImages(notesWithServerImages) {
    if (!notesWithServerImages || notesWithServerImages.length === 0) return;

    for (const note of notesWithServerImages) {
      try {
        // 通过图片列表 API 按 note_id 查找图片 ID
        const imgListResult = await window.electronAPI.syncListNoteImages({ note_id: note.id, limit: 1 });

        if (imgListResult.ok && imgListResult.images?.length > 0) {
          const imgMeta = imgListResult.images[0];
          // 构造本地保存路径
          const localFilename = `sync_${imgMeta.filename}`;
          const localRelPath = `images/${localFilename}`;

          // 先检查本地是否已存在
          const exists = await this._checkLocalImageExists(localRelPath);
          if (exists) {
            // 更新笔记的 imagePath 指向本地路径
            this._updateNoteImagePath(note.id, localRelPath);
            continue;
          }

          // 下载图片到本地（通过主进程获取 userData 路径）
          const savePath = await this._getLocalImageAbsPath(localRelPath);
          const downloadResult = await window.electronAPI.syncDownloadNoteImage(imgMeta.id, savePath);

          if (downloadResult.ok) {
            this._updateNoteImagePath(note.id, localRelPath);
            console.log('[Sync] Image downloaded for note', note.id);
          }
        }
      } catch (e) {
        console.warn('[Sync] Image download error for note', note.id, ':', e.message);
      }
    }
  },

  /**
   * 完整流程：创建图片笔记（上传图片 → 标记同步）
   * @param {string} localImagePath - 本地图片路径
   * @param {string} title - 笔记标题
   * @param {string} content - 笔记内容
   * @returns {Object} { ok, note, uploadResult }
   */
  async createImageNote(localImagePath, title, content) {
    // 1. 上传图片到服务端
    const uploadResult = await this.uploadNoteImage(localImagePath);

    if (!uploadResult.ok || !uploadResult.uploaded?.length) {
      return { ok: false, error: uploadResult.error || '图片上传失败' };
    }

    const imgInfo = uploadResult.uploaded[0];

    // 2. 创建笔记（通过 App 的 addNote 逻辑）
    const note = {
      title: title || '图片笔记',
      content: content || '',
      category: 'image',
      imagePath: imgInfo.server_path,
      imageHash: imgInfo.image_hash || '',
      imageWidth: imgInfo.width || 0,
      imageHeight: imgInfo.height || 0,
    };

    // 3. 标记同步
    this.markDirty('notes', note);

    return { ok: true, note, uploadResult };
  },

  /**
   * 获取笔记的本地图片路径
   * @param {string} noteId - 笔记 ID
   * @returns {string|null} 本地图片相对路径
   */
  getNoteImagePath(noteId) {
    // 从 notebook 获取笔记信息
    if (typeof App !== 'undefined' && App._notebook) {
      const note = App._notebook.getNoteById(noteId);
      return note?.imagePath || null;
    }
    return null;
  },

  /**
   * fullSync 后触发图片增量拉取 + 下载
   * 在 fullSync 成功后自动调用
   */
  async _syncImagesAfterPull() {
    try {
      const sinceRevision = this._getLastImageRevision();
      const result = await this.syncPullImages(sinceRevision);

      if (result.ok && result.images?.length > 0) {
        console.log('[Sync] Pulled', result.images.length, 'image metadata, downloading...');
        await this.downloadPendingImages(result.images);

        // 更新 image revision 游标
        if (result.max_revision > 0) {
          this._saveLastImageRevision(result.max_revision);
        }
      }

      // 处理已删除的图片
      if (result.ok && result.deleted_ids?.length > 0) {
        for (const { id } of result.deleted_ids) {
          console.log('[Sync] Server-deleted image:', id);
        }
      }
    } catch (e) {
      console.warn('[Sync] Post-sync image pull failed:', e.message);
    }
  },

  /**
   * 下载拉取笔记中的服务端图片（后台异步）
   */
  async _downloadPendingNoteImages(notes) {
    // 后台异步执行，不阻塞同步主流程
    setTimeout(async () => {
      try {
        await this.downloadPendingImages(notes);
      } catch (e) {
        console.warn('[Sync] Background image download failed:', e.message);
      }
    }, 500);
  },

  /**
   * 通过主进程 IPC 将拉取的笔记写入本地 notebook
   */
  async _applyPulledNotes(pulledNotes) {
    if (!pulledNotes || pulledNotes.length === 0) return;

    for (const note of pulledNotes) {
      // 防回声
      if (note.originDeviceId === this._deviceId) continue;
      if (note.deletedAt) continue;

      try {
        // 通过主进程 IPC 写入（addNote / updateNote）
        const result = await window.electronAPI.notebookAddNote({
          id: note.id,
          title: note.title,
          content: note.content,
          category: note.category,
          tags: note.tags,
          imagePath: note.imagePath || '',
          imageHash: note.imageHash || '',
          imageWidth: note.imageWidth || 0,
          imageHeight: note.imageHeight || 0,
          revision: note.revision,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        });

        if (result) {
          console.log('[Sync] Note applied:', note.id);
        }
      } catch (e) {
        console.warn('[Sync] Failed to apply note:', note.id, e.message);
      }
    }
  },

  /**
   * 更新笔记的 imagePath（图片下载后）
   */
  _updateNoteImagePath(noteId, localRelPath) {
    if (typeof App !== 'undefined' && App._notebook) {
      try {
        App._notebook.updateNote(noteId, { imagePath: localRelPath });
      } catch (e) {
        console.warn('[Sync] Failed to update note image path:', noteId, e.message);
      }
    }
  },

  /**
   * 检查本地图片是否已存在
   */
  async _checkLocalImageExists(localRelPath) {
    try {
      const result = await window.electronAPI.notebookGetImage(localRelPath);
      return result?.success === true;
    } catch {
      return false;
    }
  },

  /**
   * 获取本地图片绝对路径
   */
  async _getLocalImageAbsPath(localRelPath) {
    // 通过主进程获取 userData 路径并拼接
    try {
      const userDataPath = await window.electronAPI.getUserDataPath?.();
      if (userDataPath) {
        const absPath = userDataPath + '/notebook/' + localRelPath;
        return absPath.replace(/\/+/g, '/');
      }
    } catch {}
    // fallback：返回相对路径，由主进程处理
    return localRelPath;
  },

  // ===== revision 游标管理 =====

  _getLastImageRevision() {
    try {
      const raw = localStorage.getItem('memora_sync_last_image_revision');
      return raw ? parseInt(raw) : 0;
    } catch { return 0; }
  },

  _saveLastImageRevision(revision) {
    localStorage.setItem('memora_sync_last_image_revision', String(revision));
  },

  /**
   * 拉取助手会话和消息（标准 v3 pull）
   */
  async pullConversationsAndMessages(sinceRevision) {
    try {
      return await this.pull(['assistant_conversations', 'assistant_messages'], sinceRevision);
    } catch (e) {
      console.error('[Sync] pullConversationsAndMessages failed:', e.message);
      return { ok: false, error: e.message };
    }
  },
};

window.SyncEngine = SyncEngine;
