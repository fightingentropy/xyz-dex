import { normalizeSymbol as sharedNormalizeSymbol } from "./format";
import type { Candle } from "./candles";

const LIGHTER_API_BASE = "https://mainnet.zklighter.elliot.ai";
const ORDERBOOKS_URL = `${LIGHTER_API_BASE}/api/v1/orderBooks`;
const ORDERBOOK_DETAILS_URL = `${LIGHTER_API_BASE}/api/v1/orderBookDetails`;
const FUNDING_RATES_URL = `${LIGHTER_API_BASE}/api/v1/funding-rates`;

const ORDERBOOK_CACHE_TTL_MS = 60 * 1000;

interface LighterOrderBook {
  symbol: string;
  market_id: number;
  market_type: "perp" | "spot";
  status: "active" | "inactive";
}

interface LighterOrderBooksResponse {
  code: number;
  order_books?: LighterOrderBook[];
}

export interface LighterOrderBookDetail {
  symbol: string;
  market_id: number;
  market_type: "perp" | "spot";
  status: "active" | "inactive";
  last_trade_price?: number;
  daily_quote_token_volume?: number;
  daily_price_change?: number;
  open_interest?: number;
  default_initial_margin_fraction?: number;
}

interface LighterOrderBookDetailsResponse {
  code: number;
  order_book_details?: LighterOrderBookDetail[] | null;
  spot_order_book_details?: LighterOrderBookDetail[] | null;
}

export interface LighterFundingRate {
  market_id: number;
  exchange: string;
  symbol: string;
  rate: number;
}

interface LighterFundingRatesResponse {
  code: number;
  funding_rates?: LighterFundingRate[];
}

interface LighterCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  V?: number;
  i?: number;
}

const LIGHTER_INTERVAL_MAP: Record<string, string> = {
  "1": "1m",
  "3": "5m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "120": "1h",
  "240": "4h",
  "1D": "1d",
  "1W": "1w",
};

const toLighterInterval = (resolution: string): string =>
  LIGHTER_INTERVAL_MAP[resolution] ?? "5m";

export const normalizeLighterSymbol = (symbol: string): string => {
  const normalized = sharedNormalizeSymbol(symbol);
  if (normalized.length > 4 && normalized.endsWith("USDC")) {
    return normalized.slice(0, -4);
  }
  return normalized;
};

export type LighterMarketType = "perps" | "spot";

const orderBookCache = {
  fetchedAt: 0,
  perps: new Map<string, number>(),
  spots: new Map<string, number>(),
  inflight: null as Promise<void> | null,
};

const updateOrderBookCache = (books: LighterOrderBook[]) => {
  const nextPerps = new Map<string, number>();
  const nextSpots = new Map<string, number>();

  books.forEach((book) => {
    if (book.status !== "active") return;
    const normalized = normalizeLighterSymbol(book.symbol);
    if (!normalized) return;

    if (book.market_type === "perp") {
      nextPerps.set(normalized, book.market_id);
      return;
    }

    if (!nextSpots.has(normalized)) {
      nextSpots.set(normalized, book.market_id);
    }
  });

  orderBookCache.perps = nextPerps;
  orderBookCache.spots = nextSpots;
  orderBookCache.fetchedAt = Date.now();
};

const fetchOrderBooks = async (): Promise<void> => {
  const response = await fetch(ORDERBOOKS_URL);
  if (!response.ok) {
    throw new Error(`Lighter orderBooks failed: ${response.status}`);
  }
  const data = (await response.json()) as LighterOrderBooksResponse;
  if (!data || data.code !== 200 || !Array.isArray(data.order_books)) {
    throw new Error("Lighter orderBooks response invalid");
  }
  updateOrderBookCache(data.order_books);
};

