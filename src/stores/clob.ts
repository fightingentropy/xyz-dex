import {
  createEffect,
  createMemo,
  createRoot,
  batch,
  untrack,
  onCleanup,
} from "solid-js";
import { createStore } from "solid-js/store";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { convex, createConvexQuery } from "../lib/convex";
import { isAuthenticated } from "./auth";
import { currentSymbol, markPrice, MARKETS } from "./market";
import type { L2Book as OrderBook } from "../lib/format";

export type Collateral = "USDC" | "USDT";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type MarginType = "isolated" | "cross";

export type { OrderBook };

export type Order = Doc<"orders">;
export type Position = Doc<"positions"> & {
  takeProfit?: number | null;
  stopLoss?: number | null;
};

// Portfolio Margin Status type
export type PortfolioMarginStatus = {
  enabled: boolean;
  hedgingStatus: Array<{
    symbol: string;
    positionSize: number;
    spotBalance: number;
    hedgedSize: number;
    unhedgedSize: number;
    fullyHedged: boolean;
    spotCollateralSize: number;
  }>;
} | null;

type PerpsBalance = {
  asset: string;
  balance: number;
};

const isCollateral = (asset: string): asset is Collateral =>
  asset === "USDC" || asset === "USDT";

const { openOrders, positions, perpsBalances, portfolioMarginStatus } =
  createRoot(() => {
    const openOrdersQuery = createConvexQuery(
      api.orders.listOpenOrders,
      () => {
        return isAuthenticated() ? {} : null;
      },
      [],
    );

    const positionsQuery = createConvexQuery(
      api.orders.listPositions,
      () => {
        return isAuthenticated() ? {} : null;
      },
      [],
    );

    const balancesQuery = createConvexQuery(
      api.orders.listPerpsBalances,
      () => {
        return isAuthenticated() ? {} : null;
      },
      [],
    );

    const portfolioMarginQuery = createConvexQuery(
      api.portfolioMargin.getPortfolioMarginStatus,
      () => {
        return isAuthenticated() ? {} : null;
      },
    );

    const perpsBalances = createMemo<Record<Collateral, number>>(() => {
      const next: Record<Collateral, number> = { USDC: 0, USDT: 0 };
      const balances = (balancesQuery() ?? []) as PerpsBalance[];
      for (const balance of balances) {
        if (isCollateral(balance.asset)) {
          next[balance.asset] = balance.balance;
        }
      }
      return next;
    });

    const positionsAccessor = () => (positionsQuery() ?? []) as Position[];

    const openOrdersAccessor = () => (openOrdersQuery() ?? []) as Order[];

    return {
      openOrders: openOrdersAccessor,
      positions: positionsAccessor,
      perpsBalances,
      portfolioMarginStatus: () =>
        portfolioMarginQuery() as PortfolioMarginStatus,
    };
  });
const [orderBooks] = createStore<Record<string, OrderBook>>({});
const EMPTY_BOOK: OrderBook = { asks: [], bids: [] };

