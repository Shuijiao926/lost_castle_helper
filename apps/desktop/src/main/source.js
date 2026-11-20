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
/** 图鉴接口是 600KB 级的大包，链路拥塞时 8s 不够，单独放宽。 */
const CATALOG_TIMEOUT = 15000;

/* 瞬时网络错误才值得重试。
   实测国内到这台服务器的 TLS 握手有约 20%~50% 被中途重置（TCP 层正常，
   服务器本机自测 100% 正常，属于链路干扰），重试 3 次后失败率降到 1% 以下。 */
const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF = 400;
const RETRY_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE',
  'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT',
]);

/** 图鉴至少要有武器类型；后端返回空集合说明批次异常，应降级而不是显示一张空面板。 */
const MIN_WEAPONS = 1;

function createSource(options = {}) {
  const doFetch = options.fetch || globalThis.fetch;
  const fsp = options.fs || fs;
  const env = options.env || process.env;
  const timeout = options.timeout || FETCH_TIMEOUT;
  const log = options.log || ((...a) => logger.warn('[数据]', ...a));
  const debug = options.debug || ((...a) => logger.debug('[数据]', ...a));
  /** 重试间隔可注入，单测里换成同步实现就不会真的等。 */
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = options.attempts || RETRY_ATTEMPTS;
  const catalogTimeout = options.catalogTimeout || CATALOG_TIMEOUT;

  // 只有真正跑在 Electron 里才需要 app；测试注入 baseDir / cacheDirPath 后完全不碰它。
  const injectedPath = options.baseDir || options.cacheDirPath;
  const electronApp = options.app || (injectedPath ? null : require('electron').app);
  const isPackaged = options.isPackaged !== undefined
    ? options.isPackaged
    : Boolean(electronApp && electronApp.isPackaged);

  /**
   * 打包后静态数据在 resources/data。
   * 注意是 `process.resourcesPath`（Electron 注入到进程上的），不是 app.resourcesPath ——
   * app 上没有这个属性，写成 app.resourcesPath 会得到 undefined，然后在 path.join 里炸掉。
   */
  function resourcesPath() {
    if (options.resourcesPath) return options.resourcesPath;
    if (process.resourcesPath) return process.resourcesPath;
    throw new Error('缺少 resourcesPath：打包环境应能从 process.resourcesPath 取得');
  }

  function dataDir() {
    if (options.baseDir) return options.baseDir;
    return isPackaged
      ? path.join(resourcesPath(), 'data')
      : path.join(__dirname, '..', '..', '..', '..', 'data');
  }

  function cacheDir() {
    if (options.cacheDirPath) return options.cacheDirPath;
    // 拉取到的数据缓存在这里；LC2_CACHE_DIR 可改到自定义目录（如测试/多实例）
    const override = env.LC2_CACHE_DIR;
    if (override) return path.resolve(override);
    if (!electronApp) throw new Error('缺少 app 或 cacheDirPath，无法确定缓存目录');
    return path.join(electronApp.getPath('userData'), 'data-cache');
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

  async function requestOnce(url, asText, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || timeout);
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

  /** HTTP 4xx/5xx 是服务端明确答复，重试没有意义；只重试链路抖动。 */
  function isRetryable(e) {
    if (!e) return false;
    if (e.name === 'AbortError') return true; // 超时同样算瞬时问题
    if (/^HTTP \d+$/.test(String(e.message || ''))) return false;
    if (e.code && RETRY_CODES.has(e.code)) return true;
    if (e.cause && e.cause.code && RETRY_CODES.has(e.cause.code)) return true;
    return /fetch failed|socket hang up|ECONNRESET|other side closed|network/i.test(String(e.message || ''));
  }

  async function request(url, asText, opts = {}) {
    const tries = opts.attempts || attempts;
    let lastErr;
    for (let i = 0; i < tries; i += 1) {
      try {
        return await requestOnce(url, asText, opts.timeout);
      } catch (e) {
        lastErr = e;
        if (i === tries - 1 || !isRetryable(e)) throw e;
        log(`请求失败，第 ${i + 1} 次重试：${url}（${e.message}）`);
        await sleep(opts.backoff || RETRY_BACKOFF * (i + 1));
      }
    }
    throw lastErr;
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
      const payload = await request(`${apiBase(env)}/api/catalog`, false, { timeout: catalogTimeout });
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
