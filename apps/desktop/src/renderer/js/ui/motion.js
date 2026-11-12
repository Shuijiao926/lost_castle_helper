/* ================= 动效层（表现层） =================
 * 统一接管进出场动画节奏：
 * - replay：重播某个一次性动画类
 * - stagger：列表卡片错峰入场
 * - panelIn：面板呼出时的入场
 * - press：按钮按压反馈（键盘触发时用）
 *
 * app 层在对应时机显式调用（不再猴补丁替换业务函数）。
 */
(function () {
  'use strict';
  window.LC2 = window.LC2 || {};
  window.LC2.ui = window.LC2.ui || {};

  var reduce = false;
  try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

  function replay(el, cls) {
    if (!el || reduce) return;
    el.classList.remove(cls);
    void el.offsetWidth; /* 强制回流，让动画可重播 */
    el.classList.add(cls);
  }

  function stagger(root) {
    if (!root || reduce) return;
    var cards = root.querySelectorAll('.card');
    for (var i = 0; i < cards.length && i < 16; i++) {
      cards[i].style.setProperty('--i', String(i));
      cards[i].classList.add('m-item-in');
    }
  }

  function panelIn() {
    var p = document.getElementById('panel');
    if (!p || p.classList.contains('hidden')) return;
    replay(p, 'm-panel-in');
    stagger(document.getElementById('feed'));
  }

  function press(el) {
    if (!el || reduce) return;
    el.classList.remove('m-press');
    void el.offsetWidth;
    el.classList.add('m-press');
  }

  window.LC2.ui.motion = {
    isReduced: function () { return reduce; },
    replay: replay,
    stagger: stagger,
    panelIn: panelIn,
    press: press
  };
})();