const parseNumber = (value: string | number): number => {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const [lastPrices, setLastPrices] = createStore<Record<string, number>>({});

const ADL_COOLDOWN_MS = 4000;
const ADL_REDUCTION_FRACTION = 0.25;
const ADL_MIN_REDUCTION = 0.0001;

const adlCooldownBySymbol = new Map<string, number>();
const adlInFlight = new Set<string>();
const limitFillInFlight = new Set<Id<"orders">>();
const tpslCloseInFlight = new Set<string>();

export const getMarkPriceForSymbol = (symbol: string) => {
  if (!symbol) return 0;
  const last = lastPrices[symbol];
  if (Number.isFinite(last) && last > 0) return last;
  // Use untrack to prevent creating a subscription to MARKETS inside effects
  const fallback = untrack(() => MARKETS()).find(
    (market) => market.symbol === symbol,
  )?.price;
  return parseNumber(fallback ?? 0);
};

const getUnhedgedSize = (position: Position) => {
  const spotCollateral = position.spotCollateralSize ?? 0;
  const isShort = position.size < 0;
  const hedgedSize = isShort ? spotCollateral : 0;
  return Math.max(0, Math.abs(position.size) - hedgedSize);
};

const shouldTriggerAdl = (
  position: Position,
  mark: number,
  totalUnrealizedByCollateral: Record<Collateral, number>,
) => {
  if (!Number.isFinite(mark) || mark <= 0) return false;
  if (!Number.isFinite(position.entryPrice) || position.entryPrice <= 0) {
    return false;
  }
  if (!Number.isFinite(position.leverage) || position.leverage <= 0)
    return false;

  const isShort = position.size < 0;
  const unhedgedSize = getUnhedgedSize(position);
  if (unhedgedSize <= 0) return false;

  const marginType = position.marginType ?? "cross";
  if (marginType === "isolated") {
    const liqFactor = 1 / position.leverage;
    const liqPrice = isShort
      ? position.entryPrice * (1 + liqFactor)
      : position.entryPrice * (1 - liqFactor);
    if (!Number.isFinite(liqPrice) || liqPrice <= 0) return false;
    return isShort ? mark >= liqPrice : mark <= liqPrice;
  }

  const currentUnrealized = (mark - position.entryPrice) * position.size;
  const balance = perpsBalances()[position.collateral] ?? 0;
  const equity =
    balance +
    (totalUnrealizedByCollateral[position.collateral] - currentUnrealized);
  if (!Number.isFinite(equity)) return false;
  if (equity <= 0) return true;

  const liqPrice = isShort
    ? position.entryPrice + equity / unhedgedSize
    : position.entryPrice - equity / Math.abs(position.size);
  if (!Number.isFinite(liqPrice) || liqPrice <= 0) return false;
  return isShort ? mark >= liqPrice : mark <= liqPrice;
};

const triggerAdlReduction = async (position: Position, mark: number) => {
  if (!isAuthenticated()) return;
  const symbol = position.symbol;
  if (adlInFlight.has(symbol)) return;
  const now = Date.now();
  const last = adlCooldownBySymbol.get(symbol) ?? 0;
  if (now - last < ADL_COOLDOWN_MS) return;

  const absSize = Math.abs(position.size);
  if (!Number.isFinite(absSize) || absSize <= 0) return;
  const reduceSize = Math.min(
    absSize,
    Math.max(absSize * ADL_REDUCTION_FRACTION, ADL_MIN_REDUCTION),
  );
  if (!Number.isFinite(reduceSize) || reduceSize <= 0) return;

  adlInFlight.add(symbol);
  adlCooldownBySymbol.set(symbol, now);
  try {
    await convex.mutation(api.orders.autoDeleveragePosition, {
      symbol,
      markPrice: mark,
      reduceSize,
    });
  } catch (error) {
    console.error("ADL reduction failed:", error);
  } finally {
    adlInFlight.delete(symbol);
  }
};

createRoot(() => {
  // Sync prices for the current symbol from live markPrice.
  // Use untrack to avoid stamping the new symbol with the previous symbol's price.
  createEffect(() => {
    const price = parseNumber(markPrice());
    if (Number.isFinite(price) && price > 0) {
      const symbol = untrack(() => currentSymbol());
      setLastPrices(symbol, price);
    }
  });

  // Sync prices for ALL symbols from MARKETS data (ensures position prices are accurate)
  createEffect(() => {
    const markets = MARKETS();
    // Batch all updates to prevent triggering effects mid-iteration
    batch(() => {
      for (const market of markets) {
        const price = parseNumber(market.price);
        if (Number.isFinite(price) && price > 0) {
          setLastPrices(market.symbol, price);
        }
      }
    });
  });

  createEffect(() => {
    if (!isAuthenticated()) return;
    const activePositions = positions();
    if (activePositions.length === 0) return;

    const totalUnrealized: Record<Collateral, number> = { USDC: 0, USDT: 0 };
    for (const position of activePositions) {
      const mark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;
      totalUnrealized[position.collateral] +=
        (mark - position.entryPrice) * position.size;
    }

    for (const position of activePositions) {
      const mark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;
      if (!shouldTriggerAdl(position, mark, totalUnrealized)) continue;
      void triggerAdlReduction(position, mark);
    }
  });

  createEffect(() => {
    if (!isAuthenticated()) return;
    const orders = openOrders();
    if (orders.length === 0) return;

    for (const order of orders) {
      if (order.type !== "limit") continue;
      const limitPrice = typeof order.price === "number" ? order.price : null;
      if (
        limitPrice === null ||
        !Number.isFinite(limitPrice) ||
        limitPrice <= 0
      )
        continue;
      const mark = getMarkPriceForSymbol(order.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;

      const shouldFill =
        order.side === "buy" ? mark <= limitPrice : mark >= limitPrice;
      if (!shouldFill) continue;
      if (limitFillInFlight.has(order._id)) continue;

      limitFillInFlight.add(order._id);
      void convex
        .mutation(api.orders.fillOpenOrder, {
          orderId: order._id,
          markPrice: mark,
        })
        .catch((error) => {
          console.error("Failed to auto-fill limit order:", error);
        })
        .finally(() => {
          limitFillInFlight.delete(order._id);
        });
    }
  });

  createEffect(() => {
    if (!isAuthenticated()) return;
    const activePositions = positions();
    if (activePositions.length === 0) return;

    for (const position of activePositions) {
      if (position.size === 0) continue;
      if (tpslCloseInFlight.has(position.symbol)) continue;
      const mark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;

      const takeProfit = position.takeProfit ?? null;
      const stopLoss = position.stopLoss ?? null;
      const isLong = position.size > 0;

      const tpHit =
        takeProfit != null &&
        Number.isFinite(takeProfit) &&
        (isLong ? mark >= takeProfit : mark <= takeProfit);
      const slHit =
        stopLoss != null &&
        Number.isFinite(stopLoss) &&
        (isLong ? mark <= stopLoss : mark >= stopLoss);

      if (!tpHit && !slHit) continue;
      tpslCloseInFlight.add(position.symbol);
      void convex
        .mutation(api.orders.closePosition, {
          symbol: position.symbol,
          markPrice: mark,
        })
        .catch((error) => {
          console.error("Failed to auto-close position:", error);
        })
        .finally(() => {
          tpslCloseInFlight.delete(position.symbol);
        });
    }
  });

  // Update funding for positions at the top of each hour.
  let fundingUpdateTimeout: number | undefined;

  /**
   * Calculate the next funding payment time.
   * Funding payments are hourly, so we align to the next top-of-hour.
   */
  const getNextFundingPaymentTime = (): number => {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.getTime();
  };

  const scheduleNextFundingUpdate = () => {
    if (fundingUpdateTimeout) {
      clearTimeout(fundingUpdateTimeout);
      fundingUpdateTimeout = undefined;
    }

    const nextPaymentTime = getNextFundingPaymentTime();
    const now = Date.now();
    const delay = Math.max(0, nextPaymentTime - now);

    fundingUpdateTimeout = setTimeout(() => {
      void updateFunding().then(() => {
        // After updating, schedule the next one (hourly).
        scheduleNextFundingUpdate();
      });
    }, delay) as unknown as number;
  };

  const updateFunding = async () => {
    if (!isAuthenticated()) return;
    const activePositions = positions();
    if (activePositions.length === 0) return;

    const markets = untrack(() => MARKETS());
    const fundingRates: Record<string, number> = {};
    const markPrices: Record<string, number> = {};

    for (const position of activePositions) {
      const market = markets.find(
        (m) => m.symbol === position.symbol && m.type === "perps",
      );
      if (!market) continue;

      const mark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;

      // Convert funding from percentage to decimal (e.g., 0.01% -> 0.0001)
      const fundingRateDecimal = market.funding / 100;
      fundingRates[position.symbol] = fundingRateDecimal;
      markPrices[position.symbol] = mark;
    }

    if (Object.keys(fundingRates).length > 0) {
      try {
        await convex.mutation(api.orders.updateFundingForPositions, {
          fundingRates,
          markPrices,
        });
      } catch (error) {
        console.error("Failed to update funding:", error);
      }
    }
  };

  // Update funding immediately when positions change, then at funding payment times
  createEffect(() => {
    if (!isAuthenticated()) {
      if (fundingUpdateTimeout) {
        clearTimeout(fundingUpdateTimeout);
        fundingUpdateTimeout = undefined;
      }
      return;
    }

    const activePositions = positions();
    if (activePositions.length === 0) {
      if (fundingUpdateTimeout) {
        clearTimeout(fundingUpdateTimeout);
        fundingUpdateTimeout = undefined;
      }
      return;
    }

    // Update immediately
    void updateFunding();

    // Schedule next update at the next funding payment time
    scheduleNextFundingUpdate();

    onCleanup(() => {
      if (fundingUpdateTimeout) {
        clearTimeout(fundingUpdateTimeout);
        fundingUpdateTimeout = undefined;
      }
    });
  });
});

export const getOrderBook = (symbol: string) => {
  return orderBooks[symbol] ?? EMPTY_BOOK;
};

export const getPositionForSymbol = (symbol: string) =>
  positions().find((pos) => pos.symbol === symbol);

export const getAvailableBalance = (collateral: Collateral) => {
  const balance = perpsBalances()[collateral] ?? 0;
  const marginUsed = positions()
    .filter((pos) => pos.collateral === collateral)
    .reduce((sum, pos) => {
      const mark = getMarkPriceForSymbol(pos.symbol);
      if (!Number.isFinite(mark) || mark <= 0 || pos.leverage <= 0) return sum;
      // Account for spot collateral - only unhedged portion uses USDC margin
      const spotCollateral = pos.spotCollateralSize ?? 0;
      const unhedgedSize = Math.max(0, Math.abs(pos.size) - spotCollateral);
      const notional = unhedgedSize * mark;
      return sum + notional / pos.leverage;
    }, 0);
  return Math.max(balance - marginUsed, 0);
};

// Portfolio Margin helpers
export const isPortfolioMarginEnabled = () => {
  const status = portfolioMarginStatus();
  return status?.enabled ?? false;
};

export const getHedgingStatusForSymbol = (symbol: string) => {
  const status = portfolioMarginStatus();
  if (!status) return null;
  return status.hedgingStatus.find((h) => h.symbol === symbol) ?? null;
};

export const togglePortfolioMargin = async (
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> => {
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to change settings." };
  }
  try {
    await convex.mutation(api.portfolioMargin.togglePortfolioMargin, {
      enabled,
    });
    // Recalculate spot collateral for all positions
    await convex.mutation(api.portfolioMargin.recalculateSpotCollateral, {});
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update portfolio margin.";
    console.error("Failed to toggle portfolio margin:", error);
    return { ok: false, error: message };
  }
};

export const getBalance = (collateral: Collateral) =>
  perpsBalances()[collateral] ?? 0;

export const placeOrder = async ({
  symbol,
  side,
  type,
  size,
  price,
  leverage,
  collateral,
  marginType,
}: {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  size: number;
  price?: number;
  leverage: number;
  collateral: Collateral;
  marginType: MarginType;
}): Promise<{ ok: boolean; error?: string }> => {
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to place orders." };
  }
  if (!symbol || size <= 0) {
    return { ok: false, error: "Enter a valid size." };
  }

  const mark = getMarkPriceForSymbol(symbol);
  if (!Number.isFinite(mark) || mark <= 0) {
    return { ok: false, error: "Mark price unavailable." };
  }

  try {
    await convex.mutation(api.orders.placePerpsOrder, {
      symbol,
      side,
      type,
      size,
      price: Number.isFinite(price ?? NaN) ? price : undefined,
      leverage,
      collateral,
      marginType,
      markPrice: mark,
    });
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Order submission failed.";
    console.error("Failed to place order:", error);
    return { ok: false, error: message };
  }
};

export const updatePositionTpsl = async ({
  symbol,
  takeProfit,
  stopLoss,
}: {
  symbol: string;
  takeProfit?: number | null;
  stopLoss?: number | null;
}): Promise<{ ok: boolean; error?: string }> => {
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to update TP/SL." };
  }
  if (takeProfit != null && (!Number.isFinite(takeProfit) || takeProfit <= 0)) {
    return { ok: false, error: "Enter a valid take profit price." };
  }
  if (stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) {
    return { ok: false, error: "Enter a valid stop loss price." };
  }

  try {
    await convex.mutation(api.orders.updatePositionTpsl, {
      symbol,
      takeProfit: takeProfit ?? null,
      stopLoss: stopLoss ?? null,
    });
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update TP/SL.";
    console.error("Failed to update TP/SL:", error);
    return { ok: false, error: message };
  }
};

