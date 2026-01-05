const FUTURES_API_URL = "https://fapi.binance.com/fapi/v1";

export const RESOLUTION_MAP: Record<string, string> = {
  "1": "1m",
  "3": "3m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "120": "2h",
  "240": "4h",
  "1D": "1d",
  "1W": "1w",
};

export const SUPPORTED_RESOLUTIONS = Object.keys(RESOLUTION_MAP);

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
}

export interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

export interface OpenInterest {
  symbol: string;
  openInterest: string;
}

export const resolutionToMs = (resolution: string): number => {
  if (resolution.endsWith("D")) {
    return parseInt(resolution, 10) * 24 * 60 * 60 * 1000;
  }
  if (resolution.endsWith("W")) {
    return parseInt(resolution, 10) * 7 * 24 * 60 * 60 * 1000;
  }
  return parseInt(resolution, 10) * 60 * 1000;
};

export const toInterval = (resolution: string): string =>
  RESOLUTION_MAP[resolution] || "5m";

export const normalizeSymbol = (symbolName: string): string => {
  if (!symbolName) return "BTC";
  const upper = symbolName.toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9]/g, "");
  if (cleaned.endsWith("USDT")) return cleaned.slice(0, -4);
  if (cleaned.endsWith("USD")) return cleaned.slice(0, -3);
  return cleaned;
};

export const toBinanceSymbol = (
  symbolOrPair: string,
  quote: string = "USDT",
): string => {
  if (!symbolOrPair) return `BTC${quote}`;
  const upper = symbolOrPair.toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9]/g, "");
  if (cleaned.endsWith(quote)) return cleaned;
  return `${cleaned}${quote}`;
};

export const fetchCandles = async ({
  coin,
  resolution,
  fromMs,
  toMs,
}: {
  coin: string;
  resolution: string;
  fromMs: number;
  toMs: number;
}): Promise<Candle[]> => {
  const symbol = toBinanceSymbol(coin);
  const interval = toInterval(resolution);
  const limit = Math.min(
    Math.ceil((toMs - fromMs) / resolutionToMs(resolution)) + 1,
    1000,
  );

  const params = new URLSearchParams({
    symbol,
    interval,
    startTime: String(fromMs),
    endTime: String(toMs),
    limit: String(limit),
  });

  const response = await fetch(
    `${FUTURES_API_URL}/klines?${params.toString()}`,
  );

  if (!response.ok) {
    throw new Error(`Binance klines failed: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) return [];

  return data
    .map((candle: any) => {
      if (!Array.isArray(candle) || candle.length < 6) return null;

      return {
        time: Number(candle[0]),
        open: Number(candle[1]),
        high: Number(candle[2]),
        low: Number(candle[3]),
        close: Number(candle[4]),
        volume: Number(candle[5]),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a!.time - b!.time) as Candle[];
};

export const fetchPremiumIndex = async (
  coin: string,
  signal?: AbortSignal,
): Promise<PremiumIndex | null> => {
  const symbol = toBinanceSymbol(coin);
  const response = await fetch(
    `${FUTURES_API_URL}/premiumIndex?symbol=${symbol}`,
    { signal },
  );

  if (!response.ok) return null;
  return response.json();
};

export const fetchTicker24h = async (
  coin: string,
  signal?: AbortSignal,
): Promise<Ticker24h | null> => {
  const symbol = toBinanceSymbol(coin);
  const response = await fetch(
    `${FUTURES_API_URL}/ticker/24hr?symbol=${symbol}`,
    { signal },
  );

  if (!response.ok) return null;
  return response.json();
};

export const fetchOpenInterest = async (
  coin: string,
  signal?: AbortSignal,
): Promise<OpenInterest | null> => {
  const symbol = toBinanceSymbol(coin);
  const response = await fetch(
    `${FUTURES_API_URL}/openInterest?symbol=${symbol}`,
    { signal },
  );

  if (!response.ok) return null;
  return response.json();
};

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export interface L2Book {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
}

export const fetchL2Book = async (
  coin: string,
  signal?: AbortSignal,
): Promise<L2Book | null> => {
  try {
    const symbol = toBinanceSymbol(coin);
    const response = await fetch(
      `${FUTURES_API_URL}/depth?symbol=${symbol}&limit=20`,
      { signal },
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (!data || (!data.asks && !data.bids)) return null;

    const rawAsks = data.asks || [];
    const rawBids = data.bids || [];

    let askTotal = 0;
    const asks: OrderBookLevel[] = rawAsks
      .slice(0, 20)
      .map((level: [string, string]) => {
        const size = parseFloat(level[1]);
        askTotal += size;
        return {
          price: parseFloat(level[0]),
          size,
          total: askTotal,
        };
      })
      .reverse();

    let bidTotal = 0;
    const bids: OrderBookLevel[] = rawBids
      .slice(0, 20)
      .map((level: [string, string]) => {
        const size = parseFloat(level[1]);
        bidTotal += size;
        return {
          price: parseFloat(level[0]),
          size,
          total: bidTotal,
        };
      });

    return { asks, bids };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    console.error("Failed to fetch L2 book:", error);
    return null;
  }
};

export const formatPrice = (value: any): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const abs = Math.abs(num);
  if (abs >= 1000) return num.toFixed(2);
  if (abs >= 100) return num.toFixed(2);
  if (abs >= 1) return num.toFixed(3);
  return num.toFixed(6);
};

export const formatVolume = (value: number): string => {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}b`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}m`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}k`;
  return `$${value.toFixed(2)}`;
};

export const formatPercent = (value: number): string => {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
};
