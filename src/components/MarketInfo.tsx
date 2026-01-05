import { Component } from "solid-js";
import {
  currentMarket,
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

  return (
    <div class="flex items-center gap-4 px-4 py-2 bg-brand-surface border-b border-brand-border">
      {/* Market Selector */}
      <button
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-800/50 transition-colors"
        onClick={() => setSearchOpen(true)}
      >
        <div class="w-6 h-6 rounded-full bg-brand-screen flex items-center justify-center border border-brand-border text-[10px] font-semibold text-slate-200">
          {currentSymbol().slice(0, 4)}
        </div>
        <span class="font-semibold text-slate-100">{currentMarket()}</span>
        <span class="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded">
          10x
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
        <div class="flex flex-col">
          <span class="text-slate-200 font-mono">{openInterest()}</span>
          <span class="text-xs text-brand-slate-500">Open Interest</span>
        </div>
        <div class="flex flex-col">
          <span class={`font-mono ${fundingColor()}`}>{fundingRate()}</span>
          <span class="text-xs text-brand-slate-500">8h Funding</span>
        </div>
      </div>
    </div>
  );
};

export default MarketInfo;
