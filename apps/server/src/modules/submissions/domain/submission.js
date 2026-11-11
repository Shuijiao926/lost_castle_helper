'use strict';

/**
 * 投稿聚合（Submission）
 *
 * 玩家提交 → 待审核 → 通过（转成 Build）/ 驳回。
 * 只有 PENDING 能被审核；通过时必须能构建出合法 Build。
 */

const { ConflictError, ValidationError } = require('../../../shared/kernel/errors');
const { Build, BuildStatus } = require('../../builds/domain/build');

const SubmissionStatus = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

const VALID_STATUS = new Set(Object.values(SubmissionStatus));

class Submission {
  constructor(props) {
    this.id = props.id;
    this.buildId = props.buildId;
    this.payload = props.payload;
    this.author = props.author;
    this.contact = props.contact || null;
    this.source = props.source || null;
    this.sourceType = props.sourceType || 'authorized-submission';
    this.files = props.files || [];
    this.licenseAccepted = Boolean(props.licenseAccepted);
    this.status = props.status || SubmissionStatus.PENDING;
    this.reviewNote = props.reviewNote || null;
    this.createdAt = props.createdAt || null;
    this.reviewedAt = props.reviewedAt || null;
  }

  /**
   * 创建投稿：必须能通过严格校验（引用图鉴、字段完整），否则直接拒绝。
   * 这样审核者看到的永远是「结构上已经合格」的投稿。
   */
  static create({ id, payload, meta = {} }, catalog) {
    if (!meta.licenseAccepted) {
      throw new ValidationError(['必须勾选「允许本工具展示」的授权条款']);
    }

    // 严格校验：任何图鉴引用问题都不允许
    Build.fromRecord(payload, catalog, { strict: true, status: BuildStatus.REVIEWING });

    return new Submission({
      id,
      buildId: payload.id,
      payload,
      author: meta.author || payload.author || '匿名',
      contact: meta.contact || null,
      source: meta.source || payload.source || null,
      sourceType: meta.sourceType || 'authorized-submission',
      files: meta.files || [],
      licenseAccepted: true,
      status: SubmissionStatus.PENDING,
    });
  }

  /** 从存储记录还原（仓储只返回原始 JSON） */
  static fromRecord(record) {
    return new Submission({
      id: record.id,
      buildId: record.buildId,
      payload: record.payload,
      author: record.author,
      contact: record.contact,
      source: record.source,
      sourceType: record.sourceType,
      files: record.files,
      licenseAccepted: record.licenseAccepted !== false,
      status: record.status,
      reviewNote: record.reviewNote,
      createdAt: record.createdAt,
      reviewedAt: record.reviewedAt,
    });
  }

  get isPending() {
    return this.status === SubmissionStatus.PENDING;
  }

  /**
   * 审核通过：产出已发布的 Build
   * @returns {Build}
   */
  approve(reviewer, note, catalog) {
    if (!this.isPending) throw new ConflictError(`投稿状态为 ${this.status}，不能重复审核`);
    const build = Build.fromRecord(this.payload, catalog, { strict: true });
    build.publish();
    this.status = SubmissionStatus.APPROVED;
    this.reviewNote = note || null;
    this.reviewedAt = new Date().toISOString();
    this.reviewedBy = reviewer || 'admin';
    return build;
  }

  reject(reason) {
    if (!this.isPending) throw new ConflictError(`投稿状态为 ${this.status}，不能重复审核`);
    if (!reason) throw new ValidationError(['驳回必须填写原因']);
    this.status = SubmissionStatus.REJECTED;
    this.reviewNote = reason;
    this.reviewedAt = new Date().toISOString();
    return this;
  }

  toDTO() {
    return {
      id: this.id,
      buildId: this.buildId,
      author: this.author,
      contact: this.contact,
      source: this.source,
      sourceType: this.sourceType,
      files: this.files,
      status: this.status,
      reviewNote: this.reviewNote,
      createdAt: this.createdAt,
      reviewedAt: this.reviewedAt,
      payload: this.payload,
    };
  }
}

class SubmissionRepository {
  async nextId() {
    throw new Error('SubmissionRepository.nextId() 未实现');
  }

  async save(submission) {
    throw new Error('SubmissionRepository.save() 未实现');
  }

  async findById(id) {
    throw new Error('SubmissionRepository.findById() 未实现');
  }

  async listPending() {
    throw new Error('SubmissionRepository.listPending() 未实现');
  }
}

module.exports = { Submission, SubmissionStatus, SubmissionRepository, VALID_STATUS };
