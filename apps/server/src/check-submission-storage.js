'use strict';

/**
 * 投稿存储预检：只读检查连接、表是否存在与最小权限，不写入任何投稿。
 *
 * 期望结果是「可插入、可查询，但不能修改状态、不能写流派内容」：
 * 状态流转属于 Java 管理端，Node 只负责受理。
 */

const { PrismaClient } = require('@prisma/client');
let stage = 'configuration';

async function main() {
  const config = require('./app/config');
  if (!config.databaseUrl || !config.submissionsDatabaseUrl) {
    throw Object.assign(new Error('投稿写入连接未配置'), { code: 'MISSING_CONNECTION' });
  }
  const writer = new PrismaClient({ datasources: { db: { url: config.submissionsDatabaseUrl } } });
  try {
    stage = 'writer-connect';
    await writer.$connect();
    stage = 'writer-query';
    // 不能直接用名字查询 game.build：投稿账号没有 game schema 的 USAGE，
    // 按名字解析会抛 permission denied，而不是返回 false。先判断 schema 再决定是否查询。
    const [row] = await writer.$queryRaw`
      SELECT current_database() AS database, current_user AS role,
        has_table_privilege(current_user,'player.submission','INSERT') AS can_insert,
        has_table_privilege(current_user,'player.submission','SELECT') AS can_select,
        has_table_privilege(current_user,'player.submission','UPDATE') AS can_update,
        has_table_privilege(current_user,'player.submission','DELETE') AS can_delete,
        CASE WHEN has_schema_privilege(current_user,'game','USAGE')
          THEN has_table_privilege(current_user,'game.build','INSERT')
          ELSE false END AS can_write_build,
        (SELECT count(*)::integer FROM player.submission WHERE status = 'PENDING') AS pending
    `;
    stage = 'permissions';
    if (!row.can_insert || !row.can_select || row.can_update || row.can_delete || row.can_write_build) {
      throw Object.assign(new Error('投稿连接的权限检查未通过'), { code: 'PRIVILEGE_MISMATCH' });
    }
    console.log(JSON.stringify({
      ok: true, storage: 'postgres', submissionWrite: true,
      database: row.database, role: row.role, pendingSubmissions: row.pending,
    }));
  } finally {
    await writer.$disconnect();
  }
}

main().catch((error) => {
  // 初始化异常使用 errorCode，查询异常使用 meta.code；只输出错误码和阶段，避免泄露凭据。
  const candidate = error.meta?.code || error.errorCode || error.code;
  const code = /^(?:P\d{4}|[A-Z0-9]{5}|MISSING_CONNECTION|PRIVILEGE_MISMATCH)$/.test(candidate || '')
    ? candidate : 'CHECK_FAILED';
  console.error(JSON.stringify({ ok: false, error: '投稿数据库连接或权限检查失败', stage, code }));
  process.exitCode = 1;
});