const ensureOrderBooks = async (): Promise<void> => {
  const now = Date.now();
  if (
    orderBookCache.perps.size > 0 &&
    now - orderBookCache.fetchedAt < ORDERBOOK_CACHE_TTL_MS
  ) {
    return;
  }

  if (orderBookCache.inflight) {
    await orderBookCache.inflight;
    return;
  }

  orderBookCache.inflight = (async () => {
    try {
      await fetchOrderBooks();
    } catch (error) {
      console.error("Failed to fetch Lighter order books:", error);
    } finally {
      orderBookCache.inflight = null;
    }
  })();

  await orderBookCache.inflight;
};

export const getLighterMarketId = async (
  symbol: string,
  marketType?: LighterMarketType,
): Promise<number | null> => {
  const normalized = normalizeLighterSymbol(symbol);
  if (!normalized) return null;

  await ensureOrderBooks();

  if (marketType === "spot") {
    return orderBookCache.spots.get(normalized) ?? null;
  }
  if (marketType === "perps") {
    return orderBookCache.perps.get(normalized) ?? null;
  }

  return (
    orderBookCache.perps.get(normalized) ??
    orderBookCache.spots.get(normalized) ??
    null
  );
};

export const fetchLighterCandles = async ({
  coin,
  resolution,
  fromMs,
  toMs,
  marketType,
  signal,
}: {
  coin: string;
  resolution: string;
  fromMs: number;
  toMs: number;
  marketType?: LighterMarketType;
  signal?: AbortSignal;
}): Promise<Candle[]> => {
  try {
    const marketId = await getLighterMarketId(coin, marketType);
    if (marketId == null) return [];

    const interval = toLighterInterval(resolution);
    const params = new URLSearchParams({
      market_id: String(marketId),
      resolution: interval,
      start_timestamp: String(fromMs),
      end_timestamp: String(toMs),
      count_back: "0",
      set_timestamp_to_end: "false",
    });

    const response = await fetch(
      `${LIGHTER_API_BASE}/api/v1/candles?${params.toString()}`,
      { signal },
    );

    if (!response.ok) {
      throw new Error(`Lighter candles failed: ${response.status}`);
    }

    const data = await response.json();
    const candles = Array.isArray(data?.c) ? (data.c as LighterCandle[]) : [];

    return candles
      .map((candle) => ({
        time: Number(candle.t),
        open: Number(candle.o),
        high: Number(candle.h),
        low: Number(candle.l),
        close: Number(candle.c),
        volume: Number(candle.v ?? 0),
      }))
      .filter(
        (candle) =>
          Number.isFinite(candle.time) && Number.isFinite(candle.open),
      )
      .sort((a, b) => a.time - b.time);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return [];
    }
    console.error("Failed to fetch lighter candles:", error);
    return [];
  }
};

export const fetchLighterOrderBookDetails = async ({
  marketId,
  signal,
}: {
  marketId: number;
  signal?: AbortSignal;
}): Promise<LighterOrderBookDetail | null> => {
  const params = new URLSearchParams({ market_id: String(marketId) });
  const response = await fetch(
    `${ORDERBOOK_DETAILS_URL}?${params.toString()}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(`Lighter orderBookDetails failed: ${response.status}`);
  }
  const data = (await response.json()) as LighterOrderBookDetailsResponse;
  if (!data || data.code !== 200) {
    throw new Error("Lighter orderBookDetails response invalid");
  }
  const perps = Array.isArray(data.order_book_details)
    ? data.order_book_details
    : [];
  if (perps.length > 0) return perps[0] ?? null;
  const spots = Array.isArray(data.spot_order_book_details)
    ? data.spot_order_book_details
    : [];
  return spots[0] ?? null;
};

export const fetchLighterFundingRates = async (
  signal?: AbortSignal,
): Promise<LighterFundingRate[]> => {
  const response = await fetch(FUNDING_RATES_URL, { signal });
  if (!response.ok) {
    throw new Error(`Lighter funding-rates failed: ${response.status}`);
  }
  const data = (await response.json()) as LighterFundingRatesResponse;
  if (!data || data.code !== 200 || !Array.isArray(data.funding_rates)) {
    throw new Error("Lighter funding-rates response invalid");
  }
  return data.funding_rates;
};
