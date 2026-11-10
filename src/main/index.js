/**
 * 城堡助手 · 主进程（M1 骨架）
 *
 * 职责：
 *  - 单实例 / 托盘 / 窗口生命周期
 *  - 气泡 ⇄ 面板 两形态单窗口切换（不抢焦点）
 *  - 全局热键：常驻只 1 个，面板展开时才临时注册方向键
 *  - 读 data/*.json 并通过 IPC 交给渲染层
 *
 * 纪律：enablePanelKeys / disablePanelKeys 必须成对，否则方向键会被永久占用。
 */
const { app, BrowserWindow, Tray, Menu, screen, globalShortcut, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

/* ---------------- 常量 ---------------- */
const BUBBLE = { w: 44, h: 44 };
const PANEL = { w: 440, h: 680 };
const MARGIN = 20;

/** 默认热键 + 备选（按顺序尝试） */
const BASE_KEYS = ['Alt+`', 'Ctrl+Alt+C', 'Alt+Shift+C', 'Ctrl+Shift+F12'];

/** 面板展开期间临时注册的键 → 传给渲染层的按键名 */
const PANEL_KEYS = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Return: 'Enter',
  Space: ' ',
  Escape: 'Escape',
  Tab: 'Tab',
  D: 'd',
  F: 'f',
  I: 'i',
  H: 'h',
};

/* ---------------- 状态 ---------------- */
let win = null;
let tray = null;
let panelOpen = false;
let baseKey = null;
let panelKeysRegistered = false;
let config = { bubble: null };

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

/* ---------------- 配置 ---------------- */
function loadConfig() {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8'));
  } catch {
    config = { bubble: null };
  }
  if (!config.bubble) config.bubble = null;
}
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true });
    fs.writeFileSync(CONFIG_PATH(), JSON.stringify(config, null, 2));
  } catch (e) {
    log('saveConfig failed: ' + e.message);
  }
}

/* ---------------- 日志 ---------------- */
function log(...a) {
  console.log('[lc2]', ...a);
}

/* ---------------- 数据 ---------------- */
function readJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch (e) {
    log(`read ${name} failed: ${e.message}`);
    return fallback;
  }
}

function loadData() {
  const buildsFile = readJSON('builds.json', null);
  const weapons = readJSON('weapons.json', { weapons: [] });
  const inscriptions = readJSON('inscriptions.json', { inscriptions: [] });
  const schools = readJSON('schools.json', { schools: [] });

  let builds = [];
  let meta = { version: '0', gameVersion: '—' };
  if (buildsFile && Array.isArray(buildsFile.builds)) {
    builds = buildsFile.builds;
    meta = { version: buildsFile.version || '0', gameVersion: buildsFile.gameVersion || '—' };
  } else {
    log('builds.json 读取失败或格式不对，使用空数据集');
  }
  return { builds, weapons: weapons.weapons || [], inscriptions: inscriptions.inscriptions || [], schools: schools.schools || [], meta };
}

/* ---------------- 几何 ---------------- */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function defaultBubbleBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - BUBBLE.w - MARGIN,
    y: workArea.y + Math.round(workArea.height / 2 - BUBBLE.h / 2),
    width: BUBBLE.w,
    height: BUBBLE.h,
  };
}

function currentBubbleBounds() {
  return config.bubble || defaultBubbleBounds();
}

/** 面板从气泡自动展开：默认往左，空间不足则往右；垂直居中并夹紧 */
function panelBoundsFrom(b) {
  const disp = screen.getDisplayMatching({ x: b.x, y: b.y, width: b.width, height: b.height });
  const wa = disp.workArea;

  let x = b.x - PANEL.w + Math.round(b.width / 2);
  if (x < wa.x) x = b.x + b.width - Math.round(b.width / 2);
  x = clamp(x, wa.x, wa.x + wa.width - PANEL.w);

  let y = b.y + Math.round(b.height / 2 - PANEL.h / 2);
  y = clamp(y, wa.y, wa.y + wa.height - PANEL.h);

  return { x, y, width: PANEL.w, height: PANEL.h };
}

