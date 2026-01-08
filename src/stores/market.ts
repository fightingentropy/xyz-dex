import { createSignal, createEffect, onCleanup } from "solid-js";
import {
  fetchMetaAndAssetCtxs,
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
    }))
  );
};

// Fetch and update all markets from Hyperliquid
export const fetchAllMarkets = async (signal?: AbortSignal): Promise<void> => {
  try {
    const metaAndCtxs = await fetchMetaAndAssetCtxs(signal);
    if (!metaAndCtxs || signal?.aborted) return;

    const newMarkets: Market[] = [];

    metaAndCtxs.universe.forEach((asset, index) => {
      const ctx = metaAndCtxs.ctx[index];
      if (!ctx) return;

      const markPrice = Number(ctx.markPx || ctx.midPx || 0);
      const prevDayPrice = Number(ctx.prevDayPx || 0);
      const change24h =
        prevDayPrice > 0
          ? ((markPrice - prevDayPrice) / prevDayPrice) * 100
          : 0;
      const volume24h = Number(ctx.dayNtlVlm || 0);
      const openInterest = Number(ctx.openInterest || 0) * markPrice;
      const funding = Number(ctx.funding || 0) * 100;

      // Format price for display
      let priceStr: string;
      if (markPrice >= 1000) {
        priceStr = markPrice.toLocaleString("en-US", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        });
      } else if (markPrice >= 1) {
        priceStr = markPrice.toFixed(2);
      } else {
        priceStr = markPrice.toFixed(5);
      }

      newMarkets.push({
        symbol: asset.name,
        name: `${asset.name}-USDC`,
        price: priceStr,
        change24h,
        volume24h,
        openInterest,
        funding,
        type: "perps",
        leverage: `${asset.maxLeverage}x`,
        watchlist: watchlistSet.has(asset.name),
      });
    });

    // Sort by volume by default
    newMarkets.sort((a, b) => b.volume24h - a.volume24h);

    setMarkets(newMarkets);
    setMarketsLoading(false);
  } catch (e) {
    if (signal?.aborted) return;
    console.error("Failed to fetch markets:", e);
    setMarketsLoading(false);
  }
};

// Initialize markets fetch
let marketsFetchController: AbortController | undefined;
let marketsFetchTimer: number | undefined;

export const startMarketsFetch = () => {
  // Initial fetch
  marketsFetchController?.abort();
  marketsFetchController = new AbortController();
  fetchAllMarkets(marketsFetchController.signal);

  // Refresh every 5 seconds
  marketsFetchTimer = setInterval(() => {
    marketsFetchController?.abort();
    marketsFetchController = new AbortController();
    fetchAllMarkets(marketsFetchController.signal);
  }, 5000) as unknown as number;
};

export const stopMarketsFetch = () => {
  if (marketsFetchTimer) clearInterval(marketsFetchTimer);
  marketsFetchController?.abort();
};

// Auto-start on import
startMarketsFetch();

// Ticker data derived from markets
export const TICKER_DATA = () => {
  const m = markets();
  return m.slice(0, 10).map((market) => ({
    symbol: market.symbol,
    change: market.change24h,
  }));
};

// Settings persistence
const SETTINGS_KEY = "trade-xyz-settings";
const LAST_SYMBOL_KEY = "trade-xyz-last-symbol";
const DEFAULT_SYMBOL = "HYPE";

interface Settings {
  showOrderBook: boolean;
}

const loadSettings = (): Settings => {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    // Ignore parse errors
  }
  return { showOrderBook: true };
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

// Wrapper to persist showOrderBook changes
const setShowOrderBook = (value: boolean | ((prev: boolean) => boolean)) => {
  const newValue = typeof value === "function" ? value(showOrderBook()) : value;
  setShowOrderBookInternal(newValue);
  saveSettings({ showOrderBook: newValue });
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

// Live price polling using Hyperliquid API
export const useLivePrices = (options?: { enabled?: () => boolean }) => {
  let timer: number | undefined;
  let controller: AbortController | undefined;
  let requestId = 0;
  const isEnabled = options?.enabled ?? (() => true);

  const updatePrices = async (coin: string) => {
    const currentRequestId = ++requestId;
    controller?.abort();
    const nextController = new AbortController();
    controller = nextController;

    try {
      // Fetch all market data from Hyperliquid in a single request
      const metaAndCtxs = await fetchMetaAndAssetCtxs(nextController.signal);

      if (
        currentRequestId !== requestId ||
        nextController.signal.aborted ||
        !isEnabled() ||
        currentSymbol() !== coin
      ) {
        return;
      }

      if (!metaAndCtxs) return;

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
        const oiVal = Number.isFinite(markNumber)
          ? oiBase * markNumber
          : oiBase;
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
    } catch (e) {
      if (nextController.signal.aborted) return;
      console.error("Error updating prices:", e);
    }
  };

  // React to symbol changes
  createEffect(() => {
    const coin = currentSymbol();
    const enabled = isEnabled();

    // Clear previous timer
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    controller?.abort();

    if (!enabled) return;

    // Immediate update for new symbol
    updatePrices(coin);

    // Start polling for this symbol
    timer = setInterval(() => updatePrices(coin), 2000) as unknown as number;
  });

  onCleanup(() => {
    if (timer) clearInterval(timer);
    controller?.abort();
  });
};
