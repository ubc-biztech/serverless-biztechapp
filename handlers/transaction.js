'use strict';
const helpers = require('./helpers');
const { isEmpty } = require('../utils/functions');
const { TRANSACTIONS_TABLE, USERS_TABLE } = require('../constants/tables');

module.exports.getAll = async (event, ctx, callback) => {

  try {

    const filters = {};
    
    // check if a query was provided
    const userId = event && event.queryStringParameters && event.queryStringParameters.userId;
    
    // construct the filter params if needed
    if (userId) {
      filters.FilterExpression = 'userId = :query';
      filters.ExpressionAttributeValues = {
        ':query': parseInt(userId, 10)
      }
    }

    // scan the table
    const transaction = await helpers.scan(TRANSACTIONS_TABLE, filters);

    let items = {};
    
    // re-organize the response
    if(userId && transaction !== null) {
      items.count = transaction.length;
      items.transactions = transaction;
      items.totalCredits = transaction.reduce((accumulator, item) => accumulator + item.credits, 0);
    }
    else if(userId) {
      items.count = 0;
      items.transactions = {};
      items.totalCredits = 0;
    }
    else if(transaction !== null) items = transaction

    const response = helpers.createResponse(200, items);

    // return the response object
    callback(null, response);
    return null;

  } catch(err) {

    callback(null, err);
    return null;
  }

};

module.exports.create = async (event, ctx, callback) => {

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
        helpers.getOne(data.id, TRANSACTIONS_TABLE),
        helpers.getOne(data.userId, USERS_TABLE)
    ]);

    if(!isEmpty(existingTransaction)) throw helpers.duplicateResponse('id', data);
    if(isEmpty(existingUser)) throw helpers.notFoundResponse('User', data.userId);

    // if credits is negative value, check if the user has enough credits
    if(data.credits < 0) {

      const userCredits = existingUser.credits || 0;
      // 202 means "accepted, but not acted upon"
      if(userCredits + data.credits < 0) throw helpers.createResponse(202, {
        message: 'Transaction was not created because user does not have enough credits!'
      });

    }

    // construct the item object
    const item = {
      id: data.id,
      userId: data.userId,
      reason: data.reason,
      credits: data.credits,
      createdAt: timestamp
    };

    // do the magic
    const res = await helpers.create(item, TRANSACTIONS_TABLE);
    const response = helpers.createResponse(201, {
      message: 'Transaction Created!',
      response: res,
      item
    });

    // return the response object
    callback(null, response);
    return null;

  } catch(err) {

    callback(null, err);
    return null;
  }

};