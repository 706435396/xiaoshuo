// 登录：校验密码哈希，签发 30 天 token
import { json, sha256, TOKEN_TTL, newToken } from './_shared.js';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }

  const name = String(body.username || '').trim();
  const pwd = String(body.password || '');
  const u = await env.USER_DATA.get('user:' + name, { type: 'json' });
  if (!u) return json({ error: '用户不存在' }, 401 });

  const hash = await sha256(u.salt + pwd);
  if (hash !== u.hash) return json({ error: '密码错误' }, 401 });

  const token = newToken();
  await env.USER_DATA.put('sess:' + token, JSON.stringify({ user: name, exp: Date.now() + TOKEN_TTL }));
  return json({ token, username: name });
}
