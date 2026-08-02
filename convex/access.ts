import {
  httpAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

function siteUrl() {
  return (process.env.SITE_URL || "https://pragmatict.be").replace(/\/$/, "");
}

/** Convex injects CONVEX_SITE_URL (*.convex.site) — do not `npx convex env set` it. */
function convexSiteUrl() {
  return (process.env.CONVEX_SITE_URL || "").replace(/\/$/, "");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Exact match only (trimmed, case-insensitive). No substring/domain matching. */
function adminEmail() {
  return normalizeEmail(process.env.ADMIN_EMAIL || "");
}

function isAdminEmail(email: string) {
  const admin = adminEmail();
  return !!admin && normalizeEmail(email) === admin;
}

function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function decideLinks(token: string) {
  const base = convexSiteUrl();
  if (!base) {
    throw new Error(
      "Built-in CONVEX_SITE_URL is missing (expected on every Convex deployment).",
    );
  }
  return {
    approve: `${base}/access/decide?token=${token}&decision=approve`,
    deny: `${base}/access/decide?token=${token}&decision=deny`,
  };
}

/** Current membership status for the signed-in user (creates pending request if needed). */
export const ensureAndGet = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Not authenticated");

    const email = normalizeEmail(user.email || "");
    if (!email) throw new Error("Account has no email");

    const existing = await ctx.db
      .query("memberAccess")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const isAdmin = isAdminEmail(email);

    if (!existing) {
      const token = newToken();
      if (isAdmin) {
        const id = await ctx.db.insert("memberAccess", {
          userId,
          email,
          name: user.name,
          status: "approved",
          denyCount: 0,
          decisionToken: token,
          requestedAt: Date.now(),
          decidedAt: Date.now(),
        });
        return { status: "approved" as const, accessId: id, denyCount: 0 };
      }

      const id = await ctx.db.insert("memberAccess", {
        userId,
        email,
        name: user.name,
        status: "pending",
        denyCount: 0,
        decisionToken: token,
        requestedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.access.notifyAdminPending, {
        accessId: id,
      });
      return { status: "pending" as const, accessId: id, denyCount: 0 };
    }

    // Admin email always wins (avoids lockout if row predates ADMIN_EMAIL).
    if (isAdmin && existing.status !== "approved") {
      await ctx.db.patch(existing._id, {
        status: "approved",
        email,
        name: user.name,
        decidedAt: Date.now(),
        decisionToken: newToken(),
      });
      return {
        status: "approved" as const,
        accessId: existing._id,
        denyCount: existing.denyCount,
      };
    }

    return {
      status: existing.status,
      accessId: existing._id,
      denyCount: existing.denyCount,
    };
  },
});

/** Re-request after a first denial. */
export const requestAgain = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("memberAccess")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (!existing) {
      throw new Error("No prior access request");
    }
    if (existing.status === "unauthorized") {
      throw new Error("Access permanently denied");
    }
    if (existing.status === "approved") {
      return { status: "approved" as const };
    }
    if (existing.status === "pending") {
      return { status: "pending" as const };
    }
    if (existing.status !== "denied" || existing.denyCount >= 2) {
      throw new Error("Cannot request access again");
    }

    const token = newToken();
    await ctx.db.patch(existing._id, {
      status: "pending",
      decisionToken: token,
      requestedAt: Date.now(),
      name: user.name,
      email: normalizeEmail(user.email || existing.email),
    });
    await ctx.scheduler.runAfter(0, internal.access.notifyAdminPending, {
      accessId: existing._id,
    });
    return { status: "pending" as const };
  },
});

/** Inspect membership rows by email (ops / `npx convex run`). */
export const listByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const rows = await ctx.db
      .query("memberAccess")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    return rows.map((r) => ({
      id: r._id,
      userId: r.userId,
      email: r.email,
      status: r.status,
      denyCount: r.denyCount,
      requestedAt: r.requestedAt,
      decidedAt: r.decidedAt,
    }));
  },
});

/**
 * Reset membership for an email to pending (or delete if remove=true).
 * Does not touch ADMIN_EMAIL accounts.
 *
 * Example:
 *   npx convex run access:resetByEmail '{"email":"user@example.com"}' --push
 */
export const resetByEmail = internalMutation({
  args: {
    email: v.string(),
    remove: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!email) throw new Error("email required");
    if (isAdminEmail(email)) {
      throw new Error("Refusing to reset ADMIN_EMAIL membership");
    }

    const rows = await ctx.db
      .query("memberAccess")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();

    if (rows.length === 0) {
      return { ok: true as const, matched: 0, action: "none" as const };
    }

    if (args.remove) {
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      return {
        ok: true as const,
        matched: rows.length,
        action: "deleted" as const,
      };
    }

    for (const row of rows) {
      await ctx.db.patch(row._id, {
        status: "pending",
        denyCount: 0,
        decisionToken: newToken(),
        requestedAt: Date.now(),
      });
    }
    return {
      ok: true as const,
      matched: rows.length,
      action: "pending" as const,
    };
  },
});

