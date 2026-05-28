const Calendar = {
  currentDate: new Date(),
  currentView: 'day',
  draggedTask: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  isDragging: false,

  init() {
    this.bindEvents();
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
        timeContent.className = 'time-content';
        timeContent.dataset.hour = hour;
        timeContent.dataset.minute = minute;
        
        slot.appendChild(timeLabel);
        slot.appendChild(timeContent);
        grid.appendChild(slot);
      }
    }
    
    tasks.forEach(task => this.renderTaskBlock(task));
    
    // 滚动到当前时间
    this.scrollToCurrentTime();
  },

  scrollToCurrentTime() {
    setTimeout(() => {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      
      const grid = document.getElementById('timeGrid');
      if (!grid) {
        console.log('[Calendar] timeGrid not found');
        return;
      }
      
      const slots = grid.querySelectorAll('.time-slot');
      if (slots.length === 0) {
        console.log('[Calendar] No time slots found');
        return;
      }
      
      console.log('[Calendar] Current time:', `${currentHour}:${currentMinute}`);
      console.log('[Calendar] Total slots:', slots.length);
      
      let targetSlot = null;
      let minDiff = Infinity;
      
      // 如果当前时间在可视范围外（早于6点或晚于22点），默认定位到9点
      if (currentHour < 6 || currentHour > 22) {
        console.log('[Calendar] Current time out of range, defaulting to 9:00');
        targetSlot = slots[6]; // 9:00 的槽位（6点开始，每个小时2个槽，9-6=3小时，3*2=6）
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
        console.log('[Calendar] Target slot:', targetSlot.dataset.hour + ':' + targetSlot.dataset.minute);
        const gridRect = grid.getBoundingClientRect();
        const slotRect = targetSlot.getBoundingClientRect();
        const scrollTop = targetSlot.offsetTop - (gridRect.height / 2) + (slotRect.height / 2);
        
        console.log('[Calendar] ScrollTop:', scrollTop);
        grid.scrollTop = Math.max(0, scrollTop);
      } else {
        console.log('[Calendar] No target slot found, trying to find task');
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
    console.log('[Calendar] Scrolled to first task');
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
          if (!e.target.classList.contains('task-delete-btn')) {
            this.showTaskDetail(task);
          }
        });
        
        // 删除按钮事件
        block.querySelector('.task-delete-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteTask(task);
        });
        
        // 拖拽开始
        block.addEventListener('mousedown', (e) => {
          if (e.target.classList.contains('task-delete-btn')) return;
          this.onDragStart(e, task, block);
        });
        
        // 原生拖拽事件
        block.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', task.id);
          this.draggedTask = task;
        });
        
        // 放置区域事件
        slot.addEventListener('dragover', (e) => {
          e.preventDefault();
          slot.classList.add('drag-over');
        });
        
        slot.addEventListener('dragleave', () => {
          slot.classList.remove('drag-over');
        });
        
        slot.addEventListener('drop', (e) => {
          e.preventDefault();
          slot.classList.remove('drag-over');
          const taskId = e.dataTransfer.getData('text/plain');
          if (taskId) {
            const targetHour = parseInt(slot.dataset.hour);
            const targetMinute = parseInt(slot.dataset.minute);
            this.moveTaskToTime(taskId, targetHour, targetMinute);
          }
        });
        
        slot.appendChild(block);
      }
    });
  },

  onDragStart(e, task, block) {
    e.preventDefault();
    this.draggedTask = task;
    this.isDragging = true;
    this.dragBlock = block;
    this.originalSlot = block.parentElement;
    
    const rect = block.getBoundingClientRect();
    this.dragOffsetX = e.clientX - rect.left;
    this.dragOffsetY = e.clientY - rect.top;
    
    block.classList.add('dragging');
    console.log('[Calendar] Drag started for task:', task.title);
  },

  moveTaskToTime(taskId, hour, minute) {
    const task = Store.getTasks().find(t => t.id === taskId);
    if (!task) return;
    
    const newTime = new Date(task.dueDate);
    newTime.setHours(hour, minute, 0, 0);
    
    console.log('[Calendar] Moving task to:', newTime.toLocaleString());
    Store.updateTask(task.id, { dueDate: newTime.toISOString() });
    this.render();
    
    if (typeof App !== 'undefined') {
      App.renderTaskList();
    }
  },

  deleteTask(task) {
    if (confirm(`确定要删除任务"${task.title}"吗？`)) {
      Store.deleteTask(task.id);
      console.log('[Calendar] Task deleted:', task.title);
      this.render();
      // 刷新任务列表
      if (typeof App !== 'undefined') {
        App.renderTaskList();
      }
    }
  },

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
      
      const dayTasks = tasks.filter(task => {
        if (!task.dueDate) return false;
        const taskDate = new Date(task.dueDate);
        taskDate.setHours(0, 0, 0, 0);
        return taskDate.getTime() === dayDate.getTime();
      });
      
      const isToday = dayDate.getTime() === today.getTime();
      
      const dayEl = document.createElement('div');
      dayEl.className = `week-day ${isToday ? 'today' : ''}`;
      
      dayEl.innerHTML = `
        <div class="week-day-header">
          <div class="day-name">周${dayNames[i]}</div>
          <div class="day-number">${dayDate.getDate()}</div>
        </div>
        <div class="week-day-tasks">
          ${dayTasks.map(task => `
            <div class="week-task priority-${task.priority}" data-id="${task.id}">
              ${task.title}
              <button class="week-task-delete" data-task-id="${task.id}">×</button>
            </div>
          `).join('')}
        </div>
      `;
      
      // 周视图任务点击
      dayEl.querySelectorAll('.week-task').forEach(taskEl => {
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
      
      dayEl.addEventListener('click', () => {
        this.currentDate = dayDate;
        this.currentView = 'day';
        document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-view="day"]').classList.add('active');
        this.render();
      });
      
      grid.appendChild(dayEl);
    }
    
    container.appendChild(grid);
  },

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
      
      const isOtherMonth = date.getMonth() !== month;
      const isToday = date.getTime() === today.getTime();
      
      const dayTasks = tasks.filter(task => {
        if (!task.dueDate) return false;
        const taskDate = new Date(task.dueDate);
        taskDate.setHours(0, 0, 0, 0);
        return taskDate.getTime() === date.getTime();
      });
      
      const dayEl = document.createElement('div');
      dayEl.className = `month-day ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}`;
      
      dayEl.innerHTML = `
        <div class="month-day-number">${date.getDate()}</div>
        <div class="month-task-dots">
          ${dayTasks.slice(0, 5).map(() => '<div class="month-task-dot"></div>').join('')}
        </div>
      `;
      
      dayEl.addEventListener('click', () => {
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

  getWeekStart(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
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
    
    // 更新日期显示为"记事本"
    document.getElementById('currentDate').textContent = '记事本';
    
    // 进入记事本页时清空角标
    if (typeof App !== 'undefined') {
      App.clearNotebookBadge();
    }
    
    // 加载笔记列表
    App.loadNotes();
  }
};

window.Calendar = Calendar;