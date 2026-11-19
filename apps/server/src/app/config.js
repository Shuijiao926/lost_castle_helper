'use strict';

/**
 * 配置中心：唯一读取 process.env 的地方
 *
 * 纪律：业务代码不直接读环境变量，一律从这里取；
 * 默认值只在这里出现一次，避免散落在各处硬编码。
 */

const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SERVER_DIR = path.join(__dirname, '..', '..');

function str(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function list(name, fallback = []) {
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

const dataDir = path.resolve(str('DATA_DIR', path.join(REPO_ROOT, 'data')));

/** 连接串统一从环境变量或密钥文件读取，异常不包含实际凭据。 */
function databaseConnection(name) {
  const file = str(name + '_FILE', '');
  const value = str(name, '');
  if (file && value) throw new Error(name + ' 与 ' + name + '_FILE 只能设置一项');
  const url = file ? fs.readFileSync(file, 'utf8').trim() : value;
  if (file && !url) throw new Error(name + ' 连接串文件为空');
  if (url && !/^postgres(?:ql)?:\/\//.test(url)) throw new Error(name + ' 必须使用 PostgreSQL 协议');
  return url;
}
const databaseUrl = databaseConnection('DATABASE_URL');
const ratingsDatabaseUrl = databaseConnection('RATINGS_DATABASE_URL');
if (ratingsDatabaseUrl && !databaseUrl) throw new Error('评分写入连接需要同时配置只读数据库连接');
const adminTokenFile = str('ADMIN_TOKEN_FILE', '');
if (adminTokenFile && str('ADMIN_TOKEN', '')) throw new Error('ADMIN_TOKEN 与 ADMIN_TOKEN_FILE 只能设置一项');
const adminToken = adminTokenFile ? fs.readFileSync(adminTokenFile, 'utf8').trim() : str('ADMIN_TOKEN', 'change_me');
if (adminTokenFile && !adminToken) throw new Error('管理令牌文件为空');

const config = {
  env: str('NODE_ENV', 'development'),
  host: str('HOST', '127.0.0.1'),
  port: int('PORT', 4317),
  logLevel: str('LOG_LEVEL', 'info'),

  dataDir,
  runtimeDir: path.resolve(str('RUNTIME_DIR', path.join(dataDir, 'runtime'))),

  /** 游戏数据和评分汇总共用只读账号，评分写入使用独立的最小权限账号。 */
  databaseUrl,
  ratingsDatabaseUrl,

  /** HTTP 协议层 */
  api: {
    /** 请求体上限（JSON）与上传上限（截图） */
    maxBodyBytes: int('MAX_BODY_BYTES', 1024 * 1024),
    maxUploadBytes: int('MAX_UPLOAD_BYTES', 8 * 1024 * 1024),
    prefix: str('API_PREFIX', '/api'),
    adminHeader: str('ADMIN_HEADER', 'x-admin-token'),
  },

  cors: {
    /** 为空表示允许所有来源（本地开发）；生产建议填白名单 */
    origins: list('CORS_ORIGINS', []), credentials: false, maxAge: int('CORS_MAX_AGE', 86400),
  },

  /** 安全管控（见 modules/security） */
  security: {
    adminToken, rateLimits: {
      /** 评分：同指纹窗口内最多几次 */
      rating: {
        limit: int('RATING_RATE_LIMIT', 20), windowMs: int('RATING_RATE_WINDOW_MS', 60_000),
      }, /** 投稿：门槛更高（人工审核成本高） */
      submission: {
        limit: int('SUBMISSION_RATE_LIMIT', 5), windowMs: int('SUBMISSION_RATE_WINDOW_MS', 600_000),
      },
    }, /** 限流计数持久化文件（放 runtime，重启不清零） */
    storeFile: str('SECURITY_STORE_FILE', 'security-limits.json'),
  },

  /** 数据文件名集中管理，避免散落硬编码 */
  dataFiles: {
    builds: 'builds.json',
    weapons: 'weapons.json',
    inscriptions: 'inscriptions.json',
    schools: 'schools.json',
    catalogDir: 'catalog',
    treasures: 'treasures.json',
    runtimeCounter: 'counter.json',
    runtimeRatings: 'ratings.json',
    runtimePackage: 'package.json',
    runtimePackagesDir: 'packages',
    runtimeSubmissionsDir: 'submissions',
  },

  /** 数据包发布 */
  publishing: {
    fileBaseUrl: str('FILE_BASE_URL', ''), filePrefix: str('PACKAGE_FILE_PREFIX', 'builds'),
  },

  /** 目录信息（启动日志用） */
  serverDir: SERVER_DIR,
  repoRoot: REPO_ROOT,
};

module.exports = config;
