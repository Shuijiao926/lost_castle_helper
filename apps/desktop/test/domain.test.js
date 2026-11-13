/* 领域层单元测试：纯函数，不需要 DOM / Electron
 * 数据已清空（等真实数据接入），所以业务规则用测试内 fixture 验证。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const createCatalog = require('../src/renderer/js/data/catalog.js');
const createDomain = require('../src/renderer/js/domain/builds.js');

const catalog = createCatalog();
const domain = createDomain(catalog);

/** 最小可用的流派 fixture（字段与 data/builds.json 一致） */
function makeBuild(over = {}) {
  return {
    id: 'test_build_1',
    name: '测试流派一',
    aliases: ['别名一'],
    wt: 'SHW',
    insc: 'shw_revenge',
    rating: 8.2,
    votes: 1915,
    author: '@测试',
    features: ['站桩', '低门槛'],
    tags: ['冰属性', '盾反'],
    core: ['昂龙剑盾'],
    tip: '测试用玩法技巧，足够长',
    treasureOrder: [{ t: 'R', n: '不融冰', r: '优秀' }],
    ...over,
  };
}
const FIXTURE_BUILDS = [
  makeBuild(),
  makeBuild({ id: 'test_build_2', name: '测试流派二', wt: 'DB', insc: 'db_blademaster', rating: 7.6, votes: 1299, tags: ['暴击'], features: ['高段数'] }),
  makeBuild({ id: 'test_build_3', name: '测试流派三', wt: 'BOW', insc: 'bow_roaring', rating: 9.1, votes: 300, tags: ['雷击'], features: ['远程'] }),
];

test('catalog：结构完整，允许流派数据为空（真实数据未接入）', () => {
  assert.ok(Array.isArray(catalog.BUILDS));
  assert.equal(catalog.BUILDS.length, 0);
  assert.ok(Array.isArray(catalog.WEAPONS));
  assert.ok(Object.keys(catalog.INSC).length > 0);
  assert.ok(Array.isArray(catalog.ALL_TAGS));
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
  const b = FIXTURE_BUILDS[0];
  assert.equal(domain.matches(b, {}), true);
  assert.equal(domain.matches(b, { q: '测试流派' }), true);
  assert.equal(domain.matches(b, { q: '绝对不存在的词' }), false);
  assert.equal(domain.matches(b, { filterW: b.wt }), true);
  assert.equal(domain.matches(b, { filterW: 'NOT_A_WEAPON' }), false);
  assert.equal(domain.matches(b, { filterI: b.insc }), true);
  assert.equal(domain.matches(b, { tag: b.tags[0] }), true);
  assert.equal(domain.matches(b, { tag: '绝对不存在的标签' }), false);
});

test('多选筛选：同类取「或」，不同类取「且」', () => {
  const a = FIXTURE_BUILDS[0]; // SHW / shw_revenge / tags 冰属性,盾反
  const b = FIXTURE_BUILDS[1]; // DB / db_blademaster / tags 暴击

  // 同类多选：武器 OR
  assert.equal(domain.matches(a, { filterW: [a.wt, b.wt] }), true);
  assert.equal(domain.matches(a, { filterW: [b.wt] }), false);

  // 刻印多选
  assert.equal(domain.matches(a, { filterI: [a.insc, b.insc] }), true);
  assert.equal(domain.matches(a, { filterI: [b.insc] }), false);

  // 标签多选：命中任一即可
  assert.equal(domain.matches(a, { tag: ['暴击', a.tags[0]] }), true);
  assert.equal(domain.matches(a, { tag: ['暴击'] }), false);

  // 不同类同时满足：武器 + 标签
  assert.equal(domain.matches(a, { filterW: [a.wt], tag: [a.tags[0]] }), true);
  assert.equal(domain.matches(a, { filterW: [a.wt], tag: ['暴击'] }), false);

  // 兼容旧的单值字符串
  assert.equal(domain.matches(a, { filterW: a.wt }), true);
});

