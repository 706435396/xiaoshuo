/* ============================================================
 * 深夜文库 · 受控广告加载器（PC Popunder + 手机 Direct Link）
 * 注入方式：functions/_middleware.js 全站注入，脚本内部自行判断设备与配置。
 *
 * 目标：
 *   1. PC 受控 Popunder：
 *      - 只在桌面触发（宽屏 + fine pointer + 非移动 UA）。
 *      - 绝不页面加载自动弹；只在「退出意图」或「上一章/下一章」点击后触发。
 *      - 24 小时最多一次，且同页只注入一次。
 *      - 注入前打开 adpopup.js 的原生存根通道，确保广告开新标签，
 *        不会替换当前小说窗口。
 *   2. 手机 Direct Link：
 *      - 只在手机显示一个明确按钮：target=_blank + rel=noopener noreferrer。
 *      - 不自动弹窗、不拦截当前页面，不修改原窗口地址。
 *      - 链接/按钮文字均来自后台 /admin-ads 的 directlink 区。
 *
 * 配置来自 /api/adslots：
 *   zones.popunder[0]   -> enabled + value（官方 async script 代码或纯 script URL）
 *   zones.directlink[0] -> enabled + value/link（Direct Link 地址）+ note（按钮文字）
 * ============================================================ */
(function () {
  'use strict';

  var API = '/api/adslots';
  var POP_KEY = 'sy_pc_popunder_24h_v1';
  var POP_SESSION_KEY = 'sy_pc_popunder_session_v1';
  var COOLDOWN = 24 * 60 * 60 * 1000;
  var MIN_DWELL = 10000; // 最少停留 10 秒才允许退出意图触发
  var pageStart = Date.now();

  var ageOk = !!window.__SY_AGE_OK__;
  var config = null;
  var inited = false;
  var popInjected = false;
  var popTriggering = false;
  var popTriggeredThisPage = false;
  var directShown = false;
  var preview = /[?&]adpreview=/.test(location.search || '');

  function $(id) { return document.getElementById(id); }
  function now() { return Date.now(); }
  function gateActive() { return !!document.getElementById('agegate'); }

  function isMobileLike() {
    var ua = navigator.userAgent || '';
    if (/android|iphone|ipad|ipod|mobile|windows phone|harmony/i.test(ua)) return true;
    try { if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true; } catch (e) {}
    return (window.innerWidth || 0) <= 768;
  }
  function isDesktopLike() {
    if (isMobileLike()) return false;
    if ((window.innerWidth || 0) < 1024) return false;
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return false;
    } catch (e) {}
    return true;
  }
  function safeUrl(v) {
    var s = String(v == null ? '' : v).trim();
    if (!/^https?:\/\//i.test(s)) return '';
    return s;
  }
  function safeText(v, max) {
    var s = String(v == null ? '' : v).replace(/[<>\r\n]+/g, ' ').trim();
    return s.slice(0, max || 20) || '赞助本站';
  }
  function firstSlot(zone) {
    var list = (config && config.zones && config.zones[zone]) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].enabled && (list[i].value || list[i].link)) return list[i];
    }
    return null;
  }

  // 年龄门通过后才能初始化广告，避免联盟脚本劫持「我已满18岁」那次点击。
  document.addEventListener('sy:age-ok', function () {
    ageOk = true;
    if (config) initByDevice();
  });

  function waitAgeThen(fn) {
    // 已确认、无年龄门（验证过的老访客）、或脚本兜底状态，均直接初始化。
    if (ageOk || !gateActive()) { fn(); return; }
    // 若年龄门事件丢失，最多延后 8 秒自行初始化；正常用户点击后会更早触发。
    setTimeout(function () {
      if (!ageOk && gateActive()) return;
      fn();
    }, 8000);
  }

  function loadConfig() {
    return fetch(API + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        config = d;
        waitAgeThen(initByDevice);
      })
      .catch(function () { /* 后台不可用：静默，不影响阅读 */ });
  }

  function initByDevice() {
    if (!config || inited) return;
    inited = true;
    if (isMobileLike()) initDirectLink();
    else if (isDesktopLike()) initPopunderGate();
  }

  // ---------- 手机 Direct Link 按钮：显式新标签 ----------
  function initDirectLink() {
    if (directShown) return;
    var slot = firstSlot('directlink');
    if (!slot) return;
    var url = safeUrl(slot.value || slot.link);
    if (!url) return;

    var id = 'syDirectLinkBtn';
    if ($(id)) return;
    var a = document.createElement('a');
    a.id = id;
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('data-sy-newtab', '1');
    a.setAttribute('data-sy-controlled-direct', '1');
    a.setAttribute('aria-label', '赞助本站（新标签打开）');
    a.textContent = '♡ ' + safeText(slot.note || '赞助本站', 14);
    a.style.cssText = 'position:fixed;left:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));' +
      'z-index:9960;display:flex;align-items:center;justify-content:center;min-height:42px;padding:0 14px;' +
      'border-radius:999px;border:1px solid rgba(255,149,0,.42);' +
      'background:linear-gradient(135deg,rgba(72,44,16,.95),rgba(38,27,10,.95));' +
      'color:#ffc76b;font-size:13px;font-weight:700;text-decoration:none;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.45);backdrop-filter:blur(8px);' +
      '-webkit-tap-highlight-color:transparent;user-select:none;max-width:46vw;white-space:nowrap;' +
      'overflow:hidden;text-overflow:ellipsis';
    (document.body || document.documentElement).appendChild(a);
    directShown = true;
  }

  // ---------- PC 受控 Popunder ----------
  function popAllowedByFreq() {
    if (preview) return true;
    var t = now();
    var last = 0;
    try { last = parseInt(localStorage.getItem(POP_KEY) || '0', 10) || 0; } catch (e) {}
    if (last && t - last < COOLDOWN) return false;
    try { if (sessionStorage.getItem(POP_SESSION_KEY) === '1') return false; } catch (e) {}
    return true;
  }
  function markPopFired() {
    if (preview) return;
    var t = now();
    try { localStorage.setItem(POP_KEY, String(t)); } catch (e) {}
    try { sessionStorage.setItem(POP_SESSION_KEY, '1'); } catch (e) {}
  }

  function execScripts(html, host) {
    var box = document.createElement('div');
    box.innerHTML = html;
    var scripts = [].slice.call(box.querySelectorAll('script'));
    scripts.forEach(function (old) {
      var s = document.createElement('script');
      for (var i = 0; i < old.attributes.length; i++) {
        s.setAttribute(old.attributes[i].name, old.attributes[i].value);
      }
      s.textContent = old.textContent || '';
      host.appendChild(s);
    });
    // 没有 script 但有 iframe/img 的情况（很少）：把非脚本节点也带过去
    [].slice.call(box.childNodes).forEach(function (n) {
      if (n && n.nodeType === 1 && n.tagName && n.tagName.toLowerCase() !== 'script') host.appendChild(n);
    });
  }

  // 预加载官方脚本：只注册监听器，绝不在此刻弹窗。
  function preloadPopunder(slot) {
    if (popInjected) return true;
    var code = String(slot.value || slot.link || '').trim();
    if (!code) return false;
    popInjected = true;

    var host = document.createElement('div');
    host.setAttribute('data-sy-pc-popunder', '1');
    host.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    (document.body || document.documentElement).appendChild(host);

    // 关键：预加载期间屏蔽一切外站跳转/浮窗，避免联盟脚本在页面加载后自动弹。
    window.__SY_SUPPRESS_EXTERNAL_OPEN__ = true;
    window.__SY_ALLOW_NATIVE_TAB__ = false;

    try {
      if (/^https?:\/\//i.test(code) && !/[<>]/.test(code)) {
        var s = document.createElement('script');
        s.setAttribute('data-cfasync', 'false');
        s.src = code;
        host.appendChild(s);
      } else {
        execScripts(code, host);
      }
    } catch (e) {
      // 注入失败不能影响阅读
    }
    return true;
  }

  // 用户动作到达时短暂放行：联盟脚本自己调用 window.open，adpopup.js 会强制开新标签。
  function openPopunderWindow(force) {
    if (!config || !isDesktopLike()) return false; // 手机/平板绝不自动弹
    var slot = firstSlot('popunder');
    if (!slot) return false;
    if (!preloadPopunder(slot)) return false;
    if (popTriggeredThisPage || popTriggering) return false;
    if (!force && !popAllowedByFreq()) return false;
    if (!force && now() - pageStart < MIN_DWELL) return false;

    popTriggering = true;
    var before = window.__SY_NATIVE_TAB_OPENED__ || 0;

    // 临时打开真实新标签通道；当前小说窗口绝不会被替换。
    window.__SY_ALLOW_NATIVE_TAB__ = true;
    window.__SY_SUPPRESS_EXTERNAL_OPEN__ = false;

    setTimeout(function () {
      window.__SY_ALLOW_NATIVE_TAB__ = false;
      window.__SY_SUPPRESS_EXTERNAL_OPEN__ = true;
      var after = window.__SY_NATIVE_TAB_OPENED__ || 0;
      if (after > before) {
        popTriggeredThisPage = true;
        markPopFired();
      }
      popTriggering = false;
    }, 1200);

    return true;
  }

  function isChapterControl(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('#chapNext,#chapPrev,#nextBtn,#prevBtn');
  }

  function initPopunderGate() {
    var slot = firstSlot('popunder');
    if (!slot) return;

    // 只预加载脚本，不在加载时弹窗；等真实用户动作再放行。
    preloadPopunder(slot);

    // 用户点击上一章/下一章：捕获阶段放行，联盟脚本在同一手势内触发。
    document.addEventListener('click', function (e) {
      if (isChapterControl(e.target)) openPopunderWindow(false);
    }, true);

    // 退出意图：鼠标从顶部离开视口，且已停留足够时间。
    // relatedTarget=null 表示离开浏览器窗口；clientY<=2 表示向地址栏方向。
    document.addEventListener('mouseout', function (e) {
      if (e.relatedTarget) return;
      var y = (typeof e.clientY === 'number') ? e.clientY : 0;
      if (y > 2) return;
      openPopunderWindow(false);
    }, { passive: true });

    // 控制台/后台调试入口
    window.SYControlledAds = {
      fire: function () { return openPopunderWindow(true); },
      refresh: function () { config = null; inited = false; return loadConfig(); },
      state: function () {
        return {
          device: isDesktopLike() ? 'pc' : 'mobile',
          ageOk: ageOk,
          popInjected: popInjected,
          popTriggered: popTriggeredThisPage,
          directShown: directShown
        };
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadConfig);
  else loadConfig();
})();
