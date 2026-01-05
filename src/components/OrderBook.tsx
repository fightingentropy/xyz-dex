import {
  Component,
  For,
  createMemo,
  createSignal,
  createEffect,
  onCleanup,
  onMount,
} from "solid-js";
import { currentSymbol, markPrice } from "../stores/market";
import { fetchL2Book, OrderBookLevel } from "../lib/binance";

const OrderBook: Component = () => {
  const [asks, setAsks] = createSignal<OrderBookLevel[]>([]);
  const [bids, setBids] = createSignal<OrderBookLevel[]>([]);
  const [spread, setSpread] = createSignal(0);
  const [spreadPercent, setSpreadPercent] = createSignal(0);
  const [isTabVisible, setIsTabVisible] = createSignal(!document.hidden);
  let pollTimer: number | undefined;
  let controller: AbortController | undefined;
  let requestId = 0;

  const handleVisibilityChange = () => {
    setIsTabVisible(!document.hidden);
  };

  onMount(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  });

  const fetchOrderBook = async (coin: string) => {
    const currentRequestId = ++requestId;
    controller?.abort();
    const nextController = new AbortController();
    controller = nextController;

    const book = await fetchL2Book(coin, nextController.signal);
    if (book) {
      if (
        currentRequestId !== requestId ||
        nextController.signal.aborted ||
        !isTabVisible() ||
        currentSymbol() !== coin
      ) {
        return;
      }
      setAsks(book.asks);
      setBids(book.bids);

      // Calculate spread
      if (book.asks.length > 0 && book.bids.length > 0) {
        const bestAsk = book.asks[book.asks.length - 1]?.price || 0;
        const bestBid = book.bids[0]?.price || 0;
        const spreadVal = bestAsk - bestBid;
        setSpread(spreadVal);
        if (bestBid > 0) {
          setSpreadPercent((spreadVal / bestBid) * 100);
        }
      }
    }
  };

  // Start polling and react to symbol changes
  createEffect(() => {
    const coin = currentSymbol();
    const visible = isTabVisible();

    // Clear previous timer
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    controller?.abort();

    if (!visible) return;

    // Initial fetch
    fetchOrderBook(coin);

    // Poll every 1 second for order book updates
    pollTimer = setInterval(
      () => fetchOrderBook(coin),
      1000,
    ) as unknown as number;
  });

  onCleanup(() => {
    if (pollTimer) clearInterval(pollTimer);
    controller?.abort();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });

  const formatSize = (size: number) => size.toFixed(2);

  const maxTotal = createMemo(() => {
    let max = 1;
    const askList = asks();
    const bidList = bids();
    for (let i = 0; i < askList.length; i += 1) {
      const total = askList[i].total;
      if (total > max) max = total;
    }
    for (let i = 0; i < bidList.length; i += 1) {
      const total = bidList[i].total;
      if (total > max) max = total;
    }
    return max;
  });

  // Determine decimal places based on price
  const priceDecimals = createMemo(() => {
    const price = bids()[0]?.price || asks()[0]?.price || 0;
    if (price >= 1000) return 2;
    if (price >= 100) return 2;
    if (price >= 1) return 3;
    return 5;
  });

  return (
    <div class="flex flex-col h-full bg-brand-surface border-l border-brand-border">
      {/* Header */}
      <div class="flex items-center justify-between px-3 py-2 border-b border-brand-border">
        <span class="text-xs font-medium text-slate-200">Order Book</span>
        <div class="flex gap-1">
          <button class="p-1 rounded hover:bg-slate-800">
            <svg
              class="w-4 h-4 text-brand-slate-400"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <rect x="2" y="2" width="5" height="12" rx="1" />
              <rect x="9" y="2" width="5" height="12" rx="1" />
            </svg>
          </button>
          <button class="p-1 rounded bg-slate-800">
            <svg
              class="w-4 h-4 text-brand-accent"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <rect x="2" y="2" width="12" height="5" rx="1" />
              <rect x="2" y="9" width="12" height="5" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Column Headers */}
      <div class="grid grid-cols-3 gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-brand-slate-500">
        <div>Price</div>
        <div class="text-right">Size</div>
        <div class="text-right">Total</div>
      </div>

      {/* Asks */}
      <div class="flex-1 overflow-hidden flex flex-col justify-end">
        <For each={asks()}>
          {(level) => (
            <div class="grid grid-cols-3 gap-2 px-3 py-0.5 text-xs relative">
              <div
                class="absolute inset-0 bg-brand-red-400/10"
                style={{
                  width: `${(level.total / maxTotal()) * 100}%`,
                  right: 0,
                  left: "auto",
                }}
              />
              <div class="text-brand-red-400 font-mono relative z-10">
                {level.price.toFixed(priceDecimals())}
              </div>
              <div class="text-right text-slate-300 font-mono relative z-10">
                {formatSize(level.size)}
              </div>
              <div class="text-right text-brand-slate-400 font-mono relative z-10">
                {formatSize(level.total)}
              </div>
            </div>
          )}
        </For>
      </div>

      {/* Spread */}
      <div class="px-3 py-2 border-y border-brand-border bg-brand-screen/50">
        <div class="flex items-center justify-between text-xs">
          <span class="text-brand-green-400 font-mono font-semibold">
            {markPrice()}
          </span>
          <span class="text-brand-slate-500">
            Spread: {spreadPercent().toFixed(3)}%
          </span>
        </div>
      </div>

      {/* Bids */}
      <div class="flex-1 overflow-hidden">
        <For each={bids()}>
          {(level) => (
            <div class="grid grid-cols-3 gap-2 px-3 py-0.5 text-xs relative">
              <div
                class="absolute inset-0 bg-brand-green-400/10"
                style={{
                  width: `${(level.total / maxTotal()) * 100}%`,
                  right: 0,
                  left: "auto",
                }}
              />
              <div class="text-brand-green-400 font-mono relative z-10">
                {level.price.toFixed(priceDecimals())}
              </div>
              <div class="text-right text-slate-300 font-mono relative z-10">
                {formatSize(level.size)}
              </div>
              <div class="text-right text-brand-slate-400 font-mono relative z-10">
                {formatSize(level.total)}
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default OrderBook;
