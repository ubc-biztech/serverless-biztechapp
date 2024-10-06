import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import db from "../../lib/db";
import {
  STICKERS_TABLE,
  SCORE_TABLE,
  SOCKETS_TABLE,
  USERS_TABLE
} from "../../constants/tables";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";

export default {
  sendMessage: async (event, data) => {
    const domain = event.requestContext.domainName;
    const stage = event.requestContext.stage;
    const connectionId = event.requestContext.connectionId;
    const url = `https://${domain}/${stage}`;
    let promise = new Promise((resolve, reject) => {
      const apigatewaymanagementapi = new ApiGatewayManagementApi({
        apiVersion: "2018-11-29",
        endpoint:
          process.env.NODE_ENV === "local" ? "http://localhost:3001" : url
      });
      apigatewaymanagementapi.postToConnection(
        {
          ConnectionId: connectionId,
          Data: JSON.stringify(data)
        },
        (err, data) => {
          if (err) {
            console.error(err);
            reject(err);
          }
          resolve(data);
        }
      );
    });
    return promise;
  },
  checkPayloadProps: function (payload, check = {}) {
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
        message: errMsg,
        body:
          payload && payload.stack && payload.message
            ? JSON.stringify(payload, Object.getOwnPropertyNames(payload))
            : JSON.stringify(payload)
      };
      return response;
    }
  },
  fetchState: async () => {
    let state;
    try {
      const command = new GetCommand({
        TableName: SOCKETS_TABLE,
        Key: {
          role: "STATE",
          connectionID: "null"
        }
      });

      state = await docClient.send(command);
    } catch (err) {
      const errorResponse = db.dynamoErrorResponse(err);
      throw errorResponse;
    }
    return state;
  }
};
