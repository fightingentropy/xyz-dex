import { createSignal } from "solid-js";
import { normalizeSymbol } from "../lib/binance";
import { currentSymbol, setCurrentSymbol, setCurrentMarket } from "./market";

export type Page = "trade" | "portfolio" | "charts";

// Parse URL to get initial state
const parseUrl = (): { page: Page; symbol?: string } => {
  const path = window.location.pathname;

  // /trade or /trade/SYMBOL
  if (path === "/trade" || path.startsWith("/trade/")) {
    const parts = path.split("/").filter(Boolean);
    const symbol = normalizeSymbol(parts[1] || "");
    return { page: "trade", symbol: symbol || undefined };
  }

  // /portfolio
  if (path === "/portfolio") {
    return { page: "portfolio" };
  }

  // /charts
  if (path === "/charts") {
    return { page: "charts" };
  }

  // Default: / goes to trade
  return { page: "trade" };
};

const initialState = parseUrl();

const [currentPage, setCurrentPageInternal] = createSignal<Page>(
  initialState.page,
);

// Set initial symbol from URL if present
if (initialState.symbol) {
  setCurrentSymbol(initialState.symbol);
  setCurrentMarket(`${initialState.symbol}-USDT`);
}

// Update URL when page changes
export const setCurrentPage = (page: Page) => {
  setCurrentPageInternal(page);

  if (page === "portfolio") {
    window.history.pushState({ page }, "", "/portfolio");
  } else if (page === "charts") {
    window.history.pushState({ page }, "", "/charts");
  } else {
    const symbol = currentSymbol();
    window.history.pushState({ page, symbol }, "", `/trade/${symbol}`);
  }
};

// Handle browser back/forward navigation
window.addEventListener("popstate", (event) => {
  const state = event.state;

  if (state?.page === "portfolio") {
    setCurrentPageInternal("portfolio");
  } else if (state?.page === "charts") {
    setCurrentPageInternal("charts");
  } else if (state?.page === "trade") {
    setCurrentPageInternal("trade");
    if (state.symbol) {
      const symbol = normalizeSymbol(state.symbol);
      setCurrentSymbol(symbol);
      setCurrentMarket(`${symbol}-USDT`);
    }
  } else {
    // Fallback: parse current URL
    const parsed = parseUrl();
    setCurrentPageInternal(parsed.page);
    if (parsed.symbol) {
      setCurrentSymbol(parsed.symbol);
      setCurrentMarket(`${parsed.symbol}-USDT`);
    }
  }
});

// Set initial URL state (replace, don't push)
if (initialState.page === "portfolio") {
  window.history.replaceState({ page: "portfolio" }, "", "/portfolio");
} else if (initialState.page === "charts") {
  window.history.replaceState({ page: "charts" }, "", "/charts");
} else {
  const symbol = currentSymbol();
  window.history.replaceState(
    { page: "trade", symbol },
    "",
    `/trade/${symbol}`,
  );
}

export { currentPage };
