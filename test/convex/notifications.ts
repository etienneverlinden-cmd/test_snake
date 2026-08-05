import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  confirmationEmail,
  reminderEmail,
  sendResendEmail,
} from "./email";

const PRACTICE_PHONE = "+32 10 00 00 00";
const PRACTICE_ADDRESS = "Rue des Lilas 12, 1300 Wavre";

export const afterBook = internalAction({
  args: { appointmentId: v.id("appointments") },
  handler: async (ctx, args) => {
    const appt = await ctx.runQuery(internal.appointmentsInternal.get, {
      id: args.appointmentId,
    });
    if (!appt || appt.status !== "confirmed") return;

    // 1) Confirmation email
    if (!appt.confirmationEmailSentAt) {
      try {
        const mail = confirmationEmail({
          firstName: appt.patientFirstName,
          typeName: appt.typeName,
          startMs: appt.startMs,
          endMs: appt.endMs,
          phone: PRACTICE_PHONE,
          address: PRACTICE_ADDRESS,
        });
        await sendResendEmail({
          to: appt.patientEmail,
          ...mail,
        });
        await ctx.runMutation(internal.appointmentsInternal.markConfirmationSent, {
          id: appt._id,
        });
      } catch (e) {
        console.error("confirmation email failed", e);
      }
    }

    // 2) Google Calendar event
    try {
      await ctx.runAction(internal.google.createEvent, {
        appointmentId: appt._id,
        summary: `${appt.typeName} — ${appt.patientFirstName} ${appt.patientLastName}`,
        description: [
          `Patient: ${appt.patientFirstName} ${appt.patientLastName}`,
          `Email: ${appt.patientEmail}`,
          `Tél: ${appt.patientPhone}`,
          appt.note ? `Note: ${appt.note}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        startMs: appt.startMs,
        endMs: appt.endMs,
        attendeeEmail: appt.patientEmail,
      });
    } catch (e) {
      console.error("google calendar sync failed", e);
    }
  },
});

export const sendReminder = internalAction({
  args: { appointmentId: v.id("appointments") },
  handler: async (ctx, args) => {
    const appt = await ctx.runQuery(internal.appointmentsInternal.get, {
      id: args.appointmentId,
    });
    if (!appt || appt.status !== "confirmed") return;
    if (appt.reminderEmailSentAt) return;
    // Only send if still roughly within the 24h window (or overdue slightly)
    if (appt.startMs < Date.now()) return;

    try {
      const mail = reminderEmail({
        firstName: appt.patientFirstName,
        typeName: appt.typeName,
        startMs: appt.startMs,
        endMs: appt.endMs,
        phone: PRACTICE_PHONE,
        address: PRACTICE_ADDRESS,
      });
      await sendResendEmail({
        to: appt.patientEmail,
        ...mail,
      });
      await ctx.runMutation(internal.appointmentsInternal.markReminderSent, {
        id: appt._id,
      });
    } catch (e) {
      console.error("reminder email failed", e);
    }
  },
});

/** Safety net: hourly cron catches reminders if scheduled job was missed. */
export const processDueReminders = internalAction({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.appointmentsInternal.listDueReminders, {
      nowMs: Date.now(),
      windowMs: 24 * 60 * 60 * 1000,
    });
    for (const appt of due) {
      await ctx.runAction(internal.notifications.sendReminder, {
        appointmentId: appt._id,
      });
    }
  },
});

export const afterCancel = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    googleEventId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.googleEventId) {
      try {
        await ctx.runAction(internal.google.deleteEvent, {
          googleEventId: args.googleEventId,
        });
      } catch (e) {
        console.error("google calendar delete failed", e);
      }
    }
  },
});
