import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
].join(" ");

function siteUrl() {
  return (process.env.SITE_URL || "https://pragmatict.be").replace(/\/$/, "");
}

function convexSiteUrl() {
  return (process.env.CONVEX_SITE_URL || "").replace(/\/$/, "");
}

function googleClientId() {
  return (process.env.GOOGLE_CLIENT_ID || "").trim();
}

function googleClientSecret() {
  return (process.env.GOOGLE_CLIENT_SECRET || "").trim();
}

function redirectUri() {
  const base = convexSiteUrl();
  if (!base) {
    throw new Error("CONVEX_SITE_URL is missing on this deployment.");
  }
  return `${base}/google/callback`;
}

function newState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function buildLabel(profile: { accountName?: string; accountEmail?: string }) {
  const name = profile.accountName?.trim();
  if (name) return name.slice(0, 120);
  const email = profile.accountEmail?.trim();
  if (email) return email.slice(0, 120);
  return "Google Calendar";
}

function publicConnection(doc: {
  _id: Id<"googleConnections">;
  label: string;
  status: string;
  accountEmail?: string;
  accountName?: string;
  lastError?: string;
  calendarId?: string;
  calendarSummary?: string;
  createdAt: number;
  updatedAt: number;
  createdByUserId: Id<"users">;
}) {
  return {
    id: doc._id,
    label: doc.label,
    status: doc.status,
    accountEmail: doc.accountEmail ?? null,
    accountName: doc.accountName ?? null,
    lastError: doc.lastError ?? null,
    calendarId: doc.calendarId ?? null,
    calendarSummary: doc.calendarSummary ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdByUserId: doc.createdByUserId,
    hasCalendar: !!doc.calendarId,
  };
}

async function requireApproved(ctx: {
  db: {
    get: (id: Id<"users">) => Promise<any>;
    query: (table: "memberAccess") => any;
  };
}): Promise<{ userId: Id<"users">; email: string }> {
  const userId = await getAuthUserId(ctx as any);
  if (!userId) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Not authenticated");
  const access = await ctx.db
    .query("memberAccess")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique();
  if (!access || access.status !== "approved") {
    throw new Error("Membership not approved");
  }
  return { userId, email: (user.email || "").trim().toLowerCase() };
}

export const listConnections = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const access = await ctx.db
      .query("memberAccess")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!access || access.status !== "approved") return [];

    const rows = await ctx.db.query("googleConnections").order("desc").take(100);
    return rows
      .filter((r) => r.status !== "disconnected")
      .map(publicConnection);
  },
});

export const getConnection = query({
  args: { connectionId: v.id("googleConnections") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const access = await ctx.db
      .query("memberAccess")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!access || access.status !== "approved") return null;
    const doc = await ctx.db.get(args.connectionId);
    if (!doc || doc.status === "disconnected") return null;
    return publicConnection(doc);
  },
});

export const startConnect = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireApproved(ctx);

    const clientId = googleClientId();
    if (!clientId) {
      throw new Error(
        "GOOGLE_CLIENT_ID is not set on Convex. See docs/google-connect/README.md",
      );
    }
    if (!googleClientSecret()) {
      throw new Error(
        "GOOGLE_CLIENT_SECRET is not set on Convex. See docs/google-connect/README.md",
      );
    }

    const oauthState = newState();
    const now = Date.now();
    const connectionId = await ctx.db.insert("googleConnections", {
      createdByUserId: userId,
      label: "Connecting…",
      status: "pending_oauth",
      oauthState,
      createdAt: now,
      updatedAt: now,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "true",
      state: oauthState,
    });

    return {
      connectionId,
      authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    };
  },
});

