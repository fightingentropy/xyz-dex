const INFO_URL = "https://api.hyperliquid.xyz/info";

export interface AssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
}

export interface AssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium?: string;
  oraclePx: string;
  markPx: string;
  midPx?: string;
  impactPxs?: string[];
}

export interface MetaAndAssetCtxs {
  universe: AssetMeta[];
  ctx: AssetCtx[];
}

export interface AllMids {
  [coin: string]: string;
}

export interface L2BookLevel {
  px: string;
  sz: string;
  n: number;
}

export interface L2BookResponse {
  coin: string;
  levels: [L2BookLevel[], L2BookLevel[]]; // [bids, asks]
  time: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export interface L2Book {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
}

/**
 * Normalize a symbol to Hyperliquid format (uppercase, no suffix)
 */
export const normalizeSymbol = (symbolName: string): string => {
  if (!symbolName) return "BTC";
  const upper = symbolName.toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9]/g, "");
  if (cleaned.endsWith("USDT")) return cleaned.slice(0, -4);
  if (cleaned.endsWith("USD")) return cleaned.slice(0, -3);
  if (cleaned.endsWith("PERP")) return cleaned.slice(0, -4);
  return cleaned;
};

/**
 * Fetch all mid prices from Hyperliquid
 */
export const fetchAllMids = async (
  signal?: AbortSignal
): Promise<AllMids | null> => {
  try {
    const response = await fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
      signal,
    });

    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    console.error("Failed to fetch allMids:", error);
    return null;
  }
};

/**
 * Fetch metadata and asset contexts (funding, OI, volume, etc.)
 */
export const fetchMetaAndAssetCtxs = async (
  signal?: AbortSignal
): Promise<MetaAndAssetCtxs | null> => {
  try {
    const response = await fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    
    // The response is an array [universe, assetCtxs]
    if (Array.isArray(data) && data.length >= 2) {
      return {
        universe: data[0].universe || data[0],
        ctx: data[1],
      };
    }
    return null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    console.error("Failed to fetch metaAndAssetCtxs:", error);
    return null;
  }
};

/**
 * Get asset context for a specific coin
 */
export const getAssetContext = (
  coin: string,
  metaAndCtxs: MetaAndAssetCtxs
): { meta: AssetMeta; ctx: AssetCtx } | null => {
  const normalizedCoin = normalizeSymbol(coin);
  const index = metaAndCtxs.universe.findIndex(
    (asset) => asset.name.toUpperCase() === normalizedCoin
  );
  
  if (index === -1) return null;
  
  return {
    meta: metaAndCtxs.universe[index],
    ctx: metaAndCtxs.ctx[index],
  };
};

/**
 * Fetch L2 order book from Hyperliquid
 */
export const fetchL2Book = async (
  coin: string,
  signal?: AbortSignal
): Promise<L2Book | null> => {
  try {
    const normalizedCoin = normalizeSymbol(coin);
    const response = await fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "l2Book",
        coin: normalizedCoin,
      }),
      signal,
    });

    if (!response.ok) return null;

    const data: L2BookResponse = await response.json();
    if (!data || !data.levels) return null;

    const [rawBids, rawAsks] = data.levels;

    let askTotal = 0;
    const asks: OrderBookLevel[] = (rawAsks || [])
      .slice(0, 20)
      .map((level) => {
        const size = parseFloat(level.sz);
        askTotal += size;
        return {
          price: parseFloat(level.px),
          size,
          total: askTotal,
        };
      })
      .reverse();

    let bidTotal = 0;
    const bids: OrderBookLevel[] = (rawBids || [])
      .slice(0, 20)
      .map((level) => {
        const size = parseFloat(level.sz);
        bidTotal += size;
        return {
          price: parseFloat(level.px),
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
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
};

export const formatPercent = (value: number): string => {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
};
