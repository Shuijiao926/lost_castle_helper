/**
 * 前后端共享的流派数据校验（零依赖）
 *
 * 只做「必填 + 类型 + 取值」检查，不做 JSON Schema 全量校验，
 * 目的是给投稿接口一个快速、可读的失败原因。
 * 完整规范见 ./schema/build.schema.json
 */

const WEAPON_TYPES = ['THW', 'SHW', 'STAFF', 'DB', 'BOW', 'FD', 'GUN', 'PL', 'KA'];
const RARITIES = ['普通', '优秀', '稀有', '史诗', '传奇'];
const VERDICTS = ['净化', '不净化'];
const WEAPON_TAGS = ['核心', '毕业', '过渡', '可选'];
const DEPTHS = ['S', 'R', '1', '2'];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => Number.isFinite(Number(v));
const isArr = (v) => Array.isArray(v);

/**
 * @param {object} b
 * @returns {{ok: boolean, errors: string[]}}
 */
function validateBuild(b) {
  const e = [];
  const need = (cond, msg) => { if (!cond) e.push(msg); };

  if (!b || typeof b !== 'object') return { ok: false, errors: ['build 必须是对象'] };

  need(isStr(b.id) && /^[a-z0-9_]{3,40}$/.test(b.id), 'id：必填，3-40 位小写字母/数字/下划线');
  need(isStr(b.name) && b.name.length <= 20, 'name：必填，不超过 20 字');
  need(WEAPON_TYPES.includes(b.wt), `wt：必须是 ${WEAPON_TYPES.join('/')}`);
  need(isStr(b.insc), 'insc：必填，刻印 id');
  need(isNum(b.rating) && b.rating >= 0 && b.rating <= 10, 'rating：0-10');
  need(Number.isInteger(Number(b.votes)) && Number(b.votes) >= 0, 'votes：非负整数');
  need(isArr(b.features) && b.features.length >= 1 && b.features.length <= 5, 'features：1-5 个特点标签');
  need(isStr(b.tip) && b.tip.length >= 6, 'tip：必填，一句话玩法技巧');
  need(isStr(b.author), 'author：必填，投稿人');
  need(isStr(b.gameVersion), 'gameVersion：必填，适用游戏版本');

  if (isArr(b.tags)) {
    need(b.tags.every(isStr), 'tags：必须是字符串数组');
  }
  if (isArr(b.aliases)) {
    need(b.aliases.every(isStr), 'aliases：必须是字符串数组');
  }

  if (b.resonance) {
    need(/^\d-\d-\d$/.test(b.resonance.code || ''), 'resonance.code：形如 2-1-2');
    if (b.resonance.nodes) need(isArr(b.resonance.nodes), 'resonance.nodes：字符串数组');
  }

  if (isArr(b.soulStones)) {
    b.soulStones.forEach((s, i) => need(isStr(s.name), `soulStones[${i}].name：必填`));
  }

  if (b.gear) {
    if (b.gear.weapon) {
      need(isStr(b.gear.weapon.name), 'gear.weapon.name：必填');
      if (b.gear.weapon.rarity) need(RARITIES.includes(b.gear.weapon.rarity), 'gear.weapon.rarity：取值不合法');
    }
    if (b.gear.armor) {
      need(isStr(b.gear.armor.name), 'gear.armor.name：必填');
      if (b.gear.armor.rarity) need(RARITIES.includes(b.gear.armor.rarity), 'gear.armor.rarity：取值不合法');
    }
  }

  const checkChoice = (arr, label) => {
    if (!isArr(arr)) return;
    arr.forEach((w, i) => {
      need(isStr(w.name), `${label}[${i}].name：必填`);
      if (w.tag) need(WEAPON_TAGS.includes(w.tag), `${label}[${i}].tag：必须是 ${WEAPON_TAGS.join('/')}`);
    });
  };
  checkChoice(b.weaponChoices, 'weaponChoices');
  checkChoice(b.transition, 'transition');

  if (isArr(b.treasureOrder)) {
    b.treasureOrder.forEach((t, i) => {
      need(isStr(t.n), `treasureOrder[${i}].n：必填`);
      need(RARITIES.includes(t.r), `treasureOrder[${i}].r：必须是 ${RARITIES.join('/')}`);
      if (t.t !== undefined) need(DEPTHS.includes(t.t), `treasureOrder[${i}].t：必须是 ${DEPTHS.join('/')}`);
    });
  }

  if (isArr(b.cursed)) {
    b.cursed.forEach((c, i) => {
      need(isStr(c.name), `cursed[${i}].name：必填`);
      need(VERDICTS.includes(c.verdict), `cursed[${i}].verdict：必须是 ${VERDICTS.join('/')}`);
    });
  }

  if (isArr(b.nightmareList)) {
    b.nightmareList.forEach((n, i) => need(isStr(n.n), `nightmareList[${i}].n：必填`));
  }

  if (b.dmg !== undefined && isStr(b.dmg) && b.dmg !== '待补') {
    need(isStr(b.dmgLabel), 'dmgLabel：填了 dmg 就必须填指标名（单段伤害 / 秒伤）');
  }

  return { ok: e.length === 0, errors: e };
}

/** 校验整个 builds.json 文件 */
function validateFile(file) {
  const errors = [];
  if (!file || !isArr(file.builds)) return { ok: false, errors: ['builds 必须是数组'] };

  const seen = new Set();
  file.builds.forEach((b, i) => {
    const r = validateBuild(b);
    if (!r.ok) errors.push(...r.errors.map((x) => `builds[${i}] ${x}`));
    if (b && b.id) {
      if (seen.has(b.id)) errors.push(`builds[${i}] id 重复：${b.id}`);
      seen.add(b.id);
    }
  });
  return { ok: errors.length === 0, errors };
}

module.exports = { validateBuild, validateFile, WEAPON_TYPES, RARITIES, VERDICTS, WEAPON_TAGS, DEPTHS };
