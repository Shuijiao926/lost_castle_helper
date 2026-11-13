'use strict';

const WIKI = 'https://lc2.huijiwiki.com';
const STAFF_TITLE = '法杖';
const ATTRIBUTION = Object.freeze({
  type: 'wiki',
  name: '失落城堡2中文维基（灰机）',
  url: `${WIKI}/wiki/${encodeURIComponent(STAFF_TITLE)}`,
  license: 'CC-BY-NC-SA-4.0',
});

function createHuijiWikiInscriptions({ fetchImpl = fetch, snapshot } = {}) {
  async function parse(params) {
    const url = new URL('/api.php', WIKI);
    url.search = new URLSearchParams({ action: 'parse', format: 'json', formatversion: '2', ...params });
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`灰机 Wiki API 返回 HTTP ${response.status}`);
    const body = await response.json();
    if (!body.parse) throw new Error(`灰机 Wiki 无法解析法杖页面${body.error?.code ? ` (${body.error.code})` : ''}`);
    return body.parse;
  }

  async function load({ weaponType }) {
    if (weaponType !== 'STAFF') throw new Error('首批 Wiki 接入仅支持法杖刻印');
    if (snapshot !== undefined) {
      if (snapshot?.url !== ATTRIBUTION.url || !Array.isArray(snapshot.names) ||
          !snapshot.names.every((name) => typeof name === 'string' && name.trim())) {
        throw new Error('法杖刻印快照必须附 Wiki 来源链接及刻印名称');
      }
      return { names: snapshot.names, source: ATTRIBUTION };
    }

    const page = await parse({ page: STAFF_TITLE, prop: 'sections|revid' });
    const section = page.sections?.find((entry) => entry.line === '灵魂刻印');
    if (!section || !Number.isInteger(page.revid)) throw new Error('法杖页面缺少灵魂刻印章节或修订号');
    const content = await parse({ oldid: String(page.revid), section: section.index, prop: 'links|revid' });
    if (content.revid !== page.revid || !Array.isArray(content.links)) {
      throw new Error('法杖刻印章节缺少链接或修订号不一致');
    }

    // 此章节由 Lua 模块渲染，直接读取 MediaWiki 解析后的主命名空间链接。
    const listed = content.links
      .filter((link) => link?.ns === 0 && link.exists === true && typeof link.title === 'string')
      .map((link) => link.title.trim())
      .filter((name) => name.endsWith('刻印'));
    if (!listed.length) throw new Error('未识别到法杖刻印链接，可改用已核对的离线记录');
    const names = [...new Set(listed)];
    const url = new URL('/index.php', WIKI);
    url.search = new URLSearchParams({ oldid: String(page.revid) });
    return { names, source: { ...ATTRIBUTION, url: url.href } };
  }

  return { load };
}

module.exports = { createHuijiWikiInscriptions };