test('装备筛选：按具体武器名匹配 gear / weaponChoices', () => {
  const b = makeBuild({
    gear: { weapon: { name: '生铁大剑' } },
    weaponChoices: [{ name: '生铁大剑', tag: '核心' }],
  });
  assert.equal(domain.matches(b, { filterEquip: ['生铁大剑'] }), true);
  assert.equal(domain.matches(b, { filterEquip: ['铁木大剑'] }), false);
  // 多选装备：命中任一即可
  assert.equal(domain.matches(b, { filterEquip: ['铁木大剑', '生铁大剑'] }), true);
  // 与武器类型/刻印是「且」关系
  assert.equal(domain.matches(b, { filterEquip: ['生铁大剑'], filterW: [b.wt] }), true);
  assert.equal(domain.matches(b, { filterEquip: ['生铁大剑'], filterW: ['STAFF'] }), false);
});

test('衣服筛选：按 gear.armor 名称匹配', () => {
  const b = makeBuild({ gear: { armor: { name: '黑骑士板甲', kind: '重甲' } } });
  assert.equal(domain.matches(b, { filterArmor: ['黑骑士板甲'] }), true);
  assert.equal(domain.matches(b, { filterArmor: ['白骑士板甲'] }), false);
  assert.equal(domain.matches(b, { filterArmor: ['黑骑士板甲'], filterW: [b.wt] }), true);
  assert.equal(domain.matches(b, { filterArmor: ['黑骑士板甲'], filterW: ['STAFF'] }), false);
});

test('visibleBuilds：人气 / 评分排序 + 过滤（空列表也安全）', () => {
  assert.deepEqual(domain.visibleBuilds([], { sort: 'hot' }), []);

  const hot = domain.visibleBuilds(FIXTURE_BUILDS, { sort: 'hot' });
  assert.equal(hot.length, FIXTURE_BUILDS.length);
  for (let i = 1; i < hot.length; i++) assert.ok(hot[i - 1].votes >= hot[i].votes);

  const rating = domain.visibleBuilds(FIXTURE_BUILDS, { sort: 'rating' });
  for (let i = 1; i < rating.length; i++) assert.ok(rating[i - 1].rating >= rating[i].rating);

  assert.equal(domain.visibleBuilds(FIXTURE_BUILDS, { sort: 'hot', q: '绝对不存在的词' }).length, 0);
});

test('宝藏选项合并流派宝藏、去重并支持名称搜索', () => {
  const builds = [makeBuild({
    treasures: { chaos: ['混沌符文石'], gold: ['闪电增幅装置'] },
    cursed: [{ name: '诅咒的魔晶石' }],
  }), makeBuild()];
  assert.deepEqual(new Set(domain.listTreasures(builds)), new Set(['不融冰', '混沌符文石', '闪电增幅装置', '诅咒的魔晶石']));
  assert.deepEqual(domain.listTreasures(builds, ' 符文 '), ['混沌符文石']);
  assert.deepEqual(domain.listTreasures([]), []);
});

test('宝藏多选命中任意一项，并和武器等其他条件一起生效', () => {
  const build = makeBuild({ treasures: { gold: ['闪电增幅装置'] }, cursed: [{ name: '诅咒的魔晶石' }] });
  assert.equal(domain.matches(build, { filterTreasures: ['其他宝藏', '闪电增幅装置'], filterW: 'SHW' }), true);
  assert.equal(domain.matches(build, { filterTreasures: ['诅咒的魔晶石'], filterW: 'BOW' }), false);
  assert.equal(domain.matches(build, { filterTreasures: ['融冰'] }), false);
  assert.equal(domain.matches(build, { q: '魔晶石' }), true);
});

test('normalizeBuilds：服务端 DTO 归一化（空数据安全）', () => {
  const raw = [{ id: 'x', source: '来源A', updatedAt: '2026-01-01' }];
  const out = domain.normalizeBuilds(raw);
  assert.equal(out[0].src, '来源A');
  assert.equal(out[0].updated, '2026-01-01');

  const demo = domain.normalizeBuilds([{ id: 'y', src: '来源B', updated: '2026-02-02' }]);
  assert.equal(demo[0].src, '来源B');
  assert.equal(demo[0].updated, '2026-02-02');

  assert.deepEqual(domain.normalizeBuilds(null), []);
  assert.deepEqual(domain.normalizeBuilds([]), []);
});
