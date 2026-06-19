import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { FRESHNESS_MS, normalizeAssetSymbol } from "./lib/prices";

// ============================================================================
// Server price poller.
//
// pollHyperliquidPrices fetches authoritative perps (and spot) marks + funding
// from Hyperliquid and upserts them into the marketPrices table. The oracle in
// convex/lib/prices.ts reads from that table. The client NEVER supplies prices
// used for settlement.
// ============================================================================

const priceRowValidator = v.object({
  symbol: v.string(),
  markPx: v.number(),
  midPx: v.optional(v.number()),
  funding: v.optional(v.number()),
  source: v.optional(v.string()),
  updatedAt: v.number(),
});

/**
 * Upsert price rows into marketPrices, keyed by normalized symbol.
 */
export const upsertMarketPrices = internalMutation({
  args: { rows: v.array(priceRowValidator) },
  handler: async (ctx, { rows }) => {
    for (const row of rows) {
      const symbol = normalizeAssetSymbol(row.symbol);
      if (!symbol) continue;
      if (!Number.isFinite(row.markPx) || row.markPx <= 0) continue;

      const existing = await ctx.db
        .query("marketPrices")
        .withIndex("by_symbol", (q) => q.eq("symbol", symbol))
        .first();

      // Skip redundant writes for prices that haven't moved, but only while the
      // row is still comfortably fresh (refreshed at least every FRESHNESS_MS/2).
      // This guarantees a stable price never drifts past the oracle's freshness
      // window (which would wrongly fall back to demo prices), while cutting the
      // write volume for unchanged symbols.
      if (
        existing &&
        existing.markPx === row.markPx &&
        existing.midPx === row.midPx &&
        existing.funding === row.funding &&
        row.updatedAt - existing.updatedAt < FRESHNESS_MS / 2
      ) {
        continue;
      }

      const patch = {
        symbol,
        markPx: row.markPx,
        midPx: row.midPx,
        funding: row.funding,
        source: row.source ?? "hyperliquid",
        updatedAt: row.updatedAt,
      };

      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        await ctx.db.insert("marketPrices", patch);
      }
    }
  },
});

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

const toFiniteNumber = (value: unknown): number | undefined => {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

type PriceRow = {
  symbol: string;
  markPx: number;
  midPx?: number;
  funding?: number;
  source?: string;
  updatedAt: number;
};

async function fetchPerpsRows(now: number): Promise<PriceRow[]> {
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || data.length < 2) return [];

  const meta = data[0] as { universe?: Array<{ name?: string }> };
  const assetCtxs = data[1] as Array<{
    markPx?: string | number;
    midPx?: string | number;
    funding?: string | number;
  }>;
  const universe = meta?.universe;
  if (!Array.isArray(universe) || !Array.isArray(assetCtxs)) return [];

  const rows: PriceRow[] = [];
  for (let i = 0; i < universe.length; i++) {
    const name = universe[i]?.name;
    const ctx = assetCtxs[i];
    if (!name || !ctx) continue;
    const markPx = toFiniteNumber(ctx.markPx);
    if (markPx === undefined || markPx <= 0) continue;
    rows.push({
      symbol: name,
      markPx,
      midPx: toFiniteNumber(ctx.midPx),
      funding: toFiniteNumber(ctx.funding),
      source: "hyperliquid",
      updatedAt: now,
    });
  }
  return rows;
}

async function fetchSpotRows(now: number): Promise<PriceRow[]> {
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || data.length < 2) return [];

  const meta = data[0] as {
    tokens?: Array<{ name?: string; index?: number }>;
    universe?: Array<{ name?: string; tokens?: number[] }>;
  };
  const assetCtxs = data[1] as Array<{
    markPx?: string | number;
    midPx?: string | number;
  }>;
  const universe = meta?.universe;
  const tokens = meta?.tokens;
  if (!Array.isArray(universe) || !Array.isArray(assetCtxs)) return [];

  const rows: PriceRow[] = [];
  for (let i = 0; i < universe.length; i++) {
    const pair = universe[i];
    const ctx = assetCtxs[i];
    if (!pair || !ctx) continue;
    const markPx = toFiniteNumber(ctx.markPx);
    if (markPx === undefined || markPx <= 0) continue;
    // Resolve the base token name for the pair (first token in the pair).
    let symbol: string | undefined = pair.name;
    if (Array.isArray(pair.tokens) && tokens) {
      const baseToken = tokens.find((t) => t?.index === pair.tokens?.[0]);
      if (baseToken?.name) symbol = baseToken.name;
    }
    if (!symbol) continue;
    rows.push({
      symbol,
      markPx,
      midPx: toFiniteNumber(ctx.midPx),
      source: "hyperliquid-spot",
      updatedAt: now,
    });
  }
  return rows;
}

/**
 * Poll Hyperliquid for perps + spot marks and funding, then upsert. Defensive:
 * any fetch/parse failure is swallowed so the cron never crashes the scheduler.
 */
export const pollHyperliquidPrices = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows: PriceRow[] = [];

    try {
      rows.push(...(await fetchPerpsRows(now)));
    } catch {
      // ignore perps fetch failure
    }

    // Perps marks take precedence for any symbol; only add spot rows for
    // symbols not already covered by perps.
    const seen = new Set(rows.map((r) => normalizeAssetSymbol(r.symbol)));
    try {
      const spotRows = await fetchSpotRows(now);
      for (const row of spotRows) {
        if (seen.has(normalizeAssetSymbol(row.symbol))) continue;
        rows.push(row);
      }
    } catch {
      // ignore spot fetch failure
    }

    if (rows.length === 0) return;

    try {
      await ctx.runMutation(internal.prices.upsertMarketPrices, { rows });
    } catch {
      // ignore upsert failure; next poll will retry
    }
  },
});
