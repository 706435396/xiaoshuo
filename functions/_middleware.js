/* ============================================================
 * 深夜文库 · 全站中间件（主题注入 + 广告脚本破缓存）
 * ============================================================
 * 作用：
 *   1. 对所有 HTML 响应注入 <link rel="stylesheet" href="/theme.css">，
 *      让 1505 个静态书页 / 分类页 / 合规页无需逐个改动即可统一换肤。
 *   2. 把页面里 /adboot.js、/adfoot.js 的引用加上版本号 ?v=5，强制破 CF 边缘缓存
 *      （源脚本已更新为"停用写死联盟广告"，但旧 URL 被 CDN 缓存 HIT 拿到旧版）。
 *   3. 全站注入 /popunder.js（首次访问新标签弹窗广告），幂等、只注一次。
 *
 * 设计要点：
 *   1. 只处理 content-type 含 text/html 的响应，API / JSON / 图片直接放行。
 *   2. 用 original.clone() 兜底：任何异常都返回原响应，绝不让中间件拖垮站点。
 *   3. 主题注入与脚本破缓存各自独立，互不因对方的 early-return 跳过。
 * ============================================================ */
const THEME_TAG = '<link rel="stylesheet" href="/theme.css" data-sy-theme="1">';
const AD_VER = '5'; // 升级此值即可全站强制刷新 adboot/adfoot 脚本缓存（v5: 彻底关闭 Popunder 弹窗）
const ADSLOTS_VER = '5'; // adslots.js 渲染器版本（atOptions 绝对定位防撑开侧栏）；升级即全站破缓存
const POPUNDER_VER = '1'; // 弹窗脚本版本；升级即全站破缓存
const POPUNDER_TAG = '<script src="/popunder.js?v=' + POPUNDER_VER + '" data-sy-pop="1"><\/script>';

export async function onRequest(context) {
  const { next } = context;
  const original = await next();

  const ct = (original.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('text/html')) return original;

  // 消费前先留一份完整副本，出错时原样返回
  const fallback = original.clone();

  try {
    let html = await original.text();
    if (!html) return fallback;

    // --- 1) 广告脚本破缓存：给无版本号的引用加 ?v=N（幂等：已带 ? 的跳过） ---
    html = html
      .replace(/(["'])(\/adboot\.js)(?!\?)/g, '$1$2?v=' + AD_VER)
      .replace(/(["'])(\/adfoot\.js)(?!\?)/g, '$1$2?v=' + AD_VER)
      // adslots.js 首页写死 ?v=2、ads.js 看书页无版本号，统一加/升级版本号破缓存
      .replace(/(["'])(\/adslots\.js)(\?v=\d+)?/g, '$1$2?v=' + ADSLOTS_VER)
      .replace(/(["'])(\/ads\.js)(?!\?)/g, '$1$2?v=' + ADSLOTS_VER);

    // --- 2) 主题注入：无 </head> 或页面已自带标记则跳过注入 ---
    if (!html.includes('data-sy-theme') && /<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, THEME_TAG + '\n</head>');
    }

    // --- 3) 弹窗脚本注入：无 </body> 或页面已带标记则跳过（幂等） ---
    if (!html.includes('data-sy-pop') && /<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, POPUNDER_TAG + '\n</body>');
    }

    const headers = new Headers(original.headers);
    headers.set('content-type', 'text/html; charset=utf-8');

    return new Response(html, {
      status: original.status,
      statusText: original.statusText,
      headers
    });
  } catch (e) {
    return fallback;
  }
}
