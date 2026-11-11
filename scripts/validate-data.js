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
