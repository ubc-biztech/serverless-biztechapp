import helpers from "./handlerHelpers";
import type {
  APIGatewayEvent,
  APIGatewayResponse,
  LambdaCallback,
  LambdaContext,
  LambdaHandler
} from "./types";

/**
 * Central authentication for every Lambda behind the Cognito authorizer.
 *
 * This is the ONLY module that reads Cognito claims and the ONLY module that
 * decides who is an admin. Handlers never touch `event.requestContext` for
 * identity — they wrap themselves in `protect(access, handler)` and read the
 * verified caller from `event.auth`.
 *
 * The wrapper's job is authentication + coarse role (public / user / admin).
 * Resource-level authorization ("is this the owner of the record") is handler
 * logic: the handler reads `event.auth` and decides, because the owner often
 * comes from the body or a DB lookup, not a path parameter.
 *
 * Security invariant: an unverified email claim (`email_verified !== "true"`)
 * is treated as anonymous. The `email` attribute is user-mutable in Cognito, so
 * a token whose email has been swapped must never be trusted until re-verified.
 */

export type Caller = { email: string; isAdmin: boolean };

/** An API Gateway event after `protect` has attached the resolved caller. */
export interface AuthEvent extends APIGatewayEvent {
  auth?: Caller | null;
}

/**
 * Access levels a route can require:
 * - PUBLIC: no identity required. `event.auth` is a Caller when a verified
 *    token was present, otherwise null.
 * - USER: any signed-in, verified account.
 * - ADMIN: exec only.
 */
export const Access = Object.freeze({
  PUBLIC: "public",
  USER: "user",
  ADMIN: "admin"
} as const);

export type Access = (typeof Access)[keyof typeof Access];

type InnerHandler = (
  event: AuthEvent,
  context: LambdaContext,
  callback: LambdaCallback
) => Promise<unknown>;

export function protect(access: Access, handler: InnerHandler): LambdaHandler {
  return async (event, context, callback) => {
    const e = event as AuthEvent;
    const caller = readCaller(e);
    const run = () =>
      handler(e, context, callback) as Promise<APIGatewayResponse | void>;

    if (access === Access.PUBLIC) {
      e.auth = caller; // may be null; handler personalises if present
      return run();
    }

    if (!caller) {
      return helpers.createResponse(401, {
        message: "Sign in with a verified email to continue"
      });
    }

    if (access === Access.ADMIN && !caller.isAdmin) {
      return helpers.createResponse(403, { message: "Admin access required" });
    }

    e.auth = caller;
    return run();
  };
}

/**
 * The single source of truth for the current caller. Returns null (anonymous)
 * when there is no token, no email, or the email is unverified.
 */
export function readCaller(event: AuthEvent): Caller | null {
  const claims = event?.requestContext?.authorizer?.claims;
  if (!claims || !claims.email) return null;

  // API Gateway serialises all claim values as strings.
  if (String(claims.email_verified) !== "true") return null;

  const email = String(claims.email).trim().toLowerCase();
  if (!email) return null;

  return { email, isAdmin: isAdmin(claims, email) };
}

/**
 * The single source of truth for admin status.
 *
 * Prefers a Cognito group named `admin` (the durable model — set up the group
 * and this stops depending on the email string entirely). Falls back to the
 * verified `@ubcbiztech.com` suffix, which is only safe because `readCaller`
 * has already required `email_verified`.
 */
function isAdmin(claims: Record<string, string>, email: string): boolean {
  const groups = String(claims["cognito:groups"] ?? "").split(",");
  if (groups.includes("admin")) return true;
  return email.endsWith("@ubcbiztech.com");
}
