/**
 * 城堡助手 · 主进程
 *
 * 窗口架构（两个独立窗口，uTools 同款）：
 *   bubbleWin  72×72 圆形气泡，常驻，面板打开时也不消失
 *   panelWin   440×680 面板，按需显示，锚定气泡展开
 *
 * 两者都 focusable:false —— 不抢游戏焦点。
 * 键盘全部走 globalShortcut：面板可见时才注册导航键，隐藏立即注销。
 */
/* Windows 控制台默认代码页 936(GBK)，Node 输出 UTF-8 → 中文日志乱码。
   chcp 65001 只影响“当前控制台窗口”，放在任何输出之前执行。 */
if (process.platform === 'win32') {
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore', windowsHide: true });
  } catch {}
}

const { app, BrowserWindow, Tray, Menu, screen, globalShortcut, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const source = require('./source');
const nativeBubble = require('./nativeBubble');
const panelShadow = require('./panelShadow');

/**
 * 窗口渲染模式（用环境变量切换，方便在不同机器上一次性试出最佳组合）
 *
 *   LC2_WIN_MODE=alpha       默认：透明窗口 + 关闭 DirectComposition（多数机器上可修白角）
 *   LC2_WIN_MODE=alpha-nogpu 透明窗口 + 关闭硬件加速（兼容性最强，文字略软）
 *   LC2_WIN_MODE=shape       setShape 窗口区域裁剪（保证无白角，但边缘有整数像素锯齿）
 *
 * 必须在 app ready 之前调用 appendSwitch，所以放在文件顶部。
 */
const WIN_MODE = (process.env.LC2_WIN_MODE || 'alpha').toLowerCase();

if (WIN_MODE === 'alpha') {
  // Windows 上透明窗口白角/黑底的常见根因是 D3D 直接合成，关掉它保留 GPU 加速
  app.commandLine.appendSwitch('disable-direct-composition');
  // 让 Chromium 正常走透明视觉
  app.commandLine.appendSwitch('enable-transparent-visuals');
} else if (WIN_MODE === 'alpha-nogpu') {
  app.disableHardwareAcceleration();
}

/* ---------------- 常量 ---------------- */
const BUBBLE = { w: 72, h: 72, inset: 4 };
const PANEL = { w: 440, h: 680 };
const MARGIN = 20;

const PANEL_RADIUS = 16;

/** 开发热部署：非打包环境默认开启，LC2_HOT=0 可关闭 */
const DEV_HOT = !app.isPackaged && process.env.LC2_HOT !== '0';

/**
 * 面板阴影（原生分层窗口绘制）
 *
 * 不能用"窗口留透明边距 + CSS 阴影"：透明窗口在部分 Windows 环境下失效，
 * 留白会变成浅灰框。所以面板窗口本体不透明（铺满 + setShape 圆角），
 * 阴影交给 native/shadow.ps1 的原生分层窗口，在外侧单独画。
 */
/**
 * 面板外侧阴影
 *
 * 默认关闭：面板阴影由「独立分层窗口」实现，它和 Electron 面板是两个窗口，
 * 拖拽/重绘时必然可能错位，表现为四周模糊、错位阴影、顶部白条、四角锯齿。
 * Win11 现在直接用 DWM 系统圆角 + 系统描边（单窗口，不存在同步问题）。
 * 需要旧阴影层时：LC2_PANEL_SHADOW=1
 */
const USE_PANEL_SHADOW = process.env.LC2_PANEL_SHADOW === '1';

/**
 * 面板圆角
 *
 * 默认方形：圆角窗口的四角会透出背后的像素（游戏/文档），在浅色背景上
 * 表现为四个白点，观感很脏。方形 + 1px 系统描边最干净。
 * 需要圆角：LC2_PANEL_ROUND=1
 */
const PANEL_ROUND = process.env.LC2_PANEL_ROUND === '1';
const SHADOW_PAD = Math.max(8, Math.min(48, Number(process.env.LC2_SHADOW_PAD ?? 24)));

/** 气泡实现：native（默认，Windows 分层窗口）| electron（旧的透明窗口，兜底） */
const USE_NATIVE_BUBBLE = (process.env.LC2_BUBBLE || 'native').toLowerCase() !== 'electron';

const BASE_KEYS = ['Alt+`', 'Ctrl+Alt+C', 'Alt+Shift+C', 'Ctrl+Shift+F12'];

const PANEL_KEYS = {
  Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
  Return: 'Enter', Space: ' ', Escape: 'Escape', Tab: 'Tab',
  D: 'd', F: 'f', I: 'i', H: 'h', P: 'p',
};

/* ---------------- 状态 ---------------- */
let bubbleWin = null;
let panelWin = null;
let tray = null;
let panelOpen = false;
let baseKey = null;
let panelKeysRegistered = false;
let dragState = null;
let panelDragState = null;
let dragMoveCount = 0;
let panelPinned = false;
/** 圆角模式：dwm（Win11 系统圆角）| shape（Win10 回退裁剪）| null（探测中） */
let panelCornersMode = null;
/** 面板休眠：被点到外部后不接收键盘，点击面板唤醒 */
let panelDormant = false;
let config = { bubble: null, panel: null };

const APP_DIR = path.join(__dirname, '..', '..');          // apps/desktop
const ASSETS_DIR = path.join(APP_DIR, 'assets');
/** 数据目录统一由 source 层决定（开发 = 仓库 data/，打包 = resources/data） */
const DATA_DIR = source.dataDir();
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

/* ---------------- 日志 / 配置 ---------------- */
function log(...a) { console.log('[lc2]', ...a); }

function loadConfig() {
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8')); } catch { config = {}; }
  if (!config.bubble) config.bubble = null;
  if (!config.panel) config.panel = null;
  // 数据来源：github（线上，GitHub 兼任文件存储）| local（开发）
  config.dataSource = process.env.LC2_DATA_SOURCE || config.dataSource || (app.isPackaged ? 'github' : 'local');
  if (typeof config.panelPinned !== 'boolean') config.panelPinned = false;
}
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
    fs.writeFileSync(CONFIG_PATH(), JSON.stringify(config, null, 2));
  } catch (e) { log('saveConfig failed:', e.message); }
}

