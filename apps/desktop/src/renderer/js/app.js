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

  const { INSC_DEF, WEAPONS, INSC, BUILDS, ALL_TAGS } = LC2.data.catalog;
  const { ic, ICON_SVG, RC } = LC2.ui.icons;
  const { $, esc } = LC2.ui.dom;
  const refs = LC2.ui.dom.refs;
  const elFeed = refs.feed, elDetail = refs.detail, elSbar = refs.sbar, elBack = refs.back,
        elTtl = refs.ttl, elModal = refs.modal, elGrid = refs.mgrid,
        elPanel = refs.panel, elBubble = refs.bubble, elTip = refs.bubbleTip;
  const elFbtn = elSbar;
  const domain = LC2.domain;
  const infra = LC2.infra;
  const motion = LC2.ui.motion;
  const W = domain.weapon, wName = domain.weaponName, inscName = domain.inscriptionName, stars = domain.stars;

/* ================= 应用状态 ================= */
let pendingStagger = false;   // render 后是否让列表重新错峰入场
let notesLoaded = false;

const state={sort:'hot',view:'feed',detailId:null,expanded:{},cur:'',owned:new Set(),myVote:{},
  favs:new Set(),ratingOpen:null,notes:{},noteBid:null,
  q:'',focusedInput:false,dormant:false,tag:null,filterW:null,filterI:null,modal:false,seg:'w',sideSel:null,mq:''};

/* ================= 数据加载提示 ================= */
function logDataSummary(arr){
  try{
    console.log('[lc2] 流派数据已加载：' + arr.length + ' 条'
      + (arr.length ? '' : '（数据为空，显示空状态）'));
  }catch(e){}
}

/* ================= 领域调用（应用状态 → 领域参数） ================= */
function currentFilters() {
  return { q: state.q, filterW: state.filterW, filterI: state.filterI, tag: state.tag, sort: state.sort };
}
function visible() {
  return domain.visibleBuilds(BUILDS, currentFilters());
}

/* ===== 搜索焦点：面板默认不抢焦点，输入时才临时获焦 ===== */
function acquireFocusInput(el){
  state.focusedInput = true;
  try{ console.log('[search] acquire api=' + !!(window.lc2&&window.lc2.searchFocus) + ' el=' + (el&&el.id)); }catch(e){}
  var sb=document.getElementById('sbar');
  if(sb && el && el.id==='q') sb.classList.add('searching');
  if(typeof window.lc2!=='undefined' && window.lc2.searchFocus) window.lc2.searchFocus(true);
  setTimeout(function(){ try{ el.focus(); }catch(e){} }, 20);
  setTimeout(function(){ try{ if(document.activeElement!==el) el.focus(); }catch(e){} }, 90);
}
function releaseFocusInput(){
  if(!state.focusedInput) return;
  state.focusedInput = false;
  var sb=document.getElementById('sbar');
  if(sb) sb.classList.remove('searching');
  var ae=document.activeElement;
  if(ae && ae.blur) { try{ ae.blur(); }catch(e){} }
  if(typeof window.lc2!=='undefined' && window.lc2.searchFocus) window.lc2.searchFocus(false);
}

function render(){
  const isFeed=state.view==='feed';
  elFeed.style.display=isFeed?'block':'none';
  elDetail.style.display=isFeed?'none':'block';
  elSbar.style.display=isFeed?'flex':'none';
  elBack.style.display=isFeed?'none':'inline';
  /* 详情页：隐藏「帮助 / 筛选 / 投稿 / 标题」，只留返回 */
  $sbtn.style.display=isFeed?'':'none';
  $hbtn.style.display=isFeed?'':'none';
  elTtl.style.display=isFeed?'':'none';
  isFeed?renderFeed():renderDetail();
  if(pendingStagger){ pendingStagger=false; motion.stagger(elFeed); }
}

