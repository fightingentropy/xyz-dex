import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

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
