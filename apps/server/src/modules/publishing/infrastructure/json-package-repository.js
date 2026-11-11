'use strict';

/**
 * 数据包仓储（JSON 实现）
 *
 * <runtimeDir>/packages/<version>.json   数据包内容
 * <runtimeDir>/package.json              最新版本元信息
 */

const path = require('path');
const { PackageRepository, DataPackage } = require('../domain/package');

class JsonPackageRepository extends PackageRepository {
  constructor(db, config) {
    super();
    this.db = db;
    this.config = config;
    this.subdir = config.dataFiles.runtimePackagesDir;
    this.latestFile = config.dataFiles.runtimePackage;
    this.filePrefix = config.publishing.filePrefix;
  }

  async latest() {
    const meta = this.db.readRuntime(this.latestFile, null);
    if (!meta) return null;
    return new DataPackage(meta);
  }

  async save(pkg) {
    // 内容文件（客户端下载的就是它）
    const fileName = path.basename(new URL(pkg.fileUrl || 'x', 'http://x').pathname) || `${this.filePrefix}-${pkg.version}.json`;
    this.db.writeRuntimeJSONDir(this.subdir, fileName, JSON.parse(pkg.content || '{"builds":[]}'));

    // 最新元信息
    const meta = pkg.toDTO();
    this.db.writeRuntime(this.latestFile, meta);
    return pkg;
  }

  /** 读取某个版本的内容（客户端下载后校验用） */
  async readContent(version) {
    return this.db.readRuntime(`${this.subdir}/${version}.json`, null);
  }
}

module.exports = { JsonPackageRepository };
