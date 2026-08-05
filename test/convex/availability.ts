import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./lib";

export const listHours = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const hours = await ctx.db.query("weeklyHours").collect();
    return hours.sort(
      (a, b) =>
        a.dayOfWeek - b.dayOfWeek || a.startMinutes - b.startMinutes,
    );
  },
});

export const addHours = mutation({
  args: {
    token: v.string(),
    dayOfWeek: v.number(),
    startMinutes: v.number(),
    endMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    if (args.dayOfWeek < 0 || args.dayOfWeek > 6) {
      throw new Error("Jour invalide");
    }
    if (
      args.startMinutes < 0 ||
      args.endMinutes > 24 * 60 ||
      args.startMinutes >= args.endMinutes
    ) {
      throw new Error("Horaires invalides");
    }
    await ctx.db.insert("weeklyHours", {
      dayOfWeek: args.dayOfWeek,
      startMinutes: args.startMinutes,
      endMinutes: args.endMinutes,
    });
    return { ok: true };
  },
});

export const clearDayHours = mutation({
  args: { token: v.string(), dayOfWeek: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const existing = await ctx.db
      .query("weeklyHours")
      .withIndex("by_day", (q) => q.eq("dayOfWeek", args.dayOfWeek))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    return { ok: true };
  },
});

export const listBlocked = query({
  args: {
    token: v.optional(v.string()),
    fromMs: v.number(),
    toMs: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const all = await ctx.db.query("blockedSlots").collect();
    return all
      .filter((b) => b.startMs < args.toMs && b.endMs > args.fromMs)
      .sort((a, b) => a.startMs - b.startMs);
  },
});

export const blockSlot = mutation({
  args: {
    token: v.string(),
    startMs: v.number(),
    endMs: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    if (args.endMs <= args.startMs) throw new Error("Plage invalide");
    return await ctx.db.insert("blockedSlots", {
      startMs: args.startMs,
      endMs: args.endMs,
      reason: args.reason?.trim() || undefined,
    });
  },
});

export const unblockSlot = mutation({
  args: { token: v.string(), id: v.id("blockedSlots") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});
