'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const createBubbleWindow = require('../src/main/bubble-window');

class FakeWindow extends EventEmitter {
  webContents = new EventEmitter();
  visible = false;

  setAlwaysOnTop() {}
  setBackgroundColor() {}
  setVisibleOnAllWorkspaces() {}
  loadFile() {}
  isDestroyed() { return false; }
  isVisible() { return this.visible; }
  showInactive() { this.visible = true; }
  hide() { this.visible = false; }
}

function makeBubbleWindow({ canReveal = () => true, onContextMenu = () => {} } = {}) {
  return createBubbleWindow({
    BrowserWindow: FakeWindow,
    path,
    BUBBLE: { w: 72, h: 72 },
    WIN_MODE: 'alpha',
    bounds: { x: 0, y: 0 },
    preloadPath: 'preload.js',
    rendererDir: 'renderer',
    applyShape: () => {},
    canReveal,
    onContextMenu,
  });
}

test('备用气泡右键请求在当前窗口打开菜单', () => {
  const requests = [];
  const win = makeBubbleWindow({ onContextMenu: (owner) => requests.push(owner) });
  win.webContents.emit('context-menu');
  assert.deepEqual(requests, [win]);
});

test('已隐藏的备用气泡在剩余加载事件触发后仍然隐藏', () => {
  let hidden = false;
  const win = makeBubbleWindow({ canReveal: () => !hidden });
  win.emit('ready-to-show');
  assert.equal(win.isVisible(), true);

  hidden = true;
  win.hide();
  win.webContents.emit('did-finish-load');
  assert.equal(win.isVisible(), false);
});
