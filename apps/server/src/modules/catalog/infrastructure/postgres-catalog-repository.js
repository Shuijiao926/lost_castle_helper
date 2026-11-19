'use strict';

const { CatalogRepository, CatalogSnapshot } = require('../domain/catalog');
const { UnavailableError } = require('../../../shared/kernel/errors');

/** 只读 Java 已发布批次；一次查询保证条目与版本来自同一数据库快照。 */
class PostgresCatalogRepository extends CatalogRepository {
  constructor(client) {
    super();
    this.client = client;
  }

  async load() {
    try {
      const rows = await this.client.$queryRaw`
        SELECT b.content_hash, b.record_count, b.counts,
          COALESCE(jsonb_agg(jsonb_build_object(
            'kind', i.kind, 'payload', i.payload
          ) ORDER BY i.kind, i.position, i.item_id)
            FILTER (WHERE i.item_id IS NOT NULL), '[]'::jsonb) AS items
        FROM catalog.active_release r
        JOIN catalog.import_batch b ON b.id = r.batch_id
        LEFT JOIN catalog.item i ON i.batch_id = b.id
        WHERE r.singleton = 1
        GROUP BY b.id
      `;
      if (rows.length !== 1) throw new Error('No active catalog batch');
      const batch = rows[0];
      const kinds = ['weapons', 'weaponItems', 'inscriptions', 'schools', 'treasures',
        'armors', 'soulStones', 'cursedTreasures', 'nightmareEffects'];
      const collections = Object.fromEntries(kinds.map((kind) => [kind, []]));
      for (const item of batch.items) {
        if (!Object.hasOwn(collections, item.kind)) throw new Error('Unknown catalog kind');
        collections[item.kind].push(item.payload);
      }
      if (batch.items.length !== batch.record_count
          || kinds.some((kind) => !collections[kind].length || collections[kind].length !== batch.counts[kind])) {
        throw new Error('Incomplete active catalog batch');
      }
      return new CatalogSnapshot({
        ...collections,
        version: batch.content_hash.trim(),
        collections,
      });
    } catch (cause) {
      // 数据库故障或坏批次不可悄悄回退 JSON，避免玩家读到另一套数据。
      throw new UnavailableError('图鉴数据暂时不可用', cause);
    }
  }
}

module.exports = { PostgresCatalogRepository };
