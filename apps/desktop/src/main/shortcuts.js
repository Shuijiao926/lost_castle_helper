/**
 * 全局热键
 *
 * - 基础热键（呼出面板）从候选列表里挑第一个能注册的
 * - 面板热键只在面板可见时注册，隐藏立即注销（否则会抢游戏按键）
 */
function createShortcuts({ globalShortcut, log, BASE_KEYS, PANEL_KEYS }) {
  let baseKey = null;
  let panelKeysRegistered = false;

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
      try {
        globalShortcut.register(acc, () => {
          const win = getWindow();
          if (win && !win.isDestroyed() && isOpen()) {
            win.webContents.send('lc2:key', name);
          }
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
  }

  return {
    registerBaseKey,
    enablePanelKeys,
    disablePanelKeys,
    unregisterAll,
    getBaseKey: () => baseKey,
    isPanelKeysRegistered: () => panelKeysRegistered,
  };
}

module.exports = createShortcuts;
