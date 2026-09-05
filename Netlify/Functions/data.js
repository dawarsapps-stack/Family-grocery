import { getStore } from "@netlify/blobs";

const STORE_NAME = "family-grocery";
const STATE_KEY = "state";
const MAX_MUTATION_IDS = 160;

function uid(prefix = "x") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeName(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|grams?|l|litres?|liters?|ml|cl|oz|lb|pack|pk)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function migrateItem(raw = {}) {
  const history = Array.isArray(raw.purchaseHistory)
    ? raw.purchaseHistory
    : Array.isArray(raw.history)
      ? raw.history.map((h) => ({ id: uid("purchase"), date: h.date || raw.lastBought || Date.now(), by: h.by || raw.addedBy || "someone", source: "legacy" }))
      : [];

  if (raw.lastBought && !history.some((h) => Math.abs((h.date || 0) - raw.lastBought) < 1000)) {
    history.push({ id: uid("purchase"), date: raw.lastBought, by: raw.addedBy || "someone", source: "legacy" });
  }

  return {
    id: raw.id || uid("product"),
    name: raw.name || "Unnamed item",
    normalizedName: raw.normalizedName || normalizeName(raw.name || ""),
    category: raw.category || "Other",
    needed: Boolean(raw.needed),
    addedBy: raw.addedBy || null,
    addedAt: raw.addedAt || Date.now(),
    updatedAt: raw.updatedAt || raw.addedAt || Date.now(),
    inventory: Array.isArray(raw.inventory) ? raw.inventory : [],
    purchaseHistory: history.sort((a, b) => (b.date || 0) - (a.date || 0)),
    priceHistory: Array.isArray(raw.priceHistory) ? raw.priceHistory : [],
    comments: Array.isArray(raw.comments) ? raw.comments : [],
    photoKey: raw.photoKey || null,
  };
}

function migrateState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    version: 2,
    items: Array.isArray(src.items) ? src.items.map(migrateItem) : [],
    processedMutations: Array.isArray(src.processedMutations) ? src.processedMutations.slice(-MAX_MUTATION_IDS) : [],
    updatedAt: src.updatedAt || Date.now(),
  };
}

function findItem(state, id) {
  return state.items.find((item) => item.id === id);
}

function addPriceRecord(item, record) {
  if (!record || record.price === null || record.price === undefined || record.price === "" || !record.store || record.store === "Not recorded") return;
  const price = Number(record.price);
  if (!Number.isFinite(price) || price < 0) return;
  item.priceHistory = Array.isArray(item.priceHistory) ? item.priceHistory : [];
  item.priceHistory.unshift({
    id: record.id || uid("price"),
    store: record.store,
    price,
    size: record.size || null,
    at: record.at || Date.now(),
    by: record.by || null,
    source: record.source || "purchase",
  });
  item.priceHistory = item.priceHistory.slice(0, 120);
}

