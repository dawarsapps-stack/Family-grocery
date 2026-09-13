function renderTravel() {
  const el = $("#view-travel"); if (!el) return;
  el.innerHTML = `
    <div class="section-head"><div><h2>Flights & stays</h2><p>One shared choice. Everyone opening the link sees the same selected travel.</p></div></div>
    <div class="section-head"><div><h3 style="margin:0;color:var(--navy)">Transport</h3></div></div>
    <div class="travel-grid">${data.flights.map(flightCardHTML).join("")}</div>
    <div class="section-head" style="margin-top:20px"><div><h3 style="margin:0;color:var(--navy)">Hotels</h3><p>Choosing a hotel updates every relevant day and its day-route link.</p></div></div>
    <div class="travel-grid">${data.stays.map(stayCardHTML).join("")}</div>`;
  $$('[data-flight-select]',el).forEach(sel=>sel.addEventListener("change",()=>{if(!ownerMode)return;shared.selectedFlights[sel.dataset.flightSelect]=sel.value;saveShared(shared);}));
  $$('[data-hotel-select]',el).forEach(sel=>sel.addEventListener("change",()=>{if(!ownerMode)return;shared.selectedHotels[sel.dataset.hotelSelect]=sel.value;saveShared(shared);}));
  $$('[data-add-flight]',el).forEach(form=>form.addEventListener("submit",e=>{e.preventDefault();if(!ownerMode)return;const input=$("input",form);const label=input.value.trim();if(!label)return;const id=`custom-${Date.now()}`;const fid=form.dataset.addFlight;(shared.customFlightOptions[fid] ||= []).push({id,label,mode:"Custom option",timing:label,status:"USER OPTION",note:""});shared.selectedFlights[fid]=id;input.value="";saveShared(shared);}));
  $$('[data-add-hotel]',el).forEach(form=>form.addEventListener("submit",e=>{e.preventDefault();if(!ownerMode)return;const input=$("input",form);const name=input.value.trim();if(!name)return;const id=`custom-${Date.now()}`;const sid=form.dataset.addHotel;(shared.customHotelOptions[sid] ||= []).push({id,name});shared.selectedHotels[sid]=id;input.value="";saveShared(shared);}));
}

function flightCardHTML(f) {
  const opts=flightOptions(f), sel=selectedFlight(f), selectedId=shared.selectedFlights[f.id]||sel?.id||"";
  const query=encodeURIComponent(`Flights ${f.route} ${f.date}`);
  return `<article class="travel-card"><div class="eyebrow">${fmtDate(f.date,{day:"numeric",month:"short"})} · ${esc(f.status)}</div><h3>${esc(f.route)}</h3><div class="route">${esc(f.note||"")}</div><div class="selection-label">Chosen option</div><select class="travel-select" data-flight-select="${f.id}" ${ownerMode?"":"disabled"}>${opts.map(o=>`<option value="${esc(o.id)}" ${selectedId===o.id?"selected":""}>${esc(o.label)}</option>`).join("")}</select><div class="travel-links"><a class="ghost-button small" href="https://www.google.com/travel/flights?q=${query}" target="_blank" rel="noopener">Search live flights ↗</a></div>${ownerMode?`<div class="option-editor"><form data-add-flight="${f.id}"><input class="text-input" placeholder="Add another flight / timing"><button class="solid-button small">Add</button></form></div>`:""}</article>`;
}
function stayCardHTML(s) {
  const opts=hotelOptions(s), hotel=selectedHotel(s), selectedId=shared.selectedHotels[s.id]||"";
  const query=encodeURIComponent(`${hotel?.name||s.city} ${s.city}`);
  return `<article class="travel-card"><div class="eyebrow">${esc(s.dates)} · ${esc(s.area)}</div><h3>${esc(s.city)}</h3><div class="route">${esc(s.note||"")}</div><div class="selection-label">Chosen hotel</div><select class="travel-select" data-hotel-select="${s.id}" ${ownerMode?"":"disabled"}><option value="">Not chosen yet</option>${opts.map(o=>`<option value="${esc(o.id)}" ${selectedId===o.id?"selected":""}>${esc(o.name)}</option>`).join("")}</select>${hotel?`<div class="travel-links"><a class="ghost-button small" href="https://www.google.com/maps/search/?api=1&query=${query}" target="_blank" rel="noopener">Open hotel map ↗</a></div>`:""}${ownerMode?`<div class="option-editor"><form data-add-hotel="${s.id}"><input class="text-input" placeholder="Add another hotel"><button class="solid-button small">Add</button></form></div>`:""}</article>`;
}

function renderPlan() {
  const el=$("#view-plan");if(!el)return;const issues=planningIssues();const score=readinessScore();
  el.innerHTML=`<div class="section-head"><div><h2>Planner</h2><p>Bookings, preparation and anything that could break the route.</p></div></div><div class="plan-grid"><div><div class="card"><div class="health-score"><div class="score-ring" style="--score:${score}%"><strong>${score}</strong></div><div><h3 style="margin:0">Trip readiness</h3><div class="muted tiny">Based on stays, bookings, prep and clashes.</div></div></div><div class="issue-list">${issues.slice(0,10).map(i=>`<div class="issue ${i.bad?"bad":i.good?"good":""}">${esc(i.text)}</div>`).join("")}</div></div><div class="card"><div class="eyebrow">Bookings</div>${data.bookings.map(b=>checkRowHTML("booking",b.id,b.item,!!shared.bookingChecks[b.id])).join("")}</div></div><div><div class="card"><div class="eyebrow">Before you leave</div>${data.prep.map(p=>checkRowHTML("prep",p.id,p.item,!!shared.prepChecks[p.id])).join("")}</div><div class="card"><div class="eyebrow">Share this trip</div><p class="muted tiny">The Netlify link is the group source of truth. Viewing needs no login.</p><div class="share-grid"><button class="solid-button small" data-share>Share link</button><button class="ghost-button small" data-copy>Copy link</button>${ownerMode?`<button class="ghost-button small" data-lock-owner>Exit owner mode</button>`:""}</div></div></div></div>`;
  $$('[data-check-type]',el).forEach(cb=>cb.addEventListener("change",()=>{if(!ownerMode){cb.checked=!cb.checked;toast("Only the owner can change the shared plan.","bad");return;}const bucket=cb.dataset.checkType==="booking"?shared.bookingChecks:shared.prepChecks;bucket[cb.dataset.id]=cb.checked;saveShared(shared,{quiet:true});}));
  bindCommonActions(el);
  $("[data-lock-owner]",el)?.addEventListener("click",lockOwner);
}
function checkRowHTML(type,id,label,checked){return `<div class="check-row ${checked?"checked":""}"><input type="checkbox" data-check-type="${type}" data-id="${esc(id)}" ${checked?"checked":""} ${ownerMode?"":"disabled"}><label>${esc(label)}</label></div>`;}
