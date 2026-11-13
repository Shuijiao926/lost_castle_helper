/**
 * 托盘：显示气泡 / 退出
 *
 * 图标按候选顺序取第一个存在的文件（打包后 assets 走 extraResources）。
 */
function createTray({ Tray, Menu, nativeImage, fs, path, assetsDir, getBaseKey, onShowBubble, onToggle, onQuit, log }) {
  const candidates = [
    path.join(assetsDir, 'tray-32.png'), // 官方客户端图标提亮版（16/32px 可辨认）
    path.join(assetsDir, 'tray-16.png'),
    path.join(assetsDir, 'icon-32.png'),
    path.join(assetsDir, 'icon.png'),
  ];
  let img = nativeImage.createEmpty();
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        img = nativeImage.createFromPath(p);
        break;
      }
    } catch {}
  }
  if (img.isEmpty()) {
    log('assets/icon.png missing; tray skipped');
    return null;
  }

  const tray = new Tray(img);
  const refreshTooltip = () => {
    const key = getBaseKey();
    tray.setToolTip(`城堡助手${key ? ' · ' + key : ''}`);
  };
  refreshTooltip();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示气泡', click: onShowBubble },
      { type: 'separator' },
      { label: '退出', click: onQuit },
    ])
  );
  tray.on('click', onToggle);

  return { tray, refreshTooltip, destroy: () => { try { tray.destroy(); } catch {} } };
}

module.exports = createTray;
