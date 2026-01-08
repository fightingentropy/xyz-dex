import {
  normalizeSymbol as sharedNormalizeSymbol,
  formatPrice as sharedFormatPrice,
  formatVolume as sharedFormatVolume,
  formatPercent as sharedFormatPercent,
} from "./format";
import type { OrderBookLevel, L2Book } from "./format";

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

export interface SpotMeta {
  tokens: { name: string; szDecimals: number; index: number }[];
  universe: { name: string; tokens: [number, number]; index: number }[];
}

export interface SpotAssetCtx {
  dayNtlVlm: string;
  markPx: string;
  midPx: string;
  prevDayPx: string;
}

export interface SpotMetaAndAssetCtxs {
  meta: SpotMeta;
  ctx: SpotAssetCtx[];
}

// Re-export shared types
export type { OrderBookLevel, L2Book };

/**
 * Normalize a symbol to Hyperliquid format (uppercase, no suffix)
 */
export const normalizeSymbol = sharedNormalizeSymbol;

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
 * Fetch spot metadata and asset contexts
 */
export const fetchSpotMetaAndAssetCtxs = async (
  signal?: AbortSignal
): Promise<SpotMetaAndAssetCtxs | null> => {
  try {
    const response = await fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
      signal,
    });

    if (!response.ok) return null;
    const data = await response.json();

    // Response is [meta, assetCtxs]
    if (Array.isArray(data) && data.length >= 2) {
      return {
        meta: data[0],
        ctx: data[1],
      };
    }
    return null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    console.error("Failed to fetch spotMetaAndAssetCtxs:", error);
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

export const formatPrice = sharedFormatPrice;
export const formatVolume = sharedFormatVolume;
export const formatPercent = sharedFormatPercent;
