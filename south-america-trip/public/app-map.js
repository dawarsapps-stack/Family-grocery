function renderMapView() {
  const el=$("#view-map");if(!el)return;
  el.innerHTML=`<div class="section-head"><div><h2>Route map</h2><p>Click a stop to open that part of the itinerary. Filters from Itinerary also apply here.</p></div><button class="ghost-button small" data-fit-map>Fit route</button></div><div class="map-wrap"><div id="trip-map"></div><div class="map-fallback">Map tiles need an internet connection. Your itinerary remains available offline.</div><div class="map-legend">${filteredDays().map((d,i)=>`<button class="country-chip" data-open-map-day="${d.id}">${i+1}. ${esc(d.location)}</button>`).join("")}</div></div>`;
  bindCommonActions(el);
  setTimeout(initMap,0);
}

function initMap(focusDayId=null) {
  const node=$("#trip-map"); if(!node || activeTab!=="map") return;
  if (!window.L) { node.style.display="none"; $(".map-fallback")?.style && ($(".map-fallback").style.display="block"); return; }
  if (map) { map.remove(); map=null; }
  map=L.map(node,{zoomControl:true,worldCopyJump:true});
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  const days=filteredDays();const coords=[];const seen=new Set();
  days.forEach((d,i)=>{ if(!Number.isFinite(d.lat)||!Number.isFinite(d.lon))return; const key=`${d.lat},${d.lon}`; coords.push([d.lat,d.lon]); if(seen.has(key))return; seen.add(key); const html=`<div class="route-marker"><span>${i+1}</span></div>`; const marker=L.marker([d.lat,d.lon],{icon:L.divIcon({className:"",html,iconSize:[30,30],iconAnchor:[15,30]})}).addTo(map); marker.bindPopup(`<strong>${esc(d.location)}</strong><br>${fmtDate(d.scheduledDate,{day:"numeric",month:"short"})}<br><button data-map-popup-day="${d.id}" style="margin-top:6px">Open day</button>`); marker.on("popupopen",()=>setTimeout(()=>{$$('[data-map-popup-day]').forEach(b=>b.onclick=()=>openDay(b.dataset.mapPopupDay));},0)); });
  if(coords.length>1)L.polyline(coords,{color:"#b8842d",weight:3,opacity:.78,dashArray:"8 6"}).addTo(map);
  if(coords.length)map.fitBounds(coords,{padding:[34,34],maxZoom:6});else map.setView([-15,-60],3);
  $("[data-fit-map]")?.addEventListener("click",()=>coords.length&&map.fitBounds(coords,{padding:[34,34],maxZoom:6}));
  if(focusDayId){const d=effectiveDays().find(x=>x.id===focusDayId);if(d)map.setView([d.lat,d.lon],7);}
}

