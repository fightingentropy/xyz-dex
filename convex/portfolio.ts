import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUser } from "./lib/auth";
import {
  calculatePerpsEquity,
  calculateSpotEquity,
  getDemoPrice,
} from "./lib/portfolio";

const OWNER_TYPE_VAULT = "vault" as const;

const calculateOwnerPerpsEquity = async (
  ctx: QueryCtx,
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
) => {
  const balances = await ctx.db
    .query("perpsBalances")
    .withIndex("by_owner", (q) =>
      q.eq("ownerType", ownerType).eq("ownerId", ownerId),
    )
    .collect();
  return balances.reduce((sum, balance) => sum + balance.balance, 0);
};

const calculateOwnerSpotEquity = async (
  ctx: QueryCtx,
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
) => {
  const balances = await ctx.db
    .query("spotBalances")
    .withIndex("by_owner", (q) =>
      q.eq("ownerType", ownerType).eq("ownerId", ownerId),
    )
    .collect();
  return balances.reduce(
    (sum, balance) => sum + balance.balance * getDemoPrice(balance.asset),
    0,
  );
};

export const getMetrics = query({
  args: { vaultId: v.optional(v.id("vaults")) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;
    if (args.vaultId) {
      const vault = await ctx.db.get(args.vaultId);
      if (!vault || vault.operatorUserId !== user._id) return null;
      if (vault.status !== "active") return null;
      const perpsEquity = await calculateOwnerPerpsEquity(
        ctx,
        OWNER_TYPE_VAULT,
        args.vaultId,
      );
      const spotEquity = await calculateOwnerSpotEquity(
        ctx,
        OWNER_TYPE_VAULT,
        args.vaultId,
      );
      const totalEquity = perpsEquity + spotEquity;
      return {
        userId: user._id,
        totalEquity,
        perpsEquity,
        spotEquity,
        pnl: 0,
        volume: 0,
        updatedAt: Date.now(),
      };
    }
    const metrics = await ctx.db
      .query("portfolioMetrics")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (metrics) return metrics;

    const perpsEquity = await calculatePerpsEquity(ctx, user._id);
    const spotEquity = await calculateSpotEquity(ctx, user._id);
    const totalEquity = perpsEquity + spotEquity;
    return {
      userId: user._id,
      totalEquity,
      perpsEquity,
      spotEquity,
      pnl: 0,
      volume: 0,
      updatedAt: Date.now(),
    };
  },
});
