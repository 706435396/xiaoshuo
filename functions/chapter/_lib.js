// 章节页共享逻辑：读取书籍元数据、抓取 R2 全本、切章、生成 SEO HTML。
// 运行环境：Cloudflare Pages Functions（Workers 运行时，无 Node Buffer）。
// 用 Cache API 缓存 books.json 与 R2 原文，避免每章请求重复下载整本。

const R2_BASE = 'https://pub-0286f9f1305243479f676d853bc3c827.r2.dev/';
const SITE = 'https://shenye.72tool.com';

// 与 read.html 完全一致的章节正则
const CHAPTER_RE = /^\s*(?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章卷回部篇节集]|[Cc]hapter\s+\d+|序章|序言|前言|引言|后记|尾声|楔子|番外|[一二三四五六七八九十百千]+\s*[、﹑.．]|[（(][一二三四五六七八九十百千]+[)）]|\d+\s*[、.．])/;
const AUTO_CHUNK_SIZE = 2000;

function cleanText(s) { return String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); }

function decode(buf) {
  const u8 = new Uint8Array(buf);
  let s;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
  catch (e) { try { s = new TextDecoder('gbk').decode(u8); } catch (e2) { s = new TextDecoder('utf-8').decode(u8); } }
  return cleanText(s);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escAttr(s) { return esc(s).replace(/'/g, '&#39;'); }

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
  function flush() { if (buf.length) { chunks.push({ title: '第 ' + (chunks.length + 1) + ' 段', paras: buf }); buf = []; count = 0; } }
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
  const toOut = cs => cs.map(c => ({ title: c.title, text: c.paras.join('\n') }));
  const usable = chapters.filter(c => c.paras.length);
  if (hasMarker && usable.length > 1) return { chapters: toOut(usable), hasMarker: true };
  return { chapters: toOut(autoChunk(text, AUTO_CHUNK_SIZE)), hasMarker: false };
}

// 读自身站点的 books.json，用 Cache API 缓存（静态文件，不触发函数循环）
async function getBooks(request, ctx) {
  const url = new URL('/books.json', request.url);
  const cache = caches.default;
  let res = await cache.match(url);
  if (!res) {
    res = await fetch(url.toString());
    if (res.ok) {
      const copy = new Response(res.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
      ctx.waitUntil(cache.put(url, copy.clone()));
      res = copy;
    }
  }
  return res.json();
}

// 抓 R2 全本 txt，Cache API 缓存原文
async function getBookText(book, ctx) {
  const url = R2_BASE + (book.url || '');
  const cacheKey = new URL(url);
  const cache = caches.default;
  let res = await cache.match(cacheKey);
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error('R2 HTTP ' + res.status);
    const copy = new Response(res.body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=604800' } });
    ctx.waitUntil(cache.put(cacheKey, copy.clone()));
    res = copy;
  }
  return decode(await res.arrayBuffer());
}

const CAT_SLUG = {
  '全部': 'all', '都市激情': 'dushi', '校园之恋': 'xiaoyuan', '人妻熟女': 'renqi',
  '家庭乱伦': 'jiating', '经验故事': 'jingyan', '真实体验': 'zhenshi', '猎奇另类': 'lieqi',
  '短篇笑话': 'duanpian', '古典武侠': 'gudian', '91博客': 'blog91'
};
function catSlug(name) { return CAT_SLUG[name] || ('cat-' + String(name || 'other').slice(0, 8)); }

function pageShell({ title, description, keywords, canonical, ld, body }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${escAttr(description)}" />
<meta name="keywords" content="${escAttr(keywords)}" />
<meta name="rating" content="adult" />
<link rel="canonical" href="${escAttr(canonical)}" />
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script src="/ads.js" defer></script>
<style>
  :root{ --bg:#0d0d0d; --card:#161616; --fg:#e5e5e5; --muted:#9a9a9a; --orange:#ff9500; --line:#262626; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:2}
  a{color:var(--orange);text-decoration:none} a:hover{text-decoration:underline}
  .wrap{max-width:820px;margin:0 auto;padding:24px 18px 60px}
  .crumb{font-size:13px;color:var(--muted);margin-bottom:18px}
  h1{font-size:22px;margin:0 0 4px;line-height:1.5}
  .booktitle{font-size:13px;color:var(--muted);margin-bottom:20px}
  .content{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;font-size:17px;color:#e0e0e0;white-space:pre-wrap;word-break:break-word}
  .nav{display:flex;gap:10px;justify-content:space-between;align-items:center;margin:22px 0;flex-wrap:wrap}
  .nav a{display:inline-block;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:9px 16px;font-size:14px}
  .nav a.dis{opacity:.35;pointer-events:none}
  .nav .toc{background:transparent;border-color:var(--orange);color:var(--orange)}
  .chapters{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:20px 0}
  .chapters h2{font-size:15px;margin:0 0 12px;color:#fff;border-left:3px solid var(--orange);padding-left:10px}
  .ch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
  .ch-grid a{font-size:13px;color:#cfcfcf;padding:3px 0;display:block}
  .ch-grid a.cur{color:var(--orange);font-weight:600}
  .foot{margin-top:28px;font-size:13px;color:var(--muted);text-align:center;line-height:1.9}
</style>
</head>
<body>
<div class="wrap">
${body}
</div>
<footer style="text-align:center;font-size:12px;color:#777;padding:0 18px 30px;line-height:1.9">
  <a href="/privacy">隐私政策</a> · <a href="/dmca">版权投诉</a> · <a href="/report">内容举报/审核</a><br />
  <span>本站仅面向成年读者，请勿传播侵权内容。品牌口号：每一个夜晚，都有一个值得读完的故事。</span>
</footer>
<script src="/agegate.js" defer></script>
<!-- 广告：Adsterra（解析期写入，必须同步加载，勿加 defer/async） -->
<script src="/adboot.js"></script>
<script src="/adfoot.js"></script>
</body>
</html>`;
}

function chapterHtml(book, chapters, idx) {
  const id = String(book.id);
  const bookTitle = book.title || ('书籍' + id);
  const author = book.author || '佚名';
  const category = book.category || '其他';
  const ch = chapters[idx];
  const chTitle = ch.title || ('第 ' + (idx + 1) + ' 章');
  const n = idx + 1;
  const total = chapters.length;

  const title = bookTitle + ' ' + chTitle + ' 在线阅读 - 第' + n + '章 | 深夜文库';
  const description = (bookTitle + '（' + author + '）' + chTitle + '，' + category + '类小说第' + n + '章（共' + total + '章）在线阅读。').slice(0, 160);
  const keywords = [bookTitle, author, chTitle, bookTitle + ' 第' + n + '章', category + '小说', '在线阅读'].filter(Boolean).join(',');
  const canonical = SITE + '/chapter/' + id + '/' + n;

  const prev = idx > 0 ? '<a href="/chapter/' + id + '/' + (idx) + '">‹ 上一章</a>' : '<a class="dis">‹ 上一章</a>';
  const next = idx < total - 1 ? '<a href="/chapter/' + id + '/' + (idx + 2) + '">下一章 ›</a>' : '<a class="dis">下一章 ›</a>';

  // 章节目录（全部章，当前章高亮）
  const chLinks = chapters.map((c, i) =>
    '<a href="/chapter/' + id + '/' + (i + 1) + '"' + (i === idx ? ' class="cur"' : '') + '>' +
    (i + 1) + '. ' + esc(c.title) + '</a>'
  ).join('');

  const bodyText = ch.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Chapter',
    name: chTitle,
    numberOfPages: 1,
    inLanguage: 'zh-CN',
    url: canonical,
    isPartOf: {
      '@type': 'Book',
      name: bookTitle,
      author: { '@type': 'Person', name: author },
      genre: category,
      url: SITE + '/book/' + id
    }
  };

  const body =
    '<div class="crumb"><a href="/">深夜文库</a> &gt; <a href="/category/' + escAttr(catSlug(category)) + '">' + esc(category) + '</a> &gt; ' +
    '<a href="/book/' + escAttr(id) + '">' + esc(bookTitle) + '</a> &gt; <span>第' + n + '章</span></div>' +
    '<h1>' + esc(chTitle) + '</h1>' +
    '<div class="booktitle">《' + esc(bookTitle) + '》 · ' + esc(author) + ' · 第 ' + n + ' / ' + total + ' 章</div>' +
    '<div data-ad-slot="content-top" style="margin:14px 0;text-align:center"></div>' +
    '<div class="content">' + bodyText + '</div>' +
    '<div data-ad-slot="content-bottom" style="margin:18px 0;text-align:center"></div>' +
    '<div class="nav">' + prev + '<a class="toc" href="/book/' + escAttr(id) + '">作品详情 / 目录</a>' + next + '</div>' +
    '<section class="chapters"><h2>《' + esc(bookTitle) + '》章节目录</h2><div class="ch-grid">' + chLinks + '</div></section>' +
    '<div class="foot"><a href="/">返回深夜文库首页</a> · 共 ' + total + ' 章<br />本站仅作书籍索引，请支持正版。</div>';

  return pageShell({ title, description, keywords, canonical, ld, body });
}

export { getBooks, getBookText, buildChapters, chapterHtml, esc };
