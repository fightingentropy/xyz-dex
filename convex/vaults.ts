import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUser, requireAuthUser } from "./lib/auth";
import { getDemoPrice } from "./lib/portfolio";

const OWNER_TYPE_VAULT = "vault" as const;
const OWNER_TYPE_USER = "user" as const;
const PERFORMANCE_FEE_RATE = 0.1;

const getVaultMember = async (
  ctx: MutationCtx | QueryCtx,
  vaultId: Id<"vaults">,
  userId: Id<"users">,
) =>
  ctx.db
    .query("vaultMembers")
    .withIndex("by_vault_user", (q) =>
      q.eq("vaultId", vaultId).eq("userId", userId),
    )
    .unique();

const getVaultPerpsBalance = async (
  ctx: MutationCtx | QueryCtx,
  vaultId: Id<"vaults">,
  asset: "USDC" | "USDT",
) =>
  ctx.db
    .query("perpsBalances")
    .withIndex("by_owner_asset", (q) =>
      q
        .eq("ownerType", OWNER_TYPE_VAULT)
        .eq("ownerId", vaultId)
        .eq("asset", asset),
    )
    .unique();

const getUserPerpsBalance = async (
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">,
  asset: "USDC" | "USDT",
) =>
  ctx.db
    .query("perpsBalances")
    .withIndex("by_user_asset", (q) =>
      q.eq("userId", userId).eq("asset", asset),
    )
    .unique();

const calculateVaultEquity = async (
  ctx: MutationCtx | QueryCtx,
  vaultId: Id<"vaults">,
) => {
  const perpsBalances = await ctx.db
    .query("perpsBalances")
    .withIndex("by_owner", (q) =>
      q.eq("ownerType", OWNER_TYPE_VAULT).eq("ownerId", vaultId),
    )
    .collect();
  const spotBalances = await ctx.db
    .query("spotBalances")
    .withIndex("by_owner", (q) =>
      q.eq("ownerType", OWNER_TYPE_VAULT).eq("ownerId", vaultId),
    )
    .collect();

  const perpsEquity = perpsBalances.reduce(
    (sum, balance) => sum + balance.balance,
    0,
  );
  const spotEquity = spotBalances.reduce((sum, balance) => {
    const price = getDemoPrice(balance.asset);
    return sum + balance.balance * price;
  }, 0);

  return perpsEquity + spotEquity;
};

const calculateVaultCostBasis = async (
  ctx: MutationCtx | QueryCtx,
  vaultId: Id<"vaults">,
) => {
  const members = await ctx.db
    .query("vaultMembers")
    .withIndex("by_vault", (q) => q.eq("vaultId", vaultId))
    .collect();
  return members.reduce((sum, member) => sum + member.costBasisUSDC, 0);
};

const upsertVaultMetrics = async (
  ctx: MutationCtx,
  vaultId: Id<"vaults">,
) => {
  const equityUSDC = await calculateVaultEquity(ctx, vaultId);
  const totalCostBasis = await calculateVaultCostBasis(ctx, vaultId);
  const pnl = equityUSDC - totalCostBasis;
  const updatedAt = Date.now();

  const existing = await ctx.db
    .query("vaultMetrics")
    .withIndex("by_vault", (q) => q.eq("vaultId", vaultId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, { equityUSDC, pnl, updatedAt });
    return { equityUSDC, pnl, updatedAt };
  }

  await ctx.db.insert("vaultMetrics", {
    vaultId,
    equityUSDC,
    pnl,
    updatedAt,
  });
  return { equityUSDC, pnl, updatedAt };
};

const resolveSharePrice = (equityUSDC: number, totalShares: number) => {
  if (totalShares <= 0) return 1;
  return equityUSDC / totalShares;
};

const buildVaultSummary = (
  vault: Doc<"vaults">,
  metrics: Doc<"vaultMetrics"> | null,
  member: Doc<"vaultMembers"> | null,
  equityFallback: number | null,
  isOperator: boolean,
) => {
  const equityUSDC = metrics?.equityUSDC ?? equityFallback ?? 0;
  const pnl = metrics?.pnl ?? 0;
  const sharePrice = resolveSharePrice(equityUSDC, vault.totalShares);
  return {
    _id: vault._id,
    name: vault.name,
    operatorUserId: vault.operatorUserId,
    totalShares: vault.totalShares,
    status: vault.status,
    createdAt: vault.createdAt,
    equityUSDC,
    pnl,
    sharePrice,
    memberShares: member?.shares ?? 0,
    memberCostBasisUSDC: member?.costBasisUSDC ?? 0,
    isOperator,
  };
};

