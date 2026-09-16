import {
  initialState,
  effectiveDays,
  previewMoveDay,
  previewMoveCity,
  proposalFromPrompt,
  applyProposal,
  undoState,
  cityBlocks,
  validateProposal,
} from './planner.js';
import { mapsSearch, mapsMultiPin, googleFlightsUrl } from './links.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (iso, opt = {}) => {
  if (!iso) return '';
  const [y,m,d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {timeZone:'UTC', ...opt}).format(new Date(Date.UTC(y,m-1,d)));
};
const diff = (a,b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`))/86400000);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

async function loadWeather(day,target){
  if(!day||!target||!Number.isFinite(day.lat)||!Number.isFinite(day.lon))return;
  const daysAhead=diff(today(),day.scheduledDate);
  if(daysAhead<0||daysAhead>15)return;
  const key=`${day.lat},${day.lon},${day.scheduledDate}`;
  if(weatherCache.has(key)){target.innerHTML=weatherHTML(weatherCache.get(key));return;}
  try{
    const u=`https://api.open-meteo.com/v1/forecast?latitude=${day.lat}&longitude=${day.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${day.scheduledDate}&end_date=${day.scheduledDate}`;
    const r=await fetch(u); if(!r.ok)return; const w=await r.json();
    const x={code:w.daily?.weather_code?.[0],max:w.daily?.temperature_2m_max?.[0],min:w.daily?.temperature_2m_min?.[0],rain:w.daily?.precipitation_probability_max?.[0]};
    weatherCache.set(key,x); target.innerHTML=weatherHTML(x);
  }catch{}
}
function weatherHTML(w){
  if(w?.max==null)return'';
  const icon=w.code===0?'☀':w.code<=3?'⛅':w.code<=67?'☂':w.code<=77?'❄':'☂';
  return `<div class="weather-inline"><span>${icon}</span><strong>${Math.round(w.max)}° / ${Math.round(w.min)}°</strong><small>${w.rain??'–'}% rain</small></div>`;
}

const localMode = ['localhost','127.0.0.1'].includes(location.hostname) || location.protocol === 'file:';
const storageGet=(kind,key)=>{try{return window[kind]?.getItem(key)||''}catch{return ''}};
const storageSet=(kind,key,value)=>{try{window[kind]?.setItem(key,value);return true}catch{return false}};
const storageRemove=(kind,key)=>{try{window[kind]?.removeItem(key)}catch{}};
const GROUP_START = '2026-10-03';

let model;
let state;
let active = 'today';
let owner = true;
let adminKey = 'shared-trip-editor';
let viewerId = storageGet('localStorage','sa-v2-viewer');
let map = null;
let proposal = null;
let weatherCache = new Map();
let placeCategory = 'all';
let placeCity = 'all';
let mapCity = 'all';
let bookingCategory = 'attention';
let expandedCities = new Set(); // stores unique city blockIds, not cityIds
let expandedForViewer = '';
const filters = {country:'all', from:'', to:'', q:''};

function byId(arr,id){ return arr.find(x => x.id === id); }
function effectiveEntity(kind,id){
  const base = byId(model[kind],id);
  return base ? {...base, ...(state.overrides?.[kind]?.[id] || {})} : null;
}
function hotelOptions(stay){ return [...(stay.options || []), ...(state.customHotelOptions?.[stay.id] || [])]; }
function transportOptions(t){ return [...(t.options || []), ...(state.customTransportOptions?.[t.id] || [])]; }
function selectedHotel(stay){
  const id = state.selectedHotels?.[stay.id];
  return hotelOptions(stay).find(o => o.id === id) || null;
}
function selectedTransport(t){
  const id = state.selectedTransportOptions?.[t.id];
  return transportOptions(t).find(o => o.id === id) || null;
}
function cityName(id){ return byId(model.cities,id)?.name || id; }
function flightsUrl(t){ return googleFlightsUrl(t,'GBP'); }
function travellerNames(ids=[]){ return ids.map(id => byId(model.travellers,id)?.name).filter(Boolean).join(', '); }

function ownerControls(){ return owner; }
function displayTitle(){ return viewerRestricted() ? 'Brazil & Colombia' : 'South America'; }
function displayRoute(){ return viewerRestricted() ? 'Rio → Iguaçu → Paraty → Rio → Cartagena → Medellín → Bogotá' : model.routeSummary; }
function travellerInitials(){
  const palette=['violet','red','orange','blue'];
  return model.travellers.map((t,i)=>`<span class="mini-avatar ${palette[i%palette.length]} ${viewerId===t.id?'active':''}" title="${esc(t.name)}">${esc(t.name[0])}</span>`).join('');
}
function bookingResolved(b){
  if(b.entityType==='stay'&&b.entityId)return state.stayStatuses?.[b.entityId]==='booked';
  if(b.entityType==='transport'&&b.entityId)return state.transportStatuses?.[b.entityId]==='booked';
  if(b.entityType==='restaurant'&&b.entityId)return ['reserved','booked','skip'].includes(state.restaurantStatuses?.[b.entityId]||'planned');
  if(b.entityType==='activity'&&b.entityId)return ['booked','skip'].includes(state.activityStatuses?.[b.entityId]||'planned');
  return ['booked','skip'].includes(state.bookingStatuses?.[b.id]||b.status||'todo');
}
function attentionItems(){
  const items=[];
  visibleStays().forEach(s=>{
    const hotel=selectedHotel(s), status=state.stayStatuses?.[s.id] || (hotel?'chosen':'unselected');
    if(status!=='booked') items.push({cat:'stays',entityType:'stay',entityId:s.id,sort:s.checkIn||'9999',title:`${s.city} stay`,detail:hotel?`${hotel.name} chosen · not marked booked`:`Choose a hotel for ${s.dateLabel}`});
  });
  visibleTransport().forEach(t=>{
    const sel=selectedTransport(t), status=state.transportStatuses?.[t.id] || (sel?'chosen':'unselected');
    if(status!=='booked') items.push({cat:'transport',entityType:'transport',entityId:t.id,sort:t.date||'9999',title:t.route,detail:sel?`${sel.label} chosen · not marked booked`:'Choose / confirm transport'});
  });
  visibleBookings().forEach(b=>{
    if(bookingResolved(b)||/KEEP LOOSE/i.test(b.priority||'')) return;
    if(['stay','transport'].includes(b.entityType)) return;
    const cat=b.entityType==='restaurant'?'restaurants':b.entityType==='activity'?'activities':'tasks';
    items.push({cat,entityType:b.entityType||'other',entityId:b.entityId||b.id,sort:bookingDate(b)||'9999',title:b.title,detail:`${b.priority} · ${b.reason}`});
  });
  const seen=new Set();
  return items.sort((a,b)=>a.sort.localeCompare(b.sort)).filter(x=>{const k=`${x.cat}:${x.title}`;if(seen.has(k))return false;seen.add(k);return true;});
}

function openAttentionItem(item){
  if(!item)return;
  if(item.entityType==='stay'){openStayChooser(item.entityId);return;}
  bookingCategory=item.cat==='restaurants'?'restaurants':item.cat==='activities'?'activities':item.cat==='transport'?'transport':item.cat==='stays'?'stays':'tasks';
  switchTab('bookings');
  renderBookings();
  setTimeout(()=>{
    const card=document.querySelector(`[data-booking-entity="${item.entityId}"]`);
    if(card){card.scrollIntoView({behavior:'smooth',block:'center'});card.classList.add('focus-pulse');setTimeout(()=>card.classList.remove('focus-pulse'),1600);}
  },80);
}

function viewer(){ return byId(model.travellers,viewerId) || null; }
function viewerRestricted(){ return !!viewerId && viewerId !== 'sahil'; }
function viewerStart(){ return viewerRestricted() ? GROUP_START : model.tripStart; }
function stayDateLabel(s){
  if(viewerRestricted() && s.checkIn < GROUP_START && s.checkOut > GROUP_START){
    return `${fmt(GROUP_START,{day:'numeric'})}–${fmt(s.checkOut,{day:'numeric',month:'short'})}`;
  }
  return s.dateLabel;
}
function blockDateLabel(days){
  if(!days?.length)return '';
  const a=days[0].scheduledDate,b=days.at(-1).scheduledDate;
  if(a===b)return fmt(a,{day:'numeric',month:'short'});
  const am=fmt(a,{month:'short'}),bm=fmt(b,{month:'short'});
  return am===bm?`${fmt(a,{day:'numeric'})}–${fmt(b,{day:'numeric',month:'short'})}`:`${fmt(a,{day:'numeric',month:'short'})}–${fmt(b,{day:'numeric',month:'short'})}`;
}
function viewerDays(){
  const all = effectiveDays(model,state);
  return viewerRestricted() ? all.filter(d => d.scheduledDate >= GROUP_START) : all;
}
function viewerCityIds(){ return new Set(viewerDays().map(d => d.cityId)); }
function visibleTransport(){
  const cutoff = viewerStart();
  return model.transport.map(t => effectiveEntity('transport',t.id)).filter(t => !viewerRestricted() || t.date >= cutoff);
}
function visibleStays(){
  const cities = viewerCityIds();
  return model.stays.map(s => effectiveEntity('stays',s.id)).filter(s => cities.has(s.cityId));
}
function visibleRestaurants(){
  const cutoff = viewerStart();
  return model.restaurants.map(r => effectiveEntity('restaurants',r.id)).filter(r => !viewerRestricted() || r.date >= cutoff);
}
function visibleActivities(){
  const cutoff = viewerStart();
  return model.activities.map(a => effectiveEntity('activities',a.id)).filter(a => !viewerRestricted() || a.date >= cutoff);
}
function parseBookingDate(title=''){
  const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  const m = String(title).match(/\b(\d{1,2})(?:\s*\/\s*\d{1,2})?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i);
  if (!m) return null;
  const monKey = m[2][0].toUpperCase() + m[2].slice(1,3).toLowerCase();
  return `2026-${months[monKey]}-${String(Number(m[1])).padStart(2,'0')}`;
}
function bookingDate(b){
  if (b.entityType === 'restaurant' && b.entityId) return effectiveEntity('restaurants',b.entityId)?.date || null;
  if (b.entityType === 'activity' && b.entityId) return effectiveEntity('activities',b.entityId)?.date || null;
  if (b.entityType === 'transport' && b.entityId) return effectiveEntity('transport',b.entityId)?.date || null;
  if (b.entityType === 'stay' && b.entityId) return effectiveEntity('stays',b.entityId)?.checkIn || null;
  return parseBookingDate(b.title);
}
function visibleBookings(){
  if (!viewerRestricted()) return model.bookings;
  return model.bookings.filter(b => {
    const d = bookingDate(b);
    return !d || d >= GROUP_START;
  });
}

