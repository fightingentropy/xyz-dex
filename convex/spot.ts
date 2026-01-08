import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAuthUser, requireAuthUser } from "./lib/auth";
import { updatePortfolioMetrics } from "./lib/portfolio";

const getSpotBalance = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  asset: string,
) =>
  ctx.db
    .query("spotBalances")
    .withIndex("by_user_asset", (q) =>
      q.eq("userId", userId).eq("asset", asset),
    )
    .unique();

const upsertSpotBalance = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  asset: string,
  balance: number,
) => {
  const existing = await getSpotBalance(ctx, userId, asset);
  const now = Date.now();
  if (!existing) {
    await ctx.db.insert("spotBalances", {
      userId,
      asset,
      balance,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.patch(existing._id, { balance, updatedAt: now });
};

export const listSpotBalances = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    return ctx.db
      .query("spotBalances")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const placeSpotOrder = mutation({
  args: {
    symbol: v.string(),
    side: v.union(v.literal("buy"), v.literal("sell")),
    size: v.number(),
    price: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    if (!Number.isFinite(args.size) || args.size <= 0) {
      throw new Error("Enter a valid size.");
    }
    if (!Number.isFinite(args.price) || args.price <= 0) {
      throw new Error("Enter a valid price.");
    }

    const quote = await getSpotBalance(ctx, user._id, "USDC");
    const base = await getSpotBalance(ctx, user._id, args.symbol);
    const quoteBalance = quote?.balance ?? 0;
    const baseBalance = base?.balance ?? 0;
    const notional = args.size * args.price;

    if (args.side === "buy") {
      if (notional > quoteBalance) {
        throw new Error("Insufficient USDC balance.");
      }
      await upsertSpotBalance(ctx, user._id, "USDC", quoteBalance - notional);
      await upsertSpotBalance(
        ctx,
        user._id,
        args.symbol,
        baseBalance + args.size,
      );
    } else {
      if (args.size > baseBalance) {
        throw new Error("Insufficient asset balance.");
      }
      await upsertSpotBalance(ctx, user._id, "USDC", quoteBalance + notional);
      await upsertSpotBalance(
        ctx,
        user._id,
        args.symbol,
        baseBalance - args.size,
      );
    }

    await ctx.db.insert("trades", {
      userId: user._id,
      symbol: args.symbol,
      side: args.side,
      price: args.price,
      size: args.size,
      notional,
      fee: 0,
      pnl: 0,
      createdAt: Date.now(),
    });

    await updatePortfolioMetrics(ctx, user._id, {
      volumeDelta: notional,
      pnlDelta: 0,
    });

    return { ok: true };
  },
});
