import { Component, createSignal } from "solid-js";
import { currentSymbol } from "../stores/market";

type OrderSide = "long" | "short";
type OrderType = "market" | "limit";

const OrderForm: Component = () => {
  const [side, setSide] = createSignal<OrderSide>("long");
  const [orderType, setOrderType] = createSignal<OrderType>("market");
  const [leverage, setLeverage] = createSignal(25);
  const [amount, setAmount] = createSignal("");
  const [sliderValue, setSliderValue] = createSignal(0);
  const [reduceOnly, setReduceOnly] = createSignal(false);
  const [tpsl, setTpsl] = createSignal(false);

  const isLong = () => side() === "long";

  return (
    <div class="flex flex-col bg-brand-surface border-l border-brand-border h-full overflow-auto">
      {/* Long/Short Toggle */}
      <div class="flex">
        <button
          class={`flex-1 py-3 text-sm font-semibold transition-colors ${isLong() ? "bg-brand-green-400/20 text-brand-green-400" : "text-brand-slate-400 hover:text-slate-200"}`}
          onClick={() => setSide("long")}
        >
          Long
        </button>
        <button
          class={`flex-1 py-3 text-sm font-semibold transition-colors ${!isLong() ? "bg-brand-red-400/20 text-brand-red-400" : "text-brand-slate-400 hover:text-slate-200"}`}
          onClick={() => setSide("short")}
        >
          Short
        </button>
      </div>

      {/* Order Type */}
      <div class="flex items-center gap-1 p-3 border-b border-brand-border">
        <button
          class={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${orderType() === "market" ? "bg-brand-border text-slate-200" : "text-brand-slate-400 hover:text-slate-200"}`}
          onClick={() => setOrderType("market")}
        >
          Market
        </button>
        <button
          class={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${orderType() === "limit" ? "bg-brand-border text-slate-200" : "text-brand-slate-400 hover:text-slate-200"}`}
          onClick={() => setOrderType("limit")}
        >
          Limit
        </button>
        <div class="flex-1" />
        <button class="flex items-center gap-1 px-3 py-2 text-sm text-brand-slate-400 hover:text-slate-200">
          Pro
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

      <div class="p-3 space-y-4">
        {/* Leverage & Margin Type */}
        <div class="flex gap-2">
          <button class="flex-1 flex items-center justify-between px-3 py-2.5 bg-brand-screen border border-brand-border rounded-lg text-sm">
            <span class="text-slate-200">{leverage()}x</span>
            <svg
              class="w-4 h-4 text-brand-slate-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button class="flex-1 flex items-center justify-between px-3 py-2.5 bg-brand-screen border border-brand-border rounded-lg text-sm">
            <span class="text-slate-200">Isolated</span>
            <svg
              class="w-4 h-4 text-brand-slate-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>

        {/* Available & Position Info */}
        <div class="space-y-1.5">
          <div class="flex justify-between text-sm">
            <span class="text-brand-slate-400">Available to Trade</span>
            <span class="text-slate-200 font-mono">0.00 USDT</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-brand-slate-400">Current Position</span>
            <span class="text-slate-200 font-mono">0 {currentSymbol()}</span>
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <div class="flex items-center bg-brand-screen border border-brand-border rounded-lg overflow-hidden">
            <span class="px-3 text-sm text-brand-slate-400">Amount</span>
            <button class="px-2 py-1 text-xs bg-brand-border text-brand-slate-400 rounded">
              MAX
            </button>
            <input
              type="text"
              class="flex-1 bg-transparent px-3 py-3 text-sm text-slate-200 font-mono text-right"
              placeholder="0"
              value={amount()}
              onInput={(e) => setAmount(e.currentTarget.value)}
            />
            <button class="flex items-center gap-1 px-3 text-sm text-slate-200">
              {currentSymbol()}
              <svg
                class="w-4 h-4 text-brand-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Slider */}
        <div class="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="100"
            value={sliderValue()}
            onInput={(e) => setSliderValue(parseInt(e.currentTarget.value))}
            class="flex-1 h-1 bg-brand-border rounded-full appearance-none cursor-pointer accent-slate-400"
          />
          <div class="flex items-center bg-brand-screen border border-brand-border rounded-lg overflow-hidden">
            <input
              type="text"
              class="w-12 bg-transparent px-2 py-2 text-sm text-slate-200 font-mono text-right"
              value={sliderValue()}
              onInput={(e) =>
                setSliderValue(parseInt(e.currentTarget.value) || 0)
              }
            />
            <span class="px-2 text-sm text-brand-slate-400">%</span>
          </div>
        </div>

        {/* Checkboxes */}
        <div class="space-y-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={reduceOnly()}
              onChange={(e) => setReduceOnly(e.currentTarget.checked)}
              class="w-4 h-4 rounded border-brand-border bg-brand-screen"
            />
            <span class="text-sm text-slate-200">Reduce Only</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={tpsl()}
              onChange={(e) => setTpsl(e.currentTarget.checked)}
              class="w-4 h-4 rounded border-brand-border bg-brand-screen"
            />
            <span class="text-sm text-slate-200">Take Profit / Stop Loss</span>
          </label>
        </div>

        {/* Order Details */}
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-brand-slate-400 underline underline-offset-2 decoration-dashed decoration-brand-slate-500">
              Liquidation Price
            </span>
            <span class="text-slate-200 font-mono">--</span>
          </div>
          <div class="flex justify-between">
            <span class="text-brand-slate-400">Order Value</span>
            <span class="text-slate-200 font-mono">$0.00</span>
          </div>
          <div class="flex justify-between">
            <span class="text-brand-slate-400">Margin Required</span>
            <span class="text-slate-200 font-mono">$0.00</span>
          </div>
          <div class="flex justify-between">
            <span class="text-brand-slate-400 underline underline-offset-2 decoration-dashed decoration-brand-slate-500">
              Slippage
            </span>
            <span class="text-slate-200 font-mono">
              Est: 0.0000% / Max: 8.00%
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-brand-slate-400 underline underline-offset-2 decoration-dashed decoration-brand-slate-500">
              Fees
            </span>
            <span class="text-slate-200 font-mono">0.0090% / 0.0030%</span>
          </div>
        </div>
      </div>

      {/* Portfolio Section */}
      <div class="mt-auto border-t border-brand-border bg-brand-screen p-4 space-y-4">
        <div>
          <span class="text-sm text-brand-slate-400">Portfolio Value</span>
          <p class="text-xl font-semibold text-slate-200">$0.00</p>
        </div>

        <div class="flex gap-2">
          <button class="flex-1 py-2 bg-brand-border text-sm font-medium text-slate-200 rounded-lg hover:bg-brand-border/70 transition-colors">
            Deposit
          </button>
          <button class="flex-1 py-2 bg-brand-surface border border-brand-border text-sm font-medium text-brand-slate-400 rounded-lg hover:text-slate-200 transition-colors">
            Transfer
          </button>
          <button class="flex-1 py-2 bg-brand-surface border border-brand-border text-sm font-medium text-brand-slate-400 rounded-lg hover:text-slate-200 transition-colors">
            Withdraw
          </button>
        </div>

        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-brand-slate-400">Spot</span>
            <span class="text-slate-200 font-mono">$0.00</span>
          </div>
          <div class="flex justify-between">
            <span class="text-brand-slate-400">
              Perps <span class="text-brand-accent">[XYZ]</span>
            </span>
            <span class="text-slate-200 font-mono">$0.00</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderForm;
