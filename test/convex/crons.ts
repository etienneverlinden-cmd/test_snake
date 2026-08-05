import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "send-due-appointment-reminders",
  { minuteUTC: 5 },
  internal.notifications.processDueReminders,
);

export default crons;
