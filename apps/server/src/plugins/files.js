/**
 * 文件存储（当前方案：GitHub）
 *
 * github：把图标 / 截图提交到数据仓库，返回 raw 地址（零成本、天然 CDN）
 * local ：写到本地 storage/（开发用，配 nginx 静态目录）
 *
 * 后续换 OSS / COS 时只改这个文件。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const API = 'https://api.github.com';

function rawUrl(relPath) {
  const { owner, repo, branch } = config.github;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${relPath}`;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function saveToGithub(buffer, fileName, dir = 'assets/uploads') {
  const { owner, repo, branch, token } = config.github;
  if (!token) throw new Error('缺少 GITHUB_TOKEN，无法上传文件');

  const relPath = `${dir}/${fileName}`;
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${encodeURI(relPath)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'lc2-server',
    },
    body: JSON.stringify({
      message: `chore(upload): ${fileName}`,
      content: buffer.toString('base64'),
      branch,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub 上传失败 ${res.status}: ${t.slice(0, 200)}`);
  }
  return { provider: 'github', path: relPath, url: rawUrl(relPath), hash: sha256(buffer) };
}

function saveToLocal(buffer, fileName) {
  const dir = path.join(config.localFileDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, fileName);
  fs.writeFileSync(target, buffer);
  return { provider: 'local', path: target, url: `/static/uploads/${fileName}`, hash: sha256(buffer) };
}

/**
 * @param {Buffer} buffer
 * @param {string} fileName 需要带扩展名，调用方保证唯一
 */
async function save(buffer, fileName) {
  if (config.fileStorage === 'github') return saveToGithub(buffer, fileName);
  return saveToLocal(buffer, fileName);
}

module.exports = { save, rawUrl, sha256 };
