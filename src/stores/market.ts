import {
  batch,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import { api } from "../../convex/_generated/api";
import { createConvexQuery } from "../lib/convex";
import { isAuthenticated } from "./auth";
import {
  fetchMetaAndAssetCtxs,
  fetchSpotMetaAndAssetCtxs,
  fetchHyperliquidCandles,
  getAssetContext,
  formatPrice,
  formatVolume,
  normalizeSymbol,
  type MetaAndAssetCtxs,
  type SpotMetaAndAssetCtxs,
} from "../lib/hyperliquid";
import {
  fetchLighterFundingRates,
  fetchLighterOrderBookDetails,
  getLighterMarketId,
  normalizeLighterSymbol,
} from "../lib/lighter";
import { resolutionToMs } from "../lib/candles";

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
const WATCHLISTS_KEY = "trade-xyz-watchlists";
const TICKER_WATCHLIST_KEY = "trade-xyz-ticker-watchlist";
const DEFAULT_WATCHLIST_NAME = "crypto";
const COMMODITY_SYMBOLS = new Set([
  "ALUMINIUM",
  "COPPER",
  "GOLD",
  "NATGAS",
  "SILVER",
  "URANIUM",
]);
const DEFAULT_TICKER_WATCHLIST = [
  "BTC",
  "ETH",
  "HYPE",
  "ALUMINIUM",
  "COPPER",
  "GOLD",
  "NATGAS",
  "SILVER",
  "URANIUM",
];
const DEFAULT_WATCHLISTS: Record<string, string[]> = {
  crypto: ["BTC", "ETH", "HYPE"],
  commodities: ["ALUMINIUM", "COPPER", "GOLD", "NATGAS", "SILVER", "URANIUM"],
  indices: ["xyz:XYZ100"],
  stocks: [
    "xyz:AAPL",
    "xyz:TSLA",
    "xyz:NVDA",
    "xyz:MSFT",
    "xyz:META",
    "xyz:GOOGL",
    "xyz:AMZN",
    "xyz:NFLX",
    "xyz:AMD",
    "xyz:PLTR",
    "xyz:HOOD",
    "xyz:MSTR",
    "xyz:MU",
    "xyz:SNDK",
  ],
};

interface WatchlistsState {
  activeId: string;
  lists: Record<string, string[]>;
}

const normalizeWatchlist = (symbols: string[]): string[] => {
  const deduped = new Set<string>();
  symbols.forEach((symbol) => {
    const trimmed = String(symbol ?? "").trim();
    if (!trimmed) return;
    deduped.add(trimmed);
  });
  return [...deduped];
};

const getWatchlistCoreSymbol = (symbol: string): string => {
  const trimmed = String(symbol ?? "").trim();
  if (trimmed.toLowerCase().startsWith("xyz:")) {
    return trimmed.slice(trimmed.indexOf(":") + 1).toUpperCase();
  }
  return trimmed.toUpperCase();
};

const getWatchlistAliases = (symbol: string): string[] => {
  const core = getWatchlistCoreSymbol(symbol);
  if (!COMMODITY_SYMBOLS.has(core)) return [symbol];
  return [`xyz:${core}`, core];
};

const loadTickerWatchlist = (): string[] => {
  try {
    const stored = localStorage.getItem(TICKER_WATCHLIST_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return normalizeWatchlist(parsed);
      }
    }
  } catch (e) {
    // Ignore
  }
  return normalizeWatchlist(DEFAULT_TICKER_WATCHLIST);
};

const saveTickerWatchlist = (symbols: string[]) => {
  try {
    localStorage.setItem(TICKER_WATCHLIST_KEY, JSON.stringify(symbols));
  } catch (e) {
    // Ignore
  }
};

const { tickerWatchlist, setTickerWatchlist, tickerWatchlistSet } = createRoot(
  () => {
    const [tickerWatchlist, setTickerWatchlist] = createSignal<string[]>(
      loadTickerWatchlist(),
    );
    const tickerWatchlistSet = createMemo(() => new Set(tickerWatchlist()));
    return { tickerWatchlist, setTickerWatchlist, tickerWatchlistSet };
  },
);
const tickerWatchlistSymbols = () => tickerWatchlist();
const getTickerWatchlistKey = (
  symbol: string,
  type?: Market["type"],
): string => {
  if (type) {
    return `${symbol}:${type}`;
  }
  return symbol;
};
const isTickerWatchlisted = (
  symbol: string,
  type?: Market["type"],
): boolean => {
  const key = getTickerWatchlistKey(symbol, type);
  // Check exact match first (symbol:type)
  if (tickerWatchlistSet().has(key)) return true;
  // For backward compatibility, also check symbol without type
  if (!type && tickerWatchlistSet().has(symbol)) return true;
  // Check aliases for backward compatibility
  return getWatchlistAliases(symbol).some((alias) =>
    tickerWatchlistSet().has(alias),
  );
};

const setTickerWatchlistSymbols = (symbols: string[]) => {
  const next = normalizeWatchlist(symbols);
  setTickerWatchlist(next);
  saveTickerWatchlist(next);
};

export const toggleTickerWatchlist = (
  symbol: string,
  type?: Market["type"],
) => {
  const currentList = tickerWatchlist();
  const nextSet = new Set(currentList);
  const key = getTickerWatchlistKey(symbol, type);

  // Check if exact key exists or if symbol without type exists (for backward compatibility)
  const hasExactKey = nextSet.has(key);
  const aliases = getWatchlistAliases(symbol);
  const hasOldFormat = aliases.some((alias) => nextSet.has(alias));

  if (hasExactKey || hasOldFormat) {
    // Remove exact key
    nextSet.delete(key);
    // Remove old format entries (backward compatibility) - but only if we're removing
    // Don't remove other type-specific entries - allow multiple types
    if (hasOldFormat) {
      aliases.forEach((alias) => nextSet.delete(alias));
    }
  } else {
    // Remove old format entries first (convert to new format)
    // This ensures old "HYPE" entries get converted to "HYPE:perps" or "HYPE:spot"
    aliases.forEach((alias) => nextSet.delete(alias));
    // Add the new entry
    if (COMMODITY_SYMBOLS.has(getWatchlistCoreSymbol(symbol))) {
      nextSet.add(getWatchlistCoreSymbol(symbol));
    } else {
      nextSet.add(key);
    }
  }
  setTickerWatchlistSymbols([...nextSet]);
};

