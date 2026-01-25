import { Component, For, Show, createMemo } from "solid-js";
import {
  getAvailableBalance,
  getBalance,
  getMarkPriceForSymbol,
} from "../stores/clob";
import { MARKETS, selectMarket, type Market } from "../stores/market";
import { setCurrentPage } from "../stores/page";
import { SpotAsset, getSpotBalance, openTransferModal } from "../stores/wallet";
import { isVaultTradingAccount } from "../stores/tradingAccount";

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
  contract?: string;
}[] = [
  {
    symbol: "HYPE",
    accent: "text-emerald-300",
    contract: "0x0d01...11ec",
  },
  {
    symbol: "BTC",
    accent: "text-amber-300",
  },
];

const BalancesPanel: Component<{
  compact?: boolean;
}> = (props) => {
  const perpsTotal = createMemo(() => getBalance("USDC"));
  const perpsAvailable = createMemo(() => getAvailableBalance("USDC"));
  const spotUsdcBalance = createMemo(() => getSpotBalance("USDC"));
  const headerPadding = () => (props.compact ? "px-3 py-2" : "px-3 py-2.5");
  const cellPadding = () => (props.compact ? "px-3 py-1.5" : "px-3 py-2");
  const textSize = () => (props.compact ? "text-xs" : "text-sm");
  const visibleSpotAssets = createMemo(() =>
    isVaultTradingAccount()
      ? []
      : spotAssets.filter((asset) => getSpotBalance(asset.symbol) > 0),
  );

  const goToTrade = (symbol: string, type: Market["type"]) => {
    const market =
      MARKETS().find((item) => item.symbol === symbol && item.type === type) ??
      MARKETS().find((item) => item.symbol === symbol);
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
                  <Show when={!isVaultTradingAccount()}>
                    <button
                      class="text-brand-accent hover:underline"
                      onClick={() => openTransferModal("perpsToSpot")}
                    >
                      Transfer to Spot
                    </button>
                  </Show>
                </div>
              </td>
              <td class={`${cellPadding()} ${textSize()}`}>
                <span class="text-brand-slate-500">--</span>
              </td>
            </tr>
            {/* Spot USDC Row */}
            <Show when={!isVaultTradingAccount() && spotUsdcBalance() > 0}>
              <tr class="border-b border-brand-border/40">
                <td class={`${cellPadding()} ${textSize()}`}>
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-slate-100">USDC</span>
                    <span class="text-xs text-brand-slate-500">Spot</span>
                  </div>
                </td>
                <td class={`${cellPadding()} ${textSize()}`}>
                  <span class="font-mono">
                    {formatAmountWithUnit(spotUsdcBalance(), 2, "USDC")}
                  </span>
                </td>
                <td class={`${cellPadding()} ${textSize()}`}>
                  <span class="font-mono">
                    {formatAmountWithUnit(spotUsdcBalance(), 2, "USDC")}
                  </span>
                </td>
                <td class={`${cellPadding()} ${textSize()}`}>
                  <span class="font-mono">{formatUsd(spotUsdcBalance())}</span>
                </td>
                <td class={`${cellPadding()} ${textSize()}`}>
                  <span class="text-brand-slate-500">--</span>
                </td>
                <td class={`${cellPadding()} ${textSize()}`}>
                  <div class="flex items-center gap-4 whitespace-nowrap">
                    <button class="text-brand-accent hover:underline">
                      Send
                    </button>
                    <button
                      class="text-brand-accent hover:underline"
                      onClick={() => openTransferModal("spotToPerps")}
                    >
                      Transfer to Perps
                    </button>
                  </div>
                </td>
                <td class={`${cellPadding()} ${textSize()}`}>
                  <span class="text-brand-slate-500">--</span>
                </td>
              </tr>
            </Show>
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
                      <span class="text-brand-slate-500">--</span>
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
    </div>
  );
};

export default BalancesPanel;
