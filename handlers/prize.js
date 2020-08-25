'use strict';
const AWS = require('aws-sdk');
const helpers = require('./helpers');

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
      message: 'Event Created!',
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