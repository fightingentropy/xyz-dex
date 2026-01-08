import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthUser } from "./lib/auth";

export const listTrades = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    const limit = args.limit ?? 50;
    // Use the by_user_created index and database ordering for efficiency
    const trades = await ctx.db
      .query("trades")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
    return trades;
  },
});
