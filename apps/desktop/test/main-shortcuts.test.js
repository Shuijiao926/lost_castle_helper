'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createShortcuts = require('../src/main/shortcuts');

function makeShortcuts() {
  const registered = new Map();
  const shortcuts = createShortcuts({
    globalShortcut: {
      register: (key, handler) => {
        if (registered.has(key)) return false;
        registered.set(key, handler);
        return true;
      },
      unregister: (key) => registered.delete(key),
    },
    log: () => {},
    PANEL_KEYS: { Escape: 'Escape', Up: 'ArrowUp' },
  });
  return { registered, shortcuts };
}

test('气泡菜单关闭时释放单独注册的 Esc', () => {
  const { registered, shortcuts } = makeShortcuts();
  shortcuts.setMenuEscape(() => shortcuts.setMenuEscape(null));
  registered.get('Escape')();
  assert.equal(registered.has('Escape'), false);
});

test('菜单打开时 Esc 优先关闭菜单，随后交还面板', () => {
  const { registered, shortcuts } = makeShortcuts();
  const actions = [];
  shortcuts.enablePanelKeys({
    getWindow: () => ({ isDestroyed: () => false, webContents: { send: () => actions.push('panel') } }),
    isOpen: () => true,
  });
  shortcuts.setMenuEscape(() => {
    actions.push('menu');
    shortcuts.setMenuEscape(null);
  });
  registered.get('Escape')();
  registered.get('Escape')();
  assert.deepEqual(actions, ['menu', 'panel']);
});

test('关闭面板会注销方向键并保留气泡菜单的 Esc', () => {
  const { registered, shortcuts } = makeShortcuts();
  shortcuts.enablePanelKeys({});
  shortcuts.setMenuEscape(() => {});
  shortcuts.disablePanelKeys();
  assert.deepEqual([...registered.keys()], ['Escape']);
});
