import { getStore } from "@netlify/blobs";

const STORE = "family-grocery-photos";
const MAX_BYTES = 2_500_000;

function cleanId(value) {
  const id = String(value || "");
  return /^[a-zA-Z0-9_-]{3,120}$/.test(id) ? id : null;
}

export default async (req) => {
  const url = new URL(req.url);
  const id = cleanId(url.searchParams.get("id"));
  if (!id) return new Response("Invalid photo id", { status: 400 });
  const store = getStore(STORE);
  const key = `product/${id}`;

  if (req.method === "GET") {
    const entry = await store.getWithMetadata(key, { type: "arrayBuffer", consistency: "strong" });
    if (!entry) return new Response("Not found", { status: 404 });
    return new Response(entry.data, {
      headers: {
        "content-type": entry.metadata?.contentType || "image/jpeg",
        "cache-control": "public, max-age=86400",
        "etag": entry.etag,
      },
    });
  }

  if (req.method === "POST") {
    const type = req.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return new Response("Image required", { status: 415 });
    const data = await req.arrayBuffer();
    if (!data.byteLength || data.byteLength > MAX_BYTES) return new Response("Image too large", { status: 413 });
    await store.set(key, data, { metadata: { contentType: type, uploadedAt: Date.now() } });
    return new Response(JSON.stringify({ ok: true, key: id }), { headers: { "content-type": "application/json" } });
  }

  if (req.method === "DELETE") {
    await store.delete(key);
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/photo" };
