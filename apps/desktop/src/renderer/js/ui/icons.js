/* ================= 图标资源（表现层） =================
 * - ICON：wiki 图标 URL（武器类型 / 刻印 / 被动道具）
 * - RC：稀有度颜色
 * - ic()：生成带首字兜底的图标块
 * - ICON_SVG：卡片操作图标（Lucide，ISC）
 */
(function () {
  'use strict';
  window.LC2 = window.LC2 || {};
  window.LC2.ui = window.LC2.ui || {};

const CDN='https://huiji-thumb.huijistatic.com/lc2/uploads/thumb/';
const ICON={
  THW:CDN+'5/5d/Icon_Type_THW.png/60px-Icon_Type_THW.png',SHW:CDN+'7/7b/Icon_Type_SHW.png/60px-Icon_Type_SHW.png',
  STAFF:CDN+'5/52/Icon_Type_STAFF.png/60px-Icon_Type_STAFF.png',DB:CDN+'4/48/Icon_Type_DB.png/60px-Icon_Type_DB.png',
  BOW:CDN+'d/d2/Icon_Type_BOW.png/60px-Icon_Type_BOW.png',FD:CDN+'5/5c/Icon_Type_FD.png/60px-Icon_Type_FD.png',
  GUN:CDN+'5/5b/Icon_Type_GUN.png/60px-Icon_Type_GUN.png',PL:CDN+'0/05/Icon_type_PL.png/60px-Icon_type_PL.png',
  KA:CDN+'9/90/Icon_Type_KA.png/60px-Icon_Type_KA.png',
  thw_hunter:CDN+'3/34/Icon_Hunter_THW.png/60px-Icon_Hunter_THW.png',thw_berserk:CDN+'1/12/Icon_Type_THW_A.png/60px-Icon_Type_THW_A.png',thw_ironbone:CDN+'6/61/Icon_Type_THW_B.png/60px-Icon_Type_THW_B.png',
  shw_hunter:CDN+'7/79/Icon_Hunter_SHW.png/60px-Icon_Hunter_SHW.png',shw_revenge:CDN+'b/b0/Icon_Type_SHW_A.png/60px-Icon_Type_SHW_A.png',shw_fearless:CDN+'9/9e/Icon_Type_SHW_B.png/60px-Icon_Type_SHW_B.png',
  staff_hunter:CDN+'a/a1/Icon_Type_Staff_B.png/60px-Icon_Type_Staff_B.png',staff_arcane:CDN+'a/a1/Icon_Type_Staff_B.png/60px-Icon_Type_Staff_B.png',staff_ethereal:CDN+'1/19/Icon_Type_Staff_A.png/60px-Icon_Type_Staff_A.png',
  db_hunter:CDN+'9/92/Icon_Type_DB_B.png/60px-Icon_Type_DB_B.png',db_blademaster:CDN+'a/a6/Icon_Type_DB_A.png/60px-Icon_Type_DB_A.png',db_bladewarrior:CDN+'9/92/Icon_Type_DB_B.png/60px-Icon_Type_DB_B.png',
  bow_hunter:CDN+'4/49/Icon_Type_Bow_A.png/60px-Icon_Type_Bow_A.png',bow_roaring:CDN+'a/a2/Icon_Type_Bow_B.png/60px-Icon_Type_Bow_B.png',bow_strongarm:CDN+'4/49/Icon_Type_Bow_A.png/60px-Icon_Type_Bow_A.png',
  fd_hunter:CDN+'4/4e/Icon_Type_FD_A.png/60px-Icon_Type_FD_A.png',fd_gunner:CDN+'6/62/Icon_Type_FD_B.png/60px-Icon_Type_FD_B.png',fd_volcano:CDN+'4/4e/Icon_Type_FD_A.png/60px-Icon_Type_FD_A.png',
  gun_hunter:CDN+'9/97/Icon_Type_Gun_B.png/60px-Icon_Type_Gun_B.png',gun_lucky:CDN+'9/97/Icon_Type_Gun_B.png/60px-Icon_Type_Gun_B.png',gun_special:CDN+'d/d8/Icon_Type_Gun_A.png/60px-Icon_Type_Gun_A.png',
  pl_hunter:CDN+'a/af/Icon_Type_PL_A.png/60px-Icon_Type_PL_A.png',pl_ghostflame:CDN+'a/af/Icon_Type_PL_A.png/60px-Icon_Type_PL_A.png',pl_shadowstep:CDN+'0/07/Icon_Type_PL_B.png/60px-Icon_Type_PL_B.png',
  ka_hunter:CDN+'1/14/Icon_Type_KATANA_A.png/60px-Icon_Type_KATANA_A.png',ka_swordmaster:CDN+'1/14/Icon_Type_KATANA_A.png/60px-Icon_Type_KATANA_A.png',ka_wanderer:CDN+'3/3b/Icon_Type_KATANA_B.png/60px-Icon_Type_KATANA_B.png',
  '刺客面罩':CDN+'5/5a/Icon_PassiveProps_NecklaceOfBerserker.png/60px-Icon_PassiveProps_NecklaceOfBerserker.png',
  '雷龙翼膜':CDN+'5/55/Icon_PassiveProps_DodgeThunder.png/60px-Icon_PassiveProps_DodgeThunder.png',
  '集电瓶':CDN+'c/ca/Icon_PassiveProps_AbosorbElectricMachine.png/60px-Icon_PassiveProps_AbosorbElectricMachine.png',
  '强磁手套':CDN+'9/9d/Icon_PassiveProps_ElectricGlove.png/60px-Icon_PassiveProps_ElectricGlove.png',
  '火焰风衣':CDN+'c/c1/Icon_PassivePropsIcon_FlameCoat.png/60px-Icon_PassivePropsIcon_FlameCoat.png',
  '游侠羽饰':CDN+'b/b2/Icon_PassivePropsIcon_RangerHood_Lv1.png/60px-Icon_PassivePropsIcon_RangerHood_Lv1.png',
  '剑士腕甲':CDN+'d/da/Icon_PassivePropsIcon_SwordsmanshipGloves_Lv1.png/60px-Icon_PassivePropsIcon_SwordsmanshipGloves_Lv1.png',
  '兽骨护指':CDN+'4/43/Icon_PassiveProps_Fingerstall.png/60px-Icon_PassiveProps_Fingerstall.png'
};
const RC={'初始':'#5b6274','普通':'#5b6274','优秀':'#3f6b52','稀有':'#3d5382','史诗':'#6b4a86','传奇':'#8a6a32','诅咒':'#6b3f6b'};

/* 旧数据里存的是 huiji-thumb 缩略图路径，现已大量 404；
   文件本身还在，统一转成 Special:FilePath 直链 */
function fixIconUrl(src){
  if (typeof src !== 'string' || !src) return src;
  const m = src.match(/\/thumb\/[^/]+\/[^/]+\/([^/]+)\/\d+px-(.+)$/);
  if (m) return 'https://lc2.huijiwiki.com/wiki/Special:FilePath/' + encodeURIComponent(m[2]);
  return src;
}

function ic(key,label,size,color){
  const src=fixIconUrl(Object.hasOwn(ICON,key)?ICON[key]:Object.hasOwn(ICON,label)?ICON[label]:null);
  const ch=window.LC2.ui.dom.esc(String(label||'?').slice(0,1)),c=color||'#3b4a63';
  return '<span class="ic '+(size||'s34')+'" style="--c:'+c+'">'
    +(src?'<img src="'+src+'" alt="" loading="lazy" onload="this.classList.add(&#39;i-ok&#39;)" onerror="this.remove()">':'')
    +'<i>'+ch+'</i></span>';
}

/* 卡片操作图标：Lucide (ISC) 细线风格，stroke=currentColor，选中时填充 */
const ICON_SVG = {
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
};


  window.LC2.ui.icons = {
    CDN: CDN,
    ICON: ICON,
    RC: RC,
    ic: ic,
    ICON_SVG: ICON_SVG
  };
})();
