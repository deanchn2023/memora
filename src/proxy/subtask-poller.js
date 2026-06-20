/**
 * SubTask Polling Manager
 *
 * Monitors asynchronous background tasks (e.g., Volcano Engine Deep Research)
 * that CC Agent starts but doesn't wait for. Polls task status at intervals
 * and pushes progress updates to the renderer via cc:stream.
 *
 * Design doc: docs/design/subtask-polling-design.md (Solution A)
 */

// ─── Task ID Detection ───

// Priority-ordered patterns. Earlier patterns = higher confidence.
// ARK API ID prefixes (from official docs):
//   wf_       — workflow run ID (CC Agent internal)
//   resp_     — Responses API response ID (GET /responses/{id})
//   task_     — Content Generation task ID (GET /contents/generations/tasks/{id})
//   conv_     — Conversations ID (async chat completions)
// Generic patterns are lower priority fallbacks.
const TASK_ID_PATTERNS = [
  // ── Tier 1: Prefixed IDs (highest confidence, ARK API known formats) ──
  // wf_ prefix — workflow run ID (e.g., wf_e59a844a-8c5)
  { pattern: /\b(wf_[A-Za-z0-9_\-]{4,60})\b/g, confidence: 0.95, source: 'wf_-prefix' },
  // resp_ prefix — ARK Responses API ID (e.g., resp_xxxx)
  { pattern: /\b(resp_[A-Za-z0-9_\-]{4,60})\b/g, confidence: 0.92, source: 'resp_-prefix' },
  // task_ prefix — ARK Content Generation task ID (e.g., task_xxxx)
  { pattern: /\b(task_[A-Za-z0-9_\-]{4,60})\b/g, confidence: 0.90, source: 'task_-prefix' },
  // conv_ prefix — ARK Conversations ID
  { pattern: /\b(conv_[A-Za-z0-9_\-]{4,60})\b/g, confidence: 0.88, source: 'conv_-prefix' },

  // ── Tier 2: Labeled IDs (explicit "ID:" prefix in text) ──
  // Chinese: 任务 ID：xxx / 任务ID: xxx
  { pattern: /任务[\s]*ID[：:]\s*([A-Za-z0-9_\-]{4,40})/gi, confidence: 0.85, source: 'labeled-cn-task' },
  // Chinese: 工作流 ID：xxx / 工作流ID xxx
  { pattern: /工作流[\s]*(?:ID[：:]?\s*)?([A-Za-z0-9_\-]{4,40})/gi, confidence: 0.82, source: 'labeled-cn-workflow' },
  // English: task_id: xxx / Task ID: xxx
  { pattern: /task[_\s]*id[：:]\s*([A-Za-z0-9_\-]{4,40})/gi, confidence: 0.80, source: 'labeled-en-task' },
  // English: Run ID: xxx / run_id: xxx
  { pattern: /run[_\s]*id[：:]\s*([A-Za-z0-9_\-]{4,40})/gi, confidence: 0.78, source: 'labeled-en-run' },
  // English: conversation_id: xxx / session_id: xxx
  { pattern: /(?:conversation|session)[_\s]*id[：:]\s*([A-Za-z0-9_\-]{4,40})/gi, confidence: 0.75, source: 'labeled-session' },

  // ── Tier 3: Context-adjacent IDs (keyword nearby) ──
  // Deep Research context: "deep research" followed by an ID
  { pattern: /(?:deep.?research|深度研究)[^\n]*?(?:id[：:]\s*)?([a-z0-9_\-]{6,40})/gi, confidence: 0.60, source: 'ctx-deep-research' },
  // Workflow context: "workflow" followed by an ID
  { pattern: /workflow[^\n]*?([a-z0-9_\-]{6,40})/gi, confidence: 0.55, source: 'ctx-workflow' },
];

/**
 * Extract potential task IDs from CC result text.
 * Returns array of { id, source, confidence } sorted by confidence (descending).
 * All candidates are returned — caller should poll all of them.
 */
