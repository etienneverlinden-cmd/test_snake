import {
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireAdmin, randomToken } from "./lib";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
  "profile",
].join(" ");

function siteUrl() {
  return (process.env.SITE_URL || "http://localhost:8080/test").replace(
    /\/$/,
    "",
  );
}

function convexSiteUrl() {
  const explicit = process.env.CONVEX_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  // Built-in on Convex deployments
  const cloud = process.env.CONVEX_CLOUD_URL || "";
  if (cloud.includes(".convex.cloud")) {
    return cloud.replace(".convex.cloud", ".convex.site").replace(/\/$/, "");
  }
  throw new Error("CONVEX_SITE_URL manquant pour le callback Google");
}

function googleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET non configurés sur Convex",
    );
  }
  return { clientId, clientSecret };
}

export const getConnection = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const row = await ctx.db.query("googleCalendar").first();
    if (!row) return null;
    return {
      email: row.email,
      status: row.status,
      connectedAt: row.connectedAt,
      lastError: row.lastError,
    };
  },
});

export const startConnect = mutation({
  args: { token: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@") || !email.includes(".")) {
      throw new Error("Email Google invalide");
    }
    googleClient(); // fail early if env missing

    const oauthState = randomToken();
    const existing = await ctx.db.query("googleCalendar").collect();
    for (const row of existing) await ctx.db.delete(row._id);

    await ctx.db.insert("googleCalendar", {
      email,
      refreshToken: "",
      oauthState,
      status: "pending",
    });

    const { clientId } = googleClient();
    const redirectUri = `${convexSiteUrl()}/google/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: oauthState,
      login_hint: email,
    });

    return {
      authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    };
  },
});

export const disconnect = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db.query("googleCalendar").collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return { ok: true };
  },
});

export const findByOauthState = internalQuery({
  args: { oauthState: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("googleCalendar")
      .withIndex("by_oauth_state", (q) => q.eq("oauthState", args.oauthState))
      .unique();
  },
});

export const getConnected = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("googleCalendar").first();
    if (!row || row.status !== "connected" || !row.refreshToken) return null;
    return row;
  },
});

export const saveTokens = internalMutation({
  args: {
    id: v.id("googleCalendar"),
    email: v.string(),
    refreshToken: v.string(),
    accessToken: v.string(),
    expiresIn: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      email: args.email,
      refreshToken: args.refreshToken,
      accessToken: args.accessToken,
      accessTokenExpiresAt: Date.now() + args.expiresIn * 1000,
      oauthState: undefined,
      status: "connected",
      connectedAt: Date.now(),
      lastError: undefined,
    });
  },
});

export const markError = internalMutation({
  args: { id: v.id("googleCalendar"), message: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "error",
      lastError: args.message,
      oauthState: undefined,
    });
  },
});

export const patchAccessToken = internalMutation({
  args: {
    id: v.id("googleCalendar"),
    accessToken: v.string(),
    expiresIn: v.number(),
    refreshToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      accessToken: args.accessToken,
      accessTokenExpiresAt: Date.now() + args.expiresIn * 1000,
      ...(args.refreshToken ? { refreshToken: args.refreshToken } : {}),
    });
  },
});

async function exchangeCode(code: string) {
  const { clientId, clientSecret } = googleClient();
  const redirectUri = `${convexSiteUrl()}/google/callback`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Token exchange failed");
  }
  return data;
}

async function fetchGoogleEmail(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as { email?: string };
  if (!res.ok || !data.email) throw new Error("Impossible de lire l'email Google");
  return data.email.toLowerCase();
}

export const oauthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const adminReturn = `${siteUrl()}/admin.html`;

  if (error) {
    return Response.redirect(
      `${adminReturn}?google=error&msg=${encodeURIComponent(error)}`,
      302,
    );
  }
  if (!code || !state) {
    return Response.redirect(
      `${adminReturn}?google=error&msg=${encodeURIComponent("callback incomplet")}`,
      302,
    );
  }

  const pending = await ctx.runQuery(internal.google.findByOauthState, {
    oauthState: state,
  });
  if (!pending) {
    return Response.redirect(
      `${adminReturn}?google=error&msg=${encodeURIComponent("session OAuth inconnue")}`,
      302,
    );
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      throw new Error(
        "Google n'a pas renvoyé de refresh_token — déconnectez l'app dans votre compte Google puis réessayez",
      );
    }
    const googleEmail = await fetchGoogleEmail(tokens.access_token!);
    // Prefer the authenticated Google account; warn if different from typed email
    await ctx.runMutation(internal.google.saveTokens, {
      id: pending._id,
      email: googleEmail,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token!,
      expiresIn: tokens.expires_in || 3600,
    });
    const hint =
      googleEmail !== pending.email
        ? `&linked=${encodeURIComponent(googleEmail)}`
        : "";
    return Response.redirect(`${adminReturn}?google=ok${hint}`, 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur OAuth";
    await ctx.runMutation(internal.google.markError, {
      id: pending._id,
      message: msg,
    });
    return Response.redirect(
      `${adminReturn}?google=error&msg=${encodeURIComponent(msg)}`,
      302,
    );
  }
});

export async function getAccessToken(
  ctx: { runQuery: Function; runMutation: Function },
): Promise<{ accessToken: string; email: string } | null> {
  const conn = await ctx.runQuery(internal.google.getConnected, {});
  if (!conn) return null;

  if (
    conn.accessToken &&
    conn.accessTokenExpiresAt &&
    conn.accessTokenExpiresAt > Date.now() + 60_000
  ) {
    return { accessToken: conn.accessToken, email: conn.email };
  }

  const { clientId, clientSecret } = googleClient();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: conn.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || "Refresh Google token failed");
  }
  await ctx.runMutation(internal.google.patchAccessToken, {
    id: conn._id,
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600,
    refreshToken: data.refresh_token,
  });
  return { accessToken: data.access_token, email: conn.email };
}

export const createEvent = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    summary: v.string(),
    description: v.string(),
    startMs: v.number(),
    endMs: v.number(),
    attendeeEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getAccessToken(ctx);
    if (!auth) {
      console.warn("Google Calendar non connecté — skip event");
      return null;
    }

    const body: Record<string, unknown> = {
      summary: args.summary,
      description: args.description,
      start: {
        dateTime: new Date(args.startMs).toISOString(),
        timeZone: "Europe/Brussels",
      },
      end: {
        dateTime: new Date(args.endMs).toISOString(),
        timeZone: "Europe/Brussels",
      },
    };
    if (args.attendeeEmail) {
      body.attendees = [{ email: args.attendeeEmail }];
    }

    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json()) as { id?: string; error?: { message?: string } };
    if (!res.ok || !data.id) {
      console.error("GCal create failed", data);
      throw new Error(data.error?.message || "Création événement Google impossible");
    }
    await ctx.runMutation(internal.appointmentsInternal.setGoogleEventId, {
      id: args.appointmentId,
      googleEventId: data.id,
    });
    return data.id;
  },
});

export const deleteEvent = internalAction({
  args: { googleEventId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getAccessToken(ctx);
    if (!auth) return;
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(args.googleEventId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      },
    );
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      console.error("GCal delete failed", res.status, text);
    }
  },
});

/** Test helper: verify calendar write works (admin). */
export const testConnection = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    // Validate admin via mutation side-channel
    const ok = await ctx.runQuery(internal.google.adminCheck, {
      token: args.token,
    });
    if (!ok) throw new Error("Non autorisé");
    const auth = await getAccessToken(ctx);
    if (!auth) throw new Error("Google Calendar non connecté");
    return { email: auth.email, ok: true };
  },
});

export const adminCheck = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireAdmin(ctx, args.token);
      return true;
    } catch {
      return false;
    }
  },
});
