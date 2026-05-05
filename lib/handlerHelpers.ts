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

  duplicateResponse(prop: string, data: unknown): APIGatewayResponse {
    const response = res.send(409, {
      message: `A database entry with the same '${prop}' already exists!`,
      data,
    });
    console.error("DUPLICATE ERROR", response);
    return response;
  },

  /**
   * Validate `payload` against `check`. Throws a 406 response (via
   * `res.notAcceptable`) on the first violation; otherwise returns void.
   *
   * @param payload - the object
   * @param check - object containing the criteria for each property keyed by
   *   the property name. Accepts `{ required?: boolean, type?: string }`.
   */
  checkPayloadProps(
    payload: Record<string, unknown>,
    check: PayloadCheck,
  ): void {
    try {
      const criteria = Object.entries(check);

      criteria.forEach(([key, crit]) => {
        if (crit.required && !payload[key] && payload[key] !== false) {
          throw `'${key}' is missing from the request body`;
        }
        if (crit.type && payload[key] && typeof payload[key] !== crit.type) {
          throw `'${key}' in the request body is invalid, expected type '${crit.type}' but got '${typeof payload[key]}'`;
        }
      });
    } catch (errMsg) {
      throw res.notAcceptable(errMsg as string, payload);
    }
  },
};

export default handlerHelpers;
