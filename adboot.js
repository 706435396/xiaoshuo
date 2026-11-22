/* 深夜文库 · 广告集中配置（解析期写入层）
 * ============================================================
 * 所有 Adsterra 广告集中在此文件，用 document.write 在 HTML 解析期写入，
 * 不能用 defer/async 或 innerHTML 注入（否则不计数 / 不显示）。
 * 本文件必须 <script src="/adboot.js"></script> 同步加载。
 *
 * 【总开关】ENABLED=false → 全站广告关闭
 * 【单格式开关】FORMAT 对应项改 false
 * 【Popunder】首次访问弹一次（localStorage 门控，终身一次）
 *   浏览器禁止无手势自动弹窗，联盟脚本在"首次点击页面任意处"时弹出；
 *   这里用 localStorage 保证之后所有访问都不再加载，实现"就弹一次"。
 *   想彻底关闭：FORMAT.popunder 改 false。
 * 【位置编排】见 adfoot.js 末尾 placeAds()
 * 【300×250】已关闭（juicy=false，2026-11-22 用户要求）
 * ============================================================
 */
(function () {
  'use strict';

  // 全站总开关
  var ENABLED = true;

  // 单格式开关
  var FORMAT = {
    popunder: true,  // 首次访问弹一次；想彻底关闭改 false
    native:   true,  // 原生信息流（首页书单第 6 条后）
    social:   true,  // 社交栏浮层（阅读页不加载）
    banner:   true,  // 320×50（在 adfoot.js 写入）
    juicy:    false  // 300×250：已关闭（2026-11-22）
  };

  // Popunder 一次性门控：同一浏览器只在首次访问加载弹窗脚本
  var POP_KEY = 'sy_pop_done_v1';

  window.SY_AD_CONFIG = { enabled: ENABLED, format: FORMAT };
  if (!ENABLED) return;

  var path = location.pathname || '/';
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

  // 2) Native 原生：阅读页不投放（无列表场景，避免干扰正文）
  if (FORMAT.native && !isReader) {
    w(ext('https://bauval.org/21/c13d2e7fdaaf75d273ad382b3a8dba11', 'async="async"'));
    // 外层 id 供编排脚本搬移；内层 container id 供联盟脚本填充
    w('<div id="syAdNative" class="sy-ad-float"><div id="container-c13d2e7fdaaf75d273ad382b3a8dba11"></div></div>');
  }

  // 3) Social Bar 浮层：阅读页不加载（会遮挡正文）
  if (FORMAT.social && !isReader) {
    w(ext('https://bauval.org/14/07158b53e5f5830c39ffe2a59f9e3b25'));
  }
})();
