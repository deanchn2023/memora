#!/usr/bin/env node
/**
 * ADP V2 文件对话测试脚本
 * 
 * 用途：验证不同方式上传 Word 文件给 ADP 智能体后，能否正确读取文档内容并回答问题。
 * 
 * 测试模式：
 *   A. Type:file + DocId + DocBizId（当前客户端方式，FileName 带后缀）
 *   B. Type:file + DocId（FileName 不带后缀，官方文档 107908 要求）
 *   C. Type:text + Markdown 链接（Claw 模式官方示例方式）
 *   D. Type:file + DocBizId（Python SDK 方式，不传 DocId）
 * 
 * 判断标准：
 *   ✅ 正确：AI 回复中包含基于文档内容的点对点应答
 *   ❌ 不正确：AI 回复"请上传文件/需要文档"等说明没读到文档
 * 
 * 用法：
 *   node test/adp-file-chat-test.js                        # 需要配置环境变量
 *   TC_SECRET_KEY=xxx ADP_APP_KEY=xxx node test/adp-file-chat-test.js
 *   node test/adp-file-chat-test.js --login admin admin123  # 自动登录获取配置
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const CONFIG = {
  // Config Server（自动获取 ADP 配置）
  configServerUrl: 'http://121.5.164.126:3450',
  authServerUrl: 'http://121.5.164.126:3010',

  // 腾讯云 API 密钥（优先从环境变量，否则从 Config Server 获取）
  secretId: process.env.TC_SECRET_ID || '',
  secretKey: process.env.TC_SECRET_KEY || '',
  
  // ADP 应用配置（优先从环境变量，否则从 Config Server 获取）
  botBizId: process.env.ADP_BOT_BIZ_ID || '',
  appKey: process.env.ADP_APP_KEY || '',
  
  // 测试文件
  testFilePath: process.env.TEST_FILE || '/Users/congkunzhu/Downloads/深圳地铁智能体建设及纳管平台采购和财务试点智能体服务项目招标文件（终）.docx',
  
  // 测试 prompt
  testPrompt: '请使用文档生成点对点应答',
  
  // ADP 接口地址
  docParseUrl: 'https://wss.lke.cloud.tencent.com/v1/qbot/chat/docParse',
  chatUrl: 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
};

// ============ 自动登录获取配置 ============
async function autoLogin(username, password) {
  console.log('🔑 自动登录获取配置...');
  
  // Step 1: 登录获取 token
  const loginRes = await fetch(`${CONFIG.authServerUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!loginRes.ok) {
    const errText = await loginRes.text().catch(() => '');
    throw new Error(`Login failed: ${loginRes.status} ${errText}`);
  }

  const loginData = await loginRes.json();
  const token = loginData.token || loginData.access_token;
  if (!token) throw new Error('Login response missing token');

  console.log('  ✅ 登录成功, token:', token.substring(0, 16) + '...');

  // Step 2: 获取远程配置
  const configRes = await fetch(`${CONFIG.configServerUrl}/memora/config`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!configRes.ok) {
    throw new Error(`Config fetch failed: ${configRes.status}`);
  }

  const config = await configRes.json();
  console.log('  ✅ 配置获取成功, keys:', Object.keys(config).join(', '));

  // 提取需要的配置
  if (config.tencent_cloud) {
    if (!CONFIG.secretKey) CONFIG.secretKey = config.tencent_cloud.secret_key || '';
    if (!CONFIG.secretId || CONFIG.secretId === '') {
      CONFIG.secretId = config.tencent_cloud.secret_id || CONFIG.secretId;
    }
    if (!CONFIG.botBizId) CONFIG.botBizId = config.tencent_cloud.bot_biz_id || '';
  }

  if (config.adp) {
    if (!CONFIG.appKey) CONFIG.appKey = config.adp.app_key || '';
  }

  console.log('  📋 配置加载完成:');
  console.log('     SecretId:', CONFIG.secretId.substring(0, 8) + '...');
  console.log('     SecretKey:', CONFIG.secretKey ? CONFIG.secretKey.substring(0, 4) + '****' : '❌ 空');
  console.log('     BotBizId:', CONFIG.botBizId);
  console.log('     AppKey:', CONFIG.appKey ? CONFIG.appKey.substring(0, 8) + '...' : '❌ 空');
}

// ============ TC3-HMAC-SHA256 签名 ============
function signTC3(secretId, secretKey, payload, action, region = 'ap-guangzhou') {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];

  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:lke.tencentcloudapi.com\n`;
  const signedHeaders = 'content-type;host';
  const hashedRequestPayload = crypto.createHash('sha256').update(payload).digest('hex');
  const canonicalRequest = [
    'POST', '/', '', canonicalHeaders, signedHeaders, hashedRequestPayload
  ].join('\n');

  const algorithm = 'TC3-HMAC-SHA256';
  const service = 'lke';
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonicalRequest].join('\n');

  const secretDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
  const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, timestamp, contentType };
}

// ============ Step 1: 获取上传凭证 ============
async function getUploadCredential(fileType, botBizId, secretId, secretKey) {
  const isPublic = ['jpg', 'jpeg', 'png', 'bmp'].includes(fileType.toLowerCase());
  const body = JSON.stringify({
    BotBizId: botBizId,
    FileType: fileType,
    IsPublic: isPublic,
    TypeKey: 'realtime',
  });

  const { authorization, timestamp, contentType } = signTC3(secretId, secretKey, body, 'DescribeStorageCredential');

  console.log('  [1/4] 获取上传凭证...');

  const res = await fetch('https://lke.tencentcloudapi.com', {
    method: 'POST',
    headers: {
      'Host': 'lke.tencentcloudapi.com',
      'Content-Type': contentType,
      'X-TC-Action': 'DescribeStorageCredential',
      'X-TC-Version': '2023-11-30',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': 'ap-guangzhou',
      'Authorization': authorization,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json();
  if (data.Response?.Error) {
    throw new Error(`Credential error: ${data.Response.Error.Message} (${data.Response.Error.Code})`);
  }

  const resp = data.Response;
  console.log('  ✅ 凭证获取成功 Bucket:', resp.Bucket, 'Region:', resp.Region, 'Type:', resp.Type);
  return resp;
}

// ============ Step 2: 上传文件到 COS ============
async function uploadToCOS(fileBuffer, fileName, fileType, fileSize, botBizId, secretId, secretKey) {
  console.log('  [2/4] 上传文件到 COS...');
  
  const cred = await getUploadCredential(fileType, botBizId, secretId, secretKey);

  const mimeTypeMap = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    pdf: 'application/pdf',
    txt: 'text/plain',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
  };
  const contentType = mimeTypeMap[fileType.toLowerCase()] || 'application/octet-stream';

  let cosHash = '';
  let eTag = '';

  if (cred.UploadUrl) {
    const uploadRes = await fetch(cred.UploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: fileBuffer,
    });
    if (!uploadRes.ok) throw new Error(`COS PUT failed: ${uploadRes.status}`);
    cosHash = uploadRes.headers.get('x-cos-hash-crc64ecma') || '';
    eTag = uploadRes.headers.get('etag') || '';
  } else if (cred.Credentials) {
    // 使用临时密钥 + COS SDK 上传
    try {
      const COS = require('cos-nodejs-sdk-v5');
      const cosClient = new COS({
        SecretId: cred.Credentials.TmpSecretId,
        SecretKey: cred.Credentials.TmpSecretKey,
        SessionToken: cred.Credentials.Token,
      });
      const result = await new Promise((resolve, reject) => {
        cosClient.putObject({
          Bucket: cred.Bucket,
          Region: cred.Region,
          Key: cred.UploadPath,
          Body: Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer),
          ContentLength: fileSize,
          ContentType: contentType,
        }, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
      eTag = result.ETag || '';
      cosHash = result.headers?.['x-cos-hash-crc64ecma'] || '';
    } catch (e) {
      throw new Error(`COS SDK upload failed: ${e.message}. Try: npm install cos-nodejs-sdk-v5`);
    }
  } else {
    throw new Error('No UploadUrl or Credentials available');
  }

  const fileUrl = cred.FileUrl ||
    `https://${cred.Bucket}.${cred.Type || 'cos'}.${cred.Region}.myqcloud.com${cred.UploadPath}`;

  console.log('  ✅ 上传成功 FileUrl:', fileUrl.substring(0, 80) + '...');
  console.log('         cosHash:', cosHash ? 'yes' : 'no', 'eTag:', eTag ? 'yes' : 'no');

  return {
    fileUrl,
    bucket: cred.Bucket,
    region: cred.Region,
    type: cred.Type || 'cos',
    uploadPath: cred.UploadPath,
    cosHash,
    eTag,
  };
}

// ============ Step 3: docParse 获取 DocId ============
async function docParse(appKey, fileName, fileType, fileSize, cosResult, conversationId) {
  console.log('  [3/4] 调用 docParse 解析文档...');
  
  const cosPath = cosResult.uploadPath ||
    (cosResult.fileUrl ? new URL(cosResult.fileUrl).pathname : '');

  const body = JSON.stringify({
    session_id: conversationId,
    bot_app_key: appKey,
    request_id: conversationId,
    cos_bucket: cosResult.bucket,
    file_type: fileType,
    file_name: fileName,
    cos_url: cosPath,
    cos_hash: cosResult.cosHash || '',
    e_tag: cosResult.eTag || '',
    size: String(fileSize),
  });

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), 120000);

  const res = await fetch('https://wss.lke.cloud.tencent.com/v1/qbot/chat/docParse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body,
    signal: controller.signal,
  });

  if (!res.ok) {
    clearTimeout(timeoutTimer);
    throw new Error(`docParse HTTP error: ${res.status}`);
  }

  let docId = null;
  let lastPayload = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;

  try {
    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const data = JSON.parse(line.substring(5).trim());
          const payload = data.payload || data;
          lastPayload = payload;
          if (payload.is_final) {
            docId = payload.doc_id;
            done = true;
            break;
          }
        } catch (_) { /* ignore */ }
      }
    }
  } finally {
    clearTimeout(timeoutTimer);
    try { await reader.cancel(); } catch (_) { /* ignore */ }
  }

  if (docId) {
    console.log('  ✅ docParse 成功 DocId:', docId);
  } else {
    console.log('  ⚠️  docParse 未返回 DocId, status:', lastPayload?.status, 'error:', lastPayload?.error_message);
  }

  return { docId, status: lastPayload?.status || 'UNKNOWN', errorMessage: lastPayload?.error_message || '' };
}

