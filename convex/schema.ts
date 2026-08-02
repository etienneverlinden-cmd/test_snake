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
});
