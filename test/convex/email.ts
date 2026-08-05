import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export async function sendResendEmail(args: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY non configuré sur Convex");
  }
  const from =
    process.env.EMAIL_FROM || "Loïc Verlinden <onboarding@resend.dev>";
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
    throw new Error("Envoi email impossible");
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

export function formatApptWhen(startMs: number, endMs: number): string {
  const date = new Intl.DateTimeFormat("fr-BE", {
    timeZone: "Europe/Brussels",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(startMs));
  const start = new Intl.DateTimeFormat("fr-BE", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(startMs));
  const end = new Intl.DateTimeFormat("fr-BE", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(endMs));
  return `${date}, ${start} – ${end}`;
}

export function confirmationEmail(args: {
  firstName: string;
  typeName: string;
  startMs: number;
  endMs: number;
  phone: string;
  address: string;
}) {
  const when = formatApptWhen(args.startMs, args.endMs);
  const subject = `Confirmation de rendez-vous — ${args.typeName}`;
  const text = [
    `Bonjour ${args.firstName},`,
    ``,
    `Votre rendez-vous est confirmé :`,
    `• ${args.typeName}`,
    `• ${when}`,
    `• ${args.address}`,
    ``,
    `Pour toute modification, contactez le cabinet au ${args.phone}.`,
    ``,
    `À bientôt,`,
    `Loïc Verlinden — Kinésithérapeute`,
  ].join("\n");
  const html = `
    <p>Bonjour ${escapeHtml(args.firstName)},</p>
    <p>Votre rendez-vous est <strong>confirmé</strong>&nbsp;:</p>
    <ul>
      <li><strong>${escapeHtml(args.typeName)}</strong></li>
      <li>${escapeHtml(when)}</li>
      <li>${escapeHtml(args.address)}</li>
    </ul>
    <p>Pour toute modification, contactez le cabinet au ${escapeHtml(args.phone)}.</p>
    <p>À bientôt,<br>Loïc Verlinden — Kinésithérapeute</p>
  `;
  return { subject, text, html };
}

export function reminderEmail(args: {
  firstName: string;
  typeName: string;
  startMs: number;
  endMs: number;
  phone: string;
  address: string;
}) {
  const when = formatApptWhen(args.startMs, args.endMs);
  const subject = `Rappel — rendez-vous demain (${args.typeName})`;
  const text = [
    `Bonjour ${args.firstName},`,
    ``,
    `Rappel : votre rendez-vous a lieu dans moins de 24 heures.`,
    `• ${args.typeName}`,
    `• ${when}`,
    `• ${args.address}`,
    ``,
    `En cas d'empêchement, contactez le cabinet au ${args.phone}.`,
    ``,
    `À bientôt,`,
    `Loïc Verlinden — Kinésithérapeute`,
  ].join("\n");
  const html = `
    <p>Bonjour ${escapeHtml(args.firstName)},</p>
    <p>Rappel : votre rendez-vous a lieu <strong>dans moins de 24 heures</strong>.</p>
    <ul>
      <li><strong>${escapeHtml(args.typeName)}</strong></li>
      <li>${escapeHtml(when)}</li>
      <li>${escapeHtml(args.address)}</li>
    </ul>
    <p>En cas d'empêchement, contactez le cabinet au ${escapeHtml(args.phone)}.</p>
    <p>À bientôt,<br>Loïc Verlinden — Kinésithérapeute</p>
  `;
  return { subject, text, html };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
