/* ================= 领域层：流派规则（纯函数，无 DOM / 无 IPC） =================
 * 这里只放业务规则：
 * - 目录查找（武器 / 刻印名称）
 * - 评分星级渲染
 * - 流派筛选 / 搜索 / 排序
 * - 真实数据归一化（服务端 DTO → 前端实体）
 *
 * 不依赖 window、document、localStorage，可直接用 node --test 测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else {
    root.LC2 = root.LC2 || {};
    root.LC2.domain = factory(root.LC2.data.catalog);
  }
}(typeof self !== 'undefined' ? self : this, function (catalog) {
  'use strict';

  var WEAPONS = catalog.WEAPONS;
  var INSC = catalog.INSC;

  /** 武器目录查找（找不到时兜底成 id 自身） */
  function weapon(id) {
    return WEAPONS.find(function (w) { return w.id === id; }) || { id: id, name: id, short: id };
  }
  function weaponName(id) {
    return weapon(id).name;
  }
  function inscriptionName(id) {
    return INSC[id] ? INSC[id].name : '—';
  }

  /** 评分 → 5 颗星 HTML（四舍五入到每颗星 = 2 分） */
  function stars(rating) {
    var filled = Math.round(rating / 2);
    var html = '';
    for (var i = 0; i < 5; i++) html += i < filled ? '<i>★</i>' : '★';
    return '<span class="stars">' + html + '</span>';
  }

  /** 搜索用文本：名称 / 别名 / 标签 / 核心 / 特色 / 武器 / 刻印 / 作者 / 宝藏 */
  function searchText(build) {
    return [
      build.name,
      (build.aliases || []).join(' '),
      (build.alias || []).join(' '),
      (build.tags || []).join(' '),
      (build.core || []).join(' '),
      (build.features || []).join(' '),
      weaponName(build.wt),
      inscriptionName(build.insc),
      build.author || '',
      (build.treasureOrder || []).map(function (t) { return t.n || ''; }).join(' ')
    ].join(' ').toLowerCase();
  }

  /** 单条流派是否命中筛选条件 */
  function matches(build, filters) {
    if (filters.filterW && build.wt !== filters.filterW) return false;
    if (filters.filterI && build.insc !== filters.filterI) return false;
    if (filters.tag && (build.tags || []).indexOf(filters.tag) === -1) return false;
    if (filters.q && searchText(build).indexOf(String(filters.q).toLowerCase()) === -1) return false;
    return true;
  }

  /** 排序（不改原数组） */
  function sortBuilds(list, sort) {
    var out = list.slice();
    if (sort === 'rating') out.sort(function (a, b) { return b.rating - a.rating || b.votes - a.votes; });
    else out.sort(function (a, b) { return b.votes - a.votes || b.rating - a.rating; });
    return out;
  }

  /** 列表视图：先排序再筛选 */
  function visibleBuilds(list, filters) {
    return sortBuilds(list, filters.sort).filter(function (b) { return matches(b, filters); });
  }

  /** 服务端 DTO → 前端流派实体（source/updatedAt → src/updated） */
  function normalizeBuilds(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (b) {
      var o = Object.assign({}, b);
      o.src = b.source || b.src || '';
      o.updated = b.updatedAt || b.updated || '';
      return o;
    });
  }

  return {
    weapon: weapon,
    weaponName: weaponName,
    inscriptionName: inscriptionName,
    stars: stars,
    matches: matches,
    sortBuilds: sortBuilds,
    visibleBuilds: visibleBuilds,
    normalizeBuilds: normalizeBuilds
  };
}));
