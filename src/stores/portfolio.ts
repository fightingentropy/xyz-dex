import { createRoot } from "solid-js";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { createConvexQuery } from "../lib/convex";
import { isAuthenticated } from "./auth";

export type Trade = Doc<"trades">;
export type PortfolioMetrics =
  | {
      totalEquity: number;
      perpsEquity: number;
      spotEquity: number;
      pnl: number;
      volume: number;
      updatedAt: number;
    }
  | null
  | undefined;

const TRADE_HISTORY_LIMIT = 500;

const { tradeHistory, portfolioMetrics } = createRoot(() => {
  const tradesQuery = createConvexQuery(
    api.trades.listTrades,
    () => {
      return isAuthenticated() ? { limit: TRADE_HISTORY_LIMIT } : null;
    },
    [],
  );

  const metricsQuery = createConvexQuery(api.portfolio.getMetrics, () => {
    return isAuthenticated() ? {} : null;
  });

  return {
    tradeHistory: () => tradesQuery() ?? [],
    portfolioMetrics: () => metricsQuery() ?? null,
  };
});

export { tradeHistory, portfolioMetrics };
