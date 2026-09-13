import helpers from "./handlerHelpers";
import type {
  APIGatewayEvent,
  APIGatewayResponse,
  LambdaCallback,
  LambdaContext,
  LambdaHandler
} from "./types";

/**
 * Central authorization for every Lambda behind the Cognito authorizer.
 *
 * This is the ONLY module that reads Cognito claims and the ONLY module that
 * decides who is an admin. Handlers never touch `event.requestContext` for
 * identity — they wrap themselves in `protect(policy, handler)` and read
 * `event.auth.email`.
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
 * - "public": no identity required. `event.auth` is a Caller when a verified
 *    token was present, otherwise null. Use for routes that personalise when
 *    signed in but do not require it.
 * - "user": any signed-in, verified account.
 * - "admin": exec only.
 * - { self }: the caller must equal the target the extractor returns, or be an
 *    admin. Use for `/{email}` style routes acting on one person's record.
 */
export type Policy =
  | "public"
  | "user"
  | "admin"
  | { self: (event: AuthEvent) => string | undefined };

type InnerHandler = (
  event: AuthEvent,
  context: LambdaContext,
  callback: LambdaCallback
) => Promise<unknown>;

export function protect(policy: Policy, handler: InnerHandler): LambdaHandler {
  return async (event, context, callback) => {
    const e = event as AuthEvent;
    const caller = readCaller(e);

    const run = () =>
      handler(e, context, callback) as Promise<APIGatewayResponse | void>;

    if (policy === "public") {
      e.auth = caller; // may be null; handler personalises if present
      return run();
    }

    if (!caller) {
      return helpers.createResponse(401, {
        message: "Sign in with a verified email to continue"
      });
    }

    if (policy === "admin" && !caller.isAdmin) {
      return helpers.createResponse(403, { message: "Admin access required" });
    }

    if (typeof policy === "object" && "self" in policy) {
      const target = policy.self(e)?.trim().toLowerCase();
      if (!target) {
        return helpers.createResponse(400, {
          message: "Missing target identifier"
        });
      }
      if (target !== caller.email && !caller.isAdmin) {
        return helpers.createResponse(403, {
          message: "You can only act on your own record"
        });
      }
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

/** Read the target identifier from a path parameter (default `email`). */
export const fromPath =
  (name = "email") =>
  (event: AuthEvent): string | undefined =>
    event.pathParameters?.[name] ?? undefined;

/** Read the target identifier from a JSON body field (default `email`). */
export const fromBody =
  (name = "email") =>
  (event: AuthEvent): string | undefined => {
    try {
      const parsed = JSON.parse(event.body ?? "{}");
      const value = parsed?.[name];
      return typeof value === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  };
