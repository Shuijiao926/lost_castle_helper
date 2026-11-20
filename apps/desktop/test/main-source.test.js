/* 数据来源层测试：服务端优先、失败按缓存 → 安装包降级，全程不联网 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createSource } = require('../src/main/source');

const BASE = 'https://example.test';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 造一份安装包内的静态数据：武器 1 个、流派 1 条，便于区分「来自服务端」和「来自本地」。 */
function seedLocalDir() {
  const dir = tmpDir('lc2-local-');
  fs.writeFileSync(path.join(dir, 'weapons.json'), JSON.stringify({ weapons: [{ id: 'sword', name: '本地剑' }], items: [] }));
  fs.writeFileSync(path.join(dir, 'builds.json'), JSON.stringify({ builds: [{ id: 'local-build', name: '本地流派' }] }));
  return dir;
}

function makeSource(overrides = {}) {
  const localDir = overrides.localDir || seedLocalDir();
  const cacheDirPath = overrides.cacheDirPath || tmpDir('lc2-cache-');
  return createSource({
    baseDir: localDir,
    cacheDirPath,
    isPackaged: true,
    env: { LC2_API_URL: BASE },
    fetch: overrides.fetch,
    log: () => {},
    debug: () => {},
    timeout: 200,
  });
}

/** 按 URL 返回预置响应；没配到的 URL 直接抛错，模拟断网。 */
function routeFetch(routes) {
  return async (url) => {
    const body = routes[url];
    if (body === undefined) throw new Error('network offline');
    if (body === 'http-500') return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
}

const catalogPayload = {
  catalog: {
    version: 'v-1',
    weapons: [{ id: 'sword', name: '服务端剑' }],
    inscriptions: [{ id: 'ins-1', name: '刻印' }],
    schools: [{ id: 'school-1', name: '流派标签' }],
    treasures: [],
  },
};

/* ---------------- 图鉴 ---------------- */

test('图鉴：/api/catalog 正常时用服务端数据，并写入缓存', async () => {
  const cacheDirPath = tmpDir('lc2-cache-');
  const source = makeSource({
    cacheDirPath,
    fetch: routeFetch({ [`${BASE}/api/catalog`]: catalogPayload }),
  });

  const statics = await source.loadStatic();
  assert.equal(statics.weapons[0].name, '服务端剑');
  assert.equal(statics.inscriptions.length, 1);
  // 响应里没有的集合补空数组，界面不用再判 undefined
  assert.deepEqual(statics.armors, []);

  const cached = JSON.parse(fs.readFileSync(path.join(cacheDirPath, 'catalog.json'), 'utf8'));
  assert.equal(cached.version, 'v-1');
  assert.equal(cached.statics.weapons[0].name, '服务端剑');
});

test('图鉴：接口失败时回落安装包内的静态数据', async () => {
  const source = makeSource({ fetch: routeFetch({}) });
  const statics = await source.loadStatic();
  assert.equal(statics.weapons[0].name, '本地剑');
});

test('图鉴：接口返回空武器列表时视为异常，不显示空面板', async () => {
  const source = makeSource({
    fetch: routeFetch({ [`${BASE}/api/catalog`]: { catalog: { version: 'v-0', weapons: [] } } }),
  });
  const statics = await source.loadStatic();
  assert.equal(statics.weapons[0].name, '本地剑');
});

test('图鉴：接口失败但上次缓存过，用缓存而不是安装包', async () => {
  const cacheDirPath = tmpDir('lc2-cache-');
  fs.writeFileSync(
    path.join(cacheDirPath, 'catalog.json'),
    JSON.stringify({ version: 'v-cached', statics: { weapons: [{ id: 'cached', name: '缓存剑' }] } })
  );
  const source = makeSource({ cacheDirPath, fetch: routeFetch({}) });
  const statics = await source.loadStatic();
  assert.equal(statics.weapons[0].name, '缓存剑');
});

/* ---------------- 流派 ---------------- */

test('流派：默认走服务端数据包，成功时标记来源 server', async () => {
  const source = makeSource({
    fetch: routeFetch({ [`${BASE}/data/builds.json`]: { builds: [{ id: 'remote-1', name: '远端流派' }] } }),
  });
  const loaded = await source.loadBuilds({ source: 'server' });
  assert.equal(loaded.source, 'server');
  assert.equal(loaded.file.builds[0].id, 'remote-1');
});

test('流派：服务端失败时用上次缓存，来源标 cache', async () => {
  const cacheDirPath = tmpDir('lc2-cache-');
  fs.writeFileSync(
    path.join(cacheDirPath, 'builds.json'),
    JSON.stringify({ __hash: 'h', __version: 'v', data: { builds: [{ id: 'cached-1', name: '缓存流派' }] } })
  );
  const source = makeSource({ cacheDirPath, fetch: routeFetch({}) });
  const loaded = await source.loadBuilds({ source: 'server' });
  assert.equal(loaded.source, 'cache');
  assert.equal(loaded.file.builds[0].id, 'cached-1');
});

test('流派：没有缓存也没有网络时回落安装包内 builds.json', async () => {
  const source = makeSource({ fetch: routeFetch({}) });
  const loaded = await source.loadBuilds({ source: 'server' });
  assert.equal(loaded.source, 'local');
  assert.equal(loaded.file.builds[0].id, 'local-build');
});

test('流派：数据包带 package.json 时按 hash 命中缓存，不再重复下载', async () => {
  const cacheDirPath = tmpDir('lc2-cache-');
  const payload = { builds: [{ id: 'pkg-1', name: '包流派' }] };
  fs.writeFileSync(
    path.join(cacheDirPath, 'builds.json'),
    JSON.stringify({ __hash: 'fixed-hash', __version: 'pkg-1', data: payload })
  );
  const source = makeSource({
    cacheDirPath,
    fetch: routeFetch({
      [`${BASE}/data/package.json`]: { version: 'pkg-1', fileHash: 'fixed-hash' },
      [`${BASE}/data/builds.json`]: { builds: [{ id: 'should-not-fetch' }] },
    }),
  });
  const loaded = await source.loadBuilds({ source: 'server' });
  assert.equal(loaded.source, 'server');
  assert.equal(loaded.file.builds[0].id, 'pkg-1');
});

test('流派：local 源完全不发网络请求', async () => {
  let called = 0;
  const source = makeSource({
    fetch: async () => { called += 1; throw new Error('should not fetch'); },
  });
  const loaded = await source.loadBuilds({ source: 'local' });
  assert.equal(called, 0);
  assert.equal(loaded.source, 'local');
});

/* ---------------- 打包路径（安装包内 resources/data） ---------------- */

test('打包路径：静态数据从 resources/data 读，断网也能开面板', async () => {
  const resourcesPath = tmpDir('lc2-res-');
  const packagedData = path.join(resourcesPath, 'data');
  fs.mkdirSync(packagedData, { recursive: true });
  fs.writeFileSync(path.join(packagedData, 'weapons.json'),
    JSON.stringify({ weapons: [{ id: 'w', name: '包内剑' }] }));
  fs.writeFileSync(path.join(packagedData, 'builds.json'),
    JSON.stringify({ builds: [{ id: 'in-package' }] }));

  const source = createSource({
    resourcesPath,
    cacheDirPath: tmpDir('lc2-cache-'),
    isPackaged: true,
    env: {},
    fetch: async () => { throw new Error('offline'); },
    log: () => {},
    debug: () => {},
    timeout: 100,
  });

  assert.equal(source.dataDir(), packagedData);
  const statics = await source.loadStatic();
  assert.equal(statics.weapons[0].name, '包内剑');
  const loaded = await source.loadBuilds({ source: 'local' });
  assert.equal(loaded.file.builds[0].id, 'in-package');
});

test('打包路径：拿不到 resourcesPath 时抛可读错误，而不是拿 undefined 拼路径', () => {
  // 回归：曾经写成 app.resourcesPath（app 上没有这个属性），启动即崩。
  const fakeApp = { isPackaged: true, getPath: () => tmpDir('lc2-ud-') };
  const source = createSource({
    app: fakeApp,
    cacheDirPath: tmpDir('lc2-cache-'),
    env: {},
    log: () => {},
    debug: () => {},
  });
  assert.throws(() => source.dataDir(), /resourcesPath/);
});
