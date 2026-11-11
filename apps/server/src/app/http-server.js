'use strict';

/**
 * HTTP 服务器装配
 *
 * 这一层很薄：
 *   - 注册插件（CORS / multipart）
 *   - 按 api/routes.js 的声明批量注册路由（含权限）
 *   - 用 api/errors.js 把领域错误翻译成状态码
 *
 * 业务逻辑一律在 modules/ 里。
 */

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');

const { AUTH, ROUTES, describeRoutes } = require('../api/routes');
const { createHandlers } = require('../api/handlers');
const { mapError } = require('../api/errors');

async function buildHttpServer(container, { logger } = {}) {
  const log = logger || container.logger;
  const { config } = container;

  const app = Fastify({
    logger: false, // 统一走 shared/logger，避免两套日志格式
    bodyLimit: config.api.maxBodyBytes,
    disableRequestLogging: true,
  });

  await app.register(cors, {
    origin: config.cors.origins.length ? config.cors.origins : true,
    credentials: config.cors.credentials,
    maxAge: config.cors.maxAge,
  });
  await app.register(multipart, { limits: { fileSize: config.api.maxUploadBytes } });

  /* ---------- 错误映射 ---------- */
  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error, log);
    if (mapped) {
      if (mapped.headers) reply.headers(mapped.headers);
      return reply.code(mapped.status).send(mapped.body);
    }
    // fastify 自身的校验错误（如 body 解析失败）
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) log.error('未处理异常', { path: request.url, message: error.message });
    return reply.code(status).send({ ok: false, error: status === 500 ? 'internal error' : error.message });
  });

  /* ---------- 按声明注册路由 ---------- */
  const handlers = createHandlers(container);
  const prefix = config.api.prefix;

  for (const route of ROUTES) {
    const handler = handlers[route.handler];
    if (typeof handler !== 'function') {
      throw new Error(`路由 ${route.name} 声明的 handler「${route.handler}」未实现`);
    }
    const method = route.method.toLowerCase();

    app[method](`${prefix}${route.path}`, async (request) => {
      if (route.auth === AUTH.ADMIN) container.requireAdmin(request);
      const result = await handler(request);
      return { ok: true, ...(result || {}) };
    });
  }

  log.debug('路由注册完成', { count: ROUTES.length, prefix });
  log.debug('接口清单', { routes: describeRoutes(prefix).map((r) => `${r.method} ${r.path}`) });

  return app;
}

module.exports = { buildHttpServer };
