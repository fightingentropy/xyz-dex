import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { FRESHNESS_MS, normalizeAssetSymbol } from "./lib/prices";

// ============================================================================
// Server price poller.
//
// pollHyperliquidPrices fetches authoritative perps (and spot) marks + funding
// from Hyperliquid and upserts them into the marketPrices table. The oracle in
// convex/lib/prices.ts reads from that table. The client NEVER supplies prices
// used for settlement.
//
// IMPORTANT (cost): Hyperliquid exposes ~230 perps + ~100 spot pairs. Writing
// every one of them on every tick read+wrote hundreds of rows per poll and blew
// past the Convex free-tier Database I/O limit. marketPrices is only ever read
// on demand, one symbol at a time, at settlement (orders/vaults/spot) — nothing
// bulk-reads it and the client never reads it. So the poller writes ONLY the
// symbols that are actually held or have open orders (see getActiveSymbols), and
// ensureSymbolFresh covers the one-off case of trading a brand-new symbol.
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

// Rows not refreshed within this window are considered abandoned and pruned by
// pruneStalePrices. Generous relative to FRESHNESS_MS so a transient Hyperliquid
// outage never deletes rows the poller is still actively refreshing; any pruned
// symbol is recreated on demand (ensureSymbolFresh) or by the next poll once
// it's held/traded again.
const STALE_PRICE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Delete marketPrices rows that haven't been refreshed within STALE_PRICE_TTL_MS.
 * Once the poller is scoped to held/open symbols, rows for the rest of
 * Hyperliquid's universe stop updating; this keeps the table lean instead of
 * leaving hundreds of stale rows behind. The oracle already ignores stale rows,
 * so this is housekeeping, not correctness. The table is bounded by the number
 * of distinct symbols ever traded, so a full scan here is cheap.
 */
export const pruneStalePrices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_PRICE_TTL_MS;
    const rows = await ctx.db.query("marketPrices").collect();
    for (const row of rows) {
      if (row.updatedAt < cutoff) {
        await ctx.db.delete(row._id);
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

    // Scope writes to only the symbols that actually need a fresh server price:
    // anything currently held or with an open order. Hyperliquid's full universe
    // is hundreds of symbols; nobody reads the prices for the ones no one holds.
    // When nothing is held/open this writes nothing at all.
    const active = new Set(
      await ctx.runQuery(internal.prices.getActiveSymbols, {}),
    );
    if (active.size === 0) return;
    const scoped = rows.filter((r) =>
      active.has(normalizeAssetSymbol(r.symbol)),
    );
    if (scoped.length === 0) return;

    try {
      await ctx.runMutation(internal.prices.upsertMarketPrices, {
        rows: scoped,
      });
    } catch {
      // ignore upsert failure; next poll will retry
    }
  },
});

/**
 * Distinct base symbols that need a fresh server price right now: every symbol
 * with a non-zero position, an open order, or a non-stablecoin spot balance
 * (across both user- and vault-owned rows). The poller refreshes only these so
 * its Database I/O scales with real activity instead of Hyperliquid's full
 * ~330-symbol universe. Stablecoins are intentionally excluded — the oracle
 * values them at 1 via getDemoPrice without any marketPrices row.
 */
export const getActiveSymbols = internalQuery({
  args: {},
  handler: async (ctx) => {
    const symbols = new Set<string>();

    const positions = await ctx.db.query("positions").collect();
    for (const p of positions) {
      if (p.size === 0) continue;
      const s = normalizeAssetSymbol(p.symbol);
      if (s) symbols.add(s);
    }

    const openOrders = await ctx.db
      .query("orders")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
    for (const o of openOrders) {
      const s = normalizeAssetSymbol(o.symbol);
      if (s) symbols.add(s);
    }

    const spotBalances = await ctx.db.query("spotBalances").collect();
    for (const b of spotBalances) {
      if (!(b.balance > 0)) continue;
      const s = normalizeAssetSymbol(b.asset);
      if (!s || s === "USDC" || s === "USDT" || s === "DAI" || s === "USD") {
        continue;
      }
      symbols.add(s);
    }

    return Array.from(symbols);
  },
});

/**
 * Lightweight freshness probe used by ensureSymbolFresh (actions can't read the
 * db directly). Returns just the row's updatedAt, or null if there's no row.
 */
export const peekPriceUpdatedAt = internalQuery({
  args: { symbol: v.string() },
  handler: async (ctx, { symbol }) => {
    const s = normalizeAssetSymbol(symbol);
    if (!s) return null;
    const row = await ctx.db
      .query("marketPrices")
      .withIndex("by_symbol", (q) => q.eq("symbol", s))
      .first();
    return row ? row.updatedAt : null;
  },
});

/**
 * On-demand price warm-up for a single symbol.
 *
 * The cron only refreshes symbols that are already held/open, so the first time
 * a user trades a brand-new symbol there may be no fresh marketPrices row yet.
 * The client calls this right before placing an order so settlement has an
 * authoritative price. Cheap and self-throttling: it skips the Hyperliquid
 * fetch entirely when the row is already fresh, and only ever writes that one
 * row. Best-effort — any failure is swallowed and the order path falls back to
 * its normal oracle/demo behavior. Gated to authenticated callers so it can't
 * be used to amplify writes/fetches anonymously.
 */
export const ensureSymbolFresh = action({
  args: { symbol: v.string() },
  handler: async (ctx, { symbol }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;

    const target = normalizeAssetSymbol(symbol);
    if (!target) return;

    const now = Date.now();
    const updatedAt = await ctx.runQuery(internal.prices.peekPriceUpdatedAt, {
      symbol: target,
    });
    // Already comfortably fresh — no fetch, no write.
    if (updatedAt !== null && now - updatedAt < FRESHNESS_MS / 2) return;

    let row: PriceRow | undefined;
    try {
      const perps = await fetchPerpsRows(now);
      row = perps.find((r) => normalizeAssetSymbol(r.symbol) === target);
      if (!row) {
        const spot = await fetchSpotRows(now);
        row = spot.find((r) => normalizeAssetSymbol(r.symbol) === target);
      }
    } catch {
      return;
    }
    if (!row) return;

    try {
      await ctx.runMutation(internal.prices.upsertMarketPrices, {
        rows: [row],
      });
    } catch {
      // ignore; the order path falls back to demo/oracle behavior
    }
  },
});
