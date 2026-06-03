#!/usr/bin/env node
/**
 * Prompt 自动优化器
 * 用法：node scripts/prompt_optimizer.js --module task_recognition --bad-cases 30
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  apiKey: process.env.DEEPSEEK_API_KEY,
  apiBase: 'https://api.deepseek.com/v1',
  optimizerModel: 'deepseek-reasoner',
  evalModel: 'deepseek-chat',
  feedbackDir: process.env.MEMORA_DATA_DIR ||
    path.join(process.env.HOME, 'Library/Application Support/memora/feedback'),
  promptDir: process.env.MEMORA_PROMPT_DIR ||
    path.join(__dirname, '../prompts'),
  outputDir: process.env.MEMORA_PROMPT_DIR
    ? path.join(process.env.MEMORA_PROMPT_DIR, 'candidates')
    : path.join(__dirname, '../prompts/candidates'),
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { module: 'task_recognition', badCases: 30, autoApply: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--module') opts.module = args[++i];
    else if (args[i] === '--bad-cases') opts.badCases = parseInt(args[++i]);
    else if (args[i] === '--auto-apply') opts.autoApply = true;
  }
  return opts;
}

async function callDeepSeek(model, messages, opts = {}) {
  const response = await fetch(`${CONFIG.apiBase}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CONFIG.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, messages,
      temperature: opts.temperature ?? 0.3,
      response_format: opts.json ? { type: 'json_object' } : undefined
    })
  });
  if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

function loadBadCases(module, limit) {
  const file = path.join(CONFIG.feedbackDir, 'feedback_log.jsonl');
  if (!fs.existsSync(file)) { console.error('feedback_log.jsonl not found'); return []; }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const cases = [];
  for (let i = lines.length - 1; i >= 0 && cases.length < limit; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.module !== module) continue;
      if (!['reject', 'edit', 'delete'].includes(obj.action)) continue;
      cases.push(obj);
    } catch {}
  }
  return cases;
}

function loadCurrentPrompt(module) {
  const names = [`${module}_active.md`, `${module}_v2.0.md`];
  for (const name of names) {
    const p = path.join(CONFIG.promptDir, name);
    if (fs.existsSync(p)) {
      const realPath = fs.existsSync(p) && name.includes('active') ? fs.realpathSync(p) : p;
      return { content: fs.readFileSync(realPath, 'utf8'), version: path.basename(realPath, '.md') };
    }
  }
  return { content: '', version: 'unknown' };
}

async function generateNewPrompt(currentPrompt, badCases) {
  const systemMsg = { role: 'system', content: '你是 Prompt Engineering 专家。分析失败模式，提出修改建议，输出修改后的完整 Prompt。保持整体结构，只针对失败模式增加/修改规则。输出严格 JSON。' };
  const userMsg = { role: 'user', content: `# 当前 Prompt（v${currentPrompt.version}）\n\n\`\`\`\n${currentPrompt.content}\n\`\`\`\n\n# Bad Cases (${badCases.length} 条)\n\n${badCases.map((c, i) => `## Case ${i+1}\n- 用户操作：${c.action}\n- 原因：${c.reason || '未填写'}\n- 输入：${c.context?.source_input || '(无)'}\n- AI输出：${JSON.stringify(c.ai_output, null, 2)}\n${c.user_final ? `- 用户期望：${JSON.stringify(c.user_final, null, 2)}` : ''}`).join('\n')}\n\n输出JSON：{failure_patterns:[{pattern,evidence_cases,root_cause}],improvements:[{target_section,old_text,new_text,rationale}],new_prompt_full:"完整新版Prompt",version_bump:"minor|major",expected_improvements:""}` };

  console.log('🤖 分析失败模式...');
  const result = await callDeepSeek(CONFIG.optimizerModel, [systemMsg, userMsg], { json: true });
  return JSON.parse(result);
}

function isMatch(ai, expected) {
  if (!expected) return false;
  const keys = ['is_task', 'is_valid_info', 'priority', 'memory_type', 'category'];
  return keys.every(k => expected[k] === undefined || ai[k] === expected[k]);
}

function triggersRejectReason(ai, reason) {
  if (!reason) return false;
  if (reason.includes('不是任务') && ai.is_task === true) return true;
  if (reason.includes('不重要') && ai.priority === 'high') return true;
  return false;
}

async function evaluateOnBadCases(promptText, badCases) {
  console.log(`🧪 回归测试 ${badCases.length} 个 Bad Case...`);
  let pass = 0;
  for (let i = 0; i < badCases.length; i++) {
    const c = badCases[i];
    const inputText = c.context?.source_input;
    if (!inputText) continue;
    const filledPrompt = promptText
      .replace(/\{\{input_text\}\}/g, inputText)
      .replace(/\{\{current_time\}\}/g, new Date().toISOString())
      .replace(/\{\{[^}]+\}\}/g, '[MOCK]')
      .replace(/\{\{#each[^}]+\}\}[\s\S]*?\{\{\/each\}\}/g, '')
      .replace(/\{\{#if[^}]+\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    try {
      const aiResponse = await callDeepSeek(CONFIG.evalModel, [{ role: 'user', content: filledPrompt }], { json: true });
      const aiObj = JSON.parse(aiResponse);
      if (isMatch(aiObj, c.user_final) || !triggersRejectReason(aiObj, c.reason)) pass++;
      process.stdout.write('.');
    } catch { process.stdout.write('!'); }
  }
  console.log(`\n通过率：${pass}/${badCases.length} = ${(pass/badCases.length*100).toFixed(1)}%`);
  return { pass, total: badCases.length, rate: pass / badCases.length };
}

function bumpVersion(version, type) {
  const m = version.match(/v(\d+)\.(\d+)/);
  if (!m) return 'v2.1';
  let [_, major, minor] = m; major = parseInt(major); minor = parseInt(minor);
  if (type === 'major') { major++; minor = 0; } else minor++;
  return version.replace(/v\d+\.\d+/, `v${major}.${minor}`);
}

async function main() {
  const opts = parseArgs();
  console.log(`\n🔍 Prompt 自动优化器 - module: ${opts.module}, bad-cases: ${opts.badCases}\n`);
  if (!CONFIG.apiKey) { console.error('❌ 缺少 DEEPSEEK_API_KEY 环境变量'); process.exit(1); }

  const badCases = loadBadCases(opts.module, opts.badCases);
  if (badCases.length < 5) { console.log(`⚠️ Bad case 太少 (${badCases.length})，建议至少5条`); process.exit(0); }
  const currentPrompt = loadCurrentPrompt(opts.module);
  console.log(`✅ 已加载 ${badCases.length} 条 Bad Case，当前版本 ${currentPrompt.version}\n`);

  const splitIdx = Math.floor(badCases.length * 0.7);
  const trainSet = badCases.slice(0, splitIdx);
  const testSet = badCases.slice(splitIdx);
  console.log(`📊 训练集 ${trainSet.length} / 测试集 ${testSet.length}`);

  const oldEval = await evaluateOnBadCases(currentPrompt.content, testSet);
  console.log(`🔵 旧版本通过率：${(oldEval.rate * 100).toFixed(1)}%\n`);

  const optimization = await generateNewPrompt(currentPrompt, trainSet);
  console.log('\n📝 失败模式：');
  optimization.failure_patterns?.forEach((p, i) => console.log(`  ${i+1}. ${p.pattern} → ${p.root_cause}`));
  console.log('\n🔧 改进项：');
  optimization.improvements?.forEach((imp, i) => console.log(`  ${i+1}. [${imp.target_section}] ${imp.rationale}`));

  const newEval = await evaluateOnBadCases(optimization.new_prompt_full, testSet);
  console.log(`🟢 新版本通过率：${(newEval.rate * 100).toFixed(1)}%\n`);

  const improvement = newEval.rate - oldEval.rate;
  const newVersion = bumpVersion(currentPrompt.version, optimization.version_bump);

  if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  const candidatePath = path.join(CONFIG.outputDir, `${opts.module}_${newVersion}.md`);
  const reportPath = path.join(CONFIG.outputDir, `${opts.module}_${newVersion}.report.json`);

  fs.writeFileSync(candidatePath, optimization.new_prompt_full, 'utf8');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(), module: opts.module,
    old_version: currentPrompt.version, new_version: newVersion,
    bad_cases_used: badCases.length, train_size: trainSet.length, test_size: testSet.length,
    old_pass_rate: oldEval.rate, new_pass_rate: newEval.rate, improvement,
    failure_patterns: optimization.failure_patterns,
    improvements: optimization.improvements,
    expected_improvements: optimization.expected_improvements
  }, null, 2), 'utf8');

  console.log(`📦 候选 Prompt：${candidatePath}`);
  console.log(`📊 评测报告：${reportPath}\n`);

  if (improvement >= 0.05) {
    console.log(`✅ 提升 ${(improvement * 100).toFixed(1)}%，建议启用！`);
    if (opts.autoApply) {
      const activeLink = path.join(CONFIG.promptDir, `${opts.module}_active.md`);
      if (fs.existsSync(activeLink)) fs.unlinkSync(activeLink);
      fs.symlinkSync(candidatePath, activeLink);
      console.log(`🔗 已切换 active → ${newVersion}`);
    } else {
      console.log('💡 加 --auto-apply 自动启用');
    }
  } else if (improvement >= 0) {
    console.log(`⚠️ 提升不显著 (+${(improvement * 100).toFixed(1)}%)，保留旧版本`);
  } else {
    console.log(`❌ 新版本下降 (${(improvement * 100).toFixed(1)}%)，丢弃`);
  }
}

main().catch(e => { console.error('❌ 失败：', e); process.exit(1); });
