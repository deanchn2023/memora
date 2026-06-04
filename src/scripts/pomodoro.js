const Pomodoro = {
  timer: null,
  state: {
    isRunning: false,
    currentSession: 0,
    totalSessions: 0,
    plannedSessions: 1, // 计划番茄数
    currentTaskId: null,
    startTime: null,
    type: 'work',
    remainingTime: 25 * 60
  },
  settings: null,

  init() {
    this.settings = Store.getSettings().pomodoro;
    this.state = Store.getPomodoroState();
    this.updateDisplay();
    this.bindEvents();
    
    if (this.state.isRunning && this.state.startTime) {
      this.resume();
    }
  },

  bindEvents() {
    document.getElementById('startPomodoro').addEventListener('click', () => {
      if (this.state.isRunning) {
        this.pause();
      } else {
        this.start();
      }
    });

    document.getElementById('resetPomodoro').addEventListener('click', () => {
      this.reset();
    });
  },

  start(taskId = null) {
    // 先清除已有定时器，防止重复点击叠加多个定时器导致读秒过快
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    
    if (taskId) {
      this.state.currentTaskId = taskId;
    }
    
    this.state.isRunning = true;
    this.state.startTime = Date.now();
    this.state.remainingTime = this.getDuration() * 60;
    
    this.timer = setInterval(() => this.tick(), 1000);
    this.updateDisplay();
    this.updateButton();
    Store.savePomodoroState(this.state);
  },

  pause() {
    this.state.isRunning = false;
    clearInterval(this.timer);
    this.updateButton();
    Store.savePomodoroState(this.state);
  },

  resume() {
    // 先清除已有定时器
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    
    const elapsed = Math.floor((Date.now() - this.state.startTime) / 1000);
    this.state.remainingTime = this.getDuration() * 60 - elapsed;
    
    if (this.state.remainingTime <= 0) {
      this.complete();
    } else {
      this.state.isRunning = true;
      this.timer = setInterval(() => this.tick(), 1000);
      this.updateDisplay();
      this.updateButton();
    }
  },

  reset() {
    this.state.isRunning = false;
    this.state.currentSession = 0;
    this.state.plannedSessions = 1;
    this.state.currentTaskId = null;
    this.state.startTime = null;
    this.state.remainingTime = this.settings.workDuration * 60;
    this.state.type = 'work';
    
    clearInterval(this.timer);
    this.timer = null;
    this.updateDisplay();
    this.updateButton();
    this.updateSessionDots();
    Store.savePomodoroState(this.state);
  },

  tick() {
    this.state.remainingTime--;
    
    if (this.state.remainingTime <= 0) {
      this.complete();
    } else {
      this.updateDisplay();
    }
  },

  complete() {
    clearInterval(this.timer);
    
    if (this.state.type === 'work') {
      this.state.currentSession++;
      this.state.totalSessions++;
      
      if (this.state.currentTaskId) {
        Store.addPomodoroSession(this.state.currentTaskId, {
          type: 'work',
          duration: this.settings.workDuration,
          startTime: new Date(this.state.startTime).toISOString(),
          endTime: new Date().toISOString(),
          completed: true
        });
      }
      
      if (this.state.currentSession >= this.settings.sessionsBeforeLongBreak) {
        this.state.type = 'long_break';
        this.state.remainingTime = this.settings.longBreakDuration * 60;
        this.state.currentSession = 0;
        this.showNotification('番茄钟', '完成一组番茄钟！休息15分钟吧 🎉');
      } else {
        this.state.type = 'short_break';
        this.state.remainingTime = this.settings.shortBreakDuration * 60;
        this.showNotification('番茄钟', '完成一个番茄钟！休息5分钟吧 ☕');
      }
    } else {
      this.state.type = 'work';
      this.state.remainingTime = this.settings.workDuration * 60;
      this.showNotification('番茄钟', '休息结束，开始新的番茄钟！💪');
    }
    
    this.state.isRunning = false;
    this.state.startTime = null;
    this.updateDisplay();
    this.updateButton();
    this.updateSessionDots();
    Store.savePomodoroState(this.state);
  },

  getDuration() {
    switch (this.state.type) {
      case 'work':
        return this.settings.workDuration;
      case 'short_break':
        return this.settings.shortBreakDuration;
      case 'long_break':
        return this.settings.longBreakDuration;
      default:
        return this.settings.workDuration;
    }
  },

  updateDisplay() {
    const minutes = Math.floor(this.state.remainingTime / 60);
    const seconds = this.state.remainingTime % 60;
    const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    document.getElementById('timerDisplay').textContent = display;
    
    document.title = `${display} - 忆境 Memora`;
  },

  updateButton() {
    const btn = document.getElementById('startPomodoro');
    if (this.state.isRunning) {
      btn.textContent = '暂停';
      btn.classList.add('running');
    } else {
      btn.textContent = '开始';
      btn.classList.remove('running');
    }
  },

  updateSessionDots() {
    const total = Math.max(this.state.plannedSessions || 1, this.settings.sessionsBeforeLongBreak);
    const dots = [];
    for (let i = 0; i < total; i++) {
      if (i < this.state.currentSession) {
        dots.push('<span class="completed">●</span>');
      } else {
        dots.push('○');
      }
    }
    document.getElementById('pomodoroCount').innerHTML = dots.join(' ');
  },

  setCurrentTask(taskId, taskTitle, plannedSessions = 1) {
    this.state.currentTaskId = taskId;
    this.state.plannedSessions = plannedSessions || 1;
    const taskName = document.querySelector('.current-task .task-name');
    if (taskName) {
      taskName.textContent = taskTitle || '无';
    }
    this.updateSessionDots();
    Store.savePomodoroState(this.state);
  },

  // 增加计划番茄数（点击番茄按钮时调用）
  addPlannedSession(taskId, taskTitle) {
    if (this.state.currentTaskId === taskId) {
      // 同一任务，累加
      this.state.plannedSessions = (this.state.plannedSessions || 1) + 1;
    } else {
      // 不同任务，重置为1
      this.state.currentTaskId = taskId;
      this.state.plannedSessions = 1;
      const taskName = document.querySelector('.current-task .task-name');
      if (taskName) {
        taskName.textContent = taskTitle || '无';
      }
    }
    this.updateSessionDots();
    Store.savePomodoroState(this.state);
    return this.state.plannedSessions;
  },

  showNotification(title, body) {
    if (window.electronAPI) {
      window.electronAPI.showNotification(title, body);
    } else {
      new Notification(title, { body });
    }
  }
};

window.Pomodoro = Pomodoro;