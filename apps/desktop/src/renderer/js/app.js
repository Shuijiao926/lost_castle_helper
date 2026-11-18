  /* 说明：Electron 适配层在上面独立的 IIFE 中，Web / 原型环境会自动跳过。 */
/* ==========================================================================
 * 城堡助手 · 渲染层（应用 / 表现层，组合根）
 *
 *   data/catalog → domain/builds → infra/repositories
 *                      ↓                ↓
 *              ui/{icons,dom,motion} → app.js（state / view / interaction）
 *
 * 本文件只负责：状态、视图渲染、DOM 事件、键盘交互、Electron 适配。
 * 领域规则在 js/domain，数据来源与持久化在 js/infra。
 * ========================================================================== */
(function () {
  'use strict';

  const {
    WEAPONS, WEAPON_ITEMS, ARMORS, SOUL_STONES, CURSED_TREASURES, NIGHTMARE_EFFECTS,
    INSC, BUILDS, TREASURES, loadInscriptions, loadTreasures, loadWeapons,
    loadWeaponTypes, loadArmors, loadSoulStones, loadCursedTreasures, loadNightmareEffects,
  } = LC2.data.catalog;
  const { ic, ICON, ICON_SVG, RC, weaponTint, nightmareIcon } = LC2.ui.icons;
  const { $, esc } = LC2.ui.dom;
  const refs = LC2.ui.dom.refs;
  const elFeed = refs.feed, elDetail = refs.detail, elSbar = refs.sbar, elBack = refs.back,
        elFilterbar = refs.filterbar, elListbar = refs.listbar,
        elTtl = refs.ttl, elModal = refs.modal, elGrid = refs.mgrid,
        elPanel = refs.panel, elBubble = refs.bubble, elTip = refs.bubbleTip;
  const searchQuery = $('q'), searchQueryClear = $('qClear');
  const modalQuery = $('mq'), modalQueryClear = $('mqClear');
  const elFbtn = elSbar;
  const feedScrollbar = LC2.ui.bindFeedScrollbar(elFeed, $('feedScrollbar'));
  const domain = LC2.domain;
  const infra = LC2.infra;
  const motion = LC2.ui.motion;
  const W = domain.weapon, wName = domain.weaponName, inscName = domain.inscriptionName, stars = domain.stars;

/* ================= 应用状态 ================= */
let pendingStagger = false;   // render 后是否让列表重新错峰入场
let notesLoaded = false;
let dataStatus = window.lc2 ? 'loading' : 'ready';

const state={sort:'time',view:'feed',detailId:null,filterItem:null,lastSubmitItem:null,cur:'',owned:new Set(),myVote:{},
  favs:new Set(),ratingOpen:null,notes:{},noteBid:null,
  q:'',focusedInput:false,dormant:false,tags:[],filterW:[],filterI:[],filterEquip:[],filterArmor:[],filterTreasures:[],modal:false,seg:'w',sideSel:null,mq:''};

const filterSegments = {
  w: { field: 'filterW', label: '武器' },
  i: { field: 'filterI', label: '刻印' },
  t: { field: 'tags', label: '标签' },
  treasure: { field: 'filterTreasures', label: '宝藏' },
  equip: { field: 'filterEquip', label: '装备' },
  armor: { field: 'filterArmor', label: '衣服' },
};

const randomButton=$('randomBuild'), randomModal=$('randomModal'), randomTrack=$('randomTrack');
const randomPool=$('randomPool'), randomStatus=$('randomStatus'), randomWindow=$('randomWindow');
const randomAgain=$('randomAgain'), randomView=$('randomView');
let randomPhase='closed';
let randomResult=null;
let cancelRandomAnimation=null;

function syncRandomButton(){
  randomButton.disabled=dataStatus!=='ready' || !BUILDS.length || randomPhase==='rolling';
  randomButton.title=BUILDS.length ? '随机一下 · 从全部 '+BUILDS.length+' 个流派中抽取' : '随机一下 · 暂无流派可抽取';
}
function randomEntryHTML(build){
  const weapon=build.gear?.weapon?.name;
  const key=weapon && ICON[weapon] ? weapon : build.wt;
  return '<div class="draw-entry">'+ic(key,wName(build.wt),'s60',weaponTint(build.wt)).replace('loading="lazy"','loading="eager"')
    +'<div class="draw-entry-main"><div class="draw-entry-name">'+esc(build.name)+'</div>'
    +'<div class="draw-entry-meta">'+esc(wName(build.wt))+' · '+esc(inscName(build.insc))+'</div></div>'
    +'<p class="draw-entry-tip">'+esc(build.tip)+'</p></div>';
}
function closeRandomDraw(){
  if(randomPhase==='closed') return;
  cancelRandomAnimation?.();
  cancelRandomAnimation=null;
  randomPhase='closed';
  randomResult=null;
  randomModal.classList.remove('on','is-result');
  randomWindow.setAttribute('aria-busy','false');
  randomButton.setAttribute('aria-expanded','false');
  window.lc2?.modalEscape?.(false);
  syncRandomButton();
}
function spinRandomDraw(){
  if(randomPhase==='rolling' || dataStatus!=='ready' || !BUILDS.length) return;
  cancelRandomAnimation?.();
  const pool=BUILDS.slice();
  randomResult=domain.pickRandomBuild(pool,Math.random());
  randomPhase='rolling';
  releaseFocusInput();
  randomModal.classList.add('on');
  randomModal.classList.remove('is-result');
  randomButton.setAttribute('aria-expanded','true');
  window.lc2?.modalEscape?.(true);
  randomPool.textContent='从全部 '+pool.length+' 个流派中抽取';
  randomStatus.textContent='正在抽取…';
  randomWindow.setAttribute('aria-busy','true');
  randomAgain.disabled=true;
  randomView.disabled=true;
  syncRandomButton();
  const reel=Array.from({length:24},()=>domain.pickRandomBuild(pool,Math.random()));
  reel.push(randomResult,domain.pickRandomBuild(pool,Math.random()));
  randomTrack.innerHTML=reel.map(randomEntryHTML).join('');
  cancelRandomAnimation=motion.drawReel(randomTrack,()=>{
    randomPhase='result';
    randomModal.classList.add('is-result');
    randomWindow.setAttribute('aria-busy','false');
    randomStatus.textContent='抽中了「'+randomResult.name+'」';
    randomAgain.disabled=false;
    randomView.disabled=false;
    syncRandomButton();
    motion.replay(randomWindow,'m-draw-reveal');
  },{instant:pool.length===1});
}
function viewRandomResult(){
  if(randomPhase!=='result') return;
  const id=randomResult.id;
  closeRandomDraw();
  if(BUILDS.some(build=>build.id===id)) openDetail(id);
  else showToast('流派数据已更新，请重新抽取');
}
randomButton.onclick=spinRandomDraw;
randomAgain.onclick=spinRandomDraw;
randomView.onclick=viewRandomResult;
$('randomClose').onclick=closeRandomDraw;
randomModal.onclick=(event)=>{
  if(window.__lc2SuppressBackdrop){window.__lc2SuppressBackdrop=false;return;}
  if(event.target===randomModal) closeRandomDraw();
};
window.addEventListener('pagehide',closeRandomDraw);

/* ================= 领域调用（应用状态 → 领域参数） ================= */
function currentFilters() {
  return { q: state.q, filterW: state.filterW, filterI: state.filterI, filterEquip: state.filterEquip, filterArmor: state.filterArmor, filterTreasures: state.filterTreasures, tag: state.tags, sort: state.sort };
}
function visible() {
  return domain.visibleBuilds(BUILDS, currentFilters());
}
/** 当前排序 + 筛选下的第一条：换排序后默认就选它 */
function firstVisibleId() {
  const list = visible();
  return list.length ? list[0].id : '';
}

/* ===== 搜索焦点：面板默认不抢焦点，输入时才临时获焦 ===== */
let pendingInputFocus = null;

function acquireFocusInput(el){
  state.focusedInput = true;
  pendingInputFocus = document.hasFocus() ? null : el;
  window.lc2?.searchFocus?.(true);
  el.focus();
}
function resetInputFocus(){
  pendingInputFocus = null;
  if(!state.focusedInput) return;
  state.focusedInput = false;
  document.activeElement?.blur();
}
function releaseFocusInput(){
  if(!state.focusedInput) return;
  resetInputFocus();
  window.lc2?.searchFocus?.(false);
}


/* ================= 筛选 chips（多选） ================= */
function selectedCount(){
  return Object.values(filterSegments).reduce((count, { field }) => count + state[field].length, 0);
}
function activeFilters(){
  const out=[];
  state.filterW.forEach(function(id){
    const it = WEAPON_ITEMS.find((x) => x.name === id || x.id === id);
    out.push({k:'w', v:id, label: it ? it.name : wName(id)});
  });
  state.filterI.forEach(function(id){ out.push({k:'i', v:id, label:inscName(id).replace('刻印','')}); });
  state.tags.forEach(function(t){ out.push({k:'t', v:t, label:'#'+t}); });
  state.filterTreasures.forEach((name) => out.push({ k: 'treasure', v: name, label: name }));
  state.filterEquip.forEach((name) => {
    const it = WEAPON_ITEMS.find((x) => x.name === name);
    out.push({ k: 'equip', v: name, label: it ? it.name : name });
  });
  state.filterArmor.forEach((name) => out.push({ k: 'armor', v: name, label: name }));
  return out;
}
function clearAllFilters(){
  for (const { field } of Object.values(filterSegments)) state[field] = [];
}
function removeFilter(k, v){
  const { field } = filterSegments[k];
  state[field] = state[field].filter((value) => value !== v);
  render(); fbtnState();
}
function renderFilterbar(isFeed){
  if(!elFilterbar) return;
  const list = activeFilters();
  const lclear = document.getElementById('lclear');
  const frow = document.getElementById('frow');
  if(lclear) lclear.style.display = (isFeed && list.length) ? 'flex' : 'none';
  if(frow) frow.style.display = (isFeed && list.length) ? 'flex' : 'none';
  if(!isFeed || !list.length){ elFilterbar.style.display='none'; elFilterbar.innerHTML=''; return; }
  elFilterbar.style.display='flex';

  function chipHTML(f){
    const v = esc(String(f.v));
    return '<span class="fchip" data-fk="'+f.k+'" data-fv="'+v+'">'+esc(f.label)
      +'<i class="fx" data-fk="'+f.k+'" data-fv="'+v+'" title="移除">×</i></span>';
  }

  // 先全部渲染，再按可视宽度折叠成「前几个 + +N」
  elFilterbar.innerHTML = list.map(chipHTML).join('');
  const kids = Array.from(elFilterbar.children);
  const avail = elFilterbar.clientWidth;
  let acc = 0;
  let shown = kids.length;
  for(let i=0;i<kids.length;i++){
    const w = kids[i].offsetWidth + 6; // gap
    if(acc + w > avail){ shown = i; break; }
    acc += w;
  }
  // 预留 +N 的位置
  const moreCount = list.length - shown;
  if(moreCount > 0){
    const moreW = 34;
    let k = shown;
    while(k > 0 && acc + moreW > avail){ k--; acc -= (kids[k].offsetWidth + 6); }
    shown = k;
  }
  kids.slice(shown).forEach(function(n){ n.remove(); });
  const hidden = list.length - shown;
  if(hidden > 0){
    const more = document.createElement('span');
    more.className = 'fchip fmore';
    more.textContent = '+' + hidden;
    more.title = '还有 ' + hidden + ' 个筛选条件，点击管理';
    more.onclick = function(){ if(state.view==='feed') openModal(); };
    elFilterbar.appendChild(more);
  }

  elFilterbar.querySelectorAll('.fx').forEach(function(n){
    n.onclick=function(ev){ ev.stopPropagation(); removeFilter(n.dataset.fk, n.dataset.fv); };
  });
  elFilterbar.querySelectorAll('.fchip:not(.fmore)').forEach(function(n){
    n.onclick=function(){ if(state.view==='feed') openModal(); };
  });
}

function syncFeedScroll(){
  elFeed.classList.toggle('scrolled', elFeed.scrollTop > 0);
  feedScrollbar.sync(state.view==='feed' && !!elFeed.querySelector('.card'));
}

elFeed.addEventListener('scroll', syncFeedScroll, { passive: true });
window.addEventListener('resize', syncFeedScroll);

function render(){
  syncRandomButton();
  const isFeed=state.view==='feed';
  elPanel.classList.toggle('detail-open', !isFeed);
  elFeed.style.display=isFeed?'block':'none';
  elDetail.style.display=isFeed?'none':'block';
  elSbar.style.display=isFeed?'flex':'none';
  elBack.style.display=isFeed?'none':'inline';
  elTtl.style.display=isFeed?'':'none';
  if(elListbar) elListbar.style.display = isFeed ? 'flex' : 'none';
  renderFilterbar(isFeed);
  isFeed?renderFeed():renderDetail();
  syncFeedScroll();
  if(pendingStagger){ pendingStagger=false; motion.stagger(elFeed); }
}

/* ---------- 卡片 ---------- */
function renderFeed(){
  elFeed.setAttribute('aria-busy', String(dataStatus === 'loading'));
  if(dataStatus === 'loading'){
    elFeed.innerHTML = '<div class="feed-status" role="status"><span class="loading-ring" aria-hidden="true"></span>正在加载流派与图鉴…</div>';
    return;
  }
  if(dataStatus === 'failed'){
    elFeed.innerHTML = '<div class="feed-status"><span role="status">流派与图鉴加载失败</span><button type="button" class="load-retry">重试</button></div>';
    elFeed.querySelector('.load-retry').onclick = () => window.__lc2RefreshData();
    return;
  }
  const list=visible();
  if(!list.some(b=>b.id===state.cur)&&list.length)state.cur=list[0].id;
  if(!BUILDS.length){
    elFeed.innerHTML = emptyState('流派数据还在路上', '更新后，就能在这里查装备和刻印搭配。', false)
      .replace(/<\/div>$/, '<div class="empty-hint">先去城堡闯一局，回头再来看看。</div></div>');
    return;
  }
  if(!list.length){elFeed.innerHTML='<div class="tip">没有匹配的流派。按 F 重新筛选。</div>';return;}
  elFeed.innerHTML=list.map(b=>cardHTML(b,b.id===state.cur)).join('');
  elFeed.querySelectorAll('.card').forEach(n=>{
    n.onclick=ev=>{
      const bid=n.dataset.bid;
      if(ev.target.closest('[data-fav]')){toggleFav(bid);return;}
      if(ev.target.closest('[data-rate]')){state.ratingOpen=(state.ratingOpen===bid?null:bid);render();return;}
if(ev.target.closest('[data-note]')){openNote(bid);return;}
      if(ev.target.closest('.ratepick')) return;
      openDetail(bid);
    };
  });
  motion.bindCards(elFeed);
  const c=elFeed.querySelector('.card.is-active');if(c)c.scrollIntoView({block:'nearest'});
}
function ratingHTML(build, { showStars = true } = {}){
  if(!build.votes && !build.rating) return '<div class="rate is-unrated"><span class="rating-empty">暂无评分</span></div>';
  return '<div class="rate"><span class="sc" aria-label="评分 '+build.rating.toFixed(1)+' 分">'
    +'<strong>'+build.rating.toFixed(1)+'</strong><small>'+(showStars?'/10':'分')+'</small></span>'
    +'<div class="rating-meta">'+(showStars?stars(build.rating):'')+'<span class="votes">'+build.votes+' 人打分</span></div></div>';
}

function cardHTML(b,isCur){
  const tint=weaponTint(b.wt);
  // 一枚就够：分数够高给「高分」，否则人气够旺给「热门」，避免整列卡片都挂标签
  const badge = b.rating>=9 ? '<span class="cbadge score">高分</span>'
    : (b.votes>=150 ? '<span class="cbadge hot">热门</span>' : '');
  const weaponImage = b.gear?.weapon?.name;
  const iconKey = weaponImage && ICON[weaponImage] ? weaponImage : b.wt;
  let h='<div class="card'+(isCur?' is-active':'')+'" data-bid="'+b.id+'">';
  // 列表概览显示分数与人数，布局根据可用宽度安排在品类下方或右侧。
  h+='<div class="ch">'+ic(iconKey,W(b.wt).short,'s48',tint)
   +'<div class="main"><div class="ctop"><button type="button" class="cname" aria-label="查看'+esc(b.name)+'详情">'+esc(b.name)+'</button>'+badge+'</div>'
   +'<div class="cmeta"><span class="cate" style="--tc:'+tint+'">'+esc(wName(b.wt))+'</span>'
   +'<span class="csep">·</span><span class="cate insc">'+esc(inscName(b.insc))+'</span></div></div>'
   +ratingHTML(b, { showStars: false })+'</div>';

  if(b.tip) h+='<p class="card-summary">'+esc(b.tip)+'</p>';

  // 特征 chip 与三个操作图标同排：左边标签、右边动作，卡片底部才有"收口"
  h+='<div class="cfoot"><div class="chips feat">'
   +(b.features||[]).map(f=>'<span class="chip np">'+esc(f)+'</span>').join('')
   +'</div><div class="cardacts">'
   +'<span class="act'+(state.myVote[b.id]?' on':'')+'" data-rate="'+b.id+'" title="打分">'+ICON_SVG.star+'</span>'
   +'<span class="act fav'+(state.favs.has(b.id)?' on':'')+'" data-fav="'+b.id+'" title="收藏">'+ICON_SVG.heart+'</span>'
+'<span class="act note'+(state.notes[b.id]?' on':'')+'" data-note="'+b.id+'" title="'+(state.notes[b.id]?'修改我的印象':'写点印象')+'">'+ICON_SVG.note+'</span>'
   +'</div></div>';

  if(state.ratingOpen===b.id){
    const selection=domain.ratingSelection(state.myVote[b.id]||0);
    h+='<div class="ratepick" data-bid="'+esc(b.id)+'"><span class="rating-prompt">给流派打分</span>'
     +'<div class="rating-stars" role="radiogroup" aria-label="流派评分，满分 10 分">'
     +selection.fills.map((fill,index)=>'<span class="rp'+(fill===1?' is-full':fill===0.5?' is-half':'')+'">'
       +'<span class="rp-icon" aria-hidden="true">★</span>'
       +[index+0.5,index+1].map(value=>'<input type="radio" class="rating-half" name="rating-'+esc(b.id)+'" value="'+value+'"'
         +' aria-label="'+(value*2)+' 分，'+value+' 颗星"'+(selection.stars===value?' checked':'')+'>').join('')
       +'</span>').join('')+'</div>'
     +'<output class="rating-value" aria-live="polite" aria-atomic="true">'+ratingValueHTML(selection)+'</output></div>';
  }
  return h+'</div>';
}

/* ---------- 详情 ---------- */
function openDetail(id){state.cur=id;state.detailId=id;state.view='detail';render();motion.replay(elDetail,'m-view-in');}
function closeDetail(){state.view='feed';state.detailId=null;render();motion.replay(elFeed,'m-view-back');}
function sec(t,body,hint){return body?('<div class="sec">'+t+(hint?' <span class="hint">'+hint+'</span>':'')+'</div>'+body):'';}
function box(title,body,iconHtml){return '<div class="box"><h4>'+(iconHtml||'')+esc(title)+'</h4>'+body+'</div>';}
/* 不带标题的盒子：标题已经在 .sec 上重复时用这个，避免同一句话写两遍 */
function plainBox(body){return '<div class="box">'+body+'</div>';}

/* ================= 详情页展示形态 =================
 * 速记：只列「这局要选什么」——刻印、共鸣、灵魂石、宝藏、诅咒、加点
 * 完整：连每条说明一起带上（刻印效果、灵魂石等级效果、宝藏效果、诅咒代价…）
 */
const DETAIL_MODE_KEY='lc2.detailMode.v1';
let detailMode='quick';
try{ if(localStorage.getItem(DETAIL_MODE_KEY)==='full') detailMode='full'; }catch(e){}
function detailFull(){ return detailMode==='full'; }
function setDetailMode(mode){
  const next=mode==='full'?'full':'quick';
  if(next===detailMode) return;
  detailMode=next;
  try{ localStorage.setItem(DETAIL_MODE_KEY,next); }catch(e){}
  const top=elDetail.scrollTop;
  renderDetail();
  elDetail.scrollTop=top;
}

/* 刻印图鉴：投稿数据只存 inscEff 时，用图鉴补出完整的刻印效果 */
function inscEntry(id){ return (id && INSC[id]) || null; }

/**
 * 共鸣：把 code（形如 1-1-0）还原成每个槽位选中的方案。
 * 有图鉴就取该方案的等级与文案（能出 Lv1/Lv2/Lv3 图标），
 * 图鉴查不到时退回投稿里存下来的纯文本。
 */
function detailResonance(b){
  const res=b.resonance;
  if(!res) return [];
  const nodes=Array.isArray(res.nodes)?res.nodes:[];
  const picks=String(res.code||'').split('-').map((v)=>parseInt(v,10)||0);
  const item=inscEntry(b.insc);
  const groups=(item&&item.effectGroups&&Array.isArray(item.effectGroups.groups))?item.effectGroups.groups:[];
  const slots=Math.max(picks.length,groups.length?Math.min(groups.length,3):0,1);
  const out=[];
  for(let i=0;i<slots;i++){
    const idx=picks[i]||0;
    const group=groups[i]||[];
    const entry=idx>0?(group[idx-1]||null):null;
    const text=entry?((entry.lines||[]).join(' ')):(nodes[i]||'');
    if(!text) continue;
    out.push({slot:i+1,level:entry?(entry.level||1):(idx||1),text:String(text)});
  }
  return out;
}

/* 十六进制 → 半透明：标签底色 / 描边用（不依赖 color-mix，老版 Chromium 也能跑） */
function tint(hex,alpha){
  const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||''));
  if(!m) return 'rgba(255,255,255,'+alpha+')';
  const n=parseInt(m[1],16);
  return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')';
}

