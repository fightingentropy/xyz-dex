import { mutation, query } from "./_generated/server";
import { getAuthUser } from "./lib/auth";
import { getAdminConfig } from "./lib/admin";

const normalizeEmail = (value?: string | null) =>
  value?.trim().toLowerCase() ?? "";
const adminEmail = normalizeEmail(getAdminConfig().defaultEmail);
const isAdminEmail = (email?: string | null) =>
  adminEmail.length > 0 && normalizeEmail(email) === adminEmail;

export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated.");
    }
    const now = Date.now();
    const shouldBeAdmin = isAdminEmail(identity.email);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (existing) {
      const updates: {
        lastSeenAt: number;
        name?: string;
        email?: string;
        isAdmin?: boolean;
      } = {
        lastSeenAt: now,
        name: identity.name ?? existing.name,
        email: identity.email ?? existing.email,
      };
      if (shouldBeAdmin && !existing.isAdmin) {
        updates.isAdmin = true;
      }
      await ctx.db.patch(existing._id, updates);
      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name: identity.name ?? "Demo Trader",
      email: identity.email,
      isAdmin: shouldBeAdmin,
      createdAt: now,
      lastSeenAt: now,
    });
    return userId;
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
