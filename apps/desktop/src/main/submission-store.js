/**
 * 本地投稿草稿存储
 *
 * 投稿编辑器把草稿写到 userData/submissions/*.json，主进程启动/刷新时
 * 和仓库里的 data/builds.json 合并，先跑通「本地录入 → 展示」的闭环。
 * 后续接后台系统时，这个模块可以被服务端 API 替换掉。
 */
const fs = require('fs');
const path = require('path');

function createSubmissionStore({ dir, log }) {
  function ensureDir() {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      log('submission dir create failed:', error.message);
    }
  }

  function list() {
    try {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => path.join(dir, name))
        .map((file) => {
          try {
            const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
            if (typeof rec.id !== 'string' || typeof rec.name !== 'string') return null;
            return { ...rec, localDraft: true };
          } catch (error) {
            log('submission parse failed:', file, error.message);
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      log('submission list failed:', error.message);
      return [];
    }
  }

  function save(payload) {
    ensureDir();
    const name = 'sub-' + Date.now() + '.json';
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return { ok: true, path: file, name };
  }

  return { list, save };
}

module.exports = createSubmissionStore;
