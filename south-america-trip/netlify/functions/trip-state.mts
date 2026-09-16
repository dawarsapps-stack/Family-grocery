import { getDeployStore, getStore } from "@netlify/blobs";

const STORE = "south-america-trip";
const CURRENT = "state-v4";
const LEGACY = "shared-state";
const HISTORY_INDEX = "history-index-v4";
const HISTORY_PREFIX = "history-v4/";
const MAX_HISTORY = 60;

function storeForContext() {
  const prod = Netlify.context?.deploy?.context === "production";
  return prod ? getStore(STORE, { consistency: "strong" }) : getDeployStore(STORE);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function blankState() {
  return {
    schemaVersion: 4,
    revision: 0,
    updatedAt: null,
    updatedBy: null,
    summary: null,
    document: null,
    selectedHotels: {},
    selectedFlights: {},
    customHotelOptions: {},
    customFlightOptions: {},
    bookingChecks: {},
    prepChecks: {},
    alertAck: false
  };
}

function normalize(input: any) {
  const safe = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return { ...blankState(), ...safe, schemaVersion: 4 };
}

function historyKey(revision: number) {
  return `${HISTORY_PREFIX}${String(revision).padStart(8, "0")}.json`;
}

async function readCurrent(store: any) {
  const current = await store.get(CURRENT, { type: "json" });
  if (current) return normalize(current);
  const legacy = await store.get(LEGACY, { type: "json" });
  return normalize(legacy || blankState());
}

async function saveHistory(store: any, state: any) {
  if (!state || !Number.isFinite(Number(state.revision)) || Number(state.revision) <= 0) return;
  await store.setJSON(historyKey(Number(state.revision)), state);
  const index = (await store.get(HISTORY_INDEX, { type: "json" })) || [];
  const entry = {
    revision: Number(state.revision),
    updatedAt: state.updatedAt || null,
    updatedBy: state.updatedBy || null,
    summary: state.summary || "Trip update"
  };
  const next = [entry, ...index.filter((x: any) => Number(x.revision) !== entry.revision)].slice(0, MAX_HISTORY);
  await store.setJSON(HISTORY_INDEX, next);
}

export default async (req: Request) => {
  const store = storeForContext();
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.get("history") === "1") {
      const index = (await store.get(HISTORY_INDEX, { type: "json" })) || [];
      return json({ history: index });
    }
    return json(await readCurrent(store));
  }

  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON payload." }, 400); }
    const incoming = normalize(body?.state);
    const baseRevision = Number(body?.baseRevision ?? incoming.revision ?? 0);
    const actor = String(body?.actor || "Unknown traveller").slice(0, 80);
    const summary = String(body?.summary || "Trip update").slice(0, 180);
    const serialized = JSON.stringify(incoming);
    if (serialized.length > 1_800_000) return json({ error: "Trip state is too large." }, 413);

    const current = await readCurrent(store);
    if (baseRevision !== Number(current.revision || 0)) {
      return json({ error: "revision_conflict", current }, 409);
    }

    await saveHistory(store, current);
    const next = {
      ...incoming,
      schemaVersion: 4,
      revision: Number(current.revision || 0) + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
      summary
    };
    await store.setJSON(CURRENT, next);
    return json(next);
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON payload." }, 400); }
    if (body?.action !== "undo") return json({ error: "Unsupported action." }, 400);
    const restoreRevision = Number(body?.revision);
    if (!Number.isFinite(restoreRevision) || restoreRevision < 1) return json({ error: "Invalid revision." }, 400);
    const snapshot = await store.get(historyKey(restoreRevision), { type: "json" });
    if (!snapshot) return json({ error: "Revision not found." }, 404);
    const current = await readCurrent(store);
    await saveHistory(store, current);
    const next = {
      ...normalize(snapshot),
      revision: Number(current.revision || 0) + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: String(body?.actor || "Unknown traveller").slice(0, 80),
      summary: `Restored revision ${restoreRevision}`
    };
    await store.setJSON(CURRENT, next);
    return json(next);
  }

  return json({ error: "Method not allowed." }, 405);
};

export const config = { path: "/api/trip-state" };
