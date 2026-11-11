// 共享工具：JSON 响应、SHA-256 加盐哈希、token 鉴权（Pages Functions 以下划线文件作为模块，不路由）
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const TOKEN_TTL = 30 * 24 * 3600 * 1000; // token 有效期 30 天

export function newToken() {
  return crypto.randomUUID() + crypto.randomUUID(); // 双 UUID 提升熵
}

// 从 Authorization: Bearer <token> 解析出用户名；无效/过期返回 null
export async function authUser(request, env) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const sess = await env.USER_DATA.get('sess:' + m[1], { type: 'json' });
  if (!sess || sess.exp < Date.now()) return null;
  return sess.user;
}
