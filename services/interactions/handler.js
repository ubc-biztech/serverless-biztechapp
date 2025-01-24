import {
  CONNECTIONS_TABLE,
  QRS_TABLE,
  QUESTS_TABLE
} from "../../constants/tables";
import db from "../../lib/db";
import docClient from "../../lib/docClient";
import handlerHelpers from "../../lib/handlerHelpers";
import helpers from "../../lib/handlerHelpers";
import {
  CURRENT_EVENT
} from "./constants";
import {
  handleBooth, handleConnection, handleWorkshop
} from "./helpers";
import {
  QueryCommand
} from "@aws-sdk/lib-dynamodb";

const CONNECTION = "CONNECTION";
const WORK = "WORKSHOP";
const BOOTH = "BOOTH";

export const postInteraction = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    try {
      helpers.checkPayloadProps(data, {
        userID: {
          required: true
        },
        eventType: {
          required: true
        },
        eventParam: {
          required: true
        }
      });
    } catch (error) {
      callback(null, error);
      return null;
    }

    const timestamp = new Date().getTime();
    const {
      userID, eventType, eventParam
    } = data;

    let response;

    switch (eventType) {
    case CONNECTION:
      response = await handleConnection(userID, eventParam, timestamp);
      break;

    case WORK:
      response = await handleWorkshop(userID, eventParam, timestamp);
      break;

    case BOOTH:
      response = await handleBooth(userID, eventParam, timestamp);
      break;

    default:
      throw handlerHelpers.createResponse(400, {
        message: "interactionType argument does not match known case"
      });
    }

    callback(null, response);
  } catch (err) {
    console.error(err);
    throw handlerHelpers.createResponse(500, {
      message: "Internal server error"
    });
  }

  return null;
};

export const getAllConnections = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("id");

    const userID = event.pathParameters.id;

    const command = new QueryCommand({
      ExpressionAttributeValues: {
        ":uid": userID
      },
      KeyConditionExpression: "userID = :uid",
      TableName: CONNECTIONS_TABLE + (process.env.ENVIRONMENT || "")
    });
    const result = await docClient.send(command);
    const data = result.Items.sort((a, b) => {
      return b.createdAt - a.createdAt;
    });

    const response = handlerHelpers.createResponse(200, {
      message: `all connections for ${userID}`,
      data
    });

    callback(null, response);
  } catch (err) {
    console.error(err);
    throw handlerHelpers.createResponse(500, {
      message: "Internal server error"
    });
  }

  return null;
};

export const getAllQuests = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("id");

    const userID = event.pathParameters.id;

    const command = new QueryCommand({
      ExpressionAttributeValues: {
        ":uid": userID
      },
      KeyConditionExpression: "userID = :uid",
      TableName: QUESTS_TABLE + (process.env.ENVIRONMENT || "")
    });
    const result = await docClient.send(command);

    const response = handlerHelpers.createResponse(200, {
      message: `all quests for ${userID}`,
      data: result.Items
    });

    callback(null, response);
  } catch (err) {
    console.error(err);
    throw handlerHelpers.createResponse(500, {
      message: "Internal server error"
    });
  }

  return null;
};
