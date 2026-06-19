import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUser, requireAuthUser } from "./lib/auth";
import {
  calculateWeightedSpotEquity,
  isPortfolioMarginEnabled,
  type PositionExposure,
  updatePortfolioMetrics,
} from "./lib/portfolio";
import {
  getServerFundingRate,
  getServerMarkPrice,
} from "./lib/prices";
import { bumpCounter } from "./lib/stats";

const collateralValidator = v.union(v.literal("USDC"), v.literal("USDT"));
const sideValidator = v.union(v.literal("buy"), v.literal("sell"));
const typeValidator = v.union(v.literal("market"), v.literal("limit"));
const marginTypeValidator = v.union(v.literal("isolated"), v.literal("cross"));
const OWNER_TYPE_USER = "user" as const;
const OWNER_TYPE_VAULT = "vault" as const;

type MarginType = "isolated" | "cross";

type OwnerContext = {
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT;
  ownerId: Id<"users"> | Id<"vaults">;
  userId: Id<"users">;
};

const resolveOwner = async (
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">,
  vaultId?: Id<"vaults">,
): Promise<OwnerContext> => {
  if (!vaultId) {
    return { ownerType: OWNER_TYPE_USER, ownerId: userId, userId };
  }
  const vault = await ctx.db.get(vaultId);
  if (!vault) {
    throw new ConvexError("Vault not found.");
  }
  if (vault.operatorUserId !== userId) {
    throw new ConvexError("Not authorized to trade this vault.");
  }
  if (vault.status !== "active") {
    throw new ConvexError("Vault is not active.");
  }
  return { ownerType: OWNER_TYPE_VAULT, ownerId: vaultId, userId };
};

const resolveOwnerForQuery = async (
  ctx: QueryCtx,
  userId: Id<"users">,
  vaultId?: Id<"vaults">,
) => {
  if (!vaultId) {
    return { ownerType: OWNER_TYPE_USER, ownerId: userId };
  }
  const vault = await ctx.db.get(vaultId);
  if (!vault || vault.operatorUserId !== userId) return null;
  if (vault.status !== "active") return null;
  return { ownerType: OWNER_TYPE_VAULT, ownerId: vaultId };
};

const getPosition = async (
  ctx: MutationCtx | QueryCtx,
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
  symbol: string,
) =>
  ctx.db
    .query("positions")
    .withIndex("by_owner_symbol", (q) =>
      q.eq("ownerType", ownerType).eq("ownerId", ownerId).eq("symbol", symbol),
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
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
  asset: "USDC" | "USDT",
) => {
  const balance = await ctx.db
    .query("perpsBalances")
    .withIndex("by_owner_asset", (q) =>
      q.eq("ownerType", ownerType).eq("ownerId", ownerId).eq("asset", asset),
    )
    .unique();
  return balance?.balance ?? 0;
};

const isValidPrice = (value: number) => Number.isFinite(value) && value > 0;

const resolveMarkPrice = (
  symbol: string,
  markPrices: Record<string, number>,
) => {
  const mark = markPrices[symbol];
  if (isValidPrice(mark)) return mark;
  return 0;
};

/**
 * Build a server-derived mark price map keyed by the EXACT position symbol so
 * downstream margin / PnL helpers can look prices up without ever touching a
 * client-supplied value. Any extra symbols (e.g. the order being placed) are
 * included via `extraSymbols`. Symbols with no fresh oracle price / demo
 * fallback are simply omitted (helpers skip them via isValidPrice).
 */
const buildServerMarkPrices = async (
  ctx: MutationCtx | QueryCtx,
  symbols: string[],
) => {
  const map: Record<string, number> = {};
  const seen = new Set<string>();
  for (const symbol of symbols) {
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    try {
      map[symbol] = await getServerMarkPrice(ctx, symbol);
    } catch {
      // No fresh price and no demo fallback — omit; callers skip via isValidPrice.
    }
  }
  return map;
};

// Margin is charged on FULL notional per spec ("No symbol-scoped hedging").
// Margin used = Σ abs(size) * markPrice / leverage. Spot contributes to buying
// power only through weightedSpotEquity in the collateral pool — never as a
// same-asset offset against perps margin.
const calculateMarginUsed = (
  positions: Doc<"positions">[],
  markPrices: Record<string, number>,
) => {
  let marginUsed = 0;
  for (const position of positions) {
    if (position.leverage <= 0) continue;
    const mark = resolveMarkPrice(position.symbol, markPrices);
    if (!isValidPrice(mark)) continue;
    const size = Math.abs(position.size);
    if (size <= 0) continue;
    marginUsed += (size * mark) / position.leverage;
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
    marginType?: MarginType;
  },
  markPrices: Record<string, number>,
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
    const mark = resolveMarkPrice(position.symbol, markPrices);
    if (!isValidPrice(mark)) continue;
    const size = Math.abs(nextSize);
    if (size <= 0) continue;
    marginUsed += (size * mark) / nextLeverage;
  }

  if (!applied && signedSize !== 0) {
    if (leverage > 0 && isValidPrice(markPrice)) {
      const size = Math.abs(signedSize);
      if (size > 0) {
        marginUsed += (size * markPrice) / leverage;
      }
    }
  }

  return marginUsed;
};