/* ---------------- 数据（走 source 层：GitHub / 本地 / 缓存） ---------------- */
async function loadData() {
  const loaded = await source.loadBuilds({ source: config.dataSource });
  const file = loaded.file || { builds: [] };
  const statics = source.loadStatic();

  const builds = Array.isArray(file.builds) ? file.builds : [];
  if (!builds.length) log('builds 数据为空（source=' + loaded.source + '）');

  return {
    builds,
    weapons: statics.weapons,
    inscriptions: statics.inscriptions,
    schools: statics.schools,
    meta: {
      version: file.version || '0',
      gameVersion: file.gameVersion || '—',
      source: loaded.source,        // local | github | cache
      dataSource: config.dataSource,
    },
  };
}

/* ---------------- 几何 ---------------- */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function defaultBubbleBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - BUBBLE.w - MARGIN,
    y: workArea.y + Math.round(workArea.height / 2 - BUBBLE.h / 2),
    width: BUBBLE.w, height: BUBBLE.h,
  };
}
function currentBubbleBounds() {
  return config.bubble || defaultBubbleBounds();
}

/** 面板锚定气泡：默认向左展开，左侧不够则向右；垂直居中并夹紧 */
function panelBoundsFrom(b) {
  const disp = screen.getDisplayMatching({ x: b.x, y: b.y, width: b.width, height: b.height });
  const wa = disp.workArea;

  let x = b.x + Math.round(b.width / 2) - PANEL.w;
  if (x < wa.x) x = b.x + b.width - Math.round(b.width / 2);
  x = clamp(x, wa.x, wa.x + wa.width - PANEL.w);

  let y = b.y + Math.round(b.height / 2 - PANEL.h / 2);
  y = clamp(y, wa.y, wa.y + wa.height - PANEL.h);

  return { x, y, width: PANEL.w, height: PANEL.h };
}

/** 面板位置：优先用上次记住的位置，没有才锚定气泡 */
function resolvePanelBounds() {
  const fallback = panelBoundsFrom(currentBubbleBounds());
  if (!config.panel) return fallback;

  const p = config.panel;
  const disp = screen.getDisplayNearestPoint({ x: p.x, y: p.y });
  const wa = disp.workArea;
  // 显示器变了就把面板夹回可见区域
  return {
    x: clamp(p.x, wa.x, wa.x + wa.width - PANEL.w),
    y: clamp(p.y, wa.y, wa.y + wa.height - PANEL.h),
    width: PANEL.w,
    height: PANEL.h,
  };
}

/* ---------------- 窗口形状（兜底开关） ---------------- */
/**
 * 默认**不用** setShape：Windows 窗口区域是整数像素矩形，没有抗锯齿，
 * 圆形 / 圆角边缘会出现明显毛刺。
 *
 * 默认改用 transparent + CSS border-radius，边缘由 GPU 做 alpha 抗锯齿，平滑得多。
 * 只有当某台机器上透明合成失效（出现白角）时，才用 LC2_SHAPE_CLIP=1 回退到形状裁剪。
 */
const USE_SHAPE_CLIP = WIN_MODE === 'shape';

function shapeRounded(win, w, h, radius) {
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
  } catch (e) { log('setShape failed:', e.message); }
}