function openDay(dayId, show=true) {
  const day=effectiveDays().find(d=>d.id===dayId);if(!day)return;activeDayId=dayId;
  const panel=$("#detailPanel"),sheet=$("#detailSheet");if(!panel||!sheet)return;
  const stay=stayForDay(day),hotel=selectedHotel(stay),flight=flightForDay(day),selectedF=selectedFlight(flight),conflicts=dayConflicts(day),note=shared.dayNotes?.[day.id]||"";
  const places=day.places||[]; const directions=hotel?googleDirections(hotel.name,places):null;
  sheet.innerHTML=`<div class="sheet-handle"></div><div class="sheet-head"><div><div class="eyebrow">${fmtDate(day.scheduledDate,{weekday:"long",day:"numeric",month:"long"})}${day.scheduledDate!==day.originalDate?` · moved from ${fmtDate(day.originalDate,{day:"numeric",month:"short"})}`:""}</div><h2>${esc(day.title)}</h2><div class="muted tiny">${esc(day.location)}, ${esc(day.country)} · ${esc(day.companions||"")}</div></div><button class="ghost-button small" data-close-detail>Close</button></div>${conflicts.length?`<div class="alert warn" style="margin-top:12px"><span class="alert-dot">⚠</span><div>${conflicts.map(esc).join("<br>")}</div></div>`:""}<div class="card hero-card" style="margin-top:14px"><div class="eyebrow">Anchor</div><div class="lead">${esc(day.anchor)}</div>${hotel?`<div class="day-extra"><span class="chip green">⌂ Base: ${esc(hotel.name)}</span></div>`:""}${selectedF?`<div class="day-extra"><span class="chip gold">✈ ${esc(selectedF.label)}</span></div>`:""}<div class="route-action-row">${directions?`<a class="solid-button small" href="${directions}" target="_blank" rel="noopener">Day route in Google Maps ↗</a>`:""}<button class="ghost-button small" data-show-day-map="${day.id}">Map city</button></div><div id="detailWeather"></div></div>${timelineHTML("Morning",day.morning)}${timelineHTML("Afternoon",day.afternoon)}${timelineHTML("Evening",day.evening)}${timelineHTML("Eat",day.eat)}${timelineHTML("Logistics",day.logistics)}${day.watchOut?`<div class="alert info"><span class="alert-dot">i</span><div><strong>Worth knowing</strong><br>${esc(day.watchOut)}</div></div>`:""}<div class="detail-block"><h4>Sleep</h4><div class="timeline-items">${hotel?esc(hotel.name):esc(day.sleep||"Not set")}</div></div>${places.length?`<div class="detail-block"><h4>Places</h4><div class="day-extra">${places.map(p=>`<a class="chip" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p)}" target="_blank" rel="noopener">${esc(p)} ↗</a>`).join("")}</div></div>`:""}<div class="detail-block"><h4>Shared note</h4>${ownerMode?`<textarea id="dayNoteEdit" class="text-area" placeholder="Add a note everyone on the trip will see…">${esc(note)}</textarea>`:`<div class="timeline-items">${note?esc(note):'<span class="muted">No shared note.</span>'}</div>`}</div>`;
  $("[data-close-detail]",sheet).onclick=closeDay;
  $("[data-show-day-map]",sheet)?.addEventListener("click",()=>{closeDay();switchTab("map");setTimeout(()=>initMap(day.id),40);});
  const noteEdit=$("#dayNoteEdit",sheet);if(noteEdit)noteEdit.addEventListener("input",()=>{shared.dayNotes[day.id]=noteEdit.value;scheduleSave({quiet:true});});
  const weatherTarget=$("#detailWeather",sheet);if(weatherTarget)loadWeather(day,weatherTarget);
  if(show){panel.classList.add("open");panel.setAttribute("aria-hidden","false");}
}
function timelineHTML(label,items){if(!items?.length)return"";return `<div class="detail-block"><h4>${label}</h4><div class="timeline-items">${items.map(i=>`<div>• ${esc(i)}</div>`).join("")}</div></div>`;}
function closeDay(){activeDayId=null;const p=$("#detailPanel");p?.classList.remove("open");p?.setAttribute("aria-hidden","true");}
function googleDirections(hotel,places){const pts=(places||[]).slice(0,7);if(!hotel||!pts.length)return null;const origin=encodeURIComponent(hotel);const dest=encodeURIComponent(hotel);const waypoints=encodeURIComponent(pts.join("|"));return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&waypoints=${waypoints}&travelmode=driving`;}

function bindCommonActions(root) {
  $$('[data-open-day]',root).forEach(b=>b.addEventListener("click",()=>openDay(b.dataset.openDay)));
  $$('[data-open-map-day]',root).forEach(b=>b.addEventListener("click",()=>{switchTab("map");setTimeout(()=>initMap(b.dataset.openMapDay),50);}));
  $$('[data-go-plan]',root).forEach(b=>b.addEventListener("click",()=>switchTab("plan")));
  $$('[data-share]',root).forEach(b=>b.addEventListener("click",shareTrip));
  $$('[data-copy]',root).forEach(b=>b.addEventListener("click",copyLink));
  $$('[data-ack-alert]',root).forEach(b=>b.addEventListener("click",()=>{if(!ownerMode)return;shared.alertAck=true;saveShared(shared);}));
}

async function loadWeather(day,target){
  const key=`${day.lat},${day.lon},${day.scheduledDate}`;if(weatherCache.has(key)){target.innerHTML=weatherHTML(weatherCache.get(key));return;}
  const daysAhead=dayDiff(todayISO(),day.scheduledDate);if(daysAhead<0||daysAhead>15){target.innerHTML="";return;}
  try{const url=`https://api.open-meteo.com/v1/forecast?latitude=${day.lat}&longitude=${day.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${day.scheduledDate}&end_date=${day.scheduledDate}`;const w=await fetchJSON(url);const daily={code:w.daily?.weather_code?.[0],max:w.daily?.temperature_2m_max?.[0],min:w.daily?.temperature_2m_min?.[0],rain:w.daily?.precipitation_probability_max?.[0]};weatherCache.set(key,daily);target.innerHTML=weatherHTML(daily);}catch{target.innerHTML="";}
}
function weatherHTML(w){if(w.max==null)return"";const icon=w.code===0?"☀️":w.code<=3?"⛅":w.code<=67?"🌧️":w.code<=77?"❄️":"🌦️";return `<div class="weather-row"><div class="weather-icon">${icon}</div><div class="weather-copy"><strong>${Math.round(w.max)}° / ${Math.round(w.min)}°</strong><span>Forecast · rain chance ${w.rain??"–"}%</span></div></div>`;}
