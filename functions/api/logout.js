// 退出登录：清除会员 Cookie（前端仍会清 localStorage）
import { json } from './_shared.js';

export async function onRequestPost() {
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', 'sy_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
  return res;
}
