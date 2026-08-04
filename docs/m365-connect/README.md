# M365 Connect studio

Connect a **customer’s** Microsoft 365 so PragmatICT can work in a SharePoint site or OneDrive folder they authorize.

This is **delegated OAuth**: a customer admin or file owner signs in at Microsoft and consents. You never type their password. Access is limited to what that signed-in account can already see.

## What was built

| Piece | Role |
|-------|------|
| `m365-studio.html` + `js/m365-studio.js` | Studio UI (arcade tile → connect → pick location) |
| `convex/m365.ts` | OAuth start, callback, token refresh, Graph helpers |
| `convex/http.ts` → `/m365/callback` | Microsoft redirect URI |
| `m365Connections` table | Labels, tokens, selected site/folder |

## One-time: Entra app (PragmatICT tenant)

1. [Entra admin center](https://entra.microsoft.com) → **App registrations** → **New registration**
2. Name: e.g. `PragmatICT M365 Connect`
3. Supported account types: **Accounts in any organizational directory (multitenant)**
4. Redirect URI (Web):

   ```
   https://limitless-duck-213.convex.site/m365/callback
   ```

   (Use your Convex **HTTP** / `.convex.site` URL, not the `.cloud` URL.)

5. **Certificates & secrets** → New client secret → copy the value once
6. **API permissions** → Microsoft Graph → **Delegated**:

   - `User.Read`
   - `Sites.ReadWrite.All`
   - `Files.ReadWrite.All`

7. No admin consent needed in *your* tenant for customers; **each customer** consents when they connect (their admin may need to approve the app if user consent is disabled).

## Convex env (duck / live backend)

```bash
npx convex env set MICROSOFT_CLIENT_ID "<application (client) id>"
npx convex env set MICROSOFT_CLIENT_SECRET "<client secret value>"
```

`SITE_URL` must already be set (used to send the browser back to the studio):

- Local: `http://localhost:8080`
- Production: `https://pragmatict.be`

Ship functions:

```bash
npx convex dev --once
```

Do **not** use `npx convex deploy` for pragmatict.be (wrong deployment slot).

## How to use

1. Open **My Pragmatict** → **M365 Connect**
2. Enter a customer label → **Connect Microsoft 365**
3. Customer (admin or owner) signs in at Microsoft → **Accept**
4. Back in the studio: **Pick SharePoint site** (search) or **Use their OneDrive**
5. Browse to a folder → **Use this folder**
6. **Test access** to confirm Graph can open it

Disconnect removes stored tokens. Customers can also revoke the app under Enterprise applications in their tenant.

## Security notes

- Client secret lives only in Convex env — never in static JS.
- Refresh tokens are stored in Convex (`m365Connections`). Treat the deployment as sensitive.
- Any **approved** My Pragmatict member can see/use connections (small-team tool). Tighten later if needed.
- Broad delegated scopes are intentional for MVP; a later hardening path is `Sites.Selected` + admin site grants.
