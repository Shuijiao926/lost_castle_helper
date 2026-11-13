/**
 * 城堡助手 · 主进程入口（组合根）
 *
 * 职责只剩三件：启动顺序、依赖组装、退出清理。
 * 具体能力拆在：
 *   config.js          配置读写（校验 / 原子写 / 防抖落盘）
 *   data.js            数据加载（包装 source 层）
 *   notes-store.js     用户印象 JSON 存储
 *   geometry.js        窗口几何（纯函数）
 *   shape.js           setShape 圆角兜底
 *   panel.js           面板窗口控制器（显隐 / 拖拽 / 休眠 / 圆角 / 焦点）
 *   bubble-window.js   Electron 气泡窗口（原生分层气泡的兜底）
 *   tray.js            托盘
 *   shortcuts.js       全局热键
 *   ipc.js             IPC 白名单
 *   hot-reload.js      开发热部署
 *
 * 窗口架构（两个独立窗口，uTools 同款）：
 *   bubble  72×72 圆形气泡，常驻；panel 440×680 按需显示。
 *   两者都 focusable:false —— 不抢游戏焦点；键盘全走 globalShortcut。
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

const log = require('./util/log');
const debounce = require('./util/debounce');
const shapeRounded = require('./shape');
const createConfigStore = require('./config');
const createDataLoader = require('./data');
const createNotesStore = require('./notes-store');
const createSubmissionStore = require('./submission-store');
const createGeometry = require('./geometry');
const createPanel = require('./panel');
const createBubbleWindow = require('./bubble-window');
const createShortcuts = require('./shortcuts');
const createTray = require('./tray');
const { registerIpc } = require('./ipc');
const setupDevHotReload = require('./hot-reload');

const source = require('./source');
const nativeBubble = require('./nativeBubble');
const panelShadow = require('./panelShadow');

/* ---------------- 窗口渲染模式（必须 app ready 前设置） ---------------- */
const WIN_MODE = (process.env.LC2_WIN_MODE || 'alpha').toLowerCase();
if (WIN_MODE === 'alpha') {
  // Windows 上透明窗口白角/黑底的常见根因是 D3D 直接合成，关掉它保留 GPU 加速
  app.commandLine.appendSwitch('disable-direct-composition');
  app.commandLine.appendSwitch('enable-transparent-visuals');
} else if (WIN_MODE === 'alpha-nogpu') {
  app.disableHardwareAcceleration();
}

/* ---------------- 常量 ---------------- */
const BUBBLE = { w: 72, h: 72, inset: 4 };
// Electron 没有菜单尺寸查询接口，按当前两项菜单的 Windows DIP 尺寸预留空间。
const BUBBLE_MENU = { width: 64, height: 80, gap: 4 };
const PANEL = { w: 440, h: 680 };
const MARGIN = 20;
const PANEL_RADIUS = 16;
const DEV_HOT = !app.isPackaged && process.env.LC2_HOT !== '0';

/** 面板外侧阴影：默认关闭，Win11 用 DWM 系统圆角 + 描边 */
const USE_PANEL_SHADOW = process.env.LC2_PANEL_SHADOW === '1';
const PANEL_ROUND_ENV = (process.env.LC2_PANEL_ROUND || 'auto').toLowerCase();
const PANEL_CORNER_PREF = PANEL_ROUND_ENV === '1' ? 2 : (PANEL_ROUND_ENV === '0' ? 1 : 3);
const SHADOW_PAD = clampNumber(process.env.LC2_SHADOW_PAD, 24, 8, 48);

/** 气泡实现：native（默认，Windows 分层窗口）| electron（旧的透明窗口，兜底） */
const USE_NATIVE_BUBBLE = (process.env.LC2_BUBBLE || 'native').toLowerCase() !== 'electron';
const USE_SHAPE_CLIP = WIN_MODE === 'shape';

const BASE_KEYS = ['Alt+`', 'Ctrl+Alt+C', 'Alt+Shift+C', 'Ctrl+Shift+F12'];
const PANEL_KEYS = {
  Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
  Return: 'Enter', Space: ' ', Escape: 'Escape', Tab: 'Tab',
  D: 'd', F: 'f', I: 'i', H: 'h', P: 'p',
};

const APP_DIR = path.join(__dirname, '..', '..'); // apps/desktop
const ASSETS_DIR = path.join(APP_DIR, 'assets');
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const RENDERER_INDEX = path.join(RENDERER_DIR, 'index.html');
const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js');
const DATA_DIR = source.dataDir();

const FADE = {
  enabled: process.env.LC2_PANEL_FADE !== '0',
  inMs: clampNumber(process.env.LC2_PANEL_FADE_IN_MS, 150, 0, 2000),
  outMs: clampNumber(process.env.LC2_PANEL_FADE_OUT_MS, 110, 0, 2000),
};

