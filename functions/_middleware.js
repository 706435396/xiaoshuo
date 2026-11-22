/* ============================================================
 * 深夜文库 · 全站主题注入中间件
 * ============================================================
 * 作用：对所有 HTML 响应注入 <link rel="stylesheet" href="/theme.css">，
 * 让 1505 个静态书页 / 分类页 / 合规页无需逐个改动即可统一换肤。
 *
 * 设计要点：
 *   1. 只处理 content-type 含 text/html 的响应，API / JSON / 图片直接放行。
 *   2. 用 original.clone() 兜底：任何异常都返回原响应，绝不让主题层拖垮站点。
 *   3. 检测 data-sy-theme 标记，避免重复注入（页面自己已引入时跳过）。
 *   4. 注入点选在 </head> 之前——放在页面内联 <style> 之后，保证覆盖顺序。
 * ============================================================ */
const THEME_TAG = '<link rel="stylesheet" href="/theme.css" data-sy-theme="1">';

export async function onRequest(context) {
  const { next } = context;
  const original = await next();

  const ct = (original.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('text/html')) return original;

  // 消费前先留一份完整副本，出错时原样返回
  const fallback = original.clone();

  try {
    const html = await original.text();
    if (!html || html.includes('data-sy-theme') || !/<\/head>/i.test(html)) {
      return fallback;
    }

    const out = html.replace(/<\/head>/i, THEME_TAG + '\n</head>');
    const headers = new Headers(original.headers);
    // 主题为静态资源，短缓存即可；页面本身缓存策略由 _headers 决定
    headers.set('content-type', 'text/html; charset=utf-8');

    return new Response(out, {
      status: original.status,
      statusText: original.statusText,
      headers
    });
  } catch (e) {
    return fallback;
  }
}
