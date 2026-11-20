#!/usr/bin/env node
/**
 * 深夜文库 · Bluesky + Mastodon 自动发布（零成本方案）
 *
 * 数据源：promo/x-corpus.json（120 条已生成的中英文推广文案）
 * 去重：  promo/x-social-state.json 记录已发布的 post_id，永不重复发同一条
 * 时段：  由 --slot=morning|evening|night 指定，不同时段取不同语言/类型
 * 凭证：  全部走环境变量，缺失则该平台跳过（不报错、不影响另一平台）
 *
 * 用法：
 *   node tools/x_social_publish.js --dry-run              # 本地演练，不发不写状态
 *   node tools/x_social_publish.js --slot=morning         # 上午：中文"推荐"
 *   node tools/x_social_publish.js --slot=evening         # 晚间：中文"悬念"
 *   node tools/x_social_publish.js --slot=night           # 海外：英文"发现"
 *
 * 环境变量：
 *   BSKY_HANDLE           Bluesky 账号，如 shenye.bsky.social
 *   BSKY_APP_PASSWORD     Bluesky 应用专用密码（不是登录密码）
 *   MASTODON_INSTANCE     Mastodon 实例域名，如 mastodon.social（不要带 https://）
 *   MASTODON_TOKEN        Mastodon access token
 *   BSKY_SELF_LABEL       Bluesky 自标签，默认 sexual（warn 不隐藏、不降权）；设 none 关闭
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORPUS = path.join(ROOT, 'promo', 'x-corpus.json');
const STATE = path.join(ROOT, 'promo', 'x-social-state.json');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const hit = argv.find(a => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const DRY_RUN = argv.includes('--dry-run');
const SLOT = getArg('slot', 'morning');
const VALID_SLOTS = { morning: '推荐', evening: '悬念', night: '发现' };
if (!VALID_SLOTS[SLOT]) {
  console.error(`[FATAL] --slot 必须是 ${Object.keys(VALID_SLOTS).join('/')} 之一，收到: ${SLOT}`);
  process.exit(1);
}

// ---------- 书名过滤：擦边词，不进入自动发布队列 ----------
// 注意：这是发布侧的额外保险，不修改已上线的 x-corpus.json
const RISKY_TITLE_RE = /(熟妇|性福|人妻|调教|骗上床|丝袜|淫|奸|性交|幼|未成年|萝莉|制服诱惑)/i;
const AD_RE = /(Telegram|t\.me\/|QQ群|微信群|加群|搜索 @|禁忌书屋)/i;

// ---------- 时段 → 候选筛选 ----------
const WANT_LANG = SLOT === 'night' ? 'en' : 'zh';
const WANT_TYPE = VALID_SLOTS[SLOT];

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return fallback; }
}

function candidates() {
  const corpus = loadJSON(CORPUS, null);
  if (!corpus || !Array.isArray(corpus.posts)) throw new Error('文案库读取失败: ' + CORPUS);
  return corpus.posts.filter(p =>
    p.language === WANT_LANG &&
    p.post_type === WANT_TYPE &&
    p.approved === true &&
    !RISKY_TITLE_RE.test(p.book_title || '') &&
    !AD_RE.test(p.post_text || '')
  );
}

// ---------- Bluesky ----------
// 文档：com.atproto.server.createSession -> com.atproto.repo.createRecord
// 链接必须是 facet（UTF-8 字节偏移），否则只是纯文本不可点
function buildFacets(text) {
  const facets = [];
  const urlRe = /https?:\/\/[^\s]+/g;
  const encoder = new TextEncoder();
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    const byteStart = encoder.encode(text.slice(0, m.index)).length;
    const byteEnd = encoder.encode(text.slice(0, m.index + m[0].length)).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }]
    });
  }
  return facets;
}

async function postToBluesky(text, lang) {
  const handle = process.env.BSKY_HANDLE;
  const password = process.env.BSKY_APP_PASSWORD;
  if (!handle || !password) return { skipped: '凭证未配置 (BSKY_HANDLE / BSKY_APP_PASSWORD)' };
  const service = (process.env.BSKY_SERVICE || 'https://bsky.social').replace(/\/$/, '');
  const label = (process.env.BSKY_SELF_LABEL || 'sexual').toLowerCase();

  const sessRes = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password })
  });
  if (!sessRes.ok) throw new Error(`Bluesky 登录失败 HTTP ${sessRes.status}: ${(await sessRes.text()).slice(0, 200)}`);
  const sess = await sessRes.json();

  const serviceForRepo = sess.didDoc && sess.didDoc.service && sess.didDoc.service[0] && sess.didDoc.service[0].serviceEndpoint
    ? sess.didDoc.service[0].serviceEndpoint.replace(/\/$/, '')
    : service;

  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    langs: [lang === 'en' ? 'en' : 'zh'],
    facets: buildFacets(text)
  };
  if (label !== 'none') {
    record.labels = {
      $type: 'com.atproto.label.defs#selfLabels',
      values: [{ val: label }]
    };
  }

  const res = await fetch(`${serviceForRepo}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.accessJwt}` },
    body: JSON.stringify({ repo: sess.did, collection: 'app.bsky.feed.post', record })
  });
  if (!res.ok) throw new Error(`Bluesky 发推失败 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  const rkey = String(out.uri || '').split('/').pop();
  return { ok: true, url: `https://bsky.app/profile/${handle}/post/${rkey}`, uri: out.uri, cid: out.cid };
}

// ---------- Mastodon ----------
async function postToMastodon(text, lang) {
  const instance = process.env.MASTODON_INSTANCE;
  const token = process.env.MASTODON_TOKEN;
  if (!instance || !token) return { skipped: '凭证未配置 (MASTODON_INSTANCE / MASTODON_TOKEN)' };
  const base = `https://${instance.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  const res = await fetch(`${base}/api/v1/statuses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      status: text,
      language: lang === 'en' ? 'en' : 'zh',
      sensitive: true,           // 成人内容按平台要求标记
      visibility: 'public'
    })
  });
  if (!res.ok) throw new Error(`Mastodon 发推失败 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  return { ok: true, url: out.url || out.uri || '', id: out.id };
}

// ---------- 主流程 ----------
async function main() {
  const state = loadJSON(STATE, { version: 1, published: [], failed: [] });
  if (!Array.isArray(state.published)) state.published = [];
  const publishedIds = new Set(state.published.map(x => x.post_id));

  const pool = candidates();
  if (!pool.length) {
    console.log(`[INFO] slot=${SLOT} 无可用文案（语言=${WANT_LANG} 类型=${WANT_TYPE}，已排除擦边书名/已发过的），跳过`);
    return;
  }
  const post = pool.find(p => !publishedIds.has(p.post_id));
  if (!post) {
    console.log(`[INFO] slot=${SLOT} 候选 ${pool.length} 条已全部发过，跳过（请补充文案库）`);
    return;
  }

  console.log(`[PLAN] slot=${SLOT} 选中 ${post.post_id} | ${post.language}/${post.post_type} | ${post.book_title}`);
  console.log(`[TEXT]\n${post.post_text}\n[/TEXT]`);

  if (DRY_RUN) {
    console.log('[DRY-RUN] 演练模式：不发布、不写状态。facet 数量 =', buildFacets(post.post_text).length);
    return;
  }

  const result = { post_id: post.post_id, slot: SLOT, at: new Date().toISOString(), bluesky: null, mastodon: null };
  const tasks = [
    ['bluesky', () => postToBluesky(post.post_text, post.language)],
    ['mastodon', () => postToMastodon(post.post_text, post.language)]
  ];
  let anyOk = false;
  for (const [name, fn] of tasks) {
    try {
      const r = await fn();
      result[name] = r;
      if (r.ok) { anyOk = true; console.log(`[OK] ${name}: ${r.url}`); }
      else console.log(`[SKIP] ${name}: ${r.skipped}`);
    } catch (e) {
      result[name] = { error: String(e.message || e) };
      console.error(`[ERROR] ${name}: ${e.message || e}`);
    }
  }

  if (anyOk) {
    state.published.push(result);
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
    console.log('[DONE] 已写入发布状态');
  } else {
    console.log('[NOOP] 两个平台均未成功发布，未写状态（下次会重试同一条）');
  }
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
