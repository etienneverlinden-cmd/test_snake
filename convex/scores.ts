import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const gameValidator = v.union(v.literal("snake"), v.literal("frogger"));

function sanitizeName(name: string): string {
  const cleaned = name.trim().slice(0, 24).replace(/[^\w\s\-'.]/g, "");
  return cleaned || "Player";
}

async function requireApprovedUser(ctx: MutationCtx): Promise<{
  userId: Id<"users">;
  user: Doc<"users">;
}> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Not authenticated");
  const access = await ctx.db
    .query("memberAccess")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!access || access.status !== "approved") {
    throw new Error("Not authorised");
  }
  return { userId, user };
}

async function requireApprovedUserId(
  ctx: QueryCtx,
): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const access = await ctx.db
    .query("memberAccess")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!access || access.status !== "approved") return null;
  return userId;
}

function displayName(
  user: Doc<"users">,
  fallback: string,
): string {
  if (user.name?.trim()) return sanitizeName(user.name);
  if (user.email) {
    const local = user.email.split("@")[0] || "Player";
    return sanitizeName(local);
  }
  return sanitizeName(fallback);
}

/** Global best for one game (leaderboard #1). Auth required. */
export const getBestScore = query({
  args: { game: gameValidator },
  handler: async (ctx, args) => {
    const userId = await requireApprovedUserId(ctx);
    if (!userId) return null;

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

/** Top N scores for a game. Auth required. */
export const getTopScores = query({
  args: {
    game: gameValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireApprovedUserId(ctx);
    if (!userId) return [];

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

/** Save a finished run. Auth required — score is tied to the signed-in user. */
export const submitScore = mutation({
  args: {
    game: gameValidator,
    playerName: v.optional(v.string()),
    score: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireApprovedUser(ctx);
    const score = Math.max(0, Math.floor(args.score));
    if (!Number.isFinite(score)) throw new Error("invalid score");
    const playerName = displayName(user, args.playerName || "Player");
    const id = await ctx.db.insert("scores", {
      game: args.game,
      playerName,
      score,
      createdAt: Date.now(),
      userId,
    });
    return { id, playerName, score };
  },
});
