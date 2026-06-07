/**
 * GraphRAG - 图谱增强检索生成
 * 负责：构建 Graph RAG 上下文，增强小助手问答
 */

class GraphRAG {
  constructor() {
    // 延迟获取 IPC 引用
  }

  /**
   * 构建 Graph RAG 上下文
   * @param {string} question - 用户问题
   * @returns {Object} { matchedNodes, relatedAtoms, healthContext, graphStats }
   */
  async buildContext(question) {
    try {
      const keywords = this._extractKeywords(question);
      if (keywords.length === 0) return null;

      // 搜索匹配节点
      let matchedNodes = [];
      for (const kw of keywords.slice(0, 3)) {
        const results = await window.electronAPI?.graphSearch({ query: kw });
        if (results?.nodes) matchedNodes.push(...results.nodes);
      }
      matchedNodes = this._deduplicate(matchedNodes);
      if (matchedNodes.length === 0) return null;

      // 获取邻居节点扩展上下文
      const expandedIds = new Set(matchedNodes.map(n => n.id));
      for (const node of matchedNodes.slice(0, 3)) {
        try {
          const neighbors = await window.electronAPI?.graphNeighbors({ nodeId: node.id, depth: 1 });
          if (neighbors?.nodes) neighbors.nodes.forEach(n => expandedIds.add(n.id));
        } catch (e) { /* ignore */ }
      }

      // 获取关联知识原子内容
      const relatedAtoms = [];
      for (const node of matchedNodes) {
        if (node.source_ids && Array.isArray(node.source_ids)) {
          for (const sid of node.source_ids.slice(0, 5)) {
            try {
              const result = await window.electronAPI?.knowledgeGetAtomById(sid);
              if (result?.atom) relatedAtoms.push(result.atom);
            } catch (e) { /* ignore */ }
          }
        }
      }

      // 获取体检上下文
      const healthReport = await window.electronAPI?.graphHealthReport();
      const healthContext = this._buildHealthContext(matchedNodes, healthReport);

      // 获取图谱统计
      const graphStats = await window.electronAPI?.graphStats();

      return {
        matchedNodes,
        relatedAtoms: relatedAtoms.slice(0, 15),
        healthContext,
        graphStats
      };
    } catch (e) {
      console.error('[GraphRAG] buildContext error:', e);
      return null;
    }
  }

  /**
   * 构建 RAG 增强的 system prompt 片段
   */
  buildRAGPrompt(context) {
    if (!context || context.matchedNodes.length === 0) return '';

    let prompt = '\n\n## 用户的知识图谱上下文\n';

    // 匹配的节点
    prompt += '### 相关知识领域\n';
    context.matchedNodes.forEach(n => {
      prompt += `- ${n.label}（${n.type}/${n.density}${n.health !== 'healthy' ? '/⚠️' + n.health : ''}）`;
      if (n.summary) prompt += `：${n.summary}`;
      prompt += '\n';
    });

    // 关联知识
    if (context.relatedAtoms.length > 0) {
      prompt += '\n### 相关知识原子\n';
      context.relatedAtoms.slice(0, 10).forEach(a => {
        prompt += `- [${a.domain}] ${a.content.substring(0, 120)}\n`;
      });
    }

    // 冲突提示
    if (context.healthContext?.conflicts?.length > 0) {
      prompt += '\n### ⚠️ 知识冲突\n';
      context.healthContext.conflicts.forEach(c => {
        prompt += `- ${c.reason || '存在矛盾观点'}\n`;
      });
    }

    // 缺口提示
    if (context.healthContext?.gaps?.length > 0) {
      prompt += '\n### 📌 知识缺口\n';
      context.healthContext.gaps.forEach(g => {
        prompt += `- ${g.label}：${g.reason || '缺乏相关知识'}\n`;
      });
    }

    return prompt;
  }

  _extractKeywords(question) {
    const stopWords = new Set([
      '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '这', '中', '大', '为', '上', '个', '到', '说', '们', '么', '那', '要', '会', '对', '它', '也', '与', '及', '等', '被', '从', '而', '或',
      'how', 'what', 'why', 'should', 'can', 'the', 'is', 'are', 'do', 'does', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with'
    ]);
    const words = question.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z]{2,}/g) || [];
    return words.filter(w => !stopWords.has(w.toLowerCase()));
  }

  _deduplicate(nodes) {
    const seen = new Set();
    return nodes.filter(n => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
  }

  _buildHealthContext(nodes, report) {
    if (!report) return {};
    const nodeIds = new Set(nodes.map(n => n.id));
    return {
      conflicts: (report.conflicts || []).filter(c =>
        c.atoms?.some(a => nodeIds.has(a.id)) || nodeIds.has(c.nodeId)
      ),
      outdated: (report.outdated || []).filter(o => nodeIds.has(o.nodeId)),
      gaps: (report.gaps || []).filter(g => nodeIds.has(g.nodeId))
    };
  }
}

window.GraphRAG = GraphRAG;
