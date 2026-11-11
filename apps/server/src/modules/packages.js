/**
 * 数据包模块（客户端热更新）
 *
 * 客户端流程：GET /api/packages/latest → 比对本地 version + hash
 *            → 不一致则下载 fileUrl 覆盖本地缓存
 *
 * 骨架阶段：包就是 data/builds.json 本身，直接放到 GitHub raw；
 *          正式阶段：打 zip 上传到 GitHub Release / OSS。
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const files = require('../plugins/files');

const META_FILE = path.join(config.dataDir, 'package.json');
const BUILDS_FILE = path.join(config.dataDir, 'builds.json');

function latest() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    // 还没有发布过数据包 → 用当前 builds.json 现算一个
    try {
      const buf = fs.readFileSync(BUILDS_FILE);
      const data = JSON.parse(buf.toString('utf8'));
      return {
        version: `${data.gameVersion || '0'}-r0`,
        gameVersion: data.gameVersion || '0',
        fileUrl: files.rawUrl('data/builds.json'),
        fileHash: files.sha256(buf),
        size: buf.length,
        notes: '自动生成（尚未发布过数据包）',
        auto: true,
      };
    } catch {
      return null;
    }
  }
}

/** 发布新数据包：计算 hash 并写 data/package.json */
function publish(notes) {
  const buf = fs.readFileSync(BUILDS_FILE);
  const data = JSON.parse(buf.toString('utf8'));
  const prev = latest();
  const prevR = prev && /-r(\d+)$/.test(prev.version) ? Number(prev.version.match(/-r(\d+)$/)[1]) : 0;

  const meta = {
    version: `${data.gameVersion || '0'}-r${prevR + 1}`,
    gameVersion: data.gameVersion || '0',
    fileUrl: files.rawUrl('data/builds.json'),
    fileHash: files.sha256(buf),
    size: buf.length,
    notes: notes || '',
    publishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

module.exports = { latest, publish };
