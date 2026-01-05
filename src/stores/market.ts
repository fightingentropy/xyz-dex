import { createSignal, createEffect, onCleanup } from "solid-js";
import {
  fetchOpenInterest,
  fetchPremiumIndex,
  fetchTicker24h,
  formatPrice,
  normalizeSymbol,
} from "../lib/binance";

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

// Sample markets data
export const MARKETS: Market[] = [
  {
    symbol: "BTC",
    name: "BTC-USDT",
    price: "68,435",
    change24h: -0.77,
    volume24h: 1145.82e6,
    openInterest: 2812.78e6,
    funding: 0.0013,
    type: "perps",
    leverage: "50x",
    watchlist: true,
  },
  {
    symbol: "ETH",
    name: "ETH-USDT",
    price: "3,034.5",
    change24h: -1.04,
    volume24h: 782.5e6,
    openInterest: 1425.91e6,
    funding: 0.0008,
    type: "perps",
    leverage: "50x",
    watchlist: true,
  },
  {
    symbol: "SOL",
    name: "SOL-USDT",
    price: "122.12",
    change24h: -1.1,
    volume24h: 409.13e6,
    openInterest: 445.0e6,
    funding: 0.0013,
    type: "perps",
    leverage: "20x",
    watchlist: true,
  },
  {
    symbol: "HYPE",
    name: "HYPE-USDT",
    price: "24.996",
    change24h: 0.29,
    volume24h: 121.81e6,
    openInterest: 781.02e6,
    funding: 0.0013,
    type: "perps",
    leverage: "20x",
    watchlist: true,
  },
  {
    symbol: "BNB",
    name: "BNB-USDT",
    price: "598.20",
    change24h: -0.45,
    volume24h: 338.92e6,
    openInterest: 285.41e6,
    funding: 0.001,
    type: "perps",
    leverage: "20x",
    watchlist: false,
  },
  {
    symbol: "XRP",
    name: "XRP-USDT",
    price: "0.5582",
    change24h: 0.42,
    volume24h: 298.18e6,
    openInterest: 167.43e6,
    funding: 0.0005,
    type: "perps",
    leverage: "20x",
    watchlist: false,
  },
  {
    symbol: "ADA",
    name: "ADA-USDT",
    price: "0.458",
    change24h: 0.53,
    volume24h: 118.42e6,
    openInterest: 65.18e6,
    funding: 0.0007,
    type: "spot",
    leverage: "10x",
    watchlist: false,
  },
  {
    symbol: "DOGE",
    name: "DOGE-USDT",
    price: "0.158",
    change24h: 1.08,
    volume24h: 212.95e6,
    openInterest: 98.72e6,
    funding: 0.0009,
    type: "spot",
    leverage: "10x",
    watchlist: true,
  },
  {
    symbol: "AVAX",
    name: "AVAX-USDT",
    price: "21.45",
    change24h: -1.12,
    volume24h: 145.28e6,
    openInterest: 62.15e6,
    funding: 0.0012,
    type: "perps",
    leverage: "20x",
    watchlist: false,
  },
  {
    symbol: "LINK",
    name: "LINK-USDT",
    price: "17.29",
    change24h: 1.25,
    volume24h: 55.06e6,
    openInterest: 44.85e6,
    funding: 0.0006,
    type: "spot",
    leverage: "10x",
    watchlist: false,
  },
  {
    symbol: "DOT",
    name: "DOT-USDT",
    price: "6.58",
    change24h: -0.32,
    volume24h: 38.92e6,
    openInterest: 25.41e6,
    funding: 0.0008,
    type: "spot",
    leverage: "10x",
    watchlist: false,
  },
  {
    symbol: "LTC",
    name: "LTC-USDT",
    price: "91.29",
    change24h: 0.66,
    volume24h: 55.06e6,
    openInterest: 24.85e6,
    funding: 0.0005,
    type: "perps",
    leverage: "10x",
    watchlist: false,
  },
  {
    symbol: "ATOM",
    name: "ATOM-USDT",
    price: "9.58",
    change24h: 0.53,
    volume24h: 18.42e6,
    openInterest: 25.18e6,
    funding: 0.0011,
    type: "spot",
    leverage: "10x",
    watchlist: false,
  },
];

// Ticker data for marquee
export const TICKER_DATA = [
  { symbol: "BTC", change: -1.03 },
  { symbol: "ETH", change: -1.04 },
  { symbol: "SOL", change: -1.45 },
  { symbol: "HYPE", change: 0.29 },
  { symbol: "BNB", change: -0.45 },
  { symbol: "XRP", change: 0.42 },
  { symbol: "ADA", change: 0.53 },
  { symbol: "DOGE", change: 1.08 },
  { symbol: "AVAX", change: -1.12 },
  { symbol: "LINK", change: 1.25 },
  { symbol: "DOT", change: -0.32 },
  { symbol: "LTC", change: 0.66 },
  { symbol: "ATOM", change: 0.53 },
];

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
const [currentSymbol, setCurrentSymbolInternal] = createSignal(initialSymbol);
const [currentMarket, setCurrentMarket] = createSignal(`${initialSymbol}-USDT`);
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
};

export {
  currentSymbol,
  setCurrentSymbol,
  currentMarket,
  setCurrentMarket,
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

export const selectMarket = (symbol: string, name: string) => {
  setCurrentSymbol(symbol);
  setCurrentMarket(name);
  setSearchOpen(false);

  // Update URL to reflect the new symbol
  window.history.pushState({ page: "trade", symbol }, "", `/trade/${symbol}`);

  // Update document title
  document.title = `${markPrice()} | ${name} | Trade XYZ`;
};

// Live price polling
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
      const [ticker, premium, oi] = await Promise.all([
        fetchTicker24h(coin, nextController.signal),
        fetchPremiumIndex(coin, nextController.signal),
        fetchOpenInterest(coin, nextController.signal),
      ]);

      if (
        currentRequestId !== requestId ||
        nextController.signal.aborted ||
        !isEnabled() ||
        currentSymbol() !== coin
      ) {
        return;
      }

      const markSource = premium?.markPrice ?? ticker?.lastPrice;
      const markNumber = markSource ? Number(markSource) : NaN;
      if (markSource) {
        const formatted = formatPrice(markSource);
        setMarkPrice(formatted);
        document.title = `${formatted} | ${currentMarket()} | Trade XYZ`;
      }

      const oracleSource = premium?.indexPrice ?? premium?.markPrice;
      if (oracleSource) {
        setOraclePrice(formatPrice(oracleSource));
      }

      if (ticker?.priceChangePercent != null) {
        const change = Number(ticker.priceChangePercent);
        if (Number.isFinite(change)) {
          setChange24h(change);
        }
      }

      if (ticker?.quoteVolume != null) {
        const vol = Number(ticker.quoteVolume);
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

      if (oi?.openInterest != null) {
        const oiBase = Number(oi.openInterest);
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

      if (premium?.lastFundingRate != null) {
        const fundingVal = Number(premium.lastFundingRate) * 100;
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