const loadWatchlists = (): WatchlistsState => {
  const fallbackLists = Object.fromEntries(
    Object.entries(DEFAULT_WATCHLISTS).map(([key, list]) => [
      key,
      normalizeWatchlist(list),
    ]),
  );

  try {
    const stored = localStorage.getItem(WATCHLISTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<WatchlistsState>;
      if (parsed && typeof parsed === "object") {
        const lists = { ...fallbackLists };
        const storedLists = parsed.lists ?? {};
        Object.entries(storedLists).forEach(([key, list]) => {
          if (!Array.isArray(list)) return;
          // Skip the old "watchlist" list - it's been removed
          if (key === "watchlist") return;
          const storedList = normalizeWatchlist(list);
          // Merge default symbols into existing lists to include new additions
          const defaultList = fallbackLists[key];
          if (defaultList && Array.isArray(defaultList)) {
            const mergedSet = new Set([...storedList, ...defaultList]);
            lists[key] = normalizeWatchlist([...mergedSet]);
          } else {
            lists[key] = storedList;
          }
        });
        let activeId =
          typeof parsed.activeId === "string" && lists[parsed.activeId]
            ? parsed.activeId
            : DEFAULT_WATCHLIST_NAME;
        // If activeId is "watchlist" (the removed list), switch to default
        if (activeId === "watchlist") {
          activeId = DEFAULT_WATCHLIST_NAME;
        }
        return { activeId, lists };
      }
    }
  } catch (e) {
    // Ignore
  }

  try {
    const legacy = localStorage.getItem(WATCHLIST_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as string[];
      if (Array.isArray(parsed)) {
        // Merge legacy watchlist into crypto list
        if (fallbackLists[DEFAULT_WATCHLIST_NAME]) {
          fallbackLists[DEFAULT_WATCHLIST_NAME] = normalizeWatchlist([
            ...fallbackLists[DEFAULT_WATCHLIST_NAME],
            ...parsed,
          ]);
        }
      }
    }
  } catch (e) {
    // Ignore
  }

  return {
    activeId: DEFAULT_WATCHLIST_NAME,
    lists: fallbackLists,
  };
};

const saveWatchlists = (state: WatchlistsState) => {
  try {
    // Remove "watchlist" list if it exists before saving
    const cleanedLists = { ...state.lists };
    if (cleanedLists["watchlist"]) {
      delete cleanedLists["watchlist"];
    }
    // Ensure activeId is not "watchlist"
    const activeId =
      state.activeId === "watchlist" ? DEFAULT_WATCHLIST_NAME : state.activeId;
    localStorage.setItem(
      WATCHLISTS_KEY,
      JSON.stringify({ activeId, lists: cleanedLists }),
    );
  } catch (e) {
    // Ignore
  }
};

const {
  watchlists,
  setWatchlists,
  activeWatchlistId,
  watchlistNames,
  activeWatchlistSet,
  allWatchlistSymbolSet,
} = createRoot(() => {
  const [watchlists, setWatchlists] =
    createSignal<WatchlistsState>(loadWatchlists());
  const activeWatchlistId = () => watchlists().activeId;
  const watchlistNames = createMemo(() => Object.keys(watchlists().lists));
  const activeWatchlistSet = createMemo(
    () => new Set(watchlists().lists[activeWatchlistId()] ?? []),
  );
  const allWatchlistSymbolSet = createMemo(() => {
    const all = new Set<string>();
    const lists = watchlists().lists;
    Object.values(lists).forEach((symbols) => {
      symbols.forEach((symbol) => {
        const core = getWatchlistCoreSymbol(symbol);
        if (core) all.add(core);
      });
    });
    return all;
  });

  return {
    watchlists,
    setWatchlists,
    activeWatchlistId,
    watchlistNames,
    activeWatchlistSet,
    allWatchlistSymbolSet,
  };
});
export const isWatchlisted = (symbol: string): boolean =>
  getWatchlistAliases(symbol).some((alias) => activeWatchlistSet().has(alias));
const getAllWatchlistSymbols = (): string[] => [...allWatchlistSymbolSet()];
const getAllWatchlistSymbolSet = () => allWatchlistSymbolSet();

const safeNormalizeSymbol = (value?: string | null): string | null => {
  if (!value) return null;
  const normalized = normalizeSymbol(value);
  return normalized || null;
};

const { trackedPerps, trackedSpots, trackedAssetsKey } = createRoot(() => {
  const positionsQuery = createConvexQuery(
    api.orders.listPositions,
    () => (isAuthenticated() ? {} : null),
    [],
  );
  const spotBalancesQuery = createConvexQuery(
    api.spot.listSpotBalances,
    () => (isAuthenticated() ? {} : null),
    [],
  );

  const trackedPerps = createMemo(() => {
    const next = new Set<string>();
    const positions = positionsQuery() ?? [];
    for (const position of positions) {
      if (!position) continue;
      if (!Number.isFinite(position.size) || position.size === 0) continue;
      const normalized = safeNormalizeSymbol(position.symbol);
      if (normalized) next.add(normalized);
    }
    return [...next];
  });

  const trackedSpots = createMemo(() => {
    const next = new Set<string>();
    const balances = spotBalancesQuery() ?? [];
    for (const balance of balances) {
      if (!balance) continue;
      if (!Number.isFinite(balance.balance) || balance.balance <= 0) continue;
      if (!balance.asset || balance.asset === "USDC") continue;
      const normalized = safeNormalizeSymbol(balance.asset);
      if (normalized && normalized !== "USDC") {
        next.add(normalized);
      }
    }
    return [...next];
  });

  const trackedAssetsKey = createMemo(() => {
    const perps = [...trackedPerps()].sort();
    const spots = [...trackedSpots()].sort();
    return `${perps.join(",")}|${spots.join(",")}`;
  });

  return { trackedPerps, trackedSpots, trackedAssetsKey };
});