/* ---------------- 窗口 ---------------- */
function createWindow() {
  const b = currentBubbleBounds();

  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: BUBBLE.w,
    height: BUBBLE.h,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // 关键：永不抢焦点
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.on('closed', () => { win = null; });

  // 层级守护：被别的顶层窗口压下去就拉回来
  setInterval(() => {
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  }, 1000);
}

/* ---------------- 形态切换 ---------------- */
function openPanel() {
  if (!win || panelOpen) return;
  panelOpen = true;
  win.setBounds(panelBoundsFrom(currentBubbleBounds()), false);
  win.webContents.send('lc2:mode', 'panel');
  enablePanelKeys();
  log('panel open');
}

function closePanel() {
  if (!win || !panelOpen) return;
  panelOpen = false;
  disablePanelKeys();
  win.webContents.send('lc2:mode', 'bubble');
  win.setBounds(currentBubbleBounds(), false);
  log('panel close');
}

function togglePanel() {
  panelOpen ? closePanel() : openPanel();
}

/** 保存气泡位置（拖动后调用） */
function moveBubbleTo(x, y) {
  const disp = screen.getDisplayNearestPoint({ x, y });
  const wa = disp.workArea;
  const b = {
    x: clamp(x, wa.x, wa.x + wa.width - BUBBLE.w),
    y: clamp(y, wa.y, wa.y + wa.height - BUBBLE.h),
    width: BUBBLE.w,
    height: BUBBLE.h,
  };
  config.bubble = b;
  saveConfig();
  if (win && !panelOpen) win.setBounds(b, false);
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
    } catch (e) {
      log('register fail', key, e.message);
    }
  }
  log('!! 所有候选热键都被占用，请手动改 BASE_KEYS');
}

/**
 * 只在面板展开期间注册导航键，关闭立即注销。
 * 任何异常都不能让注册残留 —— 否则玩家游戏内方向键会失效。
 */
function enablePanelKeys() {
  if (panelKeysRegistered) return;
  panelKeysRegistered = true;
  for (const [acc, name] of Object.entries(PANEL_KEYS)) {
    try {
      globalShortcut.register(acc, () => {
        if (win && !win.isDestroyed()) win.webContents.send('lc2:key', name);
      });
    } catch (e) {
      log('panel key fail', acc, e.message);
    }
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
  const iconPath = path.join(ROOT, 'assets', 'icon.png');
  let img = nativeImage.createEmpty();
  try {
    if (fs.existsSync(iconPath)) img = nativeImage.createFromPath(iconPath);
  } catch {}

  if (img.isEmpty()) {
    log('assets/icon.png 缺失，跳过托盘（用热键 Alt+` 呼出）');
    return;
  }

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
  ipcMain.handle('lc2:setConfig', (_e, patch) => {
    if (patch && typeof patch.bubble === 'object') moveBubbleTo(patch.bubble.x, patch.bubble.y);
    return { ok: true };
  });
  ipcMain.on('lc2:toggle', () => togglePanel());
}

/* ---------------- 启动 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) openPanel(); });

  app.whenReady().then(() => {
    loadConfig();
    setupIPC();
    createWindow();
    registerBaseKey();
    createTray();

    app.on('activate', () => { if (!win) createWindow(); });
  });

  app.on('window-all-closed', () => app.quit());

  // 退出前必须释放所有热键
  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch {}
    panelKeysRegistered = false;
    saveConfig();
  });

  // 显示器变化时把窗口拉回可见区域
  screen.on('display-metrics-changed', () => {
    if (!win || panelOpen) return;
    const b = config.bubble || defaultBubbleBounds();
    moveBubbleTo(b.x, b.y);
  });
}
