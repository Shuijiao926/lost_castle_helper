'use strict';

/** 公开图鉴字段白名单；数据库的内部字段与未知元数据不进入 HTTP DTO。 */
const PUBLIC_FIELDS = Object.freeze({
  weapons: ['id', 'name', 'short', 'subs', 'note'],
  weaponItems: ['id', 'name', 'wt', 'desc', 'effect', 'icon', 'rarity', 'stats'],
  inscriptions: ['id', 'name', 'wt', 'kind', 'desc', 'effect', 'effectGroups', 'icon', 'source'],
  schools: ['id', 'name', 'kind'],
  treasures: ['id', 'name', 'rarity', 'desc', 'effect', 'icon', 'tags', 'source'],
  armors: ['id', 'name', 'kind', 'rarity', 'desc', 'effect', 'icon', 'stats', 'unobtainable'],
  soulStones: ['id', 'name', 'slot', 'grade', 'eff', 'icon', 'maxLevel', 'unavailable'],
  cursedTreasures: ['id', 'name', 'code', 'eff', 'icon', 'removed'],
  nightmareEffects: ['name', 'description', 'options'],
});

/** 深层效果也可能含内部排序值，递归剥离且不修改仓储持有的载荷。 */
function publicValue(value) {
  if (Array.isArray(value)) return value.map(publicValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['t', 'depth', '__proto__', 'constructor', 'prototype'].includes(key))
    .map(([key, entry]) => [key, publicValue(entry)]));
}

/** 在领域出口转换完整九类集合，兼容原刻印 weaponTypeId 字段。 */
function projectCollections(collections) {
  return Object.fromEntries(Object.entries(PUBLIC_FIELDS).map(([kind, fields]) => [
    kind,
    collections[kind].map((record) => {
      const dto = {};
      for (const field of fields) {
        if (Object.hasOwn(record, field)) dto[field] = publicValue(record[field]);
      }
      if (dto.source && typeof dto.source === 'object') {
        dto.source = Object.fromEntries(['type', 'name', 'url', 'license']
          .filter((key) => Object.hasOwn(dto.source, key)).map((key) => [key, dto.source[key]]));
      }
      if (kind === 'inscriptions') dto.weaponTypeId = record.wt;
      return dto;
    }),
  ]));
}

module.exports = { PUBLIC_FIELDS, projectCollections };
