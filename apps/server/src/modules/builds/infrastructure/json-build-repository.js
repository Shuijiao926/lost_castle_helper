'use strict';

/**
 * 流派仓储（JSON 实现）
 *
 * 返回「原始记录」，由应用层构造领域对象；
 * 仓储不 import domain 之外的业务逻辑，只负责存取与筛选。
 */

const { BuildRepository, BuildStatus } = require('../domain/build');

class JsonBuildRepository extends BuildRepository {
  constructor(db, config) {
    super();
    this.db = db;
    this.file = config.dataFiles.builds;
  }

  async findById(id) {
    const file = this.db.readSeed(this.file, { builds: [] });
    const record = (file.builds || []).find((b) => b.id === id);
    if (!record) return null;
    if (record.status === BuildStatus.ARCHIVED) return null; // 已下架对外不可见
    return record;
  }

  async listPublished({ weaponType = null, inscriptionId = null, sort = 'rating', limit, offset = 0 } = {}) {
    const file = this.db.readSeed(this.file, { builds: [] });
    let list = (file.builds || []).filter((b) => b.status !== BuildStatus.ARCHIVED);
    if (weaponType) list = list.filter((b) => b.wt === weaponType);
    if (inscriptionId) list = list.filter((b) => b.insc === inscriptionId);

    const by = {
      rating: (a, b) => (b.rating || 0) - (a.rating || 0),
      votes: (a, b) => (b.votes || 0) - (a.votes || 0),
      updated: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
    };
    list.sort(by[sort] || by.rating);

    const start = Number(offset) || 0;
    const end = Number.isFinite(Number(limit)) && limit ? start + Number(limit) : undefined;
    return list.slice(start, end);
  }

  async save(build) {
    const file = this.db.readSeed(this.file, { version: '0', gameVersion: '—', builds: [] });
    const record = build.toRecord();
    const builds = file.builds || [];
    const idx = builds.findIndex((b) => b.id === record.id);
    if (idx >= 0) builds[idx] = record;
    else builds.push(record);

    file.builds = builds;
    file.updatedAt = new Date().toISOString().slice(0, 10);
    this.db.writeSeed(this.file, file);
    return build;
  }

  async remove(id) {
    const file = this.db.readSeed(this.file, { builds: [] });
    const builds = (file.builds || []).filter((b) => b.id !== id);
    file.builds = builds;
    this.db.writeSeed(this.file, file);
  }
}

module.exports = { JsonBuildRepository };
