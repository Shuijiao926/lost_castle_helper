/**
 * IPC 注册（应用层）
 *
 * 渲染层只能通过这里暴露的白名单接口访问主进程能力。
 * 所有来自渲染层的坐标 / 文本都做类型校验，避免坏参数把窗口移到 NaN。
 */
function registerIpc({
  ipcMain,
  log,
  dataLoader,
  notesStore,
  configStore,
  panel,
  getAppVersion,
  getBaseKey,
  getBubbleWindow,
  setBubblePosition,
  persistBubbleBounds,
}) {
  let dragState = null;
  const finite = (v) => Number.isFinite(v);

  /* ---------------- 数据 / 配置 ---------------- */
  ipcMain.handle('lc2:getData', () => dataLoader.load());
  ipcMain.handle('lc2:getConfig', () => ({ version: getAppVersion(), baseKey: getBaseKey(), panelOpen: panel.isOpen() }));

  /* ---------------- 用户印象 ---------------- */
  ipcMain.handle('lc2:notes:get', () => notesStore.readAll());
  ipcMain.handle('lc2:notes:set', (_e, payload) => {
    const { buildId, text } = payload || {};
    const { ok, all } = notesStore.set(buildId, text);
    if (ok) log('note saved:', buildId, typeof text === 'string' && text.trim() ? '(len ' + text.trim().length + ')' : '(cleared)');
    else log('note rejected: invalid buildId');
    return all;
  });

  /* ---------------- 面板 ---------------- */
  ipcMain.on('lc2:toggle', () => panel.toggle());
  ipcMain.on('lc2:closePanel', () => panel.hide());
  ipcMain.on('lc2:pinToggle', () => panel.togglePin());
  ipcMain.on('lc2:activatePanel', () => panel.wake());
  ipcMain.on('lc2:searchFocus', (_e, on) => panel.setSearchFocus(on === true));

  /**
   * 搜索/筛选输入：临时让面板窗口可聚焦
   * 面板默认 focusable:false（不抢游戏焦点），用户主动点搜索栏时才临时放开。
   */

  /* ---------------- 气泡拖拽 ---------------- */
  ipcMain.on('lc2:dragStart', (_e, p) => {
    const win = getBubbleWindow();
    if (!win || win.isDestroyed()) return;
    if (!p || !finite(p.sx) || !finite(p.sy)) return;
    const b = win.getBounds();
    dragState = { ox: p.sx - b.x, oy: p.sy - b.y };
  });
  ipcMain.on('lc2:dragMove', (_e, p) => {
    if (!dragState || !p || !finite(p.sx) || !finite(p.sy)) return;
    setBubblePosition(p.sx - dragState.ox, p.sy - dragState.oy);
  });
  ipcMain.on('lc2:dragEnd', () => {
    dragState = null;
    persistBubbleBounds();
    log('bubble moved ->', JSON.stringify(configStore.state.bubble));
  });

  /* ---------------- 面板拖拽 ---------------- */
  ipcMain.on('lc2:panelDragStart', (_e, p) => panel.startDrag(p));
  ipcMain.on('lc2:panelDragMove', (_e, p) => panel.dragMoveFallback(p));
  ipcMain.on('lc2:panelDragEnd', () => panel.finalizeDrag());
}

module.exports = { registerIpc };
