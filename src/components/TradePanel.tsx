import { Component, Show, createMemo, createSignal, onCleanup } from "solid-js";
import BalancesPanel from "./BalancesPanel";
import OpenOrdersTable from "./OpenOrdersTable";
import PositionsTable from "./PositionsTable";
import TradeHistoryTable from "./TradeHistoryTable";
import { openOrders, positions } from "../stores/clob";

type TradeTab =
  | "balances"
  | "positions"
  | "openOrders"
  | "orderHistory"
  | "tradeHistory";

const HEIGHT_STORAGE_KEY = "trade-xyz-trade-panel-height";
const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 160;

const clampHeight = (value: number) => {
  const maxHeight = Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.75));
  return Math.min(maxHeight, Math.max(MIN_HEIGHT, value));
};

const loadHeight = () => {
  try {
    const stored = localStorage.getItem(HEIGHT_STORAGE_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        return clampHeight(parsed);
      }
    }
  } catch (error) {
    // Ignore storage errors
  }
  return clampHeight(DEFAULT_HEIGHT);
};

const TradePanel: Component = () => {
  const [activeTab, setActiveTab] = createSignal<TradeTab>("positions");
  const [panelHeight, setPanelHeight] = createSignal(loadHeight());
  let moveHandler: ((event: MouseEvent) => void) | null = null;
  let upHandler: (() => void) | null = null;

  const persistHeight = (value: number) => {
    try {
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(Math.round(value)));
    } catch (error) {
      // Ignore storage errors
    }
  };

  const stopResize = () => {
    if (moveHandler) {
      window.removeEventListener("mousemove", moveHandler);
      moveHandler = null;
    }
    if (upHandler) {
      window.removeEventListener("mouseup", upHandler);
      upHandler = null;
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const startResize = (event: MouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panelHeight();

    moveHandler = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const nextHeight = clampHeight(startHeight + delta);
      setPanelHeight(nextHeight);
      persistHeight(nextHeight);
    };

    upHandler = () => stopResize();

    window.addEventListener("mousemove", moveHandler);
    window.addEventListener("mouseup", upHandler);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  const handleWindowResize = () => {
    setPanelHeight((current) => clampHeight(current));
  };

  window.addEventListener("resize", handleWindowResize);
  onCleanup(() => {
    stopResize();
    window.removeEventListener("resize", handleWindowResize);
  });

  const positionsCount = createMemo(() => positions().length);
  const openOrdersCount = createMemo(() => openOrders().length);

  return (
    <div
      class="shrink-0 border-t border-brand-border bg-brand-surface flex flex-col"
      style={{ height: `${panelHeight()}px` }}
    >
      <div
        class="group flex h-2 cursor-row-resize items-center justify-center"
        onMouseDown={startResize}
      >
        <div class="h-0.5 w-10 rounded-full bg-brand-border transition-colors group-hover:bg-brand-slate-500" />
      </div>
      <div class="flex border-b border-brand-border">
        <button
          class={`px-4 py-2 text-xs font-medium border-b-2 ${
            activeTab() === "balances"
              ? "text-brand-accent border-brand-accent"
              : "text-brand-slate-400 border-transparent hover:text-slate-200"
          }`}
          onClick={() => setActiveTab("balances")}
        >
          Balances
        </button>
        <button
          class={`px-4 py-2 text-xs font-medium border-b-2 ${
            activeTab() === "positions"
              ? "text-brand-accent border-brand-accent"
              : "text-brand-slate-400 border-transparent hover:text-slate-200"
          }`}
          onClick={() => setActiveTab("positions")}
        >
          Positions
          <Show when={positionsCount() > 0}>
            <span class="ml-1 text-[10px] text-brand-slate-300">
              ({positionsCount()})
            </span>
          </Show>
        </button>
        <button
          class={`px-4 py-2 text-xs font-medium border-b-2 ${
            activeTab() === "openOrders"
              ? "text-brand-accent border-brand-accent"
              : "text-brand-slate-400 border-transparent hover:text-slate-200"
          }`}
          onClick={() => setActiveTab("openOrders")}
        >
          Open Orders
          <Show when={openOrdersCount() > 0}>
            <span class="ml-1 text-[10px] text-brand-slate-300">
              ({openOrdersCount()})
            </span>
          </Show>
        </button>
        <button
          class={`px-4 py-2 text-xs font-medium border-b-2 ${
            activeTab() === "orderHistory"
              ? "text-brand-accent border-brand-accent"
              : "text-brand-slate-400 border-transparent hover:text-slate-200"
          }`}
          onClick={() => setActiveTab("orderHistory")}
        >
          Order History
        </button>
        <button
          class={`px-4 py-2 text-xs font-medium border-b-2 ${
            activeTab() === "tradeHistory"
              ? "text-brand-accent border-brand-accent"
              : "text-brand-slate-400 border-transparent hover:text-slate-200"
          }`}
          onClick={() => setActiveTab("tradeHistory")}
        >
          Trade History
        </button>
      </div>
      <div class="flex-1 overflow-auto">
        <Show when={activeTab() === "balances"}>
          <BalancesPanel showMarginCard={false} compact />
        </Show>
        <Show when={activeTab() === "positions"}>
          <PositionsTable compact />
        </Show>
        <Show when={activeTab() === "openOrders"}>
          <OpenOrdersTable compact />
        </Show>
        <Show when={activeTab() === "tradeHistory"}>
          <TradeHistoryTable compact />
        </Show>
        <Show when={activeTab() === "orderHistory"}>
          <div class="flex items-center justify-center h-full text-brand-slate-500 text-sm">
            <div class="text-center">
              <p class="text-slate-300 mb-1">No history yet</p>
              <p class="text-xs">Place an order to start trading</p>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default TradePanel;
