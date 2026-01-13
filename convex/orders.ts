import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUser, requireAuthUser } from "./lib/auth";
import {
  calculateWeightedSpotEquity,
  getDemoPrice,
  isPortfolioMarginEnabled,
  updatePortfolioMetrics,
} from "./lib/portfolio";

const collateralValidator = v.union(v.literal("USDC"), v.literal("USDT"));
const sideValidator = v.union(v.literal("buy"), v.literal("sell"));
const typeValidator = v.union(v.literal("market"), v.literal("limit"));
const marginTypeValidator = v.union(v.literal("isolated"), v.literal("cross"));

type MarginType = "isolated" | "cross";

const getPosition = async (
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">,
  symbol: string,
) =>
  ctx.db
    .query("positions")
    .withIndex("by_user_symbol", (q) =>
      q.eq("userId", userId).eq("symbol", symbol),
    )
    .unique();

/**
 * Calculate funding for a position for each hour since lastFundingUpdate.
 * Funding is calculated as: positionNotional * fundingRate per hour
 * For longs: positive funding rate means paying (negative), negative means receiving (positive)
 * For shorts: opposite
 */
const calculateFundingForHours = (
  position: Doc<"positions">,
  fundingRate: number, // Funding rate in decimal form (e.g., 0.0001 = 0.01%)
  markPrice: number,
  hoursElapsed: number,
): number => {
  if (hoursElapsed <= 0 || position.size === 0) return 0;

  const positionNotional = Math.abs(position.size) * markPrice;
  const isLong = position.size > 0;

  // Calculate funding for each hour
  // For longs: if funding rate is positive, they pay (negative), if negative, they receive (positive)
  // For shorts: opposite - positive funding rate means receiving (positive), negative means paying (negative)
  const fundingPerHour = isLong
    ? -positionNotional * fundingRate
    : positionNotional * fundingRate;

  // Sum funding for all hours
  return fundingPerHour * hoursElapsed;
};

const getPerpsBalance = async (
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">,
  asset: "USDC" | "USDT",
) => {
  const balance = await ctx.db
    .query("perpsBalances")
    .withIndex("by_user_asset", (q) =>
      q.eq("userId", userId).eq("asset", asset),
    )
    .unique();
  return balance?.balance ?? 0;
};

const isValidPrice = (value: number) => Number.isFinite(value) && value > 0;

const resolveMarkPrice = (
  symbol: string,
  markOverrides: Record<string, number>,
) => {
  const override = markOverrides[symbol];
  if (isValidPrice(override)) return override;
  const demo = getDemoPrice(symbol);
  if (isValidPrice(demo)) return demo;
  return 0;
};

const calculateMarginUsed = (
  positions: Doc<"positions">[],
  markOverrides: Record<string, number>,
) => {
  let marginUsed = 0;
  for (const position of positions) {
    if (position.leverage <= 0) continue;
    const mark = resolveMarkPrice(position.symbol, markOverrides);
    if (!isValidPrice(mark)) continue;
    marginUsed += (Math.abs(position.size) * mark) / position.leverage;
  }
  return marginUsed;
};

const calculateNextMarginUsed = (
  positions: Doc<"positions">[],
  {
    symbol,
    signedSize,
    leverage,
    markPrice,
  }: {
    symbol: string;
    signedSize: number;
    leverage: number;
    markPrice: number;
  },
  markOverrides: Record<string, number>,
) => {
  let marginUsed = 0;
  let applied = false;

  for (const position of positions) {
    let nextSize = position.size;
    let nextLeverage = position.leverage;

    if (position.symbol === symbol) {
      applied = true;
      nextSize = position.size + signedSize;
      nextLeverage = leverage;
    }

    if (nextSize === 0 || nextLeverage <= 0) continue;
    const mark = resolveMarkPrice(position.symbol, markOverrides);
    if (!isValidPrice(mark)) continue;
    marginUsed += (Math.abs(nextSize) * mark) / nextLeverage;
  }

  if (!applied && signedSize !== 0) {
    if (leverage > 0 && isValidPrice(markPrice)) {
      marginUsed += (Math.abs(signedSize) * markPrice) / leverage;
    }
  }

  return marginUsed;
};

