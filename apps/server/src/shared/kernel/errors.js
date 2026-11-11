'use strict';

/**
 * 领域错误
 *
 * 领域层抛出的错误只表达「业务规则被违反」，不携带 HTTP 语义。
 * 到 interfaces 层再由错误映射表翻译成状态码。
 */

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/** 数据不满足不变量（字段缺失、枚举非法、引用不存在…） */
class ValidationError extends DomainError {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(`数据校验未通过（${list.length} 处）`, 'VALIDATION_ERROR');
    this.errors = list;
  }
}

/** 聚合/实体不存在 */
class NotFoundError extends DomainError {
  constructor(what) {
    super(`${what} 不存在`, 'NOT_FOUND');
  }
}

/** 状态迁移非法（如已审核的投稿再次审核） */
class ConflictError extends DomainError {
  constructor(message) {
    super(message, 'CONFLICT');
  }
}

/** 权限不足（管理员口令错误等） */
class ForbiddenError extends DomainError {
  constructor(message = '无权限') {
    super(message, 'FORBIDDEN');
  }
}


/** 触发安全管控（限流 / 频率超限） */
class RateLimitedError extends DomainError {
  constructor(message, retryAfterMs = 0) {
    super(message, 'RATE_LIMITED');
    this.retryAfterMs = retryAfterMs;
  }
}

/** 输入不合法（HTTP 请求参数层面） */
class BadRequestError extends DomainError {
  constructor(message) {
    super(message, 'BAD_REQUEST');
  }
}

module.exports = {
  DomainError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  RateLimitedError,
  BadRequestError,
};
