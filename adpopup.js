/* 深夜文库 · 站内广告浮窗拦截器
 * ============================================================
 * 需求：联盟广告原本会「在当前标签跳转到广告落地页」，打断阅读。
 *       改成：在原网站内弹出一个小浮窗（iframe 加载广告落地页），
 *       用户可随时手动关闭，页面不跳走、阅读不中断。
 *
 * 工作原理：
 *   1. 劫持 window.open：联盟脚本/popunder 调用 window.open(url) 时，
 *      不真正打开新标签，改成站内浮窗 iframe 打开。
 *   2. 拦截页面里 <a target=_blank> 的外站广告链接点击，改成浮窗。
 *   3. 拦截 baidu/其它联盟常见的 location 跳转：捕获 document 上的点击，
 *      若是外站广告链接则 preventDefault + 浮窗。
 *   4. 对外暴露 window.SYFloat.open(url) / close()，供其它脚本主动调用。
 *
 * 说明：只拦截「外站 http(s)」链接，站内跳转 (含 agegate 的 about:blank) 放行。
 *       浮窗带关闭按钮 + 可拖动 + 手机自适应，z-index 低于年龄门。
 * ============================================================
 */
(function () {
  'use strict';

  var HOST = location.hostname;
  var zIndex = 99990; // 低于年龄门(99999)，高于普通内容
  var cur = null;      // 当前浮窗
  var MAX_W = 380, MAX_H = 640;

  function isExternal(url) {
    if (!url) return false;
    var s = String(url);
    if (!/^https?:\/\//i.test(s)) return false; // about:blank / javascript: / 相对路径放行
    try {
      var u = new URL(s, location.href);
      if (u.hostname === HOST) return false;
      // 允许本站的兄弟子域（如 72tool.com 主域自身不算外站广告）
      return true;
    } catch (e) { return false; }
  }

  function close() {
    if (cur && cur.parentNode) cur.parentNode.removeChild(cur);
    cur = null;
  }

  function open(url, opt) {
    opt = opt || {};
    close();
    // 手机判断：UA 优先（横屏 phones 也不误判），或以 CSS 视口宽度为准
    var uaMobile = /android|iphone|ipad|ipod|mobile|windows phone/i.test(navigator.userAgent || '');
    var mobile = uaMobile || window.innerWidth <= 640;
    var vw = window.innerWidth, vh = window.innerHeight;
    var wrap = document.createElement('div');
    wrap.setAttribute('data-sy-floatbox', '1');
    wrap.style.cssText = 'position:fixed;z-index:' + zIndex + ';background:#12121a;' +
      'border:1px solid rgba(167,139,250,.5);border-radius:12px;overflow:hidden;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    if (mobile) {
      // 手机：底部抽屉式全宽（与安全区适配），贴合手机浏览习惯
      var w = vw - 16;
      var h = Math.round(vh * 0.8);
      wrap.style.cssText += ';left:8px;right:8px;width:' + w + 'px;height:' + h + 'px;' +
        'top:auto;bottom:calc(8px + env(safe-area-inset-bottom,0px));border-radius:14px';
    } else {
      wrap.style.cssText += ';width:' + MAX_W + 'px;height:' + MAX_H + 'px;right:20px;bottom:20px';
    }

    // 标题栏（可拖动）
    var bar = document.createElement('div');
    bar.style.cssText = 'height:38px;display:flex;align-items:center;gap:8px;padding:0 10px;' +
      'background:rgba(167,139,250,.14);color:#c4b5fd;font-size:12px;cursor:move;user-select:none';
    var label = document.createElement('span');
    label.textContent = opt.title || '赞助内容';
    label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '✕';
    btn.setAttribute('aria-label', '关闭广告');
    btn.style.cssText = 'border:0;background:rgba(255,255,255,.08);color:#e8e8e8;font-size:14px;' +
      'width:26px;height:26px;line-height:26px;border-radius:6px;cursor:pointer';
    btn.onmouseenter = function () { btn.style.background = 'rgba(239,68,68,.5)'; };
    btn.onmouseleave = function () { btn.style.background = 'rgba(255,255,255,.08)'; };
    btn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); close(); };
    bar.appendChild(label);
    bar.appendChild(btn);
    wrap.appendChild(bar);

    var frame = document.createElement('iframe');
    frame.setAttribute('scrolling', 'yes');
    frame.setAttribute('allow', 'autoplay; fullscreen');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.style.cssText = 'display:block;width:100%;height:calc(100% - 38px);border:0;background:#fff';
    frame.src = String(url);
    wrap.appendChild(frame);

    (document.body || document.documentElement).appendChild(wrap);
    cur = wrap;

    // 桌面端拖动
    if (!mobile) {
      (function () {
        var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
        bar.addEventListener('mousedown', function (e) {
          if (e.target === btn) return;
          dragging = true;
          var r = wrap.getBoundingClientRect();
          wrap.style.left = r.left + 'px'; wrap.style.top = r.top + 'px';
          wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
          sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
          e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
          if (!dragging) return;
          wrap.style.left = Math.max(0, Math.min(window.innerWidth - wrap.offsetWidth, ox + e.clientX - sx)) + 'px';
          wrap.style.top = Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy)) + 'px';
        });
        document.addEventListener('mouseup', function () { dragging = false; });
      })();
    }
  }

  // --- 1) 劫持 window.open：默认外站改浮窗；受控 Popunder 临时放行新标签 ---
  var realOpen = window.open;
  function fakeWindow() {
    return {
      closed: false, location: { href: '' },
      focus: function () {}, blur: function () {}, close: function () { this.closed = true; },
      moveTo: function () {}, resizeTo: function () {}, scrollTo: function () {}
    };
  }
  window.open = function (u, name, specs) {
    // 预加载受控脚本期间屏蔽自动弹窗：绝不页面加载即跳/即浮窗
    if (window.__SY_SUPPRESS_EXTERNAL_OPEN__) return fakeWindow();
    // controlled-ads.js 只在 PC 受控 Popunder 注入期间打开此开关：
    // 让联盟代码真实开新标签，但返回假句柄，避免它把新窗口 focus 到前台。
    if (window.__SY_ALLOW_NATIVE_TAB__) {
      var args = Array.prototype.slice.call(arguments);
      // 强制新标签：即使联盟脚本传了 _self/_top，也绝不替换当前小说窗口。
      if (!args[1] || args[1] === '_self' || args[1] === '_parent' || args[1] === '_top') args[1] = '_blank';
      if (typeof args[2] === 'string') args[2] += ',noopener,noreferrer';
      else args[2] = 'noopener,noreferrer';
      try {
        realOpen.apply(window, args);
        window.__SY_NATIVE_TAB_OPENED__ = (window.__SY_NATIVE_TAB_OPENED__ || 0) + 1;
      } catch (e) {}
      return fakeWindow();
    }
    if (isExternal(u)) {
      open(String(u));
      return fakeWindow();
    }
    return realOpen.apply(window, arguments);
  };

  // --- 2) 拦截外站 <a target=_blank> 点击（捕获阶段，抢在联盟之前）---
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t.nodeType !== 1 && t.parentNode) t = t.parentNode;
    if (!t || !t.closest) return;
    var a = t.closest('a');
    if (!a) return;
    // 受控 Direct Link：用户明确点击「新标签打开」，必须绕过浮窗拦截。
    if (a.hasAttribute('data-sy-newtab') || a.hasAttribute('data-sy-controlled-direct')) return;
    if (window.__SY_SUPPRESS_EXTERNAL_OPEN__) return;
    var href = a.getAttribute('href') || '';
    if (!isExternal(href)) return; // 站内/非http 放行
    var blank = a.target === '_blank' || a.getAttribute('target') === '_blank';
    // 外站链接（无论是否 _blank）都改浮窗，避免同标签跳走
    if (blank || /^https?:\/\//i.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      open(href);
    }
  }, true);

  // --- 对外 API ---
  window.SYFloat = {
    open: function (u, o) { if (isExternal(u)) open(String(u), o); },
    close: close,
    isOpen: function () { return !!cur; }
  };
})();