const calculateTotalUnrealizedPnl = (
  positions: Doc<"positions">[],
  markOverrides: Record<string, number>,
) => {
  let total = 0;
  for (const position of positions) {
    const mark = resolveMarkPrice(position.symbol, markOverrides);
    if (!isValidPrice(mark)) continue;
    if (!isValidPrice(position.entryPrice)) continue;
    total += (mark - position.entryPrice) * position.size;
  }
  return total;
};

const adjustPerpsBalance = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  asset: "USDC" | "USDT",
  delta: number,
) => {
  if (!Number.isFinite(delta) || delta === 0) return;
  const existing = await ctx.db
    .query("perpsBalances")
    .withIndex("by_user_asset", (q) =>
      q.eq("userId", userId).eq("asset", asset),
    )
    .unique();
  const now = Date.now();
  if (!existing) {
    await ctx.db.insert("perpsBalances", {
      userId,
      asset,
      balance: delta,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.patch(existing._id, {
    balance: existing.balance + delta,
    updatedAt: now,
  });
};

const applyFillToPosition = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  symbol: string,
  signedSize: number,
  fillPrice: number,
  leverage: number,
  collateral: "USDC" | "USDT",
  marginType: MarginType,
) => {
  const existing = await getPosition(ctx, userId, symbol);
  const now = Date.now();
  let realizedPnl = 0;

  if (!existing) {
    if (signedSize === 0) return 0;
    await ctx.db.insert("positions", {
      userId,
      symbol,
      size: signedSize,
      entryPrice: fillPrice,
      leverage,
      collateral,
      marginType,
      realizedPnl: 0,
      cumulativeFunding: 0,
      lastFundingUpdate: now,
      updatedAt: now,
    });
    return 0;
  }

  const nextSize = existing.size + signedSize;
  const sameDirection =
    Math.sign(existing.size) === Math.sign(signedSize) || signedSize === 0;

  if (sameDirection) {
    const totalAbs = Math.abs(existing.size) + Math.abs(signedSize);
    const nextEntry =
      totalAbs === 0
        ? fillPrice
        : (existing.entryPrice * Math.abs(existing.size) +
            fillPrice * Math.abs(signedSize)) /
          totalAbs;

    await ctx.db.patch(existing._id, {
      size: nextSize,
      entryPrice: nextEntry,
      leverage,
      collateral,
      marginType,
      updatedAt: now,
    });
    return 0;
  }

  const closedSize = Math.min(Math.abs(existing.size), Math.abs(signedSize));
  if (existing.size > 0) {
    realizedPnl = (fillPrice - existing.entryPrice) * closedSize;
  } else {
    realizedPnl = (existing.entryPrice - fillPrice) * closedSize;
  }
  const nextRealized = existing.realizedPnl + realizedPnl;

  if (Math.abs(signedSize) < Math.abs(existing.size)) {
    await ctx.db.patch(existing._id, {
      size: nextSize,
      realizedPnl: nextRealized,
      updatedAt: now,
    });
    return realizedPnl;
  }

  if (Math.abs(signedSize) === Math.abs(existing.size)) {
    await ctx.db.delete(existing._id);
    return realizedPnl;
  }

  await ctx.db.patch(existing._id, {
    size: nextSize,
    entryPrice: fillPrice,
    leverage,
    collateral,
    marginType,
    takeProfit: null,
    stopLoss: null,
    realizedPnl: nextRealized,
    updatedAt: now,
  });
  return realizedPnl;
};

const recordTrade = async (
  ctx: MutationCtx,
  {
    userId,
    orderId,
    symbol,
    side,
    size,
    price,
    pnl,
  }: {
    userId: Id<"users">;
    orderId?: Id<"orders">;
    symbol: string;
    side: "buy" | "sell";
    size: number;
    price: number;
    pnl: number;
  },
) => {
  const notional = price * size;
  await ctx.db.insert("trades", {
    userId,
    symbol,
    side,
    price,
    size,
    notional,
    fee: 0,
    pnl,
    orderId,
    createdAt: Date.now(),
  });
  await updatePortfolioMetrics(ctx, userId, {
    volumeDelta: notional,
    pnlDelta: pnl,
  });
};

const executeFill = async (
  ctx: MutationCtx,
  {
    userId,
    orderId,
    symbol,
    side,
    size,
    price,
    leverage,
    collateral,
    marginType,
  }: {
    userId: Id<"users">;
    orderId?: Id<"orders">;
    symbol: string;
    side: "buy" | "sell";
    size: number;
    price: number;
    leverage: number;
    collateral: "USDC" | "USDT";
    marginType: MarginType;
  },
) => {
  const signedSize = side === "buy" ? size : -size;
  const realizedPnl = await applyFillToPosition(
    ctx,
    userId,
    symbol,
    signedSize,
    price,
    leverage,
    collateral,
    marginType,
  );
  await adjustPerpsBalance(ctx, userId, collateral, realizedPnl);
  await recordTrade(ctx, {
    userId,
    orderId,
    symbol,
    side,
    size,
    price,
    pnl: realizedPnl,
  });
};

export const listOpenOrders = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    // Use the by_user_status_created index with database ordering for efficiency
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_user_status_created", (q) =>
        q.eq("userId", user._id).eq("status", "open"),
      )
      .order("desc")
      .collect();
    return orders;
  },
});

