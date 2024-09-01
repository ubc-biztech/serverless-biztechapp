import docClient from "./docClient.js";
import {
  RESERVED_WORDS
} from "../constants/dynamodb.js";
import {
  PutCommand,
  GetCommand,
  ScanCommand,
  BatchGetCommand,
  DeleteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";

export default {
  // DATABASE HELPER FUNCTIONS
  dynamoErrorResponse: function (err) {
    const body = {
      code: err.code,
      time: err.time,
      requestId: err.requestId,
      statusCode: err.statusCode,
      retryable: err.retryable,
      retryDelay: err.retryDelay,
    };
    const response = {
      statusCode: err.statusCode || 502,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true
      },
      type: err.name,
      body: body && body.stack && body.message
        ? JSON.stringify(body, Object.getOwnPropertyNames(body))
        : JSON.stringify(body)
    };
    console.error("DYNAMO DB ERROR", err);
    return response;
  },

  createUpdateExpression: function (obj) {
    let val = 0;
    let updateExpression = "set ";
    let expressionAttributeValues = {
    };
    let expressionAttributeNames = null;

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (key === "id" || key === "eventID;year" || key === "createdAt" || key === "updatedAt")
          continue;
        else if (RESERVED_WORDS.includes(key.toUpperCase())) {
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
    const timestamp = new Date().getTime();
    updateExpression += "updatedAt = :updatedAt";
    expressionAttributeValues[":updatedAt"] = timestamp;

    return {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    };
  },

  // DATABASE INTERACTIONS

  create: async function (item, table) {
    try {
      const params = {
        Item: item,
        TableName: table + (process.env.ENVIRONMENT || ""),
        ConditionExpression: "attribute_not_exists(id)"
      };

      const command = new PutCommand(params);
      const res = await docClient.send(command);
      return res;
    } catch (err) {
      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;
    }
  },

  getOne: async function (id, table, extraKeys = {
  }) {
    try {
      const params = {
        Key: Object.keys(extraKeys).length === 0 ? {
          id
        } : {
          id,
          ...extraKeys
        },
        TableName: table + (process.env.ENVIRONMENT || "")
      };

      const command = new GetCommand(params);
      const result = await docClient.send(command);
      return result.Item || null;
    } catch (err) {
      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;
    }
  },

  scan: async function (table, filters = {
  }) {
    try {
      const params = {
        TableName: table + (process.env.ENVIRONMENT || ""),
        ...filters
      };

      const items = [];
      let results;
      do {
        const command = new ScanCommand(params);
        results = await docClient.send(command);
        items.push(...results.Items);
        params.ExclusiveStartKey = results.LastEvaluatedKey;
      } while (results.LastEvaluatedKey);

      return items || [];
    } catch (err) {
      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;
    }
  },

  batchGet: async function (batch, tableName) {
    const batchRequestParams = {
      RequestItems: {
        [tableName]: {
          Keys: batch
        }
      }
    };

    console.log("BatchRequestParams", batchRequestParams);

    const command = new BatchGetCommand(batchRequestParams);
    return docClient.send(command);
  },

  deleteOne: async function (id, table, extraKeys = {
  }) {
    try {
      const params = {
        Key: Object.keys(extraKeys).length === 0 ? {
          id
        } : {
          id,
          ...extraKeys
        },
        TableName: table + (process.env.ENVIRONMENT || "")
      };

      const command = new DeleteCommand(params);
      const res = await docClient.send(command);
      return res;
    } catch (err) {
      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;
    }
  },

  updateDB: async function (id, obj, table) {
    try {
      const {
        updateExpression,
        expressionAttributeValues,
        expressionAttributeNames
      } = this.createUpdateExpression(obj);

      const params = {
        Key: {
          id
        },
        TableName: table + (process.env.ENVIRONMENT || ""),
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: expressionAttributeNames,
        UpdateExpression: updateExpression,
        ReturnValues: "UPDATED_NEW",
        ConditionExpression: "attribute_exists(id)"
      };

      const command = new UpdateCommand(params);
      const res = await docClient.send(command);
      return res;
    } catch (err) {
      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;
    }
  },

  updateDBCustom: async function(params) {
    try {
      const command = new UpdateCommand(params);
      const res = await docClient.send(command);
      return res;
    } catch (err) {
      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;
    }
  },

  put: async function(obj, table, createNew) {
    let conditionExpression = "attribute_exists(id)";
    if (createNew) {
      conditionExpression = "attribute_not_exists(id)";
    }
    const params = {
      Item: obj,
      TableName: table + (process.env.ENVIRONMENT || ""),
      ConditionExpression: conditionExpression
    };

    try {
      const command = new PutCommand(params);
      const res = await docClient.send(command);
      return res;
    } catch (err) {
      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;
    }
  }
};
