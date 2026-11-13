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

  /** 流派涉及的衣服/防具名 */
  function armorNames(build) {
    const a = build && build.gear && build.gear.armor;
    return a && typeof a.name === 'string' && a.name.trim() ? [a.name.trim()] : [];
  }

  /** 流派涉及的武器名单（具体武器，用于按武器条目筛选） */
  function weaponNames(build) {
    const out = [];
    const g = build && build.gear;
    if (g && g.weapon && typeof g.weapon.name === 'string') out.push(g.weapon.name);
    (build && build.weaponChoices || []).forEach((w) => { if (w && typeof w.name === 'string') out.push(w.name); });
    (build && build.transition || []).forEach((w) => { if (w && typeof w.name === 'string') out.push(w.name); });
    (build && build.core || []).forEach((n) => { if (typeof n === 'string') out.push(n); });
    return out.filter((n) => n && n.trim()).map((n) => n.trim());
  }

  function treasureNames(build) {
    return [
      ...(build.treasures?.chaos || []),
      ...(build.treasures?.gold || []),
      ...(build.treasureOrder || []).map((item) => item?.n),
      ...(build.cursed || []).map((item) => item?.name),
    ].filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim());
  }

  function listTreasures(builds, query = '') {
    const keyword = query.trim().toLowerCase();
    const names = new Set(builds.flatMap(treasureNames));
    return [...names].filter((name) => name.toLowerCase().includes(keyword))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
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
      weaponNames(build).join(' '),
      armorNames(build).join(' '),
      inscriptionName(build.insc),
      build.author || '',
      treasureNames(build).join(' ')
    ].join(' ').toLowerCase();
  }

  /** 把筛选值统一成数组（兼容单值字符串） */
  function asList(v) {
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  }

  /**
   * 单条流派是否命中筛选条件
   *
   * 多选语义：同一类里是「或」（选了双刀或法杖都算命中），
   * 不同类之间是「且」（武器 + 标签必须同时满足）。
   */
  function matches(build, filters) {
    var wantW = asList(filters.filterW);
    var wantI = asList(filters.filterI);
    var wantEquip = asList(filters.filterEquip);
    var wantArmor = asList(filters.filterArmor);
    var wantTreasures = asList(filters.filterTreasures);
    var wantT = asList(filters.tag).concat(asList(filters.tags));
    if (wantW.length && wantW.indexOf(build.wt) === -1) return false;
    if (wantEquip.length) {
      const names = weaponNames(build);
      if (!wantEquip.some((n) => names.indexOf(n) !== -1)) return false;
    }
    if (wantArmor.length && !wantArmor.some((n) => armorNames(build).indexOf(n) !== -1)) return false;
    if (wantI.length && wantI.indexOf(build.insc) === -1) return false;
    if (wantTreasures.length) {
      const names = treasureNames(build);
      if (!wantTreasures.some((name) => names.includes(name))) return false;
    }
    if (wantT.length) {
      var tags = build.tags || [];
      if (!wantT.some(function (t) { return tags.indexOf(t) !== -1; })) return false;
    }
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
    listTreasures: listTreasures,
    stars: stars,
    matches: matches,
    sortBuilds: sortBuilds,
    visibleBuilds: visibleBuilds,
    normalizeBuilds: normalizeBuilds
  };
}));
