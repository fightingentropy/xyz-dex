import { createMemo, createRoot, createSignal } from "solid-js";
import type { FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import { convex, createConvexQuery } from "../lib/convex";

type AuthUser = {
  email: string;
  name?: string;
};

type AuthSession = {
  token: string;
  expiresAt: number;
  user: AuthUser;
};

type CurrentUser = {
  _id: string;
  name?: string;
  email?: string;
  isAdmin: boolean;
  createdAt: number;
  lastSeenAt: number;
};

const STORAGE_KEY = "trade_xyz_auth_session";

const actionRef = (name: string) =>
  name as unknown as FunctionReference<"action">;
const queryRef = <TArgs extends Record<string, any>, TResult>(name: string) =>
  name as unknown as FunctionReference<"query", TArgs, TResult>;

const signInRef = actionRef("auth:signIn");
const signUpRef = actionRef("auth:signUp");
const currentUserRef = queryRef<{}, CurrentUser | null>("users:getCurrentUser");

const {
  authReady,
  isAuthenticated,
  authUser,
  isAdmin,
  adminReady,
  authOpen,
  authLoading,
  authError,
  login,
  logout,
  closeAuth,
  clearAuthError,
  signIn,
  signUp,
} = createRoot(() => {
  const [authReady, setAuthReady] = createSignal(false);
  const [isAuthenticated, setIsAuthenticated] = createSignal(false);
  const [authUser, setAuthUser] = createSignal<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = createSignal(false);
  const [authLoading, setAuthLoading] = createSignal(false);
  const [authError, setAuthError] = createSignal<string | null>(null);
  const [authToken, setAuthToken] = createSignal<string | null>(null);
  const [authExpiresAt, setAuthExpiresAt] = createSignal<number | null>(null);
  const currentUserQuery = createConvexQuery(currentUserRef, () =>
    isAuthenticated() ? {} : null,
  );
  const adminReady = createMemo(() => {
    if (!isAuthenticated()) return true;
    return currentUserQuery() !== undefined;
  });
  const isAdmin = createMemo(() => !!currentUserQuery()?.isAdmin);

  const readSession = (): AuthSession | null => {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AuthSession;
      if (!parsed?.token || !parsed?.expiresAt || !parsed?.user?.email) {
        return null;
      }
      return parsed;
    } catch (error) {
      console.warn("Failed to parse auth session:", error);
      return null;
    }
  };

  const writeSession = (session: AuthSession) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  };

  const clearSession = () => {
    setAuthToken(null);
    setAuthExpiresAt(null);
    setIsAuthenticated(false);
    setAuthUser(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const getValidToken = () => {
    // First try to get from signal (for reactivity)
    let token = authToken();
    let expiresAt = authExpiresAt();

    // Fallback to localStorage if signal hasn't updated yet
    if (!token || !expiresAt) {
      const session = readSession();
      if (session && session.expiresAt > Date.now()) {
        token = session.token;
        expiresAt = session.expiresAt;
      } else {
        return null;
      }
    }

    if (!token || !expiresAt) return null;
    if (Date.now() >= expiresAt) {
      clearSession();
      return null;
    }
    return token;
  };

  const attachConvexAuth = () => {
    convex.setAuth(async () => getValidToken());
  };

  const ensureBackendUser = async (retries = 8, baseDelayMs = 200) => {
    if (!isAuthenticated()) return;
    // Verify token is available before making authenticated request
    const token = getValidToken();
    if (!token) {
      console.warn("Token not available for ensureBackendUser");
      return;
    }

    // Give Convex time to establish the authenticated connection
    // after setAuth() is called
    await new Promise((resolve) => setTimeout(resolve, 300));

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await convex.mutation(api.users.ensureUser, {});
        return; // Success, exit
      } catch (error) {
        const isAuthError =
          error instanceof Error && error.message.includes("Not authenticated");

        if (isAuthError && attempt < retries - 1) {
          // Auth not ready yet, wait and retry with exponential backoff
          const delay = baseDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Non-auth error or final attempt
        console.error("Failed to initialize user:", error);
        return;
      }
    }
  };

  const applySession = async (session: AuthSession) => {
    setAuthToken(session.token);
    setAuthExpiresAt(session.expiresAt);
    setAuthUser(session.user);
    setIsAuthenticated(true);
    writeSession(session);
    attachConvexAuth();
    await ensureBackendUser();
  };

  const initAuth = async () => {
    const session = readSession();
    if (session && session.expiresAt > Date.now()) {
      setAuthToken(session.token);
      setAuthExpiresAt(session.expiresAt);
      setAuthUser(session.user);
      setIsAuthenticated(true);
      attachConvexAuth();
      // ensureBackendUser has retry logic to wait for Convex auth to be ready
      await ensureBackendUser();
    } else {
      clearSession();
      attachConvexAuth();
    }
    setAuthReady(true);
  };

  const login = () => {
    setAuthError(null);
    setAuthOpen(true);
  };

  const closeAuth = () => {
    setAuthError(null);
    setAuthOpen(false);
  };

  const clearAuthError = () => {
    setAuthError(null);
  };

  const signIn = async ({
    email,
    password,
  }: {
    email: string;
    password: string;
  }) => {
    if (!email.trim() || !password.trim()) {
      setAuthError("Email and password are required.");
      return false;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const session = (await convex.action(signInRef, {
        email,
        password,
      })) as AuthSession;
      if (!session?.token) {
        throw new Error("Sign in failed.");
      }
      await applySession(session);
      setAuthOpen(false);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sign in failed.";
      setAuthError(message);
      return false;
    } finally {
      setAuthLoading(false);
    }
  };

  const signUp = async ({
    email,
    password,
    name,
  }: {
    email: string;
    password: string;
    name?: string;
  }) => {
    if (!email.trim() || !password.trim()) {
      setAuthError("Email and password are required.");
      return false;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const session = (await convex.action(signUpRef, {
        email,
        password,
        name,
      })) as AuthSession;
      if (!session?.token) {
        throw new Error("Sign up failed.");
      }
      await applySession(session);
      setAuthOpen(false);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sign up failed.";
      setAuthError(message);
      return false;
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    clearSession();
    attachConvexAuth();
  };

  void initAuth();

  return {
    authReady,
    isAuthenticated,
    authUser,
    isAdmin,
    adminReady,
    authOpen,
    authLoading,
    authError,
    login,
    logout,
    closeAuth,
    clearAuthError,
    signIn,
    signUp,
  };
});

export {
  authReady,
  isAuthenticated,
  authUser,
  isAdmin,
  adminReady,
  authOpen,
  authLoading,
  authError,
  login,
  logout,
  closeAuth,
  clearAuthError,
  signIn,
  signUp,
};
