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
  getAssetContext,
  formatPrice,
  formatVolume,
  normalizeSymbol,
  type MetaAndAssetCtxs,
  type SpotMetaAndAssetCtxs,
} from "../lib/hyperliquid";
import {
  fetchFuturesTicker,
  fetchOpenInterest,
  fetchPremiumIndex,
  fetchSpotTicker,
  toBinanceSymbol,
} from "../lib/binance";
import {
  fetchLighterFundingRates,
  fetchLighterOrderBookDetails,
  getLighterMarketId,
  normalizeLighterSymbol,
} from "../lib/lighter";

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

const safeNormalizeSymbol = (value?: string | null): string | null => {
  if (!value) return null;
  const normalized = normalizeSymbol(value);
  return normalized || null;
};

const { trackedPerps, trackedSpots } = createRoot(() => {
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

  return { trackedPerps, trackedSpots };
});

const trackedAssetsKey = createMemo(() => {
  const perps = [...trackedPerps()].sort();
  const spots = [...trackedSpots()].sort();
  return `${perps.join(",")}|${spots.join(",")}`;
});

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
export type DataProvider = "hyperliquid" | "binance" | "lighter";
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
const DISPLAY_MARKET_NAME_OVERRIDES: Record<string, string> = {
  XYZ100: "NDX",
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
const [currentSymbol, setCurrentSymbolInternal] = createSignal(initialSymbol);
const [currentMarket, setCurrentMarket] = createSignal(
  initialMarket?.name ?? formatMarketName(initialSymbol),
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

  document.title = `${market.price || "--"} | ${market.symbol} | Trade XYZ`;
};

const getTrackedAssets = (provider: DataProvider) => {
  const perps = new Set(trackedPerps());
  const spots = new Set(trackedSpots());

  BASELINE_PERPS.forEach((symbol) => perps.add(symbol));
  watchlistSet.forEach((symbol) => {
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
    document.title = `${formatted} | ${normalized} | Trade XYZ`;
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

const buildHyperliquidMarkets = async (
  tracked: { perps: string[]; spots: string[] },
  signal?: AbortSignal,
): Promise<{
  markets: Market[];
  metaAndCtxs: MetaAndAssetCtxs | null;
  spotData: SpotMetaAndAssetCtxs | null;
  equitiesMetaAndCtxs: MetaAndAssetCtxs | null;
}> => {
  const perpsSet = new Set(tracked.perps);
  const spotsSet = new Set(tracked.spots);

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
      if (!perpsSet.has(asset.name)) return;
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
        watchlist: watchlistSet.has(asset.name),
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
      if (!spotsSet.has(baseToken)) return;

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
        watchlist: watchlistSet.has(baseToken),
      });
    });
  }

  if (equitiesMetaAndCtxs) {
    equitiesMetaAndCtxs.universe.forEach((asset, index) => {
      const ctx = equitiesMetaAndCtxs.ctx[index];
      if (!ctx) return;

      const markPriceVal = parseNumber(ctx.markPx ?? ctx.midPx);
      const markPrice = Number.isFinite(markPriceVal) ? markPriceVal : 0;
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
        watchlist: watchlistSet.has(asset.name),
      });
    });
  }

  return { markets: newMarkets, metaAndCtxs, spotData, equitiesMetaAndCtxs };
};

const fetchBinancePerpMarket = async (
  symbol: string,
  signal?: AbortSignal,
): Promise<Market | null> => {
  const marketSymbol = toBinanceSymbol(symbol, "USDT");
  try {
    const [ticker, premium, openInterest] = await Promise.all([
      fetchFuturesTicker({ symbol: marketSymbol, signal }),
      fetchPremiumIndex({ symbol: marketSymbol, signal }),
      fetchOpenInterest({ symbol: marketSymbol, signal }),
    ]);

    const markPriceVal = parseNumber(premium?.markPrice ?? ticker?.lastPrice);
    const lastPriceVal = parseNumber(ticker?.lastPrice);
    const priceVal = Number.isFinite(markPriceVal)
      ? markPriceVal
      : lastPriceVal;
    const changeRaw = parseNumber(ticker?.priceChangePercent);
    const volumeRaw = parseNumber(ticker?.quoteVolume);
    const oiBase = parseNumber(openInterest?.openInterest);
    const openInterestVal = Number.isFinite(oiBase)
      ? Number.isFinite(priceVal)
        ? oiBase * priceVal
        : oiBase
      : 0;
    const fundingRaw = parseNumber(premium?.lastFundingRate);

    return {
      symbol,
      name: `${symbol}-USDT`,
      price: formatPriceValue(priceVal),
      change24h: Number.isFinite(changeRaw) ? changeRaw : 0,
      volume24h: Number.isFinite(volumeRaw) ? volumeRaw : 0,
      openInterest: openInterestVal,
      funding: Number.isFinite(fundingRaw) ? fundingRaw * 100 : 0,
      type: "perps",
      leverage: DEFAULT_PERPS_LEVERAGE,
      watchlist: watchlistSet.has(symbol),
    };
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn(`Binance perp market failed: ${symbol}`, error);
    return null;
  }
};

const fetchBinanceSpotMarket = async (
  symbol: string,
  signal?: AbortSignal,
): Promise<Market | null> => {
  const marketSymbol = toBinanceSymbol(symbol, "USDT");
  try {
    const ticker = await fetchSpotTicker({ symbol: marketSymbol, signal });
    const lastPriceVal = parseNumber(ticker?.lastPrice);
    const changeRaw = parseNumber(ticker?.priceChangePercent);
    const volumeRaw = parseNumber(ticker?.quoteVolume);

    return {
      symbol,
      name: `${symbol}-USDT`,
      price: formatPriceValue(lastPriceVal),
      change24h: Number.isFinite(changeRaw) ? changeRaw : 0,
      volume24h: Number.isFinite(volumeRaw) ? volumeRaw : 0,
      openInterest: 0,
      funding: 0,
      type: "spot",
      leverage: DEFAULT_SPOT_LEVERAGE,
      watchlist: watchlistSet.has(symbol),
    };
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn(`Binance spot market failed: ${symbol}`, error);
    return null;
  }
};

const buildBinanceMarkets = async (
  tracked: { perps: string[]; spots: string[] },
  signal?: AbortSignal,
): Promise<Market[]> => {
  const perpsSymbols = [...new Set(tracked.perps)];
  const spotSymbols = [...new Set(tracked.spots)];

  const [perpsMarkets, spotMarkets] = await Promise.all([
    Promise.all(
      perpsSymbols.map((symbol) => fetchBinancePerpMarket(symbol, signal)),
    ),
    Promise.all(
      spotSymbols.map((symbol) => fetchBinanceSpotMarket(symbol, signal)),
    ),
  ]);

  return [...perpsMarkets, ...spotMarkets].filter((market): market is Market =>
    Boolean(market),
  );
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
      watchlist: watchlistSet.has(baseSymbol),
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
      watchlist: watchlistSet.has(baseSymbol),
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

const fetchAndUpdateAll = async (
  signal?: AbortSignal,
  updateLivePrices = true,
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
    } else if (provider === "binance") {
      newMarkets = await buildBinanceMarkets(trackedAssets, signal);
    } else {
      newMarkets = await buildLighterMarkets(trackedAssets, signal);
    }

    if (signal?.aborted) return;

    newMarkets.sort((a, b) => b.volume24h - a.volume24h);

    setMarkets(newMarkets);
    setMarketsLoading(false);

    const selected = syncCurrentMarket(newMarkets);

    if (!updateLivePrices) return;

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
    dataProvider();
    trackedAssetsKey();

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