/* ---------- 卡片 ---------- */
function renderFeed(){
  const list=visible();
  if(!list.some(b=>b.id===state.cur)&&list.length)state.cur=list[0].id;
  if(!BUILDS.length){
    elFeed.innerHTML='<div class="empty">'
      +'<img class="empty-crest" alt="" src="../../assets/tray-32.png">'
      +'<div class="empty-title">数据准备中</div>'
      +'<div class="empty-sub">还没有接入真实流派数据</div>'
      +'<div class="empty-hint">数据源就绪后，流派会自动出现在这里</div>'
      +'</div>';
    return;
  }
  if(!list.length){elFeed.innerHTML='<div class="tip">没有匹配的流派。按 F 重新筛选。</div>';return;}
  elFeed.innerHTML=list.map(b=>cardHTML(b,b.id===state.cur)).join('');
  elFeed.querySelectorAll('.card').forEach(n=>{
    n.onclick=ev=>{
      const bid=n.dataset.bid;
      if(ev.target.closest('.det')){openDetail(bid);return;}
      if(ev.target.closest('[data-fav]')){toggleFav(bid);return;}
      if(ev.target.closest('[data-rate]')){state.ratingOpen=(state.ratingOpen===bid?null:bid);render();return;}
if(ev.target.closest('[data-note]')){openNote(bid);return;}
      if(ev.target.closest('.rp')){state.myVote[bid]=+ev.target.dataset.v;state.ratingOpen=null;render();return;}
      toggleExpand(bid);
    };
  });
  const c=elFeed.querySelector('.card.is-active');if(c)c.scrollIntoView({block:'nearest'});
}
function cardHTML(b,isCur){
  const open=!!state.expanded[b.id];
  let h='<div class="card'+(isCur?' is-active':'')+'" data-bid="'+b.id+'">';
  h+='<div class="ch">'+ic(b.wt,W(b.wt).short,'s46')
   +'<div class="main"><div class="cname">'+esc(b.name)+'</div>'
   +'<div class="cmeta">'+esc(wName(b.wt))+' · '+esc(inscName(b.insc))+'</div>'
   +'<div class="rate"><span class="sc">★ '+b.rating.toFixed(1)+'</span>'+stars(b.rating)
   +'<span style="color:#767e94">'+b.votes+' 人打分</span></div></div>'
   +'<div class="right-col"><span class="det" data-det="'+b.id+'">详情</span>'
   +'<div class="cardacts">'
   +'<span class="act'+(state.myVote[b.id]?' on':'')+'" data-rate="'+b.id+'" title="打分">'+ICON_SVG.star+'</span>'
   +'<span class="act fav'+(state.favs.has(b.id)?' on':'')+'" data-fav="'+b.id+'" title="收藏">'+ICON_SVG.heart+'</span>'
+'<span class="act note'+(state.notes[b.id]?' on':'')+'" data-note="'+b.id+'" title="'+(state.notes[b.id]?'修改我的印象':'写点印象')+'">'+ICON_SVG.note+'</span>'
   +'</div></div></div>';

  if((b.features||[]).length){
    h+='<div class="chips" style="margin-top:11px">'+b.features.map(f=>'<span class="chip np">'+esc(f)+'</span>').join('')+'</div>';
  }

  if(state.ratingOpen===b.id){
    const my=state.myVote[b.id]||0;
    h+='<div class="ratepick"><span>给这个流派打分</span>'
     +[1,2,3,4,5].map(v=>'<span class="rp'+(v<=my?' on':'')+'" data-v="'+v+'">★</span>').join('')
     +'</div>';
  }
  if(open){
    h+='<div class="sec">玩法技巧</div><div class="tip">'+esc(b.tip)+'</div>';
    if((b.treasureOrder||[]).length){
      h+='<div class="sec">核心宝藏</div><div class="chips">'
       +b.treasureOrder.slice(0,6).map(t=>'<span class="chip">'+ic(t.n,t.n,'s24',RC[t.r]||'#3b4a63')+esc(t.n)+'</span>').join('')+'</div>';
    }
    h+='<div class="footline"><span>'+esc(b.src)+'</span><span>更新 '+esc(b.updated)+'</span></div>';
  }
  return h+'</div>';
}