// Reactive markets store
const { markets, setMarkets, marketsLoading, setMarketsLoading } = createRoot(
  () => {
    const [markets, setMarkets] = createSignal<Market[]>([]);
    const [marketsLoading, setMarketsLoading] = createSignal(true);

    createEffect(() => {
      watchlists();
      setMarkets((prev) =>
        prev.map((market) => ({
          ...market,
          watchlist: isWatchlisted(market.symbol),
        })),
      );
    });

    return { markets, setMarkets, marketsLoading, setMarketsLoading };
  },
);

// Export reactive accessor
export const MARKETS = markets;
export { marketsLoading };

const updateActiveWatchlistSymbols = (symbols: string[]) => {
  const state = watchlists();
  const nextState: WatchlistsState = {
    ...state,
    lists: {
      ...state.lists,
      [state.activeId]: normalizeWatchlist(symbols),
    },
  };
  setWatchlists(nextState);
  saveWatchlists(nextState);
  setMarkets((prev) =>
    prev.map((m) => ({
      ...m,
      watchlist: isWatchlisted(m.symbol),
    })),
  );
};

// Toggle watchlist for a symbol
export const toggleWatchlist = (symbol: string) => {
  const state = watchlists();
  const activeId = state.activeId;
  const currentList = state.lists[activeId] ?? [];
  const nextSet = new Set(currentList);
  const aliases = getWatchlistAliases(symbol);
  const shouldRemove = aliases.some((alias) => nextSet.has(alias));
  if (shouldRemove) {
    aliases.forEach((alias) => nextSet.delete(alias));
  } else if (COMMODITY_SYMBOLS.has(getWatchlistCoreSymbol(symbol))) {
    nextSet.add(getWatchlistCoreSymbol(symbol));
  } else {
    nextSet.add(symbol);
  }
  updateActiveWatchlistSymbols([...nextSet]);
};

export const addToWatchlist = (symbol: string) => {
  const state = watchlists();
  const activeId = state.activeId;
  const currentList = state.lists[activeId] ?? [];
  const nextSet = new Set(currentList);
  const aliases = getWatchlistAliases(symbol);
  if (aliases.some((alias) => nextSet.has(alias))) return;
  if (COMMODITY_SYMBOLS.has(getWatchlistCoreSymbol(symbol))) {
    nextSet.add(getWatchlistCoreSymbol(symbol));
  } else {
    nextSet.add(symbol);
  }
  updateActiveWatchlistSymbols([...nextSet]);
};

export const setActiveWatchlist = (listId: string) => {
  const state = watchlists();
  if (!state.lists[listId]) return;
  if (state.activeId === listId) return;
  const nextState = { ...state, activeId: listId };
  setWatchlists(nextState);
  saveWatchlists(nextState);
};

export const createWatchlist = (name: string): boolean => {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return false;
  const state = watchlists();
  // Check if list already exists
  if (state.lists[trimmed]) return false;
  // Don't allow creating lists with default names
  if (DEFAULT_WATCHLISTS[trimmed]) return false;
  const nextState: WatchlistsState = {
    ...state,
    lists: {
      ...state.lists,
      [trimmed]: [],
    },
    activeId: trimmed,
  };
  setWatchlists(nextState);
  saveWatchlists(nextState);
  return true;
};

export const deleteWatchlist = (listId: string): boolean => {
  const state = watchlists();
  // Don't allow deleting default lists
  if (DEFAULT_WATCHLISTS[listId]) return false;
  if (!state.lists[listId]) return false;
  const nextLists = { ...state.lists };
  delete nextLists[listId];
  // If deleting the active list, switch to default
  let nextActiveId = state.activeId;
  if (state.activeId === listId) {
    nextActiveId = DEFAULT_WATCHLIST_NAME;
  }
  const nextState: WatchlistsState = {
    activeId: nextActiveId,
    lists: nextLists,
  };
  setWatchlists(nextState);
  saveWatchlists(nextState);
  return true;
};

export const removeFromWatchlist = (symbol: string) => {
  const state = watchlists();
  const activeId = state.activeId;
  const currentList = state.lists[activeId] ?? [];
  const nextSet = new Set(currentList);
  const aliases = getWatchlistAliases(symbol);
  aliases.forEach((alias) => nextSet.delete(alias));
  updateActiveWatchlistSymbols([...nextSet]);
};

// Settings persistence
const SETTINGS_KEY = "trade-xyz-settings";
const LAST_SYMBOL_KEY = "trade-xyz-last-symbol";
const DEFAULT_SYMBOL = "HYPE";
export type DataProvider = "hyperliquid" | "lighter";
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
        parsed.dataProvider === "hyperliquid" ||
        parsed.dataProvider === "lighter"
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

const DEFAULT_PERPS_LEVERAGE = "10x";
const DEFAULT_SPOT_LEVERAGE = "1x";
const BASELINE_PERPS = ["BTC", "ETH", "HYPE", "SOL", "ZEC"];
const shouldUpdateTitle = () => window.location.pathname.startsWith("/trade");
const DISPLAY_MARKET_NAME_OVERRIDES: Record<string, string> = {
  XYZ100: "NDX",
  100: "NDX",
};
const URL_SYMBOL_OVERRIDES: Record<string, string> = {
  NDX: "xyz:XYZ100",
  XYZ100: "xyz:XYZ100",
  100: "xyz:XYZ100",
};
const getDisplaySymbol = (symbol: string): string => {
  const trimmed = symbol.trim();
  if (trimmed.toLowerCase().startsWith("xyz:")) {
    return trimmed.slice(trimmed.indexOf(":") + 1);
  }
  return trimmed;
};
const isXyzEquitySymbol = (symbol: string): boolean =>
  symbol.toLowerCase().startsWith("xyz:");
