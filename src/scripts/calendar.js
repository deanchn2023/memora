const Calendar = {
  currentDate: new Date(),
  currentView: 'week', // day/week/month 保持日历内部子视图
  calendarSubView: 'week', // 日历子视图（独立于 currentView，避免被其他视图覆盖）
  calendarActive: false, // 日历标签是否激活
  draggedTask: null,
  isDragging: false,
  dragGhost: null,

  init() {
    this.calendarActive = true; // 默认显示日历
    this.bindEvents();
    this.bindGlobalDragEvents();
    this.render();
  },

  bindEvents() {
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        // 找到实际的 view-tab 按钮（避免点击 badge 等子元素时出错）
        const viewTab = e.target.closest('.view-tab');
        if (!viewTab) return;
        
        document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
        viewTab.classList.add('active');
        const view = viewTab.dataset.view;

        if (view === 'calendar') {
          this.calendarActive = true;
          this.showCalendarView();
          this.showDateNavigator();
        } else if (view === 'documents') {
          this.calendarActive = false;
          this.currentView = 'documents';
          this.hideCalendarView();
          this.hideOtherViews('documents');
          this.hideDateNavigator();
          document.getElementById('documentsView')?.classList.remove('hidden');
          this.updateDateDisplay();
          if (window.Documents) Documents.onShow();
        } else {
          this.calendarActive = false;
          this.currentView = view;
          this.hideCalendarView();
          this.hideOtherViews(view);
          this.hideDateNavigator();
          if (view === 'notebook') this.renderNotebookView();
          else if (view === 'knowledge') this.renderKnowledgeView();
        }
      });
    });

    // 日历子视图切换（日/周/月）
    document.querySelectorAll('.calendar-sub-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.calendar-sub-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentView = e.target.dataset.cal;
        this.calendarSubView = this.currentView; // 记住用户选择
        this.render();
      });
    });

    document.getElementById('prevDate')?.addEventListener('click', () => this.navigate(-1));
    document.getElementById('nextDate')?.addEventListener('click', () => this.navigate(1));
    document.getElementById('todayBtn')?.addEventListener('click', () => this.goToToday());
  },

  showCalendarView() {
    document.getElementById('calendarView')?.classList.remove('hidden');
    document.getElementById('documentsView')?.classList.add('hidden');
    document.getElementById('notebookView')?.classList.add('hidden');
    document.getElementById('knowledgeView')?.classList.add('hidden');
    document.getElementById('aiAssistantView')?.classList.add('hidden');
    // 恢复日历子视图（currentView 可能被其他视图标签覆盖过）
    this.currentView = this.calendarSubView;
    // 同步子标签激活状态
    document.querySelectorAll('.calendar-sub-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.cal === this.currentView);
    });
    this.showDateNavigator();
    this.render();
  },

  hideCalendarView() {
    document.getElementById('calendarView')?.classList.add('hidden');
  },

  hideOtherViews(activeView) {
    // 隐藏非当前激活的视图
    document.getElementById('notebookView')?.classList.add('hidden');
    document.getElementById('knowledgeView')?.classList.add('hidden');
    document.getElementById('aiAssistantView')?.classList.add('hidden');
    document.getElementById('documentsView')?.classList.add('hidden');
    document.getElementById('calendarView')?.classList.add('hidden');

    if (activeView === 'notebook') {
      document.getElementById('notebookView')?.classList.remove('hidden');
    } else if (activeView === 'knowledge') {
      document.getElementById('knowledgeView')?.classList.remove('hidden');
    }
  },

  // 全局拖拽事件（监听 document 级别的 mousemove 和 mouseup）
  bindGlobalDragEvents() {
    document.addEventListener('mousemove', (e) => this.onDragMove(e));
    document.addEventListener('mouseup', (e) => this.onDragEnd(e));
  },

  navigate(direction) {
    if (!this.calendarActive) return;
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
    if (!this.calendarActive) return;
    this.currentDate = new Date();
    this.render();
  },

  render() {
    this.updateDateDisplay();

    if (!this.calendarActive) return;

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
    }
  },

  updateDateDisplay() {
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    let displayText = '';

    if (!this.calendarActive) {
      switch (this.currentView) {
        case 'notebook':
          displayText = window.i18n?.t('nav.notebook') || '记事本';
          break;
        case 'knowledge':
          displayText = window.i18n?.t('nav.knowledge') || '知识';
          break;
        case 'documents':
          displayText = window.i18n?.t('nav.documents') || '文档';
          break;
      }
    } else {
      const locale = window.i18n?.locale === 'en' ? 'en-US' : 'zh-CN';
      switch (this.currentView) {
        case 'day':
          displayText = this.currentDate.toLocaleDateString(locale, options);
          break;
        case 'week':
          const weekStart = this.getWeekStart(this.currentDate);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);
          if (locale === 'en-US') {
            displayText = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
          } else {
            displayText = `${weekStart.getMonth() + 1}月${weekStart.getDate()}日 - ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
          }
          break;
        case 'month':
          displayText = this.currentDate.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
          break;
      }
    }

    document.getElementById('currentDate').textContent = displayText;
  },

  // ========== 日视图 ==========
  renderDayView() {
    document.getElementById('dayView')?.classList.remove('hidden');
    document.getElementById('weekView')?.classList.add('hidden');
    document.getElementById('monthView')?.classList.add('hidden');

    const grid = document.getElementById('timeGrid');
    grid.innerHTML = '';

    const tasks = Store.getTasksByDate(this.currentDate);

    // 绘制时间槽（纯视觉网格）
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
        timeContent.className = 'time-content';
        timeContent.dataset.hour = hour;
        timeContent.dataset.minute = minute;

        slot.appendChild(timeLabel);
        slot.appendChild(timeContent);
        grid.appendChild(slot);
      }
    }

    // 创建任务覆盖层（absolute 定位，覆盖在网格上方）
    const overlay = document.createElement('div');
    overlay.className = 'task-overlay';
    overlay.id = 'taskOverlay';
    grid.appendChild(overlay);

    tasks.forEach(task => this.renderTaskBlock(task));

    // 给整个网格绑定 drop 事件（基于鼠标位置计算目标时间）
    this.bindDayViewDrop(grid);

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

      // 根据当前时间段决定默认滚动位置
      if (currentHour < 6) {
        // 凌晨：滚动到早晨区域
        targetSlot = slots[0]; // 06:00
      } else if (currentHour > 22) {
        // 深夜：滚动到晚间区域
        targetSlot = slots[Math.floor(slots.length * 0.7)]; // 约20:00
      } else {
        // 6-22点：找最近的时间槽
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
        // 将当前时间段定位在视口上方 1/4 处，方便看到前后内容
        const slotHeight = targetSlot.offsetHeight || 30;
        const offset = Math.max(0, targetSlot.offsetTop - slotHeight * 2);
        grid.scrollTop = offset;
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

    const overlay = document.getElementById('taskOverlay');
    if (!overlay) return;

    const dueDate = new Date(task.dueDate);
    const duration = task.estimatedDuration || 60;
    // 开始时间 = 截止时间 - 时长
    const startDate = new Date(dueDate.getTime() - duration * 60000);
    const startHour = startDate.getHours();
    const startMinute = startDate.getMinutes();

    // 每分钟对应的像素高度（与 CSS time-slot min-height: 64px 对应，每 30 分钟一格）
    const pxPerMinute = 64 / 30;
    // 网格起始时间 6:00
    const gridStartMinutes = 6 * 60;
    const startTotalMinutes = startHour * 60 + startMinute;
    const top = (startTotalMinutes - gridStartMinutes) * pxPerMinute;
    const height = duration * pxPerMinute;

    // 超出可见范围则不渲染
    if (top + height < 0 || top > (22 - 6 + 1) * 60 * pxPerMinute) return;

    const isCompleted = task.status === 'completed';
    const block = document.createElement('div');
    block.className = `task-block ${task.priority}${task.isDraft ? ' draft' : ''}${isCompleted ? ' completed' : ''}`;
    block.style.height = `${Math.max(height, 28)}px`;
    block.style.top = `${top}px`;
    block.dataset.taskId = task.id;
    block.draggable = !isCompleted;

    const draftLabel = task.isDraft ? '<span class="task-draft-label">草稿</span>' : '';
    const completedLabel = isCompleted ? '<span class="task-completed-label">✓ 已完成</span>' : '';
    const startTimeStr = startDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const endTimeStr = dueDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    block.innerHTML = `
      <div class="task-title">${task.title} ${draftLabel} ${completedLabel}</div>
      <div class="task-time">${startTimeStr} - ${endTimeStr} · ${duration}分钟</div>
      <button class="task-delete-btn" title="删除任务">×</button>
    `;

    // 点击查看详情 - 从 Store 获取最新数据
    block.addEventListener('click', (e) => {
      if (!e.target.classList.contains('task-delete-btn') && !this.isDragging) {
        const freshTask = Store.getTasks().find(t => t.id === task.id);
        if (freshTask) this.showTaskDetail(freshTask);
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
    });

    block.addEventListener('dragend', () => {
      block.classList.remove('dragging');
      this.draggedTask = null;
      this.clearAllDropHighlights();
    });

    overlay.appendChild(block);
  },

  // 日视图网格级 drop 事件（基于鼠标位置精确定位目标时间）
  bindDayViewDrop(grid) {
    // 先移除旧事件（防止重复绑定）
    if (grid._dayDropHandler) {
      grid.removeEventListener('dragover', grid._dayDragOverHandler);
      grid.removeEventListener('drop', grid._dayDropHandler);
    }

    grid._dayDragOverHandler = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // 高亮对应的时间槽
      const timeInfo = this.getTimeFromMouseY(e, grid);
      if (timeInfo) {
        this.highlightTimeSlot(grid, timeInfo.hour, timeInfo.minute);
      }
    };

    grid._dayDropHandler = (e) => {
      e.preventDefault();
      this.clearAllDropHighlights();

      const taskId = e.dataTransfer.getData('text/plain');
      if (!taskId) return;

      const timeInfo = this.getTimeFromMouseY(e, grid);
      if (timeInfo) {
        this.moveTaskToTime(taskId, timeInfo.hour, timeInfo.minute);
      }
    };

    grid.addEventListener('dragover', grid._dayDragOverHandler);
    grid.addEventListener('drop', grid._dayDropHandler);
  },

  // 根据鼠标 Y 坐标计算对应的时间（30分钟精度）
  getTimeFromMouseY(e, grid) {
    const gridRect = grid.getBoundingClientRect();
    const mouseY = e.clientY - gridRect.top;

    // 时间网格从 padding 顶部开始，减去 padding
    const gridTop = 24; // padding-top
    const relativeY = mouseY - gridTop;

    if (relativeY < 0) return { hour: 6, minute: 0 };

    const pxPerMinute = 64 / 30;
    const totalMinutes = Math.round(relativeY / pxPerMinute);
    const gridStartMinutes = 6 * 60;
    const absoluteMinutes = gridStartMinutes + totalMinutes;

    // 对齐到 30 分钟
    const alignedMinutes = Math.floor(absoluteMinutes / 30) * 30;
    const hour = Math.floor(alignedMinutes / 60);
    const minute = alignedMinutes % 60;

    // 限制在 6:00 ~ 22:30
    if (hour < 6) return { hour: 6, minute: 0 };
    if (hour > 22 || (hour === 22 && minute > 30)) return { hour: 22, minute: 30 };

    return { hour, minute };
  },

  // 高亮对应的时间槽
  highlightTimeSlot(grid, hour, minute) {
    this.clearAllDropHighlights();
    const slots = grid.querySelectorAll('.time-content');
    slots.forEach(slot => {
      if (parseInt(slot.dataset.hour) === hour && parseInt(slot.dataset.minute) === minute) {
        slot.classList.add('drag-over');
      }
    });
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
    document.getElementById('dayView')?.classList.add('hidden');
    document.getElementById('weekView')?.classList.remove('hidden');
    document.getElementById('monthView')?.classList.add('hidden');

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
            <div class="week-task priority-${task.priority}${task.status === 'completed' ? ' completed' : ''} draggable-task" data-id="${task.id}" draggable="${task.status !== 'completed'}" title="${this.getTaskTooltip(task)}">
              <span class="week-task-time">${new Date(task.dueDate).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              ${task.status === 'completed' ? '<span class="week-task-check">✓</span>' : ''}
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
        this.calendarSubView = 'day';
        document.querySelectorAll('.calendar-sub-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-cal="day"]').classList.add('active');
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
    document.getElementById('dayView')?.classList.add('hidden');
    document.getElementById('weekView')?.classList.add('hidden');
    document.getElementById('monthView')?.classList.remove('hidden');

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
        const completedClass = task.status === 'completed' ? ' completed' : '';
        return `<div class="month-task-tag priority-${priorityClass}${completedClass}" data-id="${task.id}" draggable="${task.status !== 'completed'}" title="${this.getTaskTooltip(task)}">${task.status === 'completed' ? '✓ ' : ''}${task.title}</div>`;
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
        this.calendarSubView = 'day';
        document.querySelectorAll('.calendar-sub-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-cal="day"]').classList.add('active');
        this.render();
      });

      grid.appendChild(dayEl);
    }

    container.appendChild(grid);
  },

  // ========== 拖拽移动逻辑 ==========

  // 日视图：移动到指定开始时间（同一天）
  moveTaskToTime(taskId, hour, minute) {
    const task = Store.getTasks().find(t => t.id === taskId);
    if (!task) return;

    const duration = task.estimatedDuration || 60;
    // 新的截止时间 = 新开始时间 + 时长
    const newDueDate = new Date(task.dueDate || new Date());
    newDueDate.setHours(hour, minute, 0, 0);
    // dueDate 是截止时间，所以 hour:minute 作为开始，加上时长得到截止时间
    newDueDate.setTime(newDueDate.getTime() + duration * 60000);

    Store.updateTask(task.id, { dueDate: newDueDate.toISOString() });
    this.render();

    if (typeof App !== 'undefined') {
      App.renderTaskList();
      const endTime = new Date(newDueDate.getTime());
      const startTime = new Date(endTime.getTime() - duration * 60000);
      App.showToast(`已移至 ${startTime.getHours()}:${String(startTime.getMinutes()).padStart(2, '0')} - ${endTime.getHours()}:${String(endTime.getMinutes()).padStart(2, '0')}`);
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
    this.hideOtherViews('notebook');
    this.calendarActive = false;
    this.currentView = 'notebook';

    document.getElementById('currentDate').textContent = window.i18n?.t('nav.notebook') || '记事本';

    if (typeof App !== 'undefined') {
      App.clearNotebookBadge();
    }

    App.loadNotes();
  },

  renderKnowledgeView() {
    this.hideOtherViews('knowledge');
    this.calendarActive = false;
    this.currentView = 'knowledge';

    document.getElementById('currentDate').textContent = window.i18n?.t('nav.knowledge') || '知识';

    // 初始化知识跟随模块
    if (window.knowledgeFollow) {
      window.knowledgeFollow.init();
      window.knowledgeFollow.onShow();
    }

    // 初始化知识萃取模块
    if (window.knowledgeDistillation) {
      window.knowledgeDistillation.init();
      window.knowledgeDistillation.onShow();
    }
  },

  renderDocumentsView() {
    this.hideOtherViews('documents');
    this.calendarActive = false;
    this.currentView = 'documents';

    document.getElementById('currentDate').textContent = window.i18n?.t('nav.documents') || '文档';

    if (window.Documents) Documents.onShow();
  },

  showDateNavigator() {
    const nav = document.querySelector('.date-navigator');
    if (nav) nav.style.display = '';
  },

  hideDateNavigator() {
    const nav = document.querySelector('.date-navigator');
    if (nav) nav.style.display = 'none';
  }
};

window.Calendar = Calendar;
