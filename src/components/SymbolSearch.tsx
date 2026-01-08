import {
  Component,
  createSignal,
  createMemo,
  For,
  createEffect,
  onMount,
  onCleanup,
  Show,
} from "solid-js";
import {
  MARKETS,
  searchOpen,
  setSearchOpen,
  selectMarket,
  toggleWatchlist,
  marketsLoading,
} from "../stores/market";
import { formatVolume, formatPercent } from "../lib/hyperliquid";

type FilterType = "all" | "perps-xyz" | "perps-hl" | "spot" | "watchlist";
type SortColumn = "volume" | "openInterest" | "funding" | "change";
type SortDirection = "asc" | "desc";

const SearchIcon: Component<{ class?: string }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class ?? "w-4 h-4"}
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const StarIcon: Component<{ active?: boolean }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    class={`w-4 h-4 transition-all duration-200 ${
      props.active
        ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.5)]"
        : "fill-transparent text-slate-600 stroke-current stroke-[1.5] hover:text-slate-400"
    }`}
  >
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.77 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const ChevronDownIcon: Component<{ class?: string }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class ?? "w-3 h-3"}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const TrendingUpIcon: Component<{ class?: string }> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class={props.class ?? "w-3.5 h-3.5"}>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

const TrendingDownIcon: Component<{ class?: string }> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class={props.class ?? "w-3.5 h-3.5"}>
    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
    <polyline points="17 18 23 18 23 12" />
  </svg>
);

const getIconGradient = (symbol: string): string => {
  switch (symbol) {
    case "BTC":
      return "from-amber-500 to-orange-600";
    case "ETH":
      return "from-slate-400 to-indigo-500";
    case "SOL":
      return "from-emerald-400 to-fuchsia-500";
    case "HYPE":
      return "from-emerald-400 to-cyan-400";
    case "BNB":
      return "from-amber-400 to-yellow-500";
    case "XRP":
      return "from-slate-400 to-slate-600";
    case "ADA":
      return "from-indigo-400 to-blue-600";
    case "DOGE":
      return "from-yellow-300 to-amber-500";
    case "LINK":
      return "from-sky-400 to-blue-600";
    case "DOT":
      return "from-pink-400 to-fuchsia-600";
    case "LTC":
      return "from-slate-300 to-slate-500";
    case "AVAX":
      return "from-red-400 to-rose-600";
    case "ZEC":
      return "from-amber-300 to-yellow-500";
    case "FARTCOIN":
      return "from-emerald-600 to-teal-700";
    case "XYZ100":
      return "from-sky-500 to-indigo-600";
    default:
      return "from-slate-600 to-slate-700";
  }
};

const getIconLabel = (symbol: string): string => {
  if (symbol === "XYZ100") return "100";
  if (symbol === "BTC") return "₿";
  if (symbol === "ETH") return "◆";
  if (symbol === "ZEC") return "Ⓩ";
  if (symbol === "XRP") return "✕";
  if (symbol.length <= 3) return symbol;
  return symbol.slice(0, 3);
};

