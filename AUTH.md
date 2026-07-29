# Auth setup (Stijn Arcade)

The arcade is locked behind **Convex Auth**:

- **Google** → play immediately after sign-in  
- **Email + password** → must enter the confirmation code from email before playing  

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

## 5. Deploy Convex functions

```bash
npx convex dev
# or
npx convex deploy
```

## 6. Test locally

```bash
npm run dev:site
```

Open `http://localhost:8080/login.html`.
