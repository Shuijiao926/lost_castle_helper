'use strict';

/**
 * 生成统一部署包：out/lc2-deploy.tar.gz。
 *
 * 服务端三个「服务」（node / admin / web）加数据库只对应一份编排，
 * 因此打包也只产出一个压缩包，解包后就是一个完整可运行的部署目录：
 *
 *   compose.yaml  .env.example  caddy/  scripts/  node-build/  admin-build/  imports/  data/
 *
 * 包里不放任何密钥、不放 node_modules、不放桌面端与测试：密钥由 secrets.py 在服务器上现场生成。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'out', 'lc2-deploy.tar.gz');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'lc2-deploy-'));

/** 管理端仓库默认与当前仓库同级；只借它的 Dockerfile，JAR 由使用者本地构建后上传。 */
const adminRepo = path.resolve(process.env.LC2_ADMIN_REPO || path.join(root, '..', 'lost_castle_helper_admin'));

/** 把仓库内文件复制到包内指定位置；拒绝符号链接和指向仓库外的真实路径。 */
function copyFile(from, to, mode) {
  const source = path.join(root, from);
  const real = fs.realpathSync(source);
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error('部署源文件超出仓库：' + from);
  }
  const target = path.join(staging, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(real, target);
  fs.chmodSync(target, mode || 0o644);
}

/** 目录复制时逐层过滤，避免把本地临时文件带进镜像上下文。 */
function copyDirectory(from, to, options) {
  const settings = options || {};
  const source = path.join(root, from);
  const real = fs.realpathSync(source);
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error('部署源目录超出仓库：' + from);
  }
  for (const name of fs.readdirSync(real).sort()) {
    if (settings.filter && !settings.filter(name)) continue;
    const relative = from + '/' + name;
    const stat = fs.lstatSync(path.join(root, relative));
    if (stat.isSymbolicLink()) throw new Error('部署包不接收符号链接：' + relative);
    if (stat.isDirectory()) copyDirectory(relative, to + '/' + name, settings);
    else copyFile(relative, to + '/' + name);
  }
}

try {
  // 一、编排与脚本：整份 deploy 目录的「提交部分」原样搬过去。
  copyFile('deploy/compose.yaml', 'compose.yaml');
  copyFile('deploy/.env.example', '.env.example');
  copyFile('deploy/README.md', 'README.md');
  copyFile('deploy/caddy/Caddyfile', 'caddy/Caddyfile');
  copyFile('deploy/scripts/ops.sh', 'scripts/ops.sh', 0o755);
  copyFile('deploy/scripts/secrets.py', 'scripts/secrets.py', 0o755);
  fs.mkdirSync(path.join(staging, 'secrets'), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(staging, 'secrets'), 0o700);

  // 二、Node 构建上下文：compose 默认用 ./node-build，Dockerfile 放在上下文根部。
  copyFile('Dockerfile', 'node-build/Dockerfile');
  copyFile('.dockerignore', 'node-build/.dockerignore');
  copyFile('package.json', 'node-build/package.json');
  copyFile('package-lock.json', 'node-build/package-lock.json');
  copyFile('apps/server/package.json', 'node-build/apps/server/package.json');
  copyDirectory('apps/server/src', 'node-build/apps/server/src');
  copyFile('apps/server/prisma/schema.prisma', 'node-build/apps/server/prisma/schema.prisma');
  copyFile('apps/shared/package.json', 'node-build/apps/shared/package.json');
  copyFile('apps/shared/validate.js', 'node-build/apps/shared/validate.js');
  copyDirectory('apps/shared/schema', 'node-build/apps/shared/schema');

  // 数据包：一份进镜像（Node 直接读），一份留给 Caddy 对外提供 /data/*。
  const isPublicData = (name) => name.endsWith('.json') && !name.endsWith('.local.json');
  copyDirectory('data', 'node-build/data', { filter: isPublicData });
  copyDirectory('data', 'data', { filter: isPublicData });

  // 三、管理端构建上下文：镜像只装 JAR，Dockerfile 从 Java 仓库借用，保证只有一份来源。
  fs.mkdirSync(path.join(staging, 'admin-build', 'target'), { recursive: true });
  let adminDockerfile = false;
  const adminSource = path.join(adminRepo, 'Dockerfile');
  if (fs.existsSync(adminSource)) {
    fs.copyFileSync(adminSource, path.join(staging, 'admin-build', 'Dockerfile'));
    adminDockerfile = true;
  }

  // 四、导入目录占位：compose 以只读方式挂给 admin 容器。
  fs.mkdirSync(path.join(staging, 'imports'), { recursive: true });

  fs.mkdirSync(path.dirname(output), { recursive: true });
  // Windows 的 bsdtar 会把 "D:\..." 里的盘符当成远程主机名（rsh 语法），
  // 因此归档路径改成相对仓库目录，并把 -C 的路径统一成正斜杠。
  execFileSync('tar', ['-czf', path.relative(root, output), '-C', staging.replace(/\\/g, '/'), '.'], {
    cwd: root,
    stdio: 'inherit',
  });

  const digest = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(output + '.sha256', digest + '  lc2-deploy.tar.gz\n');

  console.log('已生成：' + output);
  console.log('SHA256：' + digest);
  console.log('不含 node_modules、桌面端、测试、mock、运行数据或任何密钥。');
  if (!adminDockerfile) {
    console.log('');
    console.log('注意：没找到管理端 Dockerfile，admin-build/ 缺文件。');
    console.log('  期望位置：' + adminSource);
    console.log('  可用环境变量指定：LC2_ADMIN_REPO=<管理端仓库路径> node scripts/package-deploy.js');
  }
} finally {
  // 只清理由本次创建、且确实位于系统临时目录下的 staging，禁止对计算出的仓库路径递归删除。
  const real = fs.realpathSync(staging);
  const tempRoot = fs.realpathSync(os.tmpdir());
  if (path.dirname(real) !== tempRoot || !path.basename(real).startsWith('lc2-deploy-')) {
    throw new Error('临时目录归属检查失败，停止清理');
  }
  fs.rmSync(real, { recursive: true, force: true });
}
