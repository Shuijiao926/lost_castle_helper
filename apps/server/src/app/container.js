'use strict';

/**
 * 组合根（Composition Root）
 *
 * 服务端唯一「把实现拼起来」的地方：
 *   - 选持久化实现（P1：JSON；P4：Prisma）
 *   - 选适配器（logger / hash / clock）
 *   - 装配安全管控（限流器 + 请求指纹）
 *
 * 业务代码只拿到接口能力，不关心具体实现。
 */

const config = require('./config');
const { NodeHasher, SystemClock } = require('./adapters');
const { createAdminGuard } = require('./admin-auth');
const { createLogger } = require('../shared/logger');

const { InMemoryEventBus } = require('../shared/kernel/event-bus');
const { JsonDatabase } = require('../shared/infrastructure/json-database');

const { JsonCatalogRepository } = require('../modules/catalog/infrastructure/json-catalog-repository');
const { JsonBuildRepository } = require('../modules/builds/infrastructure/json-build-repository');
const { JsonSubmissionRepository } = require('../modules/submissions/infrastructure/json-submission-repository');
const { JsonRatingRepository } = require('../modules/ratings/infrastructure/json-rating-repository');
const { JsonPackageRepository } = require('../modules/publishing/infrastructure/json-package-repository');

const { PackageAssembler } = require('../modules/publishing/domain/package');
const { JsonRateLimitStore } = require('../modules/security/infrastructure/json-rate-limit-store');
const { RequestFingerprint } = require('../modules/security/infrastructure/fingerprint');
const { RateLimiter } = require('../modules/security/application/rate-limiter');

function createContainer({ logger } = {}) {
  const log = logger || createLogger({ scope: 'lc2', level: config.logLevel });

  const db = new JsonDatabase({ dataDir: config.dataDir, runtimeDir: config.runtimeDir });
  const eventBus = new InMemoryEventBus({ logger: log.child('events') });
  const hasher = new NodeHasher();
  const clock = new SystemClock();

  /* ---------- 仓储 ---------- */
  const catalogRepository = new JsonCatalogRepository(db, config);
  const buildRepository = new JsonBuildRepository(db, config);
  const submissionRepository = new JsonSubmissionRepository(db, config);
  const ratingRepository = new JsonRatingRepository(db, config);
  const packageRepository = new JsonPackageRepository(db, config);

  /* ---------- 安全管控 ---------- */
  const rateLimitStore = new JsonRateLimitStore(db, { file: config.security.storeFile });
  const rateLimiter = new RateLimiter({
    store: rateLimitStore,
    clock,
    policies: config.security.rateLimits,
    logger: log.child('security'),
  });
  const fingerprint = new RequestFingerprint({ hasher });

  /* ---------- 跨模块领域服务 ---------- */
  const packageAssembler = new PackageAssembler(
    { packageRepository, hasher, clock },
    { fileBaseUrl: config.publishing.fileBaseUrl, filePrefix: config.publishing.filePrefix },
  );

  return {
    config,
    logger: log,
    db,
    eventBus,
    hasher,
    clock,
    requireAdmin: createAdminGuard(config),

    /* 安全上下文能力 */
    security: {
      rateLimiter,
      fingerprint: (request) => fingerprint.of(request),
      describe: () => rateLimiter.describe(),
    },

    /* 仓储（模块内 infra 实现，模块外只用接口能力） */
    catalogRepository,
    buildRepository,
    submissionRepository,
    ratingRepository,
    packageRepository,

    /* 跨模块领域服务 */
    packageAssembler,
  };
}

module.exports = { createContainer };
