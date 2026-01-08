import { Component, For, Show, createMemo } from "solid-js";
import { formatPrice } from "../lib/hyperliquid";
import {
  Collateral,
  closePosition,
  getBalance,
  getMarkPriceForSymbol,
  positions,
} from "../stores/clob";

const columns = [
  "Asset",
  "Size",
  "Position Value",
  "Entry Price",
  "Mark Price",
  "PNL (ROE %)",
  "Liq. Price",
  "Margin",
  "Funding",
  "Actions",
  "TP/SL",
];

const formatSize = (size: number) => {
  const abs = Math.abs(size);
  if (abs >= 100) return abs.toFixed(2);
  if (abs >= 1) return abs.toFixed(3);
  return abs.toFixed(4);
};

const formatUsd = (value: number) =>
  `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatSignedUsd = (value: number) => {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatUsd(Math.abs(value))}`;
};

const PositionsTable: Component<{ compact?: boolean }> = (props) => {
  const cellPadding = props.compact ? "px-3 py-1.5" : "px-3 py-2";
  const headerPadding = props.compact ? "px-3 py-2" : "px-3 py-2.5";
  const textSize = props.compact ? "text-xs" : "text-sm";
  const unrealizedByCollateral = createMemo(() => {
    const totals: Record<Collateral, number> = { USDC: 0, USDT: 0 };
    for (const position of positions()) {
      const mark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(mark) || mark <= 0) continue;
      totals[position.collateral] +=
        (mark - position.entryPrice) * position.size;
    }
    return totals;
  });

  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[1200px]">
        <thead>
          <tr class="border-b border-brand-border">
            <For each={columns}>
              {(col) => (
                <th
                  class={`${headerPadding} text-xs font-medium text-brand-slate-400 text-left`}
                >
                  {col}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <Show
            when={positions().length > 0}
            fallback={
              <tr>
                <td
                  class={`${cellPadding} text-brand-slate-400 ${textSize}`}
                  colSpan={columns.length}
                >
                  No open positions
                </td>
              </tr>
            }
          >
            <For each={positions()}>
              {(position) => {
                // Use getter functions for reactivity - these will re-run when lastPrices updates
                const mark = () => getMarkPriceForSymbol(position.symbol);
                const hasValidPrice = () => {
                  const m = mark();
                  return Number.isFinite(m) && m > 0;
                };
                const positionValue = () => Math.abs(position.size) * mark();
                const margin = () =>
                  position.leverage > 0 ? positionValue() / position.leverage : 0;
                const pnl = () => (mark() - position.entryPrice) * position.size;
                const roe = () => (margin() > 0 ? (pnl() / margin()) * 100 : 0);
                const marginType = position.marginType ?? "cross";
                const marginLabel =
                  marginType === "cross" ? "Cross" : "Isolated";
                const totalUnrealized = () =>
                  unrealizedByCollateral()[position.collateral] ?? 0;
                const currentUnrealized = () => {
                  const m = mark();
                  return Number.isFinite(m) && m > 0
                    ? (m - position.entryPrice) * position.size
                    : 0;
                };
                const baseEquity = () =>
                  getBalance(position.collateral) +
                  (totalUnrealized() - currentUnrealized());
                const crossLiqPrice = () => {
                  const equity = baseEquity();
                  return Number.isFinite(equity) && position.size !== 0
                    ? position.entryPrice - equity / position.size
                    : NaN;
                };
                const liqFactor =
                  position.leverage > 0 ? 1 / position.leverage : 0;
                const isolatedLiqPrice =
                  position.size >= 0
                    ? position.entryPrice * (1 - liqFactor)
                    : position.entryPrice * (1 + liqFactor);
                const liqPrice = () =>
                  marginType === "cross" ? crossLiqPrice() : isolatedLiqPrice;
                const isLong = position.size >= 0;

                return (
                  <tr
                    class="border-b border-brand-border/40"
                    classList={{ "opacity-50 animate-pulse": !hasValidPrice() }}
                  >
                    <td class={`${cellPadding} ${textSize}`}>
                      <div class="flex items-center gap-2">
                        <span
                          class={`font-semibold ${isLong ? "text-brand-green-400" : "text-brand-red-400"}`}
                        >
                          {position.symbol}
                        </span>
                        <span class="text-xs text-brand-slate-400">
                          {position.leverage}x
                        </span>
                      </div>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span
                        class={`font-mono ${isLong ? "text-brand-green-400" : "text-brand-red-400"}`}
                      >
                        {formatSize(position.size)} {position.symbol}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono">
                        {hasValidPrice()
                          ? `${formatUsd(positionValue())} ${position.collateral}`
                          : "--"}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono">
                        {formatPrice(position.entryPrice)}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono">
                        {hasValidPrice() ? formatPrice(mark()) : "--"}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span
                        class={`font-mono ${hasValidPrice() ? (pnl() >= 0 ? "text-brand-green-400" : "text-brand-red-400") : "text-brand-slate-400"}`}
                      >
                        {hasValidPrice()
                          ? `${formatSignedUsd(pnl())} (${roe().toFixed(2)}%)`
                          : "--"}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono">
                        {hasValidPrice() &&
                        Number.isFinite(liqPrice()) &&
                        liqPrice() > 0
                          ? formatPrice(liqPrice())
                          : "--"}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono">
                        {hasValidPrice()
                          ? `${formatUsd(margin())} (${marginLabel})`
                          : `-- (${marginLabel})`}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono text-brand-slate-400">0.00</span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <button
                        class="text-brand-accent hover:underline"
                        onClick={() => closePosition(position.symbol)}
                      >
                        Close
                      </button>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono text-brand-slate-400">--</span>
                    </td>
                  </tr>
                );
              }}
            </For>
          </Show>
        </tbody>
      </table>
    </div>
  );
};

export default PositionsTable;