async function loadState(){
  if (localMode) {
    try { return {...initialState(model), ...JSON.parse(storageGet('localStorage','sa-v2-state') || 'null')}; }
    catch { return initialState(model); }
  }
  try {
    const r = await fetch('/api/v2-state',{cache:'no-store'});
    if (r.ok) return {...initialState(model), ...(await r.json())};
  } catch {}
  return initialState(model);
}

async function saveState({quiet=false}={}){
  state.updatedAt = new Date().toISOString();
  if (localMode) {
    state.revision = (state.revision || 0) + 1;
    storageSet('localStorage','sa-v2-state',JSON.stringify(state));
    renderAll();
    if (!quiet) toast('Saved locally ✓');
    return true;
  }
  if (!owner || !adminKey) {
    toast('Unlock owner editing first','bad');
    return false;
  }
  try {
    const payload = {...state, baseRevision:state.revision || 0};
    const r = await fetch('/api/v2-state',{
      method:'PUT',
      headers:{'content-type':'application/json','x-admin-key':adminKey},
      body:JSON.stringify(payload),
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      throw new Error(e.error || r.status);
    }
    state = await r.json();
    renderAll();
    if (!quiet) toast('Shared plan updated ✓');
    return true;
  } catch (e) {
    toast(`Could not save: ${e.message}`,'bad');
    return false;
  }
}

function toast(msg,kind='good'){
  const e = $('#toast');
  if (!e) return;
  e.textContent = msg;
  e.className = `toast show ${kind}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(()=>e.className='toast',2200);
}

function shell(){
  const who = viewer()?.name || 'Choose traveller';
  const rangeStart = viewerStart();
  const attention = attentionItems();
  const attentionGroups = new Set(attention.map(x=>x.cat)).size;
  const title = displayTitle();
  const route = displayRoute();
  const canEdit = ownerControls();
  const homeLabel = today() < rangeStart ? 'Home' : 'Today';
  return `<div class="app-frame">
    <header class="topbar">
      <div class="brand">
        <div class="brand-copy">
          <div class="brand-line"><h1>${esc(title)}</h1><span class="trip-dates">${fmt(rangeStart,{day:'numeric',month:'short'})}–${fmt(model.tripEnd,{day:'numeric',month:'short',year:'numeric'})}</span></div>
          <div class="brand-kicker">${viewerRestricted()?'Shared group trip':'Your South America journey'}</div>
        </div>
        <div class="people-actions">
          <button class="traveller-stack-button" id="viewerBtn" aria-label="Choose traveller"><span class="avatar-stack">${travellerInitials()}</span><span class="current-viewer">${esc(who)}</span></button>
          <button class="icon-action" id="share" title="Share trip">↗</button>
          ${!viewerRestricted()?`<button class="icon-action ${owner?'active':''}" id="edit" title="${owner?'Editing on':'Unlock editing'}">${owner?'✓':'✎'}</button>`:''}
        </div>
      </div>
      <div class="route-bar"><div class="route-copy">${esc(route)}</div>${canEdit?`<button class="attention-pill ${attention.length?'hot':''}" id="attentionBtn">${attention.length?`${attentionGroups} areas to sort`:'Everything covered ✓'}</button>`:''}</div>
    </header>
    <main class="main">
      ${localMode?'<div class="local-banner">LOCAL V2 REVIEW · Nothing here can deploy or alter the live app.</div>':''}
      ${viewerRestricted()?`<div class="viewer-banner"><strong>${esc(who)}</strong><span>Showing the shared trip from 3 October onward.</span></div>`:''}
      ${['today','itinerary','map','bookings'].map(x=>`<section id="view-${x}" class="view ${x===active?'active':''}"></section>`).join('')}
    </main>
    <nav class="bottom-nav"><div class="nav-inner four">
      ${[['today','☀',homeLabel],['itinerary','▤','Itinerary'],['map','⌖','Explore'],['bookings','✓',viewerRestricted()?'Details':'Bookings']].map(([id,ic,label])=>`<button class="nav-btn ${id===active?'active':''}" data-tab="${id}"><span>${ic}</span>${label}</button>`).join('')}
    </div></nav>
    <div class="sheet-backdrop" id="sheet"><div class="sheet" id="sheetBody"></div></div>
    <div id="toast" class="toast"></div>
  </div>`;
}

function bindShell(){
  $$('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  $('#share')?.addEventListener('click',share);
  $('#edit')?.addEventListener('click',toggleOwner);
  $('#viewerBtn')?.addEventListener('click',()=>openViewerChooser(false));
  $('#attentionBtn')?.addEventListener('click',()=>{bookingCategory='attention';switchTab('bookings');renderBookings();});
  $('#sheet')?.addEventListener('click',e => { if (e.target.id === 'sheet') closeSheet(); });
}

function switchTab(id){
  active = id;
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${id}`));
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));
  if (id === 'map') {
    renderMap();
    setTimeout(initMap,30);
  }
  scrollTo({top:0,behavior:'smooth'});
}

async function share(){
  const p = {title:model.title,text:'Our South America 2026 trip',url:location.href};
  if (navigator.share) {
    try { return await navigator.share(p); } catch {}
  }
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Link copied');
  } catch {}
}

function toggleOwner(){
  owner = true;
  adminKey = 'shared-trip-editor';
  toast('Shared editing is enabled for everyone');
}

function openViewerChooser(required=false){
  const cards = model.travellers.map((t,i)=>{
    const detail = t.id === 'sahil' ? 'Full trip · 20 Sep–17 Oct' : 'Shared trip · 3 Oct onward';
    const colors=['violet','red','orange','blue'];
    return `<button class="traveller-choice ${viewerId===t.id?'selected':''}" data-viewer-choice="${t.id}">
      <span class="traveller-avatar ${colors[i%colors.length]}">${esc(t.name[0])}</span>
      <span><strong>${esc(t.name)}</strong><small>${esc(detail)}</small></span>
      ${viewerId===t.id?'<span class="choice-check">✓</span>':''}
    </button>`;
  }).join('');
  openSheet(`<div class="sheet-head"><div><div class="eyebrow">Personalise your view</div><h2>Who are you?</h2><div class="tiny muted">The itinerary stays shared. This only simplifies what this device shows.</div></div>${required?'':'<button class="icon-action" data-close>×</button>'}</div><div class="traveller-grid">${cards}</div><div class="soft-note"><strong>Sahil</strong> sees the complete trip and planning tools. Niki, Priyesh and Amisha get the clean shared trip from 3 October onward.</div>`);
  $$('[data-viewer-choice]').forEach(b=>b.onclick=()=>{
    viewerId = b.dataset.viewerChoice;
    storageSet('localStorage','sa-v2-viewer',viewerId);
    active = 'today';
    bookingCategory = viewerId === 'sahil' ? 'attention' : 'stays';
    placeCity = 'all';
    mapCity = 'all';
    expandedCities = new Set();
    expandedForViewer = '';
    Object.assign(filters,{country:'all',from:'',to:'',q:''});
    closeSheet();
    renderAll();
    toast(`Viewing as ${viewer()?.name}`);
  });
}

function renderAll(){
  document.querySelector('#app').innerHTML = shell();
  bindShell();
  renderToday();
  renderItinerary();
  renderMap();
  renderBookings();
  if (active === 'map') setTimeout(initMap,30);
}

