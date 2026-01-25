import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

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

const buildShortExposureByAsset = (positions: PositionExposure[]) => {
  const shorts: Record<string, number> = {};
  for (const position of positions) {
    if (!position || position.size >= 0) continue;
    const marginType = position.marginType ?? "cross";
    if (marginType === "isolated") continue;
    const asset = normalizeAssetSymbol(position.symbol);
    if (!asset) continue;
    shorts[asset] = (shorts[asset] ?? 0) + Math.abs(position.size);
  }
  return shorts;
};

const resolveSpotPrice = (
  asset: string,
  spotPrices?: Record<string, number>,
) => {
  const normalized = normalizeAssetSymbol(asset);
  const live = spotPrices?.[normalized];
  if (Number.isFinite(live) && live > 0) return live;
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
  const positions =
    options.positions ??
    (
      await ctx.db
        .query("positions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).map((position) => ({
      symbol: position.symbol,
      size: position.size,
      marginType: position.marginType ?? "cross",
    }));
  const shortByAsset = buildShortExposureByAsset(positions);
  const spotPrices = options.spotPrices;

  return balances.map((balance) => {
    const normalized = normalizeAssetSymbol(balance.asset);
    const price = resolveSpotPrice(normalized, spotPrices);
    const baseWeight = getCollateralWeight(normalized);
    let weightedValue = balance.balance * price * baseWeight;
    let weight = baseWeight;

    if (normalized === "HYPE") {
      const hedgedSize = Math.min(
        balance.balance,
        shortByAsset[normalized] ?? 0,
      );
      if (hedgedSize > 0 && price > 0) {
        const unhedgedSize = Math.max(0, balance.balance - hedgedSize);
        weightedValue = hedgedSize * price + unhedgedSize * price * baseWeight;
        const denom = balance.balance * price;
        weight = denom > 0 ? weightedValue / denom : baseWeight;
      }
    }

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
