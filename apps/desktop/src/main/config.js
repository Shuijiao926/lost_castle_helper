/**
 * 用户配置（<userData>/config.json）
 *
 * - 读入时做校验：坐标必须是有限数字，坏数据降级为 null（避免 setBounds(NaN) 把窗口搞丢）
 * - 落盘用临时文件 + rename，避免写一半崩溃导致 JSON 损坏
 * - 高频场景（拖拽气泡）用 saveDebounced，避免每 8ms 写一次磁盘
 *
 * fs / path 可注入，便于单测。
 */
const fs = require('fs');
const path = require('path');
const debounce = require('./util/debounce');

function createConfigStore({ userDataDir, isPackaged, env = process.env, log, fsImpl = fs, pathImpl = path }) {
  const state = { bubble: null, panel: null, panelPinned: false, dataSource: 'local' };
  const filePath = () => pathImpl.join(userDataDir, 'config.json');

  function sanitizeBounds(v) {
    if (!v || typeof v !== 'object') return null;
    const x = Number(v.x);
    const y = Number(v.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const out = { x: Math.round(x), y: Math.round(y) };
    const w = Number(v.width);
    const h = Number(v.height);
    if (Number.isFinite(w) && w > 0) out.width = Math.round(w);
    if (Number.isFinite(h) && h > 0) out.height = Math.round(h);
    return out;
  }

  function resolveDataSource(saved) {
    if (env.LC2_DATA_SOURCE) return env.LC2_DATA_SOURCE;
    if (typeof saved === 'string' && saved) return saved;
    return isPackaged ? 'github' : 'local';
  }

  function sanitize(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    return {
      bubble: sanitizeBounds(c.bubble),
      panel: sanitizeBounds(c.panel),
      panelPinned: c.panelPinned === true,
      dataSource: resolveDataSource(c.dataSource),
    };
  }

  function load() {
    let raw = null;
    try {
      raw = JSON.parse(fsImpl.readFileSync(filePath(), 'utf8'));
    } catch {
      raw = null;
    }
    Object.assign(state, sanitize(raw));
    Object.assign(state, { dataSource: resolveDataSource(state.dataSource) });
    return state;
  }

  function save() {
    const text = JSON.stringify(state, null, 2);
    try {
      fsImpl.mkdirSync(pathImpl.dirname(filePath()), { recursive: true });
      const tmp = filePath() + '.tmp';
      fsImpl.writeFileSync(tmp, text, 'utf8');
      try {
        fsImpl.renameSync(tmp, filePath());
      } catch {
        // 特殊文件系统 rename 覆盖失败时退回直接写
        fsImpl.writeFileSync(filePath(), text, 'utf8');
      }
    } catch (e) {
      if (log) log('saveConfig failed:', e.message);
    }
  }

  const saveDebounced = debounce(save, 400);

  return { state, filePath, load, save, saveDebounced, sanitize };
}

module.exports = createConfigStore;
