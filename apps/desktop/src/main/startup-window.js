'use strict';

const MIN_VISIBLE_MS = 5000;

function createStartupWindow({ BrowserWindow, screen, bounds, page, isQuitting, log, onClosed = () => {}, timers = { setTimeout, clearTimeout } }) {
  const { workArea } = screen.getDisplayMatching(bounds);
  const width = 226;
  const height = 84;
  const win = new BrowserWindow({
    x: Math.max(workArea.x, Math.min(bounds.x + bounds.width - width, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(bounds.y + bounds.height - height, workArea.y + workArea.height - height)),
    width,
    height,
    show: false,
    focusable: false,
    skipTaskbar: true,
    frame: false,
    resizable: false,
    backgroundColor: '#21162c',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  let initialized = false;
  let minimumElapsed = false;
  let timer = null;

  function destroy() {
    if (!win.isDestroyed()) win.destroy();
  }

  function closeWhenReady() {
    if (initialized && minimumElapsed) destroy();
  }

  win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(true);
  win.once('ready-to-show', () => {
    if (isQuitting() || win.isDestroyed()) return;
    win.showInactive();
    timer = timers.setTimeout(() => {
      timer = null;
      minimumElapsed = true;
      closeWhenReady();
    }, MIN_VISIBLE_MS);
  });
  win.once('closed', () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    onClosed();
  });
  win.webContents.once('render-process-gone', destroy);
  win.loadFile(page).catch((error) => {
    // 退出时销毁窗口可能取消尚未完成的导航。
    if (win.isDestroyed()) return;
    log.warn('启动提示加载失败:', error.message);
    destroy();
  });
  return {
    finish() {
      initialized = true;
      closeWhenReady();
    },
    destroy,
  };
}

module.exports = createStartupWindow;
