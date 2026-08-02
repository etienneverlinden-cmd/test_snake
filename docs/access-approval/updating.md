# How to update

Practical checklist for changing membership access, testing locally, and shipping. Prefer a feature branch; do not push `main` unless you intend to ship the static site to production.

---

## What deploys how

| Piece | Ships when… | Notes |
|-------|-------------|--------|
| Static HTML/JS/CSS (incl. `auth-guard`, access pages, `convex-config.js`) | Push / merge to **`main`** | VPS webhook → `deploy/auto-deploy.sh` rsync to `/var/www/snake` |
| Convex functions + schema (`convex/access.ts`, etc.) | **`npm run deploy:convex`** or `npx convex dev --once` | Targets **duck** (`limitless-duck-213`), not coyote |
| Convex env vars | `npx convex env set …` (on duck) | Separate from git |
| Deck worker / `deck-api.py` | **Manual SSH** copy under `/opt/cursor-worker` | `deploy/` is **excluded** from web rsync |

`auto-deploy.sh` excludes among others: `deploy/`, `convex/`, `node_modules/`, `.git/`. Updating access logic in Convex does **not** happen via a static-only `main` push.

---

## Changing behaviour

### Client gate / copy

1. Edit `js/auth-guard.js` and/or `access-*.html`.
2. Local: `npm run dev:site` (or `python -m http.server 8080`) with Convex pointing at duck (or `npx convex dev` if iterating functions).
3. Ship static: merge to `main` when ready (site auto-deploys).

### Convex membership logic

1. Edit `convex/access.ts` (and `http.ts` / `email.ts` if needed).
2. Push functions: `npm run deploy:convex` (or keep `npx convex dev` running while developing).
3. Test decide links against `https://limitless-duck-213.convex.site/access/decide?...`.

### Schema (`memberAccess`)

1. Edit `convex/schema.ts`.
2. Deploy with `npx convex dev --once` / `deploy:convex` so schema syncs.
3. Breaking changes (rename status, remove fields) need a migration plan for existing rows in the dashboard / one-off mutation — there is no built-in migrator in-repo.

### Deck API gate

1. Edit `deploy/cursor-worker/deck-api.py` (`_auth` / `convex_viewer`).
2. On VPS (see `deploy/cursor-worker/README.md`):

```bash
sudo install -o cursor-worker -g cursor-worker -m 644 \
  deploy/cursor-worker/deck-api.py /opt/cursor-worker/bin/deck-api.py
sudo systemctl restart deck-api
```

3. Confirm `CONVEX_URL` on the worker still points at duck if you rely on the default.

### Environment variables

```bash
# Examples — run against the linked duck deployment
npx convex env set ADMIN_EMAIL "you@yourdomain.com"
npx convex env set SITE_URL "https://pragmatict.be"   # or http://localhost:8080 for local email links
npx convex env set AUTH_RESEND_KEY "re_..."
# optional:
npx convex env set AUTH_EMAIL_FROM "PragmatICT <noreply@yourdomain.com>"
```

**Do not** run `npx convex env set CONVEX_SITE_URL` — forbidden; Convex injects it.

After changing `ADMIN_EMAIL`, the next `ensureAndGet` for that address force-approves even if an old pending/denied row exists.

---

## Local test

```bash
npx convex dev          # optional if functions already on duck
npm run dev:site        # http://localhost:8080
```

Set `SITE_URL` to `http://localhost:8080` if you want grant emails to point at local login.

### Access gate checklist

1. Non-admin sign-in → `access-pending.html`; admin inbox has Approve/Deny.
2. Approve → grant email; pending poll or revisit → arcade.
3. Deny once → `access-denied.html` → Request again → pending + second admin mail.
4. Deny second time → `access-blocked.html`; request again fails.
5. Sign in as `ADMIN_EMAIL` → auto-approved, no pending gate.
6. Optional: Deck Studio call with non-approved JWT → `401 unauthorized`.

---

## Production ship checklist

Use when you intentionally want the live site / backend updated.

1. **Feature branch** reviewed; merge only what you mean to ship.
2. **Convex (duck)**  
   - `npm run deploy:convex` (or `npx convex dev --once`)  
   - Confirm env on duck: `ADMIN_EMAIL`, `SITE_URL=https://pragmatict.be`, Resend, Google, JWT.
3. **Static site**  
   - Merge/push **`main`** only when you want VPS rsync.  
   - Confirm `js/convex-config.js` still points at `limitless-duck-213`.
4. **Deck worker** (if `deck-api.py` / worker scripts changed)  
   - SSH install + `systemctl restart deck-api` (and worker if needed).  
   - Not covered by `main` auto-deploy.
5. **Smoke**  
   - Login as admin → arcade.  
   - Pending path with a test account if available.  
   - Open an old decide link → expect invalid/already decided, not a server error.

**Do not** use `npx convex deploy` expecting pragmatict.be to update — that targets unused **`brilliant-coyote-416`**.

---

## Operational notes / pitfalls

### Duck vs coyote

| | `limitless-duck-213` | `brilliant-coyote-416` |
|--|----------------------|-------------------------|
| Role | Live site backend | Convex “prod” slot, unused by site |
| Client URL | `js/convex-config.js` | — |
| Ship command | `convex dev --once` / `npm run deploy:convex` | `npx convex deploy` |
| Auth / ADMIN_EMAIL | Configured here | Empty/wrong if you never set it |

Shipping to coyote leaves production on stale duck functions until you push duck separately.

### CRLF on `.sh`

Windows checkouts can break VPS bash scripts. Repo `.gitattributes` forces LF for `*.sh` and `deploy/cursor-worker/*.sh`. If a script fails with `$'\r': command not found`, fix line endings (LF) before copying to the server.

### `CONVEX_SITE_URL`

Built-in. Required for Approve/Deny link generation. Never set via CLI. If decide links break, check the deployment’s HTTP routes and that `convex/http.ts` is deployed to duck.

### Admin email required for notifications

Without `ADMIN_EMAIL`, users still enter `pending` but nobody is notified — silent queue.

### Resend from-address

Until a domain is verified, `onboarding@resend.dev` often only delivers to the Resend account owner. Access + auth codes share `AUTH_RESEND_KEY`.

### Token rotation

Every decision issues a new `decisionToken`. Forwarded old links fail. That is intentional.

### Static deploy ≠ Convex ≠ Deck

Three pipelines. Updating only HTML cannot fix server-side `applyDecision`; updating only Convex cannot update `deck-api.py` on the VPS.

### Docs vs live site

This folder (`docs/access-approval/`) is for you in the repo. Whether it appears under `/var/www/snake` depends on rsync excludes (docs are not currently excluded — they may appear on the web root if present on `main`). Prefer keeping operator docs on a branch or excluding later if you do not want them public.
