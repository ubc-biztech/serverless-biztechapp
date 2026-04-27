"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const docClient_js_1 = __importDefault(require("./docClient.js"));
const dynamodb_js_1 = require("../constants/dynamodb.js");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
exports.default = {
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
        let expressionAttributeValues = {};
        let expressionAttributeNames = null;
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                if (key === "id" || key === "eventID;year" || key === "updatedAt")
                    continue;
                else if (dynamodb_js_1.RESERVED_WORDS.includes(key.toUpperCase())) {
                    updateExpression += `#v${val} = :val${val},`;
                    expressionAttributeValues[`:val${val}`] = obj[key];
                    if (!expressionAttributeNames)
                        expressionAttributeNames = {};
                    expressionAttributeNames[`#v${val}`] = key;
                    val++;
                }
                else {
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
            const command = new lib_dynamodb_1.PutCommand(params);
            const res = await docClient_js_1.default.send(command);
            return res;
        }
        catch (err) {
            const errorResponse = this.dynamoErrorResponse(err);
            throw errorResponse;
        }
    },
    getOne: async function (id, table, extraKeys = {}) {
        try {
            const params = {
                Key: Object.keys(extraKeys).length === 0
                    ? {
                        id
                    }
                    : {
                        id,
                        ...extraKeys
                    },
                TableName: table + (process.env.ENVIRONMENT || "")
            };
            const command = new lib_dynamodb_1.GetCommand(params);
            const result = await docClient_js_1.default.send(command);
            return result.Item || null;
        }
        catch (err) {
            const errorResponse = this.dynamoErrorResponse(err);
            throw errorResponse;
        }
    },
    getOneCustom: async function (params) {
        try {
            const command = new lib_dynamodb_1.GetCommand(params);
            const result = await docClient_js_1.default.send(command);
            return result.Item || null;
        }
        catch (err) {
            const errorResponse = this.dynamoErrorResponse(err);
            throw errorResponse;
        }
    },
    scan: async function (table, filters = {}, indexName = null) {
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
                const command = new lib_dynamodb_1.ScanCommand(params);
                results = await docClient_js_1.default.send(command);
                items.push(...results.Items);
                params.ExclusiveStartKey = results.LastEvaluatedKey;
            } while (results.LastEvaluatedKey);
            return items || [];
        }
        catch (err) {
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
        const command = new lib_dynamodb_1.BatchGetCommand(batchRequestParams);
        return docClient_js_1.default.send(command);
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
        const command = new lib_dynamodb_1.BatchWriteCommand(batchRequestParams);
        return docClient_js_1.default.send(command);
    },
    deleteOne: async function (id, table, extraKeys = {}) {
        try {
            const params = {
                Key: Object.keys(extraKeys).length === 0
                    ? {
                        id
                    }
                    : {
                        id,
                        ...extraKeys
                    },
                TableName: table + (process.env.ENVIRONMENT || "")
            };
            const command = new lib_dynamodb_1.DeleteCommand(params);
            const res = await docClient_js_1.default.send(command);
            return res;
        }
        catch (err) {
            const errorResponse = this.dynamoErrorResponse(err);
            throw errorResponse;
        }
    },
    updateDB: async function (id, obj, table) {
        try {
            const { updateExpression, expressionAttributeValues, expressionAttributeNames } = this.createUpdateExpression(obj);
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
            const command = new lib_dynamodb_1.UpdateCommand(params);
            const res = await docClient_js_1.default.send(command);
            return res;
        }
        catch (err) {
            const errorResponse = this.dynamoErrorResponse(err);
            throw errorResponse;
        }
    },
    updateDBCustom: async function (params) {
        try {
            const command = new lib_dynamodb_1.UpdateCommand(params);
            const res = await docClient_js_1.default.send(command);
            return res;
        }
        catch (err) {
            const errorResponse = this.dynamoErrorResponse(err);
            throw errorResponse;
        }
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
            const command = new lib_dynamodb_1.PutCommand(params);
            const res = await docClient_js_1.default.send(command);
            return res;
        }
        catch (err) {
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
            const command = new lib_dynamodb_1.TransactWriteCommand(params);
            const res = await docClient_js_1.default.send(command);
            return res;
        }
        catch (err) {
            const errorResponse = this.dynamoErrorResponse(err);
            throw errorResponse;
        }
    },
    writeMultiple: async function (transactItems) {
        try {
            if (!transactItems || transactItems.length === 0 || transactItems.length > 25) {
                throw {
                    statusCode: 502,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Credentials": true
                    },
                    type: "Cannot exceed greater than 25 transaction items, or have an empty transaction",
                    body: { transactItems }
                };
            }
            const tableSuffix = process.env.ENVIRONMENT || "";
            const itemsWithEnv = transactItems.map((item) => {
                if (item.Put) {
                    const putItem = Object.assign({}, item.Put);
                    putItem.TableName = item.Put.TableName + tableSuffix;
                    return { Put: putItem };
                }
                if (item.Update) {
                    const updateItem = Object.assign({}, item.Update);
                    updateItem.TableName = item.Update.TableName + tableSuffix;
                    return { Update: updateItem };
                }
                if (item.Delete) {
                    const deleteItem = Object.assign({}, item.Delete);
                    deleteItem.TableName = item.Delete.TableName + tableSuffix;
                    return { Delete: deleteItem };
                }
                if (item.ConditionCheck) {
                    const conditionItem = Object.assign({}, item.ConditionCheck);
                    conditionItem.TableName = item.ConditionCheck.TableName + tableSuffix;
                    return { ConditionCheck: conditionItem };
                }
                return item;
            });
            const params = { TransactItems: itemsWithEnv };
            const command = new lib_dynamodb_1.TransactWriteCommand(params);
            const res = await docClient_js_1.default.send(command);
            return res;
        }
        catch (err) {
            const errorResponse = this.dynamoErrorResponse(err);
            throw errorResponse;
        }
    },
    query: async function (table, indexName, keyCondition, filters = {}) {
        try {
            const params = {
                TableName: table + (process.env.ENVIRONMENT || ""),
                KeyConditionExpression: keyCondition.expression,
                ExpressionAttributeValues: {
                    ...keyCondition.expressionValues,
                    ...(filters.ExpressionAttributeValues || {})
                }
            };
            if (keyCondition.expressionNames || filters.ExpressionAttributeNames) {
                params.ExpressionAttributeNames = {
                    ...keyCondition.expressionNames,
                    ...(filters.ExpressionAttributeNames || {})
                };
            }
            if (filters.FilterExpression) {
                params.FilterExpression = filters.FilterExpression;
            }
            if (indexName) {
                params.IndexName = indexName;
            }
            const command = new lib_dynamodb_1.QueryCommand(params);
            const result = await docClient_js_1.default.send(command);
            if (!result) {
                console.warn("Query returned no result");
                return [];
            }
            return result.Items || [];
        }
        catch (err) {
            const errorResponse = this.dynamoErrorResponse(err);
            throw errorResponse;
        }
    }
};
