import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const gameValidator = v.union(v.literal("snake"), v.literal("frogger"));

function sanitizeName(name: string): string {
  const cleaned = name.trim().slice(0, 24).replace(/[^\w\s\-'.]/g, "");
  return cleaned || "Anonymous";
}

/** Global best for one game (leaderboard #1). */
export const getBestScore = query({
  args: { game: gameValidator },
  handler: async (ctx, args) => {
    const top = await ctx.db
      .query("scores")
      .withIndex("by_game_score", (q) => q.eq("game", args.game))
      .order("desc")
      .take(1);
    if (top.length === 0) return null;
    const row = top[0];
    return {
      score: row.score,
      playerName: row.playerName,
      createdAt: row.createdAt,
    };
  },
});

/** Top N scores for a game. */
export const getTopScores = query({
  args: {
    game: gameValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_game_score", (q) => q.eq("game", args.game))
      .order("desc")
      .take(limit);
    return rows.map((row) => ({
      score: row.score,
      playerName: row.playerName,
      createdAt: row.createdAt,
    }));
  },
});

/** Save a finished run. Always inserts (history + leaderboard). */
export const submitScore = mutation({
  args: {
    game: gameValidator,
    playerName: v.string(),
    score: v.number(),
  },
  handler: async (ctx, args) => {
    const score = Math.max(0, Math.floor(args.score));
    if (!Number.isFinite(score)) throw new Error("invalid score");
    const playerName = sanitizeName(args.playerName);
    const id = await ctx.db.insert("scores", {
      game: args.game,
      playerName,
      score,
      createdAt: Date.now(),
    });
    return { id, playerName, score };
  },
});
