"use node";

import { createSign, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";

type AuthAccount = {
  _id: Id<"authAccounts">;
  email: string;
  emailLower: string;
  passwordHash: string;
  passwordSalt: string;
  name?: string;
};

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

const normalizePem = (value: string) =>
  value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;

const getAuthConfig = () => {
  const issuer = process.env.CUSTOM_AUTH_ISSUER;
  const audience = process.env.CUSTOM_AUTH_AUDIENCE;
  const privateKeyRaw = process.env.CUSTOM_AUTH_PRIVATE_KEY;
  if (!issuer) {
    throw new Error("CUSTOM_AUTH_ISSUER is not set.");
  }
  if (!privateKeyRaw) {
    throw new Error("CUSTOM_AUTH_PRIVATE_KEY is not set.");
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

const createPasswordHash = (password: string) => {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = scryptSync(password, salt, PASSWORD_KEY_BYTES);
  return {
    passwordSalt: salt.toString("base64"),
    passwordHash: hash.toString("base64"),
  };
};

const verifyPassword = (
  password: string,
  passwordSalt: string,
  passwordHash: string,
) => {
  const salt = Buffer.from(passwordSalt, "base64");
  const expected = Buffer.from(passwordHash, "base64");
  const actual = scryptSync(password, salt, PASSWORD_KEY_BYTES);
  return timingSafeEqual(expected, actual);
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
      throw new Error("Enter a valid email address.");
    }
    if (args.password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }

    const existing = await ctx.runQuery(getAccountByEmailRef, {
      emailLower,
    });
    if (existing) {
      throw new Error("Email already in use.");
    }

    const { passwordHash, passwordSalt } = createPasswordHash(args.password);
    const now = Date.now();
    const name = normalizeName(args.name);
    const accountId = await ctx.runMutation(createAccountRef, {
      email: args.email.trim(),
      emailLower,
      passwordHash,
      passwordSalt,
      name,
      createdAt: now,
    });

    await ctx.runMutation(updateLoginTimestampRef, {
      accountId,
      lastLoginAt: now,
    });

    return buildSession({
      _id: accountId,
      email: args.email.trim(),
      emailLower,
      passwordHash,
      passwordSalt,
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
      throw new Error("Enter a valid email address.");
    }
    const account = await ctx.runQuery(getAccountByEmailRef, {
      emailLower,
    });
    if (
      !account ||
      !verifyPassword(args.password, account.passwordSalt, account.passwordHash)
    ) {
      throw new Error("Invalid email or password.");
    }

    await ctx.runMutation(updateLoginTimestampRef, {
      accountId: account._id,
      lastLoginAt: Date.now(),
    });

    return buildSession(account);
  },
});
