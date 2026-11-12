/* 领域层单元测试：纯函数，不需要 DOM / Electron */
const test = require('node:test');
const assert = require('node:assert/strict');

const createCatalog = require('../src/renderer/js/data/catalog.js');
const createDomain = require('../src/renderer/js/domain/builds.js');

const catalog = createCatalog();
const domain = createDomain(catalog);

test('catalog：内置示例流派与目录已就绪', () => {
  assert.ok(Array.isArray(catalog.BUILDS));
  assert.ok(catalog.BUILDS.length >= 2);
  assert.ok(catalog.WEAPONS.length >= 1);
  assert.ok(Object.keys(catalog.INSC).length > 0);
  assert.ok(catalog.BUILDS[0].id && catalog.BUILDS[0].name);
});

test('目录查找：武器名 / 刻印名 / 未知兜底', () => {
  assert.equal(domain.weaponName('SHW'), '单手武器');
  assert.equal(domain.weapon('不存在的类型').name, '不存在的类型');
  assert.match(domain.inscriptionName('shw_revenge'), /刻印/);
  assert.equal(domain.inscriptionName('nope'), '—');
});

test('stars：每 2 分一颗星，四舍五入', () => {
  assert.equal((domain.stars(10).match(/<i>/g) || []).length, 5);
  assert.equal((domain.stars(8.2).match(/<i>/g) || []).length, 4);
  assert.equal((domain.stars(0).match(/<i>/g) || []).length, 0);
  assert.match(domain.stars(6), /<span class="stars">/);
});

test('matches：关键词 / 武器 / 刻印 / 标签过滤', () => {
  const b = catalog.BUILDS[0];
  assert.equal(domain.matches(b, {}), true);
  assert.equal(domain.matches(b, { q: b.name.slice(0, 2) }), true);
  assert.equal(domain.matches(b, { q: '绝对不存在的词' }), false);
  assert.equal(domain.matches(b, { filterW: b.wt }), true);
  assert.equal(domain.matches(b, { filterW: 'NOT_A_WEAPON' }), false);
  assert.equal(domain.matches(b, { filterI: b.insc }), true);
  if (b.tags && b.tags.length) {
    assert.equal(domain.matches(b, { tag: b.tags[0] }), true);
    assert.equal(domain.matches(b, { tag: '绝对不存在的标签' }), false);
  }
});

test('visibleBuilds：人气 / 评分排序 + 过滤', () => {
  const hot = domain.visibleBuilds(catalog.BUILDS, { sort: 'hot' });
  assert.equal(hot.length, catalog.BUILDS.length);
  for (let i = 1; i < hot.length; i++) assert.ok(hot[i - 1].votes >= hot[i].votes);

  const rating = domain.visibleBuilds(catalog.BUILDS, { sort: 'rating' });
  for (let i = 1; i < rating.length; i++) assert.ok(rating[i - 1].rating >= rating[i].rating);

  const filtered = domain.visibleBuilds(catalog.BUILDS, { sort: 'hot', q: '绝对不存在的词' });
  assert.equal(filtered.length, 0);
});

test('normalizeBuilds：服务端 DTO 归一化', () => {
  const raw = [{ id: 'x', source: '来源A', updatedAt: '2026-01-01' }];
  const out = domain.normalizeBuilds(raw);
  assert.equal(out[0].src, '来源A');
  assert.equal(out[0].updated, '2026-01-01');

  // 已经带 src / updated 的示例数据保持原值
  const demo = domain.normalizeBuilds([{ id: 'y', src: '来源B', updated: '2026-02-02' }]);
  assert.equal(demo[0].src, '来源B');
  assert.equal(demo[0].updated, '2026-02-02');

  assert.deepEqual(domain.normalizeBuilds(null), []);
});
