/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as authData from "../authData.js";
import type * as http from "../http.js";
import type * as jwks from "../jwks.js";
import type * as lib_admin from "../lib/admin.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_portfolio from "../lib/portfolio.js";
import type * as migrations from "../migrations.js";
import type * as orders from "../orders.js";
import type * as portfolio from "../portfolio.js";
import type * as portfolioMargin from "../portfolioMargin.js";
import type * as spot from "../spot.js";
import type * as trades from "../trades.js";
import type * as users from "../users.js";
import type * as vaults from "../vaults.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  authData: typeof authData;
  http: typeof http;
  jwks: typeof jwks;
  "lib/admin": typeof lib_admin;
  "lib/auth": typeof lib_auth;
  "lib/portfolio": typeof lib_portfolio;
  migrations: typeof migrations;
  orders: typeof orders;
  portfolio: typeof portfolio;
  portfolioMargin: typeof portfolioMargin;
  spot: typeof spot;
  trades: typeof trades;
  users: typeof users;
  vaults: typeof vaults;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
