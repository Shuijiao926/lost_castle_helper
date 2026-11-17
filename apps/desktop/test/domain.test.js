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
});

test('标签索引从当前流派统计，每个流派的同名标签只计一次', () => {
  const builds = [];
  assert.deepEqual(domain.listTags(builds), []);
  builds.push(makeBuild({ tags: ['冰属性', '盾反', '冰属性'] }), makeBuild({ tags: ['冰属性', ''] }));
  assert.deepEqual(domain.listTags(builds), [['冰属性', 2], ['盾反', 1]]);
});

test('标签搜索忽略首尾空格和大小写', () => {
  const builds = [makeBuild({ tags: ['DOT 流', '火属性'] })];
  assert.deepEqual(domain.listTags(builds, ' dot '), [['DOT 流', 1]]);
});

test('目录查找：武器名 / 刻印名 / 未知兜底', () => {
  assert.equal(domain.weaponName('SHW'), '单手武器');
  assert.equal(domain.weapon('不存在的类型').name, '不存在的类型');
  assert.match(domain.inscriptionName('shw_revenge'), /刻印/);
  assert.equal(domain.inscriptionName('nope'), '—');
});

test('同一件武器合并到一行并保留清单与毕业装里的不同说明', () => {
  const primary = { name: '铁木大剑', atk: '35', type: '双手武器', note: '适合蓄力', obtain: '宝箱' };
  const { weapons } = domain.equipmentForDetail(makeBuild({
    gear: { weapon: primary },
    weaponChoices: [{ name: '铁木大剑', tag: '毕业', note: '优先升级', obtain: '宝箱' }],
  }));
  assert.deepEqual(weapons, [{
    name: '铁木大剑', stages: ['毕业'], types: ['双手武器'],
    notes: ['优先升级', '适合蓄力'], sources: ['宝箱'], primary,
  }]);
});

test('旧流派的核心武器在详情里标为毕业，过渡武器按所属槽位显示', () => {
  const firstChoice = { name: '铁木大剑', tag: '核心' };
  const { weapons } = domain.equipmentForDetail(makeBuild({
    weaponChoices: [firstChoice, { name: '黑铁大剑', tag: '毕业' }],
    transition: [{ name: '生铁大剑', tag: '核心' }],
    gear: { weapon: { name: firstChoice.name } },
  }));
  assert.deepEqual(weapons.map(({ stages }) => stages), [['毕业'], ['毕业'], ['过渡']]);
  assert.equal(firstChoice.tag, '核心');
});

test('旧流派只提供核心武器名单时也显示为毕业', () => {
  const { weapons } = domain.equipmentForDetail(makeBuild({ core: ['铁木大剑'] }));
  assert.deepEqual(weapons.map(({ name, stages }) => [name, stages]), [['铁木大剑', ['毕业']]]);
});

test('未保存类型的武器使用对应图鉴的武器类型', () => {
  const equipmentCatalog = createCatalog();
  equipmentCatalog.loadWeapons([
    { name: '生铁大剑', wt: 'THW' },
    { name: '旧长弓', wt: 'BOW' },
  ]);
  const { weapons } = createDomain(equipmentCatalog).equipmentForDetail(makeBuild({
    wt: 'THW',
    weaponChoices: [{ name: '铁木大剑', tag: '毕业' }],
    gear: { weapon: { name: '铁木大剑', type: '双手武器' } },
    transition: [{ name: '生铁大剑' }, { name: '旧长弓' }],
  }));
  assert.deepEqual(weapons.map(({ types }) => types), [['双手武器'], ['双手武器'], ['弓箭']]);
});

test('只录入过渡衣服时，主装备字段不会把它变成毕业装', () => {
  const { armors } = domain.equipmentForDetail(makeBuild({
    gear: { armor: { name: '朴素的内衬', type: '轻甲' } },
    armorChoices: [{ name: '朴素的内衬', type: '轻甲', tier: '过渡' }],
  }));
  assert.deepEqual(armors.map(({ stages }) => stages), [['过渡']]);
});

test('旧流派只填写毕业装时仍显示在装备清单中', () => {
  const { armors } = domain.equipmentForDetail(makeBuild({
    gear: { armor: { name: '猎手轻甲' } },
  }));
  assert.deepEqual(armors.map(({ name, stages }) => [name, stages]), [['猎手轻甲', ['毕业']]]);
});

