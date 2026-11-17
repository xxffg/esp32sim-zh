#!/usr/bin/env node
// esp32sim 汉化流水线的增量翻译脚本。
// 纯 Node.js 24,零第三方依赖:只用内置 fetch 与 fs/crypto/os/path/url。
//
// 流程:
//   1. 读出 zh/strings.json 里 zh 为空/空白的单元;
//   2. cache key = sha256(glossary.version + PROMPT_VERSION + en),命中则直接写回;
//   3. 未命中按每批 <= 12 条调用 POST {api-base}/chat/completions;
//   4. 校验模型返回的 JSON 数组;解析或校验失败时回贴错误重试一次;
//   5. 写回 strings.json,并更新 cache.json / translate-failures.json。
//
// 用法: node tools/zh-translate.mjs --help

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROMPT_VERSION = 'zh-translate-prompt-v1';
const DEFAULT_API_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BATCH_UNITS = 12;
// 12 条只是条数上限;单条帮助文本可能很长,再用字符预算兜底,避免输出被截断。
const MAX_BATCH_CHARS = 12_000;
const MAX_ATTEMPTS = 2;

const MINIMAL_GLOSSARY = {
  version: 'zh-glossary-v1',
  note: 'esp32sim 汉化术语表;改动术语时请同时改 version,否则旧译文缓存仍会命中。',
  terms: {
    board: '开发板',
    station: '站点',
    guest: '客户机',
    flash: '闪存',
    bootloader: '引导程序',
    'mask ROM': '芯片自带 ROM',
    stub: '桩函数',
    'lock-step': '锁步',
  },
};

const STYLE_RULES = [
  '1. 只用简体中文。中文句子一律使用全角标点(，。：；？！、)，不要用半角 , . : ; ? !。',
  '2. 单句不超过 40 个汉字;长句拆成几个短句。',
  '3. 先说结论,再说条件。例如先说"会失败",再说"在什么情况下失败"。',
  '4. 技术名词保留原文:ESP32 系列、ROM、JIT、UART、GPIO、WiFi、PSRAM、ELF 等;不要意译成"只读存储器""通用异步收发器"之类。',
  '5. 不翻译 --flag、命令行选项、文件路径、URL、板型名;这些一律原样保留。',
  '6. 反引号 `...` 里的内容原样保留。',
  '7. 只翻译自然语言,不改代码:缩进、引号、转义序列(如 \\n、\\t、\\")、{}、宏、函数名、变量名、运算符都保持原样。',
  '8. 多行原文逐行对应翻译,保持行数,并保留每行开头的缩进空格。',
  '9. 优先采用术语表里的译法;上下文明显不符时才调整,并保持全文术语一致。',
  '10. 不添加原文没有的解释、结论或客套话;帮助文本和错误信息要简洁、可直接展示给用户。',
].join('\n');

const HELP = `用法: node tools/zh-translate.mjs [选项]

  --strings <file>     翻译单元 JSON(默认 zh/strings.json)
  --cache <file>       翻译记忆缓存(默认 zh/cache.json;首次成功翻译时创建)
  --glossary <file>    术语表 JSON(默认 zh/glossary.json;缺失时创建最小可用版本)
  --limit <N>          本轮最多处理 N 条待译单元
  --dry-run            不联网、不写文件,只报告待译数量与按文件的统计
  --api-base <url>     DeepSeek API 基址(默认 ${DEFAULT_API_BASE})
  --model <name>       模型名(默认 ${DEFAULT_MODEL})
  --concurrency <N>    并发批次数(默认 ${DEFAULT_CONCURRENCY})
  --verbose            打印缓存键、批次详情、失败时的模型原始输出与 token 用量
  --self-test          用内置假 fetch 跑离线自测(不联网、不写仓库)
  -h, --help           显示本帮助

环境变量:
  DEEPSEEK_API_KEY       真实调用时必需;不要写进任何文件
  DEEPSEEK_TIMEOUT_MS    单次请求超时毫秒数(默认 ${DEFAULT_TIMEOUT_MS})

示例:
  node tools/zh-translate.mjs --dry-run
  node tools/zh-translate.mjs --limit 2 --verbose
  node tools/zh-translate.mjs --self-test
`;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

class TranslateError extends Error {
  constructor(message, { retryable = true, kind = 'request', content = null, attempts = undefined } = {}) {
    super(message);
    this.name = 'TranslateError';
    this.retryable = retryable;
    this.kind = kind;
    this.content = content;
    this.attempts = attempts;
  }
}

const sha256 = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex');

// cache key 严格按约定拼接:glossary.version + promptVersion + en。
const cacheKey = (glossaryVersion, en) => sha256(`${glossaryVersion}${PROMPT_VERSION}${en}`);

const redact = (text, secret) => {
  const s = String(text ?? '');
  if (!secret) return s;
  return s.split(secret).join('***');
};

const displayPath = (p) => {
  const r = relative(process.cwd(), p);
  return r && !r.startsWith('..') ? r : p;
};

function readJsonFile(file, what) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`读不到${what} ${file}:${e?.code ?? e?.message ?? e}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${what}不是合法 JSON(${file}):${e.message}`);
  }
}

