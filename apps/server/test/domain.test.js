'use strict';

/**
 * 领域层单测（不依赖数据库、网络、HTTP）
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { Build, BuildStatus } = require('../src/modules/builds/domain/build');
const { ValidationError } = require('../src/shared/kernel/errors');
const { CatalogSnapshot } = require('../src/modules/catalog/domain/catalog');
const { DataPackage, PackageAssembler, serializeBuilds } = require('../src/modules/publishing/domain/package');
const { makeCatalog, loadBuilds } = require('../test-support/helpers');

test('Build：载入真实数据并通过校验', () => {
  const catalog = makeCatalog();
  const records = loadBuilds();
  assert.ok(records.length >= 2);

  for (const record of records) {
    const build = Build.fromRecord(record, catalog);
    assert.equal(build.id, record.id);
    assert.equal(build.status, BuildStatus.PUBLISHED);
    assert.equal(build.toCardDTO().name, record.name);
  }
});

test('Build：内部字段（宝藏深度 t）绝不外泄', () => {
  const catalog = makeCatalog();
  const record = loadBuilds()[0];
  const build = Build.fromRecord(record, catalog);

  assert.ok(record.treasureOrder.every((t) => 't' in t), '原始数据应含内部字段');

  const detail = build.toDetailDTO();
  for (const item of detail.treasureOrder) {
    assert.equal('t' in item, false, '详情 DTO 不应含宝藏深度');
  }

  const item = build.toPackageItem();
  for (const t of item.treasureOrder) {
    assert.equal('t' in t, false, '数据包不应含宝藏深度');
  }
});

test('Build：宝藏顺序不允许重复', () => {
  const catalog = makeCatalog();
  const record = JSON.parse(JSON.stringify(loadBuilds()[0]));
  record.treasureOrder = [record.treasureOrder[0], { ...record.treasureOrder[0] }];

  assert.throws(() => Build.fromRecord(record, catalog), ValidationError);
});

test('Build：严格模式下未登记武器类型直接拒绝；宽松模式下只记警告', () => {
  const catalog = makeCatalog();
  const record = JSON.parse(JSON.stringify(loadBuilds()[0]));
  record.wt = 'NOPE';

  assert.throws(() => Build.fromRecord(record, catalog, { strict: true }), ValidationError);

  const lenient = Build.fromRecord(record, catalog, { strict: false });
  assert.ok(lenient.warnings.some((w) => w.includes('未登记')));
});

test('Build：下架状态对外不可见（toRecord 状态可持久化）', () => {
  const catalog = makeCatalog();
  const build = Build.fromRecord(loadBuilds()[0], catalog);
  build.archive();
  assert.equal(build.toRecord().status, BuildStatus.ARCHIVED);
});

test('DataPackage：版本号递增规则', () => {
  assert.equal(DataPackage.nextVersion('1.0.1.3', null), '1.0.1.3-r1');
  assert.equal(DataPackage.nextVersion('1.0.1.3', '1.0.1.3-r2'), '1.0.1.3-r3');
  assert.equal(DataPackage.nextVersion('1.0.1.3', '0.9.0-r41'), '1.0.1.3-r42');
});

test('数据包序列化：流派顺序不影响 hash（保证客户端不会白下载）', () => {
  const catalog = makeCatalog();
  const builds = loadBuilds().map((r) => Build.fromRecord(r, catalog));
  const forward = serializeBuilds(builds);
  const reversed = serializeBuilds([...builds].reverse());
  assert.equal(forward, reversed);
});

test('PackageAssembler：组装出可发布的版本与 hash', async () => {
  const catalog = makeCatalog();
  const builds = loadBuilds().map((r) => Build.fromRecord(r, catalog));

  const saved = [];
  const packageRepository = {
    async latest() { return null; },
    async save(pkg) { saved.push(pkg); },
  };
  const assembler = new PackageAssembler(
    {
      packageRepository,
      hasher: { sha256: (text) => `hash-${text.length}` },
      clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    },
    { fileBaseUrl: 'https://example.com/data' },
  );

  const pkg = await assembler.assemble({ builds, notes: '首次发布' });
  assert.equal(pkg.version, `${builds[0].record.gameVersion}-r1`);
  assert.match(pkg.fileHash, /^hash-\d+$/);
  assert.ok(pkg.size > 100);
  assert.match(pkg.fileUrl, /^https:\/\/example\.com\/data\/builds-.+\.json$/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].publishedAt, '2026-01-01T00:00:00.000Z');
});

test('CatalogSnapshot：重复 id 会被拒绝', () => {
  assert.throws(
    () => new CatalogSnapshot({ weapons: [{ id: 'THW', name: '双手' }, { id: 'THW', name: '重复' }] }),
    ValidationError,
  );
});

test('CatalogSnapshot：按武器类型查刻印', () => {
  const catalog = makeCatalog();
  const shw = catalog.inscriptionsOf('SHW');
  assert.ok(shw.length >= 2);
  assert.ok(shw.some((i) => i.kind === 'hunter'));
});
