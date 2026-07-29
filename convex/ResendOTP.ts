import Resend from "@auth/core/providers/resend";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

/**
 * Email OTP for password sign-up / sign-in verification (via Resend HTTP API).
 * Requires AUTH_RESEND_KEY on the Convex deployment.
 */
export const ResendOTP = Resend({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes) {
        crypto.getRandomValues(bytes);
      },
    };
    return generateRandomString(random, "0123456789", 8);
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const apiKey = provider.apiKey || process.env.AUTH_RESEND_KEY;
    if (!apiKey) {
      throw new Error(
        "AUTH_RESEND_KEY is not set on the Convex deployment. Add it to send confirmation emails.",
      );
    }
    const from =
      process.env.AUTH_EMAIL_FROM || "Stijn Arcade <onboarding@resend.dev>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Confirm your Stijn Arcade account",
        text:
          `Your Stijn Arcade confirmation code is ${token}\n\n` +
          `Enter this code on the website to finish signing up. It expires soon.`,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("Resend error", res.status, body);
      let detail = "Could not send confirmation email";
      try {
        const parsed = JSON.parse(body);
        if (parsed.message) detail = parsed.message;
      } catch {
        /* keep default */
      }
      throw new Error(detail);
    }
  },
});