function renderToday(){
  const el = $('#view-today');
  const days = viewerDays();
  if (!days.length) { el.innerHTML='<div class="empty">No itinerary days in this view.</div>'; return; }
  const now = today();
  const start = days[0].scheduledDate;
  const end = days.at(-1).scheduledDate;
  const before = now < start;
  const after = now > end;
  let d = days.find(x=>x.scheduledDate===now);
  if (!d) d = before ? days[0] : after ? days.at(-1) : days.find(x=>x.scheduledDate>now) || days[0];
  let contextDay=d;
  if(before) contextDay = days.find(x=>x.country!=='United Kingdom') || days[1] || days[0];
  const idx=days.findIndex(x=>x.id===contextDay.id);
  const stay = contextDay.stayId ? effectiveEntity('stays',contextDay.stayId) : null;
  const hotel = stay ? selectedHotel(stay) : null;
  const transportIds = before ? [...new Set([...(days[0].transportIds||[]),...(contextDay.transportIds||[])])] : (contextDay.transportIds||[]);
  const trans = transportIds.map(id=>effectiveEntity('transport',id)).filter(Boolean);
  const daysTo = before ? diff(now,start) : 0;
  const attention=attentionItems().slice(0,2);
  const heroNum=before?daysTo:fmt(contextDay.scheduledDate,{day:'numeric'});
  const heroLabel=before?`${daysTo===1?'day':'days'} to go`:fmt(contextDay.scheduledDate,{weekday:'short',day:'numeric',month:'short'});
  const next=days.slice(idx+1,idx+4);
  const showAttention=ownerControls()&&attention.length;
  const heroTitle=before?cityName(contextDay.cityId):contextDay.title;
  const heroCopy=before?(contextDay.intro||contextDay.anchor):contextDay.anchor;
  const departFact=before?`<span>◷ Depart ${fmt(days[0].scheduledDate,{weekday:'short',day:'numeric',month:'short'})}</span>`:'';
  const localTime=(()=>{try{return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:contextDay.timeZone}).format(new Date())}catch{return''}})();
  const todayPlaces=dayGuideItems(contextDay);
  const todayPins=todayPlaces.length?mapsMultiPin(todayPlaces.map(x=>x.query),todayPlaces.length>4?'driving':'walking'):'';

  el.innerHTML = `<div class="today-layout">
    <article class="journey-hero">
      <div class="hero-index"><strong>${esc(heroNum)}</strong><span>${esc(heroLabel)}</span></div>
      <div class="hero-copy">
        <div class="eyebrow">${before?'First stop':after?'Last trip day':'Today'}</div>
        <h2>${esc(heroTitle)}</h2>
        <p class="hero-anchor">${esc(heroCopy)}</p>
        <div class="trip-facts">
          ${departFact}<span>● ${esc(cityName(contextDay.cityId))}</span>${!before&&localTime?`<span>◷ ${esc(localTime)} local</span>`:''}
          ${hotel?`<button class="text-action" data-stay-today="${stay.id}">⌂ ${esc(hotel.name)}${state.stayStatuses?.[stay.id]==='booked'?' · booked':''}</button>`:stay?(ownerControls()?`<button class="text-action attention" data-stay-today="${stay.id}">⌂ Choose stay</button>`:`<span>⌂ Stay being finalised</span>`):''}
          ${trans.slice(0,2).map(t=>`<span>${t.type==='air'?'✈':'↔'} ${esc(selectedTransport(t)?.label||t.route)}</span>`).join('')}
        </div>
        <div id="todayWeather"></div>
        <div class="hero-actions"><button class="btn primary" data-day="${contextDay.id}">${before?'Open first day':'Open day'}</button>${!before&&todayPins?`<a class="btn quiet" href="${todayPins}" target="_blank" rel="noopener">Today's pins ↗</a>`:`<button class="btn quiet" data-map-today="${contextDay.cityId}">${before?`Explore ${esc(cityName(contextDay.cityId))}`:'Explore nearby'}</button>`}</div>
      </div>
    </article>
    <aside class="side-brief">
      <div class="side-brief-head"><div><div class="eyebrow">${showAttention?'Before you go':'Coming up'}</div><h3>${showAttention?'Sort these first':'Next days'}</h3></div>${showAttention?`<button class="link-button" data-attention-all>See all</button>`:''}</div>
      ${showAttention
        ? attention.map((a,i)=>`<button class="brief-row" data-attention-index="${i}"><span class="brief-dot"></span><span><strong>${esc(a.title)}</strong><small>${esc(a.detail)}</small></span><b>›</b></button>`).join('')
        : next.map(n=>`<button class="brief-row" data-day="${n.id}"><span class="brief-date">${fmt(n.scheduledDate,{day:'numeric'})}<small>${fmt(n.scheduledDate,{month:'short'})}</small></span><span><strong>${esc(n.title)}</strong><small>${esc(cityName(n.cityId))}</small></span><b>›</b></button>`).join('') || '<div class="empty compact">No more scheduled days.</div>'}
    </aside>
  </div>`;

  $$('[data-day]',el).forEach(b=>b.onclick=()=>openDay(b.dataset.day));
  $$('[data-stay-today]',el).forEach(b=>b.onclick=()=>openStayChooser(b.dataset.stayToday));
  $('[data-map-today]',el)?.addEventListener('click',e=>{mapCity=e.currentTarget.dataset.mapToday;switchTab('map');});
  $$('[data-attention-index]',el).forEach(b=>b.onclick=()=>openAttentionItem(attention[Number(b.dataset.attentionIndex)]));
  $('[data-attention-all]',el)?.addEventListener('click',()=>{bookingCategory='attention';switchTab('bookings');renderBookings();});
  loadWeather(contextDay,$('#todayWeather'));
}

function filteredDays(){
  const q = filters.q.trim().toLowerCase();
  return viewerDays().filter(d=>{
    const text = [d.title,cityName(d.cityId),d.country,d.anchor,d.intro,...Object.values(d.timeline||{}).flat()].join(' ').toLowerCase();
    return (filters.country==='all'||d.country===filters.country)
      && (!filters.from||d.scheduledDate>=filters.from)
      && (!filters.to||d.scheduledDate<=filters.to)
      && (!q||text.includes(q));
  });
}
function filtersActive(){ return filters.country!=='all'||!!filters.from||!!filters.to||!!filters.q; }
function canReorder(){ return owner && !filtersActive(); }

function ensureExpandedCities(blocks){
  const key=viewerId||'anonymous';
  if(expandedForViewer===key && expandedCities.size)return;
  const ds=viewerDays();
  const now=today();
  const anchor=ds.find(d=>d.scheduledDate>=now)||ds.at(-1);
  let idx=blocks.findIndex(b=>b.dayIds.includes(anchor?.id));
  if(idx<0)idx=0;
  expandedCities=new Set(blocks.slice(idx,idx+2).map(b=>b.blockId));
  expandedForViewer=key;
}

function renderItinerary(){
  const el = $('#view-itinerary');
  const allBlocksFull = cityBlocks(model,state);
  const viewerIds = new Set(viewerDays().map(d=>d.id));
  const allBlocks = allBlocksFull.map(b=>({...b,dayIds:b.dayIds.filter(id=>viewerIds.has(id))})).filter(b=>b.dayIds.length);
  ensureExpandedCities(allBlocks);
  const visible = new Set(filteredDays().map(d=>d.id));
  const blocks = allBlocks.map(b=>({...b,dayIds:b.dayIds.filter(id=>visible.has(id))})).filter(b=>b.dayIds.length);
  const countries = [...new Set(viewerDays().map(d=>d.country))];
  const allExpanded = allBlocks.every(b=>expandedCities.has(b.blockId));

  el.innerHTML = `<div class="page-head"><div><div class="eyebrow">The journey</div><h2>Itinerary</h2><p>${viewerRestricted()?'Your shared section, from 3 October onward.':'Browse by city, or open any day for the full plan.'}</p></div>${ownerControls()?`<div class="page-actions"><button class="btn quiet" id="itineraryAI">✦ Ask AI</button>${state.history?.length?'<button class="btn quiet" id="itineraryUndo">↶ Undo</button>':''}</div>`:''}</div>
  <div class="itinerary-jump">${allBlocks.map(b=>{const ds=effectiveDays(model,state).filter(d=>b.dayIds.includes(d.id));return `<button data-jump-block="${b.blockId}"><strong>${esc(cityName(b.cityId))}</strong><small>${blockDateLabel(ds)}</small></button>`}).join('')}</div>
  <div class="itinerary-tools"><details class="filter-drawer" ${filtersActive()?'open':''}><summary><span>Filter itinerary</span><b>${filtersActive()?'Filters active':'Country · date · search'}</b></summary><div class="filters">
    <div class="control"><label>Country</label><select id="countryFilter"><option value="all">All countries</option>${countries.map(c=>`<option value="${esc(c)}" ${filters.country===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="control"><label>From</label><input id="fromFilter" type="date" value="${esc(filters.from)}"></div>
    <div class="control"><label>To</label><input id="toFilter" type="date" value="${esc(filters.to)}"></div>
    <div class="control search"><label>Search</label><input id="searchFilter" type="search" placeholder="City, restaurant, experience…" value="${esc(filters.q)}"></div>
    <button class="btn quiet filter-reset" id="clearFilters">Clear</button>
  </div></details><button class="link-button expand-toggle" id="toggleAllCities">${allExpanded?'Collapse all':'Expand all'}</button></div>
  ${filtersActive()?'<div class="context-note">Matching cities are expanded automatically. Move controls are hidden while filters are active.</div>':''}
  <div class="journey-list">${blocks.map(b=>{
    const city=byId(model.cities,b.cityId); const ds=effectiveDays(model,state).filter(d=>b.dayIds.includes(d.id)); const fullIndex=allBlocksFull.findIndex(x=>x.blockId===b.blockId); const expanded=filtersActive()||expandedCities.has(b.blockId);
    const stayIds=[...new Set(ds.map(d=>d.stayId).filter(Boolean))];
    const stayText=stayIds.map(id=>{const st=effectiveEntity('stays',id),h=st?selectedHotel(st):null;return h?.name||''}).filter(Boolean).join(' · ');
    return `<section class="city-block ${expanded?'expanded':'collapsed'}" id="block-${b.blockId}" draggable="${canReorder()?'true':'false'}" data-city-block="${b.blockId}">
      <div class="city-head"><button class="city-title-button" data-toggle-block="${b.blockId}"><span><span class="eyebrow">${blockDateLabel(ds)}</span><strong>${esc(city?.name||b.cityId)}</strong><small>${ds.length} day${ds.length===1?'':'s'}${stayText?` · ${esc(stayText)}`:''}</small></span><b>${expanded?'−':'+'}</b></button>${canReorder()?`<div class="city-move"><button class="icon-action" data-city-move="${b.blockId}" data-delta="-1" ${fullIndex===0?'disabled':''}>↑</button><button class="icon-action" data-city-move="${b.blockId}" data-delta="1" ${fullIndex===allBlocksFull.length-1?'disabled':''}>↓</button></div>`:''}</div>
      <div class="city-days">${ds.map(dayCard).join('')}</div>
    </section>`;
  }).join('') || '<div class="empty">No itinerary days match those filters.</div>'}</div>`;

  $('#countryFilter')?.addEventListener('change',e=>{filters.country=e.target.value;renderItinerary();renderMap();});
  $('#fromFilter')?.addEventListener('change',e=>{filters.from=e.target.value;renderItinerary();renderMap();});
  $('#toFilter')?.addEventListener('change',e=>{filters.to=e.target.value;renderItinerary();renderMap();});
  $('#searchFilter')?.addEventListener('input',e=>{filters.q=e.target.value;clearTimeout(renderItinerary.t);renderItinerary.t=setTimeout(()=>{renderItinerary();renderMap();},180);});
  $('#clearFilters')?.addEventListener('click',()=>{Object.assign(filters,{country:'all',from:'',to:'',q:''});renderItinerary();renderMap();});
  $$('[data-jump-block]',el).forEach(b=>b.onclick=()=>{expandedCities.add(b.dataset.jumpBlock);renderItinerary();setTimeout(()=>document.getElementById(`block-${b.dataset.jumpBlock}`)?.scrollIntoView({behavior:'smooth',block:'start'}),20);});
  $$('[data-toggle-block]',el).forEach(b=>b.onclick=()=>{const id=b.dataset.toggleBlock;if(expandedCities.has(id))expandedCities.delete(id);else expandedCities.add(id);renderItinerary();setTimeout(()=>document.getElementById(`block-${id}`)?.scrollIntoView({block:'nearest'}),10);});
  $('#toggleAllCities')?.addEventListener('click',()=>{if(allExpanded)expandedCities=new Set();else expandedCities=new Set(allBlocks.map(b=>b.blockId));expandedForViewer=viewerId||'anonymous';renderItinerary();});
  $('#itineraryAI')?.addEventListener('click',()=>openAI());
  $('#itineraryUndo')?.addEventListener('click',()=>{state=undoState(state);saveState();toast('Last change undone');});
  bindItinerary(el,allBlocksFull);
}

function dayCard(d){
  const trans=(d.transportIds||[]).map(id=>effectiveEntity('transport',id)).filter(Boolean);
  const stay=d.stayId?effectiveEntity('stays',d.stayId):null;
  const hotel=stay?selectedHotel(stay):null;
  const stayStatus=stay?(state.stayStatuses?.[stay.id]||(hotel?'chosen':'unselected')):null;
  const travelLine=trans.length?trans.map(x=>`${x.type==='air'?'✈':'↔'} ${selectedTransport(x)?.label||x.route}`).join(' · '):'';
  return `<article class="day-card">
    <button class="date-box" data-open-day="${d.id}"><div class="num">${fmt(d.scheduledDate,{day:'numeric'})}</div><div><span class="dow">${fmt(d.scheduledDate,{weekday:'short'})}</span><span class="mon">${fmt(d.scheduledDate,{month:'short'})}</span></div></button>
    <div class="day-main">
      <div class="day-title-row"><h3>${esc(d.title)}</h3>${d.locked?'<span class="lock-mark">⌖ fixed</span>':''}</div>
      <div class="meta">${esc(cityName(d.cityId))} · ${esc(travellerNames(d.travellerIds))}</div>
      <p class="anchor">${esc(d.anchor)}</p>
      <div class="day-inline-actions">
        ${stay?(hotel?(ownerControls()?`<button class="inline-link ${stayStatus==='booked'?'confirmed':''}" data-choose-stay="${stay.id}">⌂ ${esc(hotel.name)}${stayStatus==='booked'?' ✓':''}</button>`:`<span class="inline-link static ${stayStatus==='booked'?'confirmed':''}">⌂ ${esc(hotel.name)}${stayStatus==='booked'?' ✓':''}</span>`):(ownerControls()?`<button class="inline-link attention" data-choose-stay="${stay.id}">⌂ Choose stay</button>`:`<span class="inline-link static muted">⌂ Stay being finalised</span>`)):''}
        ${travelLine?`<span class="travel-line">${esc(travelLine)}</span>`:''}
      </div>
    </div>
    <div class="day-actions"><button class="day-open" data-open-day="${d.id}" aria-label="Open day">›</button>${canReorder()?`<button class="day-move" data-move-day="${d.id}" aria-label="Move day">↕</button>`:''}</div>
  </article>`;
}

function bindItinerary(el,blocks){
  $$('[data-open-day]',el).forEach(b=>b.onclick=()=>openDay(b.dataset.openDay));
  $$('.day-card',el).forEach(card=>card.addEventListener('click',e=>{if(e.target.closest('button,a,select,input'))return;const id=card.querySelector('[data-open-day]')?.dataset.openDay;if(id)openDay(id);}));
  $$('[data-choose-stay]',el).forEach(b=>b.onclick=e=>{e.stopPropagation();openStayChooser(b.dataset.chooseStay);});
  $$('[data-move-day]',el).forEach(b=>b.onclick=()=>openMoveDay(b.dataset.moveDay));
  $$('[data-city-move]',el).forEach(b=>b.onclick=()=>{
    const i = blocks.findIndex(x=>x.blockId===b.dataset.cityMove);
    showProposal(previewMoveCity(model,state,b.dataset.cityMove,i+Number(b.dataset.delta)));
  });
  let dragged = null;
  $$('[data-city-block]',el).forEach(x=>{
    x.addEventListener('dragstart',()=>dragged=x.dataset.cityBlock);
    x.addEventListener('dragover',e=>e.preventDefault());
    x.addEventListener('drop',e=>{
      e.preventDefault();
      if (!canReorder() || !dragged || dragged===x.dataset.cityBlock) return;
      const target = blocks.findIndex(b=>b.blockId===x.dataset.cityBlock);
      showProposal(previewMoveCity(model,state,dragged,target));
      dragged = null;
    });
  });
}

function openMoveDay(id){
  const d = effectiveDays(model,state).find(x=>x.id===id);
  openSheet(`<div class="sheet-head"><div><div class="eyebrow">Move itinerary</div><h2>${esc(d.title)}</h2></div><button class="btn small" data-close>Close</button></div><p class="tiny muted">Choose a new trip date. V2 will preview every linked consequence first.</p><label class="tiny">Move to date<input class="field" type="date" id="moveDate" min="${model.tripStart}" max="${model.tripEnd}" value="${d.scheduledDate}"></label><div style="margin-top:12px"><button class="btn primary" id="previewMove">Preview consequences</button></div>`);
  $('#previewMove').onclick=()=>{
    const date = $('#moveDate').value;
    const idx = diff(model.tripStart,date);
    showProposal(previewMoveDay(model,state,id,idx));
  };
}

function renderMap(){
  const el=$('#view-map');
  const cities=[...new Set(filteredDays().filter(d=>d.country!=='United Kingdom').map(d=>d.cityId))];
  if(mapCity!=='all'&&!cities.includes(mapCity)) mapCity='all';
  el.innerHTML=`<div class="page-head"><div><div class="eyebrow">On the ground</div><h2>Explore</h2><p>Route, hotel, food, nightlife and sights in one place. Tap a city to focus.</p></div></div>
    <div class="city-tabs"><button class="seg ${mapCity==='all'?'active':''}" data-map-city="all">Route</button>${cities.map(c=>`<button class="seg ${mapCity===c?'active':''}" data-map-city="${c}">${esc(cityName(c))}</button>`).join('')}</div>
    <div class="map-layout"><div class="mapbox" id="mapbox"></div><aside class="map-guide"><div id="mapCityGuide"></div></aside></div>`;
  $$('[data-map-city]',el).forEach(b=>b.onclick=()=>{mapCity=b.dataset.mapCity;renderMap();setTimeout(initMap,20);});
  renderMapCityGuide();
}
function initMap(){
  const node=$('#mapbox'); if(!node||active!=='map')return;
  if(map){map.remove();map=null}
  if(!window.L){node.innerHTML='<div class="empty" style="margin:20px">Map library unavailable. City guides and Google Maps links still work.</div>';return}
  map=L.map(node,{zoomControl:true,worldCopyJump:true});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap'}).addTo(map);
  const ds=filteredDays(),seen=new Set(),pts=[];
  for(const d of ds){
    if(!Number.isFinite(d.lat)||!Number.isFinite(d.lon))continue;
    pts.push([d.lat,d.lon]); if(seen.has(d.cityId))continue; seen.add(d.cityId);
    const html='<span class="trip-map-dot"></span>';
    const marker=L.marker([d.lat,d.lon],{icon:L.divIcon({className:'trip-map-marker',html,iconSize:[26,26],iconAnchor:[13,13]})}).addTo(map);
    marker.bindTooltip(cityName(d.cityId),{direction:'top',offset:[0,-10],opacity:.88});
    marker.on('click',()=>{mapCity=d.cityId;renderMap();setTimeout(initMap,20);});
  }
  if(pts.length>1)L.polyline(pts,{color:'#9863d0',weight:3,opacity:.78,dashArray:'5 7'}).addTo(map);
  if(mapCity==='all'){if(pts.length)map.fitBounds(pts,{padding:[34,34],maxZoom:5});else map.setView([-15,-60],3)}
  else{const d=ds.find(x=>x.cityId===mapCity);if(d)map.setView([d.lat,d.lon],11);else if(pts.length)map.fitBounds(pts,{padding:[30,30],maxZoom:5})}
}
function cityGuideItems(cid){
  const out = [];
  visibleStays().filter(s=>s.cityId===cid).forEach(s=>{
    const chosen=selectedHotel(s);
    const options=ownerControls()?hotelOptions(s):(chosen?[chosen]:[]);
    options.forEach(h=>out.push({id:h.id,name:h.name,category:'stay',query:h.mapsQuery,kind:chosen?.id===h.id?'Chosen stay':'Hotel',selected:chosen?.id===h.id}));
  });
  visibleRestaurants().filter(r=>r.cityId===cid).forEach(r=>out.push({id:r.id,name:r.name,category:'eat',query:r.mapsQuery,kind:'Eat'}));
  visibleActivities().filter(a=>a.cityId===cid).forEach(a=>out.push({id:a.id,name:a.name,category:'do',query:a.mapsQuery,kind:'Do'}));
  model.places.filter(p=>p.cityId===cid).forEach(p=>out.push({id:p.id,name:p.name,category:p.category,query:p.mapsQuery,kind:p.category==='night'?'Drink / Night':'See / Do'}));
  const seen = new Set();
  return out.filter(x=>{const k=String(x.query||x.name).toLowerCase().replace(/\s+/g,' ').trim();if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>(b.selected?1:0)-(a.selected?1:0));
}

function dayGuideItems(d){
  const out = [];
  const stay = d.stayId ? effectiveEntity('stays',d.stayId) : null;
  const hotel = stay ? selectedHotel(stay) : null;
  if (hotel) out.push({id:hotel.id,name:hotel.name,category:'stay',query:hotel.mapsQuery,kind:'Stay',selected:true});
  (d.restaurantIds || []).forEach(id=>{
    const r = effectiveEntity('restaurants',id);
    if (r) out.push({id:r.id,name:r.name,category:'eat',query:r.mapsQuery,kind:'Eat'});
  });
  (d.activityIds || []).forEach(id=>{
    const a = effectiveEntity('activities',id);
    if (a) out.push({id:a.id,name:a.name,category:'do',query:a.mapsQuery,kind:'Do'});
  });
  (d.placeIds || []).forEach(id=>{
    const p = byId(model.places,id);
    if (p) out.push({id:p.id,name:p.name,category:p.category,query:p.mapsQuery,kind:p.category==='night'?'Drink / Night':'See / Do'});
  });
  const seen = new Set();
  return out.filter(x=>x.query && !seen.has(x.query.toLowerCase()) && seen.add(x.query.toLowerCase()));
}

function citySavedListUrl(cid){ return state.cityMapListUrls?.[cid] || ''; }
function daySavedListUrl(d){ return state.dayMapListUrls?.[d.id] || citySavedListUrl(d.cityId) || ''; }

function renderMapCityGuide(){
  const t=$('#mapCityGuide'); if(!t)return;
  const ds=filteredDays();
  if(mapCity==='all'){
    const seen=[]; const used=new Set();
    ds.forEach(d=>{if(!used.has(d.cityId)){used.add(d.cityId);seen.push(d)}});
    t.innerHTML=`<div class="map-guide-head"><div><div class="eyebrow">Trip route</div><h3>${viewerRestricted()?'Brazil & Colombia':'South America'}</h3><p>${seen.length} destinations in this view</p></div></div><div class="route-destinations">${seen.map(d=>`<button data-map-overview-city="${d.cityId}"><span>${fmt(d.scheduledDate,{day:'numeric',month:'short'})}</span><strong>${esc(cityName(d.cityId))}</strong><b>›</b></button>`).join('')}</div>`;
    $$('[data-map-overview-city]',t).forEach(b=>b.onclick=()=>{mapCity=b.dataset.mapOverviewCity;renderMap();setTimeout(initMap,20);});
    return;
  }
  const cid=mapCity;
  const items=cityGuideItems(cid),listUrl=citySavedListUrl(cid),allPinsUrl=mapsMultiPin(items.slice(0,9).map(x=>x.query),'driving');
  const stayPending=viewerRestricted()&&visibleStays().some(s=>s.cityId===cid&&!selectedHotel(s));
  const grouped=['stay','eat','night','see-do','do'].map(cat=>({cat,items:items.filter(x=>x.category===cat)})).filter(g=>g.items.length);
  t.innerHTML=`<div class="map-guide-head"><div><div class="eyebrow">City guide</div><h3>${esc(cityName(cid))}</h3><p>${items.length} saved trip places</p></div></div>
    <div class="map-guide-actions"><a class="btn primary" target="_blank" rel="noopener" href="${allPinsUrl}">Open all pins ↗</a>${listUrl?`<a class="btn quiet" target="_blank" rel="noopener" href="${esc(listUrl)}">Saved Maps list ↗</a>`:ownerControls()?'<button class="btn quiet" id="addMapList">+ Saved list</button>':''}</div>
    ${stayPending?'<div class="soft-note compact"><strong>⌂ Stay being finalised</strong><span>The confirmed hotel will appear here automatically.</span></div>':''}
    <div class="map-guide-groups">${grouped.map(g=>`<div class="map-guide-group"><span>${g.cat==='stay'?'Stay':g.cat==='eat'?'Eat':g.cat==='night'?'Drink / Night':g.cat==='do'?'Do':'See'}</span>${g.items.map(x=>`<a href="${mapsSearch(x.query)}" target="_blank" rel="noopener">${esc(x.name)} <b>↗</b></a>`).join('')}</div>`).join('')}</div><button class="link-button full" id="copyCityList">Copy curated list</button>`;
  $('#addMapList')?.addEventListener('click',()=>{const u=prompt(`Paste the shared Google Maps Saved List / My Maps URL for ${cityName(cid)}`);if(u){state.cityMapListUrls||={};state.cityMapListUrls[cid]=u;saveState();renderMap();}});
  $('#copyCityList')?.addEventListener('click',async()=>{const text=items.map(x=>`${x.kind}: ${x.name} — ${mapsSearch(x.query)}`).join('\n');try{await navigator.clipboard.writeText(text);toast('City list copied')}catch{toast('Could not copy list','bad')}});
}
function renderPlaces(){
  const el=$('#view-places');
  const cities=[...new Set(viewerDays().map(d=>d.cityId))];
  if(placeCity==='all'||!cities.includes(placeCity)) placeCity=cities[0]||'all';
  const cats=[['all','All'],['stay','Stay'],['eat','Eat'],['night','Drink'],['see-do','See'],['do','Do']];
  let items=cityGuideItems(placeCity);
  if(placeCategory!=='all')items=items.filter(x=>x.category===placeCategory);
  const allItems=cityGuideItems(placeCity),listUrl=citySavedListUrl(placeCity),allPinsUrl=mapsMultiPin(allItems.slice(0,9).map(x=>x.query),'driving');
  el.innerHTML=`<div class="page-head"><div><div class="eyebrow">Your city guide</div><h2>Places</h2><p>Only the places that matter to this trip — not a generic city directory.</p></div></div>
    <div class="city-tabs">${cities.map(c=>`<button class="seg ${placeCity===c?'active':''}" data-place-city="${c}">${esc(cityName(c))}</button>`).join('')}</div>
    <div class="place-toolbar"><div class="category-tabs">${cats.map(([id,n])=>`<button class="seg ${placeCategory===id?'active':''}" data-place-cat="${id}">${n}</button>`).join('')}</div><div class="place-map-actions"><a class="btn primary" href="${allPinsUrl}" target="_blank" rel="noopener">All city pins ↗</a>${listUrl?`<a class="btn quiet" href="${esc(listUrl)}" target="_blank" rel="noopener">Saved Maps list ↗</a>`:ownerControls()?'<button class="btn quiet" id="placesAddMapList">+ Saved list</button>':''}</div></div>
    <div class="place-stack">${items.map(x=>`<article class="place-card"><div class="place-icon">${x.category==='stay'?'⌂':x.category==='eat'?'◒':x.category==='night'?'♪':'◆'}</div><div class="place-copy"><span>${esc(x.kind)}</span><h3>${esc(x.name)}</h3></div><a class="place-arrow" target="_blank" rel="noopener" href="${mapsSearch(x.query)}">↗</a></article>`).join('')||'<div class="empty">No places in this filter yet.</div>'}</div>`;
  $$('[data-place-city]',el).forEach(b=>b.onclick=()=>{placeCity=b.dataset.placeCity;renderPlaces();});
  $$('[data-place-cat]',el).forEach(b=>b.onclick=()=>{placeCategory=b.dataset.placeCat;renderPlaces();});
  $('#placesAddMapList')?.addEventListener('click',()=>{const u=prompt(`Paste the shared Google Maps Saved List / My Maps URL for ${cityName(placeCity)}`);if(u){state.cityMapListUrls||={};state.cityMapListUrls[placeCity]=u;saveState();renderPlaces();}});
}

function renderBookings(){
  const el=$('#view-bookings');
  const items=attentionItems(); const count=new Set(items.map(x=>x.cat)).size;
  const cats=viewerRestricted()
    ? [['stays','Stays'],['transport','Transport'],['restaurants','Dining'],['activities','Activities']]
    : [['attention',`To sort${count?` · ${count}`:''}`],['stays','Stays'],['transport','Transport'],['restaurants','Dining'],['activities','Activities'],['tasks','Other']];
  if(viewerRestricted() && bookingCategory==='attention') bookingCategory='stays';
  el.innerHTML=`<div class="page-head"><div><div class="eyebrow">${viewerRestricted()?'Shared plan':'Source of truth'}</div><h2>${viewerRestricted()?'Trip details':'Bookings'}</h2><p>${viewerRestricted()?'Hotels, transport, meals and activities for the shared trip.':'Chosen is not the same as booked. Keep confirmations here and the rest of the trip updates with them.'}</p></div></div>
    <div class="booking-tabs">${cats.map(([id,n])=>`<button class="seg ${bookingCategory===id?'active':''}" data-book-cat="${id}">${n}</button>`).join('')}</div><div id="bookingBody" class="booking-body"></div>`;
  $$('[data-book-cat]',el).forEach(b=>b.onclick=()=>{bookingCategory=b.dataset.bookCat;renderBookings();});
  renderBookingBody();
}
function renderBookingBody(){
  const el=$('#bookingBody'); if(!el)return;
  if(bookingCategory==='attention')el.innerHTML=attentionHTML();
  if(bookingCategory==='transport')el.innerHTML=transportHTML();
  if(bookingCategory==='stays')el.innerHTML=staysHTML();
  if(bookingCategory==='restaurants')el.innerHTML=restaurantsHTML();
  if(bookingCategory==='activities')el.innerHTML=activitiesHTML();
  if(bookingCategory==='tasks')el.innerHTML=tasksHTML();
  bindBookingActions(el);
}
function attentionHTML(){
  const items=attentionItems();
  if(!items.length)return `<div class="all-clear"><span>✓</span><div><h3>Everything important is covered</h3><p>No unresolved bookings or choices in this traveller view.</p></div></div>`;
  const labels={stays:'Stays',transport:'Transport',restaurants:'Dining',activities:'Activities',tasks:'Other'};
  const order=['stays','transport','restaurants','activities','tasks'];
  const groups=order.map(cat=>({cat,items:items.filter(x=>x.cat===cat)})).filter(g=>g.items.length);
  return `<div class="attention-groups">${groups.map(g=>`<button class="attention-group" data-attention-jump="${g.cat}"><span class="attention-group-count">${g.items.length}</span><span><strong>${labels[g.cat]||g.cat}</strong><small>${g.items.slice(0,2).map(x=>x.title).join(' · ')}${g.items.length>2?` · +${g.items.length-2} more`:''}</small></span><b>›</b></button>`).join('')}</div>`;
}
function transportHTML(){
  return `<div class="booking-stack">${visibleTransport().map(t=>{
    const sel=selectedTransport(t);
    const status=state.transportStatuses?.[t.id]||(sel?'chosen':'unselected');
    const ref=state.transportBookingRefs?.[t.id]||'';
    const opts=transportOptions(t);
    const kind=t.type==='air'?'Flight':t.type==='road'?'Road transfer':'Transport';
    const statusText=viewerRestricted()?(status==='booked'?'Booked ✓':sel?'Planned':'Being finalised'):(status==='booked'?'Booked ✓':sel?'Chosen':'Needs choice');
    return `<article class="booking-card ${status==='booked'?'confirmed-card':''}" data-booking-entity="${t.id}">
      <div class="booking-card-top"><div><div class="eyebrow">${fmt(t.date,{weekday:'short',day:'numeric',month:'short'})} · ${esc(kind)}</div><h3>${esc(t.route)}</h3><p>${esc(travellerNames(t.travellerIds))}${t.note?` · ${esc(t.note)}`:''}</p></div><span class="state-pill ${status}">${statusText}</span></div>
      <div class="selected-strip">${sel?`<span>${esc(sel.label)}</span><small>${status==='booked'?'Confirmed':viewerRestricted()?'Current plan':'Selected plan'}</small>`:`<span>${viewerRestricted()?'Details being finalised':'No option selected'}</span><small>${viewerRestricted()?'Check back once the plan is confirmed':'Choose the plan you intend to use'}</small>`}</div>
      ${ref?`<div class="confirmation-line">Confirmation · ${esc(ref)}</div>`:''}
      <div class="booking-actions">${t.type==='air'&&!viewerRestricted()?`<a class="btn quiet" target="_blank" rel="noopener" href="${flightsUrl(t)}">Google Flights ↗</a>`:''}${ownerControls()&&sel?`<button class="btn ${status==='booked'?'quiet':'primary'}" data-toggle-transport-booked="${t.id}">${status==='booked'?'Booked ✓':'Mark booked'}</button>`:''}</div>
      ${viewerRestricted()?'':`<details class="option-disclosure" ${!sel?'open':''}><summary>${sel?'Compare / change option':`Choose ${kind.toLowerCase()}`} <b>${opts.length}</b></summary><div class="option-list">${opts.map(o=>`<div class="option-row ${sel?.id===o.id?'selected':''}"><div><strong>${esc(o.label)}</strong><small>${esc(o.baggage||o.note||'')}</small></div>${ownerControls()?`<button class="btn small ${sel?.id===o.id?'quiet':'primary'}" data-choose-flight="${t.id}" data-option="${o.id}">${sel?.id===o.id?'Selected':'Choose'}</button>`:''}</div>`).join('')||'<div class="empty compact">No options added yet.</div>'}${ownerControls()?`<button class="link-button" data-add-flight="${t.id}">+ Add another option</button>`:''}</div></details>`}
      ${ownerControls()&&sel?`<label class="booking-ref">Confirmation / booking reference<input class="field" data-transport-ref="${t.id}" value="${esc(ref)}" placeholder="Airline / booking reference"></label>`:''}
    </article>`;
  }).join('')}</div>`;
}
function staysHTML(){
  return `<div class="booking-stack">${visibleStays().map(s=>{
    const sel=selectedHotel(s),status=state.stayStatuses?.[s.id]||(sel?'chosen':'unselected'),ref=state.stayBookingRefs?.[s.id]||'';
    const statusText=viewerRestricted()?(status==='booked'?'Booked ✓':sel?'Planned':'Being finalised'):(status==='booked'?'Booked ✓':sel?'Chosen':'Needs choice');
    return `<article class="booking-card ${status==='booked'?'confirmed-card':''}" data-booking-entity="${s.id}"><div class="booking-card-top"><div><div class="eyebrow">${esc(stayDateLabel(s))} · ${esc(s.area)}</div><h3>${esc(s.city)}</h3><p>${esc(s.note||'')}</p></div><span class="state-pill ${status}">${statusText}</span></div>
      <div class="selected-strip">${sel?`<span>${esc(sel.name)}</span><small>${status==='booked'?'Confirmed stay':viewerRestricted()?'Current plan':'Selected hotel'}</small>`:`<span>${viewerRestricted()?'Stay being finalised':'No stay selected'}</span><small>${viewerRestricted()?'Check back once the hotel is confirmed':`${hotelOptions(s).length} shortlisted options`}</small>`}</div>
      ${ref?`<div class="confirmation-line">Confirmation · ${esc(ref)}</div>`:''}
      <div class="booking-actions">${ownerControls()?`<button class="btn ${sel?'quiet':'primary'}" data-open-stay="${s.id}">${sel?'View / change':'Choose stay'}</button>`:''}${sel?`<a class="btn quiet" target="_blank" rel="noopener" href="${mapsSearch(sel.mapsQuery)}">Map ↗</a>`:''}</div></article>`;
  }).join('')}</div>`;
}
function restaurantsHTML(){
  return `<div class="booking-stack">${visibleRestaurants().map(x=>{
    const st=state.restaurantStatuses[x.id]||x.status||'planned';
    const ref=state.restaurantBookingRefs?.[x.id]||'';
    return `<article class="booking-card ${['reserved','booked'].includes(st)?'confirmed-card':''}" data-booking-entity="${x.id}"><div class="booking-card-top"><div><div class="eyebrow">${esc(cityName(x.cityId))} · ${fmt(x.date,{day:'numeric',month:'short'})} · ${esc(x.time)}</div><h3>${esc(x.name)}</h3><p>${esc(x.priority)}</p></div><span class="state-pill ${st}">${st==='booked'?'Booked ✓':st==='reserved'?'Reserved ✓':st==='skip'?'Skipped':'Planned'}</span></div>
      <div class="booking-actions"><a class="btn quiet" href="${mapsSearch(x.mapsQuery)}" target="_blank" rel="noopener">Map ↗</a>${ownerControls()?`<select class="status-select" data-restaurant-status="${x.id}"><option value="planned" ${st==='planned'?'selected':''}>Planned</option><option value="reserved" ${st==='reserved'?'selected':''}>Reserved</option><option value="booked" ${st==='booked'?'selected':''}>Booked</option><option value="skip" ${st==='skip'?'selected':''}>Skip</option></select>`:''}</div>
      ${ownerControls()&&['reserved','booked'].includes(st)?`<label class="booking-ref">Reservation reference<input class="field" data-restaurant-ref="${x.id}" value="${esc(ref)}" placeholder="Confirmation / reservation name"></label>`:''}${ref?`<div class="confirmation-line">Reference · ${esc(ref)}</div>`:''}
    </article>`;
  }).join('')}</div>`;
}
function activitiesHTML(){
  return `<div class="booking-stack">${visibleActivities().map(x=>{
    const st=state.activityStatuses?.[x.id]||x.status||'planned'; const ref=state.activityBookingRefs?.[x.id]||'';
    return `<article class="booking-card ${st==='booked'?'confirmed-card':''}" data-booking-entity="${x.id}"><div class="booking-card-top"><div><div class="eyebrow">${esc(cityName(x.cityId))} · ${fmt(x.date,{day:'numeric',month:'short'})} · ${esc(x.time)}</div><h3>${esc(x.name)}</h3><p>${esc(x.flexibility)}</p></div><span class="state-pill ${st}">${st==='booked'?'Booked ✓':st==='skip'?'Skipped':'Planned'}</span></div>
      <div class="booking-actions"><a class="btn quiet" href="${mapsSearch(x.mapsQuery)}" target="_blank" rel="noopener">Map ↗</a>${ownerControls()?`<select class="status-select" data-activity-status="${x.id}"><option value="planned" ${st==='planned'?'selected':''}>Planned</option><option value="booked" ${st==='booked'?'selected':''}>Booked</option><option value="skip" ${st==='skip'?'selected':''}>Skip</option></select>`:''}</div>
      ${ownerControls()&&st==='booked'?`<label class="booking-ref">Booking reference<input class="field" data-activity-ref="${x.id}" value="${esc(ref)}" placeholder="Confirmation / voucher reference"></label>`:''}${ref?`<div class="confirmation-line">Reference · ${esc(ref)}</div>`:''}
    </article>`;
  }).join('')}</div>`;
}
function tasksHTML(){
  const tasks=visibleBookings().filter(b=>b.entityType==='other'||!b.entityId);
  return `<div class="booking-stack">${tasks.map(b=>{const st=state.bookingStatuses[b.id]||'todo';return `<article class="task-card"><div><span>${esc(b.priority)}</span><h3>${esc(b.title)}</h3><p>${esc(b.reason)}</p></div>${ownerControls()?`<select class="status-select" data-booking-status="${b.id}"><option value="todo" ${st==='todo'?'selected':''}>To do</option><option value="booked" ${st==='booked'?'selected':''}>Done</option><option value="monitor" ${st==='monitor'?'selected':''}>Monitor</option><option value="skip" ${st==='skip'?'selected':''}>Skip</option></select>`:`<span class="state-pill ${st}">${esc(st)}</span>`}</article>`;}).join('')||'<div class="all-clear"><span>✓</span><div><h3>No other tasks</h3><p>Everything here is covered elsewhere.</p></div></div>'}</div>`;
}
function bindBookingActions(el){
  $$('[data-attention-jump]',el).forEach(b=>b.onclick=()=>{bookingCategory=b.dataset.attentionJump;renderBookings();});
  $$('[data-open-stay]',el).forEach(b=>b.onclick=()=>openStayChooser(b.dataset.openStay));
  $$('[data-choose-flight]',el).forEach(b=>b.onclick=()=>{const id=b.dataset.chooseFlight;state.selectedTransportOptions[id]=b.dataset.option;state.transportStatuses||={};state.transportStatuses[id]='chosen';saveState({quiet:true});renderBookings();toast('Transport chosen ✓');});
  $$('[data-toggle-transport-booked]',el).forEach(b=>b.onclick=()=>{const id=b.dataset.toggleTransportBooked;state.transportStatuses||={};state.transportStatuses[id]=state.transportStatuses[id]==='booked'?'chosen':'booked';saveState({quiet:true});renderBookings();});
  $$('[data-transport-ref]',el).forEach(i=>i.onchange=()=>{state.transportBookingRefs||={};state.transportBookingRefs[i.dataset.transportRef]=i.value.trim();saveState({quiet:true});});
  $$('[data-add-flight]',el).forEach(b=>b.onclick=()=>{const t=byId(model.transport,b.dataset.addFlight);const label=prompt(`Add another option for ${t.route}
Example: LATAM LA123 · 09:10 → 11:00`);if(!label)return;const id=`custom-${Date.now()}`;(state.customTransportOptions[t.id]||=[]).push({id,label,carrierOrMode:label,depart:label,arrive:'',stops:null,duration:'',price:null,currency:'GBP',baggage:'Backpack / cabin baggage',status:'USER OPTION',note:''});state.selectedTransportOptions[t.id]=id;state.transportStatuses||={};state.transportStatuses[t.id]='chosen';saveState({quiet:true});renderBookings();});
  $$('[data-restaurant-status]',el).forEach(x=>x.onchange=()=>{state.restaurantStatuses[x.dataset.restaurantStatus]=x.value;saveState({quiet:true});renderBookings();});
  $$('[data-restaurant-ref]',el).forEach(i=>i.onchange=()=>{state.restaurantBookingRefs||={};state.restaurantBookingRefs[i.dataset.restaurantRef]=i.value.trim();saveState({quiet:true});});
  $$('[data-activity-status]',el).forEach(x=>x.onchange=()=>{state.activityStatuses||={};state.activityStatuses[x.dataset.activityStatus]=x.value;saveState({quiet:true});renderBookings();});
  $$('[data-activity-ref]',el).forEach(i=>i.onchange=()=>{state.activityBookingRefs||={};state.activityBookingRefs[i.dataset.activityRef]=i.value.trim();saveState({quiet:true});});
  $$('[data-booking-status]',el).forEach(x=>x.onchange=()=>{state.bookingStatuses[x.dataset.bookingStatus]=x.value;saveState({quiet:true});renderBookings();});
}
function openStayChooser(stayId){
  const stay=effectiveEntity('stays',stayId); if(!stay)return;
  const sel=selectedHotel(stay),status=state.stayStatuses?.[stay.id]||(sel?'chosen':'unselected'),ref=state.stayBookingRefs?.[stay.id]||'';
  openSheet(`<div class="sheet-head"><div><div class="eyebrow">${esc(stay.dateLabel)} · ${esc(stay.area)}</div><h2>${esc(stay.city)}</h2><div class="tiny muted">${esc(stay.note||'Choose where you want to stay.')}</div></div><button class="icon-action" data-close>×</button></div>
    <div class="step-line"><span class="${sel?'done':''}">1 Choose</span><i></i><span class="${status==='booked'?'done':''}">2 Book</span><i></i><span class="${ref?'done':''}">3 Reference</span></div>
    <div class="stay-choice-list">${hotelOptions(stay).map(o=>`<article class="stay-choice ${sel?.id===o.id?'selected':''}"><div><strong>${esc(o.name)}</strong><small>${sel?.id===o.id?(status==='booked'?'Booked ✓':'Current choice'):'Shortlist'}</small></div><div class="option-actions"><a class="btn quiet small" target="_blank" rel="noopener" href="${mapsSearch(o.mapsQuery)}">Map ↗</a>${ownerControls()?`<button class="btn small ${sel?.id===o.id?'quiet':'primary'}" data-stay-pick="${o.id}">${sel?.id===o.id?'Selected':'Choose'}</button>`:''}</div></article>`).join('')}</div>
    ${ownerControls()?`<div class="stay-manage"><button class="link-button" id="addStayOption">+ Add another hotel</button>${sel?`<button class="btn ${status==='booked'?'quiet':'primary'}" id="toggleStayBooked">${status==='booked'?'Booked ✓':'Mark booked'}</button>`:''}</div>${sel?`<label class="booking-ref">Confirmation / booking reference<input class="field" id="stayRef" value="${esc(ref)}" placeholder="Booking.com / hotel reference"></label>`:''}`:''}`);
  $$('[data-stay-pick]').forEach(b=>b.onclick=()=>{state.selectedHotels[stay.id]=b.dataset.stayPick;state.stayStatuses||={};state.stayStatuses[stay.id]='chosen';saveState({quiet:true});openStayChooser(stay.id);toast('Stay chosen ✓');});
  $('#toggleStayBooked')?.addEventListener('click',()=>{state.stayStatuses||={};state.stayStatuses[stay.id]=status==='booked'?'chosen':'booked';saveState({quiet:true});openStayChooser(stay.id);toast(status==='booked'?'Marked as chosen':'Stay marked booked ✓');});
  $('#stayRef')?.addEventListener('change',e=>{state.stayBookingRefs||={};state.stayBookingRefs[stay.id]=e.target.value.trim();saveState({quiet:true});});
  $('#addStayOption')?.addEventListener('click',()=>{const name=prompt(`Add another hotel in ${stay.city}`);if(!name)return;const id=`custom-hotel-${Date.now()}`;(state.customHotelOptions[stay.id]||=[]).push({id,name,status:'shortlist',address:'',lat:null,lon:null,bookingUrl:'',mapsQuery:`${name}, ${stay.city}`});state.selectedHotels[stay.id]=id;state.stayStatuses||={};state.stayStatuses[stay.id]='chosen';saveState({quiet:true});openStayChooser(stay.id);});
}
function openDay(id){
  const d=effectiveDays(model,state).find(x=>x.id===id); if(!d)return;
  const stay=d.stayId?effectiveEntity('stays',d.stayId):null,hotel=stay?selectedHotel(stay):null;
  const trans=(d.transportIds||[]).map(x=>effectiveEntity('transport',x)).filter(Boolean);
  const places=dayGuideItems(d),pinsUrl=mapsMultiPin(places.map(x=>x.query),places.length>4?'driving':'walking'),savedList=daySavedListUrl(d);
  const dayNo=d.orderIndex+1;
  const visible=viewerDays(); const vi=visible.findIndex(x=>x.id===d.id); const prev=visible[vi-1],next=visible[vi+1];
  openSheet(`<div class="day-detail-head"><div class="day-detail-number">${dayNo}</div><div><div class="eyebrow">${fmt(d.scheduledDate,{weekday:'long',day:'numeric',month:'long'})}</div><h2>${esc(d.title)}</h2><div class="tiny muted">${esc(cityName(d.cityId))} · ${esc(travellerNames(d.travellerIds))}</div></div><button class="icon-action" data-close>×</button></div>
    <p class="day-intro">${esc(d.intro||d.anchor)}</p>
    ${trans.length?`<div class="journey-strip">${trans.map(t=>`<span>${t.type==='air'?'✈':'↔'} <b>${esc(t.route)}</b><small>${esc(selectedTransport(t)?.label||t.status||'')}</small></span>`).join('')}</div>`:''}
    <div class="day-key-row">${stay?(hotel?(ownerControls()?`<button class="inline-link ${state.stayStatuses?.[stay.id]==='booked'?'confirmed':''}" id="dayStayBtn">⌂ ${esc(hotel.name)}${state.stayStatuses?.[stay.id]==='booked'?' ✓':''}</button>`:`<span class="inline-link static ${state.stayStatuses?.[stay.id]==='booked'?'confirmed':''}">⌂ ${esc(hotel.name)}${state.stayStatuses?.[stay.id]==='booked'?' ✓':''}</span>`):(ownerControls()?`<button class="inline-link attention" id="dayStayBtn">⌂ Choose stay</button>`:`<span class="inline-link static muted">⌂ Stay being finalised</span>`)):''}${places.slice(0,3).map(x=>`<a class="place-pill" href="${mapsSearch(x.query)}" target="_blank" rel="noopener">${esc(x.name)} ↗</a>`).join('')}</div>
    <div id="dayWeather"></div>
    <div class="day-timeline">${Object.entries(d.timeline).filter(([,a])=>a?.length).map(([k,a])=>`<section><h4>${k[0].toUpperCase()+k.slice(1)}</h4>${a.map(x=>`<div class="timeline-row"><i></i><span>${esc(x)}</span></div>`).join('')}</section>`).join('')}</div>
    ${d.watchOut?`<div class="soft-alert"><span>!</span><div><strong>Worth knowing</strong><p>${esc(d.watchOut)}</p></div></div>`:''}
    <div class="day-map-card"><div><div class="eyebrow">Today's map</div><h3>Everything for this day, together</h3><p>Hotel, food, sights and activities linked to today's plan.</p></div><div class="day-map-actions"><a class="btn primary" target="_blank" rel="noopener" href="${pinsUrl}">Open all today's pins ↗</a>${savedList?`<a class="btn quiet" target="_blank" rel="noopener" href="${esc(savedList)}">Saved Maps list ↗</a>`:ownerControls()?'<button class="btn quiet" id="addDayMapList">+ Saved list</button>':''}<button class="btn quiet" id="copyDayPlaces">Copy places</button></div></div>
    <div class="linked-places"><div class="section-mini-head"><h3>Linked places</h3><span>${places.length}</span></div>${places.map(x=>`<a class="linked-place" href="${mapsSearch(x.query)}" target="_blank" rel="noopener"><span><small>${esc(x.kind)}</small><strong>${esc(x.name)}</strong></span><b>↗</b></a>`).join('')||'<div class="empty compact">No linked map places yet.</div>'}</div><div class="day-footer-actions">${prev?`<button class="btn quiet" data-prev-day="${prev.id}">← ${fmt(prev.scheduledDate,{day:'numeric',month:'short'})}</button>`:'<span></span>'}${ownerControls()?`<button class="btn quiet" id="replanDay">✦ Replan day</button>`:''}${next?`<button class="btn quiet" data-next-day="${next.id}">${fmt(next.scheduledDate,{day:'numeric',month:'short'})} →</button>`:'<span></span>'}</div>`);
  $('#dayStayBtn')?.addEventListener('click',()=>openStayChooser(stay.id));
  $('[data-prev-day]')?.addEventListener('click',e=>openDay(e.currentTarget.dataset.prevDay));
  $('[data-next-day]')?.addEventListener('click',e=>openDay(e.currentTarget.dataset.nextDay));
  $('#replanDay')?.addEventListener('click',()=>openAI(`Replan ${fmt(d.scheduledDate,{weekday:'long',day:'numeric',month:'long'})} in ${cityName(d.cityId)}. Keep all locked bookings and transport. Preserve the spirit of the day but make the logistics better.`));
  $('#addDayMapList')?.addEventListener('click',()=>{const u=prompt(`Paste the Google Maps Saved List / My Maps URL for ${fmt(d.scheduledDate,{day:'numeric',month:'short'})} · ${cityName(d.cityId)}`);if(u){state.dayMapListUrls||={};state.dayMapListUrls[d.id]=u;saveState({quiet:true});openDay(d.id);}});
  $('#copyDayPlaces')?.addEventListener('click',async()=>{const text=places.map(x=>`${x.kind}: ${x.name} — ${mapsSearch(x.query)}`).join('\n');try{await navigator.clipboard.writeText(text);toast('Today’s places copied')}catch{toast('Could not copy places','bad')}});
  loadWeather(d,$('#dayWeather'));
}
function openAI(prefill=''){
  openSheet(`<div class="sheet-head"><div><div class="eyebrow">Trip AI</div><h2>Replan safely</h2></div><button class="btn small" data-close>Close</button></div><div class="ai-box"><strong>AI rules</strong><div class="tiny muted" style="margin-top:4px">Locked bookings are never silently moved. Every proposed change is previewed before application. Routine edits do not call AI.</div></div><textarea class="ai-input" id="aiPrompt" placeholder="e.g. Give me an extra night in Paraty but don't change anyone's international flights">${esc(prefill)}</textarea><div class="ai-suggestions"><button class="seg" data-ai-suggest="Give me an extra night in Paraty but don't change anyone's international flights">Extra Paraty night</button><button class="seg" data-ai-suggest="Move Santiago before Mendoza">Move a city</button><button class="seg" data-ai-suggest="Reorganise Rio around the selected hotel and minimise unnecessary journeys">Optimise Rio</button></div><div style="margin-top:12px"><button class="btn primary" id="askAI">Analyse & preview</button></div><div id="aiStatus" class="tiny muted" style="margin-top:8px"></div>`);
  $$('[data-ai-suggest]').forEach(b=>b.onclick=()=>$('#aiPrompt').value=b.dataset.aiSuggest);
  $('#askAI').onclick=async()=>{
    const prompt = $('#aiPrompt').value.trim();
    if (!prompt) return;
    $('#aiStatus').textContent='Analysing constraints…';
    let p;
    if (localMode) {
      await new Promise(r=>setTimeout(r,250));
      p = proposalFromPrompt(model,state,prompt);
    } else {
      try {
        const r = await fetch('/api/ai-plan',{method:'POST',headers:{'content-type':'application/json','x-admin-key':adminKey},body:JSON.stringify({prompt,state,trip:model})});
        if (!r.ok) throw new Error((await r.json()).error||r.status);
        p = await r.json();
      } catch (e) {
        toast(`AI unavailable: ${e.message}`,'bad');
        return;
      }
    }
    showProposal(p);
  };
}

function showProposal(p){
  p = validateProposal(model,state,p);
  proposal = p;
  openSheet(`<div class="sheet-head"><div><div class="eyebrow">AI change preview</div><h2>${esc(p.title)}</h2></div><button class="btn small" data-close>Close</button></div><p>${esc(p.summary)}</p>${p.conflicts?.length?`<div class="alert bad"><strong>Locked conflicts · cannot apply</strong>${p.conflicts.map(c=>`<div style="margin-top:5px">• ${esc(c.label)} — ${esc(c.reason)}</div>`).join('')}</div>`:''}${p.warnings?.length?`<div class="alert warn"><strong>Needs attention</strong>${p.warnings.map(w=>`<div style="margin-top:5px">• ${esc(w)}</div>`).join('')}</div>`:''}<div class="section-head"><div><h3>${p.ops?.length||0} proposed changes</h3></div></div>${(p.ops||[]).map(o=>`<div class="proposal-op"><div class="op-icon">↪</div><div><strong>${esc(o.label||o.entityId)}</strong><div class="tiny muted">${esc(o.from||'')} ${o.to?`→ ${esc(o.to)}`:''}</div></div></div>`).join('')||'<div class="empty">No automatic changes proposed.</div>'}<div class="option-actions" style="margin-top:14px"><button class="btn" data-close>Cancel</button>${p.conflicts?.length&&owner?'<button class="btn gold" id="resolveProposal">✨ Ask AI for a safe alternative</button>':''}${p.canApply&&owner?'<button class="btn primary" id="applyProposal">Apply all changes</button>':''}</div>`);
  $('#resolveProposal')?.addEventListener('click',()=>openAI(`Find a safe way to accomplish this request: ${p.summary} Preserve all locked transport, purchased bookings and traveller join/leave dates.`));
  $('#applyProposal')?.addEventListener('click',()=>{
    try {
      state = applyProposal(model,state,p);
      closeSheet();
      saveState();
      toast('Proposal applied · Undo is available');
    } catch (e) {
      toast(e.message,'bad');
    }
  });
}

function openSheet(html){
  const s = $('#sheet');
  const b = $('#sheetBody');
  b.innerHTML = html;
  s.classList.add('open');
  $$('[data-close]',b).forEach(x=>x.onclick=closeSheet);
}
function closeSheet(){ $('#sheet')?.classList.remove('open'); }

async function boot(){
  try {
    model = await fetch('/data/trip-v2.json').then(r=>{if(!r.ok)throw new Error(r.status);return r.json();});
    state = await loadState();
    state.cityMapListUrls ||= {};
    state.dayMapListUrls ||= {};
    state.stayStatuses ||= {};
    state.stayBookingRefs ||= {};
    document.querySelector('#app').innerHTML='';
    renderAll();
    if (!viewerId) setTimeout(()=>openViewerChooser(true),80);
    if ('serviceWorker' in navigator && !localMode) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  } catch (e) {
    document.querySelector('#app').innerHTML=`<div class="boot"><div class="boot-logo">!</div><strong>Could not load V2</strong><span>${esc(e.message)}</span></div>`;
  }
}

boot();
