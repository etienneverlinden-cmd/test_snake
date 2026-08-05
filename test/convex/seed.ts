import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./lib";

const DEFAULT_TYPES = [
  { name: "Kinésithérapie générale", durationMinutes: 30, sortOrder: 1 },
  { name: "Kinésithérapie sportive", durationMinutes: 45, sortOrder: 2 },
  { name: "Bilan / première séance", durationMinutes: 60, sortOrder: 3 },
];

/** Mon–Fri 09:00–12:00 and 13:30–18:00 */
const DEFAULT_HOURS: { dayOfWeek: number; startMinutes: number; endMinutes: number }[] =
  [1, 2, 3, 4, 5].flatMap((day) => [
    { dayOfWeek: day, startMinutes: 9 * 60, endMinutes: 12 * 60 },
    { dayOfWeek: day, startMinutes: 13 * 60 + 30, endMinutes: 18 * 60 },
  ]);

export const seedDefaults = mutation({
  args: { token: v.optional(v.string()), force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const types = await ctx.db.query("appointmentTypes").collect();
    const hours = await ctx.db.query("weeklyHours").collect();
    const empty = types.length === 0 && hours.length === 0;

    if (!empty) {
      if (!args.force) {
        return { seeded: false, reason: "already_initialized" as const };
      }
      await requireAdmin(ctx, args.token);
      for (const t of types) await ctx.db.delete(t._id);
      for (const h of hours) await ctx.db.delete(h._id);
    }

    for (const t of DEFAULT_TYPES) {
      await ctx.db.insert("appointmentTypes", { ...t, active: true });
    }
    for (const h of DEFAULT_HOURS) {
      await ctx.db.insert("weeklyHours", h);
    }
    return { seeded: true, types: DEFAULT_TYPES.length, hours: DEFAULT_HOURS.length };
  },
});