/* 品类 / 稀有度小标签：颜色跟着品类走，别全是同一个绿 */
function rtag(label,color){
  if(!label) return '';
  const c=color||'#8b93a6';
  return '<span class="rtag" style="--tag-color:'+c+';background:'+tint(c,.15)+';border:1px solid '+tint(c,.32)+'">'
    +esc(label)+'</span>';
}

/* 说明文案里的数字挑出来上色：先转义再套标签，不会二次转义 */
function accentText(text){
  /* Lv.N 单独当一个整块（压暗），避免 "Lv.1" 的 1 和后面 "3米" 的 3 粘成一个数 */
  return esc(text).replace(/(Lv\.?\s*\d+)|(\d+(?:\.\d+)?(?:–\d+(?:\.\d+)?)?(?:[ \t]*(?:%|％|点|秒|次|层|个|米|倍))?)/g,
    (all, lv) => (lv ? '<i class="lvmark">'+lv+'</i>' : '<i class="num">'+all+'</i>'));
}

/**
 * 完整模式的效果文案：一行一条，「诅咒：」单独起一行换色。
 * 原来整段用 <br> 挤在一起，看不出哪句是收益、哪句是代价。
 */
function effBlock(text){
  const raw=String(text||'').replace(/\r/g,'').trim();
  if(!raw) return '';
  const lines=[];
  raw.split(/\n+/).forEach((seg)=>{
    seg.split(/(?=诅咒\s*[-－—:：])/).forEach((part)=>{
      const t=part.trim();
      if(t) lines.push(t);
    });
  });
  return '<div class="effblock">'+lines.map((line)=>{
    const cls='effline'+(/^诅咒\s*[-－—:：]/.test(line)?' curse':'');
    return '<div class="'+cls+'">'+accentText(line)+'</div>';
  }).join('')+'</div>';
}

function renderSoulEffect(eff, level, maxLevel){
  const { summary, sampleLevel, levels } = domain.soulEffectDetails(eff, level);
  const example = sampleLevel !== null && (levels.length > 1 || maxLevel !== 1)
    ? '<span class="dstone-example">Lv.' + sampleLevel + ' 示例</span>' : '';
  const breakdown = levels.length > 1
    ? '<details class="dstone-levels"><summary>各等级效果</summary><dl>'
      + levels.map((row) => '<dt>' + (row.level === null ? '基础' : 'Lv.' + row.level)
        + '</dt><dd>' + accentText(row.text) + '</dd>').join('') + '</dl></details>' : '';
  return example + effBlock(summary) + breakdown;
}

function renderTreasureDetail(name, rarity, color, effect, order = ''){
  return '<div class="dtrow">' + order + ic(name,name,'s30',color)
    + '<div class="dtmain"><div class="dttop"><span class="dtname">' + esc(name) + '</span>'
    + rtag(rarity, RC[rarity] || '#8b93a6') + '</div>' + effBlock(effect) + '</div></div>';
}

function renderEquipmentDetails({ primary, notes, sources }, kind) {
  const stats = [];
  if (primary && kind === 'weapon') {
    if (primary.atk != null) stats.push('攻击力 ' + primary.atk);
    if (primary.skill || primary.cost != null) {
      const skill = primary.skill ? '技能「' + primary.skill + '」' : '技能';
      stats.push(skill + (primary.cost != null ? '消耗 ' + primary.cost + ' 法力' : ''));
    }
  }
  if (primary && kind === 'armor') stats.push(...(primary.attrs || []));
  const effects = effBlock([...stats, ...notes].join('\n'));
  const obtain = sources.map((source) => '<div class="dgear-source">获取：' + esc(source) + '</div>').join('');
  return effects || obtain ? '<div class="dgear-description">' + effects + obtain + '</div>' : '';
}

function renderEquipmentGroup(label, kind, rows, full) {
  if (!rows.length) return '';
  const color = kind === 'weapon' ? '#E3A08F' : '#93B7EE';
  return '<section class="box dgear-group dgear-' + kind + '"><h4>' + esc(label) + '</h4><ul>'
    + rows.map((row) => {
      const types = row.types.map((type) => rtag(type, color)).join('');
      const rarity = row.primary?.rarity;
      const stages = row.stages.map((stage) => (
        '<span class="dgear-stage' + (stage === '毕业' ? ' is-graduation' : '') + '">' + esc(stage) + '</span>'
      )).join('');
      return '<li class="dgear-row">' + ic(row.name, row.name, 's30', color)
        + '<div class="dgear-ident"><span class="dgear-name">' + esc(row.name) + '</span>'
        + types + rtag(rarity, Object.hasOwn(RC, rarity) ? RC[rarity] : '#8b93a6') + '</div>'
        + '<div class="dgear-stages">' + stages + '</div>'
        + (full ? renderEquipmentDetails(row, kind) : '')
        + '</li>';
    }).join('')
    + '</ul></section>';
}

function renderDetail(){
  const b=BUILDS.find(x=>x.id===state.detailId);
  if(!b){closeDetail();return;}
  let h='';
  /* ① 头部：名称 + 标签 + 伤害 + 评分（打分在列表卡片上） */
  h+='<div class="dhead">'+ic(b.insc,inscName(b.insc).replace('刻印',''),'s60','#4a3f2a')
   +'<div class="main"><div class="dname">'+esc(b.name)+'</div>'
   +'<div class="chips" style="margin-top:7px">'
     +(b.features||[]).map(f=>'<span class="chip np">'+esc(f)+'</span>').join('')
     +(b.tags||[]).map(t=>'<span class="chip np" data-tag="'+esc(t)+'">#'+esc(t)+'</span>').join('')+'</div>'
   +ratingHTML(b)
   +'</div></div>';

  /* ①.5 展示形态：一枚轻量文字开关，别抢标题 */
  const full=detailFull();
  h+='<div class="dmode" role="tablist" aria-label="展示形态">'
    +'<span class="dmode-tab'+(full?'':' on')+'" role="tab" data-dmode="quick" aria-selected="'+(full?'false':'true')+'" title="只列要选的东西">速记</span>'
    +'<span class="dmode-sep">·</span>'
    +'<span class="dmode-tab'+(full?' on':'')+'" role="tab" data-dmode="full" aria-selected="'+(full?'true':'false')+'" title="连每件物品的说明一起看">完整</span>'
    +'</div>';
  /* 玩法技巧（含连招要点） */
  let tipBody='<div class="tip">'+esc(b.tip)+'</div>';
  if((b.combos||[]).length){
    tipBody+='<div class="tip" style="margin-top:7px">'+b.combos.map(c=>'· '+esc(c)).join('<br>')+'</div>';
  }
  h+=sec('玩法技巧',tipBody);

  /* 伤害参考 */
  if(b.dmg&&b.dmg!=='待补'){
    h+=sec('伤害参考','<div class="tip" style="display:flex;justify-content:space-between;align-items:center">'
      +'<span style="color:#98a0b2">'+esc(b.dmgLabel||'伤害')+'</span>'
      +'<b style="font-size:17px;color:#f0c0d8;font-weight:600">'+esc(b.dmg)+'</b></div>');
  }

  /* ④ 武器刻印：图鉴图标 + 刻印名 +（完整）效果与说明 */
  const insc=inscEntry(b.insc);
  const inscMain=(insc&&insc.effectGroups&&Array.isArray(insc.effectGroups.main))?insc.effectGroups.main:[];
  const inscEffTxt=(b.inscEff&&b.inscEff!=='待补')?String(b.inscEff).trim():'';
  {
    let body='<div class="inscrow">'+ic(b.insc,'','s46','#4a3f2a')
      +'<div class="inscmain"><div class="inscname">'+esc(inscName(b.insc))
      +'<span class="gtag t-weapon">'+esc(wName(b.wt))+'</span></div>';
    if(full){
      const effLines=inscMain.length?inscMain:(inscEffTxt?[inscEffTxt]:[]);
      if(effLines.length) body+=effBlock(effLines.join('\n'));
      if(insc&&insc.desc) body+='<div class="inscdesc">'+esc(insc.desc)+'</div>';
    }
    body+='</div></div>';
    h+=sec('武器刻印',plainBox(body));
  }

  /* ⑤ 共鸣：code 拆槽位，每档带 Lv 图标与对应文案 */
  const resRows=detailResonance(b);
  if(resRows.length){
    const code=(b.resonance&&b.resonance.code)?String(b.resonance.code):'—';
    let body='<div class="dreshead"><span class="drescap">共鸣组合</span>'
      +'<span class="drescode">'+esc(code)+'</span></div>';
    body+=resRows.map(r=>'<div class="dresrow">'
      +'<span class="dresic"><img src="'+resIcon(r.level)+'" alt="Lv.'+r.level+'"></span>'
      +'<span class="dresslot">共鸣 '+r.slot+'</span>'
      +'<span class="drestxt">'+accentText(r.text)+'</span></div>').join('');
    h+=sec('共鸣',plainBox(body));
  }

  /* ⑥ 灵魂石：速记按窗口宽度排列，完整单列 + 该等级效果 */
  const stones=Array.isArray(b.soulStones)?b.soulStones:[];
  if(stones.length||(b.soulPlan||[]).length){
    let body='';
    if(stones.length){
      body+='<div class="dstones'+(full?'':' is-compact')+'">'+stones.map((s)=>{
        const cat=SOUL_STONES.find((x)=>x.name===s.name)||null;
        const lvRaw=s.lv?String(s.lv).replace(/^Lv\.?\s*/i,''):'';
        const eff=s.eff||cat?.eff;
        return '<div class="dstone">'+ic(s.name,s.name,full?'s30':'s24','#B79BEB')
          +'<div class="dstonemain"><div class="dstonetop">'
          +'<span class="dstonename">'+esc(s.name)+'</span>'
          +(lvRaw?'<span class="dstonelv">Lv.'+esc(lvRaw)+'</span>':'')
          +(full&&!lvRaw&&cat&&cat.maxLevel>1?'<span class="dstonerange">Lv.1–'+esc(cat.maxLevel)+'</span>':'')
          +(full&&cat&&cat.slot?'<span class="dstoneslot">'+esc(cat.slot)+'</span>':'')
          +'</div>'
          +(full&&eff?renderSoulEffect(eff,lvRaw,cat?.maxLevel):'')
          +'</div></div>';
      }).join('')+'</div>';
    }
    if((b.soulPlan||[]).length){
      body+='<div class="gtitle" style="--c:#B79BEB">分配方案</div><div class="plan">'
        +b.soulPlan.map(p=>'<span class="pg"><b>'+esc(p.g)+'</b>'+esc(p.items.join(' + '))+'</span>').join('')+'</div>';
    }
    h+=sec('灵魂石',plainBox(body));
  }

  /* ⑦ 武器、衣服 */
  const equipment = domain.equipmentForDetail(b);
  h += sec('武器与衣服',
    renderEquipmentGroup('武器', 'weapon', equipment.weapons, full)
    + renderEquipmentGroup('衣服', 'armor', equipment.armors, full));

  /* ⑧ 宝藏怎么选：必选 / 推荐 / 备选，以及按顺序拿的其他宝藏 */
  const tOrder=b.treasureOrder||[];
  const tt=b.treasureTiers||{};
  const mustArr=(tt.must&&tt.must.length)?tt.must:(tt.gold||[]);
  const recArr=(tt.recommended&&tt.recommended.length)?tt.recommended:[].concat(tt.craft||[],tt.main||[]);
  const backArr=tt.backup||[];
  const chaosArr=(b.treasures&&b.treasures.chaos)||[];
  const goldArr=(b.treasures&&b.treasures.gold)||[];
  const hasTiers=mustArr.length+recArr.length+backArr.length > 0;
  if(chaosArr.length||goldArr.length||hasTiers||tOrder.length||(b.treasureNotes||[]).length){
    /* 一档一区块：标题单独一行，下面统一左对齐排，不会再出现挤在右侧换行的情况 */
    const tierBlock=(label,arr,color)=>{
      if(!arr||!arr.length) return '';
      const head='<div class="dtierlabel" style="--c:'+color+'">'+esc(label)
        +'<span class="dtiernum">'+arr.length+'</span></div>';
      if(!full){
        return '<div class="dtier">'+head+'<div class="dtierchips">'
          +arr.map(x=>'<span class="chip">'+ic(x,x,'s24',color)+esc(x)+'</span>').join('')+'</div></div>';
      }
      return '<div class="dtier">'+head+'<div class="dtierlist">'+arr.map(x=>{
        const t=TREASURES.find((y)=>y.name===x)||null;
        return renderTreasureDetail(x,t?.rarity,color,t?.effect);
      }).join('')+'</div></div>';
    };
    let body='';
    /* 每一档一个色相：原来必选/推荐直接借用稀有度的深底色，做前景色会发闷、还和"合成金"撞色。
       必选用绿（和"已选"同一套语义），推荐用蓝，跟金/紫都拉得开 */
    body+=tierBlock('混沌宝藏',chaosArr,'#B892FF')
      +tierBlock('合成金宝藏',goldArr,'#E0B44A')
      +tierBlock('必选',mustArr,'#7FC79B')
      +tierBlock('推荐',recArr,'#7FA8E8')
      +tierBlock('备选',backArr,'#8A90A2');
    if(tOrder.length){
      body+='<div class="dtierlabel" style="--c:#8b9ad4;margin-top:12px">其他宝藏 · 按这个顺序拿'
        +'<span class="dtiernum">'+tOrder.length+'</span></div>';
      body+='<div class="dorder">';
      tOrder.forEach((x,i)=>{
        const t=TREASURES.find((y)=>y.name===x.n)||null;
        const order='<span class="dordernum">'+(i+1)+'</span>';
        if(full){
          body+=renderTreasureDetail(x.n,x.r,RC[x.r]||'#3b4a63',t?.effect,order);
          return;
        }
        body+='<div class="drow">'
          +order
          +ic(x.n,x.n,'s24',RC[x.r]||'#3b4a63')
          +'<div class="dtmain"><div class="dttop"><span class="dtname">'+esc(x.n)+'</span>'
          +rtag(x.r,RC[x.r]||'#8b93a6')+'</div>'
          +'</div></div>';
      });
      body+='</div><div class="chaincap" style="margin-top:7px">按从上到下拿　·　前面的是垫底件，先拿它们，后面的才刷得出来</div>';
    }
    if((b.treasureNotes||[]).length)body+='<div class="tip" style="margin-top:9px">'+b.treasureNotes.map(n=>'· '+esc(n)).join('<br>')+'</div>';
    h+=sec('宝藏怎么选',plainBox(body));
  }

  /* ⑨ 诅咒宝藏：只留「拿不拿 / 净化不净化」的结论，完整模式补诅咒代价 */
  if((b.cursed||[]).length){
    const body=b.cursed.map(c=>'<div class="cursed">'+ic(c.name,c.name,'s30','#D995BA')
      +'<div class="cmain"><div class="ctitle">'+esc(c.name)
      +'<span class="vd '+(c.verdict==='不净化'?'keep':c.verdict==='必须净化'?'purge':'suggest')+'">'+esc(c.verdict)+'</span></div>'
      +(full&&c.eff?effBlock(c.eff):'')
      +'</div></div>').join('');
    h+=sec('诅咒宝藏',plainBox(body));
  }

  /* ⑩ 炼金与猎人道具 */
  if((b.alchemy||[]).length||(b.hunterItems||[]).length){
    const hasAlchemy=(b.alchemy||[]).length>0;
    const hasHunter=(b.hunterItems||[]).length>0;
    /* 两类都用同一套物品行，只有同时存在时才加分组标题 */
    const itemRow=(name,eff)=>'<div class="ditem">'+ic(name,name,'s30','#9DCFB4')
      +'<div class="ditemmain"><div class="ditemtop"><span class="ditemname">'+esc(name)+'</span></div>'
      +(full&&eff?effBlock(eff):'')
      +'</div></div>';
    let body='';
    if(hasAlchemy&&hasHunter) body+='<div class="gtitle" style="--c:#7CC4A0;margin-top:0">炼金</div>';
    if(hasAlchemy) body+='<div class="dlist">'+b.alchemy.map(a=>itemRow(a.name,a.eff)).join('')+'</div>';
    if(hasHunter){
      if(hasAlchemy) body+='<div class="gtitle" style="--c:#7CC4A0">猎人道具</div>';
      body+='<div class="dlist">'+b.hunterItems.map(x=>itemRow(x.name,x.eff)).join('')+'</div>';
    }
    h+=sec('炼金与猎人道具',plainBox(body));
  }

  /* ⑪ 梦魇加点：改成单列卡片，名字不再被挤断行 */
  if(Array.isArray(b.nightmareList) && b.nightmareList.length){
    h+=sec('梦魇推荐加点','<div class="box">'
      +renderNightmareProgress(b.nightmareList)
      +renderNightmareCards(b.nightmareList)+'</div>');
  }

  h+='<div class="footline"><span>作者 '+esc(b.author||'—')+' · 来源：'+esc(b.src)+'</span><span>更新 '+esc(b.updated)+'</span></div>';

  elDetail.innerHTML=h;elDetail.scrollTop=0;
  elDetail.querySelectorAll('[data-tag]').forEach(n=>{n.onclick=()=>{state.tags=[n.dataset.tag];closeDetail();render();fbtnState();};});
  elDetail.querySelectorAll('[data-dmode]').forEach(n=>{n.onclick=()=>setDetailMode(n.dataset.dmode);});
}

