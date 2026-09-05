import { getStore } from "@netlify/blobs";

function defaultState() {
  return { items: [] };
}

export default async (req) => {
  const store = getStore("family-grocery");

  if (req.method === "GET") {
    const data = await store.get("state", { type: "json" });
    return new Response(JSON.stringify(data || defaultState()), {
      headers: { "content-type": "application/json" },
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (!body || !Array.isArray(body.items)) {
      return new Response(JSON.stringify({ error: "Malformed state" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    await store.setJSON("state", body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/data" };
