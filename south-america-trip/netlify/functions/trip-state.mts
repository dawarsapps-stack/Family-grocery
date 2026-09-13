import { getDeployStore, getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

const STORE_NAME = "south-america-trip";
const STATE_KEY = "shared-state";

function storeForContext() {
  const isProduction = Netlify.context?.deploy?.context === "production";
  return isProduction
    ? getStore(STORE_NAME, { consistency: "strong" })
    : getDeployStore(STORE_NAME);
}

function emptyState() {
  return {
    revision: 0,
    updatedAt: null,
    selectedHotels: {},
    selectedFlights: {},
    customHotelOptions: {},
    customFlightOptions: {},
    dayOrder: [],
    dayOverrides: {},
    dayNotes: {},
    bookingChecks: {},
    prepChecks: {},
    alertAck: false
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export default async (req: Request, _context: Context) => {
  const store = storeForContext();

  if (req.method === "GET") {
    const saved = await store.get(STATE_KEY, { type: "json" });
    return json(saved ?? emptyState());
  }

  if (req.method === "PUT") {
    const expectedPin = Netlify.env.get("TRIP_ADMIN_PIN");
    if (!expectedPin) return json({ error: "Owner editing has not been configured yet." }, 503);
    const suppliedPin = req.headers.get("x-admin-pin") ?? "";
    if (suppliedPin !== expectedPin) return json({ error: "Incorrect owner PIN." }, 401);

    let incoming: any;
    try {
      incoming = await req.json();
    } catch {
      return json({ error: "Invalid JSON payload." }, 400);
    }

    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return json({ error: "Invalid state payload." }, 400);
    }

    const serialized = JSON.stringify(incoming);
    if (serialized.length > 900_000) return json({ error: "State payload is too large." }, 413);

    const existing = (await store.get(STATE_KEY, { type: "json" })) ?? emptyState();
    const next = {
      ...emptyState(),
      ...incoming,
      revision: Number(existing.revision || 0) + 1,
      updatedAt: new Date().toISOString()
    };

    await store.setJSON(STATE_KEY, next);
    return json(next);
  }

  return json({ error: "Method not allowed." }, 405);
};

export const config: Config = {
  path: "/api/trip-state"
};
