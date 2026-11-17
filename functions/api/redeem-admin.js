// 京东E卡兑换管理后台（受管理员密钥保护）
// POST /api/redeem-admin  body: { action, secret, ... }
//   action=list     → 列出全部兑换订单（脱敏，不含卡密）
//   action=detail   → body.id，解密返回卡密（仅管理员，用于人工核验）
//   action=approve  → body.id，核验通过后开通会员 + 清除卡密密文
//   action=reject   → body.id, reason，驳回 + 清除卡密密文
//   action=testNotify → 发送一条测试通知，验证渠道配置是否生效
import { json } from './_shared.js';
import {
  adminOk, listOrders, getOrderById, decryptSecret,
  grantVipDays, publicOrder, saveOrder
} from './_redeem_lib.js';
import { notifyNewOrder } from './_notify_lib.js';

const VALID_ACTIONS = ['list', 'detail', 'approve', 'reject', 'testNotify'];

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }

  if (!adminOk(request, body, env)) return json({ error: '管理员密钥错误' }, 403);

  const action = String(body.action || '');
  if (!VALID_ACTIONS.includes(action)) return json({ error: '未知操作' }, 400);

  if (action === 'testNotify') {
    const sent = await notifyNewOrder(env, {
      id: 'TEST' + Date.now().toString(36).toUpperCase(),
      user: '测试用户',
      planDays: 365,
      cardMask: '1234****5678',
      status: 'pending',
      created: Date.now()
    }, { title: '🔔 深夜文库 · 通知测试', adminUrl: new URL('/vip', request.url).origin + '/vip' });
    if (!sent.length) return json({ error: '未配置任何通知渠道（请检查 TG/Server酱/邮件/Webhook 环境变量）' }, 400);
    return json({ ok: true, sent });
  }

  if (action === 'list') {
    const orders = await listOrders(env);
    return json({ orders: orders.map(publicOrder) });
  }

  const o = await getOrderById(env, String(body.id || ''));
  if (!o) return json({ error: '订单不存在' }, 404);

  if (action === 'detail') {
    if (!o.encPwd) return json({ error: '该订单卡密已清除（可能已处理）' }, 410);
    const cardPwd = await decryptSecret(o.encPwd, env);
    if (cardPwd === null) return json({ error: '卡密解密失败，请检查 REDEEM_KEY 配置' }, 500);
    return json({ id: o.id, cardMask: o.cardMask, cardPwd });
  }

  if (action === 'approve') {
    if (o.status === 'approved') return json({ error: '该订单已处理，请勿重复开通' }, 409);
    if (!o.encPwd && o.status !== 'pending') return json({ error: '该订单状态异常，无法开通' }, 409);
    const g = await grantVipDays(env, o.user, o.planDays);
    if (!g.ok) return json({ error: g.error }, 404);
    o.status = 'approved';
    o.vipUntil = g.vipUntil;
    o.note = (o.note ? o.note + '；' : '') + '人工核验通过，已开通';
    o.encPwd = null;
    o.reviewedAt = Date.now();
    await saveOrder(env, o);
    return json({ ok: true, order: publicOrder(o) });
  }

  // reject
  const reason = String(body.reason || '').trim();
  o.status = 'rejected';
  o.note = (o.note ? o.note + '；' : '') + (reason ? '驳回：' + reason : '人工核验未通过');
  o.encPwd = null;
  o.reviewedAt = Date.now();
  await saveOrder(env, o);
  return json({ ok: true, order: publicOrder(o) });
}
