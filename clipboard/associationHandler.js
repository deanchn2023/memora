/**
 * AI 关联检测处理器
 * - 检测新内容与已处理内容的关联
 * - supplement: 补充已有条目
 * - update: 更新已有条目状态
 * - duplicate: 跳过重复内容
 * - related: 独立创建但标记关联
 */

const { getClipboardHash } = require('./hashUtils');

class AssociationHandler {
  constructor(notebook) {
    this.notebook = notebook;
  }

  /**
   * 获取最近处理的条目，供 AI 参考
   * @param {number} count - 获取条数
   * @returns {string} 格式化的文本
   */
  getRecentItemsForPrompt(count = 5) {
    if (!this.notebook) return '（暂无）';

    const notes = this.notebook.notes || [];
    const recent = notes
      .filter(n => n.analyzed && n.analysis)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, count);

    if (recent.length === 0) return '（暂无）';

    return recent.map(item =>
      `ID: ${item.id} | 类型: ${item.category || 'general'} | 标题: ${item.analysis?.taskTitle || item.content?.substring(0, 30) || ''} | 摘要: ${item.content?.substring(0, 100) || ''}`
    ).join('\n');
  }

  /**
   * 处理 AI 返回的关联检测结果
   * @param {object} associatedWith - AI 返回的 associated_with 字段
   * @param {string} text - 原始文本
   * @returns {object} 处理结果 { handled: boolean, action: string, targetId: string }
   */
  handleAssociation(associatedWith, text) {
    if (!associatedWith || !associatedWith.has_association) {
      return { handled: false, action: null, targetId: null };
    }

    const { association_type, target_id, reason } = associatedWith;

    console.log(`[Association] Detected: ${association_type} → ${target_id}, reason: ${reason}`);

    switch (association_type) {
      case 'supplement':
        return this._handleSupplement(target_id, text, reason);
      case 'update':
        return this._handleUpdate(target_id, text, associatedWith, reason);
      case 'duplicate':
        return { handled: true, action: 'duplicate', targetId: target_id };
      case 'related':
        return { handled: false, action: 'related', targetId: target_id };
      default:
        return { handled: false, action: null, targetId: target_id };
    }
  }

  /**
   * supplement: 将新内容追加到已有条目的补充信息
   */
  _handleSupplement(targetId, text, reason) {
    if (!this.notebook) return { handled: false, action: 'supplement', targetId };

    const note = this.notebook.notes.find(n => n.id === targetId);
    if (!note) {
      console.log(`[Association] Target note ${targetId} not found, creating new`);
      return { handled: false, action: 'supplement', targetId };
    }

    // 追加补充信息
    if (!note.supplements) note.supplements = [];
    note.supplements.push({
      text: text.substring(0, 500),
      reason,
      timestamp: new Date().toISOString()
    });
    note.updatedAt = new Date().toISOString();
    this.notebook.saveNotes();

    console.log(`[Association] Supplemented note ${targetId}`);
    return { handled: true, action: 'supplement', targetId };
  }

  /**
   * update: 更新已有条目的状态/优先级
   */
  _handleUpdate(targetId, text, associatedWith, reason) {
    if (!this.notebook) return { handled: false, action: 'update', targetId };

    const note = this.notebook.notes.find(n => n.id === targetId);
    if (!note) {
      console.log(`[Association] Target note ${targetId} not found`);
      return { handled: false, action: 'update', targetId };
    }

    // 更新状态
    if (note.analysis) {
      if (associatedWith.status) note.analysis.status = associatedWith.status;
      if (associatedWith.priority) note.analysis.taskPriority = associatedWith.priority;
    }
    note.updatedAt = new Date().toISOString();
    if (!note.updates) note.updates = [];
    note.updates.push({
      text: text.substring(0, 500),
      reason,
      timestamp: new Date().toISOString()
    });
    this.notebook.saveNotes();

    console.log(`[Association] Updated note ${targetId}`);
    return { handled: true, action: 'update', targetId };
  }
}

module.exports = AssociationHandler;
