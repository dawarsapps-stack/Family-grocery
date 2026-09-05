# Larder — family grocery list

Shared list, syncs across everyone's phone via a Netlify Function backed by
Netlify Blobs (no database account, no API keys — Netlify provisions it
automatically).

## Deploy (2 minutes)

**Easiest — Netlify CLI:**
```
npm install -g netlify-cli
cd family-grocery
npm install
netlify deploy --prod
```
When prompted, create a new site. That's it — `netlify.toml` already points
Netlify at the `netlify/functions` folder and installs `@netlify/blobs`.

**Alternative — Git:**
Push this folder to a GitHub repo, then in Netlify: "Add new site" → "Import
from Git" → pick the repo. No build command needed; publish directory is `.`.

> Plain drag-and-drop of the folder into the Netlify UI will deploy the
> site but **won't** run `npm install` for the function's dependency, so the
> backend will 500. Use the CLI or Git method above.

## Using it on iPhone/Android

Open the deployed URL in Safari or Chrome, then "Add to Home Screen" — it'll
behave like a normal app icon, full width, no browser chrome.

## How data is stored

Everything lives server-side in a Netlify Blobs store called
`family-grocery`, written and read through `/api/data`. Nothing is stored
only on one device, so nobody loses the list by clearing their phone. Each
person's name (set on first visit) is the only thing saved locally, purely
so their name can be attached to items and comments.
