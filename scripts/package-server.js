'use strict';

/** 打包 Node 部署源码：仅显式列出的服务端、共享校验和真实数据，不包含密钥或 mock。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'out', 'lc2-node-deploy.tar.gz');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'lc2-node-deploy-'));

/** 路径固定在仓库内；复制时拒绝符号链接和指向仓库外的文件。 */
function copy(relative) {
  const source = path.join(root, relative);
  const target = path.join(staging, relative);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error('部署包不接收符号链接：' + relative);
  const real = fs.realpathSync(source);
  if (!real.startsWith(root + path.sep)) throw new Error('部署源文件超出仓库：' + relative);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(source)) copy(path.join(relative, name));
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

try {
  for (const name of [
    'package.json', 'package-lock.json', 'apps/server/package.json',
    'apps/server/src', 'apps/server/prisma/schema.prisma',
    'apps/shared/package.json', 'apps/shared/validate.js', 'apps/shared/schema',
    'deploy/server/Dockerfile.node', 'deploy/server/Dockerfile.node.dockerignore',
    'deploy/server/compose.node.yaml', 'deploy/server/configure-node-secrets.py',
  ]) copy(name);
  for (const name of ['builds', 'weapons', 'inscriptions', 'schools', 'treasures', 'armors',
    'soul-stones', 'cursed-treasures', 'nightmare-effects']) copy('data/' + name + '.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync('tar', ['-czf', output, '-C', staging, '.'], { stdio: 'inherit' });
  console.log('已生成：' + output);
  console.log('不包含 node_modules、桌面端、mock、运行数据或服务器密钥；不修改任何数据库。');
} finally {
  // 仅清理由本次创建且位于系统临时目录下的 staging，禁止对计算出的仓库路径递归删除。
  const real = fs.realpathSync(staging);
  const tempRoot = fs.realpathSync(os.tmpdir());
  if (path.dirname(real) !== tempRoot || !path.basename(real).startsWith('lc2-node-deploy-')) {
    throw new Error('临时目录归属检查失败，停止清理');
  }
  fs.rmSync(real, { recursive: true, force: true });
}
