import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// ============================================================================
// Server-side price oracle.
//
// All settlement / fill / PnL / notional / funding / collateral-valuation math
// in the BACKEND must derive prices from here, NEVER from client-supplied args.
// ============================================================================

// A marketPrices row is considered usable if it was updated within this window.
export const FRESHNESS_MS = 30000;

type AnyCtx = QueryCtx | MutationCtx;

// Mirror the codebase's normalizeAssetSymbol (see convex/lib/portfolio.ts and
// convex/orders.ts) so oracle lookups key on the same base symbol.
export const normalizeAssetSymbol = (symbol: string): string => {
  const trimmed = String(symbol ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("xyz:")) {
    return trimmed.slice(trimmed.indexOf(":") + 1).toUpperCase();
  }
  return trimmed.toUpperCase();
};

// Seeded static fallback prices for common symbols. Used when no fresh
// marketPrices row exists (e.g. before the poller has run, or offline dev).
// Stablecoins default to 1. Unknown symbols return undefined so the caller
// can decide whether to throw.
const DEMO_PRICES: Record<string, number> = {
  USDC: 1,
  USDT: 1,
  DAI: 1,
  USD: 1,
  BTC: 68000,
  ETH: 3000,
  SOL: 150,
  HYPE: 25,
  BNB: 600,
  XRP: 0.55,
  ADA: 0.45,
  DOGE: 0.15,
  AVAX: 21,
  LINK: 17,
  DOT: 6.5,
  LTC: 90,
  ATOM: 9.5,
  ARB: 0.7,
  OP: 1.5,
  MATIC: 0.5,
  APT: 7,
  SUI: 1.2,
  TIA: 5,
  SEI: 0.4,
  INJ: 20,
  NEAR: 4,
  TRX: 0.12,
  BCH: 350,
};

/**
 * Static fallback price for a symbol. Returns a finite positive number for
 * known symbols (stablecoins => 1) and undefined for unknown symbols so the
 * caller can decide how to handle the miss.
 */
export function getDemoPrice(symbol: string): number | undefined {
  const asset = normalizeAssetSymbol(symbol);
  if (!asset) return undefined;
  return DEMO_PRICES[asset];
}

const isFinitePositive = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Authoritative server mark price for settlement math.
 *
 * Reads the marketPrices row by symbol; if fresh (within FRESHNESS_MS) returns
 * its markPx, otherwise falls back to getDemoPrice. Throws ConvexError when
 * neither yields a finite positive number.
 */
export async function getServerMarkPrice(
  ctx: AnyCtx,
  symbol: string,
): Promise<number> {
  const asset = normalizeAssetSymbol(symbol);
  if (asset) {
    const row = await ctx.db
      .query("marketPrices")
      .withIndex("by_symbol", (q) => q.eq("symbol", asset))
      .first();
    if (
      row &&
      Date.now() - row.updatedAt <= FRESHNESS_MS &&
      isFinitePositive(row.markPx)
    ) {
      return row.markPx;
    }
  }

  const demo = getDemoPrice(symbol);
  if (isFinitePositive(demo)) return demo;

  throw new ConvexError("Price unavailable for " + symbol);
}

/**
 * Server funding rate for a symbol. Returns the fresh marketPrices.funding when
 * available, otherwise 0. Funding must NEVER come from a client arg.
 */
export async function getServerFundingRate(
  ctx: AnyCtx,
  symbol: string,
): Promise<number> {
  const asset = normalizeAssetSymbol(symbol);
  if (!asset) return 0;
  const row = await ctx.db
    .query("marketPrices")
    .withIndex("by_symbol", (q) => q.eq("symbol", asset))
    .first();
  if (
    row &&
    Date.now() - row.updatedAt <= FRESHNESS_MS &&
    typeof row.funding === "number" &&
    Number.isFinite(row.funding)
  ) {
    return row.funding;
  }
  return 0;
}
