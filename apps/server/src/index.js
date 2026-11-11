'use strict';

/**
 * 服务启动入口
 *
 *   npm run server       （仓库根目录）
 *   npm start            （apps/server）
 *
 * 启动只打印「数据加载情况」，不打印接口清单（接口见 文档/服务端说明.md）。
 */

const config = require('./app/config');
const { createLogger } = require('./shared/logger');
const { createContainer } = require('./app/container');
const { buildHttpServer } = require('./app/http-server');

const log = createLogger({ scope: 'lc2', level: config.logLevel });

/** 启动时汇总数据加载情况（缺数据也能起，只是提示） */
async function collectDataStatus(container) {
  const status = { catalog: null, builds: null, ratings: null, package: null, warnings: [] };

  try {
    const catalog = await container.catalogRepository.load();
    status.catalog = {
      weapons: catalog.weapons.size,
      inscriptions: catalog.inscriptions.size,
      schools: catalog.schools.size,
      treasures: catalog.treasures.size,
    };
    if (catalog.treasures.size === 0) status.warnings.push('宝藏图鉴为空（P2 采集后补全）');
  } catch (e) {
    status.warnings.push(`图鉴加载失败：${e.message}`);
  }

  try {
    const builds = await container.buildRepository.listPublished({});
    status.builds = { published: builds.length };
    if (!builds.length) status.warnings.push('没有已发布的流派');
  } catch (e) {
    status.warnings.push(`流派加载失败：${e.message}`);
  }

  try {
    const summaries = await container.ratingRepository.summaries();
    status.ratings = { ratedBuilds: summaries.size };
  } catch (e) {
    status.warnings.push(`评分加载失败：${e.message}`);
  }

  try {
    const pkg = await container.packageRepository.latest();
    status.package = pkg ? pkg.version : '未发布';
  } catch (e) {
    status.package = '未发布';
  }

  return status;
}

async function main() {
  const container = createContainer({ logger: log });

  container.eventBus.subscribe('BuildPublished', ({ buildId }) =>
    log.info('流派已发布，需要重新发布数据包', { buildId }),
  );
  container.eventBus.subscribe('PackagePublished', ({ version }) =>
    log.info('数据包已发布', { version }),
  );

  const app = await buildHttpServer(container);
  await app.listen({ host: config.host, port: config.port });

  const status = await collectDataStatus(container);

  log.info('服务已启动', {
    url: `http://${config.host}:${config.port}`,
    env: config.env,
    persistence: config.databaseUrl ? 'postgres' : 'json',
  });
  log.info('数据加载完成', status);
  log.debug('安全策略', container.security.describe());

  if (status.warnings.length) {
    for (const warning of status.warnings) log.warn(warning);
  }

  const shutdown = async (signal) => {
    log.info('正在关闭服务', { signal });
    await app.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  log.error('启动失败', { message: e.message, stack: e.stack?.split('\n').slice(0, 4).join(' | ') });
  process.exit(1);
});
