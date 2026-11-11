/**
 * 投稿模块
 *  create  : 玩家提交（校验用 apps/shared/validate.js）
 *  list    : 管理员查看待审队列
 *  approve : 通过 → 写入流派数据（骨架阶段直接合并进 data/builds.json）
 *  reject  : 驳回 → 记录原因
 */
const { validateBuild } = require('../../../../apps/shared/validate');
const db = require('../plugins/db');
const jsonStore = require('../store/json-store');

async function create(build, meta) {
  const check = validateBuild(build);
  if (!check.ok) return { ok: false, code: 422, errors: check.errors };

  const prisma = db.getDb();
  if (prisma) {
    const row = await prisma.submission.create({
      data: {
        buildId: build.id,
        author: meta.author || build.author || '匿名',
        contact: meta.contact || null,
        sourceUrl: meta.source || build.source || null,
        payload: build,
        files: meta.files || null,
      },
    });
    return { ok: true, id: row.id };
  }

  const id = jsonStore.saveSubmission(build, meta);
  return { ok: true, id };
}

async function list() {
  const prisma = db.getDb();
  if (prisma) {
    const rows = await prisma.submission.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
    return { source: 'db', items: rows };
  }
  return { source: 'file', items: jsonStore.listSubmissions() };
}

async function approve(id, note) {
  const prisma = db.getDb();
  if (prisma) {
    const sub = await prisma.submission.update({
      where: { id: Number(id) },
      data: { status: 'APPROVED', reviewNote: note || null, reviewedAt: new Date() },
    });
    const payload = sub.payload;
    await prisma.build.upsert({
      where: { id: payload.id },
      create: {
        id: payload.id,
        name: payload.name,
        weaponType: payload.wt,
        inscriptionId: payload.insc,
        author: payload.author || sub.author,
        gameVersion: payload.gameVersion,
        payload,
        status: 'PUBLISHED',
      },
      update: { payload, status: 'PUBLISHED' },
    });
    return { ok: true };
  }

  // 文件模式：合并进 builds.json 并删除投稿
  const sub = jsonStore.findSubmission(id);
  if (!sub) return { ok: false, code: 404, error: 'submission not found' };

  const file = jsonStore.getBuildsFile();
  const builds = file.builds || [];
  const idx = builds.findIndex((b) => b.id === sub.build.id);
  if (idx >= 0) builds[idx] = sub.build;
  else builds.push(sub.build);
  file.builds = builds;
  jsonStore.saveBuildsFile(file);
  jsonStore.removeSubmission(id);
  return { ok: true, merged: true };
}

async function reject(id, note) {
  const prisma = db.getDb();
  if (prisma) {
    await prisma.submission.update({
      where: { id: Number(id) },
      data: { status: 'REJECTED', reviewNote: note || null, reviewedAt: new Date() },
    });
    return { ok: true };
  }
  const sub = jsonStore.findSubmission(id);
  if (!sub) return { ok: false, code: 404, error: 'submission not found' };
  sub.reviewNote = note || '';
  sub.status = 'REJECTED';
  return { ok: true };
}

module.exports = { create, list, approve, reject };