/* ---------- 详情 ---------- */
function openDetail(id){state.detailId=id;state.view='detail';render();motion.replay(elDetail,'m-view-in');}
function closeDetail(){state.view='feed';state.detailId=null;render();motion.replay(elFeed,'m-view-back');}
function sec(t,body,hint){return body?('<div class="sec">'+t+(hint?' <span class="hint">'+hint+'</span>':'')+'</div>'+body):'';}
function box(title,body,iconHtml){return '<div class="box"><h4>'+(iconHtml||'')+esc(title)+'</h4>'+body+'</div>';}

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
   +'<div class="rate"><span class="sc">★ '+b.rating.toFixed(1)+'</span>'+stars(b.rating)
     +'<span style="color:#767e94">'+b.votes+' 人打分</span></div>'
   +'</div></div>';

  /* 玩法技巧 */
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

  /* 武器刻印 + 灵魂石 */
  if(b.inscEff||b.resonance){
    let body=esc(b.inscEff||'待补');
    if(b.resonance) body+='<div class="res"><b>共鸣选择 '+esc(b.resonance.code)+'</b><br>'
      +b.resonance.nodes.map(n=>'· '+esc(n)).join('<br>')+'</div>';
    h+=sec('武器刻印',box(inscName(b.insc),body,ic(b.insc,'','s30','#4a3f2a')));
  }
  if((b.soulStones||[]).length||(b.soulPlan||[]).length){
    let body='';
    if((b.soulStones||[]).length){
      body+=b.soulStones.map(s=>'<div class="srow"><span class="sn">'+esc(s.name)+'</span>'
        +'<span class="sl">'+esc(s.lv||'—')+'</span><span class="se">'+esc(s.eff)+'</span></div>').join('');
    }
    if((b.soulPlan||[]).length){
      body+='<div class="plan">'+b.soulPlan.map(p=>'<span class="pg"><b>'+esc(p.g)+'</b>'+esc(p.items.join(' + '))+'</span>').join('')+'</div>';
    }
    h+=sec('灵魂石',box('词条与分配方案',body));
  }

  /* 武器、衣服（推荐清单 + 毕业装） */
  if(b.gear||(b.weaponChoices||[]).length||(b.core||[]).length||(b.transition||[]).length){
    let body='';
    /* 推荐清单 */
    const rlist=(b.weaponChoices&&b.weaponChoices.length
        ? b.weaponChoices.slice()
        : (b.core||[]).map(n=>({name:n,tag:'核心',note:''}))).slice();
    (b.transition||[]).forEach(t=>rlist.push({name:t.name,tag:'过渡',note:(t.note||'')+(t.obtain?'　获取：'+t.obtain:'')}));
    if(rlist.length){
      body+='<div class="gtitle" style="margin-top:0">推荐清单</div><div class="plist">';
      rlist.forEach(w=>{
        body+='<div class="prow" style="align-items:flex-start;padding:7px 9px">'
          +ic(w.name,w.name,'s24',RC['传奇'])
          +'<span style="flex:1;min-width:0">'
          +'<span style="color:#d5dae6">'+esc(w.name)+'</span>'
          +(w.tag?'<span class="tierb" style="margin-left:7px;background:rgba(139,154,212,.16);color:#a3b2d4">'+esc(w.tag)+'</span>':'')
          +(w.note?'<span style="display:block;font-size:11.5px;color:#8f96a8;margin-top:3px;line-height:1.6">'+esc(w.note)+'</span>':'')
          +'</span></div>';
      });
      body+='</div>';
    }
    /* 毕业装 */
    if(b.gear){
      body+='<div class="gtitle" style="margin-top:12px">毕业装</div>';
      if(b.gear.weapon){const w=b.gear.weapon;
        body+='<div class="gear">'+ic(w.name,w.name,'s46',RC[w.rarity]||'#3b4a63')
          +'<div class="gt"><div class="gname">'+esc(w.name)
          +'<span class="gtag t-weapon">'+esc(w.type)+'</span><span class="gtag t-legend">'+esc(w.rarity)+'</span></div>'
          +'<div class="ps">攻击力 '+esc(w.atk)+'　·　技能「'+esc(w.skill)+'」消耗 '+esc(w.cost)+' 法力</div>'
          +'<div class="ps">'+esc(w.note)+'</div>'
          +'<div class="ps" style="color:#7f8798">获取：'+esc(w.obtain||'待补')+'</div></div></div>';
      }
      if(b.gear.armor){const a=b.gear.armor;
        body+='<div class="gear">'+ic(a.name,a.name,'s46',RC[a.rarity]||'#3b4a63')
          +'<div class="gt"><div class="gname">'+esc(a.name)
          +'<span class="gtag t-armor">'+esc(a.type)+'</span><span class="gtag t-legend">'+esc(a.rarity)+'</span></div>'
          +'<div class="attrs">'+(a.attrs||[]).map(x=>'<span class="attr">'+esc(x)+'</span>').join('')+'</div>'
          +'<div class="ps">'+esc(a.note)+'</div>'
          +'<div class="ps" style="color:#7f8798">获取：'+esc(a.obtain||'待补')+'</div></div></div>';
      }
    }
    h+=sec('武器、衣服',box('推荐清单 / 毕业装',body));
  }

  /* 宝藏怎么选：混沌 / 合成金 / 其他（按顺序拿） */
  const tOrder=b.treasureOrder||[];
  if(b.treasures&&(b.treasures.chaos.length||b.treasures.gold.length||tOrder.length||(b.treasureNotes||[]).length)){
    let body='';
    const chipRow=(label,arr)=>{if(!arr||!arr.length)return '';
      return '<div class="kv" style="align-items:flex-start;padding:5px 0"><span class="k">'+label+'</span>'
        +'<span style="flex:1;text-align:right">'+arr.map(x=>'<span class="chip np" style="margin:2px 0 2px 5px">'
        +ic(x,x,'s24',RC['史诗'])+esc(x)+'</span>').join('')+'</span></div>';};
    body+=chipRow('混沌宝藏',b.treasures.chaos)+chipRow('合成金宝藏',b.treasures.gold);
    if(tOrder.length){
      body+='<div class="gtitle" style="margin-top:11px;color:#8b9ad4">其他宝藏 · 按这个顺序拿'
        +'<span style="color:#6b7386;font-weight:400">（越靠前越优先）</span></div>';
      body+='<div class="plist">';
      tOrder.forEach(x=>{
        body+='<div class="prow">'
          +ic(x.n,x.n,'s24',RC[x.r]||'#3b4a63')
          +'<span class="nm2">'+esc(x.n)+'</span>'
          +'<span class="rar">'+esc(x.r)+'</span></div>';
      });
      body+='</div><div class="chaincap" style="margin-top:7px">按从上到下拿　·　前面的是垫底件，先拿它们，后面的才刷得出来</div>';
    }
    if((b.treasureNotes||[]).length)body+='<div class="tip" style="margin-top:9px">'+b.treasureNotes.map(n=>'· '+esc(n)).join('<br>')+'</div>';
    h+=sec('宝藏怎么选',box('混沌 / 合成金 / 其他',body));
  }

  /* ⑥ 诅咒宝藏 */
  if((b.cursed||[]).length){
    let body=b.cursed.map(c=>'<div class="cursed">'+ic(c.name,c.name,'s30',RC['诅咒'])
      +'<div class="cmain"><div class="ctitle">'+esc(c.name)
      +'<span class="vd '+(c.verdict==='净化'?'purge':'keep')+'">'+esc(c.verdict)+'</span></div>'
      +'<div class="ceff">'+esc(c.eff)+'</div></div></div>').join('');
    h+=sec('诅咒宝藏',box('拿不拿 / 净不净化',body));
  }

  /* ⑦ 炼金与猎人道具 */
  if((b.alchemy||[]).length||(b.hunterItems||[]).length){
    let body='';
    if((b.alchemy||[]).length){
      body+=b.alchemy.map(a=>'<div class="srow"><span class="sn">'+esc(a.name)+'</span>'
        +'<span class="se">'+esc(a.eff)+'</span></div>').join('');
    }
    if((b.hunterItems||[]).length){
      body+='<div class="plan">'+b.hunterItems.map(x=>'<span class="pg"><b>'+esc(x.name)+'</b>'+esc(x.eff)+'</span>').join('')+'</div>';
    }
    h+=sec('炼金与猎人道具',box('材料 / 道具',body));
  }

  /* ⑧ 梦魇加点 */
  if((b.nightmareList||[]).length){
    const body='<div class="nmgrid">'+b.nightmareList.map(n=>
      '<div class="nmrow"><span>'+esc(n.n)+'</span><span class="p">'+esc(n.p||'—')+'</span></div>').join('')+'</div>';
    h+=sec('梦魇推荐加点',box('个人自用方案',body));
  }

  h+='<div class="footline"><span>作者 '+esc(b.author||'—')+' · 来源：'+esc(b.src)+'</span><span>更新 '+esc(b.updated)+'</span></div>';
  
  elDetail.innerHTML=h;elDetail.scrollTop=0;
  elDetail.querySelectorAll('[data-tag]').forEach(n=>{n.onclick=()=>{state.tag=n.dataset.tag;closeDetail();fbtnState();};});
}

