/**
 * RichEditor - 轻量级富文本编辑器
 * 基于 contentEditable，Apple Design Language 风格
 * 支持加粗、斜体、下划线、删除线、有序/无序列表、链接、图片粘贴
 */
class RichEditor {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.options = {
      placeholder: options.placeholder || '',
      minHeight: options.minHeight || 120,
      maxHeight: options.maxHeight || 400,
      toolbar: options.toolbar !== false,
      toolbarItems: options.toolbarItems || ['bold', 'italic', 'underline', 'strike', '|', 'unorderedList', 'orderedList', '|', 'link', 'image'],
      onChange: options.onChange || null,
      compact: options.compact || false,
    };

    this.editorId = 'rich-editor-' + Math.random().toString(36).substr(2, 9);
    this._createDOM();
    this._bindEvents();
  }

  _createDOM() {
    this.container.classList.add('rich-editor-wrapper');
    if (this.options.compact) this.container.classList.add('rich-editor-compact');

    // 工具栏
    if (this.options.toolbar) {
      this.toolbar = document.createElement('div');
      this.toolbar.className = 'rich-editor-toolbar';
      this.toolbar.setAttribute('role', 'toolbar');
      this.toolbar.setAttribute('aria-label', '格式化工具栏');

      this.options.toolbarItems.forEach(item => {
        if (item === '|') {
          const sep = document.createElement('div');
          sep.className = 'rich-editor-toolbar-sep';
          this.toolbar.appendChild(sep);
          return;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rich-editor-toolbar-btn';
        btn.dataset.command = item;
        btn.title = this._getCommandTitle(item);
        btn.innerHTML = this._getCommandIcon(item);
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault(); // 防止失焦
          this._execCommand(item);
        });
        this.toolbar.appendChild(btn);
      });

      this.container.appendChild(this.toolbar);
    }

    // 编辑区域
    this.editArea = document.createElement('div');
    this.editArea.className = 'rich-editor-area';
    this.editArea.contentEditable = true;
    this.editArea.id = this.editorId;
    this.editArea.setAttribute('role', 'textbox');
    this.editArea.setAttribute('aria-multiline', 'true');
    this.editArea.setAttribute('aria-placeholder', this.options.placeholder);
    this.editArea.style.minHeight = this.options.minHeight + 'px';
    this.editArea.style.maxHeight = this.options.maxHeight + 'px';
    this.editArea.dataset.placeholder = this.options.placeholder;

    this.container.appendChild(this.editArea);
  }

  _bindEvents() {
    // 占位符
    this.editArea.addEventListener('focus', () => {
      if (this.isEmpty()) this.editArea.innerHTML = '';
      this.container.classList.add('rich-editor-focused');
    });
    this.editArea.addEventListener('blur', () => {
      this.container.classList.remove('rich-editor-focused');
      if (this.isEmpty()) this.editArea.innerHTML = '';
    });

    // 输入监听
    this.editArea.addEventListener('input', () => {
      this._updateToolbarState();
      if (this.options.onChange) this.options.onChange(this.getHTML(), this.getText());
    });

    // 键盘快捷键
    this.editArea.addEventListener('keydown', (e) => {
      if (e.key === 'b' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this._execCommand('bold');
      } else if (e.key === 'i' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this._execCommand('italic');
      } else if (e.key === 'u' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this._execCommand('underline');
      }
    });

    // 粘贴：纯文本粘贴，图片单独处理
    this.editArea.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            e.preventDefault();
            const file = items[i].getAsFile();
            this._insertImage(file);
            return;
          }
        }
      }
      // 如果有 HTML 内容，允许富文本粘贴
      const html = e.clipboardData?.getData('text/html');
      if (html) {
        e.preventDefault();
        // 清理危险标签但保留基本格式
        const clean = this._sanitizeHTML(html);
        document.execCommand('insertHTML', false, clean);
        return;
      }
    });

    // 工具栏状态更新
    this.editArea.addEventListener('mouseup', () => this._updateToolbarState());
    this.editArea.addEventListener('keyup', () => this._updateToolbarState());
  }

  _execCommand(command) {
    this.editArea.focus();
    switch (command) {
      case 'bold':
        document.execCommand('bold', false, null);
        break;
      case 'italic':
        document.execCommand('italic', false, null);
        break;
      case 'underline':
        document.execCommand('underline', false, null);
        break;
      case 'strike':
        document.execCommand('strikeThrough', false, null);
        break;
      case 'unorderedList':
        document.execCommand('insertUnorderedList', false, null);
        break;
      case 'orderedList':
        document.execCommand('insertOrderedList', false, null);
        break;
      case 'link': {
        this._showLinkDialog();
        return; // 异步处理，不执行后续 _updateToolbarState
      }
      case 'image': {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
          if (input.files[0]) this._insertImage(input.files[0]);
        };
        input.click();
        break;
      }
    }
    this._updateToolbarState();
    if (this.options.onChange) this.options.onChange(this.getHTML(), this.getText());
  }

  async _insertImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const img = `<img src="${dataUrl}" style="max-width:100%;border-radius:6px;margin:4px 0;" alt="粘贴的图片">`;
      document.execCommand('insertHTML', false, img);
      if (this.options.onChange) this.options.onChange(this.getHTML(), this.getText());
    };
    reader.readAsDataURL(file);
  }

  /**
   * 显示自定义链接弹窗（替代 Electron 中不可用的 prompt()）
   */
  _showLinkDialog() {
    // 保存当前选区，弹窗关闭后恢复
    const selection = window.getSelection();
    let savedRange = null;
    if (selection.rangeCount > 0) {
      savedRange = selection.getRangeAt(0).cloneRange();
    }

    // 如果有选中文本，预填为 URL；否则让用户输入
    const selectedText = selection.toString();

    // 创建弹窗 DOM
    const overlay = document.createElement('div');
    overlay.className = 'rich-editor-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'rich-editor-modal';

    const title = document.createElement('div');
    title.className = 'rich-editor-modal-title';
    title.textContent = '插入链接';

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'rich-editor-modal-input';
    urlInput.placeholder = '输入链接地址';
    urlInput.value = 'https://';

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'rich-editor-modal-input';
    textInput.placeholder = '链接文字（可选，默认使用选中文本）';
    textInput.value = selectedText || '';

    const btnRow = document.createElement('div');
    btnRow.className = 'rich-editor-modal-btns';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'rich-editor-modal-btn rich-editor-modal-btn-cancel';
    cancelBtn.textContent = '取消';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'rich-editor-modal-btn rich-editor-modal-btn-confirm';
    confirmBtn.textContent = '确定';

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);

    modal.appendChild(title);
    modal.appendChild(urlInput);
    modal.appendChild(textInput);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 聚焦 URL 输入框并选中预设文字
    requestAnimationFrame(() => {
      urlInput.focus();
      urlInput.setSelectionRange(0, urlInput.value.length);
    });

    // 清理弹窗
    const closeModal = () => {
      overlay.remove();
    };

    // 插入链接
    const insertLink = () => {
      const url = urlInput.value.trim();
      const text = textInput.value.trim();
      if (!url || url === 'https://') {
        closeModal();
        return;
      }

      // 恢复选区
      this.editArea.focus();
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }

      if (text && text !== selectedText) {
        // 用户指定了新文字：删除选区，插入带链接的文字
        document.execCommand('insertHTML', false, `<a href="${url}">${text}</a>`);
      } else {
        // 使用选中文本或直接创建链接
        document.execCommand('createLink', false, url);
      }

      this._updateToolbarState();
      if (this.options.onChange) this.options.onChange(this.getHTML(), this.getText());
      closeModal();
    };

    cancelBtn.addEventListener('click', closeModal);
    confirmBtn.addEventListener('click', insertLink);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Enter 确认，Escape 取消
    const handleKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); insertLink(); }
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    };
    urlInput.addEventListener('keydown', handleKey);
    textInput.addEventListener('keydown', handleKey);
  }

  _sanitizeHTML(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    // 移除 script/style 标签
    temp.querySelectorAll('script, style, link, meta').forEach(el => el.remove());
    // 移除事件属性
    temp.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
      });
    });
    return temp.innerHTML;
  }

  _updateToolbarState() {
    if (!this.toolbar) return;
    const commands = ['bold', 'italic', 'underline', 'strike', 'unorderedList', 'orderedList'];
    const commandMap = { unorderedList: 'insertUnorderedList', orderedList: 'insertOrderedList' };
    this.toolbar.querySelectorAll('.rich-editor-toolbar-btn').forEach(btn => {
      const cmd = btn.dataset.command;
      if (commands.includes(cmd)) {
        const execCmd = commandMap[cmd] || cmd;
        try {
          btn.classList.toggle('active', document.queryCommandState(execCmd));
        } catch (e) { /* ignore */ }
      }
    });
  }

  _getCommandTitle(cmd) {
    const titles = {
      bold: '加粗 (Ctrl+B)',
      italic: '斜体 (Ctrl+I)',
      underline: '下划线 (Ctrl+U)',
      strike: '删除线',
      unorderedList: '无序列表',
      orderedList: '有序列表',
      link: '插入链接',
      image: '插入图片',
    };
    return titles[cmd] || cmd;
  }

  _getCommandIcon(cmd) {
    const icons = {
      bold: '<b>B</b>',
      italic: '<i>I</i>',
      underline: '<u>U</u>',
      strike: '<s>S</s>',
      unorderedList: '•≡',
      orderedList: '1.',
      link: '🔗',
      image: '🖼️',
    };
    return icons[cmd] || cmd;
  }

  // ---- Public API ----

  getHTML() {
    return this.isEmpty() ? '' : this.editArea.innerHTML;
  }

  getText() {
    return this.editArea.textContent || '';
  }

  setHTML(html) {
    if (!html || html.trim() === '') {
      this.editArea.innerHTML = '';
    } else {
      this.editArea.innerHTML = html;
    }
  }

  setText(text) {
    if (!text) {
      this.editArea.innerHTML = '';
    } else {
      this.editArea.textContent = text;
    }
  }

  isEmpty() {
    const text = this.editArea.textContent?.trim() || '';
    const html = this.editArea.innerHTML?.trim() || '';
    return text === '' && (!html || html === '<br>');
  }

  clear() {
    this.editArea.innerHTML = '';
  }

  focus() {
    this.editArea.focus();
  }

  destroy() {
    this.container.innerHTML = '';
    this.container.classList.remove('rich-editor-wrapper', 'rich-editor-compact');
  }
}

// 全局工厂方法
window.RichEditor = RichEditor;
