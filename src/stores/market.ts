import { createSignal, createEffect, onCleanup } from "solid-js";
import {
  fetchMetaAndAssetCtxs,
  fetchSpotMetaAndAssetCtxs,
  getAssetContext,
  formatPrice,
  normalizeSymbol,
  type MetaAndAssetCtxs,
} from "../lib/hyperliquid";

export interface Market {
  symbol: string;
  name: string;
  price: string;
  change24h: number;
  volume24h: number;
  openInterest: number;
  funding: number;
  type: "perps" | "spot" | "equities";
  leverage: string;
  watchlist: boolean;
}

// Watchlist stored in localStorage
const WATCHLIST_KEY = "trade-xyz-watchlist";
const loadWatchlist = (): Set<string> => {
  try {
    const stored = localStorage.getItem(WATCHLIST_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch (e) {
    // Ignore
  }
  return new Set(["BTC", "HYPE"]);
};
const saveWatchlist = (watchlist: Set<string>) => {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...watchlist]));
  } catch (e) {
    // Ignore
  }
};

const watchlistSet = loadWatchlist();

// Reactive markets store
const [markets, setMarkets] = createSignal<Market[]>([]);
const [marketsLoading, setMarketsLoading] = createSignal(true);

// Export reactive accessor
export const MARKETS = markets;
export { marketsLoading };

// Toggle watchlist for a symbol
export const toggleWatchlist = (symbol: string) => {
  if (watchlistSet.has(symbol)) {
    watchlistSet.delete(symbol);
  } else {
    watchlistSet.add(symbol);
  }
  saveWatchlist(watchlistSet);
  // Update markets to reflect watchlist change
  setMarkets((prev) =>
    prev.map((m) => ({
      ...m,
      watchlist: watchlistSet.has(m.symbol),
    })),
  );
};

// Settings persistence
const SETTINGS_KEY = "trade-xyz-settings";
const LAST_SYMBOL_KEY = "trade-xyz-last-symbol";
const DEFAULT_SYMBOL = "HYPE";
export type DataProvider = "hyperliquid" | "binance";
const DEFAULT_DATA_PROVIDER: DataProvider = "hyperliquid";

interface Settings {
  showOrderBook: boolean;
  dataProvider: DataProvider;
}

const loadSettings = (): Settings => {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Settings>;
      const dataProvider =
        parsed.dataProvider === "binance" ||
        parsed.dataProvider === "hyperliquid"
          ? parsed.dataProvider
          : DEFAULT_DATA_PROVIDER;
      return {
        showOrderBook: parsed.showOrderBook ?? true,
        dataProvider,
      };
    }
  } catch (e) {
    // Ignore parse errors
  }
  return { showOrderBook: true, dataProvider: DEFAULT_DATA_PROVIDER };
};

const saveSettings = (settings: Settings) => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    // Ignore storage errors
  }
};

const initialSettings = loadSettings();
const loadLastSymbol = (): string => {
  try {
    const stored = localStorage.getItem(LAST_SYMBOL_KEY);
    if (stored) {
      const normalized = normalizeSymbol(stored);
      return normalized || DEFAULT_SYMBOL;
    }
  } catch (e) {
    // Ignore storage errors
  }
  return DEFAULT_SYMBOL;
};

const saveLastSymbol = (symbol: string) => {
  try {
    localStorage.setItem(LAST_SYMBOL_KEY, symbol);
  } catch (e) {
    // Ignore storage errors
  }
};

// Create reactive market store
const initialSymbol = loadLastSymbol();
const findMarket = (symbol: string, preferredType?: Market["type"]) => {
  const allMarkets = markets();
  if (preferredType) {
    const preferred = allMarkets.find(
      (market) => market.symbol === symbol && market.type === preferredType,
    );
    if (preferred) return preferred;
  }
  return (
    allMarkets.find(
      (market) => market.symbol === symbol && market.type === "perps",
    ) ?? allMarkets.find((market) => market.symbol === symbol)
  );
};
const initialMarket = findMarket(initialSymbol, "perps");
const [currentSymbol, setCurrentSymbolInternal] = createSignal(initialSymbol);
const [currentMarket, setCurrentMarket] = createSignal(
  initialMarket?.name ?? `${initialSymbol}-USDC`,
);
const [currentMarketType, setCurrentMarketTypeInternal] = createSignal<
  Market["type"]
