/* 面板控制器测试：用假 BrowserWindow / screen / shadow helper 验证显隐、拖拽、休眠、置顶 */
const test = require('node:test');
const assert = require('node:assert/strict');

const createPanel = require('../src/main/panel');
const createGeometry = require('../src/main/geometry');
const createConfigStore = require('../src/main/config');

const BUBBLE = { w: 72, h: 72 };
const PANEL = { w: 440, h: 680 };
const MARGIN = 20;
const HD = { x: 0, y: 0, width: 1920, height: 1080 };

class FakeWin {
  constructor(opts) {
    this.opts = opts;
    this.bounds = { x: 100, y: 100, width: opts.width, height: opts.height };
    this.visible = false;
    this.destroyed = false;
    this.focusable = !!opts.focusable;
    this.opacity = 1;
    this.shapeCalls = 0;
    this.sent = [];
    this.handlers = {};
    this.webContents = {
      send: (ch, payload) => this.sent.push([ch, payload]),
      focus: () => {},
      on: () => {},
      once: () => {},
      reloadIgnoringCache: () => {},
    };
  }
  setAlwaysOnTop() {}
  setBackgroundColor() {}
  loadFile() {}
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  once() {}
  emit(ev, arg) { (this.handlers[ev] || []).forEach((fn) => fn(arg)); }
  getBounds() { return { ...this.bounds }; }
  setBounds(b) { this.bounds = { ...b }; }
  setPosition(x, y) { this.bounds.x = x; this.bounds.y = y; }
  showInactive() { this.visible = true; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  setFocusable(v) { this.focusable = v; }
  isFocusable() { return this.focusable; }
  focus() {}
  isFocused() { return false; }
  setOpacity(v) { this.opacity = v; }
  getOpacity() { return this.opacity; }
  setShape() { this.shapeCalls += 1; }
  getNativeWindowHandle() { return Buffer.alloc(8); }
  destroy() { this.destroyed = true; }
}

function makeHarness({ pinned = false } = {}) {
  const created = [];
  const BrowserWindow = class extends FakeWin {
    constructor(opts) {
      super(opts);
      created.push(this);
    }
  };
  const primary = { workArea: HD, scaleFactor: 1 };
  let cursor = { x: 0, y: 0 };
  const screen = {
    getPrimaryDisplay: () => primary,
    getAllDisplays: () => [primary],
    getDisplayMatching: () => primary,
    getDisplayNearestPoint: () => primary,
    getCursorScreenPoint: () => ({ ...cursor }),
  };
  const setCursor = (x, y) => { cursor = { x, y }; };
  const shadow = {
    started: 0,
    setPanelCorner: async () => true,
    ensureStarted: async () => true,
    setFill: () => {},
    showAt: () => {},
    moveTo: () => {},
    setAlpha: () => {},
    fadeTo: (v, ms, done) => done && done(),
    hide: () => {},
    stop: () => {},
    dragStart: () => {},
    dragStop: () => {},
  };
  const configStore = createConfigStore({ userDataDir: require('os').tmpdir(), isPackaged: false, env: {}, log: () => {} });
  configStore.load();
  configStore.state.bubble = { x: 1500, y: 500, width: BUBBLE.w, height: BUBBLE.h };
  configStore.state.panelPinned = pinned;
  configStore.save = () => { configStore.saveCount = (configStore.saveCount || 0) + 1; };

  const keys = { enabled: 0, disabled: 0, registered: false };
  const panel = createPanel({
    BrowserWindow,
    screen,
    panelShadow: shadow,
    configStore,
    geometry: createGeometry({ BUBBLE, PANEL, MARGIN }),
    getBubbleBounds: () => configStore.state.bubble,
    enablePanelKeys: () => { keys.enabled += 1; keys.registered = true; },
    disablePanelKeys: () => { keys.disabled += 1; keys.registered = false; },
    isQuitting: () => false,
    log: () => {},
    paths: { preload: 'preload.js', rendererIndex: 'index.html' },
    PANEL,
    PANEL_RADIUS: 16,
    SHADOW_PAD: 24,
    WIN_MODE: 'alpha',
    PANEL_CORNER_PREF: 3,
    USE_PANEL_SHADOW: false,
    USE_SHAPE_CLIP: false,
    fade: { enabled: false, inMs: 150, outMs: 110 },
  });
  panel.setPinned(pinned);
  panel.create();
  return { panel, win: created[0], configStore, keys, shadow, screen, setCursor };
}

test('panel：创建后默认隐藏、不可聚焦', () => {
  const { panel, win } = makeHarness();
  assert.equal(panel.isOpen(), false);
  assert.equal(win.visible, false);
  assert.equal(win.focusable, false);
});

test('panel：show → 可见 + 通知渲染层 + 注册热键；hide 反之', () => {
  const { panel, win, keys } = makeHarness();
  panel.show();
  assert.equal(panel.isOpen(), true);
  assert.equal(win.visible, true);
  assert.equal(win.focusable, false);
  assert.ok(keys.enabled > 0);
  const openMsg = win.sent.find(([ch, p]) => ch === 'lc2:panel' && p.open === true);
  assert.ok(openMsg, '应该向渲染层发送 open=true');
  assert.equal(typeof openMsg[1].side, 'string');

  panel.hide();
  assert.equal(panel.isOpen(), false);
  assert.equal(win.visible, false);
  assert.ok(keys.disabled > 0);
  const closeMsg = win.sent.find(([ch, p]) => ch === 'lc2:panel' && p.open === false);
  assert.ok(closeMsg, '应该向渲染层发送 open=false');
});

test('panel：置顶切换会持久化并通知渲染层', () => {
  const { panel, win, configStore } = makeHarness();
  panel.setPinned(true);
  assert.equal(panel.isPinned(), true);
  assert.equal(configStore.state.panelPinned, true);
  assert.ok(configStore.saveCount > 0);
  const pinMsg = win.sent.find(([ch]) => ch === 'lc2:pin');
  assert.deepEqual(pinMsg[1], true);

  panel.togglePin();
  assert.equal(panel.isPinned(), false);
  assert.equal(configStore.state.panelPinned, false);
});

test('panel：置顶时点外部 → 休眠（不收起、不可聚焦）', () => {
  const { panel, win, keys } = makeHarness({ pinned: true });
  panel.show();
  panel.handleOutsideClick(0, 0); // 面板在屏幕右侧，左上角属于外部
  assert.equal(panel.isOpen(), true);
  assert.equal(panel.isDormant(), true);
  assert.equal(win.focusable, false);
  assert.equal(keys.registered, false);
  const dormantMsg = win.sent.find(([ch, p]) => ch === 'lc2:dormant' && p === true);
  assert.ok(dormantMsg, '应通知渲染层进入休眠');
});

test('panel：非置顶时点外部 → 收起', () => {
  const { panel, win } = makeHarness({ pinned: false });
  panel.show();
  panel.handleOutsideClick(10, 10);
  assert.equal(panel.isOpen(), false);
  assert.equal(win.visible, false);
});

test('panel：拖拽由主进程光标轮询驱动（8ms）', async () => {
  const { panel, win, screen, setCursor } = makeHarness();
  panel.show();
  win.setBounds({ x: 200, y: 300, width: PANEL.w, height: PANEL.h });
  setCursor(300, 400);
  panel.startDrag({ sx: 300, sy: 400 }); // 偏移 = (100, 100)
  setCursor(360, 450);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(win.getBounds(), { x: 260, y: 350, width: PANEL.w, height: PANEL.h });
  panel.finalizeDrag();
  // 结束后计时器已停止：再移动光标，窗口不应再动
  setCursor(500, 500);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(win.getBounds(), { x: 260, y: 350, width: PANEL.w, height: PANEL.h });
});

test('panel：拖拽结束后保存位置', () => {
  const { panel, win, configStore, setCursor } = makeHarness();
  panel.show();
  win.setBounds({ x: 200, y: 300, width: PANEL.w, height: PANEL.h });
  setCursor(300, 400);
  panel.startDrag({ sx: 300, sy: 400 });
  panel.finalizeDrag();
  assert.deepEqual(configStore.state.panel, { x: 200, y: 300 });
});

test('panel：唤醒后恢复可聚焦并通知渲染层退出休眠', () => {
  const { panel, win } = makeHarness({ pinned: true });
  panel.show();
  panel.handleOutsideClick(0, 0);
  assert.equal(panel.isDormant(), true);
  panel.wake();
  assert.equal(panel.isDormant(), false);
  assert.equal(win.focusable, true);
  const dormantMsg = win.sent.find(([ch, p]) => ch === 'lc2:dormant' && p === false);
  assert.ok(dormantMsg);
});
