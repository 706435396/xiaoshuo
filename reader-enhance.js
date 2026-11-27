/* ============================================================
 * 深夜文库 · 阅读体验增强（shenye.72tool.com）
 * 注入方式：functions/_middleware.js 全站注入，仅 TXT 阅读页生效。
 *
 * 功能（不改变现有暗色主题视觉，不动 read.html 自身逻辑）：
 *   1. 左右滑屏切章：手机触摸 / 电脑鼠标拖拽，调用现有 #chapPrev/#chapNext
 *      （它们由 read.html 内部 gotoChapter 驱动，故不碰闭包变量）。
 *   2. 字号 / 背景(夜间等) / 行距 / 翻页方式 持久化到 localStorage，
 *      重开页面自动恢复：通过「重放点击」驱动 read.html 自身的控件，
 *      保持闭包状态与界面一致。
 *   3. 新增两个控件按钮：行距（紧凑/标准/宽松）、翻页（上下滚动/左右翻页）。
 *
 * 设计要点：
 *   - 只用稳定 ID：fontInc/fontDec/bgToggle/chapPrev/chapNext/txtContent/txtWrap。
 *   - 异步等待 read.html 的 initTxtReader 绑定好控件后再接管（轮询上限 10s）。
 *   - 非 TXT 阅读页（首页/epub/登录页等）直接跳过，零副作用。
 * ============================================================ */
