import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  scores: defineTable({
    game: v.union(v.literal("snake"), v.literal("frogger")),
    playerName: v.string(),
    score: v.number(),
    createdAt: v.number(),
    userId: v.optional(v.id("users")),
  })
    .index("by_game_score", ["game", "score"])
    .index("by_game_created", ["game", "createdAt"])
    .index("by_user_game", ["userId", "game"]),

  /** Membership approval for My Pragmatict (separate from Convex Auth identity). */
  memberAccess: defineTable({
    userId: v.id("users"),
    email: v.string(),
    name: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
      v.literal("unauthorized"),
    ),
    denyCount: v.number(),
    decisionToken: v.string(),
    requestedAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["decisionToken"])
    .index("by_email", ["email"]),

  /**
   * Customer Microsoft 365 connections (delegated OAuth).
   * Tokens let approved members access SharePoint/OneDrive the consenter can see.
   */
  m365Connections: defineTable({
    createdByUserId: v.id("users"),
    label: v.string(),
    status: v.union(
      v.literal("pending_oauth"),
      v.literal("connected"),
      v.literal("error"),
      v.literal("disconnected"),
    ),
    oauthState: v.optional(v.string()),
    tenantId: v.optional(v.string()),
    tenantName: v.optional(v.string()),
    accountEmail: v.optional(v.string()),
    accountName: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
    lastError: v.optional(v.string()),
    locationKind: v.optional(
      v.union(v.literal("sharepoint"), v.literal("onedrive")),
    ),
    siteId: v.optional(v.string()),
    siteName: v.optional(v.string()),
    siteWebUrl: v.optional(v.string()),
    driveId: v.optional(v.string()),
    itemId: v.optional(v.string()),
    itemName: v.optional(v.string()),
    itemWebUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_created_by", ["createdByUserId"])
    .index("by_oauth_state", ["oauthState"])
    .index("by_status", ["status"])
    .index("by_tenant", ["tenantId"]),

  /**
   * Customer Google Calendar connections (delegated OAuth).
   * Tokens let approved members use the consenter’s Google Calendar.
   */
  googleConnections: defineTable({
    createdByUserId: v.id("users"),
    label: v.string(),
    status: v.union(
      v.literal("pending_oauth"),
      v.literal("connected"),
      v.literal("error"),
      v.literal("disconnected"),
    ),
    oauthState: v.optional(v.string()),
    accountEmail: v.optional(v.string()),
    accountName: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
    lastError: v.optional(v.string()),
    /** Google calendar id (usually "primary" or an email). */
    calendarId: v.optional(v.string()),
    calendarSummary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_created_by", ["createdByUserId"])
    .index("by_oauth_state", ["oauthState"])
    .index("by_status", ["status"])
    .index("by_email", ["accountEmail"]),
});
