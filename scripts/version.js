#!/usr/bin/env node
/**
 * 版本管理（单一来源 = 根 package.json）
 *
 * 用法：
 *   node scripts/version.js show                 查看当前版本
 *   node scripts/version.js check                校验各包版本一致（CI 用）
 *   node scripts/version.js sync                 把根版本同步到各 workspace / lockfile
 *   node scripts/version.js patch|minor|major    递增版本并同步
 *   node scripts/version.js check-changed        工作区版本是否已与 HEAD 不同（pre-commit 用）
 *   node scripts/version.js major --release      正式发布：首段 +1（如 0.3.2 → 1.0.0）
 *
 * 约定：
 *   - 日常提交：pre-commit 自动 patch +1（0.1.0 → 0.1.1）
 *   - 正式发布：先跑 npm run release（major），hook 检测到版本已改就不再自动 patch
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PACKAGE_FILES = [
  'package.json',
  'apps/desktop/package.json',
  'apps/server/package.json',
  'apps/shared/package.json',
];
const LOCK_FILE = 'package-lock.json';

const args = process.argv.slice(2);
const command = (args.find((a) => !a.startsWith('--')) || 'show').toLowerCase();
const dryRun = args.includes('--dry-run');
const quiet = args.includes('--quiet');
const fromHook = args.includes('--from-hook');
const isRelease = args.includes('--release');

function readJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function writeJSON(rel, data) {
  const text = JSON.stringify(data, null, 2) + '\n';
  if (dryRun) return;
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8');
}

function readVersion() {
  return readJSON('package.json').version;
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) throw new Error(`版本号不是合法 semver：${v}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function formatSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function bump(kind) {
  const cur = parseSemver(readVersion());
  if (kind === 'patch') cur.patch += 1;
  else if (kind === 'minor') {
    cur.minor += 1;
    cur.patch = 0;
  } else if (kind === 'major') {
    cur.major += 1;
    cur.minor = 0;
    cur.patch = 0;
  } else {
    throw new Error(`未知的递增类型：${kind}`);
  }
  return formatSemver(cur);
}

function sync(version) {
  for (const rel of PACKAGE_FILES) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const pkg = readJSON(rel);
    pkg.version = version;
    writeJSON(rel, pkg);
  }
  syncLockfile(version);
}

function syncLockfile(version) {
  const abs = path.join(ROOT, LOCK_FILE);
  if (!fs.existsSync(abs)) return;
  const lock = readJSON(LOCK_FILE);
  lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  if (lock.packages) {
    for (const rel of PACKAGE_FILES) {
      if (rel === 'package.json') continue;
      const key = rel.replace(/\\/g, '/');
      if (lock.packages[key]) lock.packages[key].version = version;
    }
  }
  writeJSON(LOCK_FILE, lock);
}

function headVersion() {
  try {
    const text = execFileSync('git', ['show', 'HEAD:package.json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(text).version;
  } catch {
    return null;
  }
}

function checkAllSame() {
  const base = readVersion();
  const bad = [];
  for (const rel of PACKAGE_FILES) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const v = readJSON(rel).version;
    if (v !== base) bad.push(`${rel} = ${v}`);
  }
  return { base, bad };
}

function currentChangedFromHead() {
  const head = headVersion();
  return head !== null && readVersion() !== head;
}

function log(msg) {
  if (!quiet) console.log(msg);
}

/* ---------------- 命令 ---------------- */
let exitCode = 0;
try {
  if (command === 'show') {
    log(readVersion());
  } else if (command === 'check' || command === 'check-changed') {
    if (command === 'check') {
      const { base, bad } = checkAllSame();
      if (bad.length) {
        console.error(`✗ 版本不一致（基准 ${base}）：\n  ` + bad.join('\n  '));
        exitCode = 1;
      } else {
        log(`✓ 各包版本一致：${base}`);
      }
    } else {
      // 供 pre-commit 用：退出 0 = 工作区版本已与 HEAD 不同（视为正式发布/手动改版）
      exitCode = currentChangedFromHead() ? 0 : 1;
      if (!quiet) log(currentChangedFromHead() ? '版本已手动修改，跳过自动 patch' : '版本未修改，将自动 patch');
    }
  } else if (command === 'sync') {
    const v = readVersion();
    sync(v);
    log(`✓ 已同步版本 ${v}`);
  } else if (['patch', 'minor', 'major'].includes(command)) {
    const next = bump(command);
    const prev = readVersion();
    if (dryRun) {
      log(`[dry-run] ${prev} → ${next}（${command}）`);
    } else {
      sync(next);
      log(`版本 ${prev} → ${next}（${command}${fromHook ? '，pre-commit 自动' : ''}）`);
      if (isRelease) {
        log('');
        log('正式发布：');
        log(`  1. git add -A && git commit -m "chore(release): v${next}"`);
        log(`  2. git tag v${next} && git push origin main --tags`);
        log('  （pre-commit 检测到版本已改，不会再自动 patch）');
      }
    }
  } else {
    console.error(`未知命令：${command}`);
    exitCode = 1;
  }
} catch (e) {
  if (!quiet) console.error('✗', e.message);
  exitCode = 1;
}

if (fromHook && exitCode !== 0) exitCode = 0; // hook 中不因校验失败阻塞提交
process.exit(exitCode);
