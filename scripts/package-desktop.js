'use strict';

/**
 * 打 Windows 安装包（.exe）：一条命令、固定产物名、构建后自检。
 *
 *   node scripts/package-desktop.js            NSIS 安装包（推荐，可自选目录）
 *   node scripts/package-desktop.js --portable 免安装单文件
 *
 * 产物落在 release/，文件名由 apps/desktop/package.json 的 artifactName 决定，
 * 版本号唯一的来源也在那里，本脚本只负责调用与校验，不复制版本号。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'apps', 'desktop');
const outputDir = path.join(root, 'release');
const portable = process.argv.includes('--portable');

const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
const expected = portable
  ? 'LC2Helper-' + version + '-portable.exe'
  : 'LC2Helper-' + version + '-win-x64-setup.exe';

/** electron-builder 的 CLI 直接跑 cli.js，避免依赖各平台的 .bin 软链与 .cmd 包装。 */
const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');

function main() {
  if (!fs.existsSync(cli)) {
    throw new Error('未找到 electron-builder，先执行 npm ci');
  }

  // --publish never：本地与 CI 都只出文件，上传与发布交给工作流显式处理。
  const args = [cli, '--publish', 'never'];
  if (portable) args.push('--win', 'portable');
  execFileSync(process.execPath, args, { cwd: appDir, stdio: 'inherit' });

  const artifact = path.join(outputDir, expected);
  if (!fs.existsSync(artifact)) {
    throw new Error('构建结束但没有产物：' + path.relative(root, artifact));
  }
  const stat = fs.statSync(artifact);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');

  console.log('');
  console.log('产物：' + path.relative(root, artifact));
  console.log('版本：' + version);
  console.log('大小：' + (stat.size / 1024 / 1024).toFixed(1) + ' MB');
  console.log('SHA256：' + digest);
  console.log('未做代码签名：首次运行需要用户在 Windows 提示里选择「仍要运行」。');
}

main();
