# Sahil · South America 2026

A shared, installable trip companion deployed on Netlify.

## Architecture

- `public/` is the stable PWA shell. It is ordinary source code; there are no base64 archives or build-time reconstruction scripts.
- `netlify/functions/trip-state.mts` stores the complete shared trip document in Netlify Blobs at runtime.
- Trip edits use optimistic revision checks, automatic three-way rebase in the client, local offline cache, queued sync, revision history, and restore/undo.
- All four travellers can edit. Each device selects the traveller name used in the revision log; there is intentionally no login friction yet.
- Open-Meteo is queried directly for near-term weather.
- Maps use Leaflet/OpenStreetMap when online plus Google Maps search/directions links.
- `netlify/functions/ai-plan.mts` implements Preview → Apply → Undo. It uses OpenAI only if `OPENAI_API_KEY` is configured; otherwise it returns a conservative local-planner fallback rather than silently fabricating AI output.

## OTA / no-deploy content updates

After the shell is deployed once, ordinary changes to itinerary days, notes, stays, transport, places, traveller assignment, booking state and selections are saved to runtime storage. They do not require a Git commit or a Netlify deploy.

A new deploy is only needed for shell/code changes (new UI capability, service-worker logic, backend function code, dependency changes).
