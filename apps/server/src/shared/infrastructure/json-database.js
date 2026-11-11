'use strict';

/**
 * JSON 文件数据库（P1 的持久化实现）
 *
 * - 种子数据：<dataDir>/*.json（只读，随仓库走）
 * - 运行时数据：<runtimeDir>/*.json（可写，不进 git）
 *
 * 写操作使用「临时文件 + rename」保证原子性。
 * P4 切换到 PostgreSQL 时，只需要换实现，接口不变。
 */

const fs = require('fs');
const path = require('path');

class JsonDatabase {
  constructor({ dataDir, runtimeDir }) {
    this.dataDir = dataDir;
    this.runtimeDir = runtimeDir;
  }

  /* ---------- 种子数据（只读） ---------- */
  readSeed(name, fallback = null) {
    return this.readJSON(path.join(this.dataDir, name), fallback);
  }

  writeSeed(name, data) {
    // 种子数据在开发期需要能被采集器/脚本写回
    return this.writeJSON(path.join(this.dataDir, name), data);
  }

  /* ---------- 运行时数据（可写） ---------- */
  readRuntime(name, fallback = null) {
    return this.readJSON(path.join(this.runtimeDir, name), fallback);
  }

  writeRuntime(name, data) {
    const target = path.join(this.runtimeDir, name);
    this.ensureDir(path.dirname(target));
    this.writeJSON(target, data);
    return target;
  }

  readRuntimeJSONDir(subdir) {
    const dir = path.join(this.runtimeDir, subdir);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.readJSON(path.join(dir, f), null))
      .filter(Boolean);
  }

  writeRuntimeJSONDir(subdir, fileName, data) {
    const dir = path.join(this.runtimeDir, subdir);
    this.ensureDir(dir);
    const target = path.join(dir, fileName);
    this.writeJSON(target, data);
    return target;
  }

  /* ---------- 低层 ---------- */
  readJSON(file, fallback = null) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      throw new Error(`读取 JSON 失败 ${file}: ${e.message}`);
    }
  }

  writeJSON(file, data) {
    this.ensureDir(path.dirname(file));
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** 文件修改时间，用于缓存失效判断 */
  mtime(file) {
    try {
      return fs.statSync(file).mtimeMs;
    } catch {
      return 0;
    }
  }
}

module.exports = { JsonDatabase };
