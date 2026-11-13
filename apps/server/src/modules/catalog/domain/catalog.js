'use strict';

/**
 * 图鉴上下文（Catalog）
 *
 * 只读的游戏参考数据：武器类型、灵魂刻印、宝物流派分类、宝藏。
 * 这些数据由采集器（P2 从 wiki）写入，领域内不修改，只做校验与查询。
 */

const { ValidationError } = require('../../../shared/kernel/errors');
const kernel = require('../../../shared/kernel/shared-kernel');

/** 枚举（值来自共享内核，保证前后端一致） */
const Enums = {
  WeaponType: kernel.WEAPON_TYPES,
  Rarity: kernel.RARITIES,
  Verdict: kernel.VERDICTS,
  WeaponTag: kernel.WEAPON_TAGS,
  /** 宝藏深度：仅内部用于排序，永不返回给客户端 UI */
  ClassifyDepth: kernel.DEPTHS,
};

class WeaponType {
  constructor({ id, name, short, subs, note }) {
    this.id = id;
    this.name = name;
    this.short = short || name;
    this.subs = subs || [];
    this.note = note || '';
  }

  static from(raw) {
    if (!raw || !raw.id || !raw.name) throw new ValidationError('武器类型缺少 id 或 name');
    return new WeaponType(raw);
  }
}

class Inscription {
  constructor({ id, name, wt, kind, source }) {
    this.id = id;
    this.name = name;
    this.weaponTypeId = wt;
    this.kind = kind || 'normal'; // hunter = 宝藏猎人
    if (source) this.source = { type: source.type, name: source.name, url: source.url, license: source.license };
  }

  static from(raw) {
    if (!raw || !raw.id || !raw.name) throw new ValidationError('刻印缺少 id 或 name');
    return new Inscription(raw);
  }
}

class School {
  constructor({ id, name, kind }) {
    this.id = id;
    this.name = name;
    this.kind = kind || 'classify';
  }

  static from(raw) {
    if (!raw || !raw.id || !raw.name) throw new ValidationError('宝物流派分类缺少 id 或 name');
    return new School(raw);
  }
}

class Treasure {
  constructor({ id, name, rarity, classifyId, depth }) {
    this.id = id || name;
    this.name = name;
    this.rarity = rarity || '普通';
    this.classifyId = classifyId || null;
    this.depth = depth || null;
  }

  static from(raw) {
    if (!raw || !raw.name) throw new ValidationError('宝藏缺少 name');
    return new Treasure(raw);
  }
}

/**
 * 图鉴快照：一次性加载、内存内查询。
 * 领域层只通过它引用图鉴，不直接碰数据源。
 */
class CatalogSnapshot {
  constructor({ weapons = [], inscriptions = [], schools = [], treasures = [], version = '0' } = {}) {
    this.version = version;

    this.weapons = new Map();
    for (const raw of weapons) {
      const w = WeaponType.from(raw);
      if (this.weapons.has(w.id)) throw new ValidationError(`武器类型 id 重复：${w.id}`);
      this.weapons.set(w.id, w);
    }

    this.inscriptions = new Map();
    for (const raw of inscriptions) {
      const i = Inscription.from(raw);
      if (this.inscriptions.has(i.id)) throw new ValidationError(`刻印 id 重复：${i.id}`);
      this.inscriptions.set(i.id, i);
    }

    this.schools = new Map();
    for (const raw of schools) {
      const s = School.from(raw);
      if (this.schools.has(s.id)) throw new ValidationError(`流派分类 id 重复：${s.id}`);
      this.schools.set(s.id, s);
    }

    this.treasures = new Map();
    for (const raw of treasures) {
      const t = Treasure.from(raw);
      if (this.treasures.has(t.id)) throw new ValidationError(`宝藏 id 重复：${t.id}`);
      this.treasures.set(t.id, t);
    }
  }

  hasWeaponType(code) {
    return this.weapons.has(code);
  }

  hasInscription(id) {
    return this.inscriptions.has(id);
  }

  weaponType(code) {
    return this.weapons.get(code) || null;
  }

  inscription(id) {
    return this.inscriptions.get(id) || null;
  }

  /** 某武器类型下的刻印（含宝藏猎人） */
  inscriptionsOf(weaponTypeCode) {
    return [...this.inscriptions.values()].filter((i) => i.weaponTypeId === weaponTypeCode);
  }

  school(id) {
    return this.schools.get(id) || null;
  }

  treasure(idOrName) {
    return this.treasures.get(idOrName) || null;
  }

  toDTO() {
    return {
      version: this.version,
      weapons: [...this.weapons.values()],
      inscriptions: [...this.inscriptions.values()],
      schools: [...this.schools.values()],
      treasures: [...this.treasures.values()],
    };
  }
}

/** 仓储接口：由 infrastructure 实现（json / prisma） */
class CatalogRepository {
  /** @returns {Promise<CatalogSnapshot>} */
  async load() {
    throw new Error('CatalogRepository.load() 未实现');
  }
}

module.exports = {
  Enums,
  WeaponType,
  Inscription,
  School,
  Treasure,
  CatalogSnapshot,
  CatalogRepository,
};
