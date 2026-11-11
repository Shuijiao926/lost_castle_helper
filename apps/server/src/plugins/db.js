/**
 * 数据库连接（骨架）
 * 没配 DATABASE_URL 就不连，业务层自动降级到 JSON 文件存储。
 */
const config = require('../config');

let prisma = null;

function enabled() {
  return Boolean(config.databaseUrl);
}

function getDb() {
  if (!enabled()) return null;
  if (prisma) return prisma;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
  } catch (e) {
    console.warn('[db] @prisma/client 未安装或未生成，降级为文件存储：', e.message);
    return null;
  }
  return prisma;
}

async function disconnect() {
  if (prisma) { await prisma.$disconnect().catch(() => {}); prisma = null; }
}

module.exports = { enabled, getDb, disconnect };
