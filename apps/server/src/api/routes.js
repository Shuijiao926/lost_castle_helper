'use strict';

/**
 * API 集中定义（唯一的地方）
 *
 * 所有路由的「方法 / 路径 / 权限 / 处理器名」都在这里声明，
 * 新增接口只改这一张表 + handlers 里加一个函数。
 */

const AUTH = Object.freeze({
  PUBLIC: 'public',
  ADMIN: 'admin',
});

const ROUTES = Object.freeze([
  { name: 'health', method: 'GET', path: '/health', auth: AUTH.PUBLIC, handler: 'health' },

  { name: 'catalog.get', method: 'GET', path: '/catalog', auth: AUTH.PUBLIC, handler: 'catalog' },

  { name: 'builds.list', method: 'GET', path: '/builds', auth: AUTH.PUBLIC, handler: 'listBuilds' },
  { name: 'builds.get', method: 'GET', path: '/builds/:id', auth: AUTH.PUBLIC, handler: 'getBuild' },

  { name: 'ratings.create', method: 'POST', path: '/ratings', auth: AUTH.PUBLIC, handler: 'rateBuild' },

  { name: 'submissions.create', method: 'POST', path: '/submissions', auth: AUTH.PUBLIC, handler: 'submitBuild' },
  { name: 'submissions.pending', method: 'GET', path: '/submissions', auth: AUTH.ADMIN, handler: 'listSubmissions' },
  { name: 'submissions.review', method: 'POST', path: '/submissions/:id/:decision', auth: AUTH.ADMIN, handler: 'reviewSubmission' },

  { name: 'packages.latest', method: 'GET', path: '/packages/latest', auth: AUTH.PUBLIC, handler: 'getLatestPackage' },
  { name: 'packages.publish', method: 'POST', path: '/packages/publish', auth: AUTH.ADMIN, handler: 'publishPackage' },
]);

/** 预览用：给文档/启动日志提供接口清单（不参与路由注册） */
function describeRoutes(prefix = '') {
  return ROUTES.map((r) => ({
    name: r.name,
    method: r.method,
    path: `${prefix}${r.path}`,
    auth: r.auth,
  }));
}

module.exports = { AUTH, ROUTES, describeRoutes };
