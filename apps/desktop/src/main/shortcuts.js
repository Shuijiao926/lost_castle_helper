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
  let escapeRegistered = false;

  function updateEscapeShortcut() {
    try {
      if ((panelEscape || menuEscape) && !escapeRegistered) {
        escapeRegistered = globalShortcut.register('Escape', () => (menuEscape || panelEscape)?.());
      } else if (!panelEscape && !menuEscape && escapeRegistered) {
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

  function registerBaseKey(handler) {
    for (const key of BASE_KEYS) {
      try {
        if (globalShortcut.register(key, handler)) {
          baseKey = key;
          log('base hotkey =', key);
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
  }

  return {
    registerBaseKey,
    enablePanelKeys,
    disablePanelKeys,
    setMenuEscape,
    unregisterAll,
    getBaseKey: () => baseKey,
    isPanelKeysRegistered: () => panelKeysRegistered,
  };
}

module.exports = createShortcuts;
