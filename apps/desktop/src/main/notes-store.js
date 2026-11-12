/**
 * 用户印象存储（本地 JSON）
 *
 * 一句话评价 / 印象，按 buildId 存 JSON：
 * 同一流派只保留一条，写入即覆盖更新，不做增量历史。
 * 位置：<userData>/notes.json
 *
 * 文件系统与路径可注入，便于单测（不需要 Electron）。
 */
const fs = require('fs');
const path = require('path');

const BUILD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_LEN = 200;

function createNotesStore({ userDataDir, log, fsImpl = fs, pathImpl = path }) {
  const filePath = () => pathImpl.join(userDataDir, 'notes.json');

  function readAll() {
    try {
      const raw = fsImpl.readFileSync(filePath(), 'utf8');
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch {
      return {};
    }
  }

  function writeAll(obj) {
    try {
      fsImpl.mkdirSync(pathImpl.dirname(filePath()), { recursive: true });
      fsImpl.writeFileSync(filePath(), JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      if (log) log('write notes failed:', e.message);
    }
  }

  /**
   * 写入一条印象（覆盖更新）。
   * @returns {{ok:boolean, all:object}} ok=false 表示 buildId 非法
   */
  function set(buildId, text) {
    const all = readAll();
    if (typeof buildId !== 'string' || !BUILD_ID_RE.test(buildId)) return { ok: false, all };
    const value = typeof text === 'string' ? text.trim().slice(0, MAX_LEN) : '';
    if (value) all[buildId] = value;
    else delete all[buildId];
    writeAll(all);
    return { ok: true, all };
  }

  return { readAll, set, filePath };
}

module.exports = createNotesStore;