>(initialMarket?.type ?? "perps");
const [currentMarketLeverage, setCurrentMarketLeverageInternal] = createSignal(
  initialMarket?.leverage ?? "10x",
);
const [markPrice, setMarkPrice] = createSignal("--");
const [oraclePrice, setOraclePrice] = createSignal("--");
const [change24h, setChange24h] = createSignal(0);
const [volume24h, setVolume24h] = createSignal("--");
const [openInterest, setOpenInterest] = createSignal("--");
const [fundingRate, setFundingRate] = createSignal("--");
const [searchOpen, setSearchOpen] = createSignal(false);
const [showOrderBook, setShowOrderBookInternal] = createSignal(
  initialSettings.showOrderBook,
);
const [dataProvider, setDataProviderInternal] = createSignal<DataProvider>(
  initialSettings.dataProvider,
);

// Wrapper to persist showOrderBook changes
const setShowOrderBook = (value: boolean | ((prev: boolean) => boolean)) => {
  const newValue = typeof value === "function" ? value(showOrderBook()) : value;
  setShowOrderBookInternal(newValue);
  saveSettings({ showOrderBook: newValue, dataProvider: dataProvider() });
};

const setDataProvider = (
  value: DataProvider | ((prev: DataProvider) => DataProvider),
) => {
  const newValue = typeof value === "function" ? value(dataProvider()) : value;
  setDataProviderInternal(newValue);
  saveSettings({ showOrderBook: showOrderBook(), dataProvider: newValue });
};

const setCurrentSymbol = (value: string | ((prev: string) => string)) => {
  const nextValue =
    typeof value === "function" ? value(currentSymbol()) : value;
  const normalized = nextValue.trim()
    ? normalizeSymbol(nextValue)
    : DEFAULT_SYMBOL;
  setCurrentSymbolInternal(normalized);
  saveLastSymbol(normalized);
  const matched = findMarket(normalized, "perps");
  if (matched) {
    setCurrentMarket(matched.name);
    setCurrentMarketTypeInternal(matched.type);
    setCurrentMarketLeverageInternal(matched.leverage);
  }
};

export {
  currentSymbol,
  setCurrentSymbol,
  currentMarket,
  setCurrentMarket,
  currentMarketType,
  currentMarketLeverage,
  markPrice,
  setMarkPrice,
  oraclePrice,
  setOraclePrice,
  change24h,
  setChange24h,
  volume24h,
  setVolume24h,
  openInterest,
  setOpenInterest,
  fundingRate,
  setFundingRate,
  searchOpen,
  setSearchOpen,
  showOrderBook,
  setShowOrderBook,
  dataProvider,
  setDataProvider,
};

export const selectMarket = (market: Market) => {
  setCurrentSymbol(market.symbol);
  setCurrentMarket(market.name);
  setCurrentMarketTypeInternal(market.type);
  setCurrentMarketLeverageInternal(market.leverage);
  setSearchOpen(false);

  // Update URL to reflect the new symbol
  window.history.pushState(
    { page: "trade", symbol: market.symbol },
    "",
    `/trade/${market.symbol}`,
  );

  // Update document title
  document.title = `${markPrice()} | ${market.symbol} | Trade XYZ`;
};

// Ticker data derived from markets
export const TICKER_DATA = () => {
  const m = markets();
  return m.slice(0, 10).map((market) => ({
    symbol: market.symbol,
    change: market.change24h,
  }));
};

/**
 * Update the current symbol's live price display from MetaAndAssetCtxs data
 */
