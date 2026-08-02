# Auth setup (My Pragmatict)

The site is locked behind **Convex Auth**, then a **membership approval** gate:

1. User signs in (Google or email + password + confirmation code).
2. First visit creates an access request → **you** get an email with Approve / Deny links.
3. Approve → user gets an email and can use My Pragmatict.
4. Deny once → user can request again from the denied page.
5. Deny a second time → status becomes **unauthorized** (no further requests).

The address in `ADMIN_EMAIL` is auto-approved on first login (so you are never locked out).

`main` auto-deploys the static site. Keep this work on a feature branch until you are ready to ship.

## 1. JWT keys (required once)

Generate keys (already done if you ran setup) and set them on the Convex deployment:

```bash
npx convex env set JWT_PRIVATE_KEY "<paste private key one line>"
npx convex env set JWKS "<paste jwks json>"
```

Or run `npx @convex-dev/auth --web-server-url http://localhost:8080` and follow prompts.

## 2. Site URL (OAuth return URL)

Local:

```bash
npx convex env set SITE_URL http://localhost:8080
```

Production (when shipping):

```bash
npx convex env set SITE_URL https://pragmatict.be
```

## 3. Google OAuth

1. Google Cloud Console → Credentials → OAuth 2.0 Client (Web)  
2. Authorized redirect URI (use your Convex **site** URL, not `.cloud`):

   `https://limitless-duck-213.convex.site/api/auth/callback/google`

3. Set env vars:

```bash
npx convex env set AUTH_GOOGLE_ID "<client id>"
npx convex env set AUTH_GOOGLE_SECRET "<client secret>"
```

## 4. Resend (email confirmation codes)

1. Create a free [Resend](https://resend.com) API key  
2. Set it on Convex:

```bash
npx convex env set AUTH_RESEND_KEY "re_..."
```

Emails are sent via Resend’s HTTP API (no Resend npm package required).

Optional custom from-address (needs a verified domain in Resend):

```bash
npx convex env set AUTH_EMAIL_FROM "Stijn Arcade <noreply@yourdomain.com>"
```

Until a domain is verified, Resend’s `onboarding@resend.dev` only delivers to your Resend account email.

## 5. Membership admin email (required)

```bash
npx convex env set ADMIN_EMAIL "you@yourdomain.com"
```

Approve/deny links in admin emails use Convex’s built-in `CONVEX_SITE_URL` (`https://….convex.site/access/decide?...`).  
That value is injected automatically — do **not** run `npx convex env set CONVEX_SITE_URL` (Convex rejects it as `EnvVarNameForbidden`).  
User grant emails use `SITE_URL` (link to `/login.html?next=arcade.html`).

Also ensure `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` are set (same as auth emails).

**Required before the gate works:** if `ADMIN_EMAIL` is missing, new users become `pending` but no admin email is sent.

## 6. Deploy Convex functions

```bash
npx convex dev
# or
npx convex deploy
```

## 7. Test locally

```bash
npx convex dev
npm run dev:site
```

Open `http://localhost:8080/login.html`.

**Access gate checklist**

1. Sign in as a non-admin → redirected to `access-pending.html`; admin receives Approve/Deny email.
2. Click Approve → user gets grant email; pending page (or next visit) opens My Pragmatict.
3. Deny once → user sees `access-denied.html` and can request again.
4. Deny the second request → `access-blocked.html` (permanent).
5. Sign in as `ADMIN_EMAIL` → auto-approved, no pending gate.