function writeJsonAtomic(file, value) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(value, null, 2) + '\n';
  const tmp = join(dir, `.${basename(file)}.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, text, 'utf8');
  try {
    renameSync(tmp, file);
  } catch {
    // Windows 上偶发 rename 被占用;退化为直接写,至少不丢结果。
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    writeFileSync(file, text, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    strings: 'zh/strings.json',
    cache: 'zh/cache.json',
    glossary: 'zh/glossary.json',
    limit: null,
    dryRun: false,
    apiBase: DEFAULT_API_BASE,
    model: DEFAULT_MODEL,
    concurrency: DEFAULT_CONCURRENCY,
    verbose: false,
    help: false,
    selfTest: false,
  };

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '-h' || arg === '--help') { opts.help = true; continue; }
    if (!arg.startsWith('--')) throw new Error(`无法识别的参数:${arg}\n用 --help 查看用法。`);

    let value;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      value = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const name = arg.slice(2);
    const need = () => {
      if (value !== undefined) {
        if (value === '') throw new Error(`选项 --${name} 的值不能为空`);
        return value;
      }
      if (i + 1 >= argv.length) throw new Error(`选项 --${name} 缺少值`);
      const v = argv[++i];
      if (v.startsWith('--')) throw new Error(`选项 --${name} 缺少值`);
      return v;
    };
    const flag = (key) => {
      if (value !== undefined) throw new Error(`选项 --${name} 不接受值`);
      opts[key] = true;
    };

    switch (name) {
      case 'dry-run': flag('dryRun'); break;
      case 'verbose': flag('verbose'); break;
      case 'self-test': flag('selfTest'); break;
      case 'strings': opts.strings = need(); break;
      case 'cache': opts.cache = need(); break;
      case 'glossary': opts.glossary = need(); break;
      case 'limit': opts.limit = need(); break;
      case 'api-base': opts.apiBase = need(); break;
      case 'model': opts.model = need(); break;
      case 'concurrency': opts.concurrency = need(); break;
      default: throw new Error(`未知选项:--${name}\n用 --help 查看用法。`);
    }
  }

  if (opts.limit !== null) {
    const n = Number(opts.limit);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--limit 必须是非负整数,收到:${opts.limit}`);
    opts.limit = n;
  }
  const concurrency = Number(opts.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency 必须是正整数,收到:${opts.concurrency}`);
  }
  opts.concurrency = concurrency;
  if (!String(opts.model).trim()) throw new Error('--model 不能为空');
  opts.apiBase = String(opts.apiBase).trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (!opts.apiBase) throw new Error('--api-base 不能为空');
  return opts;
}

// ---------------------------------------------------------------------------
// 术语表
// ---------------------------------------------------------------------------

function versionOf(data) {
  const raw = data?.version ?? data?.meta?.version ?? data?.revision ?? data?.rev;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (raw !== undefined && raw !== null) return sha256(JSON.stringify(raw)).slice(0, 16);
  // 没有 version 时用内容哈希,至少保证术语表一变、缓存就失效。
  return sha256(JSON.stringify(data)).slice(0, 16);
}

function extractTerms(data) {
  let src = data?.terms ?? data?.entries ?? data?.glossary ?? data?.termBase ?? null;
  if (src === null && Array.isArray(data)) src = data;
  if (src === null && data && typeof data === 'object') {
    const skip = new Set(['version', 'meta', 'note', 'description', 'source', 'updatedAt', 'updated_at', 'rev', 'revision']);
    const candidate = {};
    for (const [k, v] of Object.entries(data)) if (!skip.has(k)) candidate[k] = v;
    src = candidate;
  }

  const map = new Map();
  const add = (en, zh, note) => {
    if (typeof en !== 'string' || typeof zh !== 'string') return;
    const e = en.trim();
    const z = zh.trim();
    if (!e || !z) return;
    map.set(e, { en: e, zh: z, note: typeof note === 'string' && note.trim() ? note.trim() : undefined });
  };

  if (Array.isArray(src)) {
    for (const item of src) {
      if (!item || typeof item !== 'object') continue;
      add(
        item.en ?? item.source ?? item.term ?? item.from ?? item.name,
        item.zh ?? item.target ?? item.translation ?? item.to,
        item.note ?? item.comment,
      );
    }
  } else if (src && typeof src === 'object') {
    for (const [en, v] of Object.entries(src)) {
      if (typeof v === 'string') add(en, v);
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        add(v.en ?? en, v.zh ?? v.target ?? v.translation ?? v.to, v.note ?? v.comment);
      }
    }
  }
  return [...map.values()];
}

function formatGlossary(terms) {
  if (!terms.length) return '(没有可用术语,按通用规则翻译)';
  return terms.slice(0, 200).map(t => `- ${t.en} => ${t.zh}${t.note ? `(${t.note})` : ''}`).join('\n');
}

function ensureGlossary(file, log) {
  if (existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  const text = JSON.stringify(MINIMAL_GLOSSARY, null, 2) + '\n';
  try {
    // wx:另一个任务若同时创建了术语表,这里不会覆盖它。
    writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' });
    log(`已创建最小术语表:${displayPath(file)}`);
    return true;
  } catch (e) {
    if (e?.code === 'EEXIST') return false;
    throw new Error(`无法创建术语表 ${file}:${e?.message ?? e}`);
  }
}

function loadGlossary(file, { verbose = false, log = () => {} } = {}) {
  if (!existsSync(file)) {
    if (verbose) log(`术语表 ${file} 不存在,使用内置最小术语表(不写文件)`);
    const terms = extractTerms(MINIMAL_GLOSSARY);
    return { version: MINIMAL_GLOSSARY.version, terms, text: formatGlossary(terms), builtin: true };
  }
  const data = readJsonFile(file, '术语表');
  let terms = extractTerms(data);
  if (!terms.length) {
    if (verbose) log(`术语表 ${file} 里没有可用术语,回退到内置最小术语表`);
    terms = extractTerms(MINIMAL_GLOSSARY);
    return { version: MINIMAL_GLOSSARY.version, terms, text: formatGlossary(terms), builtin: true };
  }
  return { version: versionOf(data), terms, text: formatGlossary(terms), builtin: false };
}

// ---------------------------------------------------------------------------
// 翻译记忆缓存
// ---------------------------------------------------------------------------

function loadCache(file, { log = () => {}, verbose = false } = {}) {
  const map = new Map();
  if (!existsSync(file)) return { map, existed: false };
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    log(`警告:缓存 ${file} 不是合法 JSON,按空缓存继续(${e.message})`);
    return { map, existed: true, corrupt: true };
  }
  const entries = data && typeof data === 'object' && !Array.isArray(data)
    && data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)
    ? data.entries
    : data;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    if (verbose) log(`缓存 ${file} 结构无法识别,按空缓存继续`);
    return { map, existed: true, corrupt: true };
  }
  for (const [key, value] of Object.entries(entries)) {
    if (key === 'version' || key === 'promptVersion' || key === 'glossaryVersion' || key === 'meta') continue;
    const zh = typeof value === 'string'
      ? value
      : (value && typeof value === 'object' ? value.zh : undefined);
    if (typeof zh !== 'string' || !zh.trim()) continue;
    map.set(key, {
      zh,
      model: value && typeof value === 'object' ? value.model : undefined,
      updatedAt: value && typeof value === 'object' ? value.updatedAt : undefined,
    });
  }
  return { map, existed: true };
}

function ensureCacheFile(file, { log = () => {}, verbose = false, glossaryFile = null } = {}) {
  if (existsSync(file)) return false;
  let glossaryVersion = null;
  if (glossaryFile && existsSync(glossaryFile)) {
    try { glossaryVersion = versionOf(JSON.parse(readFileSync(glossaryFile, 'utf8'))); } catch { /* 元数据不阻塞 */ }
  }
  writeJsonAtomic(file, {
    version: 1,
    promptVersion: PROMPT_VERSION,
    glossaryVersion,
    entries: {},
  });
  if (verbose) log(`已初始化空缓存:${displayPath(file)}`);
  return true;
}

function saveCache(file, map, glossaryVersion, model) {
  const entries = {};
  for (const key of [...map.keys()].sort()) {
    const v = map.get(key) ?? {};
    entries[key] = {
      zh: v.zh,
      model: v.model ?? model,
      updatedAt: v.updatedAt ?? new Date().toISOString(),
    };
  }
  writeJsonAtomic(file, {
    version: 1,
    promptVersion: PROMPT_VERSION,
    glossaryVersion,
    entries,
  });
}

// ---------------------------------------------------------------------------
// 提示词与模型返回解析
// ---------------------------------------------------------------------------

function buildSystemPrompt(glossaryText) {
  return [
    '你是 esp32sim 项目的简体中文译者。esp32sim 是 ESP32 系列芯片的模拟器。',
    '把用户给出的英文原文翻译成简体中文;原文通常是代码里的帮助文本、错误信息、日志或界面文案。',
    '',
    '文风规则(全部必须遵守):',
    STYLE_RULES,
    '',
    '术语表(优先采用,并保持全文一致):',
    glossaryText,
    '',
    '输出要求:',
    '只输出一个 JSON 数组,不要 markdown 代码块,不要任何解释或前后缀。',
    '每个元素形如 {"i":0,"zh":"译文"};i 是输入条目的序号(从 0 开始),zh 不能为空。',
    '数组长度必须等于输入条数;不要遗漏、重复或新增。',
  ].join('\n');
}

function buildMessages(items, systemPrompt, feedback) {
  const input = items.map((item, i) => ({ i, file: item.unit.file, en: item.unit.en }));
  let user = [
    `请翻译下面 ${items.length} 条,每条包含 file(源码路径)与 en(英文原文)。`,
    '输入:',
    JSON.stringify(input),
    '',
    `只输出 JSON 数组,共 ${items.length} 条,形如 [{"i":0,"zh":"..."}];i 从 0 开始。`,
  ].join('\n');
  if (feedback) user += `\n\n${feedback}`;
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: user },
  ];
}

// 从模型回复里取出数组:先整体解析,再试代码块,最后按括号扫描。
// 允许模型在 JSON 前后带解释文字,但最终必须解析出一个数组。
function extractJsonArray(text) {
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  const attempts = [s.trim()];
  for (const match of s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) attempts.push(match[1].trim());
  for (let start = s.indexOf('['); start !== -1 && attempts.length <= 40; start = s.indexOf('[', start + 1)) {
    const end = findMatchingBracket(s, start);
    if (end !== -1) attempts.push(s.slice(start, end + 1));
  }

  let lastError = null;
  let fallback = null;
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      const value = JSON.parse(attempt);
      if (!Array.isArray(value)) continue;
      // 解释文字里可能有 "[1]" 之类的括号;优先返回对象数组,即真正的翻译结果。
      if (value.length === 0
        || value.every(entry => entry && typeof entry === 'object' && !Array.isArray(entry))) {
        return value;
      }
      fallback ??= value;
    } catch (e) {
      lastError = e;
    }
  }
  if (fallback) return fallback;
  throw new Error(lastError ? lastError.message : '没有找到 JSON 数组');
}

function findMatchingBracket(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function validateBatch(parsed, count) {
  const problems = [];
  if (!Array.isArray(parsed)) problems.push('返回的不是数组');
  else if (parsed.length !== count) problems.push(`条数不符:期望 ${count},实际 ${parsed.length}`);

  const out = new Array(count);
  const seen = new Set();
  const list = Array.isArray(parsed) ? parsed : [];
  for (let pos = 0; pos < list.length; pos++) {
    const entry = list[pos];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`第 ${pos} 个元素不是对象`);
      continue;
    }
    const i = entry.i;
    if (!Number.isInteger(i) || i < 0 || i >= count) {
      problems.push(`第 ${pos} 个元素的 i=${JSON.stringify(i)} 不在 0..${count - 1}`);
      continue;
    }
    if (seen.has(i)) {
      problems.push(`i=${i} 重复`);
      continue;
    }
    if (typeof entry.zh !== 'string' || !entry.zh.trim()) {
      problems.push(`i=${i} 的 zh 为空`);
      continue;
    }
    seen.add(i);
    out[i] = entry.zh;
  }
  if (list.length === count) {
    for (let i = 0; i < count; i++) if (!seen.has(i)) problems.push(`缺少 i=${i}`);
  }
  if (problems.length) {
    throw new TranslateError(`返回校验失败:${problems.slice(0, 6).join(';')}`, {
      kind: 'validate',
      retryable: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTTP 与单批翻译
// ---------------------------------------------------------------------------

async function requestChat({ apiBase, apiKey, model, timeoutMs, fetchImpl, messages }) {
  const url = `${apiBase}/chat/completions`;
  const body = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 8192,
    stream: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error(`请求超时(${timeoutMs} ms)`);
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutMs);

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new TranslateError(`请求超时(${timeoutMs} ms)`, { kind: 'request', retryable: true });
    }
    throw new TranslateError(`网络错误:${e?.message ?? e}`, { kind: 'request', retryable: true });
  }

  // 定时器要覆盖响应体读取:服务器可能先回头部、再卡住正文。
  let raw;
  try {
    raw = await res.text();
  } catch (e) {
    if (controller.signal.aborted) {
      throw new TranslateError(`请求超时(${timeoutMs} ms)`, { kind: 'request', retryable: true });
    }
    throw new TranslateError(`读取响应失败:${e?.message ?? e}`, { kind: 'request', retryable: true });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = String(raw ?? '').trim().slice(0, 500);
    try {
      const parsed = JSON.parse(raw);
      const message = parsed?.error?.message ?? parsed?.message;
      if (typeof message === 'string' && message.trim()) detail = message.trim().slice(0, 500);
    } catch { /* 保持原始文本 */ }
    const retryable = res.status === 429 || res.status >= 500;
    throw new TranslateError(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`, {
      kind: 'http',
      retryable,
    });
  }

  let data;
  try {
    data = JSON.parse(String(raw).replace(/^\uFEFF/, ''));
  } catch {
    throw new TranslateError(`API 响应不是 JSON:${String(raw).slice(0, 200)}`, {
      kind: 'request',
      retryable: true,
    });
  }
  if (data?.error) {
    const message = typeof data.error.message === 'string'
      ? data.error.message
      : JSON.stringify(data.error);
    throw new TranslateError(`API 错误:${message.slice(0, 500)}`, { kind: 'http', retryable: false });
  }

  let content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    content = content.map(part => (typeof part === 'string' ? part : (part?.text ?? ''))).join('');
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new TranslateError('API 返回内容为空', { kind: 'request', retryable: true });
  }
  return { content, usage: data?.usage ?? null };
}

