#!/usr/bin/env node
/**
 * 生成 1503 本小说的静态 SEO 书页 book/{id}.html + 重新生成 sitemap.xml。
 *
 * 设计目标：让每本书拥有【独立、可被搜索引擎收录】的 URL，且页面源码里
 * 直接包含 书名/作者/分类/类型/简介/章节目录/正文试读 等纯文本内容，
 * 从而拿到来自「书名 + 章节 + 正文片段」的长尾被动搜索流量。
 *
 * - 基础生成（不带参数）：仅用 books.json 元数据，零网络依赖，瞬间完成。
 * - 富化（--fetch）：对 txt 类从 R2 拉取前 80KB（Range），解码后切章，
 *   提取章节标题 + 首章试读，写入书页；结果缓存在 book/_preview.json，
 *   失败优雅跳过（保留元数据版）。可重复运行，已缓存的不再抓网。
 *
 * 用法：
 *   node tools/build_book_pages.js            # 元数据版（基线，必跑）
 *   node tools/build_book_pages.js --fetch    # 富化 txt 正文/章节
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BOOKS_PATH = path.join(ROOT, 'books.json');
const OUT_DIR = path.join(ROOT, 'book');
const CACHE_PATH = path.join(OUT_DIR, '_preview.json');
const CAT_DIR = path.join(ROOT, 'category');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const SITE = 'https://xiaoshuo-5hn.pages.dev';
const R2_BASE = 'https://pub-0286f9f1305243479f676d853bc3c827.r2.dev/';

const DO_FETCH = process.argv.includes('--fetch');
const CONCURRENCY = 16;
const RANGE_BYTES = 80 * 1024; // 每本 txt 只取前 80KB：足够拿到开头章节标题 + 首章试读
const REQ_TIMEOUT = 20000;

// ---------- 章节切分（与 read.html 保持一致，移植到 Node） ----------
const CHAPTER_RE = /^\s*(?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章卷回部篇节集]|[Cc]hapter\s+\d+|序章|序言|前言|引言|后记|尾声|楔子|番外|[一二三四五六七八九十百千]+\s*[、﹑.．]|[（(][一二三四五六七八九十百千]+[)）]|\d+\s*[、.．])/;

function decode(buf) {
  const u8 = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) {}
  try { return new TextDecoder('gbk').decode(u8); } catch (e) {}
  return new TextDecoder('utf-8').decode(u8);
}

function splitChapters(text) {
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
  if (!res.length) res.push({ title: '全文', paras: lines.filter(l => l.trim()) });
  return { chapters: res, hasMarker };
}

// 取前 N 个字符的纯文本预览（去多余空白）
function plainPreview(text, n) {
  return text.replace(/\s+/g, ' ').trim().slice(0, n);
}

// ---------- 工具 ----------
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escAttr(s) { return esc(s).replace(/'/g, '&#39;'); }

// ---------- 读取书籍 ----------
const books = JSON.parse(fs.readFileSync(BOOKS_PATH, 'utf8'));
const byId = new Map(books.map(b => [String(b.id), b]));
// 同分类分组，用于「同类推荐」内链
const byCat = {};
for (const b of books) {
  (byCat[b.category] = byCat[b.category] || []).push(b);
}

function relatedBooks(book, n = 8) {
  const pool = (byCat[book.category] || []).filter(x => String(x.id) !== String(book.id));
  const picks = pool.slice(0, n);
  if (picks.length < n) {
    for (const x of books) {
      if (String(x.id) === String(book.id)) continue;
      if (picks.find(p => String(p.id) === String(x.id))) continue;
      if (x.category === book.category) continue;
      picks.push(x);
      if (picks.length >= n) break;
    }
  }
  return picks;
}

// ---------- 书页 HTML ----------
function bookPageHtml(book, preview) {
  const id = String(book.id);
  const title = book.title || ('书籍' + id);
  const author = book.author || '佚名';
  const category = book.category || '其他';
  const type = (book.type || '').toUpperCase();
  const intro = book.intro || '';

  const desc = (title + '，作者' + author + '，' + category + '类' + type +
    '电子书。' + (intro || '提供在线阅读、章节目录与正文试读。')).slice(0, 160);
  const keywords = [title, author, category, '在线阅读', '小说', type].filter(Boolean).join(',');

  const readUrl = '../read?id=' + encodeURIComponent(id) +
    '&u=' + encodeURIComponent(book.url || '') +
    '&t=' + encodeURIComponent(title);

  // 同类推荐内链（真实 <a>，搜索引擎可爬）
  const rel = relatedBooks(book, 8).map(r =>
    '<li><a href="./' + escAttr(String(r.id)) + '" class="rel-link">' +
    esc(r.title) + '</a> <span class="rel-meta">· ' + esc(r.author || '') + ' · ' + esc(r.category || '') + '</span></li>'
  ).join('');

  // 章节目录 + 试读
  let chapterSection = '';
  if (preview && preview.titles && preview.titles.length) {
    const lis = preview.titles.slice(0, 60).map((t, i) =>
      '<li><span class="ch-no">' + (i + 1) + '.</span> ' + esc(t) + '</li>'
    ).join('');
    chapterSection =
      '<section class="block"><h2 class="sec-title">章节目录</h2>' +
      '<ul class="ch-list">' + lis + '</ul>' +
      (preview.chapterCount ? '<p class="ch-count">全文共 ' + preview.chapterCount + ' 章（或自动分节）。</p>' : '') +
      '</section>';
  }
  let previewSection = '';
  if (preview && preview.first) {
    previewSection =
      '<section class="block"><h2 class="sec-title">正文试读</h2>' +
      '<div class="preview-text">' + esc(preview.first) + '…</div></section>';
  }

  const formatNote = (book.type === 'txt')
    ? 'TXT 格式，已自动切分章节，支持逐章阅读、进度记忆。'
    : (book.type === 'epub'
      ? 'EPUB 格式，支持翻页、字体调节与阅读进度同步。'
      : 'PDF 格式，浏览器内置预览阅读。');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: title,
    author: { '@type': 'Person', name: author },
    genre: category,
    bookFormat: 'EBook',
    inLanguage: 'zh-CN',
    url: SITE + '/book/' + id,
    description: desc
  };
  if (preview && preview.chapterCount) jsonLd.numberOfPages = preview.chapterCount;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)} - ${esc(author)} - 在线阅读 | 电子书库</title>
<meta name="description" content="${escAttr(desc)}" />
<meta name="keywords" content="${escAttr(keywords)}" />
<link rel="canonical" href="${SITE}/book/${id}" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  :root{ --bg:#0d0d0d; --card:#161616; --fg:#e5e5e5; --muted:#9a9a9a; --orange:#ff9500; --line:#262626; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.8}
  a{color:var(--orange);text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{max-width:820px;margin:0 auto;padding:24px 18px 60px}
  .crumb{font-size:13px;color:var(--muted);margin-bottom:18px}
  h1{font-size:26px;margin:0 0 6px}
  .sub{color:var(--muted);font-size:14px;margin-bottom:18px}
  .badge{display:inline-block;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:2px 10px;font-size:12px;margin-right:8px;color:#cfcfcf}
  .btn{display:inline-block;background:var(--orange);color:#111;font-weight:600;padding:12px 26px;border-radius:10px;margin:18px 0;font-size:15px}
  .block{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:18px 0}
  .sec-title{font-size:17px;margin:0 0 12px;color:#fff;border-left:3px solid var(--orange);padding-left:10px}
  .meta-row{font-size:14px;color:var(--muted);margin:4px 0}
  .meta-row b{color:#ddd;font-weight:600}
  .intro{font-size:15px;color:#cfcfcf;margin-top:6px}
  .ch-list{list-style:none;padding:0;margin:0;columns:2;column-gap:24px}
  .ch-list li{font-size:14px;color:#cfcfcf;padding:3px 0;break-inside:avoid}
  .ch-no{color:var(--orange);margin-right:4px}
  .ch-count{font-size:13px;color:var(--muted);margin-top:10px}
  .preview-text{font-size:15px;color:#d8d8d8;text-indent:2em;white-space:pre-wrap}
  .rel-list{list-style:none;padding:0;margin:0}
  .rel-list li{padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}
  .rel-meta{color:var(--muted);font-size:12px}
  .foot{margin-top:30px;font-size:13px;color:var(--muted);text-align:center}
  @media(max-width:600px){ .ch-list{columns:1} }
</style>
</head>
<body>
<div class="wrap">
  <div class="crumb"><a href="../">电子书库</a> &gt; <a href="../category/${catSlug(category)}">${esc(category)}</a> &gt; <span>${esc(title)}</span></div>

  <h1>${esc(title)}</h1>
  <div class="sub">
    <span class="badge">${esc(type)}</span>
    <span class="badge">${esc(category)}</span>
    ${book.hot ? '<span class="badge" style="color:var(--orange);border-color:var(--orange)">热门</span>' : ''}
  </div>

  <div class="meta-row"><b>作者：</b>${esc(author)}</div>
  <div class="meta-row"><b>分类：</b>${esc(category)}</div>
  <div class="meta-row"><b>格式：</b>${esc(type)}</div>
  ${intro ? '<div class="intro"><b>简介：</b>' + esc(intro) + '</div>' : ''}

  <a class="btn" href="${escAttr(readUrl)}">▶ 开始阅读</a>
  <p class="meta-row">${esc(formatNote)}</p>

  ${chapterSection}
  ${previewSection}

  <section class="block">
    <h2 class="sec-title">同类推荐</h2>
    <ul class="rel-list">${rel}</ul>
  </section>

  <div class="foot"><a href="../">返回电子书库首页</a> · 共 ${books.length} 本在线书库</div>
</div>
</body>
</html>`;
}

// ---------- 分类落地页（承接「XX小说在线阅读」类目级长尾） ----------
// 分类 → URL slug（与 index.html 的 CAT_IMG 保持一致）
const CAT_SLUG = {
  '全部': 'all', '都市激情': 'dushi', '校园之恋': 'xiaoyuan', '人妻熟女': 'renqi',
  '家庭乱伦': 'jiating', '经验故事': 'jingyan', '真实体验': 'zhenshi', '猎奇另类': 'lieqi',
  '短篇笑话': 'duanpian', '古典武侠': 'gudian', '91博客': 'blog91'
};
function catSlug(name) { return CAT_SLUG[name] || ('cat-' + Buffer.from(String(name || 'other')).toString('hex').slice(0, 8)); }

function categoryPageHtml(cat, list, allCats) {
  const n = list.length;
  const slug = catSlug(cat);
  const title = cat + '小说在线阅读_' + cat + '小说大全 - 电子书库';
  const desc = (cat + '小说在线阅读，本站收录 ' + n + ' 本' + cat + '类电子书，提供章节目录、正文试读与在线阅读。' +
    cat + '小说大全，按更新排序，免费在线看。').slice(0, 160);
  const keywords = [cat + '小说', cat + '小说在线阅读', cat + '小说大全', cat + '电子书', '在线阅读', '小说'].join(',');

  const bookLis = list.map(b =>
    '<li><a href="../book/' + escAttr(String(b.id)) + '">' + esc(b.title || ('书籍' + b.id)) + '</a>' +
    '<span class="bmeta"> · ' + esc(b.author || '佚名') + ' · ' + esc((b.type || '').toUpperCase()) + '</span></li>'
  ).join('');

  const other = allCats.filter(c => c !== cat).map(c =>
    '<a href="./' + escAttr(catSlug(c)) + '">' + esc(c) + '小说 (' + (byCat[c] || []).length + ')</a>'
  ).join('');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: cat + '小说在线阅读',
    description: desc,
    url: SITE + '/category/' + slug,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: n,
      itemListElement: list.slice(0, 50).map((b, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: { '@type': 'Book', name: b.title, url: SITE + '/book/' + b.id }
      }))
    }
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${escAttr(desc)}" />
<meta name="keywords" content="${escAttr(keywords)}" />
<link rel="canonical" href="${SITE}/category/${slug}" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  :root{ --bg:#0d0d0d; --card:#161616; --fg:#e5e5e5; --muted:#9a9a9a; --orange:#ff9500; --line:#262626; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7}
  a{color:var(--orange);text-decoration:none} a:hover{text-decoration:underline}
  .wrap{max-width:920px;margin:0 auto;padding:24px 18px 60px}
  .crumb{font-size:13px;color:var(--muted);margin-bottom:16px}
  h1{font-size:24px;margin:0 0 8px;color:#fff}
  h1 em{color:var(--orange);font-style:normal}
  .lead{font-size:14px;color:#c9c9c9;margin:0 0 20px}
  .block{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:18px 0}
  .sec-title{font-size:16px;margin:0 0 12px;color:#fff;border-left:3px solid var(--orange);padding-left:10px}
  .books{list-style:none;padding:0;margin:0;columns:2;column-gap:28px}
  .books li{font-size:14px;padding:4px 0;break-inside:avoid;border-bottom:1px solid var(--line)}
  .bmeta{color:var(--muted);font-size:12px}
  .cats a{display:inline-block;font-size:13px;padding:5px 10px;margin:0 6px 8px 0;background:var(--card);border:1px solid var(--line);border-radius:16px;color:#cfcfcf}
  .cats a:hover{border-color:var(--orange);color:var(--orange);text-decoration:none}
  .foot{margin-top:28px;font-size:13px;color:var(--muted);text-align:center}
  @media(max-width:640px){ .books{columns:1} }
</style>
</head>
<body>
<div class="wrap">
  <div class="crumb"><a href="../">电子书库</a> &gt; <span>${esc(cat)}</span></div>
  <h1><em>${esc(cat)}</em>小说在线阅读</h1>
  <p class="lead">${esc(desc)} 共收录 <strong style="color:var(--orange)">${n}</strong> 本${esc(cat)}小说，点击书名可查看详情、章节目录与正文试读。</p>

  <section class="block">
    <h2 class="sec-title">${esc(cat)}小说列表（共 ${n} 本）</h2>
    <ul class="books">${bookLis}</ul>
  </section>

  <section class="block">
    <h2 class="sec-title">其他分类</h2>
    <div class="cats">${other}</div>
  </section>

  <div class="foot"><a href="../">返回电子书库首页</a> · 全站共 ${books.length} 本在线小说</div>
</div>
</body>
</html>`;
}

function generateCategoryPages() {
  if (!fs.existsSync(CAT_DIR)) fs.mkdirSync(CAT_DIR, { recursive: true });
  const cats = Object.keys(byCat).filter(c => c && CAT_SLUG[c]);
  let ok = 0;
  for (const cat of cats) {
    const list = byCat[cat].slice().sort((a, b) => (b.id || 0) - (a.id || 0));
    fs.writeFileSync(path.join(CAT_DIR, catSlug(cat) + '.html'), categoryPageHtml(cat, list, cats), 'utf8');
    ok++;
  }
  return ok;
}

// ---------- 生成所有书页 ----------
function generatePages(previewMap) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  let ok = 0;
  for (const b of books) {
    const id = String(b.id);
    const preview = previewMap[id] || null;
    const html = bookPageHtml(b, preview);
    fs.writeFileSync(path.join(OUT_DIR, id + '.html'), html, 'utf8');
    ok++;
  }
  return ok;
}

// ---------- 重新生成 sitemap.xml（含全部书页） ----------
function writeSitemap() {
  const urls = [];
  urls.push({ loc: SITE + '/', priority: '1.0', freq: 'weekly' });
  urls.push({ loc: SITE + '/read', priority: '0.8', freq: 'weekly' });
  urls.push({ loc: SITE + '/404.html', priority: '0.3', freq: 'yearly' });
  // 分类落地页（类目级长尾入口，优先级高于单本书）
  for (const cat of Object.keys(byCat).filter(c => c && CAT_SLUG[c])) {
    urls.push({ loc: SITE + '/category/' + catSlug(cat), priority: '0.8', freq: 'weekly' });
  }
  for (const b of books) {
    urls.push({ loc: SITE + '/book/' + String(b.id), priority: '0.6', freq: 'weekly' });
  }
  const body = urls.map(u =>
    '  <url>\n    <loc>' + u.loc + '</loc>\n    <changefreq>' + u.freq + '</changefreq>\n    <priority>' + u.priority + '</priority>\n  </url>'
  ).join('\n');
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + '\n</urlset>\n';
  fs.writeFileSync(SITEMAP_PATH, xml, 'utf8');
  return urls.length;
}

// ---------- 网络富化（--fetch） ----------
function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch (e) { return {}; }
}
function saveCache(map) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(map), 'utf8');
}

async function fetchPreview(book) {
  const url = R2_BASE + (book.url || '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT);
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-' + (RANGE_BYTES - 1) }, signal: ctrl.signal });
    if (!r.ok && r.status !== 206) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    const text = decode(buf);
    const { chapters, hasMarker } = splitChapters(text);
    const titles = chapters.slice(0, 60).map(c => c.title);
    const first = chapters[0] ? plainPreview(chapters[0].paras.join('\n'), 800) : '';
    const chapterCount = hasMarker ? chapters.length : Math.max(1, Math.ceil(plainPreview(text, 1e9).length / 2000));
    return { titles, first, chapterCount };
  } finally {
    clearTimeout(timer);
  }
}

async function enrich() {
  const cache = loadCache();
  const todo = books.filter(b => b.type === 'txt' && !cache[String(b.id)]);
  console.log('[fetch] 待抓取 txt 书页数：' + todo.length + '（已缓存 ' + Object.keys(cache).length + '）');
  let done = 0, fail = 0;
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const b = todo[i++];
      try {
        const p = await fetchPreview(b);
        cache[String(b.id)] = p;
        done++;
      } catch (e) {
        fail++;
        if (fail <= 10) console.warn('  抓取失败 id=' + b.id + ' ' + (b.title || '') + ' : ' + e.message);
      }
      if ((done + fail) % 50 === 0) {
        saveCache(cache);
        console.log('  进度 ' + (done + fail) + '/' + todo.length + '  成功 ' + done + ' 失败 ' + fail);
      }
    }
  }
  const workers = [];
  for (let w = 0; w < CONCURRENCY; w++) workers.push(worker());
  await Promise.all(workers);
  saveCache(cache);
  console.log('[fetch] 完成：成功 ' + done + '，失败 ' + fail);
  return cache;
}

// ---------- 主流程 ----------
(async () => {
  let previewMap = loadCache();
  if (DO_FETCH) {
    previewMap = await enrich();
  } else if (Object.keys(previewMap).length) {
    console.log('[info] 检测到已有预览缓存 ' + Object.keys(previewMap).length + ' 条，将直接用于书页（加 --fetch 可补充）。');
  }
  const nPages = generatePages(previewMap);
  const nCats = generateCategoryPages();
  const nSitemap = writeSitemap();
  console.log('[done] 生成书页 ' + nPages + ' 个，分类落地页 ' + nCats + ' 个，sitemap URL 数 ' + nSitemap + '。');
})();
