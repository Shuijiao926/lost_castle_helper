'use strict';

/**
 * 面板阴影 / 圆角辅助（原生分层窗口）
 *
 * 职责：
 *   1. 面板外侧的柔和阴影（逐像素高斯，不依赖 Chromium 透明合成）
 *   2. Win11：给 Electron 面板窗口开启 DWM 系统圆角（抗锯齿、清晰）
 *      Win10 / 更早：回退为 setShape 圆角 + 阴影层补一圈抗锯齿的暗色轮廓
 *   3. 全局左键轮询（点击面板外 → 通知主进程收起；置顶模式则忽略）
 *
 * 协议（stdin）：SHOW x,y | MOVE x,y | ALPHA 0-255 | HIDE | FILL 0/1 | HWND <指针> | QUIT
 * 坐标一律使用**物理像素**（脚本进程是 DPI 感知的）。
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app, screen } = require('electron');

const log = (...a) => console.log('[lc2:shadow]', ...a);

const READY_TIMEOUT = 15000;
let child = null;
let ready = false;
let starting = null;
let scale = 1;
let alphaTimer = null;
let clickHandler = null;
let cornerResolver = null;
let dragMoveHandler = null;
let dragEndHandler = null;

function scriptPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'native', 'shadow.ps1');
  return path.join(__dirname, '..', '..', 'native', 'shadow.ps1');
}

function send(cmd) {
  if (!child || !child.stdin || child.stdin.destroyed) return false;
  try { child.stdin.write(cmd + '\n'); return true; } catch { return false; }
}

function physical(x, y) {
  return `${Math.round(x * scale)},${Math.round(y * scale)}`;
}

/** 注册全局点击回调（物理像素） */
function onClick(handler) { clickHandler = handler; }

/** 原生拖拽流：光标位置（物理像素）/ 松开 */
function onDrag(handler) { dragMoveHandler = handler; }
function onDragEnd(handler) { dragEndHandler = handler; }
function dragStart() { send('DRAGSTART'); }
function dragStop() { send('DRAGSTOP'); }

/**
 * 启动阴影进程（幂等，首次需编译 C#）
 * @returns {Promise<boolean>}
 */
function ensureStarted({ panelW, panelH, radius = 16, pad = 24 } = {}) {
  if (ready) return Promise.resolve(true);
  if (starting) return starting;

  const script = scriptPath();
  if (!fs.existsSync(script)) { log('script missing:', script); return Promise.resolve(false); }

  scale = screen.getPrimaryDisplay().scaleFactor || 1;

  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-PanelW', String(panelW),
    '-PanelH', String(panelH),
    '-Radius', String(radius),
    '-Pad', String(pad),
    '-Scale', String(scale),
    // parent pid: helper self-closes if Electron dies
    '-ParentPid', String(process.pid),
  ];

  log('spawn pad=' + pad + ' scale=' + scale);
  child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  starting = new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      starting = null;
      resolve(ok);
    };

    const timer = setTimeout(() => { log('timeout waiting READY'); stop(); finish(false); }, READY_TIMEOUT);

    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;

        if (line === 'READY') {
          ready = true;
          clearTimeout(timer);
          log('ready');
          finish(true);
        } else if (line.startsWith('CLICK ')) {
          const [x, y] = line.slice(6).split(',').map(Number);
          if (Number.isFinite(x) && Number.isFinite(y) && typeof clickHandler === 'function') {
            clickHandler(x, y);
          }
        } else if (line.startsWith('DRAG ')) {
          const [x, y] = line.slice(5).split(',').map(Number);
          if (Number.isFinite(x) && Number.isFinite(y) && dragMoveHandler) dragMoveHandler(x, y);
        } else if (line === 'DRAGEND') {
          if (dragEndHandler) dragEndHandler();
        } else if (line === 'DWM ok' || line === 'DWM fail') {
          const ok = line === 'DWM ok';
          log('dwm rounded corners:', ok);
          if (cornerResolver) { const r = cornerResolver; cornerResolver = null; r(ok); }
        } else {
          log('stdout:', line);
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      const text = String(d).trim();
      if (text) log('stderr:', text.slice(0, 400));
    });

    child.on('error', (e) => { log('spawn error:', e.message); clearTimeout(timer); finish(false); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      ready = false;
      child = null;
      if (cornerResolver) { const r = cornerResolver; cornerResolver = null; r(false); }
      if (!settled) finish(false);
      else log('exited code=' + code);
    });
  });

  return starting;
}

/**
 * 让面板窗口使用系统圆角（Windows 11 DWM）
 * @param {string} hwndValue 十进制指针
 * @returns {Promise<boolean>} 是否成功（Win7/10 会失败 → 调用方回退 setShape）
 */
async function setPanelCorner(hwndValue, cornerPref = 2) {
  // 首次调用可能还在编译 C#，等就绪再发
  if (!ready && starting) {
    try { await starting; } catch {}
  }
  return new Promise((resolve) => {
    if (!ready) { resolve(false); return; }
    let done = false;
    cornerResolver = (ok) => { if (done) return; done = true; resolve(ok); };
    if (!send(`HWND ${hwndValue} ${cornerPref}`)) { done = true; cornerResolver = null; resolve(false); return; }
    setTimeout(() => {
      if (done) return;
      done = true;
      cornerResolver = null;
      resolve(false);
    }, 2500);
  });
}

/** 阴影位图内部是否填充面板色（Win10 回退时用来盖住 setShape 锯齿） */
function setFill(enabled) {
  send(`FILL ${enabled ? 1 : 0}`);
}

function showAt(dipX, dipY) { send(`SHOW ${physical(dipX, dipY)}`); }
function moveTo(dipX, dipY) { if (ready) send(`MOVE ${physical(dipX, dipY)}`); }
function setAlpha(value) {
  if (!ready) return;
  send(`ALPHA ${Math.max(0, Math.min(255, Math.round(value)))}`);
}

function fadeTo(target, ms, done) {
  if (!ready) { if (done) done(); return; }
  if (alphaTimer) { clearInterval(alphaTimer); alphaTimer = null; }
  const steps = Math.max(3, Math.round(Math.max(60, ms) / 16));
  let i = 0;
  alphaTimer = setInterval(() => {
    i += 1;
    setAlpha((target * i) / steps);
    if (i >= steps) {
      clearInterval(alphaTimer);
      alphaTimer = null;
      setAlpha(target);
      if (done) done();
    }
  }, 16);
}

function hide() {
  if (alphaTimer) { clearInterval(alphaTimer); alphaTimer = null; }
  send('HIDE');
}

function stop() {
  if (alphaTimer) { clearInterval(alphaTimer); alphaTimer = null; }
  ready = false;
  if (!child) return;
  send('QUIT');
  const c = child;
  child = null;
  setTimeout(() => { if (c && !c.killed) { try { c.kill(); } catch {} } }, 1000);
}

module.exports = {
  ensureStarted,
  setPanelCorner,
  setFill,
  showAt,
  moveTo,
  setAlpha,
  fadeTo,
  hide,
  stop,
  onClick,
  onDrag,
  onDragEnd,
  dragStart,
  dragStop,
};