function clampNumber(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* ---------------- 运行时状态 ---------------- */
app.isQuitting = false;

let panel = null;
let bubbleWin = null;
let bubbleHidden = false;
let bubbleMenu = null;
let bubbleMenuBounds = null;
let trayHandle = null;
let configStore = null;
let shortcuts = null;
let notesStore = null;
let dataLoader = null;
let geometry = null;
let disposeHotReload = null;

/* ---------------- 进程级兜底 ---------------- */
process.on('uncaughtException', (e) => {
  log.error('uncaughtException:', e && e.stack ? e.stack : e);
});
process.on('unhandledRejection', (e) => {
  log.error('unhandledRejection:', e && e.stack ? e.stack : e);
});

/* ---------------- 几何 / 气泡位置 ---------------- */
function currentBubbleBounds() {
  return configStore.state.bubble || geometry.defaultBubbleBounds(screen.getPrimaryDisplay().workArea);
}

function setBubblePosition(x, y) {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  closeBubbleMenu();
  const disp = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  const wa = disp.workArea;
  const nx = geometry.clamp(x, wa.x, wa.x + wa.width - BUBBLE.w);
  const ny = geometry.clamp(y, wa.y, wa.y + wa.height - BUBBLE.h);
  bubbleWin.setPosition(Math.round(nx), Math.round(ny), false);
}

function persistBubbleBounds() {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  const b = bubbleWin.getBounds();
  configStore.state.bubble = { x: b.x, y: b.y, width: BUBBLE.w, height: BUBBLE.h };
  configStore.save();
  // 气泡与面板相互独立，这里不再挪动面板
}

/* ---------------- 窗口安全加固 ---------------- */
function hardenWindow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  } catch {}
  win.webContents.on('will-navigate', (e, url) => {
    if (!String(url).startsWith('file://')) e.preventDefault();
  });
}

/* ---------------- 气泡窗口 ---------------- */
function createElectronBubble() {
  if (bubbleWin && !bubbleWin.isDestroyed()) return bubbleWin;
  bubbleWin = createBubbleWindow({
    BrowserWindow,
    path,
    BUBBLE,
    WIN_MODE,
    bounds: currentBubbleBounds(),
    preloadPath: PRELOAD_PATH,
    rendererDir: RENDERER_DIR,
    canReveal: () => !bubbleHidden,
    onContextMenu: (win) => showBubbleMenu(win, win.getBounds()),
    topmostLevel: 'floating',
    applyShape: (win) => {
      if (USE_SHAPE_CLIP) shapeRounded(win, BUBBLE.w, BUBBLE.h, BUBBLE.w / 2, log);
    },
  });
  hardenWindow(bubbleWin);
  return bubbleWin;
}

/**
 * 启动原生气泡（Windows 分层窗口）。
 * @returns {Promise<boolean>} 是否成功接管气泡
 */
async function startNativeBubble() {
  const b = currentBubbleBounds();
  try {
    const started = await nativeBubble.start({
      x: b.x,
      y: b.y,
      onClick: () => {
        closeBubbleMenu();
        panel.toggle();
      },
      onRightClick: (bounds) => showBubbleMenu(panel.getWindow(), bounds),
      onDragStart: closeBubbleMenu,
      onMove: (x, y) => {
        closeBubbleMenu();
        // 拖拽期间高频回调：只更新内存 + 防抖落盘，避免每 8ms 写一次磁盘
        configStore.state.bubble = { x, y, width: BUBBLE.w, height: BUBBLE.h };
        configStore.saveDebounced();
      },
      onExit: () => {
        closeBubbleMenu();
        // 原生进程意外退出：拉起 Electron 气泡兜底，保证热键仍可用
        log('原生气泡退出，切换 Electron 气泡');
        if (!app.isQuitting) createElectronBubble();
      },
    });
    if (started && bubbleHidden) nativeBubble.hide();
    return started;
  } catch (e) {
    log('startNativeBubble failed:', e.message);
    return false;
  }
}

async function initializeBubble() {
  const started = USE_NATIVE_BUBBLE && await startNativeBubble();
  if (!started) {
    if (USE_NATIVE_BUBBLE) log('原生启动失败，回退 Electron 气泡窗口');
    if (!app.isQuitting) createElectronBubble();
  } else if (bubbleWin && !bubbleWin.isDestroyed()) {
    // 原生接管成功后销毁备用窗口，避免两个气泡叠在一起。
    bubbleWin.destroy();
    bubbleWin = null;
  }
}

/* ---------------- 孤儿 helper 清理 ---------------- */
/**
 * 上一次进程被强杀 / 崩溃时，原生气泡与阴影进程可能残留（屏幕上多出图标）。
 * 启动时清理掉这些没有父进程的旧 helper：只匹配我们自己的脚本名，排除自身。
 * 必须 await —— 否则清理命令可能在 helper 启动后才执行，把新进程也杀掉。
 */
