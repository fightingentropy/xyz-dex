import { createSignal } from "solid-js";
import { normalizeSymbol } from "../lib/hyperliquid";
import {
  currentSymbol,
  formatMarketName,
  setCurrentMarket,
  setCurrentSymbol,
} from "./market";

export type Page = "trade" | "portfolio" | "charts" | "admin" | "vaults";

// Parse URL to get initial state
const parseUrl = (): { page: Page; symbol?: string; vaultId?: string } => {
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

  // /vaults or /vaults/:id
  if (path === "/vaults" || path.startsWith("/vaults/")) {
    const parts = path.split("/").filter(Boolean);
    const vaultId = parts[1];
    return { page: "vaults", vaultId: vaultId || undefined };
  }

  // /charts
  if (path === "/charts") {
    return { page: "charts" };
  }

  // /admin
  if (path === "/admin") {
    return { page: "admin" };
  }

  // Default: / goes to trade
  return { page: "trade" };
};

const initialState = parseUrl();

const [currentPage, setCurrentPageInternal] = createSignal<Page>(
  initialState.page,
);
const [currentVaultId, setCurrentVaultIdInternal] = createSignal<
  string | undefined
>(initialState.vaultId);

// Set initial symbol from URL if present
if (initialState.symbol) {
  setCurrentSymbol(initialState.symbol);
  setCurrentMarket(formatMarketName(initialState.symbol));
}

// Update URL when page changes
export const setCurrentPage = (
  page: Page,
  options: { vaultId?: string } = {},
) => {
  setCurrentPageInternal(page);
  if (page !== "vaults") {
    setCurrentVaultIdInternal(undefined);
  }

  if (page === "portfolio") {
    window.history.pushState({ page }, "", "/portfolio");
  } else if (page === "vaults") {
    const nextVaultId = options.vaultId;
    setCurrentVaultIdInternal(nextVaultId);
    const nextPath = nextVaultId ? `/vaults/${nextVaultId}` : "/vaults";
    window.history.pushState({ page, vaultId: nextVaultId }, "", nextPath);
  } else if (page === "charts") {
    window.history.pushState({ page }, "", "/charts");
  } else if (page === "admin") {
    window.history.pushState({ page }, "", "/admin");
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
  } else if (state?.page === "vaults") {
    setCurrentPageInternal("vaults");
    setCurrentVaultIdInternal(state.vaultId);
  } else if (state?.page === "charts") {
    setCurrentPageInternal("charts");
  } else if (state?.page === "admin") {
    setCurrentPageInternal("admin");
  } else if (state?.page === "trade") {
    setCurrentPageInternal("trade");
    if (state.symbol) {
      const symbol = normalizeSymbol(state.symbol);
      setCurrentSymbol(symbol);
      setCurrentMarket(formatMarketName(symbol));
    }
  } else {
    // Fallback: parse current URL
    const parsed = parseUrl();
    setCurrentPageInternal(parsed.page);
    if (parsed.page === "vaults") {
      setCurrentVaultIdInternal(parsed.vaultId);
    } else {
      setCurrentVaultIdInternal(undefined);
    }
    if (parsed.symbol) {
      setCurrentSymbol(parsed.symbol);
      setCurrentMarket(formatMarketName(parsed.symbol));
    }
  }
});

// Set initial URL state (replace, don't push)
if (initialState.page === "portfolio") {
  window.history.replaceState({ page: "portfolio" }, "", "/portfolio");
} else if (initialState.page === "vaults") {
  const nextPath = initialState.vaultId
    ? `/vaults/${initialState.vaultId}`
    : "/vaults";
  window.history.replaceState(
    { page: "vaults", vaultId: initialState.vaultId },
    "",
    nextPath,
  );
} else if (initialState.page === "charts") {
  window.history.replaceState({ page: "charts" }, "", "/charts");
} else if (initialState.page === "admin") {
  window.history.replaceState({ page: "admin" }, "", "/admin");
} else {
  const symbol = currentSymbol();
  window.history.replaceState(
    { page: "trade", symbol },
    "",
    `/trade/${symbol}`,
  );
}

export { currentPage, currentVaultId };