async function translateBatch(items, ctx) {
  let lastError = null;
  let lastAttempt = 0;
  let feedback = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    lastAttempt = attempt;
    try {
      const messages = buildMessages(items, ctx.systemPrompt, feedback);
      const result = await requestChat({
        apiBase: ctx.apiBase,
        apiKey: ctx.apiKey,
        model: ctx.model,
        timeoutMs: ctx.timeoutMs,
        fetchImpl: ctx.fetchImpl,
        messages,
      });

      let parsed;
      try {
        parsed = extractJsonArray(result.content);
      } catch (e) {
        throw new TranslateError(`JSON 解析失败:${e.message}`, {
          kind: 'parse',
          retryable: true,
          content: result.content,
        });
      }
      const translations = validateBatch(parsed, items.length);
      return { translations, attempts: attempt, usage: result.usage };
    } catch (e) {
      const err = e instanceof TranslateError
        ? e
        : new TranslateError(String(e?.message ?? e), { kind: 'request', retryable: true });
      if (ctx.verbose) {
        ctx.log(`  批次 ${ctx.batchNo} 第 ${attempt} 次失败:${ctx.safe(err.message)}`);
        if (err.content) {
          ctx.log(`  模型原始输出(截断):${ctx.safe(String(err.content).slice(0, 800)).replace(/\n/g, '\\n')}`);
        }
      }
      lastError = err;
      if (!err.retryable || attempt === MAX_ATTEMPTS) break;

      if (err.kind === 'parse' || err.kind === 'validate') {
        feedback = [
          `上一轮回复无法使用:${err.message}`,
          '请重新输出。只输出 JSON 数组,从 [ 开始到 ] 结束,不要解释、不要 markdown 代码块。',
          `数组必须正好 ${items.length} 条,i 取 0..${items.length - 1},每条 zh 非空。`,
        ].join('\n');
      } else {
        feedback = `上一轮请求失败:${err.message}\n请重试,只输出 JSON 数组。`;
      }
    }
  }

  throw new TranslateError(`${lastError?.message ?? '未知错误'}(已尝试 ${lastAttempt} 次)`, {
    kind: lastError?.kind ?? 'request',
    retryable: false,
    content: lastError?.content ?? null,
    attempts: lastAttempt,
  });
}

