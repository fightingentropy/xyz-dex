import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    isAdmin: v.optional(v.boolean()),
    deviceId: v.optional(v.string()), // Legacy field for old documents
    demoSeedVersion: v.optional(v.number()),
    portfolioMarginEnabled: v.optional(v.boolean()), // Enable spot-collateralized perps
    createdAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_token", ["tokenIdentifier"]),
  authAccounts: defineTable({
    email: v.string(),
    emailLower: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    name: v.optional(v.string()),
    createdAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  }).index("by_email", ["emailLower"]),
  perpsBalances: defineTable({
    userId: v.id("users"),
    asset: v.union(v.literal("USDC"), v.literal("USDT")),
    balance: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_asset", ["userId", "asset"]),
  spotBalances: defineTable({
    userId: v.id("users"),
    asset: v.string(),
    balance: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_asset", ["userId", "asset"]),
  orders: defineTable({
    userId: v.id("users"),
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
    .index("by_user_status_created", ["userId", "status", "createdAt"]),
  positions: defineTable({
    userId: v.id("users"),
    symbol: v.string(),
    size: v.number(),
    entryPrice: v.number(),
    leverage: v.number(),
    collateral: v.union(v.literal("USDC"), v.literal("USDT")),
    marginType: v.optional(v.union(v.literal("isolated"), v.literal("cross"))),
    spotCollateralSize: v.optional(v.number()), // Amount of position backed by spot holdings
    realizedPnl: v.number(),
    cumulativeFunding: v.optional(v.number()), // Cumulative funding collected or paid
    lastFundingUpdate: v.optional(v.number()), // Timestamp when funding was last calculated
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_symbol", ["userId", "symbol"]),
  trades: defineTable({
    userId: v.id("users"),
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
    .index("by_user_created", ["userId", "createdAt"]),
  portfolioMetrics: defineTable({
    userId: v.id("users"),
    totalEquity: v.number(),
    perpsEquity: v.number(),
    spotEquity: v.number(),
    pnl: v.number(),
    volume: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
});
