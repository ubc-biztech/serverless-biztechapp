import docClient from "./docClient.js";
import {
  RESERVED_WORDS
} from "../constants/dynamodb.js";
import {
  PutCommand,
  GetCommand,
  ScanCommand,
  QueryCommand,
  BatchGetCommand,
  DeleteCommand,
  UpdateCommand,
  TransactWriteCommand,
  BatchWriteCommand
} from "@aws-sdk/lib-dynamodb";
import { AUDIT_TABLE } from "../constants/tables.js";

export default {
  // DATABASE HELPER FUNCTIONS
  dynamoErrorResponse: function (err) {
    const body = {
      code: err.code,
      time: err.time,
      requestId: err.requestId,
      statusCode: err.statusCode,
      retryable: err.retryable,
      retryDelay: err.retryDelay
    };
    const response = {
      statusCode: err.statusCode || 502,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true
      },
      type: err.name,
      body:
        body && body.stack && body.message
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
        if (key === "id" || key === "eventID;year" || key === "updatedAt")
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

  create: async function (item, table, email = null) {
    try {
      const params = {
        Item: item,
        TableName: table + (process.env.ENVIRONMENT || ""),
        ConditionExpression: "attribute_not_exists(id)"
      };

      const command = new PutCommand(params);
      const res = await docClient.send(command);
      
      if (email) {
        await this.logChange(table, item.id, email, "CREATE");
      }
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
        Key:
          Object.keys(extraKeys).length === 0
            ? {
              id
            }
            : {
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
  getOneCustom: async function (params) {
    try {
      const command = new GetCommand(params);
      const result = await docClient.send(command);
      return result.Item || null;
    } catch (err) {
      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;
    }
  },

  scan: async function (table, filters = {
  }, indexName = null) {
    try {
      const params = {
        TableName: table + (process.env.ENVIRONMENT || ""),
        ...filters
      };

      if (indexName) {
        params.IndexName = indexName;
      }

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

  batchDelete: async function (items, tableName) {
    const deleteRequests = items.map((key) => ({
      DeleteRequest: { Key: key }
    }));

    const batchRequestParams = {
      RequestItems: {
        [`${tableName}${process.env.ENVIRONMENT || ""}`]: deleteRequests
      }
    };

    const command = new BatchWriteCommand(batchRequestParams);
    return docClient.send(command);
  },

  deleteOne: async function (id, table, extraKeys = {
  }) {
    try {
      const params = {
        Key:
          Object.keys(extraKeys).length === 0
            ? {
              id
            }
            : {
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

  updateDBCustom: async function (params, before = null, after = null, email = null) {
    try {
      const command = new UpdateCommand(params);
      const res = await docClient.send(command);

      if (email) {
        await this.logChange(params.TableName, params.Key.id, email, "UPDATE", this.calculateDelta(before, after));
      }
      return res;
    } catch (err) {
      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;
    }
  },

  calculateDelta: function (before, after) {
    const changes = {};
    const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    
    for (const key of allKeys) {
      if (key === 'updatedAt') continue;

      // in before but not in after (no change)
      if (!after.hasOwnProperty(key)) continue;
      
      const beforeVal = before[key] ? JSON.stringify(before[key]) : null;
      const afterVal = after[key] ? JSON.stringify(after[key]) : null;
      
      if (beforeVal !== afterVal) {
        changes[key] = {
          before: before[key] || "", // not present before
          after: after[key]
        };
      }
    }
    console.log(changes);
    return changes;
  },

  put: async function (obj, table, createNew) {
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
  },

  putMultiple: async function (items, tables, createNew = false) {
    try {
      if (items.length !== tables.length)
        throw {
          statusCode: 502,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Credentials": true
          },
          type: "Transaction items does not match length of tables to write",
          body: {
            items,
            tables
          }
        };

      if (items.length > 25 || items.length === 0)
        throw {
          statusCode: 502,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Credentials": true
          },
          type: "Cannot exceed greater than 25 transaction items, or have an empty transaction",
          body: {
            items,
            tables
          }
        };

      let conditionExpression = createNew
        ? "attribute_not_exists(id)"
        : "attribute_exists(id)";

      const transactItems = items.map((obj, i) => {
        return {
          Put: {
            Item: obj,
            TableName: tables[i] + (process.env.ENVIRONMENT || ""),
            ConditionExpression: conditionExpression
          }
        };
      });

      const params = {
        TransactItems: transactItems
      };

      const command = new TransactWriteCommand(params);
      const res = await docClient.send(command);
      return res;
    } catch (err) {
      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;
    }
  },

  query: async function (table, indexName, keyCondition, filters = {
  }) {
    try {
      const params = {
        TableName: table + (process.env.ENVIRONMENT || ""),
        KeyConditionExpression: keyCondition.expression,
        ExpressionAttributeValues: {
          ...keyCondition.expressionValues,
          ...(filters.ExpressionAttributeValues || {
          })
        }
      };

      if (keyCondition.expressionNames || filters.ExpressionAttributeNames) {
        params.ExpressionAttributeNames = {
          ...keyCondition.expressionNames,
          ...(filters.ExpressionAttributeNames || {
          })
        };
      }

      if (filters.FilterExpression) {
        params.FilterExpression = filters.FilterExpression;
      }

      if (indexName) {
        params.IndexName = indexName;
      }

      const command = new QueryCommand(params);
      const result = await docClient.send(command);

      if (!result) {
        console.warn("Query returned no result");
        return [];
      }

      return result.Items || [];
    } catch (err) {
      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;
    }
  },

  logChange: async function (tableName, recordId, email, changeType, delta = null) {
    try {
      const timestamp = new Date().toISOString();
  
      let item = {
        table_name: tableName,                    
        ["timestamp#email"]: `${timestamp}#${email}`,
        record_id: recordId,
        email,
        change_type: changeType, // CREATE | UPDATE | DELETE 
        timestamp 
      };

      if (delta) {
        item = {
          ...item,
          delta
        }
      }
  
      const params = {
        TableName: AUDIT_TABLE + (process.env.ENVIRONMENT || ""),
        Item: item
      };
  
      const command = new PutCommand(params);
      await docClient.send(command);
    } catch (err) {
      throw this.dynamoErrorResponse(err);
    }
  },
};
