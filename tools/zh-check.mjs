#!/usr/bin/env node
// 汉化质量门禁:对 zh/strings.json 的每条译文做确定性检查。
// 为什么独立成脚本:构建期 apply-zh.mjs 只保证锚点命中,不判断译文质量;
// CI 需要一个人在环之外也能复现的"红/绿"信号,所以这里只依赖 node 内置模块。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_MAX_SENTENCE = 40;

const CHECK_ORDER = { C1: 1, C2: 2, C3: 3, C4: 4, C5: 5, C6: 6, C7: 7, C8: 8, C9: 9 };

// 汉字后误用半角标点是中文排版里最常见的毛病,给出对应的全角字符方便直接改。
const HALF_PUNCT = new Map([
  [',', { name: '半角逗号', full: '，' }],
  [';', { name: '半角分号', full: '；' }],
  [':', { name: '半角冒号', full: '：' }],
  [')', { name: '半角右括号', full: '）' }],
]);

// 只认这些汉字区段,避免把日文假名或全角符号算进"汉字数"。
const HAN_SOURCE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/gu;
const HAN_AFTER_HALF_PUNCT = /([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF])([,;:)])/g;

// 占位符只取题目列出的几种形态:{}、{0}、{name}、%s、%d。
// 只从“中文文本”里取,所以代码里的普通花括号块不会参与比较;\{ \} 与 {{ }} 按转义忽略。
const PLACEHOLDER_RE = /(?<!\\)\{[A-Za-z0-9_]*\}|%[sd]/g;

// 双引号、单引号、反引号三种字符串字面量;捕获组里是字面量内容。
// 模板字符串的反引号也在这里识别,但它只用于“取文本”,不再当作 C5 的受保护代码。
const LITERAL_RE = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

// 控制字符允许换行和制表符(多行翻译单元的正常内容),其余和 U+FFFD 都算坏字符。
const BAD_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD]/gu;

