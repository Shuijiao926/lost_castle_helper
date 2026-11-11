'use strict';

/**
 * 评分仓储（JSON 实现）
 *
 * 同一 (buildId, voterKey) 只保留最后一次 —— 防刷的基本盘。
 */

const { RatingRepository, RatingSummary } = require('../domain/rating');

class JsonRatingRepository extends RatingRepository {
  constructor(db, config) {
    super();
    this.db = db;
    this.file = config.dataFiles.runtimeRatings;
  }

  async record(rating) {
    const data = this.db.readRuntime(this.file, { version: 1, ratings: [] });
    const list = (data.ratings || []).filter(
      (r) => !(r.buildId === rating.buildId && r.voterKey === rating.voterKey),
    );
    list.push({
      buildId: rating.buildId,
      score: rating.score,
      voterKey: rating.voterKey,
      at: new Date().toISOString(),
    });
    data.ratings = list;
    this.db.writeRuntime(this.file, data);

    const scores = list.filter((r) => r.buildId === rating.buildId).map((r) => r.score);
    return RatingSummary.from(scores);
  }

  async summaries() {
    const data = this.db.readRuntime(this.file, { version: 1, ratings: [] });
    const byBuild = new Map();
    for (const r of data.ratings || []) {
      if (!byBuild.has(r.buildId)) byBuild.set(r.buildId, []);
      byBuild.get(r.buildId).push(r.score);
    }
    const out = new Map();
    for (const [buildId, scores] of byBuild) out.set(buildId, RatingSummary.from(scores));
    return out;
  }
}

module.exports = { JsonRatingRepository };
