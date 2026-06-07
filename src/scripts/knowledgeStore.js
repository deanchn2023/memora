const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 知识体系存储路径
const KNOWLEDGE_PATH = path.join(app.getPath('userData'), 'knowledge');

// 确保目录存在
if (!fs.existsSync(KNOWLEDGE_PATH)) {
  fs.mkdirSync(KNOWLEDGE_PATH, { recursive: true });
}
const ARTICLES_DIR = path.join(KNOWLEDGE_PATH, 'articles');
if (!fs.existsSync(ARTICLES_DIR)) {
  fs.mkdirSync(ARTICLES_DIR, { recursive: true });
}

class KnowledgeStore {
  constructor() {
    this.atoms = [];
    this.clusters = [];
    this.articles = []; // 元数据索引
    this.loadData();
  }

  // ========== 数据加载 ==========

  loadData() {
    try {
      const atomsFile = path.join(KNOWLEDGE_PATH, 'atoms.json');
      if (fs.existsSync(atomsFile)) {
        this.atoms = JSON.parse(fs.readFileSync(atomsFile, 'utf8'));
      }
      const clustersFile = path.join(KNOWLEDGE_PATH, 'clusters.json');
      if (fs.existsSync(clustersFile)) {
        this.clusters = JSON.parse(fs.readFileSync(clustersFile, 'utf8'));
      }
      const articlesFile = path.join(ARTICLES_DIR, 'articles.json');
      if (fs.existsSync(articlesFile)) {
        this.articles = JSON.parse(fs.readFileSync(articlesFile, 'utf8'));
      }
      // 迁移：清理同一簇的重复文章，只保留最新一篇
      this._deduplicateArticles();
    } catch (e) {
      console.error('[KnowledgeStore] Load error:', e);
      this.atoms = [];
      this.clusters = [];
      this.articles = [];
    }
  }

  saveAtoms() {
    try {
      fs.writeFileSync(path.join(KNOWLEDGE_PATH, 'atoms.json'), JSON.stringify(this.atoms, null, 2));
    } catch (e) { console.error('[KnowledgeStore] Save atoms error:', e); }
  }

  saveClusters() {
    try {
      fs.writeFileSync(path.join(KNOWLEDGE_PATH, 'clusters.json'), JSON.stringify(this.clusters, null, 2));
    } catch (e) { console.error('[KnowledgeStore] Save clusters error:', e); }
  }

  saveArticlesIndex() {
    try {
      fs.writeFileSync(path.join(ARTICLES_DIR, 'articles.json'), JSON.stringify(this.articles, null, 2));
    } catch (e) { console.error('[KnowledgeStore] Save articles index error:', e); }
  }

  // ========== 知识原子 ==========

