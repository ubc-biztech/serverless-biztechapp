import type { APIGatewayResponse, HandlerHelpers, PayloadCheck } from "./types";
import res from "./responseHelpers";

/** Same contract as legacy `handlerHelpers.js`: CORS + JSON body via `responseHelpers.send`. */
function createResponse(statusCode: number, body?: unknown): APIGatewayResponse {
  return res.send(statusCode, body);
}

function inputError(message: string, data?: unknown): APIGatewayResponse {
  const response = createResponse(406, {
    message,
    data,
  });
  console.error("INPUT ERROR", response);
  return response;
}

function notFoundResponse(
  type: string | null = null,
  id: string | null = null,
  secondaryKey: string | null = null,
): APIGatewayResponse {
  let message: string;

  if (type && id) {
    message = secondaryKey
      ? `${type} with id '${id}' and secondaryKey '${secondaryKey}' could not be found. Make sure you have provided them correctly.`
      : `${type} with id '${id}' could not be found. Make sure you have provided the correct id.`;
  } else {
    message = "No entries found";
  }

  return createResponse(404, { message });
}

const handlerHelpers: HandlerHelpers = {
  createResponse,

  missingIdQueryResponse(type: string): APIGatewayResponse {
    return createResponse(400, {
      message: `A(n) ${type} id was not provided. Check query params`,
    });
  },

  missingPathParamResponse(type: string, paramName: string): APIGatewayResponse {
    return createResponse(400, {
      message: `A(n) ${paramName} path parameter was not provided for this ${type}. Check path params`,
    });
  },

  notFoundResponse,

  duplicateResponse(prop: string, data: unknown): APIGatewayResponse {
    const response = createResponse(409, {
      message: `A database entry with the same '${prop}' already exists!`,
      data,
    });
    console.error("DUPLICATE ERROR", response);
    return response;
  },

  inputError,

  /**
   * Check if the object passed matches the criteria
   * @param payload - the object
   * @param check - object containing the criteria for each property keyed by the property name
   * The object criteria accepts the following properties:
   * { required?: boolean, type?: string }
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
      throw inputError(errMsg as string, payload);
    }
  },
};

export default handlerHelpers;
