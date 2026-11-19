'use strict';

const { BuildRepository } = require('../domain/build');
const { ConflictError, UnavailableError } = require('../../../shared/kernel/errors');

/** 仅查询 Java 维护的已发布流派视图，不接管流派写入或迁移。 */
class PostgresBuildRepository extends BuildRepository {
  constructor(client) {
    super();
    this.client = client;
  }

  async findById(id) {
    try {
      const rows = await this.client.$queryRaw`SELECT payload FROM game.published_build WHERE id = ${id}`;
      return rows[0]?.payload || null;
    } catch (cause) {
      throw new UnavailableError('流派数据暂时不可用', cause);
    }
  }

  async listPublished({ weaponType = null, inscriptionId = null } = {}) {
    try {
      // 排序与分页由应用层在合并实际评分后完成，避免按旧分数截断结果。
      const rows = await this.client.$queryRaw`
        SELECT payload FROM game.published_build
        WHERE (CAST(${weaponType} AS text) IS NULL OR weapon_type_id = ${weaponType})
          AND (CAST(${inscriptionId} AS text) IS NULL OR inscription_id = ${inscriptionId})
        ORDER BY content_updated_on DESC NULLS LAST, id
      `;
      return rows.map((row) => row.payload);
    } catch (cause) {
      throw new UnavailableError('流派数据暂时不可用', cause);
    }
  }

  /** 旧 Node 审核入口不能绕过 Java 的历史版本与校验逻辑。 */
  async save() { throw new ConflictError('数据库流派请通过 Java 管理端维护'); }

  /** 当前通过状态下架保留历史，不支持 Node 物理删除。 */
  async remove() { throw new ConflictError('数据库流派请通过 Java 管理端下架'); }
}

module.exports = { PostgresBuildRepository };
