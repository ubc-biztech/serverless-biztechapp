'use strict';
const AWS = require('aws-sdk');
const helpers = require('./helpers');

module.exports.getAll = async (event, ctx, callback) => {

  const docClient = new AWS.DynamoDB.DocumentClient();

  try {

    // scan the table
    const prizes = await docClient.scan({
      TableName: 'biztechPrizes' + process.env.ENVIRONMENT,
    }).promise();

    let response = {}
    
    // re-organize the response
    if(prizes.Items !== null) response = helpers.createResponse(200, prizes.Items);

    // return the response object
    callback(null, response);
    return null;

  } catch(err) {

    // check if it is an unidentified error
    let errorObject = err;
    if(!errorObject.statusCode && !errorObject.headers) errorObject = helpers.dynamoErrorResponse(err);

    callback(null, errorObject);
    return null;
  }

};

module.exports.create = async (event, ctx, callback) => {

  const docClient = new AWS.DynamoDB.DocumentClient();

  try {

    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body);

    // check request body
    helpers.checkPayloadProps(data, {
      id: { required: true, type: 'string' },
      name: { required: true, type: 'string' },
      imageHash: { type: 'string'},
      price: { required: true, type: 'number' },
      links: { type: 'object' }
    });

    // check if there are prizes with the given id
    const existingPrize = await docClient.get({
      Key: { id: data.id },
      TableName: 'biztechPrizes' + process.env.ENVIRONMENT,
    }).promise();

    if(existingPrize.Item && existingPrize.Item !== null) throw helpers.duplicateResponse('id', data);

    // construct the param object
    const params = {
      Item: {
          id: data.id,
          name: data.name,
          price: data.price,
          imageHash: data.imageHash,
          links: data.links,
          createdAt: timestamp,
          updatedAt: timestamp
      },
      TableName: 'biztechPrizes' + process.env.ENVIRONMENT,
      ConditionExpression: 'attribute_not_exists(id)'
    };

    // do the magic
    const res = await docClient.put(params).promise();
    const response = helpers.createResponse(201, {
      message: 'Prize Created!',
      params: params,
      response: res
    });

    // return the response object
    callback(null, response);
    return null;

  } catch(err) {

    // check if it is an unidentified error
    let errorObject = err;
    if(!errorObject.statusCode && !errorObject.headers) errorObject = helpers.dynamoErrorResponse(err);

    callback(null, errorObject);
    return null;
  }

};

module.exports.update = async (event, ctx, callback) => {

  const docClient = new AWS.DynamoDB.DocumentClient();

  try {

    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body);
    
    // check if id was given
    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdResponse('prize');
    const id = event.pathParameters.id;

    // check request body
    helpers.checkPayloadProps(data, {
      name: { type: 'string' },
      imageHash: { type: 'string'},
      price: { type: 'number' },
      links: { type: 'object' }
    });

    // check that the id exists
    const existingPrize = await docClient.get({
      Key: { id },
      TableName: 'biztechPrizes' + process.env.ENVIRONMENT,
    }).promise();

    if(!existingPrize.Item) throw helpers.notFoundResponse('Prize', id);

    // construct the update expressions
    let updateExpression = "set ";
    let expressionAttributeValues = {};
    let expressionAttributeNames = {};
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        if(key === "name") {  // "name" is a reserved word in dynamoDB
          updateExpression += "#nm = :nmval,";
          expressionAttributeValues[":nmval"] = data["name"];
          expressionAttributeNames["#nm"] = "name";
        } else {
          updateExpression += key + "= :" + key + ",";
          expressionAttributeValues[":" + key] = data[key];
        }
      }
    }
    updateExpression += "updatedAt = :updatedAt";
    expressionAttributeValues[":updatedAt"] = timestamp;

    // construct the param object
    const params = {
      Key: { id },
      TableName: 'biztechPrizes' + process.env.ENVIRONMENT,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
      UpdateExpression: updateExpression,
      ReturnValues: "UPDATED_NEW",
      ConditionExpression: "attribute_exists(id)"
    };

    // do the magic
    const res = await docClient.update(params).promise();
    const response = helpers.createResponse(200, {
      message: 'Prize Updated!',
      params: params,
      response: res
    });
    
    // return the response object
    callback(null, response);
    return null;

  } catch(err) {

    // check if it is an unidentified error
    let errorObject = err;
    if(!errorObject.statusCode && !errorObject.headers) errorObject = helpers.dynamoErrorResponse(err);

    callback(null, errorObject);
    return null;
  }

};

module.exports.delete = async (event, ctx, callback) => {
  
  const docClient = new AWS.DynamoDB.DocumentClient();

  try {
    
    // check if id was given
    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdResponse('prize');
    const id = event.pathParameters.id;

    // check that the id exists
    const existingPrize = await docClient.get({
      Key: { id },
      TableName: 'biztechPrizes' + process.env.ENVIRONMENT,
    }).promise();

    if(!existingPrize.Item) throw helpers.notFoundResponse('Prize', id);

    // construct the param object
    const params = {
      Key: { id },
      TableName: 'biztechPrizes' + process.env.ENVIRONMENT
    };

    // do the magic
    const res = await docClient.delete(params).promise()

    const response = helpers.createResponse(200, {
      message: 'Prize deleted!',
      params: params,
      response: res
    })

    callback(null, response);

  } catch(err) {

    // check if it is an unidentified error
    let errorObject = err;
    if(!errorObject.statusCode && !errorObject.headers) errorObject = helpers.dynamoErrorResponse(err);

    callback(null, errorObject);
    return null;
  }

};
