/** 版本检查：拉取 GitHub Release，失败时退回 main 分支 package.json。 */
const { net, shell, app } = require('electron');

const REPO = 'Shuijiao926/lost_castle_helper';
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RAW_PACKAGE = `https://raw.githubusercontent.com/${REPO}/main/package.json`;

function parseVersion(s) {
  return String(s || '').replace(/^v/i, '').split('.').map((n) => {
    const v = parseInt(n, 10);
    return Number.isFinite(v) ? v : 0;
  });
}

function compareVersion(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const dx = x[i] || 0, dy = y[i] || 0;
    if (dx !== dy) return dx - dy;
  }
  return 0;
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await net.fetch(url, {
      headers: {
        'User-Agent': 'LC2-Helper/' + app.getVersion(),
        Accept: 'application/vnd.github+json',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function checkForUpdates() {
  const current = app.getVersion();
  try {
    const release = await fetchJson(API_URL);
    const latest = String(release.tag_name || '').replace(/^v/i, '');
    if (!latest) throw new Error('no tag');
    return {
      ok: true,
      current,
      latest,
      hasUpdate: compareVersion(latest, current) > 0,
      url: release.html_url || RELEASES_URL,
      notes: String(release.body || '').split('\n').slice(0, 6).join('\n'),
      source: 'release',
    };
  } catch (e1) {
    try {
      const pkg = await fetchJson(RAW_PACKAGE);
      const latest = String(pkg.version || '').replace(/^v/i, '');
      if (!latest) throw new Error('no version');
      return {
        ok: true,
        current,
        latest,
        hasUpdate: compareVersion(latest, current) > 0,
        url: RELEASES_URL,
        notes: '',
        source: 'package',
      };
    } catch (e2) {
      return { ok: false, current, error: '检查失败，请检查网络后重试' };
    }
  }
}

function openExternal(url) {
  try { shell.openExternal(url); return true; } catch { return false; }
}

module.exports = { checkForUpdates, openExternal };
