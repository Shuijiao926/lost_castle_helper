/**
 * Fastify 应用装配：插件 + 路由
 *
 * 路由一览
 *   GET  /api/health
 *   GET  /api/builds              流派列表（含评分汇总）
 *   GET  /api/builds/:id          单个流派
 *   POST /api/ratings             评分
 *   POST /api/submissions         投稿（公开）
 *   GET  /api/submissions         待审队列（管理员）
 *   POST /api/submissions/:id/approve | reject（管理员）
 *   GET  /api/packages/latest     数据包版本
 *   POST /api/packages/publish    发布数据包（管理员）
 */
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const config = require('./config');

const builds = require('./modules/builds');
const ratings = require('./modules/ratings');
const submissions = require('./modules/submissions');
const packages = require('./modules/packages');
const db = require('./plugins/db');

function clientKey(req) {
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  const ua = String(req.headers['user-agent'] || '').slice(0, 40);
  return ip + '|' + ua;
}

function requireAdmin(req, reply) {
  const token = req.headers['x-admin-token'];
  if (token !== config.adminToken) {
    reply.code(401).send({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

async function buildApp() {
  const app = Fastify({ logger: { level: config.env === 'production' ? 'info' : 'warn' } });

  await app.register(cors, { origin: true });
  await app.register(require('@fastify/multipart'), { limits: { fileSize: 8 * 1024 * 1024 } });

  /* ---------- 基础 ---------- */
  app.get('/api/health', async () => ({
    ok: true,
    service: 'lc2-server',
    env: config.env,
    database: db.enabled() ? 'postgres' : 'json-file',
    fileStorage: config.fileStorage,
    time: new Date().toISOString(),
  }));

  /* ---------- 流派 ---------- */
  app.get('/api/builds', async () => {
    const r = await builds.list();
    return { ok: true, ...r };
  });
  app.get('/api/builds/:id', async (req, reply) => {
    const b = await builds.get(req.params.id);
    if (!b) return reply.code(404).send({ ok: false, error: 'not found' });
    return { ok: true, build: b };
  });

  /* ---------- 评分 ---------- */
  app.post('/api/ratings', async (req, reply) => {
    const { buildId, score } = req.body || {};
    if (typeof buildId !== 'string' || !buildId) {
      return reply.code(400).send({ ok: false, error: 'buildId required' });
    }
    const n = Number(score);
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      return reply.code(400).send({ ok: false, error: 'score must be 0-10' });
    }
    const r = await ratings.add(buildId, n, clientKey(req));
    return { ok: true, ...r };
  });

  /* ---------- 投稿 ---------- */
  app.post('/api/submissions', async (req, reply) => {
    const { build, meta } = req.body || {};
    if (!build) return reply.code(400).send({ ok: false, error: 'build required' });
    const r = await submissions.create(build, meta || {});
    if (!r.ok) return reply.code(r.code || 422).send({ ok: false, error: 'validation failed', details: r.errors });
    return { ok: true, id: r.id };
  });

  app.get('/api/submissions', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { ok: true, ...(await submissions.list()) };
  });

  app.post('/api/submissions/:id/approve', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const r = await submissions.approve(req.params.id, (req.body || {}).note);
    return reply.code(r.ok ? 200 : r.code || 400).send(r);
  });

  app.post('/api/submissions/:id/reject', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const r = await submissions.reject(req.params.id, (req.body || {}).note);
    return reply.code(r.ok ? 200 : r.code || 400).send(r);
  });

  /* ---------- 数据包 ---------- */
  app.get('/api/packages/latest', async () => ({ ok: true, package: packages.latest() }));

  app.post('/api/packages/publish', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const meta = packages.publish((req.body || {}).notes);
    return { ok: true, package: meta };
  });

  return app;
}

module.exports = { buildApp };
