/* 深夜文库 · 看书页动态广告渲染器（后台 /admin-ads 统一管理）
 * ============================================================
 * 从 /api/adslots 读取「看书页广告」两区，注入到看书场景的 data-ad-slot 容器：
 *   reader-top    （TXT 阅读器 · 正文上方）  ┐
 *   content-top   （书详情 / 章节页 · 正文上方）┴→ zones['reader-top']
 *   reader-bottom （TXT 阅读器 · 正文下方）  ┐
 *   content-bottom（书详情 / 章节页 · 正文下方）┴→ zones['reader-bottom']
 *
 * 未启用 / 无内容的容器自动隐藏（display:none），不留空白。
 * HTML 模式：写入后重建 <script> 以触发联盟异步脚本；不支持 document.write 型。
 * 与首页 adslots.js 共用同一份后台配置，但各页只渲染自己场景的区。
 * ============================================================
 */
(function () {
  'use strict';

  var API = '/api/adslots';

  // 容器名 → 后台 zone key（同一正文上/下区覆盖阅读器与书页/章节页两套命名）
  var SLOT_ZONE = {
    'reader-top': 'reader-top',
    'content-top': 'reader-top',
    'reader-bottom': 'reader-bottom',
    'content-bottom': 'reader-bottom'
  };

  var SIZE_MAP = {
    '300x250': [300, 250], '320x50': [320, 50], '160x600': [160, 600],
    '336x280': [336, 280], '250x250': [250, 250], '320x100': [320, 100],
    '728x90': [728, 90], '300x600': [300, 600], '468x60': [468, 60]
  };

  // 从 atOptions 代码里解析 'width':468, 'height':60 这类尺寸
  function atOptionsSize(code) {
    var w = code.match(/['"]width['"]\s*:\s*(\d+)/i);
    var h = code.match(/['"]height['"]\s*:\s*(\d+)/i);
    if (w && h) return [parseInt(w[1], 10), parseInt(h[1], 10)];
    return null;
  }

  function makeCell(slot) {
    var cell = document.createElement('div');
    cell.className = 'ad-cell';
    cell.setAttribute('data-size', slot.size || 'auto');
    cell.setAttribute('data-ad-id', slot.id || '');
    cell.style.cssText = 'max-width:100%;margin:0 auto;overflow:hidden';

    if (slot.type === 'html') {
      // atOptions 全局单例冲突：用 iframe srcdoc 隔离每份代码到独立 window
      if (/atOptions\s*=/.test(slot.value)) {
        var dim = atOptionsSize(slot.value) || SIZE_MAP[slot.size];
        var frame = document.createElement('iframe');
        frame.setAttribute('scrolling', 'no');
        frame.setAttribute('data-atoptions', '1');
        frame.style.cssText = 'border:0;display:block;margin:0 auto;background:transparent' +
          (dim ? ';width:' + dim[0] + 'px;height:' + dim[1] + 'px' : '');
        frame.srcdoc = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">' +
          slot.value.replace(/<\/script>/gi, '<\\/script>') + '</body>';
        cell.appendChild(frame);
      } else {
        cell.innerHTML = slot.value;
        var old = [].slice.call(cell.querySelectorAll('script'));
        old.forEach(function (o) {
          var s = document.createElement('script');
          for (var i = 0; i < o.attributes.length; i++) s.setAttribute(o.attributes[i].name, o.attributes[i].value);
          s.textContent = o.textContent;
          o.parentNode.replaceChild(s, o);
        });
      }
    } else {
      var img = document.createElement('img');
      img.src = slot.value;
      img.alt = slot.note || '广告';
      img.loading = 'lazy';
      var dim = SIZE_MAP[slot.size];
      img.style.cssText = 'display:block;max-width:100%;height:auto;margin:0 auto;border-radius:6px';
      if (dim) { img.width = dim[0]; img.height = dim[1]; }
      if (slot.link && /^https?:\/\//i.test(slot.link)) {
        var a = document.createElement('a');
        a.href = slot.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.appendChild(img); cell.appendChild(a);
      } else {
        cell.appendChild(img);
      }
    }
    return cell;
  }

  function apply(data) {
    var zones = (data && data.zones) || {};
    var hosts = document.querySelectorAll('[data-ad-slot]');
    [].forEach.call(hosts, function (host) {
      var name = host.getAttribute('data-ad-slot');
      var zone = SLOT_ZONE[name];
      if (!zone) return; // 非看书场景的 slot（首页等）不归本渲染器管
      host.innerHTML = ''; // 幂等
      var list = (zones[zone] || []).filter(function (s) { return s && s.enabled && s.value; });
      if (!list.length) { host.style.display = 'none'; return; }
      list.forEach(function (s) { host.appendChild(makeCell(s)); });
      host.style.display = '';
      host.setAttribute('data-ad-filled', '1');
    });
  }

  function hideAll() {
    var hosts = document.querySelectorAll('[data-ad-slot]');
    [].forEach.call(hosts, function (host) {
      if (SLOT_ZONE[host.getAttribute('data-ad-slot')]) {
        host.style.display = 'none';
      }
    });
  }

  function load() {
    return fetch(API + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(apply)
      .catch(function () { hideAll(); }); // API 不可用：全部隐藏，不留空白
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();

  // 兼容旧调用与控制台调试
  window.SY_ADS = { refresh: load, zones: ['reader-top', 'reader-bottom'] };
})();
