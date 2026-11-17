// 京东E卡兑换提交 / 查询（用户登录后使用）
// POST /api/redeem  body: { planDays, cardNo, cardPwd }
//   → 卡号哈希去重、卡密加密落盘；提交即开通会员（active 待复核），后台判定无效再撤销。
// GET  /api/redeem?id=xxx  → 查询自己某笔订单状态（仅脱敏信息，不含卡密）。
import { json, sha256 } from './_shared.js';
import {
  PLANS, normalizeCardNo, maskCardNo, encryptSecret,
  getOrderByHash, getOrderById, saveOrder, verifyCard,
  grantVipDays, revokeVipDays, publicOrder, currentUser
} from './_redeem_lib.js';
import { scheduleNotify } from './_notify_lib.js';

const VALID_DAYS = PLANS.map(p => p.days);

export async function onRequestGet({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: '请先登录后再查询' }, 401);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: '缺少订单号 id' }, 400);
  const o = await getOrderById(env, id);
  if (!o || o.user !== user) return json({ error: '未找到该订单' }, 404);
  return json({ order: publicOrder(o) });
}

export async function onRequestPost({ request, env, context }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: '请先登录后再兑换' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }

  const planDays = Number(body.planDays);
  if (!VALID_DAYS.includes(planDays)) return json({ error: '套餐无效，本站仅提供年卡（365 天）兑换' }, 400);

  const cardNo = normalizeCardNo(body.cardNo);
  const cardPwd = String(body.cardPwd || '').replace(/\s/g, '');
  if (cardNo.length < 8 || cardPwd.length < 4) return json({ error: '卡号或卡密格式不正确' }, 400);

  // 卡号哈希去重（只存哈希，不存完整卡号明文）
  const hash = await sha256(cardNo);
  const existing = await getOrderByHash(env, hash);
  if (existing && existing.status !== 'rejected') {
    const tip = existing.status === 'approved' ? '该卡已兑换成功，请勿重复提交' : '该卡已提交，正在处理中';
    return json({ error: tip, order: publicOrder(existing) }, 409);
  }

  const id = 'JD' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const enc = await encryptSecret(cardPwd, env);
  const mode = String(env.CARD_VERIFY_MODE || 'manual').toLowerCase() === 'auto' ? 'auto' : 'manual';

  // 提交即开通：先发放会员并记录快照（供后台驳回时精确撤销）
  const g = await grantVipDays(env, user, planDays);
  if (!g.ok) return json({ error: '会员开通失败：' + g.error }, 500);

  const order = {
    id,
    hash,
    user,
    planDays,
    cardMask: maskCardNo(cardNo),
    status: 'active', // 已自动开通，待后台复核；复核不通过则撤销
    created: Date.now(),
    mode,
    encPwd: enc, // 保留密文供后台复核；复核完成后销毁
    grantBefore: g.grantBefore,
    grantAfter: g.grantAfter,
    vipUntil: g.vipUntil,
    note: ''
  };

  // 自动验卡模式：提交时即核验，无效则当场撤销 + 驳回
  if (mode === 'auto') {
    const vr = await verifyCard(cardNo, cardPwd, env, mode);
    if (vr.status === 'valid') {
      order.status = 'approved';
      order.note = '自动核验通过，已开通';
      order.encPwd = null;
    } else if (vr.status === 'invalid') {
      const rv = await revokeVipDays(env, user, planDays, g.grantBefore, g.grantAfter);
      order.status = 'rejected';
      order.vipUntil = rv.vipUntil || null;
      order.note = '自动核验未通过，已撤销：' + (vr.reason || '卡密无效');
      order.encPwd = null;
    } else if (vr.status === 'error') {
      order.note = '自动核验接口异常，已开通并转人工复核：' + (vr.reason || '');
    }
  }

  await saveOrder(env, order);

  // 新订单通知：仅「待人工复核」时推送，自动核验已判定的不打扰站长
  if (order.status === 'active' && order.mode === 'manual') {
    scheduleNotify(context, env, order, { adminUrl: new URL('/vip', request.url).origin + '/vip' });
  }

  return json({
    ok: true,
    order: publicOrder(order),
    message: order.status === 'approved'
      ? '兑换成功，会员已开通'
      : order.status === 'rejected'
        ? '卡密核验未通过'
        : '兑换成功，会员已生效；管理员将复核卡密，请勿重复提交'
  });
}
