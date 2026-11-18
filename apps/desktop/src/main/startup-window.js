'use strict';

const TRANSITION_MS = 240;
const BUBBLE_SIZE = 72;

function createStartupWindow({
  BrowserWindow, screen, bounds, page, isQuitting, log, onClosed = () => {},
  timers = { setTimeout, clearTimeout }, now = () => performance.now(),
}) {
  const { workArea } = screen.getDisplayMatching(bounds);
  const width = 226;
  const height = 84;
  const win = new BrowserWindow({
    x: Math.max(workArea.x, Math.min(bounds.x + bounds.width - width, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(bounds.y + Math.round((bounds.height - height) / 2), workArea.y + workArea.height - height)),
    width, height, show: false, focusable: false, skipTaskbar: true,
    frame: false, resizable: false, roundedCorners: true,
    backgroundColor: '#21162c',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  let initialized = false;
  let visible = false;
  let dragging = false;
  let transitioning = false;
  let timer = null;
  let status = '正在准备…';
  let destination = null;

  function destroy() {
    if (!win.isDestroyed()) win.destroy();
  }

  async function updatePage() {
    if (!visible || win.isDestroyed()) return;
    try {
      await win.webContents.executeJavaScript(
        'document.getElementById("startupStatus").textContent = ' + JSON.stringify(status) + ';',
      );
    } catch (error) {
      if (!win.isDestroyed()) log.warn('更新启动状态失败:', error.message);
    }
  }

  async function closeWhenReady() {
    if (!initialized || !visible || dragging || transitioning || win.isDestroyed()) return;
    transitioning = true;
    const start = win.getBounds();
    destination = {
      x: start.x + start.width - BUBBLE_SIZE,
      y: start.y + Math.round((start.height - BUBBLE_SIZE) / 2),
      width: BUBBLE_SIZE,
      height: BUBBLE_SIZE,
    };
    let reduced = false;
    try {
      reduced = await win.webContents.executeJavaScript(
        'document.body.classList.add("is-finishing"); LC2.ui.motion.isReduced();',
      );
    } catch (error) {
      if (win.isDestroyed()) return;
      log.warn('启动卡片收拢失败:', error.message);
    }
    if (win.isDestroyed()) return;
    const began = now();
    function step() {
      timer = null;
      if (win.isDestroyed()) return;
      if (isQuitting()) { destroy(); return; }
      const progress = reduced ? 1 : Math.min(1, (now() - began) / TRANSITION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = {};
      for (const key of ['x', 'y', 'width', 'height']) {
        next[key] = Math.round(start[key] + (destination[key] - start[key]) * eased);
      }
      win.setBounds(next);
      if (progress === 1) destroy();
      else timer = timers.setTimeout(step, 16);
    }
    step();
  }

  function finishWhenReady() {
    closeWhenReady().catch((error) => {
      log.warn('启动卡片退场失败:', error.message);
      destroy();
    });
  }

  win.setAlwaysOnTop(true, 'floating');
  win.on('will-move', (event) => {
    if (transitioning) event.preventDefault();
    else dragging = true;
  });
  win.on('moved', () => {
    dragging = false;
    finishWhenReady();
  });
  win.once('ready-to-show', () => {
    if (isQuitting() || win.isDestroyed()) return;
    visible = true;
    win.showInactive();
    updatePage().catch((error) => log.warn('更新启动状态失败:', error.message));
    finishWhenReady();
  });
  win.once('closed', () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    onClosed(destination);
  });
  win.webContents.once('render-process-gone', destroy);
  win.loadFile(page).catch((error) => {
    if (win.isDestroyed()) return;
    log.warn('启动提示加载失败:', error.message);
    destroy();
  });
  return {
    setStatus(text) {
      status = text;
      updatePage().catch((error) => log.warn('更新启动状态失败:', error.message));
    },
    finish() {
      initialized = true;
      finishWhenReady();
    },
    destroy,
  };
}

module.exports = createStartupWindow;
