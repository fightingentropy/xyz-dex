import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthUser } from "./lib/auth";

export const listTrades = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    const trades = await ctx.db
      .query("trades")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const sorted = trades.sort((a, b) => b.createdAt - a.createdAt);
    const limit = args.limit ?? 50;
    return sorted.slice(0, limit);
  },
});