function applyBubbleShape() {
  if (!USE_SHAPE_CLIP) return;
  shapeRounded(bubbleWin, BUBBLE.w, BUBBLE.h, BUBBLE.w / 2);
}
function applyPanelShape() {
  if (!panelWin || panelWin.isDestroyed()) return;
  if (panelCornersMode === 'dwm') return;     // Win11：系统圆角，不裁剪
  if (panelCornersMode === null) return;      // 探测中，等结果
  // Win10 回退：窗口区域裁剪（阴影层会补一圈抗锯齿轮廓盖住阶梯）
  shapeRounded(panelWin, PANEL.w, PANEL.h, PANEL_RADIUS);
}

/**
 * 圆角方案探测
 *
 * Win11：DWM 系统圆角（抗锯齿、清晰）
 * Win10：DWM 不支持 → setShape 裁剪 + 阴影层内部填面板色补边
 * 无阴影进程：直接 setShape
 */
function setupPanelCorners() {
  if (!panelWin) return;

  const forced = (process.env.LC2_PANEL_CORNERS || 'auto').toLowerCase();

  if (forced === 'shape') {
    panelCornersMode = 'shape';
    if (USE_PANEL_SHADOW) panelShadow.setFill(true);
    applyPanelShape();
    log('panel corners: shape (forced)');
    return;
  }

  let hwndValue = '0';
  try {
    const buf = panelWin.getNativeWindowHandle();
    hwndValue = buf.length >= 8 ? buf.readBigUInt64LE(0).toString() : String(buf.readUInt32LE(0));
  } catch (e) {
    log('getNativeWindowHandle failed:', e.message);
  }

  panelShadow.setPanelCorner(hwndValue, PANEL_ROUND ? 2 : 1).then((ok) => {
    if (!panelWin || panelWin.isDestroyed()) return;
    if (ok) {
      panelCornersMode = 'dwm';
      try { panelWin.setShape([]); } catch {}
      log('panel corners: dwm', PANEL_ROUND ? 'round' : 'square');
    } else {
      panelCornersMode = 'shape';
      if (USE_PANEL_SHADOW) panelShadow.setFill(true);
      applyPanelShape();
      log('panel corners: shape fallback (win10/7)');
    }
  });
}

/* ---------------- 气泡窗口 ---------------- */
function createBubbleWindow() {
  const b = currentBubbleBounds();
  bubbleWin = new BrowserWindow({
    x: b.x, y: b.y, width: BUBBLE.w, height: BUBBLE.h,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  bubbleWin.setAlwaysOnTop(true, 'screen-saver');
  try { bubbleWin.setBackgroundColor('#00000000'); } catch {}
  try { bubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}

  bubbleWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { mode: 'bubble', win: WIN_MODE } });

  const reveal = () => {
    if (!bubbleWin || bubbleWin.isDestroyed()) return;
    if (!bubbleWin.isVisible()) bubbleWin.show();
    applyBubbleShape();
  };
  bubbleWin.once('ready-to-show', reveal);
  bubbleWin.webContents.once('did-finish-load', reveal);
  bubbleWin.on('closed', () => { bubbleWin = null; });

  // 层级守护
  setInterval(() => {
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.setAlwaysOnTop(true, 'screen-saver');
    if (panelWin && !panelWin.isDestroyed() && panelOpen) panelWin.setAlwaysOnTop(true, 'screen-saver');
  }, 1000);
}

/* ---------------- 面板窗口 ---------------- */
function createPanelWindow() {
  panelWin = new BrowserWindow({
    width: PANEL.w, height: PANEL.h,
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
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  panelWin.setAlwaysOnTop(true, 'screen-saver');
  try { panelWin.setBackgroundColor('#15161c'); } catch {}

  panelWin.webContents.on('console-message', (_e, level, message) => {
    log('[renderer]', message);
  });
  panelWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { mode: 'panel', win: WIN_MODE } });
  setupPanelCorners();
  panelWin.once('ready-to-show', () => applyPanelShape());
  panelWin.webContents.once('did-finish-load', () => applyPanelShape());
  // 开发热部署时渲染层会重载：重载后把当前开合/置顶状态重新下发
  panelWin.webContents.on('did-finish-load', () => {
    try {
      const b = currentBubbleBounds();
      const side = panelWin.getBounds().x < b.x ? 'left' : 'right';
      panelWin.webContents.send('lc2:panel', { open: panelOpen, pinned: panelPinned, side });
    } catch (e) { log('resend panel state failed:', e.message); }
  });
  // 面板不销毁，只隐藏，避免反复重建
  panelWin.on('blur', () => {
    log('panel blur');
    enterDormant();
  });
  panelWin.on('focus', () => log('panel focus'));
  panelWin.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); hidePanel(); } });
}

