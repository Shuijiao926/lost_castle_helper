'use strict';

/**
 * 投稿仓储（JSON 实现）
 *
 * 每个投稿一个文件：<runtimeDir>/submissions/<id>.json
 * 待审列表 = 目录内 status=PENDING 的文件。
 */

const { SubmissionRepository } = require('../domain/submission');

class JsonSubmissionRepository extends SubmissionRepository {
  constructor(db, config) {
    super();
    this.db = db;
    this.subdir = config.dataFiles.runtimeSubmissionsDir;
    this.counterFile = config.dataFiles.runtimeCounter;
  }

  async nextId() {
    const counter = this.db.readRuntime(this.counterFile, { submission: 0 });
    counter.submission = (counter.submission || 0) + 1;
    this.db.writeRuntime(this.counterFile, counter);
    return `sub_${String(counter.submission).padStart(6, '0')}`;
  }

  async save(submission) {
    const record = {
      ...submission.toDTO(),
      licenseAccepted: submission.licenseAccepted,
    };
    this.db.writeRuntimeJSONDir(this.subdir, `${submission.id}.json`, record);
    return submission;
  }

  async findById(id) {
    const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe) return null;
    return this.db.readRuntimeJSONDir(this.subdir).find((r) => r.id === safe) || null;
  }

  async listPending() {
    return this.db
      .readRuntimeJSONDir(this.subdir)
      .filter((r) => r.status === 'PENDING')
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }
}

module.exports = { JsonSubmissionRepository };
