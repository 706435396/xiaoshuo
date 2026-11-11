// 进度云同步：GET 拉取、PUT 上传（需 Bearer token 鉴权）
import { json, authUser } from './_shared.js';

export async function onRequestGet({ request, env }) {
  const user = await authUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);
  const p = await env.USER_DATA.get('prog:' + user, { type: 'json' });
  return json(p || { favs: [], ratings: {}, progress: {} });
}

export async function onRequestPut({ request, env }) {
  const user = await authUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }

  // 仅接受受控字段，限制规模，防滥用
  const favs = Array.isArray(body.favs) ? body.favs.map(String).slice(0, 2000) : [];
  const ratings = (body.ratings && typeof body.ratings === 'object') ? body.ratings : {};
  const progress = (body.progress && typeof body.progress === 'object') ? body.progress : {};
  await env.USER_DATA.put('prog:' + user, JSON.stringify({ favs, ratings, progress }));
  return json({ ok: true });
}
