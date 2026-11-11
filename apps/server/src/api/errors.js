'use strict';

/**
 * HTTP 错误映射：领域错误 → 状态码
 *
 * 放在 API 公共层，模块（domain/application）不感知 HTTP 语义。
 */

const {
  DomainError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  RateLimitedError,
  BadRequestError,
} = require('../shared/kernel/errors');

const SCOPE = 'api:errors';

function mapError(error, logger) {
  if (error instanceof ValidationError) {
    return { status: 422, body: { ok: false, error: 'validation failed', details: error.errors } };
  }
  if (error instanceof BadRequestError) {
    return { status: 400, body: { ok: false, error: error.message } };
  }
  if (error instanceof NotFoundError) {
    return { status: 404, body: { ok: false, error: error.message } };
  }
  if (error instanceof ConflictError) {
    return { status: 409, body: { ok: false, error: error.message } };
  }
  if (error instanceof ForbiddenError) {
    return { status: 401, body: { ok: false, error: error.message } };
  }
  if (error instanceof RateLimitedError) {
    const retryAfterSec = Math.max(1, Math.ceil((error.retryAfterMs || 0) / 1000));
    return {
      status: 429,
      headers: { 'retry-after': String(retryAfterSec) },
      body: { ok: false, error: error.message, retryAfterMs: error.retryAfterMs || 0 },
    };
  }
  if (error instanceof DomainError) {
    return { status: 400, body: { ok: false, error: error.message, code: error.code } };
  }

  logger?.error('未处理的异常', { scope: SCOPE, message: error.message, stack: error.stack?.split('\n')[1] });
  return null; // 交给上层按 500 处理
}

module.exports = { mapError };
