import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/admin";
import { updatePortfolioMetrics } from "./lib/portfolio";

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

export const mintPerpsUSDC = mutation({
  args: { amount: v.number() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (!Number.isFinite(args.amount) || args.amount <= 0) {
      throw new ConvexError("Enter a valid USDC amount.");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("perpsBalances")
      .withIndex("by_owner_asset", (q) =>
        q.eq("ownerType", "user").eq("ownerId", admin._id).eq("asset", "USDC"),
      )
      .unique();

    const nextBalance = (existing?.balance ?? 0) + args.amount;
    if (!existing) {
      await ctx.db.insert("perpsBalances", {
        userId: admin._id,
        ownerType: "user",
        ownerId: admin._id,
        asset: "USDC",
        balance: nextBalance,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(existing._id, {
        balance: nextBalance,
        updatedAt: now,
      });
    }

    await updatePortfolioMetrics(ctx, admin._id);

    return { balance: nextBalance };
  },
});