function cleanupOrphanHelpers() {
  return new Promise((resolve) => {
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
        resolve();
      });
    } catch (e) {
      log('cleanup orphan helpers failed:', e.message);
      resolve();
    }
  });
}

/* ---------------- 气泡右键菜单 ---------------- */
function restartApp() {
  if (app.isQuitting) return;
  // 便携版退出后会删除解包目录，需要从启动器重新运行。
  const launcher = app.isPackaged && process.env.PORTABLE_EXECUTABLE_FILE;
  app.relaunch(launcher ? { execPath: launcher } : {});
  app.quit();
}

function showBubbleMenu(window, bounds = currentBubbleBounds()) {
  if (app.isQuitting || bubbleHidden || !window || window.isDestroyed()) return;
  closeBubbleMenu();
  if (!bubbleMenu) {
    bubbleMenu = Menu.buildFromTemplate([
      { label: '重启', click: restartApp },
      { label: '隐藏', click: hideBubbleAndPanel },
    ]);
  }
  const bubble = { width: BUBBLE.w, height: BUBBLE.h, ...bounds };
  const { workArea } = screen.getDisplayMatching(bubble);
  const position = geometry.bubbleMenuPosition(bubble, workArea, BUBBLE_MENU);
  const origin = window.getContentBounds();
  // Electron 将相对坐标 -1 解释为光标位置。
  const x = position.x === origin.x - 1 ? 0 : position.x - origin.x;
  const y = position.y === origin.y - 1 ? 0 : position.y - origin.y;
  const menuBounds = { x: origin.x + x, y: origin.y + y, width: BUBBLE_MENU.width, height: BUBBLE_MENU.height };
  bubbleMenuBounds = menuBounds;
  shortcuts.setMenuEscape(closeBubbleMenu);
  bubbleMenu.popup({ window, x, y, callback: () => {
    if (bubbleMenuBounds !== menuBounds) return;
    bubbleMenuBounds = null;
    shortcuts.setMenuEscape(null);
  } });
}

function closeBubbleMenu() {
  if (!bubbleMenuBounds) return;
  bubbleMenuBounds = null;
  shortcuts.setMenuEscape(null);
  bubbleMenu.closePopup();
}

function handleOutsideClick(px, py) {
  if (bubbleMenuBounds) {
    const point = screen.screenToDipPoint({ x: px, y: py });
    const { x, y, width, height } = bubbleMenuBounds;
    // 让菜单内的点击交给 Electron，避免在选项触发前关闭菜单。
    if (point.x >= x && point.x < x + width && point.y >= y && point.y < y + height) return;
    closeBubbleMenu();
  }
  panel.handleOutsideClick(px, py);
}

function hideBubbleAndPanel() {
  closeBubbleMenu();
  bubbleHidden = true;
  if (nativeBubble.isRunning()) nativeBubble.hide();
  if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
  panel.hide();
}

/* ---------------- 托盘动作 ---------------- */
function showBubble() {
  bubbleHidden = false;
  if (nativeBubble.isRunning()) nativeBubble.show();
  if (bubbleWin && !bubbleWin.isDestroyed() && !bubbleWin.isVisible()) {
    const b = currentBubbleBounds();
    bubbleWin.setBounds({ x: b.x, y: b.y, width: BUBBLE.w, height: BUBBLE.h });
    bubbleWin.showInactive();
  }
}