(function () {
  'use strict';

  var KEY = 'sy_reader_cfg_v1';
  var DEFAULTS = { fs: 17, bg: 0, lh: 1.9, mode: 'scroll' }; // fontSize / bgIndex / lineHeight / pageMode
  var BG_COUNT = 4; // read.html 的 bgModes 数量（深空/羊皮纸/护眼绿/夜间）
  var LH_VALS = [1.7, 1.9, 2.2];
  var LH_NAMES = ['紧凑', '标准', '宽松'];
  var cfg = loadCfg();
  var restoring = false;   // 重放点击期间抑制 save，避免把目标值累加
  var swipeReady = false;
  var suppressClick = false;

  function $(id) { return document.getElementById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function loadCfg() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!o || typeof o !== 'object') return clone(DEFAULTS);
      var c = clone(DEFAULTS);
      if (typeof o.fs === 'number') c.fs = Math.max(13, Math.min(30, o.fs));
      if (typeof o.bg === 'number') c.bg = Math.max(0, Math.min(BG_COUNT - 1, o.bg));
      if (typeof o.lh === 'number' && LH_VALS.indexOf(o.lh) >= 0) c.lh = o.lh;
      if (o.mode === 'flip' || o.mode === 'scroll') c.mode = o.mode;
      return c;
    } catch (e) { return clone(DEFAULTS); }
  }
  function saveCfg() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }

  // 等待 read.html 把控件 onclick 绑好（initTxtReader 内同步设置）
  function waitReady(cb, tries) {
    tries = tries || 0;
    var wrap = $('txtWrap'), content = $('txtContent');
    var bound = content && $('fontInc') && $('fontInc').onclick && $('bgToggle') && $('bgToggle').onclick;
    var visible = wrap && !wrap.classList.contains('hidden');
    if (bound && visible) { cb(); return; }
    if (tries > 100) return; // ~10s 上限，超时静默放弃，不影响原站
    setTimeout(function () { waitReady(cb, tries + 1); }, 100);
  }

  // 包裹既有 onclick：先执行原逻辑，再同步持久化状态
  function wrapHandler(el, after) {
    if (!el || typeof el.onclick !== 'function') return;
    var orig = el.onclick;
    el.onclick = function () {
      var r = orig.apply(this, arguments);
      if (!restoring) { after(); saveCfg(); }
      return r;
    };
  }

  function replayFont() {
    var delta = cfg.fs - 17; // read.html 默认 fontSize=17
    if (!delta) return;
    var btn = $(delta > 0 ? 'fontInc' : 'fontDec');
    if (!btn || typeof btn.onclick !== 'function') return;
    restoring = true;
    for (var i = 0; i < Math.abs(delta); i++) btn.click();
    restoring = false;
  }
  function replayBg() {
    if (!cfg.bg) return; // 默认 index 0
    var btn = $('bgToggle');
    if (!btn || typeof btn.onclick !== 'function') return;
    restoring = true;
    for (var i = 0; i < cfg.bg; i++) btn.click();
    restoring = false;
  }

  // ---- 行距：注入 !important 样式覆盖 renderChapter 写死的内联 line-height:1.9 ----
  var lhStyle = null;
  function applyLineHeight() {
    if (!lhStyle) {
      lhStyle = document.createElement('style');
      lhStyle.id = 'sy-reader-lh-style';
      (document.head || document.documentElement).appendChild(lhStyle);
    }
    lhStyle.textContent = '#txtContent p,#txtContent h2{line-height:' + cfg.lh + ' !important}';
  }
  // ---- 翻页方式：左右翻页时显示提示条 ----
  var hintEl = null;
  function applyModeUI() {
    var wrap = $('txtWrap');
    if (!wrap) return;
    if (cfg.mode === 'flip') {
      if (!hintEl) {
        hintEl = document.createElement('div');
        hintEl.id = 'sy-flip-hint';
        hintEl.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:5;' +
          'background:rgba(8,6,20,.82);color:#cfc9ea;border:1px solid rgba(148,120,255,.32);' +
          'border-radius:14px;padding:3px 12px;font-size:11px;pointer-events:none;backdrop-filter:blur(6px)';
        hintEl.textContent = '← 左右滑屏切换章节 →';
        wrap.appendChild(hintEl);
      }
      hintEl.style.display = '';
    } else if (hintEl) {
      hintEl.style.display = 'none';
    }
  }

  // ---- 新增控件按钮 ----
  function makeBtn(id, title, text) {
    var b = document.createElement('button');
    b.id = id;
    b.title = title;
    b.textContent = text;
    b.className = 'px-2 py-1 rounded bg-gray-100 dark:bg-[#2a2a2a] hover:bg-gray-200 dark:hover:bg-[#333]';
    return b;
  }
  function addControls() {
    var bar = $('epubControls');
    if (!bar || $('syLhBtn')) return;
    var lhBtn = makeBtn('syLhBtn', '切换行距', '行距:' + nameLh(cfg.lh));
    var modeBtn = makeBtn('syModeBtn', '切换翻页方式', cfg.mode === 'flip' ? '左右翻页' : '上下滚动');
    // 插到 bgToggle 之后，保持控件聚在一起
    var bg = $('bgToggle');
    if (bg && bg.nextSibling) bar.insertBefore(modeBtn, bg.nextSibling);
    else if (bg) bar.appendChild(modeBtn);
    else bar.appendChild(modeBtn);
    bar.insertBefore(lhBtn, modeBtn);

    lhBtn.onclick = function () {
      var i = LH_VALS.indexOf(cfg.lh);
      cfg.lh = LH_VALS[(i + 1) % LH_VALS.length];
      this.textContent = '行距:' + nameLh(cfg.lh);
      applyLineHeight(); saveCfg();
    };
    modeBtn.onclick = function () {
      cfg.mode = cfg.mode === 'flip' ? 'scroll' : 'flip';
      this.textContent = cfg.mode === 'flip' ? '左右翻页' : '上下滚动';
      applyModeUI(); saveCfg();
    };
  }
  function nameLh(v) { var i = LH_VALS.indexOf(v); return LH_NAMES[i < 0 ? 1 : i]; }

  // ---- 左右滑动切章（仅在 flip 模式）----
  function markSuppress() { suppressClick = true; setTimeout(function () { suppressClick = false; }, 400); }
  function flip(d) {
    var target = d > 0 ? 'chapNext' : 'chapPrev';
    var btn = $(target);
    if (btn && typeof btn.onclick === 'function' && !btn.disabled) btn.click();
  }
  function bindSwipe() {
    if (swipeReady) return;
    var el = $('txtContent');
    if (!el) return;
    swipeReady = true;
    var tsX = 0, tsY = 0, tracked = false, mdX = null, mdY = null, md = false;

    el.addEventListener('touchstart', function (e) {
      if (cfg.mode !== 'flip' || e.touches.length !== 1) return;
      tsX = e.touches[0].clientX; tsY = e.touches[0].clientY; tracked = true;
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (!tracked || cfg.mode !== 'flip') return;
      tracked = false;
      var t = e.changedTouches[0], dx = t.clientX - tsX, dy = t.clientY - tsY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) { markSuppress(); flip(dx < 0 ? 1 : -1); }
    }, { passive: true });
    el.addEventListener('mousedown', function (e) {
      if (cfg.mode !== 'flip') return;
      mdX = e.clientX; mdY = e.clientY; md = true;
    });
    window.addEventListener('mouseup', function (e) {
      if (!md || cfg.mode !== 'flip') return;
      md = false;
      var dx = e.clientX - mdX, dy = e.clientY - mdY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { markSuppress(); flip(dx < 0 ? 1 : -1); }
    });
  }

  // ---- 主流程：仅 TXT 阅读页 ----
  function init() {
    if (!$('txtContent') || !$('txtWrap')) return;
    waitReady(function () {
      // 1) 包裹既有控件，之后用户每次点击都会持久化
      wrapHandler($('fontInc'), function () { cfg.fs = Math.min(30, cfg.fs + 1); });
      wrapHandler($('fontDec'), function () { cfg.fs = Math.max(13, cfg.fs - 1); });
      wrapHandler($('bgToggle'), function () { cfg.bg = (cfg.bg + 1) % BG_COUNT; });
      // 2) 重放保存的字号/背景（重放期间被包裹的回调不写存储）
      replayFont();
      replayBg();
      // 3) 应用行距/翻页方式 UI，新增控件，绑定滑动
      applyLineHeight();
      applyModeUI();
      addControls();
      bindSwipe();
      // 4) 章节切换会重渲染正文，行距样式是 !important 不受影响；
      //    提示条位于 txtWrap 也不受影响，无需额外处理。
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
