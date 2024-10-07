import helpers from "./helpers";
import db from "../../lib/db";
import {
  STICKERS_TABLE,
  SCORE_TABLE,
  SOCKETS_TABLE,
  USERS_TABLE
} from "../../constants/tables";
import { DeleteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";

export const connectHandler = async (event, ctx, callback) => {
  const connectionID = event.requestContext.connectionId;
  const obj = {
    connectionID,
    role: "voter",
    userID: ""
  };

  db.put(obj, SOCKETS_TABLE, true);

  return {
    statusCode: 200,
    body: "Connected."
  };
};

export const disconnectHandler = async (event, ctx, callback) => {
  const connectionID = event.requestContext.connectionId;

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
      body: res,
      message: "Disconnected"
    };
  } catch (err) {
    const errorResponse = db.dynamoErrorResponse(err);
    throw errorResponse;
  }
};

export const syncHandler = async (event, ctx, callback) => {
  const body = JSON.parse(event.body);
  if (!body.hasOwnProperty("id")) {
    const errMessage = helpers.checkPayloadProps(body, {
      id: {
        required: true,
        type: "string"
      }
    });
    await helpers.sendMessage(event, errMessage);
    return errMessage;
  }

  let state = await helpers.fetchState();
  const isVoting = state.Item.isVoting;

  if (!isVoting) {
    await helpers.sendMessage(event, {
      isVoting,
      stickers: []
    });
    return {
      statusCode: 200
    };
  }

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
      TableName: STICKERS_TABLE
    });
    const response = await docClient.send(command);
    stickers = {
      stickers: response.Items,
      count: response.Count
    };
  } catch (error) {
    db.dynamoErrorResponse(error);
    await helpers.sendMessage(event, {
      status: "502",
      message: "Internal server error"
    });
  }

  await helpers.sendMessage(event, {
    status: 200,
    isVoting,
    stickers
  });
  return {
    statusCode: 200
  };
};

/**
 * Admin action handler
 * The event.body must have the following properties:
 * {
 *     event: "start" | "end" | "changeTeam" | "listen"
 * }
 *
 *    if changeTeam is used as the action, then a team property must
 *    be provided as part of the message body
 */
export const adminHandler = async (event, ctx, callback) => {
  const body = JSON.parse(event.body);
  if (!body.hasOwnProperty("event")) {
    const errMessage = helpers.checkPayloadProps(body, {
      event: {
        required: true,
        type: "string"
      }
    });
    await helpers.sendMessage(event, errMessage);
    return errMessage;
  }

  const action = body.event;

  if (action === "changeTeam" && !body.hasOwnProperty("team")) {
    const errMessage = helpers.checkPayloadProps(body, {
      team: {
        required: true,
        type: "string"
      }
    });

    await helpers.sendMessage(event, errMessage);
    return errMessage;
  }

  try {
    let payload;
    switch (action) {
      case "start": {
        payload = helpers.updateSocket(
          {
            isVoting: true
          },
          "STATE"
        );
        helpers.sendMessage(event, {
          status: 200,
          message: payload
        });
        helpers.notifyVoters(
          payload,
          event.requestContext.domainName,
          event.requestContext.stage
        );
        break;
      }

      case "end": {
        payload = helpers.updateSocket(
          {
            isVoting: false
          },
          "STATE"
        );
        helpers.sendMessage(event, {
          status: 200,
          message: payload
        });
        helpers.notifyVoters(
          payload,
          event.requestContext.domainName,
          event.requestContext.stage
        );
        break;
      }

      case "changeTeam": {
        payload = helpers.updateSocket(
          {
            teamName: body.team
          },
          "STATE"
        );
        helpers.sendMessage(event, {
          status: 200,
          message: payload
        });
        helpers.notifyVoters(
          payload,
          event.requestContext.domainName,
          event.requestContext.stage
        );
        break;
      }

      case "listen": {
        payload = helpers.updateSocket(
          {
            role: "admin"
          },
          event.requestContext.connectionId
        );
        helpers.sendMessage(event, {
          status: 200,
          message: payload
        });
        break;
      }

      default: {
        await helpers.sendMessage(event, {
          status: "400",
          message: "unrecognized event type"
        });
        break;
      }
    }
  } catch (error) {
    console.error(error);
    await helpers.sendMessage(event, {
      status: "500",
      message: "Internal Server Error"
    });
    return {
      statusCode: 500
    };
  }
  return {
    statusCode: 200
  };
};

export const stickerHandler = async (event, ctx, callback) => {};

export const scoreHandler = async (event, ctx, callback) => {};

export const defaultHandler = async (event, ctx, callback) => {
  try {
    await helpers.sendMessage(event, {
      status: "400",
      message: "unknown action"
    });
  } catch (error) {
    console.error(error);
    callback(null, error);
    return null;
  }
  return {
    statusCode: 200
  };
};
