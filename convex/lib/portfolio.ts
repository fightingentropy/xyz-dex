import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// ============================================================================
// Portfolio Margin Helpers
// ============================================================================

/**
 * Calculate how much of a short position can be collateralized by spot holdings.
 * Only short positions (negative size) can be spot-collateralized.
 *
 * @param spotBalance - Amount of spot asset held (e.g., 200 HYPE)
 * @param positionSize - Position size, negative for shorts (e.g., -300)
 * @returns Amount that can be spot-collateralized (e.g., 200)
 */
export const calculateSpotCollateralForPosition = (
  spotBalance: number,
  positionSize: number,
): number => {
  if (positionSize >= 0) return 0; // Only shorts can be spot-collateralized
  const shortSize = Math.abs(positionSize);
  return Math.min(spotBalance, shortSize);
};

/**
 * Calculate the unhedged portion of a position that requires USDC margin.
 *
 * @param positionSize - Total position size (negative for shorts)
 * @param spotCollateralSize - Amount backed by spot holdings
 * @returns Unhedged size requiring USDC collateral
 */
export const calculateUnhedgedSize = (
  positionSize: number,
  spotCollateralSize: number,
): number => {
  return Math.max(0, Math.abs(positionSize) - spotCollateralSize);
};

/**
 * Calculate margin required for a position, accounting for spot collateral.
 * Spot-collateralized portion requires no USDC margin.
 *
 * @param position - The position document
 * @param markPrice - Current mark price of the asset
 * @returns Margin required in USDC
 */
export const calculatePositionMarginWithSpotCollateral = (
  position: { size: number; leverage: number; spotCollateralSize?: number },
  markPrice: number,
): number => {
  if (position.leverage <= 0 || !Number.isFinite(markPrice) || markPrice <= 0) {
    return 0;
  }

  const spotCollateral = position.spotCollateralSize ?? 0;
  const unhedgedSize = calculateUnhedgedSize(position.size, spotCollateral);

  // Only the unhedged portion requires USDC margin
  return (unhedgedSize * markPrice) / position.leverage;
};

/**
 * Get spot balance for a specific asset.
 */
export const getSpotBalanceForAsset = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  asset: string,
): Promise<number> => {
  const balance = await ctx.db
    .query("spotBalances")
    .withIndex("by_user_asset", (q) =>
      q.eq("userId", userId).eq("asset", asset),
    )
    .unique();
  return balance?.balance ?? 0;
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

// ============================================================================
// Demo Prices & Equity Calculations
// ============================================================================

const DEMO_PRICES: Record<string, number> = {
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

const getDemoPrice = (asset: string) => DEMO_PRICES[asset] ?? 0;

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
) => {
  const balances = await ctx.db
    .query("spotBalances")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return balances.reduce(
    (sum, balance) => sum + balance.balance * getDemoPrice(balance.asset),
    0,
  );
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
    return;
  }

  await ctx.db.insert("portfolioMetrics", {
    userId,
    volume,
    pnl,
    perpsEquity,
    spotEquity,
    totalEquity,
    updatedAt,
  });

  return;
};
