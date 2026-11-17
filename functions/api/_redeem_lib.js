// 共享库：京东E卡兑换（AES-GCM 加密卡密、卡号哈希去重、验卡适配器、开通会员）
// 设计原则：卡密不明文落盘；只有持管理员密钥者能解密查看；核销后立即清除密文。
import { getSession } from './_shared.js';

// 默认管理密钥：与 grant.js 保持一致。线上由 CF Pages 环境变量 ADMIN_SECRET 覆盖。
const DEFAULT_SECRET = 'shenye-vip-2026';

// 兑换套餐：仅年卡一种通道。1 张 10 元面值京东E卡 = 年卡 365 天。
export const PLANS = [
  { days: 365, name: '年卡', label: '365 天', cardValue: 10 }
];

// ---------- 管理员鉴权 ----------
export function adminOk(request, body, env) {
  const expected = env.ADMIN_SECRET || DEFAULT_SECRET;
  const supplied = request.headers.get('x-admin-secret') || (body && body.secret);
  return !!supplied && supplied === expected;
}

// ---------- Base64 ----------
function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------- AES-GCM ----------
async function aesKey(env) {
  const secret = env.REDEEM_KEY || env.ADMIN_SECRET || DEFAULT_SECRET;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function encryptSecret(plain, env) {
  const key = await aesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return { iv: toB64(iv), data: toB64(enc) };
}
export async function decryptSecret(rec, env) {
  if (!rec || !rec.iv || !rec.data) return null;
  try {
    const key = await aesKey(env);
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(rec.iv) }, key, fromB64(rec.data)
    );
    return new TextDecoder().decode(dec);
  } catch {
    return null;
  }
}

// ---------- 卡号规范化 / 脱敏 ----------
export function normalizeCardNo(v) {
  return String(v || '').replace(/[\s-]/g, '').toUpperCase();
}
export function maskCardNo(v) {
  const n = normalizeCardNo(v);
  if (!n) return '';
  return n.length > 8 ? n.slice(0, 4) + '****' + n.slice(-4) : n.slice(0, 2) + '****';
}

// ---------- 订单 KV ----------
const orderKey = hash => 'redeem:' + hash;
const idKey = id => 'redeemid:' + id;

export async function getOrderByHash(env, hash) {
  return env.USER_DATA.get(orderKey(hash), { type: 'json' });
}
export async function getOrderById(env, id) {
  const hash = await env.USER_DATA.get(idKey(id));
  return hash ? getOrderByHash(env, hash) : null;
}
export async function saveOrder(env, order) {
  await env.USER_DATA.put(orderKey(order.hash), JSON.stringify(order));
  await env.USER_DATA.put(idKey(order.id), order.hash);
}
export async function listOrders(env) {
  const out = [];
  let cursor = null;
  do {
    const page = await env.USER_DATA.list({ prefix: 'redeem:', cursor, limit: 1000 });
    for (const k of page.keys) {
      const o = await env.USER_DATA.get(k.name, { type: 'json' });
      if (o && o.id) out.push(o);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  out.sort((a, b) => (b.created || 0) - (a.created || 0));
  return out;
}

// ---------- 开通会员（与 /api/grant 相同的续费叠加语义）----------
// 返回 grantBefore/grantAfter 供兑换订单记录，驳回时可精确回滚。
export async function grantVipDays(env, name, days) {
  const u = await env.USER_DATA.get('user:' + name, { type: 'json' });
  if (!u) return { ok: false, error: '用户不存在：' + name };
  const now = Date.now();
  const base = (u.vipExp && u.vipExp > now) ? u.vipExp : now;
  const vipExp = base + days * 24 * 3600 * 1000;
  u.vipExp = vipExp;
  await env.USER_DATA.put('user:' + name, JSON.stringify(u));
  return {
    ok: true, vipExp,
    grantBefore: base,
    grantAfter: vipExp,
    vipUntil: new Date(vipExp).toISOString().slice(0, 10)
  };
}

// ---------- 撤销会员天数（人工复核判定卡密无效时调用）----------
// 精确回滚：若当前 vipExp 仍等于发放后的快照（用户期间未再续费），直接恢复发放前值；
// 否则保守扣减 days 天且不低于 now（不误伤用户后续 legitimate 续费）。
export async function revokeVipDays(env, name, days, grantBefore, grantAfter) {
  const u = await env.USER_DATA.get('user:' + name, { type: 'json' });
  if (!u) return { ok: false, error: '用户不存在：' + name };
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  let vipExp = Number(u.vipExp) || 0;
  if (grantAfter != null && Math.abs(vipExp - grantAfter) < 1000) {
    vipExp = Number(grantBefore) || 0; // 精确恢复发放前
  } else {
    vipExp = Math.max(0, vipExp - Number(days || 0) * day); // 保守扣减
  }
  if (vipExp < now) vipExp = 0; // 已过期则清零，等同无会员
  u.vipExp = vipExp;
  await env.USER_DATA.put('user:' + name, JSON.stringify(u));
  return { ok: true, vipExp, vipUntil: vipExp > now ? new Date(vipExp).toISOString().slice(0, 10) : null };
}

// ---------- 验卡适配器（A 人工 / B 自动）----------
// 手动模式直接返回 pending，由管理员在后台解密卡密人工核验后点「通过」。
// 自动模式调用 env.CARD_VERIFY_URL：
//   POST JSON { cardNo, cardPwd }，Header Authorization: Bearer <CARD_VERIFY_TOKEN>
//   期望响应 { ok:true, valid:true } / { valid:false, reason:'...' }
//   或 { code:0 } / { code:非0, msg:'...' } —— 若你的平台格式不同，只需改这一段映射。
export async function verifyCard(cardNo, cardPwd, env, forceMode) {
  const mode = String(forceMode || env.CARD_VERIFY_MODE || 'manual').toLowerCase();
  if (mode !== 'auto') return { status: 'pending', mode: 'manual' };
  const url = env.CARD_VERIFY_URL;
  if (!url) return { status: 'error', mode: 'auto', reason: '未配置 CARD_VERIFY_URL' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + (env.CARD_VERIFY_TOKEN || '')
      },
      body: JSON.stringify({ cardNo, cardPwd })
    });
    const data = await res.json().catch(() => ({}));
    const valid = data.valid === true || data.ok === true || data.code === 0;
    const invalid = data.valid === false || data.ok === false || (data.code != null && data.code !== 0);
    if (valid) return { status: 'valid', mode: 'auto', detail: data };
    if (invalid) return { status: 'invalid', mode: 'auto', reason: data.reason || data.msg || data.message || '卡密校验未通过' };
    return { status: 'error', mode: 'auto', reason: '验卡接口返回无法识别' };
  } catch (e) {
    return { status: 'error', mode: 'auto', reason: '验卡接口异常：' + (e && e.message || e) };
  }
}

// ---------- 对外展示（永不泄露卡密）----------
export function publicOrder(o) {
  if (!o) return null;
  return {
    id: o.id,
    status: o.status,
    planDays: o.planDays,
    cardMask: o.cardMask,
    created: o.created,
    mode: o.mode,
    note: o.note || '',
    vipUntil: o.vipUntil || null
  };
}

// ---------- 当前登录用户（用于提交绑定自己的账号）----------
export async function currentUser(request, env) {
  const sess = await getSession(request, env);
  return sess ? sess.user : null;
}
