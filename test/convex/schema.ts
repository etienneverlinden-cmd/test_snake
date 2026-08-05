import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  appointmentTypes: defineTable({
    name: v.string(),
    durationMinutes: v.number(),
    active: v.boolean(),
    sortOrder: v.number(),
  }).index("by_active_sort", ["active", "sortOrder"]),

  weeklyHours: defineTable({
    dayOfWeek: v.number(), // 0 = Sunday … 6 = Saturday
    startMinutes: v.number(),
    endMinutes: v.number(),
  }).index("by_day", ["dayOfWeek"]),

  blockedSlots: defineTable({
    startMs: v.number(),
    endMs: v.number(),
    reason: v.optional(v.string()),
  }).index("by_start", ["startMs"]),

  appointments: defineTable({
    startMs: v.number(),
    endMs: v.number(),
    typeId: v.id("appointmentTypes"),
    typeName: v.string(),
    patientFirstName: v.string(),
    patientLastName: v.string(),
    patientEmail: v.string(),
    patientPhone: v.string(),
    note: v.optional(v.string()),
    status: v.union(v.literal("confirmed"), v.literal("cancelled")),
    createdAt: v.number(),
    googleEventId: v.optional(v.string()),
    confirmationEmailSentAt: v.optional(v.number()),
    reminderEmailSentAt: v.optional(v.number()),
    reminderJobId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_start", ["startMs"])
    .index("by_status_start", ["status", "startMs"]),

  adminSessions: defineTable({
    token: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  /** Single Google Calendar connection for the practice. */
  googleCalendar: defineTable({
    email: v.string(),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    oauthState: v.optional(v.string()),
    connectedAt: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("connected"),
      v.literal("error"),
    ),
    lastError: v.optional(v.string()),
  }).index("by_oauth_state", ["oauthState"]),
});
