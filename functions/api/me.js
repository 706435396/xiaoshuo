// 账号状态查询：GET /api/me → { user }
// 全免费模式：仅用于校验登录态，会员字段已移除。
import { json, getSession } from './_shared.js';

export async function onRequestGet({ request, env }) {
  const sess = await getSession(request, env);
  if (!sess) return json({ error: '未登录', user: null }, 401);
  return json({ user: sess.user });
}
