'use strict';

/**
 * 管理员鉴权（P1 临时方案）
 *
 * 请求头名与口令都来自配置，不在代码里写死。
 * P4 换成账号体系时，只替换这里与 routes 的 auth 标记，业务代码不动。
 */

const { ForbiddenError } = require('../shared/kernel/errors');

function createAdminGuard(config) {
  const header = config.api.adminHeader.toLowerCase();
  const token = config.security.adminToken;

  return function requireAdmin(request) {
    const provided = request.headers?.[header];
    if (!provided || provided !== token) {
      throw new ForbiddenError('管理员口令不正确');
    }
    return true;
  };
}

module.exports = { createAdminGuard };
