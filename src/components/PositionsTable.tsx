import { Component, For, Show, createMemo } from "solid-js";
import { formatPrice } from "../lib/hyperliquid";
import {
  Collateral,
  closePosition,
  getBalance,
  getMarkPriceForSymbol,
  positions,
} from "../stores/clob";
import { MARKETS } from "../stores/market";

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

                // Portfolio margin: calculate hedged vs unhedged portions
                const spotCollateral = position.spotCollateralSize ?? 0;
                const isShort = position.size < 0;
                const hedgedSize = isShort ? spotCollateral : 0;
                const unhedgedSize = Math.abs(position.size) - hedgedSize;
                const isFullyHedged = hedgedSize > 0 && unhedgedSize <= 0;
                const isPartiallyHedged = hedgedSize > 0 && unhedgedSize > 0;

                // Margin calculation: only unhedged portion requires USDC margin
                const margin = () => {
                  if (position.leverage <= 0) return 0;
                  const unhedgedValue = unhedgedSize * mark();
                  return unhedgedValue / position.leverage;
                };

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

                // Liquidation price calculation accounting for spot collateral
                const liqPrice = () => {
                  // Fully hedged positions have no liquidation risk
                  if (isFullyHedged) return null;

                  // For partially hedged or unhedged positions
                  if (marginType === "cross") {
                    // Cross margin: use account equity for unhedged portion
                    const equity = baseEquity();
                    if (!Number.isFinite(equity) || unhedgedSize === 0) return NaN;
                    // For shorts, liq price is entry + equity/size (price going up)
                    // For longs, liq price is entry - equity/size (price going down)
                    if (isShort) {
                      return position.entryPrice + equity / unhedgedSize;
                    }
                    return position.entryPrice - equity / Math.abs(position.size);
                  } else {
                    // Isolated margin: use leverage factor for unhedged portion
                    const liqFactor = position.leverage > 0 ? 1 / position.leverage : 0;
                    if (isShort) {
                      // For shorts, liquidation happens when price goes up
                      return position.entryPrice * (1 + liqFactor);
                    }
                    // For longs, liquidation happens when price goes down
                    return position.entryPrice * (1 - liqFactor);
                  }
                };

                const isLong = position.size >= 0;

                // Funding display - show cumulative funding collected or paid
                const fundingDisplay = () => {
                  // Get funding rate for this symbol
                  const market = MARKETS().find(
                    (m) => m.symbol === position.symbol && m.type === "perps"
                  );
                  
                  // Calculate cumulative funding
                  // Funding is paid every 8 hours (3 times per day)
                  // For longs: positive funding rate means paying funding (negative), negative means receiving (positive)
                  // For shorts: opposite - positive funding rate means receiving funding (positive), negative means paying (negative)
                  let cumulativeFunding = position.cumulativeFunding ?? 0;
                  
                  // If we have a stored cumulative funding value, use it
                  if (cumulativeFunding !== 0) {
                    const fundingColor = cumulativeFunding >= 0 ? "text-brand-green-400" : "text-brand-red-400";
                    return (
                      <span class={`font-mono ${fundingColor}`}>
                        {formatSignedUsd(cumulativeFunding)}
                      </span>
                    );
                  }
                  
                  // Otherwise, calculate an estimate based on current funding rate and time elapsed
                  if (market && market.funding !== undefined) {
                    const fundingRate = market.funding; // Already in decimal form (e.g., 0.0001 = 0.01%)
                    const positionNotional = Math.abs(position.size) * mark();
                    const hoursSinceUpdate = (Date.now() - position.updatedAt) / (1000 * 60 * 60);
                    const fundingPeriods = hoursSinceUpdate / 8; // Funding paid every 8 hours
                    
                    // For longs: if funding rate is positive, they pay (negative), if negative, they receive (positive)
                    // For shorts: opposite
                    const estimatedFunding = isLong
                      ? -positionNotional * fundingRate * fundingPeriods
                      : positionNotional * fundingRate * fundingPeriods;
                    
                    const fundingColor = estimatedFunding >= 0 ? "text-brand-green-400" : "text-brand-red-400";
                    return (
                      <span class={`font-mono ${fundingColor}`}>
                        {formatSignedUsd(estimatedFunding)}
                      </span>
                    );
                  }
                  
                  return (
                    <span class="font-mono text-brand-slate-400">--</span>
                  );
                };

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
                        <Show when={isFullyHedged}>
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
                            HEDGED
                          </span>
                        </Show>
                        <Show when={isPartiallyHedged}>
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
                            PARTIAL
                          </span>
                        </Show>
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
                          ? `${formatSignedUsd(pnl())} (${isFullyHedged ? "∞" : roe().toFixed(2)}%)`
                          : "--"}
                      </span>
                    </td>
                    <td class={`${cellPadding} ${textSize}`}>
                      <span class="font-mono">
                        <Show
                          when={!isFullyHedged}
                          fallback={
                            <span class="text-emerald-400 font-medium">None</span>
                          }
                        >
                          {hasValidPrice() &&
                          liqPrice() !== null &&
                          Number.isFinite(liqPrice()) &&
                          (liqPrice() as number) > 0
                            ? formatPrice(liqPrice() as number)
                            : "--"}
                        </Show>
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
                      {hasValidPrice() ? fundingDisplay() : (
                        <span class="font-mono text-brand-slate-400">--</span>
                      )}
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
