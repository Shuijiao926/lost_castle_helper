#!/usr/bin/env node
/**
 * 安装 Git hooks（npm install / npm run prepare 时自动执行）
 *
 * 把 core.hooksPath 指向仓库内的 .githooks，
 * 这样 pre-commit 的自动版本号随仓库走，不用每台机器手动复制。
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

try {
  run(['rev-parse', '--git-dir']);
} catch {
  console.log('跳过 hooks 安装：当前目录不是 git 仓库');
  process.exit(0);
}

try {
  run(['config', 'core.hooksPath', '.githooks']);
  const hook = path.join(ROOT, '.githooks', 'pre-commit');
  if (fs.existsSync(hook) && process.platform !== 'win32') {
    fs.chmodSync(hook, 0o755);
  }
  console.log('✓ Git hooks 已启用：core.hooksPath = .githooks（提交时自动递增 patch 版本）');
} catch (e) {
  console.log('安装 hooks 失败（不影响功能）：', e.message);
}
