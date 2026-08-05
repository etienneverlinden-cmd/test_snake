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
import type * as appointments from "../appointments.js";
import type * as appointmentsInternal from "../appointmentsInternal.js";
import type * as availability from "../availability.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as google from "../google.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as notifications from "../notifications.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  appointments: typeof appointments;
  appointmentsInternal: typeof appointmentsInternal;
  availability: typeof availability;
  crons: typeof crons;
  email: typeof email;
  google: typeof google;
  http: typeof http;
  lib: typeof lib;
  notifications: typeof notifications;
  seed: typeof seed;
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