function extractTaskIds(resultText) {
  const found = [];

  for (const { pattern, confidence, source } of TASK_ID_PATTERNS) {
    const matches = [...resultText.matchAll(pattern)];
    for (const match of matches) {
      const id = match[1];
      // Deduplicate — keep highest confidence
      const existing = found.find(f => f.id === id);
      if (!existing) {
        found.push({ id, source, confidence });
      } else if (confidence > existing.confidence) {
        existing.confidence = confidence;
        existing.source = source;
      }
    }
  }

  // Also look for standalone ID-like tokens near keywords (lowest priority)
  const keywordContext = /(?:任务|task|工作流|workflow|deep.?research|深度研究)/gi;
  let ctxMatch;
  while ((ctxMatch = keywordContext.exec(resultText)) !== null) {
    const afterText = resultText.substring(ctxMatch.index, ctxMatch.index + 100);
    const idMatch = afterText.match(/[：:]\s*([A-Za-z0-9_\-]{6,40})/);
    if (idMatch && !found.some(f => f.id === idMatch[1])) {
      found.push({ id: idMatch[1], source: 'keyword-context', confidence: 0.45 });
    }
  }

  // Sort by confidence descending
  found.sort((a, b) => b.confidence - a.confidence);

  return found;
}

// ─── Polling State ───

class PollState {
  constructor(taskId, sessionId, providerConfig, onEvent) {
    this.taskId = taskId;
    this.sessionId = sessionId;
    this.providerConfig = providerConfig; // { type: 'volcano'|'tencent'|'custom', baseUrl, apiKey, ... }
    this.onEvent = onEvent; // callback(data)
    this.timer = null;
    this.startTime = Date.now();
    this.lastStatus = null;
    this.consecutiveUnchanged = 0;
    this.currentInterval = 10 * 1000; // Start at 10s
    this.maxWaitMs = 10 * 60 * 1000; // 10 minutes
    this.minInterval = 10 * 1000;
    this.maxInterval = 30 * 1000;
    this.errorRetryCount = 0;
    this.maxErrorRetries = 5;
    this.notFoundCount = 0;
    this.maxNotFoundRetries = 3; // After 3 "not found" responses, give up
  }

  get elapsed() {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  get isExpired() {
    return Date.now() - this.startTime > this.maxWaitMs;
  }

  /**
   * Adaptive backoff: increase interval when status doesn't change
   */
  nextInterval() {
    if (this.consecutiveUnchanged >= 6) return this.maxInterval;
    if (this.consecutiveUnchanged >= 3) return 20 * 1000;
    return this.minInterval;
  }
}

// ─── SubTask Poller ───

class SubTaskPoller {
  constructor() {
    this.activePollers = new Map(); // taskId → PollState
    this.mainWindow = null;
  }

  setMainWindow(win) {
    this.mainWindow = win;
  }

  /**
   * Start polling a subtask
   * @param {string} taskId - The async task ID
   * @param {string} sessionId - CC session ID (for potential auto-continue)
   * @param {object} providerConfig - Provider config for API calls
   * @param {function} [onEvent] - Optional callback (in addition to cc:stream)
   */
  start(taskId, sessionId, providerConfig, onEvent) {
    if (this.activePollers.has(taskId)) {
      console.log(`[SubTask] Already polling ${taskId}, skipping`);
      return;
    }

    const state = new PollState(taskId, sessionId, providerConfig, onEvent);
    this.activePollers.set(taskId, state);

    console.log(`[SubTask] Starting poll for task: ${taskId} | provider: ${providerConfig?.type || 'unknown'}`);

    // Notify frontend
    this._send(taskId, {
      event: 'subtask_start',
      taskId,
      message: `开始监控子任务: ${taskId}`,
    });

    // Initial poll immediately
    this._poll(taskId);

    // Schedule recurring polls with adaptive interval
    this._scheduleNext(taskId);
  }

  _scheduleNext(taskId) {
    const state = this.activePollers.get(taskId);
    if (!state) return;

    const interval = state.nextInterval();
    state.timer = setTimeout(() => {
      this._poll(taskId).then(() => {
        this._scheduleNext(taskId);
      });
    }, interval);
  }

