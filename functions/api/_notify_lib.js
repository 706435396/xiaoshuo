// 新订单通知适配器：多渠道并推，任一渠道失败不影响兑换提交。
// 支持渠道（环境变量，填哪个启用哪个，可同时启用多个）：
//   TG_BOT_TOKEN + TG_CHAT_ID        → Telegram Bot 私信
//   SERVERCHAN_KEY                   → Server酱³（微信服务号推送，国内最省事）
//   RESEND_API_KEY + NOTIFY_FROM + NOTIFY_TO  → 邮件（Resend）
//   NOTIFY_WEBHOOK_URL               → 自定义 Webhook（钉钉/企微/飞书/Bark/n8n 通用 JSON）
// 安全：通知内容只含脱敏信息，绝不包含卡密；卡密仍需登录管理后台解密查看。
// 使用 context.waitUntil 后台推送，不阻塞用户提交响应。

function fmtTime(ms) {
  try { return new Date(ms + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' (北京时间)'; }
  catch { return String(ms); }
}

// 构造纯文本消息（各渠道共用）
export function buildMessage(order, opts = {}) {
  const title = opts.title || '🔔 深夜文库 · 新兑换订单';
  const adminUrl = opts.adminUrl || 'https://shenye.72tool.com/vip';
  const planName = { 365: '年卡' }[order.planDays] || (order.planDays + '天');
  const statusText = { active: '已开通·待复核', pending: '待复核', approved: '已通过', rejected: '已驳回撤销' }[order.status] || order.status;
  const lines = [
    title,
    '',
    '订单号：' + order.id,
    '用户：' + order.user,
    '套餐：' + planName + '（' + order.planDays + ' 天）',
    '卡号：' + order.cardMask,
    '状态：' + statusText,
    '时间：' + fmtTime(order.created || Date.now()),
    '',
    '会员已先行为用户开通。👉 请登录后台复核卡密：' + adminUrl,
    '',
    '（出于安全，卡密不在通知中显示，请在后台点「查看卡密」解密；无效卡请点「驳回」撤销会员）'
  ];
  return { title, text: lines.join('\n'), adminUrl, order };
}

// 飞书签名：stringToSign = timestamp + "\n" + secret 作为 HMAC 密钥，对空串签名后 Base64
async function feishuSign(secret) {
  const ts = String(Math.floor(Date.now() / 1000));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(ts + '\n' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(''));
  const sign = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return { timestamp: ts, sign };
}

// 飞书卡片消息（带一键打开后台按钮）
function feishuCard(msg) {
  const o = msg.order || {};
  const planName = ({ 365: '年卡' })[o.planDays] || (o.planDays ? o.planDays + ' 天' : '—');
  const statusText = { active: '已开通·待复核', approved: '已通过', rejected: '已驳回撤销' }[o.status] || '';
  const content = [
    '**订单号**：' + (o.id || '—'),
    '**用户**：' + (o.user || '—'),
    '**套餐**：' + planName,
    '**卡号**：' + (o.cardMask || '—'),
    '**状态**：' + (statusText || '—'),
    '**时间**：' + fmtTime(o.created || Date.now())
  ].join('\n');
  const elements = [{ tag: 'div', text: { tag: 'lark_md', content } }];
  if (msg.adminUrl) {
    elements.push({
      tag: 'action',
      actions: [{ tag: 'button', text: { tag: 'plain_text', content: '打开后台复核' }, url: msg.adminUrl, type: 'primary' }]
    });
  }
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: '会员已先行开通；卡密不在通知内显示，请在后台复核，无效卡点「驳回」撤销' }] });
  return { msg_type: 'interactive', card: { config: { wide_screen_mode: true }, header: { title: { tag: 'plain_text', content: msg.title }, template: 'orange' }, elements } };
}

async function post(url, init, timeoutMs = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Telegram
async function sendTelegram(env, msg) {
  const token = env.TG_BOT_TOKEN, chat = env.TG_CHAT_ID;
  if (!token || !chat) return null;
  const res = await post(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: msg.text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  return 'telegram:' + res.status;
}

// Server酱³（微信）
async function sendServerchan(env, msg) {
  const key = env.SERVERCHAN_KEY;
  if (!key) return null;
  const body = new URLSearchParams({ title: msg.title, desp: msg.text });
  const res = await post(`https://sctapi.ftqq.com/${key}.send`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  return 'serverchan:' + res.status;
}

// 邮件（Resend）
async function sendEmail(env, msg) {
  const key = env.RESEND_API_KEY, from = env.NOTIFY_FROM, to = env.NOTIFY_TO;
  if (!key || !from || !to) return null;
  const res = await post('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({
      from,
      to: to.split(/[,;]/).map(s => s.trim()).filter(Boolean),
      subject: msg.title,
      text: msg.text
    })
  });
  return 'email:' + res.status;
}

// 自定义 Webhook：根据 URL 自动适配钉钉/企微/飞书，否则发通用 JSON
async function sendWebhook(env, msg) {
  const url = env.NOTIFY_WEBHOOK_URL;
  if (!url) return null;
  let body;
  if (url.includes('oapi.dingtalk.com')) {
    body = JSON.stringify({ msgtype: 'text', text: { content: msg.text } });
  } else if (url.includes('qyapi.weixin.qq.com')) {
    body = JSON.stringify({ msgtype: 'text', text: { content: msg.text.slice(0, 2048) } });
  } else if (url.includes('open.feishu.cn')) {
    const payload = feishuCard(msg);
    // 飞书若开启了签名校验，必须带 timestamp + sign（密钥 FEISHU_SECRET）
    if (env.FEISHU_SECRET) Object.assign(payload, await feishuSign(env.FEISHU_SECRET));
    body = JSON.stringify(payload);
  } else {
    body = JSON.stringify({ title: msg.title, text: msg.text, type: 'new-redeem' });
  }
  const res = await post(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  return 'webhook:' + res.status;
}

// 主入口：并发推送所有已配置渠道，返回发送结果数组（供自验/排查）
export async function notifyNewOrder(env, order, opts) {
  const msg = buildMessage(order, opts);
  const jobs = [sendTelegram, sendServerchan, sendEmail, sendWebhook].map(fn =>
    fn(env, msg).catch(e => 'error:' + (e && e.message || e))
  );
  const results = await Promise.all(jobs);
  const sent = results.filter(x => x && !String(x).startsWith('error:'));
  const failed = results.filter(x => x && String(x).startsWith('error:'));
  if (!sent.length && !failed.length) console.log('[notify] 未配置任何通知渠道，跳过');
  else console.log('[notify] 已推送：' + sent.join(', ') + (failed.length ? '；失败：' + failed.join(', ') : ''));
  return sent; // 仅返回成功送达的渠道，失败项只记日志
}

// 在 Pages Function 中用 waitUntil 后台推送，不阻塞响应
export function scheduleNotify(context, env, order, opts) {
  const p = notifyNewOrder(env, order, opts);
  if (context && typeof context.waitUntil === 'function') context.waitUntil(p);
  // 无 context（如本地自验）时也不 await，避免拖慢；由调用方自行决定是否 await
  return p;
}