/* 梦魇条目：图标跨两行，名称与效果成组，点数在独立列中垂直居中。 */
function renderNightmareCards(list){
  return '<div class="nmlist">'+list.map(({n,p,points})=>
    '<div class="nmitem">'+nightmareIcon(n)
    +'<div class="nmmain"><div class="nmname">'+esc(n)+'</div>'
    +(p?'<div class="nmeff">'+accentText(p)+'</div>':'')
    +'</div>'+(points?'<span class="nmpt">'+points+'<small>点</small></span>':'')+'</div>').join('')+'</div>';
}

/* ================= 交互 ================= */
function toggleFav(id){
  state.favs.has(id)?state.favs.delete(id):state.favs.add(id);
  render();
  const el=document.querySelector('.card[data-bid="'+id+'"] .act.fav');
  if(el) motion.replay(el,'m-pop');
}
elBack.onclick=closeDetail;

/* 筛选 */
let modalCloseTimer = null;
function openModal(){
  // 打开筛选前先收起输入焦点：避免输入法候选窗/搜索栏状态残留
  if(modalCloseTimer){ clearTimeout(modalCloseTimer); modalCloseTimer=null; }
  elModal.classList.remove('closing');
  try{ if(document.activeElement && document.activeElement.blur) document.activeElement.blur(); }catch(e){}
  if(state.focusedInput) releaseFocusInput();
  state.modal=true;state.mq='';modalQuery.value='';
  // 先在隐藏状态把内容渲染好，再加 .on 触发动画：避免动画第一帧是空弹层
  renderModal();
  var panelEl=document.getElementById('panel'); if(panelEl) panelEl.classList.add('modal-open');
    var sb=document.getElementById('sbar'); if(sb) sb.classList.add('open');
  elModal.classList.add('on');
  requestAnimationFrame(syncSegThumb);
}
function closeModal(){
    if(!state.modal && !elModal.classList.contains('on')) return;
    pendingStagger = state.modal;
    state.modal=false;
    elModal.classList.add('closing');
    if(modalCloseTimer) clearTimeout(modalCloseTimer);
    modalCloseTimer = setTimeout(function(){
      elModal.classList.remove('on','closing');
      modalCloseTimer=null;
    }, 160);
    var panelEl=document.getElementById('panel'); if(panelEl) panelEl.classList.remove('modal-open');
    var sb=document.getElementById('sbar'); if(sb) sb.classList.remove('open');
    if(state.focusedInput) releaseFocusInput();
    render(); fbtnState();
  }

/* 统一空状态：面板用大字版，弹层用紧凑版（同一套结构/图标/文案层级） */
function emptyState(title, sub, compact){
  return '<div class="empty' + (compact ? ' compact' : '') + '">'
    + '<img class="empty-dog" alt="" src="../../assets/empty-dog.png">'
    + '<div class="empty-title">' + esc(title) + '</div>'
    + (sub ? '<div class="empty-sub">' + esc(sub) + '</div>' : '')
    + '</div>';
}

function cell(key,label,sub,on){
  return '<div class="mg'+(on?' on':'')+'" data-k="'+esc(key)+'">'
    +ic(key,label,'s46')
    +'<div class="cn">'+esc(label)+'</div>'
    +(sub?'<div class="cc">'+esc(sub)+'</div>':'')+'</div>';
}


function segName(){
  return filterSegments[state.seg].label;
}

function curSelList(){
  return state[filterSegments[state.seg].field];
}
function setCurSelList(v){
  state[filterSegments[state.seg].field] = v;
}
function refreshFootActions(){
  const clear=document.getElementById('mclear');
  const allBtn=document.getElementById('mall');
  const cur=curSelList().length, all=selectedCount();
  if(clear){
    clear.classList.toggle('disabled', !cur);
    clear.setAttribute('title', cur ? '清空' + segName() + '（' + cur + '）' : '当前类没有可清空的筛选');
  }
  if(allBtn){
    const others = all - cur;
    allBtn.classList.toggle('disabled', !(others > 0));
    allBtn.setAttribute('title', others > 0 ? '清空全部筛选' : '没有其他类的筛选');
  }
}

function setFilterCellSelected(item, selected) {
  item.classList.toggle('on', selected);
  if (item.hasAttribute('aria-pressed')) item.setAttribute('aria-pressed', String(selected));
}

function syncModalSelection() {
  const selected = new Set(curSelList());
  for (const item of elGrid.querySelectorAll('.mg')) {
    setFilterCellSelected(item, selected.has(item.dataset.k));
  }
  refreshFootActions();
}

elGrid.addEventListener('click', (event) => {
  const item = event.target.closest('.mg');
  if (!item || !elGrid.contains(item)) return;
  const key = item.dataset.k;
  const selected = curSelList();
  const isSelected = !selected.includes(key);
  setCurSelList(isSelected ? [...selected, key] : selected.filter((value) => value !== key));
  setFilterCellSelected(item, isSelected);
  refreshFootActions();
});


/* 分段控件滑动指示块 */
function syncSegThumb(){
  const seg=document.querySelector('#modal .mseg');
  const thumb=seg && seg.querySelector('.seg-thumb');
  const active=seg && seg.querySelector('div.on');
  if(!seg || !thumb || !active) return;
  const sr=seg.getBoundingClientRect(), ar=active.getBoundingClientRect();
  if(!ar.width) return;
  thumb.style.left=(ar.left-sr.left)+'px';
  thumb.style.top=(ar.top-sr.top)+'px';
  thumb.style.width=ar.width+'px';
  thumb.style.height=ar.height+'px';
}


/* 宝藏图标：把数据里的 icon 填进 ICON 映射，ic() 会优先用图片，失败回退首字 */

/* 武器条目 / 刻印图标：数据里的 icon 填进 ICON 映射 */
function applyCatalogIcons(){
  WEAPON_ITEMS.forEach((it) => { if (it.icon) ICON[it.name] = it.icon; });
  // 9 个武器类型图标在 wiki 上已失效：用该类型第一件装备的图标作为类型图标
  WEAPONS.forEach((w) => {
    const first = WEAPON_ITEMS.find((it) => it.wt === w.id && it.icon);
    if (first) ICON[w.id] = first.icon;
  });
  Object.values(INSC).forEach((it) => { if (it.icon) ICON[it.id] = it.icon; });
  ARMORS.forEach((it) => { if (it.icon) ICON[it.name] = it.icon; });
  SOUL_STONES.forEach((it) => { if (it.icon) ICON[it.name] = it.icon; });
  CURSED_TREASURES.forEach((it) => { if (it.icon) ICON[it.name] = it.icon; });
}

function applyTreasureIcons(){
  TREASURES.forEach((t) => { if (t.icon) ICON[t.name] = t.icon; });
}

function renderModal(animate){
  const searchText = { w: '搜索武器类型', i: '搜索刻印', equip: '搜索装备', armor: '搜索衣服', treasure: '搜索宝藏', t: '搜索标签' };
  if(modalQuery) modalQuery.placeholder = searchText[state.seg] || '搜索';
  state.filterItem = null;
  renderFilterInfo(null);
  modalQueryClear.hidden = !state.mq;
  const q=state.mq.trim().toLowerCase();
  if(animate){ elGrid.classList.remove('m-seg-in'); void elGrid.offsetWidth; elGrid.classList.add('m-seg-in'); }
  function finish(itemsLen){
    const count=document.getElementById('mcount');
    if(count) count.textContent = '共 ' + itemsLen + ' 项';
    const empty = itemsLen === 0;
    elGrid.classList.toggle('is-empty', empty);
    const modalEl = document.getElementById('modal');
    if(modalEl) modalEl.classList.toggle('no-info', empty || state.seg === 't');
    refreshFootActions();
  }
  if (state.seg === 'treasure') {
    // 全量宝藏目录优先；数据未就绪时退回流派里出现过的宝藏
    const all = TREASURES.length ? TREASURES.map((t) => t.name) : domain.listTreasures(BUILDS, '');
    const items = q ? all.filter((name) => name.toLowerCase().includes(q)) : all;
    elGrid.innerHTML = items.length
      ? items.map((name) => cell(name, name, '', state.filterTreasures.includes(name))).join('')
      : emptyState(q ? '没有匹配的宝藏 (・_・;)' : '宝藏目录还没同步 (´･ω･`)',
        q ? '换个关键词试试看' : '等下次数据更新，这里会自动出现', true);
    finish(items.length);
    return;
  }
  if(state.seg==='t'){
    const items = domain.listTags(BUILDS, q);
    elGrid.innerHTML = items.length ? items.map(([tag, count]) => {
      const selected = state.tags.includes(tag);
      return '<button type="button" class="mg mg-tag'+(selected?' on':'')+'" data-k="'+esc(tag)+'" aria-pressed="'+selected+'">'
        +'<span class="mg-label">'+esc(tag)+'</span>'
        +'<span class="cc">'+count+' 个流派</span></button>';
    }).join('') : emptyState(q ? '没有匹配的标签' : '还没有流派标签',
      q ? '换个关键词试试看' : '有流派带上标签后，就能在这里筛选。', true);
    finish(items.length);
    return;
  }
  if(state.seg==='w'){
    const items=WEAPONS.filter(w=>!q||(w.name+w.short).toLowerCase().includes(q));
    elGrid.innerHTML = items.length ? items.map(w=>cell(w.id,w.name,'',state.filterW.indexOf(w.id)>=0)).join('')
      : emptyState('没有匹配的武器 (・_・;)','换个关键词试试看', true);
    finish(items.length);
  }else if(state.seg==='armor'){
    const items = ARMORS.filter((it) => {
      if(!q) return true;
      return (it.name + ' ' + (it.kind||'')).toLowerCase().includes(q);
    });
    elGrid.innerHTML = items.length
      ? items.map((it) => cell(it.name, it.name, it.kind || '', state.filterArmor.indexOf(it.name)>=0)).join('')
      : emptyState('没有匹配的衣服 (・_・;)','换个关键词试试看', true);
    finish(items.length);
  }else if(state.seg==='equip'){
    const items = WEAPON_ITEMS.filter((it) => {
      if(!q) return true;
      const t = W(it.wt);
      return (it.name + ' ' + (t.name||'') + ' ' + (t.short||'')).toLowerCase().includes(q);
    });
    elGrid.innerHTML = items.length
      ? items.map((it) => cell(it.name, it.name, W(it.wt).short, state.filterEquip.indexOf(it.name)>=0)).join('')
      : emptyState('没有匹配的装备 (・_・;)','换个关键词试试看', true);
    finish(items.length);
  }else{
    const items=Object.values(INSC).filter(i=>!q||i.name.toLowerCase().includes(q));
    elGrid.innerHTML = items.length ? items.map(i=>cell(i.id,i.name.replace('刻印',''),W(i.wt).short,state.filterI.indexOf(i.id)>=0)).join('')
      : emptyState('没有匹配的刻印 (・_・;)','换个关键词试试看', true);
    finish(items.length);
  }
}
function renderFilterInfo(item){
  const box = $('minfo');
  if(!box) return;
  box.innerHTML = item ? buildItemInfo(item) : '<div class="si-empty">鼠标移到图鉴上<br>这里会显示说明</div>';
}

elGrid.addEventListener('mouseover', (event) => {
  const item = event.target.closest('.mg');
  if (!item || !elGrid.contains(item)) return;
  state.filterItem = filterItemByKey(state.seg, item.dataset.k);
  renderFilterInfo(state.filterItem);
});
elGrid.addEventListener('click', (event) => {
  const item = event.target.closest('.mg');
  if (!item || !elGrid.contains(item)) return;
  state.filterItem = filterItemByKey(state.seg, item.dataset.k);
  renderFilterInfo(state.filterItem);
});
document.getElementById('itemDetailClose').onclick = closeItemDetail;
document.getElementById('itemDetail').addEventListener('click', (e) => { if (e.target.id === 'itemDetail') closeItemDetail(); });

elFbtn.onclick=(ev)=>{
  const t=ev.target;
  if(t && t.closest && (t.closest('#fopen') || t.closest('#fchev'))){ releaseFocusInput(); openModal(); return; }
  acquireFocusInput(searchQuery);
};
const $pinbtn=$('pinbtn');
$pinbtn.onclick=()=>{
  motion.press($pinbtn);
  $pinbtn.classList.toggle('on');   // 立即反馈，主进程回包再校正
  if(typeof window.lc2!=='undefined' && window.lc2.pinToggle){ window.lc2.pinToggle(); }
  else { const on=$pinbtn.classList.toggle('on'); showToast(on?'已置顶':'已取消置顶'); }
};
if(typeof window.lc2!=='undefined' && window.lc2.onPin){
  window.lc2.onPin(function(p){
    $pinbtn.classList.toggle('on',!!p);
    showToast(p?'已置顶':'已取消置顶');
  });
}

/* 列表工具栏：有筛选时显示清空图标 */
{
  const lclearBtn = document.getElementById('lclear');
  if (lclearBtn) lclearBtn.onclick = function(){
    if (!activeFilters().length) return;
    clearAllFilters();
    render(); fbtnState();
    showToast('已清空全部筛选');
  };
}

/* 筛选列表滚动时，让半隐滚动条短暂浮现 */
let gridScrollTimer = null;
if (elGrid) {
  elGrid.addEventListener('scroll', function () {
    elGrid.classList.add('scrolling');
    clearTimeout(gridScrollTimer);
    gridScrollTimer = setTimeout(function () { elGrid.classList.remove('scrolling'); }, 700);
  }, { passive: true });
}

/* 排序（在筛选弹层里） */
function syncSortUI(){
  const sorter=document.getElementById('sorter');
  if(sorter) sorter.dataset.sort = state.sort;
  document.querySelectorAll('#sorter .sbtn').forEach(x=>x.classList.toggle('on',x.dataset.sort===state.sort));
}
/* 换排序规则后整个列表顺序都变了，高亮若停在原来那张卡上会像「点错了」，
 * 所以统一把结果里的第一条选中，并回到列表顶部。 */
function applySort(sort){
  state.sort=sort;
  state.ratingOpen=null;
  syncSortUI();
  const first=firstVisibleId();
  if(first) state.cur=first;
  render();
  elFeed.scrollTop=0;
  syncFeedScroll();
  fbtnState();
}
document.querySelectorAll('#sorter .sbtn').forEach(d=>{
  d.onclick=()=>applySort(d.dataset.sort);
});

/* ================= 投稿编辑器：从图鉴选内容，降低录入门槛 ================= */
const $sbtn=$('sbtn'),$toast=$('toast');
let toastTimer=null;
function showToast(msg,ms){
  $toast.innerHTML=msg;$toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$toast.classList.remove('on'),ms||4200);
}

const submit = { wt: '', insc: '', transition: [], graduation: [], slot: 'transition', armorTransition: [], armorGraduation: [], armorSlot: 'transition', treasureTiers: { must: [], recommended: [], backup: [] }, treasureSlot: 'must', soulStones: [], cursed: { none: [], suggest: [], must: [] }, cursedSlot: 'none', resonance: ['', '', ''], stoneOrder: ['red', 'green', 'blue'], stoneConfirmed: false, tags: [] };
const nightmareSelections = new Map();
const SLOT_ICON = {
  transition: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6l6 6-6 6M14 6l6 6-6 6"/></svg>',
  graduation: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 3 14.7 9 21 9.8 16.5 14 17.6 20.3 12 17.2 6.4 20.3 7.5 14 3 9.8 9.3 9 12 3"/></svg>',
  'cursed-none': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><path d="M6.6 6.6l10.8 10.8"/></svg>',
  'cursed-suggest': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.3 6 11a6 6 0 0 1-12 0c0-4.7 6-11 6-11z"/></svg>',
  'cursed-must': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 4.8h2.8l-.6 9.6h-1.6z" fill="currentColor" stroke="none"/><circle cx="12" cy="18.4" r="1.55" fill="currentColor" stroke="none"/></svg>',
  'treasure-must': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l2.3 4.8 5.2.7-3.8 3.7.9 5.2L12 16l-4.6 2.4.9-5.2L4.5 9.5l5.2-.7z"/></svg>',
  'treasure-recommended': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.2"/><path d="M8.7 12.2l2.2 2.2 4.4-4.6"/></svg>',
  'treasure-backup': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16l-6-4-6 4z"/></svg>',
};
state.submitOpen = false;
const $subModal = $('submitModal');