/* ================= 交互 ================= */
function toggleExpand(id){
  state.cur=id;
  state.expanded[id]=!state.expanded[id];
  render();
  if(state.expanded[id]){
    const card=document.querySelector('.card[data-bid="'+id+'"]');
    if(card) motion.replay(card,'m-expanding');
  }
}
function toggleFav(id){
  state.favs.has(id)?state.favs.delete(id):state.favs.add(id);
  render();
  const el=document.querySelector('.card[data-bid="'+id+'"] .act.fav');
  if(el) motion.replay(el,'m-pop');
}
elBack.onclick=closeDetail;

/* 筛选 */
function openModal(){state.modal=true;state.mq='';$('mq').value='';
  elModal.classList.add('on');
    var sb=document.getElementById('sbar'); if(sb) sb.classList.add('open');
    renderModal();}
function closeModal(){
    pendingStagger = state.modal;
    state.modal=false;elModal.classList.remove('on');
    var sb=document.getElementById('sbar'); if(sb) sb.classList.remove('open');
    if(state.focusedInput) releaseFocusInput();
  }
function cell(key,label,sub,on){
  return '<div class="mg'+(on?' on':'')+'" data-k="'+esc(key)+'">'
    +ic(key,label,'s46',RC['传奇'])
    +'<div class="cn">'+esc(label)+'</div>'
    +(sub?'<div class="cc">'+esc(sub)+'</div>':'')+'</div>';
}
function renderModal(){
  const q=state.mq.toLowerCase();
  if(state.seg==='t'){
    const items=ALL_TAGS.filter(([t])=>!q||t.toLowerCase().includes(q));
    elGrid.innerHTML=items.length?items.map(([t,arr])=>
      '<div class="mg'+(state.tag===t?' on':'')+'" data-k="'+esc(t)+'">'
      +'<div style="background:#2c3346;color:#c2ceec;border-radius:8px;padding:8px 4px;font-size:11.5px">'+esc(t)+'</div>'
      +'<div class="cc">'+arr.length+' 个玩法</div></div>').join('')
      :'<div style="color:#6b7386;font-size:12px">无匹配标签</div>';
    elGrid.querySelectorAll('.mg').forEach(n=>{n.onclick=()=>{const t=n.dataset.k;state.tag=(state.tag===t?null:t);renderModal();};});
    return;
  }
  if(state.seg==='w'){
    const items=WEAPONS.filter(w=>!q||(w.name+w.short).toLowerCase().includes(q));
    elGrid.innerHTML=items.map(w=>cell(w.id,w.name,'',state.filterW===w.id)).join('');
    elGrid.querySelectorAll('.mg').forEach(n=>{n.onclick=()=>{const k=n.dataset.k;state.filterW=(state.filterW===k?null:k);renderModal();};});
  }else{
    const items=Object.values(INSC).filter(i=>!q||i.name.toLowerCase().includes(q));
    elGrid.innerHTML=items.map(i=>cell(i.id,i.name.replace('刻印',''),W(i.wt).short,state.filterI===i.id)).join('');
    elGrid.querySelectorAll('.mg').forEach(n=>{n.onclick=()=>{const k=n.dataset.k;state.filterI=(state.filterI===k?null:k);renderModal();};});
  }
}
elFbtn.onclick=(ev)=>{
  const t=ev.target;
  if(t && t.closest && (t.closest('#fopen') || t.closest('#fchev'))){ releaseFocusInput(); openModal(); return; }
  acquireFocusInput($('q'));
};
const $pinbtn=$('pinbtn');
$pinbtn.onclick=()=>{
  motion.press($pinbtn);
  $pinbtn.classList.toggle('on');   // 立即反馈，主进程回包再校正
  if(typeof window.lc2!=='undefined' && window.lc2.pinToggle){ window.lc2.pinToggle(); }
  else { const on=$pinbtn.classList.toggle('on'); showToast(on?'已置顶：点击外部不收起':'已取消置顶'); }
};
if(typeof window.lc2!=='undefined' && window.lc2.onPin){
  window.lc2.onPin(function(p){
    $pinbtn.classList.toggle('on',!!p);
    showToast(p?'已置顶：点击外部不收起':'已取消置顶');
  });
}

