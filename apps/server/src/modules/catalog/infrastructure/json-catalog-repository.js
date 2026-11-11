'use strict';

/**
 * 图鉴仓储（JSON 实现）
 *
 * 数据来源（P1）：仓库 data/ 下的 weapons / inscriptions / schools；
 * P2 接入 wiki 采集后，treasures 从 data/catalog/treasures.json 读。
 *
 * 带 mtime 缓存：文件没变就不重复解析。
 */

const path = require('path');
const { CatalogRepository, CatalogSnapshot } = require('../domain/catalog');

class JsonCatalogRepository extends CatalogRepository {
  constructor(db, config) {
    super();
    this.db = db;
    this.config = config;
    this.files = {
      weapons: path.join(db.dataDir, config.dataFiles.weapons),
      inscriptions: path.join(db.dataDir, config.dataFiles.inscriptions),
      schools: path.join(db.dataDir, config.dataFiles.schools),
      treasures: path.join(db.dataDir, config.dataFiles.catalogDir, config.dataFiles.treasures),
    };
    this.cache = null;
    this.cacheKey = '';
  }

  async load() {
    const files = this.files;

    const key = Object.values(files).map((f) => this.db.mtime(f)).join(':');
    if (this.cache && this.cacheKey === key) return this.cache;

    const weapons = this.db.readJSON(files.weapons, { weapons: [] });
    const inscriptions = this.db.readJSON(files.inscriptions, { inscriptions: [] });
    const schools = this.db.readJSON(files.schools, { schools: [] });
    const treasures = this.db.readJSON(files.treasures, { treasures: [] });

    const snapshot = new CatalogSnapshot({
      version: weapons.version || inscriptions.version || schools.version || '0',
      weapons: weapons.weapons || [],
      inscriptions: inscriptions.inscriptions || [],
      schools: schools.schools || [],
      treasures: treasures.treasures || [],
    });

    this.cache = snapshot;
    this.cacheKey = key;
    return snapshot;
  }
}

module.exports = { JsonCatalogRepository };
