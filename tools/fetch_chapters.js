#!/usr/bin/env node
/**
 * 抓取 R2 全本 txt，切分章节后缓存到 book/_chapters.json。
 * 供 build_book_pages.js 生成「每章独立可抓 URL」的静态章节页。
 *
 * 切章逻辑与 read.html 保持一致：
 *  - 有真实章节标记（第X章/序章/一、/（一）/1. 等）→ 按标题切
 *  - 全篇无标记（纯流水）→ 按约 2000 字自动分块
 *
 * 特性：并发抓取、可中断续跑（已缓存跳过）、失败优雅跳过、gzip 自动解压。
 *
 * 用法：
 *   node tools/fetch_chapters.js --limit 20   # 小样本验证
 *   node tools/fetch_chapters.js              # 全量
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BOOKS_PATH = path.join(ROOT, 'books.json');
const CACHE_DIR = path.join(ROOT, 'book', 'chapters');  // 每本一个 json 文件，避免单文件超 512MB 上限
const R2_BASE = 'https://pub-0286f9f1305243479f676d853bc3c827.r2.dev/';

const CONCURRENCY = 16;
const REQ_TIMEOUT = 30000;
const AUTO_CHUNK_SIZE = 2000;
const argLimitIdx = process.argv.indexOf('--limit');
const LIMIT = argLimitIdx >= 0 ? parseInt(process.argv[argLimitIdx + 1], 10) : 0;

// 与 read.html / build_book_pages.js 完全一致的章节正则
const CHAPTER_RE = /^\s*(?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章卷回部篇节集]|[Cc]hapter\s+\d+|序章|序言|前言|引言|后记|尾声|楔子|番外|[一二三四五六七八九十百千]+\s*[、﹑.．]|[（(][一二三四五六七八九十百千]+[)）]|\d+\s*[、.．])/;

// 清洗文本中的非法控制字符（NUL、0x1A、其他 C0 控制符），保留 \n \r \t
function cleanText(s) {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function decode(buf) {
  const u8 = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let s;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
  catch (e) { try { s = new TextDecoder('gbk').decode(u8); } catch (e2) { s = new TextDecoder('utf-8').decode(u8); } }
  return cleanText(s);
}

function splitByMarker(text) {
  const lines = text.split(/\r?\n/);
  const res = [];
  let cur = null, hasMarker = false;
  for (const line of lines) {
    if (CHAPTER_RE.test(line)) {
      hasMarker = true;
      if (cur) res.push(cur);
      cur = { title: (line.trim().slice(0, 40)) || ('第' + (res.length + 1) + '节'), paras: [] };
    } else {
      if (!cur) cur = { title: '正文', paras: [] };
      if (line.trim()) cur.paras.push(line.trim());
    }
  }
  if (cur) res.push(cur);
  return { chapters: res, hasMarker };
}

function autoChunk(text, size) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let buf = [], count = 0;
  function flush() {
    if (buf.length) { chunks.push({ title: '第 ' + (chunks.length + 1) + ' 段', paras: buf }); buf = []; count = 0; }
  }
  for (let raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (t.length > size) {
      flush();
      for (let i = 0; i < t.length; i += size) { buf = [t.slice(i, i + size)]; flush(); }
      continue;
    }
    if (count > 0 && count + t.length > size) flush();
    buf.push(t); count += t.length;
  }
  flush();
  if (!chunks.length) chunks.push({ title: '全文', paras: lines.filter(l => l.trim()) });
  return chunks;
}

function buildChapters(text) {
  const { chapters, hasMarker } = splitByMarker(text);
  const usable = chapters.filter(c => c.paras.length);
  if (hasMarker && usable.length > 1) {
    return { chapters: usable, hasMarker: true };
  }
  return { chapters: autoChunk(text, AUTO_CHUNK_SIZE), hasMarker: false };
}

function cacheFile(id) { return path.join(CACHE_DIR, String(id) + '.json'); }
function hasCache(id) { return fs.existsSync(cacheFile(id)); }
function saveCache(id, data) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const f = cacheFile(id), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, f);
}

async function fetchBook(book) {
  const url = R2_BASE + (book.url || '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    const text = decode(buf);
    const { chapters, hasMarker } = buildChapters(text);
    const out = chapters.map(c => ({ title: c.title, text: c.paras.join('\n') }));
    return {
      chapters: out,
      chapterCount: out.length,
      wordCount: text.replace(/\s/g, '').length,
      hasMarker
    };
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const books = JSON.parse(fs.readFileSync(BOOKS_PATH, 'utf8'));
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  let todo = books.filter(b => b.type === 'txt' && !hasCache(b.id));
  // id=3 是占位示例书（R2 无真实文件，404），跳过
  todo = todo.filter(b => String(b.id) !== '3');
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);
  const cachedCount = books.filter(b => hasCache(b.id)).length;

  console.log('[fetch_chapters] 待抓取：' + todo.length + ' 本（已缓存 ' + cachedCount + ' 本）');
  let done = 0, fail = 0, i = 0;
  const started = Date.now();

  async function worker() {
    while (i < todo.length) {
      const b = todo[i++];
      try {
        const data = await fetchBook(b);
        saveCache(b.id, data);
        done++;
      } catch (e) {
        fail++;
        if (fail <= 15) console.warn('  失败 id=' + b.id + ' ' + (b.title || '') + ' : ' + e.message);
      }
      const processed = done + fail;
      if (processed % 50 === 0) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0);
        console.log('  进度 ' + processed + '/' + todo.length + '  成功 ' + done + ' 失败 ' + fail + ' (' + elapsed + 's)');
      }
    }
  }

  const workers = [];
  for (let w = 0; w < CONCURRENCY; w++) workers.push(worker());
  await Promise.all(workers);

  // 汇总（只读每个小文件的元信息，不载入正文到内存）
  let totalCh = 0, totalBooks = 0;
  for (const b of books) {
    if (!hasCache(b.id)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(cacheFile(b.id), 'utf8'));
      totalCh += d.chapterCount || 0; totalBooks++;
    } catch (e) {}
  }
  console.log('[fetch_chapters] 完成：本次成功 ' + done + '，失败 ' + fail +
    '；缓存总计 ' + totalBooks + ' 本 / ' + totalCh + ' 章');
})();
