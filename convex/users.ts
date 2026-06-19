import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUser } from "./lib/auth";
import { bumpCounter } from "./lib/stats";

export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated.");
    }
    const now = Date.now();
    // Use .first() defensively so accidental duplicate rows don't throw.
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .first();

    if (existing) {
      const updates: {
        lastSeenAt: number;
        name?: string;
        email?: string;
      } = {
        lastSeenAt: now,
        name: identity.name ?? existing.name,
        email: identity.email ?? existing.email,
      };
      await ctx.db.patch(existing._id, updates);
      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name: identity.name ?? "Demo Trader",
      email: identity.email,
      isAdmin: false,
      createdAt: now,
      lastSeenAt: now,
    });

    // Tolerate a concurrent insert under races: if another call inserted a row
    // for the same tokenIdentifier, keep the earliest and patch lastSeenAt onto it.
    const all = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .collect();
    if (all.length > 1) {
      const winner = all.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      await ctx.db.patch(winner._id, { lastSeenAt: now });
      return winner._id;
    }
    // Count a genuinely-new user (skip the racy duplicate path above to avoid
    // double counting; admin.recomputeStats can reconcile any drift).
    await bumpCounter(ctx, "total_users", 1);
    return userId;
  },
});

export const revokeSessions = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) {
      throw new ConvexError("Not authenticated.");
    }
    await ctx.db.patch(user._id, { tokenValidAfter: Date.now() });
    return null;
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin ?? false,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
    };
  },
});
