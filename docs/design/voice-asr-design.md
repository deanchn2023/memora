# 语音 ASR 实时识别功能设计

## 概述

在「新建待办」按钮旁增加语音按钮，点击后启动实时语音识别（ASR），将语音转为文本并记录到记事本（新增"语音数据"分类）。设置中增加「语音配置」标签页，支持火山引擎和腾讯云 ASR。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  渲染进程 (Renderer)                                        │
│                                                             │
│  ┌──────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │ 麦克风   │───▶│ AudioContext     │───▶│ IPC 发送     │  │
│  │ getUser  │    │ PCM 16k/16bit    │    │ asr:audio   │  │
│  │ Media    │    │ ScriptProcessor  │    │ -chunk      │  │
│  └──────────┘    └──────────────────┘    └──────┬───────┘  │
│                                                 │          │
│  ┌──────────┐    ┌──────────────────┐    ┌──────▼───────┐  │
│  │ 实时文本 │◀───│ asr:result       │◀───│ IPC 接收     │  │
│  │ 显示区   │    │ onASRResult()    │    │ asr:result  │  │
│  └──────────┘    └──────────────────┘    └──────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                         IPC
┌─────────────────────────────────────────────────────────────┐
│  主进程 (Main)                                              │
│                                                             │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │ asr:audio-chunk │───▶│ ASR WebSocket Client         │   │
│  │ IPC Handler      │    │                              │   │
│  └──────────────────┘    │  ┌─ 火山引擎 ──────────────┐ │   │
│                          │  │ wss://openspeech.byte...│ │   │
│                          │  │ header: appid/token     │ │   │
│                          │  │ payload: audio config    │ │   │
│                          │  └─────────────────────────┘ │   │
│                          │  ┌─ 腾讯云 ────────────────┐ │   │
│                          │  │ wss://asr.cloud.tencent │ │   │
│                          │  │ signature: HMAC-SHA1    │ │   │
│                          │  └─────────────────────────┘ │   │
│                          └──────────┬───────────────────┘   │
│                                     │                       │
│                          ┌──────────▼───────────────────┐   │
│                          │ asr:result IPC push         │   │
│                          │ → renderer                   │   │
│                          └──────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/scripts/asr-engine.js` | 主进程 ASR WebSocket 客户端（火山/腾讯云） |
| `src/scripts/voice-recorder.js` | 渲染进程音频采集 + PCM 转换 |
| `preload.js` | ASR IPC 通道定义 |
| `main.js` | 加载 ASR 引擎 + IPC 处理 |
| `src/index.html` | 语音按钮 + 语音配置面板 |
| `src/scripts/app.js` | 语音按钮事件绑定 + 实时文本展示 + 保存到记事本 |
| `src/styles/voice-asr.css` | 语音 UI 样式 |

## 火山引擎 ASR 协议

- **WebSocket URL**: `wss://openspeech.bytedance.com/api/v1/asr`
- **认证**: 首条 JSON 消息包含 `header: { appid, token, cluster }`
- **音频格式**: PCM 16kHz 16bit Mono
- **流程**:
  1. 连接 WebSocket
  2. 发送首条 JSON 配置消息
  3. 持续发送音频二进制片段（每 100-200ms）
  4. 接收 JSON 响应（`payload.result[].text`, `result[].is_final`）
  5. 结束时关闭连接

## 腾讯云 ASR 协议

- **WebSocket URL**: `wss://asr.cloud.tencent.com/asr/v2/{appid}?{params}`
- **认证**: URL 参数 `signature = Base64(HmacSHA1(签名原文, SecretKey))`
- **签名原文**: 除 signature 外所有参数按字典序排序拼接的 URL 路径
- **音频格式**: PCM 16kHz 16bit Mono (voice_format=1)
- **流程**:
  1. 带 signature 参数连接 WebSocket
  2. 收到 `{code:0, message:"success"}` 表示握手成功
  3. 持续发送音频二进制片段
  4. 接收 JSON 响应（`result.voice_text_str`, `result.slice_type` 0/1/2, `final`）
  5. 结束时发送 `{"type":"end"}` 文本消息

## 配置项

### 火山引擎
| 字段 | 说明 |
|------|------|
| appId | 火山引擎应用 ID |
| token | 访问令牌 |
| cluster | 集群标识（如 `volcengine_streaming_common`） |

### 腾讯云
| 字段 | 说明 |
|------|------|
| appId | 腾讯云 AppID |
| secretId | SecretID |
| secretKey | SecretKey |
| engineModelType | 引擎模型（默认 `16k_zh_en`） |

## 记事本分类

新增默认分类 `voice`，标签为 `🎤 语音数据`，在 `getAllCategories()` 和 `getNoteCategoryLabel()` 中注册。
