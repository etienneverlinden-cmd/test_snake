import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

export const get = internalQuery({
  args: { id: v.id("appointments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const setGoogleEventId = internalMutation({
  args: {
    id: v.id("appointments"),
    googleEventId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { googleEventId: args.googleEventId });
  },
});

export const markConfirmationSent = internalMutation({
  args: { id: v.id("appointments") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { confirmationEmailSentAt: Date.now() });
  },
});

export const markReminderSent = internalMutation({
  args: { id: v.id("appointments") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { reminderEmailSentAt: Date.now() });
  },
});

export const setReminderJobId = internalMutation({
  args: {
    id: v.id("appointments"),
    reminderJobId: v.id("_scheduled_functions"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { reminderJobId: args.reminderJobId });
  },
});

export const listDueReminders = internalQuery({
  args: { nowMs: v.number(), windowMs: v.number() },
  handler: async (ctx, args) => {
    // Appointments starting between now+23h and now+25h without reminder
    const from = args.nowMs + args.windowMs - 60 * 60 * 1000;
    const to = args.nowMs + args.windowMs + 60 * 60 * 1000;
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_status_start", (q) =>
        q.eq("status", "confirmed").gte("startMs", from).lt("startMs", to),
      )
      .collect();
    return rows.filter((r) => !r.reminderEmailSentAt);
  },
});

export type AppointmentId = Id<"appointments">;