const CODE_TOKEN_RULES = [
  { kind: 'URL', re: /https?:\/\/[^\s`"'）)]+/g, group: 0 },
  { kind: '参数名', re: /(?<![\w-])--[a-z0-9][a-z0-9-]*/g, group: 0 },
];

// 反引号只在 Markdown 文档里代表“受保护的行内代码”;JS 模板字符串不算。
const BACKTICK_RULE = { kind: '反引号代码', re: /`([^`]+)`/g, group: 1 };

const HELP = `用法：node tools/zh-check.mjs [选项]

检查 zh/strings.json 里的中文译文，有 error 时退出码为 1。
  C1  zh 为空或只有空白                          error
  C2  汉字后紧跟半角 , ; : )                     error
  C3  单句汉字数超过 --max-sentence              error
  C4  en/zh 的占位符数量或顺序不一致             error
  C5  反引号代码、URL、--flag 没有原样保留       error
  C6  zh 里出现术语表的 banned 词                error
  C7  en 出现术语，zh 既没译也没保留原词         warning
  C8  zh 里有控制字符或 U+FFFD                   error
  C9  同文件里相同 en 对应不同 zh                warning
  C10 标题结尾标点                               跳过（要求里明确不做）

单元先按“代码骨架”分类：骨架相同算 text，查 C1–C9；骨架不同算 code，
只查 C1/C8，不拿占位符或代码保护去判译文（那是 apply-zh 的职责）。

选项：
  --strings PATH     翻译单元清单，默认 zh/strings.json
  --glossary PATH    术语表，默认 zh/glossary.json
  --max-sentence N   单句汉字上限，默认 ${DEFAULT_MAX_SENTENCE}
  --json             输出 JSON，便于 CI 消费
  -h, --help         显示本帮助

退出码：0 没有 error；1 有 error；2 参数或输入文件有问题。`;

class UsageError extends Error {}

/** 解析命令行。用法错误统一抛 UsageError,由 main 映射到退出码 2。 */
function parseArgs(argv) {
  const opts = {
    strings: 'zh/strings.json',
    glossary: 'zh/glossary.json',
    maxSentence: DEFAULT_MAX_SENTENCE,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }

    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(0, eq) : arg;
    if (name !== '--strings' && name !== '--glossary' && name !== '--max-sentence') {
      throw new UsageError(`未知参数“${arg}”（用 --help 看用法）`);
    }

    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined || value === '') throw new UsageError(`${name} 缺少参数值`);

    if (name === '--strings') opts.strings = value;
    else if (name === '--glossary') opts.glossary = value;
    else {
      // 阈值必须是正整数;0 或 NaN 会让 C3 失去意义,直接当用法错误。
      if (!/^\d+$/.test(value) || Number(value) < 1) {
        throw new UsageError(`--max-sentence 需要正整数，收到“${value}”`);
      }
      opts.maxSentence = Number(value);
    }
  }
  return opts;
}

/** 读 JSON 并保留"哪个文件坏了"的上下文,方便 CI 日志定位。 */
function readJson(file, label) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    throw new UsageError(`${label}读不到：${file}（${e.code ?? e.message}）`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new UsageError(`${label}不是合法 JSON：${file}\n${e.message}`);
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 整词、区分大小写匹配:术语表要求的就是这个语义。 */
function wholeWordRe(word) {
  return new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(word)}(?![A-Za-z0-9_])`);
}

function isMarkdownFile(file) {
  return /\.(md|mdx|markdown)$/i.test(String(file ?? ''));
}

function isHtmlFile(file) {
  return /\.(html?|xhtml)$/i.test(String(file ?? ''));
}

/** 把字符串字面量内容抹成 S,保留代码结构;用于判断 en/zh 是否只是文字不同。 */
function replaceQuoted(text) {
  return String(text ?? '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '"S"')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'S'")
    .replace(/`(?:[^`\\]|\\.)*`/g, '`S`');
}

function codeSkeleton(text) {
  return replaceQuoted(text);
}

/**
 * HTML 的正文是用户可见文案:把标签之间的文字抹成 T、保留标签本身,
 * 这样 <p>中文</p> 与 <p>English</p> 骨架相同,归为 text。
 * 属性值(alt/title/content 等)也被 replaceQuoted 抹成 S,属于文案而非结构。
 * 不含 HTML 标签的行(例如 .html 里的 <script> JS)退回普通代码骨架。
 */
function htmlSkeleton(text) {
  const original = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const quoted = replaceQuoted(original);
  if (!/<[a-zA-Z!/][^>]*>/.test(original)) return quoted;
  return quoted
    .split(/(<[^>]*>)/)
    .map(part => (part.startsWith('<') ? part : 'T'))
    .join('');
}

/**
 * 单元粒度是“被改动的整行源码”,不是纯字符串,所以先分类:
 * 骨架相同 -> text,继续做文案检查;骨架不同 -> code,说明代码结构被重构,
 * 不拿占位符/代码保护去判译文(那是 apply-zh 的职责)。
 * HTML 正文单独骨架化:正文变化仍算 text,增删/改动标签才算 code。
 */
function classifyUnit(unit) {
  const en = unit.en;
  const zh = typeof unit.zh === 'string' ? unit.zh : '';
  if (isMarkdownFile(unit.file)) return 'text';
  if (isHtmlFile(unit.file)) {
    return htmlSkeleton(en) === htmlSkeleton(zh) ? 'text' : 'code';
  }
  // 没有字符串字面量/标签的单元没有可判的代码骨架(纯文本/纯说明),按 text 处理。
  if (!/["'`<]/.test(en)) return 'text';
  return codeSkeleton(en) === codeSkeleton(zh) ? 'text' : 'code';
}

function stripTags(text) {
  return String(text ?? '').replace(/<[^>]+>/g, '\n');
}

/** script/style 里的 JS/CSS 由字符串字面量分支覆盖,这里只要真正的 HTML 文字节点。 */
function htmlTextNodes(text) {
  const withoutBlocks = String(text ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '\n');
  return stripTags(withoutBlocks);
}

/**
 * 取出真正要审的中文文本:
 * - Markdown: 去掉 HTML 标签后的正文(反引号是行内代码,不当作字符串字面量);
 * - 含字符串字面量的代码/HTML: 所有字面量内容,HTML 再额外加上文字节点;
 * - 纯文本: 去掉标签后的全文。
 * 片段之间用换行连接,这样 C3 不会把同一行里多个短字符串拼成假长句。
 */
function extractText(text, file) {
  if (typeof text !== 'string' || !text) return '';
  if (isMarkdownFile(file)) return stripTags(text);

  const parts = [];
  for (const match of text.matchAll(LITERAL_RE)) {
    parts.push(match[1] ?? match[2] ?? match[3]);
  }
  if (isHtmlFile(file) && /<[a-zA-Z!/][^>]*>/.test(text)) parts.push(htmlTextNodes(text));
  return parts.length > 0 ? parts.join('\n') : stripTags(text);
}

/** 术语表结构不对时宁可报错,也不要悄悄少查一批词。 */
function loadGlossary(file) {
  const data = readJson(file, '术语表');
  if (!data || typeof data !== 'object' || !data.terms || typeof data.terms !== 'object' || Array.isArray(data.terms)) {
    throw new UsageError(`术语表缺少 terms 对象：${file}`);
  }

  const terms = [];
  for (const [en, zh] of Object.entries(data.terms)) {
    if (!en.trim() || typeof zh !== 'string' || !zh.trim()) {
      throw new UsageError(`术语表条目无效：${JSON.stringify(en)} -> ${JSON.stringify(zh)}`);
    }
    terms.push({ en, zh, enRe: wholeWordRe(en), zhEnRe: wholeWordRe(en) });
  }

  const banned = [];
  if (data.banned !== undefined) {
    if (!Array.isArray(data.banned)) throw new UsageError(`术语表的 banned 必须是数组：${file}`);
    data.banned.forEach((entry, i) => {
      if (!entry || typeof entry.zh !== 'string' || !entry.zh.trim()) {
        throw new UsageError(`术语表 banned 第 ${i + 1} 条缺少 zh 字段`);
      }
      banned.push({ zh: entry.zh, use: typeof entry.use === 'string' ? entry.use : '' });
    });
  }

  // keep 是给译者的保留词政策,门禁不据此判错;这里做一次清洗以便未来复用。
  const keep = Array.isArray(data.keep) ? data.keep.filter(k => typeof k === 'string' && k.trim()) : [];
  return { terms, banned, keep };
}

/** 清单条目只做最小归一:缺 en/zh 的条目留给 C1 等检查去报,而不是在这里崩溃。 */
function loadUnits(file) {
  const data = readJson(file, '翻译清单');
  if (!data || !Array.isArray(data.units)) {
    throw new UsageError(`翻译清单缺少 units 数组：${file}`);
  }
  return data.units.map((unit, i) => {
    if (!unit || typeof unit !== 'object') {
      throw new UsageError(`翻译清单第 ${i + 1} 条不是对象`);
    }
    return {
      file: typeof unit.file === 'string' && unit.file ? unit.file : '(未注明文件)',
      en: typeof unit.en === 'string' ? unit.en : '',
      zh: unit.zh,
      occ: unit.occ,
    };
  });
}

function makeFinding(check, level, unit, index, reason) {
  return {
    check,
    level,
    file: unit.file,
    unit: index + 1,
    en: unit.en,
    zh: typeof unit.zh === 'string' ? unit.zh : '',
    reason,
  };
}

function countHan(text) {
  return (text.match(HAN_SOURCE) || []).length;
}

/** 输出里的英文/中文片段压成一行,否则多行代码会把报告撑散。 */
function snippet(text, max = 72) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '（空）';
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function formatTokens(tokens) {
  if (tokens.length === 0) return '无';
  const head = tokens.slice(0, 8).join('、');
  return tokens.length > 8 ? `${head}…` : head;
}

/** C1:空译文没有任何审查价值,必须先挡住。 */
function checkC1(unit, index) {
  if (typeof unit.zh !== 'string') {
    return [makeFinding('C1', 'error', unit, index, 'zh 缺失或不是字符串')];
  }
  if (unit.zh.trim() === '') {
    return [makeFinding('C1', 'error', unit, index, 'zh 为空或只有空白')];
  }
  return [];
}

/** C2:汉字后紧跟半角 , ; : ) 时给出应改成的全角字符;只审中文文本片段。 */
function checkC2(unit, index, zhText) {
  if (!zhText) return [];
  const matches = [...zhText.matchAll(HAN_AFTER_HALF_PUNCT)];
  if (matches.length === 0) return [];
  const [han, punct] = [matches[0][1], matches[0][2]];
  const { name, full } = HALF_PUNCT.get(punct);
  const more = matches.length > 1 ? `（共 ${matches.length} 处）` : '';
  return [makeFinding('C2', 'error', unit, index, `汉字“${han}”后紧跟${name}“${punct}”，应改用全角“${full}”${more}`)];
}

/** C3:按 。！？； 和换行切句,逐句数汉字;只看中文文本片段。 */
function checkC3(unit, index, maxSentence, zhText) {
  if (!zhText) return [];
  const findings = [];
  const sentences = zhText.split(/[。！？；\n]+/);
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    if (!sentence) continue;
    const n = countHan(sentence);
    if (n <= maxSentence) continue;
    findings.push(makeFinding('C3', 'error', unit, index,
      `第 ${i + 1} 句有 ${n} 个汉字，超过上限 ${maxSentence}：${snippet(sentence, 40)}`));
  }
  return findings;
}

/** C4:占位符既要比数量也要比顺序;只从中文文本里提取,并忽略 \{ \} 与 {{ }} 转义。 */
function checkC4(unit, index, enText, zhText) {
  const en = placeholders(enText);
  const zh = placeholders(zhText);
  if (en.length === zh.length && en.every((token, i) => token === zh[i])) return [];

  let reason;
  if (en.length === zh.length) {
    const i = en.findIndex((token, k) => token !== zh[k]);
    reason = `第 ${i + 1} 个占位符不一致：en 为 ${en[i]}，zh 为 ${zh[i]}`;
  } else {
    reason = `占位符数量不一致：en ${en.length} 个 [${formatTokens(en)}]，zh ${zh.length} 个 [${formatTokens(zh)}]`;
  }
  return [makeFinding('C4', 'error', unit, index, reason)];
}

function placeholders(text) {
  const cleaned = String(text ?? '')
    .replace(/\{\{|\}\}/g, '')
    .replace(/\\[{}]/g, '');
  return [...cleaned.matchAll(PLACEHOLDER_RE)].map(match => match[0]);
}

/** C5:把 en 里的"不可翻译片段"当成合同,zh 必须逐字保留。 */
function checkC5(unit, index) {
  if (typeof unit.zh !== 'string') return [];
  // 反引号只保护 Markdown 行内代码;JS 模板字符串是代码语法,不是受保护文本。
  const rules = isMarkdownFile(unit.file)
    ? [BACKTICK_RULE, ...CODE_TOKEN_RULES]
    : CODE_TOKEN_RULES;
  const findings = [];
  for (const { kind, token } of extractCodeTokens(unit.en, rules)) {
    // 参数名按整词查,避免 --wifi 被 --wifi-sta 假命中。
    const kept = kind === '参数名' ? containsWholeWord(unit.zh, token) : unit.zh.includes(token);
    if (!kept) {
      findings.push(makeFinding('C5', 'error', unit, index, `en 里的${kind}“${snippet(token, 120)}”没有原样出现在 zh 里`));
    }
  }
  return findings;
}

function extractCodeTokens(text, rules) {
  const tokens = [];
  const seen = new Set();
  for (const rule of rules) {
    for (const match of String(text ?? '').matchAll(rule.re)) {
      const token = match[rule.group];
      if (!token || !token.trim()) continue;
      const key = `${rule.kind}\u0000${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push({ kind: rule.kind, token });
    }
  }
  return tokens;
}

function containsWholeWord(text, word) {
  return wholeWordRe(word).test(text);
}

/** C6:banned 是明确的错译/禁用词,只在中文文本里出现即 error。 */
function checkC6(unit, index, banned, zhText) {
  if (!zhText) return [];
  return banned
    .filter(entry => zhText.includes(entry.zh))
    .map(entry => makeFinding('C6', 'error', unit, index,
      `使用了禁用词“${entry.zh}”，应改用“${entry.use || '更合适的译法'}”`));
}

/** C7:只警告,因为术语可能有语序/量词变化;en/zh 都只看各自的文本片段,避免代码标识符干扰。 */
function checkC7(unit, index, terms, enText, zhText) {
  if (!enText || !zhText) return [];
  const findings = [];
  for (const term of terms) {
    if (!term.enRe.test(enText)) continue;
    if (zhText.includes(term.zh) || term.zhEnRe.test(zhText)) continue;
    findings.push(makeFinding('C7', 'warning', unit, index,
      `en 出现术语“${term.en}”，zh 里既没有“${term.zh}”也没有保留“${term.en}”`));
  }
  return findings;
}

/** C8:控制字符通常意味着复制粘贴污染,U+FFFD 则说明编码时已经丢字。 */
function checkC8(unit, index) {
  if (typeof unit.zh !== 'string' || !unit.zh) return [];
  const matches = [...unit.zh.matchAll(BAD_CHAR_RE)];
  if (matches.length === 0) return [];
  const cp = matches[0][0].codePointAt(0);
  const label = cp === 0xFFFD
    ? '替换字符 U+FFFD（编码时已经丢了字）'
    : `控制字符 U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  const more = matches.length > 1 ? `（共 ${matches.length} 处）` : '';
  return [makeFinding('C8', 'error', unit, index, `zh 里有${label}${more}`)];
}

/** C9:同一文件里相同的英文应只有一种译法;只比较 text 单元,code 单元本来就不该逐字对应。 */
function checkC9(units, classifications) {
  const groups = new Map();
  units.forEach((unit, index) => {
    if (!unit.en) return;
    if (classifications[index] !== 'text') return;
    const key = `${unit.file}\u0000${unit.en}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ index, zh: typeof unit.zh === 'string' ? unit.zh : '' });
  });

  const findings = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (new Set(group.map(item => item.zh)).size < 2) continue;
    const others = group.slice(1).map(item => `#${item.index + 1}`).join('、');
    const first = group[0];
    findings.push(makeFinding('C9', 'warning', units[first.index], first.index,
      `同一文件里相同的 en 对应了不同的 zh（另见 ${others}）`));
  }
  return findings;
}

function runChecks(units, classifications, glossary, maxSentence) {
  const findings = [];
  units.forEach((unit, index) => {
    const kind = classifications[index];
    // C1/C8 与结构无关,text 与 code 都查。
    const unitFindings = [...checkC1(unit, index), ...checkC8(unit, index)];

    if (kind === 'text') {
      const enText = extractText(unit.en, unit.file);
      const zhText = extractText(unit.zh, unit.file);
      unitFindings.push(
        ...checkC2(unit, index, zhText),
        ...checkC3(unit, index, maxSentence, zhText),
        ...checkC4(unit, index, enText, zhText),
        ...checkC5(unit, index),
        ...checkC6(unit, index, glossary.banned, zhText),
        ...checkC7(unit, index, glossary.terms, enText, zhText),
      );
    }

    for (const finding of unitFindings) finding.kind = kind;
    findings.push(...unitFindings);
  });

  const duplicates = checkC9(units, classifications);
  for (const finding of duplicates) finding.kind = 'text';
  findings.push(...duplicates);
  return findings;
}

/** 按文件聚合,保持 strings.json 里的文件出现顺序;文件内按单元号和检查编号排。 */
function groupByFile(units, findings) {
  const fileOrder = new Map();
  units.forEach(unit => {
    if (!fileOrder.has(unit.file)) fileOrder.set(unit.file, fileOrder.size);
  });

  const byFile = new Map();
  for (const finding of findings) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, []);
    byFile.get(finding.file).push(finding);
  }

  return [...byFile.entries()]
    .map(([file, list]) => ({
      file,
      findings: list.slice().sort((a, b) => a.unit - b.unit || CHECK_ORDER[a.check] - CHECK_ORDER[b.check]),
      errors: list.filter(item => item.level === 'error').length,
      warnings: list.filter(item => item.level === 'warning').length,
    }))
    .sort((a, b) => (fileOrder.get(a.file) ?? 0) - (fileOrder.get(b.file) ?? 0));
}

function printHuman({ stringsFile, glossaryFile, maxSentence, units, textUnits, codeUnits, files, errors, warnings }) {
  console.log(`zh-check：${stringsFile}（${units.length} 条翻译单元，术语表 ${glossaryFile}，单句上限 ${maxSentence} 个汉字）`);
  console.log(`文本单元 ${textUnits} 条、代码单元 ${codeUnits} 条（代码单元不参与质量判定）`);
  console.log('');
  if (files.length === 0) {
    console.log('未发现问题。');
    console.log('');
  }

  for (const group of files) {
    console.log(`${group.file}（错误 ${group.errors}，警告 ${group.warnings}）`);
    for (const finding of group.findings) {
      const level = finding.level === 'error' ? '错误' : '警告';
      console.log(`  [${level}] ${finding.check} #${finding.unit} 「${snippet(finding.en)}」 ${finding.reason}`);
    }
    console.log('');
  }
  console.log(`错误 ${errors} 条，警告 ${warnings} 条，共 ${units.length} 条翻译单元`);
}

function buildJson({ stringsFile, glossaryFile, maxSentence, units, textUnits, codeUnits, files, findings, errors, warnings }) {
  return {
    ok: errors === 0,
    strings: stringsFile,
    glossary: glossaryFile,
    maxSentence,
    summary: { errors, warnings, units: units.length, textUnits, codeUnits },
    files: files.map(group => ({ file: group.file, errors: group.errors, warnings: group.warnings })),
    findings,
  };
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`zh-check：${e.message}`);
    process.exitCode = 2;
    return;
  }

  if (opts.help) {
    console.log(HELP);
    return;
  }

  const stringsPath = resolve(opts.strings);
  const glossaryPath = resolve(opts.glossary);

  try {
    const glossary = loadGlossary(glossaryPath);
    const units = loadUnits(stringsPath);
    const classifications = units.map(unit => classifyUnit(unit));
    const findings = runChecks(units, classifications, glossary, opts.maxSentence);
    const files = groupByFile(units, findings);
    const errors = findings.filter(finding => finding.level === 'error').length;
    const warnings = findings.length - errors;
    const textUnits = classifications.filter(kind => kind === 'text').length;
    const codeUnits = classifications.length - textUnits;
    // 报告里用命令行给的相对路径，比 resolve 后的绝对路径更适合贴进 CI 日志。
    const report = {
      stringsFile: opts.strings,
      glossaryFile: opts.glossary,
      maxSentence: opts.maxSentence,
      units,
      textUnits,
      codeUnits,
      files,
      findings,
      errors,
      warnings,
    };

    if (opts.json) console.log(JSON.stringify(buildJson(report), null, 2));
    else printHuman(report);

    // 用 exitCode 而不是 process.exit:管道里的 stdout 不会被截断。
    process.exitCode = errors > 0 ? 1 : 0;
  } catch (e) {
    if (opts.json) console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
    else console.error(`zh-check：${e.message}`);
    process.exitCode = 2;
  }
}

main();
