function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function fallback(prompt: string, context: any) {
  const day = context?.day || {};
  const locked = (context?.lockedItems || []).map((x: any) => x.route || x.item || x.title).filter(Boolean);
  const text = prompt.toLowerCase();
  const suggestions: string[] = [];
  if (/food|restaurant|eat|dinner|lunch/.test(text)) suggestions.push("Strengthen the day around one destination-specific food anchor and keep the rest flexible.");
  if (/night|music|bar|salsa|samba|tango/.test(text)) suggestions.push("Add a neighbourhood-led evening with live music/culture and a safe ride-home plan.");
  if (/less travel|relax|rest|slow/.test(text)) suggestions.push("Remove the lowest-value transit or filler block and protect a reset window.");
  if (/adventure|wow|holy|dramatic|hike|boat|bike/.test(text)) suggestions.push("Prioritise one high-impact landscape/adventure anchor rather than stacking generic sights.");
  if (!suggestions.length) suggestions.push("Rework the day around the request while keeping location, safety, and confirmed bookings intact.");
  return {
    mode: "local-planner-fallback",
    title: day?.title ? `Replan ${day.title}` : "Trip replan",
    summary: suggestions.join(" "),
    safeguards: [
      "Do not move or delete locked/booked transport without explicit confirmation.",
      "Keep the 40L cabin-bag constraint on any flight change.",
      "Prefer safe late-night logistics and destination-specific experiences."
    ],
    lockedItems: locked,
    patch: day?.id ? { dayId: day.id, noteAppend: `Replan request: ${prompt}` } : null
  };
}

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
  const prompt = String(body?.prompt || "").trim();
  if (!prompt) return json({ error: "Prompt required." }, 400);

  const apiKey = Netlify.env.get("OPENAI_API_KEY");
  if (!apiKey) return json(fallback(prompt, body?.context));

  try {
    const instruction = `You are a conservative travel replanner. Return JSON only with keys title, summary, safeguards (array), patch. Never move locked/booked items unless the user explicitly asks. Respect one 40L cabin backpack, safety at night, and destination-specific experiences. Patch may only target the supplied day and should be minimal.`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: [
          { role: "system", content: [{ type: "input_text", text: instruction }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify({ prompt, context: body?.context || {} }) }] }
        ],
        text: { format: { type: "json_object" } }
      })
    });
    if (!response.ok) return json(fallback(prompt, body?.context));
    const payload: any = await response.json();
    const raw = payload?.output_text || payload?.output?.flatMap((x: any) => x.content || []).find((x: any) => x.type === "output_text")?.text;
    if (!raw) return json(fallback(prompt, body?.context));
    return json({ mode: "openai", ...JSON.parse(raw) });
  } catch {
    return json(fallback(prompt, body?.context));
  }
};

export const config = { path: "/api/ai-plan" };
