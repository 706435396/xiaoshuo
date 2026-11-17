// 会员状态查询：GET /api/me → { user, isVip, vipExp, vipUntil }
// 未登录返回 401；前端据此决定是否解锁付费章节。
import { json, getSession, memberInfo } from './_shared.js';

export async function onRequestGet({ request, env }) {
  const sess = await getSession(request, env);
  if (!sess) return json({ error: '未登录', user: null, isVip: false, vipExp: 0 }, 401);
  const info = await memberInfo(env, sess.user);
  return json({
    user: info.user,
    isVip: info.isVip,
    vipExp: info.vipExp,
    vipUntil: info.vipExp ? new Date(info.vipExp).toISOString().slice(0, 10) : null
  });
}
