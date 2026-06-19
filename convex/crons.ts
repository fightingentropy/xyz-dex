import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Poll Hyperliquid for authoritative server-side prices frequently so the
// marketPrices oracle (convex/lib/prices.ts) stays within FRESHNESS_MS.
// crons.interval supports seconds-granularity in this Convex version.
crons.interval(
  "poll-prices",
  { seconds: 5 },
  internal.prices.pollHyperliquidPrices,
  {},
);

export default crons;
