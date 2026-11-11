'use strict';

/**
 * 流派聚合（Build）
 *
 * 一个流派 = 客户端卡片 + 详情页 8 个区块。
 * payload 保留完整原始结构（含内部字段），对外 DTO 时剥离内部信息。
 */

const { ValidationError, ConflictError } = require('../../../shared/kernel/errors');
const kernel = require('../../../shared/kernel/shared-kernel');

/** 流派状态 */
const BuildStatus = Object.freeze({
  DRAFT: 'DRAFT',         // 编辑中，客户端不可见
  REVIEWING: 'REVIEWING', // 待审核
  PUBLISHED: 'PUBLISHED', // 已发布
  ARCHIVED: 'ARCHIVED',   // 已下架
});

const VALID_STATUS = new Set(Object.values(BuildStatus));

/** 数据来源类型（合规用：见 文档/数据源清单.md） */
const SourceType = Object.freeze({
  WIKI: 'wiki',
  SELF_TEST: 'self-test',
  AUTHORIZED_SUBMISSION: 'authorized-submission',
  PR: 'pr',
  MAINTAINER: 'maintainer',
});

const VALID_SOURCE_TYPE = new Set(Object.values(SourceType));
const LICENSE = 'CC-BY-NC-SA-4.0';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 内部字段：绝对不能出现在给客户端的数据里 */
const INTERNAL_FIELDS = ['t'];

function assertUniqueTreasures(list) {
  const seen = new Set();
  for (const item of list) {
    const key = item.n;
    if (seen.has(key)) throw new ValidationError([`treasureOrder 出现重复宝藏：${key}`]);
    seen.add(key);
  }
}

/** 剥离内部字段（宝藏深度 t） */
function stripInternal(record) {
  const out = { ...record };
  if (Array.isArray(out.treasureOrder)) {
    out.treasureOrder = out.treasureOrder.map((item) => {
      const copy = { ...item };
      for (const f of INTERNAL_FIELDS) delete copy[f];
      return copy;
    });
  }
  return out;
}

class Build {
  /**
   * @param {object} record 完整流派数据（含内部字段）
   * @param {object} catalog CatalogSnapshot
   * @param {{status?:string, strict?:boolean, warnings?:string[]}} opts
   */
  constructor(record, catalog, opts = {}) {
    this.record = record;
    this.catalog = catalog;
    this.status = opts.status || BuildStatus.PUBLISHED;
    this.warnings = opts.warnings || [];
  }

  /**
   * 载入/导入数据（默认宽松：历史数据可能引用不全，只记警告）
   * 新投稿必须用 strict=true，任何引用问题都直接拒绝。
   */
  static fromRecord(record, catalog, opts = {}) {
    const strict = Boolean(opts.strict);
    const errors = [];
    const warnings = [];

    if (!record || typeof record !== 'object') throw new ValidationError(['流派必须是对象']);

    // 1) 共享内核：字段级校验（前后端一致）
    //    宽松模式下，与图鉴引用相关的错误降级为警告（历史数据可能引用不全）
    const check = kernel.validateBuild(record);
    if (!check.ok) {
      for (const err of check.errors) {
        const isCatalogRef = /^(wt|insc)：/.test(err);
        if (isCatalogRef && !strict) warnings.push(err);
        else errors.push(err);
      }
    }

    // 2) 图鉴引用校验
    if (record.wt && !catalog.hasWeaponType(record.wt)) {
      const msg = `武器类型未登记：${record.wt}`;
      strict ? errors.push(msg) : warnings.push(msg);
    }
    if (record.insc) {
      const insc = catalog.inscription(record.insc);
      if (!insc) {
        const msg = `刻印未登记：${record.insc}`;
        strict ? errors.push(msg) : warnings.push(msg);
      } else if (record.wt && insc.weaponTypeId !== record.wt) {
        const msg = `刻印 ${record.insc} 属于 ${insc.weaponTypeId}，与流派武器类型 ${record.wt} 不匹配`;
        strict ? errors.push(msg) : warnings.push(msg);
      }
    }

    // 3) 领域规则：宝藏顺序
    if (Array.isArray(record.treasureOrder) && record.treasureOrder.length) {
      try {
        assertUniqueTreasures(record.treasureOrder);
      } catch (e) {
        errors.push(...e.errors);
      }
    }

    // 4) 领域规则：日期与来源
    if (record.updatedAt && !DATE_RE.test(record.updatedAt)) {
      errors.push('updatedAt 必须是 YYYY-MM-DD');
    }
    if (record.sourceType !== undefined && !VALID_SOURCE_TYPE.has(record.sourceType)) {
      errors.push(`sourceType 必须是 ${[...VALID_SOURCE_TYPE].join(' / ')}`);
    }
    if (record.license !== undefined && record.license !== LICENSE) {
      errors.push(`license 只允许 ${LICENSE}`);
    }

    // 5) 状态
    const status = opts.status || record.status || BuildStatus.PUBLISHED;
    if (!VALID_STATUS.has(status)) errors.push(`未知状态：${status}`);

    if (errors.length) throw new ValidationError(errors);

    return new Build(record, catalog, { status, warnings });
  }

