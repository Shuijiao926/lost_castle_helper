/**
 * 窗口几何（纯函数）
 *
 * 全部显式接收 workArea / displays / 尺寸常量，不依赖 electron，
 * 因此可以在 node --test 里直接验证多显示器与边缘夹紧逻辑。
 */
function createGeometry({ BUBBLE, PANEL, MARGIN }) {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  /** 气泡默认位置：主屏右侧、垂直居中 */
  function defaultBubbleBounds(workArea) {
    return {
      x: workArea.x + workArea.width - BUBBLE.w - MARGIN,
      y: workArea.y + Math.round(workArea.height / 2 - BUBBLE.h / 2),
      width: BUBBLE.w,
      height: BUBBLE.h,
    };
  }

  /** 面板锚定气泡：默认向左展开，左侧不够则向右；垂直居中并夹紧 */
  function panelBoundsFrom(bubble, display) {
    const wa = display.workArea;
    let x = bubble.x + Math.round(bubble.width / 2) - PANEL.w;
    if (x < wa.x) x = bubble.x + bubble.width - Math.round(bubble.width / 2);
    x = clamp(x, wa.x, wa.x + wa.width - PANEL.w);

    let y = bubble.y + Math.round(bubble.height / 2 - PANEL.h / 2);
    y = clamp(y, wa.y, wa.y + wa.height - PANEL.h);

    return { x, y, width: PANEL.w, height: PANEL.h };
  }

  /**
   * 面板是否至少有一部分落在某个显示器里。
   * 拖拽允许移出屏幕边界（uTools 式），但恢复位置时不能让它彻底消失。
   */
  function panelVisibleSomewhere(x, y, displays, minVisible = 48) {
    const bounds = { x, y, width: PANEL.w, height: PANEL.h };
    for (const d of displays) {
      const wa = d.workArea;
      const iw = Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x);
      const ih = Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y);
      if (iw >= minVisible && ih >= minVisible) return true;
    }
    return false;
  }

  /** 恢复面板位置：优先上次位置（允许部分出屏），完全不可见才夹回最近显示器 */
  function resolvePanelBounds(saved, bubble, displays, nearestDisplay) {
    const fallback = panelBoundsFrom(bubble, nearestDisplay || displays[0]);
    if (!saved) return fallback;

    // 允许上次放在屏幕边缘外（部分露出）；只有完全找不到时才夹回最近显示器
    if (panelVisibleSomewhere(saved.x, saved.y, displays)) {
      return { x: saved.x, y: saved.y, width: PANEL.w, height: PANEL.h };
    }
    const disp = nearestDisplay || displays[0];
    const wa = disp.workArea;
    return {
      x: clamp(saved.x, wa.x, wa.x + wa.width - PANEL.w),
      y: clamp(saved.y, wa.y, wa.y + wa.height - PANEL.h),
      width: PANEL.w,
      height: PANEL.h,
    };
  }

  return { clamp, defaultBubbleBounds, panelBoundsFrom, panelVisibleSomewhere, resolvePanelBounds };
}

module.exports = createGeometry;
