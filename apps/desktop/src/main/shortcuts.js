/**
 * 全局热键
 *
 * - 基础热键（呼出面板）从候选列表里挑第一个能注册的
 * - 面板热键只在面板可见时注册，隐藏立即注销（否则会抢游戏按键）
 */
function createShortcuts({ globalShortcut, log, BASE_KEYS, PANEL_KEYS }) {
  let baseKey = null;
  let panelKeysRegistered = false;
  let panelEscape = null;
  let menuEscape = null;
  let modalEscape = null;
  let escapeRegistered = false;

  /** Esc 的占用优先级：弹层 > 气泡菜单 > 面板 */
  const escapeHandler = () => modalEscape || menuEscape || panelEscape;

  function updateEscapeShortcut() {
    try {
      if (escapeHandler() && !escapeRegistered) {
        escapeRegistered = globalShortcut.register('Escape', () => escapeHandler()?.());
      } else if (!escapeHandler() && escapeRegistered) {
        globalShortcut.unregister('Escape');
        escapeRegistered = false;
      }
    } catch (e) {
      log('register fail Escape', e.message);
    }
  }

  function setMenuEscape(handler) {
    menuEscape = handler;
    updateEscapeShortcut();
  }

  /**
   * 弹层占用 Esc。
   *
   * 输入控件临时获焦时主进程会注销面板热键（否则输入框收不到按键），
   * 此时 Esc 只剩「窗口有焦点」这一条路，窗口一旦失焦弹层就关不掉了。
   * 打开弹层时把 Esc 重新注册回来，由渲染层统一处理成关闭当前弹层。
   */
  function setModalEscape(handler) {
    modalEscape = handler;
    updateEscapeShortcut();
  }

  function registerBaseKey(handler) {
    for (const key of BASE_KEYS) {
      try {
        if (globalShortcut.register(key, handler)) {
          baseKey = key;
          return baseKey;
        }
      } catch (e) {
        log('register fail', key, e.message);
      }
    }
    log('!! all candidate hotkeys are taken; edit BASE_KEYS manually');
    return null;
  }

  function enablePanelKeys({ getWindow, isOpen }) {
    if (panelKeysRegistered) return;
    panelKeysRegistered = true;
    for (const [acc, name] of Object.entries(PANEL_KEYS)) {
      const handler = () => {
        const win = getWindow();
        if (win && !win.isDestroyed() && isOpen()) win.webContents.send('lc2:key', name);
      };
      if (acc === 'Escape') {
        panelEscape = handler;
        updateEscapeShortcut();
        continue;
      }
      try {
        globalShortcut.register(acc, handler);
      } catch (e) {
        log('panel key fail', acc, e.message);
      }
    }
  }

  function disablePanelKeys() {
    if (!panelKeysRegistered) return;
    panelKeysRegistered = false;
    panelEscape = null;
    updateEscapeShortcut();
    for (const acc of Object.keys(PANEL_KEYS)) {
      if (acc === 'Escape') continue;
      try {
        globalShortcut.unregister(acc);
      } catch {}
    }
  }

  function unregisterAll() {
    try {
      globalShortcut.unregisterAll();
    } catch {}
    panelKeysRegistered = false;
    escapeRegistered = false;
    panelEscape = null;
    menuEscape = null;
    modalEscape = null;
  }

  return {
    registerBaseKey,
    enablePanelKeys,
    disablePanelKeys,
    setMenuEscape,
    setModalEscape,
    unregisterAll,
    getBaseKey: () => baseKey,
    isPanelKeysRegistered: () => panelKeysRegistered,
  };
}

module.exports = createShortcuts;
