import { createMemo, createRoot } from "solid-js";
import { api } from "../../convex/_generated/api";
import { convex, createConvexQuery } from "../lib/convex";
import { isAuthenticated } from "./auth";

export type SpotAsset =
  | "USDC"
  | "BTC"
  | "HYPE"
  | "ADA"
  | "DOGE"
  | "LINK"
  | "DOT"
  | "ATOM";

export const SPOT_ASSETS: SpotAsset[] = [
  "USDC",
  "BTC",
  "HYPE",
  "ADA",
  "DOGE",
  "LINK",
  "DOT",
  "ATOM",
];

const { spotBalances } = createRoot(() => {
  const balancesQuery = createConvexQuery(
    api.spot.listSpotBalances,
    () => {
      return isAuthenticated() ? {} : null;
    },
    [],
  );

  const spotBalances = createMemo<Record<SpotAsset, number>>(() => {
    const next = SPOT_ASSETS.reduce(
      (acc, asset) => ({ ...acc, [asset]: 0 }),
      {} as Record<SpotAsset, number>,
    );
    const balances = balancesQuery() ?? [];
    for (const balance of balances) {
      if (isSpotAsset(balance.asset)) {
        next[balance.asset] = balance.balance;
      }
    }
    return next;
  });

  return { spotBalances };
});

export const getSpotBalance = (asset: SpotAsset) => spotBalances()[asset] ?? 0;

export const isSpotAsset = (asset: string): asset is SpotAsset =>
  SPOT_ASSETS.includes(asset as SpotAsset);

export const placeSpotOrder = async ({
  symbol,
  side,
  size,
  price,
}: {
  symbol: SpotAsset;
  side: "buy" | "sell";
  size: number;
  price: number;
}): Promise<{ ok: boolean; error?: string }> => {
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to place orders." };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "Enter a valid size." };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "Enter a valid price." };
  }
  try {
    await convex.mutation(api.spot.placeSpotOrder, {
      symbol,
      side,
      size,
      price,
    });
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Spot order failed.";
    console.error("Failed to place spot order:", error);
    return { ok: false, error: message };
  }
};