const calculateTotalUnrealizedPnl = (
  positions: Doc<"positions">[],
  markPrices: Record<string, number>,
) => {
  let total = 0;
  for (const position of positions) {
    const mark = resolveMarkPrice(position.symbol, markPrices);
    if (!isValidPrice(mark)) continue;
    if (!isValidPrice(position.entryPrice)) continue;
    total += (mark - position.entryPrice) * position.size;
  }
  return total;
};

const adjustPerpsBalance = async (
  ctx: MutationCtx,
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
  userId: Id<"users"> | null,
  asset: "USDC" | "USDT",
  delta: number,
) => {
  if (!Number.isFinite(delta) || delta === 0) return;
  const existing = await ctx.db
    .query("perpsBalances")
    .withIndex("by_owner_asset", (q) =>
      q.eq("ownerType", ownerType).eq("ownerId", ownerId).eq("asset", asset),
    )
    .unique();
  const now = Date.now();
  if (!existing) {
    // Floor at 0: a debit can never mint a negative balance. The shortfall is
    // treated as bankruptcy for this sim — the loss is capped at available
    // collateral (here, zero).
    await ctx.db.insert("perpsBalances", {
      ...(userId ? { userId } : {}),
      ownerType,
      ownerId,
      asset,
      balance: Math.max(0, delta),
      updatedAt: now,
    });
    return;
  }
  // Floor the resulting balance at 0 so a realized loss never drives the perps
  // balance negative. Credits (positive delta) are unaffected.
  const nextBalance = Math.max(0, existing.balance + delta);
  await ctx.db.patch(existing._id, {
    ...(userId ? { userId } : {}),
    ownerType,
    ownerId,
    balance: nextBalance,
    updatedAt: now,
  });
};

