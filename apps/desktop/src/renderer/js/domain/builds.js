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
  const NIGHTMARE_DEPTH_THRESHOLDS = Object.freeze([10, 20, 30, 40, 50]);

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

  function mergeEquipment(choices, primary) {
    const rows = new Map();
    function add(name, item, stage) {
      if (!rows.has(name)) {
        rows.set(name, { name, stages: [], types: [], notes: [], sources: [], primary: null });
      }
      const row = rows.get(name);
      const pairs = [
        [row.stages, stage],
        [row.types, item.type],
        [row.notes, item.note],
        [row.sources, item.obtain],
      ];
      for (const [values, value] of pairs) {
        if (value && !values.includes(value)) values.push(value);
      }
      return row;
    }

    for (const choice of choices) {
      const name = typeof choice?.name === 'string' ? choice.name.trim() : '';
      // 旧记录把推荐清单中的首件毕业武器记为「核心」。
      if (name) add(name, choice, choice.tag === '核心' ? '毕业' : choice.tag);
    }
    const primaryName = typeof primary?.name === 'string' ? primary.name.trim() : '';
    if (primaryName) {
      // 本地投稿只有过渡装时也会设置 gear。已有阶段以清单为准。
      const stage = rows.has(primaryName) ? '' : '毕业';
      add(primaryName, primary, stage).primary = primary;
    }
    return [...rows.values()];
  }

  function equipmentForDetail(build) {
    const weapons = build.weaponChoices?.length
      ? build.weaponChoices
      : (build.core || []).map((name) => ({ name, tag: '毕业' }));
    const weaponRows = mergeEquipment([
      ...weapons,
      ...(build.transition || []).map((item) => ({ ...item, tag: '过渡' })),
    ], build.gear?.weapon);

    // 投稿只在主武器上记录类型，其余武器从对应的图鉴条目补齐。
    for (const row of weaponRows) {
      if (row.types.length) continue;
      const item = catalog.WEAPON_ITEMS.find(({ name }) => name === row.name);
      const type = item && WEAPONS.find(({ id }) => id === item.wt);
      if (type?.name) row.types.push(type.name);
    }

    return {
      weapons: weaponRows,
      armors: mergeEquipment(
        (build.armorChoices || []).map((item) => ({ ...item, tag: item?.tier })),
        build.gear?.armor,
      ),
    };
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

  function listTags(builds, query = '') {
    const keyword = query.trim().toLowerCase();
    const counts = new Map();
    for (const build of builds) {
      if (!Array.isArray(build.tags)) continue;
      for (const tag of new Set(build.tags)) {
        if (typeof tag !== 'string' || !tag.trim() || !tag.toLowerCase().includes(keyword)) continue;
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts.entries()].sort(([tagA, countA], [tagB, countB]) =>
      countB - countA || tagA.localeCompare(tagB, 'zh-CN'));
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

  /**
   * 流派的时间戳（毫秒）；取不到就返回 0，交给排序沉到最后。
   * 优先 createdAt（投稿时间），退回 updatedAt / updated（最后更新）。
   */
  function buildTime(build) {
    var raw = build.createdAt || build.updatedAt || build.updated || '';
    var t = Date.parse(raw);
    return isNaN(t) ? 0 : t;
  }

  /** 排序（不改原数组）：time 由近到远，rating 高分在前，默认按人气 */
  function sortBuilds(list, sort) {
    var out = list.slice();
    if (sort === 'rating') out.sort(function (a, b) { return b.rating - a.rating || b.votes - a.votes; });
    else if (sort === 'time') out.sort(function (a, b) { return buildTime(b) - buildTime(a) || b.votes - a.votes; });
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

  function soulShape(item) {
    const slot = String(item?.slot || '');
    if (slot.includes('三角')) return 'triangle';
    if (slot.includes('方形')) return 'square';
    if (slot.includes('圆形')) return 'circle';
    if (slot.includes('六边')) return 'hexagon';
    return '';
  }

  function soulLoadout(stones) {
    const plan = [['triangle', 'square', 'circle'], ['triangle', 'square', 'circle'], ['hexagon', 'hexagon']];
    const extras = stones.slice();
    const groups = plan.map((group) => group.map((shape) => {
      const index = extras.findIndex((stone) => soulShape(stone) === shape);
      const stone = index < 0 ? null : extras.splice(index, 1)[0];
      return { shape, stone };
    }));
    return { groups, extras };
  }

  function soulEffectDetails(raw, selectedLevel) {
    const text = String(raw || '').trim();
    const levels = text.split(/\s+\/\s+(?=Lv\.?\s*\d+\b)/i).filter(Boolean).map((step) => {
      const match = /^Lv\.?\s*(\d+)\s+(.+)$/is.exec(step);
      return match ? { level: Number(match[1]), text: match[2] } : { level: null, text: step };
    });
    const exact = levels.find(({ level }) => level !== null && level === Number(selectedLevel));
    if (exact) return { summary: exact.text, sampleLevel: null, levels };

    const first = levels[0];
    const number = /\d+(?:\.\d+)?/g;
    if (levels.length > 1) {
      const template = first.text.replace(number, '#');
      if (levels.every((entry) => entry.text.replace(number, '#') === template)) {
        const values = levels.map((entry) => entry.text.match(number) || []);
        let index = 0;
        // Bound each varying value by published levels, without assuming linear growth.
        const summary = first.text.replace(number, (value) => {
          const column = values.map((row) => row[index]);
          index += 1;
          const min = column.reduce((low, current) => Number(current) < Number(low) ? current : low, value);
          const max = column.reduce((high, current) => Number(current) > Number(high) ? current : high, value);
          return Number(min) === Number(max) ? value : min + '–' + max;
        });
        return { summary, sampleLevel: null, levels };
      }
    }
    return { summary: first?.text || '', sampleLevel: first?.level ?? null, levels };
  }

  function nightmareList(selections) {
    return catalog.NIGHTMARE_EFFECTS.flatMap((effect) => {
      const option = effect.options.find((entry) => entry.points === selections.get(effect.name));
      return option ? [{ n: effect.name, p: option.label, points: option.points }] : [];
    });
  }

  function nightmareTotal(list) {
    if (list.some((entry) => !Number.isSafeInteger(entry.points) || entry.points < 1)) return null;
    return list.reduce((sum, entry) => sum + entry.points, 0);
  }

  function nightmareProgress(list) {
    const points = nightmareTotal(list);
    if (points === null) return null;
    const thresholds = NIGHTMARE_DEPTH_THRESHOLDS;
    return { points, depth: thresholds.filter((threshold) => threshold <= points).length, thresholds };
  }

  return {
    weapon: weapon,
    weaponName: weaponName,
    inscriptionName: inscriptionName,
    listTreasures: listTreasures,
    listTags,
    equipmentForDetail,
    stars: stars,
    matches: matches,
    buildTime: buildTime,
    sortBuilds: sortBuilds,
    visibleBuilds: visibleBuilds,
    normalizeBuilds: normalizeBuilds,
    soulShape,
    soulLoadout,
    soulEffectDetails,
    nightmareList,
    nightmareTotal,
    nightmareProgress,
  };
}));
