// 广告位配置 API
// GET  /api/adslots          公开读取（前台渲染用）
// POST /api/adslots          需 X-Ad-Pass 管理密码，写入 KV
// 管理密码：CF 环境变量 AD_PASS；未设置时使用内置默认值（建议到 CF 后台设置覆盖）
// 数据存 KV USER_DATA，key = 'adslots:v1'
import { json } from './_shared.js';

var KEY = 'adslots:v1';
var DEFAULT_PASS = 'shenye2026';

// 允许的广告位 key（与首页 data-ad-key 一一对应）
var ALLOWED_SLOTS = [
  'home-banner', 'home-rect', 'home-native',
  'left-1', 'left-2',
  'right-1', 'right-2', 'right-3'
];

function emptyData() {
  var slots = {};
  ALLOWED_SLOTS.forEach(function (k) {
    slots[k] = { enabled: false, type: 'image', value: '', link: '', note: '' };
  });
  return { v: 1, slots: slots, updatedAt: 0 };
}

export async function onRequest(context) {
  var request = context.request;
  var env = context.env;
  var method = (request.method || 'GET').toUpperCase();

  // ---------- GET：读取配置（公开；带正确 X-Ad-Pass 时附 authed=true 供后台登录校验） ----------
  if (method === 'GET') {
    var gotPass = (request.headers.get('x-ad-pass') || '').trim();
    var wantPass = ((env.AD_PASS || DEFAULT_PASS) + '').trim();
    var authed = !!gotPass && gotPass === wantPass;
    try {
      var raw = await env.USER_DATA.get(KEY, { type: 'text' });
      var data = raw ? JSON.parse(raw) : emptyData();
      var base = emptyData();
      Object.keys(base.slots).forEach(function (k) {
        if (!data.slots || !data.slots[k]) data.slots[k] = base.slots[k];
      });
      data.authed = authed;
      return json(data);
    } catch (e) {
      var fallback = emptyData();
      fallback.authed = authed;
      return json(fallback);
    }
  }

  // ---------- POST：保存配置（需管理密码） ----------
  if (method === 'POST') {
    var pass = (request.headers.get('x-ad-pass') || '').trim();
    var expected = ((env.AD_PASS || DEFAULT_PASS) + '').trim();
    if (!pass || pass !== expected) {
      return json({ ok: false, error: '管理密码错误' }, 401);
    }

    var body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: '请求数据格式错误' }, 400);
    }

    var src = (body && body.slots && typeof body.slots === 'object') ? body.slots : {};
    var clean = {};
    ALLOWED_SLOTS.forEach(function (k) {
      var s = src[k] || {};
      clean[k] = {
        enabled: !!s.enabled,
        type: (s.type === 'html' || s.type === 'image') ? s.type : 'image',
        value: String(s.value == null ? '' : s.value).slice(0, 20000),
        link: String(s.link == null ? '' : s.link).slice(0, 2000),
        note: String(s.note == null ? '' : s.note).slice(0, 100)
      };
    });

    var payload = { v: 1, slots: clean, updatedAt: Date.now() };
    try {
      await env.USER_DATA.put(KEY, JSON.stringify(payload));
    } catch (e) {
      return json({ ok: false, error: '写入失败：' + (e && e.message ? e.message : '未知错误') }, 500);
    }
    return json({ ok: true, updatedAt: payload.updatedAt, count: ALLOWED_SLOTS.length });
  }

  return json({ error: 'Method Not Allowed' }, 405);
}
