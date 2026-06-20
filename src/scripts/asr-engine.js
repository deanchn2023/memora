/**
 * ASR Engine — 实时语音识别 WebSocket 客户端
 * 支持火山引擎和腾讯云 ASR
 * 
 * 使用方式:
 *   const asr = new ASREngine(provider, config);
 *   asr.onResult(text, isFinal) → 识别结果回调
 *   asr.onError(err) → 错误回调
 *   asr.onStart() → 连接成功回调
 *   asr.connect() → 建立连接
 *   asr.sendAudioChunk(buffer) → 发送音频片段 (ArrayBuffer/Buffer)
 *   asr.stop() → 结束识别并关闭连接
 */

const WebSocket = require('ws');
const crypto = require('crypto');

// ─── 火山引擎 ASR ────────────────────────────────────────────
class VolcanoASR {
  constructor(config) {
    this.appId = config.appId;
    this.token = config.token;
    this.cluster = config.cluster || 'volcengine_streaming_common';
    this.wsUrl = 'wss://openspeech.bytedance.com/api/v1/asr';
    this.ws = null;
    this.onResult = null;
    this.onError = null;
    this.onStart = null;
    this._ended = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          // 发送首条 JSON 配置消息
          const initMsg = {
            header: {
              appid: this.appId,
              token: this.token,
              cluster: this.cluster,
            },
            payload: {
              model_config: {
                config: {
                  format: 'pcm',
                  sample_rate: 16000,
                  bits: 16,
                  channel: 1,
                  codec: 'raw',
                },
              },
            },
          };
          this.ws.send(JSON.stringify(initMsg));
          if (this.onStart) this.onStart();
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            const status = msg.header?.status;
            if (status !== 0) {
              if (this.onError) this.onError(new Error(`Volcano ASR error: ${msg.header?.message || 'unknown'} (status=${status})`));
              return;
            }
            const results = msg.payload?.result || [];
            for (const r of results) {
              if (this.onResult) this.onResult(r.text || '', !!r.is_final);
            }
          } catch (e) {
            // 忽略解析错误
          }
        });

        this.ws.on('error', (err) => {
          if (this.onError) this.onError(err);
          reject(err);
        });

        this.ws.on('close', () => {
          // 连接关闭
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  sendAudioChunk(buffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    }
  }

  async stop() {
    this._ended = true;
    if (this.ws) {
      try {
        // 发送结束标记（空帧）
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(Buffer.alloc(0));
        }
        await new Promise(resolve => {
          this.ws.on('close', resolve);
          setTimeout(resolve, 2000); // 超时保护
          this.ws.close();
        });
      } catch (e) {
        // 忽略关闭错误
      }
    }
  }
}

// ─── 腾讯云 ASR ──────────────────────────────────────────────
class TencentASR {
  constructor(config) {
    this.appId = config.appId;
    this.secretId = config.secretId;
    this.secretKey = config.secretKey;
    this.engineModelType = config.engineModelType || '16k_zh_en';
    // voice_format: 1 = PCM（16kHz, 16-bit, mono）
    // VoiceRecorder 解码 WebM 后输出 PCM，所以这里用 1
    this.voiceFormat = 1;
    this.wsUrl = 'asr.cloud.tencent.com/asr/v2';
    this.ws = null;
    this.onResult = null;
    this.onError = null;
    this.onStart = null;
    this._voiceId = null;
  }