/* 排序（在筛选弹层里） */
function syncSortUI(){
  document.querySelectorAll('#msort .so').forEach(x=>x.classList.toggle('on',x.dataset.sort===state.sort));
}
document.querySelectorAll('#msort .so').forEach(d=>{
  d.onclick=()=>{state.sort=d.dataset.sort;syncSortUI();render();fbtnState();};
});

/* 投稿（v1 仅入口提示，详情页 v2 做） */
const $sbtn=$('sbtn'),$toast=$('toast');
let toastTimer=null;
function showToast(msg,ms){
  $toast.innerHTML=msg;$toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$toast.classList.remove('on'),ms||4200);
}
$sbtn.onclick=()=>{
  showToast('<b style="color:#c8d8f5">投稿功能将在 v2 开放</b><br>'
   +'流程：填写流派表单 → 审核 → 上线，投稿人署名<br>'
   +'需填：流派名 / 别名 / 武器+刻印 / 特色 / 秒伤 / 刻印共鸣 / 灵魂石 / 毕业装备 / 宝藏 / 诅咒宝藏 / 炼金 / 梦魇加点');
};

/* 帮助 */
const $hbtn=$('hbtn'),$help=$('help'),$helpClose=$('helpClose');
function openHelp(){$help.classList.add('on');}
function closeHelp(){$help.classList.remove('on');}
$hbtn.onclick=openHelp;
$helpClose.onclick=closeHelp;
$help.onclick=ev=>{if(ev.target===$help)closeHelp();};
$('noteCancel').onclick=closeNote;
$('noteSave').onclick=saveNote;
$('noteText').addEventListener('input',function(){ var c=$('noteCount'); if(c) c.textContent=String(this.value.length); });
$('noteText').addEventListener('keydown',function(ev){
  if(ev.key==='Escape'){ ev.preventDefault(); ev.stopPropagation(); closeNote(); }
  if(ev.key==='Enter' && (ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); saveNote(); }
});
$('mCancel').onclick=()=>{state.filterW=null;state.filterI=null;state.tag=null;closeModal();render();fbtnState();};
$('mOk').onclick=()=>{closeModal();render();fbtnState();};
elModal.onclick=ev=>{if(ev.target===elModal)closeModal();};
document.querySelectorAll('.mseg div').forEach(d=>{d.onclick=()=>{state.seg=d.dataset.seg;
  document.querySelectorAll('.mseg div').forEach(x=>x.classList.toggle('on',x.dataset.seg===state.seg));renderModal();};});
