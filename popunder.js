/* 深夜文库 · 插屏弹窗渲染器（Adsterra Interstitial · 首次访问弹一次）
 * ============================================================
 * 需求：每个访客首次访问触发一次【插屏广告】——即截图那种居中弹窗、
 *       带图标/星级/商品图/右上角关闭按钮、背景遮罩的样式。
 *       这类广告是 Adsterra 的 Interstitial 格式，代码由联盟后台生成，
 *       每个广告位唯一，因此做成【后台可配置】：在 /admin-ads 的
 *       「插屏弹窗」标签粘贴联盟 <script> 代码即可，随时可换、无需改本站代码。
 *
 * 实现：
 *   1. 读取 /api/adslots 的 zones.interstitial，取第一个 enabled && value 非空
 *      的广告位（只弹一个，避免多个插屏叠加互相遮挡）。
 *   2. localStorage 门控：同一浏览器终身只加载一次（KEY=sy_pop_done_v1，
 *      沿用旧 key，已弹过的老访客不会重复弹）。
 *   3. HTML 代码写入隐藏容器后重建其中的 <script> 以触发执行——这是
 *      动态注入联盟脚本的标准可靠做法（innerHTML 里的 script 不会自动执行）。
 *      联盟脚本自己负责渲染居中弹窗、遮罩、关闭按钮及落地页跳转。
 *
 * 调试：URL 带 ?adpreview=时间戳 时强制跳过门控（供后台「预览三端」反复查看）。
 * ============================================================
 */
(function () {
  'use strict';

  var KEY = 'sy_pop_done_v1';
  var API = '/api/adslots';

  // 后台预览模式：URL 带 adpreview 参数时绕过门控，便于反复查看插屏效果
  var previewMode = /[?&]adpreview=/.test(location.search);

  function alreadyFired() {
    if (previewMode) return false;
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function markFired() {
    if (previewMode) return;
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
  }

  // 把联盟 HTML 代码里的 script 重建以触发执行（与 adslots.js 同一成熟做法）
  function injectHtml(html) {
    // 用隐藏容器承载，避免污染页面结构；联盟插屏脚本通常自行创建全屏 fixed 弹层，
    // 本容器仅作为脚本宿主，不参与展示。
    var box = document.createElement('div');
    box.setAttribute('data-sy-interstitial', '1');
    box.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    box.innerHTML = html;
    var scripts = [].slice.call(box.querySelectorAll('script'));
    scripts.forEach(function (o) {
      var s = document.createElement('script');
      for (var i = 0; i < o.attributes.length; i++) s.setAttribute(o.attributes[i].name, o.attributes[i].value);
      s.textContent = o.textContent;
      o.parentNode.replaceChild(s, o);
    });
    (document.body || document.documentElement).appendChild(box);
  }

  function fire(slot) {
    if (!slot || !slot.value) return;
    if (alreadyFired()) return;
    markFired(); // 先写门控再注入，避免脚本重复加载/多次弹
    injectHtml(slot.value);
  }

  function loadAndFire() {
    fetch(API + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d && d.zones && d.zones.interstitial) || [];
        // 只取第一个启用且有内容的插屏位
        var slot = null;
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].enabled && list[i].value) { slot = list[i]; break; }
        }
        fire(slot);
      })
      .catch(function () { /* 后台不可用：静默，不影响阅读 */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAndFire, { once: true });
  } else {
    loadAndFire();
  }
})();