/* ---------------- 启动 ---------------- */
if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.lc2.assistant'); } catch {}
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (panel) panel.show();
  });

  app.whenReady().then(async () => {
    log('app ready，开始初始化');
    await cleanupOrphanHelpers();
    log('残留 helper 清理完成');

    const userDataDir = app.getPath('userData');
    configStore = createConfigStore({
      userDataDir,
      isPackaged: app.isPackaged,
      env: process.env,
      log,
    });
    configStore.load();

    log('数据来源 =', configStore.state.dataSource, '| 缓存目录 =', source.cacheDir(), process.env.LC2_DATA_URL ? '| 自定义数据地址 = ' + process.env.LC2_DATA_URL : '');
    geometry = createGeometry({ BUBBLE, PANEL, MARGIN });
    notesStore = createNotesStore({ userDataDir, log });
    dataLoader = createDataLoader({ source, configStore, log });

    shortcuts = createShortcuts({ globalShortcut, log, BASE_KEYS, PANEL_KEYS });

    panel = createPanel({
      BrowserWindow,
      screen,
      panelShadow,
      configStore,
      geometry,
      getBubbleBounds: currentBubbleBounds,
      enablePanelKeys: () => shortcuts.enablePanelKeys({
        getWindow: () => panel.getWindow(),
        isOpen: () => panel.isOpen(),
      }),
      disablePanelKeys: () => shortcuts.disablePanelKeys(),
      isQuitting: () => Boolean(app.isQuitting),
      log,
      paths: { preload: PRELOAD_PATH, rendererIndex: RENDERER_INDEX },
      PANEL,
      PANEL_RADIUS,
      SHADOW_PAD,
      WIN_MODE,
      PANEL_CORNER_PREF,
      USE_PANEL_SHADOW,
      USE_SHAPE_CLIP,
      topmostLevel: 'floating',
      fade: FADE,
    });
    panel.setPinned(configStore.state.panelPinned);

    registerIpc({
      ipcMain,
      log,
      dataLoader,
      notesStore,
      configStore,
      panel,
      getAppVersion: () => app.getVersion(),
      getBaseKey: () => shortcuts.getBaseKey(),
      getBubbleWindow: () => bubbleWin,
      setBubblePosition,
      persistBubbleBounds,
      onSubmitBuild: async (payload) => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new Error('投稿内容无效');
        }
        const res = submissionStore.save(payload);
        log('submission saved:', res.path);
        return res;
      },
    });

    // 辅助进程必须常驻：即使不显示阴影，它也负责
    //   1) 给面板窗口设置 DWM 系统圆角/描边
    //   2) 全局左键轮询 → 点外部收起 / 置顶时休眠
    panelShadow.onClick(handleOutsideClick);
    panelShadow.onDrag((px, py) => panel.dragToPhysical(px, py));
    panelShadow.onDragEnd(() => panel.finalizeDrag());
    panelShadow
      .ensureStarted({ panelW: PANEL.w, panelH: PANEL.h, radius: PANEL_RADIUS, pad: SHADOW_PAD })
      .then((ok) => {
        if (!ok) log('警告：辅助进程启动失败 → 外部点击收起 / 系统圆角将不可用');
        else log('辅助进程就绪（DWM 圆角 + 全局点击轮询）');
      });

    panel.create();
    hardenWindow(panel.getWindow());
    log('面板窗口已创建');

    log('启动气泡：' + (USE_NATIVE_BUBBLE ? 'native' : 'electron'));
    await initializeBubble();

    shortcuts.registerBaseKey(() => panel.toggle());
    log('window mode =', WIN_MODE, '| panel shadow =', USE_PANEL_SHADOW, '| shadow pad =', SHADOW_PAD, '| pinned =', panel.isPinned());
    trayHandle = createTray({
      Tray,
      Menu,
      nativeImage,
      fs,
      path,
      assetsDir: ASSETS_DIR,
      getBaseKey: () => shortcuts.getBaseKey(),
      onShowBubble: showBubble,
      onToggle: () => panel.toggle(),
      onQuit: () => app.quit(),
      log,
    });
    log(trayHandle ? '托盘已就绪' : '托盘不可用（缺少图标资源）');

    if (DEV_HOT) {
      disposeHotReload = setupDevHotReload({
        fs,
        path,
        debounce,
        dirs: {
          rendererDir: RENDERER_DIR,
          dataDir: DATA_DIR,
          nativeDir: path.join(APP_DIR, 'native'),
          mainDir: __dirname,
          preloadDir: path.join(__dirname, '..'),
        },
        actions: {
          reloadRendererWindows(reason) {
            const targets = [panel && panel.getWindow(), bubbleWin].filter((w) => w && !w.isDestroyed());
            if (!targets.length) return;
            for (const w of targets) {
              try { w.webContents.reloadIgnoringCache(); } catch {}
            }
            log('hot reload:', reason);
          },
          async restartNativeHelpers() {
            log('hot reload: native scripts changed, restarting helpers');
            closeBubbleMenu();
            try { nativeBubble.stop(); } catch {}
            try { panelShadow.stop(); } catch {}
            if (USE_NATIVE_BUBBLE) await initializeBubble();
            await panelShadow.ensureStarted({ panelW: PANEL.w, panelH: PANEL.h, radius: PANEL_RADIUS, pad: SHADOW_PAD });
            panel.onNativeRestart();
          },
        },
        log,
      });
    }

    screen.on('display-metrics-changed', () => {
      if (!bubbleWin) return;
      const b = currentBubbleBounds();
      setBubblePosition(b.x, b.y);
      persistBubbleBounds();
    });
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    app.isQuitting = true;
    closeBubbleMenu();
      if (disposeHotReload) {
      try { disposeHotReload(); } catch {}
    }
    try { nativeBubble.stop(); } catch {}
    try { panelShadow.stop(); } catch {}
    if (shortcuts) shortcuts.unregisterAll();
    if (trayHandle) trayHandle.destroy();
    if (configStore) {
      configStore.saveDebounced.cancel();
      configStore.save();
    }
  });
}