function subSet(id, v){ const el = $(id); if (el) el.textContent = String(v); }

function subSplit(v){
  return String(v || '').split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
}
function renderStonePrio(){
  const wrap = $('stonePrio');
  if(!wrap) return;
  submit.stoneOrder = Array.from(wrap.querySelectorAll('.rune-row')).map((row) => row.dataset.stone);
}
function applyStoneOrder(order){
  const wrap = $('stonePrio');
  if(!wrap) return;
  order.forEach((stone) => {
    const row = wrap.querySelector('[data-stone="' + stone + '"]');
    if(row) wrap.appendChild(row);
  });
  submit.stoneOrder = order.slice();
  submit.stoneConfirmed = false;
  renderStonePrio();
  renderStoneConfirm();
}
let runeDrag = null;
(function bindRuneDrag(){
  const wrap = $('stonePrio');
  if(!wrap) return;
  wrap.addEventListener('pointerdown', (ev) => {
    if(ev.button !== 0) return;
    const row = ev.target.closest('.rune-row');
    if(!row) return;
    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);
    row.classList.add('drag-origin');
    runeDrag = { row, ghost, offsetY: ev.clientY - rect.top };
    try { row.setPointerCapture(ev.pointerId); } catch(e){}
    ev.preventDefault();
  });
  document.addEventListener('pointermove', (ev) => {
    if(!runeDrag) return;
    runeDrag.ghost.style.top = (ev.clientY - runeDrag.offsetY) + 'px';
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.rune-row');
    if(!target || target === runeDrag.row || !wrap.contains(target)) return;
    const before = Array.from(wrap.children).map((el) => [el, el.getBoundingClientRect().top]);
    const rect = target.getBoundingClientRect();
    const after = ev.clientY > rect.top + rect.height / 2;
    wrap.insertBefore(runeDrag.row, after ? target.nextSibling : target);
    const afterMap = new Map(Array.from(wrap.children).map((el) => [el, el.getBoundingClientRect().top]));
    for(const [el, top] of before){
      if(el === runeDrag.row) continue;
      const nextTop = afterMap.get(el);
      if(nextTop === undefined || nextTop === top) continue;
      el.animate(
        [{ transform: `translateY(${top - nextTop}px)` }, { transform: 'none' }],
        { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
    }
  });
  function end(){
    if(!runeDrag) return;
    runeDrag.ghost.remove();
    runeDrag.row.classList.remove('drag-origin');
    runeDrag = null;
    submit.stoneConfirmed = false;
    renderStonePrio();
    renderStoneConfirm();
  }
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
})();

function renderStoneConfirm(){
  const btn = $('stoneConfirm');
  if(!btn) return;
  btn.classList.toggle('on', !!submit.stoneConfirmed);
  btn.setAttribute('aria-pressed', submit.stoneConfirmed ? 'true' : 'false');
  const label = btn.querySelector('.rune-confirm-label');
  if(label) label.textContent = submit.stoneConfirmed ? '已确认当前顺序' : '确认当前顺序';
  btn.title = submit.stoneConfirmed ? '已确认符文优先级，点击取消' : '确认符文优先级';
}
const stoneConfirmBtn = $('stoneConfirm');
if(stoneConfirmBtn) stoneConfirmBtn.addEventListener('click', () => {
  submit.stoneConfirmed = !submit.stoneConfirmed;
  renderStoneConfirm();
  if(submit.stoneConfirmed) showToast('符文优先级已确认');
});
renderStoneConfirm();

const subTagInput = $('subTagInput');
const subTagAdd = $('subTagAdd');
function syncSubTagAdd(){
  if (subTagAdd) subTagAdd.disabled = !subTagInput?.value.trim();
}

function renderSubTags(){
  syncSubTagAdd();
  const list = $('subTagList');
  if(!list) return;
  list.innerHTML = '';
  submit.tags.forEach((tag, idx) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    const label = document.createElement('span');
    label.textContent = tag;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tag-x';
    close.textContent = '×';
    close.title = '移除标签';
    close.setAttribute('aria-label', '移除标签 ' + tag);
    close.addEventListener('click', (ev) => {
      ev.stopPropagation();
      submit.tags.splice(idx, 1);
      renderSubTags();
      $('subTagInput')?.focus();
    });
    chip.appendChild(label);
    chip.appendChild(close);
    list.appendChild(chip);
  });
}
function addSubTags(raw){
  const parts = String(raw || '').split(/[,，、]+/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean);
  let added = false;
  for(const value of parts){
    if(value.length > 12){ showToast('单个标签最多 12 个字'); continue; }
    if(submit.tags.includes(value)){ continue; }
    if(submit.tags.length >= 8){ showToast('最多添加 8 个标签'); break; }
    submit.tags.push(value);
    added = true;
  }
  if (added) renderSubTags();
  else if (parts.length && parts.every((value) => submit.tags.includes(value))) showToast('这个标签已添加');
  return added;
}
function commitSubTagInput(){
  const input = $('subTagInput');
  if(!input) return false;
  const added = addSubTags(input.value);
  if(added || !input.value.trim()) input.value = '';
  syncSubTagAdd();
  return added;
}
if(subTagInput){
  subTagInput.addEventListener('input', syncSubTagAdd);
  subTagInput.addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    if(ev.key === 'Enter' || ev.key === ',' || ev.key === '，' || ev.key === '、'){
      ev.preventDefault();
      commitSubTagInput();
    } else if(ev.key === 'Backspace' && !subTagInput.value && submit.tags.length){
      submit.tags.pop();
      renderSubTags();
    }
  });
}
subTagAdd?.addEventListener('click', () => {
  commitSubTagInput();
  subTagInput?.focus();
});
$('subTagEditor')?.addEventListener('click', (ev) => {
  if (ev.target !== subTagAdd) subTagInput?.focus();
});
renderSubTags();

