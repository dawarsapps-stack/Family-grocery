"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fmtDate = (iso, opts = {}) => {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(date);
};
const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
};
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const todayISO = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};
const esc = (v = "") => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (v = "") => String(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const deepClone = obj => JSON.parse(JSON.stringify(obj));

const app = $("#app");
let data = null;
let shared = null;
let canonicalDays = [];
let map = null;
let mapLayer = null;
let activeTab = "today";
let activeDayId = null;
let ownerMode = false;
let adminPin = sessionStorage.getItem("trip-admin-pin") || "";
let saveTimer = null;
let lastSyncOk = true;
let weatherCache = new Map();

const FILTERS = { country: "all", from: "", to: "", q: "" };
const cityAliases = {
  "san pedro de atacama": "san pedro",
  "guatape": "medellin",
  "foz do iguacu": "foz do iguacu",
  "rio de janeiro": "rio de janeiro",
  "buenos aires": "buenos aires",
  "bolivian altiplano": "",
};

const defaultShared = () => ({
  revision: 0, updatedAt: null, selectedHotels: {}, selectedFlights: {}, customHotelOptions: {},
  customFlightOptions: {}, dayOrder: [], dayOverrides: {}, dayNotes: {}, bookingChecks: {}, prepChecks: {}, alertAck: false
});

function normalizeShared(raw) {
  return { ...defaultShared(), ...(raw || {}) };
}

function canonicalOrder() { return canonicalDays.map(d => d.id); }
function effectiveOrder() {
  const known = new Set(canonicalOrder());
  const requested = (shared.dayOrder || []).filter(id => known.has(id));
  const missing = canonicalOrder().filter(id => !requested.includes(id));
  return [...requested, ...missing];
}
function effectiveDays() {
  const lookup = new Map(canonicalDays.map(d => [d.id, d]));
  return effectiveOrder().map((id, idx) => {
    const base = lookup.get(id);
    const override = shared.dayOverrides?.[id] || {};
    return { ...base, ...override, scheduledDate: addDays(data.tripStart, idx), originalDate: base.date, orderIndex: idx };
  });
}

function stayForDay(day) {
  const loc = slug(day.location);
  const sleep = slug(day.sleep || "");
  return data.stays.find(stay => {
    const s = slug(stay.city);
    const alias = cityAliases[slug(day.location)] ? slug(cityAliases[slug(day.location)]) : loc;
    return loc.includes(s) || s.includes(loc) || alias.includes(s) || s.includes(alias) || sleep.includes(s);
  }) || null;
}

function hotelOptions(stay) {
  const canonical = stay?.options || [];
  const custom = shared.customHotelOptions?.[stay?.id] || [];
  return [...canonical, ...custom];
}
function selectedHotel(stay) {
  if (!stay) return null;
  const all = hotelOptions(stay);
  const id = shared.selectedHotels?.[stay.id];
  return all.find(h => h.id === id) || null;
}

function flightForDay(day) {
  return data.flights.find(f => f.date === day.originalDate) || null;
}
function flightOptions(flight) {
  if (!flight) return [];
  return [...(flight.options || []), ...(shared.customFlightOptions?.[flight.id] || [])];
}
function selectedFlight(flight) {
  if (!flight) return null;
  const id = shared.selectedFlights?.[flight.id] || "current";
  return flightOptions(flight).find(o => o.id === id) || flightOptions(flight)[0] || null;
}

function dayConflicts(day) {
  const issues = [];
  const flight = flightForDay(day);
  const fixed = flight && /VERIFIED|LOCKED|BOOK OPERATOR/i.test(flight.status || "");
  if (fixed && day.scheduledDate !== day.originalDate) {
    issues.push(`Fixed travel is recorded for ${fmtDate(day.originalDate, { day: "numeric", month: "short" })}.`);
  }
  if (day.originalDate !== day.scheduledDate && /LOCKED DATE/i.test(day.decision || "")) {
    issues.push(`This day was marked as date-locked on ${fmtDate(day.originalDate, { day: "numeric", month: "short" })}.`);
  }
  return issues;
}

function planningIssues() {
  const issues = [];
  const days = effectiveDays();
  days.forEach(d => dayConflicts(d).forEach(text => issues.push({ bad: true, text: `${d.title}: ${text}` })));
  data.stays.forEach(stay => {
    if (!shared.selectedHotels?.[stay.id]) issues.push({ text: `Hotel not chosen yet: ${stay.city} (${stay.dates}).` });
  });
  data.flights.forEach(f => {
    const opts = flightOptions(f);
    const selected = selectedFlight(f);
    if (!selected || /TARGET|RECONFIRM|TBD|BOOK OPERATOR/i.test(f.status || "")) {
      issues.push({ text: `Travel still needs confirming: ${f.route} · ${selected?.label || f.timing}.` });
    }
  });
  if (!issues.length) issues.push({ good: true, text: "No unresolved planning issues." });
  return issues;
}

function readinessScore() {
  const hotelTotal = data.stays.length || 1;
  const hotelDone = data.stays.filter(s => shared.selectedHotels?.[s.id]).length;
  const prepTotal = data.prep.length || 1;
  const prepDone = data.prep.filter(p => shared.prepChecks?.[p.id]).length;
  const bookingTotal = data.bookings.length || 1;
  const bookingDone = data.bookings.filter(b => shared.bookingChecks?.[b.id]).length;
  const conflicts = effectiveDays().reduce((n, d) => n + dayConflicts(d).length, 0);
  const raw = ((hotelDone / hotelTotal) * 35 + (prepDone / prepTotal) * 30 + (bookingDone / bookingTotal) * 35) - conflicts * 6;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function loadShared() {
  try {
    const s = await fetchJSON("/api/trip-state", { cache: "no-store" });
    localStorage.setItem("trip-shared-cache", JSON.stringify(s));
    lastSyncOk = true;
    return normalizeShared(s);
  } catch (err) {
    lastSyncOk = false;
    try { return normalizeShared(JSON.parse(localStorage.getItem("trip-shared-cache") || "null")); }
    catch { return defaultShared(); }
  }
}

async function saveShared(next, { quiet = false } = {}) {
  shared = normalizeShared(next);
  localStorage.setItem("trip-shared-cache", JSON.stringify(shared));
  renderAll();
  if (!adminPin) {
    if (!quiet) toast("Unlock owner editing before saving changes.", "bad");
    return false;
  }
  try {
    const saved = await fetchJSON("/api/trip-state", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-pin": adminPin },
      body: JSON.stringify(shared)
    });
    shared = normalizeShared(saved);
    localStorage.setItem("trip-shared-cache", JSON.stringify(shared));
    lastSyncOk = true;
    updateSyncIndicators();
    if (!quiet) toast("Shared with the trip group ✓");
    return true;
  } catch (err) {
    lastSyncOk = false;
    updateSyncIndicators();
    if (/Incorrect owner PIN/i.test(err.message)) {
      ownerMode = false;
      adminPin = "";
      sessionStorage.removeItem("trip-admin-pin");
    }
    if (!quiet) toast(`Could not sync: ${err.message}`, "bad");
    return false;
  }
}

function scheduleSave({ quiet = true } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveShared(shared, { quiet }), 500);
}

