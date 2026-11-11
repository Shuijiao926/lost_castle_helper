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
const { app, BrowserWindow, Tray, Menu, screen, globalShortcut, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const source = require('./source');
const nativeBubble = require('./nativeBubble');

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

/** 气泡实现：native（默认，Windows 分层窗口）| electron（旧的透明窗口，兜底） */
const USE_NATIVE_BUBBLE = (process.env.LC2_BUBBLE || 'native').toLowerCase() !== 'electron';

const BASE_KEYS = ['Alt+`', 'Ctrl+Alt+C', 'Alt+Shift+C', 'Ctrl+Shift+F12'];

const PANEL_KEYS = {
  Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
  Return: 'Enter', Space: ' ', Escape: 'Escape', Tab: 'Tab',
  D: 'd', F: 'f', I: 'i', H: 'h',
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
  if (!USE_SHAPE_CLIP) return;
  shapeRounded(panelWin, PANEL.w, PANEL.h, 12);
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

  panelWin.setAlwaysOnTop(true, 'screen-saver');
  try { panelWin.setBackgroundColor('#00000000'); } catch {}

  panelWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { mode: 'panel', win: WIN_MODE } });
  panelWin.once('ready-to-show', () => applyPanelShape());
  panelWin.webContents.once('did-finish-load', () => applyPanelShape());
  // 面板不销毁，只隐藏，避免反复重建
  panelWin.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); hidePanel(); } });
}

/* ---------------- 面板显隐 ---------------- */
function showPanel() {
  if (!panelWin || panelOpen) return;
  panelOpen = true;
  panelWin.setBounds(resolvePanelBounds(), false);
  applyPanelShape();
  panelWin.showInactive();          // 显示但不抢焦点
  panelWin.webContents.send('lc2:panel', 'open');
  enablePanelKeys();
  log('panel open');
}

function hidePanel() {
  if (!panelWin || !panelOpen) return;
  panelOpen = false;
  disablePanelKeys();
  panelWin.webContents.send('lc2:panel', 'close');
  panelWin.hide();
  log('panel close');
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
  });
  ipcMain.on('lc2:panelDragMove', (_e, p) => {
    if (!panelWin || !panelDragState) return;
    const disp = screen.getDisplayNearestPoint({ x: Math.round(p.sx), y: Math.round(p.sy) });
    const wa = disp.workArea;
    const x = clamp(p.sx - panelDragState.ox, wa.x, wa.x + wa.width - PANEL.w);
    const y = clamp(p.sy - panelDragState.oy, wa.y, wa.y + wa.height - PANEL.h);
    panelWin.setPosition(Math.round(x), Math.round(y), false);
  });
  ipcMain.on('lc2:panelDragEnd', () => {
    if (!panelWin) return;
    panelDragState = null;
    const b = panelWin.getBounds();
    config.panel = { x: b.x, y: b.y };
    saveConfig();
    log('panel moved ->', b.x, b.y);
  });
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

/* ---------------- 启动 ---------------- */
app.isQuitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showPanel());

  app.whenReady().then(async () => {
    loadConfig();
    setupIPC();
    createPanelWindow();

    const bubbleOk = USE_NATIVE_BUBBLE ? await startNativeBubble() : false;
    if (!bubbleOk) {
      if (USE_NATIVE_BUBBLE) log('原生启动失败，回退 Electron 气泡窗口');
      createBubbleWindow();
    }

    registerBaseKey();
    log('window mode =', WIN_MODE, '| shape clip =', USE_SHAPE_CLIP);
    createTray();

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
    try { globalShortcut.unregisterAll(); } catch {}
    panelKeysRegistered = false;
    saveConfig();
  });
}
