import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuthUser } from "./auth";

type AdminConfig = {
  defaultEmail: string;
  defaultPassword: string;
  defaultName: string;
};

const DEFAULT_ADMIN_EMAIL = "admin@trade.xyz";
const DEFAULT_ADMIN_PASSWORD = "TradeXYZAdmin!";
const DEFAULT_ADMIN_NAME = "Platform Admin";

export const getAdminConfig = (): AdminConfig => {
  return {
    defaultEmail: process.env.ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL,
    defaultPassword: process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD,
    defaultName: process.env.ADMIN_NAME ?? DEFAULT_ADMIN_NAME,
  };
};

export const requireAdmin = async (ctx: MutationCtx | QueryCtx) => {
  const user = await requireAuthUser(ctx);
  if (!user.isAdmin) {
    throw new Error("Admin access required.");
  }
  return user;
};
