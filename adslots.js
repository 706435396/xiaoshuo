/* 深夜文库 · C 版动态广告网格渲染器
 * 从 /api/adslots (v2) 读取后台配置，按三区（hero / cat / shelf）渲染广告位。
 * - 每区是网格容器 [data-ad-zone]，可渲染任意数量广告位（后台可增删）
 * - 广告位支持尺寸预设：auto 自适应 / 300x250 / 320x50 / ... / 728x90 通栏
 * - 图片模式：img + 可选跳转；HTML 模式：写入代码并重建 script（支持联盟异步脚本）
 * - 未启用或空内容的广告位不渲染；整区为空时容器隐藏（:empty 兜底）
 * defer 加载，不阻塞页面。
 */
(function () {
  'use strict';

  var API = '/api/adslots';
  var ZONES = ['hero', 'cat', 'shelf'];

  // 图片尺寸映射（用于 <img> 的 width/height，帮助页面稳定布局）
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
    cell.className = 'ad-cell' + (slot.size === '728x90' || slot.size === '468x60' ? ' span-2' : '');
    cell.setAttribute('data-size', slot.size || 'auto');
    cell.setAttribute('data-ad-id', slot.id || '');

    if (slot.type === 'html') {
      // atOptions 型横幅：atOptions 是挂在 window 上的全局变量，多个不同 key 同页会互相覆盖，
      // 导致 invoke 脚本拿错配置渲染不出来。用 iframe srcdoc 给每份代码独立 window 彻底隔离。
      if (/atOptions\s*=/.test(slot.value)) {
        var dim = atOptionsSize(slot.value) || SIZE_MAP[slot.size];
        var frame = document.createElement('iframe');
        frame.setAttribute('scrolling', 'no');
        frame.setAttribute('data-atoptions', '1');
        var W = dim ? dim[0] : 468, H = dim ? dim[1] : 60;
        frame.style.cssText = 'border:0;display:block;background:transparent;transform-origin:top center' +
          ';width:' + W + 'px;height:' + H + 'px';
        // 内联 srcdoc：脚本在独立文档解析期执行，document.write/invoke 都正常
        frame.srcdoc = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">' +
          slot.value.replace(/<\/script>/gi, '<\\/script>') + '</body>';
        cell.appendChild(frame);
        // 宽于容器时等比缩放，广告完整可见（不裁切）；支持窗口 resize
        function fitAt() {
          var avail = cell.clientWidth || W;
          var scale = avail < W ? avail / W : 1;
          frame.style.transform = 'scale(' + scale + ')';
          cell.style.height = Math.round(H * scale) + 'px';
          cell.style.minWidth = Math.round(W * scale) + 'px';
        }
        requestAnimationFrame(function () { requestAnimationFrame(fitAt); });
        window.addEventListener('resize', fitAt);
      } else {
        // 普通 HTML 模式：innerHTML 写入后 script 不自动执行，重建以触发
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
      var css = 'display:block;max-width:100%;height:auto;margin:0 auto;border-radius:6px';
      if (dim) { img.width = dim[0]; img.height = dim[1]; }
      img.style.cssText = css;
      if (slot.link && /^https?:\/\//i.test(slot.link)) {
        var a = document.createElement('a');
        a.href = slot.link;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.appendChild(img);
        cell.appendChild(a);
      } else {
        cell.appendChild(img);
      }
    }
    return cell;
  }

  function apply(data) {
    if (!data || !data.zones) return;
    ZONES.forEach(function (zone) {
      var host = document.querySelector('[data-ad-zone="' + zone + '"]');
      if (!host) return;
      host.innerHTML = ''; // 幂等：重复调用不重复渲染
      var list = (data.zones[zone] || []).filter(function (s) { return s && s.enabled && s.value; });
      list.forEach(function (s) { host.appendChild(makeCell(s)); });
    });
  }

  function load() {
    return fetch(API + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(apply)
      .catch(function () { /* 后台不可用：网格保持空，:empty 规则自动隐藏 */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();

  window.SY_ADS = { refresh: load, zones: ZONES };
})();
