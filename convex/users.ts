import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAuthUser } from "./lib/auth";
import { getAdminConfig } from "./lib/admin";
const DEMO_SEED_VERSION = 4;
const BASE_USDC_BALANCE = 1_000_000;

const normalizeEmail = (value?: string | null) =>
  value?.trim().toLowerCase() ?? "";
const adminEmail = normalizeEmail(getAdminConfig().defaultEmail);
const isAdminEmail = (email?: string | null) =>
  adminEmail.length > 0 && normalizeEmail(email) === adminEmail;

const seedDemoData = async (ctx: MutationCtx, userId: Id<"users">) => {
  const user = await ctx.db.get(userId);
  const currentVersion = user?.demoSeedVersion ?? 0;
  if (currentVersion >= DEMO_SEED_VERSION) return;

  const now = Date.now();

  const positions = await ctx.db
    .query("positions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const position of positions) {
    await ctx.db.delete(position._id);
  }

  const orders = await ctx.db
    .query("orders")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const order of orders) {
    await ctx.db.delete(order._id);
  }

  const trades = await ctx.db
    .query("trades")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const trade of trades) {
    await ctx.db.delete(trade._id);
  }

  const perpsBalances = await ctx.db
    .query("perpsBalances")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  let hasUsdc = false;
  for (const balance of perpsBalances) {
    if (balance.asset === "USDC") {
      await ctx.db.patch(balance._id, {
        balance: BASE_USDC_BALANCE,
        updatedAt: now,
      });
      hasUsdc = true;
      continue;
    }
    await ctx.db.delete(balance._id);
  }
  if (!hasUsdc) {
    await ctx.db.insert("perpsBalances", {
      userId,
      asset: "USDC",
      balance: BASE_USDC_BALANCE,
      updatedAt: now,
    });
  }

  const spotBalances = await ctx.db
    .query("spotBalances")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const balance of spotBalances) {
    await ctx.db.delete(balance._id);
  }

  const metrics = await ctx.db
    .query("portfolioMetrics")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const perpsEquity = BASE_USDC_BALANCE;
  const spotEquity = 0;
  const totalEquity = perpsEquity + spotEquity;
  if (metrics) {
    await ctx.db.patch(metrics._id, {
      volume: 0,
      pnl: 0,
      perpsEquity,
      spotEquity,
      totalEquity,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("portfolioMetrics", {
      userId,
      volume: 0,
      pnl: 0,
      perpsEquity,
      spotEquity,
      totalEquity,
      updatedAt: now,
    });
  }

  await ctx.db.patch(userId, { demoSeedVersion: DEMO_SEED_VERSION });
};

export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated.");
    }
    const now = Date.now();
    const shouldBeAdmin = isAdminEmail(identity.email);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (existing) {
      const updates: {
        lastSeenAt: number;
        name?: string;
        email?: string;
        isAdmin?: boolean;
      } = {
        lastSeenAt: now,
        name: identity.name ?? existing.name,
        email: identity.email ?? existing.email,
      };
      if (shouldBeAdmin && !existing.isAdmin) {
        updates.isAdmin = true;
      } else if (existing.isAdmin == null) {
        updates.isAdmin = false;
      }
      await ctx.db.patch(existing._id, updates);
      await seedDemoData(ctx, existing._id);
      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name: identity.name ?? "Demo Trader",
      email: identity.email,
      isAdmin: shouldBeAdmin,
      createdAt: now,
      lastSeenAt: now,
    });

    await seedDemoData(ctx, userId);
    return userId;
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin ?? false,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
    };
  },
});
