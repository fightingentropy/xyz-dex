import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { bumpCounter } from "./stats";

// ============================================================================
// Portfolio Margin Collateral Helpers
// ============================================================================

export const COLLATERAL_WEIGHTS: Record<string, number> = {
  USDC: 1,
  USDT: 1,
  BTC: 0.95,
  ETH: 0.9,
  SOL: 0.85,
  HYPE: 0.75,
  BNB: 0.9,
  XRP: 0.8,
  ADA: 0.8,
  DOGE: 0.7,
  AVAX: 0.8,
  LINK: 0.85,
  DOT: 0.8,
  LTC: 0.85,
  ATOM: 0.8,
};

export const getCollateralWeight = (asset: string) =>
  COLLATERAL_WEIGHTS[asset] ?? 0;

// ============================================================================
// Demo Prices & Equity Calculations
// ============================================================================

export const DEMO_PRICES: Record<string, number> = {
  USDC: 1,
  USDT: 1,
  BTC: 68435,
  ETH: 3034.5,
  SOL: 122.12,
  HYPE: 24.996,
  BNB: 598.2,
  XRP: 0.5582,
  ADA: 0.458,
  DOGE: 0.158,
  AVAX: 21.45,
  LINK: 17.29,
  DOT: 6.58,
  LTC: 91.29,
  ATOM: 9.58,
};

export const getDemoPrice = (asset: string) => DEMO_PRICES[asset] ?? 0;

export type PositionExposure = {
  symbol: string;
  size: number;
  marginType?: "isolated" | "cross";
};

const normalizeAssetSymbol = (symbol: string) => {
  const trimmed = String(symbol ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("xyz:")) {
    return trimmed.slice(trimmed.indexOf(":") + 1).toUpperCase();
  }
  return trimmed.toUpperCase();
};

const resolveSpotPrice = (
  asset: string,
  spotPrices?: Record<string, number>,
): number => {
  const normalized = normalizeAssetSymbol(asset);
  const live = spotPrices?.[normalized];
  if (typeof live === "number" && Number.isFinite(live) && live > 0) {
    return live;
  }
  return getDemoPrice(normalized);
};

export const getWeightedSpotEquityBreakdown = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  options: {
    positions?: PositionExposure[];
    spotPrices?: Record<string, number>;
  } = {},
) => {
  const balances = await ctx.db
    .query("spotBalances")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const spotPrices = options.spotPrices;

  // Per-asset COLLATERAL_WEIGHTS haircuts are applied UNIFORMLY to every spot
  // asset. There is no symbol-scoped spot/short hedging (per specs.md "No
  // symbol-scoped hedging"): spot contributes to buying power solely through
  // its weighted equity here, while margin is charged on full notional in
  // orders.ts. This keeps the equity side and the margin side consistent.
  return balances.map((balance) => {
    const normalized = normalizeAssetSymbol(balance.asset);
    const price = resolveSpotPrice(normalized, spotPrices);
    const weight = getCollateralWeight(normalized);
    const weightedValue = balance.balance * price * weight;

    return {
      asset: balance.asset,
      balance: balance.balance,
      price,
      weight,
      weightedValue,
    };
  });
};

export const calculateWeightedSpotEquity = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  positions?: PositionExposure[],
  spotPrices?: Record<string, number>,
) => {
  const breakdown = await getWeightedSpotEquityBreakdown(ctx, userId, {
    positions,
    spotPrices,
  });
  return breakdown.reduce((sum, item) => sum + item.weightedValue, 0);
};

export const calculatePerpsEquity = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) => {
  const balances = await ctx.db
    .query("perpsBalances")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return balances.reduce((sum, balance) => sum + balance.balance, 0);
};

export const calculateSpotEquity = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  spotPrices?: Record<string, number>,
) => {
  const balances = await ctx.db
    .query("spotBalances")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return balances.reduce(
    (sum, balance) =>
      sum + balance.balance * resolveSpotPrice(balance.asset, spotPrices),
    0,
  );
};

/**
 * Check if a user has portfolio margin enabled.
 */
export const isPortfolioMarginEnabled = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<boolean> => {
  const user = await ctx.db.get(userId);
  return user?.portfolioMarginEnabled ?? false;
};

export const updatePortfolioMetrics = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  deltas: { volumeDelta?: number; pnlDelta?: number } = {},
): Promise<void> => {
  const volumeDelta = deltas.volumeDelta ?? 0;
  const pnlDelta = deltas.pnlDelta ?? 0;
  const existing = await ctx.db
    .query("portfolioMetrics")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  const perpsEquity = await calculatePerpsEquity(ctx, userId);
  const spotEquity = await calculateSpotEquity(ctx, userId);
  const volume = (existing?.volume ?? 0) + volumeDelta;
  const pnl = (existing?.pnl ?? 0) + pnlDelta;
  const totalEquity = perpsEquity + spotEquity;
  const previousEquity = existing?.totalEquity ?? 0;
  const updatedAt = Date.now();

  if (existing) {
    await ctx.db.patch(existing._id, {
      volume,
      pnl,
      perpsEquity,
      spotEquity,
      totalEquity,
      updatedAt,
    });
  } else {
    await ctx.db.insert("portfolioMetrics", {
      userId,
      volume,
      pnl,
      perpsEquity,
      spotEquity,
      totalEquity,
      updatedAt,
    });
  }

  // Maintain the global admin display counters from this single choke point.
  // Equity is a running sum of per-user deltas (point-in-time aggregate).
  await bumpCounter(ctx, "total_volume", volumeDelta);
  await bumpCounter(ctx, "total_realized_pnl", pnlDelta);
  await bumpCounter(ctx, "total_equity", totalEquity - previousEquity);
};
