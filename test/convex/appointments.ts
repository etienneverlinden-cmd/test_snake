import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  brusselsDayStartMs,
  dayOfWeekBrussels,
  generateSlotsForDay,
  getActiveTypes,
  getWeeklyHoursForDay,
  listBusyInRange,
  overlaps,
} from "./lib";

export const listTypes = query({
  args: {},
  handler: async (ctx) => {
    return await getActiveTypes(ctx);
  },
});

export const listSlots = query({
  args: {
    typeId: v.id("appointmentTypes"),
    fromDate: v.string(), // YYYY-MM-DD
    days: v.number(),
  },
  handler: async (ctx, args) => {
    const type = await ctx.db.get(args.typeId);
    if (!type || !type.active) return [];

    const days = Math.min(Math.max(args.days, 1), 14);
    const now = Date.now();
    const result: { date: string; slots: number[] }[] = [];

    const [y0, m0, d0] = args.fromDate.split("-").map(Number);
    for (let i = 0; i < days; i++) {
      const dt = new Date(Date.UTC(y0, m0 - 1, d0 + i));
      const dateStr = dt.toISOString().slice(0, 10);
      const dayStart = brusselsDayStartMs(dateStr);
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      const dow = dayOfWeekBrussels(dateStr);
      const hours = await getWeeklyHoursForDay(ctx, dow);
      if (hours.length === 0) {
        result.push({ date: dateStr, slots: [] });
        continue;
      }
      const { appointments, blocked } = await listBusyInRange(
        ctx,
        dayStart,
        dayEnd,
      );
      const busy = [
        ...appointments.map((a) => ({ startMs: a.startMs, endMs: a.endMs })),
        ...blocked.map((b) => ({ startMs: b.startMs, endMs: b.endMs })),
      ];
      const slots = generateSlotsForDay(
        dayStart,
        hours,
        type.durationMinutes,
        busy,
        now,
      );
      result.push({ date: dateStr, slots });
    }
    return result;
  },
});

export const book = mutation({
  args: {
    typeId: v.id("appointmentTypes"),
    startMs: v.number(),
    patientFirstName: v.string(),
    patientLastName: v.string(),
    patientEmail: v.string(),
    patientPhone: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const type = await ctx.db.get(args.typeId);
    if (!type || !type.active) throw new Error("Type de séance invalide");

    const first = args.patientFirstName.trim();
    const last = args.patientLastName.trim();
    const email = args.patientEmail.trim().toLowerCase();
    const phone = args.patientPhone.trim();
    if (!first || !last) throw new Error("Nom et prénom requis");
    if (!email.includes("@")) throw new Error("Email invalide");
    if (phone.length < 8) throw new Error("Téléphone invalide");

    const durationMs = type.durationMinutes * 60 * 1000;
    const startMs = args.startMs;
    const endMs = startMs + durationMs;
    const now = Date.now();
    if (startMs < now - 60_000) throw new Error("Ce créneau est déjà passé");

    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Brussels",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(startMs));
    const dayStart = brusselsDayStartMs(dateStr);
    const dow = dayOfWeekBrussels(dateStr);
    const hours = await getWeeklyHoursForDay(ctx, dow);
    const startMin = Math.round((startMs - dayStart) / 60000);
    const endMin = startMin + type.durationMinutes;
    const inHours = hours.some(
      (h) => startMin >= h.startMinutes && endMin <= h.endMinutes,
    );
    if (!inHours) throw new Error("Hors des horaires d'ouverture");

    const { appointments, blocked } = await listBusyInRange(
      ctx,
      startMs,
      endMs,
    );
    const conflict = [...appointments, ...blocked].some((b) =>
      overlaps(startMs, endMs, b.startMs, b.endMs),
    );
    if (conflict) throw new Error("Ce créneau vient d'être réservé");

    const id = await ctx.db.insert("appointments", {
      startMs,
      endMs,
      typeId: type._id,
      typeName: type.name,
      patientFirstName: first,
      patientLastName: last,
      patientEmail: email,
      patientPhone: phone,
      note: args.note?.trim() || undefined,
      status: "confirmed",
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.notifications.afterBook, {
      appointmentId: id,
    });

    const reminderAt = startMs - 24 * 60 * 60 * 1000;
    if (reminderAt > now + 60_000) {
      const jobId = await ctx.scheduler.runAt(
        reminderAt,
        internal.notifications.sendReminder,
        { appointmentId: id },
      );
      await ctx.db.patch(id, { reminderJobId: jobId });
    }

    return {
      id,
      startMs,
      endMs,
      typeName: type.name,
      patientFirstName: first,
      patientLastName: last,
    };
  },
});
