#!/usr/bin/env node
/**
 * generate_promo.js — 从 books.json 生成站内推荐数据 + IndexNow 推送清单
 *
 * 只产出数据，不向任何外部平台发送内容。
 *
 * 输出：promo/out.json
 *   - books:        本次选中的书（已过滤），供站内推荐位消费
 *   - indexnowUrls: 本次要推送给 Bing/Yandex 的 URL（纯技术收录）
 *
 * 合规过滤（不可关闭）：
 *   1) 分类白名单：只从相对通用的分类里选，高危分类整体排除
 *   2) 标题黑名单：命中未成年人相关信号的书直接排除
 *   3) 测试书 / 无有效 URL 的书排除
 *   4) 若本地存在 book/chapters/*.json，再做一次正文开头扫描过滤
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://shenye.72tool.com';
const OUT_DIR = path.join(ROOT, 'promo');
const OUT_FILE = path.join(OUT_DIR, 'out.json');

// ---------- 合规过滤规则 ----------
// 只从这些分类里选书；其它分类（含家庭乱伦/校园之恋/猎奇另类/91博客）一律不推荐
const SAFE_CATEGORIES = new Set(['都市激情', '真实体验', '人妻熟女', '经验故事', '古典武侠']);

// 未成年人题材信号（标题层）。宁可错杀，不可漏放。
const MINOR_RE = new RegExp(
  '(未成年|蘿莉|罗莉|蘿榛|正太|幼女|幼童|雛女|雏女|小學生|小学生|國中|国中|' +
  '初中生|高中生|高中|中學生|中学生|少年|少女|小孩|男童|女童|' +
  '未滿|未满|[0-9]{1,2}[岁嵗]|幼|懵懂|蓓蕾|养成|養成)',
  'i'
);

// 明显测试/占位条目
const TEST_RE = /(测试|測試|test|占位|示例|placeholder)/i;

function buildBodyBlocklist() {
  const dir = path.join(ROOT, 'book', 'chapters');
  let files = [];
  try { files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : []; }
  catch (_) { return new Set(); }
  const blocked = new Set();
  for (const f of files) {
    const id = Number(path.basename(f, '.json'));
    if (!Number.isFinite(id)) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      // 只取前 4000 字符，降低开销；命中即排除整本
      if (MINOR_RE.test(raw.slice(0, 4000))) blocked.add(id);
    } catch (_) { /* 读取失败不阻塞 */ }
  }
  return blocked;
}

// ---------- 稳定伪随机：按 UTC 日期轮换选题，避免每次推同一批 ----------
function seededIndex(seed, len) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % Math.max(1, len);
}

function pickDaily(cands, dayKey, count) {
  const out = [];
  const used = new Set();
  let cursor = seededIndex(dayKey, cands.length);
  const stride = Math.max(1, Math.floor(cands.length / count));
  for (let i = 0; i < count && cands.length; i++) {
    let idx = (cursor + i * stride + seededIndex(dayKey + '#' + i, cands.length)) % cands.length;
    let guard = 0;
    while (used.has(idx) && guard++ < cands.length) idx = (idx + 1) % cands.length;
    used.add(idx);
    out.push(cands[idx]);
  }
  return out;
}

function blurb(book) {
  if (book.intro && book.intro.length > 8 && !TEST_RE.test(book.intro)) {
    return book.intro.replace(/\s+/g, ' ').slice(0, 90);
  }
  const who = book.author ? `${book.author} 著，` : '';
  return `${who}${book.category}题材，深夜文库提供完整章节目录与免费在线试读`;
}

function main() {
  const books = JSON.parse(fs.readFileSync(path.join(ROOT, 'books.json'), 'utf8'));
  const bodyBlocked = buildBodyBlocklist();

  const stats = { total: books.length, byCategory: 0, byTitle: 0, byBody: 0, byTest: 0, kept: 0 };
  const candidates = [];

  for (const b of books) {
    if (!SAFE_CATEGORIES.has(b.category)) { stats.byCategory++; continue; }
    if (MINOR_RE.test(b.title) || MINOR_RE.test(b.author || '')) { stats.byTitle++; continue; }
    if (TEST_RE.test(b.title) || !b.url || !/^book\//.test(b.url)) { stats.byTest++; continue; }
    if (bodyBlocked.has(Number(b.id))) { stats.byBody++; continue; }
    candidates.push(b);
  }
  stats.kept = candidates.length;

  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10); // UTC 日期，同一天多次运行结果一致
  const count = Math.min(3, candidates.length);
  const picked = pickDaily(candidates, dayKey, count);

  const outBooks = picked.map(b => ({
    id: b.id,
    title: b.title,
    author: b.author || '',
    category: b.category,
    bookUrl: `${SITE}/book/${b.id}`,
    firstChapterUrl: `${SITE}/chapter/${b.id}/1`,
    blurb: blurb(b)
  }));

  // IndexNow 只推少量高价值 URL，不做 11 万章全量推送
  const indexnowUrls = [SITE + '/', SITE + '/sitemap-main.xml'];
  for (const b of outBooks) {
    indexnowUrls.push(b.bookUrl, b.firstChapterUrl);
  }

  const result = {
    generatedAt: now.toISOString(),
    dayKey,
    site: SITE,
    filterStats: stats,
    books: outBooks,
    indexnowUrls: [...new Set(indexnowUrls)]
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), 'utf8');

  console.log('[generate_promo] 过滤统计:', JSON.stringify(stats));
  console.log('[generate_promo] 本次选中:', outBooks.map(b => `${b.id}:${b.title}`).join(' | ') || '(无)');
  console.log('[generate_promo] 输出:', path.relative(ROOT, OUT_FILE));
  console.log('[generate_promo] IndexNow URL 数:', result.indexnowUrls.length);
}

main();
