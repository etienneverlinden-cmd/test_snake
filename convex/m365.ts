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

const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
  "Sites.ReadWrite.All",
  "Files.ReadWrite.All",
].join(" ");

function siteUrl() {
  return (process.env.SITE_URL || "https://pragmatict.be").replace(/\/$/, "");
}

function convexSiteUrl() {
  return (process.env.CONVEX_SITE_URL || "").replace(/\/$/, "");
}

function msClientId() {
  return (process.env.MICROSOFT_CLIENT_ID || "").trim();
}

function msClientSecret() {
  return (process.env.MICROSOFT_CLIENT_SECRET || "").trim();
}

function redirectUri() {
  const base = convexSiteUrl();
  if (!base) {
    throw new Error("CONVEX_SITE_URL is missing on this deployment.");
  }
  return `${base}/m365/callback`;
}

function newState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function buildConnectionLabel(profile: {
  tenantName?: string;
  accountName?: string;
  accountEmail?: string;
}) {
  const tenant = profile.tenantName?.trim();
  if (tenant) return tenant.slice(0, 120);
  const name = profile.accountName?.trim();
  if (name) return name.slice(0, 120);
  const email = profile.accountEmail?.trim();
  if (email) return email.slice(0, 120);
  return "Connected customer";
}

function publicConnection(doc: {
  _id: Id<"m365Connections">;
  label: string;
  status: string;
  tenantId?: string;
  tenantName?: string;
  accountEmail?: string;
  accountName?: string;
  lastError?: string;
  locationKind?: "sharepoint" | "onedrive";
  siteId?: string;
  siteName?: string;
  siteWebUrl?: string;
  driveId?: string;
  itemId?: string;
  itemName?: string;
  itemWebUrl?: string;
  createdAt: number;
  updatedAt: number;
  createdByUserId: Id<"users">;
}) {
  return {
    id: doc._id,
    label: doc.label,
    status: doc.status,
    tenantId: doc.tenantId ?? null,
    tenantName: doc.tenantName ?? null,
    accountEmail: doc.accountEmail ?? null,
    accountName: doc.accountName ?? null,
    lastError: doc.lastError ?? null,
    locationKind: doc.locationKind ?? null,
    siteId: doc.siteId ?? null,
    siteName: doc.siteName ?? null,
    siteWebUrl: doc.siteWebUrl ?? null,
    driveId: doc.driveId ?? null,
    itemId: doc.itemId ?? null,
    itemName: doc.itemName ?? null,
    itemWebUrl: doc.itemWebUrl ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdByUserId: doc.createdByUserId,
    hasLocation: !!(doc.driveId && doc.itemId),
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

    const rows = await ctx.db.query("m365Connections").order("desc").take(100);
    return rows
      .filter((r) => r.status !== "disconnected")
      .map(publicConnection);
  },
});

export const getConnection = query({
  args: { connectionId: v.id("m365Connections") },
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

/** Start delegated OAuth — customer admin/owner will sign in at Microsoft. */
export const startConnect = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireApproved(ctx);

    const clientId = msClientId();
    if (!clientId) {
      throw new Error(
        "MICROSOFT_CLIENT_ID is not set on Convex. See docs/m365-connect/README.md",
      );
    }
    if (!msClientSecret()) {
      throw new Error(
        "MICROSOFT_CLIENT_SECRET is not set on Convex. See docs/m365-connect/README.md",
      );
    }

    const oauthState = newState();
    const now = Date.now();
    const connectionId = await ctx.db.insert("m365Connections", {
      createdByUserId: userId,
      label: "Connecting…",
      status: "pending_oauth",
      oauthState,
      createdAt: now,
      updatedAt: now,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri(),
      response_mode: "query",
      scope: SCOPES,
      state: oauthState,
      prompt: "select_account",
    });

    return {
      connectionId,
      authorizeUrl: `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${params}`,
    };
  },
});

