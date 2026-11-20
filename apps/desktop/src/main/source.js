'use strict';

/**
 * 数据来源层
 *
 *   server : 打包后的默认来源。图鉴走 GET /api/catalog（PostgreSQL 里的真实数据），
 *            流派走 GET /data/builds.json（服务端数据包，字段与本地 builds.json 完全一致，
 *            所以详情页不需要按需请求）。两者失败都按「缓存 → 安装包静态数据」降级，断网也能开面板。
 *   local  : 只读安装包 / 仓库 data/，开发与离线验证用。
 *   github : 旧方案（raw.githubusercontent.com），保留作兜底与灰度对比。
 *
 * fetch / fs / electron app / 目录全部可注入，单测不需要联网，也不需要启动 Electron。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { apiBase } = require('./endpoints');
const logger = require('./util/log');

const DEFAULT_REPO = { owner: 'Shuijiao926', repo: 'lost_castle_helper', branch: 'main' };
const FETCH_TIMEOUT = 8000;

/** 图鉴至少要有武器类型；后端返回空集合说明批次异常，应降级而不是显示一张空面板。 */
const MIN_WEAPONS = 1;

function createSource(options = {}) {
  const doFetch = options.fetch || globalThis.fetch;
  const fsp = options.fs || fs;
  const env = options.env || process.env;
  const timeout = options.timeout || FETCH_TIMEOUT;
  const log = options.log || ((...a) => logger.warn('[数据]', ...a));
  const debug = options.debug || ((...a) => logger.debug('[数据]', ...a));

  // 只有真正跑在 Electron 里才需要 app；测试注入 baseDir / cacheDirPath 后完全不碰它。
  const electronApp = options.app || (options.baseDir ? null : require('electron').app);
  const isPackaged = options.isPackaged !== undefined
    ? options.isPackaged
    : Boolean(electronApp && electronApp.isPackaged);

  function dataDir() {
    if (options.baseDir) return options.baseDir;
    return isPackaged
      ? path.join(electronApp.resourcesPath, 'data')
      : path.join(__dirname, '..', '..', '..', '..', 'data');
  }

  function cacheDir() {
    if (options.cacheDirPath) return options.cacheDirPath;
    // 拉取到的数据缓存在这里；LC2_CACHE_DIR 可改到自定义目录（如测试/多实例）
    const override = env.LC2_CACHE_DIR;
    return override ? path.resolve(override) : path.join(electronApp.getPath('userData'), 'data-cache');
  }

  function readLocalJSON(name, fallback) {
    try { return JSON.parse(fsp.readFileSync(path.join(dataDir(), name), 'utf8')); }
    catch (e) { log(`local ${name} failed:`, e.message); return fallback; }
  }

  function githubBase(repo) {
    const { owner, repo: r, branch } = { ...DEFAULT_REPO, ...(repo || {}) };
    return `https://raw.githubusercontent.com/${owner}/${r}/${branch}/data`;
  }

  /** 服务端数据包目录；LC2_DATA_URL 可整体接管（镜像 / 本地静态目录）。 */
  function packageBase() {
    const custom = env.LC2_DATA_URL;
    if (custom) return custom.replace(/\/+$/, '');
    return `${apiBase(env)}/data`;
  }

  async function request(url, asText) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await doFetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'lc2-helper', Accept: asText ? '*/*' : 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asText ? await res.text() : await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function sha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  /* ------------------------------ 流派数据包 ------------------------------ */

  function readCache() {
    try {
      return JSON.parse(fsp.readFileSync(path.join(cacheDir(), 'builds.json'), 'utf8'));
    } catch { return null; }
  }

  function writeCache(obj) {
    try {
      fsp.mkdirSync(cacheDir(), { recursive: true });
      fsp.writeFileSync(path.join(cacheDir(), 'builds.json'), JSON.stringify(obj), 'utf8');
    } catch (e) { log('write cache failed:', e.message); }
  }

  /**
   * 从数据包目录拉流派。
   * 有 package.json 就按版本 + hash 判断是否要重新下载；没有就直接下 builds.json。
   */
  async function fetchPackage(base) {
    let meta = null;
    try { meta = await request(`${base}/package.json`, false); } catch { /* 还没发布过数据包 */ }

    if (meta && meta.fileHash) {
      const cached = readCache();
      if (cached && cached.__hash === meta.fileHash && cached.__version === meta.version) {
        debug('package unchanged ->', meta.version);
        return cached.data;
      }
      const text = await request(meta.fileUrl || `${base}/builds.json`, true);
      const hash = sha256(text);
      if (hash !== meta.fileHash) log('hash mismatch, use downloaded anyway');
      const data = JSON.parse(text);
      writeCache({ __hash: hash, __version: meta.version, data });
      debug('package updated ->', meta.version);
      return data;
    }

    const data = await request(`${base}/builds.json`, false);
    writeCache({ __hash: sha256(JSON.stringify(data)), __version: 'unknown', data });
    debug('package fetched（无 package.json，直接拉 builds.json）');
    return data;
  }

  function localBuilds() {
    const previewName = 'builds.local.json';
    if (!isPackaged && fsp.existsSync(path.join(dataDir(), previewName))) {
      const preview = readLocalJSON(previewName, null);
      if (Array.isArray(preview && preview.builds)) return { source: 'local', file: preview };
      log(`preview ${previewName} invalid, use local seed`);
    }
    const file = readLocalJSON('builds.json', null);
    return { source: 'local', file: file || { builds: [] } };
  }

  /** 远端失败时按「缓存 → 安装包」降级，绝不因为网络问题白屏。 */
  async function withFallback(load, label) {
    try {
      const data = await load();
      if (data && Array.isArray(data.builds)) return { source: label, file: data };
      log(`${label} 返回的不是流派包，降级`);
    } catch (e) {
      log(`${label} failed, fallback to cache:`, e.message);
    }

    const cached = readCache();
    if (cached && cached.data && Array.isArray(cached.data.builds)) {
      return { source: 'cache', file: cached.data };
    }

    return localBuilds();
  }

  /**
   * 统一入口
   * @param {{source?: 'server'|'local'|'github', repo?: object}} opts
   */
  async function loadBuilds(opts = {}) {
    const source = opts.source || 'server';
    if (source === 'local') return localBuilds();
    if (source === 'github') return withFallback(() => fetchPackage(githubBase(opts.repo)), 'github');
    return withFallback(() => fetchPackage(packageBase()), 'server');
  }

  /* -------------------------------- 图鉴 -------------------------------- */

  function localStatic() {
    return {
      weapons: readLocalJSON('weapons.json', { weapons: [] }).weapons || [],
      weaponItems: readLocalJSON('weapons.json', { items: [] }).items || [],
      armors: readLocalJSON('armors.json', { armors: [] }).armors || [],
      soulStones: readLocalJSON('soul-stones.json', { soulStones: [] }).soulStones || [],
      cursedTreasures: readLocalJSON('cursed-treasures.json', { cursedTreasures: [] }).cursedTreasures || [],
      nightmareEffects: readLocalJSON('nightmare-effects.json', { nightmareEffects: [] }).nightmareEffects || [],
      inscriptions: readLocalJSON('inscriptions.json', { inscriptions: [] }).inscriptions || [],
      schools: readLocalJSON('schools.json', { schools: [] }).schools || [],
      treasures: readLocalJSON('treasures.json', { treasures: [] }).treasures || [],
    };
  }

  function readStaticCache() {
    try {
      const cached = JSON.parse(fsp.readFileSync(path.join(cacheDir(), 'catalog.json'), 'utf8'));
      const statics = cached && cached.statics;
      return statics && Array.isArray(statics.weapons) && statics.weapons.length >= MIN_WEAPONS
        ? statics : null;
    } catch { return null; }
  }

  function writeStaticCache(statics, version) {
    try {
      fsp.mkdirSync(cacheDir(), { recursive: true });
      fsp.writeFileSync(path.join(cacheDir(), 'catalog.json'),
        JSON.stringify({ version: version || 'unknown', statics }), 'utf8');
    } catch (e) { log('write catalog cache failed:', e.message); }
  }

  /** 服务端 /api/catalog 的九类集合键与本地静态 JSON 完全同名，只做取值与校验。 */
  function projectCatalog(catalog) {
    if (!catalog || !Array.isArray(catalog.weapons) || catalog.weapons.length < MIN_WEAPONS) return null;
    const pick = (key) => (Array.isArray(catalog[key]) ? catalog[key] : []);
    return {
      weapons: pick('weapons'),
      weaponItems: pick('weaponItems'),
      armors: pick('armors'),
      soulStones: pick('soulStones'),
      cursedTreasures: pick('cursedTreasures'),
      nightmareEffects: pick('nightmareEffects'),
      inscriptions: pick('inscriptions'),
      schools: pick('schools'),
      treasures: pick('treasures'),
    };
  }

  /** 武器 / 刻印 / 流派标签：优先服务端图鉴，失败按「缓存 → 安装包」降级。 */
  async function loadStatic() {
    try {
      const payload = await request(`${apiBase(env)}/api/catalog`, false);
      const statics = projectCatalog(payload && payload.catalog);
      if (statics) {
        writeStaticCache(statics, payload.catalog.version);
        return statics;
      }
      log('catalog 内容不完整，降级');
    } catch (e) {
      log('catalog api failed, fallback to cache:', e.message);
    }

    return readStaticCache() || localStatic();
  }

  return { loadBuilds, loadStatic, dataDir, cacheDir, localStatic };
}

/* 默认实例延迟创建：测试只调 createSource，不会在 Node 环境触碰 electron。 */
let instance = null;
function defaults() {
  if (!instance) instance = createSource();
  return instance;
}

module.exports = {
  createSource,
  loadBuilds: (opts) => defaults().loadBuilds(opts),
  loadStatic: () => defaults().loadStatic(),
  dataDir: () => defaults().dataDir(),
  cacheDir: () => defaults().cacheDir(),
};