$('mq').addEventListener('input',e=>{state.mq=e.target.value;renderModal();});
$('q').addEventListener('input',e=>{state.q=e.target.value;render();fbtnState();});
$('q').addEventListener('blur',()=>{
  var sb=document.getElementById('sbar'); if(sb) sb.classList.remove('searching');
});
$('q').addEventListener('keydown',e=>{
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation();
    if(state.q){ state.q=''; e.target.value=''; render(); fbtnState(); }
    else e.target.blur();
  } else if(e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); e.target.blur(); }
});
$('mq').addEventListener('keydown',e=>{
    if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeModal(); }
  });
  var msearchEl=document.querySelector('.msearch'); if(msearchEl) msearchEl.addEventListener('click',()=>acquireFocusInput($('mq')));
function fbtnState(){
  const p=[];if(state.filterW)p.push(wName(state.filterW));
  if(state.filterI)p.push(inscName(state.filterI).replace('刻印',''));
  if(state.tag)p.push(state.tag);
  if(state.sort==='rating')p.push('评分');
  elFbtn.classList.toggle('on',p.length>0);
  const inp=$('q');
  if(inp) inp.placeholder = p.length ? ('已筛选：'+p.join(' · ')+'（点此搜索或调整）') : '搜索流派 / 别名 / 武器 / 宝藏';
  syncSortUI();
}
elBubble.onclick=()=>{elPanel.classList.remove('hidden');elBubble.classList.add('hidden');elTip.classList.add('hidden');};