function buildItemInfo(item){
  const asText = (value) => {
    if (typeof value === 'string') return value.trim();
    if (value && typeof value === 'object') {
      if (typeof value.text === 'string') return value.text.trim();
      if (typeof value.desc === 'string') return value.desc.trim();
      if (typeof value.name === 'string' && value.text !== undefined) return value.text.trim();
    }
    return '';
  };
  const cleanRepeats = (text) => String(text || '')
    .replace(/(特殊动作|普通攻击|武器技能|跳跃|闪避|蓄力攻击)\1/g, '$1')
    .replace(/攻击(普通攻击|特殊动作)/g, '$1')
    .trim();
  const highlightNumbers = (text) => {
    const raw = String(text || '');
    return raw.split(/([+-]?\d+(?:\.\d+)?%?)/).map((part, i) => {
      if (i % 2 === 1) return '<em>' + esc(part) + '</em>';
      return esc(part);
    }).join('');
  };
  const splitParagraphs = (text) => String(text || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const splitEffect = (text) => {
    const out = [];
    for (const line of String(text || '').split(/\n+/)) {
      const parts = line.match(/[^。；！？\n]+[。；！？]?/g) || [line];
      for (const part of parts) {
        const t = part.trim();
        if (t) out.push(t);
      }
    }
    return out;
  };

  const meta = [];
  if(item.wt && typeof W === 'function') { try { meta.push(W(item.wt).name); } catch(e){} }
  if(item.kind){ if(item.kind==='hunter') meta.push('通用刻印'); else if(item.kind==='specific') meta.push('专属刻印'); else meta.push(asText(item.kind)); }
  const rarity = asText(item.rarity);
  if(rarity) meta.push(rarity);
  if(item.grade) meta.push('品级 ' + asText(item.grade));
  if(item.slot) meta.push(asText(item.slot));
  if(typeof item.maxLevel === 'number' && item.maxLevel) meta.push('等级上限 ' + item.maxLevel);
  if(item.depth) meta.push('深度 ' + asText(item.depth));
  if(item.unobtainable) meta.push('无法正常生成');
  const desc = asText(item.desc || item.description || item.note);
  let effect = cleanRepeats(asText(item.effect || item.eff));
  let curse = '';
  const curseMatch = effect.match(/[；;]\s*诅咒\s*[:：]\s*([\s\S]*)$/);
  if(curseMatch){
    curse = curseMatch[1].trim();
    effect = effect.slice(0, curseMatch.index).trim();
  }
  const stats = asText(item.stats);
  const tags = (Array.isArray(item.tags) ? item.tags : Array.isArray(item.subs) ? item.subs : (typeof item.tags === 'string' && item.tags ? item.tags.split(/[,\s]+/) : []))
    .map(asText).filter(Boolean);
  const source = asText(item.source);
  const rarityClass = ({'初始':'r0','普通':'r1','优秀':'r2','稀有':'r3','史诗':'r4','传奇':'r5'})[rarity] || '';
  const metaHTML = meta.map((t) => {
    const isRarity = t === rarity;
    return '<span class="si-chip' + (isRarity ? ' si-rarity ' + rarityClass : '') + '">' + esc(t) + '</span>';
  }).join('');
  const statLines = stats.split(/[；\n]+/).map((x) => x.trim()).filter(Boolean);
  const descHTML = splitParagraphs(desc).map((p) => '<p class="si-p">' + esc(p) + '</p>').join('');
  const effectLines = splitEffect(effect);
  const g = item.effectGroups;
  const levelParts = effect ? effect.split(/\s*\/\s*(?=Lv\.\d+)/).map((x) => x.trim()).filter(Boolean) : [];
  let effectHTML;
  if(levelParts.length > 1){
    effectHTML = '<div class="si-level-list">' + levelParts.map((part) => {
      const m = part.match(/^(Lv\.\d+)\s*(.*)$/s);
      const tag = m ? m[1] : '';
      const text = m ? m[2] : part;
      return '<div class="si-level-row">' + (tag ? '<span class="si-level-tag">' + esc(tag) + '</span>' : '') + '<span class="si-level-text">' + highlightNumbers(text) + '</span></div>';
    }).join('') + '</div>';
  } else if(g && (Array.isArray(g.main) || Array.isArray(g.groups))){
    const mainLines = Array.isArray(g.main) ? g.main.filter(Boolean) : [];
    const rawGroups = Array.isArray(g.groups) ? g.groups : [];
    const resBlocks = rawGroups.map((rg, idx) => {
      const entries = Array.isArray(rg) ? rg : (rg && Array.isArray(rg.lines) ? [rg] : []);
      return { title: '共鸣组 ' + (idx + 1), entries };
    }).filter((b) => b.entries.length);
    effectHTML = (mainLines.length ? '<div class="si-effect-main"><div class="si-effect-sub">主效果</div><div class="si-effect-list">' + mainLines.map((line) => '<div class="si-effect-line"><span class="si-eqtext">' + highlightNumbers(line) + '</span></div>').join('') + '</div></div>' : '')
      + (resBlocks.length ? '<div class="si-resonance"><div class="si-effect-sub">共鸣</div>'
        + resBlocks.map((block) => '<div class="si-resblock"><div class="si-res-title">' + block.title + '</div>' + block.entries.map((entry) => '<div class="si-resgroup"><span class="si-lv">Lv.' + (entry.level || 1) + '</span><div class="si-reslines">' + (entry.lines || []).map((line) => '<p class="si-p">' + highlightNumbers(line) + '</p>').join('') + '</div></div>').join('') + '</div>').join('') + '</div>' : '');
  } else if(effectLines.length > 1) {
    effectHTML = '<div class="si-effect-list">' + effectLines.map((line, i) => '<div class="si-effect-line"><span class="si-eq">' + String(i + 1).padStart(2, '0') + '</span><span class="si-eqtext">' + highlightNumbers(line) + '</span></div>').join('') + '</div>';
  } else {
    effectHTML = effect ? '<div class="si-text">' + highlightNumbers(effect) + '</div>' : '';
  }
  return '<div class="si-hero"><div class="si-pic">' + ic(item.iconKey || item.name, item.name, 's60') + '</div>'
    + '<div class="si-name">' + esc(item.name) + '</div>'
    + (meta.length ? '<div class="si-meta">' + metaHTML + '</div>' : '')
    + '</div>'
    + (desc ? '<div class="si-sec si-desc"><div class="si-label">说明</div><div class="si-text">' + descHTML + '</div></div>' : '')
    + (effect ? '<div class="si-sec si-effect"><div class="si-label">效果</div>' + effectHTML + '</div>' : '')
    + (curse ? '<div class="si-sec si-curse"><div class="si-label">诅咒</div><div class="si-text">' + esc(curse) + '</div></div>' : '')
    + (statLines.length ? '<div class="si-sec si-attrs"><div class="si-label">属性</div><div class="si-stats">' + statLines.map((line) => '<div class="si-stat">' + esc(line) + '</div>').join('') + '</div></div>' : '')
    + (source ? '<div class="si-sec"><div class="si-label">获取</div><div class="si-text">' + esc(source) + '</div></div>' : '')
    + (tags.length ? '<div class="si-sec"><div class="si-label">标签</div><div class="si-tags">' + tags.map((t) => '<span class="si-tag">' + esc(t) + '</span>').join('') + '</div></div>' : '')
    + (!desc && !effect && !stats ? '<div class="si-sec"><div class="si-text dim">说明信息待补</div></div>' : '');
}

const SUBINFO_EMPTY = '<div class="si-empty">点选图鉴里的任意一件<br>这里会显示它的说明</div>';

function showItemInfo(item){
  const box = $('subInfo');
  state.lastSubmitItem = item;
  if(box){
    box.innerHTML = buildItemInfo(item);
  }
}

function openItemDetail(item){
  if(!item) return;
  const body = $('itemDetailBody'), modal = $('itemDetail');
  if(!body || !modal) return;
  body.innerHTML = buildItemInfo(item);
  modal.classList.add('on');
}

function closeItemDetail(){
  const modal = $('itemDetail');
  if(modal) modal.classList.remove('on');
}

function filterItemByKey(seg, key){
  if(seg === 'w') return WEAPONS.find((x) => x.id === key) || null;
  if(seg === 'i') return INSC[key] ? { ...INSC[key], name: INSC[key].name } : null;
  if(seg === 'equip') return WEAPON_ITEMS.find((x) => x.name === key) || null;
  if(seg === 'armor') return ARMORS.find((x) => x.name === key) || null;
  if(seg === 'treasure') return TREASURES.find((x) => x.name === key) || null;
  return null;
}

function subCell(item, selected, onClick, iconKey, label){
  const el = document.createElement('div');
  el.className = 'subcell' + (selected ? ' on' : '');
  el.innerHTML = ic(iconKey || item.name, item.name, 's46') + `<div class="sn">${esc(label || item.name)}</div>`;
  el.title = item.eff ? (item.name + '：' + item.eff) : item.name;
  el.onclick = (ev) => { showItemInfo(item); onClick(ev); };
  return el;
}

function subPreview(){
  const nameEl = $('spvName'), metaEl = $('spvMeta'), tipEl = $('spvTip');
  if (!nameEl) return;
  nameEl.textContent = ($('subName').value || '').trim() || '流派名';
  const wt = submit.wt ? wName(submit.wt) : '武器未选';
  const insc = submit.insc ? (INSC[submit.insc]?.name || submit.insc).replace('刻印', '') : '刻印未选';
  metaEl.textContent = wt + ' · ' + insc;
  tipEl.textContent = ($('subTip').value || '').trim() || '一句话技巧';
}

function subRenderWt(){
  const grid = $('subWtGrid');
  grid.innerHTML = '';
  const q = ($('subWtSearch')?.value || '').trim().toLowerCase();
  WEAPONS.filter((it) => !q || (it.name + ' ' + (it.short || '') + ' ' + (it.note || '')).toLowerCase().includes(q)).forEach((it) => {
    grid.appendChild(subCell(it, submit.wt === it.id, () => {
      submit.wt = submit.wt === it.id ? '' : it.id;
      subRenderWt(); subRenderInsc(); subRenderEquip(); subStatus();
    }, it.id, it.name));
  });
  subSet('subWtVal', submit.wt ? wName(submit.wt) : '');
  subPreview();
}

function subInscList(){
  return Object.keys(INSC).map((id) => INSC[id]);
}

let resMenuSlot = -1;

function resGroups(){
  const item = INSC[submit.insc];
  const groups = item && item.effectGroups && item.effectGroups.groups;
  if(!Array.isArray(groups)) return [];
  const out = groups.slice(0, 3);
  while(out.length < 3) out.push([]);
  return out;
}

function resEntries(slotIdx){
  const group = resGroups()[slotIdx];
  return Array.isArray(group) ? group : [];
}

function selectedSoulStones(){
  return submit.soulStones.map((name) => SOUL_STONES.find((stone) => stone.name === name)).filter(Boolean);
}

function resIcon(level){
  return '../../assets/resonance-lv' + (level >= 2 ? (level >= 3 ? 3 : 2) : 1) + '.png';
}

function highlightStoneSlots(shape){
  document.querySelectorAll('.stone-slot.hint').forEach((el) => el.classList.remove('hint'));
  if(!shape) return;
  document.querySelectorAll('.stone-slot.is-empty[data-shape="' + shape + '"]').forEach((el) => el.classList.add('hint'));
}

function buildResChain(nodeFactory, loadout = domain.soulLoadout(selectedSoulStones())){
  const shapePath = {
    triangle: '<path d="M12 4l8 14H4z"/>',
    square: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    circle: '<circle cx="12" cy="12" r="7"/>',
    hexagon: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/>',
  };
  const shapeName = { triangle: '三角形', square: '方形', circle: '圆形', hexagon: '六边形' };
  const { groups, extras } = loadout;
  const stoneSlot = ({ shape, stone }) => {
    if(stone) return '<span class="stone-slot filled" data-shape="' + shape + '" title="' + esc(stone.name) + '"><img src="' + esc(stone.icon || '') + '" alt=""></span>';
    return '<span class="stone-slot is-empty" data-shape="' + shape + '" title="' + shapeName[shape] + '槽位 · 未镶嵌"><svg viewBox="0 0 24 24" aria-hidden="true">' + shapePath[shape] + '</svg></span>';
  };
  const steps = groups.map((group, idx) => {
    const slots = group.map(stoneSlot).join('');
    const value = parseInt(submit.resonance[idx], 10) || 0;
    const opts = resEntries(idx);
    const entry = value ? opts[value - 1] : null;
    return slots + nodeFactory(idx, entry, opts);
  });
  if(extras.length){
    steps[steps.length - 1] += '<span class="chain-extra" title="' + esc(extras.map((s) => s.name).join('、')) + '">+' + extras.length + '</span>';
  }
  return steps.map((step) => '<span class="soulres-step">' + step + '</span>').join('');
}

function renderSoulRes(loadout){
  const box = $('subSoulRes');
  if(!box) return;
  if(!submit.insc){ box.hidden = true; return; }
  box.hidden = false;
  const slots = $('subSoulResSlots');
  const code = $('subSoulResCode');
  const picks = submit.resonance;
  if(code) code.textContent = picks.some(Boolean) ? picks.map((v) => v || 0).join('-') : '尚未选择共鸣';
  if(!slots) return;
  slots.innerHTML = buildResChain((idx, entry, opts) => {
    if(entry){
      const level = entry.level || 1;
      return '<span class="soulres-node filled" title="共鸣 ' + (idx + 1) + ' · ' + esc((entry.lines || [])[0] || '') + '"><img src="' + resIcon(level) + '" alt="Lv.' + level + '"></span>';
    }
    return '<span class="soulres-node is-empty" title="共鸣 ' + (idx + 1) + '：' + (opts.length ? '尚未选择' : '无可用选项') + '"><span class="rplus">' + (opts.length ? '+' : '–') + '</span></span>';
  }, loadout);
}

function renderResBar(){
  const bar = $('subResBar');
  if(!bar) return;
  renderSoulRes();
  const groups = resGroups();
  const hasOptions = groups.some((g) => Array.isArray(g) && g.length);
  if(!submit.insc){
    bar.hidden = true;
    resMenuSlot = -1;
    return;
  }
  bar.hidden = false;
  const slots = $('subResSlots');
  if(slots){
    slots.innerHTML = buildResChain((idx, entry, opts) => {
      const cls = 'soulres-node' + (entry ? ' filled' : (opts.length ? ' is-empty' : ' is-empty'));
      const title = entry ? ('共鸣 ' + (idx + 1) + ' · ' + esc((entry.lines || [])[0] || '')) : ('共鸣 ' + (idx + 1) + '：' + (opts.length ? '选择共鸣' : '无可用选项'));
      const disabled = opts.length ? '' : ' disabled';
      return '<button type="button" class="' + cls + '" data-res-slot="' + idx + '"' + disabled + ' title="' + title + '">'
        + (entry ? '<img src="' + resIcon(entry.level) + '" alt="Lv.' + (entry.level || 1) + '">' : '<span class="rplus">' + (opts.length ? '+' : '–') + '</span>')
        + '</button>';
    });
  }
  const hint = $('subResHint');
  if(hint) hint.textContent = submit.resonance.some(Boolean) ? '已选 ' + submit.resonance.map((v) => v || 0).join('-') : '尚未选择共鸣';
  const menu = $('subResMenu');
  if(!menu) return;
  if(resMenuSlot < 0){
    menu.hidden = true;
    menu.innerHTML = '';
    return;
  }
  const entries = resEntries(resMenuSlot);
  menu.hidden = false;
  menu.innerHTML = '<div class="resmenu-title">选择共鸣</div>'
    + (entries.length
      ? entries.map((entry, idx) => '<button type="button" class="resopt" data-res-value="' + (idx + 1) + '">'
        + '<img class="ricon" src="' + resIcon(entry.level) + '" alt="Lv.' + (entry.level || 1) + '">'
        + '<span class="roptext">' + esc((entry.lines || [])[0] || '') + '</span></button>').join('')
      : '<div class="resmenu-empty">该位置没有可选的共鸣</div>')
    + '<button type="button" class="resclear" data-res-clear="1">清空该共鸣</button>';
}

function bindResBar(){
  const bar = $('subResBar');
  if(!bar || bar.dataset.bound) return;
  bar.dataset.bound = '1';
  document.addEventListener('click', (ev) => {
    if(!ev.target || !ev.target.isConnected) return;
    if(resMenuSlot >= 0 && !ev.target.closest('#subResBar')){ resMenuSlot = -1; renderResBar(); }
  });
  bar.addEventListener('click', (ev) => {
    const slot = ev.target.closest('[data-res-slot]');
    if(slot){ const idx = Number(slot.dataset.resSlot); resMenuSlot = resMenuSlot === idx ? -1 : idx; renderResBar(); return; }
    const opt = ev.target.closest('[data-res-value]');
    if(opt && resMenuSlot >= 0){
      submit.resonance[resMenuSlot] = opt.dataset.resValue;
      resMenuSlot = -1;
      renderResBar();
      return;
    }
    const clear = ev.target.closest('[data-res-clear]');
    if(clear && resMenuSlot >= 0){
      submit.resonance[resMenuSlot] = '';
      resMenuSlot = -1;
      renderResBar();
    }
  });
  renderSoulRes();
}

function currentWeaponFilter(id){
  const toggle = $(id);
  if (!toggle) return '';
  toggle.disabled = !submit.wt;
  if (toggle.disabled) toggle.classList.remove('on');
  const enabled = toggle.classList.contains('on');
  toggle.setAttribute('aria-pressed', String(enabled));
  return enabled ? submit.wt : '';
}

function bindCurrentWeaponFilter(id, render){
  const toggle = $(id);
  toggle?.addEventListener('click', () => {
    if (toggle.disabled) return;
    toggle.classList.toggle('on');
    render();
  });
}

function subRenderInsc(){
  const grid = $('subInscGrid');
  const q = ($('subInscSearch')?.value || '').trim().toLowerCase();
  const wt = currentWeaponFilter('subInscOnlyWt');
  grid.innerHTML = '';
  subInscList().filter((it) => {
    if(wt && it.wt !== wt) return false;
    return !q || it.name.toLowerCase().includes(q);
  }).forEach((it) => {
    grid.appendChild(subCell(it, submit.insc === it.id, () => {
      const next = submit.insc === it.id ? '' : it.id;
      if(next !== submit.insc) submit.resonance = ['', '', ''];
      submit.insc = next;
      resMenuSlot = -1;
      subRenderInsc(); subStatus(); renderResBar();
    }, it.id, it.name.replace('刻印', '')));
  });
  subSet('subInscVal', submit.insc ? (INSC[submit.insc]?.name || submit.insc) : '');
  renderResBar();
  subPreview();
}

bindResBar();
const soulGrid = $('subSoulGrid');
if(soulGrid){
  soulGrid.addEventListener('mouseover', (ev) => {
    const cell = ev.target.closest('.subcell');
    if(cell) highlightStoneSlots(cell.dataset.shape || '');
  });
  soulGrid.addEventListener('mouseleave', () => highlightStoneSlots(''));
}

const subWtSearch = $('subWtSearch');
if(subWtSearch) subWtSearch.addEventListener('input', subRenderWt);
const subInscSearch = $('subInscSearch');
if(subInscSearch) subInscSearch.addEventListener('input', subRenderInsc);
bindCurrentWeaponFilter('subInscOnlyWt', subRenderInsc);
bindCurrentWeaponFilter('subEquipOnlyWt', subRenderEquip);

function subRenderEquip(){
  const q = ($('subEquipSearch').value || '').trim().toLowerCase();
  const wt = currentWeaponFilter('subEquipOnlyWt');
  const grid = $('subEquipGrid');
  grid.innerHTML = '';
  WEAPON_ITEMS.filter((it) => (!wt || it.wt === wt) && (!q || it.name.toLowerCase().includes(q))).forEach((it) => {
    const inTransition = submit.transition.includes(it.name);
    const inGraduation = submit.graduation.includes(it.name);
    const el = subCell(it, inTransition || inGraduation, () => {
      const list = submit[submit.slot];
      const at = list.indexOf(it.name);
      if (at >= 0) list.splice(at, 1);
      else {
        const otherKey = submit.slot === 'graduation' ? 'transition' : 'graduation';
        const oi = submit[otherKey].indexOf(it.name);
        if (oi >= 0) submit[otherKey].splice(oi, 1);
        list.push(it.name);
      }
      subRenderEquip(); subRenderSlots(); subStatus();
    });
    el.classList.add('eqcell');
    if (inTransition) el.classList.add('transition');
    if (inGraduation) el.classList.add('graduation');
    const slot = inTransition ? 'transition' : inGraduation ? 'graduation' : null;
    if (slot) {
      const badge = document.createElement('span');
      badge.className = 'slotbadge ' + slot;
      const src = document.querySelector('#submitModal .equipment-slots .subslot[data-slot="' + slot + '"] svg');
      badge.innerHTML = src ? src.outerHTML : SLOT_ICON[slot];
      el.appendChild(badge);
    }
    grid.appendChild(el);
  });
}

function subRenderSlots(){
  document.querySelectorAll('#submitModal .subslot').forEach((box) => {
    box.classList.toggle('on', box.dataset.slot === submit.slot);
  });
}

function subRenderArmor(){
  const q = ($('subArmorSearch').value || '').trim().toLowerCase();
  const slotKey = submit.armorSlot === 'graduation' ? 'armorGraduation' : 'armorTransition';
  const otherKey = slotKey === 'armorGraduation' ? 'armorTransition' : 'armorGraduation';
  const grid = $('subArmorGrid');
  grid.innerHTML = '';
  ARMORS.filter((it) => !q || it.name.toLowerCase().includes(q)).forEach((it) => {
    const inTransition = submit.armorTransition.includes(it.name);
    const inGraduation = submit.armorGraduation.includes(it.name);
    const el = subCell(it, inTransition || inGraduation, () => {
      const list = submit[slotKey];
      const at = list.indexOf(it.name);
      if (at >= 0) list.splice(at, 1);
      else {
        const oi = submit[otherKey].indexOf(it.name);
        if (oi >= 0) submit[otherKey].splice(oi, 1);
        list.push(it.name);
      }
      subRenderArmor(); subRenderArmorSlots(); subStatus();
    });
    el.classList.add('eqcell');
    const group = inTransition ? 'transition' : inGraduation ? 'graduation' : '';
    if (group) {
      const badge = document.createElement('span');
      badge.className = 'slotbadge ' + group;
      const src = document.querySelector('#submitModal .armor-slots .subslot[data-slot="' + group + '"] svg');
      badge.innerHTML = src ? src.outerHTML : SLOT_ICON[group];
      el.appendChild(badge);
    }
    grid.appendChild(el);
  });
}

function subRenderArmorSlots(){
  document.querySelectorAll('#submitModal .armor-slots .subslot').forEach((box) => {
    box.classList.toggle('on', box.dataset.slot === submit.armorSlot);
  });
}

function subRenderTreasures(){
  const q = ($('subTreasureSearch').value || '').trim().toLowerCase();
  const activeKey = submit.treasureSlot;
  const grid = $('subTreasureGrid');
  grid.innerHTML = '';
  TREASURES.filter((it) => !q || it.name.toLowerCase().includes(q)).forEach((it) => {
    const group = ['must', 'recommended', 'backup'].find((k) => submit.treasureTiers[k].includes(it.name)) || '';
    const el = subCell(it, !!group, () => {
      const list = submit.treasureTiers[activeKey];
      const at = list.indexOf(it.name);
      if (at >= 0) list.splice(at, 1);
      else {
        ['must', 'recommended', 'backup'].forEach((k) => {
          const i = submit.treasureTiers[k].indexOf(it.name);
          if (i >= 0) submit.treasureTiers[k].splice(i, 1);
        });
        list.push(it.name);
      }
      subRenderTreasures(); subRenderTreasureSlots(); subStatus();
    });
    el.classList.add('eqcell');
    if (group) {
      const badge = document.createElement('span');
      badge.className = 'slotbadge treasure-' + group;
      const src = document.querySelector('#submitModal .treasure-slots .subslot[data-slot="' + group + '"] svg');
      badge.innerHTML = src ? src.outerHTML : SLOT_ICON['treasure-' + group];
      el.appendChild(badge);
    }
    grid.appendChild(el);
  });
}

function subRenderTreasureSlots(){
  document.querySelectorAll('#submitModal .treasure-slots .subslot').forEach((box) => {
    box.classList.toggle('on', box.dataset.slot === submit.treasureSlot);
  });
}

function subRenderSoul(){
  const q = ($('subSoulSearch').value || '').trim().toLowerCase();
  const grid = $('subSoulGrid');
  const loadout = domain.soulLoadout(selectedSoulStones());
  const availableShapes = new Set(loadout.groups.flat().filter(({ stone }) => !stone).map(({ shape }) => shape));
  const fullHint = '灵魂石槽位已满，点击已选灵魂石可移除。';
  subSet('subSoulHint', availableShapes.size ? '' : fullHint);
  grid.innerHTML = '';
  SOUL_STONES.filter((it) => !it.unavailable && (!q || it.name.toLowerCase().includes(q))).forEach((it) => {
    const selected = submit.soulStones.includes(it.name);
    const shape = domain.soulShape(it);
    const blocked = !selected && !availableShapes.has(shape);
    const blockedHint = availableShapes.size ? (shape ? it.slot + '已满，先移除一个同形状的灵魂石。' : '没有对应的灵魂石槽位。') : fullHint;
    const cell = subCell(it, selected, () => {
      if (blocked) { showToast(esc(blockedHint)); return; }
      const at = submit.soulStones.indexOf(it.name);
      if (at >= 0) submit.soulStones.splice(at, 1); else submit.soulStones.push(it.name);
      subRenderSoul(); subStatus();
    }, it.name, it.name);
    cell.dataset.shape = shape;
    if (blocked) {
      cell.classList.add('soul-slot-full');
      cell.setAttribute('aria-disabled', 'true');
      cell.title = blockedHint;
    }
    grid.appendChild(cell);
  });
  renderSoulRes(loadout);
}

function subRenderCursed(){
  const q = ($('subCursedSearch').value || '').trim().toLowerCase();
  const activeKey = submit.cursedSlot;
  const active = submit.cursed[activeKey];
  const grid = $('subCursedGrid');
  grid.innerHTML = '';
  CURSED_TREASURES.filter((it) => !it.removed && (!q || it.name.toLowerCase().includes(q))).forEach((it) => {
    const group = ['none', 'suggest', 'must'].find((k) => submit.cursed[k].includes(it.name)) || '';
    const el = subCell(it, !!group, () => {
      const list = submit.cursed[activeKey];
      const at = list.indexOf(it.name);
      if (at >= 0) list.splice(at, 1);
      else {
        ['none', 'suggest', 'must'].forEach((k) => {
          const i = submit.cursed[k].indexOf(it.name);
          if (i >= 0) submit.cursed[k].splice(i, 1);
        });
        list.push(it.name);
      }
      subRenderCursed(); subRenderCursedSlots(); subStatus();
    }, it.name, it.name);
    el.classList.add('eqcell');
    if (group) {
      const badge = document.createElement('span');
      badge.className = 'slotbadge cursed-' + group;
      const src = document.querySelector('#submitModal .cursed-slots .subslot[data-slot="' + group + '"] svg');
      badge.innerHTML = src ? src.outerHTML : SLOT_ICON['cursed-' + group];
      el.appendChild(badge);
    }
    grid.appendChild(el);
  });
}

function subRenderCursedSlots(){
  document.querySelectorAll('#submitModal .cursed-slots .subslot').forEach((box) => {
    box.classList.toggle('on', box.dataset.slot === submit.cursedSlot);
  });
}

function subStatus(){}

function renderNightmareProgress(list){
  const progress = domain.nightmareProgress(list);
  if (!progress) return '<p class="nightmare-unrecorded">这份方案未记录梦魇强度</p>';
  const { points, depth, thresholds } = progress;
  const max = thresholds.at(-1);
  const depthLabel = depth ? '梦魇深度 ' + depth : '未达深度 1';
  return '<div class="nightmare-progress">'
    + '<div class="nightmare-progress-caption"><b>梦魇强度</b>'
    + '<span class="nightmare-points">' + points + ' 点</span>'
    + '<span class="nightmare-depth">' + depthLabel + '</span></div>'
    + '<div class="nightmare-scale">'
    + '<progress class="nightmare-meter" aria-label="梦魇强度" aria-valuetext="' + points + ' 点，' + depthLabel + '"'
    + ' value="' + Math.min(points, max) + '" max="' + max + '"></progress>'
    + '<div class="nightmare-marks" aria-hidden="true">'
    + [0, ...thresholds].map((threshold) => '<span class="nightmare-mark' + (threshold && points >= threshold ? ' reached' : '') + '">'
      + '<span class="nightmare-mark-label">' + threshold + '</span></span>').join('')
    + '</div></div></div>';
}

function updateNightmareProgress(){
  $('subNightmareProgress').innerHTML = renderNightmareProgress(domain.nightmareList(nightmareSelections));
}

function updateNightmareStepper(stepper, options, index){
  const option = options[index];
  stepper.querySelector('.nightmare-option').textContent = option ? option.label : '不加点';
  stepper.querySelector('.nightmare-option-points').textContent = option ? option.points + ' 点' : '';
  stepper.querySelector('[data-nightmare-step="-1"]').disabled = index < 0;
  stepper.querySelector('[data-nightmare-step="1"]').disabled = index >= options.length - 1;
  stepper.classList.toggle('has-points', index >= 0);
}

function renderNightmareEditor(){
  const list = $('subNightmareEffects');
  if (!list) return;
  if (!NIGHTMARE_EFFECTS.length) {
    list.textContent = '暂时没有可选的梦魇效果。';
    $('subNightmareProgress').textContent = '';
    return;
  }
  list.innerHTML = NIGHTMARE_EFFECTS.map(({ name, description }) =>
    '<div class="nightmare-row"><div class="nightmare-effect">' + nightmareIcon(name)
    + '<span><b>' + esc(name) + '</b><small>' + esc(description) + '</small></span></div>'
    + '<div class="nightmare-stepper" role="group" aria-label="' + esc(name) + '" data-nightmare="' + esc(name) + '">'
    + '<button type="button" data-nightmare-step="-1" aria-label="降低' + esc(name) + '档位">−</button>'
    + '<div class="nightmare-option-readout"><span class="nightmare-option"></span><small class="nightmare-option-points"></small></div>'
    + '<button type="button" data-nightmare-step="1" aria-label="提高' + esc(name) + '档位">+</button></div></div>'
  ).join('');
  list.querySelectorAll('.nightmare-stepper').forEach((stepper, i) => {
    const { name, options } = NIGHTMARE_EFFECTS[i];
    updateNightmareStepper(stepper, options, options.findIndex(({ points }) => points === nightmareSelections.get(name)));
  });
  updateNightmareProgress();
}

function renderNightmareRows(list, removable = false){
  return list.map((entry) => {
    const { n, p, points } = entry;
    const value = [points ? points + ' 点' : '', p].filter(Boolean).join(' · ') || '—';
    return '<div class="nmrow"><span class="nightmare-effect">' + nightmareIcon(n) + '<span>' + esc(n) + '</span></span>'
      + '<span class="p">' + esc(value) + '</span>'
      + (removable ? '<button type="button" class="nightmare-remove" data-remove-nightmare="' + esc(n)
        + '" aria-label="移除' + esc(n) + '">×</button>' : '') + '</div>';
  }).join('');
}

$('subNightmareEffects')?.addEventListener('click', (ev) => {
  const button = ev.target.closest('button[data-nightmare-step]');
  if (!button || button.disabled) return;
  const stepper = button.closest('.nightmare-stepper');
  const { name, options } = NIGHTMARE_EFFECTS.find(({ name }) => name === stepper.dataset.nightmare);
  const current = options.findIndex(({ points }) => points === nightmareSelections.get(name));
  const next = current + Number(button.dataset.nightmareStep);
  if (next === -1) nightmareSelections.delete(name);
  else nightmareSelections.set(name, options[next].points);
  updateNightmareStepper(stepper, options, next);
  updateNightmareProgress();
});

function openSubmit(){
  $('subName').value = '';
  $('subVersion').value = '';
  $('subAuthor').value = '';
  submit.tags = [];
  if($('subTagInput')) $('subTagInput').value = '';
  renderSubTags();
  $('subTip').value = '';
  if($('subWtSearch')) $('subWtSearch').value = '';
  if($('subInscSearch')) $('subInscSearch').value = '';
  submit.wt = ''; submit.insc = ''; submit.transition = []; submit.graduation = []; submit.slot = 'transition'; submit.armorTransition = []; submit.armorGraduation = []; submit.armorSlot = 'transition'; submit.treasureTiers = { must: [], recommended: [], backup: [] }; submit.treasureSlot = 'must';
  submit.soulStones = []; submit.cursed = { none: [], suggest: [], must: [] }; submit.cursedSlot = 'none'; submit.resonance = ['', '', ''];
  nightmareSelections.clear();
  applyStoneOrder(['red', 'green', 'blue']);
  subRenderWt(); subRenderInsc(); subRenderEquip(); subRenderSlots(); subRenderArmor(); subRenderArmorSlots(); subRenderTreasures(); subRenderTreasureSlots();
  subRenderSoul(); subRenderCursed(); subRenderCursedSlots(); subRenderTreasureSlots(); subStatus();
  subGo(0);
  subReviewOpen = false;
  $subModal.classList.remove('review-mode');
  subSet('subSave', '查看已选');
  subPreview();
  state.submitOpen = true;
  state.lastSubmitItem = null;
  const infoBox = $('subInfo');
  if(infoBox) infoBox.innerHTML = SUBINFO_EMPTY;
  $subModal.classList.add('on');
  requestAnimationFrame(syncSubThumb);
  acquireFocusInput($('subName'));
}

function closeSubmit(){
  state.submitOpen = false;
  state.lastSubmitItem = null;
  const infoBox = $('subInfo');
  if(infoBox) infoBox.innerHTML = SUBINFO_EMPTY;
  $subModal.classList.remove('review-mode');
  $subModal.classList.remove('on');
  releaseFocusInput();
}

function selectedResonance(){
  const rows = submit.resonance.map((v, idx) => {
    const entry = resEntries(idx)[parseInt(v, 10) - 1];
    const text = entry ? (entry.lines || []).join(' ') : '';
    return text ? { slot: idx + 1, level: entry.level || 1, text } : null;
  }).filter(Boolean);
  if(!rows.length) return null;
  return {
    code: submit.resonance.map((v) => v || 0).join('-'),
    nodes: rows.map((row) => row.text),   // 数据包只存文本
    rows,                                  // 评审页渲染用（带图标等级）
  };
}

/* 校验失败：提示 + 跳到要补的那一页，避免「点了没反应」的错觉 */
function submitBlocked(message, page, focusId){
  showToast(message);
  const idx = SUB_PAGES.indexOf(page);
  if(idx >= 0) subGo(idx);
  const el = focusId ? $(focusId) : null;
  if(el) requestAnimationFrame(() => acquireFocusInput(el));
}

let submitBusy = false;

async function saveSubmit(){
  if(submitBusy) return;
  const name = ($('subName').value || '').trim();
  const author = ($('subAuthor').value || '').trim();
  const gameVersion = ($('subVersion').value || '').trim();
  commitSubTagInput();
  const tags = submit.tags.slice();
  const tip = ($('subTip').value || '').trim();
  if (name.length < 2 || name.length > 20) return submitBlocked('流派名需要 2-20 个字', 'basic', 'subName');
  if (!submit.wt) return submitBlocked('请选择武器类型', 'wt');
  if (!submit.insc) return submitBlocked('请选择主刻印', 'insc');
  if (!author) return submitBlocked('请填写作者', 'basic', 'subAuthor');
  if (!gameVersion) return submitBlocked('请填写游戏版本', 'basic', 'subVersion');
  if (!tags.length) return submitBlocked('请至少填一个标签', 'basic', 'subTagInput');
  if (tip.length < 6) return submitBlocked('一句话技巧至少 6 个字', 'basic', 'subTip');

  const resPick = selectedResonance();
  const today = new Date().toISOString().slice(0, 10);
  const war = W(submit.wt);
  const gear = {};
  const primary = submit.graduation[0] || submit.transition[0];
  if (primary) gear.weapon = { name: primary, type: war.name };
  const armorPrimary = submit.armorGraduation[0] || submit.armorTransition[0];
  if (armorPrimary) {
    const a = ARMORS.find((x) => x.name === armorPrimary);
    gear.armor = { name: armorPrimary, type: a ? a.kind : '' };
  }
  const features = tags.slice(0, 5).map((t) => t.slice(0, 8));
  const nightmare = domain.nightmareList(nightmareSelections);
  const record = {
    id: 'sub_' + Date.now().toString(36),
    name, wt: submit.wt, insc: submit.insc,
    rating: 0, votes: 0,
    features, tags, tip, author, gameVersion,
    updatedAt: today,
    ...(resPick ? { resonance: { code: resPick.code, nodes: resPick.nodes } } : {}),
    ...(nightmare.length ? { nightmareList: nightmare } : {}),
    ...(submit.stoneConfirmed ? { stonePriority: Object.fromEntries(submit.stoneOrder.map((key, idx) => [key, idx + 1])) } : {}),
    sourceType: 'self-test',
    license: 'CC-BY-NC-SA-4.0',
    ...(Object.keys(gear).length ? { gear } : {}),
    weaponChoices: submit.graduation.map((name) => ({ name, tag: '毕业' })),
    transition: submit.transition.map((n) => ({ name: n, tag: '过渡' })),
    armorChoices: [
      ...submit.armorGraduation.map((n) => ({ n, tier: '毕业' })),
      ...submit.armorTransition.map((n) => ({ n, tier: '过渡' })),
    ].map(({ n, tier }) => {
      const a = ARMORS.find((x) => x.name === n);
      return { name: n, ...(a && a.kind ? { type: a.kind } : {}), tier };
    }),
    treasureTiers: {
      must: submit.treasureTiers.must.slice(),
      recommended: submit.treasureTiers.recommended.slice(),
      backup: submit.treasureTiers.backup.slice(),
    },
    soulStones: submit.soulStones.map((n) => {
      const s = SOUL_STONES.find((x) => x.name === n);
      return { name: n, ...(s && s.eff ? { eff: s.eff } : {}) };
    }),
    cursed: [
      ...submit.cursed.none.map((n) => ({ n, verdict: '不净化' })),
      ...submit.cursed.suggest.map((n) => ({ n, verdict: '建议净化' })),
      ...submit.cursed.must.map((n) => ({ n, verdict: '必须净化' })),
    ].map(({ n, verdict }) => {
      const c = CURSED_TREASURES.find((x) => x.name === n);
      return { name: n, ...(c && c.eff ? { eff: c.eff } : {}), verdict };
    }),
  };
  submitBusy = true;
  subSet('subSave', '提交中…');
  try {
    const res = await window.lc2?.submitBuild?.(record);
    if (!res || !res.ok) throw new Error('保存失败');
    showToast('<b style="color:#c8d8f5">投稿已保存并加入本地图鉴</b><br>' + esc(res.path));
    closeSubmit();
    if (window.__lc2RefreshData) window.__lc2RefreshData();
  } catch (err) {
    console.error('投稿保存失败', err);
    showToast('保存失败：' + esc(err && err.message ? err.message : String(err)));
  } finally {
    submitBusy = false;
    subSet('subSave', subReviewOpen ? '提交' : '查看已选');
  }
}

/* 多页切换 */
const SUB_PAGES = ['basic', 'wt', 'insc', 'equip', 'armor', 'treasure', 'soul', 'cursed', 'nightmare'];
let subPage = 0;
let subReviewOpen = false;
let subReviewScroll = 0;
function subPageScroller(){
  return SUB_PAGES[subPage] === 'nightmare' ? $('subNightmareEffects') : $('subMain');
}
function subGo(i){
  subReviewOpen = false;
  $subModal.classList.remove('review-mode');
  subPage = Math.max(0, Math.min(SUB_PAGES.length - 1, i));
  const page = SUB_PAGES[subPage];
  $subModal.classList.toggle('no-info', page === 'basic' || page === 'nightmare');
  if (page === 'nightmare') renderNightmareEditor();
  const prev = $('subPrev'), next = $('subNext');
  if (prev) prev.disabled = subPage === 0;
  if (next) next.disabled = subPage === SUB_PAGES.length - 1;
  document.querySelectorAll('#submitModal .subpage').forEach((el) => el.classList.toggle('on', el.dataset.page === page));
  document.querySelectorAll('#submitModal .subpages > div').forEach((el) => el.classList.toggle('on', el.dataset.page === page));
  subSet('subSave', '查看已选');
  requestAnimationFrame(syncSubThumb);
}

function openReview(){
  commitSubTagInput();
  subReviewScroll = subPageScroller().scrollTop;
  subReviewOpen = true;
  $subModal.classList.remove('no-info');
  $subModal.classList.add('review-mode');
  const prev = $('subPrev'), next = $('subNext');
  if (prev) prev.disabled = false;
  if (next) next.disabled = true;
  document.querySelectorAll('#submitModal .subpage').forEach((el) => el.classList.toggle('on', el.dataset.page === 'review'));
  document.querySelectorAll('#submitModal .subpages > div').forEach((el) => el.classList.remove('on'));
  subRenderReview();
  subSet('subSave', '提交');
  requestAnimationFrame(syncSubThumb);
  $('subMain').scrollTop = 0;
}

function backToSubmitPage(){
  subGo(subPage);
  subPageScroller().scrollTop = subReviewScroll;
}

function subReviewRow(label, items, kind, group, opts){
  if(!items.length) return '';
  const keyOf = opts && opts.icon ? opts.icon : (n) => n;
  const labelOf = opts && opts.label ? opts.label : (n) => n;
  return '<div class="rvgroup"><span class="rvglabel">'+label+'</span><span class="rvchips">'
    + items.map((n) => '<span class="rvchip" title="点击查看详情" data-kind="'+kind+'" data-group="'+group+'" data-name="'+esc(n)+'">'+ic(keyOf(n), labelOf(n), 's30')+esc(labelOf(n))
      +'<span class="rvx" data-kind="'+kind+'" data-group="'+group+'" data-name="'+esc(n)+'">×</span></span>').join('')
    + '</span></div>';
}

function subClearReview(){
  submit.wt = '';
  submit.insc = '';
  submit.transition = []; submit.graduation = [];
  submit.armorTransition = []; submit.armorGraduation = [];
  submit.treasureTiers = { must: [], recommended: [], backup: [] }; submit.treasureSlot = 'must';
  submit.soulStones = [];
  submit.cursed = { none: [], suggest: [], must: [] };
  submit.resonance = ['', '', ''];
  nightmareSelections.clear();
  applyStoneOrder(['red', 'green', 'blue']);
  renderResBar();
  subRenderWt(); subRenderInsc(); subRenderEquip(); subRenderSlots();
  subRenderArmor(); subRenderArmorSlots(); subRenderTreasures(); subRenderTreasureSlots();
  subRenderSoul(); subRenderCursed(); subRenderCursedSlots();
  subRenderReview(); subStatus();
  showToast('已清空全部已选内容');
}

function subRenderReview(){
  const box = $('subReview');
  if(!box) return;
  const parts = [];
  if(submit.wt) parts.push(subReviewRow('武器', [submit.wt], 'wt', '', { icon: (id) => id, label: (id) => wName(id) }));
  if(submit.insc) parts.push(subReviewRow('刻印', [submit.insc], 'insc', '', { icon: (id) => id, label: (id) => (INSC[id]?.name || id).replace('刻印','') }));
  const resPick = selectedResonance();
  if(resPick){
    parts.push('<div class="rvsec"><div class="rvhead"><span>刻印共鸣</span><span class="rvcount">'+esc(resPick.code)+'</span></div>'
      + '<div class="rvresonance">'
      + resPick.rows.map((row) => '<div class="rvnote">'
        + '<span class="rvnote-ic"><img src="' + resIcon(row.level) + '" alt="Lv.' + row.level + '"></span>'
        + '<span class="rvnote-name">共鸣 ' + row.slot + '</span>'
        + '<span class="rvnote-text" title="' + esc(row.text) + '">' + esc(row.text) + '</span>'
        + '</div>').join('')
      + '</div></div>');
  }
  const stonePicks = submit.stoneOrder.map((key, idx) => [key, idx + 1]);
  if(submit.stoneConfirmed){
    const stoneNames = { red: '阿希尔符文', green: '帕拉提符文', blue: '纳伊鲁符文' };
    const stoneIcons = {
      red: 'https://huiji-public.huijistatic.com/lc2/uploads/0/07/Icon_Power_Red.png',
      green: 'https://huiji-public.huijistatic.com/lc2/uploads/6/69/Icon_Power_Green.png',
      blue: 'https://huiji-public.huijistatic.com/lc2/uploads/f/fe/Icon_Power_blue.png',
    };
    parts.push('<div class="rvsec"><div class="rvhead"><span>符文优先级</span></div><div class="rvgroup"><span class="rvchips rune-order">'
      + stonePicks.map(([k], i) => '<span class="rvstone '+k+'"><img class="rvstone-ic" src="' + stoneIcons[k] + '" alt=""><span>' + stoneNames[k] + '</span></span>' + (i < stonePicks.length - 1 ? '<span class="rvstone-arrow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span>' : '')).join('')
      + '</span></div></div>');
  }
  if(submit.transition.length || submit.graduation.length){
    parts.push('<div class="rvsec"><div class="rvhead"><span>装备</span><span class="rvcount">'
      +(submit.transition.length+submit.graduation.length)+'</span></div>'
      + subReviewRow('过渡', submit.transition, 'equip', 'transition')
      + subReviewRow('毕业', submit.graduation, 'equip', 'graduation') + '</div>');
  }
  if(submit.armorTransition.length || submit.armorGraduation.length){
    parts.push('<div class="rvsec"><div class="rvhead"><span>衣服</span><span class="rvcount">'
      +(submit.armorTransition.length+submit.armorGraduation.length)+'</span></div>'
      + subReviewRow('过渡', submit.armorTransition, 'armor', 'transition')
      + subReviewRow('毕业', submit.armorGraduation, 'armor', 'graduation') + '</div>');
  }
  const tr = submit.treasureTiers;
  const trAll = tr.must.length + tr.recommended.length + tr.backup.length;
  if(trAll){
    parts.push('<div class="rvsec"><div class="rvhead"><span>宝藏</span><span class="rvcount">'+trAll+'</span></div>'
      + subReviewRow('必选', tr.must, 'treasure', 'must')
      + subReviewRow('推荐', tr.recommended, 'treasure', 'recommended')
      + subReviewRow('备选', tr.backup, 'treasure', 'backup') + '</div>');
  }
  if(submit.soulStones.length){
    parts.push('<div class="rvsec"><div class="rvhead"><span>灵魂石</span><span class="rvcount">'+submit.soulStones.length+'</span></div>'
      + subReviewRow('效果', submit.soulStones, 'soul', '') + '</div>');
  }
  const c = submit.cursed;
  const cAll = c.none.length + c.suggest.length + c.must.length;
  if(cAll){
    parts.push('<div class="rvsec"><div class="rvhead"><span>诅咒宝藏</span><span class="rvcount">'+cAll+'</span></div>'
      + subReviewRow('不用净化', c.none, 'cursed', 'none')
      + subReviewRow('建议净化', c.suggest, 'cursed', 'suggest')
      + subReviewRow('必须净化', c.must, 'cursed', 'must') + '</div>');
  }
  const nightmare = domain.nightmareList(nightmareSelections);
  if (nightmare.length) {
    parts.push('<div class="rvsec"><div class="rvhead"><span>梦魇推荐加点</span></div>'
      + renderNightmareProgress(nightmare)
      + renderNightmareRows(nightmare, true) + '</div>');
  }
  box.innerHTML = parts.length ? parts.join('') : emptyState('还没有选东西呢 (´･ω･`)', '去前面的页签挑一挑吧', true);
  box.querySelectorAll('[data-remove-nightmare]').forEach((button) => {
    button.onclick = () => {
      nightmareSelections.delete(button.dataset.removeNightmare);
      subRenderReview();
    };
  });
  const clear = $('subReviewClear'); if(clear) clear.classList.toggle('disabled', !parts.length);
  const reviewItem = (kind, group, name) => {
    if(kind === 'wt') return WEAPONS.find((x) => x.id === name) || null;
    if(kind === 'insc') return INSC[name] ? { ...INSC[name] } : null;
    if(kind === 'equip') return WEAPON_ITEMS.find((x) => x.name === name) || null;
    if(kind === 'armor') return ARMORS.find((x) => x.name === name) || null;
    if(kind === 'treasure') return TREASURES.find((x) => x.name === name) || null;
    if(kind === 'soul') return SOUL_STONES.find((x) => x.name === name) || null;
    if(kind === 'cursed') return CURSED_TREASURES.find((x) => x.name === name) || null;
    return null;
  };
  box.querySelectorAll('.rvchip').forEach((chip) => {
    chip.onclick = (ev) => {
      if(ev.target.closest && ev.target.closest('.rvx')) return;
      const item = reviewItem(chip.dataset.kind, chip.dataset.group, chip.dataset.name);
      if(!item) return;
      if(window.innerWidth >= 720) showItemInfo(item);
    };
  });
  box.querySelectorAll('.rvx').forEach((x) => {
    x.onclick = (ev) => {
      const kind = x.dataset.kind, group = x.dataset.group, name = x.dataset.name;
      ev.stopPropagation();
      if(kind === 'wt') submit.wt = '';
      else if(kind === 'insc') submit.insc = '';
      else if(kind === 'equip') submit[group === 'transition' ? 'transition' : 'graduation'] = submit[group === 'transition' ? 'transition' : 'graduation'].filter((n) => n !== name);
      else if(kind === 'armor') submit[group === 'transition' ? 'armorTransition' : 'armorGraduation'] = submit[group === 'transition' ? 'armorTransition' : 'armorGraduation'].filter((n) => n !== name);
      else if(kind === 'treasure') submit.treasureTiers[group] = submit.treasureTiers[group].filter((n) => n !== name);
      else if(kind === 'soul') submit.soulStones = submit.soulStones.filter((n) => n !== name);
      else if(kind === 'cursed') submit.cursed[group] = submit.cursed[group].filter((n) => n !== name);
      subRenderWt(); subRenderInsc(); subRenderEquip(); subRenderArmor(); subRenderTreasures(); subRenderSoul(); subRenderCursed();
      subRenderSlots(); subRenderArmorSlots(); subRenderTreasureSlots(); subRenderCursedSlots(); subRenderReview(); subStatus();
    };
  });
}

function syncSubThumb(){
  const row = $('subPages');
  const thumb = row && row.querySelector('.seg-thumb');
  const active = row && row.querySelector('div.on');
  if (!row || !thumb) return;
  if (!active) { thumb.style.width = '0'; thumb.style.height = '0'; return; }
  const rr = row.getBoundingClientRect(), ar = active.getBoundingClientRect();
  if (!ar.width) { thumb.style.width = '0'; thumb.style.height = '0'; return; }
  thumb.style.left = (ar.left - rr.left) + 'px';
  thumb.style.top = (ar.top - rr.top) + 'px';
  thumb.style.width = ar.width + 'px';
  thumb.style.height = ar.height + 'px';
}
window.addEventListener('resize', () => { if (state.submitOpen) syncSubThumb(); });
document.querySelectorAll('#submitModal .subpages > div').forEach((btn) => {
  btn.onclick = () => subGo(SUB_PAGES.indexOf(btn.dataset.page));
});
document.querySelectorAll('#submitModal .equipment-slots .subslot').forEach((slot) => {
  slot.onclick = () => { submit.slot = slot.dataset.slot; subRenderEquip(); subRenderSlots(); };
});
document.querySelectorAll('#submitModal .armor-slots .subslot').forEach((slot) => {
  slot.onclick = () => { submit.armorSlot = slot.dataset.slot; subRenderArmor(); subRenderArmorSlots(); };
});
document.querySelectorAll('#submitModal .treasure-slots .subslot').forEach((slot) => {
  slot.onclick = () => { submit.treasureSlot = slot.dataset.slot; subRenderTreasures(); subRenderTreasureSlots(); };
});
document.querySelectorAll('#submitModal .cursed-slots .subslot').forEach((slot) => {
  slot.onclick = () => { submit.cursedSlot = slot.dataset.slot; subRenderCursed(); subRenderCursedSlots(); };
});
$('subPrev').onclick = () => { if (subReviewOpen) backToSubmitPage(); else subGo(subPage - 1); };
$('subNext').onclick = () => { if (!subReviewOpen) subGo(subPage + 1); };
$sbtn.onclick = openSubmit;
$('subClose').onclick = closeSubmit;
$('subSave').onclick = () => { if (subReviewOpen) saveSubmit(); else openReview(); };
$('subReviewBack').onclick = backToSubmitPage;
$('subReviewClear').onclick = subClearReview;
$('subName').addEventListener('input', subPreview);
$('subTip').addEventListener('input', subPreview);
$('subEquipSearch').addEventListener('input', subRenderEquip);
$('subArmorSearch').addEventListener('input', subRenderArmor);
$('subTreasureSearch').addEventListener('input', subRenderTreasures);
$('subSoulSearch').addEventListener('input', subRenderSoul);
$('subCursedSearch').addEventListener('input', subRenderCursed);
$subModal.addEventListener('click', (e) => { if(window.__lc2SuppressBackdrop){window.__lc2SuppressBackdrop=false;return;} if (e.target === $subModal) closeSubmit(); });

/* 详情栏宽度拖拽 */
(function bindInfoSplitters(){
  const KEY = 'lc2.infoWidth';
  const MIN = 220;
  function maxWidth(){ return Math.max(MIN, Math.min(560, window.innerWidth - 300)); }
  function applyPaneWidth(pane, value){
    if(!pane) return;
    const w = Math.max(MIN, Math.min(maxWidth(), value));
    pane.style.width = w + 'px';
  }
  function applyAll(value){
    document.querySelectorAll('.minfo,.subinfo').forEach((p) => applyPaneWidth(p, value));
  }
  const saved = Number(localStorage.getItem(KEY));
  if(Number.isFinite(saved) && saved >= MIN) applyAll(saved);
  function setup(splitId, paneSelector){
    const split = document.getElementById(splitId);
    const pane = document.querySelector(paneSelector);
    if(!split || !pane) return;
    let drag = null;
    split.addEventListener('pointerdown', (ev) => {
      if(ev.button !== 0) return;
      drag = { x: ev.clientX, w: pane.getBoundingClientRect().width };
      split.classList.add('dragging');
      try { split.setPointerCapture(ev.pointerId); } catch(e){}
      ev.preventDefault();
      ev.stopPropagation();
    });
    split.addEventListener('pointermove', (ev) => {
      if(!drag) return;
      const next = drag.w + (drag.x - ev.clientX);
      applyPaneWidth(pane, next);
    });
    function end(){
      if(!drag) return;
      drag = null;
      split.classList.remove('dragging');
      try { localStorage.setItem(KEY, String(Math.round(pane.getBoundingClientRect().width))); } catch(e){}
    }
    split.addEventListener('pointerup', end);
    split.addEventListener('pointercancel', end);
    split.addEventListener('lostpointercapture', end);
    split.addEventListener('dblclick', () => { applyAll(268); try { localStorage.setItem(KEY, '268'); } catch(e){} });
  }
  setup('filterSplit', '.minfo');
  setup('subSplit', '.subinfo');
  window.addEventListener('resize', () => {
    document.querySelectorAll('.minfo,.subinfo').forEach((p) => {
      if(p.style.width) applyPaneWidth(p, parseInt(p.style.width, 10));
    });
  });
})();

/* 设置 */
const settingsBtn = $('settingsBtn'), settingsModal = $('settings'), settingsClose = $('settingsClose');
function syncSizeButtons(){
  const w = window.innerWidth, h = window.innerHeight;
  document.querySelectorAll('#settings [data-size]').forEach((btn) => {
    const [bw, bh] = btn.dataset.size.split('x').map(Number);
    btn.classList.toggle('on', Math.abs(w - bw) <= 4 && Math.abs(h - bh) <= 4);
  });
}
function applyPanelSize(w, h){
  if(window.lc2 && window.lc2.setPanelSize) window.lc2.setPanelSize(w, h);
  else window.resizeTo(w, h);
  setTimeout(() => {
    syncSizeButtons();
    if(Math.abs(window.innerWidth - w) > 6 || Math.abs(window.innerHeight - h) > 6){
      showToast('窗口尺寸调整失败，请重启客户端后再试');
    }
  }, 320);
}
async function openSettings(){
  settingsModal.classList.add('on');
  syncSizeButtons();
  if(settingsBtn) settingsBtn.setAttribute('aria-expanded', 'true');
  await loadSettingsVersion();
}
function closeSettings(){
  settingsModal.classList.remove('on');
  if(settingsBtn) settingsBtn.setAttribute('aria-expanded', 'false');
}
if(settingsBtn) settingsBtn.onclick = openSettings;
if(settingsClose) settingsClose.onclick = closeSettings;
settingsModal.onclick = (event) => {
  if(window.__lc2SuppressBackdrop){window.__lc2SuppressBackdrop=false;return;}
  if(event.target === settingsModal) closeSettings();
};
document.querySelectorAll('#settings [data-size]').forEach((btn) => {
  btn.onclick = () => {
    const [w, h] = btn.dataset.size.split('x').map(Number);
    applyPanelSize(w, h);
  };
});
const settingsCheck = $('settingsCheckUpdate');
const settingsUpdateMsg = $('settingsUpdateMsg');
const settingsDownload = $('settingsDownloadUpdate');
let updateInfo = null;
function setUpdateMsg(text, ok){
  if(settingsUpdateMsg){
    settingsUpdateMsg.textContent = text;
    settingsUpdateMsg.style.color = ok ? '#A8D8B0' : '';
  }
}
function compareVersion(a, b){
  const parse = (s) => String(s || '').replace(/^v/i, '').split('.').map((n) => {
    const v = parseInt(n, 10); return Number.isFinite(v) ? v : 0;
  });
  const x = parse(a), y = parse(b);
  for(let i = 0; i < Math.max(x.length, y.length); i++){
    const dx = x[i] || 0, dy = y[i] || 0;
    if(dx !== dy) return dx - dy;
  }
  return 0;
}
async function fetchRemoteVersion(){
  const urls = [
    'https://raw.githubusercontent.com/Shuijiao926/lost_castle_helper/main/package.json',
    'https://raw.githubusercontent.com/Shuijiao926/lost_castle_helper/master/package.json',
  ];
  for(const url of urls){
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      if(!res.ok) continue;
      const pkg = await res.json();
      if(pkg && pkg.version) return String(pkg.version).replace(/^v/i, '');
    } catch(e) {
      // try next mirror
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
if(settingsCheck) settingsCheck.onclick = async () => {
  if(settingsCheck.disabled) return;
  settingsCheck.disabled = true;
  settingsCheck.textContent = '检查中…';
  if(settingsDownload) settingsDownload.hidden = true;
  setUpdateMsg('正在检查最新版本…');
  try {
    let current = '—';
    if(window.lc2 && window.lc2.getConfig){
      try { const cfg = await window.lc2.getConfig(); current = cfg.version || current; } catch(e){}
    }
    let latest = await fetchRemoteVersion();
    if(!latest && window.lc2 && window.lc2.checkUpdate){
      try {
        const remote = await window.lc2.checkUpdate();
        if(remote && remote.ok) latest = remote.latest;
      } catch(e){}
    }
    if(!latest){
      setUpdateMsg('检查失败，请检查网络后重试');
      return;
    }
    if(compareVersion(latest, current) > 0){
      updateInfo = { latest, current, url: 'https://github.com/Shuijiao926/lost_castle_helper/releases' };
      setUpdateMsg('发现新版本 v' + latest + '，当前 v' + current);
      if(settingsDownload) settingsDownload.hidden = false;
    } else {
      updateInfo = { latest, current, url: 'https://github.com/Shuijiao926/lost_castle_helper/releases' };
      setUpdateMsg('当前已是最新版本 v' + current, true);
    }
  } catch(e) {
    setUpdateMsg('检查失败，请检查网络后重试');
  } finally {
    settingsCheck.disabled = false;
    settingsCheck.textContent = '检查更新';
  }
};
if(settingsDownload) settingsDownload.onclick = () => {
  const url = (updateInfo && updateInfo.url) || 'https://github.com/Shuijiao926/lost_castle_helper/releases';
  if(window.lc2 && window.lc2.openExternal) window.lc2.openExternal(url);
  else window.open(url, '_blank');
};

/* 帮助 */
const $hbtn=$('hbtn'),$help=$('help'),$helpClose=$('helpClose');
function openHelp(){$help.classList.add('on');}
function closeHelp(){$help.classList.remove('on');}
$hbtn.onclick=openHelp;
$helpClose.onclick=closeHelp;
$help.onclick=ev=>{if(window.__lc2SuppressBackdrop){window.__lc2SuppressBackdrop=false;return;}if(ev.target===$help)closeHelp();};

const updateVersion = $('updateVersion');

for (const note of LC2.data.updateNotes) {
  const item = document.createElement('li');
  item.textContent = note;
  $('updateNotes').append(item);
}

async function loadSettingsVersion() {
  const api = window.lc2;
  if (updateVersion.dataset.loaded) return;
  if (!api) {
    updateVersion.textContent = '网页原型';
    return;
  }

  updateVersion.textContent = '读取中…';
  try {
    const { version } = await api.getConfig();
    updateVersion.textContent = version ? `v${version}` : '版本未知';
    if (version) updateVersion.dataset.loaded = 'true';
  } catch (error) {
    console.error('[lc2] 读取客户端版本失败', error);
    updateVersion.textContent = '暂时无法读取';
  }
}


$('noteCancel').onclick=closeNote;
$('noteSave').onclick=saveNote;
/* 点遮罩关掉：弹窗本体（不含 sheet）单独接管，和筛选 / 帮助等弹层一致 */
document.getElementById('noteModal').addEventListener('mousedown', function(ev){
  if(ev.target === ev.currentTarget) closeNote();
});
$('noteText').addEventListener('input',function(){ var c=$('noteCount'); if(c) c.textContent=String(this.value.length); });
$('noteText').addEventListener('keydown',function(ev){
  if(ev.key==='Escape'){ ev.preventDefault(); ev.stopPropagation(); closeNote(); }
  if(ev.key==='Enter' && (ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); saveNote(); }
});
const mclearBtn=document.getElementById('mclear');
if(mclearBtn) mclearBtn.onclick=function(){
  if(!curSelList().length) return;
  const name = segName();
  setCurSelList([]);
  syncModalSelection(); render(); fbtnState();
  showToast('已清空' + name + '筛选');
};
const mallBtn=document.getElementById('mall');
if(mallBtn) mallBtn.onclick=function(){
  if(!(selectedCount() - curSelList().length)) return;
  clearAllFilters();
  syncModalSelection(); render(); fbtnState();
  showToast('已清空全部筛选');
};
const mCloseBtn=document.getElementById('mClose');
if(mCloseBtn) mCloseBtn.onclick=()=>closeModal();
elModal.onclick=ev=>{if(window.__lc2SuppressBackdrop){window.__lc2SuppressBackdrop=false;return;}if(ev.target===elModal)closeModal();};
document.querySelectorAll('#modal .mseg div').forEach(d=>{d.onclick=()=>{
  state.seg=d.dataset.seg;
  const seg=document.querySelector('#modal .mseg'); if(seg) seg.dataset.seg=state.seg;
  document.querySelectorAll('#modal .mseg div').forEach(x=>x.classList.toggle('on',x.dataset.seg===state.seg));
  syncSegThumb();
  renderModal(true);
};});
function updateModalQuery(){
  state.mq = modalQuery.value;
  renderModal();
}
modalQuery.addEventListener('input', updateModalQuery);
modalQueryClear.addEventListener('mousedown', (e) => e.preventDefault());
modalQueryClear.addEventListener('click', () => {
  modalQuery.value = '';
  updateModalQuery();
});
function updateSearchQuery(){
  state.q = searchQuery.value;
  searchQueryClear.hidden = !state.q;
  render();
  fbtnState();
}
function clearSearchQuery(){
  searchQuery.value = '';
  updateSearchQuery();
}
searchQuery.addEventListener('input', updateSearchQuery);
searchQueryClear.addEventListener('mousedown', (e) => e.preventDefault());
searchQueryClear.addEventListener('click', clearSearchQuery);
searchQuery.addEventListener('keydown',e=>{
  if (e.isComposing) return;
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation();
    if(state.q) clearSearchQuery();
    else e.target.blur();
  } else if(e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); e.target.blur(); }
});
modalQuery.addEventListener('keydown',e=>{
    if (e.isComposing) return;
    if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeModal(); }
  });
