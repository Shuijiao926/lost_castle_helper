/**
 * 面板窗口控制器
 *
 * 把「面板窗口」的完整生命周期收在这一层：
 *   创建 / 显隐 / 淡入淡出 / 圆角方案 / 拖拽 / 休眠 / 搜索焦点 / 外部点击收起
 *
 * 依赖全部从外部注入（Electron、原生 shadow helper、配置、几何、热键），
 * 因此可以用假窗口在 node --test 里验证主要流程。
 */
const shapeRounded = require('./shape');

function createPanel(deps) {
  const {
    BrowserWindow,
    screen,
    panelShadow,
    configStore,
    geometry,
    getBubbleBounds,
    enablePanelKeys,
    disablePanelKeys,
    isQuitting,
    log,
    paths,
    PANEL,
    PANEL_RADIUS,
    SHADOW_PAD,
    WIN_MODE,
    PANEL_CORNER_PREF,
    USE_PANEL_SHADOW,
    USE_SHAPE_CLIP,
    fade,
  } = deps;

  /**
   * 置顶级别：floating（普通 topmost）而不是 screen-saver。
   * screen-saver 会盖住系统截图 / 微信截图的框选层，导致无法在面板内部起手框选。
   */
  const TOPMOST_LEVEL = deps.topmostLevel || 'floating';

  let win = null;
  let open = false;
  let pinned = false;
  let dormant = false;
  /** 圆角模式：dwm（Win11 系统圆角）| shape（Win10 回退裁剪）| null（探测中） */
  let cornersMode = null;
  let dragState = null;
  let dragMoveCount = 0;
  let dragTimer = null;
  let dragCursorScale = 1;
  let lastDragPos = null;

  function stopDragTimer() {
    if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  }

  /**
   * Windows 上把 window 从 skipTaskbar 变成 focusable 后，
   * 系统会重新给它创建任务栏按钮（用户反馈：操作搜索/筛选时底部多一个图标）。
   * 每次焦点变化后重新声明 skipTaskbar=true 来清掉按钮。
   */
  function keepOffTaskbar() {
    if (!win || win.isDestroyed()) return;
    try { win.setSkipTaskbar(true); } catch {}
  }

  /* ---------------- 圆角 ---------------- */
  function applyShape() {
    if (!win || win.isDestroyed()) return;
    if (cornersMode === 'dwm') return; // Win11：系统圆角，不裁剪
    if (cornersMode === null) return; // 探测中，等结果
    // Win10 回退：窗口区域裁剪（阴影层会补一圈抗锯齿轮廓盖住阶梯）
    shapeRounded(win, PANEL.w, PANEL.h, PANEL_RADIUS, log);
  }

  function setupCorners() {
    if (!win) return;
    const forced = (process.env.LC2_PANEL_CORNERS || 'auto').toLowerCase();

    if (forced === 'shape') {
      cornersMode = 'shape';
      if (USE_PANEL_SHADOW) panelShadow.setFill(true);
      applyShape();
      log('panel corners: shape (forced)');
      return;
    }

    let hwndValue = '0';
    try {
      const buf = win.getNativeWindowHandle();
      hwndValue = buf.length >= 8 ? buf.readBigUInt64LE(0).toString() : String(buf.readUInt32LE(0));
    } catch (e) {
      log('getNativeWindowHandle failed:', e.message);
    }

    panelShadow.setPanelCorner(hwndValue, PANEL_CORNER_PREF).then((ok) => {
      if (!win || win.isDestroyed()) return;
      if (ok) {
        cornersMode = 'dwm';
        try { win.setShape([]); } catch {}
        log(
          'panel corners: dwm pref=' + PANEL_CORNER_PREF,
          PANEL_CORNER_PREF === 1 ? 'square' : (PANEL_CORNER_PREF === 2 ? 'round' : 'round-small')
        );
      } else {
        cornersMode = 'shape';
        if (USE_PANEL_SHADOW) panelShadow.setFill(true);
        applyShape();
        log('panel corners: shape fallback (win10/7)');
      }
    });
  }

  /* ---------------- 淡入淡出 ---------------- */
  const FADE = fade || { enabled: true, inMs: 150, outMs: 110 };
  let fadeSupported = null; // null = 未探测
  let fadeTimer = null;

  function stopFade() {
    if (fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }

  function probeFadeSupport(target) {
    if (fadeSupported !== null) return fadeSupported;
    fadeSupported = false;
    if (!FADE.enabled || typeof target.setOpacity !== 'function' || typeof target.getOpacity !== 'function') return false;
    try {
      target.setOpacity(0.02);
      fadeSupported = target.getOpacity() < 0.5; // 读不回来说明系统忽略透明度
      target.setOpacity(1);
    } catch {
      fadeSupported = false;
    }
    log('panel fade supported =', fadeSupported);
    return fadeSupported;
  }

  function fadeIn(target) {
    // Win11 系统圆角依赖非 layered 窗口：一旦调用 setOpacity，窗口会变成 layered，
    // DWM 圆角可能失效。所以圆角走 DWM 时（或还在探测中）跳过窗口透明度动画。
    if (cornersMode !== 'shape') return;
    if (!probeFadeSupport(target)) {
      try { target.setOpacity(1); } catch {}
      return;
    }
    stopFade();
    const steps = Math.max(4, Math.round(FADE.inMs / 16));
    let i = 0;
    target.setOpacity(0);
    fadeTimer = setInterval(() => {
      i += 1;
      const t = i / steps;
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      try { target.setOpacity(Math.min(1, eased)); } catch {}
      if (i >= steps) {
        stopFade();
        try { target.setOpacity(1); } catch {}
      }
    }, 16);
  }

  function fadeOut(target, done) {
    if (cornersMode !== 'shape') {
      done();
      return;
    }
    if (!probeFadeSupport(target)) {
      try { target.setOpacity(1); } catch {}
      done();
      return;
    }
    stopFade();
    const steps = Math.max(3, Math.round(FADE.outMs / 16));
    let i = 0;
    fadeTimer = setInterval(() => {
      i += 1;
      const t = i / steps;
      const eased = Math.pow(1 - t, 2); // ease-in quad
      try { target.setOpacity(Math.max(0, eased)); } catch {}
      if (i >= steps) {
        stopFade();
        done();
      }
    }, 16);
  }

  /* ---------------- 位置 ---------------- */
  function resolveBounds() {
    const bubble = getBubbleBounds();
    const displays = screen.getAllDisplays();
    const nearestToBubble = screen.getDisplayMatching
      ? screen.getDisplayMatching(bubble)
      : screen.getDisplayNearestPoint({ x: bubble.x, y: bubble.y });
    return geometry.resolvePanelBounds(
      configStore.state.panel,
      bubble,
      displays,
      nearestToBubble
    );
  }

  function sideOfPanel() {
    const b = getBubbleBounds();
    return win.getBounds().x < b.x ? 'left' : 'right';
  }

  function sendPanelState() {
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send('lc2:panel', { open, pinned, side: sideOfPanel() });
    } catch (e) {
      log('send panel state failed:', e.message);
    }
  }

  /* ---------------- 阴影 ---------------- */
  function showPanelShadow() {
    if (!USE_PANEL_SHADOW || !win) return;
    const b = win.getBounds();
    panelShadow
      .ensureStarted({ panelW: PANEL.w, panelH: PANEL.h, radius: PANEL_RADIUS, pad: SHADOW_PAD })
      .then((ok) => {
        if (!ok || !open) return;
        panelShadow.setAlpha(0);
        panelShadow.showAt(b.x - SHADOW_PAD, b.y - SHADOW_PAD);
        panelShadow.fadeTo(255, FADE.inMs);
        // 阴影窗口更晚创建，会压在最上层；显式把面板抬回上面
        try { win.setAlwaysOnTop(true, TOPMOST_LEVEL); } catch {}
      });
  }

  /* ---------------- 休眠 / 唤醒 ---------------- */
  function enterDormant() {
    if (!win || win.isDestroyed() || !open || dormant) return;
    dormant = true;
    disablePanelKeys();
    try { win.setFocusable(false); } catch {}
    try { win.webContents.send('lc2:dormant', true); } catch {}
    log('panel dormant（不接收键盘，点击面板唤醒）pinned =', pinned);
  }

  function exitSearchFocus() {
    if (!win || win.isDestroyed()) return;
    keepOffTaskbar();
    // 只恢复不可聚焦 + 重新注册热键；不要 hide/show，否则会打断点击
    try { win.setFocusable(false); } catch {}
    if (open && !dormant) enablePanelKeys();
  }

  function wake() {
    if (!win || win.isDestroyed() || !open) return;
    dormant = false;
    log('panel activate（点击唤醒）pinned =', pinned);
    try { win.setFocusable(true); } catch {}
    try { win.focus(); } catch {}
    try { win.webContents.focus(); } catch {}
    keepOffTaskbar();
    if (win.webContents) win.webContents.send('lc2:dormant', false);
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const focused = win.isFocused();
      log('panel activate: focused=', focused);
      if (!focused) {
        // 唤醒失败 → 退回"不抢焦点但可用热键"模式，避免键盘完全失效
        enablePanelKeys();
        win.webContents.send('lc2:dormant', false);
        log('panel activate failed → 回退到热键模式');
      }
    }, 150);
  }

  function setSearchFocus(on) {
    if (!win || win.isDestroyed()) return;
    if (!on) {
      exitSearchFocus();
      return;
    }
    dormant = false;
    win.webContents.send('lc2:dormant', false);
    disablePanelKeys();
    try { win.setFocusable(true); } catch {}
    try { win.focus(); } catch {}
    try { win.webContents.focus(); } catch {}
    keepOffTaskbar();
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      keepOffTaskbar();
      log('search focus on: focusable=', win.isFocusable(), 'focused=', win.isFocused());
      if (!win.isFocused()) {
        // 某些系统/窗口管理器下 focus() 不生效，show() 会强制激活
        log('search focus retry via show()');
        try {
          win.show();
          win.webContents.focus();
          keepOffTaskbar();
        } catch {}
        setTimeout(() => {
          if (win && !win.isDestroyed()) log('search focus retry result: focused=', win.isFocused());
        }, 150);
      }
    }, 120);
  }

  /* ---------------- 显隐 ---------------- */
  function show() {
    if (!win || open) return;
    open = true;
    dormant = false;
    win.setBounds(resolveBounds(), false);
    applyShape();
    fadeIn(win);
    win.showInactive(); // 显示但不抢焦点
    try { win.setFocusable(false); } catch {}
    keepOffTaskbar();
    showPanelShadow();
    // 告诉渲染层面板从气泡哪一侧展开（决定进场动画的方向原点）
    sendPanelState();
    enablePanelKeys();
    log('panel open');
  }

  function hide() {
    stopDragTimer();
    if (!win || !open) return;
    open = false;
    dormant = false;
    disablePanelKeys();
    try { win.webContents.send('lc2:panel', { open: false }); } catch {}
    exitSearchFocus();
    keepOffTaskbar();
    if (USE_PANEL_SHADOW) panelShadow.fadeTo(0, FADE.outMs, () => panelShadow.hide());
    fadeOut(win, () => {
      try { win.hide(); } catch {}
      // 系统圆角模式绝不能碰 opacity（layered 会让 DWM 圆角/焦点失效）
      if (cornersMode === 'shape') {
        try { win.setOpacity(1); } catch {}
      }
      if (USE_PANEL_SHADOW) panelShadow.hide();
      log('panel close');
    });
  }

  function toggle() {
    open ? hide() : show();
  }

  /* ---------------- 拖拽 ---------------- */
  function moveTo(x, y) {
    if (!win || win.isDestroyed()) return;
    const rx = Math.round(x), ry = Math.round(y);
    if (dragState && lastDragPos && lastDragPos[0] === rx && lastDragPos[1] === ry) return;
    lastDragPos = [rx, ry];
    win.setPosition(rx, ry, false);
    dragMoveCount += 1;
  }

  function startDrag(payload) {
    if (!win) return;
    const p = payload || {};
    if (!Number.isFinite(p.sx) || !Number.isFinite(p.sy)) return;
    const b = win.getBounds();
    dragState = { ox: p.sx - b.x, oy: p.sy - b.y };
    lastDragPos = [b.x, b.y];

    // getCursorScreenPoint 在不同 DPI 环境下可能是 DIP 或物理像素：
    // 用「与按下点（DIP）的误差」判断哪种解释正确
    try {
      const scale = screen.getPrimaryDisplay().scaleFactor || 1;
      const cp = screen.getCursorScreenPoint();
      const errDip = Math.hypot(cp.x / scale - p.sx, cp.y / scale - p.sy);
      const errRaw = Math.hypot(cp.x - p.sx, cp.y - p.sy);
      dragCursorScale = errDip < errRaw ? scale : 1;
    } catch { dragCursorScale = screen.getPrimaryDisplay().scaleFactor || 1; }

    // 拖拽期间隐藏阴影：阴影是独立分层窗口，跟随移动必然滞后/错位
    if (USE_PANEL_SHADOW) {
      try { panelShadow.hide(); } catch {}
    }
    try { win.setAlwaysOnTop(true, TOPMOST_LEVEL); } catch {}
    // helper 的拖拽流只用于「窗口外松开鼠标」的检测；位置改由主进程轮询
    try { panelShadow.dragStart(); } catch (e) { log('dragStart helper failed:', e.message); }

    // 主进程 120Hz 轮询光标并移动窗口（比 helper→stdout→IPC 更稳）
    stopDragTimer();
    dragTimer = setInterval(() => {
      if (!win || win.isDestroyed() || !dragState) { stopDragTimer(); return; }
      let cp;
      try { cp = screen.getCursorScreenPoint(); } catch { return; }
      if (!cp) return;
      moveTo(cp.x / dragCursorScale - dragState.ox, cp.y / dragCursorScale - dragState.oy);
    }, 8);
    log('drag start panel=', JSON.stringify(b));
  }

  /** 原生光标流 → 面板位置（现在仅作兜底；主进程计时器接管时不双驱动） */
  function dragToPhysical(px, py) {
    if (dragTimer) return;
    if (!win || win.isDestroyed() || !dragState) return;
    const scale = screen.getPrimaryDisplay().scaleFactor || 1;
    moveTo(px / scale - dragState.ox, py / scale - dragState.oy);
  }

  function dragMoveFallback(payload) {
    // 位置更新以辅助进程的原生光标流为准；这里仅作兜底（如辅助进程不可用）
    if (!win || !dragState || dragState.native !== false) return;
    const p = payload || {};
    if (!Number.isFinite(p.sx) || !Number.isFinite(p.sy)) return;
    moveTo(p.sx - dragState.ox, p.sy - dragState.oy);
  }

  function finalizeDrag() {
    if (!win || win.isDestroyed() || !dragState) return;
    // 最后一帧对齐：松开时可能还有 1 帧未应用
    try {
      const cp = screen.getCursorScreenPoint();
      if (cp) moveTo(cp.x / dragCursorScale - dragState.ox, cp.y / dragCursorScale - dragState.oy);
    } catch {}
    stopDragTimer();
    try { panelShadow.dragStop(); } catch {}
    dragState = null;
    lastDragPos = null;
    dragMoveCount = 0;
    const b = win.getBounds();
    configStore.state.panel = { x: b.x, y: b.y };
    try { configStore.save(); } catch (e) { log('save panel pos failed:', e.message); }
    log('panel moved ->', b.x, b.y);
    try {
      win.setAlwaysOnTop(true, TOPMOST_LEVEL);
      if (USE_PANEL_SHADOW) {
        panelShadow.setAlpha(255);
        panelShadow.showAt(b.x - SHADOW_PAD, b.y - SHADOW_PAD);
      }
      setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        const nb = win.getBounds();
        if (USE_PANEL_SHADOW) panelShadow.moveTo(nb.x - SHADOW_PAD, nb.y - SHADOW_PAD);
        try { win.setAlwaysOnTop(true, TOPMOST_LEVEL); } catch {}
      }, 120);
    } catch (e) {
      log('drag end resync failed:', e.message);
    }
  }

  /* ---------------- 外部点击 ---------------- */
  /** 全局左键点击：点在面板与气泡之外 → 收起面板（popover 行为） */
  function handleOutsideClick(px, py) {
    if (!open || !win) return;
    const scale = screen.getPrimaryDisplay().scaleFactor || 1;
    const x = px / scale;
    const y = py / scale;

    const pb = win.getBounds();
    const inPanel = x >= pb.x && x <= pb.x + pb.width && y >= pb.y && y <= pb.y + pb.height;

    const bb = getBubbleBounds();
    const pad = 6;
    const inBubble =
      x >= bb.x - pad && x <= bb.x + bb.width + pad && y >= bb.y - pad && y <= bb.y + bb.height + pad;

    if (inPanel || inBubble) return;
    log('outside click: pinned =', pinned);
    if (pinned) {
      // 置顶模式：点击外部不收起，但进入休眠（停止接收键盘）
      enterDormant();
      return;
    }
    hide();
  }

  /* ---------------- 置顶 ---------------- */
  function setPinned(v) {
    pinned = !!v;
    configStore.state.panelPinned = pinned;
    try { configStore.save(); } catch (e) { log('save pinned failed:', e.message); }
    if (win && !win.isDestroyed()) win.webContents.send('lc2:pin', pinned);
    log('pin toggle →', pinned);
    return pinned;
  }

  /* ---------------- 创建 ---------------- */
  function create() {
    win = new BrowserWindow({
      width: PANEL.w,
      height: PANEL.h,
      transparent: false,
      backgroundColor: '#15161c',
      frame: false,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: paths.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    win.setAlwaysOnTop(true, TOPMOST_LEVEL);
    try { win.setBackgroundColor('#15161c'); } catch {}

    win.webContents.on('console-message', (_e, _level, message) => {
      log('[renderer]', message);
    });
    win.loadFile(paths.rendererIndex, { query: { mode: 'panel', win: WIN_MODE } });
    setupCorners();
    win.once('ready-to-show', () => applyShape());
    win.webContents.once('did-finish-load', () => applyShape());
    // 开发热部署时渲染层会重载：重载后把当前开合/置顶状态重新下发
    win.webContents.on('did-finish-load', () => sendPanelState());
    // 面板不销毁，只隐藏，避免反复重建
    win.on('blur', () => {
      log('panel blur');
      enterDormant();
    });
    win.on('focus', () => {
      log('panel focus');
      keepOffTaskbar();
    });
    win.on('close', (e) => {
      if (!isQuitting()) {
        e.preventDefault();
        hide();
      }
    });

    return win;
  }

  return {
    create,
    show,
    hide,
    toggle,
    getWindow: () => win,
    isOpen: () => open,
    isPinned: () => pinned,
    isDormant: () => dormant,
    setPinned,
    togglePin: () => setPinned(!pinned),
    // 位置 / 拖拽
    moveTo,
    startDrag,
    dragToPhysical,
    dragMoveFallback,
    finalizeDrag,
    // 交互
    handleOutsideClick,
    wake,
    setSearchFocus,
    // 圆角 / 形状（原生 helper 重启后重探）
    applyShape,
    setupCorners,
    onNativeRestart: () => {
      cornersMode = null;
      setupCorners();
    },
  };
}

module.exports = createPanel;