/** 全局左键点击：点在面板与气泡之外 → 收起面板（popover 行为） */
function onGlobalClick(px, py) {
  if (!panelOpen || !panelWin) return;
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  const x = px / scale;
  const y = py / scale;

  const pb = panelWin.getBounds();
  const inPanel = x >= pb.x && x <= pb.x + pb.width && y >= pb.y && y <= pb.y + pb.height;

  const bb = config.bubble || defaultBubbleBounds();
  const pad = 6;
  const inBubble =
    x >= bb.x - pad && x <= bb.x + bb.width + pad && y >= bb.y - pad && y <= bb.y + bb.height + pad;

  if (inPanel || inBubble) return;
  log('outside click: pinned =', panelPinned);
  if (panelPinned) {                           // 置顶模式：点击外部不收起，但进入休眠（停止接收键盘）
    enterDormant();
    return;
  }
  hidePanel();
}

panelShadow.onClick(onGlobalClick);

/* 原生拖拽流：辅助进程按 8ms 轮询光标，主进程据此移动面板。
   不依赖窗口焦点 / pointer capture，光标移出窗口也不会断。 */
panelShadow.onDrag((px, py) => {
  if (!panelWin || panelWin.isDestroyed() || !panelDragState) return;
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  movePanelTo(px / scale - panelDragState.ox, py / scale - panelDragState.oy);
});
panelShadow.onDragEnd(() => finalizePanelDrag());

