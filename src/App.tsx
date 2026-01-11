import { Component, Show, createSignal, onCleanup, onMount } from "solid-js";
import Header from "./components/Header";
import MarketInfo from "./components/MarketInfo";
import TradingViewChart from "./components/TradingViewChart";
import OrderBook from "./components/OrderBook";
import OrderForm from "./components/OrderForm";
import SymbolSearch from "./components/SymbolSearch";
import Portfolio from "./components/Portfolio";
import ChartsGrid from "./components/ChartsGrid";
import TradePanel from "./components/TradePanel";
import AuthModal from "./components/AuthModal";
import TransferModal from "./components/TransferModal";
import AdminDashboard from "./components/AdminDashboard";
import { useLivePrices, showOrderBook } from "./stores/market";
import { currentPage, setCurrentPage } from "./stores/page";
import {
  authReady,
  isAdmin,
  isAuthenticated,
  login,
  logout,
} from "./stores/auth";

const App: Component = () => {
  const [isTabVisible, setIsTabVisible] = createSignal(!document.hidden);

  const handleVisibilityChange = () => {
    setIsTabVisible(!document.hidden);
  };

  onMount(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  });

  onCleanup(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });

  // Start live price polling
  useLivePrices({
    enabled: () => currentPage() === "trade" && isTabVisible(),
  });

  return (
    <div class="flex h-screen w-full flex-col bg-brand-screen text-slate-200 select-none md:select-auto">
      {/* Header */}
      <Show when={currentPage() !== "charts"}>
        <Header />
      </Show>

      {/* Mobile Header */}
      <Show when={currentPage() !== "charts"}>
        <header class="flex md:hidden items-center justify-between px-3 py-2 border-b border-brand-border">
          <button onClick={() => setCurrentPage("trade")}>
            <img
              alt="XYZ"
              width="50"
              height="30"
              src="/xyz.svg"
              class="object-contain"
            />
          </button>
          <button
            class="px-3 py-1.5 text-sm font-semibold text-brand-screen bg-brand-accent rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={!authReady()}
            onClick={() => (isAuthenticated() ? logout() : login())}
          >
            {authReady()
              ? isAuthenticated()
                ? "Sign out"
                : "Connect"
              : "Checking"}
          </button>
        </header>
      </Show>

      {/* Trade View */}
      <Show when={currentPage() === "trade"}>
        {/* Market Info Bar */}
        <MarketInfo />

        {/* Main Content */}
        <div class="flex flex-1 overflow-hidden">
          {/* Chart Area */}
          <div class="flex-1 flex flex-col min-w-0 min-h-0">
            <TradingViewChart />

            {/* Bottom Panel - Positions/Orders */}
            <TradePanel />
          </div>

          {/* Order Book */}
          <Show when={showOrderBook()}>
            <div class="w-64 hidden lg:block">
              <OrderBook />
            </div>
          </Show>

          {/* Order Form */}
          <div class="w-80 hidden md:block">
            <OrderForm />
          </div>
        </div>
      </Show>

      {/* Portfolio View */}
      <Show when={currentPage() === "portfolio"}>
        <div class="flex-1 overflow-hidden">
          <Portfolio />
        </div>
      </Show>

      {/* Charts View */}
      <Show when={currentPage() === "charts"}>
        <div class="flex-1 overflow-hidden">
          <ChartsGrid />
        </div>
      </Show>

      {/* Admin View */}
      <Show when={currentPage() === "admin"}>
        <div class="flex-1 overflow-hidden">
          <AdminDashboard />
        </div>
      </Show>

      {/* Mobile Bottom Nav */}
      <Show when={currentPage() !== "charts"}>
        <nav class="flex md:hidden items-center justify-around py-2 border-t border-brand-border bg-brand-surface">
          <button
            class={`flex flex-col items-center gap-1 ${currentPage() === "trade" ? "text-brand-accent" : "text-brand-slate-400"}`}
            onClick={() => setCurrentPage("trade")}
          >
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
            >
              <path d="m3 17 2.5-8.5L12 6l6.5 2.5L21 17" />
              <path d="m3 17 9 4 9-4" />
              <path d="M12 10v12" />
            </svg>
            <span class="text-xs">Trade</span>
          </button>
          <button
            class={`flex flex-col items-center gap-1 ${currentPage() === "portfolio" ? "text-brand-accent" : "text-brand-slate-400"}`}
            onClick={() => setCurrentPage("portfolio")}
          >
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
            >
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
            <span class="text-xs">Portfolio</span>
          </button>
          <button
            class={`flex flex-col items-center gap-1 ${currentPage() === "charts" ? "text-brand-accent" : "text-brand-slate-400"}`}
            onClick={() => setCurrentPage("charts")}
          >
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
            >
              <path d="M3 3v18h18" />
              <path d="m19 9-5 5-4-4-5 5" />
            </svg>
            <span class="text-xs">Charts</span>
          </button>
          <Show when={isAdmin()}>
            <button
              class={`flex flex-col items-center gap-1 ${currentPage() === "admin" ? "text-brand-accent" : "text-brand-slate-400"}`}
              onClick={() => setCurrentPage("admin")}
            >
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
              >
                <path d="M12 3l8 4v4c0 5.55-3.84 10.74-8 12-4.16-1.26-8-6.45-8-12V7l8-4Z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              <span class="text-xs">Admin</span>
            </button>
          </Show>
        </nav>
      </Show>

      <AuthModal />
      <TransferModal />

      {/* Symbol Search Modal */}
      <SymbolSearch />
    </div>
  );
};

export default App;
