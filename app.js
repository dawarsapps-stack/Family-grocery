(() => {
  "use strict";

  const API = "/api/data";
  const PHOTO_API = "/api/photo";
  const NAME_KEY = "oakdene_name";
  const LEGACY_NAME_KEY = "larder_name";
  const CACHE_KEY = "oakdene_state_v2";
  const QUEUE_KEY = "oakdene_mutations_v2";
  const POLL_MS = 8000;
  const DAY = 86400000;

  const STORES = ["Tesco", "Sainsbury's", "Waitrose", "Ocado", "Asda", "Morrisons", "Aldi", "Lidl", "Co-op", "M&S", "Other", "Not recorded"];
  const RETAILERS = [
    ["Tesco", q => `https://www.tesco.com/groceries/en-GB/search?query=${encodeURIComponent(q)}`],
    ["Sainsbury's", q => `https://www.sainsburys.co.uk/gol-ui/SearchResults/${encodeURIComponent(q)}`],
    ["Waitrose", q => `https://www.waitrose.com/ecom/shop/search?searchTerm=${encodeURIComponent(q)}`],
    ["Ocado", q => `https://www.ocado.com/search?entry=${encodeURIComponent(q)}`],
    ["Asda", q => `https://www.asda.com/groceries/search/${encodeURIComponent(q)}`],
    ["Morrisons", q => `https://groceries.morrisons.com/search?entry=${encodeURIComponent(q)}`],
    ["Aldi", q => `https://www.aldi.co.uk/results?q=${encodeURIComponent(q)}`],
    ["Co-op", q => `https://www.coop.co.uk/products/search?text=${encodeURIComponent(q)}`],
  ];

  let state = loadJSON(CACHE_KEY, { version: 2, items: [] });
  let queue = loadJSON(QUEUE_KEY, []);
  let flushing = false;
  let currentView = "shop";
  let currentItemId = null;
  let homeFilter = "all";
  let shopSmartOrder = true;
  let toastTimer = null;
  let purchasePhotoFile = null;
  let homePhotoFile = null;

  const $ = id => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

  function uid(prefix = "x") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function persist() {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function myName() {
    return localStorage.getItem(NAME_KEY) || localStorage.getItem(LEGACY_NAME_KEY) || "";
  }

  function setMyName(name) {
    localStorage.setItem(NAME_KEY, name);
    localStorage.removeItem(LEGACY_NAME_KEY);
    renderProfile();
  }

  function esc(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function cleanName(value = "") {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function normalizeName(value = "") {
    return String(value)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|grams?|l|litres?|liters?|ml|cl|oz|lb|pack|pk)\b/g, " ")
      .replace(/\b(the|a|an|some|fresh|organic|large|small|medium|packets?|packet|packs?|bottles?|bottle)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stem(token) {
    if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
    if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
    if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
    return token;
  }

  function nameScore(a, b) {
    const na = normalizeName(a), nb = normalizeName(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if ((na.includes(nb) || nb.includes(na)) && Math.min(na.length, nb.length) >= 4) return 0.84;
    const A = new Set(na.split(" ").filter(Boolean).map(stem));
    const B = new Set(nb.split(" ").filter(Boolean).map(stem));
    let overlap = 0;
    A.forEach(x => { if (B.has(x)) overlap += 1; });
    const union = new Set([...A, ...B]).size || 1;
    const jaccard = overlap / union;
    const containment = overlap / Math.max(1, Math.min(A.size, B.size));
    return Math.max(jaccard, containment * 0.82);
  }

  function findBestMatch(name, threshold = 0.58) {
    let best = null;
    for (const item of state.items || []) {
      const score = nameScore(name, item.name);
      if (score >= threshold && (!best || score > best.score)) best = { item, score };
    }
    return best;
  }

  function inferCategory(name) {
    const n = normalizeName(name);
    const groups = [
      ["Fruit & veg", ["apple","banana","orange","lemon","lime","grape","berry","strawberry","blueberry","raspberry","pear","peach","plum","melon","mango","avocado","tomato","potato","onion","garlic","carrot","pepper","broccoli","spinach","lettuce","cucumber","courgette","mushroom","ginger","herb","coriander","parsley"]],
      ["Dairy & eggs", ["milk","cheese","yoghurt","yogurt","butter","cream","egg","halloumi","mozzarella","parmesan"]],
      ["Meat & fish", ["chicken","beef","lamb","pork","steak","mince","bacon","ham","salmon","fish","prawn","sausage","turkey"]],
      ["Bakery", ["bread","bagel","croissant","roll","wrap","pitta","naan","cake","brioche"]],
      ["Drinks", ["water","juice","cola","coke","lemonade","wine","beer","coffee","tea","tonic","squash"]],
      ["Frozen", ["frozen","ice cream","pizza","peas","chips"]],
      ["Household", ["tablet","detergent","washing","dishwasher","bleach","cleaner","toilet","tissue","kitchen roll","foil","bin bag","soap","shampoo"]],
      ["Pantry", ["rice","pasta","flour","sugar","salt","oil","sauce","beans","tin","cereal","oats","jam","honey","spice","lentil","chickpea"]],
    ];
    for (const [category, words] of groups) if (words.some(w => n.includes(w))) return category;
    return "Other";
  }

  function categoryIcon(category) {
    return ({
      "Fruit & veg":"◒", "Dairy & eggs":"◌", "Meat & fish":"◇", "Bakery":"◫", "Drinks":"◍", "Frozen":"✣", "Household":"⌂", "Pantry":"◈", "Other":"•"
    })[category] || "•";
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }

  function parseLocalDate(iso) {
    if (!iso) return null;
    const [y,m,d] = iso.split("-").map(Number);
    return new Date(y, (m || 1)-1, d || 1, 12, 0, 0);
  }

  function daysUntil(iso) {
    const d = parseLocalDate(iso);
    if (!d) return null;
    const today = parseLocalDate(todayISO());
    return Math.round((d - today) / DAY);
  }

  function expiryLabel(iso) {
    if (!iso) return { text: "No expiry set", tone: "" };
    const days = daysUntil(iso);
    if (days < 0) return { text: days === -1 ? "Expired yesterday" : `Expired ${Math.abs(days)}d ago`, tone: "bad" };
    if (days === 0) return { text: "Expires today", tone: "bad" };
    if (days === 1) return { text: "Expires tomorrow", tone: "warn" };
    if (days <= 3) return { text: `Expires in ${days} days`, tone: "warn" };
    if (days <= 10) return { text: `Expires in ${days} days`, tone: "good" };
    return { text: `Best before ${formatDate(iso)}`, tone: "" };
  }

  function formatDate(value, opts = { day: "numeric", month: "short" }) {
    if (!value) return "";
    const date = typeof value === "number" ? new Date(value) : parseLocalDate(value);
    if (!date || Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, opts);
  }

  function timeAgo(ts) {
    if (!ts) return "";
    const diff = Date.now() - Number(ts);
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.max(1, Math.round(diff/60000))}m ago`;
    if (diff < DAY) return `${Math.round(diff/3600000)}h ago`;
    if (diff < 2*DAY) return "yesterday";
    if (diff < 14*DAY) return `${Math.round(diff/DAY)}d ago`;
    return new Date(Number(ts)).toLocaleDateString(undefined,{day:"numeric",month:"short"});
  }

  function usableLots(item) {
    return (item.inventory || []).filter(lot => !lot.expiryDate || daysUntil(lot.expiryDate) >= 0);
  }

  function expiredLots(item) {
    return (item.inventory || []).filter(lot => lot.expiryDate && daysUntil(lot.expiryDate) < 0);
  }

  function totalQty(lots) {
    const vals = (lots || []).map(l => Number(l.quantity)).filter(Number.isFinite);
    return vals.length ? vals.reduce((a,b)=>a+b,0) : null;
  }

  function inventorySummary(item, onlyUsable = false) {
    const lots = onlyUsable ? usableLots(item) : (item.inventory || []);
    if (!lots.length) return null;
    const unitGroups = new Map();
    lots.forEach(lot => {
      const unit = lot.unit || "item";
      const qty = Number(lot.quantity);
      if (Number.isFinite(qty)) unitGroups.set(unit, (unitGroups.get(unit) || 0) + qty);
    });
    if (unitGroups.size === 1) {
      const [[unit, qty]] = [...unitGroups.entries()];
      const prettyUnit = qty === 1 ? unit : pluralUnit(unit);
      return `${trimNumber(qty)} ${prettyUnit}`;
    }
    return `${lots.length} ${lots.length === 1 ? "lot" : "lots"}`;
  }

  function pluralUnit(unit) {
    const map = { item:"items", pack:"packs", bottle:"bottles", tin:"tins", bag:"bags", kg:"kg", g:"g", litre:"litres", ml:"ml" };
    return map[unit] || `${unit}s`;
  }

  function trimNumber(n) {
    return Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1).replace(/\.0$/,"");
  }

  function latestPurchase(item) {
    return [...(item.purchaseHistory || [])].sort((a,b)=>(b.date||0)-(a.date||0))[0] || null;
  }

  function latestPrices(item) {
    const rows = [...(item.priceHistory || [])].sort((a,b)=>(b.at||0)-(a.at||0));
    const seen = new Set();
    return rows.filter(row => {
      if (!row.store || row.store === "Not recorded" || seen.has(row.store)) return false;
      seen.add(row.store); return Number.isFinite(Number(row.price));
    });
  }

  function bestPrice(item) {
    const rows = latestPrices(item);
    if (!rows.length) return null;
    return rows.reduce((best,row)=> Number(row.price) < Number(best.price) ? row : best, rows[0]);
  }

  function latestExpiry(item) {
    const lots = (item.inventory || []).filter(l => l.expiryDate).sort((a,b)=>daysUntil(a.expiryDate)-daysUntil(b.expiryDate));
    return lots[0] || null;
  }

  function photoURL(item) {
    if (!item.photoKey) return null;
    return `${PHOTO_API}?id=${encodeURIComponent(item.photoKey)}&v=${encodeURIComponent(item.updatedAt || 0)}`;
  }

  function makeProduct(name, needed = true) {
    const now = Date.now();
    return {
      id: uid("product"),
      name: cleanName(name),
      normalizedName: normalizeName(name),
      category: inferCategory(name),
      needed,
      addedBy: myName(),
      addedAt: now,
      updatedAt: now,
      inventory: [], purchaseHistory: [], priceHistory: [], comments: [], photoKey: null,
    };
  }

  function makeLot({ quantity = 1, unit = "item", expiryDate = null, store = null, price = null }) {
    return {
      id: uid("lot"), quantity: quantity === "" ? null : Number(quantity), unit,
      expiryDate: expiryDate || null, store: store && store !== "Not recorded" ? store : null,
      price: price === "" || price === null ? null : Number(price),
      purchasedAt: Date.now(), addedAt: Date.now(), by: myName()
    };
  }

  function applyMutation(target, mutation) {
    const p = mutation.payload || {};
    const actor = mutation.actor || myName() || "someone";
    const now = mutation.at || Date.now();
    target.items = Array.isArray(target.items) ? target.items : [];
    const find = id => target.items.find(x => x.id === id);
    let item;
    switch (mutation.type) {
      case "addProduct":
        if (p.product && !find(p.product.id)) target.items.unshift(structuredCloneSafe(p.product));
        break;
      case "updateProduct":
        item = find(p.itemId); if (!item) break;
        Object.assign(item, p.patch || {}); if (p.patch?.name) item.normalizedName = normalizeName(p.patch.name); item.updatedAt = now; break;
      case "setNeeded":
        item = find(p.itemId); if (!item) break;
        item.needed = Boolean(p.needed); if (item.needed) { item.addedBy = actor; item.addedAt = now; } item.updatedAt = now; break;
      case "purchase":
        item = find(p.itemId); if (!item) break;
        item.inventory = item.inventory || []; item.inventory.unshift(structuredCloneSafe(p.lot)); item.needed = false;
        item.purchaseHistory = item.purchaseHistory || []; item.purchaseHistory.unshift(structuredCloneSafe(p.purchase));
        if (p.lot?.store && p.lot?.price !== null && p.lot?.price !== "" && Number.isFinite(Number(p.lot.price))) {
          item.priceHistory = item.priceHistory || [];
          item.priceHistory.unshift({ id:uid("price"), store:p.lot.store, price:Number(p.lot.price), size:p.lot.size||null, at:now, by:actor, source:"purchase" });
        }
        item.updatedAt = now; break;
      case "addExisting":
        if (p.product && !find(p.product.id)) target.items.unshift(structuredCloneSafe(p.product));
        item = find(p.itemId || p.product?.id); if (!item) break;
        item.inventory = item.inventory || []; item.inventory.unshift(structuredCloneSafe(p.lot));
        item.purchaseHistory = item.purchaseHistory || [];
        item.purchaseHistory.unshift({ id:uid("purchase"), date:p.lot?.purchasedAt||now, by:actor, store:p.lot?.store||null, price:p.lot?.price??null, quantity:p.lot?.quantity??null, unit:p.lot?.unit||null, source:"existing" });
        item.updatedAt = now; break;
      case "updateLot":
        item = find(p.itemId); if (!item) break;
        { const lot = (item.inventory || []).find(x => x.id === p.lotId); if (lot) Object.assign(lot, p.patch || {}); }
        item.updatedAt = now; break;
      case "removeLot":
        item = find(p.itemId); if (!item) break;
        item.inventory = (item.inventory || []).filter(x => x.id !== p.lotId); item.updatedAt = now; break;
      case "addPrice":
        item = find(p.itemId); if (!item) break;
        item.priceHistory = item.priceHistory || []; item.priceHistory.unshift(structuredCloneSafe(p.record)); item.updatedAt = now; break;
      case "addComment":
        item = find(p.itemId); if (!item) break;
        item.comments = item.comments || []; if (!item.comments.some(c => c.id === p.comment.id)) item.comments.push(structuredCloneSafe(p.comment)); item.updatedAt = now; break;
      case "deleteProduct":
        target.items = target.items.filter(x => x.id !== p.itemId); break;
    }
    target.version = 2; target.updatedAt = now;
    return target;
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeMutation(type, payload) {
    return { id: uid("m"), type, payload, actor: myName() || "someone", at: Date.now() };
  }

  function mutate(type, payload) {
    const mutation = makeMutation(type, payload);
    applyMutation(state, mutation);
    queue.push(mutation);
    persist();
    renderAll();
    flushQueue();
    return mutation;
  }

  async function flushQueue() {
    if (flushing || !queue.length || !navigator.onLine) return;
    flushing = true;
    showSync("Saving…", false, true);
    try {
      while (queue.length && navigator.onLine) {
        const mutation = queue[0];
        const res = await fetch(API, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(mutation) });
        if (!res.ok) throw new Error(`Save failed ${res.status}`);
        const serverState = await res.json();
        queue.shift();
        state = serverState;
        for (const pending of queue) applyMutation(state, pending);
        persist();
      }
      showSync("Synced", false, true);
      renderAll();
    } catch (error) {
      console.error(error);
      showSync(navigator.onLine ? "Save retrying" : "Offline", true, true);
    } finally {
      flushing = false;
    }
  }

  async function fetchState() {
    try {
      const res = await fetch(API, { cache:"no-store" });
      if (!res.ok) throw new Error("Fetch failed");
      const serverState = await res.json();
      state = serverState;
      for (const pending of queue) applyMutation(state, pending);
      persist();
      renderAll();
      showSync(queue.length ? "Saving…" : "Synced", false, true);
      if (queue.length) flushQueue();
    } catch (error) {
      console.warn(error);
      showSync("Offline", true, true);
    }
  }

  function showSync(text, offline = false, flash = false) {
    const el = $("syncPill");
    el.textContent = text;
    el.classList.toggle("offline", offline);
    el.classList.toggle("show", offline || flash);
    if (!offline && flash) setTimeout(() => el.classList.remove("show"), 1300);
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function renderProfile() {
    const name = myName();
    $("profileName").textContent = name || "Who are you?";
    $("avatarInitial").textContent = name ? name.slice(0,1).toUpperCase() : "?";
  }

  function renderAll() {
    renderProfile();
    renderShop();
    renderHome();
    renderHistory();
    renderSmartStrip();
    renderBadges();
    if (currentItemId && $("itemDialog").open) {
      const item = state.items.find(x => x.id === currentItemId);
      if (item) renderItemSheet(item); else $("itemDialog").close();
    }
  }

  function renderBadges() {
    const needed = (state.items || []).filter(i => i.needed).length;
    $("shopBadge").textContent = needed;
    $("shopBadge").hidden = !needed;
    const soon = (state.items || []).flatMap(i => i.inventory || []).filter(l => l.expiryDate && daysUntil(l.expiryDate) <= 3).length;
    $("expiryBadge").textContent = soon;
    $("expiryBadge").hidden = !soon;
  }

  function renderSmartStrip() {
    const duplicate = (state.items || []).filter(i => i.needed && usableLots(i).length).length;
    const soon = (state.items || []).flatMap(i => i.inventory || []).filter(l => l.expiryDate && daysUntil(l.expiryDate) >= 0 && daysUntil(l.expiryDate) <= 3).length;
    const expired = (state.items || []).flatMap(i => i.inventory || []).filter(l => l.expiryDate && daysUntil(l.expiryDate) < 0).length;
    const strip = $("smartStrip");
    if (!duplicate && !soon && !expired) { strip.hidden = true; return; }
    const parts = [];
    if (duplicate) parts.push(`<strong>${duplicate}</strong> ${duplicate === 1 ? "list item is" : "list items are"} already at home`);
    if (soon) parts.push(`<strong>${soon}</strong> expiring soon`);
    if (expired) parts.push(`<strong>${expired}</strong> expired`);
    strip.innerHTML = `Oakdene check: ${parts.join(" · ")} <button type="button" data-smart-home>Review</button>`;
    strip.hidden = false;
    qs("[data-smart-home]", strip)?.addEventListener("click", () => switchView("home"));
  }

  function productMeta(item, context) {
    const chips = [];
    const usable = usableLots(item);
    if (context === "shop" && usable.length) chips.push(`<span class="meta-chip warn">⌂ ${esc(inventorySummary(item,true) || "At home")}</span>`);
    if (context !== "shop" && item.needed) chips.push(`<span class="meta-chip warn">On list</span>`);
    if (context === "home") {
      const lot = latestExpiry(item);
      if (lot) { const e = expiryLabel(lot.expiryDate); chips.push(`<span class="meta-chip ${e.tone}">${esc(e.text)}</span>`); }
      else chips.push(`<span class="meta-chip">No expiry set</span>`);
    }
    if (context === "history") {
      const purchase = latestPurchase(item);
      if (purchase) chips.push(`<span>${purchase.store ? esc(purchase.store) + " · " : ""}${esc(timeAgo(purchase.date))}</span>`);
      if (usable.length) chips.push(`<span class="meta-chip good">⌂ at home</span>`);
    }
    const best = bestPrice(item);
    if (best && context !== "home") chips.push(`<span>from £${Number(best.price).toFixed(2)}</span>`);
    if ((item.comments || []).length) chips.push(`<span>💬 ${(item.comments || []).length}</span>`);
    return chips.join("");
  }

  function thumbHTML(item) {
    const url = photoURL(item);
    if (url) return `<div class="product-thumb"><img src="${esc(url)}" alt="" loading="lazy" /></div>`;
    return `<div class="product-thumb">${esc(categoryIcon(item.category))}</div>`;
  }

  function productCardHTML(item, context) {
    const usable = usableLots(item);
    const duplicate = context === "shop" && usable.length;
    const historyClass = context === "history" ? " history-card" : "";
    const buy = context === "shop" ? `<button class="buy-check" type="button" data-action="bought" data-id="${esc(item.id)}" aria-label="Mark ${esc(item.name)} bought">✓</button>` : "";
    const side = context === "history"
      ? `<button class="history-add" type="button" data-action="need" data-id="${esc(item.id)}">${item.needed ? "On list" : "Need again"}</button>`
      : `<div class="card-actions"><button class="small-icon-btn price" type="button" data-action="price" data-id="${esc(item.id)}" aria-label="Prices">£</button><button class="card-chevron" type="button" data-action="open" data-id="${esc(item.id)}" aria-label="Open details">›</button></div>`;
    return `<article class="product-card${historyClass}" data-card-id="${esc(item.id)}">
      <div class="product-row" data-action="open" data-id="${esc(item.id)}">
        ${buy}${thumbHTML(item)}
        <div class="product-info"><div class="product-name">${esc(item.name)}</div><div class="product-meta">${productMeta(item,context)}</div></div>
        ${side}
      </div>
      ${duplicate ? `<div class="duplicate-warning"><span>Oakdene thinks you still have ${esc(inventorySummary(item,true) || "some")} at home.</span><button type="button" data-action="remove-list" data-id="${esc(item.id)}">Remove from list</button></div>` : ""}
    </article>`;
  }

  function renderShop() {
    let items = (state.items || []).filter(i => i.needed);
    if (shopSmartOrder) {
      const order = ["Fruit & veg","Bakery","Dairy & eggs","Meat & fish","Frozen","Pantry","Drinks","Household","Other"];
      items.sort((a,b) => order.indexOf(a.category)-order.indexOf(b.category) || (b.addedAt||0)-(a.addedAt||0));
    } else items.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
    $("shopSub").textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
    $("shopSortBtn").textContent = shopSmartOrder ? "Smart order" : "Recent first";
    $("shopList").innerHTML = items.length ? items.map(i => productCardHTML(i,"shop")).join("") : `<div class="empty-state"><div class="empty-icon">✓</div><strong>The list is clear</strong><span>Add something above, or use “At home” to record what Oakdene already has.</span></div>`;
  }

  function renderHome() {
    const all = (state.items || []).filter(i => (i.inventory || []).length);
    const allLots = all.flatMap(i => i.inventory || []);
    const expired = allLots.filter(l => l.expiryDate && daysUntil(l.expiryDate) < 0).length;
    const soon = allLots.filter(l => l.expiryDate && daysUntil(l.expiryDate) >= 0 && daysUntil(l.expiryDate) <= 3).length;
    const fresh = allLots.length - expired - soon;
    $("expirySummary").innerHTML = `<div class="summary-card"><div class="num">${fresh}</div><div class="label">fine for now</div></div><div class="summary-card warn"><div class="num">${soon}</div><div class="label">expiring soon</div></div><div class="summary-card bad"><div class="num">${expired}</div><div class="label">expired</div></div>`;
    let items = all;
    if (homeFilter === "expiring") items = items.filter(i => (i.inventory||[]).some(l => l.expiryDate && daysUntil(l.expiryDate) >= 0 && daysUntil(l.expiryDate) <= 3));
    if (homeFilter === "expired") items = items.filter(i => expiredLots(i).length);
    items.sort((a,b) => {
      const ae = latestExpiry(a), be = latestExpiry(b);
      if (ae && be) return daysUntil(ae.expiryDate)-daysUntil(be.expiryDate);
      if (ae) return -1; if (be) return 1; return a.name.localeCompare(b.name);
    });
    $("homeSub").textContent = `${all.length} ${all.length === 1 ? "product" : "products"}`;
    $("homeFilterBtn").textContent = homeFilter === "all" ? "All" : homeFilter === "expiring" ? "Expiring" : "Expired";
    $("homeList").innerHTML = items.length ? items.map(i => productCardHTML(i,"home")).join("") : `<div class="empty-state"><div class="empty-icon">⌂</div><strong>${homeFilter === "all" ? "Oakdene is empty" : "Nothing here"}</strong><span>${homeFilter === "all" ? "Add things already in the kitchen so the list can warn you before you buy duplicates." : "Try another filter."}</span></div>`;
  }

  function renderHistory() {
    const query = normalizeName($("historySearch")?.value || "");
    let items = (state.items || []).filter(i => (i.purchaseHistory || []).length || (i.inventory || []).length || i.needed);
    if (query) items = items.filter(i => normalizeName(i.name).includes(query) || nameScore(query,i.name) > .5);
    items.sort((a,b) => (latestPurchase(b)?.date||b.updatedAt||0)-(latestPurchase(a)?.date||a.updatedAt||0));
    $("historySub").textContent = `${items.length} known`;
    $("historyList").innerHTML = items.length ? items.map(i => productCardHTML(i,"history")).join("") : `<div class="empty-state"><div class="empty-icon">↺</div><strong>No matches</strong><span>Anything the family buys becomes part of Oakdene's memory.</span></div>`;
  }

  function switchView(view) {
    currentView = view;
    qsa(".view").forEach(el => el.classList.toggle("active", el.dataset.view === view));
    qsa(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.nav === view));
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function renderQuickSuggestions(value) {
    const panel = $("smartSuggestions");
    const q = cleanName(value);
    if (q.length < 2) { panel.hidden = true; panel.innerHTML = ""; return; }
    const matches = (state.items || [])
      .map(item => ({ item, score:nameScore(q,item.name) }))
      .filter(x => x.score >= .35 || normalizeName(x.item.name).includes(normalizeName(q)))
      .sort((a,b)=>b.score-a.score || (b.item.updatedAt||0)-(a.item.updatedAt||0)).slice(0,4);
    if (!matches.length) { panel.hidden = true; return; }
    panel.innerHTML = matches.map(({item}) => {
      const home = usableLots(item).length ? `${inventorySummary(item,true) || "At home"} at home` : "Bought before";
      const last = latestPurchase(item); const price = last?.price != null ? ` · £${Number(last.price).toFixed(2)}${last.store ? ` at ${last.store}`:""}` : "";
      return `<div class="suggestion"><div class="suggestion-main"><div class="suggestion-name">${esc(item.name)}</div><div class="suggestion-meta">${esc(home)}${esc(price)}</div></div><button type="button" data-suggest-id="${esc(item.id)}">${item.needed ? "On list" : "Add"}</button></div>`;
    }).join("");
    panel.hidden = false;
    qsa("[data-suggest-id]", panel).forEach(btn => btn.addEventListener("click", () => {
      const item = state.items.find(i => i.id === btn.dataset.suggestId); if (item) smartAddExisting(item);
      $("quickAddInput").value = ""; updateQuickInput(); panel.hidden = true;
    }));
  }

  function smartAddByName(name) {
    name = cleanName(name); if (!name) return;
    const best = findBestMatch(name, .72);
    if (best) return smartAddExisting(best.item);
    const product = makeProduct(name, true);
    mutate("addProduct", { product });
    toast(`${product.name} added`);
  }

  function smartAddExisting(item) {
    if (item.needed) { toast(`${item.name} is already on the list`); return; }
    const good = usableLots(item);
    const expired = expiredLots(item);
    if (good.length) {
      const nextExpiry = good.filter(l=>l.expiryDate).sort((a,b)=>daysUntil(a.expiryDate)-daysUntil(b.expiryDate))[0];
      const content = $("smartDialogContent");
      content.innerHTML = `<div class="dialog-handle"></div><div class="dialog-icon">⌂</div><p class="kicker">Oakdene check</p><h3>You may already have ${esc(item.name)}</h3><p>Before adding another one, Oakdene found stock that doesn't appear to be expired.</p>
        <div class="smart-fact"><div class="smart-fact-icon">✓</div><div><strong>${esc(inventorySummary(item,true) || "At home")}</strong>${nextExpiry ? esc(expiryLabel(nextExpiry.expiryDate).text) : "No expiry date has been recorded."}</div></div>
        <div class="smart-dialog-actions"><button class="button gold" type="button" data-smart-action="add">Add anyway</button><button class="button ghost" type="button" data-smart-action="view">View what we have</button><button class="button ghost" type="button" data-smart-action="cancel">Don't add</button></div>`;
      $("smartDialog").showModal();
      qs('[data-smart-action="add"]',content).onclick = () => { mutate("setNeeded",{itemId:item.id,needed:true}); $("smartDialog").close(); toast(`${item.name} added anyway`); };
      qs('[data-smart-action="view"]',content).onclick = () => { $("smartDialog").close(); switchView("home"); openItem(item.id); };
      qs('[data-smart-action="cancel"]',content).onclick = () => $("smartDialog").close();
      return;
    }
    mutate("setNeeded", { itemId:item.id, needed:true });
    if (expired.length) toast(`${item.name} added — the stock at home looks expired`);
    else {
      const last = latestPurchase(item);
      toast(last?.price != null && last.store ? `Bought before: £${Number(last.price).toFixed(2)} at ${last.store}` : `${item.name} added from history`);
    }
  }

  function openPurchase(itemId) {
    const item = state.items.find(i => i.id === itemId); if (!item) return;
    $("purchaseItemId").value = item.id; $("purchaseTitle").textContent = item.name;
    $("purchaseQty").value = "1"; $("purchaseUnit").value = "item"; $("purchaseExpiry").value = ""; $("purchasePrice").value = "";
    const last = latestPurchase(item); $("purchaseStore").value = last?.store && STORES.includes(last.store) ? last.store : "Not recorded";
    purchasePhotoFile = null; $("purchasePhoto").value = ""; $("purchasePhotoLabel").textContent = "Take or choose a photo";
    $("purchaseDialog").showModal();
  }

  function openHomeAdd(prefill = "") {
    $("homeAddName").value = prefill; $("homeAddQty").value = "1"; $("homeAddUnit").value = "item"; $("homeAddExpiry").value = "";
    homePhotoFile = null; $("homeAddPhoto").value = ""; $("homeAddPhotoLabel").textContent = "Take or choose a photo"; $("homeAddMatch").hidden = true;
    $("homeAddDialog").showModal(); setTimeout(()=>$("homeAddName").focus(),100);
  }

  function openPrice(itemId) {
    const item = state.items.find(i=>i.id===itemId); if (!item) return;
    $("priceItemId").value = item.id; $("priceTitle").textContent = `Price for ${item.name}`; $("priceAmount").value = ""; $("priceSize").value = "";
    const last = latestPurchase(item); $("priceStore").value = last?.store && STORES.includes(last.store) ? last.store : "Tesco";
    $("priceDialog").showModal();
  }

  function itemInsight(item) {
    const good = usableLots(item), expired = expiredLots(item), soon = good.filter(l=>l.expiryDate && daysUntil(l.expiryDate)<=3);
    if (item.needed && good.length) return {tone:"warn", text:`This is on the shopping list, but Oakdene still shows ${inventorySummary(item,true) || "some"} at home. Check before buying.`};
    if (expired.length) return {tone:"bad", text:`${expired.length} ${expired.length===1?"lot looks":"lots look"} expired. Remove or update the expiry if that isn't right.`};
    if (soon.length) return {tone:"warn", text:`Use this soon — ${soon.length===1?expiryLabel(soon[0].expiryDate).text:`${soon.length} lots expire within 3 days`}.`};
    const purchase = latestPurchase(item), best = bestPrice(item);
    if (purchase && best) return {tone:"",text:`Oakdene remembers this product. Latest known best price is £${Number(best.price).toFixed(2)} at ${best.store}.`};
    if (good.length) return {tone:"",text:`You have ${inventorySummary(item,true) || "some"} at home.`};
    if (purchase) return {tone:"",text:`Last recorded ${timeAgo(purchase.date)}${purchase.store?` from ${purchase.store}`:""}${purchase.price!=null?` for £${Number(purchase.price).toFixed(2)}`:""}.`};
    return {tone:"",text:"Oakdene will learn this product as your family records purchases and prices."};
  }

  function renderItemSheet(item) {
    currentItemId = item.id;
    const content = $("itemDialogContent");
    const photo = photoURL(item);
    const insight = itemInsight(item);
    const lots = [...(item.inventory || [])].sort((a,b) => {
      if (a.expiryDate && b.expiryDate) return daysUntil(a.expiryDate)-daysUntil(b.expiryDate);
      return a.expiryDate ? -1 : b.expiryDate ? 1 : (b.addedAt||0)-(a.addedAt||0);
    });
    const prices = latestPrices(item).sort((a,b)=>Number(a.price)-Number(b.price));
    const cheapest = prices[0]?.id;
    const purchase = latestPurchase(item);
    content.innerHTML = `<div class="dialog-handle"></div>
      <div class="dialog-headline"><div><p class="kicker">${esc(item.category || "Other")}</p></div><button class="close-dialog" type="button" data-close="itemDialog">×</button></div>
      <div class="product-hero ${photo?"":"no-photo"}">${photo?`<img src="${esc(photo)}" alt="${esc(item.name)}" />`:esc(categoryIcon(item.category))}<div class="product-hero-controls"><label class="floating-mini">◎ ${photo?"Change photo":"Add photo"}<input type="file" accept="image/*" capture="environment" data-product-photo="${esc(item.id)}" /></label></div></div>
      <div class="product-title-row"><h3>${esc(item.name)}</h3><span class="category-pill">${esc(item.category)}</span></div>
      <div class="insight-card ${insight.tone}">${esc(insight.text)}</div>

      <section class="sheet-section"><div class="sheet-section-title"><span>AT HOME</span><button type="button" data-sheet-action="add-lot" data-id="${esc(item.id)}">+ Add stock</button></div>
        ${lots.length ? lots.map(lot => {
          const ex = expiryLabel(lot.expiryDate); const price = lot.price != null ? ` · £${Number(lot.price).toFixed(2)}` : ""; const store = lot.store ? ` · ${esc(lot.store)}` : "";
          return `<div class="lot-card"><div class="lot-top"><div><div class="lot-name">${esc(`${trimNumber(lot.quantity ?? 1)} ${Number(lot.quantity)===1?(lot.unit||"item"):pluralUnit(lot.unit||"item")}`)}</div><div class="lot-meta"><span class="${ex.tone}">${esc(ex.text)}</span>${store}${price}</div></div><div class="lot-actions"><button type="button" data-sheet-action="edit-lot" data-lot="${esc(lot.id)}">Edit</button><button class="danger" type="button" data-sheet-action="remove-lot" data-lot="${esc(lot.id)}">Used</button></div></div></div>`;
        }).join("") : `<div class="empty-state" style="padding:16px"><strong>Nothing recorded at home</strong><span>Add existing stock or mark this bought.</span></div>`}
      </section>

      <section class="sheet-section"><div class="sheet-section-title"><span>PRICE COMPARISON</span><button type="button" data-sheet-action="add-price" data-id="${esc(item.id)}">+ Add price</button></div>
        ${prices.length ? prices.map(p => `<div class="price-card ${p.id===cheapest?"best":""}"><div class="price-top"><div><div class="price-store">${esc(p.store)} ${p.id===cheapest?`<span class="best-badge">best known</span>`:""}</div><div class="price-meta">${p.size?esc(p.size)+" · ":""}seen ${esc(timeAgo(p.at))}${p.by?` by ${esc(p.by)}`:""}</div></div><div class="price-amount">£${Number(p.price).toFixed(2)}</div></div></div>`).join("") : `<div class="inline-alert">No family prices recorded yet. Add a price when you see one, or check retailers below.</div>`}
        <div class="retailer-grid" style="margin-top:9px">${RETAILERS.map(([name,url])=>`<a class="retailer-link" href="${esc(url(item.name))}" target="_blank" rel="noopener"><strong>${esc(name)}</strong><span>Check live ↗</span></a>`).join("")}</div>
        <div class="price-disclaimer">“Best known” uses prices recorded by your family. Retailer buttons open the supermarket's current search so you can verify today's live price before buying.</div>
      </section>

      <section class="sheet-section"><div class="sheet-section-title"><span>FAMILY NOTES</span><span>${(item.comments||[]).length}</span></div>
        ${(item.comments||[]).length ? (item.comments||[]).map(c=>`<div class="comment-row"><b>${esc(c.by||"someone")}</b><span class="comment-time">${esc(timeAgo(c.at))}</span><br>${esc(c.text)}</div>`).join("") : `<div class="lot-meta">No notes yet.</div>`}
        <form class="comment-form" data-comment-form="${esc(item.id)}"><input type="text" placeholder="Add a note for the family…" maxlength="300" /><button type="submit">Send</button></form>
      </section>

      <div class="sheet-footer-actions">
        <button class="button ${item.needed?"ghost":"gold"}" type="button" data-sheet-action="toggle-needed" data-id="${esc(item.id)}">${item.needed?"Remove from list":"Need again"}</button>
        <button class="button primary" type="button" data-sheet-action="bought" data-id="${esc(item.id)}">Bought it</button>
      </div>
      <button class="danger-link" type="button" data-sheet-action="delete" data-id="${esc(item.id)}">Delete product and its history</button>
      ${purchase ? `<div class="price-disclaimer" style="text-align:center">Last activity: ${esc(timeAgo(purchase.date))}${purchase.by?` · ${esc(purchase.by)}`:""}</div>` : ""}`;
  }

  function openItem(itemId) {
    const item = state.items.find(i => i.id === itemId); if (!item) return;
    renderItemSheet(item); if (!$("itemDialog").open) $("itemDialog").showModal();
  }

  function openLotEditor(item, lot) {
    const content = $("smartDialogContent");
    content.innerHTML = `<div class="dialog-handle"></div><div class="dialog-headline"><div><p class="kicker">At home</p><h3>Edit ${esc(item.name)}</h3></div><button class="close-dialog" type="button" data-close="smartDialog">×</button></div>
      <form data-lot-edit>
        <div class="two-col"><div><label class="field-label">Quantity</label><input class="field" name="qty" type="number" min="0" step="0.1" value="${esc(lot.quantity ?? 1)}"></div><div><label class="field-label">Unit</label><select class="field" name="unit">${["item","pack","bottle","tin","bag","kg","g","litre","ml"].map(u=>`<option ${u===(lot.unit||"item")?"selected":""}>${u}</option>`).join("")}</select></div></div>
        <label class="field-label">Expiry / best before</label><input class="field" name="expiry" type="date" value="${esc(lot.expiryDate||"")}">
        <label class="field-label">Shop</label><select class="field" name="store">${STORES.map(s=>`<option ${s===(lot.store||"Not recorded")?"selected":""}>${esc(s)}</option>`).join("")}</select>
        <button class="button primary wide" type="submit">Save changes</button><button class="button ghost wide" type="button" data-close="smartDialog">Cancel</button>
      </form>`;
    $("smartDialog").showModal();
    qs("[data-lot-edit]",content).addEventListener("submit", e => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      mutate("updateLot", { itemId:item.id, lotId:lot.id, patch:{ quantity:Number(fd.get("qty")), unit:fd.get("unit"), expiryDate:fd.get("expiry")||null, store:fd.get("store")==="Not recorded"?null:fd.get("store") } });
      $("smartDialog").close(); toast("Stock updated");
    });
  }

  async function compressImage(file) {
    if (!file) return null;
    const img = await new Promise((resolve,reject) => {
      const i = new Image(); const url = URL.createObjectURL(file);
      i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
      i.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
      i.src = url;
    });
    const max = 1280; const scale = Math.min(1, max / Math.max(img.naturalWidth,img.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(img.naturalWidth*scale); canvas.height = Math.round(img.naturalHeight*scale);
    canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
    return await new Promise(resolve => canvas.toBlob(resolve,"image/jpeg",.8));
  }

  async function uploadPhoto(itemId, file) {
    try {
      toast("Uploading photo…");
      const blob = await compressImage(file);
      if (!blob) throw new Error("No image");
      const res = await fetch(`${PHOTO_API}?id=${encodeURIComponent(itemId)}`, { method:"POST", headers:{"content-type":"image/jpeg"}, body:blob });
      if (!res.ok) throw new Error(`Photo upload failed ${res.status}`);
      mutate("updateProduct", { itemId, patch:{ photoKey:itemId } });
      toast("Photo saved");
    } catch (error) {
      console.error(error); toast("Couldn't save that photo");
    }
  }

  function updateQuickInput() {
    const input = $("quickAddInput");
    input.parentElement.classList.toggle("has-text", Boolean(input.value));
    renderQuickSuggestions(input.value);
  }

  function fillStoreSelects() {
    [$("purchaseStore"),$("priceStore")].forEach(select => { select.innerHTML = STORES.map(s=>`<option>${esc(s)}</option>`).join(""); });
    $("purchaseStore").value = "Not recorded"; $("priceStore").value = "Tesco";
  }

  function bindEvents() {
    qsa(".nav-item").forEach(btn => btn.addEventListener("click",()=>switchView(btn.dataset.nav)));
    $("profileBtn").addEventListener("click",()=>{ $("nameInput").value=myName(); $("nameDialog").showModal(); setTimeout(()=>$("nameInput").select(),80); });
    $("nameForm").addEventListener("submit",e=>{ e.preventDefault(); const name=cleanName($("nameInput").value); if(!name) return; setMyName(name); $("nameDialog").close(); toast(`Hi ${name}`); });
    $("quickAddInput").addEventListener("input",updateQuickInput);
    $("clearQuickInput").addEventListener("click",()=>{ $("quickAddInput").value=""; updateQuickInput(); $("quickAddInput").focus(); });
    $("quickAddForm").addEventListener("submit",e=>{ e.preventDefault(); smartAddByName($("quickAddInput").value); $("quickAddInput").value=""; updateQuickInput(); $("smartSuggestions").hidden=true; });
    $("addHomeBtn").addEventListener("click",()=>openHomeAdd()); $("addHomeTopBtn").addEventListener("click",()=>openHomeAdd());
    $("shopSortBtn").addEventListener("click",()=>{ shopSmartOrder=!shopSmartOrder; renderShop(); });
    $("homeFilterBtn").addEventListener("click",()=>{ homeFilter=homeFilter==="all"?"expiring":homeFilter==="expiring"?"expired":"all"; renderHome(); });
    $("historySearch").addEventListener("input",renderHistory);

    document.addEventListener("click", e => {
      const close = e.target.closest("[data-close]"); if (close) { $(close.dataset.close)?.close(); return; }
      const actionEl = e.target.closest("[data-action]");
      if (actionEl) {
        e.stopPropagation(); const id=actionEl.dataset.id; const action=actionEl.dataset.action;
        if(action==="open") openItem(id);
        if(action==="bought") openPurchase(id);
        if(action==="price") { openPrice(id); }
        if(action==="need") { const item=state.items.find(i=>i.id===id); if(item) smartAddExisting(item); }
        if(action==="remove-list") { mutate("setNeeded",{itemId:id,needed:false}); toast("Removed from shopping list"); }
      }
    });

    $("purchasePhoto").addEventListener("change",e=>{ purchasePhotoFile=e.target.files?.[0]||null; $("purchasePhotoLabel").textContent=purchasePhotoFile?purchasePhotoFile.name:"Take or choose a photo"; });
    $("homeAddPhoto").addEventListener("change",e=>{ homePhotoFile=e.target.files?.[0]||null; $("homeAddPhotoLabel").textContent=homePhotoFile?homePhotoFile.name:"Take or choose a photo"; });
    $("homeAddName").addEventListener("input",()=>{
      const best=findBestMatch($("homeAddName").value,.72), el=$("homeAddMatch");
      if(best){ const home=inventorySummary(best.item,true); el.innerHTML=`Oakdene already knows <strong>${esc(best.item.name)}</strong>${home?` and shows ${esc(home)} at home`:""}. New stock will be added to the same product.`; el.hidden=false; } else el.hidden=true;
    });

    $("purchaseForm").addEventListener("submit", async e => {
      e.preventDefault(); const item=state.items.find(i=>i.id===$("purchaseItemId").value); if(!item)return;
      const lot=makeLot({quantity:$("purchaseQty").value,unit:$("purchaseUnit").value,expiryDate:$("purchaseExpiry").value,store:$("purchaseStore").value,price:$("purchasePrice").value});
      const purchase={id:uid("purchase"),date:Date.now(),by:myName(),store:lot.store,price:lot.price,quantity:lot.quantity,unit:lot.unit,source:"purchase"};
      mutate("purchase",{itemId:item.id,lot,purchase}); $("purchaseDialog").close(); toast(`${item.name} moved home`);
      if(purchasePhotoFile) await uploadPhoto(item.id,purchasePhotoFile);
    });

    $("homeAddForm").addEventListener("submit", async e => {
      e.preventDefault(); const name=cleanName($("homeAddName").value); if(!name)return;
      const match=findBestMatch(name,.72); const product=match?null:makeProduct(name,false); const itemId=match?.item.id||product.id;
      const lot=makeLot({quantity:$("homeAddQty").value,unit:$("homeAddUnit").value,expiryDate:$("homeAddExpiry").value,store:null,price:null});
      mutate("addExisting",{itemId,product,lot}); $("homeAddDialog").close(); toast(`${match?.item.name||product.name} added at home`);
      if(homePhotoFile) await uploadPhoto(itemId,homePhotoFile);
    });

    $("priceForm").addEventListener("submit",e=>{
      e.preventDefault(); const itemId=$("priceItemId").value; const price=Number($("priceAmount").value); if(!Number.isFinite(price))return;
      mutate("addPrice",{itemId,record:{id:uid("price"),store:$("priceStore").value,price,size:cleanName($("priceSize").value)||null,at:Date.now(),by:myName(),source:"manual"}}); $("priceDialog").close(); toast("Price added");
    });

    $("itemDialogContent").addEventListener("click",e=>{
      const el=e.target.closest("[data-sheet-action]"); if(!el)return; e.preventDefault();
      const item=state.items.find(i=>i.id===currentItemId); if(!item)return;
      const action=el.dataset.sheetAction;
      if(action==="add-lot") { $("itemDialog").close(); openPurchase(item.id); }
      if(action==="add-price") { openPrice(item.id); }
      if(action==="toggle-needed") { if(item.needed){mutate("setNeeded",{itemId:item.id,needed:false});toast("Removed from list");}else smartAddExisting(item); }
      if(action==="bought") { $("itemDialog").close(); openPurchase(item.id); }
      if(action==="edit-lot") { const lot=(item.inventory||[]).find(l=>l.id===el.dataset.lot); if(lot) openLotEditor(item,lot); }
      if(action==="remove-lot") { mutate("removeLot",{itemId:item.id,lotId:el.dataset.lot}); toast("Removed from home"); }
      if(action==="delete") {
        const content=$("smartDialogContent"); content.innerHTML=`<div class="dialog-handle"></div><div class="dialog-icon">!</div><h3>Delete ${esc(item.name)}?</h3><p>This removes its stock, price memory, notes and purchase history for everyone.</p><div class="smart-dialog-actions"><button class="button danger" type="button" data-confirm-delete>Delete permanently</button><button class="button ghost" type="button" data-close="smartDialog">Cancel</button></div>`;
        $("smartDialog").showModal(); qs("[data-confirm-delete]",content).onclick=()=>{mutate("deleteProduct",{itemId:item.id});$("smartDialog").close();$("itemDialog").close();toast("Product deleted");};
      }
    });

    $("itemDialogContent").addEventListener("change",e=>{
      const input=e.target.closest("[data-product-photo]"); if(input?.files?.[0]) uploadPhoto(input.dataset.productPhoto,input.files[0]);
    });

    $("itemDialogContent").addEventListener("submit",e=>{
      const form=e.target.closest("[data-comment-form]"); if(!form)return; e.preventDefault(); const input=qs("input",form); const text=cleanName(input.value); if(!text)return;
      mutate("addComment",{itemId:form.dataset.commentForm,comment:{id:uid("comment"),text,by:myName(),at:Date.now()}}); input.value="";
    });

    window.addEventListener("online",()=>{showSync("Back online",false,true);fetchState();flushQueue();});
    window.addEventListener("offline",()=>showSync("Offline",true,true));
  }

  function init() {
    fillStoreSelects(); bindEvents(); renderAll();
    if (!myName()) $("nameDialog").showModal(); else renderProfile();
    fetchState(); setInterval(()=>{ if(!queue.length && !flushing) fetchState(); },POLL_MS);
    if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
  }

  init();
})();
