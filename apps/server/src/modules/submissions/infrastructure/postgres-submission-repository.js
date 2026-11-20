'use strict';

/**
 * 投稿仓储（PostgreSQL 实现）
 *
 * 只负责「新增待审」与「读取」：状态流转由 Java 管理端独占，
 * 因此这里没有 update/delete 语句，重复写入由数据库唯一索引拒绝。
 */

const crypto = require('crypto');
const { SubmissionRepository } = require('../domain/submission');
const { ConflictError, UnavailableError } = require('../../../shared/kernel/errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 键排序后的 JSON 文本，保证同一内容得到同一指纹。 */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** 投稿载荷指纹，用于部署预检与重复内容识别，不参与业务判断。 */
function fingerprint(payload) {
  return crypto.createHash('sha256').update(canonical(payload), 'utf8').digest('hex');
}

class PostgresSubmissionRepository extends SubmissionRepository {
  constructor(client) {
    super();
    this.client = client;
  }

  /** 交由中国数据库生成标识会引入额外往返，这里直接用 UUID 作为受理号。 */
  async nextId() {
    return crypto.randomUUID();
  }

  /** 只插入待审记录；同流派已有待审时由唯一索引拒绝，不覆盖也不合并。 */
  async save(submission) {
    const record = submission.toDTO();
    try {
      await this.client.$executeRaw`
        INSERT INTO player.submission
          (id, build_id, status, author, contact, source, source_type,
           license_accepted, files, payload, payload_hash)
        VALUES (
          CAST(${submission.id} AS uuid), ${submission.buildId}, ${submission.status},
          ${submission.author}, ${submission.contact}, ${submission.source}, ${submission.sourceType},
          ${submission.licenseAccepted}, CAST(${JSON.stringify(record.files)} AS jsonb),
          CAST(${JSON.stringify(record.payload)} AS jsonb), ${fingerprint(record.payload)})
      `;
    } catch (cause) {
      if (cause.meta?.code === '23505') throw new ConflictError('该流派已有待审投稿');
      throw new UnavailableError('投稿暂时无法保存', cause);
    }
    return submission;
  }

  /** 非 UUID 标识不可能存在于表中，直接按未找到处理，避免数据库类型错误。 */
  async findById(id) {
    const value = String(id || '');
    if (!UUID.test(value)) return null;
    try {
      const rows = await this.client.$queryRaw`
        SELECT id::text AS id, build_id, status, author, contact, source, source_type,
               license_accepted, files::text AS files, payload::text AS payload,
               review_note, reviewed_by, submitted_at, reviewed_at
        FROM player.submission WHERE id = CAST(${value} AS uuid)
      `;
      return rows[0] ? toRecord(rows[0]) : null;
    } catch (cause) {
      throw new UnavailableError('投稿暂时不可用', cause);
    }
  }

  /** 待审列表按提交时间升序，先到先审；完整载荷交给上层转换。 */
  async listPending() {
    try {
      const rows = await this.client.$queryRaw`
        SELECT id::text AS id, build_id, status, author, contact, source, source_type,
               license_accepted, files::text AS files, payload::text AS payload,
               review_note, reviewed_by, submitted_at, reviewed_at
        FROM player.submission WHERE status = 'PENDING'
        ORDER BY submitted_at, id
      `;
      return rows.map(toRecord);
    } catch (cause) {
      throw new UnavailableError('投稿暂时不可用', cause);
    }
  }
}

/** 数据库行转仓储记录：只做字段改名与 JSON 还原，不改变内容结构。 */
function toRecord(row) {
  return {
    id: row.id,
    buildId: row.build_id,
    status: row.status,
    author: row.author,
    contact: row.contact,
    source: row.source,
    sourceType: row.source_type,
    licenseAccepted: row.license_accepted,
    files: JSON.parse(row.files),
    payload: JSON.parse(row.payload),
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by,
    createdAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
  };
}

module.exports = { PostgresSubmissionRepository };
