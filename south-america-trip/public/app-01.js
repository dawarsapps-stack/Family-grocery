"use strict";
"use strict";
const API="/api/trip-state", AI_API="/api/ai-plan", CACHE="sa-trip-v4-cache", PENDING="sa-trip-v4-pending", ACTOR="sa-trip-actor";
const TRAVELLERS=["Sahil","Niki","Priyesh","Amisha"];
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const app=$("#app");
let state=null, synced=null, doc=null, activeTab="home", activeDayId=null, map=null, saveTimer=null, saving=false, queuedSummary="", lastSync=true, exploreCategory="All", weatherCache=new Map();
const filters={q:"",country:"all"};

function clone(v){if(v===undefined)return undefined;return JSON.parse(JSON.stringify(v));}
function esc(v=""){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function fmtDate(iso,opts={day:"numeric",month:"short"}){if(!iso)return"";const [y,m,d]=iso.split("-").map(Number);const dt=new Date(Date.UTC(y,m-1,d));return new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",...opts}).format(dt);}
function todayISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function uid(p="x"){return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
function actor(){return localStorage.getItem(ACTOR)||"Sahil";}
function setActor(name){localStorage.setItem(ACTOR,name);renderAll();}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function isObj(v){return !!v&&typeof v==="object"&&!Array.isArray(v);}
function merge3(base,local,remote){
  if(eq(local,base))return clone(remote); if(eq(remote,base))return clone(local);
  if(Array.isArray(base)&&Array.isArray(local)&&Array.isArray(remote)){
    const keyed=[...base,...local,...remote].filter(Boolean).every(x=>!Array.isArray(x)&&(!isObj(x)||("id" in x)));
    if(!keyed)return clone(local);
    const bm=new Map(base.map(x=>[x.id,x])),lm=new Map(local.map(x=>[x.id,x])),rm=new Map(remote.map(x=>[x.id,x]));
    const order=eq(local.map(x=>x.id),base.map(x=>x.id))?remote.map(x=>x.id):local.map(x=>x.id);
    const ids=[...order,...remote.map(x=>x.id)].filter((x,i,a)=>x&&a.indexOf(x)===i);
    const out=[];
    for(const id of ids){const b=bm.get(id),l=lm.get(id),r=rm.get(id);if(b&&l===undefined&&r!==undefined){if(eq(r,b))continue;out.push(clone(r));continue;}if(b&&r===undefined&&l!==undefined){if(eq(l,b))continue;out.push(clone(l));continue;}if(l===undefined&&r===undefined)continue;if(b===undefined){out.push(clone(l??r));continue;}out.push(merge3(b,l??b,r??b));}
    return out;
  }
  if(isObj(base)&&isObj(local)&&isObj(remote)){const out={};const keys=new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]);for(const k of keys){if(!(k in local)&&k in base&&eq(remote[k],base[k]))continue;if(!(k in remote)&&k in base&&eq(local[k],base[k]))continue;out[k]=merge3(base[k],local[k],remote[k]);}return out;}
  return clone(local);
}
function toast(msg,bad=false){const t=$("#toast");if(!t)return;t.textContent=msg;t.className=`toast show${bad?" bad":""}`;clearTimeout(toast._t);toast._t=setTimeout(()=>t.className="toast",2400);}
async function request(url,opts){const r=await fetch(url,opts);let body=null;try{body=await r.json();}catch{}if(!r.ok){const e=new Error(body?.error||String(r.status));e.status=r.status;e.payload=body;throw e;}return body;}
function persist(){if(state)localStorage.setItem(CACHE,JSON.stringify(state));}

function normaliseDoc(d){
  d.version="4.0";d.title=d.title||"Sahil · South America 2026";d.tripStart=d.tripStart||"2026-09-20";d.tripEnd=d.tripEnd||"2026-10-17";
  d.travellers=(d.travellers?.length?d.travellers:TRAVELLERS.map(n=>({id:n.toLowerCase(),name:n}))).map(t=>typeof t==="string"?{id:t.toLowerCase(),name:t}:t);
  d.days=(d.days||[]).map((x,i)=>({...x,id:x.id||`day-${x.date}-${i}`,travellerIds:x.travellerIds||travellerIdsFromCompanions(x.companions),notes:x.notes||"",locked:!!x.locked}));
  d.flights=(d.flights||d.transport||[]).map((x,i)=>({...x,id:x.id||`transport-${i+1}`,type:x.type||"air",locked:!!x.locked,baggage:x.baggage||x.options?.[0]?.baggage||"Reconfirm cabin allowance"}));
  d.stays=(d.stays||[]).map((x,i)=>({...x,id:x.id||`stay-${i+1}`,locked:!!x.locked,status:x.status||"shortlist",selectedHotelId:x.selectedHotelId||null}));
  d.bookings=(d.bookings||[]).map((x,i)=>({...x,id:x.id||`booking-${i+1}`,title:x.title||x.item||"Booking",status:x.status||"needs-action",locked:!!x.locked}));
  d.prep=d.prep||[];d.explore=d.explore||deriveExplore(d);return d;
}
function travellerIdsFromCompanions(c=""){const s=String(c).toLowerCase();if(s.includes("all four"))return["sahil","niki","priyesh","amisha"];const out=[];for(const n of TRAVELLERS)if(s.includes(n.toLowerCase()))out.push(n.toLowerCase());return out.length?out:["sahil"];}
function deriveExplore(d){const out=[],seen=new Set();for(const s of d.stays||[]){for(const h of s.options||[]){const k=`stay:${h.name}`;if(seen.has(k))continue;seen.add(k);out.push({id:uid("place"),category:"Stay",name:h.name,city:s.city,query:`${h.name}, ${s.city}`,lat:h.lat??null,lon:h.lon??null,note:s.area||""});}}for(const day of d.days||[]){for(const p of day.places||[]){const k=`see:${p}`;if(seen.has(k))continue;seen.add(k);out.push({id:uid("place"),category:"See",name:p,city:day.location,query:p,lat:null,lon:null,note:""});}}return out;}
