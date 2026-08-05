import { QueryCtx, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
  token: string | undefined,
) {
  if (!token) throw new Error("Non autorisé");
  const session = await ctx.db
    .query("adminSessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!session || session.expiresAt < Date.now()) {
    throw new Error("Session expirée — reconnectez-vous");
  }
  return session;
}

export async function getActiveTypes(ctx: QueryCtx) {
  const types = await ctx.db.query("appointmentTypes").collect();
  return types
    .filter((t) => t.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getWeeklyHoursForDay(ctx: QueryCtx, dayOfWeek: number) {
  return await ctx.db
    .query("weeklyHours")
    .withIndex("by_day", (q) => q.eq("dayOfWeek", dayOfWeek))
    .collect();
}

export async function listBusyInRange(
  ctx: QueryCtx,
  rangeStart: number,
  rangeEnd: number,
) {
  const appointments = await ctx.db
    .query("appointments")
    .withIndex("by_status_start", (q) =>
      q.eq("status", "confirmed").gte("startMs", rangeStart - 1000 * 60 * 60 * 24),
    )
    .collect();

  const blocked = await ctx.db.query("blockedSlots").collect();

  const busyAppts = appointments.filter(
    (a) => a.startMs < rangeEnd && a.endMs > rangeStart,
  );
  const busyBlocked = blocked.filter(
    (b) => b.startMs < rangeEnd && b.endMs > rangeStart,
  );

  return { appointments: busyAppts, blocked: busyBlocked };
}

export function generateSlotsForDay(
  dayStartMs: number,
  hours: { startMinutes: number; endMinutes: number }[],
  durationMinutes: number,
  busy: { startMs: number; endMs: number }[],
  nowMs: number,
): number[] {
  const slots: number[] = [];
  const durationMs = durationMinutes * 60 * 1000;
  const stepMs = 15 * 60 * 1000;

  for (const h of hours) {
    let cursor = dayStartMs + h.startMinutes * 60 * 1000;
    const windowEnd = dayStartMs + h.endMinutes * 60 * 1000;
    while (cursor + durationMs <= windowEnd) {
      const end = cursor + durationMs;
      const isPast = cursor <= nowMs;
      const conflict = busy.some((b) => overlaps(cursor, end, b.startMs, b.endMs));
      if (!isPast && !conflict) slots.push(cursor);
      cursor += stepMs;
    }
  }
  return slots;
}

/** Local midnight for a YYYY-MM-DD in Europe/Brussels — approximate via UTC+offset. */
export function brusselsDayStartMs(dateStr: string): number {
  // dateStr = "2026-08-05"
  const [y, m, d] = dateStr.split("-").map(Number);
  // Use noon UTC then floor to Brussels calendar day via Intl
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(probe);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Offset: Brussels local hour at that UTC noon
  const localHour = get("hour") === 24 ? 0 : get("hour");
  const offsetHours = localHour - 12;
  return Date.UTC(y, m - 1, d, -offsetHours, 0, 0);
}

export function dayOfWeekBrussels(dateStr: string): number {
  const start = brusselsDayStartMs(dateStr);
  // weekday in Brussels
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Brussels",
    weekday: "short",
  });
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const key = fmt.format(new Date(start + 12 * 60 * 60 * 1000));
  return map[key] ?? new Date(start).getUTCDay();
}

export function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type AppointmentId = Id<"appointments">;