  addAtom(atom) {
    // 去重：相同内容不重复添加
    const contentHash = this._hashContent(atom.content);
    if (this.atoms.some(a => this._hashContent(a.content) === contentHash)) {
      console.log('[KnowledgeStore] Duplicate atom, skipping');
      return null;
    }

    const newAtom = {
      id: `atom_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      content: atom.content,
      source_note_ids: atom.source_note_ids || [],
      domain: atom.domain || '未分类',
      type: atom.type || 'fact', // fact/rule/insight/procedure
      importance: atom.importance ?? 0.5,
      cluster_id: atom.cluster_id || null,
      contentHash,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.atoms.unshift(newAtom);
    this.saveAtoms();

    // 标记图谱缓存过期
    this._markGraphStale();

    // 自动匹配知识簇
    if (!newAtom.cluster_id) {
      this._autoAssignCluster(newAtom);
    }

    return newAtom;
  }

  getAtoms(filter) {
    let result = [...this.atoms];
    if (filter?.domain) result = result.filter(a => a.domain === filter.domain);
    if (filter?.type) result = result.filter(a => a.type === filter.type);
    if (filter?.cluster_id) result = result.filter(a => a.cluster_id === filter.cluster_id);
    if (filter?.unclustered) result = result.filter(a => !a.cluster_id);
    return result;
  }

  getAtomById(id) {
    return this.atoms.find(a => a.id === id);
  }

  updateAtom(id, updates) {
    const idx = this.atoms.findIndex(a => a.id === id);
    if (idx !== -1) {
      this.atoms[idx] = { ...this.atoms[idx], ...updates, updated_at: new Date().toISOString() };
      this.saveAtoms();
      return this.atoms[idx];
    }
    return null;
  }

  deleteAtom(id) {
    const idx = this.atoms.findIndex(a => a.id === id);
    if (idx !== -1) {
      const atom = this.atoms.splice(idx, 1)[0];
      // 从簇中移除
      if (atom.cluster_id) {
        const cluster = this.getClusterById(atom.cluster_id);
        if (cluster) {
          cluster.atom_ids = (cluster.atom_ids || []).filter(aid => aid !== id);
          cluster.updated_at = new Date().toISOString();
          this.saveClusters();
        }
      }
      this.saveAtoms();
      this._markGraphStale();
      return atom;
    }
    return null;
  }

  // ========== 知识簇 ==========

  addCluster(cluster) {
    const newCluster = {
      id: `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name: cluster.name,
      domain: cluster.domain || '未分类',
      description: cluster.description || '',
      atom_ids: cluster.atom_ids || [],
      keywords: cluster.keywords || [],
      status: cluster.status || 'growing', // growing/mature/distilled
      article_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.clusters.unshift(newCluster);
    this.saveClusters();

    // 将原子归入此簇
    if (newCluster.atom_ids.length > 0) {
      for (const atomId of newCluster.atom_ids) {
        const atom = this.getAtomById(atomId);
        if (atom) {
          atom.cluster_id = newCluster.id;
        }
      }
      this.saveAtoms();
    }

    return newCluster;
  }

  getClusters(filter) {
    let result = [...this.clusters];
    if (filter?.status) result = result.filter(c => c.status === filter.status);
    if (filter?.domain) result = result.filter(c => c.domain === filter.domain);
    return result;
  }

  getClusterById(id) {
    return this.clusters.find(c => c.id === id);
  }

  updateCluster(id, updates) {
    const idx = this.clusters.findIndex(c => c.id === id);
    if (idx !== -1) {
      this.clusters[idx] = { ...this.clusters[idx], ...updates, updated_at: new Date().toISOString() };
      this.saveClusters();
      return this.clusters[idx];
    }
    return null;
  }

  deleteCluster(id, atomAction = 'release') {
    const idx = this.clusters.findIndex(c => c.id === id);
    if (idx !== -1) {
      const cluster = this.clusters.splice(idx, 1)[0];
      // 处理簇内原子
      for (const atomId of (cluster.atom_ids || [])) {
        if (atomAction === 'delete') {
          this.atoms = this.atoms.filter(a => a.id !== atomId);
        } else {
          // release: 解除簇关联
          const atom = this.getAtomById(atomId);
          if (atom) atom.cluster_id = null;
        }
      }
      this.saveAtoms();
      this.saveClusters();
      return cluster;
    }
    return null;
  }

  clusterAtom(atomId, clusterId) {
    const atom = this.getAtomById(atomId);
    const cluster = this.getClusterById(clusterId);
    if (!atom || !cluster) return null;

    // 从旧簇移除
    if (atom.cluster_id && atom.cluster_id !== clusterId) {
      const oldCluster = this.getClusterById(atom.cluster_id);
      if (oldCluster) {
        oldCluster.atom_ids = (oldCluster.atom_ids || []).filter(id => id !== atomId);
      }
    }

    atom.cluster_id = clusterId;
    if (!cluster.atom_ids.includes(atomId)) {
      cluster.atom_ids.push(atomId);
    }
    cluster.updated_at = new Date().toISOString();
    atom.updated_at = new Date().toISOString();

    // 更新簇状态
    this._updateClusterStatus(cluster);

    this.saveAtoms();
    this.saveClusters();
    return { atom, cluster };
  }

  // ========== 知识文章 ==========

  addArticle(article) {
    // 去重：同一簇只保留一篇文章，重复生成时更新旧文章
    if (article.cluster_id) {
      const existing = this.articles.find(a => a.cluster_id === article.cluster_id);
      if (existing) {
        console.log('[KnowledgeStore] Cluster already has article, updating:', existing.id);
        // 更新已有文章内容
        const filePath = path.join(ARTICLES_DIR, existing.file_path);
        try {
          fs.writeFileSync(filePath, article.content || '', 'utf8');
        } catch (e) {
          console.error('[KnowledgeStore] Update article file error:', e);
          return null;
        }
        existing.title = article.title || existing.title;
        existing.version = (existing.version || 1) + 1;
        existing.atom_count = article.atom_count || existing.atom_count;
        existing.source_note_count = article.source_note_count || existing.source_note_count;
        existing.tags = article.tags || existing.tags;
        existing.updated_at = new Date().toISOString();
        this.saveArticlesIndex();
        return existing;
      }
    }

    const id = `article_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const fileName = `${id}.md`;
    const filePath = path.join(ARTICLES_DIR, fileName);

    // 写入 Markdown 文件
    try {
      fs.writeFileSync(filePath, article.content || '', 'utf8');
    } catch (e) {
      console.error('[KnowledgeStore] Write article file error:', e);
      return null;
    }

    const newArticle = {
      id,
      cluster_id: article.cluster_id || null,
      title: article.title,
      file_path: fileName,
      version: article.version || 1,
      atom_count: article.atom_count || 0,
      source_note_count: article.source_note_count || 0,
      tags: article.tags || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.articles.unshift(newArticle);
    this.saveArticlesIndex();

    // 更新簇状态
    if (newArticle.cluster_id) {
      this.updateCluster(newArticle.cluster_id, { status: 'distilled', article_id: id });
    }

    return newArticle;
  }

  getArticles(filter) {
    let result = [...this.articles];
    if (filter?.cluster_id) result = result.filter(a => a.cluster_id === filter.cluster_id);
    if (filter?.tags) result = result.filter(a => a.tags.some(t => filter.tags.includes(t)));
    return result;
  }

  getArticleById(id) {
    const meta = this.articles.find(a => a.id === id);
    if (!meta) return null;
    const filePath = path.join(ARTICLES_DIR, meta.file_path);
    let content = '';
    try {
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, 'utf8');
      }
    } catch (e) { console.error('[KnowledgeStore] Read article error:', e); }
    return { ...meta, content };
  }

  updateArticle(id, updates) {
    const idx = this.articles.findIndex(a => a.id === id);
    if (idx !== -1) {
      if (updates.content !== undefined) {
        const filePath = path.join(ARTICLES_DIR, this.articles[idx].file_path);
        try {
          fs.writeFileSync(filePath, updates.content, 'utf8');
        } catch (e) { console.error('[KnowledgeStore] Update article file error:', e); }
        delete updates.content;
      }
      this.articles[idx] = { ...this.articles[idx], ...updates, updated_at: new Date().toISOString() };
      this.saveArticlesIndex();
      return this.articles[idx];
    }
    return null;
  }

  deleteArticle(id) {
    const idx = this.articles.findIndex(a => a.id === id);
    if (idx !== -1) {
      const article = this.articles.splice(idx, 1)[0];
      // 删除文件
      const filePath = path.join(ARTICLES_DIR, article.file_path);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) { console.error('[KnowledgeStore] Delete article file error:', e); }
      // 更新簇状态
      if (article.cluster_id) {
        const cluster = this.getClusterById(article.cluster_id);
        if (cluster && cluster.article_id === id) {
          cluster.article_id = null;
          // 降回 mature 状态
          if (cluster.status === 'distilled') {
            cluster.status = 'mature';
          }
          this.saveClusters();
        }
      }
      this.saveArticlesIndex();
      return article;
    }
    return null;
  }

  // ========== 统计与领域 ==========

  getStats() {
    const domains = {};
    for (const atom of this.atoms) {
      domains[atom.domain] = (domains[atom.domain] || 0) + 1;
    }
    return {
      totalAtoms: this.atoms.length,
      totalClusters: this.clusters.length,
      totalArticles: this.articles.length,
      unclusteredAtoms: this.atoms.filter(a => !a.cluster_id).length,
      domains,
      clustersByStatus: {
        growing: this.clusters.filter(c => c.status === 'growing').length,
        mature: this.clusters.filter(c => c.status === 'mature').length,
        distilled: this.clusters.filter(c => c.status === 'distilled').length
      }
    };
  }

  getDomains() {
    const domains = new Set();
    for (const atom of this.atoms) domains.add(atom.domain);
    for (const cluster of this.clusters) domains.add(cluster.domain);
    return [...domains].sort();
  }

  // ========== 内部方法 ==========

  // 清理同一簇的重复文章，只保留最新一篇
  _deduplicateArticles() {
    const seen = new Map(); // cluster_id -> article index
    const toRemove = [];
    for (let i = 0; i < this.articles.length; i++) {
      const a = this.articles[i];
      if (!a.cluster_id) continue;
      if (seen.has(a.cluster_id)) {
        const prevIdx = seen.get(a.cluster_id);
        // 保留 updated_at 更新的，删除更旧的
        const prevDate = this.articles[prevIdx].updated_at || this.articles[prevIdx].created_at;
        const curDate = a.updated_at || a.created_at;
        if (curDate >= prevDate) {
          toRemove.push(prevIdx);
          seen.set(a.cluster_id, i);
        } else {
          toRemove.push(i);
        }
      } else {
        seen.set(a.cluster_id, i);
      }
    }
    if (toRemove.length > 0) {
      // 删除旧文件并从列表移除
      for (const idx of toRemove) {
        const article = this.articles[idx];
        const filePath = path.join(ARTICLES_DIR, article.file_path);
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (e) { /* ignore */ }
      }
      const removeSet = new Set(toRemove);
      this.articles = this.articles.filter((_, idx) => !removeSet.has(idx));
      this.saveArticlesIndex();
      console.log(`[KnowledgeStore] Deduplicated ${toRemove.length} duplicate articles`);
    }
  }

  _hashContent(content) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update((content || '').trim(), 'utf8').digest('hex');
  }

  _autoAssignCluster(atom) {
    // 简单关键词匹配：找同领域已有簇
    const sameDomainClusters = this.clusters.filter(c => c.domain === atom.domain);
    if (sameDomainClusters.length > 0) {
      // 找最匹配的簇（基于关键词交集）
      let bestCluster = null;
      let bestScore = 0;
      for (const cluster of sameDomainClusters) {
        const score = this._keywordMatchScore(atom.content, cluster.keywords);
        if (score > bestScore) {
          bestScore = score;
          bestCluster = cluster;
        }
      }
      // 阈值：至少有1个关键词匹配
      if (bestCluster && bestScore > 0) {
        this.clusterAtom(atom.id, bestCluster.id);
        console.log('[KnowledgeStore] Auto-assigned atom to cluster:', bestCluster.name);
      }
    }
  }

  _keywordMatchScore(content, keywords) {
    if (!keywords || keywords.length === 0) return 0;
    let score = 0;
    const lower = content.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) score++;
    }
    return score;
  }

  _updateClusterStatus(cluster) {
    const atomCount = cluster.atom_ids.length;
    if (atomCount >= 3 && cluster.status === 'growing') {
      cluster.status = 'mature';
    }
    if (cluster.article_id && cluster.status !== 'distilled') {
      cluster.status = 'distilled';
    }
  }

  // 标记图谱缓存过期
  _markGraphStale() {
    try {
      const fs = require('fs');
      const path = require('path');
      const { app } = require('electron');
      const dbPath = path.join(app.getPath('userData'), 'knowledge', 'knowledge-graph.db');
      if (fs.existsSync(dbPath) && global.graphDb) {
        global.graphDb.markStale();
      }
    } catch (e) { /* ignore */ }
  }

  // 合并相似簇（名称相同或关键词高度重叠）
  mergeSimilarClusters() {
    const merged = [];
    let mergeCount = 0;

    for (let i = 0; i < this.clusters.length; i++) {
      if (merged.includes(i)) continue;

      for (let j = i + 1; j < this.clusters.length; j++) {
        if (merged.includes(j)) continue;

        const a = this.clusters[i];
        const b = this.clusters[j];

        // 判断是否可合并：同名 或 关键词重叠 >= 2 或 关键词重叠率 >= 50%
        const shouldMerge = this._shouldMergeClusters(a, b);

        if (shouldMerge) {
          // 将 j 簇的原子全部归入 i 簇
          for (const atomId of (b.atom_ids || [])) {
            const atom = this.getAtomById(atomId);
            if (atom) {
              atom.cluster_id = a.id;
              if (!a.atom_ids.includes(atomId)) {
                a.atom_ids.push(atomId);
              }
            }
          }
          // 合并关键词
          const combinedKw = new Set([...(a.keywords || []), ...(b.keywords || [])]);
          a.keywords = [...combinedKw];
          // 合并描述（取较长的）
          if ((b.description || '').length > (a.description || '').length) {
            a.description = b.description;
          }
          a.updated_at = new Date().toISOString();

          // 标记 j 为已合并
          merged.push(j);
          mergeCount++;

          console.log(`[KnowledgeStore] Merged cluster "${b.name}" into "${a.name}"`);
        }
      }
    }

    // 删除被合并的簇
    if (mergeCount > 0) {
      this.clusters = this.clusters.filter((_, idx) => !merged.includes(idx));
      // 更新所有保留簇的状态
      for (const cluster of this.clusters) {
        this._updateClusterStatus(cluster);
      }
      this.saveClusters();
      this.saveAtoms();
    }

    return { mergeCount };
  }

  _shouldMergeClusters(a, b) {
    // 同名直接合并
    if (a.name === b.name) return true;
    // 同领域才考虑合并
    if (a.domain !== b.domain) return false;
    // 关键词重叠检查
    const kwA = new Set((a.keywords || []).map(k => k.toLowerCase()));
    const kwB = new Set((b.keywords || []).map(k => k.toLowerCase()));
    let overlap = 0;
    for (const kw of kwA) {
      if (kwB.has(kw)) overlap++;
    }
    // 重叠 >= 2 或 重叠率 >= 50%（至少2个关键词时）
    if (overlap >= 2) return true;
    if (kwA.size >= 2 && kwB.size >= 2 && overlap / Math.min(kwA.size, kwB.size) >= 0.5) return true;
    return false;
  }

  // 清理空簇（没有原子的簇）
  cleanupEmptyClusters() {
    const before = this.clusters.length;
    this.clusters = this.clusters.filter(c => (c.atom_ids || []).length > 0);
    const removed = before - this.clusters.length;
    if (removed > 0) {
      this.saveClusters();
      console.log(`[KnowledgeStore] Cleaned up ${removed} empty clusters`);
    }
    return { removed };
  }
}

module.exports = { KnowledgeStore };
