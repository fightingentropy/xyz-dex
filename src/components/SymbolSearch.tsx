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

const StarIcon: Component<{ active?: boolean }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    class={`w-3.5 h-3.5 ${props.active ? "fill-amber-400 text-amber-400" : "fill-transparent text-brand-slate-600 stroke-current stroke-2"}`}
  >
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.77 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const ChevronDownIcon: Component<{ class?: string }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class ?? "w-3 h-3"}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const getIconClass = (symbol: string): string => {
  switch (symbol) {
    case "BTC":
      return "bg-amber-500 text-brand-screen";
    case "ETH":
      return "bg-slate-400 text-brand-screen";
    case "SOL":
      return "bg-gradient-to-br from-emerald-400 to-fuchsia-500 text-brand-screen";
    case "HYPE":
      return "bg-brand-screen text-emerald-300 border border-brand-border";
    case "BNB":
      return "bg-amber-400 text-brand-screen";
    case "XRP":
      return "bg-slate-500 text-brand-screen";
    case "ADA":
      return "bg-indigo-400 text-brand-screen";
    case "DOGE":
      return "bg-yellow-300 text-brand-screen";
    case "LINK":
      return "bg-sky-400 text-brand-screen";
    case "DOT":
      return "bg-pink-400 text-brand-screen";
    case "LTC":
      return "bg-slate-300 text-brand-screen";
    case "AVAX":
      return "bg-red-400 text-brand-screen";
    case "ZEC":
      return "bg-amber-300 text-brand-screen";
    case "FARTCOIN":
      return "bg-slate-700 text-slate-200";
    case "XYZ100":
      return "bg-sky-600 text-white";
    default:
      return "bg-slate-700 text-slate-200";
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
  const [strictMode, setStrictMode] = createSignal(true);
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [sortColumn, setSortColumn] = createSignal<SortColumn>("volume");
  const [sortDirection, setSortDirection] = createSignal<SortDirection>("desc");
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  const filteredMarkets = createMemo(() => {
    const q = query().toLowerCase();
    const f = filter();
    const allMarkets = MARKETS();

    let results = allMarkets.filter((m) => {
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
      absFormatted = absChange.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    } else if (absChange >= 1) {
      absFormatted = absChange.toFixed(2);
    } else if (absChange >= 0.01) {
      absFormatted = absChange.toFixed(4);
    } else {
      absFormatted = absChange.toFixed(6);
    }
    
    const sign = priceChange >= 0 ? "+" : "-";
    return `${sign}${absFormatted} / ${formatPercent(changePercent)}`;
  };

  return (
    <div
      class={`symbol-search-overlay ${searchOpen() ? "is-open" : ""}`}
      onClick={(e) => e.target === e.currentTarget && setSearchOpen(false)}
    >
      <div class="w-[min(920px,95vw)] max-h-[75vh] bg-[#0d1014] border border-brand-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Search Header */}
        <div class="flex items-center gap-2 px-3 py-2.5 border-b border-brand-border">
          <input
            ref={inputRef}
            type="text"
            placeholder={`Search ${MARKETS().length} live markets`}
            class="flex-1 bg-transparent border-0 text-sm text-slate-300 placeholder:text-brand-slate-500 font-normal"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setSelectedIdx(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            class="bg-slate-800 border border-slate-700 text-brand-slate-400 rounded px-1.5 py-0.5 text-[10px] hover:bg-slate-700"
            onClick={() => setSearchOpen(false)}
          >
            esc
          </button>
        </div>

        {/* Filter Tabs */}
        <div class="flex items-center justify-between px-3 py-2 border-b border-brand-border bg-[#0d1014]">
          <div class="flex items-center gap-0.5">
            <button
              class={`px-2.5 py-1 rounded text-xs transition-colors ${
                filter() === "all"
                  ? "bg-[#1a1e24] text-white"
                  : "text-brand-slate-400 hover:text-slate-200 hover:bg-[#13161b]"
              }`}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              class={`px-2.5 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                filter() === "perps-xyz"
                  ? "bg-[#1a1e24] text-white"
                  : "text-brand-slate-400 hover:text-slate-200 hover:bg-[#13161b]"
              }`}
              onClick={() => setFilter("perps-xyz")}
            >
              Perps
              <span class="text-amber-400 font-medium">[XYZ]</span>
            </button>
            <button
              class={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-colors ${
                filter() === "perps-hl"
                  ? "bg-[#1a1e24] text-white"
                  : "text-brand-slate-400 hover:text-slate-200 hover:bg-[#13161b]"
              }`}
              onClick={() => setFilter("perps-hl")}
            >
              Perps
              <img src="/hyperliquid.svg" alt="" class="w-4 h-4" />
            </button>
            <button
              class={`px-2.5 py-1 rounded text-xs transition-colors ${
                filter() === "spot"
                  ? "bg-[#1a1e24] text-white"
                  : "text-brand-slate-400 hover:text-slate-200 hover:bg-[#13161b]"
              }`}
              onClick={() => setFilter("spot")}
            >
              Spot
            </button>
            <button
              class={`px-2.5 py-1 rounded text-xs transition-colors ${
                filter() === "watchlist"
                  ? "bg-[#1a1e24] text-white"
                  : "text-brand-slate-400 hover:text-slate-200 hover:bg-[#13161b]"
              }`}
              onClick={() => setFilter("watchlist")}
            >
              Watchlist
            </button>
          </div>

          {/* Strict / All Toggle */}
          <div class="flex items-center bg-[#1a1e24] rounded p-0.5">
            <button
              class={`px-2 py-1 rounded text-xs transition-colors ${
                strictMode()
                  ? "bg-brand-accent text-brand-screen font-medium"
                  : "text-brand-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setStrictMode(true)}
            >
              Strict
            </button>
            <button
              class={`px-2 py-1 rounded text-xs transition-colors ${
                !strictMode()
                  ? "bg-brand-accent text-brand-screen font-medium"
                  : "text-brand-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setStrictMode(false)}
            >
              All
            </button>
          </div>
        </div>

        {/* Table Header */}
        <div class="grid grid-cols-[minmax(180px,1.8fr)_1.1fr_0.9fr_0.9fr_0.7fr_0.25fr] gap-2 px-3 py-2 text-[10px] text-brand-slate-500 border-b border-brand-border min-w-[680px]">
          <div>Market</div>
          <button
            class="flex items-center gap-1 hover:text-slate-300 transition-colors text-left"
            onClick={() => handleSort("change")}
          >
            Price Change
            <Show when={sortColumn() === "change"}>
              <ChevronDownIcon
                class={`w-2.5 h-2.5 transition-transform ${sortDirection() === "asc" ? "rotate-180" : ""}`}
              />
            </Show>
          </button>
          <button
            class="flex items-center gap-1 hover:text-slate-300 transition-colors text-left"
            onClick={() => handleSort("volume")}
          >
            Volume
            <Show when={sortColumn() === "volume"}>
              <ChevronDownIcon
                class={`w-2.5 h-2.5 transition-transform ${sortDirection() === "asc" ? "rotate-180" : ""}`}
              />
            </Show>
          </button>
          <button
            class="flex items-center gap-1 hover:text-slate-300 transition-colors text-left"
            onClick={() => handleSort("openInterest")}
          >
            Open Interest
            <Show when={sortColumn() === "openInterest"}>
              <ChevronDownIcon
                class={`w-2.5 h-2.5 transition-transform ${sortDirection() === "asc" ? "rotate-180" : ""}`}
              />
            </Show>
          </button>
          <button
            class="flex items-center gap-1 hover:text-slate-300 transition-colors text-left"
            onClick={() => handleSort("funding")}
          >
            Funding
            <Show when={sortColumn() === "funding"}>
              <ChevronDownIcon
                class={`w-2.5 h-2.5 transition-transform ${sortDirection() === "asc" ? "rotate-180" : ""}`}
              />
            </Show>
          </button>
          <div></div>
        </div>

        {/* Market Rows */}
        <div ref={listRef} class="overflow-auto flex-1">
          <Show when={marketsLoading()}>
            <div class="flex items-center justify-center py-12 text-brand-slate-400 text-sm">
              <svg class="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Loading markets...
            </div>
          </Show>
          <For each={filteredMarkets()}>
            {(market, idx) => (
              <button
                type="button"
                data-idx={idx()}
                class={`grid grid-cols-[minmax(180px,1.8fr)_1.1fr_0.9fr_0.9fr_0.7fr_0.25fr] gap-2 items-center px-3 py-2 text-xs text-slate-200 w-full text-left cursor-pointer min-w-[680px] border-b border-brand-border/50 transition-colors ${
                  idx() === selectedIdx()
                    ? "bg-[#171b20]"
                    : "bg-[#0d1014] hover:bg-[#13161b]"
                }`}
                onClick={() => selectMarket(market)}
              >
                <div class="flex flex-col gap-0">
                  <div class="flex items-center gap-2">
                    <span
                      class={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${getIconClass(market.symbol)}`}
                    >
                      {getIconLabel(market.symbol)}
                    </span>
                    <span class="font-medium text-slate-100 text-xs">
                      {market.type === "equities" ? `[${market.name}]` : market.name}
                    </span>
                    <span class="bg-[#1e2328] text-slate-400 rounded px-1 py-0.5 text-[9px]">
                      {market.leverage}
                    </span>
                    {market.type === "equities" && (
                      <span class="bg-[rgba(80,227,171,0.15)] text-brand-accent rounded px-1 py-0.5 text-[9px]">
                        xyz
                      </span>
                    )}
                  </div>
                  <div class="text-brand-slate-500 text-[10px] ml-7">
                    {market.price}
                  </div>
                </div>
                <div
                  class={`font-mono text-xs ${
                    market.change24h >= 0
                      ? "text-brand-green-400"
                      : "text-brand-red-400"
                  }`}
                >
                  {formatPriceChange(market)}
                </div>
                <div class="text-slate-300 text-xs">{formatVolume(market.volume24h)}</div>
                <div class="text-slate-300 text-xs">{formatVolume(market.openInterest)}</div>
                <div
                  class={`text-xs ${
                    market.funding >= 0
                      ? "text-brand-green-400"
                      : "text-brand-red-400"
                  }`}
                >
                  {formatPercent(market.funding)}
                </div>
                <span
                  class="flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWatchlist(market.symbol);
                  }}
                >
                  <StarIcon active={market.watchlist} />
                </span>
              </button>
            )}
          </For>
        </div>

        {/* Footer */}
        <div class="flex justify-between items-center px-3 py-2 border-t border-brand-border text-brand-slate-500 text-[10px] bg-[#0d1014]">
          <div class="flex flex-wrap gap-3">
            <div class="flex items-center gap-1">
              <span class="flex items-center gap-0.5">
                <span class="bg-[#1e2328] border border-[#2a2f36] rounded px-1 py-0.5 text-[9px] text-slate-400">
                  ↑
                </span>
                <span class="bg-[#1e2328] border border-[#2a2f36] rounded px-1 py-0.5 text-[9px] text-slate-400">
                  ↓
                </span>
              </span>
              <span>Navigate</span>
            </div>
            <div class="flex items-center gap-1">
              <span class="bg-[#1e2328] border border-[#2a2f36] rounded px-1 py-0.5 text-[9px] text-slate-400">
                ↵
              </span>
              <span>Select</span>
            </div>
            <div class="flex items-center gap-1">
              <span class="bg-[#1e2328] border border-[#2a2f36] rounded px-1 py-0.5 text-[9px] text-slate-400">
                ⌘F
              </span>
              <span>Search</span>
            </div>
            <div class="flex items-center gap-1">
              <span class="bg-[#1e2328] border border-[#2a2f36] rounded px-1 py-0.5 text-[9px] text-slate-400">
                ⌘S
              </span>
              <span>Watchlist</span>
            </div>
            <div class="flex items-center gap-1">
              <span class="bg-[#1e2328] border border-[#2a2f36] rounded px-1 py-0.5 text-[9px] text-slate-400">
                ⌘↑
              </span>
              <span>Top</span>
            </div>
            <div class="flex items-center gap-1">
              <span class="bg-[#1e2328] border border-[#2a2f36] rounded px-1 py-0.5 text-[9px] text-slate-400">
                ⌘↓
              </span>
              <span>Bottom</span>
            </div>
          </div>
          <div class="text-brand-slate-500">
            {filteredMarkets().length} markets
          </div>
        </div>
      </div>
    </div>
  );
};

export default SymbolSearch;
