/**
 * IPC 注册（应用层）
 *
 * 渲染层只能通过这里暴露的白名单接口访问主进程能力。
 * 所有来自渲染层的坐标 / 文本都做类型校验，避免坏参数把窗口移到 NaN。
 */
function registerIpc({
  ipcMain,
  dataLoader,
  startInitialDataLoad,
  notesStore,
  panel,
  getAppVersion,
  getBaseKey,
  getBubbleWindow,
  setBubblePosition,
  persistBubbleBounds,
  onSubmitBuild,
  onSubmitMode,
  setModalEscape,
}) {
  let dragState = null;
  const finite = (v) => Number.isFinite(v);

  /* ---------------- 数据 / 配置 ---------------- */
  let firstDataRequest = true;
  ipcMain.handle('lc2:getData', async () => {
    const finish = firstDataRequest ? startInitialDataLoad?.() : null;
    firstDataRequest = false;
    try {
      const data = await dataLoader.load();
      finish?.('来源=' + data.meta.source + ' · 流派=' + data.builds.length + ' 条');
      return data;
    } catch (error) {
      finish?.('失败');
      throw error;
    }
  });
  ipcMain.handle('lc2:checkUpdate', () => updater.checkForUpdates());
  ipcMain.handle('lc2:openExternal', (_e, url) => updater.openExternal(String(url || '')));
  ipcMain.handle('lc2:getConfig', () => ({ version: getAppVersion(), baseKey: getBaseKey(), panelOpen: panel.isOpen() }));

  /* ---------------- 用户印象 ---------------- */
  ipcMain.handle('lc2:notes:get', () => notesStore.readAll());
  ipcMain.handle('lc2:notes:set', (_e, payload) => {
    const { buildId, text } = payload || {};
    const { all } = notesStore.set(buildId, text);
    return all;
  });

  /* ---------------- 投稿草稿 ---------------- */
  ipcMain.handle('lc2:submitBuild', async (_e, payload) => {
    if (typeof onSubmitBuild !== 'function') throw new Error('投稿保存不可用');
    return onSubmitBuild(payload);
  });

  ipcMain.handle('lc2:submitMode', (_e, on) => {
    if (typeof onSubmitMode === 'function') onSubmitMode(on === true);
  });

  /* ---------------- 面板 ---------------- */
  ipcMain.on('lc2:toggle', () => panel.toggle());
  ipcMain.on('lc2:closePanel', () => panel.hide());
  ipcMain.on('lc2:pinToggle', () => panel.togglePin());
  ipcMain.on('lc2:activatePanel', () => panel.wake());
  ipcMain.on('lc2:searchFocus', (_e, on) => panel.setSearchFocus(on === true));

  /**
   * 弹层占用 Esc
   * 输入框临时获焦时面板热键会被注销（否则输入框收不到按键），
   * 这时 Esc 只能靠窗口焦点，窗口一失焦弹层就关不掉。
   * 由渲染层在打开/关闭弹层时申请，单独把 Esc 抢回来再转发成普通按键。
   */
  ipcMain.on('lc2:modalEscape', (_e, on) => {
    if (typeof setModalEscape === 'function') setModalEscape(on === true);
  });

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
  });

  /* ---------------- 面板拖拽 ---------------- */
  ipcMain.on('lc2:panelDragStart', (_e, p) => panel.startDrag(p));
  ipcMain.on('lc2:panelDragMove', (_e, p) => panel.dragMoveFallback(p));
  ipcMain.on('lc2:panelDragEnd', () => panel.finalizeDrag());
  ipcMain.on('lc2:panelResizeStart', (_e, p) => panel.startResize(p));
  ipcMain.on('lc2:panelResizeEnd', () => panel.finalizeResize());
  ipcMain.on('lc2:setPanelSize', (_e, size) => { if (size) panel.setSize(Number(size.width), Number(size.height)); });
}

module.exports = { registerIpc };
