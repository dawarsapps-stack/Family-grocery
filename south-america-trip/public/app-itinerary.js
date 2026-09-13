function renderToday() {
  const el = $("#view-today"); if (!el) return;
  const now = todayISO();
  const days = effectiveDays();
  let day = days.find(d => d.scheduledDate === now);
  const before = now < data.tripStart;
  const after = now > addDays(data.tripStart, days.length - 1);
  if (!day) day = before ? days[0] : after ? days[days.length - 1] : days.find(d => d.scheduledDate > now) || days[0];
  const idx = days.findIndex(d => d.id === day.id);
  const stay = stayForDay(day), hotel = selectedHotel(stay), flight = flightForDay(day), selectedF = selectedFlight(flight);
  const countdown = before ? dayDiff(now, data.tripStart) : null;
  const localTime = (() => { try { return new Intl.DateTimeFormat("en-GB", { hour:"2-digit", minute:"2-digit", timeZone: day.timeZone }).format(new Date()); } catch { return ""; } })();
  const conflicts = dayConflicts(day);
  const header = before ? `${countdown} day${countdown===1?"":"s"} to go` : after ? "Trip complete" : `Day ${idx+1} of ${days.length}`;
  const critical = data.criticalAlert && !shared.alertAck ? `<div class="alert warn"><span class="alert-dot">⚠</span><div><strong>Critical connection</strong><br>${esc(data.criticalAlert)}${ownerMode?`<div style="margin-top:8px"><button class="ghost-button small" data-ack-alert>Acknowledge</button></div>`:""}</div></div>` : "";
  el.innerHTML = `
    ${critical}
    <div class="quick-grid">
      <div class="card hero-card">
        <div class="eyebrow">${header} · ${fmtDate(day.scheduledDate,{weekday:"short",day:"numeric",month:"short"})}</div>
        <h3>${esc(day.title)}</h3>
        <div class="lead">${esc(day.anchor)}</div>
        <div class="today-time"><span class="chip">📍 ${esc(day.location)}</span>${localTime?`<span class="chip">◷ ${esc(localTime)} local</span>`:""}${hotel?`<span class="chip green">⌂ ${esc(hotel.name)}</span>`:""}${selectedF?`<span class="chip gold">✈ ${esc(selectedF.mode||flight.mode)}</span>`:""}</div>
        ${conflicts.length?`<div class="alert warn" style="margin-top:12px"><span class="alert-dot">⚠</span><div>${conflicts.map(esc).join("<br>")}</div></div>`:""}
        <div class="route-action-row"><button class="solid-button" data-open-day="${day.id}">Open full day</button><button class="ghost-button" data-open-map-day="${day.id}">Show on map</button></div>
        <div id="todayWeather"></div>
      </div>
      <div class="card">
        <div class="eyebrow">Next up</div>
        ${days.slice(idx+1,idx+4).map(n=>`<button class="ghost-button" style="width:100%;justify-content:flex-start;margin-top:7px;text-align:left" data-open-day="${n.id}"><strong style="min-width:54px">${fmtDate(n.scheduledDate,{day:"numeric",month:"short"})}</strong><span>${esc(n.title)}</span></button>`).join("") || `<div class="muted tiny">No more scheduled days.</div>`}
        <div class="divider"></div>
        <div class="eyebrow">Planning health</div>
        <div class="health-score"><div class="score-ring" style="--score:${readinessScore()}%"><strong>${readinessScore()}</strong></div><div><strong>${planningIssues().filter(i=>!i.good).length}</strong><div class="muted tiny">items still need attention</div><button class="ghost-button small" style="margin-top:7px" data-go-plan>Open plan</button></div></div>
      </div>
    </div>`;
  bindCommonActions(el);
  const weatherTarget = $("#todayWeather");
  if (weatherTarget && !after) loadWeather(day, weatherTarget);
}

function filteredDays() {
  const q = FILTERS.q.trim().toLowerCase();
  return effectiveDays().filter(day => {
    const country = FILTERS.country === "all" || day.country === FILTERS.country;
    const from = !FILTERS.from || day.scheduledDate >= FILTERS.from;
    const to = !FILTERS.to || day.scheduledDate <= FILTERS.to;
    const text = [day.title,day.location,day.country,day.anchor,day.intro,(day.places||[]).join(" ")].join(" ").toLowerCase();
    return country && from && to && (!q || text.includes(q));
  });
}

