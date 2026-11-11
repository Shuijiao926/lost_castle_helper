'use strict';

/**
 * 安全上下文：限流策略（纯函数，无 IO）
 *
 * 滑动窗口计数：只保留窗口内的时间戳，数量达到 limit 即拒绝。
 * 领域层不碰存储、不碰时钟，二者由 application 注入。
 */

/**
 * @param {number[]} timestamps 历史请求时间（毫秒）
 * @param {{limit:number, windowMs:number, now:number}} policy
 * @returns {{allowed:boolean, remaining:number, retryAfterMs:number, kept:number[]}}
 */
function evaluateWindow(timestamps, { limit, windowMs, now }) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return { allowed: true, remaining: Infinity, retryAfterMs: 0, kept: [] };
  }

  const since = now - windowMs;
  const kept = (timestamps || []).filter((t) => Number.isFinite(t) && t > since).sort((a, b) => a - b);

  if (kept.length >= limit) {
    const oldest = kept[0];
    const retryAfterMs = Math.max(0, oldest + windowMs - now);
    return { allowed: false, remaining: 0, retryAfterMs, kept };
  }

  kept.push(now);
  return { allowed: true, remaining: limit - kept.length, retryAfterMs: 0, kept };
}

/** 限流策略值对象 */
class RateLimitPolicy {
  constructor({ limit, windowMs }) {
    if (!Number.isFinite(limit) || limit < 0) throw new Error('limit 必须是非负数字');
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('windowMs 必须是正数');
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** 人类可读描述，用于日志与文档 */
  describe() {
    const minutes = Math.round((this.windowMs / 60_000) * 10) / 10;
    return `${this.limit} 次 / ${minutes} 分钟`;
  }
}

module.exports = { evaluateWindow, RateLimitPolicy };