  _generateSignature(params) {
    // 1. 拼接签名原文（除 signature 外的参数按字典序排序）
    // 签名路径必须包含 appId：asr.cloud.tencent.com/asr/v2/{appId}?{params}
    // 参数值使用原始值，不做 URL 编码（参考官方文档）
    const sortedKeys = Object.keys(params).sort();
    const queryParts = sortedKeys.map(k => `${k}=${params[k]}`);
    const signStr = `${this.wsUrl}/${this.appId}?${queryParts.join('&')}`;

    // 2. HMAC-SHA1 加密
    const hmac = crypto.createHmac('sha1', this.secretKey);
    hmac.update(signStr);
    const signature = hmac.digest('base64');

    // 3. 返回原始 Base64 签名（URL 编码在 connect() 中单独处理 signature）
    return signature;
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this._voiceId = crypto.randomUUID();

        const params = {
          secretid: this.secretId,
          timestamp: Math.floor(Date.now() / 1000).toString(),
          expired: Math.floor(Date.now() / 1000 + 86400).toString(),
          nonce: Math.floor(Math.random() * 1000000000).toString(),
          engine_model_type: this.engineModelType,
          voice_id: this._voiceId,
          voice_format: this.voiceFormat.toString(),
          needvad: '1',
          filter_punc: '1',
        };

        const signature = this._generateSignature(params);

        // 按官方文档方式构建 URL：
        // 1. 非签名参数按字典序排列，使用原始值（不 URL 编码）
        // 2. 签名参数 URL 编码后追加到末尾
        const sortedKeys = Object.keys(params).sort();
        const rawQueryString = sortedKeys
          .map(k => `${k}=${params[k]}`)
          .join('&');
        const signatureEncoded = encodeURIComponent(signature);
        const url = `wss://${this.wsUrl}/${this.appId}?${rawQueryString}&signature=${signatureEncoded}`;

        console.log('[ASR] Signing string:', `${this.wsUrl}/${this.appId}?${rawQueryString}`);
        console.log('[ASR] Signature (raw):', signature);
        console.log('[ASR] Signature (encoded):', signatureEncoded);
        console.log('[ASR] Full URL:', url.replace(/secretid=[^&]+/, 'secretid=***'));
        console.log('[ASR] SecretId:', this.secretId ? this.secretId.substring(0, 6) + '...' : 'MISSING');
        console.log('[ASR] SecretKey:', this.secretKey ? this.secretKey.substring(0, 4) + '...' : 'MISSING');
        console.log('[ASR] AppId:', this.appId);

        this.ws = new WebSocket(url);

        const timeout = setTimeout(() => {
          reject(new Error('腾讯云 ASR 连接超时'));
          this.ws.close();
        }, 10000);

        this.ws.on('open', () => {
          // 等待握手成功响应
        });

        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.code !== 0) {
              if (this.onError) this.onError(new Error(`腾讯云 ASR 错误: ${msg.message} (code=${msg.code})`));
              clearTimeout(timeout);
              reject(new Error(`腾讯云 ASR 握手失败: ${msg.message}`));
              return;
            }

            // 握手成功
            if (msg.message === 'success' && !this._handshakeDone) {
              this._handshakeDone = true;
              clearTimeout(timeout);
              if (this.onStart) this.onStart();
              resolve();
              return;
            }

            // 识别结果
            if (msg.result) {
              const text = msg.result.voice_text_str || '';
              const sliceType = msg.result.slice_type;
              // slice_type: 0=开始, 1=识别中, 2=识别结束(稳态)
              const isFinal = sliceType === 2 || msg.final === 1;
              if (this.onResult) this.onResult(text, isFinal);
            }

            if (msg.final === 1) {
              // 最终结果，连接将被服务端关闭
            }
          } catch (e) {
            // 忽略解析错误
          }
        });

        this.ws.on('error', (err) => {
          clearTimeout(timeout);
          if (this.onError) this.onError(err);
          reject(err);
        });

        this.ws.on('close', () => {
          // 连接关闭
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  sendAudioChunk(buffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    }
  }

  async stop() {
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          // 发送结束信号
          this.ws.send(JSON.stringify({ type: 'end' }));
        }
        await new Promise(resolve => {
          this.ws.on('close', resolve);
          setTimeout(resolve, 3000);
          this.ws.close();
        });
      } catch (e) {
        // 忽略关闭错误
      }
    }
  }
}

// ─── ASR 引擎工厂 ────────────────────────────────────────────
class ASREngine {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
    this.client = null;
    this.onResult = null;
    this.onError = null;
    this.onStart = null;
    this._accumulatedText = '';
  }

  connect() {
    if (this.provider === 'volcano') {
      this.client = new VolcanoASR(this.config);
    } else if (this.provider === 'tencent') {
      this.client = new TencentASR(this.config);
    } else {
      return Promise.reject(new Error(`不支持的 ASR 供应商: ${this.provider}`));
    }

    this.client.onResult = (text, isFinal) => {
      if (isFinal) {
        this._accumulatedText += text;
      }
      if (this.onResult) this.onResult(text, isFinal, this._accumulatedText);
    };
    this.client.onError = (err) => {
      if (this.onError) this.onError(err);
    };
    this.client.onStart = () => {
      if (this.onStart) this.onStart();
    };

    return this.client.connect();
  }

  sendAudioChunk(buffer) {
    if (this.client) {
      this.client.sendAudioChunk(buffer);
    }
  }

  async stop() {
    if (this.client) {
      await this.client.stop();
    }
    return this._accumulatedText;
  }

  getAccumulatedText() {
    return this._accumulatedText;
  }
}

module.exports = { ASREngine };
