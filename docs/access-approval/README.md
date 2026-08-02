# Membership access approval

Operator docs for the **membership gate** on My Pragmatict: how it works, where the code lives, and how to change or ship it.

Auth identity (Google / email+password) is separate. This system answers: *“is this signed-in user allowed to use the product?”*

For Convex Auth setup (JWT, Google, Resend keys), see [`AUTH.md`](../../AUTH.md). For Convex project / deployment basics, see [`CONVEX.md`](../../CONVEX.md).

---

## Index

| Doc | Contents |
|-----|----------|
| **This file** | Purpose, quick map of files, status cheat-sheet |
| [`architecture.md`](./architecture.md) | Components, data model, client/server enforcement, emails, env vars |
| [`flows.md`](./flows.md) | End-to-end: request, approve, deny×2, admin bootstrap, HTTP decide |
| [`updating.md`](./updating.md) | How to change code/schema/env; local test; production ship checklist; pitfalls |

---

## 1. Purpose

My Pragmatict is locked behind two layers:

1. **Convex Auth** — user must sign in (`login.html`).
2. **Membership approval** (`memberAccess`) — after sign-in, status must be `approved` before arcade / games / Deck Studio APIs work.

You (admin) get an email with one-click Approve / Deny links. Users get confirmation (or denial) emails. A second denial makes the account permanently `unauthorized`.

The email in `ADMIN_EMAIL` is **auto-approved** so you are never locked out.

---

## 2. Quick file map

| Area | Path | Role |
|------|------|------|
| Schema | `convex/schema.ts` → `memberAccess` | Status, deny count, decision token |
| Core logic | `convex/access.ts` | `ensureAndGet`, `requestAgain`, notify, apply decision, HTTP handler |
| HTTP route | `convex/http.ts` | `GET /access/decide` |
| Emails | `convex/email.ts` | Resend send action |
| Viewer | `convex/users.ts` | `users:viewer` includes `accessStatus` |
| Scores | `convex/scores.ts` | Mutations/queries require `approved` |
| Client gate | `js/auth-guard.js` | Redirect by status |
| Status pages | `access-pending.html`, `access-denied.html`, `access-blocked.html` | UX for non-approved |
| Convex URL | `js/convex-config.js` | Live backend: `limitless-duck-213` |
| Deck API | `deploy/cursor-worker/deck-api.py` | Bearer + `accessStatus === "approved"` |

Protected pages that load `auth-guard.js`: `arcade.html`, `snake.html`, `frogger.html`, `deck-studio.html`, plus the three access pages themselves.

---

## 3. Status cheat-sheet

| Status | Meaning | User sees | Can request again? |
|--------|---------|-----------|--------------------|
| `pending` | Waiting for admin | `access-pending.html` | Already waiting |
| `approved` | Allowed | Arcade / games / Deck | N/A |
| `denied` | First denial (`denyCount === 1`) | `access-denied.html` | Yes (once) |
| `unauthorized` | Second denial (`denyCount >= 2`) | `access-blocked.html` | No |

---

## 4. Live vs unused Convex deployments

| Deployment | URL fragment | Used by site? | How to push functions |
|------------|--------------|---------------|------------------------|
| **Dev (live)** | `limitless-duck-213` | **Yes** — `js/convex-config.js` | `npm run deploy:convex` or `npx convex dev --once` |
| **Prod slot (unused)** | `brilliant-coyote-416` | **No** | `npx convex deploy` — **do not use** for pragmatict.be |

Static site on `main` auto-deploys to the VPS. Convex functions and Deck worker do **not** ride that rsync; see [`updating.md`](./updating.md).
