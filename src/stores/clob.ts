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
import type { OrderBookLevel, L2Book as OrderBook } from "../lib/format";

export type Collateral = "USDC" | "USDT";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type MarginType = "isolated" | "cross";

export type { OrderBookLevel, OrderBook };

export type Order = Doc<"orders">;
export type Position = Doc<"positions">;

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
      const balances = balancesQuery() ?? [];
      for (const balance of balances) {
        if (balance.asset === "USDC" || balance.asset === "USDT") {
          next[balance.asset] = balance.balance;
        }
      }
      return next;
    });

    return {
      openOrders: () => openOrdersQuery() ?? [],
      positions: () => positionsQuery() ?? [],
      perpsBalances,
      portfolioMarginStatus: () =>
        portfolioMarginQuery() as PortfolioMarginStatus,
    };
  });
const [orderBooks, setOrderBooks] = createStore<Record<string, OrderBook>>({});

const parseNumber = (value: string | number): number => {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const [lastPrices, setLastPrices] = createStore<Record<string, number>>({});

const getTickSize = (price: number) => {
  if (price >= 10000) return 10;
  if (price >= 1000) return 1;
  if (price >= 100) return 0.1;
  if (price >= 10) return 0.01;
  if (price >= 1) return 0.001;
  return 0.0001;
};

const countDecimals = (value: number) => {
  const text = value.toString();
  if (!text.includes(".")) return 0;
  return text.split(".")[1]?.length ?? 0;
};

const roundToTick = (value: number, tick: number) => {
  const decimals = countDecimals(tick);
  return Number((Math.round(value / tick) * tick).toFixed(decimals));
};

const LEVEL_COUNT = 24;
const LIQUIDITY_FRACTION = 0.01;
const MIN_LIQUIDITY_NOTIONAL = 150_000;
const MAX_LIQUIDITY_NOTIONAL = 10_000_000;
const BOOK_REFRESH_THRESHOLD = 0.0025;
const ADL_COOLDOWN_MS = 4000;
const ADL_REDUCTION_FRACTION = 0.25;
const ADL_MIN_REDUCTION = 0.0001;

const adlCooldownBySymbol = new Map<string, number>();
const adlInFlight = new Set<string>();

const levelMultiplier = (seed: number, index: number) => {
  const wave = Math.sin(seed + index) * 10000;
  const variation = wave - Math.floor(wave);
  return 0.7 + variation * 0.6 + index * 0.02;
};

const getLiquidityNotional = (symbol: string) => {
  // Use untrack to prevent creating a subscription to MARKETS inside effects
  const market = untrack(() => MARKETS()).find(
    (item) => item.symbol === symbol,
  );
  const volume = market?.volume24h ?? 75e6;
  const notional = volume * LIQUIDITY_FRACTION;
  return Math.min(
    MAX_LIQUIDITY_NOTIONAL,
    Math.max(MIN_LIQUIDITY_NOTIONAL, notional),
  );
};

const recalcTotals = (levels: OrderBookLevel[]) => {
  let running = 0;
  return levels.map((level) => {
    running += level.size;
    return {
      ...level,
      total: running,
    };
  });
};

const normalizeSide = (levels: OrderBookLevel[], side: "bids" | "asks") => {
  const sorted = [...levels].sort((a, b) => {
    if (side === "bids") return b.price - a.price;
    return a.price - b.price;
  });
  return recalcTotals(sorted);
};

const seedOrderBook = (symbol: string, midPrice: number): OrderBook => {
  const priceBase = Math.max(midPrice, 1);
  const tick = getTickSize(priceBase);
  const seed = symbol
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const baseNotional = getLiquidityNotional(symbol);
  const baseSize = baseNotional / priceBase / LEVEL_COUNT;
  const asks: OrderBookLevel[] = [];
  const bids: OrderBookLevel[] = [];
  for (let i = 1; i <= LEVEL_COUNT; i += 1) {
    const askSize = baseSize * levelMultiplier(seed, i);
    const bidSize = baseSize * levelMultiplier(seed + 17, i);
    asks.push({
      price: roundToTick(priceBase + i * tick, tick),
      size: Number(askSize.toFixed(4)),
      total: 0,
    });
    bids.push({
      price: roundToTick(priceBase - i * tick, tick),
      size: Number(bidSize.toFixed(4)),
      total: 0,
    });
  }
  return {
    asks: recalcTotals(asks),
    bids: recalcTotals(bids),
  };
};

const ensureOrderBook = (symbol: string) => {
  if (orderBooks[symbol]) return;
  const mid = getMarkPriceForSymbol(symbol) || 100;
  setOrderBooks(symbol, seedOrderBook(symbol, mid));
};

const applyOpenOrdersToBook = (book: OrderBook, symbol: string) => {
  const open = openOrders().filter(
    (order) => order.symbol === symbol && order.status === "open",
  );
  if (open.length === 0) return book;
  let nextBook: OrderBook = {
    asks: book.asks,
    bids: book.bids,
  };
  for (const order of open) {
    if (order.price == null) continue;
    const sideBook = order.side === "buy" ? "bids" : "asks";
    const levels = addLiquidity(
      nextBook[sideBook],
      order.price,
      order.size,
      sideBook,
    );
    nextBook = {
      ...nextBook,
      [sideBook]: levels,
    };
  }
  return nextBook;
};

const addLiquidity = (
  levels: OrderBookLevel[],
  price: number,
  size: number,
  side: "bids" | "asks",
) => {
  let matched = false;
  const nextLevels = levels.map((level) => {
    if (level.price === price) {
      matched = true;
      return {
        ...level,
        size: level.size + size,
      };
    }
    return level;
  });

  if (!matched) {
    nextLevels.push({ price, size, total: 0 });
  }

  return normalizeSide(nextLevels, side);
};

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
    const symbol = currentSymbol();
    const mark = getMarkPriceForSymbol(symbol);
    openOrders();
    if (!Number.isFinite(mark) || mark <= 0) return;
    const { hasBook, bestBid, bestAsk } = untrack(() => {
      const book = orderBooks[symbol];
      return {
        hasBook: Boolean(book),
        bestBid: book?.bids[0]?.price ?? 0,
        bestAsk: book?.asks[0]?.price ?? 0,
      };
    });
    if (!hasBook) {
      setOrderBooks(symbol, seedOrderBook(symbol, mark));
      return;
    }
    const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0;
    if (!mid) return;
    const drift = Math.abs(mark - mid) / mid;
    if (drift < BOOK_REFRESH_THRESHOLD) return;
    const refreshed = seedOrderBook(symbol, mark);
    setOrderBooks(symbol, applyOpenOrdersToBook(refreshed, symbol));
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

  // Update funding for positions at funding payment times (7pm, 3am, 11am UK time)
  let fundingUpdateTimer: number | undefined;
  let fundingUpdateTimeout: number | undefined;

  /**
   * Calculate the next funding payment time in UK timezone
   * Funding payments occur at 7pm (19:00), 3am (03:00), and 11am (11:00) UK time (every 8 hours)
   */
  const getNextFundingPaymentTime = (): number => {
    const now = new Date();
    
    // Get current time in UK (Europe/London timezone)
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    
    const parts = formatter.formatToParts(now);
    const getPart = (type: string) => {
      const part = parts.find(p => p.type === type);
      return part ? parseInt(part.value, 10) : 0;
    };
    
    const ukYear = getPart("year");
    const ukMonth = getPart("month") - 1; // JavaScript months are 0-indexed
    const ukDay = getPart("day");
    const ukHour = getPart("hour");
    const ukMinute = getPart("minute");
    const ukSecond = getPart("second");
    
    // Funding payment times: 7pm (19:00), 3am (03:00), 11am (11:00)
    const fundingHours = [19, 3, 11]; // 7pm, 3am, 11am
    
    // Find the next funding hour
    let nextHour = fundingHours.find(h => h > ukHour);
    let daysToAdd = 0;
    
    if (nextHour === undefined) {
      // Current hour is after 7pm, next payment is 3am tomorrow
      nextHour = fundingHours[0]; // 3am
      daysToAdd = 1;
    }

    // Calculate milliseconds until next funding payment in UK time
    const currentUKTimeMs = (ukHour * 60 + ukMinute) * 60 * 1000 + ukSecond * 1000;
    const nextUKTimeMs = nextHour * 60 * 60 * 1000;
    let msUntilNext = nextUKTimeMs - currentUKTimeMs;
    
    if (msUntilNext <= 0) {
      // Next payment is tomorrow
      msUntilNext += 24 * 60 * 60 * 1000;
    }
    
    // Now we need to convert this UK time difference to local time
    // The trick: create two dates in UK timezone and see the difference in local time
    const ukNowStr = `${ukYear}-${String(ukMonth + 1).padStart(2, "0")}-${String(ukDay).padStart(2, "0")}T${String(ukHour).padStart(2, "0")}:${String(ukMinute).padStart(2, "0")}:${String(ukSecond).padStart(2, "0")}`;
    
    // Create a date that represents "now" in UK timezone by parsing it
    // We'll use the fact that we can create a date and then check what it is in UK vs local
    const testDate1 = new Date(now.getTime());
    const testDate2 = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour later
    
    const uk1 = testDate1.toLocaleString("en-GB", { timeZone: "Europe/London" });
    const uk2 = testDate2.toLocaleString("en-GB", { timeZone: "Europe/London" });
    const local1 = testDate1.toLocaleString("en-GB");
    const local2 = testDate2.toLocaleString("en-GB");
    
    const ukDiff = new Date(uk2).getTime() - new Date(uk1).getTime();
    const localDiff = new Date(local2).getTime() - new Date(local1).getTime();
    
    // The ratio tells us how to convert UK time differences to local time
    // For most cases, this will be 1:1, but during DST transitions it might differ slightly
    const timeRatio = localDiff / ukDiff;
    
    // Calculate the target time
    const targetLocalTime = now.getTime() + msUntilNext * timeRatio;
    
    return targetLocalTime;
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
        // After updating, schedule the next one (8 hours later)
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
  ensureOrderBook(symbol);
  return orderBooks[symbol];
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