export const createVault = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError("Vault name is required.");
    }
    const now = Date.now();
    const vaultId = await ctx.db.insert("vaults", {
      name,
      operatorUserId: user._id,
      totalShares: 0,
      status: "active",
      createdAt: now,
    });
    await ctx.db.insert("vaultMetrics", {
      vaultId,
      equityUSDC: 0,
      pnl: 0,
      updatedAt: now,
    });
    return { vaultId };
  },
});

export const listVaults = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    const [vaults, metrics] = await Promise.all([
      ctx.db.query("vaults").collect(),
      ctx.db.query("vaultMetrics").collect(),
    ]);
    const metricsByVault = new Map(
      metrics.map((metric) => [metric.vaultId, metric]),
    );

    const memberByVault = new Map<Id<"vaults">, Doc<"vaultMembers">>();
    if (user) {
      const members = await ctx.db
        .query("vaultMembers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const member of members) {
        memberByVault.set(member.vaultId, member);
      }
    }

    return vaults.map((vault) =>
      buildVaultSummary(
        vault,
        metricsByVault.get(vault._id) ?? null,
        memberByVault.get(vault._id) ?? null,
        null,
        !!user && user._id === vault.operatorUserId,
      ),
    );
  },
});

export const getVaultDetail = query({
  args: { vaultId: v.id("vaults") },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    const vault = await ctx.db.get(args.vaultId);
    if (!vault) return null;

    const metrics = await ctx.db
      .query("vaultMetrics")
      .withIndex("by_vault", (q) => q.eq("vaultId", vault._id))
      .unique();

    const member = user ? await getVaultMember(ctx, vault._id, user._id) : null;

    let equityFallback: number | null = null;
    let pnlFallback: number | null = null;
    if (!metrics) {
      equityFallback = await calculateVaultEquity(ctx, vault._id);
      const totalCostBasis = await calculateVaultCostBasis(ctx, vault._id);
      pnlFallback = equityFallback - totalCostBasis;
    }

    const summary = buildVaultSummary(
      vault,
      metrics,
      member,
      equityFallback,
      !!user && user._id === vault.operatorUserId,
    );

    const sharePrice = summary.sharePrice;
    const memberValue = summary.memberShares * sharePrice;
    const memberProfit = Math.max(0, memberValue - summary.memberCostBasisUSDC);

    return {
      ...summary,
      pnl: metrics?.pnl ?? pnlFallback ?? summary.pnl,
      memberValueUSDC: memberValue,
      memberProfitUSDC: memberProfit,
      metricsUpdatedAt: metrics?.updatedAt ?? null,
    };
  },
});

