import { normalizeSymbol as sharedNormalizeSymbol } from "./format";

const FUTURES_API_URL = "https://fapi.binance.com/fapi/v1";
const SPOT_API_URL = "https://api.binance.com/api/v3";

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

export interface BinanceTicker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

export interface BinancePremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
}

export interface BinanceOpenInterest {
  symbol: string;
  openInterest: string;
}

const fetchJson = async <T>(url: string, signal?: AbortSignal): Promise<T> => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Binance request failed: ${response.status}`);
  }
  return (await response.json()) as T;
};

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

export const normalizeSymbol = sharedNormalizeSymbol;

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

export const fetchSpotCandles = async ({
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

  const response = await fetch(`${SPOT_API_URL}/klines?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Binance spot klines failed: ${response.status}`);
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

export const fetchFuturesTicker = async ({
  symbol,
  signal,
}: {
  symbol: string;
  signal?: AbortSignal;
}): Promise<BinanceTicker24h> => {
  const params = new URLSearchParams({ symbol });
  return fetchJson<BinanceTicker24h>(
    `${FUTURES_API_URL}/ticker/24hr?${params.toString()}`,
    signal,
  );
};

export const fetchPremiumIndex = async ({
  symbol,
  signal,
}: {
  symbol: string;
  signal?: AbortSignal;
}): Promise<BinancePremiumIndex> => {
  const params = new URLSearchParams({ symbol });
  return fetchJson<BinancePremiumIndex>(
    `${FUTURES_API_URL}/premiumIndex?${params.toString()}`,
    signal,
  );
};

export const fetchOpenInterest = async ({
  symbol,
  signal,
}: {
  symbol: string;
  signal?: AbortSignal;
}): Promise<BinanceOpenInterest> => {
  const params = new URLSearchParams({ symbol });
  return fetchJson<BinanceOpenInterest>(
    `${FUTURES_API_URL}/openInterest?${params.toString()}`,
    signal,
  );
};

export const fetchSpotTicker = async ({
  symbol,
  signal,
}: {
  symbol: string;
  signal?: AbortSignal;
}): Promise<BinanceTicker24h> => {
  const params = new URLSearchParams({ symbol });
  return fetchJson<BinanceTicker24h>(
    `${SPOT_API_URL}/ticker/24hr?${params.toString()}`,
    signal,
  );
};
