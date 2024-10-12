import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import db from "../../lib/db";
import { SOCKETS_TABLE, STICKERS_TABLE } from "../../constants/tables";
import { DeleteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import { RESERVED_WORDS } from "../../constants/dynamodb";
import error from "copy-dynamodb-table/error";

/**
 * @param event socket action event
 * @param {Object} data message object being sent
 */
export const sendMessage = async (event, data) => {
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const connectionId = event.requestContext.connectionId;
  let url = `https://ei737zemd6.execute-api.us-west-2.amazonaws.com/${stage}`;

  if (domain === "localhost") url = "http://localhost:3001";

  try {
    let apigatewaymanagementapi = new ApiGatewayManagementApi({
      apiVersion: "2018-11-29",
      endpoint: url
    });
    await new Promise((resolve, reject) => {
      apigatewaymanagementapi.postToConnection(
        {
          ConnectionId: connectionId,
          Data: JSON.stringify(data)
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
    await deleteConnection(connectionId);
  }
};

export const fetchState = async () => {
  let state;
  try {
    const command = new GetCommand({
      TableName: SOCKETS_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        connectionID: "STATE"
      }
    });

    state = await docClient.send(command);
  } catch (err) {
    const errorResponse = db.dynamoErrorResponse(err);
    console.log(errorResponse);
  }
  return state;
};

/**
 * @param state socket state object, update role, teamName, isVoting
 * @param {string} connectionID id of socket connection
 */
export async function updateSocket(state, connectionID) {
  let res = {
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
    console.log(error);
    res = {
      status: 500,
      action: "error",
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
export async function notifyVoters(data, action, event) {
  let voters;
  try {
    const command = new QueryCommand({
      IndexName: "role",
      ExpressionAttributeNames: {
        "#role": "role"
      },
      ExpressionAttributeValues: {
        ":role": "voter"
      },
      KeyConditionExpression: "#role = :role",
      ProjectionExpression: "connectionID",
      TableName: SOCKETS_TABLE + (process.env.ENVIRONMENT || "")
    });
    const response = await docClient.send(command);
    voters = response.Items;
  } catch (error) {
    let errResponse = db.dynamoErrorResponse(error);
    console.log(errResponse);
  }

  for (let i = 0; i < voters.length; i++) {
    await sendMessage(
      {
        requestContext: {
          domainName: event.requestContext.domainName,
          stage: event.requestContext.stage,
          connectionId: voters[i].connectionID
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
export async function notifyAdmins(data, action, event) {
  let voters;
  try {
    const command = new QueryCommand({
      IndexName: "role",
      ExpressionAttributeNames: {
        "#role": "role"
      },
      ExpressionAttributeValues: {
        ":role": "admin"
      },
      KeyConditionExpression: "#role = :role",
      ProjectionExpression: "connectionID",
      TableName: SOCKETS_TABLE + (process.env.ENVIRONMENT || "")
    });
    const response = await docClient.send(command);
    voters = response.Items;
  } catch (error) {
    let errResponse = db.dynamoErrorResponse(error);
    console.log(errResponse);
  }

  for (let i = 0; i < voters.length; i++) {
    await sendMessage(
      {
        requestContext: {
          domainName: event.requestContext.domainName,
          stage: event.requestContext.stage,
          connectionId: voters[i].connectionID
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
export function createUpdateExpression(obj) {
  let val = 0;
  let updateExpression = "SET ";
  let expressionAttributeValues = {};
  let expressionAttributeNames = null;

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (RESERVED_WORDS.includes(key.toUpperCase())) {
        updateExpression += `#v${val} = :val${val},`;
        expressionAttributeValues[`:val${val}`] = obj[key];
        if (!expressionAttributeNames) expressionAttributeNames = {};
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
export function checkPayloadProps(payload, check = {}) {
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
    const response = {
      status: 406,
      action: "error",
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
export async function deleteConnection(connectionID) {
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
    let errResponse = db.dynamoErrorResponse(error);
    console.log(errResponse);
  }
}

export async function getSticker(teamName, stickerName, id) {
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
    console.log(errorResponse);
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
export async function updateSticker(state, teamName, userID, stickerName) {
  let res = {
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
    console.log(error);
    res = {
      status: 500,
      message: "Internal Server Error"
    };
  }
  return res;
}

export function createResponse(statusCode, body) {
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

export async function syncAdmin(event, teamName, isVoting) {
  await updateSocket(
    {
      role: "admin"
    },
    event.requestContext.connectionId
  );

  let stickers = [];
  try {
    const command = new QueryCommand({
      ExpressionAttributeValues: {
        ":v_team": teamName
      },
      ExpressionAttributeNames: {
        "#cnt": "count",
        "#lmt": "limit"
      },
      KeyConditionExpression: "teamName = :v_team",
      ProjectionExpression: "stickerName, #cnt, #lmt",
      TableName: STICKERS_TABLE + (process.env.ENVIRONMENT || "")
    });
    const response = await docClient.send(command);
    stickers = response.Items;
  } catch (error) {
    let errResponse = db.dynamoErrorResponse(error);
    console.log(errResponse);
    await sendMessage(event, {
      status: "502",
      action: "error",
      message: "Internal server error"
    });
  }

  await sendMessage(event, {
    status: 200,
    action: "sync",
    data: {
      isVoting,
      teamName,
      stickers
    }
  });
  return {
    statusCode: 200
  };
}

export async function syncUser(body, event) {
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
    console.log(errResponse);
    await sendMessage(event, {
      status: "502",
      action: "error",
      message: "Internal server error"
    });
  }

  return stickers;
}
