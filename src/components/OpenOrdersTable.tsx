import { Component, For, Show } from "solid-js";
import { formatPrice } from "../lib/binance";
import { cancelOrder, fillOpenOrder, openOrders } from "../stores/clob";

const columns = [
  "Time",
  "Symbol",
  "Side",
  "Type",
  "Price",
  "Size",
  "Filled",
  "Collateral",
  "Actions",
];

const formatSize = (size: number) => {
  const abs = Math.abs(size);
  if (abs >= 100) return abs.toFixed(2);
  if (abs >= 1) return abs.toFixed(3);
  return abs.toFixed(4);
};

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const OpenOrdersTable: Component<{ compact?: boolean }> = (props) => {
  const rowPadding = props.compact ? "py-2" : "py-3";
  const textSize = props.compact ? "text-xs" : "text-sm";
  const activeOrders = () =>
    openOrders().filter((order) => order.status === "open");

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
            when={activeOrders().length > 0}
            fallback={
              <tr>
                <td
                  class={`px-4 ${rowPadding} text-brand-slate-400 ${textSize}`}
                  colSpan={columns.length}
                >
                  No open orders
                </td>
              </tr>
            }
          >
            <For each={activeOrders()}>
              {(order) => (
                <tr class="border-b border-brand-border/40">
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="font-mono text-brand-slate-400">
                      {formatTime(order.createdAt)}
                    </span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="font-semibold">{order.symbol}</span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span
                      class={`font-semibold ${
                        order.side === "buy"
                          ? "text-brand-green-400"
                          : "text-brand-red-400"
                      }`}
                    >
                      {order.side === "buy" ? "Buy" : "Sell"}
                    </span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="text-brand-slate-300">
                      {order.type === "limit" ? "Limit" : "Market"}
                    </span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="font-mono">
                      {order.price != null ? formatPrice(order.price) : "--"}
                    </span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="font-mono">
                      {formatSize(order.size)} {order.symbol}
                    </span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="font-mono text-brand-slate-400">
                      {formatSize(order.filledSize)}
                    </span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <span class="font-mono text-brand-slate-400">
                      {order.collateral}
                    </span>
                  </td>
                  <td class={`px-4 ${rowPadding} ${textSize}`}>
                    <div class="flex items-center gap-3">
                      <button
                        class="text-brand-accent hover:underline"
                        onClick={() => void fillOpenOrder(order._id)}
                      >
                        Fill
                      </button>
                      <button
                        class="text-brand-red-400 hover:underline"
                        onClick={() => void cancelOrder(order._id)}
                      >
                        Cancel
                      </button>
                    </div>
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

export default OpenOrdersTable;