const updateCurrentSymbolPrices = (
  coin: string,
  metaAndCtxs: MetaAndAssetCtxs,
) => {
  const assetData = getAssetContext(coin, metaAndCtxs);
  if (!assetData) return;

  const { ctx } = assetData;

  // Mark price
  const markSource = ctx.markPx ?? ctx.midPx;
  const markNumber = markSource ? Number(markSource) : NaN;
  if (markSource) {
    const formatted = formatPrice(markSource);
    setMarkPrice(formatted);
    document.title = `${formatted} | ${currentSymbol()} | Trade XYZ`;
  }

  // Oracle price
  const oracleSource = ctx.oraclePx ?? ctx.markPx;
  if (oracleSource) {
    setOraclePrice(formatPrice(oracleSource));
  }

  // 24h change calculated from prevDayPx
  if (ctx.prevDayPx && markNumber) {
    const prevDayPrice = Number(ctx.prevDayPx);
    if (Number.isFinite(prevDayPrice) && prevDayPrice > 0) {
      const change = ((markNumber - prevDayPrice) / prevDayPrice) * 100;
      if (Number.isFinite(change)) {
        setChange24h(change);
      }
    }
  }

  // 24h volume (dayNtlVlm is notional volume in USD)
  if (ctx.dayNtlVlm != null) {
    const vol = Number(ctx.dayNtlVlm);
    if (Number.isFinite(vol)) {
      if (vol >= 1e9) {
        setVolume24h(`$${(vol / 1e9).toFixed(2)}B`);
      } else if (vol >= 1e6) {
        setVolume24h(`$${(vol / 1e6).toFixed(2)}M`);
      } else if (vol >= 1e3) {
        setVolume24h(`$${(vol / 1e3).toFixed(2)}K`);
      } else {
        setVolume24h(`$${vol.toFixed(2)}`);
      }
    }
  }

  // Open interest (in base currency, convert to USD using mark price)
  if (ctx.openInterest != null) {
    const oiBase = Number(ctx.openInterest);
    const oiVal = Number.isFinite(markNumber) ? oiBase * markNumber : oiBase;
    if (Number.isFinite(oiVal)) {
      if (oiVal >= 1e9) {
        setOpenInterest(`$${(oiVal / 1e9).toFixed(2)}B`);
      } else if (oiVal >= 1e6) {
        setOpenInterest(`$${(oiVal / 1e6).toFixed(2)}M`);
      } else if (oiVal >= 1e3) {
        setOpenInterest(`$${(oiVal / 1e3).toFixed(2)}K`);
      } else {
        setOpenInterest(`$${oiVal.toFixed(2)}`);
      }
    }
  }

  // Funding rate (already in decimal form, multiply by 100 for percentage)
  if (ctx.funding != null) {
    const fundingVal = Number(ctx.funding) * 100;
    if (Number.isFinite(fundingVal)) {
      const sign = fundingVal >= 0 ? "+" : "";
      setFundingRate(`${sign}${fundingVal.toFixed(4)}%`);
    }
  }
};

/**
 * Fetch and update all markets AND the current symbol's prices from a single API call.
 * This consolidates what was previously two separate polling loops.
 */
const formatPriceStr = (price: number): string => {
  if (price >= 1000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } else if (price >= 1) {
    return price.toFixed(2);
  } else {
    return price.toFixed(5);
  }
};

