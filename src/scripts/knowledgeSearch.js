/**
 * 知识跟随 - 本地知识搜索模块
 * 同时搜索记忆系统（MemoryStore）、笔记系统（Notebook）、知识图谱（Atoms+Clusters）、知识文章（Articles）
 */

class KnowledgeSearch {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 30000; // 30s 缓存
  }

  /**
   * 模糊搜索本地知识
   * @param {string} query - 搜索关键词
   * @param {number} limit - 返回条数，默认3
   * @returns {Promise<Array>} 搜索结果
   */
  async searchLocalKnowledge(query, limit = 3) {
    if (!query || query.trim().length === 0) return [];

    const results = [];

    try {
      // 1. 搜索记忆系统
      const memResult = await window.electronAPI.getMemories({ limit: 50 });
      if (memResult.memories) {
        memResult.memories.forEach(m => {
          const score = this.calculateRelevance(query, m.content);
          if (score > 0) {
            results.push({
              type: 'memory',
              id: m.id,
              title: this.extractTitle(m.content),
              content: m.content,
              category: m.category,
              memoryType: m.type,
              createdAt: m.createdAt,
              score,
              source: 'local_memory'
            });
          }
        });
      }
    } catch (e) {
      console.error('[KnowledgeSearch] Memory search error:', e);
    }

    try {
      // 2. 搜索笔记系统
      const noteResult = await window.electronAPI.notebookSearch(query);
      if (noteResult.notes) {
        noteResult.notes.forEach(n => {
          const score = this.calculateRelevance(query, n.content || n.title || '');
          if (score > 0) {
            results.push({
              type: 'notebook',
              id: n.id,
              title: n.title || this.extractTitle(n.content),
              content: n.content,
              category: n.category,
              createdAt: n.createdAt,
              score,
              source: 'local_notebook'
            });
          }
        });
      }
    } catch (e) {
      console.error('[KnowledgeSearch] Notebook search error:', e);
    }

    try {
      // 3. 搜索知识图谱（原子 + 簇），低优先级
      const atomResult = await window.electronAPI.knowledgeGetAtoms({});
      if (atomResult.atoms) {
        atomResult.atoms.forEach(a => {
          const score = this.calculateRelevance(query, a.content);
          if (score > 0) {
            results.push({
              type: 'knowledge_atom',
              id: a.id,
              title: this.extractTitle(a.content),
              content: a.content,
              category: a.domain,
              atomType: a.type,
              clusterId: a.cluster_id,
              createdAt: a.created_at,
              // 低优先级：降低分数使图谱结果排在记忆和笔记之后
              score: score * 0.8,
              source: 'knowledge_graph'
            });
          }
        });
      }
    } catch (e) {
      console.error('[KnowledgeSearch] Knowledge atoms search error:', e);
    }

    try {
      // 4. 搜索知识图谱中的簇名称
      const clusterResult = await window.electronAPI.knowledgeGetClusters({});
      if (clusterResult.clusters) {
        clusterResult.clusters.forEach(c => {
          const score = this.calculateRelevance(query, c.name + ' ' + (c.domain || ''));
          if (score > 0) {
            results.push({
              type: 'knowledge_cluster',
              id: c.id,
              title: c.name,
              content: `知识簇: ${c.name}（${c.domain || '未分类'}），包含 ${c.atom_ids?.length || 0} 个知识原子`,
              category: c.domain,
              atomCount: c.atom_ids?.length || 0,
              createdAt: c.created_at,
              // 低优先级
              score: score * 0.7,
              source: 'knowledge_graph'
            });
          }
        });
      }
    } catch (e) {
      console.error('[KnowledgeSearch] Knowledge clusters search error:', e);
    }

    try {
      // 5. 搜索知识文章，低优先级
      const articleResult = await window.electronAPI.knowledgeGetArticles({});
      if (articleResult.articles) {
        for (const a of articleResult.articles) {
          // 文章标题和标签搜索
          let score = this.calculateRelevance(query, a.title + ' ' + (a.tags || []).join(' '));
          // 如果有摘要也搜索
          if (a.summary) {
            score = Math.max(score, this.calculateRelevance(query, a.summary) * 0.9);
          }
          if (score > 0) {
            results.push({
              type: 'knowledge_article',
              id: a.id,
              title: a.title,
              content: a.summary || `知识文章: ${a.title}`,
              category: a.tags?.[0] || '知识文章',
              articleTags: a.tags,
              clusterId: a.cluster_id,
              createdAt: a.created_at,
              // 低优先级
              score: score * 0.75,
              source: 'knowledge_article'
            });
          }
        }
      }
    } catch (e) {
      console.error('[KnowledgeSearch] Knowledge articles search error:', e);
    }

    // 按相关度排序，取 Top N
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * 计算文本相关度分数
   * @param {string} query - 搜索词
   * @param {string} content - 被搜索内容
   * @returns {number} 0~1 的分数
   */
  calculateRelevance(query, content) {
    if (!query || !content) return 0;

    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    if (keywords.length === 0) return 0;

    const lower = content.toLowerCase();
    let score = 0;

    keywords.forEach(kw => {
      // 完全匹配
      if (lower.includes(kw)) {
        score += 1;
        // 多次出现加权
        const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = lower.match(regex);
        if (matches) {
          score += matches.length * 0.3;
        }
      }
      // 前缀匹配
      keywords.forEach(kw2 => {
        if (kw2 !== kw && kw2.startsWith(kw)) {
          score += 0.5;
        }
      });
    });

    return Math.min(score / keywords.length, 1.0);
  }

  /**
   * 从内容中提取标题
   */
  extractTitle(content) {
    if (!content) return '无标题';
    const firstLine = content.split('\n')[0] || '';
    return firstLine.substring(0, 50) + (firstLine.length > 50 ? '...' : '');
  }

  /**
   * 格式化匹配度百分比
   */
  formatScore(score) {
    return Math.round(score * 100) + '%';
  }

  /**
   * 格式化来源类型标签
   */
  getSourceLabel(source) {
    const labels = {
      'local_memory': '记忆',
      'local_notebook': '笔记',
      'knowledge_graph': '知识图谱',
      'knowledge_article': '知识文章',
      'adp_recommend': 'ADP推荐',
      'adp_search': 'ADP搜索'
    };
    return labels[source] || source;
  }

  /**
   * 格式化来源图标
   */
  getSourceIcon(source) {
    const icons = {
      'local_memory': '📚',
      'local_notebook': '📝',
      'knowledge_graph': '🧬',
      'knowledge_article': '📖',
      'adp_recommend': '🔵',
      'adp_search': '🤖'
    };
    return icons[source] || '📄';
  }
}

// 导出为全局对象
window.KnowledgeSearch = KnowledgeSearch;
