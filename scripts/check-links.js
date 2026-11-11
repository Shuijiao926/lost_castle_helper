/**
 * 文档内链检查
 *
 *   node scripts/check-links.js
 *
 * 扫描所有 .md 里的相对链接（含图片），确认目标文件存在。
 * 外链（http/https/mailto）与纯锚点跳过。
 * CI 会跑这一条：文档改名忘记改链接，会直接失败。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LINK_RE = /!?\[[^\]]*\]\(([^)]+)\)/g;
const SKIP_DIRS = new Set(['node_modules', '.git', 'release', 'storage']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function main() {
  const files = walk(ROOT);
  let checked = 0;
  const broken = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const base = path.dirname(file);
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(text)) !== null) {
      let target = m[1].trim().replace(/^<|>$/g, '');
      if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
      target = target.split('#')[0].trim();
      if (!target) continue;
      target = decodeURIComponent(target.replace(/\+/g, '%2B'));

      const resolved = path.normalize(path.join(base, target));
      checked++;
      if (!fs.existsSync(resolved)) {
        broken.push({ file: path.relative(ROOT, file), target });
      }
    }
  }

  if (broken.length) {
    console.error(`✗ 文档内链检查失败：${broken.length} 个失效（共检查 ${checked} 个）\n`);
    for (const b of broken) console.error(`  ${b.file}  ->  ${b.target}`);
    process.exit(1);
  }

  console.log(`✓ 文档内链全部有效（${files.length} 个文档，${checked} 个链接）`);
}

main();
