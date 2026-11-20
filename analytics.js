/**
 * analytics.js — 深夜文库 GA4 + UTM 追踪（可配置、零依赖）
 *
 * 用法：
 *   1) 在需要追踪的页面 <head> 里加一行：<script src="/analytics.js" defer></script>
 *   2) 申请到 GA4 后，把下面 GA_MEASUREMENT_ID 改成你的测量 ID（形如 G-XXXXXXXXXX）。
 *      留空时全部逻辑静默跳过，不影响站点，不发任何外部请求。
 *
 * 提供：
 *   window.SY_TRACK.event(name, params)  发送自定义事件
 *   window.SY_TRACK.signUp()             注册成功事件（带 UTM 来源）
 *   window.SY_TRACK.viewItem(id, title)  小说详情浏览事件
 *   window.SY_TRACK.getUTM()             读取当前 UTM 来源
 *
 * 事件：page_view / sign_up / login / view_item（与方案 GA4 建议一致）
 */
(function () {
  'use strict';

  // ===== 只需改这一处：GA4 测量 ID。留空 = 完全静默 =====
  var GA_MEASUREMENT_ID = '';

  var UTM_KEY = 'sy_utm';
  var UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function readUTM() {
    var cur = {};
    try {
      var q = new URLSearchParams(location.search);
      UTM_FIELDS.forEach(function (k) { var v = q.get(k); if (v) cur[k] = v; });
    } catch (e) {}
    var first = {}, last = {};
    try {
      first = JSON.parse(localStorage.getItem(UTM_KEY + '_first') || '{}');
      last = JSON.parse(localStorage.getItem(UTM_KEY + '_last') || '{}');
    } catch (e) {}
    if (Object.keys(cur).length) {
      try {
        localStorage.setItem(UTM_KEY + '_last', JSON.stringify(cur));
        if (!Object.keys(first).length) localStorage.setItem(UTM_KEY + '_first', JSON.stringify(cur));
      } catch (e) {}
    }
    return { current: cur, first: first, last: Object.keys(last).length ? last : cur };
  }

  var utm = readUTM();
  var ready = false;

  function push(name, params) {
    if (!GA_MEASUREMENT_ID || !window.dataLayer) return;
    try { window.dataLayer.push(Object.assign({ event: name }, params || {})); } catch (e) {}
  }

  function initGA() {
    if (!GA_MEASUREMENT_ID || ready) return;
    ready = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, { page_view: false, send_page_view: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
    document.head.appendChild(s);
  }

  function withUTM(params) {
    var p = Object.assign({}, params || {});
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (k) {
      if (utm.current[k]) p[k] = utm.current[k];
      else if (utm.last[k]) p[k] = utm.last[k];
    });
    return p;
  }

  window.SY_TRACK = {
    getUTM: function () { return utm; },
    enabled: function () { return !!GA_MEASUREMENT_ID; },
    event: function (name, params) { initGA(); push(name, withUTM(params)); },
    signUp: function (method) {
      initGA();
      push('sign_up', withUTM({ method: method || 'site_form' }));
    },
    login: function () { initGA(); push('login', withUTM({})); },
    viewItem: function (id, title) {
      initGA();
      push('view_item', withUTM({ item_id: String(id), item_name: title || '' }));
    }
  };

  // 自动 page_view（ID 为空时 initGA 不执行，dataLayer 不存在，push 直接返回）
  initGA();
  push('page_view', { page_path: location.pathname });

  // 阅读页自动 view_item：/read?book=123 或 /read.html?book=123
  try {
    var q = new URLSearchParams(location.search);
    var id = q.get('book') || q.get('id');
    if (id && /read/.test(location.pathname)) window.SY_TRACK.viewItem(id, document.title);
  } catch (e) {}
})();
