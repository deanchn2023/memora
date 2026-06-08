/**
 * 腾讯云智能体开发平台 (ADP) V2 HTTP SSE 客户端
 * 支持：文本问答 / 免登录文件 URL 传入 / 图片 URL 传入
 * 文档：https://cloud.tencent.com/document/product/1759/129202
 */

import { randomUUID } from "crypto";

// ─────────────────────────── 类型定义 ───────────────────────────

export interface ADPClientConfig {
  /** 应用 AppKey（从应用管理 -> 调用 获取） */
  appKey: string;
  /** 访客 ID，建议业务侧唯一标识用户 */
  visitorId: string;
  /** 是否使用增量文本事件（text.delta），默认 true */
  incremental?: boolean;
  /** 流式回复频率控制，默认 5 */
  streamingThrottle?: number;
  /** 模型名称（可选，空时跟随应用配置） */
  modelName?: string;
  /** 联网搜索：'enable' | 'disable' | ''（跟随应用） */
  searchNetwork?: string;
}

export type ContentType = "text" | "image" | "file";

export interface TextContent {
  Type: "text";
  Text: string;
}

export interface ImageContent {
  Type: "image";
  Image: { Url: string };
}

export interface FileContent {
  Type: "file";
  File: {
    FileName: string;
    FileSize: string;
    FileUrl: string;  // 免登录可访问的公开 URL
    FileType: string;
    DocId?: string;
  };
}

export type Content = TextContent | ImageContent | FileContent;

export interface SendMessageOptions {
  /** 会话 ID（不传则自动生成，多轮对话请保持同一个） */
  conversationId?: string;
  /** 消息内容列表 */
  contents: Content[];
  /** 请求 ID（不传则自动生成） */
  requestId?: string;
  /** 角色指令（Prompt），为空跟随应用配置 */
  systemRole?: string;
}

// SSE 回调类型
export interface SSEHandlers {
  /** 收到文本增量（Incremental=true 时） */
  onTextDelta?: (text: string, messageId: string) => void;
  /** 收到完整文本替换（Incremental=false 或后端修正时） */
  onTextReplace?: (text: string, messageId: string) => void;
  /** 消息处理完成（含完整 Contents） */
  onMessageDone?: (message: ADPMessage) => void;
  /** 响应全部完成 */
  onResponseCompleted?: (response: ADPRecord) => void;
  /** 错误 */
  onError?: (error: ADPError) => void;
  /** 流结束 */
  onDone?: () => void;
  /** 原始事件（调试用） */
  onRawEvent?: (eventName: string, data: unknown) => void;
}

// ADP 返回结构（简化）
export interface ADPMessage {
  Type: string;
  MessageId: string;
  Name: string;
  Title: string;
  Status: string;
  StatusDesc: string;
  Contents?: Content[];
  ExtraInfo?: Record<string, unknown>;
}

export interface ADPRecord {
  Role: string;
  RecordId: string;
  ConversationId: string;
  Status: string;
  StatusDesc: string;
  Messages?: ADPMessage[];
  StatInfo?: Record<string, unknown>;
  ExtraInfo?: Record<string, unknown>;
}

export interface ADPError {
  Code: number;
  Message: string;
  RequestId: string;
  TraceId: string;
  Elapsed?: number;
}

// ─────────────────────────── 工具函数 ───────────────────────────

/**
 * 根据文件扩展名推断 FileType
 */
export function inferFileType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "pdf",
    doc: "doc",
    docx: "docx",
    xls: "xls",
    xlsx: "xlsx",
    ppt: "ppt",
    pptx: "pptx",
    txt: "txt",
    md: "md",
    csv: "csv",
    png: "png",
    jpg: "jpg",
    jpeg: "jpeg",
    gif: "gif",
    webp: "webp",
    mp4: "mp4",
    mp3: "mp3",
  };
  return map[ext] ?? ext;
}

/**
 * 构建文件 Content（核心：传入免登录公开 URL）
 *
 * @param fileUrl   - 免登录可下载的文件 URL（COS 公开链接 / CDN 等）
 * @param fileName  - 文件名（带扩展名）
 * @param fileSize  - 文件大小（字节数字符串，不知道可传 "0"）
 * @param docId     - 实时文档解析接口返回的 doc_id（标准模式文件对话时必填）
 */
