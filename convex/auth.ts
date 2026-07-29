import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTP } from "./ResendOTP";

function siteUrl() {
  const url = process.env.SITE_URL;
  if (!url) throw new Error("SITE_URL is not set");
  return url.replace(/\/$/, "");
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google,
    Password({
      verify: ResendOTP,
      profile(params) {
        const email = String(params.email ?? "");
        const name = params.name
          ? String(params.name).slice(0, 24)
          : email.split("@")[0] || "Player";
        return { email, name };
      },
    }),
  ],
  callbacks: {
    // Accept /path, ?query, absolute SITE_URL urls, and bare filenames like index.html
    async redirect({ redirectTo }) {
      const base = siteUrl();
      if (redirectTo.startsWith("?") || redirectTo.startsWith("/")) {
        return `${base}${redirectTo}`;
      }
      if (redirectTo.startsWith(base)) {
        const after = redirectTo[base.length];
        if (after === undefined || after === "?" || after === "/") {
          return redirectTo;
        }
      }
      if (!redirectTo.includes("://") && !redirectTo.startsWith("//")) {
        return `${base}/${redirectTo.replace(/^\.\//, "")}`;
      }
      throw new Error(
        `Invalid redirectTo ${redirectTo} for configured SITE_URL: ${base}`,
      );
    },
  },
});
