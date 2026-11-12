/**
 * 开发热部署
 *
 *   renderer/ 递归监听 → 重载渲染窗口
 *   data/*.json       → 重载界面（重新 getData）
 *   native/*.ps1      → 重启原生 helper
 *   main / preload    → 无法热重载，只提示需要重启
 *
 * 所有副作用通过 actions 注入，便于关闭与测试。
 */
function setupDevHotReload({ fs, path, debounce, dirs, actions, log }) {
  const disposers = [];

  // renderer：分层后样式 / 脚本 / 图片都在子目录里
  const reloadRenderer = debounce((reason) => actions.reloadRendererWindows(reason), 250);
  try {
    const watcher = fs.watch(dirs.rendererDir, { recursive: true }, (_ev, filename) => {
      const f = String(filename || '');
      if (/\.(html|css|js|json|png|jpe?g|svg|webp)$/i.test(f)) reloadRenderer('renderer:' + f);
    });
    disposers.push(() => { try { watcher.close(); } catch {} });
  } catch (e) {
    log('renderer 目录监听失败，退回 index.html 监听:', e.message);
    const file = path.join(dirs.rendererDir, 'index.html');
    fs.watchFile(file, { interval: 400 }, () => reloadRenderer('renderer:index.html'));
    disposers.push(() => fs.unwatchFile(file));
  }

  // 数据文件（开发模式读本地）→ 重载界面即可重新 getData
  const dataFiles = ['builds.json', 'weapons.json', 'inscriptions.json', 'schools.json']
    .map((n) => path.join(dirs.dataDir, n));
  const reloadData = debounce(() => actions.reloadRendererWindows('data'), 350);
  for (const f of dataFiles) fs.watchFile(f, { interval: 500 }, reloadData);
  disposers.push(() => dataFiles.forEach((f) => fs.unwatchFile(f, reloadData)));

  // 原生脚本（气泡 / 阴影）→ 重启对应进程
  const restartNative = debounce(() => actions.restartNativeHelpers(), 600);
  const nativeFiles = ['bubble.ps1', 'shadow.ps1'].map((n) => path.join(dirs.nativeDir, n));
  for (const f of nativeFiles) fs.watchFile(f, { interval: 400 }, restartNative);
  disposers.push(() => nativeFiles.forEach((f) => fs.unwatchFile(f, restartNative)));

  // 主进程 / preload 无法热重载，改动只提示（避免误以为没生效）
  const mainHint = debounce(() => log('hot reload: 主进程/preload 已变化 → 需要重启 npm run desktop'), 400);
  const watchedDirs = [dirs.mainDir, dirs.preloadDir].filter(Boolean);
  for (const dir of watchedDirs) {
    try {
      const w = fs.watch(dir, { recursive: false }, (_ev, filename) => {
        if (filename && /\.js$/.test(String(filename))) mainHint();
      });
      disposers.push(() => { try { w.close(); } catch {} });
    } catch {}
  }

  log('开发热部署已开启：renderer / data / native 自动重载（LC2_HOT=0 关闭）');

  return () => {
    for (const d of disposers) {
      try { d(); } catch {}
    }
    log('开发热部署已关闭');
  };
}

module.exports = setupDevHotReload;
