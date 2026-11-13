/**
 * 数据来源层
 *
 *   local  : 读仓库 data/（开发 / 离线）
 *   github : 从 GitHub raw 拉数据包，本地缓存 + hash 校验（当前线上方案）
 *
 * 文件存储暂由 GitHub 承担：图标与 data/*.json 都在数据仓库里，
 * 后续接自建后端时只需改这个文件（把 base url 换成 API）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const DEFAULT_REPO = { owner: 'Shuijiao926', repo: 'lost_castle_helper', branch: 'main' };
const FETCH_TIMEOUT = 8000;

function log(...a) { console.log('[lc2:data]', ...a); }

function dataDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'data')
    : path.join(__dirname, '..', '..', '..', '..', 'data');
}
function cacheDir() {
  // 拉取到的数据缓存在这里；LC2_CACHE_DIR 可改到自定义目录（如测试/多实例）
  const override = process.env.LC2_CACHE_DIR;
  return override ? path.resolve(override) : path.join(app.getPath('userData'), 'data-cache');
}

function readLocalJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir(), name), 'utf8')); }
  catch (e) { log(`local ${name} failed:`, e.message); return fallback; }
}

function rawBase(repo) {
  // LC2_DATA_URL 可覆盖数据源地址（自建服务 / 镜像 / 本地静态目录）
  const custom = process.env.LC2_DATA_URL;
  if (custom) return custom.replace(/\/+$/, '');
  const { owner, repo: r, branch } = { ...DEFAULT_REPO, ...(repo || {}) };
  return `https://raw.githubusercontent.com/${owner}/${r}/${branch}/data`;
}

async function fetchJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'lc2-helper' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'lc2-helper' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

/** 读取本地缓存（上次成功拉取的数据） */
function readCache() {
  try {
    const p = path.join(cacheDir(), 'builds.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

function writeCache(obj) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(path.join(cacheDir(), 'builds.json'), JSON.stringify(obj), 'utf8');
  } catch (e) { log('write cache failed:', e.message); }
}

/**
 * 从 GitHub 拉数据。
 * 有 data/package.json 就按版本 + hash 判断要不要下载；没有就直接下 builds.json。
 * @returns {Promise<object|null>}
 */
async function fetchRemote(repo) {
  const base = rawBase(repo);
  let meta = null;
  try { meta = await fetchJSON(`${base}/package.json`); } catch { /* 还没发布过数据包 */ }

  if (meta && meta.fileHash) {
    const cached = readCache();
    if (cached && cached.__hash === meta.fileHash && cached.__version === meta.version) {
      log('remote unchanged ->', meta.version);
      return cached.data;
    }
    const text = await fetchText(meta.fileUrl || `${base}/builds.json`);
    const hash = sha256(text);
    if (hash !== meta.fileHash) log('hash mismatch, use downloaded anyway');
    const data = JSON.parse(text);
    writeCache({ __hash: hash, __version: meta.version, data });
    log('remote updated ->', meta.version);
    return data;
  }

  const data = await fetchJSON(`${base}/builds.json`);
  writeCache({ __hash: sha256(JSON.stringify(data)), __version: 'unknown', data });
  log('remote fetched（无 package.json，直接拉 builds.json）');
  return data;
}

/**
 * 统一入口
 * @param {{source?: 'local'|'github', repo?: object}} opts
 */
async function loadBuilds(opts = {}) {
  const source = opts.source || 'github';

  if (source === 'local') {
    const file = readLocalJSON('builds.json', null);
    return { source: 'local', file: file || { builds: [] } };
  }

  try {
    const data = await fetchRemote(opts.repo);
    if (data && Array.isArray(data.builds)) return { source: 'github', file: data };
  } catch (e) {
    log('remote failed, fallback to local:', e.message);
  }

  const cached = readCache();
  if (cached && cached.data && Array.isArray(cached.data.builds)) {
    return { source: 'cache', file: cached.data };
  }

  const file = readLocalJSON('builds.json', { builds: [] });
  return { source: 'local', file };
}

/** 武器 / 刻印 / 流派标签：体积小、变动少，先用本地 */
function loadStatic() {
  return {
    weapons: readLocalJSON('weapons.json', { weapons: [] }).weapons || [],
    weaponItems: readLocalJSON('weapons.json', { items: [] }).items || [],
    armors: readLocalJSON('armors.json', { armors: [] }).armors || [],
    soulStones: readLocalJSON('soul-stones.json', { soulStones: [] }).soulStones || [],
    cursedTreasures: readLocalJSON('cursed-treasures.json', { cursedTreasures: [] }).cursedTreasures || [],
    inscriptions: readLocalJSON('inscriptions.json', { inscriptions: [] }).inscriptions || [],
    schools: readLocalJSON('schools.json', { schools: [] }).schools || [],
    treasures: readLocalJSON('treasures.json', { treasures: [] }).treasures || [],
  };
}

module.exports = { loadBuilds, loadStatic, dataDir, cacheDir };
