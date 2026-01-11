const DEFAULT_ADMIN_EMAIL = "admin@trade.xyz";

const splitList = (value?: string) =>
  value
    ?.split(/[;,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean) ?? [];

const resolveAdminEmails = () => {
  const raw =
    import.meta.env.VITE_ADMIN_EMAILS ?? import.meta.env.VITE_ADMIN_EMAIL;
  const parsed = splitList(raw);
  return parsed.length ? parsed : [DEFAULT_ADMIN_EMAIL];
};

export const adminEmails = resolveAdminEmails();

export const isAdminEmail = (email?: string | null) =>
  !!email && adminEmails.includes(email.trim().toLowerCase());