export function buildFileContent(
  fileUrl: string,
  fileName: string,
  fileSize: string = "0",
  docId?: string
): FileContent {
  return {
    Type: "file",
    File: {
      FileName: fileName,
      FileSize: fileSize,
      FileUrl: fileUrl,
      FileType: inferFileType(fileName),
      ...(docId ? { DocId: docId } : {}),
    },
  };
}

/**
 * 构建图片 Content
 */
export function buildImageContent(imageUrl: string): ImageContent {
  return { Type: "image", Image: { Url: imageUrl } };
}

/**
 * 构建文本 Content
 */
export function buildTextContent(text: string): TextContent {
  return { Type: "text", Text: text };
}

// ─────────────────────────── 主客户端 ───────────────────────────

const ADP_ENDPOINT = "https://wss.lke.cloud.tencent.com/adp/v2/chat";

export class ADPClient {
  private config: Required<ADPClientConfig>;

  constructor(config: ADPClientConfig) {
    this.config = {
      incremental: true,
      streamingThrottle: 5,
      modelName: "",
      searchNetwork: "",
      ...config,
    };
  }

  /**
   * 发送消息，通过 SSE 流式接收响应
   *
   * @returns conversationId（供多轮对话复用）
   */
  async sendMessage(
    options: SendMessageOptions,
    handlers: SSEHandlers = {}
  ): Promise<string> {
    const conversationId = options.conversationId ?? randomUUID();
    const requestId = options.requestId ?? randomUUID();

    const body: Record<string, unknown> = {
      RequestId: requestId,
      ConversationId: conversationId,
      AppKey: this.config.appKey,
      VisitorId: this.config.visitorId,
      Contents: options.contents,
      Incremental: this.config.incremental,
      StreamingThrottle: this.config.streamingThrottle,
      Stream: "enable",
      EnableMultiIntent: true,
    };

    if (this.config.modelName) body.ModelName = this.config.modelName;
    if (this.config.searchNetwork) body.SearchNetwork = this.config.searchNetwork;
    if (options.systemRole) body.SystemRole = options.systemRole;

    const response = await fetch(ADP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    if (!response.body) throw new Error("响应 body 为空");

    await this._parseSSEStream(response.body, handlers);
    return conversationId;
  }

  // ── 便捷方法 ──

  /** 纯文本问答 */
  async chat(
    text: string,
    handlers: SSEHandlers,
    conversationId?: string
  ): Promise<string> {
    return this.sendMessage(
      { conversationId, contents: [buildTextContent(text)] },
      handlers
    );
  }

  /**
   * 带文件的问答（文件 URL 必须免登录可访问）
   *
   * @param question  - 用户问题
   * @param fileUrl   - 公开可下载的文件 URL
   * @param fileName  - 文件名（带后缀）
   * @param fileSize  - 文件大小（字节），不知道传 "0"
   */
  async chatWithFile(
    question: string,
    fileUrl: string,
    fileName: string,
    handlers: SSEHandlers,
    options: { conversationId?: string; fileSize?: string; docId?: string } = {}
  ): Promise<string> {
    const contents: Content[] = [
      buildTextContent(question),
      buildFileContent(fileUrl, fileName, options.fileSize ?? "0", options.docId),
    ];
    return this.sendMessage(
      { conversationId: options.conversationId, contents },
      handlers
    );
  }

  /**
   * 带图片的问答（图片 URL 必须免登录可访问）
   */
  async chatWithImage(
    question: string,
    imageUrl: string,
    handlers: SSEHandlers,
    conversationId?: string
  ): Promise<string> {
    const contents: Content[] = [
      buildTextContent(question),
      buildImageContent(imageUrl),
    ];
    return this.sendMessage({ conversationId, contents }, handlers);
  }

  // ── SSE 解析核心 ──

  private async _parseSSEStream(
    body: ReadableStream<Uint8Array>,
    handlers: SSEHandlers
  ): Promise<void> {
    const decoder = new TextDecoder();
    const reader = body.getReader();

    let buffer = "";
    let currentEvent = "";

    const processLine = (line: string) => {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const raw = line.slice(5).trim();

        if (raw === "[DONE]") {
          handlers.onDone?.();
          return;
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return; // 忽略非 JSON 行
        }

        handlers.onRawEvent?.(currentEvent, parsed);

        switch (currentEvent) {
          case "text.delta": {
            const p = parsed as { Text: string; MessageId: string };
            handlers.onTextDelta?.(p.Text, p.MessageId);
            break;
          }
          case "text.replace": {
            const p = parsed as { Text: string; MessageId: string };
            handlers.onTextReplace?.(p.Text, p.MessageId);
            break;
          }
          case "message.done": {
            const p = parsed as { Message: ADPMessage };
            handlers.onMessageDone?.(p.Message);
            break;
          }
          case "response.completed": {
            const p = parsed as { Response: ADPRecord };
            handlers.onResponseCompleted?.(p.Response);
            break;
          }
          case "error": {
            const p = parsed as { Error: ADPError };
            handlers.onError?.(p.Error);
            break;
          }
          // request_ack / response.created / response.processing / message.added
          // / content.added / message.processing / quote_info.added / reference.added
          // 按需扩展，此处通过 onRawEvent 透传
        }
      } else if (line === "") {
        // 空行：事件结束，重置当前事件名
        currentEvent = "";
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // 最后一段可能不完整，留在 buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          processLine(line);
        }
      }

      // 处理剩余 buffer
      if (buffer.trim()) processLine(buffer);
    } finally {
      reader.releaseLock();
    }
  }
}

