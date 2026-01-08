import { Component, For, Show, createMemo } from "solid-js";
import {
  getAvailableBalance,
  getBalance,
  getMarkPriceForSymbol,
} from "../stores/clob";
import { MARKETS, selectMarket, type Market } from "../stores/market";
import { setCurrentPage } from "../stores/page";
import { SpotAsset, getSpotBalance } from "../stores/wallet";

const columns = [
  "Coin",
  "Total Balance",
  "Available Balance",
  "USDC Value",
  "PNL (ROE %)",
  "Actions",
  "Contract",
];

const formatUsd = (value: number) => {
  if (!Number.isFinite(value)) return "--";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatAmount = (value: number, decimals: number) => {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const formatAmountWithUnit = (
  value: number,
  decimals: number,
  unit: string,
) => {
  const formatted = formatAmount(value, decimals);
  return formatted === "--" ? formatted : `${formatted} ${unit}`;
};

const spotAssets: {
  symbol: SpotAsset;
  accent: string;
  roe?: number;
  contract?: string;
}[] = [
  {
    symbol: "HYPE",
    accent: "text-emerald-300",
    roe: 10.9,
    contract: "0x0d01...11ec",
  },
  {
    symbol: "BTC",
    accent: "text-amber-300",
    roe: 3.6,
  },
];

const PORTFOLIO_LEVERAGE = 3;

const BalancesPanel: Component<{
  showMarginCard?: boolean;
  compact?: boolean;
}> = (props) => {
  const perpsTotal = createMemo(() => getBalance("USDC"));
  const perpsAvailable = createMemo(() => getAvailableBalance("USDC"));
  const hypeSpotBalance = createMemo(() => getSpotBalance("HYPE"));
  const hypePrice = createMemo(() => getMarkPriceForSymbol("HYPE"));
  const hypeValue = createMemo(() => {
    const price = hypePrice();
    const balance = hypeSpotBalance();
    if (!Number.isFinite(price) || price <= 0) return 0;
    return balance * price;
  });
  const maxShortNotional = createMemo(() => hypeValue() * PORTFOLIO_LEVERAGE);
  const hasCollateral = createMemo(() => hypeSpotBalance() > 0);
  const showMarginCard = () => props.showMarginCard !== false;
  const headerPadding = () => (props.compact ? "px-3 py-2" : "px-3 py-2.5");
  const cellPadding = () => (props.compact ? "px-3 py-1.5" : "px-3 py-2");
  const textSize = () => (props.compact ? "text-xs" : "text-sm");
  const visibleSpotAssets = createMemo(() =>
    spotAssets.filter((asset) => getSpotBalance(asset.symbol) > 0),
  );

  const goToTrade = (symbol: string, type: Market["type"]) => {
    const market =
      MARKETS.find((item) => item.symbol === symbol && item.type === type) ??
      MARKETS.find((item) => item.symbol === symbol);
    if (market) {
      selectMarket(market);
    }
    setCurrentPage("trade");
  };

  return (
    <div class="space-y-4">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[980px]">
          <thead>
            <tr class="border-b border-brand-border">
              <For each={columns}>
                {(col) => (
                  <th
                    class={`${headerPadding()} text-xs font-medium text-brand-slate-400 text-left`}
                  >
                    {col}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <tr class="border-b border-brand-border/40">
              <td class={`${cellPadding()} ${textSize()}`}>
                <div class="flex items-center gap-2">
                  <span class="font-semibold text-slate-100">USDC</span>
                  <span class="text-xs text-brand-slate-500">Perps</span>
                </div>
              </td>
              <td class={`${cellPadding()} ${textSize()}`}>
                <span class="font-mono">
                  {formatAmountWithUnit(perpsTotal(), 2, "USDC")}
                </span>
              </td>
              <td class={`${cellPadding()} ${textSize()}`}>
                <span class="font-mono">
                  {formatAmountWithUnit(perpsAvailable(), 2, "USDC")}
                </span>
              </td>
              <td class={`${cellPadding()} ${textSize()}`}>
                <span class="font-mono">{formatUsd(perpsTotal())}</span>
              </td>
              <td class={`${cellPadding()} ${textSize()}`}>
                <span class="text-brand-slate-500">--</span>
              </td>
              <td class={`${cellPadding()} ${textSize()}`}>
                <div class="flex items-center gap-4 whitespace-nowrap">
                  <button class="text-brand-accent hover:underline">
                    Send
                  </button>
                  <button class="text-brand-accent hover:underline">
                    Transfer to Spot
                  </button>
                </div>
              </td>
              <td class={`${cellPadding()} ${textSize()}`}>
                <span class="text-brand-slate-500">--</span>
              </td>
            </tr>
            <For each={visibleSpotAssets()}>
              {(asset) => {
                const balance = createMemo(() => getSpotBalance(asset.symbol));
                const price = createMemo(() =>
                  getMarkPriceForSymbol(asset.symbol),
                );
                const value = createMemo(() => {
                  const latestPrice = price();
                  const latestBalance = balance();
                  if (!Number.isFinite(latestPrice) || latestPrice <= 0)
                    return 0;
                  return latestBalance * latestPrice;
                });
                const pnl = createMemo(() => {
                  if (asset.roe == null) return null;
                  return value() * (asset.roe / 100);
                });
                const decimals = asset.symbol === "BTC" ? 6 : 4;

                return (
                  <tr class="border-b border-brand-border/40">
                    <td class={`${cellPadding()} ${textSize()}`}>
                      <div class="flex items-center gap-2">
                        <span class={`font-semibold ${asset.accent}`}>
                          {asset.symbol}
                        </span>
                        <span class="text-xs text-brand-slate-500">Spot</span>
                      </div>
                    </td>
                    <td class={`${cellPadding()} ${textSize()}`}>
                      <span class="font-mono">
                        {formatAmountWithUnit(
                          balance(),
                          decimals,
                          asset.symbol,
                        )}
                      </span>
                    </td>
                    <td class={`${cellPadding()} ${textSize()}`}>
                      <span class="font-mono">
                        {formatAmountWithUnit(
                          balance(),
                          decimals,
                          asset.symbol,
                        )}
                      </span>
                    </td>
                    <td class={`${cellPadding()} ${textSize()}`}>
                      <span class="font-mono">{formatUsd(value())}</span>
                    </td>
                    <td class={`${cellPadding()} ${textSize()}`}>
                      <Show
                        when={pnl() != null}
                        fallback={<span class="text-brand-slate-500">--</span>}
                      >
                        <span class="font-mono text-brand-green-400">
                          +{formatUsd(pnl() ?? 0)} ({asset.roe?.toFixed(1)}%)
                        </span>
                      </Show>
                    </td>
                    <td class={`${cellPadding()} ${textSize()}`}>
                      <div class="flex items-center gap-4 whitespace-nowrap">
                        <button
                          class="text-brand-accent hover:underline"
                          onClick={() => goToTrade(asset.symbol, "spot")}
                        >
                          Buy Spot
                        </button>
                        <button class="text-brand-accent hover:underline">
                          Send
                        </button>
                        <button class="text-brand-accent hover:underline">
                          Transfer to/from EVM
                        </button>
                      </div>
                    </td>
                    <td class={`${cellPadding()} ${textSize()}`}>
                      <span class="font-mono text-xs text-brand-slate-400">
                        {asset.contract ?? "--"}
                      </span>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>

      <Show when={showMarginCard()}>
        <div class="bg-brand-surface border border-brand-border rounded-lg p-4">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div class="text-sm text-brand-slate-400">Portfolio Margin</div>
              <div class="text-base font-semibold text-slate-100">
                Short HYPE perp with spot HYPE collateral
              </div>
              <div class="text-xs text-brand-slate-500 mt-1">
                Spot HYPE collateral applies automatically when available.
              </div>
            </div>
            <button
              class={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                hasCollateral()
                  ? "border-brand-red-400/70 text-brand-red-400 hover:bg-brand-red-400/10"
                  : "border-brand-border text-brand-slate-500 cursor-not-allowed"
              }`}
              onClick={() => goToTrade("HYPE", "perps")}
              disabled={!hasCollateral()}
            >
              Short HYPE perp
            </button>
          </div>

          <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric
              label="Spot HYPE Balance"
              value={formatAmountWithUnit(hypeSpotBalance(), 4, "HYPE")}
            />
            <Metric label="Collateral Value" value={formatUsd(hypeValue())} />
            <Metric
              label={`Max Short (${PORTFOLIO_LEVERAGE}x)`}
              value={formatUsd(maxShortNotional())}
            />
            <Metric
              label="Status"
              value={hasCollateral() ? "Enabled" : "Add spot HYPE"}
            />
          </div>

          <Show when={!hasCollateral()}>
            <div class="text-xs text-brand-slate-500 mt-3">
              Add spot HYPE to enable portfolio margin.
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

const Metric: Component<{ label: string; value: string }> = (props) => {
  return (
    <div class="bg-brand-screen border border-brand-border rounded-lg px-3 py-2">
      <div class="text-xs text-brand-slate-500">{props.label}</div>
      <div class="text-sm font-mono text-slate-100">{props.value}</div>
    </div>
  );
};

export default BalancesPanel;
