import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    isAdmin: v.optional(v.boolean()),
    deviceId: v.optional(v.string()), // Legacy field for old documents
    portfolioMarginEnabled: v.optional(v.boolean()), // Enable cross-asset portfolio margin
    demoSeedVersion: v.optional(v.number()), // Legacy field for seeded demo users
    tokenValidAfter: v.optional(v.number()), // ms; tokens with iat older than this are revoked
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_lastSeen", ["lastSeenAt"]),
  authAccounts: defineTable({
    email: v.string(),
    emailLower: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    passwordN: v.optional(v.number()), // scrypt cost parameter N used for this hash
    name: v.optional(v.string()),
    createdAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  }).index("by_email", ["emailLower"]),
  authRateLimits: defineTable({
    key: v.string(), // emailLower the limit applies to
    windowStart: v.number(),
    attempts: v.number(),
    lockedUntil: v.optional(v.number()),
  }).index("by_key", ["key"]),
  marketPrices: defineTable({
    symbol: v.string(),
    markPx: v.number(),
    midPx: v.optional(v.number()),
    funding: v.optional(v.number()),
    source: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_symbol", ["symbol"]),
  perpsBalances: defineTable({
    userId: v.optional(v.id("users")),
    ownerType: v.optional(v.union(v.literal("user"), v.literal("vault"))),
    ownerId: v.optional(v.union(v.id("users"), v.id("vaults"))),
    asset: v.union(v.literal("USDC"), v.literal("USDT")),
    balance: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_asset", ["userId", "asset"])
    .index("by_owner", ["ownerType", "ownerId"])
    .index("by_owner_asset", ["ownerType", "ownerId", "asset"]),
  spotBalances: defineTable({
    userId: v.optional(v.id("users")),
    ownerType: v.optional(v.union(v.literal("user"), v.literal("vault"))),
    ownerId: v.optional(v.union(v.id("users"), v.id("vaults"))),
    asset: v.string(),
    balance: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_asset", ["userId", "asset"])
    .index("by_owner", ["ownerType", "ownerId"])
    .index("by_owner_asset", ["ownerType", "ownerId", "asset"]),
  orders: defineTable({
    userId: v.optional(v.id("users")),
    ownerType: v.optional(v.union(v.literal("user"), v.literal("vault"))),
    ownerId: v.optional(v.union(v.id("users"), v.id("vaults"))),
    symbol: v.string(),
    side: v.union(v.literal("buy"), v.literal("sell")),
    type: v.union(v.literal("market"), v.literal("limit")),
    price: v.optional(v.number()),
    size: v.number(),
    filledSize: v.number(),
    avgFillPrice: v.optional(v.number()),
    leverage: v.number(),
    collateral: v.union(v.literal("USDC"), v.literal("USDT")),
    marginType: v.optional(v.union(v.literal("isolated"), v.literal("cross"))),
    status: v.union(
      v.literal("open"),
      v.literal("filled"),
      v.literal("cancelled"),
      v.literal("partial"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_user_status_created", ["userId", "status", "createdAt"])
    .index("by_owner", ["ownerType", "ownerId"])
    .index("by_owner_status", ["ownerType", "ownerId", "status"])
    .index("by_owner_status_created", [
      "ownerType",
      "ownerId",
      "status",
      "createdAt",
    ])
    .index("by_status", ["status"]),
  positions: defineTable({
    userId: v.optional(v.id("users")),
    ownerType: v.optional(v.union(v.literal("user"), v.literal("vault"))),
    ownerId: v.optional(v.union(v.id("users"), v.id("vaults"))),
    symbol: v.string(),
    size: v.number(),
    entryPrice: v.number(),
    leverage: v.number(),
    collateral: v.union(v.literal("USDC"), v.literal("USDT")),
    marginType: v.optional(v.union(v.literal("isolated"), v.literal("cross"))),
    spotCollateralSize: v.optional(v.number()), // Legacy: spot-hedged size (unused)
    takeProfit: v.optional(v.union(v.number(), v.null())),
    stopLoss: v.optional(v.union(v.number(), v.null())),
    realizedPnl: v.number(),
    cumulativeFunding: v.optional(v.number()), // Cumulative funding collected or paid
    lastFundingUpdate: v.optional(v.number()), // Timestamp when funding was last calculated
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_symbol", ["userId", "symbol"])
    .index("by_owner", ["ownerType", "ownerId"])
    .index("by_owner_symbol", ["ownerType", "ownerId", "symbol"]),
  trades: defineTable({
    userId: v.optional(v.id("users")),
    ownerType: v.optional(v.union(v.literal("user"), v.literal("vault"))),
    ownerId: v.optional(v.union(v.id("users"), v.id("vaults"))),
    symbol: v.string(),
    side: v.union(v.literal("buy"), v.literal("sell")),
    price: v.number(),
    size: v.number(),
    notional: v.number(),
    fee: v.number(),
    pnl: v.number(),
    orderId: v.optional(v.id("orders")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_symbol", ["userId", "symbol"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_owner", ["ownerType", "ownerId"])
    .index("by_owner_symbol", ["ownerType", "ownerId", "symbol"])
    .index("by_owner_created", ["ownerType", "ownerId", "createdAt"]),
  portfolioMetrics: defineTable({
    userId: v.id("users"),
    totalEquity: v.number(),
    perpsEquity: v.number(),
    spotEquity: v.number(),
    pnl: v.number(),
    volume: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
  vaults: defineTable({
    name: v.string(),
    operatorUserId: v.id("users"),
    totalShares: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("closed"),
    ),
    createdAt: v.number(),
  })
    .index("by_operator", ["operatorUserId"])
    .index("by_status", ["status"]),
  vaultMembers: defineTable({
    vaultId: v.id("vaults"),
    userId: v.id("users"),
    shares: v.number(),
    costBasisUSDC: v.number(),
    createdAt: v.number(),
  })
    .index("by_vault", ["vaultId"])
    .index("by_user", ["userId"])
    .index("by_vault_user", ["vaultId", "userId"]),
  vaultMetrics: defineTable({
    vaultId: v.id("vaults"),
    equityUSDC: v.number(),
    pnl: v.number(),
    updatedAt: v.number(),
  }).index("by_vault", ["vaultId"]),
  vaultFees: defineTable({
    vaultId: v.id("vaults"),
    operatorUserId: v.id("users"),
    amountUSDC: v.number(),
    createdAt: v.number(),
  })
    .index("by_vault", ["vaultId"])
    .index("by_operator", ["operatorUserId"]),
  // Sharded display counters for the admin dashboard. Maintained incrementally
  // (see convex/lib/stats.ts) so the dashboard never full-table-scans the
  // unbounded trades/orders history, and sharded so the per-trade counter
  // writes don't create a single-hot-document contention point on the money
  // path. Values are best-effort display metrics, not money — see recomputeStats.
  statsCounters: defineTable({
    name: v.string(),
    shard: v.number(),
    value: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_name_shard", ["name", "shard"]),
});
