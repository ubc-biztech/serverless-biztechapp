'use strict';
const AWS = require('aws-sdk');
const helpers = require('./helpers');

module.exports.getAll = async (event, ctx, callback) => {

  const docClient = new AWS.DynamoDB.DocumentClient();

  try {

    // scan the table
    const transaction = await docClient.scan({
      TableName: 'biztechTransactions' + process.env.ENVIRONMENT,
    }).promise();

    let response = {}
    
    // re-organize the response
    if(transaction.Items !== null) response = helpers.createResponse(200, transaction.Items);

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
    if(!existingUser.Item) throw helpers.notFoundResponse('User', data.id);

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
    console.log({err})
    if(!errorObject.statusCode && !errorObject.headers) errorObject = helpers.dynamoErrorResponse(err);

    callback(null, errorObject);
    return null;
  }

};