  get id() {
    return this.record.id;
  }

  get name() {
    return this.record.name;
  }

  get weaponTypeId() {
    return this.record.wt;
  }

  get inscriptionId() {
    return this.record.insc;
  }

  get isPublished() {
    return this.status === BuildStatus.PUBLISHED;
  }

  /** 发布：只能从 DRAFT / REVIEWING / ARCHIVED 进入 */
  publish() {
    if (this.isPublished) return this;
    this.status = BuildStatus.PUBLISHED;
    return this;
  }

  /** 下架：合规投诉时的第一动作（见 数据源清单 第六节） */
  archive() {
    if (this.status === BuildStatus.ARCHIVED) return this;
    this.status = BuildStatus.ARCHIVED;
    return this;
  }

  /**
   * 修改数据（重新走校验），用于「审核通过时补充字段」
   */
  update(patch, opts = {}) {
    if (this.status === BuildStatus.ARCHIVED) {
      throw new ConflictError('已下架的流派不能直接修改，请先恢复');
    }
    const merged = { ...this.record, ...patch };
    const rebuilt = Build.fromRecord(merged, this.catalog, {
      status: this.status,
      strict: opts.strict !== false,
    });
    Object.assign(this, rebuilt);
    return this;
  }

  /** 持久化形态：完整 payload + 状态 */
  toRecord() {
    return {
      ...this.record,
      sourceType: this.record.sourceType || SourceType.MAINTAINER,
      license: this.record.license || LICENSE,
      status: this.status,
    };
  }

  /** 列表卡片 DTO（不含内部字段，不含大段正文） */
  toCardDTO(override = {}) {
    const r = this.record;
    const wt = this.catalog.weaponType(r.wt);
    const insc = this.catalog.inscription(r.insc);
    return {
      id: r.id,
      name: r.name,
      aliases: r.aliases || [],
      weaponType: wt ? { id: wt.id, name: wt.name, short: wt.short } : { id: r.wt, name: r.wt, short: r.wt },
      inscription: insc ? { id: insc.id, name: insc.name } : { id: r.insc, name: r.insc },
      rating: override.rating ?? r.rating ?? 0,
      votes: override.votes ?? r.votes ?? 0,
      features: r.features || [],
      tags: r.tags || [],
      author: r.author,
      sourceType: r.sourceType || SourceType.MAINTAINER,
      gameVersion: r.gameVersion,
      updatedAt: r.updatedAt,
      status: this.status,
    };
  }

  /** 详情 DTO：8 个区块全量，但剥掉内部排序字段 */
  toDetailDTO(override = {}) {
    return {
      ...stripInternal(this.record),
      sourceType: this.record.sourceType || SourceType.MAINTAINER,
      license: this.record.license || LICENSE,
      status: this.status,
      rating: override.rating ?? this.record.rating ?? 0,
      votes: override.votes ?? this.record.votes ?? 0,
    };
  }

  /** 用于数据包序列化（Publishing 上下文） */
  toPackageItem() {
    return stripInternal(this.record);
  }
}

/** 仓储接口（infrastructure 实现） */
class BuildRepository {
  async findById(id) {
    throw new Error('BuildRepository.findById() 未实现');
  }

  /** @param {{weaponType?:string, inscriptionId?:string, sort?:'rating'|'votes'|'updated'}} filter */
  async listPublished(filter) {
    throw new Error('BuildRepository.listPublished() 未实现');
  }

  async save(build) {
    throw new Error('BuildRepository.save() 未实现');
  }
}

module.exports = {
  Build,
  BuildStatus,
  SourceType,
  BuildRepository,
  LICENSE,
};
