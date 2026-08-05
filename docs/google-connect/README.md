# Google Connect studio

Connect a **customer’s** Google Calendar so PragmatICT can work with events they authorize.

This is **delegated OAuth**: the customer signs in at Google and consents. You never type their password. Access is limited to calendars that account can write to.

## What was built

| Piece | Role |
|-------|------|
| `google-studio.html` + `js/google-studio.js` | Studio UI (arcade tile → connect → pick calendar) |
| `convex/googleConnect.ts` | OAuth start, callback, token refresh, Calendar helpers |
| `convex/http.ts` → `/google/callback` | Google redirect URI |
| `googleConnections` table | Labels, tokens, selected calendar |

## One-time: Google Cloud OAuth client

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a project
2. Enable **Google Calendar API**
3. **OAuth consent screen** (External) → add test users while in Testing
4. **Credentials** → OAuth client ID → **Web application**
5. Authorized redirect URI:

   ```
   https://limitless-duck-213.convex.site/google/callback
   ```

   (Convex **HTTP** / `.convex.site` URL, not `.cloud`.)

6. Copy Client ID and Client secret

If you already created a client for the Loïc test site, you can reuse it and **add** this redirect URI to the same client.

## Convex env (duck / live backend)

```bash
npx convex env set GOOGLE_CLIENT_ID "<client id>"
npx convex env set GOOGLE_CLIENT_SECRET "<client secret>"
```

`SITE_URL` must already be set (return URL after OAuth):

- Local: `http://localhost:8080`
- Production: `https://pragmatict.be`

Ship functions:

```bash
npx convex dev --once
```

Do **not** use `npx convex deploy` for pragmatict.be (wrong deployment slot).

## How to use

1. Open **My Pragmatict** → **Google Connect**
2. **Connect Google Calendar** → customer signs in at Google → Accept
3. Primary calendar is selected by default
4. **Choose calendar** to pick another writable calendar
5. **Test access** to confirm Calendar API works

Disconnect removes stored tokens. Customers can revoke the app under [Google Account → Third-party access](https://myaccount.google.com/permissions).

## Security notes

- Client secret lives only in Convex env — never in static JS.
- Refresh tokens are stored in Convex (`googleConnections`). Treat the deployment as sensitive.
- Any **approved** My Pragmatict member can see/use connections (small-team tool).
