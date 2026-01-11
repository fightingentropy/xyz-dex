import {
  Component,
  Show,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  currentMarket,
  currentMarketLeverage,
  currentMarketType,
  currentSymbol,
  markPrice,
  oraclePrice,
  change24h,
  volume24h,
  openInterest,
  fundingRate,
  setSearchOpen,
} from "../stores/market";

const ChevronDown = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="text-brand-slate-400"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const MarketInfo: Component = () => {
  const [fundingCountdown, setFundingCountdown] = createSignal("00:00:00");

  const leverageLabel = () =>
    currentMarketType() === "spot" ? "Spot" : currentMarketLeverage();
  const changeColor = () => {
    const val = change24h();
    if (!Number.isFinite(val)) return "text-brand-slate-500";
    return val >= 0 ? "text-brand-green-400" : "text-brand-red-400";
  };
  const changeText = () => {
    const val = change24h();
    if (!Number.isFinite(val)) return "--";
    const sign = val >= 0 ? "+" : "";
    return `${sign}${val.toFixed(2)}%`;
  };
  const fundingColor = () => {
    const rate = fundingRate();
    if (rate === "--") return "text-brand-slate-500";
    return rate.startsWith("-") ? "text-brand-red-400" : "text-brand-green-400";
  };

  const formatFundingCountdown = () => {
    const now = new Date();
    
    // Get current time in UK (Europe/London timezone)
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    
    const parts = formatter.formatToParts(now);
    const getPart = (type: string) => {
      const part = parts.find(p => p.type === type);
      return part ? parseInt(part.value, 10) : 0;
    };
    
    const ukYear = getPart("year");
    const ukMonth = getPart("month") - 1; // JavaScript months are 0-indexed
    const ukDay = getPart("day");
    const ukHour = getPart("hour");
    const ukMinute = getPart("minute");
    const ukSecond = getPart("second");
    
    // Funding payment times: 7pm (19:00), 3am (03:00), 11am (11:00) UK time
    const fundingHours = [19, 3, 11]; // 7pm, 3am, 11am
    
    // Find the next funding hour
    let nextHour = fundingHours.find(h => h > ukHour);
    let daysToAdd = 0;
    
    if (nextHour === undefined) {
      // Current hour is after 7pm, next payment is 3am tomorrow
      nextHour = fundingHours[0]; // 3am
      daysToAdd = 1;
    }

    // Find the local time that corresponds to the next funding payment time in UK
    // We'll start with an estimate and refine it
    const currentUKTimeMs = (ukHour * 60 + ukMinute) * 60 * 1000 + ukSecond * 1000;
    const nextUKTimeMs = nextHour * 60 * 60 * 1000;
    let msUntilNextUK = nextUKTimeMs - currentUKTimeMs;
    
    if (msUntilNextUK <= 0) {
      // Next payment is tomorrow
      msUntilNextUK += 24 * 60 * 60 * 1000;
    }
    
    // Start with an estimate
    let candidate = new Date(now.getTime() + msUntilNextUK);
    
    // Refine the candidate by checking what UK time it represents
    // and adjusting until we find the exact time
    for (let i = 0; i < 48; i++) {
      const candidateUK = candidate.toLocaleString("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const candidateParts = candidateUK.split(":");
      const candidateHour = parseInt(candidateParts[0], 10);
      const candidateMinute = parseInt(candidateParts[1], 10);
      
      // Check if we've found the right time (within 1 minute)
      if (candidateHour === nextHour && candidateMinute === 0) {
        break;
      }
      
      // Adjust the candidate time
      if (candidateHour < nextHour || (candidateHour === 23 && nextHour === 0)) {
        // Need to move forward
        candidate = new Date(candidate.getTime() + 60 * 1000);
      } else {
        // Need to move backward
        candidate = new Date(candidate.getTime() - 60 * 1000);
      }
    }
    
    const remaining = Math.max(0, candidate.getTime() - now.getTime());
    const totalSeconds = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0"),
    ].join(":");
  };

  createEffect(() => {
    if (currentMarketType() === "spot") {
      setFundingCountdown("--:--:--");
      return;
    }
    const update = () => setFundingCountdown(formatFundingCountdown());
    update();
    const timer = setInterval(update, 1000);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <div class="flex items-center gap-4 px-4 py-2 bg-brand-surface border-b border-brand-border">
      {/* Market Selector */}
      <button
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-800/50 transition-colors"
        onClick={() => setSearchOpen(true)}
      >
        <Show
          when={["BTC", "ETH", "HYPE", "SOL", "ZEC"].includes(currentSymbol())}
          fallback={
            <div class="w-6 h-6 rounded-full bg-brand-screen flex items-center justify-center border border-brand-border text-[10px] font-semibold text-slate-200">
              {currentSymbol().slice(0, 4)}
            </div>
          }
        >
          <img
            src={`/${currentSymbol().toLowerCase()}.svg`}
            alt={currentSymbol()}
            class="w-6 h-6"
          />
        </Show>
        <span class="font-semibold text-slate-100">{currentMarket()}</span>
        <span class="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded">
          {leverageLabel()}
        </span>
        <ChevronDown />
      </button>

      {/* Price */}
      <div class="flex flex-col">
        <span class="text-lg font-bold text-brand-green-400 font-mono">
          {markPrice()}
        </span>
        <span class="text-xs text-brand-slate-400">Mark Price</span>
      </div>

      {/* Stats */}
      <div class="flex items-center gap-6 ml-4 text-sm">
        <div class="flex flex-col">
          <span class={`font-mono ${changeColor()}`}>{changeText()}</span>
          <span class="text-xs text-brand-slate-500">24h Change</span>
        </div>
        <div class="flex flex-col">
          <span class="text-slate-200 font-mono">{oraclePrice()}</span>
          <span class="text-xs text-brand-slate-500">Oracle</span>
        </div>
        <div class="flex flex-col">
          <span class="text-slate-200 font-mono">{volume24h()}</span>
          <span class="text-xs text-brand-slate-500">24h Volume</span>
        </div>
        <Show when={currentMarketType() !== "spot"}>
          <div class="flex flex-col">
            <span class="text-slate-200 font-mono">{openInterest()}</span>
            <span class="text-xs text-brand-slate-500">Open Interest</span>
          </div>
          <div class="flex flex-col">
            <div class="flex items-center gap-3">
              <span class={`font-mono ${fundingColor()}`}>{fundingRate()}</span>
              <span class="font-mono text-slate-200">{fundingCountdown()}</span>
            </div>
            <span class="text-xs text-brand-slate-500">
              Funding / Countdown
            </span>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default MarketInfo;
