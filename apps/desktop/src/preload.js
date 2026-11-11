/**
 * preload：只暴露白名单 API。
 * 渲染层拿不到 Node，也拿不到 ipcRenderer 本体。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lc2', {
  /* ---- 数据 ---- */
  getData: () => ipcRenderer.invoke('lc2:getData'),
  getConfig: () => ipcRenderer.invoke('lc2:getConfig'),

  /* ---- 面板 ---- */
  /** 主进程通知面板打开/关闭（只有 mode=panel 的窗口会收到） */
  onPanel: (cb) => {
    const h = (_e, state) => cb(state);
    ipcRenderer.on('lc2:panel', h);
    return () => ipcRenderer.removeListener('lc2:panel', h);
  },
  /** 主进程转发的按键名（ArrowUp / Enter / f …） */
  onKey: (cb) => {
    const h = (_e, key) => cb(key);
    ipcRenderer.on('lc2:key', h);
    return () => ipcRenderer.removeListener('lc2:key', h);
  },
  /** 请求切换面板（气泡点击 / Esc 到底） */
  requestToggle: () => ipcRenderer.send('lc2:toggle'),
  /** 请求关闭面板 */
  requestClose: () => ipcRenderer.send('lc2:closePanel'),

  /* ---- 气泡拖拽 ---- */
  dragStart: (sx, sy) => ipcRenderer.send('lc2:dragStart', { sx, sy }),
  dragMove: (sx, sy) => ipcRenderer.send('lc2:dragMove', { sx, sy }),
  dragEnd: () => ipcRenderer.send('lc2:dragEnd'),

  /* ---- 面板拖拽（与气泡相互独立） ---- */
  panelDragStart: (sx, sy) => ipcRenderer.send('lc2:panelDragStart', { sx, sy }),
  panelDragMove: (sx, sy) => ipcRenderer.send('lc2:panelDragMove', { sx, sy }),
  panelDragEnd: () => ipcRenderer.send('lc2:panelDragEnd'),
});