export const disconnect = mutation({
  args: { connectionId: v.id("googleConnections") },
  handler: async (ctx, args) => {
    await requireApproved(ctx);
    const doc = await ctx.db.get(args.connectionId);
    if (!doc) throw new Error("Connection not found");
    await ctx.db.patch(args.connectionId, {
      status: "disconnected",
      refreshToken: undefined,
      accessToken: undefined,
      accessTokenExpiresAt: undefined,
      oauthState: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const selectCalendar = mutation({
  args: {
    connectionId: v.id("googleConnections"),
    calendarId: v.string(),
    calendarSummary: v.string(),
  },
  handler: async (ctx, args) => {
    await requireApproved(ctx);
    const doc = await ctx.db.get(args.connectionId);
    if (!doc || doc.status !== "connected") {
      throw new Error("Connection is not ready");
    }
    await ctx.db.patch(args.connectionId, {
      calendarId: args.calendarId.trim(),
      calendarSummary: args.calendarSummary.trim().slice(0, 200),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const clearCalendar = mutation({
  args: { connectionId: v.id("googleConnections") },
  handler: async (ctx, args) => {
    await requireApproved(ctx);
    const doc = await ctx.db.get(args.connectionId);
    if (!doc) throw new Error("Connection not found");
    await ctx.db.patch(args.connectionId, {
      calendarId: undefined,
      calendarSummary: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const internalGetByState = internalQuery({
  args: { oauthState: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("googleConnections")
      .withIndex("by_oauth_state", (q) => q.eq("oauthState", args.oauthState))
      .unique();
  },
});

export const internalGet = internalQuery({
  args: { connectionId: v.id("googleConnections") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.connectionId);
  },
});

export const internalMemberAccess = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("memberAccess")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

export const internalFindConnectedByEmail = internalQuery({
  args: {
    accountEmail: v.string(),
    excludeId: v.id("googleConnections"),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("googleConnections")
      .withIndex("by_email", (q) => q.eq("accountEmail", args.accountEmail))
      .collect();
    return (
      rows.find(
        (r) =>
          r._id !== args.excludeId &&
          r.status === "connected" &&
          !!r.refreshToken,
      ) ?? null
    );
  },
});

export const internalAbsorbPending = internalMutation({
  args: { pendingId: v.id("googleConnections") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.pendingId, {
      status: "disconnected",
      oauthState: undefined,
      refreshToken: undefined,
      accessToken: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const internalSaveTokens = internalMutation({
  args: {
    connectionId: v.id("googleConnections"),
    refreshToken: v.optional(v.string()),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
    scope: v.optional(v.string()),
    accountEmail: v.optional(v.string()),
    accountName: v.optional(v.string()),
    label: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("pending_oauth"),
        v.literal("connected"),
        v.literal("error"),
        v.literal("disconnected"),
      ),
    ),
    clearOauthState: v.boolean(),
    calendarId: v.optional(v.string()),
    calendarSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      updatedAt: Date.now(),
    };
    if (args.refreshToken) patch.refreshToken = args.refreshToken;
    if (args.scope !== undefined) patch.scope = args.scope;
    if (args.accountEmail !== undefined) patch.accountEmail = args.accountEmail;
    if (args.accountName !== undefined) patch.accountName = args.accountName;
    if (args.label !== undefined) patch.label = args.label;
    if (args.status !== undefined) patch.status = args.status;
    if (args.clearOauthState) patch.oauthState = undefined;
    if (args.calendarId !== undefined) patch.calendarId = args.calendarId;
    if (args.calendarSummary !== undefined) {
      patch.calendarSummary = args.calendarSummary;
    }
    await ctx.db.patch(args.connectionId, patch);
  },
});

export const internalMarkError = internalMutation({
  args: {
    connectionId: v.id("googleConnections"),
    lastError: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      status: "error",
      lastError: args.lastError,
      oauthState: undefined,
      updatedAt: Date.now(),
    });
  },
});

async function exchangeCode(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || "Google token exchange failed",
    );
  }
  return data;
}

async function refreshAccess(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || "Google token refresh failed",
    );
  }
  return data;
}

async function loadProfile(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as {
    email?: string;
    name?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message || "Could not load Google profile");
  }
  return {
    accountEmail: data.email?.toLowerCase(),
    accountName: data.name,
  };
}

async function gcalGet(accessToken: string, path: string) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    const msg =
      (data as any)?.error?.message ||
      `Google Calendar API error (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export const oauthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const studio = `${siteUrl()}/google-studio.html`;

  if (err) {
    const dest = new URL(studio);
    dest.searchParams.set("error", err);
    return Response.redirect(dest.toString(), 302);
  }
  if (!code || !state) {
    const dest = new URL(studio);
    dest.searchParams.set("error", "Missing OAuth code or state");
    return Response.redirect(dest.toString(), 302);
  }

  const connection = await ctx.runQuery(internal.googleConnect.internalGetByState, {
    oauthState: state,
  });
  if (!connection) {
    const dest = new URL(studio);
    dest.searchParams.set("error", "Unknown or expired OAuth state");
    return Response.redirect(dest.toString(), 302);
  }

  try {
    if (!googleClientId() || !googleClientSecret()) {
      throw new Error("Google app credentials are not configured");
    }
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token && !connection.refreshToken) {
      // First connect must get refresh_token; prompt=consent should ensure it
      throw new Error(
        "Google did not return a refresh token. Revoke the app in your Google Account and try again.",
      );
    }
    const profile = await loadProfile(tokens.access_token!);
    const label = buildLabel(profile);

    let targetId = connection._id;
    if (profile.accountEmail) {
      const existing = await ctx.runQuery(
        internal.googleConnect.internalFindConnectedByEmail,
        { accountEmail: profile.accountEmail, excludeId: connection._id },
      );
      if (existing) {
        targetId = existing._id;
        await ctx.runMutation(internal.googleConnect.internalAbsorbPending, {
          pendingId: connection._id,
        });
      }
    }

    // Default to primary calendar
    let calendarId = "primary";
    let calendarSummary = "Primary";
    try {
      const primary = await gcalGet(tokens.access_token!, "/calendars/primary");
      calendarId = (primary.id as string) || "primary";
      calendarSummary = (primary.summary as string) || "Primary";
    } catch {
      /* keep defaults */
    }

    await ctx.runMutation(internal.googleConnect.internalSaveTokens, {
      connectionId: targetId,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token!,
      accessTokenExpiresAt: Date.now() + ((tokens.expires_in || 3600) - 60) * 1000,
      scope: tokens.scope,
      accountEmail: profile.accountEmail,
      accountName: profile.accountName,
      label,
      status: "connected",
      clearOauthState: true,
      calendarId,
      calendarSummary,
    });

    const dest = new URL(studio);
    dest.searchParams.set("connected", targetId);
    return Response.redirect(dest.toString(), 302);
  } catch (e) {
    const message = e instanceof Error ? e.message : "OAuth failed";
    await ctx.runMutation(internal.googleConnect.internalMarkError, {
      connectionId: connection._id,
      lastError: message,
    });
    const dest = new URL(studio);
    dest.searchParams.set("error", message);
    dest.searchParams.set("connection", connection._id);
    return Response.redirect(dest.toString(), 302);
  }
});

async function requireApprovedAction(ctx: any): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const access = await ctx.runQuery(internal.googleConnect.internalMemberAccess, {
    userId,
  });
  if (!access || access.status !== "approved") {
    throw new Error("Membership not approved");
  }
  return userId;
}

async function getValidAccessToken(
  ctx: any,
  connectionId: Id<"googleConnections">,
): Promise<string> {
  const doc = await ctx.runQuery(internal.googleConnect.internalGet, {
    connectionId,
  });
  if (!doc || doc.status !== "connected") {
    throw new Error("Connection is not connected");
  }
  if (!doc.refreshToken && !doc.accessToken) {
    throw new Error("Connection has no tokens — reconnect");
  }

  const stillValid =
    doc.accessToken &&
    doc.accessTokenExpiresAt &&
    doc.accessTokenExpiresAt > Date.now() + 30_000;

  if (stillValid && doc.accessToken) return doc.accessToken;

  if (!doc.refreshToken) {
    throw new Error("Access token expired and no refresh token — reconnect");
  }

  const tokens = await refreshAccess(doc.refreshToken);
  await ctx.runMutation(internal.googleConnect.internalSaveTokens, {
    connectionId,
    refreshToken: tokens.refresh_token || doc.refreshToken,
    accessToken: tokens.access_token!,
    accessTokenExpiresAt:
      Date.now() + ((tokens.expires_in || 3600) - 60) * 1000,
    scope: tokens.scope || doc.scope,
    status: "connected",
    clearOauthState: false,
  });
  return tokens.access_token!;
}

export const listCalendars = action({
  args: { connectionId: v.id("googleConnections") },
  handler: async (ctx, args) => {
    await requireApprovedAction(ctx);
    const token = await getValidAccessToken(ctx, args.connectionId);
    const data = await gcalGet(
      token,
      "/users/me/calendarList?minAccessRole=writer&maxResults=50",
    );
    return (data.items || []).map((c: any) => ({
      id: c.id as string,
      summary: (c.summary || c.id) as string,
      primary: !!c.primary,
      accessRole: (c.accessRole || "") as string,
    }));
  },
});

export const testAccess = action({
  args: { connectionId: v.id("googleConnections") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: true;
    email: string | null;
    calendarId: string;
    calendarSummary: string;
    upcomingCount: number;
  }> => {
    await requireApprovedAction(ctx);
    const doc = await ctx.runQuery(internal.googleConnect.internalGet, {
      connectionId: args.connectionId,
    });
    if (!doc || doc.status !== "connected") {
      throw new Error("Connection is not connected");
    }
    const token = await getValidAccessToken(ctx, args.connectionId);
    const calendarId = doc.calendarId || "primary";
    const cal = await gcalGet(
      token,
      `/calendars/${encodeURIComponent(calendarId)}`,
    );
    const now = new Date().toISOString();
    const events = await gcalGet(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(now)}&maxResults=5&singleEvents=true&orderBy=startTime`,
    );
    return {
      ok: true,
      email: doc.accountEmail || null,
      calendarId: (cal.id as string) || calendarId,
      calendarSummary: (cal.summary as string) || doc.calendarSummary || calendarId,
      upcomingCount: (events.items || []).length,
    };
  },
});
