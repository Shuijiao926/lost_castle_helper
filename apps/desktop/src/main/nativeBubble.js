/**
 * 原生气泡窗口（PowerShell + Windows 分层窗口）
 *
 * 为什么不用 Electron 的透明窗口：
 *   Chromium 的透明合成在部分 Windows 环境（关掉透明效果、部分显卡驱动）会失效 → 白角；
 *   win.setShape() 又只能按整数像素裁剪 → 锯齿。
 *   Windows 原生分层窗口（WS_EX_LAYERED + UpdateLayeredWindow）逐像素 alpha 由系统合成，
 *   既平滑又没有白角 —— uTools 的悬浮球就是这条路线。
 *
 * 与脚本的行协议：
 *   PS -> Electron : READY | CLICK | MOVE x,y
 *   Electron -> PS : QUIT
 *
 * 坐标约定：脚本回调的是**物理像素**，这里统一换算成 Electron 的 DIP。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app, screen } = require('electron');

const log = (...a) => console.log('[lc2:bubble]', ...a);

const BUBBLE_DIP = 72;      // 逻辑尺寸（和原先 Electron 窗口一致）
const READY_TIMEOUT = 8000; // 冷启动编译 C# 需要一点时间

let child = null;
let stopping = false;
let ready = false;
let cbs = {};
let scale = 1;

/* ---------------- 路径 ---------------- */
function dirInApp(name) {
  // 打包后 native / assets 走 extraResources（PS 读不了 asar 里的文件）
  if (app.isPackaged) return path.join(process.resourcesPath, name);
  return path.join(__dirname, '..', '..', name);
}

function scriptPath() { return path.join(dirInApp('native'), 'bubble.ps1'); }
function iconPath() { return path.join(dirInApp('assets'), 'icon.png'); }

/* ---------------- 启动 ---------------- */
/**
 * @param {{x:number,y:number,onClick?:Function,onMove?:Function,onFail?:Function}} opts
 *        x / y 为 DIP 坐标
 * @returns {Promise<boolean>} 脚本是否成功进入 READY
 */
function start(opts = {}) {
  cbs = opts;
  stopping = false;
  ready = false;

  const scr = screen.getPrimaryDisplay();
  scale = scr.scaleFactor || 1;
  const size = Math.round(BUBBLE_DIP * scale);
  const px = Math.round((opts.x ?? 0) * scale);
  const py = Math.round((opts.y ?? 0) * scale);

  const script = scriptPath();
  const icon = iconPath();
  if (!fs.existsSync(script)) { log('script missing:', script); return Promise.resolve(false); }
  if (!fs.existsSync(icon)) { log('icon missing:', icon); return Promise.resolve(false); }

  // 注意：气泡图由脚本内部按物理像素合成并每帧重绘（旋转光环），不再需要预生成 PNG
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-Icon', icon,
    '-Size', String(size),
    '-X', String(px),
    '-Y', String(py),
  ];

  log('spawn size=' + size + ' scale=' + scale);
  child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const timer = setTimeout(() => {
      log('timeout waiting READY');
      stop();
      finish(false);
    }, READY_TIMEOUT);

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
        } else if (line === 'CLICK') {
          if (typeof cbs.onClick === 'function') cbs.onClick();
        } else if (line.startsWith('MOVE ')) {
          const [x, y] = line.slice(5).split(',').map(Number);
          if (Number.isFinite(x) && Number.isFinite(y) && typeof cbs.onMove === 'function') {
            cbs.onMove(Math.round(x / scale), Math.round(y / scale));
          }
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

    child.on('error', (e) => {
      log('spawn error:', e.message);
      clearTimeout(timer);
      finish(false);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      const wasReady = ready;
      ready = false;
      child = null;
      if (!wasReady) finish(false);
      else if (!stopping) {
        log('exited unexpectedly, code=' + code);
        if (typeof cbs.onExit === 'function') cbs.onExit(code);
      }
    });
  });
}

/* ---------------- 控制 ---------------- */
function send(cmd) {
  if (!child || !child.stdin || child.stdin.destroyed) return false;
  try { child.stdin.write(cmd + '\n'); return true; } catch { return false; }
}

function stop() {
  stopping = true;
  if (!child) return;
  send('QUIT');
  const c = child;
  setTimeout(() => {
    if (c && !c.killed) {
      try { c.kill(); } catch {}
    }
  }, 1200);
  child = null;
}

function isRunning() { return Boolean(child) && ready; }

module.exports = { start, stop, send, isRunning, BUBBLE_DIP };