const getUrlSymbol = (symbol: string): string => {
  const coreSymbol = getDisplaySymbol(symbol);
  const override = DISPLAY_MARKET_NAME_OVERRIDES[coreSymbol.toUpperCase()];
  return override ?? coreSymbol;
};
const normalizeUrlSymbol = (symbol: string): string => {
  if (!symbol) return DEFAULT_SYMBOL;
  const normalized = normalizeSymbol(symbol);
  if (normalized.toLowerCase().startsWith("xyz:")) return normalized;
  const upper = normalized.toUpperCase();
  const override = URL_SYMBOL_OVERRIDES[upper];
  if (override) return override;
  const xyzCandidate = `xyz:${upper}`;
  const allMarkets = markets();
  if (allMarkets.some((market) => market.symbol === xyzCandidate)) {
    return xyzCandidate;
  }
  return normalized;
};
export const formatMarketName = (
  symbol: string,
  type?: Market["type"],
): string => {
  const coreSymbol = getDisplaySymbol(symbol);
  const override = DISPLAY_MARKET_NAME_OVERRIDES[coreSymbol.toUpperCase()];
  if (override) return override;
  if (type === "equities" || isXyzEquitySymbol(symbol)) return coreSymbol;
  return `${symbol}-USDC`;
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
const {
  currentSymbol,
  setCurrentSymbolInternal,
  currentMarket,
  setCurrentMarket,
  currentMarketType,
  setCurrentMarketTypeInternal,
  currentMarketLeverage,
  setCurrentMarketLeverageInternal,
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
  setShowOrderBookInternal,
  dataProvider,
  setDataProviderInternal,
} = createRoot(() => {
  const [currentSymbol, setCurrentSymbolInternal] = createSignal(initialSymbol);
  const [currentMarket, setCurrentMarket] = createSignal(
    initialMarket?.name ?? formatMarketName(initialSymbol),
  );
  const [currentMarketType, setCurrentMarketTypeInternal] = createSignal<
    Market["type"]
  >(initialMarket?.type ?? "perps");
  const [currentMarketLeverage, setCurrentMarketLeverageInternal] =
    createSignal(initialMarket?.leverage ?? "10x");
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

  return {
    currentSymbol,
    setCurrentSymbolInternal,
    currentMarket,
    setCurrentMarket,
    currentMarketType,
    setCurrentMarketTypeInternal,
    currentMarketLeverage,
    setCurrentMarketLeverageInternal,
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
    setShowOrderBookInternal,
    dataProvider,
    setDataProviderInternal,
  };
});

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
    ? normalizeUrlSymbol(nextValue)
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
  watchlistNames,
  activeWatchlistId,
  dataProvider,
  setDataProvider,
  getUrlSymbol,
  normalizeUrlSymbol,
  getWatchlistCoreSymbol,
  getAllWatchlistSymbolSet,
  tickerWatchlistSymbols,
  isTickerWatchlisted,
  setTickerWatchlistSymbols,
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
    `/trade/${getUrlSymbol(market.symbol)}`,
  );

  // Update document title
  if (shouldUpdateTitle()) {
    document.title = `${markPrice()} | ${getUrlSymbol(market.symbol)} | Trade XYZ`;
  }
};

const formatPriceValue = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return formatPriceStr(value);
};

