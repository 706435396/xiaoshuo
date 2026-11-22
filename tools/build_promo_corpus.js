#!/usr/bin/env node
/**
 * build_promo_corpus.js — 生成 30 本代表性小说的中英文推广文案库
 *
 * 用途：为 X（Twitter）自动化引流准备第一批测试文案，输出 promo/x-corpus.json。
 * 每行 = 一本书 × 一种内容角度（推荐 / 悬念 / 英文发现 / 全免费+账户），
 * 字段对齐方案里的 Posts 工作表，可直接导入 Google Sheets 或 n8n。
 *
 * 合规（沿用站内 generate_promo.js 的规则，不可关闭）：
 *   1) 分类白名单：只从 SAFE_CATEGORIES 选，高危分类整体排除
 *   2) 未成年人信号：标题/作者命中即排除
 *   3) 测试书/无 URL 排除
 *   4) 正文开头含未成年人信号或广告引流的书排除
 *   5) 文案本身不含露骨描写，只做剧情/人物/悬念层推荐
 *
 * 简介来源：books.json 的 intro 全是占位，真实剧情在 book/chapters/<id>.json 的第 2 章起。
 * 只取中性片段做钩子，不复制正文到推文。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://shenye.72tool.com';
const OUT = path.join(ROOT, 'promo', 'x-corpus.json');
const COUNT = 30;

const SAFE_CATEGORIES = new Set(['都市激情', '真实体验', '人妻熟女', '经验故事', '古典武侠']);
const MINOR_RE = new RegExp(
  '(未成年|蘿莉|罗莉|正太|幼女|幼童|雛女|雏女|小學生|小学生|國中|国中|' +
  '初中生|高中生|高中|中學生|中学生|少年|少女|小孩|男童|女童|' +
  '未滿|未满|[0-9]{1,2}[岁嵗]|幼|懵懂|蓓蕾|养成|養成)', 'i');
const TEST_RE = /(测试|測試|test|占位|示例|placeholder)/i;
// 正文里的引流广告信号（ Telegram/Telegram群/其他站 ）——这类书不推广
const AD_RE = /(Telegram|t\.me\/|QQ群|微信群|加群|免费入群|搜索 @|其他网站|禁忌书屋)/i;
// 书名/文案层露骨词：命中则整本排除，避免推文出现直白成人词汇
const EROTIC_RE = /(淫|姦|奸|性交|做爱|猛干|抽插|高潮|自慰|口交|肛| porn|sex|orgy|rape)/i;

function seededIndex(seed, len) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % Math.max(1, len);
}
function pickSpread(cands, n) {
  const out = [], used = new Set();
  const stride = Math.max(1, Math.floor(cands.length / n));
  for (let i = 0; i < n && cands.length; i++) {
    let idx = (seededIndex('xcorpus-2026', cands.length) + i * stride + seededIndex('#' + i, cands.length)) % cands.length;
    let g = 0; while (used.has(idx) && g++ < cands.length) idx = (idx + 1) % cands.length;
    used.add(idx); out.push(cands[idx]);
  }
  return out;
}

// 注意：books.json 简介全是占位、正文含露骨描写，均不适合直接做推广钩子。
// 合规做法：只用「书名 + 题材 + 章节数」这类元数据做定制，绝不把正文片段带进推文。
// 正文仅用于合规过滤（未成年人信号/广告引流），不用于文案内容。
function safeGenre(genre) {
  const map = { '都市激情': '都市情感', '人妻熟女': '情感关系', '真实体验': '人生故事',
    '经验故事': '人生故事', '古典武侠': '武侠传奇' };
  return map[genre] || '原创故事';
}
function enGenre(genre) {
  const map = { '都市激情': 'contemporary relationships', '人妻熟女': 'relationships and emotions',
    '真实体验': 'life stories', '经验故事': 'life stories', '古典武侠': 'wuxia adventure' };
  return map[genre] || 'original fiction';
}

// 角度不同的开头池，按书 id 取模轮换，避免 120 条文案千篇一律
const CN_REC_HOOKS = [
  '成年人物的选择与命运，往往从一个细节开始。',
  '一段关系的走向，常常藏在没说出口的话里。',
  '当熟悉的世界被打破，每个人都要重新做选择。',
  '有些故事的张力，来自看似平静的日常。'
];
const CN_SUSP_HOOKS = [
  '如果你发现，自己最信任的人一直隐藏着一个秘密，你会怎么选？',
  '真相揭开之前，你愿意相信谁？',
  '一个细节，可能改写所有人对彼此的判断。',
  '如果重来一次，故事里的人还会做同样的决定吗？'
];
const EN_HOOKS = [
  'A story about choices, consequences, and the ties between people.',
  'Complex relationships and unexpected turns, in original Chinese fiction.',
  'Discover how one decision reshapes everything that follows.',
  'Original Chinese stories for adult readers, with English introduction.'
];

function makePosts(b) {
  const url = `${SITE}/book/${b.id}`;
  // utm_content 用书 id 区分；X 会把链接显示为短链，实际字数按平台计，这里仍用完整 URL 保证参数正确
  const utm = (camp, content) => `${url}?utm_source=x&utm_medium=organic_social&utm_campaign=${camp}&utm_content=${content}`;
  const genre = safeGenre(b.category);
  const chapters = b.chapterCount ? `（${b.chapterCount} 章）` : '';
  const k = b.id % 4;
  return [
    {
      post_id: `${b.id}-cn-rec`, book_id: b.id, language: 'zh', post_type: '推荐',
      post_text: `📚 今日原创小说推荐\n《${b.title}》${chapters}\n类型：${genre}\n${CN_REC_HOOKS[k]}\n你会如何看待这个故事？\n阅读更多：${utm('cn_fiction', `book_${b.id}`)}\n#原创小说 #文学阅读`,
      image_url: '', target_url: utm('cn_fiction', `book_${b.id}`), utm_campaign: 'cn_fiction'
    },
    {
      post_id: `${b.id}-cn-susp`, book_id: b.id, language: 'zh', post_type: '悬念',
      post_text: `${CN_SUSP_HOOKS[k]}\n这正是《${b.title}》最值得讨论的地方。\n成年读者可前往深夜文库了解完整故事：${utm('cn_fiction', `susp_${b.id}`)}`,
      image_url: '', target_url: utm('cn_fiction', `susp_${b.id}`), utm_campaign: 'cn_fiction'
    },
    {
      post_id: `${b.id}-en-disc`, book_id: b.id, language: 'en', post_type: '发现',
      post_text: `📖 Original Chinese Fiction\n"${b.title}" — ${EN_HOOKS[k]}\n${utm('en_fiction', `en_${b.id}`)}\nFor adults 18+. Chinese text, English intro.`,
      image_url: '', target_url: utm('en_fiction', `en_${b.id}`), utm_campaign: 'en_fiction'
    },
    {
      post_id: `${b.id}-cn-vip`, book_id: b.id, language: 'zh', post_type: '全免费',
      post_text: `《${b.title}》正在深夜文库连载。\n📖 浏览目录 · 📚 全本免费 · ⭐ 创建阅读账户 · 🔖 同步进度\n欢迎成年读者探索原创故事：${utm('cn_member', `vip_${b.id}`)}`,
      image_url: '', target_url: utm('cn_member', `vip_${b.id}`), utm_campaign: 'cn_member'
    }
  ];
}

function main() {
  const books = JSON.parse(fs.readFileSync(path.join(ROOT, 'books.json'), 'utf8'));
  const stats = { total: books.length, byCategory: 0, byMinor: 0, byTest: 0, byBody: 0, kept: 0 };
  const cands = [];
  for (const b of books) {
    if (!SAFE_CATEGORIES.has(b.category)) { stats.byCategory++; continue; }
    if (MINOR_RE.test(b.title) || MINOR_RE.test(b.author || '') || EROTIC_RE.test(b.title)) { stats.byMinor++; continue; }
    if (TEST_RE.test(b.title) || !b.url) { stats.byTest++; continue; }
    const cf = path.join(ROOT, 'book', 'chapters', `${b.id}.json`);
    if (!fs.existsSync(cf)) continue;
    let d; try { d = JSON.parse(fs.readFileSync(cf, 'utf8')); } catch (_) { continue; }
    const chapters = d.chapters || [];
    if (chapters.length < 2) continue;
    const head = chapters.slice(1, 4).map(c => (c.text || '').slice(0, 1500)).join('\n');
    if (MINOR_RE.test(head) || AD_RE.test(head.slice(0, 800))) { stats.byBody++; continue; }
    b.chapterCount = d.chapterCount || chapters.length;
    cands.push(b);
  }
  stats.kept = cands.length;
  const picked = pickSpread(cands, Math.min(COUNT, cands.length));
  const posts = [];
  for (const b of picked) {
    for (const p of makePosts(b)) {
      posts.push({ ...p, book_title: b.title, category: b.category, chapter_count: b.chapterCount || '',
        status: 'draft', approved: false, x_post_id: '', x_post_url: '', published_at: '', attempts: 0, error_message: '' });
    }
  }
  const out = { generatedAt: new Date().toISOString(), site: SITE, filterStats: stats,
    books: picked.map(b => ({ id: b.id, title: b.title, category: b.category, chapterCount: b.chapterCount })),
    posts, note: '全部为 draft/未审核；导入 Posts 表后需人工审核并把 approved 设为 true 才允许自动发布。' };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('[x-corpus] 过滤统计:', JSON.stringify(stats));
  console.log('[x-corpus] 选中书籍:', picked.length, '| 文案条数:', posts.length);
  console.log('[x-corpus] 输出:', path.relative(ROOT, OUT));
}
main();
