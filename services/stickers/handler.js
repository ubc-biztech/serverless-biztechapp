import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import { isEmpty } from "../../lib/utils";
import { STICKERS_TABLE } from "../../constants/tables";
import AWS from "@aws-sdk/client-apigatewaymanagementapi";

export const connectionHandler = async (event, context, cb) => {};

export const defaultHandler = async (event, context, cb) => {
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const connectionId = event.requestContext.connectionId;
  const callbackUrlForAWS = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
  await sendMessageToClient(callbackUrlForAWS, connectionId, event);
  return {
    statusCode: 200
  };
};

export const stickerHandler = async (event, context, cb) => {};

export const scoreHandler = async (event, context, cb) => {};

const sendMessageToClient = async (url, connectionId, payload) =>
  new Promise((resolve, reject) => {
    const apigatewaymanagementapi = new AWS.ApiGatewayManagementApi({
      apiVersion: "2018-11-29",
      endpoint: url
    });
    apigatewaymanagementapi.postToConnection(
      {
        ConnectionId: connectionId, // connectionId of the receiving ws-client
        Data: JSON.stringify(payload)
      },
      (err, data) => {
        if (err) {
          console.log("err is", err);
          reject(err);
        }
        resolve(data);
      }
    );
  });