function toast(message, kind = "good") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function updateSyncIndicators() {
  $$(".sync-dot").forEach(el => {
    el.classList.toggle("good", lastSyncOk);
    el.classList.toggle("bad", !lastSyncOk);
  });
  $$('[data-sync-text]').forEach(el => {
    el.textContent = lastSyncOk ? "Shared plan synced" : "Offline · showing last saved plan";
  });
}

function icons(name) {
  const map = { today: "☀", itinerary: "▤", map: "⌖", travel: "✈", plan: "✓" };
  return map[name] || "•";
}

function shellHTML() {
  const tripDays = canonicalDays.length;
  const countries = [...new Set(canonicalDays.map(d => d.country).filter(c => c !== "United Kingdom"))];
  return `
    <header class="topbar">
      <div class="brand-row">
        <div>
          <div class="brand-kicker">Shared trip companion</div>
          <h1 class="brand-title">South America 2026</h1>
          <div class="brand-sub">${esc(data.routeSummary)} · ${fmtDate(data.tripStart,{day:"numeric",month:"short"})}–${fmtDate(data.tripEnd,{day:"numeric",month:"short",year:"numeric"})}</div>
        </div>
        <div class="top-actions">
          <button class="icon-button" id="shareBtn" title="Share trip"><span>↗</span><span class="action-label">Share</span></button>
          <button class="icon-button" id="ownerBtn" title="Owner editing">✎</button>
        </div>
      </div>
      <div class="owner-pill ${ownerMode ? "editing" : ""}" id="ownerStatus"><span class="sync-dot ${lastSyncOk ? "good" : "bad"}"></span><span data-sync-text>${lastSyncOk ? "Shared plan synced" : "Offline · showing last saved plan"}</span>${ownerMode ? " · Owner editing on" : " · Everyone can view"}</div>
    </header>
    <main class="main">
      <section class="summary-grid">
        <div class="stat"><strong>${tripDays}</strong><span>days</span></div>
        <div class="stat"><strong>${countries.length}</strong><span>countries</span></div>
        <div class="stat"><strong>${data.stays.length}</strong><span>stays</span></div>
        <div class="stat"><strong>${data.flights.length}</strong><span>travel legs</span></div>
      </section>
      <section id="view-today" class="view active"></section>
      <section id="view-itinerary" class="view"></section>
      <section id="view-map" class="view"></section>
      <section id="view-travel" class="view"></section>
      <section id="view-plan" class="view"></section>
    </main>
    <nav class="bottom-nav" aria-label="Trip sections">
      <div class="bottom-nav-inner">
        ${["today","itinerary","map","travel","plan"].map(id => `<button class="nav-btn ${id===activeTab?"active":""}" data-tab="${id}"><span class="nav-ico">${icons(id)}</span><span>${id[0].toUpperCase()+id.slice(1)}</span></button>`).join("")}
      </div>
    </nav>
    <div id="detailPanel" class="detail-panel" aria-hidden="true"><div id="detailSheet" class="detail-sheet"></div></div>
    <div id="ownerModal" class="modal" aria-hidden="true"></div>
    <div id="toast" class="toast"></div>`;
}

function renderAll() {
  if (!data || !shared) return;
  renderToday();
  renderItinerary();
  renderTravel();
  renderPlan();
  renderMapView();
  updateOwnerUI();
  updateSyncIndicators();
  if (activeDayId) openDay(activeDayId, false);
}
