'use strict';

const { RatingRepository, RatingSummary } = require('../domain/rating');
const { NotFoundError, UnavailableError } = require('../../../shared/kernel/errors');

/** 查询汇总与写评分使用不同账号，均不向接口暴露原始指纹或连接信息。 */
class PostgresRatingRepository extends RatingRepository {
  constructor(readClient, writeClient) {
    super();
    this.readClient = readClient;
    this.writeClient = writeClient;
  }

  /** 数据库函数内串行写入、校验发布状态并计算包含本次修改的汇总。 */
  async record(rating) {
    if (!this.writeClient) throw new UnavailableError('评分写入连接尚未配置');
    try {
      const rows = await this.writeClient.$queryRaw`
        SELECT average_score, votes FROM player.rate_build(
          CAST(${rating.buildId} AS text), CAST(${rating.voterKey} AS text), CAST(${rating.score} AS numeric))
      `;
      if (rows.length !== 1) throw new Error('Missing rating summary');
      return new RatingSummary({ avg: Number(rows[0].average_score), votes: Number(rows[0].votes) });
    } catch (cause) {
      // 流派可能在应用检查之后被下架；以数据库锁内检查为准。
      if (cause.meta?.code === 'P0002') throw new NotFoundError('流派 ' + rating.buildId);
      throw new UnavailableError('评分暂时无法保存', cause);
    }
  }

  /** 只读聚合视图，列表和详情不再读取 ratings.json 或 mock 票数。 */
  async summaries() {
    try {
      const rows = await this.readClient.$queryRaw`
        SELECT build_id, average_score, votes FROM player.build_rating_summary
      `;
      return new Map(rows.map((row) => [row.build_id,
        new RatingSummary({ avg: Number(row.average_score), votes: Number(row.votes) })]));
    } catch (cause) {
      throw new UnavailableError('评分数据暂时不可用', cause);
    }
  }
}

module.exports = { PostgresRatingRepository };
