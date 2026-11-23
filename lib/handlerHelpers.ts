import type { APIGatewayResponse, HandlerHelpers, PayloadCheck } from "./types";
import res from "./responseHelpers";

/**
 * Domain-level helpers for request validation and common error shapes.
 *
 * HTTP-response building (200/201/4xx/5xx envelopes, JSON body, CORS headers)
 * lives in `responseHelpers`. Anything you'd previously have written via
 * `helpers.createResponse(...)`, `helpers.inputError(...)`, or
 * `helpers.notFoundResponse(...)` should use `res.send` / `res.notAcceptable` /
 * `res.notFound` from `responseHelpers` directly.
 */
const handlerHelpers: HandlerHelpers = {
  createResponse(statusCode: number, body?: unknown): APIGatewayResponse {
    return res.send(statusCode, body);
  },

  missingIdQueryResponse(type: string): APIGatewayResponse {
    return res.send(400, {
      message: `A(n) ${type} id was not provided. Check query params`,
    });
  },

  missingPathParamResponse(type: string, paramName: string): APIGatewayResponse {
    return res.send(400, {
      message: `A(n) ${paramName} path parameter was not provided for this ${type}. Check path params`,
    });
  },

  notFoundResponse(
    type?: string | null,
    id?: string | null,
    secondaryKey?: string | number | null,
  ): APIGatewayResponse {
    return res.notFound(
      type ?? undefined,
      id ?? undefined,
      secondaryKey !== null && secondaryKey !== undefined ? String(secondaryKey) : undefined,
    );
  },

  duplicateResponse(prop: string, data: unknown): APIGatewayResponse {
    const response = res.send(409, {
      message: `A database entry with the same '${prop}' already exists!`,
      data,
    });
    console.error("DUPLICATE ERROR", response);
    return response;
  },

  inputError(message: string, data?: unknown): APIGatewayResponse {
    return res.notAcceptable(message, data);
  },

  /**
   * Custom validators run after type checks for supplied fields and return an
   * error message or undefined. Defaults to a 406 response unless makeError is supplied.
   */
  checkPayloadProps(
    payload: Record<string, unknown>,
    check: PayloadCheck,
    makeError?: (message: string) => unknown,
  ): void {
    const fail = (message: string): never => {
      throw makeError ? makeError(message) : res.notAcceptable(message, payload);
    };
    if (payload === null || payload === undefined) fail("Provide a request body object.");
    for (const [key, crit] of Object.entries(check)) {
      const value = payload[key];
      const supplied = Object.prototype.hasOwnProperty.call(payload, key);
      if (crit.required && !value && value !== false) {
        fail(`'${key}' is missing from the request body`);
      }
      // Preserve legacy schemas; custom rules type-check every supplied value, including false/null/0.
      const checkType = crit.validate ? supplied : Boolean(value);
      if (crit.type && checkType && typeof value !== crit.type) {
        fail(`'${key}' in the request body is invalid, expected type '${crit.type}' but got '${typeof value}'`);
      }
      if (supplied && crit.validate) {
        const message = crit.validate(value);
        if (message !== undefined) fail(message);
      }
    }
  },
};

export default handlerHelpers;