const fetchAndUpdateAll = async (
  signal?: AbortSignal,
  updateLivePrices = true,
): Promise<void> => {
  try {
    // Fetch perps and spot data in parallel
    const [metaAndCtxs, spotData] = await Promise.all([
      fetchMetaAndAssetCtxs(signal),
      fetchSpotMetaAndAssetCtxs(signal),
    ]);

    if (signal?.aborted) return;

    const newMarkets: Market[] = [];

    // Add perps markets
    if (metaAndCtxs) {
      metaAndCtxs.universe.forEach((asset, index) => {
        const ctx = metaAndCtxs.ctx[index];
        if (!ctx) return;

        const markPriceVal = Number(ctx.markPx || ctx.midPx || 0);
        const prevDayPrice = Number(ctx.prevDayPx || 0);
        const change24hVal =
          prevDayPrice > 0
            ? ((markPriceVal - prevDayPrice) / prevDayPrice) * 100
            : 0;
        const volume24hVal = Number(ctx.dayNtlVlm || 0);
        const openInterestVal = Number(ctx.openInterest || 0) * markPriceVal;
        const fundingVal = Number(ctx.funding || 0) * 100;

        newMarkets.push({
          symbol: asset.name,
          name: `${asset.name}-USDC`,
          price: formatPriceStr(markPriceVal),
          change24h: change24hVal,
          volume24h: volume24hVal,
          openInterest: openInterestVal,
          funding: fundingVal,
          type: "perps",
          leverage: `${asset.maxLeverage}x`,
          watchlist: watchlistSet.has(asset.name),
        });
      });
    }

    // Add spot markets
    if (spotData) {
      const tokenMap = new Map<number, string>();
      spotData.meta.tokens.forEach((token) => {
        tokenMap.set(token.index, token.name);
      });

      spotData.meta.universe.forEach((pair) => {
        // Use pair.index to look up the correct context (not iteration index)
        const ctx = spotData.ctx[pair.index];
        if (!ctx) return;

        // Get base token name (first token in pair)
        const baseToken = tokenMap.get(pair.tokens[0]);
        const quoteToken = tokenMap.get(pair.tokens[1]);
        if (!baseToken || !quoteToken) return;

        // Skip non-USDC pairs for now
        if (quoteToken !== "USDC") return;

        const markPriceVal = Number(ctx.markPx || ctx.midPx || 0);
        const prevDayPrice = Number(ctx.prevDayPx || 0);
        const change24hVal =
          prevDayPrice > 0
            ? ((markPriceVal - prevDayPrice) / prevDayPrice) * 100
            : 0;
        const volume24hVal = Number(ctx.dayNtlVlm || 0);

        newMarkets.push({
          symbol: baseToken,
          name: `${baseToken}-USDC`,
          price: formatPriceStr(markPriceVal),
          change24h: change24hVal,
          volume24h: volume24hVal,
          openInterest: 0,
          funding: 0,
          type: "spot",
          leverage: "1x",
          watchlist: watchlistSet.has(baseToken),
        });
      });
    }

    // Sort by volume by default
    newMarkets.sort((a, b) => b.volume24h - a.volume24h);

    setMarkets(newMarkets);
    setMarketsLoading(false);

    // Also update the current symbol's live prices from the same data
    if (updateLivePrices && metaAndCtxs) {
      const coin = currentSymbol();
      updateCurrentSymbolPrices(coin, metaAndCtxs);
    }
  } catch (e) {
    if (signal?.aborted) return;
    console.error("Failed to fetch markets:", e);
    setMarketsLoading(false);
  }
};

// For backward compatibility - alias to the consolidated function
export const fetchAllMarkets = fetchAndUpdateAll;

/**
 * Unified live price polling hook.
 * Fetches market data once every 2 seconds and updates both:
 * - The full markets list
 * - The current symbol's live price display
 *
 * This consolidates what was previously two separate polling loops
 * (startMarketsFetch at 5s and useLivePrices at 2s) into one.
 */
export const useLivePrices = (options?: { enabled?: () => boolean }) => {
  let timer: number | undefined;
  let controller: AbortController | undefined;
  let requestId = 0;
  const isEnabled = options?.enabled ?? (() => true);

  const doFetch = async () => {
    const currentRequestId = ++requestId;
    controller?.abort();
    const nextController = new AbortController();
    controller = nextController;

    try {
      await fetchAndUpdateAll(nextController.signal, true);
    } catch (e) {
      if (nextController.signal.aborted) return;
      console.error("Error updating prices:", e);
    }
  };

  // React to symbol changes and enabled state
  createEffect(() => {
    const enabled = isEnabled();
    // Track currentSymbol to trigger re-fetch on symbol change
    currentSymbol();

    // Clear previous timer
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    controller?.abort();

    if (!enabled) return;

    // Immediate update
    doFetch();

    // Start polling - unified 2 second interval for both markets + live prices
    timer = setInterval(doFetch, 2000) as unknown as number;
  });

  onCleanup(() => {
    if (timer) clearInterval(timer);
    controller?.abort();
  });
};

// Initial fetch on module load (non-polling, just to populate markets initially)
// The useLivePrices hook will take over polling when the app mounts
fetchAndUpdateAll(undefined, false);
