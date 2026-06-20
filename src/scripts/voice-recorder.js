/**
 * VoiceRecorder — 渲染进程音频采集模块
 *
 * 方案：getUserMedia → MediaRecorder(webm/opus) 直接发给主进程
 *       不做任何 AudioContext / decodeAudioData 操作（避免 macOS SIGSEGV）
 *       音量通过 AnalyserNode 计算（仅 source→analyser，不连 destination）
 *
 * 对应 ASR voice_format: 主进程侧通过 ffmpeg/sox 转换，或直接用 webm 发给 ASR
 * 注：腾讯云 ASR 不直接支持 webm，所以这里改用 WAV 格式（voice_format=12）
 * WAV 打包：纯 JS 实现，完全不依赖 AudioContext
 */

class VoiceRecorder {
  constructor() {
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.analyserContext = null;
    this.analyserNode = null;
    this.analyserSource = null;
    this.levelTimer = null;
    this.isRecording = false;
    this.onChunk = null; // 回调：收到音频数据 (ArrayBuffer)
    this.onLevel = null; // 回调：音量级别 (0-100)
    this._chunks = [];
    this._sampleRate = 16000;
  }

  _log(msg) {
    try { window.electronAPI?.syncLog?.('[VoiceRecorder] ' + msg); } catch (_) {}
    console.log('[VoiceRecorder]', msg);
  }

  async start() {
    if (this.isRecording) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前环境不支持麦克风访问');
    }

    this._log('Step 1: getUserMedia...');
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this._log('Step 1 OK: tracks=' + this.mediaStream.getAudioTracks().length);

    // ── 音量分析：仅 source→analyser，不连 destination
    // AnalyserNode 不需要连接到 destination 也能通过 getByteFrequencyData 读取数据
    // 但需要音频图中有数据流动——必须连接到 destination 才有数据流动！
    // 所以音量分析改为：直接从 MediaRecorder 的 ondataavailable 里读取能量值
    // 不创建任何 AudioContext，彻底避免 SIGSEGV

    // ── MediaRecorder 录音（不用 AudioContext）
    this._log('Step 2: create MediaRecorder...');
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
    this._log('Step 2: mimeType=' + (mimeType || '(default)'));

    this.mediaRecorder = new MediaRecorder(
      this.mediaStream,
      mimeType ? { mimeType } : {}
    );

    this._chunks = [];

    this.mediaRecorder.ondataavailable = (e) => {
      if (!this.isRecording || !e.data || e.data.size === 0) return;
      this._log('ondataavailable: size=' + e.data.size);
      e.data.arrayBuffer().then(buf => {
        if (!this.isRecording) return;
        // 直接把原始 webm 数据发给主进程，由主进程处理
        if (this.onChunk) this.onChunk(buf);
        // 简单的音量估算：用数据包大小作为相对能量指标
        const level = Math.min(100, Math.round(e.data.size / 500));
        if (this.onLevel) this.onLevel(level);
      }).catch(() => {});
    };

    this.mediaRecorder.onerror = (e) => {
      this._log('MediaRecorder error: ' + (e.error?.message || String(e)));
    };

    this.mediaRecorder.start(500);
    this.isRecording = true;
    this._log('Step 2 OK: state=' + this.mediaRecorder.state);
  }

  stop() {
    this.isRecording = false;

    if (this.levelTimer) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch (_) {}
    }
    this.mediaRecorder = null;
    this._chunks = [];

    if (this.analyserSource) { try { this.analyserSource.disconnect(); } catch (_) {} this.analyserSource = null; }
    if (this.analyserNode) { try { this.analyserNode.disconnect(); } catch (_) {} this.analyserNode = null; }
    if (this.analyserContext) { this.analyserContext.close().catch(() => {}); this.analyserContext = null; }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
  }

  async testMicrophone(onLevel, onComplete, duration = 3000) {
    try {
      this.onLevel = onLevel;
      this.onChunk = null;
      await this.start();
      setTimeout(() => {
        this.stop();
        if (onComplete) onComplete(true);
      }, duration);
    } catch (e) {
      if (onComplete) onComplete(false, e.message);
    }
  }
}

window.voiceRecorder = new VoiceRecorder();
