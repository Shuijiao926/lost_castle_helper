/**
 * 流派模块
 *  - 有数据库：读 Build 表（status=PUBLISHED）
 *  - 无数据库：读 data/builds.json（骨架阶段）
 */
const db = require('../plugins/db');
const jsonStore = require('../store/json-store');

async function list() {
  const prisma = db.getDb();
  if (prisma) {
    const rows = await prisma.build.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { votes: 'desc' },
    });
    return {
      source: 'db',
      builds: rows.map((r) => ({ ...r.payload, rating: r.rating, votes: r.votes })),
    };
  }
  const file = jsonStore.getBuildsFile();
  const merged = jsonStore.mergeRatings(file);
  return { source: 'file', version: merged.version, gameVersion: merged.gameVersion, builds: merged.builds };
}

async function get(id) {
  const prisma = db.getDb();
  if (prisma) {
    const row = await prisma.build.findUnique({ where: { id } });
    if (!row) return null;
    return { ...row.payload, rating: row.rating, votes: row.votes };
  }
  const file = jsonStore.getBuildsFile();
  return (file.builds || []).find((b) => b.id === id) || null;
}

module.exports = { list, get };
