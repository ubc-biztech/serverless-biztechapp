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
    if(!errorObject.statusCode) errorObject = helpers.createResponse(500, err);

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
    if(!errorObject.statusCode) errorObject = helpers.createResponse(500, err);

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
    if(!event.pathParameters || !event.pathParameters.id) throw helpers.createResponse(400, { message: "A prize id was not provided", data });
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

    if(!existingPrize.Item) throw helpers.notFoundResponse('Prize');

    // construct the update expressions
    let updateExpression = "set ";
    let expressionAttributeValues = {};
    for (const key in data) {
      if (data.hasOwnProperty(key) && key != "id") {
          updateExpression += key + "= :" + key + ",";
          expressionAttributeValues[":" + key] = data[key];
      }
    }
    updateExpression += "updatedAt = :updatedAt";
    expressionAttributeValues[":updatedAt"] = timestamp;

    // construct the param object
    const params = {
      Key: { id },
      TableName: 'biztechPrizes' + process.env.ENVIRONMENT,
      ExpressionAttributeValues: expressionAttributeValues,
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
    if(!errorObject.statusCode) errorObject = helpers.createResponse(500, err);

    callback(null, errorObject);
    return null;
  }

};