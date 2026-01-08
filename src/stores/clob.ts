import { createEffect, createMemo, createRoot } from "solid-js";
import { createStore } from "solid-js/store";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { convex, createConvexQuery } from "../lib/convex";
import { isAuthenticated } from "./auth";
import { currentSymbol, markPrice, MARKETS } from "./market";

export type Collateral = "USDC" | "USDT";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type MarginType = "isolated" | "cross";

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export type Order = Doc<"orders">;
export type Position = Doc<"positions">;

const { openOrders, positions, perpsBalances } = createRoot(() => {
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

const levelMultiplier = (seed: number, index: number) => {
  const wave = Math.sin(seed + index) * 10000;
  const variation = wave - Math.floor(wave);
  return 0.7 + variation * 0.6 + index * 0.02;
};

const getLiquidityNotional = (symbol: string) => {
  const market = MARKETS().find((item) => item.symbol === symbol);
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
  const fallback = MARKETS().find((market) => market.symbol === symbol)?.price;
  return parseNumber(fallback ?? 0);
};

createRoot(() => {
  createEffect(() => {
    const symbol = currentSymbol();
    const price = parseNumber(markPrice());
    if (Number.isFinite(price) && price > 0) {
      setLastPrices(symbol, price);
    }
  });

  createEffect(() => {
    const symbol = currentSymbol();
    const mark = getMarkPriceForSymbol(symbol);
    openOrders();
    if (!Number.isFinite(mark) || mark <= 0) return;
    const existing = orderBooks[symbol];
    if (!existing) {
      setOrderBooks(symbol, seedOrderBook(symbol, mark));
      return;
    }
    const bestBid = existing.bids[0]?.price ?? 0;
    const bestAsk = existing.asks[0]?.price ?? 0;
    const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0;
    if (!mid) return;
    const drift = Math.abs(mark - mid) / mid;
    if (drift < BOOK_REFRESH_THRESHOLD) return;
    const refreshed = seedOrderBook(symbol, mark);
    setOrderBooks(symbol, applyOpenOrdersToBook(refreshed, symbol));
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
      const notional = Math.abs(pos.size) * mark;
      return sum + notional / pos.leverage;
    }, 0);
  return Math.max(balance - marginUsed, 0);
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

export { openOrders, positions };
