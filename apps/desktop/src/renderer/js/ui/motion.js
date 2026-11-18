/* ================= 动效层（表现层） =================
 * 统一接管进出场动画节奏：
 * - replay：重播某个一次性动画类
 * - stagger：列表卡片错峰入场
 * - panelIn：面板呼出时的入场
 * - press：按钮按压反馈（键盘触发时用）
 * - bindCards：卡片悬停的进入、离开与取消反馈
 * - drawReel：随机流派滚轴减速与取消
 *
 * app 层在对应时机显式调用（不再猴补丁替换业务函数）。
 */
(function () {
  'use strict';
  window.LC2 = window.LC2 || {};
  window.LC2.ui = window.LC2.ui || {};

  var reduce = false;
  var motionQuery = null;
  try {
    motionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    reduce = !!motionQuery?.matches;
  } catch (e) {}

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

  function bindCards(root) {
    root.querySelectorAll('.card').forEach(function (card) {
      var frame = 0;
      var pointerX = 0;
      var pointerY = 0;
      function move(event) {
        if (reduce) return;
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (frame) return;
        frame = requestAnimationFrame(function () {
          frame = 0;
          var bounds = card.getBoundingClientRect();
          card.style.setProperty('--hover-x', (pointerX - bounds.left) + 'px');
          card.style.setProperty('--hover-y', (pointerY - bounds.top) + 'px');
        });
      }
      function leave() {
        cancelAnimationFrame(frame);
        frame = 0;
        card.classList.remove('m-card-hover');
      }
      card.addEventListener('pointerenter', function () {
        card.classList.remove('m-item-in');
        card.classList.add('m-card-hover');
      });
      card.addEventListener('animationend', function (event) {
        if (event.target === card && event.animationName === 'm-item-in') card.classList.remove('m-item-in');
      });
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerleave', leave);
      card.addEventListener('pointercancel', leave);
    });
  }

  function drawReel(track, onFinish, { instant = false } = {}) {
    // 入场缩放会影响屏幕坐标，滚轴位移使用布局尺寸才能准确停在中央。
    const height = track.firstElementChild.offsetHeight;
    const inset = (track.parentElement.clientHeight - height) / 2;
    const start = 'translateY(' + (inset - height) + 'px)';
    const end = 'translateY(' + (inset - (track.children.length - 2) * height) + 'px)';
    track.style.transform = start;
    if (instant || (motionQuery ? motionQuery.matches : reduce)) {
      track.style.transform = end;
      onFinish();
      return () => {};
    }
    const animation = track.animate([{ transform: start }, { transform: end }], {
      duration: 2600,
      easing: 'cubic-bezier(.12,.65,.08,1)',
      fill: 'forwards',
    });
    function finish() {
      track.style.transform = end;
      animation.cancel();
      onFinish();
    }
    animation.addEventListener('finish', finish, { once: true });
    return () => {
      animation.removeEventListener('finish', finish);
      animation.cancel();
    };
  }

  window.LC2.ui.motion = {
    isReduced: function () { return motionQuery ? motionQuery.matches : reduce; },
    replay: replay,
    stagger: stagger,
    panelIn: panelIn,
    press: press,
    bindCards: bindCards,
    drawReel
  };
})();
