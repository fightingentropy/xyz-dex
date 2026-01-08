import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUser, requireAuthUser } from "./lib/auth";
import { updatePortfolioMetrics } from "./lib/portfolio";

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

const calculateMarginUsed = (positions: Doc<"positions">[]) => {
  let marginUsed = 0;
  for (const position of positions) {
    if (position.leverage <= 0) continue;
    if (!Number.isFinite(position.entryPrice) || position.entryPrice <= 0) {
      continue;
    }
    marginUsed +=
      (Math.abs(position.size) * position.entryPrice) / position.leverage;
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
) => {
  let marginUsed = 0;
  let applied = false;

  for (const position of positions) {
    let nextSize = position.size;
    let nextLeverage = position.leverage;
    let price = position.entryPrice;

    if (position.symbol === symbol) {
      applied = true;
      nextSize = position.size + signedSize;
      nextLeverage = leverage;
      price = markPrice;
    }

    if (nextSize === 0 || nextLeverage <= 0) continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    marginUsed += (Math.abs(nextSize) * price) / nextLeverage;
  }

  if (!applied && signedSize !== 0) {
    if (leverage > 0 && Number.isFinite(markPrice) && markPrice > 0) {
      marginUsed += (Math.abs(signedSize) * markPrice) / leverage;
    }
  }

  return marginUsed;
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
    const collateralPositions = positions.filter(
      (position) => position.collateral === args.collateral,
    );
    const signedSize = args.side === "buy" ? args.size : -args.size;
    const currentMarginUsed = calculateMarginUsed(collateralPositions);
    const nextMarginUsed = calculateNextMarginUsed(collateralPositions, {
      symbol: args.symbol,
      signedSize,
      leverage: args.leverage,
      markPrice: args.markPrice,
    });
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
