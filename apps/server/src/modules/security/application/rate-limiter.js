'use strict';

/**
 * 安全上下文应用层：限流器
 *
 * 用法：
 *   await container.security.rateLimiter.assert('rating', fingerprint)
 *
 * 触发时抛 RateLimitedError（HTTP 层映射为 429 + Retry-After）。
 */

const { evaluateWindow, RateLimitPolicy } = require('../domain/rate-limit');
const { RateLimitedError } = require('../../../shared/kernel/errors');

class RateLimiter {
  /**
   * @param {{store:object, clock:object, policies:Record<string,{limit:number,windowMs:number}>, logger?:object}} deps
   */
  constructor({ store, clock, policies = {}, logger }) {
    this.store = store;
    this.clock = clock;
    this.logger = logger;
    this.policies = new Map(
      Object.entries(policies)
        .filter(([, p]) => p && Number.isFinite(p.limit))
        .map(([action, p]) => [action, new RateLimitPolicy(p)]),
    );
  }

  /** 策略描述（启动日志/文档用） */
  describe() {
    const out = {};
    for (const [action, policy] of this.policies) out[action] = policy.describe();
    return out;
  }

  /**
   * @param {string} action 动作名（rating / submission …）
   * @param {string} key 指纹
   * @returns {Promise<{allowed:boolean, remaining:number}>}
   */
  async assert(action, key) {
    const policy = this.policies.get(action);
    if (!policy) return { allowed: true, remaining: Infinity };

    const storeKey = `${action}:${key}`;
    const now = this.clock.now().getTime();
    const timestamps = await this.store.load(storeKey);
    const decision = evaluateWindow(timestamps, { limit: policy.limit, windowMs: policy.windowMs, now });

    await this.store.save(storeKey, decision.kept);

    if (!decision.allowed) {
      this.logger?.warn('触发限流', { action, retryAfterMs: decision.retryAfterMs });
      throw new RateLimitedError(`请求过于频繁（${action}），请稍后再试`, decision.retryAfterMs);
    }

    return { allowed: true, remaining: decision.remaining };
  }
}

module.exports = { RateLimiter };
