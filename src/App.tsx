import {
  Component,
  Show,
  Suspense,
  createSignal,
  lazy,
  onCleanup,
  onMount,
} from "solid-js";
import Header from "./components/Header";
import MarketInfo from "./components/MarketInfo";
import TradingViewChart from "./components/TradingViewChart";
import OrderBook from "./components/OrderBook";
import OrderForm from "./components/OrderForm";
import SymbolSearch from "./components/SymbolSearch";
import TradePanel from "./components/TradePanel";
import AuthModal from "./components/AuthModal";
import TransferModal from "./components/TransferModal";
import OptionsTrade from "./components/OptionsTrade";
import { useLivePrices, showOrderBook } from "./stores/market";
import { currentPage, setCurrentPage } from "./stores/page";
import { vaultsList } from "./stores/vaults";
import type { VaultSummary } from "./stores/vaults";
import {
  authReady,
  isAdmin,
  isAuthenticated,
  login,
  logout,
} from "./stores/auth";

const Portfolio = lazy(() => import("./components/Portfolio"));
const ChartsGrid = lazy(() => import("./components/ChartsGrid"));
const AdminDashboard = lazy(() => import("./components/AdminDashboard"));
const Vaults = lazy(() => import("./components/Vaults"));

const App: Component = () => {
  const [isTabVisible, setIsTabVisible] = createSignal(!document.hidden);
  const [mobileProfileOpen, setMobileProfileOpen] = createSignal(false);

  const handleVisibilityChange = () => {
    setIsTabVisible(!document.hidden);
  };

  const handleMyVaultClick = () => {
    const operatorVault = vaultsList().find(
      (vault: VaultSummary) => vault.isOperator,
    );
    if (operatorVault) {
      setCurrentPage("vaults", { vaultId: operatorVault._id });
    } else {
      setCurrentPage("vaults");
    }
    setMobileProfileOpen(false);
  };

  onMount(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const preloadTimeout = window.setTimeout(() => {
      void Portfolio.preload();
      void Vaults.preload();
    }, 600);
    onCleanup(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimeout(preloadTimeout);
    });
  });

  // Start live price polling
  useLivePrices({
    enabled: () =>
      (currentPage() === "trade" || currentPage() === "options") &&
      isTabVisible(),
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
          <Show
            when={authReady()}
            fallback={
              <button
                class="px-3 py-1.5 text-sm font-semibold text-brand-screen bg-brand-accent rounded-lg opacity-60 cursor-not-allowed"
                disabled
              >
                Checking
              </button>
            }
          >
            <Show
              when={isAuthenticated()}
              fallback={
                <button
                  class="px-3 py-1.5 text-sm font-semibold text-brand-screen bg-brand-accent rounded-lg hover:bg-brand-accent/80"
                  onClick={() => login()}
                >
                  Connect
                </button>
              }
            >
              <div class="relative">
                <button
                  class="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-slate-100 border border-brand-border rounded-lg hover:border-brand-accent hover:text-brand-accent transition-colors"
                  onClick={() => setMobileProfileOpen(!mobileProfileOpen())}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span>Profile</span>
                </button>

                {mobileProfileOpen() && (
                  <>
                    <div
                      class="fixed inset-0 z-40"
                      onClick={() => setMobileProfileOpen(false)}
                    />
                    <div class="absolute right-0 top-full mt-2 w-48 bg-brand-surface border border-brand-border rounded-lg shadow-xl z-50 py-2">
                      <button
                        class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-200 hover:bg-brand-border/30 transition-colors"
                        onClick={handleMyVaultClick}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <rect x="3" y="4" width="18" height="16" rx="2" />
                          <path d="M7 12h10" />
                          <path d="M9 8h6" />
                          <path d="M9 16h6" />
                        </svg>
                        <span>My Vault</span>
                      </button>
                      <div class="border-t border-brand-border my-1" />
                      <button
                        class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-brand-red-400 hover:bg-brand-border/30 transition-colors"
                        onClick={() => {
                          setMobileProfileOpen(false);
                          logout();
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        <span>Sign out</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </Show>
          </Show>
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

      {/* Options View */}
      <Show when={currentPage() === "options"}>
        <div class="flex-1 overflow-hidden">
          <OptionsTrade />
        </div>
      </Show>

      {/* Portfolio View */}
      <Show when={currentPage() === "portfolio"}>
        <div class="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div class="h-full w-full flex items-center justify-center text-brand-slate-400">
                Loading...
              </div>
            }
          >
            <Portfolio />
          </Suspense>
        </div>
      </Show>

      {/* Vaults View */}
      <Show when={currentPage() === "vaults"}>
        <div class="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div class="h-full w-full flex items-center justify-center text-brand-slate-400">
                Loading...
              </div>
            }
          >
            <Vaults />
          </Suspense>
        </div>
      </Show>

      {/* Charts View */}
      <Show when={currentPage() === "charts"}>
        <div class="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div class="h-full w-full flex items-center justify-center text-brand-slate-400">
                Loading...
              </div>
            }
          >
            <ChartsGrid />
          </Suspense>
        </div>
      </Show>

      {/* Admin View */}
      <Show when={currentPage() === "admin"}>
        <div class="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div class="h-full w-full flex items-center justify-center text-brand-slate-400">
                Loading...
              </div>
            }
          >
            <AdminDashboard />
          </Suspense>
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
            class={`flex flex-col items-center gap-1 ${currentPage() === "options" ? "text-brand-accent" : "text-brand-slate-400"}`}
            onClick={() => setCurrentPage("options")}
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
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M7 9h10" />
              <path d="M7 13h5" />
              <path d="M7 17h8" />
            </svg>
            <span class="text-xs">Options</span>
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
            class={`flex flex-col items-center gap-1 ${currentPage() === "vaults" ? "text-brand-accent" : "text-brand-slate-400"}`}
            onClick={() => setCurrentPage("vaults")}
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
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M7 12h10" />
              <path d="M9 8h6" />
              <path d="M9 16h6" />
            </svg>
            <span class="text-xs">Vaults</span>
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