export const listPositions = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
  },
});

export const updatePositionTpsl = mutation({
  args: {
    symbol: v.string(),
    takeProfit: v.optional(v.union(v.number(), v.null())),
    stopLoss: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const position = await getPosition(ctx, user._id, args.symbol);
    if (!position) return;

    const updates: Record<string, number | null> = {};

    if (args.takeProfit !== undefined) {
      if (
        args.takeProfit !== null &&
        (!Number.isFinite(args.takeProfit) || args.takeProfit <= 0)
      ) {
        throw new Error("Invalid take profit price.");
      }
      updates.takeProfit = args.takeProfit;
    }

    if (args.stopLoss !== undefined) {
      if (
        args.stopLoss !== null &&
        (!Number.isFinite(args.stopLoss) || args.stopLoss <= 0)
      ) {
        throw new Error("Invalid stop loss price.");
      }
      updates.stopLoss = args.stopLoss;
    }

    if (Object.keys(updates).length === 0) return;
    await ctx.db.patch(position._id, updates);
  },
});

/**
 * Update funding for positions based on funding rates.
 * This should be called periodically (e.g., every hour) to accumulate funding.
 * Funding rates should be in decimal form (e.g., 0.0001 = 0.01%)
 */
export const updateFundingForPositions = mutation({
  args: {
    fundingRates: v.optional(v.record(v.string(), v.number())), // Map of symbol -> funding rate (decimal)
    markPrices: v.optional(v.record(v.string(), v.number())), // Map of symbol -> mark price
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const now = Date.now();
    const fundingRates = args.fundingRates ?? {};
    const markPrices = args.markPrices ?? {};
    let updatedCount = 0;

    for (const position of positions) {
      const fundingRate = fundingRates[position.symbol];
      const markPrice = markPrices[position.symbol];

      // Skip if we don't have funding rate or mark price
      if (
        fundingRate === undefined ||
        !Number.isFinite(fundingRate) ||
        markPrice === undefined ||
        !Number.isFinite(markPrice) ||
        markPrice <= 0
      ) {
        continue;
      }

      // Calculate hours elapsed since last funding update (or position creation)
      const lastUpdate = position.lastFundingUpdate ?? position.updatedAt;
      const totalHoursElapsed = (now - lastUpdate) / (1000 * 60 * 60);

      // Calculate funding for each full hour (round down)
      const fullHoursElapsed = Math.floor(totalHoursElapsed);

      // Only update if at least 1 full hour has passed
      if (fullHoursElapsed < 1) {
        continue;
      }

      // Calculate funding for each hour
      const fundingDelta = calculateFundingForHours(
        position,
        fundingRate,
        markPrice,
        fullHoursElapsed,
      );

      // Update lastFundingUpdate to the start of the current hour
      // This ensures we don't double-count partial hours
      const hoursInMs = fullHoursElapsed * 60 * 60 * 1000;
      const newLastUpdate = lastUpdate + hoursInMs;

      // Update cumulative funding
      const currentFunding = position.cumulativeFunding ?? 0;
      const newFunding = currentFunding + fundingDelta;

      // Update position with new funding and lastFundingUpdate timestamp
      // Use newLastUpdate to avoid double-counting partial hours
      await ctx.db.patch(position._id, {
        cumulativeFunding: newFunding,
        lastFundingUpdate: newLastUpdate,
        updatedAt: now,
      });

      // Adjust balance based on funding (funding affects the perps balance)
      await adjustPerpsBalance(
        ctx,
        user._id,
        position.collateral,
        fundingDelta,
      );

      updatedCount++;
    }

    return { updated: updatedCount };
  },
});