/* 面板休眠时点击任意位置唤醒（捕获阶段，先恢复焦点再处理点击） */
if (typeof window.lc2 !== 'undefined' && window.lc2) {
  document.addEventListener('mousedown', () => {
    if (state.dormant) {
      state.dormant = false;
      if (window.lc2.activatePanel) window.lc2.activatePanel();
    }
  }, true);
}


/* ===== 打分悬停预览 ===== */
function __setRatePreview(box, n){
  if(!box) return;
  box.querySelectorAll('.rp').forEach(function(s){
    var v = +s.dataset.v;
    s.classList.toggle('preview', n > 0 && v <= n);
    s.classList.toggle('dim', n > 0 && v > n);
  });
}
document.addEventListener('mouseover', function(ev){
  var rp = ev.target && ev.target.closest ? ev.target.closest('.ratepick .rp') : null;
  if(!rp) return;
  __setRatePreview(rp.closest('.ratepick'), +rp.dataset.v);
});
document.addEventListener('mouseout', function(ev){
  var box = ev.target && ev.target.closest ? ev.target.closest('.ratepick') : null;
  if(!box) return;
  var to = ev.relatedTarget;
  if(to && box.contains(to)) return;
  __setRatePreview(box, 0);
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
  acquireFocusInput(ta);
  setTimeout(function(){ try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch(e){} }, 40);
}
function closeNote(){
  var m = document.getElementById('noteModal'); if(m) m.classList.remove('on');
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
  if(tag==='INPUT'||tag==='TEXTAREA') return;   // 输入控件自己处理键盘
  if(k==='`'){e.preventDefault();
    if(typeof window.lc2!=='undefined'){ window.lc2.requestToggle(); return; }
    const hid=elPanel.classList.toggle('hidden');
    elBubble.classList.toggle('hidden',!hid);elTip.classList.toggle('hidden',!hid);return;}
  if(elPanel.classList.contains('hidden'))return;
  if($help.classList.contains('on')){
    if(k==='Escape'||k==='h'||k==='H'){e.preventDefault();closeHelp();}
    return;
  }
  if(state.modal){if(k==='Escape'){e.preventDefault();closeModal();}return;}
  if(k==='Escape'){e.preventDefault();
    $toast.classList.remove('on');
    if(state.view==='detail')closeDetail();
    else if(state.q){state.q='';$('q').value='';render();}
    else if(state.tag){state.tag=null;render();fbtnState();}
    else if(typeof window.lc2!=='undefined'){ window.lc2.requestToggle(); }
    return;}
  if(k==='f'||k==='F'){e.preventDefault();motion.press($('sbar'));if(state.view==='feed')openModal();return;}
  if(k==='i'||k==='I'){e.preventDefault();motion.press($('sbtn'));if(state.view==='feed')$sbtn.click();return;}
  if(k==='h'||k==='H'){e.preventDefault();motion.press($('hbtn'));openHelp();return;}
  if(k==='p'||k==='P'){e.preventDefault();motion.press($('pinbtn'));
    if(typeof window.lc2!=='undefined'&&window.lc2.pinToggle){ window.lc2.pinToggle(); }
    else { const on=$('pinbtn').classList.toggle('on'); showToast(on?'已置顶：点击外部不收起':'已取消置顶'); }
    return;}
  if(k==='d'||k==='D'){e.preventDefault();if(state.view==='feed'&&!state.cur)return;state.view==='feed'?openDetail(state.cur):closeDetail();return;}
  if(k==='ArrowDown'||k==='ArrowUp'){
    if(state.view==='detail'){elDetail.scrollTop+=(k==='ArrowDown'?80:-80);e.preventDefault();return;}
    e.preventDefault();const list=visible();const i=list.findIndex(b=>b.id===state.cur);
    const n=Math.max(0,Math.min(list.length-1,(i<0?0:i)+(k==='ArrowDown'?1:-1)));
    if(list[n]){state.cur=list[n].id;render();}return;}
  if(k==='Enter'||k==='ArrowRight'){e.preventDefault();if(state.view==='detail'||!state.cur)return;toggleExpand(state.cur);return;}
  if(k==='ArrowLeft'){e.preventDefault();
    if(state.view==='detail')closeDetail();
    else if(state.expanded[state.cur]){state.expanded[state.cur]=false;render();}return;}
});

