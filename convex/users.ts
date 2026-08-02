import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/** Current signed-in user + membership status, or null. */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;

    const access = await ctx.db
      .query("memberAccess")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    return {
      id: user._id,
      email: user.email ?? null,
      name: user.name ?? null,
      emailVerificationTime: user.emailVerificationTime ?? null,
      image: user.image ?? null,
      accessStatus: access?.status ?? null,
      denyCount: access?.denyCount ?? 0,
    };
  },
});