  async _poll(taskId) {
    const state = this.activePollers.get(taskId);
    if (!state) return;

    // Timeout check
    if (state.isExpired) {
      this._send(taskId, {
        event: 'subtask_timeout',
        taskId,
        message: `子任务执行超时（>${Math.floor(state.maxWaitMs / 60000)}分钟）`,
        elapsed: state.elapsed,
      });
      this.stop(taskId);
      return;
    }

    try {
      const status = await this._queryTaskStatus(taskId, state.providerConfig);

      // Task not found
      if (status.notFound) {
        state.notFoundCount++;
        if (state.notFoundCount >= state.maxNotFoundRetries) {
          this._send(taskId, {
            event: 'subtask_not_found',
            taskId,
            message: `任务 ${taskId} 未找到（已重试 ${state.notFoundCount} 次）。可能任务ID不正确或已过期。`,
            elapsed: state.elapsed,
          });
          this.stop(taskId);
          return;
        }
        // Still retrying
        this._send(taskId, {
          event: 'subtask_progress',
          taskId,
          state: 'querying',
          message: `查询任务状态中... (未找到，重试 ${state.notFoundCount}/${state.maxNotFoundRetries})`,
          elapsed: state.elapsed,
        });
        return;
      }

      // Reset not-found counter on successful query
      state.notFoundCount = 0;
      state.errorRetryCount = 0;

      // Status changed?
      const statusKey = `${status.state}|${status.stage || ''}|${status.progress || 0}`;
      if (statusKey !== state.lastStatus) {
        state.lastStatus = statusKey;
        state.consecutiveUnchanged = 0;
        this._send(taskId, {
          event: 'subtask_progress',
          taskId,
          state: status.state,
          stage: status.stage,
          progress: status.progress,
          message: status.message,
          elapsed: state.elapsed,
        });
      } else {
        state.consecutiveUnchanged++;
        // Periodic heartbeat (every ~30s) so user knows we're still watching
        if (state.consecutiveUnchanged % 3 === 0) {
          this._send(taskId, {
            event: 'subtask_progress',
            taskId,
            state: status.state,
            stage: status.stage,
            progress: status.progress,
            message: status.message || `执行中...`,
            elapsed: state.elapsed,
          });
        }
      }

      // Task completed
      if (status.state === 'completed' || status.state === 'succeeded' || status.state === 'done') {
        const result = status.result || (await this._getTaskResult(taskId, state.providerConfig));
        this._send(taskId, {
          event: 'subtask_done',
          taskId,
          result,
          elapsed: state.elapsed,
        });
        this.stop(taskId);
      } else if (status.state === 'failed' || status.state === 'error' || status.state === 'cancelled') {
        this._send(taskId, {
          event: 'subtask_error',
          taskId,
          error: status.error || status.message || '子任务执行失败',
          state: status.state,
          elapsed: state.elapsed,
        });
        this.stop(taskId);
      }
    } catch (e) {
      console.error(`[SubTask] Poll error for ${taskId}:`, e.message);
      state.errorRetryCount++;

      if (state.errorRetryCount >= state.maxErrorRetries) {
        this._send(taskId, {
          event: 'subtask_error',
          taskId,
          error: `查询失败（连续 ${state.errorRetryCount} 次错误）: ${e.message}`,
          elapsed: state.elapsed,
        });
        this.stop(taskId);
        return;
      }

      // Network error — don't stop, just notify
      this._send(taskId, {
        event: 'subtask_progress',
        taskId,
        state: 'retrying',
        message: `网络重试中 (${state.errorRetryCount}/${state.maxErrorRetries})...`,
        elapsed: state.elapsed,
      });
    }
  }

  /**
   * Query task status from provider API.
   * Supports multiple providers with different API formats.
   */
  async _queryTaskStatus(taskId, providerConfig) {
    const { type } = providerConfig;

    if (type === 'volcano') {
      return this._queryVolcano(taskId, providerConfig);
    } else if (type === 'tencent') {
      return this._queryTencent(taskId, providerConfig);
    }

    // Generic / custom: try all ARK API patterns
    return this._queryGeneric(taskId, providerConfig);
  }