export const cancelOrder = async (orderId: Id<"orders">) => {
  if (!isAuthenticated()) return;
  try {
    await convex.mutation(api.orders.cancelOrder, { orderId });
  } catch (error) {
    console.error("Failed to cancel order:", error);
  }
};

export const fillOpenOrder = async (orderId: Id<"orders">) => {
  if (!isAuthenticated()) return;
  const order = openOrders().find((item) => item._id === orderId);
  if (!order || order.status !== "open") return;
  const fillMark = getMarkPriceForSymbol(order.symbol);
  if (!Number.isFinite(fillMark) || fillMark <= 0) return;
  try {
    await convex.mutation(api.orders.fillOpenOrder, {
      orderId,
      markPrice: fillMark,
    });
  } catch (error) {
    console.error("Failed to fill order:", error);
  }
};

export const closePosition = async (symbol: string) => {
  if (!isAuthenticated()) return;
  const position = positions().find((pos) => pos.symbol === symbol);
  if (!position) return;
  const mark = getMarkPriceForSymbol(symbol);
  if (!Number.isFinite(mark) || mark <= 0) return;
  try {
    await convex.mutation(api.orders.closePosition, {
      symbol,
      markPrice: mark,
    });
  } catch (error) {
    console.error("Failed to close position:", error);
  }
};

export { openOrders, positions, portfolioMarginStatus };
