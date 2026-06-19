import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAuthUser, requireAuthUser } from "./lib/auth";
import { updatePortfolioMetrics } from "./lib/portfolio";
import { getServerMarkPrice } from "./lib/prices";
import { bumpCounter } from "./lib/stats";

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
      ownerType: "user",
      ownerId: userId,
      asset,
      balance,
      updatedAt: now,
    });
  } else {
    await ctx.db.patch(existing._id, {
      ownerType: "user",
      ownerId: userId,
      balance,
      updatedAt: now,
    });
  }
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

export const transferUSDC = mutation({
  args: {
    amount: v.number(),
    direction: v.union(v.literal("perpsToSpot"), v.literal("spotToPerps")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    if (!Number.isFinite(args.amount) || args.amount <= 0) {
      throw new ConvexError("Enter a valid amount.");
    }

    const perpsBalance = await ctx.db
      .query("perpsBalances")
      .withIndex("by_user_asset", (q) =>
        q.eq("userId", user._id).eq("asset", "USDC"),
      )
      .unique();
    const spotBalance = await getSpotBalance(ctx, user._id, "USDC");

    const perpsAmount = perpsBalance?.balance ?? 0;
    const spotAmount = spotBalance?.balance ?? 0;

    if (args.direction === "perpsToSpot") {
      // Source = perps. The debit must provably succeed before crediting spot:
      // a missing perps row means a 0 balance, which cannot cover a positive
      // amount, so reject instead of crediting the destination unconditionally.
      if (!perpsBalance || args.amount > perpsAmount) {
        throw new ConvexError("Insufficient Perps USDC balance.");
      }
      // Deduct from perps (source), then credit spot (destination).
      await ctx.db.patch(perpsBalance._id, {
        ownerType: "user",
        ownerId: user._id,
        balance: perpsAmount - args.amount,
        updatedAt: Date.now(),
      });
      await upsertSpotBalance(ctx, user._id, "USDC", spotAmount + args.amount);
    } else {
      // Source = spot. The debit must provably succeed before crediting perps:
      // a missing spot row means a 0 balance, which cannot cover a positive
      // amount, so reject instead of crediting the destination unconditionally.
      if (!spotBalance || args.amount > spotAmount) {
        throw new ConvexError("Insufficient Spot USDC balance.");
      }
      // Deduct from spot (source), then credit perps (destination).
      await upsertSpotBalance(ctx, user._id, "USDC", spotAmount - args.amount);
      const now = Date.now();
      if (!perpsBalance) {
        await ctx.db.insert("perpsBalances", {
          userId: user._id,
          ownerType: "user",
          ownerId: user._id,
          asset: "USDC",
          balance: args.amount,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(perpsBalance._id, {
          ownerType: "user",
          ownerId: user._id,
          balance: perpsAmount + args.amount,
          updatedAt: now,
        });
      }
    }

    await updatePortfolioMetrics(ctx, user._id, {
      volumeDelta: 0,
      pnlDelta: 0,
    });

    return { ok: true };
  },
});

export const placeSpotOrder = mutation({
  args: {
    symbol: v.string(),
    side: v.union(v.literal("buy"), v.literal("sell")),
    size: v.number(),
    // Optional client price: kept for back-compat / limit intent ONLY. It must
    // NEVER influence settled notional or credited balances — the fill price is
    // always derived server-side via getServerMarkPrice.
    price: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    if (!Number.isFinite(args.size) || args.size <= 0) {
      throw new ConvexError("Enter a valid size.");
    }

    // Authoritative fill price from the server oracle — never the client arg.
    const fillPrice = await getServerMarkPrice(ctx, args.symbol);

    const quote = await getSpotBalance(ctx, user._id, "USDC");
    const base = await getSpotBalance(ctx, user._id, args.symbol);
    const quoteBalance = quote?.balance ?? 0;
    const baseBalance = base?.balance ?? 0;
    const notional = args.size * fillPrice;

    if (args.side === "buy") {
      if (notional > quoteBalance) {
        throw new ConvexError("Insufficient USDC balance.");
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
        throw new ConvexError("Insufficient asset balance.");
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
      ownerType: "user",
      ownerId: user._id,
      symbol: args.symbol,
      side: args.side,
      price: fillPrice,
      size: args.size,
      notional,
      fee: 0,
      pnl: 0,
      createdAt: Date.now(),
    });

    // Display counter: count the spot trade (volume is counted via
    // updatePortfolioMetrics below).
    await bumpCounter(ctx, "total_trades", 1);

    await updatePortfolioMetrics(ctx, user._id, {
      volumeDelta: notional,
      pnlDelta: 0,
    });

    return { ok: true };
  },
});