modalQuery.parentElement.addEventListener('click', () => acquireFocusInput(modalQuery));
function fbtnState(){
  elFbtn.classList.toggle('on', selectedCount() > 0);
  searchQuery.placeholder = '搜索流派 / 别名 / 武器 / 宝藏';
  syncSortUI();
}
elBubble.onclick=()=>{elPanel.classList.remove('hidden');elBubble.classList.add('hidden');elTip.classList.add('hidden');};

/* 面板休眠时点击任意位置唤醒（捕获阶段，先恢复焦点再处理点击） */
if (typeof window.lc2 !== 'undefined' && window.lc2) {
  document.addEventListener('mousedown', (event) => {
    if (!state.dormant) return;
    if (event.target.closest('.msearch, .searchbar input, .searchbar .search-clear')) return;
    state.dormant = false;
    if (window.lc2.activatePanel) window.lc2.activatePanel();
  }, true);
}


/* ===== 半星评分与实时预览 ===== */
function ratingValueHTML(selection){
  return selection.stars ? '<strong>'+selection.score+'</strong><small>分</small>' : '<span>未选择</span>';
}
function updateRatingPreview(box, starCount){
  const selection=domain.ratingSelection(starCount);
  box.querySelectorAll('.rp').forEach((star,index)=>{
    star.classList.toggle('is-full', selection.fills[index]===1);
    star.classList.toggle('is-half', selection.fills[index]===0.5);
  });
  box.querySelector('.rating-value').innerHTML=ratingValueHTML(selection);
}
function previewRating(event){
  const option=event.target.closest?.('.rating-half');
  if(option) updateRatingPreview(option.closest('.ratepick'), Number(option.value));
}
function restoreRating(event){
  const group=event.target.closest?.('.rating-stars');
  if(!group || group.contains(event.relatedTarget)) return;
  const box=group.closest('.ratepick');
  updateRatingPreview(box, state.myVote[box.dataset.bid]||0);
}
document.addEventListener('pointerover', previewRating);
document.addEventListener('focusin', previewRating);
document.addEventListener('pointerout', restoreRating);
document.addEventListener('focusout', restoreRating);
document.addEventListener('change', (event)=>{
  const option=event.target.closest?.('.rating-half');
  if(!option || !option.checked) return;
  const box=option.closest('.ratepick');
  const selection=domain.ratingSelection(Number(option.value));
  state.myVote[box.dataset.bid]=selection.stars;
  updateRatingPreview(box, selection.stars);
  box.closest('.card').querySelector('[data-rate]').classList.add('on');
});


