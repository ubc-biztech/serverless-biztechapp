import {
  ApiGatewayManagementApi
} from "@aws-sdk/client-apigatewaymanagementapi";
import db from "../../lib/db";
import {
  SOCKETS_TABLE, STICKERS_TABLE
} from "../../constants/tables";
import {
  DeleteCommand, GetCommand, QueryCommand
} from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import {
  RESERVED_WORDS
} from "../../constants/dynamodb";
// @ts-expect-error TS7016 `copy-dynamodb-table` ships no type declarations.
import error from "copy-dynamodb-table/error";
import {
  ACTION_TYPES, STATE_KEY
} from "./constants";
import type { PayloadCheck, WebSocketEvent, WebSocketRequestContext } from "../../lib/types";

/**
 * @param event socket action event
 * @param {Object} data message object being sent
 */
export const sendMessage = async (event: { requestContext: WebSocketRequestContext }, data: unknown) => {
  const {
    url, connectionId
  } = getEndpoint(event);
  try {
    let apigatewaymanagementapi = new ApiGatewayManagementApi({
      apiVersion: "2018-11-29",
      endpoint: url
    });
    await new Promise((resolve, reject) => {
      apigatewaymanagementapi.postToConnection(
        {
          ConnectionId: connectionId,
          // The generated SDK type declares `Data` as `Uint8Array`, but the runtime accepts a string body.
          Data: JSON.stringify(data) as unknown as Uint8Array
        },
        (err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data);
          }
        }
      );
    });
  } catch (error) {
    switch ((error as { code?: string }).code) {
    // BUG (pre-existing, preserved): `"GoneException" || "UnknownException"` evaluates to "GoneException", so "UnknownException" never matches this case.
    // @ts-expect-error TS2872 the `||` in the case expression is always truthy; preserved verbatim.
    case "GoneException" || "UnknownException": // Connection no longer exists
      console.error("Stale Connection", (error as { message?: unknown }).message || error);
      break;

    case "LimitExceededException": // Rate limit exceeded
      console.error("Rate limit exceeded.", (error as { message?: unknown }).message || error);
      break;

    case "PayloadTooLargeException": // Payload size exceeds the allowed limit
      console.error("Payload is too large", (error as { message?: unknown }).message || error);
      break;

    case "ForbiddenException": // Insufficient permissions
      console.error(
        "Forbidden: You do not have permission to post to this connection.",
        (error as { message?: unknown }).message || error
      );
      break;

    case "InternalServerErrorException": // Internal server error
      console.error("Internal server error", (error as { message?: unknown }).message || error);

      break;

    case "BadRequestException": // Invalid request format
      console.error(
        "Bad request: Please check your data format.",
        (error as { message?: unknown }).message || error
      );
      break;

    default:
      console.error("An unexpected error occurred:", (error as { message?: unknown }).message || error);
      break;
    }
    await deleteConnection(connectionId);
  }
};

/**
 * This method fetches state for the current room, "STATE" if only one room
 * @param roomID roomID to fetch state
 */
export const fetchState = async (roomID = STATE_KEY) => {
  let state;
  try {
    const command = new GetCommand({
      TableName: SOCKETS_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        connectionID: roomID || STATE_KEY
      }
    });

    state = await docClient.send(command);
  } catch (err) {
    const errorResponse = db.dynamoErrorResponse(err);
    console.error(errorResponse);
  }
  return state;
};

/**
 *
 * @param {*} event
 * @returns {obj} {url, connectionId}
 */
function getEndpoint(event: { requestContext: WebSocketRequestContext }) {
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const connectionId = event.requestContext.connectionId;
  let url = `https://${domain}/${stage}`;

  if (domain === "localhost") url = "http://localhost:3001";
  return {
    url,
    connectionId
  };
}

/**
 * @param state socket state object, update role, teamName, isVoting
 * @param {string} connectionID id of socket connection
 */
export async function updateSocket(state: Record<string, unknown>, connectionID: string) {
  let res: Record<string, unknown> = {
    status: 200,
    action: "update",
    message: "Successfully updated state",
    data: state
  };
  try {
    let {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    } = createUpdateExpression(state);

    let updateCommand = {
      Key: {
        connectionID
      },
      TableName: SOCKETS_TABLE + (process.env.ENVIRONMENT || ""),
      ExpressionAttributeValues: expressionAttributeValues,
      UpdateExpression: updateExpression,
      ReturnValues: "UPDATED_NEW",
      ...(expressionAttributeNames && {
        ExpressionAttributeNames: expressionAttributeNames
      })
    };

    await db.updateDBCustom(updateCommand);
  } catch (error) {
    console.error(error);
    res = {
      status: 502,
      action: ACTION_TYPES.error,
      message: "Internal Server Error"
    };
  }
  return res;
}

/**
 * @param state socket state object, update role, teamName, isVoting
 * @param {Object} event socket event object
 *
 * sends message to all voters
 */
