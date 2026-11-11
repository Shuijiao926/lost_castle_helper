'use strict';

/**
 * 应用层：发布
 */

const { NotFoundError } = require('../../../shared/kernel/errors');
const { Build, BuildStatus } = require('../../builds/domain/build');

class GetLatestPackage {
  constructor({ packageRepository }) {
    this.packages = packageRepository;
  }

  async execute() {
    const pkg = await this.packages.latest();
    if (!pkg) throw new NotFoundError('数据包（尚未发布过）');
    return pkg.toDTO ? pkg.toDTO() : pkg;
  }
}

class PublishPackage {
  constructor({ packageAssembler, buildRepository, catalogRepository, eventBus }) {
    this.assembler = packageAssembler;
    this.builds = buildRepository;
    this.catalog = catalogRepository;
    this.events = eventBus;
  }

  async execute({ notes, fileName } = {}) {
    const catalog = await this.catalog.load();
    const records = await this.builds.listPublished({});
    const builds = records.map((record) =>
      Build.fromRecord(record, catalog, { status: record.status || BuildStatus.PUBLISHED }),
    );
    const pkg = await this.assembler.assemble({ builds, notes, fileName });
    this.events?.publish('PackagePublished', { version: pkg.version, hash: pkg.fileHash });
    return pkg.toDTO();
  }
}

module.exports = { GetLatestPackage, PublishPackage };
