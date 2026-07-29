import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Arcade scores + Convex Auth tables.
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
});