export const listPerpsBalances = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    return ctx.db
      .query("perpsBalances")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const placePerpsOrder = mutation({
  args: {
    symbol: v.string(),
    side: sideValidator,
    type: typeValidator,
    size: v.number(),
    price: v.optional(v.number()),
    leverage: v.number(),
    collateral: collateralValidator,
    markPrice: v.number(),
    markPrices: v.optional(v.record(v.string(), v.number())),
    marginType: v.optional(marginTypeValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    if (!Number.isFinite(args.size) || args.size <= 0) {
      throw new Error("Size must be positive.");
    }
    if (!Number.isFinite(args.markPrice) || args.markPrice <= 0) {
      throw new Error("Invalid mark price.");
    }
    if (!Number.isFinite(args.leverage) || args.leverage <= 0) {
      throw new Error("Invalid leverage.");
    }

    const marginType = args.marginType ?? "cross";
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const signedSize = args.side === "buy" ? args.size : -args.size;

    const portfolioMarginEnabled = await isPortfolioMarginEnabled(
      ctx,
      user._id,
    );
    const markOverrides = {
      ...(args.markPrices ?? {}),
      [args.symbol]: args.markPrice,
    };

    if (portfolioMarginEnabled) {
      const currentMarginUsed = calculateMarginUsed(positions, markOverrides);
      const nextMarginUsed = calculateNextMarginUsed(
        positions,
        {
          symbol: args.symbol,
          signedSize,
          leverage: args.leverage,
          markPrice: args.markPrice,
        },
        markOverrides,
      );
      const perpsBalances = await ctx.db
        .query("perpsBalances")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const totalPerpsBalance = perpsBalances.reduce(
        (sum, balance) => sum + balance.balance,
        0,
      );
      const weightedSpotEquity = await calculateWeightedSpotEquity(
        ctx,
        user._id,
      );
      const totalUnrealized = calculateTotalUnrealizedPnl(
        positions,
        markOverrides,
      );
      const collateralPool =
        totalPerpsBalance + weightedSpotEquity + totalUnrealized;

      if (
        nextMarginUsed > collateralPool &&
        nextMarginUsed >= currentMarginUsed
      ) {
        throw new Error("Insufficient collateral.");
      }
    } else {
      const collateralPositions = positions.filter(
        (position) => position.collateral === args.collateral,
      );
      const currentMarginUsed = calculateMarginUsed(
        collateralPositions,
        markOverrides,
      );
      const nextMarginUsed = calculateNextMarginUsed(
        collateralPositions,
        {
          symbol: args.symbol,
          signedSize,
          leverage: args.leverage,
          markPrice: args.markPrice,
        },
        markOverrides,
      );
      const availableBalance = await getPerpsBalance(
        ctx,
        user._id,
        args.collateral,
      );
      if (
        nextMarginUsed > availableBalance &&
        nextMarginUsed >= currentMarginUsed
      ) {
        throw new Error("Insufficient collateral.");
      }
    }

    const now = Date.now();
    const limitPrice =
      args.type === "limit" && Number.isFinite(args.price ?? NaN)
        ? args.price
        : undefined;
    const aggressive =
      args.type === "market" ||
      (limitPrice != null &&
        (args.side === "buy"
          ? limitPrice >= args.markPrice
          : limitPrice <= args.markPrice));
    const fillPrice =
      args.type === "market" ? args.markPrice : (limitPrice ?? args.markPrice);

    if (aggressive) {
      const orderId = await ctx.db.insert("orders", {
        userId: user._id,
        symbol: args.symbol,
        side: args.side,
        type: args.type,
        ...(limitPrice != null ? { price: limitPrice } : {}),
        size: args.size,
        filledSize: args.size,
        avgFillPrice: fillPrice,
        leverage: args.leverage,
        collateral: args.collateral,
        marginType,
        status: "filled",
        createdAt: now,
        updatedAt: now,
      });

      await executeFill(ctx, {
        userId: user._id,
        orderId,
        symbol: args.symbol,
        side: args.side,
        size: args.size,
        price: fillPrice,
        leverage: args.leverage,
        collateral: args.collateral,
        marginType,
      });
      return { orderId, status: "filled" as const };
    }

    const orderId = await ctx.db.insert("orders", {
      userId: user._id,
      symbol: args.symbol,
      side: args.side,
      type: args.type,
      ...(limitPrice != null ? { price: limitPrice } : {}),
      size: args.size,
      filledSize: 0,
      leverage: args.leverage,
      collateral: args.collateral,
      marginType,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    return { orderId, status: "open" as const };
  },
});

export const cancelOrder = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order || order.userId !== user._id) return;
    if (order.status !== "open") return;
    await ctx.db.patch(order._id, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
  },
});

