import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getAccountByEmail = internalQuery({
  args: { emailLower: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("authAccounts")
      .withIndex("by_email", (q) => q.eq("emailLower", args.emailLower))
      .unique();
  },
});

export const createAccount = internalMutation({
  args: {
    email: v.string(),
    emailLower: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    passwordN: v.optional(v.number()),
    name: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("authAccounts", args);
  },
});

// --- Rate limiting helpers (per emailLower key) ---

export const getRateLimit = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("authRateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
  },
});

// Record a failed attempt. Implements a fixed window with exponential
// backoff/lockout once the attempt threshold is exceeded.
export const recordFailedAttempt = internalMutation({
  args: {
    key: v.string(),
    now: v.number(),
    windowMs: v.number(),
    maxAttempts: v.number(),
    baseLockMs: v.number(),
    maxLockMs: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("authRateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    // Start a fresh window if none exists or the previous window has elapsed
    // and the key is not currently locked.
    if (
      !existing ||
      (args.now - existing.windowStart > args.windowMs &&
        (existing.lockedUntil === undefined ||
          existing.lockedUntil <= args.now))
    ) {
      if (existing) {
        await ctx.db.patch(existing._id, {
          windowStart: args.now,
          attempts: 1,
          lockedUntil: undefined,
        });
      } else {
        await ctx.db.insert("authRateLimits", {
          key: args.key,
          windowStart: args.now,
          attempts: 1,
        });
      }
      return;
    }

    const attempts = existing.attempts + 1;
    let lockedUntil = existing.lockedUntil;
    if (attempts >= args.maxAttempts) {
      // Exponential backoff based on how far past the threshold we are.
      const over = attempts - args.maxAttempts;
      const lockMs = Math.min(
        args.baseLockMs * Math.pow(2, over),
        args.maxLockMs,
      );
      lockedUntil = args.now + lockMs;
    }
    await ctx.db.patch(existing._id, { attempts, lockedUntil });
  },
});

// Reset the rate limit for a key on a successful auth.
export const clearRateLimit = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("authRateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const updateLoginTimestamp = internalMutation({
  args: {
    accountId: v.id("authAccounts"),
    lastLoginAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, { lastLoginAt: args.lastLoginAt });
  },
});
