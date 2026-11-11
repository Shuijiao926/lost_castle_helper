/**
 * 配置读取：只在这里碰 process.env，其余模块 require('./config')。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const config = {
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 4317),

  /* 数据库：留空 → 降级为 JSON 文件存储（骨架阶段） */
  databaseUrl: process.env.DATABASE_URL || '',

  /* 文件存储：github | local */
  fileStorage: process.env.FILE_STORAGE || 'github',
  github: {
    owner: process.env.GITHUB_OWNER || 'Shuijiao926',
    repo: process.env.GITHUB_REPO || 'lost_castle_helper',
    branch: process.env.GITHUB_BRANCH || 'main',
    token: process.env.GITHUB_TOKEN || '',
  },
  localFileDir: path.join(REPO_ROOT, 'storage'),

  /* 数据目录（种子 + 无数据库时的存储位置） */
  dataDir: path.join(REPO_ROOT, 'data'),

  adminToken: process.env.ADMIN_TOKEN || 'change_me',
};

module.exports = config;
