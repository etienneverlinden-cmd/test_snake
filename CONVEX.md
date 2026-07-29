# Convex setup (Stijn Arcade)

Same pattern as [pawnie](https://github.com/stijnv31/pawnie): Convex schema + functions, a thin client wrapper, and a **local fallback** when Convex is not configured.

## What was added

| Path | Role |
|------|------|
| `convex/schema.ts` | Auth tables + `scores` |
| `convex/auth.ts` | Google + Password (email verify via Resend) |
| `convex/scores.ts` | Auth-gated leaderboard APIs |
| `js/auth.js` | Vanilla Convex Auth client |
| `login.html` | Sign in / sign up / confirm email |
| `js/convex-config.js` | Public `STIJN_ARCADE_CONVEX_URL` |

## Auth setup

See **AUTH.md** for Google OAuth, Resend, JWT keys, and `SITE_URL`.

## One-time Convex link (on your PC)

```bash
cd "…/Test/Snake"
npm install
npx convex login
npx convex dev
```

Copy the deployment URL into `js/convex-config.js`.

## Difference vs pawnie

Pawnie is **Next.js** with React Convex Auth.  
This arcade is **static HTML**, so auth uses the same Convex Auth backend with a small vanilla JS client (`js/auth.js`).

## Fallback

If Convex is down, local high scores still work in the browser — but **playing the site requires sign-in** when auth is configured.
