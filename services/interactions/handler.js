import { CONNECTIONS_TABLE } from "../../constants/tables";
import docClient from "../../lib/docClient";
import handlerHelpers from "../../lib/handlerHelpers";
import helpers from "../../lib/handlerHelpers";
import { handleBooth, handleConnection, handleWorkshop } from "./helpers";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

const CONNECTION = "CONNECTION";
const WORK = "WORKSHOP";
const BOOTH = "BOOTH";

export const postInteraction = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("id");

    const userID = event.pathParameters.id;
    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      interactionType: {
        required: true
      },
      eventParam: {
        required: true
      }
    });

    const timestamp = new Date().getTime();
    const { interactionType, eventParam } = data;

    let response;

    switch (interactionType) {
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
    const data = result?.Items.sort((a, b) => {
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

export const getAllQuests = (event, ctx, callback) => {};