export const disconnect = mutation({
  args: { connectionId: v.id("m365Connections") },
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

export const selectLocation = mutation({
  args: {
    connectionId: v.id("m365Connections"),
    locationKind: v.union(v.literal("sharepoint"), v.literal("onedrive")),
    siteId: v.optional(v.string()),
    siteName: v.optional(v.string()),
    siteWebUrl: v.optional(v.string()),
    driveId: v.string(),
    itemId: v.string(),
    itemName: v.string(),
    itemWebUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireApproved(ctx);
    const doc = await ctx.db.get(args.connectionId);
    if (!doc || doc.status !== "connected") {
      throw new Error("Connection is not ready");
    }
    await ctx.db.patch(args.connectionId, {
      locationKind: args.locationKind,
      siteId: args.siteId,
      siteName: args.siteName,
      siteWebUrl: args.siteWebUrl,
      driveId: args.driveId,
      itemId: args.itemId,
      itemName: args.itemName,
      itemWebUrl: args.itemWebUrl,
      updatedAt: Date.now(),
      lastError: undefined,
    });
    return { ok: true };
  },
});

export const clearLocation = mutation({
  args: { connectionId: v.id("m365Connections") },
  handler: async (ctx, args) => {
    await requireApproved(ctx);
    const doc = await ctx.db.get(args.connectionId);
    if (!doc) throw new Error("Connection not found");
    await ctx.db.patch(args.connectionId, {
      locationKind: undefined,
      siteId: undefined,
      siteName: undefined,
      siteWebUrl: undefined,
      driveId: undefined,
      itemId: undefined,
      itemName: undefined,
      itemWebUrl: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const internalGetByState = internalQuery({
  args: { oauthState: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("m365Connections")
      .withIndex("by_oauth_state", (q) => q.eq("oauthState", args.oauthState))
      .unique();
  },
});

export const internalGet = internalQuery({
  args: { connectionId: v.id("m365Connections") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.connectionId);
  },
});

/** Existing live connection for the same Microsoft tenant (avoid duplicates). */
export const internalFindConnectedByTenant = internalQuery({
  args: {
    tenantId: v.string(),
    excludeId: v.optional(v.id("m365Connections")),
  },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("m365Connections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    return (
      matches.find(
        (row) =>
          row.status === "connected" &&
          row._id !== args.excludeId,
      ) ?? null
    );
  },
});

export const internalAbsorbPending = internalMutation({
  args: { pendingId: v.id("m365Connections") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.pendingId, {
      status: "disconnected",
      oauthState: undefined,
      refreshToken: undefined,
      accessToken: undefined,
      accessTokenExpiresAt: undefined,
      updatedAt: Date.now(),
    });
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

export const internalSaveTokens = internalMutation({
  args: {
    connectionId: v.id("m365Connections"),
    refreshToken: v.optional(v.string()),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
    scope: v.optional(v.string()),
    tenantId: v.optional(v.string()),
    tenantName: v.optional(v.string()),
    accountEmail: v.optional(v.string()),
    accountName: v.optional(v.string()),
    label: v.optional(v.string()),
    status: v.union(
      v.literal("connected"),
      v.literal("error"),
      v.literal("pending_oauth"),
    ),
    lastError: v.optional(v.string()),
    clearOauthState: v.boolean(),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.refreshToken) patch.refreshToken = args.refreshToken;
    if (args.scope !== undefined) patch.scope = args.scope;
    if (args.tenantId !== undefined) patch.tenantId = args.tenantId;
    if (args.tenantName !== undefined) patch.tenantName = args.tenantName;
    if (args.accountEmail !== undefined) patch.accountEmail = args.accountEmail;
    if (args.accountName !== undefined) patch.accountName = args.accountName;
    if (args.label !== undefined) patch.label = args.label;
    if (args.lastError !== undefined) patch.lastError = args.lastError;
    else if (args.status === "connected") patch.lastError = undefined;
    if (args.clearOauthState) patch.oauthState = undefined;
    await ctx.db.patch(args.connectionId, patch);
  },
});

export const internalMarkError = internalMutation({
  args: {
    connectionId: v.id("m365Connections"),
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
  const body = new URLSearchParams({
    client_id: msClientId(),
    client_secret: msClientSecret(),
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    scope: SCOPES,
  });
  const res = await fetch(
    "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      data.error_description || data.error || "Token exchange failed",
    );
  }
  return data as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
}

async function refreshAccess(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: msClientId(),
    client_secret: msClientSecret(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: SCOPES,
  });
  const res = await fetch(
    "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      data.error_description || data.error || "Token refresh failed",
    );
  }
  return data as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
}

async function graphGet(accessToken: string, path: string) {
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error_description ||
      `Graph error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function loadProfile(accessToken: string) {
  const me = await graphGet(
    accessToken,
    "/me?$select=displayName,mail,userPrincipalName",
  );
  let tenantName: string | undefined;
  let tenantId: string | undefined;
  try {
    const org = await graphGet(
      accessToken,
      "/organization?$select=id,displayName",
    );
    const first = org.value?.[0];
    if (first) {
      tenantId = first.id;
      tenantName = first.displayName;
    }
  } catch {
    /* org read may fail on some tenants; non-fatal */
  }
  return {
    accountEmail: me.mail || me.userPrincipalName || undefined,
    accountName: me.displayName || undefined,
    tenantId,
    tenantName,
  };
}

/** OAuth redirect target — exchange code, store tokens, return to studio. */
export const oauthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description");
  const studio = `${siteUrl()}/m365-studio.html`;

  if (err) {
    const dest = new URL(studio);
    dest.searchParams.set("error", errDesc || err);
    return Response.redirect(dest.toString(), 302);
  }

  if (!code || !state) {
    const dest = new URL(studio);
    dest.searchParams.set("error", "Missing OAuth code or state");
    return Response.redirect(dest.toString(), 302);
  }

  const connection = await ctx.runQuery(internal.m365.internalGetByState, {
    oauthState: state,
  });
  if (!connection) {
    const dest = new URL(studio);
    dest.searchParams.set("error", "Unknown or expired OAuth state");
    return Response.redirect(dest.toString(), 302);
  }

  try {
    if (!msClientId() || !msClientSecret()) {
      throw new Error("Microsoft app credentials are not configured");
    }
    const tokens = await exchangeCode(code);
    const profile = await loadProfile(tokens.access_token);
    const label = buildConnectionLabel(profile);

    let targetId = connection._id;
    if (profile.tenantId) {
      const existing = await ctx.runQuery(
        internal.m365.internalFindConnectedByTenant,
        { tenantId: profile.tenantId, excludeId: connection._id },
      );
      if (existing) {
        targetId = existing._id;
        await ctx.runMutation(internal.m365.internalAbsorbPending, {
          pendingId: connection._id,
        });
      }
    }

    await ctx.runMutation(internal.m365.internalSaveTokens, {
      connectionId: targetId,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: Date.now() + (tokens.expires_in - 60) * 1000,
      scope: tokens.scope,
      tenantId: profile.tenantId,
      tenantName: profile.tenantName,
      accountEmail: profile.accountEmail,
      accountName: profile.accountName,
      label,
      status: "connected",
      clearOauthState: true,
    });
    const dest = new URL(studio);
    dest.searchParams.set("connected", targetId);
    return Response.redirect(dest.toString(), 302);
  } catch (e) {
    const message = e instanceof Error ? e.message : "OAuth failed";
    await ctx.runMutation(internal.m365.internalMarkError, {
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
  const access = await ctx.runQuery(internal.m365.internalMemberAccess, {
    userId,
  });
  if (!access || access.status !== "approved") {
    throw new Error("Membership not approved");
  }
  return userId;
}

async function getValidAccessToken(
  ctx: any,
  connectionId: Id<"m365Connections">,
): Promise<string> {
  const doc = await ctx.runQuery(internal.m365.internalGet, { connectionId });
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
  await ctx.runMutation(internal.m365.internalSaveTokens, {
    connectionId,
    refreshToken: tokens.refresh_token || doc.refreshToken,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in - 60) * 1000,
    scope: tokens.scope || doc.scope,
    status: "connected",
    clearOauthState: false,
  });
  return tokens.access_token;
}

export const searchSites = action({
  args: {
    connectionId: v.id("m365Connections"),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    await requireApprovedAction(ctx);
    const token = await getValidAccessToken(ctx, args.connectionId);
    const q = args.query.trim() || "*";
    const data = await graphGet(
      token,
      `/sites?search=${encodeURIComponent(q)}&$select=id,name,displayName,webUrl`,
    );
    return (data.value || []).slice(0, 25).map((s: any) => ({
      id: s.id as string,
      name: (s.displayName || s.name || "Site") as string,
      webUrl: (s.webUrl || "") as string,
    }));
  },
});

export const getSiteDriveRoot = action({
  args: {
    connectionId: v.id("m365Connections"),
    siteId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireApprovedAction(ctx);
    const token = await getValidAccessToken(ctx, args.connectionId);
    const drive = await graphGet(
      token,
      `/sites/${args.siteId}/drive?$select=id,name,webUrl`,
    );
    const root = await graphGet(
      token,
      `/drives/${drive.id}/root?$select=id,name,webUrl`,
    );
    return {
      driveId: drive.id as string,
      driveName: (drive.name || "Documents") as string,
      itemId: root.id as string,
      itemName: (root.name || "root") as string,
      itemWebUrl: (root.webUrl || drive.webUrl || "") as string,
    };
  },
});

export const getMyDriveRoot = action({
  args: { connectionId: v.id("m365Connections") },
  handler: async (ctx, args) => {
    await requireApprovedAction(ctx);
    const token = await getValidAccessToken(ctx, args.connectionId);
    const drive = await graphGet(token, "/me/drive?$select=id,name,webUrl");
    const root = await graphGet(
      token,
      `/drives/${drive.id}/root?$select=id,name,webUrl`,
    );
    return {
      driveId: drive.id as string,
      driveName: (drive.name || "OneDrive") as string,
      itemId: root.id as string,
      itemName: (root.name || "root") as string,
      itemWebUrl: (root.webUrl || drive.webUrl || "") as string,
    };
  },
});

export const listChildren = action({
  args: {
    connectionId: v.id("m365Connections"),
    driveId: v.string(),
    itemId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireApprovedAction(ctx);
    const token = await getValidAccessToken(ctx, args.connectionId);
    const data = await graphGet(
      token,
      `/drives/${args.driveId}/items/${args.itemId}/children?$select=id,name,webUrl,folder,file,size,lastModifiedDateTime,createdDateTime&$top=200`,
    );
    return (data.value || []).map((item: any) => {
      const isFolder = !!item.folder;
      const mime = (item.file && item.file.mimeType) || "";
      let typeLabel = isFolder ? "Folder" : "File";
      if (!isFolder && item.name) {
        const dot = String(item.name).lastIndexOf(".");
        if (dot > 0) typeLabel = String(item.name).slice(dot + 1).toUpperCase();
      }
      return {
        id: item.id as string,
        name: item.name as string,
        webUrl: (item.webUrl || "") as string,
        isFolder,
        size: typeof item.size === "number" ? (item.size as number) : null,
        lastModifiedDateTime: (item.lastModifiedDateTime ||
          item.createdDateTime ||
          null) as string | null,
        mimeType: mime as string,
        typeLabel,
      };
    });
  },
});

/** Connected customers that already have a selected SharePoint/OneDrive folder. */
export const listBrowsableConnections = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const access = await ctx.db
      .query("memberAccess")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!access || access.status !== "approved") return [];

    const rows = await ctx.db.query("m365Connections").order("desc").take(100);
    return rows
      .filter(
        (r) =>
          r.status === "connected" && !!(r.driveId && r.itemId),
      )
      .map(publicConnection);
  },
});

export const testAccess = action({
  args: { connectionId: v.id("m365Connections") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: true;
    kind: string;
    name: string;
    webUrl: string | null;
  }> => {
    await requireApprovedAction(ctx);
    const doc: {
      status: string;
      driveId?: string;
      itemId?: string;
      locationKind?: string;
      itemWebUrl?: string;
    } | null = await ctx.runQuery(internal.m365.internalGet, {
      connectionId: args.connectionId,
    });
    if (!doc || doc.status !== "connected") {
      throw new Error("Connection is not connected");
    }
    const token = await getValidAccessToken(ctx, args.connectionId);

    if (doc.driveId && doc.itemId) {
      const item = await graphGet(
        token,
        `/drives/${doc.driveId}/items/${doc.itemId}?$select=id,name,webUrl`,
      );
      return {
        ok: true,
        kind: doc.locationKind || "unknown",
        name: item.name as string,
        webUrl: (item.webUrl || doc.itemWebUrl || "") as string,
      };
    }

    const me = await graphGet(
      token,
      "/me?$select=displayName,mail,userPrincipalName",
    );
    return {
      ok: true,
      kind: "account",
      name: (me.displayName || me.mail || me.userPrincipalName) as string,
      webUrl: null,
    };
  },
});
