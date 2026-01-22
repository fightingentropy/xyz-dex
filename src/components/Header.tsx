import { Component, Show, createSignal } from "solid-js";
import {
  authReady,
  isAdmin,
  isAuthenticated,
  login,
  logout,
} from "../stores/auth";
import {
  dataProvider,
  setDataProvider,
  showOrderBook,
  setShowOrderBook,
} from "../stores/market";
import type { DataProvider } from "../stores/market";
import { currentPage, setCurrentPage } from "../stores/page";
import {
  isPortfolioMarginEnabled,
  togglePortfolioMargin,
} from "../stores/clob";
import { vaultsList } from "../stores/vaults";
import type { VaultSummary } from "../stores/vaults";
import { isVaultTradingAccount } from "../stores/tradingAccount";

const Header: Component = () => {
  const [profileOpen, setProfileOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [isTogglingMargin, setIsTogglingMargin] = createSignal(false);

  const handleTogglePortfolioMargin = async () => {
    if (isVaultTradingAccount()) return;
    if (isTogglingMargin()) return;
    setIsTogglingMargin(true);
    try {
      await togglePortfolioMargin(!isPortfolioMarginEnabled());
    } finally {
      setIsTogglingMargin(false);
    }
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
    setProfileOpen(false);
  };

  const toggleProfileMenu = () => {
    const next = !profileOpen();
    setProfileOpen(next);
    if (next) {
      setSettingsOpen(false);
    }
  };

  const toggleSettingsMenu = () => {
    const next = !settingsOpen();
    setSettingsOpen(next);
    if (next) {
      setProfileOpen(false);
    }
  };

  return (
    <header class="bg-brand-screen top-0 z-25 hidden items-center gap-2 px-3 py-2 sm:px-4 md:flex">
      <div class="flex items-center gap-6 pr-4 font-mono text-sm">
        <button
          onClick={() => setCurrentPage("trade")}
          class="flex items-center"
        >
          <img
            alt="XYZ"
            width="68"
            height="32"
            class="object-contain shrink-0 select-none"
            src="/xyz.svg"
          />
        </button>
        <nav class="flex items-center gap-5">
          <button
            class={
              currentPage() === "trade"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onClick={() => setCurrentPage("trade")}
          >
            <p class="truncate">Trade</p>
          </button>
          <button
            class={
              currentPage() === "options"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onClick={() => setCurrentPage("options")}
          >
            <p class="truncate">Options</p>
          </button>
          <button
            class={
              currentPage() === "portfolio"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onClick={() => setCurrentPage("portfolio")}
          >
            <p class="truncate">Portfolio</p>
          </button>
          <button
            class={
              currentPage() === "vaults"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onClick={() => setCurrentPage("vaults")}
          >
            <p class="truncate">Vaults</p>
          </button>
          <button
            class={
              currentPage() === "charts"
                ? "text-brand-accent"
                : "text-brand-slate-400 hover:text-brand-slate-100"
            }
            onClick={() => setCurrentPage("charts")}
          >
            <p class="truncate">Charts</p>
          </button>
          <Show when={isAdmin()}>
            <button
              class={
                currentPage() === "admin"
                  ? "text-brand-accent"
                  : "text-brand-slate-400 hover:text-brand-slate-100"
              }
              onClick={() => setCurrentPage("admin")}
            >
              <p class="truncate">Admin</p>
            </button>
          </Show>
        </nav>
      </div>

      <div class="flex-1" />

      <div class="flex items-center gap-2">
        <Show
          when={authReady()}
          fallback={
            <button
              class="flex items-center gap-2 px-4 py-1.5 text-sm font-semibold text-brand-screen bg-brand-accent rounded-lg opacity-60 cursor-not-allowed"
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
                class="flex items-center gap-2 px-4 py-1.5 text-sm font-semibold text-brand-screen bg-brand-accent rounded-lg hover:bg-brand-accent/80 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => login()}
              >
                Connect
              </button>
            }
          >
            <div class="relative">
              <button
                class="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-slate-100 border border-brand-border rounded-lg hover:border-brand-accent hover:text-brand-accent transition-colors"
                onClick={toggleProfileMenu}
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
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {profileOpen() && (
                <>
                  <div
                    class="fixed inset-0 z-40"
                    onClick={() => setProfileOpen(false)}
                  />
                  <div class="absolute right-0 top-full mt-2 w-56 bg-brand-surface border border-brand-border rounded-lg shadow-xl z-50 py-2">
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
                        setProfileOpen(false);
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

        {/* Settings Button */}
        <div class="relative">
          <button
            class="flex items-center justify-center w-9 h-9 text-brand-slate-400 hover:text-brand-slate-100 border border-brand-border rounded-lg bg-brand-surface transition-colors"
            onClick={toggleSettingsMenu}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>

          {/* Settings Dropdown */}
          {settingsOpen() && (
            <>
              <div
                class="fixed inset-0 z-40"
                onClick={() => setSettingsOpen(false)}
              />
              <div class="absolute right-0 top-full mt-2 w-56 bg-brand-surface border border-brand-border rounded-lg shadow-xl z-50 py-2">
                <div class="px-3 py-2 border-b border-brand-border">
                  <span class="text-xs font-medium text-brand-slate-400 uppercase tracking-wider">
                    Layout
                  </span>
                </div>

                <div
                  class="flex items-center justify-between px-3 py-2.5 hover:bg-brand-border/30 cursor-pointer transition-colors"
                  onClick={() => setShowOrderBook(!showOrderBook())}
                >
                  <span class="text-sm text-slate-200">Show Order Book</span>
                  <div
                    class={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${showOrderBook() ? "bg-brand-accent" : "bg-brand-border"}`}
                  >
                    <span
                      class={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showOrderBook() ? "translate-x-5" : "translate-x-0.5"}`}
                    />
                  </div>
                </div>

                <div class="px-3 py-2 border-t border-brand-border">
                  <span class="text-xs font-medium text-brand-slate-400 uppercase tracking-wider">
                    Margin
                  </span>
                </div>
                <div
                  class={`flex items-center justify-between px-3 py-2.5 transition-colors ${
                    isTogglingMargin() || isVaultTradingAccount()
                      ? "opacity-60 cursor-not-allowed"
                      : "hover:bg-brand-border/30 cursor-pointer"
                  }`}
                  onClick={() => {
                    if (!isTogglingMargin() && !isVaultTradingAccount()) {
                      void handleTogglePortfolioMargin();
                    }
                  }}
                >
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-slate-200">Portfolio Margin</span>
                    <Show when={isPortfolioMarginEnabled()}>
                      <span class="text-[10px] uppercase tracking-wider text-emerald-400">
                        Active
                      </span>
                    </Show>
                  </div>
                  <div
                    class={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                      isPortfolioMarginEnabled()
                        ? "bg-emerald-500"
                        : "bg-brand-border"
                    }`}
                  >
                    <span
                      class={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        isPortfolioMarginEnabled()
                          ? "translate-x-5"
                          : "translate-x-0.5"
                      }`}
                    />
                  </div>
                </div>

                <div class="px-3 py-2 border-t border-brand-border">
                  <span class="text-xs font-medium text-brand-slate-400 uppercase tracking-wider">
                    Data
                  </span>
                </div>
                <label class="flex items-center justify-between px-3 py-2.5 hover:bg-brand-border/30 cursor-pointer transition-colors">
                  <span class="text-sm text-slate-200">Provider</span>
                  <select
                    class="rounded border border-brand-border bg-brand-screen px-2 py-1 text-xs text-slate-200 focus:border-brand-accent"
                    value={dataProvider()}
                    onChange={(event) =>
                      setDataProvider(event.currentTarget.value as DataProvider)
                    }
                  >
                    <option value="hyperliquid">Hyperliquid</option>
                    <option value="lighter">Lighter</option>
                  </select>
                </label>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