function renderItinerary() {
  const el = $("#view-itinerary"); if (!el) return;
  const countries = [...new Set(effectiveDays().map(d=>d.country))];
  const days = filteredDays();
  el.innerHTML = `
    <div class="section-head"><div><h2>Itinerary</h2><p>Filter the trip, open any day, and ${ownerMode?"move plans between dates":"see the live shared order"}.</p></div>${ownerMode?`<button class="ghost-button small" data-reset-order>Reset order</button>`:""}</div>
    <div class="filters">
      <div class="control country"><label>Country</label><select id="countryFilter"><option value="all">All countries</option>${countries.map(c=>`<option ${FILTERS.country===c?"selected":""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="control"><label>From</label><input type="date" id="fromFilter" value="${esc(FILTERS.from)}"></div>
      <div class="control"><label>To</label><input type="date" id="toFilter" value="${esc(FILTERS.to)}"></div>
      <div class="control search filter-search"><label>Search</label><input type="search" id="searchFilter" placeholder="Place, activity, city…" value="${esc(FILTERS.q)}"></div>
      <button class="ghost-button small filter-reset" id="clearFilters">Clear</button>
    </div>
    <div class="itinerary-list">${days.length?days.map(dayCardHTML).join(""):`<div class="empty">No days match those filters.</div>`}</div>`;
  $("#countryFilter",el)?.addEventListener("change",e=>{FILTERS.country=e.target.value;renderItinerary();renderMapView();});
  $("#fromFilter",el)?.addEventListener("change",e=>{FILTERS.from=e.target.value;renderItinerary();renderMapView();});
  $("#toFilter",el)?.addEventListener("change",e=>{FILTERS.to=e.target.value;renderItinerary();renderMapView();});
  $("#searchFilter",el)?.addEventListener("input",e=>{FILTERS.q=e.target.value;clearTimeout(renderItinerary._q);renderItinerary._q=setTimeout(()=>{renderItinerary();renderMapView();},220);});
  $("#clearFilters",el)?.addEventListener("click",()=>{Object.assign(FILTERS,{country:"all",from:"",to:"",q:""});renderItinerary();renderMapView();});
  $("[data-reset-order]",el)?.addEventListener("click",()=>{shared.dayOrder=[];saveShared(shared);});
  bindCommonActions(el);
  $$('[data-move]',el).forEach(btn=>btn.addEventListener("click",()=>moveDay(btn.dataset.dayId,Number(btn.dataset.move))));
}

function dayCardHTML(day) {
  const stay = stayForDay(day), hotel = selectedHotel(stay), flight=flightForDay(day), selectedF=selectedFlight(flight), conflicts=dayConflicts(day);
  const moved = day.scheduledDate !== day.originalDate;
  return `<article class="day-card ${conflicts.length?"has-conflict":""}" data-day-card="${day.id}">
    <button class="date-box" data-open-day="${day.id}" aria-label="Open ${esc(day.title)}"><div class="dow">${fmtDate(day.scheduledDate,{weekday:"short"}).toUpperCase()}</div><div class="daynum">${fmtDate(day.scheduledDate,{day:"numeric"})}</div><div class="month">${fmtDate(day.scheduledDate,{month:"short"})}</div></button>
    <div class="day-main">
      <div class="day-title-row"><h3>${esc(day.title)}</h3>${moved?`<span class="chip red">Moved from ${fmtDate(day.originalDate,{day:"numeric",month:"short"})}</span>`:""}${conflicts.length?`<span class="chip red">⚠ clash</span>`:""}</div>
      <div class="day-meta">📍 ${esc(day.location)}, ${esc(day.country)} · ${esc(day.companions||"")}</div>
      <div class="day-anchor">${esc(day.anchor)}</div>
      <div class="day-extra">${hotel?`<span class="chip green">⌂ ${esc(hotel.name)}</span>`:stay?`<span class="chip">⌂ Hotel not chosen</span>`:""}${selectedF?`<span class="chip gold">✈ ${esc(selectedF.label)}</span>`:""}${day.decision?`<span class="chip red">! ${esc(day.decision)}</span>`:""}</div>
    </div>
    <div class="day-actions"><button data-open-day="${day.id}" title="Open day">›</button>${ownerMode?`<button data-move="-1" data-day-id="${day.id}" ${day.orderIndex===0?"disabled":""} title="Move earlier">↑</button><button data-move="1" data-day-id="${day.id}" ${day.orderIndex===effectiveDays().length-1?"disabled":""} title="Move later">↓</button><div class="move-hint">MOVE</div>`:""}</div>
  </article>`;
}

function moveDay(dayId, delta) {
  if (!ownerMode) return;
  const order = effectiveOrder(); const i = order.indexOf(dayId); const j=i+delta;
  if (i<0||j<0||j>=order.length) return;
  [order[i],order[j]]=[order[j],order[i]]; shared.dayOrder=order; saveShared(shared);
}
