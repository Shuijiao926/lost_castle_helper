'use strict';

/**
 * 评分上下文（Ratings）
 *
 * 规则：同一 voterKey（服务端用 IP + UA 指纹）对同一流派只保留最后一次评分。
 */

const { ValidationError } = require('../../../shared/kernel/errors');

class Rating {
  constructor({ buildId, score, voterKey }) {
    this.buildId = buildId;
    this.score = score;
    this.voterKey = voterKey;
  }

  static create({ buildId, score, voterKey }) {
    if (!buildId || typeof buildId !== 'string') throw new ValidationError(['buildId 必填']);
    if (!voterKey) throw new ValidationError(['缺少评分指纹']);
    const n = Number(score);
    if (!Number.isFinite(n) || n < 0 || n > 10) throw new ValidationError(['分数必须在 0–10 之间']);
    return new Rating({ buildId, score: n, voterKey });
  }
}

/** 聚合结果（不可变值对象） */
class RatingSummary {
  constructor({ avg = 0, votes = 0 }) {
    this.avg = Number(avg.toFixed(2));
    this.votes = votes;
  }

  static from(scores) {
    if (!scores.length) return new RatingSummary({ avg: 0, votes: 0 });
    const sum = scores.reduce((a, b) => a + b, 0);
    return new RatingSummary({ avg: sum / scores.length, votes: scores.length });
  }
}

class RatingRepository {
  /** @returns {Promise<RatingSummary>} */
  async record(rating) {
    throw new Error('RatingRepository.record() 未实现');
  }

  /** 批量取：返回 Map<buildId, RatingSummary> */
  async summaries() {
    throw new Error('RatingRepository.summaries() 未实现');
  }
}

module.exports = { Rating, RatingSummary, RatingRepository };
