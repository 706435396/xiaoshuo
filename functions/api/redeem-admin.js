// 京东E卡兑换管理后台（受管理员密钥保护）
// POST /api/redeem-admin  body: { action, secret, ... }
//   action=list     → 列出全部兑换订单（脱敏，不含卡密）
//   action=detail   → body.id，解密返回卡密（仅管理员，用于人工核验）
//   action=approve  → body.id，复核通过：会员已生效，仅标记通过 + 销毁卡密密文
//   action=reject   → body.id, reason，复核不通过：撤销会员权限 + 销毁卡密密文（幂等）
//   action=testNotify → 发送一条测试通知，验证渠道配置是否生效
import { json } from './_shared.js';
import {
  adminOk, listOrders, getOrderById, decryptSecret,
  revokeVipDays, publicOrder, saveOrder
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
      status: 'active',
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
    if (o.status === 'approved') return json({ error: '该订单已通过，请勿重复处理' }, 409);
    if (o.status === 'rejected') return json({ error: '该订单已驳回撤销，无法再通过' }, 409);
    if (!o.encPwd && o.status !== 'active') return json({ error: '该订单状态异常，无法复核' }, 409);
    // 会员在提交时已开通，此处只标记复核通过并销毁卡密，不再重复发放天数
    o.status = 'approved';
    o.note = (o.note ? o.note + '；' : '') + '人工复核通过，会员保留';
    o.encPwd = null;
    o.reviewedAt = Date.now();
    await saveOrder(env, o);
    return json({ ok: true, order: publicOrder(o) });
  }

  // reject：复核不通过，撤销提交时发放的会员权限（幂等）
  if (o.status === 'rejected') return json({ error: '该订单已撤销，请勿重复处理' }, 409);
  const reason = String(body.reason || '').trim();
  let revoked = null;
  if (o.status === 'active' || o.status === 'approved') {
    // 会员可能已生效：按订单快照撤销对应天数
    const rv = await revokeVipDays(env, o.user, o.planDays, o.grantBefore, o.grantAfter);
    if (!rv.ok) return json({ error: '撤销会员失败：' + rv.error }, 404);
    revoked = rv;
    o.vipUntil = rv.vipUntil || null;
  }
  o.status = 'rejected';
  o.note = (o.note ? o.note + '；' : '') + (reason ? '复核未通过：' + reason + '，已撤销会员' : '复核未通过，已撤销会员');
  o.encPwd = null;
  o.reviewedAt = Date.now();
  await saveOrder(env, o);
  return json({ ok: true, order: publicOrder(o), revoked });
}
