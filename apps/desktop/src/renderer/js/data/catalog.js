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

const BUILDS=[
{ id:'shw_rev_1', name:'复仇战士剑盾流', alias:['昂龙剑盾','超级轮椅','一顶到底'], wt:'SHW', insc:'shw_revenge',
  rating:8.2, votes:1915, author:'@迷雾、', updated:'2026-11-12', src:'抖音图文《失落城堡2流派》第7集',
  features:['一顶到底','站桩硬顶','低操作门槛','冰属性直伤'],
  dmgLabel:'单段伤害', dmg:'96,366',
  tip:'昂龙剑盾一顶到底：靠复仇印记自动触发精确防御，站桩硬顶打伤害，几乎不用手动挡。',
  core:['昂龙剑盾'],
  inscEff:'直接攻击有 12% 概率获得 1 个复仇印记，最多 3 个。任意未触发精确防御的特殊动作会消耗印记，触发一次精确防御效果。',
  resonance:{code:'2-1-2',nodes:['空中特殊动作下落盾击的精确防御会激起石刃，接续后造成强力一击',
    '盾突后再次按下攻击派生昂龙拳，跃起同时造成伤害并可防御',
    '任意盾击与盾击类武器技能伤害提升 20%']},
  soulStones:[
    {name:'残像',lv:'',eff:'直接攻击有 30% 概率额外造成一次较弱的伤害'},
    {name:'骤死',lv:'',eff:'直接攻击有概率触发杀敌效果（冷却 1 秒）'},
    {name:'分解精通',lv:'Lv.5/5',eff:'分解宝藏返还的魂晶 +5'},
    {name:'狂热',lv:'Lv.5/10',eff:'暴击有 25% 概率回复 1 点生命'},
    {name:'嗜血',lv:'Lv.5/5',eff:'击杀怪物有 50% 概率回复生命'},
    {name:'利刃',lv:'Lv.10/10',eff:'直接攻击伤害提升'},
    {name:'背水',lv:'Lv.10/10',eff:'生命值低于 50% 时攻击力 +12%'},
    {name:'特殊增伤',lv:'Lv.10/10',eff:'特殊动作伤害提升'},
    {name:'铁匠',lv:'Lv.5/5',eff:'新增武器附魔的消耗减少'},
    {name:'连杀',lv:'Lv.10/10',eff:'击杀敌人后攻击力 +12%，持续 10 秒'}
  ],
  soulPlan:[
    {g:'提供增伤',items:['利刃2','背水2','特殊增伤2','连杀2']},
    {g:'提供回复',items:['狂热1','嗜血1']},
    {g:'提供资源',items:['分解精通','铁匠']},
    {g:'提升攻频',items:['残像']}
  ],
  gear:{
    weapon:{name:'英勇战魂',type:'单手武器',rarity:'传奇',atk:'88',skill:'战魂附身',cost:'30',
      note:'技能开启后全能力提升、所有动作强化，受击触发一次精确防御；毕业附魔优先',
      obtain:'后期关卡的传奇掉落 / 虚灵商店'},
    armor:{name:'诡谲混沌之铠',type:'轻甲',rarity:'传奇',
      attrs:['生命值上限 200','攻击速度 10%','暴击率 10%','攻击力 25%','生命/法力上限 +15%','三色符文 +3'],
      note:'版本最强衣服，攻速加成很舒服，成长属性强',obtain:'后期首领掉落'}
  },
  transition:[
    {name:'任意单手剑盾',type:'过渡武器',note:'优先拿带「盾击」或「精确防御」强化的，先把复仇印记循环跑起来',obtain:'前三关随便捡，稀有以上即可'},
    {name:'高攻速轻甲',type:'过渡防具',note:'攻速 > 生命，先把普攻频率拉起来',obtain:'安全区商店 / 首领掉落'}
  ],
  treasures:{chaos:['冰霜类混沌宝藏'],gold:['合成金宝藏'],other:['不融冰','冰薄荷叶','六角石头','北风号角']},
  treasureNotes:['开局优先拿不融冰，先把冰权重确定下来','冰薄荷叶对本流派很重要；但若六角石头带简易附魔可以放弃','北风号角需要叠层，尽早拿'],
  cursed:[
    {name:'被诅咒的硬币',eff:'每清空 2 个区域的敌人后获得一枚（当前累积 0 区域）；诅咒：虚灵商店刷新价格提高',verdict:'不净化'},
    {name:'邪恶的锢灵瓶',eff:'附近有敌人被击杀时提升 1 点生命上限，最多提升 80 点',verdict:'不净化'},
    {name:'吸魂之楔',eff:'直接攻击造成暴击时回复 3 点生命',verdict:'不净化'},
    {name:'邪兽的钝角',eff:'每损失 15 点生命值，造成的最终伤害提高 1%（当前提升 18%）；净化后效果下降 50%',verdict:'净化'},
    {name:'染血的冠军腰带',eff:'攻击力提高 18 点；诅咒：生命值上限减少 40%',verdict:'净化'}
  ],
  alchemy:[
    {name:'异变邪血',eff:'每次击败首领级怪物后，增加 2.5% 生命值与 2.5% 攻击力'},
    {name:'变异刚韧毛发',eff:'攻击力提高 8%'},
    {name:'魔王大头壳',eff:'红/绿/蓝三色符文各增加 2 点'}
  ],
  hunterItems:[{name:'飞盘',eff:'前期补充伤害'},{name:'香蕉',eff:'后期替换，增加容错'}],
  nightmareList:[
    {n:'生命锁定',p:'65%'},{n:'灵药污染',p:'100%'},{n:'法力锁定',p:''},{n:'泉水污染',p:'20%'},
    {n:'虚弱体质',p:''},{n:'脆弱身板',p:'30%'},{n:'元素易伤',p:'50%'},{n:'回收惩罚',p:''},
    {n:'负重降低',p:''},{n:'坏运气',p:''},{n:'选择限制',p:'45%'},{n:'升级锁定',p:''},{n:'魂晶吞噬',p:''}
  ],
  treasureOrder:[
    {t:'R',n:'不融冰',r:'优秀'},{t:'R',n:'六角石头',r:'优秀'},
    {t:'1',n:'冰薄荷叶',r:'稀有'},{t:'1',n:'北风号角',r:'稀有'}
  ],
  combos:['盾突 → 攻击派生昂龙拳，一边跃起一边防御','受击自动触发精确防御，不用手动按','空中特殊动作下落盾击接石刃，收尾伤害最高'],
  weaponChoices:[
    {name:'昂龙剑盾',tag:'核心',note:'流派名字来源，盾突 + 精确防御循环最顺'},
    {name:'英勇战魂',tag:'毕业',note:'战魂附身后全能力提升，收尾伤害更高'},
    {name:'任意单手剑盾',tag:'过渡',note:'前三关随便捡，带「盾击」强化优先'}
  ],
  tags:['冰属性','盾反','直接攻击','生存']
},
{ id:'db_bm_1', name:'双刀闪避暴击流', alias:['暴击双刀','闪暴双刀'], wt:'DB', insc:'db_blademaster',
  rating:7.6, votes:1299, author:'示例作者', updated:'2026-11-10', src:'TapTap 攻略',
  features:['高段数','位移输出','容错中等'], dmgLabel:'秒伤', dmg:'待补',
  tip:'贴身连续输出，靠闪避帧接攻击打出暴击链；位移段是核心伤害窗口，别拿位移去赶路。',
  core:['双刀'], inscEff:'', resonance:null, soulStones:[], soulPlan:[], gear:null, transition:[],
  treasures:{chaos:[],gold:[],other:[]}, treasureNotes:[], cursed:[], alchemy:[], hunterItems:[],
  nightmareList:[{n:'坏运气',p:''},{n:'选择限制',p:'45%'},{n:'生命锁定',p:'65%'}],
  treasureOrder:[{t:'R',n:'剑士腕甲',r:'优秀'},{t:'R',n:'兽骨护指',r:'优秀'},
    {t:'1',n:'刺客面罩',r:'稀有'},{t:'1',n:'游侠羽饰',r:'稀有'},{t:'2',n:'元素王冠',r:'史诗'}],
  combos:['武器技能后接取消重击可保留位移','闪避帧内接攻击触发暴击链'],
  tags:['暴击','闪避','直接攻击']
},
{ id:'bow_roar_1', name:'射手雷击流', alias:['雷击弓箭','雷电射手','雷电流'], wt:'BOW', insc:'bow_roaring',
  rating:7.4, votes:612, author:'示例作者', updated:'2026-11-06', src:'社区原帖',
  features:['远程','雷击叠层','AOE清群'], dmgLabel:'秒伤', dmg:'待补',
  tip:'靠雷击标签叠雷，蓄力箭起手引爆；保持中距离，太近吃突进。',
  core:['弓箭'], inscEff:'', resonance:null, soulStones:[], soulPlan:[], gear:null, transition:[],
  treasures:{chaos:[],gold:[],other:[]}, treasureNotes:[], cursed:[], alchemy:[], hunterItems:[],
  nightmareList:[{n:'坏运气',p:''},{n:'元素易伤',p:'50%'}],
  treasureOrder:[{t:'R',n:'雷纹印记',r:'优秀'},{t:'R',n:'电弧花蕾',r:'优秀'},
    {t:'1',n:'闪电之鳞',r:'稀有'},{t:'2',n:'轰雷之须',r:'史诗'}],
  combos:['蓄力箭起手引爆雷击','雷击堆起来后靠电花清群'], tags:['雷击','电属性','轰雷']
},
{ id:'thw_hun_1', name:'虚浮的闪电溜溜球', alias:['漂浮溜溜球','闪电溜溜球','雷击溜溜球'], wt:'THW', insc:'thw_hunter',
  rating:6.9, votes:233, author:'示例作者', updated:'2026-11-08', src:'TapTap《一把虚浮的闪电溜溜球》',
  features:['娱乐向','漂浮','雷击'], dmgLabel:'秒伤', dmg:'待补',
  tip:'娱乐向：靠溜溜球在外圈反复命中，堆雷击后用漂浮拉扯。',
  core:['溜溜球'], inscEff:'', resonance:null, soulStones:[], soulPlan:[], gear:null, transition:[],
  treasures:{chaos:[],gold:[],other:[]}, treasureNotes:[], cursed:[], alchemy:[], hunterItems:[],
  nightmareList:[{n:'坏运气',p:''}],
  treasureOrder:[{t:'R',n:'雷龙翼膜',r:'优秀'},{t:'1',n:'闪电之鳞',r:'稀有'},{t:'2',n:'法力电芯',r:'史诗'}],
  combos:['保持距离让溜溜球反复命中'], tags:['雷击','电属性','漂浮']
},
{ id:'staff_arc_1', name:'法杖环状挥击流', alias:['环击法杖','法杖AOE'], wt:'STAFF', insc:'staff_arcane',
  rating:7.8, votes:903, author:'示例作者', updated:'2026-11-08', src:'TapTap 攻略',
  features:['站桩输出','卡位循环','清屏强'], dmgLabel:'秒伤', dmg:'待补',
  tip:'环状挥击卡位循环站桩输出，技能后接平A回蓝，别边走边放。',
  core:['法杖'], inscEff:'', resonance:null, soulStones:[], soulPlan:[], gear:null, transition:[],
  treasures:{chaos:[],gold:[],other:[]}, treasureNotes:[], cursed:[], alchemy:[], hunterItems:[],
  nightmareList:[{n:'弱化体质',p:''},{n:'法力锁定',p:''}],
  treasureOrder:[{t:'R',n:'魔力玛瑙',r:'优秀'},{t:'1',n:'湮灭之令',r:'稀有'},{t:'2',n:'元素王冠',r:'史诗'}],
  combos:['环状挥击卡位循环','技能后接平A回蓝'], tags:['符文法弹','法力']
},
{ id:'gun_luck_1', name:'火枪炸弹流', alias:['炸弹火枪','诱爆流'], wt:'GUN', insc:'gun_lucky',
  rating:7.1, votes:445, author:'示例作者', updated:'2026-10-30', src:'TapTap 攻略',
  features:['埋弹引爆','清群'], dmgLabel:'秒伤', dmg:'待补',
  tip:'先埋弹再引爆，靠爆燃火球清群；狭窄地形别乱炸。',
  core:['火枪'], inscEff:'', resonance:null, soulStones:[], soulPlan:[], gear:null, transition:[],
  treasures:{chaos:[],gold:[],other:[]}, treasureNotes:[], cursed:[], alchemy:[], hunterItems:[],
  nightmareList:[{n:'坏运气',p:''}],
  treasureOrder:[{t:'R',n:'中瓶黑火药',r:'优秀'},{t:'1',n:'诱爆试剂',r:'稀有'}],
  combos:['先埋弹再引爆'], tags:['爆燃火球','投掷']
},
{ id:'thw_iron_1', name:'三槽爆发流', alias:['蓄力爆发','满槽流'], wt:'THW', insc:'thw_ironbone',
  rating:7.0, votes:388, author:'示例作者', updated:'2026-10-28', src:'社区原帖',
  features:['蓄力爆发','单段极高'], dmgLabel:'单段伤害', dmg:'待补',
  tip:'满三槽后放旋风强蓄力斩，收尾重砍吃满 1100%。',
  core:['重剑/大刀'], inscEff:'', resonance:null, soulStones:[], soulPlan:[], gear:null, transition:[],
  treasures:{chaos:[],gold:[],other:[]}, treasureNotes:[], cursed:[], alchemy:[], hunterItems:[],
  nightmareList:[{n:'脆弱身板',p:'30%'},{n:'生命锁定',p:'65%'}],
  treasureOrder:[{t:'R',n:'佣兵板甲',r:'优秀'},{t:'1',n:'坚韧纵劈',r:'稀有'},{t:'2',n:'撼地重斩',r:'史诗'}],
  combos:['满三槽（180）再放强蓄力斩'], tags:['武器技能','生存']
}];

const ALL_TAGS=(()=>{const m=new Map();BUILDS.forEach(b=>(b.tags||[]).forEach(t=>{
  if(!m.has(t))m.set(t,[]);m.get(t).push(b);}));
  return [...m.entries()].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0],'zh'));})();

  return { INSC_DEF: INSC_DEF, WEAPONS: WEAPONS, INSC: INSC, BUILDS: BUILDS, ALL_TAGS: ALL_TAGS };
}));
