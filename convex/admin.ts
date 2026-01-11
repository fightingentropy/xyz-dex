import { query } from "./_generated/server";
import { requireAdmin } from "./lib/admin";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const getDashboardStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();

    const [users, metrics, trades, orders, positions] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("portfolioMetrics").collect(),
      ctx.db.query("trades").collect(),
      ctx.db.query("orders").collect(),
      ctx.db.query("positions").collect(),
    ]);

    const totalUsers = users.length;
    const activeUsers24h = users.filter(
      (user) => user.lastSeenAt >= now - ONE_DAY_MS,
    ).length;

    const totals = metrics.reduce(
      (acc, metric) => {
        acc.totalVolume += metric.volume;
        acc.totalEquity += metric.totalEquity;
        acc.totalPnl += metric.pnl;
        return acc;
      },
      { totalVolume: 0, totalEquity: 0, totalPnl: 0 },
    );

    const totalTrades = trades.length;
    const totalFees = trades.reduce((sum, trade) => sum + trade.fee, 0);

    const openOrders = orders.filter(
      (order) => order.status === "open" || order.status === "partial",
    ).length;

    return {
      totalUsers,
      activeUsers24h,
      totalVolume: totals.totalVolume,
      totalEquity: totals.totalEquity,
      totalPnl: totals.totalPnl,
      totalTrades,
      totalFees,
      openOrders,
      openPositions: positions.length,
      updatedAt: now,
    };
  },
});
