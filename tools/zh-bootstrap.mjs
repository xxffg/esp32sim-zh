// 从「当前已汉化的工作树 vs HEAD(上游)」反向生成 zh/strings.json。
// 用法: node tools/zh-bootstrap.mjs <repo> [outFile]
// 说明: 只处理 git diff 里已修改的文件;新增文件(如 docs/zh)不属于翻译单元,由 overlay 处理。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const repo = resolve(process.argv[2] ?? '.');
const outFile = resolve(process.argv[3] ?? join(repo, 'zh', 'strings.json'));

const lf = s => s.replace(/\r\n/g, '\n');
const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

// 行级 LCS 差异,返回 {i, del, add}:i 是本段删除内容在 pristine 里的起始行号
function diffLines(a, b) {
  const n = a.length; const m = b.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j]
        ? dp[at(i + 1, j + 1)] + 1
        : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }
  const hunks = [];
  let i0 = 0; let del = []; let add = [];
  const flush = () => { if (del.length || add.length) { hunks.push({ i: i0, del, add }); del = []; add = []; } };
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { flush(); i++; j++; }
    else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) { if (!del.length && !add.length) i0 = i; del.push(a[i++]); }
    else { if (!del.length && !add.length) i0 = i; add.push(b[j++]); }
  }
  while (i < n) { if (!del.length && !add.length) i0 = i; del.push(a[i++]); }
  while (j < m) { if (!del.length && !add.length) i0 = i; add.push(b[j++]); }
  flush();
  return hunks;
}

const changed = git(['diff', '--name-only']).split('\n').map(s => s.trim()).filter(Boolean);
if (changed.length === 0) { console.error('没有改动,无法引导:先在工作树里完成汉化'); process.exit(2); }

const units = [];
const stats = [];

for (const file of changed) {
  let pristine;
  try { pristine = lf(git(['show', `HEAD:${file}`])); } catch { continue; }
  const current = lf(readFileSync(join(repo, file), 'utf8'));
  if (pristine === current) continue;

  const pl = pristine.split('\n');
  const offsets = [0];
  for (let k = 0; k < pl.length; k++) offsets.push(offsets[k] + pl[k].length + 1);

  let fileUnits = 0;
  for (const h of diffLines(pl, current.split('\n'))) {
    if (h.del.length === h.add.length) {
      for (let k = 0; k < h.del.length; k++) {
        if (h.del[k] === h.add[k]) continue;
        if (!h.del[k].trim()) continue;                       // 纯空行不译
        units.push({ file, en: h.del[k], zh: h.add[k], pos: offsets[h.i + k] ?? 0 });
        fileUnits++;
      }
    } else {
      const en = h.del.join('\n'); const zh = h.add.join('\n');
      if (en !== zh && en.trim()) { units.push({ file, en, zh, pos: offsets[h.i] ?? 0 }); fileUnits++; }
    }
  }
  stats.push({ file, units: fileUnits, pristine });
}

// 同一文件里同样的 en 可能出现多次(例如各芯片表格里的同名标签),
// 按出现顺序编号 occ,apply-zh 取第 occ 次出现替换。
const counters = new Map();
const uniq = units.map(u => {
  const k = u.file + '\u0000' + u.en;
  const n = (counters.get(k) ?? 0) + 1;
  counters.set(k, n);
  return { file: u.file, en: u.en, zh: u.zh, occ: n };
});

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({
  meta: {
    generator: 'tools/zh-bootstrap.mjs',
    upstream: 'HEAD',
    count: uniq.length,
    note: 'en/zh 为精确文本(多行用 \\n 连接);en 唯一时唯一匹配,occ 表示取第几次出现',
  },
  units: uniq,
}, null, 2) + '\n', 'utf8');

const dup = uniq.filter(u => u.occ > 1).length;
console.log(`写入 ${outFile}`);
console.log(`文件 ${stats.length} 个,翻译单元 ${uniq.length} 条(其中 ${dup} 条用 occ 消歧)`);
for (const s of stats.sort((x, y) => y.units - x.units)) console.log(`  ${String(s.units).padStart(4)}  ${s.file}`);