  /**
   * Derive the ARK API base URL from the provider's baseUrl.
   * Coding Plan baseUrl is like: https://ark.cn-beijing.volces.com/api/coding
   * Standard ARK baseUrl is like:  https://ark.cn-beijing.volces.com/api/v3
   * Both need /v3 suffix for API calls.
   */
  _deriveArkApiBase(providerBaseUrl) {
    let base = (providerBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
    // If baseUrl ends with /api/coding (Coding Plan), append /v3
    if (/\/api\/coding$/i.test(base)) {
      base = base + '/v3';
    }
    // If baseUrl ends with /api (no version), append /v3
    if (/\/api$/i.test(base)) {
      base = base + '/v3';
    }
    return base;
  }

  /**
   * Build endpoint candidates for a task ID based on its prefix.
   * ARK API has multiple async task patterns:
   *   - Responses API:         GET /responses/{id}          (resp_ prefix)
   *   - Content Generation:    GET /contents/generations/tasks/{id}  (task_ prefix)
   *   - Async Chat Completions: GET /async/chat/completions/{id}    (conv_ or generic)
   *   - Deep Research (legacy): GET /deep-research/tasks/{id}       (generic)
   */
  _buildVolcanoEndpoints(apiBase, taskId) {
    const endpoints = [];

    // Prefix-based routing (highest priority)
    if (taskId.startsWith('resp_')) {
      // ARK Responses API
      endpoints.push(`${apiBase}/responses/${taskId}`);
    } else if (taskId.startsWith('task_')) {
      // ARK Content Generation API
      endpoints.push(`${apiBase}/contents/generations/tasks/${taskId}`);
    } else if (taskId.startsWith('conv_')) {
      // ARK Conversations API
      endpoints.push(`${apiBase}/async/chat/completions/${taskId}`);
      endpoints.push(`${apiBase}/conversations/${taskId}`);
    } else if (taskId.startsWith('wf_')) {
      // Workflow run ID — try all patterns since format is uncertain
      endpoints.push(`${apiBase}/responses/${taskId}`);
      endpoints.push(`${apiBase}/contents/generations/tasks/${taskId}`);
      endpoints.push(`${apiBase}/async/chat/completions/${taskId}`);
      endpoints.push(`${apiBase}/deep-research/tasks/${taskId}`);
      endpoints.push(`${apiBase}/workflows/${taskId}`);
      endpoints.push(`${apiBase}/tasks/${taskId}`);
    } else {
      // Generic — try all patterns
      endpoints.push(`${apiBase}/responses/${taskId}`);
      endpoints.push(`${apiBase}/contents/generations/tasks/${taskId}`);
      endpoints.push(`${apiBase}/async/chat/completions/${taskId}`);
      endpoints.push(`${apiBase}/deep-research/tasks/${taskId}`);
      endpoints.push(`${apiBase}/tasks/${taskId}`);
    }

    return endpoints;
  }

  /**
   * Query Volcano Engine (火山引擎) ARK API task status.
   * Supports multiple ARK async task patterns (Responses API, Content Generation, Deep Research).
   */
  async _queryVolcano(taskId, config) {
    const apiBase = this._deriveArkApiBase(config.baseUrl);
    const apiKey = config.apiKey;

    const endpoints = this._buildVolcanoEndpoints(apiBase, taskId);

    for (const url of endpoints) {
      try {
        const resp = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (resp.status === 404) {
          continue; // Try next endpoint
        }

        if (!resp.ok) {
          const errText = await resp.text();
          console.warn(`[SubTask] Volcano API ${url} → ${resp.status}: ${errText.substring(0, 200)}`);
          continue;
        }

        const data = await resp.json();
        console.log(`[SubTask] Volcano API hit: ${url} → status=${data.status || data.state || 'unknown'}`);
        return this._normalizeVolcanoStatus(data);
      } catch (e) {
        console.warn(`[SubTask] Volcano endpoint ${url} failed:`, e.message);
        continue;
      }
    }

    return { notFound: true, state: 'unknown' };
  }

  _normalizeVolcanoStatus(data) {
    // ARK API status field can be: status, state, or task_status
    const state = data.status || data.state || data.task_status || 'running';
    const stage = data.stage || data.phase || data.current_step || data.step || '';
    const progress = data.progress || data.percentage ||
      (data.steps_completed && data.steps_total ? Math.round(data.steps_completed / data.steps_total * 100) : null);
    const message = data.message || data.description || data.detail || '';

    // Map ARK API states to normalized states
    // ARK Responses API: queued, in_progress, completed, failed, incomplete, cancelled
    // ARK Content Generation: queued, processing, completed, failed
    // ARK Deep Research: running, succeeded, failed
    let normalizedState = 'running';
    const lowerState = state.toLowerCase();
    if (['completed', 'succeeded', 'success', 'done', 'finished'].includes(lowerState)) {
      normalizedState = 'completed';
    } else if (['failed', 'error'].includes(lowerState)) {
      normalizedState = 'failed';
    } else if (['cancelled', 'canceled'].includes(lowerState)) {
      normalizedState = 'failed';
    } else if (['incomplete'].includes(lowerState)) {
      // incomplete = stopped early (e.g., token limit) — treat as completed with partial result
      normalizedState = 'completed';
    } else if (['queued', 'pending', 'waiting'].includes(lowerState)) {
      normalizedState = 'running';
    } else if (['running', 'processing', 'in_progress', 'in-progress'].includes(lowerState)) {
      normalizedState = 'running';
    }

    // Extract result from various ARK response shapes
    let result = null;
    if (data.output) {
      // Responses API: data.output is either object or array
      if (Array.isArray(data.output)) {
        // Responses API array format: [{ type: "message", content: [{ type: "output_text", text: "..." }] }]
        const texts = [];
        for (const item of data.output) {
          if (item.content && Array.isArray(item.content)) {
            for (const c of item.content) {
              if (c.text) texts.push(c.text);
            }
          }
        }
        result = texts.length > 0 ? texts.join('\n') : null;
      } else if (typeof data.output === 'string') {
        result = data.output;
      } else if (data.output.content) {
        result = typeof data.output.content === 'string' ? data.output.content : JSON.stringify(data.output.content);
      }
    }
    if (!result) result = data.result || data.content || data.html || null;

    return {
      state: normalizedState,
      stage,
      progress,
      message,
      result,
    };
  }

  /**
   * Query Tencent Cloud (腾讯云) Coding Plan task status.
   * Uses ARK-compatible API, same endpoint patterns as Volcano.
   */
  async _queryTencent(taskId, config) {
    const baseUrl = (config.baseUrl || 'https://api.lkeap.cloud.tencent.com/coding/v3').replace(/\/+$/, '');
    const apiKey = config.apiKey;

    // Use same endpoint builder as Volcano for ARK-compatible APIs
    const endpoints = this._buildVolcanoEndpoints(baseUrl, taskId);

    for (const url of endpoints) {
      try {
        const resp = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (resp.status === 404) continue;
        if (!resp.ok) {
          const errText = await resp.text();
          console.warn(`[SubTask] Tencent API ${url} → ${resp.status}: ${errText.substring(0, 200)}`);
          continue;
        }

        const data = await resp.json();
        console.log(`[SubTask] Tencent API hit: ${url} → status=${data.status || data.state || 'unknown'}`);
        return this._normalizeVolcanoStatus(data);
      } catch (e) {
        console.warn(`[SubTask] Tencent endpoint ${url} failed:`, e.message);
        continue;
      }
    }

    return { notFound: true, state: 'unknown' };
  }

  /**
   * Generic query — tries common REST patterns.
   */
  async _queryGeneric(taskId, config) {
    const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    const apiKey = config.apiKey;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    // Use same endpoint builder as Volcano for consistency
    const endpoints = this._buildVolcanoEndpoints(baseUrl, taskId);
    // Also try generic REST patterns
    endpoints.push(`${baseUrl}/research/${taskId}`);

    for (const url of endpoints) {
      try {
        const resp = await fetch(url, { headers });
        if (resp.status === 404) continue;
        if (!resp.ok) continue;
        const data = await resp.json();
        return this._normalizeVolcanoStatus(data);
      } catch (_) {
        continue;
      }
    }

    return { notFound: true, state: 'unknown' };
  }

  /**
   * Get full task result (called when status is completed but result not in status response)
   */
  async _getTaskResult(taskId, config) {
    const { type } = config;
    let apiBase;

    if (type === 'volcano') {
      apiBase = this._deriveArkApiBase(config.baseUrl);
    } else if (type === 'tencent') {
      apiBase = (config.baseUrl || 'https://api.lkeap.cloud.tencent.com/coding/v3').replace(/\/+$/, '');
    } else {
      apiBase = (config.baseUrl || '').replace(/\/+$/, '');
    }

    const apiKey = config.apiKey;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    // Build result-fetching endpoints based on task ID prefix
    const endpoints = [];
    if (taskId.startsWith('resp_')) {
      endpoints.push(`${apiBase}/responses/${taskId}`);
    } else if (taskId.startsWith('task_')) {
      endpoints.push(`${apiBase}/contents/generations/tasks/${taskId}`);
    } else if (taskId.startsWith('wf_')) {
      endpoints.push(`${apiBase}/responses/${taskId}`);
      endpoints.push(`${apiBase}/contents/generations/tasks/${taskId}`);
    } else {
      endpoints.push(`${apiBase}/responses/${taskId}`);
      endpoints.push(`${apiBase}/contents/generations/tasks/${taskId}`);
    }
    // Generic fallbacks
    endpoints.push(`${apiBase}/deep-research/tasks/${taskId}/result`);
    endpoints.push(`${apiBase}/tasks/${taskId}/result`);
    endpoints.push(`${apiBase}/tasks/${taskId}`);

    for (const url of endpoints) {
      try {
        const resp = await fetch(url, { headers });
        if (!resp.ok) continue;
        const data = await resp.json();
        // Extract result from various ARK response shapes
        if (data.output) {
          if (typeof data.output === 'string') return data.output;
          if (Array.isArray(data.output)) {
            const texts = [];
            for (const item of data.output) {
              if (item.content && Array.isArray(item.content)) {
                for (const c of item.content) {
                  if (c.text) texts.push(c.text);
                }
              }
            }
            if (texts.length > 0) return texts.join('\n');
          }
        }
        return data.result || data.output || data.content || data.html || JSON.stringify(data, null, 2);
      } catch (_) {
        continue;
      }
    }

    return null;
  }

  _send(taskId, data) {
    console.log(`[SubTask] ${data.event} | task: ${taskId} | ${data.message || data.state || ''} | elapsed: ${data.elapsed || 0}s`);
    if (this.mainWindow) {
      // Use separate channel 'cc:subtask' to avoid conflict with cc:stream lifecycle
      // (cc:stream listeners are removed after 'done' event, but subtask polling continues)
      this.mainWindow.webContents.send('cc:subtask', { ...data, _subtask: true });
    }
    // Also call the optional callback
    const state = this.activePollers.get(taskId);
    if (state?.onEvent) {
      try { state.onEvent(data); } catch (_) {}
    }
  }

  stop(taskId) {
    const state = this.activePollers.get(taskId);
    if (state?.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    this.activePollers.delete(taskId);
    console.log(`[SubTask] Stopped polling for ${taskId}`);
  }

  stopAll() {
    for (const taskId of this.activePollers.keys()) {
      this.stop(taskId);
    }
  }

  getActiveTasks() {
    return Array.from(this.activePollers.keys()).map(taskId => {
      const state = this.activePollers.get(taskId);
      return { taskId, elapsed: state.elapsed, lastStatus: state.lastStatus };
    });
  }
}

const subTaskPoller = new SubTaskPoller();

module.exports = { SubTaskPoller, subTaskPoller, extractTaskIds };
