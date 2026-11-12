/**
 * Electron 气泡窗口（原生分层气泡不可用时的兜底）
 *
 * 常驻 72×72、透明、不抢焦点；显示/拖拽由 index 统一管理。
 * 注意：始终置顶的「层级守护」定时器不在这里创建，避免创建多次时重复叠加。
 */
function createBubbleWindow({ BrowserWindow, path, BUBBLE, WIN_MODE, bounds, preloadPath, rendererDir, applyShape }) {
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: BUBBLE.w,
    height: BUBBLE.h,
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
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  try { win.setBackgroundColor('#00000000'); } catch {}
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}

  win.loadFile(path.join(rendererDir, 'index.html'), { query: { mode: 'bubble', win: WIN_MODE } });

  const reveal = () => {
    if (!win || win.isDestroyed()) return;
    if (!win.isVisible()) win.show();
    applyShape(win);
  };
  win.once('ready-to-show', reveal);
  win.webContents.once('did-finish-load', reveal);
  win.on('closed', () => {});

  return win;
}

module.exports = createBubbleWindow;