// ---------------------------------------------------------------------------
// 分批与主流程
// ---------------------------------------------------------------------------

function buildBatches(items) {
  const batches = [];
  let current = [];
  let chars = 0;
  const flush = () => {
    if (!current.length) return;
    batches.push(current);
    current = [];
    chars = 0;
  };

  for (const item of items) {
    const cost = item.unit.en.length + 64;
    if (current.length >= MAX_BATCH_UNITS
      || (current.length > 0 && chars + cost > MAX_BATCH_CHARS)) {
      flush();
    }
    current.push(item);
    chars += cost;
  }
  flush();
  return batches;
}

function fileCounts(items) {
  const counts = new Map();
  for (const item of items) {
    const file = item.unit.file;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function run(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? ((...args) => console.log(...args));
  const logError = options.logError ?? ((...args) => console.error(...args));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const opts = parseArgs(argv);
  if (opts.help) {
    log(HELP);
    return { exitCode: 0 };
  }

  const stringsFile = resolve(cwd, opts.strings);
  const cacheFile = resolve(cwd, opts.cache);
  const glossaryFile = resolve(cwd, opts.glossary);
  const failuresFile = join(dirname(stringsFile), 'translate-failures.json');

  const doc = readJsonFile(stringsFile, '翻译单元文件');
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.units)) {
    throw new Error(`翻译单元文件缺少 units 数组:${stringsFile}`);
  }
  const badUnit = doc.units.findIndex(unit => !unit || typeof unit !== 'object' || typeof unit.en !== 'string');
  if (badUnit !== -1) throw new Error(`units[${badUnit}] 缺少字符串字段 en:${stringsFile}`);

  // 非 dry-run 时补一份最小术语表(已存在则绝不覆盖),并确保缓存文件存在。
  // dry-run 不写任何文件,包括这两个。
  if (!opts.dryRun) {
    ensureGlossary(glossaryFile, log);
    ensureCacheFile(cacheFile, { log, verbose: opts.verbose, glossaryFile });
  }

  const allPending = [];
  doc.units.forEach((unit, index) => {
    if (typeof unit.zh !== 'string' || unit.zh.trim() === '') allPending.push({ unit, docIndex: index });
  });
  const selected = opts.limit === null ? allPending : allPending.slice(0, opts.limit);

  if (!selected.length) {
    if (allPending.length) log('将翻译 0 条');
    else log('没有待译单元');
    return {
      exitCode: 0,
      pending: 0,
      selected: 0,
      cacheHits: 0,
      translated: 0,
      failed: 0,
      apiCalls: 0,
      batches: 0,
    };
  }

  const glossary = loadGlossary(glossaryFile, { verbose: opts.verbose, log });
  const systemPrompt = buildSystemPrompt(glossary.text);
  const { map: cache } = loadCache(cacheFile, { log, verbose: opts.verbose });

  const work = selected.map(item => ({
    ...item,
    key: cacheKey(glossary.version, item.unit.en),
  }));
  const apiWork = [];
  let cacheHits = 0;
  for (const item of work) {
    const hit = cache.get(item.key);
    if (hit) {
      item.fromCache = true;
      item.zh = hit.zh;
      cacheHits++;
      if (opts.verbose) {
        log(`  缓存命中 ${item.key.slice(0, 12)} ${item.unit.file}:${item.unit.en.split('\n')[0].slice(0, 60)}`);
      }
    } else {
      apiWork.push(item);
    }
  }
  const batches = buildBatches(apiWork);

  if (opts.dryRun) {
    log(`将翻译 ${selected.length} 条`);
    for (const [file, count] of fileCounts(selected)) {
      log(`  ${String(count).padStart(4)}  ${file}`);
    }
    log(`缓存命中 ${cacheHits} 条,需调用 API ${apiWork.length} 条,分 ${batches.length} 批`);
    return {
      exitCode: 0,
      pending: selected.length,
      selected: selected.length,
      cacheHits,
      translated: 0,
      failed: 0,
      apiCalls: 0,
      batches: batches.length,
      cached: cacheHits,
    };
  }

  const apiKey = String(env.DEEPSEEK_API_KEY ?? '').trim();
  if (apiWork.length && !apiKey) {
    logError('错误:未设置 DEEPSEEK_API_KEY,无法调用 DeepSeek API。');
    logError('  PowerShell: $env:DEEPSEEK_API_KEY = "sk-..."');
    logError('  bash/zsh:   export DEEPSEEK_API_KEY=sk-...');
    logError('  没有 key 时可先用 --dry-run 检查待译条目,或跑 --self-test。');
    return { exitCode: 1, pending: selected.length, cacheHits, translated: 0, failed: 0, apiCalls: 0, batches: batches.length };
  }
  if (apiWork.length && typeof fetchImpl !== 'function') {
    throw new Error('当前 Node.js 没有可用的 fetch;需要 Node.js 18+。');
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (apiWork.length && env.DEEPSEEK_TIMEOUT_MS !== undefined && String(env.DEEPSEEK_TIMEOUT_MS).trim() !== '') {
    const n = Number(env.DEEPSEEK_TIMEOUT_MS);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`DEEPSEEK_TIMEOUT_MS 必须是正整数毫秒数,收到:${env.DEEPSEEK_TIMEOUT_MS}`);
    }
    timeoutMs = Math.floor(n);
  }

  const safe = text => redact(text, apiKey);
  log(`待译 ${selected.length} 条:缓存命中 ${cacheHits} 条,需调用 API ${apiWork.length} 条,`
    + `分 ${batches.length} 批(模型 ${opts.model},并发 ${opts.concurrency})`);

  const success = new Map();
  for (const item of work) if (item.fromCache) success.set(item.docIndex, item.zh);

  const failures = [];
  let translatedApi = 0;
  let failedUnits = 0;
  let apiCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheDirty = false;
  let nextBatch = 0;

  const worker = async () => {
    while (true) {
      const batchIndex = nextBatch++;
      if (batchIndex >= batches.length) return;
      const items = batches[batchIndex];
      try {
        const result = await translateBatch(items, {
          apiBase: opts.apiBase,
          apiKey,
          model: opts.model,
          timeoutMs,
          fetchImpl,
          systemPrompt,
          verbose: opts.verbose,
          log,
          safe,
          batchNo: batchIndex + 1,
        });
        apiCalls += result.attempts;
        translatedApi += items.length;
        if (result.usage) {
          promptTokens += Number(result.usage.prompt_tokens) || 0;
          completionTokens += Number(result.usage.completion_tokens) || 0;
        }
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const zh = result.translations[i];
          success.set(item.docIndex, zh);
          cache.set(item.key, { zh, model: opts.model, updatedAt: new Date().toISOString() });
          cacheDirty = true;
        }
        log(`[${batchIndex + 1}/${batches.length}] ${items.length} 条 -> 成功 ${items.length}`);
      } catch (e) {
        const reason = safe(e?.message ?? e);
        apiCalls += e?.attempts ?? MAX_ATTEMPTS;
        for (const item of items) {
          failures.push({
            docIndex: item.docIndex,
            file: item.unit.file,
            en: item.unit.en,
            occ: item.unit.occ,
            reason,
            attempts: e?.attempts ?? MAX_ATTEMPTS,
          });
        }
        failedUnits += items.length;
        log(`[${batchIndex + 1}/${batches.length}] ${items.length} 条 -> 失败 ${items.length}(${reason})`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, batches.length) }, () => worker()),
  );

  if (success.size) {
    for (const [index, zh] of success) doc.units[index].zh = zh;
    writeJsonAtomic(stringsFile, doc);
    log(`写回 ${stringsFile}:${success.size} 条`);
  } else if (opts.verbose) {
    log('没有成功结果,strings.json 未改动');
  }

  if (cacheDirty) {
    saveCache(cacheFile, cache, glossary.version, opts.model);
    log(`缓存写回 ${cacheFile}:${cache.size} 条`);
  }

  if (failures.length) {
    failures.sort((a, b) => a.docIndex - b.docIndex);
    writeJsonAtomic(failuresFile, {
      generatedAt: new Date().toISOString(),
      model: opts.model,
      count: failures.length,
      failures: failures.map(({ file, en, occ, reason, attempts }) => ({ file, en, occ, reason, attempts })),
    });
    logError(`失败 ${failures.length} 条,清单:${failuresFile}`);
  } else if (existsSync(failuresFile)) {
    rmSync(failuresFile, { force: true });
    if (opts.verbose) log(`已删除旧的失败清单 ${failuresFile}`);
  }

  log(`完成:成功 ${success.size} 条(缓存 ${cacheHits} + API ${translatedApi}),失败 ${failedUnits} 条`);
  if (opts.verbose) log(`API 调用 ${apiCalls} 次,token 用量 输入 ${promptTokens} / 输出 ${completionTokens}`);

  return {
    exitCode: failures.length ? 2 : 0,
    pending: selected.length,
    selected: selected.length,
    cacheHits,
    translated: success.size,
    failed: failedUnits,
    apiCalls,
    batches: batches.length,
    cacheEntries: cache.size,
  };
}

