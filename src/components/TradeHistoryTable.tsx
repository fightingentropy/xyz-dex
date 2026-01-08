import { Component, For, Show } from "solid-js";
import { formatPrice } from "../lib/hyperliquid";
import { tradeHistory } from "../stores/portfolio";

const columns = ["Time", "Symbol", "Side", "Price", "Size", "Notional", "PnL"];

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

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

const TradeHistoryTable: Component<{ compact?: boolean }> = (props) => {
  const rowPadding = props.compact ? "py-2" : "py-3";
  const textSize = props.compact ? "text-xs" : "text-sm";

  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[960px]">
        <thead>
          <tr class="border-b border-brand-border">
            <For each={columns}>
              {(col) => (
                <th class="px-4 py-3 text-xs font-medium text-brand-slate-400 text-left">
                  {col}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <Show
            when={tradeHistory().length > 0}
            fallback={
              <tr>
                <td
                  class={`px-4 ${rowPadding} text-brand-slate-400 ${textSize}`}
                  colSpan={columns.length}
                >
                  No trades yet
                </td>
              </tr>
            }
          >
            <For each={tradeHistory()}>
              {(trade) => (
                <tr class="border-b border-brand-border/40">
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="font-mono text-brand-slate-400">
                      {formatTime(trade.createdAt)}
                    </span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="font-semibold">{trade.symbol}</span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span
                      class={`font-semibold ${
                        trade.side === "buy"
                          ? "text-brand-green-400"
                          : "text-brand-red-400"
                      }`}
                    >
                      {trade.side === "buy" ? "Buy" : "Sell"}
                    </span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="font-mono">{formatPrice(trade.price)}</span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="font-mono">
                      {formatSize(trade.size)} {trade.symbol}
                    </span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="font-mono">{formatUsd(trade.notional)}</span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span
                      class={`font-mono ${
                        trade.pnl >= 0
                          ? "text-brand-green-400"
                          : "text-brand-red-400"
                      }`}
                    >
                      {formatUsd(trade.pnl)}
                    </span>
                  </td>
                </tr>
              )}
            </For>
          </Show>
        </tbody>
      </table>
    </div>
  );
};

export default TradeHistoryTable;
