/* 深夜文库 · 广告集中配置（解析期写入层）
 * ============================================================
 * 用 document.write 在 HTML 解析期写入广告，必须同步加载（勿 defer/async 本文件）。
 *
 * 【首页】（/ 或 /index.html）
 *   320×50 / 300×250 / Native 三个格子广告已改为「官方代码静态写进 index.html 格子」，
 *   解析期天然落到格内，不再靠事后搬运。因此本文件在首页跳过这三者，只保留：
 *     - Popunder（首次弹一次门控）
 *     - Social Bar（浮层，不占格子）
 *
 * 【书页 / 章节页】本文件照常写 300×250 + Native + Social Bar；adfoot.js 写 320×50。
 * 【阅读页】只写 Popunder；320×50 由 adfoot.js 搬到正文下方（见 adfoot.js）。
 *
 * 【总开关】ENABLED=false → 关闭本文件涉及的浮层广告
 * 【格式开关】FORMAT 各项改 false 即关闭对应广告
 * ============================================================
 */
(function () {
  'use strict';

  var ENABLED = true;
  var FORMAT = {
    popunder: true,  // 首次访问弹一次；想彻底关闭改 false
    native:   true,  // 原生（书页/章节页；首页已静态写、阅读页不投）
    social:   true,  // 社交栏浮层（首页/书页/章节页；阅读页不加载避免遮挡正文）
    banner:   true,  // 320×50（在 adfoot.js 写入；首页已静态写）
    juicy:    true   // 300×250（书页/章节页；首页已静态写、阅读页不投）
  };

  // Popunder 一次性门控：同一浏览器只在首次访问加载弹窗脚本
  var POP_KEY = 'sy_pop_done_v1';

  window.SY_AD_CONFIG = { enabled: ENABLED, format: FORMAT };
  if (!ENABLED) return;

  var path = location.pathname || '/';
  var isHome = /^\/(index\.html)?$/.test(path);
  var isReader = /^\/read(\.html)?$/.test(path);

  function w(s) { document.write(s); }
  function ext(url, extra) {
    return '<script ' + (extra || '') + ' data-cfasync="false" src="' + url + '"><\/script>';
  }

  // 1) Popunder：仅首次访问加载；弹窗由联盟脚本在首次交互时触发
  if (FORMAT.popunder) {
    var firstVisit = true;
    try { firstVisit = !localStorage.getItem(POP_KEY); } catch (e) {}
    if (firstVisit) {
      try { localStorage.setItem(POP_KEY, '1'); } catch (e) {}
      w(ext('https://abscloud.org/1/0af312921b8958cf650f130cb9ee40f7'));
    }
  }

  // 2) 300×250 中矩形（JuicyAds）：仅书页/章节页（首页已静态写进格子、阅读页不投）
  if (FORMAT.juicy && !isHome && !isReader) {
    w(ext('https://poweredby.jads.co/js/jads.js', 'async="async"'));
    w('<div id="syAdRect"><ins id="1133796" data-width="300" data-height="250"></ins></div>');
    w('<script>(adsbyjuicy=window.adsbyjuicy||[]).push({adzone:1133796});<\/script>');
  }

  // 3) Native 原生：仅书页/章节页（首页已静态写进格子、阅读页不投）
  if (FORMAT.native && !isHome && !isReader) {
    w(ext('https://bauval.org/21/c13d2e7fdaaf75d273ad382b3a8dba11', 'async="async"'));
    w('<div id="syAdNative"><div id="container-c13d2e7fdaaf75d273ad382b3a8dba11"></div></div>');
  }

  // 4) Social Bar 浮层：脚本自身悬浮在页面边缘，不占格子（阅读页不加载）
  if (FORMAT.social && !isReader) {
    w(ext('https://bauval.org/14/07158b53e5f5830c39ffe2a59f9e3b25'));
  }
})();
