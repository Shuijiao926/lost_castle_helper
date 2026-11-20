'use strict';

/**
 * 导出客户端数据包（PostgreSQL → data/builds.json）
 *
 * 客户端流派列表读的是数据包而不是 API：详情页要八个区块全量，
 * /api/builds 只给卡片摘要，逐条拉详情又太慢。所以审核通过后由这里
 * 把已发布流派整体导出成一份包，交给 Caddy 的 /data/* 直接托管。
 *
 * 只把 JSON 写到 stdout，诊断一律走 stderr，这样可以安全地重定向：
 *   ./scripts/ops.sh export
 */

const config = require('./app/config');
const { createLogger } = require('./shared/logger');
const { createContainer } = require('./app/container');
const { stripInternal } = require('./modules/builds/domain/build');

async function main() {
  // level=error：info 走 stdout 会污染重定向出来的 JSON。
  const log = createLogger({ scope: 'export', level: 'error' });

  if (!config.databaseUrl) {
    throw new Error('未配置 DATABASE_URL：JSON 模式直接编辑 data/builds.json，不需要导出');
  }

  const container = createContainer({ logger: log, config });
  try {
    const records = await container.buildRepository.listPublished({ sort: 'updated' });
    const summaries = await container.ratingRepository.summaries();

    const builds = records.map((record) => {
      // 内部字段（宝藏深度 t）不进数据包：与 HTTP DTO 共用同一份字段白名单
      const dto = stripInternal(record);
      const summary = summaries.get(dto.id);
      return {
        ...dto,
        rating: summary ? summary.avg : (Number.isFinite(dto.rating) ? dto.rating : 0),
        votes: summary ? summary.votes : (Number.isFinite(dto.votes) ? dto.votes : 0),
      };
    });

    const today = new Date().toISOString().slice(0, 10);
    const pkg = {
      version: today,
      gameVersion: (builds.find((b) => b.gameVersion) || {}).gameVersion || '—',
      updatedAt: today,
      builds,
    };

    process.stdout.write(JSON.stringify(pkg, null, 2) + '\n');
    log.error(`已导出 ${builds.length} 条已发布流派`);
  } finally {
    await container.closeResources();
  }
}

main().catch((e) => {
  console.error('[export] 失败：' + e.message);
  process.exit(1);
});
