import handlerHelpers from "../../lib/handlerHelpers";
import helpers from "./helpers";
import db from "../../lib/db";
import { isEmpty } from "../../lib/utils";
import {
  STICKERS_TABLE,
  SCORE_TABLE,
  SOCKETS_TABLE,
  USERS_TABLE
} from "../../constants/tables";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";

export const connectHandler = async (event, ctx, callback) => {
  callback(null, {
    statusCode: 200,
    body: "Connected.",
    headers: {
      "Sec-WebSocket-Protocol": "websocket"
    }
  });

  return {
    statusCode: 200,
    body: "Connected."
  };
};

export const disconnectHandler = async (event, ctx, callback) => {
  callback(null, {
    statusCode: 200,
    body: "Disconnected."
  });

  return {
    statusCode: 200,
    body: "Disconnected."
  };
};

export const defaultHandler = async (event, ctx, callback) => {
  try {
    await helpers.sendMessage(event, event);
  } catch (error) {
    console.error(error);
    callback(null, error);
    return null;
  }
  return {
    statusCode: 200
  };
};

export const stickerHandler = async (event, ctx, callback) => {};

export const scoreHandler = async (event, ctx, callback) => {
  callback(null, {
    statusCode: 200,
    body: "Connected.",
    headers: {
      "Sec-WebSocket-Protocol": "websocket"
    }
  });
};

export const syncHandler = async (event, ctx, callback) => {
  const body = JSON.parse(event.body);
  if (!body.hasOwnProperty("id")) {
    const errMessage = helpers.checkPayloadProps(body, {
      id: { required: true, type: "string" }
    });
    await helpers.sendMessage(event, errMessage);
    return errMessage;
  }

  let state = await helpers.fetchState();
  const isVoting = state.Item.isVoting;

  if (!isVoting) {
    await helpers.sendMessage(event, { isVoting, stickers: [] });
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
    stickers = { stickers: response.Items, count: response.Count };
  } catch (error) {
    db.dynamoErrorResponse(error);
    await helpers.sendMessage(event, {
      status: "502",
      message: "Internal server error"
    });
  }

  await helpers.sendMessage(event, { status: 200, isVoting, stickers });
  return {
    statusCode: 200
  };
};
