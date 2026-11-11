/**
 * 无数据库时的存储实现（骨架阶段默认走这里）
 * —— 直接读写仓库 data/*.json，和客户端内置数据同构，方便对照调试。
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const DATA_DIR = config.dataDir;
const SUBS_DIR = path.join(DATA_DIR, 'submissions');

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return fallback; }
}

/** 原子写：临时文件 + rename */
function write(file, data) {
  const target = path.join(DATA_DIR, file);
  ensureDir(path.dirname(target));
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

/* ---------- 流派 ---------- */
const getBuildsFile = () => read('builds.json', { version: '0', gameVersion: '—', builds: [] });
const saveBuildsFile = (data) => write('builds.json', data);

/* ---------- 评分 ---------- */
const RATINGS = 'ratings.json';
const getRatings = () => read(RATINGS, { version: 1, ratings: [] });

function addRating(buildId, score, voterKey) {
  const db = getRatings();
  db.ratings = db.ratings.filter((r) => !(r.buildId === buildId && r.voter === voterKey));
  db.ratings.push({ buildId, score, voter: voterKey, at: new Date().toISOString() });
  write(RATINGS, db);

  const mine = db.ratings.filter((r) => r.buildId === buildId);
  const avg = mine.reduce((s, r) => s + r.score, 0) / (mine.length || 1);
  return { id: buildId, avg: Number(avg.toFixed(2)), votes: mine.length };
}

function mergeRatings(file) {
  const db = getRatings();
  const by = new Map();
  for (const r of db.ratings) {
    if (!by.has(r.buildId)) by.set(r.buildId, []);
    by.get(r.buildId).push(r.score);
  }
  return {
    ...file,
    builds: (file.builds || []).map((b) => {
      const scores = by.get(b.id) || [];
      if (!scores.length) return b;
      const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
      return { ...b, rating: Number(avg.toFixed(2)), votes: scores.length };
    }),
  };
}

/* ---------- 投稿 ---------- */
function saveSubmission(build, meta) {
  ensureDir(SUBS_DIR);
  const id = build.id || 'submission_' + Date.now();
  const file = path.join(SUBS_DIR, `${id}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ build, meta, at: new Date().toISOString() }, null, 2), 'utf8');
  return path.basename(file, '.json');
}

function listSubmissions() {
  ensureDir(SUBS_DIR);
  return fs.readdirSync(SUBS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try { return { file: f, ...JSON.parse(fs.readFileSync(path.join(SUBS_DIR, f), 'utf8')) }; }
      catch { return null; }
    })
    .filter(Boolean);
}

function findSubmission(id) {
  return listSubmissions().find((s) => s.file === id || s.file === id + '.json');
}

function removeSubmission(id) {
  const s = findSubmission(id);
  if (!s) return false;
  try { fs.unlinkSync(path.join(SUBS_DIR, s.file)); return true; } catch { return false; }
}

module.exports = {
  DATA_DIR, SUBS_DIR,
  getBuildsFile, saveBuildsFile,
  getRatings, addRating, mergeRatings,
  saveSubmission, listSubmissions, findSubmission, removeSubmission,
};
