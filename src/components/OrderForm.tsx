import {
  Component,
  Show,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";
import { currentMarketType, currentSymbol } from "../stores/market";
import {
  Collateral,
  getAvailableBalance,
  getBalance,
  getMarkPriceForSymbol,
  getPositionForSymbol,
  placeOrder,
  positions,
} from "../stores/clob";
import { isAuthenticated } from "../stores/auth";
import { getSpotBalance, isSpotAsset, placeSpotOrder } from "../stores/wallet";
import { portfolioMetrics } from "../stores/portfolio";

type OrderSide = "long" | "short";
type OrderType = "market" | "limit";

const OrderForm: Component = () => {
  const [side, setSide] = createSignal<OrderSide>("long");
  const [orderType, setOrderType] = createSignal<OrderType>("market");
  const [leverage, setLeverage] = createSignal(25);
  const [leverageMenuOpen, setLeverageMenuOpen] = createSignal(false);
  const [marginType, setMarginType] = createSignal<"isolated" | "cross">(
    "isolated",
  );
  const [amount, setAmount] = createSignal("");
  const [limitPrice, setLimitPrice] = createSignal("");
  const [sliderValue, setSliderValue] = createSignal(0);
  const [reduceOnly, setReduceOnly] = createSignal(false);
  const [tpsl, setTpsl] = createSignal(false);
  const [takeProfit, setTakeProfit] = createSignal("");
  const [stopLoss, setStopLoss] = createSignal("");
  const [collateral] = createSignal<Collateral>("USDC");
  const [spotError, setSpotError] = createSignal("");
  const [orderError, setOrderError] = createSignal("");

  const isLong = () => side() === "long";
  const isSpot = createMemo(() => currentMarketType() === "spot");
  const spotAsset = createMemo(() => {
    const symbol = currentSymbol();
    return isSpotAsset(symbol) ? symbol : null;
  });
  const effectiveLeverage = createMemo(() => (isSpot() ? 1 : leverage()));
  const leverageOptions = [2, 5, 10, 15, 20, 25, 35, 50, 75, 100];
  const currentPosition = createMemo(() =>
    getPositionForSymbol(currentSymbol()),
  );
  const mark = createMemo(() => getMarkPriceForSymbol(currentSymbol()));
  const parsedAmount = createMemo(() => parseFloat(amount()));
  const parsedLimitPrice = createMemo(() => parseFloat(limitPrice()));
  const availableBalance = createMemo(() => {
    if (!isSpot()) return getAvailableBalance(collateral());
    if (isLong()) return getSpotBalance("USDC");
    const asset = spotAsset();
    return asset ? getSpotBalance(asset) : 0;
  });
  const orderPrice = createMemo(() => {
    if (orderType() === "limit" && Number.isFinite(parsedLimitPrice())) {
      return parsedLimitPrice();
    }
    return mark();
  });
  const canReduceOnly = createMemo(() => !isSpot());
  const reduceMaxSize = createMemo(() => {
    if (isSpot()) return 0;
    const position = currentPosition();
    if (!position) return 0;
    const isReducing = isLong() ? position.size < 0 : position.size > 0;
    return isReducing ? Math.abs(position.size) : 0;
  });
  const baseMaxSize = createMemo(() => {
    const price = orderPrice();
    if (!Number.isFinite(price) || price <= 0) return 0;
    if (isSpot()) {
      return isLong() ? availableBalance() / price : availableBalance();
    }
    if (effectiveLeverage() <= 0) return 0;
    return (availableBalance() * effectiveLeverage()) / price;
  });
  const maxSize = createMemo(() =>
    canReduceOnly() && reduceOnly() ? reduceMaxSize() : baseMaxSize(),
  );
  const orderSize = createMemo(() =>
    Number.isFinite(parsedAmount()) && parsedAmount() > 0 ? parsedAmount() : 0,
  );
  const orderValue = createMemo(() => {
    if (orderSize() <= 0) return 0;
    const price = orderPrice();
    return Number.isFinite(price) ? orderSize() * price : 0;
  });
  const marginRequired = createMemo(() => {
    if (isSpot()) return 0;
    if (orderValue() <= 0 || effectiveLeverage() <= 0) return 0;
    return orderValue() / effectiveLeverage();
  });
  const liquidationPreview = createMemo(() => {
    if (isSpot()) return "--";
    const price = orderPrice();
    if (!Number.isFinite(price) || price <= 0 || effectiveLeverage() <= 0) {
      return "--";
    }
    const factor = 1 / effectiveLeverage();
    const liq = isLong() ? price * (1 - factor) : price * (1 + factor);
    return liq > 0 ? liq.toFixed(3) : "--";
  });
  const reduceOnlyError = createMemo(() => {
    if (!canReduceOnly() || !reduceOnly()) return "";
    if (reduceMaxSize() <= 0) {
      return "Reduce-only requires an opposing position.";
    }
    if (orderSize() > reduceMaxSize()) {
      return "Reduce-only size exceeds position.";
    }
    return "";
  });
  const isOrderValid = createMemo(() => {
    if (orderSize() <= 0) return false;
    if (orderType() === "limit") {
      return (
        Number.isFinite(parsedLimitPrice()) &&
        parsedLimitPrice() > 0 &&
        !reduceOnlyError()
      );
    }
    return !reduceOnlyError();
  });

  const formatUsd = (value: number) => {
    if (!Number.isFinite(value)) return "--";
    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatSignedUsd = (value: number) => {
    if (!Number.isFinite(value)) return "--";
    const sign = value >= 0 ? "+" : "-";
    return `${sign}${formatUsd(Math.abs(value))}`;
  };

  const formatAmount = (value: number, decimals: number) =>
    value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  const spotDecimals = (symbol: string | null) => (symbol === "BTC" ? 6 : 4);

  const availableLabel = createMemo(() => {
    if (!isSpot()) return "Available to Trade";
    if (isLong()) return "Available USDC";
    const asset = spotAsset();
    return `Available ${asset ?? currentSymbol()}`;
  });

  const availableDisplay = createMemo(() => {
    if (!isSpot()) {
      return `${formatUsd(availableBalance())} ${collateral()}`;
    }
    if (isLong()) return `${formatUsd(availableBalance())} USDC`;
    const asset = spotAsset();
    return `${formatAmount(
      availableBalance(),
      spotDecimals(asset),
    )} ${asset ?? currentSymbol()}`;
  });

  const positionLabel = createMemo(() =>
    isSpot() ? "Spot Balance" : "Current Position",
  );

  const positionDisplay = createMemo(() => {
    if (isSpot()) {
      const asset = spotAsset();
      const balance = asset ? getSpotBalance(asset) : 0;
      return `${formatAmount(balance, spotDecimals(asset))} ${
        asset ?? currentSymbol()
      }`;
    }
    return currentPosition()
      ? `${currentPosition()!.size.toFixed(4)} ${currentSymbol()}`
      : `0 ${currentSymbol()}`;
  });
  const positionValueClass = createMemo(() => {
    if (isSpot()) {
      const asset = spotAsset();
      const balance = asset ? getSpotBalance(asset) : 0;
      return balance > 0 ? "text-slate-100" : "text-brand-slate-400";
    }
    const position = currentPosition();
    if (!position || position.size === 0) return "text-brand-slate-400";
    return position.size > 0 ? "text-brand-green-400" : "text-brand-red-400";
  });

  const sizePrecision = createMemo(() =>
    isSpot() ? spotDecimals(spotAsset()) : 4,
  );
  const longLabel = createMemo(() => (isSpot() ? "Buy" : "Buy / Long"));
  const shortLabel = createMemo(() => (isSpot() ? "Sell" : "Sell / Short"));
  const metrics = createMemo(() => portfolioMetrics());
  const perpsBalance = createMemo(
    () => getBalance("USDC") + getBalance("USDT"),
  );
  const spotEquity = createMemo(() => metrics()?.spotEquity ?? 0);
  const perpsEquity = createMemo(
    () => metrics()?.perpsEquity ?? perpsBalance(),
  );
  const unrealizedPnl = createMemo(() => {
    return positions().reduce((sum, position) => {
      const currentMark = getMarkPriceForSymbol(position.symbol);
      if (!Number.isFinite(currentMark) || currentMark <= 0) return sum;
      return sum + (currentMark - position.entryPrice) * position.size;
    }, 0);
  });
  const marginUsed = createMemo(() => {
    return positions().reduce((sum, position) => {
      const currentMark = getMarkPriceForSymbol(position.symbol);
      if (
        !Number.isFinite(currentMark) ||
        currentMark <= 0 ||
        position.leverage <= 0
      ) {
        return sum;
      }
      const notional = Math.abs(position.size) * currentMark;
      return sum + notional / position.leverage;
    }, 0);
  });
  const crossMarginRatio = createMemo(() => {
    const equity = perpsEquity();
    if (!Number.isFinite(equity) || equity <= 0) return 0;
    return (marginUsed() / equity) * 100;
  });
  const orderValueDisplay = createMemo(() =>
    orderValue() > 0 ? formatUsd(orderValue()) : "N/A",
  );
  const marginRequiredDisplay = createMemo(() =>
    marginRequired() > 0 ? formatUsd(marginRequired()) : "N/A",
  );

  const clampPercent = (value: number) =>
    Math.min(100, Math.max(0, Math.round(value)));

  const updateAmountInput = (value: string) => {
    setAmount(value);
    const max = maxSize();
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || max <= 0) {
      setSliderValue(0);
      return;
    }
    const percent = clampPercent((parsed / max) * 100);
    setSliderValue(percent);
  };

  const updateFromSlider = (value: number) => {
    const percent = clampPercent(Number.isFinite(value) ? value : 0);
    const max = maxSize();
    if (!Number.isFinite(max) || max <= 0) {
      setSliderValue(0);
      setAmount("");
      return;
    }
    setSliderValue(percent);
    const size = (max * percent) / 100;
    setAmount(size > 0 ? size.toFixed(sizePrecision()) : "");
  };

  createEffect(() => {
    if (isSpot() && reduceOnly()) {
      setReduceOnly(false);
    }
  });

  createEffect(() => {
    if (!isSpot()) {
      setSpotError("");
    }
  });
  createEffect(() => {
    if (isSpot()) {
      setOrderError("");
    }
  });

  createEffect(() => {
    const max = maxSize();
    const size = orderSize();
    if (size <= 0 || max <= 0) {
      setSliderValue(0);
      return;
    }
    const next = clampPercent((size / max) * 100);
    if (next !== sliderValue()) {
      setSliderValue(next);
    }
  });

  const submitOrder = async () => {
    if (!isOrderValid()) return;
    if (!isAuthenticated()) {
      const message = "Sign in to trade.";
      if (isSpot()) {
        setSpotError(message);
      } else {
        setOrderError(message);
      }
      return;
    }
    if (isSpot()) {
      const asset = spotAsset();
      if (!asset) {
        setSpotError("Spot asset unavailable.");
        return;
      }
      const result = await placeSpotOrder({
        symbol: asset,
        side: isLong() ? "buy" : "sell",
        size: orderSize(),
        price: orderPrice(),
      });
      if (!result.ok) {
        setSpotError(result.error ?? "Spot order failed.");
        return;
      }
      setSpotError("");
      setOrderError("");
      setAmount("");
      setSliderValue(0);
      return;
    }

    const result = await placeOrder({
      symbol: currentSymbol(),
      side: isLong() ? "buy" : "sell",
      type: orderType(),
      size: orderSize(),
      price: orderType() === "limit" ? parsedLimitPrice() : undefined,
      leverage: leverage(),
      collateral: collateral(),
      marginType: marginType(),
    });
    if (!result.ok) {
      setOrderError(result.error ?? "Order failed.");
      return;
    }
    setOrderError("");
    setAmount("");
    setSliderValue(0);
  };

  return (
    <div class="flex flex-col bg-brand-surface border-l border-brand-border h-full overflow-auto">
      <div class="bg-brand-screen/60 border-b border-brand-border p-3 space-y-3">
        <Show when={!isSpot()}>
          <div class="space-y-2">
            <div class="grid grid-cols-3 gap-2">
              <button
                class="rounded-xl bg-brand-border/70 py-2 text-sm font-semibold text-slate-100"
                onClick={() =>
                  setMarginType(
                    marginType() === "isolated" ? "cross" : "isolated",
                  )
                }
              >
                {marginType() === "isolated" ? "Isolated" : "Cross"}
              </button>
              <button
                class="rounded-xl bg-brand-border/70 py-2 text-sm font-semibold text-slate-100"
                onClick={() => setLeverageMenuOpen(!leverageMenuOpen())}
              >
                {leverage()}x
              </button>
              <button class="rounded-xl bg-brand-border/70 py-2 text-sm font-semibold text-slate-100">
                Classic
              </button>
            </div>
            <Show when={leverageMenuOpen()}>
              <div class="rounded-xl border border-brand-border bg-brand-surface p-2">
                <div class="grid grid-cols-5 gap-2">
                  {leverageOptions.map((option) => (
                    <button
                      class={`rounded-md border px-2 py-1 text-xs ${
                        leverage() === option
                          ? "border-brand-accent text-brand-accent bg-brand-accent/10"
                          : "border-brand-border text-brand-slate-400 hover:text-slate-200"
                      }`}
                      onClick={() => {
                        setLeverage(option);
                        setLeverageMenuOpen(false);
                      }}
                    >
                      {option}x
                    </button>
                  ))}
                </div>
              </div>
            </Show>
          </div>
        </Show>

        {/* Order Type */}
        <div class="flex items-center gap-6 border-b border-brand-border/70">
          <button
            class={`relative pb-3 text-sm font-semibold transition-colors after:content-[''] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full ${
              orderType() === "market"
                ? "text-slate-100 after:bg-brand-accent"
                : "text-brand-slate-400 hover:text-slate-200 after:bg-transparent"
            }`}
            onClick={() => setOrderType("market")}
          >
            Market
          </button>
          <button
            class={`relative pb-3 text-sm font-semibold transition-colors after:content-[''] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full ${
              orderType() === "limit"
                ? "text-slate-100 after:bg-brand-accent"
                : "text-brand-slate-400 hover:text-slate-200 after:bg-transparent"
            }`}
            onClick={() => {
              setOrderType("limit");
              if (!limitPrice()) {
                const price = mark();
                if (Number.isFinite(price) && price > 0) {
                  setLimitPrice(price.toFixed(3));
                }
              }
            }}
          >
            Limit
          </button>
          <div class="flex-1" />
          <button class="flex items-center gap-1 pb-3 text-sm text-brand-slate-400 hover:text-slate-200">
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

        {/* Long/Short Toggle */}
        <div class="rounded-xl bg-brand-border/60 p-1">
          <div class="flex">
            <button
              class={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                isLong()
                  ? "bg-brand-accent text-brand-screen"
                  : "text-brand-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setSide("long")}
            >
              {longLabel()}
            </button>
            <button
              class={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                !isLong()
                  ? "bg-brand-accent text-brand-screen"
                  : "text-brand-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setSide("short")}
            >
              {shortLabel()}
            </button>
          </div>
        </div>
      </div>

      <div class="p-3 space-y-4">
        {/* Available & Position Info */}
        <div class="space-y-2">
          <div class="flex justify-between text-sm">
            <span class="text-brand-slate-500">{availableLabel()}</span>
            <span class="text-slate-100 font-mono">{availableDisplay()}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-brand-slate-500">{positionLabel()}</span>
            <span class={`font-mono ${positionValueClass()}`}>
              {positionDisplay()}
            </span>
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <div class="flex items-center rounded-xl border border-brand-border bg-brand-screen px-3 py-3">
            <input
              type="text"
              inputmode="decimal"
              pattern="[0-9]*[.]?[0-9]*"
              autocomplete="off"
              class="flex-1 bg-transparent text-sm text-slate-100 font-mono text-left"
              placeholder="Size"
              value={amount()}
              onInput={(e) => updateAmountInput(e.currentTarget.value)}
            />
            <button class="flex items-center gap-2 text-sm text-slate-100">
              {currentSymbol()}
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
        </div>

        <Show when={orderType() === "limit"}>
          <div>
            <div class="flex items-center rounded-xl border border-brand-border bg-brand-screen px-3 py-3">
              <span class="text-sm text-brand-slate-400">Price</span>
              <input
                type="text"
                inputmode="decimal"
                pattern="[0-9]*[.]?[0-9]*"
                autocomplete="off"
                class="flex-1 bg-transparent px-3 text-sm text-slate-100 font-mono text-right"
                placeholder={mark().toFixed(3)}
                value={limitPrice()}
                onInput={(e) => setLimitPrice(e.currentTarget.value)}
              />
              <span class="text-xs text-brand-slate-400">
                {isSpot() ? "USDC" : collateral()}
              </span>
            </div>
          </div>
        </Show>

        {/* Slider */}
        <div class="flex items-center gap-3">
          <div class="relative flex-1">
            <div class="absolute inset-0 flex items-center">
              <div class="h-1.5 w-full rounded-full bg-brand-border/70" />
            </div>
            <div class="absolute inset-0 flex items-center">
              <div
                class="h-1.5 rounded-full bg-brand-accent"
                style={{ width: `${sliderValue()}%` }}
              />
            </div>
            <div class="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
              <span class="h-2 w-2 rounded-full bg-brand-border/70" />
              <span class="h-2 w-2 rounded-full bg-brand-border/70" />
              <span class="h-2 w-2 rounded-full bg-brand-border/70" />
              <span class="h-2 w-2 rounded-full bg-brand-border/70" />
              <span class="h-2 w-2 rounded-full bg-brand-border/70" />
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={sliderValue()}
              onInput={(e) =>
                updateFromSlider(parseInt(e.currentTarget.value, 10))
              }
              class="order-slider relative z-10 w-full"
            />
          </div>
          <div class="flex items-center rounded-xl border border-brand-border bg-brand-screen px-3 py-2 text-sm">
            <input
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              class="w-10 bg-transparent text-right font-mono text-slate-100"
              value={sliderValue()}
              onInput={(e) =>
                updateFromSlider(parseInt(e.currentTarget.value, 10) || 0)
              }
            />
            <span class="ml-1 text-brand-slate-400">%</span>
          </div>
        </div>

        {/* Checkboxes */}
        <Show when={!isSpot()}>
          <div class="space-y-2">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={reduceOnly()}
                onChange={(e) => setReduceOnly(e.currentTarget.checked)}
                class="h-5 w-5 rounded-md border border-brand-border bg-brand-screen accent-brand-accent"
              />
              <span class="text-sm text-slate-100">Reduce Only</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={tpsl()}
                onChange={(e) => setTpsl(e.currentTarget.checked)}
                class="h-5 w-5 rounded-md border border-brand-border bg-brand-screen accent-brand-accent"
              />
              <span class="text-sm text-slate-100">
                Take Profit / Stop Loss
              </span>
            </label>
          </div>

          <Show when={reduceOnlyError()}>
            <div class="text-xs text-brand-red-400">{reduceOnlyError()}</div>
          </Show>

          <Show when={tpsl()}>
            <div class="space-y-2">
              <div class="flex items-center bg-brand-screen border border-brand-border rounded-lg overflow-hidden">
                <span class="px-3 text-sm text-brand-slate-400">
                  Take Profit
                </span>
                <input
                  type="text"
                  inputmode="decimal"
                  pattern="[0-9]*[.]?[0-9]*"
                  autocomplete="off"
                  class="flex-1 bg-transparent px-3 py-3 text-sm text-slate-200 font-mono text-right"
                  placeholder="--"
                  value={takeProfit()}
                  onInput={(e) => setTakeProfit(e.currentTarget.value)}
                />
              </div>
              <div class="flex items-center bg-brand-screen border border-brand-border rounded-lg overflow-hidden">
                <span class="px-3 text-sm text-brand-slate-400">Stop Loss</span>
                <input
                  type="text"
                  inputmode="decimal"
                  pattern="[0-9]*[.]?[0-9]*"
                  autocomplete="off"
                  class="flex-1 bg-transparent px-3 py-3 text-sm text-slate-200 font-mono text-right"
                  placeholder="--"
                  value={stopLoss()}
                  onInput={(e) => setStopLoss(e.currentTarget.value)}
                />
              </div>
            </div>
          </Show>
        </Show>

        <Show when={spotError()}>
          <div class="text-xs text-brand-red-400">{spotError()}</div>
        </Show>
        <Show when={orderError()}>
          <div class="text-xs text-brand-red-400">{orderError()}</div>
        </Show>

        {/* Order Details */}
        <Show
          when={!isSpot()}
          fallback={
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-brand-slate-500">Order Value</span>
                <span class="text-slate-100 font-mono">
                  {orderValueDisplay()}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-brand-slate-500">Estimated Fee</span>
                <span class="text-slate-100 font-mono">0.10%</span>
              </div>
            </div>
          }
        >
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-brand-slate-500 underline underline-offset-2 decoration-dashed decoration-brand-slate-500">
                Liquidation Price
              </span>
              <span class="text-slate-100 font-mono">
                {liquidationPreview()}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-brand-slate-500">Order Value</span>
              <span class="text-slate-100 font-mono">
                {orderValueDisplay()}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-brand-slate-500">Margin Required</span>
              <span class="text-slate-100 font-mono">
                {marginRequiredDisplay()}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-brand-slate-500 underline underline-offset-2 decoration-dashed decoration-brand-slate-500">
                Slippage
              </span>
              <span class="font-mono text-brand-accent">
                Est: 0% / Max: 1.00%
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-brand-slate-500 underline underline-offset-2 decoration-dashed decoration-brand-slate-500">
                Fees
              </span>
              <span class="font-mono text-brand-accent">
                0% / 0%
              </span>
            </div>
          </div>
        </Show>

        <button
          class={`w-full rounded-xl py-3 text-sm font-semibold transition-colors ${
            isOrderValid()
              ? "bg-brand-accent text-brand-screen hover:brightness-105"
              : "bg-brand-border text-brand-slate-500 cursor-not-allowed"
          }`}
          onClick={submitOrder}
          disabled={!isOrderValid()}
        >
          Place Order
        </button>
      </div>

      {/* Portfolio Section */}
      <div class="mt-auto border-t border-brand-border bg-brand-screen px-4 py-5 space-y-4">
        <div class="flex gap-3">
          <button class="flex-1 rounded-xl bg-brand-accent py-2.5 text-sm font-semibold text-brand-screen">
            Deposit
          </button>
          <button class="flex-1 rounded-xl border border-brand-accent/60 py-2.5 text-sm font-semibold text-brand-accent hover:bg-brand-accent/10 transition-colors">
            Withdraw
          </button>
        </div>

        <div class="space-y-2 border-t border-brand-border/70 pt-3">
          <div class="text-sm text-brand-slate-500">Account Overview</div>
          <div class="flex justify-between text-sm">
            <span class="text-brand-slate-500">Balance</span>
            <span class="font-mono text-slate-100">
              {formatUsd(perpsBalance() + spotEquity())}
            </span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-brand-slate-500">Unrealized PNL</span>
            <span
              class={`font-mono ${
                unrealizedPnl() >= 0
                  ? "text-brand-green-400"
                  : "text-brand-red-400"
              }`}
            >
              {formatSignedUsd(unrealizedPnl())}
            </span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-brand-slate-500">Cross Margin Ratio</span>
            <span class="font-mono text-brand-accent">
              {crossMarginRatio().toFixed(2)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderForm;
