'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { importBuilds } = require('../src/modules/builds/application/import-builds');
const { importInscriptions } = require('../src/modules/catalog/application/import-inscriptions');
const { createHuijiWikiInscriptions } = require('../src/modules/catalog/infrastructure/huiji-wiki-inscriptions');
const { CatalogSnapshot } = require('../src/modules/catalog/domain/catalog');

const file = require('../../../data/inscriptions.json');
const snapshot = require('../../../data/sources/huiji-staff-inscriptions.json');
const catalogRepository = {
  load: async () => new CatalogSnapshot({ ...file, ...require('../../../data/weapons.json') }),
};
const records = require('./fixtures/builds.json');

test('授权流派导入使用作者署名，输出剥离内部宝藏深度', async () => {
  const meta = { author: '投稿作者', source: 'https://example.test/build', licenseAccepted: true };
  const result = await importBuilds({
    sourceType: 'authorized-submission',
    file: { ...records, builds: [{ payload: records.builds[0], meta }] },
    catalogRepository,
  });
  const [build] = result.builds;
  assert.equal(build.author, meta.author);
  assert.equal(build.source, meta.source);
  assert.equal(build.sourceType, 'authorized-submission');
  assert.equal(build.license, 'CC-BY-NC-SA-4.0');
  assert.ok(build.treasureOrder.length);
  assert.ok(build.treasureOrder.every((item) => !Object.hasOwn(item, 't')));
});

test('流派导入拒绝未授权的作者投稿', async () => {
  await assert.rejects(importBuilds({
    sourceType: 'authorized-submission',
    file: { ...records, builds: [{ payload: records.builds[0], meta: { licenseAccepted: false } }] },
    catalogRepository,
  }), (error) => error.errors?.some((message) => message.includes('作者授权')));
});

test('流派导入拒绝把 Wiki 图鉴当成流派', async () => {
  await assert.rejects(importBuilds({ sourceType: 'wiki', file: records, catalogRepository }),
    (error) => error.errors?.some((message) => message.includes('不支持')));
});

test('离线 Wiki 来源可重现已纳入目录的法杖刻印署名', async () => {
  const source = createHuijiWikiInscriptions({ snapshot });
  assert.deepEqual(await importInscriptions({ source, file, weaponType: 'STAFF' }), file);
});

test('按灰机真实响应格式导入 Lua 生成的刻印链接并附修订链接', async () => {
  const revid = 129625;
  const calls = [];
  const page = { title: '法杖', pageid: 2571, revid };
  const replies = [
    { ...page, sections: [{ line: '灵魂刻印', index: '1' }] },
    { ...page, links: [
      { ns: 0, title: '宝藏猎人刻印', exists: true },
      { ns: 0, title: '奥术大师刻印', exists: true },
      { ns: 0, title: '空灵法师刻印', exists: true },
    ] },
  ];
  const source = createHuijiWikiInscriptions({ fetchImpl: async (url) => {
    calls.push(url.searchParams);
    return { ok: true, json: async () => ({ parse: replies.shift() }) };
  } });
  const result = await importInscriptions({ source, file, weaponType: 'STAFF' });
  assert.equal(calls[1].get('prop'), 'links|revid');
  assert.equal(calls[1].get('oldid'), String(revid));
  assert.equal(calls[1].get('section'), '1');
  assert.deepEqual(result.inscriptions.filter((item) => item.wt !== 'STAFF'), file.inscriptions.filter((item) => item.wt !== 'STAFF'));
  assert.equal(result.inscriptions.find((item) => item.id === 'staff_arcane').source.url, `https://lc2.huijiwiki.com/index.php?oldid=${revid}`);
});

test('在线 Wiki 处理器按修订读取章节，缺少刻印时停止导入', async () => {
  const replies = [
    { sections: [{ line: '灵魂刻印', index: '1' }], revid: 123 },
    { revid: 123, links: [{ ns: 0, title: '奥术大师刻印', exists: true }] },
  ];
  const source = createHuijiWikiInscriptions({ fetchImpl: async () => ({ ok: true, json: async () => ({ parse: replies.shift() }) }) });
  await assert.rejects(importInscriptions({ source, file, weaponType: 'STAFF' }),
    (error) => error.errors?.some((message) => message.includes('刻印名称')));
});
