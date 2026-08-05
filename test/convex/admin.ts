import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { randomToken, requireAdmin, SESSION_TTL_MS } from "./lib";

export const login = mutation({
  args: { password: v.string() },
  handler: async (ctx, args) => {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
      throw new Error("ADMIN_PASSWORD non configuré sur Convex");
    }
    if (args.password !== expected) {
      throw new Error("Mot de passe incorrect");
    }
    const token = randomToken();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    await ctx.db.insert("adminSessions", { token, expiresAt });
    return { token, expiresAt };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (session) await ctx.db.delete(session._id);
    return { ok: true };
  },
});

export const me = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    try {
      await requireAdmin(ctx, args.token);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },
});

export const listAppointments = query({
  args: {
    token: v.optional(v.string()),
    fromMs: v.number(),
    toMs: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_start", (q) =>
        q.gte("startMs", args.fromMs - 1).lt("startMs", args.toMs),
      )
      .collect();
    return rows.sort((a, b) => a.startMs - b.startMs);
  },
});

export const cancelAppointment = mutation({
  args: { token: v.string(), id: v.id("appointments") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const appt = await ctx.db.get(args.id);
    if (!appt) throw new Error("Rendez-vous introuvable");
    if (appt.reminderJobId) {
      try {
        await ctx.scheduler.cancel(appt.reminderJobId);
      } catch {
        /* already ran or missing */
      }
    }
    await ctx.db.patch(args.id, {
      status: "cancelled",
      reminderJobId: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.notifications.afterCancel, {
      appointmentId: args.id,
      googleEventId: appt.googleEventId,
    });
    return { ok: true };
  },
});
