/**
 * 数据校验脚本
 *
 *   node scripts/validate-data.js              # 校验 data/builds.json
 *   node scripts/validate-data.js <file.json>  # 校验指定文件
 *
 * CI 也跑这一条（.github/workflows/validate.yml）
 */
const fs = require('fs');
const path = require('path');
const { validateFile } = require('../apps/shared/validate');

const target = process.argv[2] || path.join(__dirname, '..', 'data', 'builds.json');

function main() {
  let raw;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch (e) {
    console.error(`✗ 读不到文件：${target}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`✗ JSON 语法错误：${e.message}`);
    process.exit(1);
  }

  // 衣服目录：结构与唯一性校验（data/armors.json）
  if (path.basename(target) === 'armors.json') {
    const relA = path.relative(path.join(__dirname, '..'), target);
    const errs = [];
    if (!Array.isArray(data.armors) || !data.armors.length) errs.push('armors：必须是非空数组');
    const ids = new Set();
    const names = new Set();
    const kinds = ['轻甲', '布甲', '重甲'];
    (data.armors || []).forEach((a, i) => {
      if (!a || typeof a.id !== 'string' || !a.id) errs.push(`armors[${i}].id：必填`);
      if (!a || typeof a.name !== 'string' || !a.name.trim()) errs.push(`armors[${i}].name：必填`);
      if (a && a.kind && !kinds.includes(a.kind)) errs.push(`armors[${i}].kind：必须是 ${kinds.join('/')}`);
      if (a && a.icon && typeof a.icon !== 'string') errs.push(`armors[${i}].icon：必须是字符串 URL`);
      if (a && a.id) { if (ids.has(a.id)) errs.push(`armors[${i}].id 重复：${a.id}`); ids.add(a.id); }
      if (a && a.name) { if (names.has(a.name)) errs.push(`armors[${i}].name 重复：${a.name}`); names.add(a.name); }
    });
    if (errs.length) {
      console.error(`✗ ${relA} 校验失败（${errs.length} 处）\n`);
      errs.slice(0, 30).forEach((e) => console.error('  · ' + e));
      process.exit(1);
    }
    console.log(`✓ ${relA}`);
    console.log(`  ${data.armors.length} 件衣服 · 来源 ${(data.source && data.source.name) || '?'} · ${(data.source && data.source.license) || '?'}`);
    return;
  }

  // 宝藏目录：结构与唯一性校验（data/treasures.json）
  if (path.basename(target) === 'treasures.json') {
    const relT = path.relative(path.join(__dirname, '..'), target);
    const errs = [];
    if (!Array.isArray(data.treasures) || !data.treasures.length) errs.push('treasures：必须是非空数组');
    if (!data.source || !data.source.license) errs.push('source.license：必填（如 CC-BY-NC-SA-4.0）');
    const ids = new Set();
    const names = new Set();
    (data.treasures || []).forEach((t, i) => {
      if (!t || typeof t.id !== 'string' || !t.id) errs.push(`treasures[${i}].id：必填`);
      if (!t || typeof t.name !== 'string' || !t.name.trim()) errs.push(`treasures[${i}].name：必填`);
      if (t && t.id) { if (ids.has(t.id)) errs.push(`treasures[${i}].id 重复：${t.id}`); ids.add(t.id); }
      if (t && t.name) { if (names.has(t.name)) errs.push(`treasures[${i}].name 重复：${t.name}`); names.add(t.name); }
      if (t && t.icon && typeof t.icon !== 'string') errs.push(`treasures[${i}].icon：必须是字符串 URL`);
    });
    if (errs.length) {
      console.error(`✗ ${relT} 校验失败（${errs.length} 处）\n`);
      errs.slice(0, 30).forEach((e) => console.error('  · ' + e));
      process.exit(1);
    }
    console.log(`✓ ${relT}`);
    console.log(`  ${data.treasures.length} 个宝藏 · 来源 ${data.source.name || '?'} · ${data.source.license}`);
    return;
  }

  const r = validateFile(data);
  const rel = path.relative(path.join(__dirname, '..'), target);

  if (!r.ok) {
    console.error(`✗ ${rel} 校验失败（${r.errors.length} 处）\n`);
    r.errors.forEach((e) => console.error('  · ' + e));
    process.exit(1);
  }

  const n = data.builds.length;
  console.log(`✓ ${rel}`);
  console.log(`  版本 ${data.version || '?'} · 游戏 ${data.gameVersion || '?'} · ${n} 个流派`);
  data.builds.forEach((b) => {
    console.log(`  · ${b.id}  ${b.name}  (${b.wt})  ★${b.rating}`);
  });
}

main();