/** 把面板移动到指定 DIP 坐标（拖拽用，带屏幕 clamp 与层级兜底） */
function movePanelTo(x, y) {
  if (!panelWin || panelWin.isDestroyed()) return;
  const disp = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  const wa = disp.workArea;
  const nx = clamp(x, wa.x, wa.x + wa.width - PANEL.w);
  const ny = clamp(y, wa.y, wa.y + wa.height - PANEL.h);
  panelWin.setPosition(Math.round(nx), Math.round(ny), false);
  dragMoveCount += 1;
  if (dragMoveCount % 12 === 0) {
    try { panelWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  }
}

/** 结束拖拽：落位保存、阴影恢复、日志（可重复调用） */
function finalizePanelDrag() {
  if (!panelWin || panelWin.isDestroyed() || !panelDragState) return;
  panelDragState = null;
  dragMoveCount = 0;
  try { panelShadow.dragStop(); } catch {}
  const b = panelWin.getBounds();
  config.panel = { x: b.x, y: b.y };
  try { saveConfig(); } catch (e) { log('save panel pos failed:', e.message); }
  log('panel moved ->', b.x, b.y);
  try {
    panelWin.setAlwaysOnTop(true, 'screen-saver');
    if (USE_PANEL_SHADOW) {
      panelShadow.setAlpha(255);
      panelShadow.showAt(b.x - SHADOW_PAD, b.y - SHADOW_PAD);
    }
    setTimeout(() => {
      if (!panelWin || panelWin.isDestroyed()) return;
      const nb = panelWin.getBounds();
      if (USE_PANEL_SHADOW) panelShadow.moveTo(nb.x - SHADOW_PAD, nb.y - SHADOW_PAD);
      try { panelWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    }, 120);
  } catch (e) { log('drag end resync failed:', e.message); }
}

/** 进入休眠：注销面板热键 + 不可聚焦（键盘完全交给游戏），点击面板可唤醒 */
function enterDormant() {
  if (!panelWin || panelWin.isDestroyed() || !panelOpen || panelDormant) return;
  panelDormant = true;
  disablePanelKeys();
  try { panelWin.setFocusable(false); } catch {}
  try { panelWin.webContents.send('lc2:dormant', true); } catch {}
  log('panel dormant（不接收键盘，点击面板唤醒）pinned =', panelPinned);
}

/** 退出搜索态：交还焦点、恢复不可聚焦、重新注册面板热键 */
function exitSearchFocus() {
  if (!panelWin || panelWin.isDestroyed()) return;
  // 注意：此处一定是在“窗口已经失焦（点了游戏/其它窗口）”或“面板即将隐藏”时调用，
  // 所以只需恢复不可聚焦 + 重新注册热键；不要 hide/show，否则会打断点击。
  try { panelWin.setFocusable(false); } catch {}
  if (panelOpen && !panelDormant) enablePanelKeys();
}

/** 显示/淡入面板阴影（位置 = 面板窗口向外扩 SHADOW_PAD） */
function showPanelShadow() {
  if (!USE_PANEL_SHADOW || !panelWin) return;
  const b = panelWin.getBounds();
  panelShadow
    .ensureStarted({ panelW: PANEL.w, panelH: PANEL.h, radius: PANEL_RADIUS, pad: SHADOW_PAD })
    .then((ok) => {
      if (!ok || !panelOpen) return;
      panelShadow.setAlpha(0);
      panelShadow.showAt(b.x - SHADOW_PAD, b.y - SHADOW_PAD);
      panelShadow.fadeTo(255, PANEL_FADE_IN_MS);
      // 阴影窗口更晚创建，会压在最上层；显式把面板抬回上面
      try { panelWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    });
}

/* ---------------- 面板显隐 ---------------- */

/**
 * 窗口级淡入淡出
 *
 * 目的：面板「弹出来」时不要硬切，配合渲染层动效一起给出轻盈感。
 * 安全兜底：某些系统设置下 setOpacity 无效，先探测一次，无效则直接显隐。
 */
const PANEL_FADE = process.env.LC2_PANEL_FADE !== '0';
const PANEL_FADE_IN_MS = Number(process.env.LC2_PANEL_FADE_IN_MS || 150);
const PANEL_FADE_OUT_MS = Number(process.env.LC2_PANEL_FADE_OUT_MS || 110);

let fadeSupported = null;   // null = 未探测
let fadeTimer = null;

function stopFade() {
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
}

function probeFadeSupport(win) {
  if (fadeSupported !== null) return fadeSupported;
  fadeSupported = false;
  if (!PANEL_FADE || typeof win.setOpacity !== 'function' || typeof win.getOpacity !== 'function') return false;
  try {
    win.setOpacity(0.02);
    fadeSupported = win.getOpacity() < 0.5;   // 读不回来说明系统忽略透明度
    win.setOpacity(1);
  } catch { fadeSupported = false; }
  log('panel fade supported =', fadeSupported);
  return fadeSupported;
}

function fadeIn(win) {
  // Win11 系统圆角依赖非 layered 窗口：一旦调用 setOpacity，窗口会变成 layered，
  // DWM 圆角可能失效。所以圆角走 DWM 时（或还在探测中）跳过窗口透明度动画。
  if (panelCornersMode !== 'shape') return;   // 系统圆角模式：绝不改 opacity（layered 会影响焦点/圆角）
  if (!probeFadeSupport(win)) { try { win.setOpacity(1); } catch {} return; }
  stopFade();
  const steps = Math.max(4, Math.round(PANEL_FADE_IN_MS / 16));
  let i = 0;
  win.setOpacity(0);
  fadeTimer = setInterval(() => {
    i += 1;
    const t = i / steps;
    const eased = 1 - Math.pow(1 - t, 3);      // ease-out cubic
    try { win.setOpacity(Math.min(1, eased)); } catch {}
    if (i >= steps) { stopFade(); try { win.setOpacity(1); } catch {} }
  }, 16);
}

function fadeOut(win, done) {
  if (panelCornersMode !== 'shape') { done(); return; }
  if (!probeFadeSupport(win)) { try { win.setOpacity(1); } catch {}; done(); return; }
  stopFade();
  const steps = Math.max(3, Math.round(PANEL_FADE_OUT_MS / 16));
  let i = 0;
  fadeTimer = setInterval(() => {
    i += 1;
    const t = i / steps;
    const eased = Math.pow(1 - t, 2);          // ease-in quad
    try { win.setOpacity(Math.max(0, eased)); } catch {}
    if (i >= steps) { stopFade(); done(); }
  }, 16);
}

function showPanel() {
  if (!panelWin || panelOpen) return;
  panelOpen = true;
  panelDormant = false;
  panelWin.setBounds(resolvePanelBounds(), false);
  applyPanelShape();
  fadeIn(panelWin);
  panelWin.showInactive();          // 显示但不抢焦点
  try { panelWin.setFocusable(false); } catch {}
  showPanelShadow();
  // 告诉渲染层面板从气泡哪一侧展开（决定进场动画的方向原点）
  const b = currentBubbleBounds();
  const side = panelWin.getBounds().x < b.x ? 'left' : 'right';
  panelWin.webContents.send('lc2:panel', { open: true, side, pinned: panelPinned });
  enablePanelKeys();
  log('panel open');
}

function hidePanel() {
  if (!panelWin || !panelOpen) return;
  panelOpen = false;
  panelDormant = false;
  disablePanelKeys();
  panelWin.webContents.send('lc2:panel', { open: false });
  exitSearchFocus();
  if (USE_PANEL_SHADOW) panelShadow.fadeTo(0, PANEL_FADE_OUT_MS, () => panelShadow.hide());
  fadeOut(panelWin, () => {
    try { panelWin.hide(); } catch {}
    // 系统圆角模式绝不能碰 opacity（layered 会让 DWM 圆角/焦点失效）
    if (panelCornersMode === 'shape') { try { panelWin.setOpacity(1); } catch {} }
    if (USE_PANEL_SHADOW) panelShadow.hide();
    log('panel close');
  });
}

function togglePanel() {
  panelOpen ? hidePanel() : showPanel();
}

/* ---------------- 气泡移动 ---------------- */
function setBubblePosition(x, y) {
  if (!bubbleWin) return;
  const disp = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  const wa = disp.workArea;
  const nx = clamp(x, wa.x, wa.x + wa.width - BUBBLE.w);
  const ny = clamp(y, wa.y, wa.y + wa.height - BUBBLE.h);
  bubbleWin.setPosition(Math.round(nx), Math.round(ny), false);
}

function persistBubbleBounds() {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  const b = bubbleWin.getBounds();
  config.bubble = { x: b.x, y: b.y, width: BUBBLE.w, height: BUBBLE.h };
  saveConfig();
  // 气泡与面板相互独立，这里不再挪动面板
}

/* ---------------- 热键 ---------------- */
function registerBaseKey() {
  for (const key of BASE_KEYS) {
    try {
      if (globalShortcut.register(key, togglePanel)) {
        baseKey = key;
        log('base hotkey =', key);
        return;
      }
    } catch (e) { log('register fail', key, e.message); }
  }
  log('!! all candidate hotkeys are taken; edit BASE_KEYS manually');
}

function enablePanelKeys() {
  if (panelKeysRegistered) return;
  panelKeysRegistered = true;
  for (const [acc, name] of Object.entries(PANEL_KEYS)) {
    try {
      globalShortcut.register(acc, () => {
        if (panelWin && !panelWin.isDestroyed() && panelOpen) {
          panelWin.webContents.send('lc2:key', name);
        }
      });
    } catch (e) { log('panel key fail', acc, e.message); }
  }
}

function disablePanelKeys() {
  if (!panelKeysRegistered) return;
  panelKeysRegistered = false;
  for (const acc of Object.keys(PANEL_KEYS)) {
    try { globalShortcut.unregister(acc); } catch {}
  }
}

/* ---------------- 托盘 ---------------- */
function createTray() {
  const candidates = [
    path.join(ASSETS_DIR, 'icon-32.png'),
    path.join(ASSETS_DIR, 'icon-64.png'),
    path.join(ASSETS_DIR, 'icon.png'),
  ];
  let img = nativeImage.createEmpty();
  for (const p of candidates) {
    try { if (fs.existsSync(p)) { img = nativeImage.createFromPath(p); break; } } catch {}
  }
  if (img.isEmpty()) { log('assets/icon.png missing; tray skipped'); return; }

  tray = new Tray(img);
  tray.setToolTip(`城堡助手${baseKey ? ' · ' + baseKey : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `呼出面板 (${baseKey || '未注册'})`, click: togglePanel },
    { type: 'separator' },
    { label: '打开数据目录', click: () => require('electron').shell.openPath(DATA_DIR) },
    { label: '退出', click: () => app.quit() },
  ]));
  tray.on('click', togglePanel);
}

/* ---------------- IPC ---------------- */
function setupIPC() {
  ipcMain.handle('lc2:getData', () => loadData());
  ipcMain.handle('lc2:getConfig', () => ({ baseKey, panelOpen }));

  ipcMain.on('lc2:toggle', () => togglePanel());
  ipcMain.on('lc2:closePanel', () => hidePanel());

  /* 气泡拖拽 */
  ipcMain.on('lc2:dragStart', (_e, p) => {
    if (!bubbleWin) return;
    const b = bubbleWin.getBounds();
    dragState = { ox: p.sx - b.x, oy: p.sy - b.y };
  });
  ipcMain.on('lc2:dragMove', (_e, p) => {
    if (!bubbleWin || !dragState) return;
    setBubblePosition(p.sx - dragState.ox, p.sy - dragState.oy);
  });
  ipcMain.on('lc2:dragEnd', () => {
    dragState = null;
    persistBubbleBounds();
    log('bubble moved ->', JSON.stringify(config.bubble));
  });

  /* 面板拖拽（独立于气泡） */
  ipcMain.on('lc2:panelDragStart', (_e, p) => {
    if (!panelWin) return;
    const b = panelWin.getBounds();
    panelDragState = { ox: p.sx - b.x, oy: p.sy - b.y };
    // 拖拽期间隐藏阴影：阴影是独立分层窗口，跟随移动必然滞后/错位，
    // 先藏起来，松手后按最终位置一次性显示，既不掉帧也不会有幽灵阴影。
    if (USE_PANEL_SHADOW) { try { panelShadow.hide(); } catch {} }
    try { panelShadow.dragStart(); } catch (e) { log('dragStart native failed:', e.message); }
    log('drag start panel=', JSON.stringify(b));
  });
  ipcMain.on('lc2:panelDragMove', (_e, p) => {
    // 位置更新以辅助进程的原生光标流为准；这里仅作兜底（如辅助进程不可用）
    if (!panelWin || !panelDragState || panelDragState.native !== false) return;
    movePanelTo(p.sx - panelDragState.ox, p.sy - panelDragState.oy);
  });
  /**
   * 搜索/筛选输入：临时让面板窗口可聚焦
   *
   * 代价说明：面板默认 focusable:false（不抢游戏焦点）。
   * 用户主动点搜索栏时，才临时 setFocusable(true)+focus()，并注销面板热键，
   * 这样字母键、方向键、退格、输入法都能正常进入输入框；
   * 退出输入（失焦/Esc）立即恢复不可聚焦并重新注册面板热键。
   */
  /** 点击面板唤醒：恢复可聚焦并聚焦窗口（面板热键保持注销，键盘由 DOM 处理） */
  ipcMain.on('lc2:activatePanel', () => {
    if (!panelWin || panelWin.isDestroyed() || !panelOpen) return;
    panelDormant = false;
    log('panel activate（点击唤醒）pinned =', panelPinned);
    try { panelWin.setFocusable(true); } catch {}
    try { panelWin.focus(); } catch {}
    try { panelWin.webContents.focus(); } catch {}
    if (panelWin.webContents) panelWin.webContents.send('lc2:dormant', false);
    setTimeout(() => {
      if (!panelWin || panelWin.isDestroyed()) return;
      const focused = panelWin.isFocused();
      log('panel activate: focused=', focused);
      if (!focused) {
        // 唤醒失败 → 退回"不抢焦点但可用热键"模式，避免键盘完全失效
        enablePanelKeys();
        panelWin.webContents.send('lc2:dormant', false);
        log('panel activate failed → 回退到热键模式');
      }
    }, 150);
  });

  ipcMain.on('lc2:searchFocus', (_e, on) => {
    if (!panelWin || panelWin.isDestroyed()) return;
    if (on) {
      panelDormant = false;
      panelWin.webContents.send('lc2:dormant', false);
      disablePanelKeys();
      try { panelWin.setFocusable(true); } catch {}
      try { panelWin.focus(); } catch {}
      try { panelWin.webContents.focus(); } catch {}
      setTimeout(() => {
        if (!panelWin || panelWin.isDestroyed()) return;
        log('search focus on: focusable=', panelWin.isFocusable(), 'focused=', panelWin.isFocused());
        if (!panelWin.isFocused()) {
          // 某些系统/窗口管理器下 focus() 不生效，show() 会强制激活
          log('search focus retry via show()');
          try { panelWin.show(); panelWin.webContents.focus(); } catch {}
          setTimeout(() => {
            if (panelWin && !panelWin.isDestroyed()) log('search focus retry result: focused=', panelWin.isFocused());
          }, 150);
        }
      }, 120);
    } else {
      exitSearchFocus();
    }
  });

  ipcMain.on('lc2:pinToggle', () => {
    panelPinned = !panelPinned;
    config.panelPinned = panelPinned;
    try { saveConfig(); } catch (e) { log('save pinned failed:', e.message); }
    if (panelWin && !panelWin.isDestroyed()) {
      panelWin.webContents.send('lc2:pin', panelPinned);
    }
    log('pin toggle →', panelPinned);
  });

  ipcMain.on('lc2:panelDragEnd', () => finalizePanelDrag());
}

/* ---------------- 原生气泡 ---------------- */
/**
 * @returns {Promise<boolean>} 是否成功接管气泡
 */
async function startNativeBubble() {
  const b = config.bubble || defaultBubbleBounds();
  try {
    return await nativeBubble.start({
      x: b.x,
      y: b.y,
      onClick: () => togglePanel(),
      onMove: (x, y) => {
        config.bubble = { x, y, width: BUBBLE.w, height: BUBBLE.h };
        saveConfig();
      },
      onExit: () => {
        // 原生进程意外退出：拉起 Electron 气泡兜底，保证热键仍可用
        log('原生气泡退出，切换 Electron 气泡');
        if (!app.isQuitting) createBubbleWindow();
      },
    });
  } catch (e) {
    log('startNativeBubble failed:', e.message);
    return false;
  }
}

/* ---------------- 开发热部署 ---------------- */
function debounce(fn, ms) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function reloadRendererWindows(reason) {
  const targets = [panelWin, bubbleWin].filter((w) => w && !w.isDestroyed());
  if (!targets.length) return;
  for (const w of targets) {
    try { w.webContents.reloadIgnoringCache(); } catch {}
  }
  log('hot reload:', reason);
}

function setupDevHotReload() {
  const rendererFile = path.join(__dirname, '..', 'renderer', 'index.html');
  fs.watchFile(rendererFile, { interval: 400 }, debounce(() => reloadRendererWindows('renderer'), 250));

  // 数据文件（开发模式读本地）→ 重载界面即可重新 getData
  const dataFiles = ['builds.json', 'weapons.json', 'inscriptions.json', 'schools.json']
    .map((n) => path.join(DATA_DIR, n));
  const reloadData = debounce(() => reloadRendererWindows('data'), 350);
  for (const f of dataFiles) fs.watchFile(f, { interval: 500 }, reloadData);

  // 原生脚本（气泡 / 阴影）→ 重启对应进程
  const nativeDir = path.join(__dirname, '..', '..', 'native');
  const restartNative = debounce(async () => {
    log('hot reload: native scripts changed, restarting helpers');
    try { nativeBubble.stop(); } catch {}
    try { panelShadow.stop(); } catch {}
    panelCornersMode = null;

    if (USE_NATIVE_BUBBLE) {
      const ok = await startNativeBubble();
      if (!ok) log('native bubble restart failed');
    }
    {
      await panelShadow.ensureStarted({ panelW: PANEL.w, panelH: PANEL.h, radius: PANEL_RADIUS, pad: SHADOW_PAD });
      setupPanelCorners();
    }
  }, 600);
  for (const f of ['bubble.ps1', 'shadow.ps1']) {
    fs.watchFile(path.join(nativeDir, f), { interval: 400 }, restartNative);
  }

  // 主进程 / preload 无法热重载，改动只提示（避免误以为没生效）
  const mainHint = debounce(() => log('hot reload: 主进程/preload 已变化 → 需要重启 npm run desktop'), 400);
  for (const dir of [__dirname, path.join(__dirname, '..')]) {
    try {
      fs.watch(dir, { recursive: false }, (_ev, filename) => {
        if (filename && /\.js$/.test(String(filename))) mainHint();
      });
    } catch {}
  }

  log('开发热部署已开启：renderer / data / native 自动重载（LC2_HOT=0 关闭）');
}

/* ---------------- 孤儿进程清理 ---------------- */
/**
 * 上一次进程被强杀 / 崩溃时，原生气泡与阴影进程可能残留（屏幕上多出图标）。
 * 启动时清理掉这些没有父进程的旧 helper：只匹配我们自己的脚本名，排除自身。
 */
function cleanupOrphanHelpers() {
  const { execFile } = require('child_process');
  const ps = [
    'Get-CimInstance Win32_Process -Filter "Name=\'powershell.exe\'"',
    "| Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'native\\(bubble|shadow)\\.ps1' }",
    '| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join(' ');
  try {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true }, (err) => {
      if (err) log('cleanup orphan helpers failed:', err.message);
      else log('已清理上次遗留的原生 helper 进程');
    });
  } catch (e) {
    log('cleanup orphan helpers failed:', e.message);
  }
}

/* ---------------- 启动 ---------------- */
app.isQuitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showPanel());

  app.whenReady().then(async () => {
    cleanupOrphanHelpers();
    loadConfig();
    panelPinned = Boolean(config.panelPinned);
    setupIPC();

    // 辅助进程必须常驻：即使不显示阴影，它也负责
    //   1) 给面板窗口设置 DWM 系统圆角/描边
    //   2) 全局左键轮询 → 点外部收起 / 置顶时休眠
    panelShadow
      .ensureStarted({ panelW: PANEL.w, panelH: PANEL.h, radius: PANEL_RADIUS, pad: SHADOW_PAD })
      .then((ok) => {
        if (!ok) log('警告：辅助进程启动失败 → 外部点击收起 / 系统圆角将不可用');
        else log('辅助进程就绪（DWM 圆角 + 全局点击轮询）');
      });

    createPanelWindow();

    const bubbleOk = USE_NATIVE_BUBBLE ? await startNativeBubble() : false;
    if (!bubbleOk) {
      if (USE_NATIVE_BUBBLE) log('原生启动失败，回退 Electron 气泡窗口（CSS 光环：默认静止，悬停旋转）');
      createBubbleWindow();
    } else if (bubbleWin && !bubbleWin.isDestroyed()) {
      // 原生接管成功：销毁可能残留的 Electron 气泡，避免两个气泡叠在一起
      log('原生气泡接管成功，销毁残留 Electron 气泡窗口');
      bubbleWin.destroy();
      bubbleWin = null;
    }

    registerBaseKey();
    log('window mode =', WIN_MODE, '| panel shadow =', USE_PANEL_SHADOW, '| shadow pad =', SHADOW_PAD, '| pinned =', panelPinned);
    createTray();
    if (DEV_HOT) setupDevHotReload();

    screen.on('display-metrics-changed', () => {
      if (!bubbleWin) return;
      const b = config.bubble || defaultBubbleBounds();
      setBubblePosition(b.x, b.y);
      persistBubbleBounds();
    });
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    app.isQuitting = true;
    try { nativeBubble.stop(); } catch {}
    try { panelShadow.stop(); } catch {}
    try { globalShortcut.unregisterAll(); } catch {}
    panelKeysRegistered = false;
    saveConfig();
  });
}
