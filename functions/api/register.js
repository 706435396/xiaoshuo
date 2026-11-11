// 注册：用户名 + 密码（加盐 SHA-256 存储），签发 30 天 token
import { json, sha256, TOKEN_TTL, newToken } from './_shared.js';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }

  const name = String(body.username || '').trim();
  const pwd = String(body.password || '');
  if (!name || !pwd) return json({ error: '用户名和密码必填' }, 400);
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5\-]{1,32}$/.test(name)) return json({ error: '用户名仅限中英文/数字/下划线，1-32 位' }, 400);
  if (pwd.length < 6) return json({ error: '密码至少 6 位' }, 400);

  if (await env.USER_DATA.get('user:' + name)) return json({ error: '用户名已存在' }, 409);

  const salt = crypto.randomUUID();
  const hash = await sha256(salt + pwd);
  await env.USER_DATA.put('user:' + name, JSON.stringify({ salt, hash, created: Date.now() }));

  const token = newToken();
  await env.USER_DATA.put('sess:' + token, JSON.stringify({ user: name, exp: Date.now() + TOKEN_TTL }));
  return json({ token, username: name });
}
