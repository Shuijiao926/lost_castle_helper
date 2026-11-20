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

const defaultConfig = require('./config');
const { NodeHasher, SystemClock } = require('./adapters');
const { createAdminGuard } = require('./admin-auth');
const { createLogger } = require('../shared/logger');

const { InMemoryEventBus } = require('../shared/kernel/event-bus');
const { JsonDatabase } = require('../shared/infrastructure/json-database');

const { JsonCatalogRepository } = require('../modules/catalog/infrastructure/json-catalog-repository');
const { PostgresCatalogRepository } = require('../modules/catalog/infrastructure/postgres-catalog-repository');
const { JsonBuildRepository } = require('../modules/builds/infrastructure/json-build-repository');
const { PostgresBuildRepository } = require('../modules/builds/infrastructure/postgres-build-repository');
const { JsonSubmissionRepository } = require('../modules/submissions/infrastructure/json-submission-repository');
const { PostgresSubmissionRepository } = require('../modules/submissions/infrastructure/postgres-submission-repository');
const { JsonRatingRepository } = require('../modules/ratings/infrastructure/json-rating-repository');
const { PostgresRatingRepository } = require('../modules/ratings/infrastructure/postgres-rating-repository');
const { JsonPackageRepository } = require('../modules/publishing/infrastructure/json-package-repository');

const { PackageAssembler } = require('../modules/publishing/domain/package');
const { JsonRateLimitStore } = require('../modules/security/infrastructure/json-rate-limit-store');
const { RequestFingerprint } = require('../modules/security/infrastructure/fingerprint');
const { RateLimiter } = require('../modules/security/application/rate-limiter');

function createContainer({ logger, databaseClient, catalogClient, ratingClient, submissionClient, config = defaultConfig } = {}) {
  const log = logger || createLogger({ scope: 'lc2', level: config.logLevel });

  const db = new JsonDatabase({ dataDir: config.dataDir, runtimeDir: config.runtimeDir });
  const eventBus = new InMemoryEventBus({ logger: log.child('events') });
  const hasher = new NodeHasher();
  const clock = new SystemClock();

  /* ---------- 仓储 ---------- */
  let ownedClient = null;
  let ownedRatingClient = null;
  let ownedSubmissionClient = null;
  const suppliedClient = databaseClient || catalogClient;
  if (config.databaseUrl && !suppliedClient) {
    // 仅使用已有 Prisma 的查询能力；不对 Java 管理的 schema 执行建表或迁移。
    const { PrismaClient } = require('@prisma/client');
    ownedClient = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  }
  if (config.databaseUrl && config.ratingsDatabaseUrl && !ratingClient) {
    const { PrismaClient } = require('@prisma/client');
    ownedRatingClient = new PrismaClient({ datasources: { db: { url: config.ratingsDatabaseUrl } } });
  }
  if (config.databaseUrl && config.submissionsDatabaseUrl && !submissionClient) {
    const { PrismaClient } = require('@prisma/client');
    ownedSubmissionClient = new PrismaClient({ datasources: { db: { url: config.submissionsDatabaseUrl } } });
  }
  const catalogRepository = config.databaseUrl
    ? new PostgresCatalogRepository(suppliedClient || ownedClient)
    : new JsonCatalogRepository(db, config);
  const buildRepository = config.databaseUrl
    ? new PostgresBuildRepository(suppliedClient || ownedClient)
    : new JsonBuildRepository(db, config);
  const submissionRepository = config.databaseUrl && config.submissionsDatabaseUrl
    ? new PostgresSubmissionRepository(submissionClient || ownedSubmissionClient)
    : new JsonSubmissionRepository(db, config);
  const ratingRepository = config.databaseUrl
    ? new PostgresRatingRepository(suppliedClient || ownedClient, ratingClient || ownedRatingClient)
    : new JsonRatingRepository(db, config);
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
    persistence: config.databaseUrl ? 'mixed' : 'json',
    persistenceDetails: {
      catalog: config.databaseUrl ? 'postgres' : 'json',
      builds: config.databaseUrl ? 'postgres' : 'json', ratings: config.databaseUrl ? 'postgres' : 'json',
      submissions: config.databaseUrl && config.submissionsDatabaseUrl ? 'postgres' : 'json',
      packages: 'json',
    },
    ratingWriteConfigured: Boolean(config.databaseUrl && (config.ratingsDatabaseUrl || ratingClient)),
    /** 流派改由 Java 维护后，投稿审核也只能由管理端执行，Node 不再写入流派。 */
    submissionReviewOwner: config.databaseUrl ? 'java' : 'node',
    async closeResources() {
      await Promise.all([ownedClient?.$disconnect(), ownedRatingClient?.$disconnect(), ownedSubmissionClient?.$disconnect()]);
    },
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