/* ================= 用户印象 / 评价 ================= */
function bootNotes(){
  if(notesLoaded) return;
  notesLoaded = true;
  infra.notes.load().then(function(all){
    state.notes = all || {};
    render(); fbtnState();
  });
}

/**
 * 印象：每个流派一条记录，可反复修改。
 * 存储按 buildId 覆盖更新（不做增量历史）。
 */
function openNote(id){
  state.noteBid = id;
  var existing = state.notes[id] || '';
  var ta = document.getElementById('noteText');
  var c = document.getElementById('noteCount');
  var m = document.getElementById('noteModal');
  if(!ta || !m) return;
  ta.value = existing;
  ta.readOnly = false;
  if(c) c.textContent = String(ta.value.length);
  var saveBtn = document.getElementById('noteSave');
  if(saveBtn) saveBtn.style.display = '';
  var cancelBtn = document.getElementById('noteCancel');
  if(cancelBtn) cancelBtn.textContent = '取消';
  var title = document.querySelector('#noteModal .mh b');
  if(title) title.textContent = existing ? '修改我的印象' : '写点印象 / 评价';
  m.classList.add('on');
  /* 输入框获焦会注销面板热键，这里单独把 Esc 抢回来看住弹层 */
  window.lc2?.modalEscape?.(true);
  acquireFocusInput(ta);
  setTimeout(function(){ try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch(e){} }, 40);
}
function closeNote(){
  var m = document.getElementById('noteModal'); if(m) m.classList.remove('on');
  window.lc2?.modalEscape?.(false);
  releaseFocusInput();
  state.noteBid = null;
}
function saveNote(){
  var id = state.noteBid;
  var ta = document.getElementById('noteText');
  if(!id || !ta){ closeNote(); return; }
  var text = (ta.value || '').trim().slice(0, 120);
  var had = !!state.notes[id];
  if(!text && !had){ showToast('写一句话再保存吧'); return; }
  if(text) state.notes[id] = text; else delete state.notes[id];
  infra.notes.save(id, text, state.notes);   // 覆盖更新，不做增量历史
  closeNote();
  render(); fbtnState();
  showToast(text ? (had ? '印象已更新' : '印象已保存') : '已清除印象');
}