const SymbolSearch: Component = () => {
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<FilterType>("all");
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [sortColumn, setSortColumn] = createSignal<SortColumn>("volume");
  const [sortDirection, setSortDirection] = createSignal<SortDirection>("desc");
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  const ALLOWED_SYMBOLS = ["BTC", "ETH", "SOL", "HYPE", "ZEC"];

  const filteredMarkets = createMemo(() => {
    const q = query().toLowerCase();
    const f = filter();
    const allMarkets = MARKETS();

    let results = allMarkets.filter((m) => {
      // Only show allowed symbols
      if (!ALLOWED_SYMBOLS.includes(m.symbol)) return false;

      const matchesQuery =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.symbol.toLowerCase().includes(q);
      if (!matchesQuery) return false;

      if (f === "all") return true;
      if (f === "watchlist") return m.watchlist;
      if (f === "perps-xyz") return m.type === "equities";
      if (f === "perps-hl") return m.type === "perps";
      if (f === "spot") return m.type === "spot";
      return true;
    });

    // Sort results
    const col = sortColumn();
    const dir = sortDirection();
    results = [...results].sort((a, b) => {
      let aVal: number, bVal: number;
      switch (col) {
        case "volume":
          aVal = a.volume24h;
          bVal = b.volume24h;
          break;
        case "openInterest":
          aVal = a.openInterest;
          bVal = b.openInterest;
          break;
        case "funding":
          aVal = a.funding;
          bVal = b.funding;
          break;
        case "change":
          aVal = a.change24h;
          bVal = b.change24h;
          break;
        default:
          aVal = a.volume24h;
          bVal = b.volume24h;
      }
      return dir === "desc" ? bVal - aVal : aVal - bVal;
    });

    return results;
  });

  const handleSort = (column: SortColumn) => {
    if (sortColumn() === column) {
      setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const scrollToSelected = () => {
    if (!listRef) return;
    const row = listRef.querySelector(`[data-idx="${selectedIdx()}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setSearchOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filteredMarkets().length - 1));
      requestAnimationFrame(scrollToSelected);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      requestAnimationFrame(scrollToSelected);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const market = filteredMarkets()[selectedIdx()];
      if (market) {
        selectMarket(market);
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(0);
      requestAnimationFrame(scrollToSelected);
    } else if ((e.metaKey || e.ctrlKey) && e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(filteredMarkets().length - 1);
      requestAnimationFrame(scrollToSelected);
    } else if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      setFilter("watchlist");
    }
  };

  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setSearchOpen(true);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "f" && searchOpen()) {
      e.preventDefault();
      inputRef?.focus();
      inputRef?.select();
    }
    if (searchOpen() && e.key === "Escape") {
      setSearchOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleGlobalKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleGlobalKeyDown);
  });

  // Focus input when modal opens
  createEffect(() => {
    if (!searchOpen()) return;
    requestAnimationFrame(() => {
      inputRef?.focus();
      inputRef?.select();
    });
  });

  // Format price change with absolute value
  const formatPriceChange = (market: ReturnType<typeof MARKETS>[0]) => {
    const price = parseFloat(market.price.replace(/,/g, ""));
    const changePercent = market.change24h;
    const priceChange = (price * changePercent) / 100;

    const absChange = Math.abs(priceChange);
    let absFormatted: string;
    if (absChange >= 1000) {
      absFormatted = absChange.toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
    } else if (absChange >= 1) {
      absFormatted = absChange.toFixed(2);
    } else if (absChange >= 0.01) {
      absFormatted = absChange.toFixed(4);
    } else {
      absFormatted = absChange.toFixed(6);
    }

    const sign = priceChange >= 0 ? "+" : "-";
    return { sign, absFormatted, percent: formatPercent(changePercent) };
  };

  const filterTabs = [
    { id: "all" as FilterType, label: "All" },
    { id: "perps-xyz" as FilterType, label: "Perps", badge: "XYZ" },
    { id: "perps-hl" as FilterType, label: "Perps", icon: "/hyperliquid.svg" },
    { id: "spot" as FilterType, label: "Spot" },
    { id: "watchlist" as FilterType, label: "Watchlist", emoji: "⭐" },
  ];

  return (
    <div
      class={`symbol-search-overlay ${searchOpen() ? "is-open" : ""}`}
      onClick={(e) => e.target === e.currentTarget && setSearchOpen(false)}
    >
      <div class="symbol-search-modal">
        {/* Search Header */}
        <div class="search-header">
          <div class="search-input-wrapper">
            <SearchIcon class="search-icon" />
            <input
              ref={inputRef}
              type="text"
              placeholder={`Search ${MARKETS().length} markets...`}
              class="search-input"
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setSelectedIdx(0);
              }}
              onKeyDown={handleKeyDown}
            />
            <div class="search-shortcut">
              <kbd>esc</kbd>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div class="filter-section">
          <div class="filter-tabs">
            <For each={filterTabs}>
              {(tab) => (
                <button
                  class={`filter-tab ${filter() === tab.id ? "active" : ""}`}
                  onClick={() => setFilter(tab.id)}
                >
                  {tab.emoji && <span class="tab-emoji">{tab.emoji}</span>}
                  <span>{tab.label}</span>
                  {tab.badge && <span class="tab-badge">{tab.badge}</span>}
                  {tab.icon && <img src={tab.icon} alt="" class="tab-icon" />}
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Table Header */}
        <div class="table-header">
          <div class="th-cell th-market">Market</div>
          <button
            class={`th-cell th-sortable ${sortColumn() === "change" ? "active" : ""}`}
            onClick={() => handleSort("change")}
          >
            <span>24h Change</span>
            <Show when={sortColumn() === "change"}>
              <ChevronDownIcon
                class={`th-sort-icon ${sortDirection() === "asc" ? "asc" : ""}`}
              />
            </Show>
          </button>
          <button
            class={`th-cell th-sortable ${sortColumn() === "volume" ? "active" : ""}`}
            onClick={() => handleSort("volume")}
          >
            <span>Volume</span>
            <Show when={sortColumn() === "volume"}>
              <ChevronDownIcon
                class={`th-sort-icon ${sortDirection() === "asc" ? "asc" : ""}`}
              />
            </Show>
          </button>
          <button
            class={`th-cell th-sortable ${sortColumn() === "openInterest" ? "active" : ""}`}
            onClick={() => handleSort("openInterest")}
          >
            <span>Open Interest</span>
            <Show when={sortColumn() === "openInterest"}>
              <ChevronDownIcon
                class={`th-sort-icon ${sortDirection() === "asc" ? "asc" : ""}`}
              />
            </Show>
          </button>
          <button
            class={`th-cell th-sortable ${sortColumn() === "funding" ? "active" : ""}`}
            onClick={() => handleSort("funding")}
          >
            <span>Funding</span>
            <Show when={sortColumn() === "funding"}>
              <ChevronDownIcon
                class={`th-sort-icon ${sortDirection() === "asc" ? "asc" : ""}`}
              />
            </Show>
          </button>
          <div class="th-cell th-action"></div>
        </div>

        {/* Market Rows */}
        <div ref={listRef} class="market-list">
          <Show when={marketsLoading()}>
            <div class="loading-state">
              <div class="loading-spinner" />
              <span>Loading markets...</span>
            </div>
          </Show>
          <For each={filteredMarkets()}>
            {(market, idx) => {
              const change = formatPriceChange(market);
              const isPositive = market.change24h >= 0;

              return (
                <button
                  type="button"
                  data-idx={idx()}
                  class={`market-row ${idx() === selectedIdx() ? "selected" : ""}`}
                  onClick={() => selectMarket(market)}
                >
                  <div class="market-info">
                    <Show
                      when={["BTC", "ETH", "HYPE", "SOL", "ZEC"].includes(market.symbol)}
                      fallback={
                        <div class={`market-icon bg-gradient-to-br ${getIconGradient(market.symbol)}`}>
                          <span>{getIconLabel(market.symbol)}</span>
                        </div>
                      }
                    >
                      <div class="market-icon">
                        <img src={`/${market.symbol.toLowerCase()}.svg`} alt={market.symbol} class="coin-logo" />
                      </div>
                    </Show>
                    <div class="market-details">
                      <div class="market-name-row">
                        <span class="market-name">
                          {market.type === "equities"
                            ? `[${market.name}]`
                            : market.name}
                        </span>
                        <span class="leverage-badge">{market.type === "spot" ? "Spot" : market.leverage}</span>
                        {market.type === "equities" && (
                          <span class="xyz-badge">XYZ</span>
                        )}
                      </div>
                      <span class="market-price">${market.price}</span>
                    </div>
                  </div>

                  <div class={`change-cell ${isPositive ? "positive" : "negative"}`}>
                    <div class="change-indicator">
                      {isPositive ? (
                        <TrendingUpIcon class="trend-icon" />
                      ) : (
                        <TrendingDownIcon class="trend-icon" />
                      )}
                    </div>
                    <div class="change-values">
                      <span class="change-absolute">
                        {change.sign}${change.absFormatted}
                      </span>
                      <span class="change-percent">{change.percent}</span>
                    </div>
                  </div>

                  <div class="volume-cell">
                    <span class="volume-value">{formatVolume(market.volume24h)}</span>
                  </div>

                  <div class="oi-cell">
                    <span class="oi-value">
                      {market.type === "spot" ? "--" : formatVolume(market.openInterest)}
                    </span>
                  </div>

                  <div class={`funding-cell ${market.type === "spot" ? "" : market.funding >= 0 ? "positive" : "negative"}`}>
                    <span class="funding-value">
                      {market.type === "spot" ? "--" : formatPercent(market.funding)}
                    </span>
                  </div>

                  <div
                    class="star-cell"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWatchlist(market.symbol);
                    }}
                  >
                    <StarIcon active={market.watchlist} />
                  </div>
                </button>
              );
            }}
          </For>
        </div>

        {/* Footer */}
        <div class="search-footer">
          <div class="shortcuts">
            <div class="shortcut-group">
              <kbd>↑</kbd>
              <kbd>↓</kbd>
              <span>Navigate</span>
            </div>
            <div class="shortcut-group">
              <kbd>↵</kbd>
              <span>Select</span>
            </div>
            <div class="shortcut-group">
              <kbd>⌘</kbd>
              <kbd>F</kbd>
              <span>Search</span>
            </div>
            <div class="shortcut-group">
              <kbd>⌘</kbd>
              <kbd>S</kbd>
              <span>Watchlist</span>
            </div>
          </div>
          <div class="market-count">
            <span class="count-number">{filteredMarkets().length}</span>
            <span class="count-label">markets</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SymbolSearch;