const applyFillToPosition = async (
  ctx: MutationCtx,
  ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT,
  ownerId: Id<"users"> | Id<"vaults">,
  userId: Id<"users"> | null,
  symbol: string,
  signedSize: number,
  fillPrice: number,
  leverage: number,
  collateral: "USDC" | "USDT",
  marginType: MarginType,
) => {
  const existing = await getPosition(ctx, ownerType, ownerId, symbol);
  const now = Date.now();
  let realizedPnl = 0;
  const ownerFields =
    ownerType === OWNER_TYPE_USER
      ? { ownerType, ownerId, userId: userId ?? undefined }
      : { ownerType, ownerId };

  if (!existing) {
    if (signedSize === 0) return 0;
    await ctx.db.insert("positions", {
      ...ownerFields,
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
      ...ownerFields,
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
      ...ownerFields,
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
    ...ownerFields,
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
    ownerType,
    ownerId,
    userId,
    orderId,
    symbol,
    side,
    size,
    price,
    pnl,
  }: {
    ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT;
    ownerId: Id<"users"> | Id<"vaults">;
    userId: Id<"users"> | null;
    orderId?: Id<"orders">;
    symbol: string;
    side: "buy" | "sell";
    size: number;
    price: number;
    pnl: number;
  },
) => {
  const notional = price * size;
  const ownerFields =
    ownerType === OWNER_TYPE_USER
      ? { ownerType, ownerId, userId: userId ?? undefined }
      : { ownerType, ownerId };
  await ctx.db.insert("trades", {
    ...ownerFields,
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
  // Display counters: count every trade; fee is currently 0 everywhere. Volume
  // is counted via updatePortfolioMetrics below (per-user), matching the
  // dashboard's historical semantics.
  await bumpCounter(ctx, "total_trades", 1);
  await bumpCounter(ctx, "total_fees", 0);
  if (ownerType === OWNER_TYPE_USER && userId) {
    await updatePortfolioMetrics(ctx, userId, {
      volumeDelta: notional,
      pnlDelta: pnl,
    });
  }
};

const executeFill = async (
  ctx: MutationCtx,
  {
    ownerType,
    ownerId,
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
    ownerType: typeof OWNER_TYPE_USER | typeof OWNER_TYPE_VAULT;
    ownerId: Id<"users"> | Id<"vaults">;
    userId: Id<"users"> | null;
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
    ownerType,
    ownerId,
    userId,
    symbol,
    signedSize,
    price,
    leverage,
    collateral,
    marginType,
  );
  await adjustPerpsBalance(
    ctx,
    ownerType,
    ownerId,
    userId,
    collateral,
    realizedPnl,
  );
  await recordTrade(ctx, {
    ownerType,
    ownerId,
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
  args: { vaultId: v.optional(v.id("vaults")) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    const owner = await resolveOwnerForQuery(ctx, user._id, args.vaultId);
    if (!owner) return [];
    // Use the by_owner_status_created index with database ordering for efficiency
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_owner_status_created", (q) =>
        q
          .eq("ownerType", owner.ownerType)
          .eq("ownerId", owner.ownerId)
          .eq("status", "open"),
      )
      .order("desc")
      .collect();
    return orders;
  },
});

export const listPositions = query({
  args: { vaultId: v.optional(v.id("vaults")) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    const owner = await resolveOwnerForQuery(ctx, user._id, args.vaultId);
    if (!owner) return [];
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", owner.ownerType).eq("ownerId", owner.ownerId),
      )
      .collect();
    return positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
  },
});

export const updatePositionTpsl = mutation({
  args: {
    symbol: v.string(),
    takeProfit: v.optional(v.union(v.number(), v.null())),
    stopLoss: v.optional(v.union(v.number(), v.null())),
    vaultId: v.optional(v.id("vaults")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const position = await getPosition(
      ctx,
      owner.ownerType,
      owner.ownerId,
      args.symbol,
    );
    if (!position) return;

    const updates: Record<string, number | null> = {};

    if (args.takeProfit !== undefined) {
      if (
        args.takeProfit !== null &&
        (!Number.isFinite(args.takeProfit) || args.takeProfit <= 0)
      ) {
        throw new ConvexError("Invalid take profit price.");
      }
      updates.takeProfit = args.takeProfit;
    }

    if (args.stopLoss !== undefined) {
      if (
        args.stopLoss !== null &&
        (!Number.isFinite(args.stopLoss) || args.stopLoss <= 0)
      ) {
        throw new ConvexError("Invalid stop loss price.");
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
    vaultId: v.optional(v.id("vaults")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", owner.ownerType).eq("ownerId", owner.ownerId),
      )
      .collect();

    const now = Date.now();
    let updatedCount = 0;

    for (const position of positions) {
      // Funding rate and mark price are sourced from the server oracle ONLY.
      // Client-supplied args.fundingRates / args.markPrices are ignored for money.
      let fundingRate: number;
      let markPrice: number;
      try {
        fundingRate = await getServerFundingRate(ctx, position.symbol);
        markPrice = await getServerMarkPrice(ctx, position.symbol);
      } catch {
        // No fresh server price available for this symbol — skip funding.
        continue;
      }

      // Skip if we don't have a usable funding rate or mark price
      if (
        !Number.isFinite(fundingRate) ||
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
        owner.ownerType,
        owner.ownerId,
        owner.ownerType === OWNER_TYPE_USER ? user._id : null,
        position.collateral,
        fundingDelta,
      );

      updatedCount++;
    }

    return { updated: updatedCount };
  },
});

export const listPerpsBalances = query({
  args: { vaultId: v.optional(v.id("vaults")) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];
    const owner = await resolveOwnerForQuery(ctx, user._id, args.vaultId);
    if (!owner) return [];
    return ctx.db
      .query("perpsBalances")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", owner.ownerType).eq("ownerId", owner.ownerId),
      )
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
    // markPrice / markPrices / spotPrices remain accepted for back-compat with
    // the existing client but are IGNORED for all settlement / margin math.
    markPrice: v.optional(v.number()),
    markPrices: v.optional(v.record(v.string(), v.number())),
    spotPrices: v.optional(v.record(v.string(), v.number())),
    marginType: v.optional(marginTypeValidator),
    vaultId: v.optional(v.id("vaults")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const ownerFields =
      owner.ownerType === OWNER_TYPE_USER
        ? {
            userId: user._id,
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
          }
        : { ownerType: owner.ownerType, ownerId: owner.ownerId };
    if (!Number.isFinite(args.size) || args.size <= 0) {
      throw new ConvexError("Size must be positive.");
    }
    if (!Number.isFinite(args.leverage) || args.leverage <= 0) {
      throw new ConvexError("Invalid leverage.");
    }

    // Authoritative server mark for the symbol being traded. Throws if the
    // oracle has no fresh price and no demo fallback.
    const serverMark = await getServerMarkPrice(ctx, args.symbol);

    const marginType = args.marginType ?? "cross";
    const positions = await ctx.db
      .query("positions")
      .withIndex("by_owner", (q) =>
        q.eq("ownerType", owner.ownerType).eq("ownerId", owner.ownerId),
      )
      .collect();
    const signedSize = args.side === "buy" ? args.size : -args.size;

    const portfolioMarginEnabled =
      owner.ownerType === OWNER_TYPE_USER
        ? await isPortfolioMarginEnabled(ctx, user._id)
        : false;
    // Build a price map purely from server marks (existing positions + the
    // order symbol). Client price args never enter this map.
    const markPrices = await buildServerMarkPrices(ctx, [
      args.symbol,
      ...positions.map((position) => position.symbol),
    ]);
    markPrices[args.symbol] = serverMark;

    if (portfolioMarginEnabled) {
      const currentMarginUsed = calculateMarginUsed(positions, markPrices);
      const nextMarginUsed = calculateNextMarginUsed(
        positions,
        {
          symbol: args.symbol,
          signedSize,
          leverage: args.leverage,
          markPrice: serverMark,
          marginType,
        },
        markPrices,
      );
      const perpsBalances = await ctx.db
        .query("perpsBalances")
        .withIndex("by_owner", (q) =>
          q.eq("ownerType", owner.ownerType).eq("ownerId", owner.ownerId),
        )
        .collect();
      const totalPerpsBalance = perpsBalances.reduce(
        (sum, balance) => sum + balance.balance,
        0,
      );
      const exposurePositions: PositionExposure[] = positions.map(
        (position) => ({
          symbol: position.symbol,
          size: position.size,
          marginType: position.marginType ?? "cross",
        }),
      );
      const existingExposure = exposurePositions.find(
        (position) => position.symbol === args.symbol,
      );
      if (existingExposure) {
        existingExposure.size += signedSize;
        existingExposure.marginType = marginType;
        if (existingExposure.size === 0) {
          const idx = exposurePositions.indexOf(existingExposure);
          if (idx >= 0) exposurePositions.splice(idx, 1);
        }
      } else if (signedSize !== 0) {
        exposurePositions.push({
          symbol: args.symbol,
          size: signedSize,
          marginType,
        });
      }
      // Pass undefined for spotPrices so spot equity is valued from server-side
      // prices only (the portfolio lib falls back to its own oracle/demo prices).
      const weightedSpotEquity = await calculateWeightedSpotEquity(
        ctx,
        user._id,
        exposurePositions,
        undefined,
      );
      const totalUnrealized = calculateTotalUnrealizedPnl(
        positions,
        markPrices,
      );
      const collateralPool =
        totalPerpsBalance + weightedSpotEquity + totalUnrealized;

      if (
        nextMarginUsed > collateralPool &&
        nextMarginUsed >= currentMarginUsed
      ) {
        throw new ConvexError("Insufficient collateral.");
      }
    } else {
      const collateralPositions = positions.filter(
        (position) => position.collateral === args.collateral,
      );
      const currentMarginUsed = calculateMarginUsed(
        collateralPositions,
        markPrices,
      );
      const nextMarginUsed = calculateNextMarginUsed(
        collateralPositions,
        {
          symbol: args.symbol,
          signedSize,
          leverage: args.leverage,
          markPrice: serverMark,
          marginType,
        },
        markPrices,
      );
      const availableBalance = await getPerpsBalance(
        ctx,
        owner.ownerType,
        owner.ownerId,
        args.collateral,
      );
      if (
        nextMarginUsed > availableBalance &&
        nextMarginUsed >= currentMarginUsed
      ) {
        throw new ConvexError("Insufficient collateral.");
      }
    }

    const now = Date.now();
    const limitPrice =
      args.type === "limit" && Number.isFinite(args.price ?? NaN)
        ? args.price
        : undefined;
    // The limit `price` is the client's crossing INTENT only. The crossing test
    // compares it to the server mark; the actual fill ALWAYS settles at the
    // server mark, never at the client value.
    const aggressive =
      args.type === "market" ||
      (limitPrice != null &&
        (args.side === "buy"
          ? limitPrice >= serverMark
          : limitPrice <= serverMark));
    const fillPrice = serverMark;

    if (aggressive) {
      const orderId = await ctx.db.insert("orders", {
        ...ownerFields,
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
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        userId: owner.ownerType === OWNER_TYPE_USER ? user._id : null,
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
      ...ownerFields,
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
  args: { orderId: v.id("orders"), vaultId: v.optional(v.id("vaults")) },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const order = await ctx.db.get(args.orderId);
    if (
      !order ||
      order.ownerType !== owner.ownerType ||
      order.ownerId !== owner.ownerId
    ) {
      return;
    }
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
    // markPrice accepted for back-compat but IGNORED — fill settles at server mark.
    markPrice: v.optional(v.number()),
    vaultId: v.optional(v.id("vaults")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const order = await ctx.db.get(args.orderId);
    if (
      !order ||
      order.ownerType !== owner.ownerType ||
      order.ownerId !== owner.ownerId
    ) {
      return;
    }
    if (order.status !== "open") return;

    // The resting order's limit price is only the crossing intent. The actual
    // fill settles at the authoritative server mark price.
    const fillPrice = await getServerMarkPrice(ctx, order.symbol);
    if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
      throw new ConvexError("Invalid fill price.");
    }

    await ctx.db.patch(order._id, {
      status: "filled",
      filledSize: order.size,
      avgFillPrice: fillPrice,
      updatedAt: Date.now(),
    });

    await executeFill(ctx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      userId: owner.ownerType === OWNER_TYPE_USER ? user._id : null,
      orderId: order._id,
      symbol: order.symbol,
      side: order.side,
      size: order.size,
      price: fillPrice,
      leverage: order.leverage,
      collateral: order.collateral,
      marginType: order.marginType ?? "cross",
    });
  },
});

export const closePosition = mutation({
  args: {
    symbol: v.string(),
    // markPrice accepted for back-compat but IGNORED — close settles at server mark.
    markPrice: v.optional(v.number()),
    vaultId: v.optional(v.id("vaults")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const position = await getPosition(
      ctx,
      owner.ownerType,
      owner.ownerId,
      args.symbol,
    );
    if (!position) return;

    // Settlement price is the authoritative server mark, never the client value.
    const markPrice = await getServerMarkPrice(ctx, position.symbol);
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      throw new ConvexError("Invalid mark price.");
    }

    const marginType = position.marginType ?? "cross";
    const side = position.size > 0 ? "sell" : "buy";
    const size = Math.abs(position.size);
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      ...(owner.ownerType === OWNER_TYPE_USER ? { userId: user._id } : {}),
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      symbol: position.symbol,
      side,
      type: "market",
      size,
      filledSize: size,
      avgFillPrice: markPrice,
      leverage: position.leverage,
      collateral: position.collateral,
      marginType,
      status: "filled",
      createdAt: now,
      updatedAt: now,
    });

    await executeFill(ctx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      userId: owner.ownerType === OWNER_TYPE_USER ? user._id : null,
      orderId,
      symbol: position.symbol,
      side,
      size,
      price: markPrice,
      leverage: position.leverage,
      collateral: position.collateral,
      marginType,
    });
  },
});

export const autoDeleveragePosition = mutation({
  args: {
    symbol: v.string(),
    // markPrice accepted for back-compat but IGNORED — ADL settles at server mark.
    markPrice: v.optional(v.number()),
    reduceSize: v.number(),
    vaultId: v.optional(v.id("vaults")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const owner = await resolveOwner(ctx, user._id, args.vaultId);
    const position = await getPosition(
      ctx,
      owner.ownerType,
      owner.ownerId,
      args.symbol,
    );
    if (!position) return;
    if (!Number.isFinite(args.reduceSize) || args.reduceSize <= 0) {
      throw new ConvexError("Invalid reduce size.");
    }

    // Settlement price is the authoritative server mark, never the client value.
    const markPrice = await getServerMarkPrice(ctx, position.symbol);
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      throw new ConvexError("Invalid mark price.");
    }

    const absSize = Math.abs(position.size);
    if (absSize <= 0) return;
    const size = Math.min(absSize, args.reduceSize);
    if (size <= 0) return;

    const marginType = position.marginType ?? "cross";
    const side = position.size > 0 ? "sell" : "buy";
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      ...(owner.ownerType === OWNER_TYPE_USER ? { userId: user._id } : {}),
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      symbol: position.symbol,
      side,
      type: "market",
      size,
      filledSize: size,
      avgFillPrice: markPrice,
      leverage: position.leverage,
      collateral: position.collateral,
      marginType,
      status: "filled",
      createdAt: now,
      updatedAt: now,
    });

    await executeFill(ctx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      userId: owner.ownerType === OWNER_TYPE_USER ? user._id : null,
      orderId,
      symbol: position.symbol,
      side,
      size,
      price: markPrice,
      leverage: position.leverage,
      collateral: position.collateral,
      marginType,
    });
  },
});
