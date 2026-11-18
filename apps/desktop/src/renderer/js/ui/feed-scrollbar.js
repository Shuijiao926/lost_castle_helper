/* 流派列表的贴边滚动条：只处理滚动位置、拖动与可访问性。 */
(function () {
  'use strict';

  function bindFeedScrollbar(feed, rail) {
    const track = rail.querySelector('.feed-scroll-track');
    const thumb = rail.querySelector('.feed-scroll-thumb');
    const topButton = rail.querySelector('[data-scroll="top"]');
    const bottomButton = rail.querySelector('[data-scroll="bottom"]');
    let enabled = false;
    let hideTimer = 0;
    let drag = null;

    function reveal() {
      clearTimeout(hideTimer);
      rail.classList.add('is-scrolling');
      hideTimer = setTimeout(() => rail.classList.remove('is-scrolling'), 1100);
    }

    function sync(active = enabled) {
      enabled = active;
      const overflow = feed.scrollHeight - feed.clientHeight;
      const visible = enabled && feed.clientHeight > 0 && overflow > 1;
      rail.hidden = !visible;
      feed.classList.toggle('has-scrollbar', visible);
      if (!visible) {
        endDrag();
        return;
      }
      rail.style.setProperty('--rail-top', (feed.offsetTop + 6) + 'px');
      rail.style.setProperty('--rail-height', Math.max(0, feed.clientHeight - 12) + 'px');
      const max = Math.max(1, feed.scrollHeight - feed.clientHeight);
      const ratio = Math.max(0, Math.min(1, feed.scrollTop / max));
      const size = Math.min(track.clientHeight, Math.max(28, track.clientHeight * feed.clientHeight / feed.scrollHeight));
      thumb.style.setProperty('--thumb-height', size + 'px');
      thumb.style.setProperty('--thumb-top', (ratio * (track.clientHeight - size)) + 'px');
      thumb.setAttribute('aria-valuemax', String(Math.round(max)));
      thumb.setAttribute('aria-valuenow', String(Math.round(ratio * max)));
      thumb.setAttribute('aria-valuetext', Math.round(ratio * 100) + '%');
      topButton.disabled = feed.scrollTop <= 1;
      bottomButton.disabled = max - feed.scrollTop <= 1;
    }

    function jump(top) {
      feed.scrollTop = top;
      sync();
      reveal();
    }
    topButton.onclick = () => jump(0);
    bottomButton.onclick = () => jump(feed.scrollHeight);

    function endDrag() {
      if (!drag) return;
      const pointerId = drag.pointerId;
      drag = null;
      rail.classList.remove('is-dragging');
      if (thumb.hasPointerCapture(pointerId)) thumb.releasePointerCapture(pointerId);
    }
    thumb.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const travel = track.clientHeight - thumb.offsetHeight;
      if (travel <= 0) return;
      drag = { pointerId: event.pointerId, y: event.clientY, top: feed.scrollTop,
        scale: (feed.scrollHeight - feed.clientHeight) / travel };
      thumb.setPointerCapture(event.pointerId);
      rail.classList.add('is-dragging');
    });
    thumb.addEventListener('pointermove', event => {
      if (drag && event.pointerId === drag.pointerId) jump(drag.top + (event.clientY - drag.y) * drag.scale);
    });
    thumb.addEventListener('pointerup', endDrag);
    thumb.addEventListener('pointercancel', endDrag);
    thumb.addEventListener('lostpointercapture', endDrag);
    window.addEventListener('blur', endDrag);

    track.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target !== track) return;
      event.preventDefault();
      const bounds = track.getBoundingClientRect();
      const ratio = (event.clientY - bounds.top - thumb.offsetHeight / 2) / Math.max(1, track.clientHeight - thumb.offsetHeight);
      jump(ratio * (feed.scrollHeight - feed.clientHeight));
    });
    // 面板的全局热键会发到 document，因此也检查当前聚焦的滑块。
    document.addEventListener('keydown', event => {
      if (rail.hidden || document.querySelector('.modal.on')) return;
      const focused = event.target === document ? document.activeElement : event.target;
      if (focused.matches?.('.feed-scroll-arrow') && (event.key === 'Enter' || event.key === ' ')) {
        if (event.target === document) {
          event.preventDefault();
          focused.click();
        }
        event.stopImmediatePropagation();
        return;
      }
      if (focused !== thumb) return;
      const steps = { ArrowUp: -80, ArrowDown: 80, PageUp: -feed.clientHeight, PageDown: feed.clientHeight };
      if (Object.hasOwn(steps, event.key)) jump(feed.scrollTop + steps[event.key]);
      else if (event.key === 'Home') jump(0);
      else if (event.key === 'End') jump(feed.scrollHeight);
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    });
    rail.addEventListener('wheel', event => {
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? feed.clientHeight : 1;
      jump(feed.scrollTop + event.deltaY * scale);
    }, { passive: false });
    feed.addEventListener('scroll', () => { sync(); reveal(); }, { passive: true });
    const observer = new ResizeObserver(() => sync());
    observer.observe(feed);
    return { sync };
  }

  window.LC2.ui.bindFeedScrollbar = bindFeedScrollbar;
})();