export async function notifyVoters(data: unknown, action: string, event: WebSocketEvent, roomID: string) {
  let voters;
  try {
    const command = new QueryCommand({
      IndexName: "role",
      ExpressionAttributeNames: {
        "#role": "role",
        "#roomID": "roomID"
      },
      ExpressionAttributeValues: {
        ":role": "voter",
        ":roomID": roomID
      },
      KeyConditionExpression: "#role = :role",
      FilterExpression: "#roomID = :roomID",
      ProjectionExpression: "connectionID",
      TableName: SOCKETS_TABLE + (process.env.ENVIRONMENT || "")
    });
    const response = await docClient.send(command);
    voters = response.Items;
  } catch (error) {
    let errResponse = db.dynamoErrorResponse(error);
    console.error(errResponse);
  }

  // BUG (pre-existing, preserved): the catch above swallows the error, so a failed query falls through to `voters.length` on undefined and throws a TypeError.
  // send message to all voters in the specific room
  for (let i = 0; i < voters!.length; i++) {
    await sendMessage(
      {
        requestContext: {
          domainName: event.requestContext.domainName,
          stage: event.requestContext.stage,
          connectionId: voters![i].connectionID
        }
      },
      {
        status: 200,
        action,
        data
      }
    );
  }
}

/**
 * @param state socket state object, update role, teamName, isVoting
 * @param {Object} event socket event object
 *
 * sends message to all admins
 */
export async function notifyAdmins(data: unknown, action: string, event: WebSocketEvent, roomID: string) {
  let admins;
  try {
    const command = new QueryCommand({
      IndexName: "role",
      ExpressionAttributeNames: {
        "#role": "role",
        "#roomID": "roomID"
      },
      ExpressionAttributeValues: {
        ":role": "admin",
        ":roomID": roomID
      },
      KeyConditionExpression: "#role = :role",
      FilterExpression: "#roomID = :roomID",
      ProjectionExpression: "connectionID",
      TableName: SOCKETS_TABLE + (process.env.ENVIRONMENT || "")
    });
    const response = await docClient.send(command);
    admins = response.Items;
  } catch (error) {
    let errResponse = db.dynamoErrorResponse(error);
    console.error(errResponse);
  }

  // BUG (pre-existing, preserved): the catch above swallows the error, so a failed query falls through to `admins.length` on undefined and throws a TypeError.
  // should only ever be length one because we have one presenter per room
  for (let i = 0; i < admins!.length; i++) {
    await sendMessage(
      {
        requestContext: {
          domainName: event.requestContext.domainName,
          stage: event.requestContext.stage,
          connectionId: admins![i].connectionID
        }
      },
      {
        status: 200,
        action,
        data
      }
    );
  }
}

/**
 *
 * @param {*} obj
 *
 * returns parsed update expression based on input obj
 */
export function createUpdateExpression(obj: Record<string, unknown>) {
  let val = 0;
  let updateExpression = "SET ";
  let expressionAttributeValues: Record<string, unknown> = {
  };
  let expressionAttributeNames: Record<string, string> | null = null;

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (RESERVED_WORDS.includes(key.toUpperCase())) {
        updateExpression += `#v${val} = :val${val},`;
        expressionAttributeValues[`:val${val}`] = obj[key];
        if (!expressionAttributeNames) expressionAttributeNames = {
        };
        expressionAttributeNames[`#v${val}`] = key;
        val++;
      } else {
        updateExpression += `${key} = :${key},`;
        expressionAttributeValues[`:${key}`] = obj[key];
      }
    }
  }
  updateExpression = updateExpression.slice(0, -1);

  return {
    updateExpression,
    expressionAttributeValues,
    expressionAttributeNames
  };
}

/**
 *
 * @param {Object} payload given body
 * @param {*} check required elements
 *
 * return custom error message
 */
export function checkPayloadProps(payload: Record<string, any>, check: PayloadCheck = {
}) {
  try {
    const criteria = Object.entries(check);
    criteria.forEach(([key, crit]) => {
      // check if property exists
      if (crit.required && !payload[key] && payload[key] !== false) {
        throw `'${key}' is missing from the request body`;
      }
      // check for the property's type
      if (crit.type && payload[key] && typeof payload[key] !== crit.type) {
        throw `'${key}' in the request body is invalid, expected type '${
          crit.type
        }' but got '${typeof payload[key]}'`;
      }
    });
  } catch (errMsg) {
    const response: { status?: number; action: string; message: unknown; data: string } = {
      status: 406,
      action: ACTION_TYPES.error,
      message: errMsg,
      data:
        payload && payload.stack && payload.message
          ? JSON.stringify(payload, Object.getOwnPropertyNames(payload))
          : JSON.stringify(payload)
    };
    return response;
  }
}

/**
 * @param {string} connectionID
 * @returns void
 *
 * Deletes connection in sockets table
 */
