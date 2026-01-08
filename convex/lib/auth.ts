import type { MutationCtx, QueryCtx } from "../_generated/server";

const getIdentity = async (ctx: MutationCtx | QueryCtx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return identity;
};

export const getAuthUser = async (ctx: MutationCtx | QueryCtx) => {
  const identity = await getIdentity(ctx);
  if (!identity) return null;
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  return user;
};

export const requireAuthUser = async (ctx: MutationCtx | QueryCtx) => {
  const identity = await getIdentity(ctx);
  if (!identity) {
    throw new Error("Not authenticated.");
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) {
    throw new Error("User not found.");
  }
  return user;
};