// ============ Step 4: 发送对话请求（SSE 流式） ============
async function chatWithADP(requestBody, label) {
  console.log(`  [4/4] 发送对话请求 (${label})...`);
  console.log('  请求体 Contents:');
  for (const c of requestBody.Contents) {
    if (c.Type === 'file') {
      const f = { ...c.File };
      if (f.FileUrl) f.FileUrl = f.FileUrl.substring(0, 60) + '...';
      console.log('    Type:file', JSON.stringify(f));
    } else if (c.Type === 'text') {
      console.log('    Type:text', JSON.stringify({ Text: c.Text.substring(0, 100) + (c.Text.length > 100 ? '...' : '') }));
    } else {
      console.log('    Type:' + c.Type, JSON.stringify(c).substring(0, 100));
    }
  }

  const httpUrl = CONFIG.chatUrl;

  const res = await fetch(httpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Chat HTTP error: ${res.status} ${errText.substring(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulatedText = '';
  let hadError = false;
  let errorMessage = '';
  let eventTypeStats = {};

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const dataStr = line.substring(5).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const data = JSON.parse(dataStr);
          const eventType = data.Type || '';
          eventTypeStats[eventType] = (eventTypeStats[eventType] || 0) + 1;

          // 处理 text.delta 增量文本
          if (data.Text) {
            accumulatedText += data.Text;
          }

          // 处理 error 事件
          if (eventType === 'error' || data.Error) {
            hadError = true;
            errorMessage = data.Error?.Message || data.Error?.message || JSON.stringify(data.Error || data);
          }

          // 处理 message.done 中可能包含完整文本
          if (eventType === 'message.done' && data.Message?.Contents) {
            for (const content of data.Message.Contents) {
              if (content.Type === 'text' && content.Text && !accumulatedText) {
                accumulatedText = content.Text;
              }
            }
          }
        } catch (_) { /* ignore parse errors */ }
      }
    }
  } finally {
    try { await reader.cancel(); } catch (_) { /* ignore */ }
  }

  console.log('  SSE 事件统计:', JSON.stringify(eventTypeStats));
  return { text: accumulatedText, hadError, errorMessage };
}

