/* 主进程纯逻辑测试：配置 / 印象存储 / 几何 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const createConfigStore = require('../src/main/config');
const createNotesStore = require('../src/main/notes-store');
const createGeometry = require('../src/main/geometry');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/* ---------------- config ---------------- */
test('config：首次加载给默认值，dataSource 按环境兜底', () => {
  const dir = tmpDir('lc2-cfg-');
  const store = createConfigStore({ userDataDir: dir, isPackaged: false, env: {}, log: () => {} });
  const state = store.load();
  assert.equal(state.bubble, null);
  assert.equal(state.panel, null);
  assert.equal(state.panelPinned, false);
  assert.equal(state.dataSource, 'local');
});

test('config：env 覆盖 dataSource；打包环境默认 github', () => {
  const dir = tmpDir('lc2-cfg-');
  const envStore = createConfigStore({ userDataDir: dir, isPackaged: false, env: { LC2_DATA_SOURCE: 'github' }, log: () => {} });
  assert.equal(envStore.load().dataSource, 'github');

  const dir2 = tmpDir('lc2-cfg-');
  const pkgStore = createConfigStore({ userDataDir: dir2, isPackaged: true, env: {}, log: () => {} });
  assert.equal(pkgStore.load().dataSource, 'github');
});

test('config：坏坐标被丢弃，正常坐标保留并落盘', () => {
  const dir = tmpDir('lc2-cfg-');
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ bubble: { x: 'oops', y: 2 }, panel: { x: 120.4, y: 300 }, panelPinned: true })
  );
  const store = createConfigStore({ userDataDir: dir, isPackaged: false, env: {}, log: () => {} });
  const state = store.load();
  assert.equal(state.bubble, null);
  assert.deepEqual(state.panel, { x: 120, y: 300 });
  assert.equal(state.panelPinned, true);

  state.panel = { x: 1, y: 2 };
  store.save();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.deepEqual(saved.panel, { x: 1, y: 2 });
});

test('config：文件损坏时降级为默认值，不抛错', () => {
  const dir = tmpDir('lc2-cfg-');
  fs.writeFileSync(path.join(dir, 'config.json'), '{ not json');
  const store = createConfigStore({ userDataDir: dir, isPackaged: false, env: {}, log: () => {} });
  const state = store.load();
  assert.equal(state.bubble, null);
  assert.equal(state.panel, null);
});

test('config：防抖落盘可取消（退出时手动 flush）', async () => {
  const dir = tmpDir('lc2-cfg-');
  const store = createConfigStore({ userDataDir: dir, isPackaged: false, env: {}, log: () => {} });
  store.load();
  store.state.panel = { x: 9, y: 9 };
  store.saveDebounced();
  store.saveDebounced.cancel();
  store.save();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.deepEqual(saved.panel, { x: 9, y: 9 });
});

/* ---------------- notes ---------------- */
test('notes：写入 / 覆盖更新 / 清空 / 非法 buildId', () => {
  const dir = tmpDir('lc2-notes-');
  const store = createNotesStore({ userDataDir: dir, log: () => {} });

  let r = store.set('shw_rev_1', '续航强');
  assert.equal(r.ok, true);
  assert.deepEqual(store.readAll(), { shw_rev_1: '续航强' });

  r = store.set('shw_rev_1', '续航强，清屏快');
  assert.equal(r.ok, true);
  assert.equal(store.readAll().shw_rev_1, '续航强，清屏快'); // 覆盖，不增量

  r = store.set('shw_rev_1', '');
  assert.equal(r.ok, true);
  assert.deepEqual(store.readAll(), {});

  r = store.set('../evil', 'x');
  assert.equal(r.ok, false);
});

test('notes：超长文本截断到 200 字', () => {
  const dir = tmpDir('lc2-notes-');
  const store = createNotesStore({ userDataDir: dir, log: () => {} });
  store.set('a', 'x'.repeat(500));
  assert.equal(store.readAll().a.length, 200);
});

/* ---------------- geometry ---------------- */
const BUBBLE = { w: 72, h: 72 };
const PANEL = { w: 440, h: 680 };
const MARGIN = 20;
const HD = { x: 0, y: 0, width: 1920, height: 1080 };

test('geometry：气泡默认位置在右侧垂直居中', () => {
  const g = createGeometry({ BUBBLE, PANEL, MARGIN });
  const b = g.defaultBubbleBounds(HD);
  assert.equal(b.x, 1920 - 72 - 20);
  assert.equal(b.y, Math.round(1080 / 2 - 36));
});

test('geometry：面板默认向左展开，左边界不够时向右并夹紧', () => {
  const g = createGeometry({ BUBBLE, PANEL, MARGIN });
  const display = { workArea: HD };
  const normal = g.panelBoundsFrom({ x: 1500, y: 500, width: 72, height: 72 }, display);
  assert.equal(normal.width, PANEL.w);
  assert.ok(normal.x >= HD.x && normal.x + PANEL.w <= HD.width);

  const leftEdge = g.panelBoundsFrom({ x: 10, y: 500, width: 72, height: 72 }, display);
  assert.ok(leftEdge.x >= HD.x);
});

test('geometry：上次位置部分在屏内 → 保持原样', () => {
  const g = createGeometry({ BUBBLE, PANEL, MARGIN });
  const displays = [{ workArea: HD }];
  const saved = { x: -100, y: 200 }; // 左侧露出 340px
  const out = g.resolvePanelBounds(saved, { x: 1500, y: 500, width: 72, height: 72 }, displays, displays[0]);
  assert.deepEqual(out, { x: -100, y: 200, width: PANEL.w, height: PANEL.h });
});

test('geometry：上次位置完全出屏 → 夹回最近显示器', () => {
  const g = createGeometry({ BUBBLE, PANEL, MARGIN });
  const displays = [{ workArea: HD }];
  const saved = { x: -3000, y: -3000 };
  const out = g.resolvePanelBounds(saved, { x: 1500, y: 500, width: 72, height: 72 }, displays, displays[0]);
  assert.equal(out.x, HD.x);
  assert.equal(out.y, HD.y);
});
