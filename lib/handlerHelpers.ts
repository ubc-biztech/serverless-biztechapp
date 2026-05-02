import type { APIGatewayResponse, HandlerHelpers, PayloadSchema, InferredPayload } from "./types";
import res from "./responseHelpers";

const handlerHelpers: HandlerHelpers = {
  missingIdQueryResponse(type: string): APIGatewayResponse {
    return res.badRequest(`A(n) ${type} id was not provided. Check query params`);
  },

  missingPathParamResponse(type: string, paramName: string): APIGatewayResponse {
    return res.badRequest(`A(n) ${paramName} path parameter was not provided for this ${type}. Check path params`);
  },

  duplicateResponse(prop: string, data: unknown): APIGatewayResponse {
    const response = res.conflict(`A database entry with the same '${prop}' already exists!`, data);
    console.error("DUPLICATE ERROR", response);
    return response;
  },

  /**
   * Check if the object passed matches the criteria
   * @param {*} payload - the object 
   * @param {*} check  - object containing the criteria for each property keyed by the property name
   * The object criteria accepts the following properties:
   * {
   *    required: <boolean>,
   *    type: <string>
   * }
   */
  checkPayloadProps<T extends PayloadSchema>(
    payload: Record<string, unknown>,
    check: T
  ): InferredPayload<T> {
    try {
      const criteria = Object.entries(check);

      criteria.forEach(([key, crit]) => {
        // check if property exists
        if(crit.required && !payload[key] && payload[key] !== false) {
          throw `'${key}' is missing from the request body`;
        }
        // check for the property's type
        if(crit.type && payload[key] && typeof payload[key] !== crit.type) {
          throw `'${key}' in the request body is invalid, expected type '${crit.type}' but got '${typeof payload[key]}'`;
        }
      });
      return payload as InferredPayload<T>
    } catch (errMsg) {
      throw this.inputError(errMsg as string, payload);
    }
  },
};

export default handlerHelpers;
