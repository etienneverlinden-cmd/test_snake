import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/** Current signed-in user, or null. */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      id: user._id,
      email: user.email ?? null,
      name: user.name ?? null,
      emailVerificationTime: user.emailVerificationTime ?? null,
      image: user.image ?? null,
    };
  },
});
