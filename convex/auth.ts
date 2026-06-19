"use node";

import { createSign, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";

type AuthAccount = {
  _id: Id<"authAccounts">;
  email: string;
  emailLower: string;
  passwordHash: string;
  passwordSalt: string;
  passwordN?: number;
  name?: string;
};

type RateLimit = {
  key: string;
  windowStart: number;
  attempts: number;
  lockedUntil?: number;
} | null;

type AuthSession = {
  token: string;
  expiresAt: number;
  user: {
    email: string;
    name: string;
  };
};

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;
const MAX_PASSWORD_LENGTH = 128;
// scrypt cost parameter. New accounts use 1<<17; legacy hashes without a
// stored passwordN default to 16384 (the Node default) for back-compat.
const SCRYPT_N_NEW = 1 << 17;
const SCRYPT_N_DEFAULT = 16384;
// scryptSync enforces an internal memory limit; raising N requires a larger
// maxmem. 256 MiB is comfortably above the requirement for N = 1<<17.
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

// Rate-limit configuration: lock out after 5 failures within the window,
// with exponential backoff on continued failures.
const RL_WINDOW_MS = 15 * 60 * 1000;
const RL_MAX_ATTEMPTS = 5;
const RL_BASE_LOCK_MS = 60 * 1000;
const RL_MAX_LOCK_MS = 60 * 60 * 1000;

// A fixed dummy salt/hash used to run scrypt when an account is missing on
// signIn, so response timing does not reveal account existence.
const DUMMY_SALT = Buffer.from(
  "0000000000000000000000000000000000000000000000000000000000000000",
  "hex",
);

const getAccountByEmailRef = makeFunctionReference<
  "query",
  { emailLower: string },
  AuthAccount | null
>("authData:getAccountByEmail");
const createAccountRef = makeFunctionReference<
  "mutation",
  {
    email: string;
    emailLower: string;
    passwordHash: string;
    passwordSalt: string;
    passwordN?: number;
    name?: string;
    createdAt: number;
  },
  Id<"authAccounts">
>("authData:createAccount");
const updateLoginTimestampRef = makeFunctionReference<
  "mutation",
  { accountId: Id<"authAccounts">; lastLoginAt: number },
  void
>("authData:updateLoginTimestamp");
const getRateLimitRef = makeFunctionReference<
  "query",
  { key: string },
  RateLimit
>("authData:getRateLimit");
const recordFailedAttemptRef = makeFunctionReference<
  "mutation",
  {
    key: string;
    now: number;
    windowMs: number;
    maxAttempts: number;
    baseLockMs: number;
    maxLockMs: number;
  },
  void
>("authData:recordFailedAttempt");
const clearRateLimitRef = makeFunctionReference<
  "mutation",
  { key: string },
  void
>("authData:clearRateLimit");

const normalizePem = (value: string) =>
  value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;

const getAuthConfig = () => {
  const issuer = process.env.CUSTOM_AUTH_ISSUER;
  const audience = process.env.CUSTOM_AUTH_AUDIENCE;
  const privateKeyRaw = process.env.CUSTOM_AUTH_PRIVATE_KEY;
  if (!issuer) {
    throw new ConvexError("CUSTOM_AUTH_ISSUER is not set.");
  }
  if (!privateKeyRaw) {
    throw new ConvexError("CUSTOM_AUTH_PRIVATE_KEY is not set.");
  }
  const privateKey = normalizePem(privateKeyRaw);
  return {
    issuer,
    audience,
    privateKey,
  };
};

const base64Url = (input: string | Buffer) =>
  Buffer.from(input).toString("base64url");

const getKeyId = () => {
  const direct = process.env.CUSTOM_AUTH_KEY_ID;
  if (direct) return direct;
  const jwkRaw = process.env.CUSTOM_AUTH_PUBLIC_JWK;
  if (!jwkRaw) return undefined;
  try {
    const parsed = JSON.parse(jwkRaw) as { kid?: string };
    return typeof parsed.kid === "string" ? parsed.kid : undefined;
  } catch {
    return undefined;
  }
};

const signJwt = (payload: Record<string, unknown>) => {
  const { privateKey } = getAuthConfig();
  const header: Record<string, string> = {
    alg: "RS256",
    typ: "JWT",
  };
  const keyId = getKeyId();
  if (keyId) {
    header.kid = keyId;
  }
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const signature = signer.sign(privateKey);
  return `${data}.${base64Url(signature)}`;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const normalizeName = (name?: string) => {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
};

const displayNameFor = (account: { name?: string; email: string }) =>
  account.name?.trim() || account.email.split("@")[0];

const scryptWithN = (password: string, salt: Buffer, N: number) =>
  scryptSync(password, salt, PASSWORD_KEY_BYTES, {
    N,
    maxmem: SCRYPT_MAXMEM,
  });

const createPasswordHash = (password: string) => {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = scryptWithN(password, salt, SCRYPT_N_NEW);
  return {
    passwordSalt: salt.toString("base64"),
    passwordHash: hash.toString("base64"),
    passwordN: SCRYPT_N_NEW,
  };
};

const verifyPassword = (
  password: string,
  passwordSalt: string,
  passwordHash: string,
  passwordN?: number,
) => {
  const salt = Buffer.from(passwordSalt, "base64");
  const expected = Buffer.from(passwordHash, "base64");
  const N = passwordN ?? SCRYPT_N_DEFAULT;
  const actual = scryptWithN(password, salt, N);
  return timingSafeEqual(expected, actual);
};

// Run a scrypt against a dummy salt to keep signIn timing constant when the
// account is missing. The result is intentionally discarded.
const runDummyScrypt = (password: string) => {
  try {
    scryptWithN(password, DUMMY_SALT, SCRYPT_N_NEW);
  } catch {
    // ignore — purely a timing equalizer
  }
};


const buildSession = (account: AuthAccount): AuthSession => {
  const { issuer, audience } = getAuthConfig();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_SECONDS;
  const displayName = displayNameFor(account);
  const payload: Record<string, unknown> = {
    iss: issuer,
    sub: account._id,
    iat: now,
    exp,
    name: displayName,
    email: account.email,
  };
  if (audience) {
    payload.aud = audience;
  }
  return {
    token: signJwt(payload),
    expiresAt: exp * 1000,
    user: {
      email: account.email,
      name: displayName,
    },
  };
};

export const signUp = action({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const emailLower = normalizeEmail(args.email);
    if (!isValidEmail(emailLower)) {
      throw new ConvexError("Enter a valid email address.");
    }
    if (args.password.length < 8) {
      throw new ConvexError("Password must be at least 8 characters.");
    }
    // Reject overly long passwords BEFORE scrypt to prevent CPU DoS.
    if (args.password.length > MAX_PASSWORD_LENGTH) {
      throw new ConvexError(
        `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
      );
    }

    const now = Date.now();

    // Rate limit signUp attempts per email.
    const limit = await ctx.runQuery(getRateLimitRef, { key: emailLower });
    if (limit && limit.lockedUntil !== undefined && limit.lockedUntil > now) {
      const seconds = Math.ceil((limit.lockedUntil - now) / 1000);
      throw new ConvexError(
        `Too many attempts. Try again in ${seconds} seconds.`,
      );
    }

    const existing = await ctx.runQuery(getAccountByEmailRef, {
      emailLower,
    });
    if (existing) {
      await ctx.runMutation(recordFailedAttemptRef, {
        key: emailLower,
        now,
        windowMs: RL_WINDOW_MS,
        maxAttempts: RL_MAX_ATTEMPTS,
        baseLockMs: RL_BASE_LOCK_MS,
        maxLockMs: RL_MAX_LOCK_MS,
      });
      throw new ConvexError("Email already in use.");
    }

    const { passwordHash, passwordSalt, passwordN } = createPasswordHash(
      args.password,
    );
    const name = normalizeName(args.name);
    const accountId = await ctx.runMutation(createAccountRef, {
      email: args.email.trim(),
      emailLower,
      passwordHash,
      passwordSalt,
      passwordN,
      name,
      createdAt: now,
    });

    await ctx.runMutation(updateLoginTimestampRef, {
      accountId,
      lastLoginAt: now,
    });

    // Successful sign-up clears any accumulated rate-limit state.
    await ctx.runMutation(clearRateLimitRef, { key: emailLower });

    return buildSession({
      _id: accountId,
      email: args.email.trim(),
      emailLower,
      passwordHash,
      passwordSalt,
      passwordN,
      name,
    });
  },
});

export const signIn = action({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const emailLower = normalizeEmail(args.email);
    if (!isValidEmail(emailLower)) {
      throw new ConvexError("Enter a valid email address.");
    }
    // Reject overly long passwords BEFORE scrypt to prevent CPU DoS.
    if (args.password.length > MAX_PASSWORD_LENGTH) {
      throw new ConvexError("Invalid email or password.");
    }

    const now = Date.now();

    // Rate limit: reject while locked out.
    const limit = await ctx.runQuery(getRateLimitRef, { key: emailLower });
    if (limit && limit.lockedUntil !== undefined && limit.lockedUntil > now) {
      const seconds = Math.ceil((limit.lockedUntil - now) / 1000);
      throw new ConvexError(
        `Too many attempts. Try again in ${seconds} seconds.`,
      );
    }

    const account = await ctx.runQuery(getAccountByEmailRef, {
      emailLower,
    });

    let ok: boolean;
    if (!account) {
      // Constant-time: run a dummy scrypt so timing does not reveal that the
      // account does not exist.
      runDummyScrypt(args.password);
      ok = false;
    } else {
      ok = verifyPassword(
        args.password,
        account.passwordSalt,
        account.passwordHash,
        account.passwordN,
      );
    }

    if (!account || !ok) {
      await ctx.runMutation(recordFailedAttemptRef, {
        key: emailLower,
        now,
        windowMs: RL_WINDOW_MS,
        maxAttempts: RL_MAX_ATTEMPTS,
        baseLockMs: RL_BASE_LOCK_MS,
        maxLockMs: RL_MAX_LOCK_MS,
      });
      throw new ConvexError("Invalid email or password.");
    }

    await ctx.runMutation(updateLoginTimestampRef, {
      accountId: account._id,
      lastLoginAt: now,
    });

    // Successful sign-in resets the rate limit.
    await ctx.runMutation(clearRateLimitRef, { key: emailLower });

    return buildSession(account);
  },
});
