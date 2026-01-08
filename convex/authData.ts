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
    name: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("authAccounts", args);
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
