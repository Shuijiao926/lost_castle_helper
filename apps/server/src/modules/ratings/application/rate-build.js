'use strict';

/**
 * 应用层：评分
 */

const { Rating } = require('../domain/rating');
const { NotFoundError } = require('../../../shared/kernel/errors');

class RateBuild {
  constructor({ ratingRepository, buildRepository, security, eventBus }) {
    this.ratings = ratingRepository;
    this.builds = buildRepository;
    this.security = security;
    this.events = eventBus;
  }

  /**
   * @param {{buildId:string, score:number, fingerprint:string}} input
   *        顺序：先做领域校验（非法请求不消耗配额），再走安全管控
   */
  async execute({ buildId, score, fingerprint }) {
    const rating = Rating.create({ buildId, score, voterKey: fingerprint });

    await this.security.rateLimiter.assert('rating', fingerprint);

    // 确认流派存在（不存在就不要产生孤儿评分）
    const build = await this.builds.findById(rating.buildId);
    if (!build) throw new NotFoundError(`流派 ${rating.buildId}`);

    const summary = await this.ratings.record(rating);
    this.events?.publish('BuildRated', { buildId: rating.buildId, score: rating.score });
    return { buildId: rating.buildId, avg: summary.avg, votes: summary.votes };
  }
}

module.exports = { RateBuild };
