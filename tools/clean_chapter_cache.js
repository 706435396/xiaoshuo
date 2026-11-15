#!/usr/bin/env node
// 就地清洗 book/chapters/*.json 中正文/标题里的非法控制字符（NUL、0x1A 等 C0 控制符）。
// 这些字符来自 GBK 解码残留，会导致 HTML 被识别为二进制。无需重新下载。
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'book', 'chapters');

function clean(s) { return String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); }

if (!fs.existsSync(DIR)) { console.log('无缓存目录'); process.exit(0); }
const files = fs.readdirSync(DIR).filter(f => /^\d+\.json$/.test(f));
let fixed = 0;
for (const f of files) {
  const p = path.join(DIR, f);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    // 解析后逐字段清洗（比正则替换原始 JSON 更可靠）
    const d = JSON.parse(raw);
    let changed = false;
    if (d.chapters && Array.isArray(d.chapters)) {
      for (const c of d.chapters) {
        const nt = clean(c.title), nx = clean(c.text);
        if (nt !== c.title) { c.title = nt; changed = true; }
        if (nx !== c.text) { c.text = nx; changed = true; }
      }
    }
    if (changed) {
      fs.writeFileSync(p, JSON.stringify(d), 'utf8');
      fixed++;
    }
  } catch (e) { /* 跳过损坏文件 */ }
}
console.log('[clean] 检查 ' + files.length + ' 个文件，清洗 ' + fixed + ' 个。');
