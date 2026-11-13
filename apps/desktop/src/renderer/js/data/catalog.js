/* ================= 静态目录 + 内置示例流派 =================
 * 领域层的数据来源（domain 只读取，不修改）：
 * - INSC_DEF / WEAPONS / INSC：武器类型与刻印目录
 * - BUILDS：内置示例流派（真实数据加载前的兜底 / 原型预览数据）
 * - ALL_TAGS：按流派数量排序的标签索引
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else {
    root.LC2 = root.LC2 || {};
    root.LC2.data = root.LC2.data || {};
    root.LC2.data.catalog = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

const INSC_DEF={
  THW:[['hunter','宝藏猎人刻印'],['berserk','狂暴武士刻印'],['ironbone','铁骨莽勇刻印']],
  SHW:[['hunter','宝藏猎人刻印'],['revenge','复仇战士刻印'],['fearless','无畏勇士刻印']],
  STAFF:[['hunter','宝藏猎人刻印'],['arcane','奥术大师刻印'],['ethereal','空灵法师刻印']],
  DB:[['hunter','宝藏猎人刻印'],['blademaster','利刃舞女刻印'],['bladewarrior','刀锋战士刻印']],
  BOW:[['hunter','宝藏猎人刻印'],['roaring','轰鸣游侠刻印'],['strongarm','强臂弓手刻印']],
  FD:[['hunter','宝藏猎人刻印'],['gunner','炮斗士刻印'],['volcano','火山战士刻印']],
  GUN:[['hunter','宝藏猎人刻印'],['lucky','幸运猎手刻印'],['special','特种枪手刻印']],
  PL:[['hunter','宝藏猎人刻印'],['ghostflame','幽焰行者刻印'],['shadowstep','踏影魔人刻印']],
  KA:[['hunter','宝藏猎人刻印'],['swordmaster','剑术大师刻印'],['wanderer','流浪剑客刻印']]
};
const WEAPONS=[
  {id:'THW',name:'双手武器',short:'双手'},{id:'SHW',name:'单手武器',short:'单手'},
  {id:'STAFF',name:'法杖',short:'法杖'},{id:'DB',name:'双刀',short:'双刀'},
  {id:'BOW',name:'弓箭',short:'弓'},{id:'FD',name:'涡炉枪',short:'涡炉'},
  {id:'GUN',name:'火枪',short:'火枪'},{id:'PL',name:'幽影提灯',short:'提灯'},
  {id:'KA',name:'太刀',short:'太刀'}
];
const INSC={};
WEAPONS.forEach(w=>{w.inscriptions=(INSC_DEF[w.id]||[]).map(([code,name])=>{
  const id=w.id.toLowerCase()+'_'+code;INSC[id]={id,name,wt:w.id,kind:code==='hunter'?'hunter':'specific'};return id;});});

/* 流派内容数据：等真实数据接入。
   客户端运行时会通过 IPC 从 data/builds.json（或数据包）加载并替换这里。 */
const BUILDS=[];

/* 全量宝藏目录：运行时由 data/treasures.json 通过 loadTreasures() 填充 */
const TREASURES=[];

/* 全量武器条目：运行时由 data/weapons.json 的 items 通过 loadWeapons() 填充 */
const WEAPON_ITEMS=[];

/* 全量衣服/防具：运行时由 data/armors.json 通过 loadArmors() 填充 */
const ARMORS=[];

const ALL_TAGS=(()=>{const m=new Map();BUILDS.forEach(b=>(b.tags||[]).forEach(t=>{
  if(!m.has(t))m.set(t,[]);m.get(t).push(b);}));
  return [...m.entries()].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0],'zh'));})();

  function loadTreasures(entries) {
    if (!Array.isArray(entries)) return;
    TREASURES.length = 0;
    for (const entry of entries) {
      if (entry && typeof entry.name === 'string' && entry.name.trim()) {
        TREASURES.push({ id: entry.id || entry.name, name: entry.name.trim(), icon: entry.icon || '' });
      }
    }
  }

  function loadArmors(items) {
    if (!Array.isArray(items)) return;
    ARMORS.length = 0;
    for (const item of items) {
      if (item && typeof item.name === 'string' && item.name.trim()) {
        ARMORS.push({ id: item.id || item.name, name: item.name.trim(), kind: item.kind || '', icon: item.icon || '' });
      }
    }
  }

  function loadWeapons(items) {
    if (!Array.isArray(items)) return;
    WEAPON_ITEMS.length = 0;
    for (const item of items) {
      if (item && typeof item.name === 'string' && item.name.trim()) {
        WEAPON_ITEMS.push({ id: item.id || item.name, name: item.name.trim(), wt: item.wt || '', icon: item.icon || '' });
      }
    }
  }

  function loadInscriptions(entries) {
    if (!Array.isArray(entries) || !entries.length) return;
    for (const entry of entries) {
      if (entry && Object.hasOwn(INSC, entry.id) && INSC[entry.id].wt === entry.wt && typeof entry.name === 'string' && entry.name) {
        Object.assign(INSC[entry.id], { name: entry.name, source: entry.source, icon: entry.icon || '' });
      }
    }
  }

  return { INSC_DEF: INSC_DEF, WEAPONS: WEAPONS, WEAPON_ITEMS: WEAPON_ITEMS, ARMORS: ARMORS, INSC: INSC, BUILDS: BUILDS, TREASURES: TREASURES, ALL_TAGS: ALL_TAGS, loadInscriptions: loadInscriptions, loadTreasures: loadTreasures, loadWeapons: loadWeapons, loadArmors: loadArmors };
}));
