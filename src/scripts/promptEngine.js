// 轻量 Handlebars 风格模板引擎
class PromptEngine {
  constructor() {
    this.cache = new Map();
  }

  render(templateText, vars) {
    let tpl = templateText;

    // 1. {{#each xxx}}...{{/each}}
    tpl = tpl.replace(/\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (_, key, body) => {
        const arr = this._resolve(vars, key);
        if (!Array.isArray(arr)) return '';
        return arr.map((item, idx) => {
          let block = body;
          block = block.replace(/\{\{@index\}\}/g, idx);
          block = block.replace(/\{\{@last\}\}/g, idx === arr.length - 1);
          block = block.replace(/\{\{this\.([\w.]+)\}\}/g,
            (_, k) => this._resolve(item, k) ?? '');
          block = block.replace(/\{\{this\}\}/g, item);
          block = block.replace(/\{\{(\w+)\}\}/g,
            (_, k) => (typeof item === 'object' ? (item[k] ?? '') : ''));
          block = block.replace(/\{\{#unless\s+@last\}\}([\s\S]*?)\{\{\/unless\}\}/g,
            (_, b) => idx === arr.length - 1 ? '' : b);
          block = block.replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
            (_, k, b) => this._resolve(item, k) ? b : '');
          return block;
        }).join('');
      });

    // 2. {{#if xxx}}...{{/if}}
    tpl = tpl.replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_, key, body) => this._resolve(vars, key) ? body : '');

    // 3. {{xxx}}
    tpl = tpl.replace(/\{\{([\w.]+)\}\}/g,
      (_, key) => this._resolve(vars, key) ?? '');

    return tpl;
  }

  _resolve(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }
}

module.exports = PromptEngine;