// ---------------------------------------------------------------------------
// 离线自测:注入假 fetch,模拟三类模型回复
// ---------------------------------------------------------------------------

function check(condition, message) {
  if (!condition) throw new Error(`断言失败:${message}`);
}

async function selfTest() {
  const dirs = [];
  try {
    // --- 场景 1:正常 JSON / 带解释文字的 JSON / 非法 JSON 重试 ---
    const dir = mkdtempSync(join(tmpdir(), 'zh-translate-selftest-'));
    dirs.push(dir);
    const strings = join(dir, 'strings.json');
    const cache = join(dir, 'cache.json');
    const glossary = join(dir, 'glossary.json');
    const failures = join(dir, 'translate-failures.json');

    const initialUnits = Array.from({ length: 25 }, (_, i) => ({
      file: i < 12 ? 'src/first.js' : (i < 24 ? 'src/second.js' : 'src/third.js'),
      en: `message ${i}: the board failed to boot`,
      zh: '',
      occ: 1,
    }));
    initialUnits.push({ file: 'src/first.js', en: 'already translated', zh: '已完成', occ: 1 });
    const initialDoc = { meta: { count: initialUnits.length }, units: initialUnits };
    writeFileSync(strings, JSON.stringify(initialDoc, null, 2) + '\n', 'utf8');
    writeFileSync(glossary, JSON.stringify({
      version: 'self-test-v1',
      terms: { board: '开发板', bootloader: '引导程序' },
    }, null, 2) + '\n', 'utf8');

    // 解释文字里先出现 "[1]" 时,也必须提取后面的对象数组。
    const extracted = extractJsonArray('说明[1]:\n[{"i":0,"zh":"提取成功"}]\n请查收。[2]');
    check(extracted.length === 1 && extracted[0].zh === '提取成功', '应能从解释文字中提取对象数组');

    const requests = [];
    const attemptByStart = new Map();
    const fakeFetch = async (url, init) => {
      const requestBody = JSON.parse(init.body);
      const user = requestBody.messages.at(-1).content;
      const batch = extractJsonArray(user);
      // 每批的 i 都从 0 开始,所以用 en 里的编号区分批次。
      const start = Number(/^message (\d+):/.exec(batch[0].en)?.[1] ?? 0);
      const attempt = (attemptByStart.get(start) ?? 0) + 1;
      attemptByStart.set(start, attempt);
      requests.push({ url, requestBody, user, start, attempt });

      let content;
      if (start === 0) {
        content = JSON.stringify(batch.map(({ i }) => ({ i, zh: `正常译文 ${i}` })));
      } else if (start === 12) {
        content = '好的,以下是翻译结果(注意[1]只是说明):\n'
          + JSON.stringify(batch.map(({ i }) => ({ i, zh: `解释文字里的译文 ${i}` })))
          + '\n如需调整请告诉我。[2]';
      } else if (attempt === 1) {
        content = '抱歉,输出坏了: [ {"i":24,"zh":"没有闭合';
      } else {
        content = JSON.stringify(batch.map(({ i }) => ({ i, zh: `重试后的译文 ${i}` })));
      }

      return new Response(JSON.stringify({
        id: 'fake',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const quiet = () => {};
    const baseArgs = ['--strings', strings, '--cache', cache, '--glossary', glossary, '--concurrency', '1'];
    const r1 = await run({
      argv: baseArgs,
      env: { DEEPSEEK_API_KEY: 'test-key' },
      fetchImpl: fakeFetch,
      log: quiet,
      logError: quiet,
    });
    check(r1.exitCode === 0, `正常场景应退出 0,实际 ${r1.exitCode}`);
    check(r1.apiCalls === 4, `应调用 4 次(非法 JSON 多一次重试),实际 ${r1.apiCalls}`);
    check(r1.translated === 25 && r1.cacheHits === 0, `应翻译 25 条,实际 ${r1.translated}/${r1.cacheHits}`);
    check(attemptByStart.get(24) === 2, '非法 JSON 应触发一次重试');
    const retryRequest = requests.find(r => r.start === 24 && r.attempt === 2);
    check(!!retryRequest && /无法使用/.test(retryRequest.user), '重试请求应回贴解析错误');
    check(requests.every(r => r.url.endsWith('/chat/completions')), '请求地址应为 /chat/completions');
    const systemContent = requests[0].requestBody.messages[0].content;
    check(/单句不超过 40 个汉字/.test(systemContent), '提示词应包含单句长度规则');
    check(/全角标点/.test(systemContent), '提示词应包含全角标点规则');
    check(/先说结论,再说条件/.test(systemContent), '提示词应包含先结论后条件规则');
    check(/board => 开发板/.test(systemContent), '提示词应包含术语表');
    check(requests.every(r => /"file":/.test(r.user) && /"en":/.test(r.user)),
      '用户消息应包含文件路径与英文原文');

    const doc1 = JSON.parse(readFileSync(strings, 'utf8'));
    check(doc1.units.filter(u => u.zh.trim()).length === 26, '写回后应有 26 条非空译文');
    check(doc1.units.at(-1).zh === '已完成', '原有译文不应被改动');
    check(doc1.units.length === 26, '单元数量与顺序应保持');
    check(existsSync(cache), '成功翻译后应创建 cache.json');
    check(Object.keys(JSON.parse(readFileSync(cache, 'utf8')).entries).length === 25, '缓存应写入 25 条');
    check(!existsSync(failures), '成功时不应留下失败清单');
    console.log('ok 1/4: 正常 JSON、带解释文字、非法 JSON 重试');

    // --- 场景 2:缓存命中,不得联网 ---
    writeFileSync(strings, JSON.stringify(initialDoc, null, 2) + '\n', 'utf8');
    let unexpectedCalls = 0;
    const noFetch = async () => {
      unexpectedCalls++;
      throw new Error('缓存命中时不应联网');
    };
    const r2 = await run({
      argv: baseArgs,
      env: { DEEPSEEK_API_KEY: 'test-key' },
      fetchImpl: noFetch,
      log: quiet,
      logError: quiet,
    });
    check(r2.exitCode === 0, `缓存场景应退出 0,实际 ${r2.exitCode}`);
    check(r2.cacheHits === 25 && r2.apiCalls === 0, `应全部命中缓存,实际命中 ${r2.cacheHits}、调用 ${r2.apiCalls}`);
    check(unexpectedCalls === 0, '缓存命中时不应调用 fetch');
    console.log('ok 2/4: 缓存命中不联网');

    // --- 场景 3:非法 JSON 两次都失败 -> 退出 2 + 失败清单 ---
    const failDir = mkdtempSync(join(tmpdir(), 'zh-translate-selftest-fail-'));
    dirs.push(failDir);
    const strings2 = join(failDir, 'strings.json');
    const cache2 = join(failDir, 'cache.json');
    const glossary2 = join(failDir, 'glossary.json');
    const failures2 = join(failDir, 'translate-failures.json');
    writeFileSync(strings2, JSON.stringify({
      meta: {},
      units: [
        { file: 'src/a.rs', en: 'first failing message', zh: '', occ: 1 },
        { file: 'src/b.rs', en: 'second failing message', zh: '', occ: 1 },
      ],
    }, null, 2) + '\n', 'utf8');
    writeFileSync(glossary2, JSON.stringify({
      version: 'self-test-v1',
      terms: { board: '开发板' },
    }, null, 2) + '\n', 'utf8');

    let badCalls = 0;
    const badFetch = async () => {
      badCalls++;
      return new Response('这不是 JSON', { status: 200, headers: { 'content-type': 'text/plain' } });
    };
    const r3 = await run({
      argv: ['--strings', strings2, '--cache', cache2, '--glossary', glossary2, '--concurrency', '1'],
      env: { DEEPSEEK_API_KEY: 'test-key' },
      fetchImpl: badFetch,
      log: quiet,
      logError: quiet,
    });
    check(r3.exitCode === 2, `永久失败应退出 2,实际 ${r3.exitCode}`);
    check(badCalls === 2, `应调用 2 次(含一次重试),实际 ${badCalls}`);
    check(existsSync(failures2), '失败时应写 translate-failures.json');
    const failureDoc = JSON.parse(readFileSync(failures2, 'utf8'));
    check(failureDoc.failures.length === 2, '失败清单应包含 2 条');
    check(failureDoc.failures.every(f => typeof f.en === 'string' && f.en && typeof f.reason === 'string' && f.reason),
      '失败清单应包含 en 与 reason');
    const doc3 = JSON.parse(readFileSync(strings2, 'utf8'));
    check(doc3.units.every(u => u.zh === ''), '失败时不应写入译文');
    console.log('ok 3/4: 非法 JSON 二次失败 -> 退出 2 并写失败清单');

    // --- 场景 4:缺 DEEPSEEK_API_KEY -> 退出 1 ---
    const r4 = await run({
      argv: ['--strings', strings2, '--cache', join(failDir, 'cache2.json'), '--glossary', glossary2],
      env: {},
      fetchImpl: badFetch,
      log: quiet,
      logError: quiet,
    });
    check(r4.exitCode === 1, `缺 API key 应退出 1,实际 ${r4.exitCode}`);
    console.log('ok 4/4: 缺少 DEEPSEEK_API_KEY 时退出 1');

    return true;
  } finally {
    for (const dir of dirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    try {
      await selfTest();
      console.log('self-test ok');
      process.exitCode = 0;
    } catch (e) {
      console.error(`self-test 失败:${e?.stack ?? e}`);
      process.exitCode = 1;
    }
  } else {
    try {
      const summary = await run({ argv });
      process.exitCode = summary.exitCode;
    } catch (e) {
      console.error(`错误:${e?.message ?? e}`);
      process.exitCode = 1;
    }
  }
}