// ============ UUID 生成 ============
function uuid() {
  return crypto.randomUUID();
}

// ============ 判断回答是否正确 ============
function evaluateResponse(text) {
  if (!text || text.trim().length === 0) {
    return { pass: false, reason: '空回复' };
  }

  // 失败关键词：说明 AI 没有读到文档内容
  const failKeywords = [
    '请上传', '需要提供文件', '请提供文档', '请将文件', '需要文件',
    '无法读取', '没有收到文件', '未收到文档', '无法访问文件', '请发送文件',
    '请把文件', '请传入文件', '请提交文件', '没有文件', '缺少文件',
    '无法解析', '请提供相关文件', '请先上传',
  ];

  // 成功关键词：说明 AI 读到了文档内容
  const successKeywords = [
    '点对点应答', '应答', '偏离', '响应', '招标', '深圳地铁',
    '技术规格', '参数', '需求', '服务项目', '采购', '纳管',
    '智能体', '财务试点', '投标', '项目概况',
  ];

  const lowerText = text.toLowerCase();

  for (const kw of failKeywords) {
    if (lowerText.includes(kw)) {
      return { pass: false, reason: `回复包含失败关键词: "${kw}"` };
    }
  }

  let matchCount = 0;
  for (const kw of successKeywords) {
    if (lowerText.includes(kw)) matchCount++;
  }

  if (matchCount >= 2) {
    return { pass: true, reason: `回复包含 ${matchCount} 个文档相关关键词` };
  }

  return { pass: null, reason: '无法自动判断，需人工检查回复内容' };
}

