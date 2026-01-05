import { Component, createSignal, For } from 'solid-js';

type TabId = 'balances' | 'positions' | 'openOrders' | 'twap' | 'tradeHistory' | 'fundingHistory' | 'orderHistory' | 'accountActivity';

const tabs: { id: TabId; label: string }[] = [
  { id: 'balances', label: 'Balances' },
  { id: 'positions', label: 'Positions' },
  { id: 'openOrders', label: 'Open Orders' },
  { id: 'twap', label: 'TWAP' },
  { id: 'tradeHistory', label: 'Trade History' },
  { id: 'fundingHistory', label: 'Funding History' },
  { id: 'orderHistory', label: 'Order History' },
  { id: 'accountActivity', label: 'Account Activity' },
];

const positionColumns = [
  'Asset',
  'Size',
  'Position Value',
  'Entry Price',
  'Mark Price',
  'Liq. Price',
  'PNL (ROE %)',
  'Margin',
  'Funding',
  'Actions',
  'TP/SL',
];

const Portfolio: Component = () => {
  const [activeTab, setActiveTab] = createSignal<TabId>('positions');
  const [accountsFilter, setAccountsFilter] = createSignal('All');
  const [periodFilter, setPeriodFilter] = createSignal('7 Days');
  const [chartType, setChartType] = createSignal('PnL');

  return (
    <div class="flex flex-col h-full bg-brand-screen text-slate-200 overflow-hidden">
      {/* Page Title */}
      <div class="px-4 py-4">
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
              <div class="text-2xl font-semibold text-slate-100 mb-3">--</div>
              <button class="text-sm text-[#5b9cf2] hover:underline">View Volume</button>
            </div>

            {/* Fees Card */}
            <div class="bg-brand-surface border border-brand-border rounded-lg p-4">
              <div class="text-sm text-brand-slate-400 mb-3">Fees (Taker / Maker)</div>
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-sm text-slate-300">Perps</span>
                  <span class="text-sm font-medium text-slate-100">0.0450% / 0.0150%</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-slate-300">Spot</span>
                  <span class="text-sm font-medium text-slate-100">0.0700% / 0.0400%</span>
                </div>
              </div>
              <button class="text-sm text-[#5b9cf2] hover:underline mt-3">View Fee Schedule</button>
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
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                  </button>
                </div>

                {/* Period Dropdown */}
                <div class="flex items-center gap-2">
                  <span class="text-sm text-brand-slate-400">Period</span>
                  <button class="flex items-center gap-1.5 text-sm text-slate-100 hover:text-white">
                    {periodFilter()}
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                  </button>
                </div>

                {/* Chart Type Dropdown */}
                <div class="flex items-center gap-2">
                  <span class="text-sm text-brand-slate-400">Chart</span>
                  <button class="flex items-center gap-1.5 text-sm text-slate-100 hover:text-white">
                    {chartType()}
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Stats & Chart Grid */}
              <div class="grid grid-cols-1 xl:grid-cols-12 gap-6">
                {/* Stats List */}
                <div class="xl:col-span-4 space-y-2">
                  <StatRow label="PnL" value="--" subValue="--" />
                  <StatRow label="Volume" value="--" subValue="--" />
                  <StatRow label="Total Equity" value="--" subValue="--" />
                  <StatRow label="Perps Account Equity" value="--" subValue="--" />
                  <StatRow label="Spot Account Equity" value="--" subValue="--" />
                  <StatRow label="Vault Equity" value="--" subValue="--" />
                  <StatRow label="Staking Account" value="--" subValue="--" />
                </div>

                {/* Chart */}
                <div class="xl:col-span-8">
                  <div class="h-48 relative">
                    {/* Y-Axis Labels */}
                    <div class="absolute left-0 top-0 bottom-6 w-8 flex flex-col justify-between text-xs text-brand-slate-500 text-right pr-2">
                      <span>3</span>
                      <span>2</span>
                      <span>1</span>
                      <span>0</span>
                    </div>
                    
                    {/* Chart Area */}
                    <div class="ml-10 h-full border-l border-b border-brand-border relative">
                      {/* Grid Lines */}
                      <div class="absolute inset-0 flex flex-col justify-between">
                        <div class="border-b border-brand-border/30 h-0" />
                        <div class="border-b border-brand-border/30 h-0" />
                        <div class="border-b border-brand-border/30 h-0" />
                      </div>
                      
                      {/* Empty chart line (flat at 0) */}
                      <div class="absolute bottom-0 left-0 right-0 h-px bg-brand-slate-500/50" />
                      
                      {/* Price label */}
                      <div class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-brand-slate-500">
                        $0.00
                      </div>
                    </div>

                    {/* X-Axis Labels */}
                    <div class="ml-10 flex justify-between text-xs text-brand-slate-500 mt-1">
                      <span>Sun. 04 Jan</span>
                      <span>Mon. 05 Jan</span>
                      <span>Mon. 05 Jan</span>
                      <span>Mon. 05 Jan</span>
                      <span>Mon. 05 Jan</span>
                      <span>Mon. 05 Jan</span>
                      <span>Mon. 05 Jan</span>
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
                        ? 'text-slate-100 border-slate-100'
                        : 'text-brand-slate-400 border-transparent hover:text-slate-200'
                    }`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                )}
              </For>
            </div>
            <button class="px-4 py-3 text-sm text-brand-slate-400 hover:text-slate-200 border-l border-brand-border">
              Close
            </button>
          </div>

          {/* Table Header */}
          <div class="overflow-x-auto">
            <table class="w-full min-w-[1200px]">
              <thead>
                <tr class="border-b border-brand-border">
                  <For each={positionColumns}>
                    {(col, index) => (
                      <th 
                        class={`px-4 py-3 text-xs font-medium text-brand-slate-400 text-left ${
                          col === 'Position Value' ? 'cursor-pointer hover:text-slate-200' : ''
                        }`}
                      >
                        <div class="flex items-center gap-1">
                          {col}
                          {col === 'Position Value' && (
                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="m6 9 6 6 6-6"/>
                            </svg>
                          )}
                        </div>
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                {/* Empty State */}
              </tbody>
            </table>
          </div>

          {/* Empty State */}
          <div class="flex items-center justify-center py-16 text-brand-slate-400">
            Connect wallet to view open positions
          </div>
        </div>
      </div>
    </div>
  );
};

// Stat Row Component
const StatRow: Component<{ label: string; value: string; subValue?: string }> = (props) => {
  return (
    <div class="flex items-center justify-between py-1">
      <span class="text-sm text-brand-slate-400">{props.label}</span>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-slate-100">{props.value}</span>
        {props.subValue && <span class="text-brand-slate-500">{props.subValue}</span>}
      </div>
    </div>
  );
};

export default Portfolio;
