/**
 * 评分模块
 * 同一 voterKey（IP + UA 指纹）对同一流派只保留最后一次，避免刷分。
 */
const db = require('../plugins/db');
const jsonStore = require('../store/json-store');

/**
 * @param {string} buildId
 * @param {number} score 0-10
 * @param {string} voterKey
 */
async function add(buildId, score, voterKey) {
  const prisma = db.getDb();
  if (prisma) {
    await prisma.rating.upsert({
      where: { buildId_voterKey: { buildId, voterKey } },
      create: { buildId, score, voterKey },
      update: { score },
    });
    const agg = await prisma.rating.aggregate({
      where: { buildId },
      _avg: { score: true },
      _count: true,
    });
    const avg = agg._avg.score || 0;
    await prisma.build.update({
      where: { id: buildId },
      data: { rating: Number(avg.toFixed(2)), votes: agg._count },
    }).catch(() => {});
    return { id: buildId, avg: Number(avg.toFixed(2)), votes: agg._count };
  }

  return jsonStore.addRating(buildId, score, voterKey);
}

module.exports = { add };
