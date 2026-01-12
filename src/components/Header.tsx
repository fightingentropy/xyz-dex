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

const Header: Component = () => {
  const [settingsOpen, setSettingsOpen] = createSignal(false);

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
            class="object-contain flex-shrink-0 select-none"
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
        <button
          class="flex items-center gap-2 px-4 py-1.5 text-sm font-semibold text-brand-screen bg-brand-accent rounded-lg hover:bg-brand-accent/80 disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={!authReady()}
          onClick={() => (isAuthenticated() ? logout() : login())}
        >
          {authReady()
            ? isAuthenticated()
              ? "Sign out"
              : "Connect"
            : "Checking"}
        </button>

        {/* Settings Button */}
        <div class="relative">
          <button
            class="flex items-center justify-center w-9 h-9 text-brand-slate-400 hover:text-brand-slate-100 border border-brand-border rounded-lg bg-brand-surface transition-colors"
            onClick={() => setSettingsOpen(!settingsOpen())}
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

                <label class="flex items-center justify-between px-3 py-2.5 hover:bg-brand-border/30 cursor-pointer transition-colors">
                  <span class="text-sm text-slate-200">Show Order Book</span>
                  <button
                    class={`relative w-10 h-5 rounded-full transition-colors ${showOrderBook() ? "bg-brand-accent" : "bg-brand-border"}`}
                    onClick={() => setShowOrderBook(!showOrderBook())}
                  >
                    <span
                      class={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showOrderBook() ? "translate-x-5" : "translate-x-0.5"}`}
                    />
                  </button>
                </label>

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
                    <option value="binance">Binance</option>
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
