'use strict';

/**
 * API 处理器（唯一的地方）
 *
 * 每个 handler 都很薄：解析请求 → 调用模块用例 → 返回数据。
 * `ok: true` 包装与权限校验由 http-server 统一处理。
 */

const { ListBuilds, GetBuild } = require('../modules/builds/application/use-cases');
const { GetCatalog } = require('../modules/catalog/application/get-catalog');
const { SubmitBuild, ReviewSubmission, ListPendingSubmissions } = require('../modules/submissions/application/use-cases');
const { RateBuild } = require('../modules/ratings/application/rate-build');
const { GetLatestPackage, PublishPackage } = require('../modules/publishing/application/use-cases');
const { BadRequestError, ValidationError } = require('../shared/kernel/errors');

function createHandlers(container) {
  /* ---------- 查询 ---------- */
  const listBuilds = new ListBuilds(container);
  const getBuild = new GetBuild(container);
  const getCatalog = new GetCatalog(container);

  /* ---------- 写入 ---------- */
  const rateBuild = new RateBuild(container);
  const submitBuild = new SubmitBuild(container);
  const reviewSubmission = new ReviewSubmission(container);
  const listPending = new ListPendingSubmissions(container);
  const getLatestPackage = new GetLatestPackage(container);
  const publishPackage = new PublishPackage(container);

  return {
    async health() {
      return {
        service: 'lc2-server',
        env: container.config.env,
        persistence: container.config.databaseUrl ? 'postgres' : 'json',
        version: container.packageVersion || null,
        time: new Date().toISOString(),
      };
    },

    async catalog() {
      return { catalog: await getCatalog.execute() };
    },

    async listBuilds(request) {
      const { weaponType, inscriptionId, sort, limit, offset } = request.query || {};
      return listBuilds.execute({ weaponType, inscriptionId, sort, limit, offset });
    },

    async getBuild(request) {
      return { build: await getBuild.execute(request.params.id) };
    },

    async rateBuild(request) {
      const { buildId, score } = request.body || {};
      const fingerprint = container.security.fingerprint(request);
      return rateBuild.execute({ buildId, score, fingerprint });
    },

    async submitBuild(request) {
      const { payload, meta } = request.body || {};
      if (!payload || typeof payload !== 'object') {
        throw new BadRequestError('payload 必填且必须是对象');
      }
      const fingerprint = container.security.fingerprint(request);
      return submitBuild.execute({ payload, meta: meta || {}, fingerprint });
    },

    async listSubmissions() {
      const items = await listPending.execute();
      return { items, count: items.length };
    },

    async reviewSubmission(request) {
      const { id, decision } = request.params;
      if (!['approve', 'reject'].includes(decision)) {
        throw new ValidationError([`未知审核动作：${decision}（只支持 approve / reject）`]);
      }
      const note = (request.body || {}).note || null;
      return reviewSubmission.execute({ id, decision, note, reviewer: 'admin' });
    },

    async getLatestPackage() {
      return { package: await getLatestPackage.execute() };
    },

    async publishPackage(request) {
      const notes = (request.body || {}).notes || '';
      return { package: await publishPackage.execute({ notes }) };
    },
  };
}

module.exports = { createHandlers };
