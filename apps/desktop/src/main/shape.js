/**
 * setShape 圆角裁剪（Win10 / 无 DWM 时的兜底）
 *
 * Windows 窗口区域是整数像素矩形，没有抗锯齿，所以这是最后手段；
 * 默认走 DWM 系统圆角，只有 LC2_WIN_MODE=shape 时才用这里。
 */
module.exports = function shapeRounded(win, w, h, radius, log) {
  if (!win || typeof win.setShape !== 'function') return;
  try {
    const rects = [];
    const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
    for (let y = 0; y < h; y++) {
      let inset = 0;
      if (y < r) {
        const dy = r - (y + 0.5);
        inset = r - Math.sqrt(Math.max(0, r * r - dy * dy));
      } else if (y >= h - r) {
        const dy = (y + 0.5) - (h - r);
        inset = r - Math.sqrt(Math.max(0, r * r - dy * dy));
      }
      const x = Math.round(inset);
      const wRow = Math.round(w - inset * 2);
      if (wRow > 0) rects.push({ x, y, width: wRow, height: 1 });
    }
    win.setShape(rects);
  } catch (e) {
    if (log) log('setShape failed:', e.message);
  }
};
