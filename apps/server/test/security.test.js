'use strict';

/**
 * 安全上下文单测：纯逻辑（不依赖存储）
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateWindow, RateLimitPolicy } = require('../src/modules/security/domain/rate-limit');
const { RateLimiter } = require('../src/modules/security/application/rate-limiter');
const { RequestFingerprint } = require('../src/modules/security/infrastructure/fingerprint');

test('滑动窗口：达到上限后拒绝，并给出重试时间', () => {
  const now = 1_000_000;
  const policy = { limit: 2, windowMs: 60_000, now };

  const first = evaluateWindow([], policy);
  assert.equal(first.allowed, true);

  const second = evaluateWindow(first.kept, policy);
  assert.equal(second.allowed, true);

  const third = evaluateWindow(second.kept, policy);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterMs > 0 && third.retryAfterMs <= policy.windowMs);
});

test('滑动窗口：窗口外的旧记录会被清理（允许恢复）', () => {
  const now = 1_000_000;
  const old = now - 120_000;
  const decision = evaluateWindow([old, old], { limit: 1, windowMs: 60_000, now });
  assert.equal(decision.allowed, true);
  assert.equal(decision.kept.length, 1);
});

test('RateLimitPolicy：非法参数直接拒绝构造', () => {
  assert.throws(() => new RateLimitPolicy({ limit: -1, windowMs: 1000 }));
  assert.throws(() => new RateLimitPolicy({ limit: 1, windowMs: 0 }));
});

test('RateLimiter：用内存 store 模拟，第三次调用抛 429 类错误', async () => {
  const memory = new Map();
  const store = {
    async load(key) { return memory.get(key) || []; },
    async save(key, ts) { memory.set(key, ts); },
  };
  let now = 5_000;
  const limiter = new RateLimiter({
    store,
    clock: { now: () => new Date(now) },
    policies: { rating: { limit: 2, windowMs: 60_000 } },
  });

  await limiter.assert('rating', 'fp-a');
  now += 100;
  await limiter.assert('rating', 'fp-a');
  now += 100;
  await assert.rejects(() => limiter.assert('rating', 'fp-a'), /请求过于频繁/);

  // 不同指纹互不影响
  await limiter.assert('rating', 'fp-b');
});

test('RequestFingerprint：同 IP+UA 稳定，换 UA 变化，且不暴露原始信息', () => {
  const { NodeHasher } = require('../src/app/adapters');
  const fp = new RequestFingerprint({ hasher: new NodeHasher() });

  const reqA = { ip: '10.0.0.1', headers: { 'user-agent': 'UA1' } };
  const reqB = { ip: '10.0.0.1', headers: { 'user-agent': 'UA2' } };

  const a1 = fp.of(reqA);
  const a2 = fp.of(reqA);
  assert.equal(a1, a2);
  assert.notEqual(a1, fp.of(reqB));
  assert.equal(a1.includes('10.0.0.1'), false);
});