// ============ 主测试流程 ============
async function runTest(mode, sharedCosResult, sharedDocId) {
  const modeLabels = {
    A: 'Type:file + DocId + DocBizId（FileName 带后缀，当前客户端方式）',
    B: 'Type:file + DocId（FileName 不带后缀，官方文档 107908 要求）',
    C: 'Type:text + Markdown 链接（Claw 模式官方示例方式）',
    D: 'Type:file + DocBizId（Python SDK 方式，不传 DocId）',
  };

  console.log('\n' + '='.repeat(80));
  console.log(`📋 测试模式 ${mode}: ${modeLabels[mode]}`);
  console.log('='.repeat(80));

  // 读取测试文件
  if (!fs.existsSync(CONFIG.testFilePath)) {
    console.error('❌ 测试文件不存在:', CONFIG.testFilePath);
    return { pass: false, reason: '文件不存在' };
  }

  const fileBuffer = fs.readFileSync(CONFIG.testFilePath);
  const fileName = path.basename(CONFIG.testFilePath);
  const fileExt = path.extname(fileName).substring(1); // docx
  const fileSize = fs.statSync(CONFIG.testFilePath).size;
  const fileNameWithoutExt = path.basename(fileName, path.extname(fileName)); // 不带后缀

  console.log(`📄 文件: ${fileName} (${(fileSize / 1024).toFixed(1)}KB, 类型: ${fileExt})`);
  console.log(`💬 Prompt: ${CONFIG.testPrompt}`);

  // 每个模式用独立的会话 ID
  const convId = uuid();

  // 复用 COS 上传结果（同一个文件不需要重复上传）
  let cosResult = sharedCosResult;
  let docId = sharedDocId;

  if (!cosResult) {
    try {
      cosResult = await uploadToCOS(fileBuffer, fileName, fileExt, fileSize, CONFIG.botBizId, CONFIG.secretId, CONFIG.secretKey);
    } catch (err) {
      console.error('❌ COS 上传失败:', err.message);
      return { pass: false, reason: 'COS 上传失败: ' + err.message };
    }
  } else {
    console.log('  [1/4] 复用已有 COS 上传结果');
    console.log('  [2/4] 复用已有 COS 上传结果');
  }

  // 每个模式需要独立的 docParse（因为 session_id 必须和 ConversationId 一致！）
  if (!docId || true) { // 始终重新 docParse，因为 session_id 需要匹配
    try {
      const parseResult = await docParse(CONFIG.appKey, fileName, fileExt, fileSize, cosResult, convId);
      docId = parseResult.docId;
    } catch (err) {
      console.error('❌ docParse 失败:', err.message);
    }
  }

  // 构建请求体
  const fileUrl = cosResult.fileUrl;
  let requestBody;

  switch (mode) {
    case 'A': {
      // 当前客户端方式：Type:file + DocId + DocBizId + FileName 带后缀
      const fileInfo = {
        FileName: fileName, // 带后缀 "xxx.docx"
        FileSize: String(fileSize),
        FileUrl: fileUrl,
        FileType: fileExt,
      };
      if (docId) {
        fileInfo.DocId = docId;
        fileInfo.DocBizId = docId;
      }
      requestBody = {
        RequestId: uuid(),
        ConversationId: convId,
        AppKey: CONFIG.appKey,
        VisitorId: 'test_adp_file_chat',
        VisitorBizId: 'test_adp_file_chat',
        Contents: [
          { Type: 'file', File: fileInfo },
          { Type: 'text', Text: CONFIG.testPrompt },
        ],
        Incremental: true,
        Stream: 'enable',
        StreamingThrottle: 5,
      };
      break;
    }

    case 'B': {
      // 官方文档 107908 要求：FileName 不带后缀，只用 DocId（不传 DocBizId）
      const fileInfo = {
        FileName: fileNameWithoutExt, // 不带后缀
        FileSize: String(fileSize),
        FileUrl: fileUrl,
        FileType: fileExt,
      };
      if (docId) {
        fileInfo.DocId = docId; // 只传 DocId，不传 DocBizId
      }
      requestBody = {
        RequestId: uuid(),
        ConversationId: convId,
        AppKey: CONFIG.appKey,
        VisitorId: 'test_adp_file_chat',
        Contents: [
          { Type: 'file', File: fileInfo },
          { Type: 'text', Text: CONFIG.testPrompt },
        ],
        Incremental: true,
        Stream: 'enable',
        StreamingThrottle: 5,
      };
      break;
    }

    case 'C': {
      // Claw 模式官方示例方式：用 Markdown 链接放在 text 里
      const markdownLink = `[${fileNameWithoutExt}](${fileUrl})`;
      requestBody = {
        RequestId: uuid(),
        ConversationId: convId,
        AppKey: CONFIG.appKey,
        VisitorId: 'test_adp_file_chat',
        Contents: [
          { Type: 'text', Text: `${markdownLink}\n\n${CONFIG.testPrompt}` },
        ],
        Incremental: true,
        Stream: 'enable',
        StreamingThrottle: 5,
      };
      break;
    }

    case 'D': {
      // Python SDK 方式：只传 DocBizId，不传 DocId
      const fileInfo = {
        FileName: fileName, // Python SDK 带后缀
        FileSize: String(fileSize),
        FileUrl: fileUrl,
        FileType: fileExt,
      };
      if (docId) {
        fileInfo.DocBizId = docId; // 只传 DocBizId，不传 DocId
      }
      requestBody = {
        RequestId: uuid(),
        ConversationId: convId,
        AppKey: CONFIG.appKey,
        VisitorId: 'test_adp_file_chat',
        VisitorBizId: 'test_adp_file_chat',
        Contents: [
          { Type: 'file', File: fileInfo },
          { Type: 'text', Text: CONFIG.testPrompt },
        ],
        Incremental: true,
        Stream: 'enable',
        StreamingThrottle: 5,
      };
      break;
    }
  }

  // 发送对话
  let result;
  try {
    result = await chatWithADP(requestBody, modeLabels[mode]);
  } catch (err) {
    console.error('❌ 对话请求失败:', err.message);
    return { pass: false, reason: '对话请求失败: ' + err.message };
  }

  // 输出结果
  console.log('\n' + '-'.repeat(60));
  console.log('📝 AI 回复:');
  console.log('-'.repeat(60));
  console.log(result.text.substring(0, 3000));
  if (result.text.length > 3000) console.log(`... (共 ${result.text.length} 字符)`);
  console.log('-'.repeat(60));

  if (result.hadError) {
    console.log('⚠️  SSE 错误:', result.errorMessage);
  }

  // 评估
  const evaluation = evaluateResponse(result.text);
  if (evaluation.pass === true) {
    console.log(`✅ 测试通过: ${evaluation.reason}`);
  } else if (evaluation.pass === false) {
    console.log(`❌ 测试失败: ${evaluation.reason}`);
  } else {
    console.log(`⚠️  需人工判断: ${evaluation.reason}`);
  }

  return { ...evaluation, responseText: result.text, docId };
}