// ─────────────────────────── 使用示例 ───────────────────────────

/**
 * 示例 1：纯文本问答
 */
async function example_text() {
  const client = new ADPClient({
    appKey: "YOUR_APP_KEY",
    visitorId: "user_001",
  });

  let fullText = "";
  const conversationId = await client.chat(
    "帮我总结一下大模型的发展趋势",
    {
      onTextDelta: (text) => {
        process.stdout.write(text);
        fullText += text;
      },
      onResponseCompleted: (resp) => {
        console.log("\n\n[完成] token:", resp.StatInfo);
      },
      onError: (err) => console.error("[错误]", err),
    }
  );

  console.log("conversationId:", conversationId);
  return conversationId;
}

/**
 * 示例 2：传入免登录可下载的文件 URL（核心场景）
 *
 * 文件必须是公开可访问的 URL，例如：
 *  - 腾讯 COS 公开桶链接
 *  - CDN 静态资源链接
 *  - 其他免鉴权 HTTP/HTTPS 直链
 */
async function example_file_url() {
  const client = new ADPClient({
    appKey: "YOUR_APP_KEY",
    visitorId: "user_001",
    incremental: true,
  });

  // 免登录可下载的文件 URL（示例：COS 公开链接）
  const fileUrl =
    "https://your-bucket.cos.ap-guangzhou.myqcloud.com/docs/report.pdf";

  let answer = "";
  await client.chatWithFile(
    "请总结这份文档的核心内容",
    fileUrl,
    "report.pdf",
    {
      onTextDelta: (text) => {
        process.stdout.write(text);
        answer += text;
      },
      onMessageDone: (msg) => {
        if (msg.Type === "reply") {
          console.log("\n\n[最终回答]", msg.Contents);
        }
      },
      onError: (err) => console.error("[错误]", err.Message),
      onDone: () => console.log("\n[流结束]"),
    },
    { fileSize: "102400" }
  );
}

/**
 * 示例 3：多轮对话（复用 conversationId）
 */
async function example_multi_turn() {
  const client = new ADPClient({
    appKey: "YOUR_APP_KEY",
    visitorId: "user_002",
  });

  const collect = (label: string) => {
    let buf = "";
    return {
      handlers: {
        onTextDelta: (t: string) => { buf += t; },
        onDone: () => console.log(`\n[${label}]`, buf),
        onError: (e: ADPError) => console.error(e),
      } satisfies SSEHandlers,
    };
  };

  // 第一轮
  const { handlers: h1 } = collect("轮1");
  const cid = await client.chat("你好，我想了解一下向量数据库", h1);

  // 第二轮（复用 conversationId 保持上下文）
  const { handlers: h2 } = collect("轮2");
  await client.chat("它和传统关系型数据库有什么区别？", h2, cid);
}

/**
 * 示例 4：传入图片 URL
 */
async function example_image_url() {
  const client = new ADPClient({
    appKey: "YOUR_APP_KEY",
    visitorId: "user_003",
  });

  await client.chatWithImage(
    "这张图片里有什么内容？",
    "https://your-bucket.cos.ap-guangzhou.myqcloud.com/images/chart.png",
    {
      onTextDelta: (t) => process.stdout.write(t),
      onDone: () => console.log("\n[完成]"),
      onError: (e) => console.error(e),
    }
  );
}

// 导出所有工具函数和类
export { example_text, example_file_url, example_multi_turn, example_image_url };