state.cur=BUILDS.length?BUILDS[0].id:'';
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
        pdrag = { sx: ev.screenX, sy: ev.screenY };
        try { el.setPointerCapture(ev.pointerId); } catch(e){}
        window.lc2.panelDragStart(ev.screenX, ev.screenY);
        ev.preventDefault();
      }, true);
      /* 位移由主进程原生光标流完成（非聚焦窗口 pointermove 会断），
         这里只保留 start / end 生命周期标记。 */
      el.addEventListener('pointerup', function(ev){
        if(!pdrag) return;
        pdrag = null;
        try { el.releasePointerCapture(ev.pointerId); } catch(e){}
        window.lc2.panelDragEnd();
      }, true);
    }
    bindPanelDrag(document.getElementById('grip'));   // 顶部拖拽条
    bindPanelDrag(document.getElementById('hdr'));    // 标题栏空白处（按钮除外）
    /* 阻止 Chromium 原生拖拽：否则按住图标/文字会拖出“幽灵”并选中 */
    document.addEventListener('dragstart', function(ev){ ev.preventDefault(); }, true);
  }

/* 打分星点按弹一下（事件委托，不侵入业务逻辑） */
document.addEventListener('click', function(ev){
  var rp = ev.target && ev.target.closest ? ev.target.closest('.rp') : null;
  if(rp) motion.replay(rp, 'm-pop');
}, true);

/* 主进程全局热键 → 合成 keydown，复用已有键盘逻辑 */
  window.lc2.onKey(function(key){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
  });

  /* 面板显隐由主进程通知 */
  window.addEventListener('blur', () => {
  if (state.focusedInput) releaseFocusInput();
  state.dormant = true;
});

if (window.lc2.onDormant) {
  window.lc2.onDormant(function(v){
    state.dormant = !!v;
    var sb=document.getElementById('sbar');
    if (sb && v) sb.classList.remove('searching');
  });
}

window.lc2.onPanel(function(s){
    var payload = (s && typeof s === 'object') ? s : { open: s === 'open' };
    state.open = !!payload.open;
    if(!payload.open && state.focusedInput) releaseFocusInput();
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
  infra.data.load().then(function(d){
    if(!d){
      console.warn('[lc2] 数据为空，保留内置示例');
      return;
    }
    var arr = domain.normalizeBuilds(d.builds);
    BUILDS.length = 0;
    Array.prototype.push.apply(BUILDS, arr);
    state.cur = arr.length ? BUILDS[0].id : '';
    state.expanded = {};
    logDataSummary(arr);
    render(); fbtnState();
  }).catch(function(e){
    console.error('[lc2] 数据加载失败', e);
  });
})();
})();
