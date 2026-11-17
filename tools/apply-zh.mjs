// 模式 B 的构建期替换:把上游源码复制成 build-src,再按 zh/strings.json 精确替换译文。
// 用法: node tools/apply-zh.mjs --upstream <上游目录> --out <build-src> [--strings zh/strings.json]
// 约定: 每条 unit 的 en 必须在目标文件里恰好出现 1 次;0 次(锚点失配)或多次(歧义)都算失败。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};

const upstream = resolve(arg('upstream', '.'));
const out = resolve(arg('out', 'build-src'));
const stringsFile = resolve(arg('strings', join(upstream, 'zh', 'strings.json')));
const overlay = resolve(arg('overlay', join(upstream, 'zh', 'overlay')));

const skip = new Set(['.git', 'target', 'node_modules', 'build-src', '.build', 'dist', 'out']);

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (skip.has(name)) continue;
    const src = join(from, name); const dst = join(to, name);
    const st = statSync(src);
    if (st.isDirectory()) copyTree(src, dst);
    else if (st.isFile()) copyFileSync(src, dst);
  }
}

console.log(`上游: ${upstream}`);
console.log(`输出: ${out}`);
console.log('复制源码树 ...');
copyTree(upstream, out);

const { units } = JSON.parse(readFileSync(stringsFile, 'utf8'));
console.log(`翻译单元: ${units.length} 条`);

const cache = new Map();
const read = p => {
  // 统一成 LF:git archive 在 core.autocrlf=true 时会带 CRLF,而 unit 的 en/zh 是 LF
  if (!cache.has(p)) cache.set(p, readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
  return cache.get(p);
};
const write = (p, s) => { cache.set(p, s); };

const failures = [];
let applied = 0;

// 同一个 en 出现多次时按 occ 从大到小处理,避免"替换掉第一次之后编号错位"
const byFile = new Map();
for (const u of units) {
  if (!byFile.has(u.file)) byFile.set(u.file, []);
  byFile.get(u.file).push(u);
}

for (const [file, list] of byFile) {
  list.sort((a, b) => (b.occ ?? 1) - (a.occ ?? 1));
  const path = join(out, file);
  for (const unit of list) {
    let text;
    try { text = read(path); }
    catch { failures.push({ ...unit, reason: '找不到文件' }); continue; }

    const occ = unit.occ ?? 1;
    let idx = -1; let from = 0;
    for (let k = 0; k < occ; k++) {
      idx = text.indexOf(unit.en, from);
      if (idx < 0) break;
      from = idx + unit.en.length;
    }
    if (idx < 0) { failures.push({ ...unit, reason: `锚点失配(找不到第 ${occ} 次出现)` }); continue; }

    write(path, text.slice(0, idx) + unit.zh + text.slice(idx + unit.en.length));
    applied++;
  }
}

// 代码增补(不是翻译):在唯一锚点之后插入固定文本
const insertsFile = join(dirname(stringsFile), 'inserts.json');
if (statSync(stringsFile).isFile() && (() => { try { return statSync(insertsFile).isFile(); } catch { return false; } })()) {
  const inserts = JSON.parse(readFileSync(insertsFile, 'utf8')).units ?? [];
  console.log(`插入单元: ${inserts.length} 条(来自 ${insertsFile})`);
  for (const ins of inserts) {
    const path = join(out, ins.file);
    const text = read(path);
    const at = text.indexOf(ins.after);
    if (at < 0) { failures.push({ file: ins.file, en: ins.after, reason: '插入锚点失配' }); continue; }
    if (text.indexOf(ins.after, at + 1) >= 0) { failures.push({ file: ins.file, en: ins.after, reason: '插入锚点不唯一' }); continue; }
    const cut = at + ins.after.length;
    write(path, text.slice(0, cut) + ins.text + text.slice(cut));
    applied++;
  }
}

for (const [p, s] of cache) {
  let original = '';
  try { original = readFileSync(join(upstream, relative(out, p)), 'utf8').replace(/\r\n/g, '\n'); } catch { /* 新文件 */ }
  if (s !== original) writeFileSync(p, s, 'utf8');
}

if (overlay && (() => { try { return statSync(overlay).isDirectory(); } catch { return false; } })()) {
  console.log('复制 overlay ...');
  copyTree(overlay, out);
}

console.log(`\n替换成功 ${applied} / ${units.length}`);
if (failures.length) {
  console.error(`失败 ${failures.length} 条:`);
  for (const f of failures.slice(0, 40)) {
    const head = f.en.split('\n')[0].slice(0, 80);
    console.error(`  [${f.reason}] ${f.file}: ${head}`);
  }
  if (failures.length > 40) console.error(`  ... 其余 ${failures.length - 40} 条省略`);
  writeFileSync(join(out, 'zh-failures.json'), JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log('全部命中,可以用 build-src 编译了。');