function applyMutation(inputState, mutation) {
  const state = migrateState(inputState);
  if (!mutation || !mutation.id || !mutation.type || !mutation.payload) return state;
  if (state.processedMutations.includes(mutation.id)) return state;

  const p = mutation.payload;
  const actor = mutation.actor || "someone";
  const now = mutation.at || Date.now();
  let item;

  switch (mutation.type) {
    case "addProduct": {
      if (!p.product || !p.product.id || state.items.some((x) => x.id === p.product.id)) break;
      const product = migrateItem(p.product);
      product.normalizedName = product.normalizedName || normalizeName(product.name);
      product.updatedAt = now;
      state.items.unshift(product);
      break;
    }
    case "updateProduct": {
      item = findItem(state, p.itemId);
      if (!item) break;
      const allowed = ["name", "category", "needed", "photoKey", "addedBy", "addedAt"];
      for (const key of allowed) if (Object.prototype.hasOwnProperty.call(p.patch || {}, key)) item[key] = p.patch[key];
      if (p.patch?.name) item.normalizedName = normalizeName(p.patch.name);
      item.updatedAt = now;
      break;
    }
    case "setNeeded": {
      item = findItem(state, p.itemId);
      if (!item) break;
      item.needed = Boolean(p.needed);
      if (item.needed) {
        item.addedBy = actor;
        item.addedAt = now;
      }
      item.updatedAt = now;
      break;
    }
    case "purchase": {
      item = findItem(state, p.itemId);
      if (!item || !p.lot) break;
      item.inventory = Array.isArray(item.inventory) ? item.inventory : [];
      item.inventory.unshift({ ...p.lot, id: p.lot.id || uid("lot"), by: p.lot.by || actor, purchasedAt: p.lot.purchasedAt || now, addedAt: p.lot.addedAt || now });
      item.needed = false;
      item.purchaseHistory = Array.isArray(item.purchaseHistory) ? item.purchaseHistory : [];
      item.purchaseHistory.unshift({
        id: p.purchase?.id || uid("purchase"),
        date: p.purchase?.date || now,
        by: p.purchase?.by || actor,
        store: p.purchase?.store || p.lot.store || null,
        price: p.purchase?.price ?? p.lot.price ?? null,
        quantity: p.purchase?.quantity ?? p.lot.quantity ?? null,
        unit: p.purchase?.unit || p.lot.unit || null,
        source: "purchase",
      });
      item.purchaseHistory = item.purchaseHistory.slice(0, 120);
      addPriceRecord(item, {
        store: p.lot.store,
        price: p.lot.price,
        size: p.lot.size || null,
        at: now,
        by: actor,
        source: "purchase",
      });
      item.updatedAt = now;
      break;
    }
    case "addExisting": {
      if (p.product && !state.items.some((x) => x.id === p.product.id)) state.items.unshift(migrateItem(p.product));
      item = findItem(state, p.itemId || p.product?.id);
      if (!item || !p.lot) break;
      item.inventory = Array.isArray(item.inventory) ? item.inventory : [];
      item.inventory.unshift({ ...p.lot, id: p.lot.id || uid("lot"), by: p.lot.by || actor, addedAt: p.lot.addedAt || now });
      item.purchaseHistory = Array.isArray(item.purchaseHistory) ? item.purchaseHistory : [];
      item.purchaseHistory.unshift({
        id: uid("purchase"), date: p.lot.purchasedAt || now, by: actor,
        store: p.lot.store || null, price: p.lot.price ?? null,
        quantity: p.lot.quantity ?? null, unit: p.lot.unit || null, source: "existing"
      });
      item.updatedAt = now;
      break;
    }
    case "updateLot": {
      item = findItem(state, p.itemId);
      if (!item) break;
      const lot = (item.inventory || []).find((x) => x.id === p.lotId);
      if (!lot) break;
      Object.assign(lot, p.patch || {});
      item.updatedAt = now;
      break;
    }
    case "removeLot": {
      item = findItem(state, p.itemId);
      if (!item) break;
      item.inventory = (item.inventory || []).filter((x) => x.id !== p.lotId);
      item.updatedAt = now;
      break;
    }
    case "addPrice": {
      item = findItem(state, p.itemId);
      if (!item) break;
      addPriceRecord(item, { ...p.record, by: p.record?.by || actor, at: p.record?.at || now, source: p.record?.source || "manual" });
      item.updatedAt = now;
      break;
    }
    case "addComment": {
      item = findItem(state, p.itemId);
      if (!item || !p.comment) break;
      item.comments = Array.isArray(item.comments) ? item.comments : [];
      if (!item.comments.some((c) => c.id === p.comment.id)) item.comments.push({ ...p.comment, by: p.comment.by || actor, at: p.comment.at || now });
      item.updatedAt = now;
      break;
    }
    case "deleteProduct": {
      state.items = state.items.filter((x) => x.id !== p.itemId);
      break;
    }
    default:
      break;
  }

  state.processedMutations.push(mutation.id);
  state.processedMutations = state.processedMutations.slice(-MAX_MUTATION_IDS);
  state.updatedAt = now;
  return state;
}

function responseJSON(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}

export default async (req) => {
  const store = getStore(STORE_NAME);

  if (req.method === "GET") {
    const data = await store.get(STATE_KEY, { type: "json", consistency: "strong" });
    return responseJSON(migrateState(data));
  }

  if (req.method === "POST") {
    let mutation;
    try {
      mutation = await req.json();
    } catch {
      return responseJSON({ error: "Invalid JSON" }, 400);
    }
    if (!mutation?.id || !mutation?.type || !mutation?.payload) return responseJSON({ error: "Malformed mutation" }, 400);

    let lastError;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const entry = await store.getWithMetadata(STATE_KEY, { type: "json", consistency: "strong" });
        const current = migrateState(entry?.data || null);
        if (current.processedMutations.includes(mutation.id)) return responseJSON(current);
        const next = applyMutation(current, mutation);
        if (entry) {
          await store.setJSON(STATE_KEY, next, { onlyIfMatch: entry.etag });
        } else {
          await store.setJSON(STATE_KEY, next, { onlyIfNew: true });
        }
        return responseJSON(next);
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 35 + attempt * 45));
      }
    }
    console.error("Oakdene mutation failed", lastError);
    return responseJSON({ error: "Could not save this change. Please try again." }, 409);
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/data" };
