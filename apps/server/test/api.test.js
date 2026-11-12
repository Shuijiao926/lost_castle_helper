'use strict';

/**
 * HTTP 集成测试：用 fastify.inject()，不真的监听端口。
 * 数据目录复制到临时目录，避免污染仓库里的种子数据。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { REPO_ROOT } = require('../test-support/helpers');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lc2-server-test-'));
const dataDir = path.join(tmpRoot, 'data');
const runtimeDir = path.join(tmpRoot, 'runtime');
fs.mkdirSync(dataDir, { recursive: true });

// builds.json 用测试 fixture（仓库里的种子数据已清空，等真实数据接入）
fs.copyFileSync(path.join(__dirname, 'fixtures', 'builds.json'), path.join(dataDir, 'builds.json'));
for (const name of ['weapons.json', 'inscriptions.json', 'schools.json']) {
  fs.copyFileSync(path.join(REPO_ROOT, 'data', name), path.join(dataDir, name));
}

process.env.DATA_DIR = dataDir;
process.env.RUNTIME_DIR = runtimeDir;
process.env.ADMIN_TOKEN = 'test-token';
process.env.LOG_LEVEL = 'error';
process.env.RATING_RATE_LIMIT = '2';        // 便于验证限流
process.env.RATING_RATE_WINDOW_MS = '60000';
process.env.SUBMISSION_RATE_LIMIT = '10';

const { createContainer } = require('../src/app/container');
const { buildHttpServer } = require('../src/app/http-server');

let app;
let container;

test.before(async () => {
  container = createContainer();
  app = await buildHttpServer(container, { logger: container.logger });
  await app.ready();
});

test.after(async () => {
  await app.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('GET /api/health：返回持久化模式与目录', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'lc2-server');
  assert.equal(body.persistence, 'json');
});

test('GET /api/catalog：返回武器类型与刻印', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/catalog' });
  assert.equal(res.statusCode, 200);
  const { catalog } = res.json();
  assert.ok(catalog.weapons.length >= 9);
  assert.ok(catalog.inscriptions.length >= 27);
  assert.ok(catalog.schools.length >= 20);
});

test('GET /api/builds：列表返回卡片字段且不含内部字段', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/builds' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.ok(body.items.length >= 2);

  const card = body.items[0];
  assert.ok(card.id);
  assert.ok(card.weaponType.name);
  assert.equal('treasureOrder' in card, false, '列表卡片不应带完整区块');
});

test('GET /api/builds/:id：详情剥掉宝藏深度 t', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/builds/shw_revenge_sword' });
  assert.equal(res.statusCode, 200);
  const { build } = res.json();
  for (const item of build.treasureOrder) {
    assert.equal('t' in item, false);
  }
});

test('GET /api/builds/:id：不存在的流派返回 404', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/builds/not_exists' });
  assert.equal(res.statusCode, 404);
});

test('POST /api/ratings：同指纹重复评分只保留最后一次', async () => {
  const first = await app.inject({
    method: 'POST', url: '/api/ratings',
    payload: { buildId: 'shw_revenge_sword', score: 9 },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().votes, 1);

  const second = await app.inject({
    method: 'POST', url: '/api/ratings',
    payload: { buildId: 'shw_revenge_sword', score: 5 },
  });
  assert.equal(second.json().votes, 1);
  assert.equal(second.json().avg, 5);

  const list = await app.inject({ method: 'GET', url: '/api/builds' });
  const card = list.json().items.find((i) => i.id === 'shw_revenge_sword');
  assert.equal(card.rating, 5);
});

test('POST /api/ratings：非法分数返回 422', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/ratings',
    payload: { buildId: 'shw_revenge_sword', score: 99 },
  });
  assert.equal(res.statusCode, 422);
});

test('POST /api/ratings：超过阈值返回 429 与 Retry-After', async () => {
  // 前两个用例已经消耗了 2 次配额（RATING_RATE_LIMIT=2）
  const res = await app.inject({
    method: 'POST', url: '/api/ratings',
    payload: { buildId: 'shw_revenge_sword', score: 7 },
  });
  assert.equal(res.statusCode, 429);
  assert.ok(res.headers['retry-after']);
  assert.equal(res.json().ok, false);
});

test('POST /api/ratings：非法分数不消耗限流配额（先校验后限流）', async () => {
  // 用另一个指纹（不同 UA）验证：非法请求不计数
  const headers = { 'user-agent': 'lc2-test-invalid' };
  for (let i = 0; i < 3; i++) {
    const res = await app.inject({
      method: 'POST', url: '/api/ratings', headers,
      payload: { buildId: 'shw_revenge_sword', score: 99 },
    });
    assert.equal(res.statusCode, 422);
  }
});

test('POST /api/submissions：缺授权拒绝；合法投稿进入待审', async () => {
  const fresh = await app.inject({ method: 'GET', url: '/api/builds/shw_revenge_sword' });
  const payload = fresh.json().build;
  payload.id = 'test_demo_build';
  payload.name = '测试流派';

  const noLicense = await app.inject({
    method: 'POST', url: '/api/submissions',
    payload: { payload, meta: { author: '测试员' } },
  });
  assert.equal(noLicense.statusCode, 422);

  const ok = await app.inject({
    method: 'POST', url: '/api/submissions',
    payload: { payload, meta: { author: '测试员', licenseAccepted: true } },
  });
  assert.equal(ok.statusCode, 200);
  const { id } = ok.json();
  assert.match(id, /^sub_\d{6}$/);
});

test('审核接口：未带管理员 token 返回 401', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/submissions' });
  assert.equal(res.statusCode, 401);
});

test('审核通过：写回流派并出现在列表中', async () => {
  const pending = await app.inject({
    method: 'GET', url: '/api/submissions',
    headers: { 'x-admin-token': 'test-token' },
  });
  assert.equal(pending.statusCode, 200);
  const items = pending.json().items;
  assert.equal(items.length, 1);

  const approve = await app.inject({
    method: 'POST', url: `/api/submissions/${items[0].id}/approve`,
    headers: { 'x-admin-token': 'test-token' },
    payload: { note: '通过' },
  });
  assert.equal(approve.statusCode, 200);
  assert.equal(approve.json().status, 'APPROVED');

  const list = await app.inject({ method: 'GET', url: '/api/builds' });
  assert.ok(list.json().items.some((i) => i.id === 'test_demo_build'));

  // 已审核的不能再审
  const again = await app.inject({
    method: 'POST', url: `/api/submissions/${items[0].id}/reject`,
    headers: { 'x-admin-token': 'test-token' },
    payload: { note: '驳回' },
  });
  assert.equal(again.statusCode, 409);
});

test('发布数据包：无 token 拒绝；发布后可取到最新版本', async () => {
  const denied = await app.inject({ method: 'POST', url: '/api/packages/publish', payload: {} });
  assert.equal(denied.statusCode, 401);

  const published = await app.inject({
    method: 'POST', url: '/api/packages/publish',
    headers: { 'x-admin-token': 'test-token' },
    payload: { notes: '测试发布' },
  });
  assert.equal(published.statusCode, 200);
  const pkg = published.json().package;
  assert.match(pkg.version, /-r\d+$/);
  assert.equal(pkg.fileHash.length, 64); // sha256 hex

  const latest = await app.inject({ method: 'GET', url: '/api/packages/latest' });
  assert.equal(latest.statusCode, 200);
  assert.equal(latest.json().package.version, pkg.version);
});
