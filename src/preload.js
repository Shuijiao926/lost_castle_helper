/**
 * preload：只暴露白名单 API 给渲染进程。
 * 渲染层拿不到 Node，也拿不到 ipcRenderer 本体。
 */
const { contextBridge, ipcRenderer } = require('electron');

const KEY_EVENTS = ['lc2:key', 'lc2:mode', 'lc2:toggle'];

contextBridge.exposeInMainWorld('lc2', {
  /** 拉取 data/*.json（主进程读文件并校验） */
  getData: () => ipcRenderer.invoke('lc2:getData'),

  /** 拉取配置（热键、位置等） */
  getConfig: () => ipcRenderer.invoke('lc2:getConfig'),

  /** 保存配置 */
  setConfig: (patch) => ipcRenderer.invoke('lc2:setConfig', patch),

  /** 主进程转发过来的按键名（ArrowUp / Enter / f …） */
  onKey: (cb) => {
    const h = (_e, key) => cb(key);
    ipcRenderer.on('lc2:key', h);
    return () => ipcRenderer.removeListener('lc2:key', h);
  },

  /** 窗口形态切换：'bubble' | 'panel' */
  onMode: (cb) => {
    const h = (_e, mode) => cb(mode);
    ipcRenderer.on('lc2:mode', h);
    return () => ipcRenderer.removeListener('lc2:mode', h);
  },

  /** 渲染层请求收起面板（点气泡、按 Esc 到底时调用） */
  requestToggle: () => ipcRenderer.send('lc2:toggle'),
});
