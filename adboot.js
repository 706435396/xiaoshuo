/* 深夜文库 · 广告集中配置（解析期写入层）
 * ============================================================
 * 用 document.write 在 HTML 解析期写入广告，必须同步加载（勿 defer/async 本文件）。
 *
 * 【全站广告已迁移到后台 /admin-ads 统一管理】
 *   首页由 adslots.js 渲染三区，看书页由 ads.js 渲染 reader-top/bottom 两区。
 *   本文件与 adfoot.js 写死的联盟广告已全部停用（ENABLED=false），
 *   避免与后台投放重复、遮挡阅读。下方联盟代码保留，日后若要恢复把 ENABLED 改 true 即可。
 *
 * 【总开关】ENABLED=false → 全站停用本文件所有写死联盟广告（当前状态）
 * 【格式开关】FORMAT 各项单独控制；总开关关闭时无效
 * 【Popunder】popunder=false → 弹窗广告已彻底关闭（即使日后恢复总开关也不会弹）
 * ============================================================
 */
(function () {
  'use strict';

  // 全站写死联盟广告总开关：false = 全部停用，广告只由后台 /admin-ads 投放
  var ENABLED = false;
  var FORMAT = {
    popunder: false, // 已彻底关闭 Popunder 弹窗（用户要求）；如需恢复改 true 并同步升级中间件 AD_VER
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

  // 首页广告（含浮层）已全部改为后台配置：/admin-ads.html + adslots.js
  // 首页不再写入任何联盟脚本，避免与后台投放重复或遮挡。
  if (isHome) return;

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
