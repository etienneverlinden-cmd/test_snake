# Migrating pragmatict.be to Cloudflare Pages

Goal: host the **static site** on Cloudflare Pages. Domain registration stays at **OVH**.  
Hetzner keeps only backend services that Pages cannot replace (Deck API / cursor-worker).

## What moves vs what stays

| Piece | After migration |
|-------|-----------------|
| HTML / CSS / JS / assets / `/test` | **Cloudflare Pages** |
| Convex (auth, M365, Google Connect, Loïc rabbit) | Unchanged (Convex cloud) |
| Domain registrar | **OVH** (unchanged) |
| DNS | **Cloudflare** nameservers |
| Deck API / cursor-worker | Still on Hetzner VPS (or migrate later) |
| Old VPS auto-deploy (`main` → `/var/www/snake`) | Stop using for the public site |

## Repo setup (already in this branch)

```bash
npm run build:pages    # writes ./dist (static only)
npm run deploy:pages   # optional CLI deploy (needs Wrangler login)
```

Cloudflare Git integration build settings:

| Setting | Value |
|---------|--------|
| Framework preset | None |
| Build command | `npm run build:pages` |
| Build output directory | `dist` |
| Root directory | `/` (repo root) |
| Node version | 22 (or 20) |

## Step-by-step (you do this in the browsers)

### 1. Cloudflare — add the site (DNS)

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com)
2. **Add a site** → `pragmatict.be`
3. Choose the **Free** plan
4. Cloudflare scans DNS — keep existing records for now; you will point the apex to Pages later
5. Note the two **nameservers** Cloudflare shows (e.g. `ada.ns.cloudflare.com`, `bob.ns.cloudflare.com`)

### 2. OVH — point DNS to Cloudflare

1. Log in to [OVH](https://www.ovh.com) → Domains → `pragmatict.be`
2. **DNS servers** / **Serveurs DNS** (not the zone records)
3. Switch to **external DNS** and paste Cloudflare’s two nameservers
4. Save — propagation: often 15 min–few hours (sometimes up to 24–48 h)

Do **not** transfer the domain away from OVH. Only change nameservers.

### 3. Cloudflare Pages — connect GitHub

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Authorize GitHub → select repo `etienneverlinden-cmd/test_snake`
3. Production branch: `main` (after this feature is merged) or temporarily `feature/cloudflare-pages` for a dry run
4. Build settings as in the table above
5. **Save and Deploy**

Wait until the first deploy succeeds. You get a URL like `https://pragmatict.pages.dev`.

### 4. Attach custom domain

1. Pages project → **Custom domains** → **Set up a domain**
2. Add `pragmatict.be` and `www.pragmatict.be`
3. Cloudflare will create the right DNS records automatically (usually `CNAME` to `*.pages.dev`)

SSL is automatic on Pages.

### 5. Smoke-test before cutting Hetzner traffic

While DNS still propagates, open:

- `https://pragmatict.pages.dev`
- `https://pragmatict.pages.dev/arcade.html`
- `https://pragmatict.pages.dev/test/`

Check login, Google Connect, Loïc RDV (Convex must still work — it does not depend on Hetzner).

### 6. After cutover works

On Hetzner you can:

1. Leave Deck API / worker running if you still use Deck Studio
2. Optionally stop publishing the old static tree (`snake-deploy`) so you don’t maintain two copies
3. Later remove the pragmatict Caddy site block once you are confident

Update Convex `SITE_URL` only if needed — it should stay `https://pragmatict.be`.

## CLI alternative (no Git integration)

```bash
npx wrangler login
npm run deploy:pages
```

Then attach the custom domain in the Pages UI the same way.

## Rollback

At OVH, put the original OVH nameservers back (or set A record to `89.167.46.13` again if you managed DNS in Cloudflare and want to leave Cloudflare). Hetzner `/var/www/snake` can still serve the old site until you delete it.

## Checklist

- [ ] Cloudflare site added for `pragmatict.be`
- [ ] OVH nameservers → Cloudflare
- [ ] Pages project connected + first deploy green
- [ ] Custom domains `pragmatict.be` + `www`
- [ ] Smoke test Pages URL + apex domain
- [ ] Deck Studio still works (Hetzner API) if you use it
- [ ] Merge `feature/cloudflare-pages` to `main` when happy
