import type { MutationCtx, QueryCtx } from "../_generated/server";

type AdminConfig = {
  emails: string[];
  defaultEmail: string;
  defaultPassword: string;
  defaultName: string;
};

const DEFAULT_ADMIN_EMAIL = "admin@trade.xyz";
const DEFAULT_ADMIN_PASSWORD = "TradeXYZAdmin!";
const DEFAULT_ADMIN_NAME = "Platform Admin";

const splitList = (value?: string) =>
  value
    ?.split(/[;,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean) ?? [];

const resolveAdminEmails = () => {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL;
  const parsed = splitList(raw);
  return parsed.length ? parsed : [DEFAULT_ADMIN_EMAIL];
};

export const getAdminConfig = (): AdminConfig => {
  const emails = resolveAdminEmails();
  return {
    emails,
    defaultEmail: emails[0],
    defaultPassword: process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD,
    defaultName: process.env.ADMIN_NAME ?? DEFAULT_ADMIN_NAME,
  };
};

export const isAdminEmail = (email?: string | null) => {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return resolveAdminEmails().includes(normalized);
};

export const requireAdmin = async (ctx: MutationCtx | QueryCtx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !identity.email) {
    throw new Error("Not authenticated.");
  }
  if (!isAdminEmail(identity.email)) {
    throw new Error("Admin access required.");
  }
  return identity;
};
