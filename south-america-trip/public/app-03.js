"use strict";
function setColombia(d){
  setDay(d,"2026-10-11",{title:"Rio → Cartagena",location:"Cartagena",country:"Colombia",intro:"Easy Rio morning, then the group splits at the airport: Niki home; Sahil, Priyesh and Amisha continue toward Cartagena.",anchor:"Depart Rio on 11 Oct. Exact flight numbers and connection timings remain RECONFIRM.",morning:["Easy Rio breakfast / lunch and packing."],afternoon:["All four head to the airport together.","Niki flies to London; Sahil, Priyesh and Amisha head toward Cartagena."],evening:["Connect onward to Cartagena if booked that way; do not assume old placeholder timings."],logistics:["Reconfirm exact 11 Oct flights before treating any number as confirmed."],decision:"RECONFIRM · exact 11 Oct flight details",locked:false,travellerIds:["sahil","priyesh","amisha"],lat:10.391,lon:-75.4794,timeZone:"America/Bogota",sleep:"Cartagena · hotel not yet booked."});
  for(const id of ["flight-14","flight-15","flight-16"]){const f=byId(d.flights,id);if(f){f.status="RECONFIRM";f.locked=false;f.note="Old flight number/timing is not treated as confirmed; verify before booking or editing.";}}
  const s10=byId(d.stays,"stay-10");if(s10)Object.assign(s10,{dates:"11–14 Oct",note:"Cartagena accommodation is not booked; prioritise Walled City / Getsemaní edge for safe late returns"});
  const s11=byId(d.stays,"stay-11");if(s11)Object.assign(s11,{dates:"14–16 Oct"});const s12=byId(d.stays,"stay-12");if(s12)Object.assign(s12,{dates:"16–17 Oct"});
  setDay(d,"2026-10-16",{title:"Medellín → Bogotá",location:"Bogotá",country:"Colombia",intro:"Move to Bogotá on the 16th so the final capital chapter is real, not just an airport night.",anchor:"Travel to Bogotá with enough day left for a neighbourhood dinner / drinks; exact flight to reconfirm.",decision:"TARGET / RECONFIRM · arrive Bogotá on 16 Oct",lat:4.711,lon:-74.0721,timeZone:"America/Bogota",sleep:"Bogotá · Chapinero / Zona G."});
  const f18=byId(d.flights,"flight-18");if(f18)Object.assign(f18,{date:"2026-10-16",route:"Medellín → Bogotá",timing:"TBD · arrive Bogotá on 16 Oct",status:"TARGET / RECONFIRM",locked:false,note:"Current structure puts Bogotá on 16 Oct; exact flight remains to confirm."});
}

function applyLegacyShared(seed,legacy){
  if(!legacy||typeof legacy!=="object")return;
  for(const day of seed.days||[]){const note=legacy.dayNotes?.[day.id];if(note&&!day.notes)day.notes=String(note);}
  for(const stay of seed.stays||[]){const custom=legacy.customHotelOptions?.[stay.id]||[];const names=new Set((stay.options||[]).map(x=>x.name));for(const h of custom)if(h?.name&&!names.has(h.name)){stay.options.push(h);names.add(h.name);}}
  for(const flight of seed.flights||[]){const custom=legacy.customFlightOptions?.[flight.id]||[];flight.options=flight.options||[];const ids=new Set(flight.options.map(x=>x.id));for(const o of custom)if(o?.id&&!ids.has(o.id)){flight.options.push(o);ids.add(o.id);}if(legacy.selectedFlights?.[flight.id])flight.selectedOptionId=legacy.selectedFlights[flight.id];}
}
function flightForDay(day){return doc.flights.find(f=>f.date===day.date)||null;}
function stayForDay(day){const loc=String(day.location||"").toLowerCase();return doc.stays.find(s=>loc.includes(String(s.city||"").toLowerCase())&&dateInStay(day.date,s))||doc.stays.find(s=>loc.includes(String(s.city||"").toLowerCase()))||null;}
function dateInStay(date,s){if(s.checkIn&&s.checkOut)return date>=s.checkIn&&date<s.checkOut;return true;}
function selectedHotel(stay){if(!stay)return null;const id=state.selectedHotels?.[stay.id]||stay.selectedHotelId;return (stay.options||[]).find(x=>x.id===id)||null;}
function needsAttention(){const out=[];for(const f of doc.flights)if(!f.locked&&/RECONFIRM|TARGET|TBD|PLANNED/i.test(f.status||""))out.push(`${f.route} · ${f.status}`);for(const s of doc.stays)if(!selectedHotel(s))out.push(`${s.city} stay · hotel not selected`);for(const b of doc.bookings)if(!(state.bookingChecks||{})[b.id]&&!/booked|done/i.test(b.status||""))out.push(b.title);return out;}
function lockedItems(){return [...doc.flights.filter(x=>x.locked),...doc.bookings.filter(x=>x.locked)];}
function readiness(){const total=doc.bookings.length+doc.stays.length+doc.prep.length||1;const done=doc.bookings.filter(b=>state.bookingChecks?.[b.id]||/booked|done/i.test(b.status||"")).length+doc.stays.filter(selectedHotel).length+doc.prep.filter(p=>state.prepChecks?.[p.id]).length;return Math.round(done/total*100);}

async function syncState(summary="Trip update",initial=false){
  persist();localStorage.setItem(PENDING,"1");if(!navigator.onLine){lastSync=false;updateSync();return false;}if(saving){queuedSummary=summary;return false;}saving=true;
  try{
    let working=clone(state),base=clone(synced||{revision:0});
    for(let attempt=0;attempt<2;attempt++){
      try{const saved=await request(API,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({state:working,baseRevision:Number(base.revision||0),actor:actor(),summary})});state=saved;synced=clone(saved);doc=state.document;persist();localStorage.removeItem(PENDING);lastSync=true;updateSync();if(!initial)toast("Shared trip updated");return true;}
      catch(e){if(e.status===409&&e.payload?.current){const remote=e.payload.current;working=merge3(base,working,remote);working.revision=remote.revision;base=clone(remote);continue;}throw e;}
    }
    throw new Error("Could not reconcile concurrent edit");
  }catch(e){lastSync=false;updateSync();toast(`Saved offline · sync pending (${e.message})`,true);return false;}
  finally{saving=false;if(queuedSummary){const s=queuedSummary;queuedSummary="";setTimeout(()=>syncState(s),50);}}
}
