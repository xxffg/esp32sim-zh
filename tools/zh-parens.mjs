// 把半角括号转成全角,但**只动用户可见文本**:
//   - .js  : 只处理字符串字面量与模板字符串内部
//   - .html: <script> 块按 JS 规则处理,其余部分(正文、属性值)整段处理
// 用法: node tools/zh-parens.mjs <file> [...]
import { readFileSync, writeFileSync } from 'node:fs';

const convert = s => s.replace(/\(([^()]*[\u4e00-\u9fff][^()]*)\)/g, '（$1）');

function fixJs(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      let buf = '';
      while (j < text.length) {
        if (text[j] === '\\') { buf += text[j] + text[j + 1]; j += 2; continue; }
        if (text[j] === quote) break;
        buf += text[j]; j++;
      }
      out += quote + convert(buf) + quote;
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      const k = end < 0 ? text.length : end;
      out += text.slice(i, k); i = k;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const k = end < 0 ? text.length : end + 2;
      out += text.slice(i, k); i = k;
    } else {
      out += ch; i++;
    }
  }
  return out;
}

function fixHtml(text) {
  let out = '';
  let i = 0;
  const re = /<script\b(?![^>]*\bsrc=)[^>]*>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += convert(text.slice(i, m.index));
    const bodyStart = m.index + m[0].length;
    const close = text.indexOf('</script>', bodyStart);
    const bodyEnd = close < 0 ? text.length : close;
    out += m[0] + fixJs(text.slice(bodyStart, bodyEnd)) + (close < 0 ? '' : '</script>');
    i = close < 0 ? text.length : close + '</script>'.length;
    re.lastIndex = i;
  }
  out += convert(text.slice(i));
  return out;
}

for (const f of process.argv.slice(2)) {
  const text = readFileSync(f, 'utf8');
  const fixed = f.endsWith('.js') ? fixJs(text) : fixHtml(text);
  const n = (text.match(/\([^()]*[\u4e00-\u9fff][^()]*\)/g) ?? []).length;
  writeFileSync(f, fixed, 'utf8');
  console.log(`${n} 处  ${f}`);
}
