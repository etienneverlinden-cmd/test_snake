import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export async function sendResendEmail(args: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) {
  const apiKey = process.env.AUTH_RESEND_KEY;
  if (!apiKey) {
    throw new Error("AUTH_RESEND_KEY is not set on the Convex deployment.");
  }
  const from =
    process.env.AUTH_EMAIL_FROM || "PragmatICT <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      text: args.text,
      html: args.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Resend error", res.status, body);
    throw new Error("Could not send email");
  }
}

export const send = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    html: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    await sendResendEmail(args);
  },
});
