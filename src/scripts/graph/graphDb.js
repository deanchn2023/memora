/**
 * GraphDB - sql.js (SQLite) 知识图谱数据库层
 * 负责：初始化 Schema / CRUD / FTS5 检索 / 图遍历 / 体检报告
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class GraphDB {
  constructor(userDataPath) {
    this.dbDir = path.join(userDataPath, 'knowledge');
    this.dbPath = path.join(this.dbDir, 'knowledge-graph.db');
    this.db = null;
    // 确保 sql.js WASM 文件路径
    this._sqlJsPath = path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist');
  }

  async init() {
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
    }
    const SQL = await initSqlJs({
      locateFile: file => path.join(this._sqlJsPath, file)
    });

    if (fs.existsSync(this.dbPath)) {
      try {
        const buffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(buffer);
      } catch (e) {
        console.error('[GraphDB] Failed to load existing db, creating new one:', e.message);
        this.db = new SQL.Database();
      }
    } else {
      this.db = new SQL.Database();
    }
    this._createTables();
    this.save();
    console.log('[GraphDB] Initialized at', this.dbPath);
    return this;
  }

  _createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        domain TEXT,
        density TEXT DEFAULT 'moderate',
        health TEXT DEFAULT 'healthy',
        health_detail TEXT,
        summary TEXT,
        stats TEXT,
        source_ids TEXT,
        weight INTEGER DEFAULT 5,
        extra TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        strength REAL DEFAULT 0.5,
        label TEXT,
        extra TEXT,
        created_at TEXT NOT NULL
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS health_reports (
        id TEXT PRIMARY KEY,
        report_type TEXT NOT NULL DEFAULT 'full',
        built_at TEXT NOT NULL,
        node_count INTEGER DEFAULT 0,
        edge_count INTEGER DEFAULT 0,
        summary TEXT,
        gaps TEXT,
        outdated TEXT,
        conflicts TEXT,
        duplicates TEXT,
        orphans TEXT,
        suggestions TEXT
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // 索引
    this.db.run('CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_nodes_domain ON nodes(domain)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_nodes_health ON nodes(health)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_nodes_density ON nodes(density)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_health_built ON health_reports(built_at)');

    // FTS5（可选，降级为 LIKE 搜索）
    this._hasFts = false;
    try {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
          id, label, summary, domain, properties,
          content='nodes', content_rowid='rowid'
        );
      `);
      this._hasFts = true;
    } catch (e) {
      // FTS5 不可用，降级为 LIKE 搜索
      console.log('[GraphDB] FTS5 not available, using LIKE search fallback');
    }
  }

  save() {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (e) {
      console.error('[GraphDB] Save error:', e);
    }
  }

  // ========== 节点操作 ==========

  upsertNodes(nodes) {
    if (!nodes || nodes.length === 0) return;
    this.db.run('BEGIN TRANSACTION');
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO nodes
      (id, type, label, domain, density, health, health_detail, summary, stats, source_ids, weight, extra, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of nodes) {
      stmt.run([
        n.id, n.type, n.label, n.domain || '', n.density || 'moderate',
        n.health || 'healthy',
        this._json(n.health_detail),
        n.summary || '',
        this._json(n.stats),
        this._json(n.source_ids),
        n.weight || 5,
        this._json(n.extra),
        n.created_at || new Date().toISOString(),
        n.updated_at || new Date().toISOString()
      ]);
    }
    stmt.free();
    this.db.run('COMMIT');
    this.save();
  }

  getNodes(filter = {}) {
    let sql = 'SELECT * FROM nodes WHERE 1=1';
    const params = [];
    if (filter.type) { sql += ' AND type = ?'; params.push(filter.type); }
    if (filter.domain) { sql += ' AND domain = ?'; params.push(filter.domain); }
    if (filter.density) { sql += ' AND density = ?'; params.push(filter.density); }
    if (filter.health && filter.health !== 'healthy') { sql += ' AND health = ?'; params.push(filter.health); }
    if (filter.health === 'healthy') { sql += ' AND health = ?'; params.push('healthy'); }
    sql += ' ORDER BY weight DESC, updated_at DESC';
    if (filter.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }
    return this._query(sql, params);
  }

  getNodeById(id) {
    const rows = this._query('SELECT * FROM nodes WHERE id = ?', [id]);
    return rows[0] || null;
  }

  updateNode(id, updates) {
    const fields = [];
    const values = [];
    for (const [k, v] of Object.entries(updates)) {
      if (['type', 'label', 'domain', 'density', 'health', 'summary', 'weight'].includes(k)) {
        fields.push(`${k} = ?`);
        values.push(v);
      } else if (['health_detail', 'stats', 'source_ids', 'extra'].includes(k)) {
        fields.push(`${k} = ?`);
        values.push(this._json(v));
      }
    }
    if (fields.length === 0) return;
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    this.db.run(`UPDATE nodes SET ${fields.join(', ')} WHERE id = ?`, values);
    this.save();
  }

  deleteNode(id) {
    this.db.run('DELETE FROM edges WHERE source_id = ? OR target_id = ?', [id, id]);
    this.db.run('DELETE FROM nodes WHERE id = ?', [id]);
    this.save();
  }

  searchNodes(query, limit = 20) {
    if (this._hasFts) {
      try {
        const ftsQuery = query.replace(/'/g, "''").split(/\s+/).map(w => `${w}*`).join(' OR ');
        return this._query(
          'SELECT n.* FROM nodes n JOIN nodes_fts f ON n.id = f.id WHERE nodes_fts MATCH ? ORDER BY rank LIMIT ?',
          [ftsQuery, limit]
        );
      } catch (e) {
        // FTS5 查询失败，降级
      }
    }
    // LIKE 降级
    return this._query(
      "SELECT * FROM nodes WHERE label LIKE ? OR summary LIKE ? OR domain LIKE ? ORDER BY weight DESC LIMIT ?",
      [`%${query}%`, `%${query}%`, `%${query}%`, limit]
    );
  }

  // ========== 边操作 ==========

  upsertEdges(edges) {
    if (!edges || edges.length === 0) return;
    this.db.run('BEGIN TRANSACTION');
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO edges (id, source_id, target_id, type, strength, label, extra, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of edges) {
      const eid = e.id || `${e.source_id}_${e.type}_${e.target_id}`;
      stmt.run([eid, e.source_id, e.target_id, e.type, e.strength || 0.5, e.label || '', this._json(e.extra), new Date().toISOString()]);
    }
    stmt.free();
    this.db.run('COMMIT');
    this.save();
  }

  getEdges(filter = {}) {
    let sql = 'SELECT * FROM edges WHERE 1=1';
    const params = [];
    if (filter.source_id) { sql += ' AND source_id = ?'; params.push(filter.source_id); }
    if (filter.target_id) { sql += ' AND target_id = ?'; params.push(filter.target_id); }
    if (filter.type) { sql += ' AND type = ?'; params.push(filter.type); }
    return this._query(sql, params);
  }

  getAllEdges() {
    return this._query('SELECT * FROM edges', []);
  }

  // ========== 图遍历 ==========

  getNeighbors(nodeId, depth = 1) {
    try {
      return this._query(`
        WITH RECURSIVE gt(id, depth) AS (
          VALUES (?, 0)
          UNION ALL
          SELECT
            CASE WHEN e.source_id = gt.id THEN e.target_id ELSE e.source_id END,
            gt.depth + 1
          FROM edges e
          JOIN gt ON (e.source_id = gt.id OR e.target_id = gt.id)
          WHERE gt.depth < ?
        )
        SELECT DISTINCT n.* FROM nodes n
        JOIN gt ON n.id = gt.id
        WHERE gt.depth > 0
      `, [nodeId, depth]);
    } catch (e) {
      console.error('[GraphDB] getNeighbors error:', e);
      return [];
    }
  }

  getSubgraph(nodeId) {
    const node = this.getNodeById(nodeId);
    if (!node) return { nodes: [], edges: [] };

    // 获取该节点所有关联（2跳内）
    const neighborNodes = this.getNeighbors(nodeId, 2);
    const allNodeIds = new Set([nodeId, ...neighborNodes.map(n => n.id)]);

    const allEdges = this.getAllEdges().filter(e =>
      allNodeIds.has(e.source_id) && allNodeIds.has(e.target_id)
    );

    return {
      nodes: [node, ...neighborNodes],
      edges: allEdges
    };
  }

  // ========== 体检报告 ==========

  saveHealthReport(report) {
    const id = `report_${Date.now()}`;
    this.db.run(`
      INSERT OR REPLACE INTO health_reports
      (id, report_type, built_at, node_count, edge_count, summary, gaps, outdated, conflicts, duplicates, orphans, suggestions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, report.report_type || 'full', report.built_at || new Date().toISOString(),
      report.node_count || 0, report.edge_count || 0,
      this._json(report.summary),
      this._json(report.gaps),
      this._json(report.outdated),
      this._json(report.conflicts),
      this._json(report.duplicates),
      this._json(report.orphans),
      this._json(report.suggestions)
    ]);
    this.save();
    return id;
  }

  getLatestHealthReport() {
    const rows = this._query('SELECT * FROM health_reports ORDER BY built_at DESC LIMIT 1');
    return rows[0] || null;
  }

  // ========== 缓存状态 ==========

  isStale() {
    const rows = this._query("SELECT value FROM config WHERE key = 'graph_stale'");
    return rows.length > 0 && rows[0].value === '1';
  }

  markStale() {
    this.db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('graph_stale', '1')");
    this.save();
  }

  clearStale() {
    this.db.run("DELETE FROM config WHERE key = 'graph_stale'");
    this.save();
  }

  getBuiltAt() {
    const report = this.getLatestHealthReport();
    return report?.built_at || null;
  }

  // ========== 统计 ==========

  getStats() {
    const nodes = this._query('SELECT COUNT(*) as count FROM nodes');
    const edges = this._query('SELECT COUNT(*) as count FROM edges');
    const healthDist = this._query('SELECT health, COUNT(*) as count FROM nodes GROUP BY health');
    const densityDist = this._query('SELECT density, COUNT(*) as count FROM nodes GROUP BY density');
    const typeDist = this._query('SELECT type, COUNT(*) as count FROM nodes GROUP BY type');

    return {
      nodeCount: nodes[0]?.count || 0,
      edgeCount: edges[0]?.count || 0,
      healthDist: Object.fromEntries(healthDist.map(r => [r.health, r.count])),
      densityDist: Object.fromEntries(densityDist.map(r => [r.density, r.count])),
      typeDist: Object.fromEntries(typeDist.map(r => [r.type, r.count]))
    };
  }

  // ========== 全量清空 ==========

  clearAll() {
    this.db.run('DELETE FROM nodes');
    this.db.run('DELETE FROM edges');
    this.db.run('DELETE FROM health_reports');
    this.db.run('DELETE FROM config');
    this.save();
  }

  // ========== 工具方法 ==========

  _query(sql, params = []) {
    try {
      const results = this.db.exec(sql, params);
      if (!results || results.length === 0) return [];
      const columns = results[0].columns;
      return results[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => {
          let val = row[i];
          if (['stats', 'source_ids', 'extra', 'health_detail', 'summary',
               'gaps', 'outdated', 'conflicts', 'duplicates', 'orphans', 'suggestions', 'value'].includes(col)) {
            try { val = JSON.parse(val); } catch (e) { /* keep as string */ }
          }
          obj[col] = val;
        });
        return obj;
      });
    } catch (e) {
      console.error('[GraphDB] Query error:', sql, e.message);
      return [];
    }
  }

  _json(val) {
    if (val === null || val === undefined) return null;
    return typeof val === 'string' ? val : JSON.stringify(val);
  }

  destroy() {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { GraphDB };
