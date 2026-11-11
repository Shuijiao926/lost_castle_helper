'use strict';

/**
 * 安全上下文基础设施：限流计数持久化
 *
 * 存到 runtime 目录，重启不清零（否则重启即可绕过限流）。
 * 文件结构：{ version, entries: { "rating:abc123": [ts, ts, ...] } }
 */

class JsonRateLimitStore {
  constructor(db, { file }) {
    this.db = db;
    this.file = file;
  }

  read() {
    return this.db.readRuntime(this.file, { version: 1, entries: {} });
  }

  async load(key) {
    const data = this.read();
    return data.entries?.[key] || [];
  }

  async save(key, timestamps) {
    const data = this.read();
    data.entries = data.entries || {};
    if (timestamps && timestamps.length) data.entries[key] = timestamps;
    else delete data.entries[key];
    this.db.writeRuntime(this.file, data);
  }
}

module.exports = { JsonRateLimitStore };
