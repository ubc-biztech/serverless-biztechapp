'use strict';
const AWS = require('aws-sdk');
const helpers = require('./helpers');

module.exports.getAll = async (event, ctx, callback) => {

  const docClient = new AWS.DynamoDB.DocumentClient();

  try {

    // construct the params
    const params = { TableName: 'biztechTransactions' + process.env.ENVIRONMENT };

    // check if a query was provided
    const userId = event && event.queryStringParameters && event.queryStringParameters.userId;

    if (userId) {
      params.FilterExpression = 'userId = :query';
      params.ExpressionAttributeValues = {
        ':query': userId
      }
    }

    // scan the table
    const transaction = await docClient.scan(params).promise();

    let items = {};
    
    // re-organize the response
    if(userId && transaction.Items !== null) {
      items.count = transaction.Items.length;
      items.transactions = transaction.Items;
      items.totalCredits = transaction.Items.reduce((accumulator, item) => accumulator + item.credits, 0);
    }
    else if(userId) {
      items.count = 0;
      items.transactions = {};
      items.totalCredits = 0;
    }
    else if(transaction.Items !== null) items = transaction.Items

    const response = helpers.createResponse(200, items);

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
      userId: { required: true, type: 'number' },
      reason: { required: true, type: 'string'},
      credits: { required: true, type: 'number' },
    });

    // check if there are transactions with the given id
    // check that the user id exists
    const [existingTransaction, existingUser] = await Promise.all([
        docClient.get({ Key: { id: data.id }, TableName: 'biztechTransactions' + process.env.ENVIRONMENT }).promise(),
        docClient.get({ Key: { id: data.userId }, TableName: 'biztechUsers' + process.env.ENVIRONMENT }).promise()
    ]);

    if(existingTransaction.Item && existingTransaction.Item !== null) throw helpers.duplicateResponse('id', data);
    if(!existingUser.Item) throw helpers.notFoundResponse('User', data.userId);

    // if credits is negative value, check if the user has enough credits
    if(data.credits < 0) {

      const userCredits = existingUser.Item.credits || 0;
      // 202 means "accepted, but not acted upon"
      if(userCredits + data.credits < 0) throw helpers.createResponse(202, {
        message: 'Transaction was not created because user does not have enough credits!'
      });

    }

    // construct the param object
    const params = {
      Item: {
          id: data.id,
          userId: data.userId,
          reason: data.reason,
          credits: data.credits,
          createdAt: timestamp
      },
      TableName: 'biztechTransactions' + process.env.ENVIRONMENT,
      ConditionExpression: 'attribute_not_exists(id)'
    };

    // do the magic
    const res = await docClient.put(params).promise();
    const response = helpers.createResponse(201, {
      message: 'Transaction Created!',
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