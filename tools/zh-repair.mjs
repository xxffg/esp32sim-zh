// 上游合并后,清掉「英文原文已经不存在」的翻译单元。
// 作用:上游改了某行英文时,旧单元会变成死锚点,导致 apply-zh 整体失败;
//       先删掉它们,zh-discover 会把新英文重新捡回来,zh-translate 再翻。
// 用法: node tools/zh-repair.mjs [--root <仓库>] [--strings zh/strings.json] [--dry-run]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : join(dirname(fileURLToPath(import.meta.url)), '..'));
const stringsArg = process.argv.includes('--strings')
  ? process.argv[process.argv.indexOf('--strings') + 1]
  : 'zh/strings.json';
const stringsPath = join(ROOT, stringsArg);
const dryRun = process.argv.includes('--dry-run');

const data = JSON.parse(readFileSync(stringsPath, 'utf8'));
const files = new Map();
const read = p => {
  if (!files.has(p)) {
    const full = join(ROOT, p);
    files.set(p, existsSync(full) ? readFileSync(full, 'utf8').replace(/\r\n/g, '\n') : null);
  }
  return files.get(p);
};

const kept = [];
const dropped = [];
for (const u of data.units) {
  const text = read(u.file);
  if (text === null) { dropped.push({ ...u, why: '文件不存在' }); continue; }
  if (text.includes(u.en)) { kept.push(u); continue; }
  dropped.push({ ...u, why: '英文原文已不在文件里' });
}

console.log(`单元 ${data.units.length} 条:保留 ${kept.length},失效 ${dropped.length}`);
for (const d of dropped.slice(0, 15)) {
  console.log(`  - ${d.file}: ${String(d.en).split('\n')[0].slice(0, 70)}`);
}
if (dropped.length > 15) console.log(`  ... 其余 ${dropped.length - 15} 条`);

if (dryRun) { console.log('--dry-run,未写入'); process.exit(0); }
if (dropped.length === 0) { console.log('没有失效单元,strings.json 保持不变'); process.exit(0); }

data.units = kept;
data.meta.count = kept.length;
writeFileSync(stringsPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`已写回 ${stringsPath}(删掉 ${dropped.length} 条失效单元,等 discover 重新捡回新英文)`);