export const fillOpenOrder = mutation({
  args: {
    orderId: v.id("orders"),
    markPrice: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order || order.userId !== user._id) return;
    if (order.status !== "open") return;

    const fillPrice =
      order.price ?? (Number.isFinite(args.markPrice) ? args.markPrice : 0);
    if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
      throw new Error("Invalid fill price.");
    }

    await ctx.db.patch(order._id, {
      status: "filled",
      filledSize: order.size,
      avgFillPrice: fillPrice,
      updatedAt: Date.now(),
    });

    await executeFill(ctx, {
      userId: user._id,
      orderId: order._id,
      symbol: order.symbol,
      side: order.side,
      size: order.size,
      price: fillPrice,
      leverage: order.leverage,
      collateral: order.collateral,
      marginType: order.marginType ?? "isolated",
    });
  },
});

export const closePosition = mutation({
  args: {
    symbol: v.string(),
    markPrice: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const position = await getPosition(ctx, user._id, args.symbol);
    if (!position) return;
    if (!Number.isFinite(args.markPrice) || args.markPrice <= 0) {
      throw new Error("Invalid mark price.");
    }

    const side = position.size > 0 ? "sell" : "buy";
    const size = Math.abs(position.size);
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      userId: user._id,
      symbol: position.symbol,
      side,
      type: "market",
      size,
      filledSize: size,
      avgFillPrice: args.markPrice,
      leverage: position.leverage,
      collateral: position.collateral,
      marginType: position.marginType ?? "isolated",
      status: "filled",
      createdAt: now,
      updatedAt: now,
    });

    await executeFill(ctx, {
      userId: user._id,
      orderId,
      symbol: position.symbol,
      side,
      size,
      price: args.markPrice,
      leverage: position.leverage,
      collateral: position.collateral,
      marginType: position.marginType ?? "isolated",
    });
  },
});

export const autoDeleveragePosition = mutation({
  args: {
    symbol: v.string(),
    markPrice: v.number(),
    reduceSize: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const position = await getPosition(ctx, user._id, args.symbol);
    if (!position) return;
    if (!Number.isFinite(args.markPrice) || args.markPrice <= 0) {
      throw new Error("Invalid mark price.");
    }
    if (!Number.isFinite(args.reduceSize) || args.reduceSize <= 0) {
      throw new Error("Invalid reduce size.");
    }

    const absSize = Math.abs(position.size);
    if (absSize <= 0) return;
    const size = Math.min(absSize, args.reduceSize);
    if (size <= 0) return;

    const side = position.size > 0 ? "sell" : "buy";
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      userId: user._id,
      symbol: position.symbol,
      side,
      type: "market",
      size,
      filledSize: size,
      avgFillPrice: args.markPrice,
      leverage: position.leverage,
      collateral: position.collateral,
      marginType: position.marginType ?? "isolated",
      status: "filled",
      createdAt: now,
      updatedAt: now,
    });

    await executeFill(ctx, {
      userId: user._id,
      orderId,
      symbol: position.symbol,
      side,
      size,
      price: args.markPrice,
      leverage: position.leverage,
      collateral: position.collateral,
      marginType: position.marginType ?? "isolated",
    });
  },
});
