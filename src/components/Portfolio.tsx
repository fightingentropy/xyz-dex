import { Component, For, Show, createMemo, createSignal } from "solid-js";
import BalancesPanel from "./BalancesPanel";
import OpenOrdersTable from "./OpenOrdersTable";
import PositionsTable from "./PositionsTable";
import TradeHistoryTable from "./TradeHistoryTable";
import { portfolioMetrics, tradeHistory } from "../stores/portfolio";
import { openOrders, positions } from "../stores/clob";

type TabId =
  | "balances"
  | "positions"
  | "openOrders"
  | "twap"
  | "tradeHistory"
  | "fundingHistory"
  | "orderHistory"
  | "accountActivity";

const tabs: { id: TabId; label: string }[] = [
  { id: "balances", label: "Balances" },
  { id: "positions", label: "Positions" },
  { id: "openOrders", label: "Open Orders" },
  { id: "twap", label: "TWAP" },
  { id: "tradeHistory", label: "Trade History" },
  { id: "fundingHistory", label: "Funding History" },
  { id: "orderHistory", label: "Order History" },
  { id: "accountActivity", label: "Account Activity" },
];

const PERIOD_OPTIONS = [
  { id: "24h", label: "24H", rangeMs: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7D", rangeMs: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "30D", rangeMs: 30 * 24 * 60 * 60 * 1000 },
  { id: "all", label: "All Time" },
] as const;

type PeriodOption = (typeof PERIOD_OPTIONS)[number];
type PeriodId = PeriodOption["id"];

const DEFAULT_PERIOD = PERIOD_OPTIONS[1];
const DEFAULT_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
const CHART_LINE_COLOR = "#f8fafc";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const buildTicks = (min: number, max: number, count: number) => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count <= 1) return [];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => max - step * index);
};