export const notifyAdminPending = internalMutation({
  args: { accessId: v.id("memberAccess") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.accessId);
    if (!row || row.status !== "pending") return;

    const admin = adminEmail();
    if (!admin) {
      console.error("ADMIN_EMAIL is not set; cannot notify admin");
      return;
    }

    const links = decideLinks(row.decisionToken);
    const who = row.name ? `${row.name} <${row.email}>` : row.email;
    const attempt =
      row.denyCount === 0 ? "first request" : "second request (final)";

    await ctx.scheduler.runAfter(0, internal.email.send, {
      to: admin,
      subject: `[PragmatICT] Access request — ${row.email}`,
      text:
        `A user requested access to My Pragmatict (${attempt}).\n\n` +
        `User: ${who}\n\n` +
        `Approve:\n${links.approve}\n\n` +
        `Deny:\n${links.deny}\n`,
      html:
        `<p>A user requested access to <strong>My Pragmatict</strong> (${attempt}).</p>` +
        `<p><strong>User:</strong> ${escapeHtml(who)}</p>` +
        `<p><a href="${links.approve}">Approve access</a></p>` +
        `<p><a href="${links.deny}">Deny access</a></p>`,
    });
  },
});

export const applyDecision = internalMutation({
  args: {
    token: v.string(),
    decision: v.union(v.literal("approve"), v.literal("deny")),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("memberAccess")
      .withIndex("by_token", (q) => q.eq("decisionToken", args.token))
      .unique();

    if (!row) {
      return { ok: false as const, reason: "invalid" as const };
    }
    if (row.status === "approved") {
      return { ok: true as const, status: "approved" as const, email: row.email };
    }
    if (row.status === "unauthorized") {
      return {
        ok: true as const,
        status: "unauthorized" as const,
        email: row.email,
      };
    }
    if (row.status !== "pending") {
      return { ok: false as const, reason: "not_pending" as const, status: row.status };
    }

    if (args.decision === "approve") {
      await ctx.db.patch(row._id, {
        status: "approved",
        decidedAt: Date.now(),
        decisionToken: newToken(),
      });
      await ctx.scheduler.runAfter(0, internal.email.send, {
        to: row.email,
        subject: "My Pragmatict access granted",
        text:
          `Your access to My Pragmatict has been approved.\n\n` +
          `Sign in here:\n${siteUrl()}/login.html?next=arcade.html\n`,
        html:
          `<p>Your access to <strong>My Pragmatict</strong> has been approved.</p>` +
          `<p><a href="${siteUrl()}/login.html?next=arcade.html">Sign in</a></p>`,
      });
      return { ok: true as const, status: "approved" as const, email: row.email };
    }

    const denyCount = row.denyCount + 1;
    if (denyCount >= 2) {
      await ctx.db.patch(row._id, {
        status: "unauthorized",
        denyCount,
        decidedAt: Date.now(),
        decisionToken: newToken(),
      });
      await ctx.scheduler.runAfter(0, internal.email.send, {
        to: row.email,
        subject: "My Pragmatict access denied",
        text:
          `Your request for My Pragmatict access was denied a second time.\n` +
          `Access is not authorised for this account.\n`,
      });
      return {
        ok: true as const,
        status: "unauthorized" as const,
        email: row.email,
      };
    }

    await ctx.db.patch(row._id, {
      status: "denied",
      denyCount,
      decidedAt: Date.now(),
      decisionToken: newToken(),
    });
    await ctx.scheduler.runAfter(0, internal.email.send, {
      to: row.email,
      subject: "My Pragmatict access denied",
      text:
        `Your request for My Pragmatict access was denied.\n\n` +
        `You may request access one more time from the website after signing in.\n` +
        `${siteUrl()}/login.html?next=arcade.html\n`,
    });
    return { ok: true as const, status: "denied" as const, email: row.email };
  },
});

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const decideHttp = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const decision = url.searchParams.get("decision");
  if (!token || (decision !== "approve" && decision !== "deny")) {
    return htmlResponse(
      400,
      "Invalid link",
      "<p>This approval link is missing parameters.</p>",
    );
  }

  const result = await ctx.runMutation(internal.access.applyDecision, {
    token,
    decision,
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      return htmlResponse(
        404,
        "Unknown request",
        "<p>This approval link is invalid or has already been used.</p>",
      );
    }
    return htmlResponse(
      409,
      "Already decided",
      `<p>This request is no longer pending (status: ${escapeHtml(String(result.status))}).</p>`,
    );
  }

  if (result.status === "approved") {
    return htmlResponse(
      200,
      "Approved",
      `<p>Access approved for <strong>${escapeHtml(result.email)}</strong>. They will receive a confirmation email.</p>`,
    );
  }
  if (result.status === "denied") {
    return htmlResponse(
      200,
      "Denied",
      `<p>Access denied for <strong>${escapeHtml(result.email)}</strong> (they may request once more).</p>`,
    );
  }
  return htmlResponse(
    200,
    "Unauthorised",
    `<p>Access permanently denied for <strong>${escapeHtml(result.email)}</strong>.</p>`,
  );
});

function htmlResponse(status: number, title: string, body: string) {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} — PragmatICT</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1.25rem;color:#121212;line-height:1.5}a{color:#be1622}</style></head>
<body><h1>${title}</h1>${body}<p><a href="${siteUrl()}/">Back to PragmatICT</a></p></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
