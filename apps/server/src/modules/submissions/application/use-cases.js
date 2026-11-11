'use strict';

/**
 * 应用层：投稿
 *
 * SubmitBuild  玩家提交 → 落库（PENDING）
 * ReviewSubmission 管理员审核 → 通过则写入流派 + 发布数据包标记
 */

const { Submission, SubmissionStatus } = require('../domain/submission');
const { NotFoundError, ConflictError } = require('../../../shared/kernel/errors');

class SubmitBuild {
  constructor({ submissionRepository, catalogRepository, security, eventBus }) {
    this.submissions = submissionRepository;
    this.catalog = catalogRepository;
    this.security = security;
    this.events = eventBus;
  }

  /**
   * @param {{payload:object, meta:object, fingerprint:string}} input
   */
  async execute(input = {}) {
    const catalog = await this.catalog.load();
    const id = await this.submissions.nextId();

    // 先校验（非法投稿不消耗配额），再限流
    const submission = Submission.create({ id, payload: input.payload, meta: input.meta }, catalog);
    await this.security.rateLimiter.assert('submission', input.fingerprint);

    await this.submissions.save(submission);

    this.events?.publish('SubmissionCreated', { submissionId: submission.id, buildId: submission.buildId });
    return { id: submission.id, status: submission.status };
  }
}

class ReviewSubmission {
  constructor({ submissionRepository, buildRepository, catalogRepository, eventBus }) {
    this.submissions = submissionRepository;
    this.builds = buildRepository;
    this.catalog = catalogRepository;
    this.events = eventBus;
  }

  async execute({ id, decision, note, reviewer }) {
    const record = await this.submissions.findById(id);
    if (!record) throw new NotFoundError(`投稿 ${id}`);

    const submission = Submission.fromRecord(record);
    if (!submission.isPending) {
      throw new ConflictError(`投稿状态为 ${submission.status}，不能重复审核`);
    }

    const catalog = await this.catalog.load();

    if (decision === 'approve') {
      const build = submission.approve(reviewer, note, catalog);
      await this.builds.save(build);
      await this.submissions.save(submission);
      this.events?.publish('BuildPublished', { buildId: build.id, submissionId: submission.id });
      return { ok: true, buildId: build.id, status: submission.status };
    }

    if (decision === 'reject') {
      submission.reject(note);
      await this.submissions.save(submission);
      this.events?.publish('SubmissionRejected', { submissionId: submission.id, reason: note });
      return { ok: true, status: submission.status };
    }

    throw new ConflictError(`未知审核动作：${decision}`);
  }
}

class ListPendingSubmissions {
  constructor({ submissionRepository }) {
    this.submissions = submissionRepository;
  }

  async execute() {
    const records = await this.submissions.listPending();
    return records.map((r) => Submission.fromRecord(r).toDTO());
  }
}

module.exports = { SubmitBuild, ReviewSubmission, ListPendingSubmissions, SubmissionStatus };
