import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUser, requireAuthUser } from "./lib/auth";

/**
 * Toggle portfolio margin mode for the authenticated user.
 * When enabled, short perp positions can be collateralized by spot holdings
 * of the same asset, reducing or eliminating liquidation risk for hedged portions.
 */
export const togglePortfolioMargin = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    await ctx.db.patch(user._id, {
      portfolioMarginEnabled: args.enabled,
    });
    return { ok: true, enabled: args.enabled };
  },
});

/**
 * Get the current portfolio margin status for the authenticated user.
 * Returns whether portfolio margin is enabled and hedging details for each position.
 */
export const getPortfolioMarginStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;

    const enabled = user.portfolioMarginEnabled ?? false;

    // Get all positions and spot balances to calculate hedging status
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const spotBalances = await ctx.db
      .query("spotBalances")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Build a map of spot balances by asset
    const spotByAsset: Record<string, number> = {};
    for (const balance of spotBalances) {
      spotByAsset[balance.asset] = balance.balance;
    }

    // Calculate hedging status for each short position
    const hedgingStatus = positions
      .filter((pos) => pos.size < 0) // Only shorts can be spot-collateralized
      .map((pos) => {
        const spotBalance = spotByAsset[pos.symbol] ?? 0;
        const shortSize = Math.abs(pos.size);
        const hedgedSize = enabled ? Math.min(spotBalance, shortSize) : 0;
        const unhedgedSize = shortSize - hedgedSize;

        return {
          symbol: pos.symbol,
          positionSize: pos.size,
          spotBalance,
          hedgedSize,
          unhedgedSize,
          fullyHedged: unhedgedSize === 0 && hedgedSize > 0,
          spotCollateralSize: pos.spotCollateralSize ?? 0,
        };
      });

    return {
      enabled,
      hedgingStatus,
    };
  },
});

/**
 * Recalculate and update spotCollateralSize for all positions.
 * Call this when spot balances change to keep hedging in sync.
 */
export const recalculateSpotCollateral = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    const enabled = user.portfolioMarginEnabled ?? false;

    if (!enabled) {
      // If portfolio margin is disabled, clear all spot collateral
      const positions = await ctx.db
        .query("positions")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();

      for (const pos of positions) {
        if (pos.spotCollateralSize && pos.spotCollateralSize > 0) {
          await ctx.db.patch(pos._id, {
            spotCollateralSize: 0,
            updatedAt: Date.now(),
          });
        }
      }
      return { ok: true, updated: 0 };
    }

    // Get spot balances
    const spotBalances = await ctx.db
      .query("spotBalances")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const spotByAsset: Record<string, number> = {};
    for (const balance of spotBalances) {
      spotByAsset[balance.asset] = balance.balance;
    }

    // Get all positions
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    let updated = 0;
    const now = Date.now();

    for (const pos of positions) {
      let newSpotCollateral = 0;

      // Only short positions can be spot-collateralized
      if (pos.size < 0) {
        const spotBalance = spotByAsset[pos.symbol] ?? 0;
        const shortSize = Math.abs(pos.size);
        newSpotCollateral = Math.min(spotBalance, shortSize);
      }

      // Update if changed
      if ((pos.spotCollateralSize ?? 0) !== newSpotCollateral) {
        await ctx.db.patch(pos._id, {
          spotCollateralSize: newSpotCollateral,
          updatedAt: now,
        });
        updated++;
      }
    }

    return { ok: true, updated };
  },
});
