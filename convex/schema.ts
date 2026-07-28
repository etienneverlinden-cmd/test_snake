import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Arcade scores — same Convex style as pawnie (defineSchema + indexed tables).
export default defineSchema({
  scores: defineTable({
    game: v.union(v.literal("snake"), v.literal("frogger")),
    playerName: v.string(),
    score: v.number(),
    createdAt: v.number(),
  })
    .index("by_game_score", ["game", "score"])
    .index("by_game_created", ["game", "createdAt"]),
});
