// 发现上游新增、但 zh/strings.json 里还没有的可见英文文案。
// 用法:
//   node tools/zh-discover.mjs                 # 只报告
//   node tools/zh-discover.mjs --write         # 追加为待译单元(zh 为空,交给 zh-translate)
//   node tools/zh-discover.mjs --json          # 机器可读
//
// 设计取舍:宁少勿多。只扫白名单文件,只认"整行就是一段文案"的行,
// 这样 apply-zh 能按行精确替换;认不准的 JS 文案不自动抓,列为提示。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = f => args.includes(f);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };

const stringsPath = join(ROOT, opt('strings', 'zh/strings.json'));

// 只扫这些文件:HTML 文案 + CLI 里的用户可见字符串
const HTML_FILES = ['web/index.html', 'web/run.html'];
const RUST_FILES = ['cli/src/lib.rs', 'cli/src/camera.rs', 'esp-soc/src/elf.rs', 'esp-soc/src/image.rs', 'esp-soc/src/load.rs'];

const strings = JSON.parse(readFileSync(stringsPath, 'utf8'));
const covered = new Set();
for (const u of strings.units) for (const line of String(u.en).split('\n')) covered.add(line.trim());

const CJK = /[\u4e00-\u9fff]/;
const WORD = /[A-Za-z]{2,}/;

function looksLikeProse(s) {
  const t = s.trim();
  if (t.length < 8 || t.length > 400) return false;
  if (!WORD.test(t)) return false;
  if (/^(https?:|\/\/)/.test(t)) return false;
  if (/^(const|let|var|function|return|import|export|use |pub |fn |impl |struct |enum |match |if |for |while )\b/.test(t)) return false;
  if (/[{};]$/.test(t) && !/[.!?]$/.test(t)) return false;      // 代码行
  return true;
}

// HTML:取出标签之间的文字
function htmlTextCandidates(line) {
  const out = [];
  const re = />([^<>]{1,400})</g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const text = m[1];
    if (!WORD.test(text)) continue;
    if (!looksLikeProse(text)) continue;
    out.push(text.trim());
  }
  return out;
}

// Rust:只认 eprintln!/println!/usage_error/format! 里的字符串字面量
function rustTextCandidates(line) {
  if (/\[(emu|irq|net|board|ble|pwm|adc|cooja|cosim|c6|c3|coproc)\]/.test(line)) return [];  // 运行时报告行不译
  if (!/(eprintln!\(|println!\(|usage_error\()/.test(line)) return [];
  const out = [];
  const re = /"((?:[^"\\]|\\.){4,400})"/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const text = m[1];
    if (!WORD.test(text)) continue;
    if (/^[-\w.\/]+$/.test(text)) continue;           // 路径、标识符
    if (/^https?:/.test(text)) continue;
    if (!looksLikeProse(text)) continue;
    out.push(text);
  }
  return out;
}

const found = [];
for (const rel of HTML_FILES) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) continue;
  const lines = readFileSync(p, 'utf8').split('\n');
  let inScript = false;
  let inPre = false;
  lines.forEach((line, i) => {
    if (/<script\b/i.test(line)) inScript = true;
    if (/<\/script>/i.test(line)) { inScript = false; return; }
    if (inScript) return;                                   // 页面内联 JS 不是文案
    if (/<pre\b/i.test(line)) inPre = true;
    if (/<\/pre>/i.test(line)) { inPre = false; return; }
    if (inPre) return;                                      // 终端输出/代码示例不是文案
    if (covered.has(line.trim())) return;                   // 整行已译
    const texts = htmlTextCandidates(line);
    if (texts.length === 0) return;
    const joined = texts.join(' ');
    if (covered.has(joined)) return;
    found.push({ file: rel, line: i + 1, en: line.trim(), kind: 'html' });
  });
}

for (const rel of RUST_FILES) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) continue;
  const lines = readFileSync(p, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const texts = rustTextCandidates(line);
    if (texts.length === 0) return;
    if (covered.has(line.trim())) return;
    found.push({ file: rel, line: i + 1, en: line.trim(), kind: 'rust' });
  });
}

// 去重
const seen = new Set();
const uniq = found.filter(f => { const k = f.file + '\u0000' + f.en; if (seen.has(k)) return false; seen.add(k); return true; });

if (has('--json')) {
  console.log(JSON.stringify({ count: uniq.length, items: uniq }, null, 2));
} else {
  console.log(`发现 ${uniq.length} 条尚未翻译的可见文案(已覆盖 ${covered.size} 行)`);
  const byFile = new Map();
  for (const f of uniq) { if (!byFile.has(f.file)) byFile.set(f.file, []); byFile.get(f.file).push(f); }
  for (const [file, list] of byFile) {
    console.log(`\n${file}(${list.length} 条)`);
    for (const f of list.slice(0, 12)) console.log(`  L${f.line}: ${f.en.slice(0, 90)}`);
    if (list.length > 12) console.log(`  ... 其余 ${list.length - 12} 条`);
  }
}

if (has('--write')) {
  let added = 0;
  for (const f of uniq) {
    // 按整行写入:apply-zh 按行替换,粒度与 bootstrap 生成的一致
    const line = readFileSync(join(ROOT, f.file), 'utf8').split('\n')[f.line - 1].trim();
    if (covered.has(line)) continue;
    strings.units.push({ file: f.file, en: line, zh: '', discovered: true });
    covered.add(line);
    added++;
  }
  if (added === 0) {
    console.log('\n没有新增单元,strings.json 保持不变');
  } else {
    strings.meta.count = strings.units.length;
    writeFileSync(stringsPath, JSON.stringify(strings, null, 2) + '\n', 'utf8');
    console.log(`\n已写入 ${added} 条待译单元(zh 为空,等 zh-translate 填)`);
  }
}
