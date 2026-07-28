# Convex setup (Stijn Arcade)

Same pattern as [pawnie](https://github.com/stijnv31/pawnie): Convex schema + functions, a thin client wrapper, and a **local fallback** when Convex is not configured.

## What was added

| Path | Role |
|------|------|
| `convex/schema.ts` | `scores` table |
| `convex/scores.ts` | `getBestScore`, `getTopScores`, `submitScore` |
| `js/db.js` | Browser client (`try` Convex → else `localStorage`) like pawnie's `tryConvexQuery` |
| `js/convex-config.js` | Public `STIJN_ARCADE_CONVEX_URL` |

## One-time setup (on your PC)

```bash
cd "…/Test/Snake"
npm install
npx convex login
npx convex dev
```

`npx convex dev` creates a deployment and generates `convex/_generated/`.  
Copy the printed URL (e.g. `https://happy-animal-123.convex.cloud`) into:

1. `js/convex-config.js` → `window.STIJN_ARCADE_CONVEX_URL = "https://…"`
2. Optionally `.env` as `CONVEX_URL=…`

Then commit/push so the live site can reach Convex.

## Difference vs pawnie

Pawnie is **Next.js**: the server holds `CONVEX_API_SECRET` and the browser never sees it.  
This arcade is **static HTML**, so the browser talks to Convex with **public** score functions (validated/sanitized). We cannot hide a secret in the frontend.

## Fallback

If `STIJN_ARCADE_CONVEX_URL` is empty or Convex is down, scores still work via `localStorage` (same idea as pawnie falling back when Convex is disabled).
