// 广告位配置 API v2（C 版动态网格）
// GET  /api/adslots          公开读取（前台渲染 / 后台加载；带正确 X-Ad-Pass 时附 authed=true）
// POST /api/adslots          需 X-Ad-Pass 管理密码，写入 KV
//
// 数据结构：六区，每区是广告位数组，可自由增删
//   首页三区：hero / cat / shelf
//   看书两区：reader-top（正文上方）/ reader-bottom（正文下方）
//   插屏一区：interstitial（Adsterra Interstitial 弹窗代码，首次访问弹一次，由 popunder.js 读取）
//   { v:2, zones:{ hero:[slot], cat:[slot], shelf:[slot], 'reader-top':[slot], 'reader-bottom':[slot], interstitial:[slot] }, updatedAt }
//   slot = { id, enabled, type:'image'|'html', value, link, note, size }
// 注：看书两区由 ads.js 读取，同时映射旧静态命名 reader-top/bottom 与 content-top/bottom。
// 注：interstitial 由 popunder.js 读取，仅取第一个启用且有内容的 slot。
//
// 管理密码：CF 环境变量 AD_PASS；未设置时使用内置默认值
// 数据存 KV USER_DATA，key = 'adslots:v1'（沿用 key，内部版本升 v2，自动迁移旧数据）
import { json } from './_shared.js';

var KEY = 'adslots:v1';
var DEFAULT_PASS = 'shenye2026';
var ZONES = ['hero', 'cat', 'shelf', 'reader-top', 'reader-bottom', 'interstitial'];
var MAX_PER_ZONE = 24;   // 每区最多 24 个广告位，防滥用
var MAX_SLOT_LEN = 20000;

// 合法尺寸预设（size=auto 表示自适应）
var SIZES = ['auto', '300x250', '320x50', '160x600', '336x280', '250x250', '320x100', '728x90', '300x600', '468x60'];

function makeId() {
  return 'ad' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeSlot(s) {
  s = s || {};
  return {
    id: /^[a-zA-Z0-9_-]{1,40}$/.test(String(s.id || '')) ? s.id : makeId(),
    enabled: !!s.enabled,
    type: (s.type === 'html') ? 'html' : 'image',
    value: String(s.value == null ? '' : s.value).slice(0, MAX_SLOT_LEN),
    link: String(s.link == null ? '' : s.link).slice(0, 2000),
    note: String(s.note == null ? '' : s.note).slice(0, 100),
    size: SIZES.indexOf(s.size) >= 0 ? s.size : 'auto'
  };
}

function emptySlot() {
  return { id: makeId(), enabled: false, type: 'image', value: '', link: '', note: '', size: 'auto' };
}

// 初始结构：五区各 2 个空位 + 插屏 1 个空位（用户可增删）
function emptyData() {
  return {
    v: 2,
    zones: {
      hero: [normalizeSlot({ id: 'hero-1' }), normalizeSlot({ id: 'hero-2' })],
      cat: [normalizeSlot({ id: 'cat-1' }), normalizeSlot({ id: 'cat-2' })],
      shelf: [normalizeSlot({ id: 'shelf-1' }), normalizeSlot({ id: 'shelf-2' })],
      'reader-top': [normalizeSlot({ id: 'rt-1' }), normalizeSlot({ id: 'rt-2' })],
      'reader-bottom': [normalizeSlot({ id: 'rb-1' }), normalizeSlot({ id: 'rb-2' })],
      interstitial: [normalizeSlot({ id: 'it-1' })]
    },
    updatedAt: 0
  };
}

// v1 固定 slots → v2 三区 zones 迁移，避免旧配置丢失
function migrate(data) {
  if (!data || typeof data !== 'object') return emptyData();
  if (data.v === 2 && data.zones && typeof data.zones === 'object') {
    var seed = emptyData().zones; // 补齐新增区时给默认空位，保持各区初始结构一致
    ZONES.forEach(function (z) {
      if (!Array.isArray(data.zones[z])) data.zones[z] = (seed[z] || []).map(normalizeSlot);
      data.zones[z] = data.zones[z].slice(0, MAX_PER_ZONE).map(normalizeSlot);
    });
    return data;
  }
  if (data.slots && typeof data.slots === 'object') {
    var out = emptyData();
    var map = {
      'home-banner': 'hero', 'home-rect': 'hero', 'home-native': 'hero',
      'left-1': 'cat', 'left-2': 'cat',
      'right-1': 'shelf', 'right-2': 'shelf', 'right-3': 'shelf'
    };
    Object.keys(map).forEach(function (k) {
      var s = data.slots[k];
      if (s && (s.value || s.enabled)) {
        var n = normalizeSlot(s);
        n.id = k;
        out.zones[map[k]].push(n);
      }
    });
    out.updatedAt = data.updatedAt || 0;
    return out;
  }
  return emptyData();
}

export async function onRequest(context) {
  var request = context.request;
  var env = context.env;
  var method = (request.method || 'GET').toUpperCase();

  // ---------- GET：读取（公开；带正确密码附 authed） ----------
  if (method === 'GET') {
    var gotPass = (request.headers.get('x-ad-pass') || '').trim();
    var wantPass = ((env.AD_PASS || DEFAULT_PASS) + '').trim();
    var authed = !!gotPass && gotPass === wantPass;
    var data;
    try {
      var raw = await env.USER_DATA.get(KEY, { type: 'text' });
      data = migrate(raw ? JSON.parse(raw) : null);
    } catch (e) {
      data = emptyData();
    }
    data.authed = authed;
    data.sizes = SIZES;
    return json(data);
  }

  // ---------- POST：保存（需管理密码） ----------
  if (method === 'POST') {
    var pass = (request.headers.get('x-ad-pass') || '').trim();
    var expected = ((env.AD_PASS || DEFAULT_PASS) + '').trim();
    if (!pass || pass !== expected) return json({ ok: false, error: '管理密码错误' }, 401);

    var body;
    try { body = await request.json(); }
    catch (e) { return json({ ok: false, error: '请求数据格式错误' }, 400); }

    var src = (body && body.zones && typeof body.zones === 'object') ? body.zones : {};
    var clean = {};
    var total = 0;
    ZONES.forEach(function (z) {
      var arr = Array.isArray(src[z]) ? src[z] : [];
      clean[z] = arr.slice(0, MAX_PER_ZONE).map(normalizeSlot);
      // 检测重复 id，重复则重新生成，避免渲染 key 冲突
      var seen = {};
      clean[z].forEach(function (s) {
        if (seen[s.id]) s.id = makeId();
        seen[s.id] = 1;
      });
      total += clean[z].length;
    });

    var payload = { v: 2, zones: clean, updatedAt: Date.now() };
    try {
      await env.USER_DATA.put(KEY, JSON.stringify(payload));
    } catch (e) {
      return json({ ok: false, error: '写入失败：' + (e && e.message ? e.message : '未知错误') }, 500);
    }
    return json({ ok: true, updatedAt: payload.updatedAt, count: total });
  }

  return json({ error: 'Method Not Allowed' }, 405);
}