export const depositUSDC = mutation({
  args: { vaultId: v.id("vaults"), amount: v.number() },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    if (!Number.isFinite(args.amount) || args.amount <= 0) {
      throw new ConvexError("Enter a valid USDC amount.");
    }

    const vault = await ctx.db.get(args.vaultId);
    if (!vault) {
      throw new ConvexError("Vault not found.");
    }
    if (vault.status !== "active") {
      throw new ConvexError("Vault is not accepting deposits.");
    }

    const equityUSDC = await calculateVaultEquity(ctx, vault._id);
    const sharePrice = resolveSharePrice(equityUSDC, vault.totalShares);
    if (!Number.isFinite(sharePrice) || sharePrice <= 0) {
      throw new ConvexError("Vault share price is unavailable.");
    }

    const mintedShares = args.amount / sharePrice;
    const now = Date.now();

    const userBalance = await getUserPerpsBalance(ctx, user._id, "USDC");
    const userBalanceAmount = userBalance?.balance ?? 0;
    if (args.amount > userBalanceAmount) {
      throw new ConvexError("Insufficient USDC balance.");
    }

    if (userBalance) {
      await ctx.db.patch(userBalance._id, {
        ownerType: OWNER_TYPE_USER,
        ownerId: user._id,
        balance: userBalanceAmount - args.amount,
        updatedAt: now,
      });
    } else {
      throw new ConvexError("Insufficient USDC balance.");
    }

    const vaultBalance = await getVaultPerpsBalance(ctx, vault._id, "USDC");
    if (vaultBalance) {
      await ctx.db.patch(vaultBalance._id, {
        ownerType: OWNER_TYPE_VAULT,
        ownerId: vault._id,
        balance: vaultBalance.balance + args.amount,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("perpsBalances", {
        ownerType: OWNER_TYPE_VAULT,
        ownerId: vault._id,
        asset: "USDC",
        balance: args.amount,
        updatedAt: now,
      });
    }

    const member = await getVaultMember(ctx, vault._id, user._id);
    if (member) {
      await ctx.db.patch(member._id, {
        shares: member.shares + mintedShares,
        costBasisUSDC: member.costBasisUSDC + args.amount,
      });
    } else {
      await ctx.db.insert("vaultMembers", {
        vaultId: vault._id,
        userId: user._id,
        shares: mintedShares,
        costBasisUSDC: args.amount,
        createdAt: now,
      });
    }

    await ctx.db.patch(vault._id, {
      totalShares: vault.totalShares + mintedShares,
    });

    await upsertVaultMetrics(ctx, vault._id);

    return { sharesMinted: mintedShares, sharePrice };
  },
});

export const withdrawUSDC = mutation({
  args: { vaultId: v.id("vaults"), shares: v.number() },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    if (!Number.isFinite(args.shares) || args.shares <= 0) {
      throw new ConvexError("Enter a valid share amount.");
    }

    const vault = await ctx.db.get(args.vaultId);
    if (!vault) {
      throw new ConvexError("Vault not found.");
    }

    const member = await getVaultMember(ctx, vault._id, user._id);
    if (!member || member.shares <= 0) {
      throw new ConvexError("No shares available to withdraw.");
    }
    if (args.shares > member.shares) {
      throw new ConvexError("Withdrawal exceeds available shares.");
    }

    const equityUSDC = await calculateVaultEquity(ctx, vault._id);
    const sharePrice = resolveSharePrice(equityUSDC, vault.totalShares);
    if (!Number.isFinite(sharePrice) || sharePrice < 0) {
      throw new ConvexError("Vault share price is unavailable.");
    }

    const value = args.shares * sharePrice;
    const costBasisPortion =
      member.costBasisUSDC * (args.shares / member.shares);
    const profit = Math.max(0, value - costBasisPortion);
    const fee = profit * PERFORMANCE_FEE_RATE;
    const payout = value - fee;

    const vaultBalance = await getVaultPerpsBalance(ctx, vault._id, "USDC");
    const vaultUsdc = vaultBalance?.balance ?? 0;
    if (value > vaultUsdc) {
      throw new ConvexError("Vault has insufficient USDC liquidity.");
    }

    const now = Date.now();

    if (vaultBalance) {
      await ctx.db.patch(vaultBalance._id, {
        ownerType: OWNER_TYPE_VAULT,
        ownerId: vault._id,
        balance: vaultUsdc - value,
        updatedAt: now,
      });
    }

    const userBalance = await getUserPerpsBalance(ctx, user._id, "USDC");
    if (userBalance) {
      await ctx.db.patch(userBalance._id, {
        ownerType: OWNER_TYPE_USER,
        ownerId: user._id,
        balance: userBalance.balance + payout,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("perpsBalances", {
        userId: user._id,
        ownerType: OWNER_TYPE_USER,
        ownerId: user._id,
        asset: "USDC",
        balance: payout,
        updatedAt: now,
      });
    }

    if (fee > 0) {
      const operatorBalance = await getUserPerpsBalance(
        ctx,
        vault.operatorUserId,
        "USDC",
      );
      if (operatorBalance) {
        await ctx.db.patch(operatorBalance._id, {
          ownerType: OWNER_TYPE_USER,
          ownerId: vault.operatorUserId,
          balance: operatorBalance.balance + fee,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("perpsBalances", {
          userId: vault.operatorUserId,
          ownerType: OWNER_TYPE_USER,
          ownerId: vault.operatorUserId,
          asset: "USDC",
          balance: fee,
          updatedAt: now,
        });
      }

      await ctx.db.insert("vaultFees", {
        vaultId: vault._id,
        operatorUserId: vault.operatorUserId,
        amountUSDC: fee,
        createdAt: now,
      });
    }

    const remainingShares = member.shares - args.shares;
    const remainingCostBasis = member.costBasisUSDC - costBasisPortion;
    await ctx.db.patch(member._id, {
      shares: remainingShares,
      costBasisUSDC: remainingCostBasis,
    });

    await ctx.db.patch(vault._id, {
      totalShares: vault.totalShares - args.shares,
    });

    await upsertVaultMetrics(ctx, vault._id);

    return { payout, fee, sharePrice };
  },
});