test('灵魂石按形状占用槽位，同形状选满后仍可使用其他空槽', () => {
  const stones = ['圆形槽位', '圆形槽位', '圆形槽位'].map((slot, index) => ({ name: '灵魂石' + index, slot }));
  const { groups, extras } = domain.soulLoadout(stones);
  const slots = groups.flat();
  assert.equal(slots.length, 8);
  assert.deepEqual(slots.filter(({ shape }) => shape === 'circle').map(({ stone }) => stone), stones.slice(0, 2));
  assert.ok(slots.some(({ shape, stone }) => shape === 'triangle' && !stone));
  assert.deepEqual(extras, stones.slice(2));
});

test('灵魂石未指定等级时概括已知变化，保留固定距离和各等级原文', () => {
  const detail = domain.soulEffectDetails('Lv.1 3米以内伤害增加1.5% / Lv.2 3米以内伤害增加3.0% / Lv.3 3米以内伤害增加4.5%');
  assert.equal(detail.summary, '3米以内伤害增加1.5–4.5%');
  assert.equal(detail.sampleLevel, null);
  assert.deepEqual(detail.levels[1], { level: 2, text: '3米以内伤害增加3.0%' });
});

test('灵魂石已指定等级时展示该档的图鉴效果', () => {
  const detail = domain.soulEffectDetails('Lv.1 生命值增加1% / Lv.2 生命值增加2.5%', 2);
  assert.equal(detail.summary, '生命值增加2.5%');
});

test('灵魂石只有一档资料时保留已知等级与原文', () => {
  const detail = domain.soulEffectDetails('Lv.1 蓄力值可累积至第三层');
  assert.equal(detail.summary, '蓄力值可累积至第三层');
  assert.equal(detail.sampleLevel, 1);
});

test('梦魇推荐只保存图鉴中可选的档位，并按累计强度求和', () => {
  const nightmareCatalog = createCatalog();
  const { nightmareEffects } = require('../../../data/nightmare-effects.json');
  nightmareCatalog.loadNightmareEffects(nightmareEffects);
  const nightmare = createDomain(nightmareCatalog);
  const picks = nightmare.nightmareList(new Map([
    ['魂晶吞噬', 5],
    ['生命锁定', 12],
    ['法力锁定', 4], // 每档增量不能当作该档累计强度
    ['未知词条', 10],
  ]));
  assert.deepEqual(picks, [
    { n: '生命锁定', p: '锁定 65%', points: 12 },
    { n: '魂晶吞噬', p: '价格 +5%', points: 5 },
  ]);
  assert.equal(nightmare.nightmareTotal(picks), 17);
});

test('梦魇强度每到一个刻度提升一层深度，超过 50 点仍为深度 5', () => {
  assert.equal(domain.nightmareProgress([]).depth, 0);
  for (const [points, depth] of [[9, 0], [10, 1], [20, 2], [30, 3], [40, 4], [49, 4], [50, 5], [52, 5]]) {
    assert.equal(domain.nightmareProgress([{ points }]).depth, depth);
  }
  assert.equal(domain.nightmareProgress([{ points: 52 }]).points, 52);
});

test('历史梦魇方案没有强度字段时依然可展示，也不计算不完整的总强度', () => {
  const legacy = [{ n: '生命锁定', p: '65%' }, { n: '升级锁定' }];
  assert.equal(domain.nightmareProgress(legacy), null);
  assert.deepEqual(domain.normalizeBuilds([makeBuild({ nightmareList: legacy })])[0].nightmareList, legacy);
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

test('visibleBuilds：时间排序由近到远（createdAt 优先，缺时间沉底）', () => {
  const builds = [
    makeBuild({ id: 'old', updatedAt: '2026-11-01' }),
    makeBuild({ id: 'newest', createdAt: '2026-11-25T08:30:00.000Z' }),
    // 更新时间比 newest 还晚，但投稿时间更早：应以 createdAt 为准排第三
    makeBuild({ id: 'mid', createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-28T00:00:00.000Z' }),
    makeBuild({ id: 'none' }),
  ];
  const sorted = domain.visibleBuilds(builds, { sort: 'time' });
  assert.deepEqual(sorted.map((b) => b.id), ['newest', 'mid', 'old', 'none']);
  // 不改原数组
  assert.deepEqual(builds.map((b) => b.id), ['old', 'newest', 'mid', 'none']);
  // 时间戳缺失时给 0，不抛错
  assert.equal(domain.buildTime({}), 0);
  assert.equal(domain.buildTime({ updated: '不是日期' }), 0);
  // 同一时间戳：退回人气高者优先
  const sameDay = [makeBuild({ id: 'low', votes: 10, updatedAt: '2026-11-05' }), makeBuild({ id: 'high', votes: 900, updatedAt: '2026-11-05' })];
  assert.deepEqual(domain.visibleBuilds(sameDay, { sort: 'time' }).map((b) => b.id), ['high', 'low']);
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
