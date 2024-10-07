import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import db from "../../lib/db";
import { SOCKETS_TABLE } from "../../constants/tables";
import { DeleteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import { RESERVED_WORDS } from "../../constants/dynamodb";

export default {
  sendMessage: async (event, data) => {
    const domain = event.requestContext.domainName;
    const stage = event.requestContext.stage;
    const connectionId = event.requestContext.connectionId;
    const url = `https://${domain}/${stage}`;

    try {
      let apigatewaymanagementapi = new ApiGatewayManagementApi({
        apiVersion: "2018-11-29",
        endpoint: process.env.ENVIRONMENT ? url : "http://localhost:3001"
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
      deleteConnection(connectionId);
    }
  },

  fetchState: async () => {
    let state;
    try {
      const command = new GetCommand({
        TableName: SOCKETS_TABLE,
        Key: {
          connectionID: "STATE"
        }
      });

      state = await docClient.send(command);
    } catch (err) {
      const errorResponse = db.dynamoErrorResponse(err);
      throw errorResponse;
    }
    return state;
  },

  updateState: function (state) {
    let res;
    try {
      let {
        updateExpression,
        expressionAttributeValues,
        expressionAttributeNames
      } = this.createUpdateExpression(state);

      let updateCommand = {
        Key: {
          connectionID: "STATE"
        },
        TableName:
          SOCKETS_TABLE +
          (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
        ExpressionAttributeValues: expressionAttributeValues,
        UpdateExpression: updateExpression,
        ReturnValues: "UPDATED_NEW",
        ...(expressionAttributeNames && {
          ExpressionAttributeNames: expressionAttributeNames
        })
      };

      db.updateDBCustom(updateCommand);
    } catch (error) {
      console.error(error);
      res = {
        status: 500,
        message: "Internal Server Error"
      };
    }
    res = {
      status: 200,
      message: "Successfully updated state",
      state: state
    };
    return res;
  },

  notifyVoters: async function (state, domainName, stage) {
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
        TableName: SOCKETS_TABLE
      });
      const response = await docClient.send(command);
      voters = response.Items;
    } catch (error) {
      db.dynamoErrorResponse(error);
    }

    for (let i = 0; i < voters.length; i++) {
      this.sendMessage(
        {
          requestContext: {
            domainName,
            stage,
            connectionId: voters[i].connectionID
          }
        },
        { status: 200, state }
      );
    }
  },

  createUpdateExpression: function (obj) {
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
  }
};

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
      body: res,
      message: "Disconnected"
    };
  } catch (err) {
    const errorResponse = db.dynamoErrorResponse(err);
    throw errorResponse;
  }
}
