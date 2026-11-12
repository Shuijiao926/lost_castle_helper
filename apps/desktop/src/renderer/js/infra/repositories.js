/* ================= 基础设施层：数据源 / 本地持久化 =================
 * 把「数据从哪来、存到哪」收口在这里：
 * - lc2.data：真实流派数据（Electron IPC；浏览器环境返回 null 走内置示例）
 * - lc2.notes：用户印象（Electron 写 userData/notes.json；浏览器退回 localStorage）
 *
 * 上层只依赖这些接口，不关心 IPC / localStorage 细节，便于测试与替换。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else {
    root.LC2 = root.LC2 || {};
    root.LC2.infra = factory({ lc2: root.lc2, storage: root.localStorage, storageKey: 'lc2.notes.v1' });
  }
}(typeof self !== 'undefined' ? self : this, function (env) {
  'use strict';

  var lc2 = env.lc2;
  var storage = env.storage;
  var STORAGE_KEY = env.storageKey || 'lc2.notes.v1';

  /* ---------------- 流派数据 ---------------- */
  var dataRepo = {
    /** 是否支持真实数据源（Electron 面板窗口） */
    available: function () {
      return !!(lc2 && typeof lc2.getData === 'function');
    },
    /** 加载真实数据；浏览器 / 数据为空时返回 null，由上层保留内置示例 */
    load: function () {
      if (!dataRepo.available()) return Promise.resolve(null);
      return lc2.getData().then(function (d) {
        return d && Array.isArray(d.builds) ? d : null;   // 空数组也算有效数据：显示空状态
      });
    }
  };

  /* ---------------- 用户印象 ---------------- */
  var notesRepo = {
    /** 读取全部印象：{ buildId: text } */
    load: function () {
      if (lc2 && typeof lc2.notesGet === 'function') {
        return lc2.notesGet().then(function (obj) {
          return obj && typeof obj === 'object' ? obj : {};
        }).catch(function () { return {}; });
      }
      try {
        return Promise.resolve(JSON.parse(storage.getItem(STORAGE_KEY) || '{}'));
      } catch (e) {
        return Promise.resolve({});
      }
    },
    /**
     * 保存一条印象（覆盖更新，不做增量历史）。
     * allNotes 用于浏览器 localStorage 兜底时整体序列化。
     */
    save: function (buildId, text, allNotes) {
      if (lc2 && typeof lc2.notesSet === 'function') {
        try {
          var p = lc2.notesSet(buildId, text);
          if (p && typeof p.catch === 'function') p.catch(function () {});
        } catch (e) { /* 忽略 IPC 失败，界面已乐观更新 */ }
        return;
      }
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(allNotes || {}));
      } catch (e) { /* 存储不可用时静默 */ }
    }
  };

  return { data: dataRepo, notes: notesRepo };
}));
