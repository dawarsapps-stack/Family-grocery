# Oakdene Groceries

A premium shared family grocery web app for iPhone and Android, deployed on Netlify.

## What it does

- Shared shopping list that syncs across the family
- "At home" inventory kept separately from the shopping list
- Expiry / best-before tracking with expiring-soon and expired alerts
- Smart duplicate checks before adding something the family already has
- Product memory: previously bought items, purchase history, family notes and photos
- Camera/photo uploads stored in Netlify Blobs
- Family price memory by supermarket, with cheapest known price highlighted
- One-tap links to current retailer searches for Tesco, Sainsbury's, Waitrose, Ocado, Asda, Morrisons, Aldi and Co-op
- Offline local cache and queued edits that sync when connectivity returns
- Installable PWA experience for iPhone/Android home screens

## Data model

The app deliberately separates three concepts:

1. **Need to buy** (`needed`) — whether the product is on the shared shopping list.
2. **At home** (`inventory`) — one or more stock lots, each with quantity and optional expiry/store/price.
3. **History** (`purchaseHistory`) — what the family has bought before.

A product can be both at home and on the shopping list at the same time. This prevents duplicate warnings from destroying the fact that some stock is still in the house.

Existing v1 data is migrated automatically. Old "previously bought" records remain history; they are not assumed to still be physically at home because the old app did not track that distinction.

## Price comparison

Oakdene records prices the family actually sees or pays and compares the latest recorded price per supermarket. Retailer buttons open each supermarket's live search for verification.

Automated ingestion of all live UK supermarket prices is intentionally not scraped from retailer websites. A production-grade live feed should be added via a licensed retailer/product-pricing data source or supported API to avoid brittle, inaccurate comparisons.

## Deployment

Netlify is connected to the GitHub repository. Pushing to `main` triggers deployment.

The app uses:

- `family-grocery` Netlify Blob store for structured state
- `family-grocery-photos` Netlify Blob store for compressed product photos
- `netlify/functions/data.js` for conflict-safe granular mutations
- `netlify/functions/photo.js` for image upload/retrieval

No separate database or API keys are required for the current feature set.