// ============ 入口 ============
async function main() {
  console.log('🧪 ADP V2 文件对话测试');
  console.log('📅', new Date().toLocaleString());
  console.log('');

  // 解析命令行参数
  const args = process.argv.slice(2);
  if (args.includes('--login')) {
    const loginIdx = args.indexOf('--login');
    const username = args[loginIdx + 1] || 'admin';
    const password = args[loginIdx + 2] || 'admin123';
    try {
      await autoLogin(username, password);
    } catch (err) {
      console.error('❌ 自动登录失败:', err.message);
      process.exit(1);
    }
  }

  // 检查配置
  if (!CONFIG.secretKey) {
    console.error('❌ 缺少腾讯云 SecretKey');
    console.error('   方法 1: 设置环境变量 TC_SECRET_KEY=xxx');
    console.error('   方法 2: 使用 --login 参数自动获取: node test/adp-file-chat-test.js --login admin admin123');
    process.exit(1);
  }
  if (!CONFIG.appKey) {
    console.error('❌ 缺少 ADP AppKey');
    console.error('   方法 1: 设置环境变量 ADP_APP_KEY=xxx');
    console.error('   方法 2: 使用 --login 参数自动获取');
    process.exit(1);
  }
  if (!CONFIG.botBizId) {
    console.error('❌ 缺少 BotBizId');
    console.error('   方法 1: 设置环境变量 ADP_BOT_BIZ_ID=xxx');
    console.error('   方法 2: 使用 --login 参数自动获取');
    process.exit(1);
  }
  if (!fs.existsSync(CONFIG.testFilePath)) {
    console.error('❌ 测试文件不存在:', CONFIG.testFilePath);
    process.exit(1);
  }

  console.log('🔑 配置就绪:');
  console.log('   SecretId:', CONFIG.secretId.substring(0, 8) + '...');
  console.log('   SecretKey:', CONFIG.secretKey.substring(0, 4) + '****');
  console.log('   BotBizId:', CONFIG.botBizId);
  console.log('   AppKey:', CONFIG.appKey.substring(0, 8) + '...');
  console.log('');

  const results = {};
  let sharedCosResult = null;

  // 先做一次 COS 上传（所有模式共享同一个上传结果）
  const fileBuffer = fs.readFileSync(CONFIG.testFilePath);
  const fileName = path.basename(CONFIG.testFilePath);
  const fileExt = path.extname(fileName).substring(1);
  const fileSize = fs.statSync(CONFIG.testFilePath).size;

  try {
    sharedCosResult = await uploadToCOS(fileBuffer, fileName, fileExt, fileSize, CONFIG.botBizId, CONFIG.secretId, CONFIG.secretKey);
  } catch (err) {
    console.error('❌ COS 上传失败，终止测试:', err.message);
    process.exit(1);
  }

  // 逐个测试每种模式
  for (const mode of ['A', 'B', 'C', 'D']) {
    try {
      results[mode] = await runTest(mode, sharedCosResult, null);
    } catch (err) {
      console.error(`\n❌ 模式 ${mode} 异常:`, err.message);
      results[mode] = { pass: false, reason: err.message };
    }
    // 模式间等待 3 秒，避免频率限制
    if (mode !== 'D') {
      console.log('\n⏳ 等待 3 秒后测试下一种模式...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // 汇总
  console.log('\n' + '='.repeat(80));
  console.log('📊 测试汇总');
  console.log('='.repeat(80));
  const modeLabels = {
    A: 'Type:file + DocId + DocBizId（FileName 带后缀）',
    B: 'Type:file + DocId（FileName 不带后缀）',
    C: 'Type:text + Markdown 链接（Claw 模式）',
    D: 'Type:file + DocBizId（不传 DocId）',
  };

  for (const [mode, result] of Object.entries(results)) {
    const icon = result?.pass === true ? '✅' : result?.pass === false ? '❌' : '⚠️';
    console.log(`  ${icon} 模式 ${mode}: ${modeLabels[mode]}`);
    console.log(`       结果: ${result?.reason || '未执行'}`);
    if (result?.docId) console.log(`       DocId: ${result.docId}`);
  }

  console.log('\n💡 结论：');
  const passedModes = Object.entries(results).filter(([, r]) => r?.pass === true).map(([m]) => m);
  if (passedModes.length > 0) {
    console.log(`  ✅ 成功的模式: ${passedModes.join(', ')}`);
    console.log(`  📌 推荐使用模式 ${passedModes[0]} 的请求格式更新客户端`);
  } else {
    console.log('  ❌ 所有模式均未通过自动判断，请人工检查上方 AI 回复内容');
    console.log('  📌 如果所有模式都不行，问题可能在 ADP 应用配置（未开启文件理解），而非请求格式');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
