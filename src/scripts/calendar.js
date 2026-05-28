const Calendar = {
  currentDate: new Date(),
  currentView: 'day',
  draggedTask: null,
  isDragging: false,
  dragGhost: null,

  init() {
    this.bindEvents();
    this.bindGlobalDragEvents();
    this.render();
  },

  bindEvents() {
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentView = e.target.dataset.view;
        this.render();
      });
    });

    document.getElementById('prevDate').addEventListener('click', () => this.navigate(-1));
    document.getElementById('nextDate').addEventListener('click', () => this.navigate(1));
    document.getElementById('todayBtn').addEventListener('click', () => this.goToToday());
  },

  // 全局拖拽事件（监听 document 级别的 mousemove 和 mouseup）
  bindGlobalDragEvents() {
    document.addEventListener('mousemove', (e) => this.onDragMove(e));
    document.addEventListener('mouseup', (e) => this.onDragEnd(e));
  },

  navigate(direction) {
    switch (this.currentView) {
      case 'day':
        this.currentDate.setDate(this.currentDate.getDate() + direction);
        break;
      case 'week':
        this.currentDate.setDate(this.currentDate.getDate() + (direction * 7));
        break;
      case 'month':
        this.currentDate.setMonth(this.currentDate.getMonth() + direction);
        break;
    }
    this.render();
  },

  goToToday() {
    this.currentDate = new Date();
    this.render();
  },

  render() {
    this.updateDateDisplay();

    switch (this.currentView) {
      case 'day':
        this.renderDayView();
        break;
      case 'week':
        this.renderWeekView();
        break;
      case 'month':
        this.renderMonthView();
        break;
      case 'notebook':
        this.renderNotebookView();
        break;
    }
  },

  updateDateDisplay() {
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    let displayText = '';

    switch (this.currentView) {
      case 'day':
        displayText = this.currentDate.toLocaleDateString('zh-CN', options);
        break;
      case 'week':
        const weekStart = this.getWeekStart(this.currentDate);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        displayText = `${weekStart.getMonth() + 1}月${weekStart.getDate()}日 - ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
        break;
      case 'month':
        displayText = this.currentDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
        break;
    }

    document.getElementById('currentDate').textContent = displayText;
  },

  // ========== 日视图 ==========
  renderDayView() {
    document.getElementById('dayView').classList.remove('hidden');
    document.getElementById('weekView').classList.add('hidden');
    document.getElementById('monthView').classList.add('hidden');

    const grid = document.getElementById('timeGrid');
    grid.innerHTML = '';

    const tasks = Store.getTasksByDate(this.currentDate);

    for (let hour = 6; hour <= 22; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slot = document.createElement('div');
        slot.className = 'time-slot';
        slot.dataset.hour = hour;
        slot.dataset.minute = minute;

        const timeLabel = document.createElement('div');
        timeLabel.className = 'time-label';
        timeLabel.textContent = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

        const timeContent = document.createElement('div');
        timeContent.className = 'time-content drop-target';
        timeContent.dataset.hour = hour;
        timeContent.dataset.minute = minute;

        slot.appendChild(timeLabel);
        slot.appendChild(timeContent);
        grid.appendChild(slot);
      }
    }

    tasks.forEach(task => this.renderTaskBlock(task));

    this.scrollToCurrentTime();
  },

  scrollToCurrentTime() {
    setTimeout(() => {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      const grid = document.getElementById('timeGrid');
      if (!grid) return;

      const slots = grid.querySelectorAll('.time-slot');
      if (slots.length === 0) return;

      let targetSlot = null;
      let minDiff = Infinity;

      if (currentHour < 6 || currentHour > 22) {
        targetSlot = slots[6];
      } else {
        slots.forEach(slot => {
          const slotHour = parseInt(slot.dataset.hour);
          const slotMinute = parseInt(slot.dataset.minute);
          const slotTime = slotHour * 60 + slotMinute;
          const currentTime = currentHour * 60 + currentMinute;
          const diff = Math.abs(slotTime - currentTime);
          if (diff < minDiff) {
            minDiff = diff;
            targetSlot = slot;
          }
        });
      }

      if (targetSlot) {
        const gridRect = grid.getBoundingClientRect();
        const slotRect = targetSlot.getBoundingClientRect();
        const scrollTop = targetSlot.offsetTop - (gridRect.height / 2) + (slotRect.height / 2);
        grid.scrollTop = Math.max(0, scrollTop);
      } else {
        this.scrollToFirstTask();
      }
    }, 300);
  },

  scrollToFirstTask() {
    const grid = document.getElementById('timeGrid');
    if (!grid) return;

    const tasks = grid.querySelectorAll('.task-block');
    if (tasks.length === 0) return;

    const firstTask = tasks[0];
    const gridRect = grid.getBoundingClientRect();
    const taskRect = firstTask.getBoundingClientRect();
    const scrollTop = firstTask.offsetTop - (gridRect.height / 2) + (taskRect.height / 2);
    grid.scrollTop = Math.max(0, scrollTop);
  },

  renderTaskBlock(task) {
    if (!task.dueDate) return;

    const dueDate = new Date(task.dueDate);
    const startHour = Math.max(6, dueDate.getHours() - Math.floor(task.estimatedDuration / 60));
    const startMinute = dueDate.getMinutes();
    const duration = task.estimatedDuration;
    const height = (duration / 30) * 60;

    const grid = document.getElementById('timeGrid');
    const slots = grid.querySelectorAll('.time-content');

    slots.forEach(slot => {
      const slotHour = parseInt(slot.dataset.hour);
      const slotMinute = parseInt(slot.dataset.minute);

      if (slotHour === startHour && Math.abs(slotMinute - startMinute) < 30) {
        const block = document.createElement('div');
        block.className = `task-block ${task.priority}${task.isDraft ? ' draft' : ''}`;
        block.style.height = `${height}px`;
        block.style.top = '4px';
        block.dataset.taskId = task.id;
        block.draggable = true;

        const draftLabel = task.isDraft ? '<span class="task-draft-label">草稿</span>' : '';
        block.innerHTML = `
          <div class="task-title">${task.title} ${draftLabel}</div>
          <div class="task-time">${dueDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · ${duration}分钟</div>
          <button class="task-delete-btn" title="删除任务">×</button>
        `;

        // 点击查看详情
        block.addEventListener('click', (e) => {
          if (!e.target.classList.contains('task-delete-btn') && !this.isDragging) {
            this.showTaskDetail(task);
          }
        });

        // 删除按钮
        block.querySelector('.task-delete-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteTask(task);
        });

        // 拖拽开始
        block.addEventListener('dragstart', (e) => {
          if (e.target.classList.contains('task-delete-btn')) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData('text/plain', task.id);
          e.dataTransfer.effectAllowed = 'move';
          this.draggedTask = task;
          block.classList.add('dragging');
          console.log('[Calendar] Day view drag started:', task.title);
        });

        block.addEventListener('dragend', () => {
          block.classList.remove('dragging');
          this.draggedTask = null;
          this.clearAllDropHighlights();
        });

        slot.appendChild(block);
      }
    });

    // 给日视图的 time-content 绑定 drop 事件
    this.bindDropEvents(grid);
  },

  // 给容器内的所有 drop-target 元素绑定拖放事件
  bindDropEvents(container) {
    const targets = container.querySelectorAll('.drop-target');
    targets.forEach(target => {
      target.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        target.classList.add('drag-over');
      });

      target.addEventListener('dragleave', () => {
        target.classList.remove('drag-over');
      });

      target.addEventListener('drop', (e) => {
        e.preventDefault();
        target.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) {
          // 日视图：更新时间
          const hour = parseInt(target.dataset.hour);
          const minute = parseInt(target.dataset.minute);
          if (!isNaN(hour)) {
            this.moveTaskToTime(taskId, hour, minute);
          }
          // 周/月视图：更新日期
          const dateStr = target.dataset.date;
          if (dateStr) {
            this.moveTaskToDate(taskId, dateStr);
          }
        }
      });
    });
  },

  // 清除所有拖拽高亮
  clearAllDropHighlights() {
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  },

  // ========== 周视图（带拖拽） ==========
  renderWeekView() {
    document.getElementById('dayView').classList.add('hidden');
    document.getElementById('weekView').classList.remove('hidden');
    document.getElementById('monthView').classList.add('hidden');

    const container = document.getElementById('weekView');
    container.innerHTML = '';

    const weekStart = this.getWeekStart(this.currentDate);
    const tasks = Store.getTasksByWeek(weekStart);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const grid = document.createElement('div');
    grid.className = 'week-grid';

    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + i);
      const dateStr = this.formatDateStr(dayDate);

      const dayTasks = tasks.filter(task => {
        if (!task.dueDate) return false;
        const taskDate = new Date(task.dueDate);
        taskDate.setHours(0, 0, 0, 0);
        return taskDate.getTime() === dayDate.getTime();
      });

      const isToday = dayDate.getTime() === today.getTime();

      const dayEl = document.createElement('div');
      dayEl.className = `week-day drop-target ${isToday ? 'today' : ''}`;
      dayEl.dataset.date = dateStr;

      dayEl.innerHTML = `
        <div class="week-day-header">
          <div class="day-name">周${dayNames[i]}</div>
          <div class="day-number">${dayDate.getDate()}</div>
        </div>
        <div class="week-day-tasks">
          ${dayTasks.map(task => `
            <div class="week-task priority-${task.priority} draggable-task" data-id="${task.id}" draggable="true" title="${this.getTaskTooltip(task)}">
              <span class="week-task-time">${new Date(task.dueDate).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              ${task.title}
              <button class="week-task-delete" data-task-id="${task.id}">×</button>
            </div>
          `).join('')}
        </div>
      `;

      // 周视图任务事件
      dayEl.querySelectorAll('.week-task').forEach(taskEl => {
        taskEl.addEventListener('dragstart', (e) => {
          if (e.target.classList.contains('week-task-delete')) {
            e.preventDefault();
            return;
          }
          const taskId = taskEl.dataset.id;
          e.dataTransfer.setData('text/plain', taskId);
          e.dataTransfer.effectAllowed = 'move';
          this.draggedTask = Store.getTasks().find(t => t.id === taskId);
          taskEl.classList.add('dragging');
        });

        taskEl.addEventListener('dragend', () => {
          taskEl.classList.remove('dragging');
          this.draggedTask = null;
          this.clearAllDropHighlights();
        });

        taskEl.addEventListener('click', (e) => {
          if (e.target.classList.contains('week-task-delete')) {
            e.stopPropagation();
            const taskId = e.target.dataset.taskId;
            const task = Store.getTasks().find(t => t.id === taskId);
            if (task) this.deleteTask(task);
          } else {
            const taskId = taskEl.dataset.id;
            const task = Store.getTasks().find(t => t.id === taskId);
            if (task) this.showTaskDetail(task);
          }
        });
      });

      // 双击日期头部跳转到日视图
      dayEl.querySelector('.week-day-header').addEventListener('dblclick', () => {
        this.currentDate = dayDate;
        this.currentView = 'day';
        document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-view="day"]').classList.add('active');
        this.render();
      });

      grid.appendChild(dayEl);
    }

    // 绑定周视图的 drop 事件
    grid.querySelectorAll('.week-day.drop-target').forEach(dayEl => {
      dayEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dayEl.classList.add('drag-over');
      });

      dayEl.addEventListener('dragleave', (e) => {
        // 只在离开 dayEl 时移除高亮，避免子元素触发
        if (!dayEl.contains(e.relatedTarget)) {
          dayEl.classList.remove('drag-over');
        }
      });

      dayEl.addEventListener('drop', (e) => {
        e.preventDefault();
        dayEl.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const dateStr = dayEl.dataset.date;
        if (taskId && dateStr) {
          this.moveTaskToDate(taskId, dateStr);
        }
      });
    });

    container.appendChild(grid);
  },

  // ========== 月视图（带拖拽） ==========
  renderMonthView() {
    document.getElementById('dayView').classList.add('hidden');
    document.getElementById('weekView').classList.add('hidden');
    document.getElementById('monthView').classList.remove('hidden');

    const container = document.getElementById('monthView');
    container.innerHTML = '';

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const tasks = Store.getTasksByMonth(year, month);

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const grid = document.createElement('div');
    grid.className = 'month-grid';

    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    dayNames.forEach(name => {
      const header = document.createElement('div');
      header.className = 'month-header';
      header.textContent = name;
      grid.appendChild(header);
    });

    for (let i = 0; i < 42; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = this.formatDateStr(date);

      const isOtherMonth = date.getMonth() !== month;
      const isToday = date.getTime() === today.getTime();

      const dayTasks = tasks.filter(task => {
        if (!task.dueDate) return false;
        const taskDate = new Date(task.dueDate);
        taskDate.setHours(0, 0, 0, 0);
        return taskDate.getTime() === date.getTime();
      });

      const dayEl = document.createElement('div');
      dayEl.className = `month-day drop-target ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}`;
      dayEl.dataset.date = dateStr;

      // 月视图显示任务标签（最多3个）
      const taskTags = dayTasks.slice(0, 3).map(task => {
        const priorityClass = task.priority || 'medium';
        return `<div class="month-task-tag priority-${priorityClass}" data-id="${task.id}" draggable="true" title="${this.getTaskTooltip(task)}">${task.title}</div>`;
      }).join('');
      const moreCount = dayTasks.length > 3 ? `<div class="month-task-more">+${dayTasks.length - 3}</div>` : '';

      dayEl.innerHTML = `
        <div class="month-day-number">${date.getDate()}</div>
        <div class="month-task-list">
          ${taskTags}
          ${moreCount}
        </div>
      `;

      // 月视图任务标签拖拽
      dayEl.querySelectorAll('.month-task-tag').forEach(tagEl => {
        tagEl.addEventListener('dragstart', (e) => {
          e.stopPropagation();
          const taskId = tagEl.dataset.id;
          e.dataTransfer.setData('text/plain', taskId);
          e.dataTransfer.effectAllowed = 'move';
          this.draggedTask = Store.getTasks().find(t => t.id === taskId);
          tagEl.classList.add('dragging');
        });

        tagEl.addEventListener('dragend', () => {
          tagEl.classList.remove('dragging');
          this.draggedTask = null;
          this.clearAllDropHighlights();
        });

        // 点击任务标签查看详情
        tagEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const taskId = tagEl.dataset.id;
          const task = Store.getTasks().find(t => t.id === taskId);
          if (task) this.showTaskDetail(task);
        });
      });

      // 月视图日期格的 drop 事件
      dayEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dayEl.classList.add('drag-over');
      });

      dayEl.addEventListener('dragleave', (e) => {
        if (!dayEl.contains(e.relatedTarget)) {
          dayEl.classList.remove('drag-over');
        }
      });

      dayEl.addEventListener('drop', (e) => {
        e.preventDefault();
        dayEl.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const dateStr = dayEl.dataset.date;
        if (taskId && dateStr) {
          this.moveTaskToDate(taskId, dateStr);
        }
      });

      // 点击日期跳转到日视图
      dayEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('month-task-tag')) return;
        this.currentDate = date;
        this.currentView = 'day';
        document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-view="day"]').classList.add('active');
        this.render();
      });

      grid.appendChild(dayEl);
    }

    container.appendChild(grid);
  },

  // ========== 拖拽移动逻辑 ==========

  // 日视图：移动到指定时间（同一天）
  moveTaskToTime(taskId, hour, minute) {
    const task = Store.getTasks().find(t => t.id === taskId);
    if (!task || !task.dueDate) return;

    const newDate = new Date(task.dueDate);
    newDate.setHours(hour, minute, 0, 0);

    console.log('[Calendar] Moving task to time:', task.title, '→', newDate.toLocaleString());
    Store.updateTask(task.id, { dueDate: newDate.toISOString() });
    this.render();

    if (typeof App !== 'undefined') {
      App.renderTaskList();
      App.showToast(`已移至 ${hour}:${String(minute).padStart(2, '0')}`);
    }
  },

  // 周/月视图：移动到指定日期（保留原时间）
  moveTaskToDate(taskId, dateStr) {
    const task = Store.getTasks().find(t => t.id === taskId);
    if (!task) return;

    let newDate;
    if (task.dueDate) {
      // 保留原有时分秒，只改日期
      const oldDate = new Date(task.dueDate);
      const [year, month, day] = dateStr.split('-').map(Number);
      newDate = new Date(year, month - 1, day, oldDate.getHours(), oldDate.getMinutes(), 0, 0);
    } else {
      // 没有 dueDate 的情况，默认设为当天 9:00
      const [year, month, day] = dateStr.split('-').map(Number);
      newDate = new Date(year, month - 1, day, 9, 0, 0, 0);
    }

    console.log('[Calendar] Moving task to date:', task.title, '→', newDate.toLocaleString());
    Store.updateTask(task.id, { dueDate: newDate.toISOString() });
    this.render();

    if (typeof App !== 'undefined') {
      App.renderTaskList();
      const dateLabel = `${newDate.getMonth() + 1}月${newDate.getDate()}日 ${newDate.getHours()}:${String(newDate.getMinutes()).padStart(2, '0')}`;
      App.showToast(`已移至 ${dateLabel}`);
    }
  },

  // ========== 全局 mouse 拖拽（备用方案，用于更流畅的拖拽体验） ==========
  onDragMove(e) {
    // 当前使用原生 HTML5 Drag & Drop，不需要自定义 mousemove 逻辑
    // 如需更精细的控制，可在此实现自定义拖拽
  },

  onDragEnd(e) {
    this.isDragging = false;
    this.clearAllDropHighlights();
  },

  // ========== 工具方法 ==========

  formatDateStr(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  getTaskTooltip(task) {
    const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleString('zh-CN') : '无截止时间';
    const priority = { high: '高', medium: '中', low: '低' }[task.priority] || '中';
    return `${task.title}\n时间: ${dueDate}\n优先级: ${priority}\n时长: ${task.estimatedDuration}分钟\n\n拖拽可更改时间`;
  },

  getWeekStart(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  },

  deleteTask(task) {
    if (confirm(`确定要删除任务"${task.title}"吗？`)) {
      Store.deleteTask(task.id);
      console.log('[Calendar] Task deleted:', task.title);
      this.render();
      if (typeof App !== 'undefined') {
        App.renderTaskList();
      }
    }
  },

  showTaskDetail(task) {
    const event = new CustomEvent('showTaskModal', { detail: task });
    document.dispatchEvent(event);
  },

  renderNotebookView() {
    document.getElementById('dayView').classList.add('hidden');
    document.getElementById('weekView').classList.add('hidden');
    document.getElementById('monthView').classList.add('hidden');
    document.getElementById('notebookView').classList.remove('hidden');

    document.getElementById('currentDate').textContent = '记事本';

    if (typeof App !== 'undefined') {
      App.clearNotebookBadge();
    }

    App.loadNotes();
  }
};

window.Calendar = Calendar;
