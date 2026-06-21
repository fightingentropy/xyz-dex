import { createMemo, createRoot, createSignal } from "solid-js";
import { api } from "../../convex/_generated/api";
import { convex, createConvexQuery } from "../lib/convex";
import { isAuthenticated } from "./auth";
import { isVaultTradingAccount } from "./tradingAccount";

export type SpotAsset =
  | "USDC"
  | "USDT"
  | "BTC"
  | "ETH"
  | "SOL"
  | "HYPE"
  | "BNB"
  | "XRP"
  | "ADA"
  | "DOGE"
  | "AVAX"
  | "LINK"
  | "DOT"
  | "LTC"
  | "ATOM";

const SPOT_ASSETS: SpotAsset[] = [
  "USDC",
  "USDT",
  "BTC",
  "ETH",
  "SOL",
  "HYPE",
  "BNB",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "LINK",
  "DOT",
  "LTC",
  "ATOM",
];

const {
  spotBalances,
  transferModalOpen,
  transferDirection,
  openTransferModal,
  closeTransferModal,
} = createRoot(() => {
  const balancesQuery = createConvexQuery(
    api.spot.listSpotBalances,
    () => {
      return isAuthenticated() && !isVaultTradingAccount() ? {} : null;
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

  // Transfer modal state
  const [transferModalOpen, setTransferModalOpen] = createSignal(false);
  const [transferDirection, setTransferDirection] = createSignal<
    "perpsToSpot" | "spotToPerps"
  >("perpsToSpot");

  const openTransferModal = (
    direction: "perpsToSpot" | "spotToPerps" = "perpsToSpot",
  ) => {
    if (isVaultTradingAccount()) return;
    setTransferDirection(direction);
    setTransferModalOpen(true);
  };

  const closeTransferModal = () => setTransferModalOpen(false);

  return {
    spotBalances,
    transferModalOpen,
    transferDirection,
    openTransferModal,
    closeTransferModal,
  };
});

export {
  transferModalOpen,
  transferDirection,
  openTransferModal,
  closeTransferModal,
};

export const getSpotBalance = (asset: SpotAsset) => spotBalances()[asset] ?? 0;
export const getSpotBalances = () => spotBalances();

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
  if (isVaultTradingAccount()) {
    return { ok: false, error: "Vaults can only trade perps." };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "Enter a valid size." };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "Enter a valid price." };
  }
  // Warm up the server oracle for this symbol so the fill settles on a fresh
  // server price (the cron only polls already-held symbols). Best-effort and
  // cheap (no-op when already fresh).
  try {
    await convex.action(api.prices.ensureSymbolFresh, { symbol });
  } catch {
    // ignore; placeSpotOrder derives the fill price server-side regardless
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

export const transferUSDC = async ({
  amount,
  direction,
}: {
  amount: number;
  direction: "perpsToSpot" | "spotToPerps";
}): Promise<{ ok: boolean; error?: string }> => {
  if (!isAuthenticated()) {
    return { ok: false, error: "Sign in to transfer." };
  }
  if (isVaultTradingAccount()) {
    return {
      ok: false,
      error: "Vaults cannot transfer between spot and perps.",
    };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a valid amount." };
  }
  try {
    await convex.mutation(api.spot.transferUSDC, { amount, direction });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer failed.";
    console.error("Failed to transfer USDC:", error);
    return { ok: false, error: message };
  }
};
