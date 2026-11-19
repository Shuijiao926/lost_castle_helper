'use strict';

/** 服务器部署前检查评分连接与最小权限；只做查询，不创建测试评分。 */
const { PrismaClient } = require('@prisma/client');
let stage = 'configuration';

async function main() {
  const config = require('./app/config');
  if (!config.databaseUrl || !config.ratingsDatabaseUrl) {
    throw Object.assign(new Error('评分连接未配置'), { code: 'MISSING_CONNECTION' });
  }
  const reader = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  const writer = new PrismaClient({ datasources: { db: { url: config.ratingsDatabaseUrl } } });
  try {
    // 显式连接保留 Prisma 的初始化错误码；首次查询触发的惰性连接可能丢失该字段。
    stage = 'reader-connect';
    await reader.$connect();
    stage = 'reader-query';
    const [read] = await reader.$queryRaw`
      SELECT current_database() AS database, current_user AS role,
        (SELECT count(*)::integer FROM player.build_rating_summary) AS rated_builds,
        has_function_privilege(current_user,'player.rate_build(text,text,numeric)','EXECUTE') AS can_rate
    `;
    stage = 'writer-connect';
    await writer.$connect();
    stage = 'writer-query';
    const [write] = await writer.$queryRaw`
      SELECT current_database() AS database, current_user AS role,
        has_function_privilege(current_user,'player.rate_build(text,text,numeric)','EXECUTE') AS can_rate,
        has_table_privilege(current_user,'player.build_rating','SELECT') AS can_read_raw,
        has_table_privilege(current_user,'player.build_rating','INSERT') AS can_insert_raw,
        has_table_privilege(current_user,'player.build_rating','UPDATE') AS can_update_raw,
        has_table_privilege(current_user,(SELECT c.oid FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='game' AND c.relname='build'),'UPDATE') AS can_change_build
    `;
    stage = 'permissions';
    if (read.database !== write.database || read.can_rate || !write.can_rate
        || write.can_read_raw || write.can_insert_raw || write.can_update_raw || write.can_change_build) {
      throw Object.assign(new Error('评分连接的数据库或最小权限检查未通过'), { code: 'PRIVILEGE_MISMATCH' });
    }
    console.log(JSON.stringify({
      ok: true, storage: 'postgres', ratingWrite: true,
      readRole: read.role, writeRole: write.role, buildsWithRatings: read.rated_builds,
    }));
  } finally {
    await Promise.all([reader.$disconnect(), writer.$disconnect()]);
  }
}

main().catch((error) => {
  // 初始化异常使用 errorCode，查询异常使用 meta.code；只输出错误码和阶段，避免泄露凭据。
  const candidate = error.meta?.code || error.errorCode || error.code;
  const code = /^(?:P\d{4}|[A-Z0-9]{5}|MISSING_CONNECTION|PRIVILEGE_MISMATCH)$/.test(candidate || '')
    ? candidate : 'CHECK_FAILED';
  console.error(JSON.stringify({ ok: false, error: '评分数据库连接或权限检查失败', stage, code }));
  process.exitCode = 1;
});
