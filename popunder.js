/* 深夜文库 · Popunder 弹窗广告（首次访问 · 新标签页打开）
 * ============================================================
 * 需求：每个访客首次访问触发一次广告，广告在【新标签页】打开，
 *       当前小说页面留在原标签、不跟着跳转到广告站。
 *
 * 实现：
 *   1. localStorage 门控：同一浏览器终身只加载一次（KEY=sy_pop_done_v1）。
 *   2. 加载 Adsterra Popunder 脚本（abscloud.org/1），该脚本本身即标准
 *      popunder：在用户首次交互时 window.open 一个新标签到广告落地页，
 *      原标签不动。落地页由联盟动态下发，无需固定 URL。
 *
 * 说明：浏览器禁止「无用户手势」的自动弹窗，因此广告由联盟脚本在用户
 *      首次点击/触摸页面时弹出——这是 popunder 的标准且唯一可靠实现。
 *      之前「当前页跳到飞鸟VPN」是另一个 Social Bar 脚本(bauval/14)所致，
 *      已关闭；本脚本用的 abscloud/1 是新标签弹窗，不会同标签跳转。
 * ============================================================
 */
(function () {
  'use strict';

  var KEY = 'sy_pop_done_v1';
  var SRC = 'https://abscloud.org/1/0af312921b8958cf650f130cb9ee40f7';

  // 已弹过则不再加载
  try { if (localStorage.getItem(KEY) === '1') return; } catch (e) {}
  // 先写门控，避免多次加载造成重复弹窗
  try { localStorage.setItem(KEY, '1'); } catch (e) {}

  function load() {
    var s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    (document.head || document.body).appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();