const formatFundingRateValue = (value: number): string => {
  if (!Number.isFinite(value)) return "--";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(4)}%`;
};

const formatUsdValue = (value: number): string => {
  if (!Number.isFinite(value)) return "--";
  return formatVolume(value);
};

const syncCurrentMarket = (nextMarkets: Market[]): Market | null => {
  if (nextMarkets.length === 0) return null;
  const symbol = currentSymbol();
  const preferredType = currentMarketType();
  let match =
    nextMarkets.find(
      (market) => market.symbol === symbol && market.type === preferredType,
    ) ?? nextMarkets.find((market) => market.symbol === symbol);

  if (!match) {
    if (!symbol.toLowerCase().startsWith("xyz:")) {
      const upper = symbol.toUpperCase();
      const override = URL_SYMBOL_OVERRIDES[upper];
      const candidate = override ?? `xyz:${upper}`;
      const aliasMatch = nextMarkets.find(
        (market) => market.symbol === candidate,
      );
      if (aliasMatch) {
        match = aliasMatch;
        setCurrentSymbolInternal(aliasMatch.symbol);
        saveLastSymbol(aliasMatch.symbol);
      }
    }
  }

  if (!match) {
    match = nextMarkets[0];
    if (!match) return null;
    setCurrentSymbolInternal(match.symbol);
    saveLastSymbol(match.symbol);
  }

  batch(() => {
    setCurrentMarket(match!.name);
    setCurrentMarketTypeInternal(match!.type);
    setCurrentMarketLeverageInternal(match!.leverage);
  });

  return match;
};

const updateCurrentStatsFromMarket = (market: Market | null) => {
  if (!market) return;
  batch(() => {
    setMarkPrice(market.price || "--");
    setOraclePrice(market.price || "--");
    setChange24h(Number.isFinite(market.change24h) ? market.change24h : 0);
    setVolume24h(formatUsdValue(market.volume24h));

    if (market.type === "spot") {
      setOpenInterest("--");
      setFundingRate("--");
    } else {
      setOpenInterest(formatUsdValue(market.openInterest));
      setFundingRate(formatFundingRateValue(market.funding));
    }
  });

  if (shouldUpdateTitle()) {
    document.title = `${market.price || "--"} | ${getUrlSymbol(market.symbol)} | Trade XYZ`;
  }
};

const getTrackedAssets = (provider: DataProvider) => {
  const perps = new Set(trackedPerps());
  const spots = new Set(trackedSpots());

  BASELINE_PERPS.forEach((symbol) => perps.add(symbol));
  getAllWatchlistSymbols().forEach((symbol) => {
    perps.add(symbol);
    if (!isXyzEquitySymbol(symbol)) {
      spots.add(symbol);
    }
  });

  if (perps.size === 0 && spots.size === 0) {
    if (perps.size === 0) {
      const fallback = untrack(() => currentSymbol());
      if (fallback) perps.add(fallback);
    }
  }

  if (provider !== "hyperliquid") {
    spots.delete("HYPE");
    perps.delete("HYPE");
    for (const symbol of perps) {
      if (isXyzEquitySymbol(symbol)) perps.delete(symbol);
    }
    for (const symbol of spots) {
      if (isXyzEquitySymbol(symbol)) spots.delete(symbol);
    }
  }

  return {
    perps: [...perps],
    spots: [...spots],
  };
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
    if (shouldUpdateTitle()) {
      document.title = `${formatted} | ${getUrlSymbol(currentSymbol())} | Trade XYZ`;
    }
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
    if (Number.isFinite(vol)) setVolume24h(formatUsdValue(vol));
  }

  // Open interest (in base currency, convert to USD using mark price)
  if (ctx.openInterest != null) {
    const oiBase = Number(ctx.openInterest);
    const oiVal = Number.isFinite(markNumber) ? oiBase * markNumber : oiBase;
    if (Number.isFinite(oiVal)) setOpenInterest(formatUsdValue(oiVal));
  }

  // Funding rate (already in decimal form, multiply by 100 for percentage)
  if (ctx.funding != null) {
    const fundingVal = Number(ctx.funding) * 100;
    if (Number.isFinite(fundingVal)) {
      setFundingRate(formatFundingRateValue(fundingVal));
    }
  }
};

const updateCurrentSpotPrices = (
  coin: string,
  spotData: SpotMetaAndAssetCtxs,
) => {
  const normalized = normalizeSymbol(coin);
  const tokenMap = new Map<number, string>();
  spotData.meta.tokens.forEach((token) => {
    tokenMap.set(token.index, token.name);
  });

  const pair = spotData.meta.universe.find((entry) => {
    const base = tokenMap.get(entry.tokens[0]);
    const quote = tokenMap.get(entry.tokens[1]);
    return base?.toUpperCase() === normalized && quote === "USDC";
  });

  if (!pair) return;
  const ctx = spotData.ctx[pair.index];
  if (!ctx) return;

  const markSource = ctx.markPx ?? ctx.midPx;
  const markNumber = markSource ? Number(markSource) : NaN;
  if (markSource) {
    const formatted = formatPrice(markSource);
    setMarkPrice(formatted);
    setOraclePrice(formatted);
    if (shouldUpdateTitle()) {
      document.title = `${formatted} | ${getUrlSymbol(normalized)} | Trade XYZ`;
    }
  }

  if (ctx.prevDayPx && markNumber) {
    const prevDayPrice = Number(ctx.prevDayPx);
    if (Number.isFinite(prevDayPrice) && prevDayPrice > 0) {
      const change = ((markNumber - prevDayPrice) / prevDayPrice) * 100;
      if (Number.isFinite(change)) {
        setChange24h(change);
      }
    }
  }

  if (ctx.dayNtlVlm != null) {
    const vol = Number(ctx.dayNtlVlm);
    if (Number.isFinite(vol)) {
      setVolume24h(formatVolume(vol));
    }
  }

  setOpenInterest("--");
  setFundingRate("--");
};

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

const parseNumber = (value: string | number | null | undefined): number => {
  if (value == null) return NaN;
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : NaN;
};

const formatLighterLeverage = (fraction?: number): string => {
  const parsed = parseNumber(fraction ?? null);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PERPS_LEVERAGE;
  const leverage = Math.max(1, Math.floor(10000 / parsed));
  return `${leverage}x`;
};

const LIVE_PRICE_RESOLUTION = "1";
const LIVE_PRICE_LOOKBACK = 2;
const LIVE_PRICE_MIN_FETCH_MS = 15000;
const hyperliquidLivePriceCache = new Map<
  string,
  { price: number; ts: number }
>();

const formatLiveMarkPrice = (value: number, provider: DataProvider): string =>
  provider === "hyperliquid" ? formatPrice(value) : formatPriceValue(value);

const getLiveSymbols = (): string[] => {
  const next = new Set<string>(BASELINE_PERPS);
  const current = currentSymbol();
  if (current) next.add(current);
  trackedPerps().forEach((symbol) => {
    if (symbol) next.add(symbol);
  });
  return [...next];
};

const resolveMarketType = (symbol: string): Market["type"] => {
  const list = markets();
  const match = list.find((market) => market.symbol === symbol);
  if (match) return match.type;
  if (symbol === currentSymbol()) return currentMarketType();
  if (symbol.toLowerCase().startsWith("xyz:")) return "equities";
  return "perps";
};

const fetchHyperliquidLivePrice = async (
  symbol: string,
  signal?: AbortSignal,
): Promise<number | null> => {
  const now = Date.now();
  const cacheKey = normalizeSymbol(symbol);
  const cached = hyperliquidLivePriceCache.get(cacheKey);
  if (cached && now - cached.ts < LIVE_PRICE_MIN_FETCH_MS) {
    return cached.price;
  }
  if (signal?.aborted) return cached?.price ?? null;
  const periodMs = resolutionToMs(LIVE_PRICE_RESOLUTION);
  const fromMs = now - periodMs * LIVE_PRICE_LOOKBACK;
  const candles = await fetchHyperliquidCandles({
    coin: symbol,
    resolution: LIVE_PRICE_RESOLUTION,
    fromMs,
    toMs: now,
    signal,
  });
  const latest = candles[candles.length - 1];
  if (!latest || !Number.isFinite(latest.close)) return null;
  const price = latest.close > 0 ? latest.close : null;
  if (price != null) {
    hyperliquidLivePriceCache.set(cacheKey, { price, ts: now });
  }
  return price;
};

const fetchLighterLivePrice = async (
  symbol: string,
  marketType: Market["type"],
  signal?: AbortSignal,
): Promise<number | null> => {
  const lighterType = marketType === "spot" ? "spot" : "perps";
  const marketId = await getLighterMarketId(symbol, lighterType);
  if (marketId == null) return null;
  const detail = await fetchLighterOrderBookDetails({ marketId, signal });
  if (!detail) return null;
  const price = parseNumber(detail.last_trade_price ?? null);
  if (!Number.isFinite(price) || price <= 0) return null;
  return price;
};

const applyLivePriceUpdates = (
  provider: DataProvider,
  updates: Map<string, number>,
) => {
  if (updates.size === 0) return;

  const current = currentSymbol();
  const currentType = currentMarketType();
  const currentPrice = updates.get(current);
  if (currentPrice != null) {
    const formatted = formatLiveMarkPrice(currentPrice, provider);
    setMarkPrice(formatted);
    if (currentType === "spot") {
      setOraclePrice(formatted);
    }
    if (shouldUpdateTitle()) {
      document.title = `${formatted} | ${getUrlSymbol(current)} | Trade XYZ`;
    }
  }

  setMarkets((prev) => {
    let changed = false;
    const next = prev.map((market) => {
      const price = updates.get(market.symbol);
      if (price == null) return market;
      const formatted = formatPriceValue(price);
      if (market.price === formatted) return market;
      changed = true;
      return { ...market, price: formatted };
    });
    return changed ? next : prev;
  });
};

const buildHyperliquidMarkets = async (
  tracked: { perps: string[]; spots: string[] },
  signal?: AbortSignal,
): Promise<{
  markets: Market[];
  metaAndCtxs: MetaAndAssetCtxs | null;
  spotData: SpotMetaAndAssetCtxs | null;
  equitiesMetaAndCtxs: MetaAndAssetCtxs | null;
}> => {
  // Build normalized sets for comparison (handle both raw and normalized symbol names)
  const perpsSet = new Set<string>();
  tracked.perps.forEach((symbol) => {
    perpsSet.add(symbol);
    perpsSet.add(normalizeSymbol(symbol));
  });
  const spotsSet = new Set<string>();
  tracked.spots.forEach((symbol) => {
    spotsSet.add(symbol);
    spotsSet.add(normalizeSymbol(symbol));
  });

  const [metaAndCtxs, spotData, equitiesMetaAndCtxs] = await Promise.all([
    perpsSet.size > 0 ? fetchMetaAndAssetCtxs(signal) : Promise.resolve(null),
    spotsSet.size > 0
      ? fetchSpotMetaAndAssetCtxs(signal)
      : Promise.resolve(null),
    fetchMetaAndAssetCtxs(signal, { dex: "xyz" }),
  ]);

  const newMarkets: Market[] = [];

  if (metaAndCtxs) {
    metaAndCtxs.universe.forEach((asset, index) => {
      const normalizedAssetName = normalizeSymbol(asset.name);
      // Check both raw name and normalized name against the tracked set
      if (!perpsSet.has(asset.name) && !perpsSet.has(normalizedAssetName))
        return;
      const ctx = metaAndCtxs.ctx[index];
      if (!ctx) return;

      const markPriceVal = parseNumber(ctx.markPx ?? ctx.midPx);
      const prevDayPrice = parseNumber(ctx.prevDayPx);
      const change24hVal =
        Number.isFinite(prevDayPrice) &&
        prevDayPrice > 0 &&
        Number.isFinite(markPriceVal)
          ? ((markPriceVal - prevDayPrice) / prevDayPrice) * 100
          : 0;
      const volumeRaw = parseNumber(ctx.dayNtlVlm);
      const volume24hVal = Number.isFinite(volumeRaw) ? volumeRaw : 0;
      const oiBase = parseNumber(ctx.openInterest);
      const openInterestVal = Number.isFinite(oiBase)
        ? Number.isFinite(markPriceVal)
          ? oiBase * markPriceVal
          : oiBase
        : 0;
      const fundingRaw = parseNumber(ctx.funding);
      const fundingVal = Number.isFinite(fundingRaw) ? fundingRaw * 100 : 0;

      newMarkets.push({
        symbol: asset.name,
        name: formatMarketName(asset.name, "perps"),
        price: formatPriceValue(markPriceVal),
        change24h: change24hVal,
        volume24h: volume24hVal,
        openInterest: openInterestVal,
        funding: fundingVal,
        type: "perps",
        leverage: `${asset.maxLeverage}x`,
        watchlist: isWatchlisted(asset.name),
      });
    });
  }

  if (spotData) {
    const tokenMap = new Map<number, string>();
    spotData.meta.tokens.forEach((token) => {
      tokenMap.set(token.index, token.name);
    });

    spotData.meta.universe.forEach((pair) => {
      const ctx = spotData.ctx[pair.index];
      if (!ctx) return;

      const baseToken = tokenMap.get(pair.tokens[0]);
      const quoteToken = tokenMap.get(pair.tokens[1]);
      if (!baseToken || !quoteToken) return;
      if (quoteToken !== "USDC") return;
      const normalizedBaseToken = normalizeSymbol(baseToken);
      // Check both raw name and normalized name against the tracked set
      if (!spotsSet.has(baseToken) && !spotsSet.has(normalizedBaseToken))
        return;

      const markPriceVal = parseNumber(ctx.markPx ?? ctx.midPx);
      const prevDayPrice = parseNumber(ctx.prevDayPx);
      const change24hVal =
        Number.isFinite(prevDayPrice) &&
        prevDayPrice > 0 &&
        Number.isFinite(markPriceVal)
          ? ((markPriceVal - prevDayPrice) / prevDayPrice) * 100
          : 0;
      const volumeRaw = parseNumber(ctx.dayNtlVlm);
      const volume24hVal = Number.isFinite(volumeRaw) ? volumeRaw : 0;

      newMarkets.push({
        symbol: baseToken,
        name: formatMarketName(baseToken, "spot"),
        price: formatPriceValue(markPriceVal),
        change24h: change24hVal,
        volume24h: volume24hVal,
        openInterest: 0,
        funding: 0,
        type: "spot",
        leverage: DEFAULT_SPOT_LEVERAGE,
        watchlist: isWatchlisted(baseToken),
      });
    });
  }

  if (equitiesMetaAndCtxs) {
    equitiesMetaAndCtxs.universe.forEach((asset, index) => {
      const ctx = equitiesMetaAndCtxs.ctx[index];
      if (!ctx) return;

      const markPriceVal = parseNumber(ctx.markPx ?? ctx.midPx);
      const prevDayPrice = parseNumber(ctx.prevDayPx);
      const change24hVal =
        Number.isFinite(prevDayPrice) &&
        prevDayPrice > 0 &&
        Number.isFinite(markPriceVal)
          ? ((markPriceVal - prevDayPrice) / prevDayPrice) * 100
          : 0;
      const volumeRaw = parseNumber(ctx.dayNtlVlm);
      const volume24hVal = Number.isFinite(volumeRaw) ? volumeRaw : 0;
      const oiBase = parseNumber(ctx.openInterest);
      const openInterestVal = Number.isFinite(oiBase)
        ? Number.isFinite(markPriceVal)
          ? oiBase * markPriceVal
          : oiBase
        : 0;
      const fundingRaw = parseNumber(ctx.funding);
      const fundingVal = Number.isFinite(fundingRaw) ? fundingRaw * 100 : 0;

      newMarkets.push({
        symbol: asset.name,
        name: formatMarketName(asset.name, "equities"),
        price: formatPriceValue(markPriceVal),
        change24h: change24hVal,
        volume24h: volume24hVal,
        openInterest: openInterestVal,
        funding: fundingVal,
        type: "equities",
        leverage: `${asset.maxLeverage}x`,
        watchlist: isWatchlisted(asset.name),
      });
    });
  }

  return { markets: newMarkets, metaAndCtxs, spotData, equitiesMetaAndCtxs };
};

const fetchLighterPerpMarket = async (
  symbol: string,
  fundingRates: Map<number, number>,
  signal?: AbortSignal,
): Promise<Market | null> => {
  const marketId = await getLighterMarketId(symbol, "perps");
  if (marketId == null) return null;
  try {
    const detail = await fetchLighterOrderBookDetails({ marketId, signal });
    if (!detail) return null;
    const baseSymbol =
      normalizeLighterSymbol(detail.symbol || symbol) || symbol;

    const priceVal = parseNumber(detail.last_trade_price);
    const changeRaw = parseNumber(detail.daily_price_change);
    const volumeRaw = parseNumber(detail.daily_quote_token_volume);
    const oiBase = parseNumber(detail.open_interest);
    const openInterestVal = Number.isFinite(oiBase)
      ? Number.isFinite(priceVal)
        ? oiBase * priceVal
        : oiBase
      : 0;
    const fundingRaw = fundingRates.get(marketId) ?? 0;

    return {
      symbol: baseSymbol,
      name: `${baseSymbol}-USDC`,
      price: formatPriceValue(priceVal),
      change24h: Number.isFinite(changeRaw) ? changeRaw : 0,
      volume24h: Number.isFinite(volumeRaw) ? volumeRaw : 0,
      openInterest: openInterestVal,
      funding: Number.isFinite(fundingRaw) ? fundingRaw * 100 : 0,
      type: "perps",
      leverage: formatLighterLeverage(detail.default_initial_margin_fraction),
      watchlist: isWatchlisted(baseSymbol),
    };
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn(`Lighter perp market failed: ${symbol}`, error);
    return null;
  }
};

const fetchLighterSpotMarket = async (
  symbol: string,
  signal?: AbortSignal,
): Promise<Market | null> => {
  const marketId = await getLighterMarketId(symbol, "spot");
  if (marketId == null) return null;
  try {
    const detail = await fetchLighterOrderBookDetails({ marketId, signal });
    if (!detail) return null;
    const baseSymbol =
      normalizeLighterSymbol(detail.symbol || symbol) || symbol;

    const priceVal = parseNumber(detail.last_trade_price);
    const changeRaw = parseNumber(detail.daily_price_change);
    const volumeRaw = parseNumber(detail.daily_quote_token_volume);

    return {
      symbol: baseSymbol,
      name: `${baseSymbol}-USDC`,
      price: formatPriceValue(priceVal),
      change24h: Number.isFinite(changeRaw) ? changeRaw : 0,
      volume24h: Number.isFinite(volumeRaw) ? volumeRaw : 0,
      openInterest: 0,
      funding: 0,
      type: "spot",
      leverage: DEFAULT_SPOT_LEVERAGE,
      watchlist: isWatchlisted(baseSymbol),
    };
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn(`Lighter spot market failed: ${symbol}`, error);
    return null;
  }
};

const buildLighterMarkets = async (
  tracked: { perps: string[]; spots: string[] },
  signal?: AbortSignal,
): Promise<Market[]> => {
  const perpsSymbols = [...new Set(tracked.perps)];
  const spotSymbols = [...new Set(tracked.spots)];
  const fundingRates = new Map<number, number>();

  if (perpsSymbols.length > 0) {
    try {
      const rates = await fetchLighterFundingRates(signal);
      rates
        .filter((rate) => rate.exchange === "lighter")
        .forEach((rate) => {
          const parsed = parseNumber(rate.rate);
          if (Number.isFinite(parsed)) {
            fundingRates.set(rate.market_id, parsed);
          }
        });
    } catch (error) {
      if (signal?.aborted) return [];
      console.warn("Lighter funding rates failed:", error);
    }
  }

  const [perpsMarkets, spotMarkets] = await Promise.all([
    Promise.all(
      perpsSymbols.map((symbol) =>
        fetchLighterPerpMarket(symbol, fundingRates, signal),
      ),
    ),
    Promise.all(
      spotSymbols.map((symbol) => fetchLighterSpotMarket(symbol, signal)),
    ),
  ]);

  return [...perpsMarkets, ...spotMarkets].filter((market): market is Market =>
    Boolean(market),
  );
};

const fetchAndUpdateMarkets = async (
  signal?: AbortSignal,
  updateCurrentStats = true,
): Promise<void> => {
  const provider = dataProvider();
  const trackedAssets = getTrackedAssets(provider);

  try {
    let newMarkets: Market[] = [];
    let metaAndCtxs: MetaAndAssetCtxs | null = null;
    let spotData: SpotMetaAndAssetCtxs | null = null;
    let equitiesMetaAndCtxs: MetaAndAssetCtxs | null = null;

    if (provider === "hyperliquid") {
      const result = await buildHyperliquidMarkets(trackedAssets, signal);
      newMarkets = result.markets;
      metaAndCtxs = result.metaAndCtxs;
      spotData = result.spotData;
      equitiesMetaAndCtxs = result.equitiesMetaAndCtxs;
    } else {
      newMarkets = await buildLighterMarkets(trackedAssets, signal);
    }

    if (signal?.aborted) return;

    newMarkets.sort((a, b) => b.volume24h - a.volume24h);

    setMarkets(newMarkets);
    setMarketsLoading(false);

    const selected = syncCurrentMarket(newMarkets);

    if (!updateCurrentStats) return;

    if (provider === "hyperliquid") {
      const coin = selected?.symbol ?? currentSymbol();
      const marketType = selected?.type ?? currentMarketType();
      if (marketType === "spot") {
        if (spotData) {
          updateCurrentSpotPrices(coin, spotData);
        } else {
          updateCurrentStatsFromMarket(selected);
        }
      } else if (marketType === "equities") {
        if (equitiesMetaAndCtxs) {
          updateCurrentSymbolPrices(coin, equitiesMetaAndCtxs);
        } else {
          updateCurrentStatsFromMarket(selected);
        }
      } else {
        if (metaAndCtxs) {
          updateCurrentSymbolPrices(coin, metaAndCtxs);
        } else {
          updateCurrentStatsFromMarket(selected);
        }
      }
      return;
    }

    updateCurrentStatsFromMarket(selected);
  } catch (e) {
    if (signal?.aborted) return;
    console.error("Failed to fetch markets:", e);
    setMarketsLoading(false);
  }
};

/**
 * Fetches lightweight live prices for current/active symbols without
 * rebuilding the full markets list.
 */
const fetchAndUpdateLivePrices = async (
  signal?: AbortSignal,
): Promise<void> => {
  const provider = dataProvider();
  const symbols = getLiveSymbols();
  if (symbols.length === 0) return;

  const updates = new Map<string, number>();

  if (provider === "hyperliquid") {
    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const price = await fetchHyperliquidLivePrice(symbol, signal);
          if (price != null) updates.set(symbol, price);
        } catch (error) {
          if (signal?.aborted) return;
          console.warn(`Live price failed: ${symbol}`, error);
        }
      }),
    );
  } else {
    const typeBySymbol = new Map<string, Market["type"]>();
    markets().forEach((market) => {
      typeBySymbol.set(market.symbol, market.type);
    });
    await Promise.all(
      symbols.map(async (symbol) => {
        const marketType =
          typeBySymbol.get(symbol) ?? resolveMarketType(symbol);
        if (marketType === "equities") return;
        try {
          const price = await fetchLighterLivePrice(symbol, marketType, signal);
          if (price != null) updates.set(symbol, price);
        } catch (error) {
          if (signal?.aborted) return;
          console.warn(`Live price failed: ${symbol}`, error);
        }
      }),
    );
  }

  if (signal?.aborted) return;
  applyLivePriceUpdates(provider, updates);
};

const MARKETS_POLL_MS = 15000;
const LIVE_PRICE_POLL_MS = 2000;
const LIVE_PRICE_DEBOUNCE_MS = 300;

/**
 * Live price polling hook.
 * - Full markets refresh runs on a slower interval.
 * - Current/active symbol prices update more frequently.
 */
export const useLivePrices = (options?: { enabled?: () => boolean }) => {
  let marketsTimer: number | undefined;
  let liveTimer: number | undefined;
  let liveImmediateTimer: number | undefined;
  let marketsController: AbortController | undefined;
  let liveController: AbortController | undefined;
  let livePollInFlight = false;
  let livePollQueued = false;
  const isEnabled = options?.enabled ?? (() => true);

  const pollMarkets = async () => {
    marketsController?.abort();
    const nextController = new AbortController();
    marketsController = nextController;
    try {
      await fetchAndUpdateMarkets(nextController.signal, true);
    } catch (e) {
      if (nextController.signal.aborted) return;
      console.error("Error updating markets:", e);
    }
  };

  const pollLivePrices = async () => {
    if (livePollInFlight) {
      livePollQueued = true;
      return;
    }
    livePollInFlight = true;
    livePollQueued = false;
    const nextController = new AbortController();
    liveController = nextController;
    try {
      await fetchAndUpdateLivePrices(nextController.signal);
    } catch (e) {
      if (nextController.signal.aborted) return;
      console.error("Error updating live prices:", e);
    } finally {
      livePollInFlight = false;
      if (livePollQueued && !nextController.signal.aborted) {
        livePollQueued = false;
        void pollLivePrices();
      }
    }
  };

  const scheduleLivePrices = (delayMs = 0) => {
    if (!isEnabled()) return;
    if (liveImmediateTimer) {
      clearTimeout(liveImmediateTimer);
      liveImmediateTimer = undefined;
    }
    liveImmediateTimer = setTimeout(() => {
      liveImmediateTimer = undefined;
      if (!isEnabled()) return;
      void pollLivePrices();
    }, delayMs) as unknown as number;
  };

  createEffect(() => {
    const enabled = isEnabled();
    const symbol = currentSymbol();
    const marketType = currentMarketType();
    if (!enabled) return;

    const list = untrack(() => markets());
    if (list.length > 0) {
      const match =
        list.find(
          (market) => market.symbol === symbol && market.type === marketType,
        ) ?? list.find((market) => market.symbol === symbol);
      if (match) updateCurrentStatsFromMarket(match);
    }

    scheduleLivePrices(LIVE_PRICE_DEBOUNCE_MS);
  });

  // React to provider/watchlist changes and enabled state
  createEffect(() => {
    const enabled = isEnabled();
    dataProvider();
    trackedAssetsKey();

    // Clear previous timer
    if (marketsTimer) {
      clearInterval(marketsTimer);
      marketsTimer = undefined;
    }
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = undefined;
    }
    if (liveImmediateTimer) {
      clearTimeout(liveImmediateTimer);
      liveImmediateTimer = undefined;
    }
    marketsController?.abort();
    liveController?.abort();
    livePollInFlight = false;
    livePollQueued = false;

    if (!enabled) return;

    // Immediate update
    untrack(() => {
      void pollMarkets();
      scheduleLivePrices(LIVE_PRICE_DEBOUNCE_MS);
    });

    // Start polling with split intervals
    marketsTimer = setInterval(
      pollMarkets,
      MARKETS_POLL_MS,
    ) as unknown as number;
    liveTimer = setInterval(
      pollLivePrices,
      LIVE_PRICE_POLL_MS,
    ) as unknown as number;
  });

  onCleanup(() => {
    if (marketsTimer) clearInterval(marketsTimer);
    if (liveTimer) clearInterval(liveTimer);
    if (liveImmediateTimer) clearTimeout(liveImmediateTimer);
    marketsController?.abort();
    liveController?.abort();
    livePollInFlight = false;
    livePollQueued = false;
  });
};

// Initial fetch on module load (non-polling, just to populate markets initially)
// The useLivePrices hook will take over polling when the app mounts
fetchAndUpdateMarkets(undefined, false);
