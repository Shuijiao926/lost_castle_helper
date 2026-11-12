/* 基础设施层单元测试：用假的 Electron / localStorage 环境验证仓储行为 */
const test = require('node:test');
const assert = require('node:assert/strict');

const createRepositories = require('../src/renderer/js/infra/repositories.js');

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _dump: () => Object.fromEntries(map)
  };
}

test('data：浏览器环境返回 null（走内置示例）', async () => {
  const repo = createRepositories({ lc2: undefined, storage: memoryStorage() });
  assert.equal(repo.data.available(), false);
  assert.equal(await repo.data.load(), null);
});

test('data：Electron 环境读取真实数据；空数据归一为 null', async () => {
  const lc2 = {
    getData: async () => ({ builds: [{ id: 'a', source: 's', updatedAt: 't' }] })
  };
  const repo = createRepositories({ lc2, storage: memoryStorage() });
  assert.equal(repo.data.available(), true);
  const data = await repo.data.load();
  assert.equal(data.builds.length, 1);

  const empty = createRepositories({ lc2: { getData: async () => ({ builds: [] }) }, storage: memoryStorage() });
  assert.deepEqual(await empty.data.load(), null);
});

test('notes：localStorage 兜底读写', async () => {
  const storage = memoryStorage();
  const repo = createRepositories({ storage });
  assert.deepEqual(await repo.notes.load(), {});

  const all = { build_1: '续航强' };
  repo.notes.save('build_1', '续航强', all);
  assert.deepEqual(storage._dump(), { 'lc2.notes.v1': JSON.stringify(all) });
  assert.deepEqual(await repo.notes.load(), all);
});

test('notes：Electron 环境走 IPC，且失败不抛错', async () => {
  const calls = [];
  const lc2 = {
    notesGet: async () => ({ a: '印象A' }),
    notesSet: (id, text) => { calls.push([id, text]); return Promise.reject(new Error('ipc down')); }
  };
  const repo = createRepositories({ lc2, storage: memoryStorage() });
  assert.deepEqual(await repo.notes.load(), { a: '印象A' });

  // 覆盖更新语义：同一个 buildId 再写一次，只记录一条
  repo.notes.save('a', '印象A2', { a: '印象A2' });
  assert.deepEqual(calls, [['a', '印象A2']]);
});

test('notes：localStorage 数据损坏时降级为空对象', async () => {
  const storage = memoryStorage();
  storage.setItem('lc2.notes.v1', 'not-json');
  const repo = createRepositories({ storage });
  assert.deepEqual(await repo.notes.load(), {});
});