const formatAxisValue = (value: number) => {
  if (!Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const formatAxisDate = (timestamp: number, periodId: PeriodId) => {
  if (!Number.isFinite(timestamp)) return "--";
  const date = new Date(timestamp);
  if (periodId === "24h") {
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (periodId === "all") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
  });
};

const Portfolio: Component = () => {
  const [activeTab, setActiveTab] = createSignal<TabId>("positions");
  const [accountsFilter] = createSignal("All");
  const [periodFilter, setPeriodFilter] =
    createSignal<PeriodOption>(DEFAULT_PERIOD);
  const [periodMenuOpen, setPeriodMenuOpen] = createSignal(false);
  const [chartType] = createSignal("PnL");
  const metrics = () => portfolioMetrics();
  const positionsCount = createMemo(() => positions().length);
  const openOrdersCount = createMemo(() => openOrders().length);

  const tabCountFor = (tabId: TabId) => {
    if (tabId === "positions") return positionsCount();
    if (tabId === "openOrders") return openOrdersCount();
    return 0;
  };

  const formatUsd = (value?: number) => {
    if (!Number.isFinite(value ?? NaN)) return "--";
    const numeric = Number(value);
    const formatted = Math.abs(numeric).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${numeric < 0 ? "-" : ""}$${formatted}`;
  };

  const pnlChart = createMemo(() => {
    const selected = periodFilter();
    const rangeMs = "rangeMs" in selected ? selected.rangeMs : undefined;
    const rangeEnd = Date.now();
    const rangeStart = rangeMs ? rangeEnd - rangeMs : undefined;
    const filtered = tradeHistory()
      .filter((trade) => !rangeStart || trade.createdAt >= rangeStart)
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt);

    let running = 0;
    const defaultSpan = rangeMs ?? DEFAULT_RANGE_MS;
    const startTime =
      rangeStart ?? filtered[0]?.createdAt ?? rangeEnd - defaultSpan;
    const points = [{ time: startTime, value: 0 }];

    for (const trade of filtered) {
      running += trade.pnl;
      points.push({ time: trade.createdAt, value: running });
    }
    points.push({ time: rangeEnd, value: running });

    let min = Math.min(...points.map((point) => point.value));
    let max = Math.max(...points.map((point) => point.value));
    if (min === max) {
      const pad = Math.max(1, Math.abs(min) * 0.1);
      min -= pad;
      max += pad;
    } else {
      const pad = (max - min) * 0.1;
      min -= pad;
      max += pad;
    }

    return {
      points,
      min,
      max,
      rangeStart: startTime,
      rangeEnd,
      lastValue: running,
      hasTrades: filtered.length > 0,
    };
  });

  const plotPoints = createMemo(() => {
    const chart = pnlChart();
    const timeRange = Math.max(1, chart.rangeEnd - chart.rangeStart);
    const valueRange = Math.max(1e-6, chart.max - chart.min);
    return chart.points.map((point) => ({
      ...point,
      x: clamp(((point.time - chart.rangeStart) / timeRange) * 100, 0, 100),
      y: clamp(100 - ((point.value - chart.min) / valueRange) * 100, 0, 100),
    }));
  });

  const linePath = createMemo(() => {
    const points = plotPoints();
    if (!points.length) return "";
    let path = `M${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const next = points[i];
      path += ` L${next.x} ${prev.y} L${next.x} ${next.y}`;
    }
    return path;
  });

  const yTicks = createMemo(() => {
    const chart = pnlChart();
    if (!chart.hasTrades) return [0, 0, 0, 0];
    return buildTicks(chart.min, chart.max, 4);
  });

  const xTicks = createMemo(() => {
    const chart = pnlChart();
    const start = chart.rangeStart;
    const end = chart.rangeEnd;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [start];
    }
    const count = 5;
    const step = (end - start) / (count - 1);
    return Array.from({ length: count }, (_, index) => start + step * index);
  });

  return (
    <div class="flex flex-col h-full bg-brand-screen text-slate-200 overflow-hidden">
      {/* Page Title */}
      <div class="px-4 py-4 flex items-center">
        <h1 class="text-xl font-semibold text-slate-100">Portfolio</h1>
      </div>

      {/* Main Content */}
      <div class="flex-1 overflow-auto px-4 pb-4">
        {/* Top Section - Stats Cards */}
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-4">
          {/* Left Column - Volume & Fees */}
          <div class="lg:col-span-3 flex flex-col gap-4">
            {/* 14 Day Volume Card */}
            <div class="bg-brand-surface border border-brand-border rounded-lg p-4">
              <div class="text-sm text-brand-slate-400 mb-2">14 Day Volume</div>
              <div class="text-2xl font-semibold text-slate-100 mb-3">
                {formatUsd(metrics()?.volume)}
              </div>
              <button class="text-sm text-[#5b9cf2] hover:underline">
                View Volume
              </button>
            </div>

            {/* Fees Card */}
            <div class="bg-brand-surface border border-brand-border rounded-lg p-4">
              <div class="text-sm text-brand-slate-400 mb-3">
                Fees (Taker / Maker)
              </div>
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-sm text-slate-300">Perps</span>
                  <span class="text-sm font-medium text-slate-100">
                    0% / 0%
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-slate-300">Spot</span>
                  <span class="text-sm font-medium text-slate-100">
                    0% / 0%
                  </span>
                </div>
              </div>
              <button class="text-sm text-[#5b9cf2] hover:underline mt-3">
                View Fee Schedule
              </button>
            </div>
          </div>

          {/* Right Column - Account Overview & Chart */}
          <div class="lg:col-span-9">
            <div class="bg-brand-surface border border-brand-border rounded-lg p-4 h-full">
              {/* Header with Filters */}
              <div class="flex flex-wrap items-center gap-6 mb-4 pb-4 border-b border-brand-border">
                {/* Accounts Dropdown */}
                <div class="flex items-center gap-2">
                  <span class="text-sm text-brand-slate-400">Accounts</span>
                  <button class="flex items-center gap-1.5 text-sm text-slate-100 hover:text-white">
                    {accountsFilter()}
                    <svg
                      class="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                </div>

                {/* Period Dropdown */}
                <div class="flex items-center gap-2">
                  <span class="text-sm text-brand-slate-400">Period</span>
                  <div class="relative">
                    <button
                      class="flex items-center gap-1.5 text-sm text-slate-100 hover:text-white"
                      onClick={() => setPeriodMenuOpen(!periodMenuOpen())}
                    >
                      {periodFilter().label}
                      <svg
                        class="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    <Show when={periodMenuOpen()}>
                      <>
                        <div
                          class="fixed inset-0 z-30"
                          onClick={() => setPeriodMenuOpen(false)}
                        />
                        <div class="absolute left-0 top-full z-40 mt-2 w-32 rounded-lg border border-brand-border bg-brand-surface shadow-xl">
                          <For each={PERIOD_OPTIONS}>
                            {(option) => (
                              <button
                                class={`w-full px-3 py-2 text-left text-xs font-medium transition-colors ${
                                  option.id === periodFilter().id
                                    ? "text-brand-accent bg-brand-accent/10"
                                    : "text-brand-slate-300 hover:text-slate-100 hover:bg-brand-border/60"
                                }`}
                                onClick={() => {
                                  setPeriodFilter(option);
                                  setPeriodMenuOpen(false);
                                }}
                              >
                                {option.label}
                              </button>
                            )}
                          </For>
                        </div>
                      </>
                    </Show>
                  </div>
                </div>

                {/* Chart Type Dropdown */}
                <div class="flex items-center gap-2">
                  <span class="text-sm text-brand-slate-400">Chart</span>
                  <button class="flex items-center gap-1.5 text-sm text-slate-100 hover:text-white">
                    {chartType()}
                    <svg
                      class="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Stats & Chart Grid */}
              <div class="grid grid-cols-1 xl:grid-cols-12 gap-6">
                {/* Stats List */}
                <div class="xl:col-span-4 space-y-2">
                  <StatRow
                    label="PnL"
                    value={formatUsd(metrics()?.pnl)}
                    subValue="--"
                  />
                  <StatRow
                    label="Volume"
                    value={formatUsd(metrics()?.volume)}
                    subValue="--"
                  />
                  <StatRow
                    label="Total Equity"
                    value={formatUsd(metrics()?.totalEquity)}
                    subValue="--"
                  />
                  <StatRow
                    label="Perps Account Equity"
                    value={formatUsd(metrics()?.perpsEquity)}
                    subValue="--"
                  />
                  <StatRow
                    label="Spot Account Equity"
                    value={formatUsd(metrics()?.spotEquity)}
                    subValue="--"
                  />
                  <StatRow label="Vault Equity" value="--" subValue="--" />
                  <StatRow label="Staking Account" value="--" subValue="--" />
                </div>

                {/* Chart */}
                <div class="xl:col-span-8">
                  <div class="h-48 relative">
                    {/* Y-Axis Labels */}
                    <div class="absolute left-0 top-0 bottom-6 w-16 flex flex-col justify-between text-[11px] text-brand-slate-400 text-right pr-2">
                      <For each={yTicks()}>
                        {(tick) => <span>{formatAxisValue(tick)}</span>}
                      </For>
                    </div>

                    {/* Chart Area */}
                    <div class="ml-16 h-full border-l border-b border-brand-border relative overflow-hidden">
                      {/* Grid Lines */}
                      <div class="absolute inset-0 flex flex-col justify-between">
                        <For each={yTicks()}>
                          {() => (
                            <div class="border-b border-brand-border/30 h-0" />
                          )}
                        </For>
                      </div>

                      <svg
                        class="absolute inset-0 h-full w-full"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                      >
                        <Show when={linePath() !== ""}>
                          <path
                            d={linePath()}
                            fill="none"
                            stroke={CHART_LINE_COLOR}
                            stroke-width="1.1"
                          />
                        </Show>
                      </svg>

                      <Show when={!pnlChart().hasTrades}>
                        <div class="absolute inset-0 flex items-center justify-center text-xs text-brand-slate-500">
                          No PnL data for this period
                        </div>
                      </Show>
                    </div>

                    {/* X-Axis Labels */}
                    <div class="ml-16 flex justify-between text-xs text-brand-slate-500 mt-1">
                      <For each={xTicks()}>
                        {(tick) => (
                          <span>{formatAxisDate(tick, periodFilter().id)}</span>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Section - Tabs & Table */}
        <div class="bg-brand-surface border border-brand-border rounded-lg overflow-hidden">
          {/* Tabs Header */}
          <div class="flex items-center border-b border-brand-border">
            <div class="flex-1 flex items-center overflow-x-auto">
              <For each={tabs}>
                {(tab) => (
                  <button
                    class={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                      activeTab() === tab.id
                        ? "text-slate-100 border-slate-100"
                        : "text-brand-slate-400 border-transparent hover:text-slate-200"
                    }`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                    <Show when={tabCountFor(tab.id) > 0}>
                      <span class="ml-1 text-xs text-brand-slate-300">
                        ({tabCountFor(tab.id)})
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <button class="px-4 py-3 text-sm text-brand-slate-400 hover:text-slate-200 border-l border-brand-border">
              Close
            </button>
          </div>

          <div class="p-2">
            <Show when={activeTab() === "balances"}>
              <BalancesPanel />
            </Show>
            <Show when={activeTab() === "positions"}>
              <PositionsTable />
            </Show>
            <Show when={activeTab() === "openOrders"}>
              <OpenOrdersTable />
            </Show>
            <Show when={activeTab() === "tradeHistory"}>
              <TradeHistoryTable />
            </Show>
            <Show
              when={
                activeTab() !== "balances" &&
                activeTab() !== "positions" &&
                activeTab() !== "openOrders" &&
                activeTab() !== "tradeHistory"
              }
            >
              <div class="flex items-center justify-center py-16 text-brand-slate-400">
                No data for this tab yet
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
};

// Stat Row Component
const StatRow: Component<{
  label: string;
  value: string;
  subValue?: string;
}> = (props) => {
  return (
    <div class="flex items-center justify-between py-1">
      <span class="text-sm text-brand-slate-400">{props.label}</span>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-slate-100">{props.value}</span>
        {props.subValue && (
          <span class="text-brand-slate-500">{props.subValue}</span>
        )}
      </div>
    </div>
  );
};

export default Portfolio;
