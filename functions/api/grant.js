// 手动开通会员：POST /api/grant
// 受管理员密钥保护。密钥来源优先级：请求头 X-Admin-Secret > body.secret > 环境变量 ADMIN_SECRET > 内置默认密钥。
// 环境变量未配置时用内置默认密钥（仅用于起步，务必在 CF 后台配 ADMIN_SECRET 覆盖）。
// body: { username, days, secret? }  days 为会员天数（1-3650），留空默认 30 天。
import { json } from './_shared.js';

const DEFAULT_SECRET = 'shenye-vip-2026'; // 起步密钥；建议在 CF Pages 环境变量配置 ADMIN_SECRET 覆盖

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }

  const expected = env.ADMIN_SECRET || DEFAULT_SECRET;
  const supplied = request.headers.get('x-admin-secret') || body.secret;
  if (!supplied || supplied !== expected) return json({ error: '管理员密钥错误' }, 403);

  const name = String(body.username || '').trim();
  let days = Number(body.days);
  if (!days || !Number.isFinite(days)) days = 30;
  days = Math.min(3650, Math.max(1, Math.floor(days)));

  const u = await env.USER_DATA.get('user:' + name, { type: 'json' });
  if (!u) return json({ error: '用户不存在：' + name }, 404);

  // 续费叠加：若当前会员未过期，在原到期时间基础上顺延；否则从现在起算
  const now = Date.now();
  const base = (u.vipExp && u.vipExp > now) ? u.vipExp : now;
  const vipExp = base + days * 24 * 3600 * 1000;
  u.vipExp = vipExp;
  await env.USER_DATA.put('user:' + name, JSON.stringify(u));

  // 鉴权每次实时读 user 对象，旧会话无需重新登录即生效
  return json({ ok: true, username: name, days, vipExp, vipUntil: new Date(vipExp).toISOString().slice(0, 10) });
}
