/* ================= DOM 小工具（表现层） =================
 * 只放通用 DOM 访问：$ / 转义 / 常用节点引用。
 * 节点引用在脚本加载时一次性取好（脚本都放在 body 末尾）。
 */
(function () {
  'use strict';
  window.LC2 = window.LC2 || {};
  window.LC2.ui = window.LC2.ui || {};

  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }

  window.LC2.ui.dom = {
    $: $,
    esc: esc,
    refs: {
      feed: $('feed'),
      detail: $('detail'),
      sbar: $('sbar'),
      filterbar: $('filterbar'),
      listbar: $('listbar'),
      back: $('back'),
      ttl: $('ttl'),
      modal: $('modal'),
      mgrid: $('mgrid'),
      panel: $('panel'),
      bubble: $('bubble'),
      bubbleTip: $('bubbleTip')
    }
  };
})();