export async function deleteConnection(connectionID: string) {
  try {
    const params = {
      Key: {
        connectionID
      },
      TableName: SOCKETS_TABLE + (process.env.ENVIRONMENT || "")
    };

    const command = new DeleteCommand(params);
    const res = await docClient.send(command);
    return {
      statusCode: 200,
      message: "Disconnected"
    };
  } catch (err) {
    // BUG (pre-existing, preserved): the caught error is bound to `err`, but the imported `error` module is passed to `dynamoErrorResponse` instead.
    let errResponse = db.dynamoErrorResponse(error);
    console.error(errResponse);
  }
}

export async function getSticker(teamName: string, stickerName: string, id: string) {
  try {
    const params = {
      Key: {
        teamName,
        ["userID#stickerName"]: id + "#" + stickerName
      },
      TableName: STICKERS_TABLE + (process.env.ENVIRONMENT || "")
    };

    const command = new GetCommand(params);
    const result = await docClient.send(command);
    return result.Item || null;
  } catch (err) {
    const errorResponse = db.dynamoErrorResponse(err);
    console.error(errorResponse);
  }
}

/**
 *
 * @param {*} state sticker state object, update: count, limit
 * @param {*} teamName
 * @param {*} userID
 * @param {*} stickerName
 *
 * updates sticker.
 */
export async function updateSticker(state: Record<string, unknown>, teamName: string, userID: string, stickerName: string) {
  let res: Record<string, unknown> = {
    status: 200,
    message: "Successfully updated state",
    state: state
  };
  try {
    let {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    } = createUpdateExpression(state);

    let updateCommand = {
      Key: {
        teamName,
        ["userID#stickerName"]: userID + "#" + stickerName
      },
      TableName: STICKERS_TABLE + (process.env.ENVIRONMENT || ""),
      ExpressionAttributeValues: expressionAttributeValues,
      UpdateExpression: updateExpression,
      ReturnValues: "UPDATED_NEW",
      ...(expressionAttributeNames && {
        ExpressionAttributeNames: expressionAttributeNames
      })
    };

    await db.updateDBCustom(updateCommand);
  } catch (error) {
    console.error(error);
    res = {
      status: 502,
      message: "Internal Server Error"
    };
  }
  return res;
}

/*
Assuming syncAdmin is called on the correct teamName, there is no need for roomID 
*/
export async function syncAdmin(event: WebSocketEvent, teamName: string, isVoting: boolean) {
  await updateSocket(
    {
      role: "admin"
    },
    event.requestContext.connectionId
  );

  await sendMessage(event, {
    status: 200,
    action: ACTION_TYPES.sync,
    data: {
      isVoting,
      teamName
    }
  });
  return {
    statusCode: 200
  };
}

export async function syncUser(body: Record<string, any>, event: WebSocketEvent) {
  let stickers;
  try {
    const command = new QueryCommand({
      IndexName: "userID",

      ExpressionAttributeValues: {
        ":v_id": body.id
      },
      ExpressionAttributeNames: {
        "#cnt": "count",
        "#lmt": "limit"
      },
      KeyConditionExpression: "userID = :v_id",
      ProjectionExpression: "stickerName, #cnt, #lmt",
      TableName: STICKERS_TABLE + (process.env.ENVIRONMENT || "")
    });
    const response = await docClient.send(command);
    stickers = {
      stickers: response.Items,
      count: response.Count
    };
  } catch (error) {
    let errResponse = db.dynamoErrorResponse(error);
    console.error(errResponse);
    await sendMessage(event, {
      status: "502",
      action: ACTION_TYPES.error,
      message: "Internal server error"
    });
  }

  return stickers;
}

export async function fetchSocketRoomIDForConnection(id: string) {
  let roomID;
  try {
    const command = new QueryCommand({
      ExpressionAttributeValues: {
        ":v_id": id
      },
      KeyConditionExpression: "connectionID = :v_id",
      ProjectionExpression: "roomID",
      TableName: SOCKETS_TABLE + (process.env.ENVIRONMENT || "")
    });
    const response = await docClient.send(command);
    if (response.Items && response.Items.length > 0) {
      roomID = response.Items[0].roomID;
    }
  } catch (error) {
    const errResponse = db.dynamoErrorResponse(error);
    console.error(errResponse);
  }
  return roomID;
}

export async function fetchSocket(id: string) {
  const command = new GetCommand({
    TableName: SOCKETS_TABLE + (process.env.ENVIRONMENT || ""),
    Key: {
      connectionID: id
    }
  });
  const response = await docClient.send(command);
  return response.Item || null;
}

export function createResponse(statusCode: number, body: any) {
  const response = {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true
    },
    // helps stringify Error objects as well
    body:
      body && body.stack && body.message
        ? JSON.stringify(body, Object.getOwnPropertyNames(body))
        : JSON.stringify(body)
  };
  return response;
}

export function missingPathParamResponse(type: string, paramName: string) {
  return createResponse(400, {
    message: `A(n) ${paramName} path parameter was not provided for this ${type}. Check path params`
  });
}
