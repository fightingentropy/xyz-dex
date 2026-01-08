import {
  Component,
  createSignal,
  createMemo,
  For,
  createEffect,
  onMount,
  onCleanup,
} from "solid-js";
import {
  MARKETS,
  searchOpen,
  setSearchOpen,
  selectMarket,
} from "../stores/market";
import { formatVolume, formatPercent } from "../lib/binance";

type FilterType = "all" | "perps" | "spot" | "equities" | "watchlist";

const StarIcon: Component<{ active?: boolean }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    class={`w-4.5 h-4.5 ${props.active ? "fill-brand-accent text-brand-accent" : "fill-brand-slate-600 text-brand-slate-600"}`}
  >
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.77 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const AssetIcon: Component<{ symbol: string }> = (props) => {
  const getIconClass = () => {
    switch (props.symbol) {
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
      default:
        return "bg-slate-700 text-slate-200";
    }
  };

  const getLabel = () => {
    if (props.symbol.length <= 4) return props.symbol;
    return props.symbol.slice(0, 3);
  };

  return (
    <span
      class={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${getIconClass()}`}
    >
      {getLabel()}
    </span>
  );
};

const SymbolSearch: Component = () => {
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<FilterType>("all");
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const filteredMarkets = createMemo(() => {
    const q = query().toLowerCase();
    const f = filter();

    return MARKETS.filter((m) => {
      const matchesQuery =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.symbol.toLowerCase().includes(q);
      if (!matchesQuery) return false;

      if (f === "all") return true;
      if (f === "watchlist") return m.watchlist;
      return m.type === f;
    });
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setSearchOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filteredMarkets().length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const market = filteredMarkets()[selectedIdx()];
      if (market) {
        selectMarket(market);
      }
    }
  };

  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setSearchOpen(true);
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

  return (
    <div
      class={`symbol-search-overlay ${searchOpen() ? "is-open" : ""}`}
      onClick={(e) => e.target === e.currentTarget && setSearchOpen(false)}
    >
      <div class="w-[min(1100px,95vw)] max-h-[90vh] bg-brand-surface border border-brand-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Search Header */}
        <div class="flex items-center gap-4 px-5 py-4 border-b border-brand-border bg-gradient-to-b from-[rgba(22,26,30,0.95)] to-[rgba(22,26,30,0.6)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="text-brand-slate-500"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder={`Search ${MARKETS.length} live markets`}
            class="flex-1 bg-transparent border-0 text-lg text-slate-200 placeholder:text-brand-slate-500"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setSelectedIdx(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            class="bg-slate-800 border border-slate-700 text-brand-slate-400 rounded-lg px-2.5 py-1 text-xs tracking-wider lowercase hover:bg-slate-700"
            onClick={() => setSearchOpen(false)}
          >
            esc
          </button>
        </div>

        {/* Filter Tabs */}
        <div class="flex items-center justify-between px-5 py-2.5 border-b border-brand-border bg-[#12151a]">
          <div class="flex items-center gap-2.5 flex-wrap">
            <button
              class={`px-3 py-1.5 rounded-full text-sm flex items-center gap-2 ${filter() === "all" ? "bg-[#262a2f] border border-brand-border text-slate-200" : "text-brand-slate-400 hover:text-slate-200"}`}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              class={`px-3 py-1.5 rounded-full text-sm flex items-center gap-2 ${filter() === "watchlist" ? "bg-[#262a2f] border border-brand-border text-slate-200" : "text-brand-slate-400 hover:text-slate-200"}`}
              onClick={() => setFilter("watchlist")}
            >
              <StarIcon active />
              Watchlist
            </button>
            <button
              class={`px-3 py-1.5 rounded-full text-sm flex items-center gap-2 ${filter() === "perps" ? "bg-[#262a2f] border border-brand-border text-slate-200" : "text-brand-slate-400 hover:text-slate-200"}`}
              onClick={() => setFilter("perps")}
            >
              <span class="w-4 h-4 rounded-full bg-brand-accent text-brand-screen text-[10px] font-semibold flex items-center justify-center">
                B
              </span>
              Perps
            </button>
            <button
              class={`px-3 py-1.5 rounded-full text-sm flex items-center gap-2 ${filter() === "spot" ? "bg-[#262a2f] border border-brand-border text-slate-200" : "text-brand-slate-400 hover:text-slate-200"}`}
              onClick={() => setFilter("spot")}
            >
              Spot
            </button>
            <button
              class={`px-3 py-1.5 rounded-full text-sm flex items-center gap-2 ${filter() === "equities" ? "bg-[#262a2f] border border-brand-border text-slate-200" : "text-brand-slate-400 hover:text-slate-200"}`}
              onClick={() => setFilter("equities")}
            >
              <span class="text-brand-accent font-semibold text-xs">[</span>
              Equities
              <span class="text-brand-accent font-semibold text-xs">]</span>
            </button>
          </div>
        </div>

        {/* Table Header */}
        <div class="grid grid-cols-[minmax(320px,2.4fr)_1.1fr_0.9fr_0.9fr_0.9fr_0.4fr] gap-3 px-5 py-3 text-[11px] uppercase tracking-widest text-brand-slate-500 border-b border-brand-border min-w-[860px]">
          <div>Market</div>
          <div>Change</div>
          <div>Volume</div>
          <div>Open Interest</div>
          <div>Funding</div>
          <div></div>
        </div>

        {/* Market Rows */}
        <div class="overflow-auto flex-1">
          <For each={filteredMarkets()}>
            {(market, idx) => (
              <button
                type="button"
                class={`grid grid-cols-[minmax(320px,2.4fr)_1.1fr_0.9fr_0.9fr_0.9fr_0.4fr] gap-3 items-center px-5 py-3 text-sm text-slate-200 w-full text-left cursor-pointer min-w-[860px] border-b border-brand-border ${idx() === selectedIdx() ? "bg-[#1e2227] shadow-[inset_0_0_0_1px_#2e3338]" : "bg-[rgba(22,26,30,0.6)] hover:bg-[#1a1e22]"}`}
                onClick={() => selectMarket(market)}
              >
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2.5 flex-wrap">
                    <AssetIcon symbol={market.symbol} />
                    <span class="font-semibold text-slate-50">
                      {market.name}
                    </span>
                    <span class="bg-slate-800 text-slate-300 rounded-full px-2 py-0.5 text-[11px] border border-slate-700">
                      {market.leverage}
                    </span>
                    {market.type === "equities" && (
                      <span class="bg-[rgba(80,227,171,0.15)] text-brand-accent rounded-full px-2 py-0.5 text-[11px] border border-[rgba(80,227,171,0.35)]">
                        xyz
                      </span>
                    )}
                  </div>
                  <div class="text-brand-slate-400 text-xs">{market.price}</div>
                </div>
                <div
                  class={
                    market.change24h >= 0
                      ? "text-brand-green-400"
                      : "text-brand-red-400"
                  }
                >
                  {formatPercent(market.change24h)}
                </div>
                <div>{formatVolume(market.volume24h)}</div>
                <div>{formatVolume(market.openInterest)}</div>
                <div
                  class={
                    market.funding >= 0
                      ? "text-brand-green-400"
                      : "text-brand-red-400"
                  }
                >
                  {formatPercent(market.funding)}
                </div>
                <span class="flex items-center justify-center">
                  <StarIcon active={market.watchlist} />
                </span>
              </button>
            )}
          </For>
        </div>

        {/* Footer */}
        <div class="flex justify-between items-center px-5 py-3 border-t border-brand-border text-brand-slate-400 text-xs bg-brand-surface">
          <div class="flex flex-wrap gap-3">
            <div class="flex items-center gap-1.5">
              <span class="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-300 font-mono">
                ↑↓
              </span>
              Navigate
            </div>
            <div class="flex items-center gap-1.5">
              <span class="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-300 font-mono">
                Enter
              </span>
              Select
            </div>
            <div class="flex items-center gap-1.5">
              <span class="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-300 font-mono">
                ⌘+K
              </span>
              Search
            </div>
          </div>
          <div class="text-brand-slate-500">
            <span class="text-slate-200">{filteredMarkets().length}</span>{" "}
            markets
          </div>
        </div>
      </div>
    </div>
  );
};

export default SymbolSearch;
