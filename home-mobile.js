/* ============================================================
 * 深夜文库 · 手机首页体验增强（shenye.72tool.com）
 * 注入方式：functions/_middleware.js 全站注入，仅首页生效（靠 #catBar/#mobileShelf 判定）。
 *
 * 解决的问题（手机截图反馈）：
 *   1. 「我的书架」卡片看着像空的：#shelfBody 默认带 hidden，要手动点标题才展开。
 *      → 手机端默认展开；为空时给一句引导（点书右上角 ♥ 收藏即出现在这里）。
 *      仍保留点击折叠/展开；用户主动折叠过则记住本次会话状态，不再自动展开。
 *   2. 分类横滑末端「免费」被裁、看着像没滑到底：给 #catBar 加渐隐遮罩提示可横滑，
 *      并在滑到末端时淡出提示。纯 DOM/CSS，不改分类数据。
 *   3. 顶部「登录」按钮被挤出屏幕：由 mobile-adapt.css 负责压缩 header 间距。
 *
 * 原则：只做展示层增强，不动 index.html 逻辑、不动广告位、不动内容/分类数据。
 * ============================================================ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // 首页判定：分类横滑条 + 移动书架同时存在
  if (!$('catBar') || !$('mobileShelf')) return;

  // ---------- 1) 书架：手机端默认展开 ----------
  var SHELF_SESSION_KEY = 'sy_shelf_collapsed_session';
  function initShelf() {
    var body = $('shelfBody'), arrow = $('shelfArrow'), toggle = $('shelfToggle');
    if (!body || !toggle) return;

    // 用户本次会话内主动折叠过 → 尊重折叠，不自动展开
    var userCollapsed = false;
    try { userCollapsed = sessionStorage.getItem(SHELF_SESSION_KEY) === '1'; } catch (e) {}

    if (!userCollapsed && body.classList.contains('hidden')) {
      body.classList.remove('hidden');
      if (arrow) arrow.style.transform = 'rotate(90deg)';
    }

    // 保留/接管点击：记录折叠状态到 sessionStorage
    // 注意：本监听器在 index.html 原监听器之后执行，读到的已是切换后的最终状态
    toggle.addEventListener('click', function () {
      var hidden = body.classList.contains('hidden');
      try { sessionStorage.setItem(SHELF_SESSION_KEY, hidden ? '1' : '0'); } catch (e) {}
    });

    // 空书架引导：等 renderShelf 填充后，若两块都是「暂无」则加一句引导
    observeEmptyShelf(body);
  }

  function observeEmptyShelf(body) {
    var GUIDE_ID = 'syShelfGuide';
    function maybeGuide() {
      var txt = body.textContent || '';
      var hasReal = body.querySelector('a[href^="read.html"]'); // 有真实书链接即非空
      var old = $(GUIDE_ID);
      if (hasReal) { if (old) old.remove(); return; }
      if (txt.indexOf('暂无') < 0) return; // renderShelf 还没跑，等下次
      if (old) return;
      var g = document.createElement('div');
      g.id = GUIDE_ID;
      g.style.cssText = 'margin-top:10px;padding:8px 10px;border-radius:8px;' +
        'background:rgba(255,149,0,.08);border:1px dashed rgba(255,149,0,.35);' +
        'color:#b9a989;font-size:12px;line-height:1.6';
      g.innerHTML = '💡 书架还是空的 —— 点书单右上角 <b style="color:#ff9500">♥</b> 收藏，或给书打个分，就会出现在这里。';
      body.appendChild(g);
    }
    // 轮询等 renderShelf（fetch books.json 是异步的）
    var tries = 0;
    var t = setInterval(function () {
      maybeGuide();
      if ($(GUIDE_ID) || ++tries > 60) clearInterval(t); // 最多 ~6s
    }, 100);
    // DOM 变化时也检查一次（收藏/评分后刷新）
    if (window.MutationObserver) {
      new MutationObserver(maybeGuide).observe(body, { childList: true, subtree: true });
    }
  }

  // ---------- 2) 分类横滑：渐隐遮罩 + 滑到末端淡出提示 ----------
  function initCatFade() {
    var bar = $('catBar');
    if (!bar) return;
    var holder = bar.parentNode;
    if (!holder || $(('syCatFade'))) return;

    var fade = document.createElement('div');
    fade.id = 'syCatFade';
    fade.setAttribute('aria-hidden', 'true');
    fade.style.cssText = 'position:absolute;top:0;right:0;width:34px;height:100%;' +
      'pointer-events:none;z-index:2;background:linear-gradient(to right,rgba(0,0,0,0),#12121a);' +
      'opacity:.9;transition:opacity .2s';

    // 保证定位上下文（不改原有 class，仅补 position）
    var cs = getComputedStyle(holder);
    if (cs.position === 'static') holder.style.position = 'relative';
    holder.insertBefore(fade, bar.nextSibling);

    function updateFade() {
      var atEnd = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 4;
      fade.style.opacity = atEnd ? '0' : '.9';
    }
    bar.addEventListener('scroll', updateFade, { passive: true });
    window.addEventListener('resize', updateFade, { passive: true });
    updateFade();
  }

  function init() {
    initShelf();
    initCatFade();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