/* 键盘 */
document.addEventListener('keydown',e=>{
  const k=e.key;
  const tag=(e.target&&e.target.tagName)||'';
  if(k==='Escape' && e.target.matches?.('.rating-half')){e.preventDefault();state.ratingOpen=null;render();return;}
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;   // 输入控件自己处理键盘
  if((k==='Enter'||k===' ') && e.target.closest?.('.card .cname')) return;
  if(document.getElementById('itemDetail')?.classList.contains('on')){ if(k==='Escape'){e.preventDefault();closeItemDetail();} return; }
  /* 印象弹层：打开时占住键盘，Esc 只关它，不要再往下触发「详情返回 / 收起面板」 */
  if(document.getElementById('noteModal')?.classList.contains('on')){
    if(k==='Escape'){e.preventDefault();e.stopPropagation();closeNote();}
    return;
  }
  if(e.target===searchQueryClear && k==='Enter') return;
  if(k==='`'){e.preventDefault();
    if(typeof window.lc2!=='undefined'){ window.lc2.requestToggle(); return; }
    const hid=elPanel.classList.toggle('hidden');
    elBubble.classList.toggle('hidden',!hid);elTip.classList.toggle('hidden',!hid);return;}
  if(elPanel.classList.contains('hidden'))return;
  if(randomModal.classList.contains('on')){
    if(k==='Escape'){e.preventDefault();closeRandomDraw();}
    if(k==='Enter' && e.target===document){e.preventDefault();viewRandomResult();}
    return;
  }
  if (settingsModal.classList.contains('on')) {
    if (k === 'Escape') { e.preventDefault(); closeSettings(); }
    return;
  }
  if($help.classList.contains('on')){
    if(k==='Escape'||k==='h'||k==='H'){e.preventDefault();closeHelp();}
    return;
  }
  if(state.submitOpen){if(k==='Escape'){e.preventDefault();closeSubmit();}return;}
  if(state.modal){if(k==='Escape'){e.preventDefault();closeModal();}return;}
  if(k==='Escape'){e.preventDefault();
    if(state.ratingOpen){state.ratingOpen=null;render();return;}
    $toast.classList.remove('on');
    if(state.view==='detail')closeDetail();
    else if(state.q) clearSearchQuery();
    else if(selectedCount()){clearAllFilters();render();fbtnState();}
    else if(typeof window.lc2!=='undefined'){ window.lc2.requestToggle(); }
    return;}
  // 面板热键从主进程合成到 document，评分获得焦点时按半星档位处理。
  const focusedRating=document.activeElement?.closest('.rating-half');
  if(state.ratingOpen && focusedRating){
    const steps={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1};
    if(Object.hasOwn(steps,k)){
      e.preventDefault();
      const options=[...focusedRating.closest('.rating-stars').querySelectorAll('.rating-half')];
      const next=options[(options.indexOf(focusedRating)+steps[k]+options.length)%options.length];
      next.focus();
      next.click();
      return;
    }
    if(k==='Enter'||k===' '){e.preventDefault();focusedRating.click();return;}
  }
  if(k==='f'||k==='F'){e.preventDefault();motion.press($('sbar'));if(state.view==='feed')openModal();return;}
  if(k==='i'||k==='I'){e.preventDefault();motion.press($('sbtn'));if(state.view==='feed')$sbtn.click();return;}
  if(k==='h'||k==='H'){e.preventDefault();motion.press($('hbtn'));openHelp();return;}
  if(k==='p'||k==='P'){e.preventDefault();motion.press($('pinbtn'));
    if(typeof window.lc2!=='undefined'&&window.lc2.pinToggle){ window.lc2.pinToggle(); }
    else { const on=$('pinbtn').classList.toggle('on'); showToast(on?'已置顶':'已取消置顶'); }
    return;}
  if(k==='d'||k==='D'){e.preventDefault();if(state.view==='feed'&&!state.cur)return;state.view==='feed'?openDetail(state.cur):closeDetail();return;}
  if(k==='ArrowDown'||k==='ArrowUp'){
    if(state.view==='detail'){elDetail.scrollTop+=(k==='ArrowDown'?80:-80);e.preventDefault();return;}
    e.preventDefault();const list=visible();const i=list.findIndex(b=>b.id===state.cur);
    const n=Math.max(0,Math.min(list.length-1,(i<0?0:i)+(k==='ArrowDown'?1:-1)));
    if(list[n]){state.cur=list[n].id;render();}return;}
  if(k==='Enter'||k==='ArrowRight'){
    e.preventDefault();
    if(state.view==='detail'||!state.cur)return;
    const focusedName=document.activeElement?.closest('.card .cname');
    openDetail(focusedName?focusedName.closest('.card').dataset.bid:state.cur);
    return;
  }
  if(k==='ArrowLeft'){e.preventDefault();
    if(state.view==='detail')closeDetail();return;}
});

state.cur=firstVisibleId()||(BUILDS.length?BUILDS[0].id:'');
render();fbtnState();
if(typeof window.lc2 === 'undefined') bootNotes();   // 浏览器 / 原型：读 localStorage


/* ==================================================================
   Electron 适配层（双窗口架构）
   ?mode=bubble  只显示气泡，负责拖拽 / 点击
   ?mode=panel   只显示面板，负责数据与键盘
   浏览器直接打开 design/index.html 时 window.lc2 不存在，整段跳过
   ================================================================== */
(function(){
  if(typeof window.lc2 === 'undefined'){
    document.body.classList.add('web');
    return;
  }

  var params = new URLSearchParams(location.search);
  var mode = params.get('mode') || 'panel';
  var winMode = params.get('win') || 'alpha';
  var isBubble = mode === 'bubble';

  document.body.classList.add(winMode === 'shape' ? 'win-shape' : 'win-alpha');

  document.body.classList.add('electron', isBubble ? 'mode-bubble' : 'mode-panel');
  elPanel.classList.toggle('hidden', isBubble);
  elBubble.classList.toggle('hidden', !isBubble);
  elTip.classList.add('hidden');

  /* ---------------- 气泡窗口 ---------------- */
  if(isBubble){
    var drag = null;
    elBubble.addEventListener('pointerdown', function(ev){
      if(ev.button !== 0) return;
      drag = { sx: ev.screenX, sy: ev.screenY, moved: 0 };
      try { elBubble.setPointerCapture(ev.pointerId); } catch(e){}
      window.lc2.dragStart(ev.screenX, ev.screenY);
      ev.preventDefault(); ev.stopImmediatePropagation();
    }, true);
    elBubble.addEventListener('pointermove', function(ev){
      if(!drag) return;
      var dx = ev.screenX - drag.sx, dy = ev.screenY - drag.sy;
      drag.moved = Math.max(drag.moved, Math.sqrt(dx*dx + dy*dy));
      window.lc2.dragMove(ev.screenX, ev.screenY);
    }, true);
    elBubble.addEventListener('pointerup', function(ev){
      if(!drag) return;
      var moved = drag.moved; drag = null;
      try { elBubble.releasePointerCapture(ev.pointerId); } catch(e){}
      window.lc2.dragEnd();
      if(moved < 4) window.lc2.requestToggle();   // 轻点 = 开/关面板，气泡本身不消失
      ev.stopImmediatePropagation();
    }, true);
    elBubble.addEventListener('click', function(ev){ ev.stopImmediatePropagation(); }, true);
    return;   // 气泡窗口不加载数据、不处理键盘
  }

  /* ---------------- 面板窗口 ---------------- */
  state.open = true;
  render(); fbtnState();

  /* 面板拖拽：顶部拖拽条 + 标题栏空白处，共用同一套原生光标流。
     只绑定一次（onPanel 回调里重复绑定会导致一次拖动触发多次 dragStart）。 */
  if(!window.__lc2DragBound){
    window.__lc2DragBound = true;
    var pdrag = null;
    function bindPanelDrag(el){
      if(!el) return;
      el.addEventListener('pointerdown', function(ev){
        if(ev.button !== 0) return;
        if(ev.target.closest('.fbtn') || ev.target.closest('.back')) return;
    if(ev.target.closest('.mh-close, .ok, button, input, textarea, .mseg, .seg-thumb, .rvclear, .rvback, .subarrow, .msubmit, .mfoot')) return;
        if(el.classList.contains('modal') && ev.target.closest('.msheet')) return;
        pdrag = { sx: ev.screenX, sy: ev.screenY };
        try { el.setPointerCapture(ev.pointerId); } catch(e){}
        window.lc2.panelDragStart(ev.screenX, ev.screenY);
        ev.preventDefault();
      }, true);
      /* 位移由主进程原生光标流完成（非聚焦窗口 pointermove 会断），
         这里只保留 start / end 生命周期标记。 */
      el.addEventListener('pointerup', function(ev){
        if(!pdrag) return;
        const moved = Math.abs((ev.screenX||0) - pdrag.sx) > 3 || Math.abs((ev.screenY||0) - pdrag.sy) > 3;
        pdrag = null;
        try { el.releasePointerCapture(ev.pointerId); } catch(e){}
        window.lc2.panelDragEnd();
        if(moved){
          window.__lc2SuppressBackdrop = true;
          setTimeout(function(){ window.__lc2SuppressBackdrop = false; }, 180);
        }
      }, true);
    }
    /* 自定义窗口缩放：避免无边框窗口右下角原生命中不稳定 */
  (function bindResizeHandles(){
    const panelEl = document.getElementById('panel');
    if(!panelEl || !window.lc2 || !window.lc2.panelResizeStart) return;
    let rz = null;
    function endResizeOnce(){ if(!rz) return; rz = null; window.lc2.panelResizeEnd(); }
    const dirs = ['n','s','e','w','ne','nw','se','sw'];
    dirs.forEach((dir) => {
      const el = document.createElement('div');
      el.className = 'rz rz-' + dir;
      el.dataset.dir = dir;
      el.addEventListener('pointerdown', (ev) => {
        if(ev.button !== 0) return;
        rz = { id: ev.pointerId };
        try { el.setPointerCapture(ev.pointerId); } catch(e){}
        try { el.addEventListener('lostpointercapture', endResizeOnce, { once: true }); } catch(e){}
        window.lc2.panelResizeStart(ev.screenX, ev.screenY, dir);
        ev.preventDefault();
        ev.stopPropagation();
      }, true);
      panelEl.appendChild(el);
    });
    function endResize(ev){
      if(!rz) return;
      rz = null;
      window.lc2.panelResizeEnd();
      if(ev && ev.preventDefault) ev.preventDefault();
    }
    document.addEventListener('pointerup', endResize, true);
    document.addEventListener('pointercancel', endResize, true);
    window.addEventListener('blur', () => { if(rz){ rz = null; window.lc2.panelResizeEnd(); } });
  })();

  bindPanelDrag(document.getElementById('grip'));   // 顶部拖拽条
    bindPanelDrag(document.getElementById('hdr'));    // 标题栏空白处（按钮除外）
    /* 弹窗打开后顶部栏被遮住：让弹窗标题栏/复查栏也能拖动整窗 */
    document.querySelectorAll('.modal .mh, #submitModal .rvbar').forEach((el) => bindPanelDrag(el));
  bindPanelDrag(document.getElementById('modal'));
  bindPanelDrag(document.getElementById('submitModal'));
  bindPanelDrag(document.getElementById('help'));
  bindPanelDrag(document.getElementById('settings'));
  bindPanelDrag(randomModal);
    /* 阻止 Chromium 原生拖拽：否则按住图标/文字会拖出“幽灵”并选中 */
    document.addEventListener('dragstart', function(ev){ ev.preventDefault(); }, true);
  }

/* 打分星点按弹一下（事件委托，不侵入业务逻辑） */
document.addEventListener('click', function(ev){
  const option=ev.target.closest?.('.rating-half');
  if(option) motion.replay(option.closest('.rp').querySelector('.rp-icon'), 'm-pop');
}, true);

/* 主进程全局热键 → 合成 keydown，复用已有键盘逻辑 */
  window.lc2.onKey(function(key){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
  });

  /* 面板显隐由主进程通知 */
window.addEventListener('focus', () => {
  const input = pendingInputFocus;
  pendingInputFocus = null;
  input?.focus();
});

window.addEventListener('blur', () => {
  resetInputFocus();
  state.dormant = true;
});

if (window.lc2.onDormant) {
  window.lc2.onDormant(function(v){
    state.dormant = !!v;
    if (state.dormant) resetInputFocus();
  });
}

window.lc2.onPanel(function(s){
    var payload = (s && typeof s === 'object') ? s : { open: s === 'open' };
    state.open = !!payload.open;
    if(payload.frame){
      document.body.classList.toggle('frame-dwm', payload.frame === 'dwm');
      elPanel.style.setProperty('--window-radius', payload.cornerRadius + 'px');
    }
    if (!state.open) closeSettings();
    if (!state.open) closeRandomDraw();
    if (!payload.open) resetInputFocus();
    if(typeof payload.pinned === 'boolean'){
      var pb = document.getElementById('pinbtn');
      if(pb) pb.classList.toggle('on', payload.pinned);
    }
    if(payload.side){
      var p = document.getElementById('panel');
      if(p) p.style.transformOrigin = payload.side === 'left' ? '100% 50%' : '0% 50%';
    }
    render();
    if(state.open) setTimeout(motion.panelIn, 16);
  });

  bootNotes();

/* 载入真实数据（Electron 面板窗口） */
  function applyPayload(d){
    closeRandomDraw();
    loadInscriptions(d.inscriptions);
    loadWeaponTypes(d.weapons);
  loadWeapons(d.weaponItems);
    loadArmors(d.armors);
    loadSoulStones(d.soulStones);
    loadCursedTreasures(d.cursedTreasures);
    loadNightmareEffects(d.nightmareEffects);
    if (state.submitOpen && !subReviewOpen && SUB_PAGES[subPage] === 'nightmare') renderNightmareEditor();
    applyCatalogIcons();
    loadTreasures(d.treasures);
    applyTreasureIcons();
    const attribution = Object.values(INSC).find((item) => item.source)?.source;
    if (attribution) {
      const source = $('catalogSource');
      source.textContent = `图鉴来源：${attribution.name}（${attribution.license}）`;
      source.title = attribution.url;
      source.hidden = false;
    }
    var arr = domain.normalizeBuilds(d.builds);
    BUILDS.length = 0;
    Array.prototype.push.apply(BUILDS, arr);
    state.cur = firstVisibleId() || (arr.length ? BUILDS[0].id : '');
    dataStatus = 'ready';
    render(); fbtnState();
    if (state.modal) renderModal();
  }
  window.__lc2ApplyPayload = applyPayload;
  async function refreshData(){
    const isInitial = dataStatus !== 'ready';
    if(dataStatus === 'failed'){
      dataStatus = 'loading';
      render();
    }
    try {
      const data = await infra.data.load();
      if (!data) throw new Error('未取得有效的流派数据');
      applyPayload(data);
      return data;
    } catch (error) {
      console.error('[lc2] 数据加载失败', error);
      if(isInitial){
        dataStatus = 'failed';
        render();
      }
      return null;
    }
  }
  window.__lc2RefreshData = refreshData;
  void refreshData();
})();
})();
