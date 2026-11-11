'use strict';

/**
 * 应用层：流派查询
 *
 * 只做编排：取数据 → 构造领域对象 → 组装 DTO。
 * 这里没有业务规则，规则都在 domain/builds/build.js。
 */

const { Build, BuildStatus } = require('../domain/build');
const { NotFoundError } = require('../../../shared/kernel/errors');

const SORTS = new Set(['rating', 'votes', 'updated']);

class ListBuilds {
  constructor({ buildRepository, ratingRepository, catalogRepository }) {
    this.builds = buildRepository;
    this.ratings = ratingRepository;
    this.catalog = catalogRepository;
  }

  /**
   * @param {{weaponType?:string, inscriptionId?:string, sort?:string, limit?:number, offset?:number}} query
   */
  async execute(query = {}) {
    const sort = SORTS.has(query.sort) ? query.sort : 'rating';
    const catalog = await this.catalog.load();
    const summaries = await this.ratings.summaries();

    const records = await this.builds.listPublished({
      weaponType: query.weaponType || null,
      inscriptionId: query.inscriptionId || null,
      sort,
      limit: query.limit,
      offset: query.offset,
    });

    const items = [];
    const skipped = [];
    for (const record of records) {
      try {
        const build = Build.fromRecord(record, catalog, {
          status: record.status || BuildStatus.PUBLISHED,
        });
        const summary = summaries.get(build.id);
        items.push(build.toCardDTO(summary ? { rating: summary.avg, votes: summary.votes } : {}));
      } catch (e) {
        // 历史脏数据不应拖垮整个列表：跳过并记录，由数据校验脚本兜底修复
        skipped.push({ id: record.id, reason: e.message });
      }
    }

    return {
      items,
      total: items.length,
      skipped,
      catalogVersion: catalog.version,
      gameVersion: records[0]?.gameVersion || null,
    };
  }
}

class GetBuild {
  constructor({ buildRepository, ratingRepository, catalogRepository }) {
    this.builds = buildRepository;
    this.ratings = ratingRepository;
    this.catalog = catalogRepository;
  }

  async execute(id) {
    const record = await this.builds.findById(id);
    if (!record) throw new NotFoundError(`流派 ${id}`);

    const catalog = await this.catalog.load();
    const build = Build.fromRecord(record, catalog, { status: record.status || BuildStatus.PUBLISHED });
    const summaries = await this.ratings.summaries();
    const summary = summaries.get(build.id);

    return build.toDetailDTO(summary ? { rating: summary.avg, votes: summary.votes } : {});
  }
}

module.exports = { ListBuilds, GetBuild };
