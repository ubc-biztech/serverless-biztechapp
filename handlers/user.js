'use strict';
const AWS = require('aws-sdk');
const helpers = require('./helpers');
const { isEmpty } = require('../utils/functions');
const { USERS_TABLE, USER_INVITE_CODES_TABLE, EVENTS_TABLE } = require('../constants/tables');

module.exports.create = async (event, ctx, callback) => {

  const docClient = new AWS.DynamoDB.DocumentClient();

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);

  if (!data.hasOwnProperty('id')) {

    callback(null, helpers.inputError('User ID not specified.', data));

  }

  const id = parseInt(data.id, 10);

  const email = data.email;

  let isBiztechAdmin = false;

  //assume the created user is biztech admin if using biztech email
  if (
    email.substring(email.indexOf('@') + 1, email.length) === 'ubcbiztech.com'
  ) {

    isBiztechAdmin = true;

  }
  const userParams = {
    Item: {
      id,
      fname: data.fname,
      lname: data.lname,
      email: data.email,
      faculty: data.faculty,
      year: data.year,
      gender: data.gender,
      diet: data.diet,
      createdAt: timestamp,
      updatedAt: timestamp,
      admin: isBiztechAdmin,
    },
    TableName: USERS_TABLE + process.env.ENVIRONMENT,
    ConditionExpression: 'attribute_not_exists(id)'
  };


  //check whether the favedEventsArray body param meets the requirements
  if (data.hasOwnProperty('favedEventsArray') && Array.isArray(data.favedEventsArray)) {

    let favedEventsArray = data.favedEventsArray;
    if (!favedEventsArray.length === 0) {

      callback(null, helpers.inputError('the favedEventsArray is empty', data));

    }
    if (!favedEventsArray.every(eventIDAndYear => (typeof eventIDAndYear === 'string'))) {

      callback(null, helpers.inputError('the favedEventsArray contains non-string element(s)', data));

    }
    if (favedEventsArray.length !== new Set(favedEventsArray).size) {

      callback(null, helpers.inputError('the favedEventsArray contains duplicate elements', data));

    }
    //if all conditions met, add favedEventsArray as a Set to userParams
    userParams.Item['favedEventsID;year'] = docClient.createSet(favedEventsArray);

  }

  if (data.hasOwnProperty('inviteCode')) {

    const inviteCodeParams = {
      Key: { id: data.inviteCode },
      TableName: USER_INVITE_CODES_TABLE + process.env.ENVIRONMENT
    };
    await docClient
      .get(inviteCodeParams)
      .promise()
      .then(async result => {

        if (result.Item == null) {

          const response = helpers.createResponse(
            404,
            'Invite code not found.'
          );
          callback(null, response);

        } else {

          // invite code was found
          // add paid: true to user
          userParams.Item.paid = true;
          const deleteParams = {
            Key: { id: data.inviteCode },
            TableName: USER_INVITE_CODES_TABLE + process.env.ENVIRONMENT
          };
          await docClient.delete(deleteParams).promise();

        }

      })
      .catch(error => {

        console.error(error);
        const response = helpers.createResponse(502, error);
        callback(null, response);

      });

  }

  await docClient
    .put(userParams)
    .promise()
    .then(() => {

      const response = helpers.createResponse(201, {
        message: 'Created!',
        params: userParams
      });
      callback(null, response);

    })
    .catch(error => {

      let response;
      if (error.code === 'ConditionalCheckFailedException') {

        response = helpers.createResponse(409,
          'User could not be created because id already exists');

      } else {

        response = helpers.createResponse(502,
          'Internal Server Error occurred');

      }
      callback(null, response);

    });

};

module.exports.get = async (event, ctx, callback) => {

  try {

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('event');
    const id = parseInt(event.pathParameters.id, 10);
    if(isNaN(id)) throw helpers.inputError('Id is not a number!');

    const user = await helpers.getOne(id, USERS_TABLE);
    if(isEmpty(user)) throw helpers.notFoundResponse('user', id);

    const response = helpers.createResponse(200, user);
    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

module.exports.update = async (event, ctx, callback) => {

  try {

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('event');
    const id = event.pathParameters.id;

    const existingUser = await helpers.getOne(id, USERS_TABLE);
    if(isEmpty(existingUser)) throw helpers.notFoundResponse('user', id);

    const data = JSON.parse(event.body);

    const res = await helpers.updateDB(id, data, USERS_TABLE);
    const response = helpers.createResponse(200, {
      message: `Updated event with id ${id}!`,
      response: res
    });

    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

module.exports.getAll = async (event, ctx, callback) => {

  try {

    const users = await helpers.scan(USERS_TABLE);

    // create the response
    const response = helpers.createResponse(200, users);

    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

module.exports.favouriteEvent = async (event, ctx, callback) => {

  const docClient = new AWS.DynamoDB.DocumentClient();

  try {

    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      ['eventID;year']: { required: true, type: 'string' },
      isFavourite: { required: true, type: 'boolean' }
    });

    const eventIDAndYear = data['eventID;year'];
    const eventObj = helpers.parseEventIDAndYear(eventIDAndYear);
    const {eventID, year} = eventObj;

    //Check if eventID exists and is string. Check if year exists and is number.
    if(typeof eventID !== 'string' || typeof year !== 'number' || isNaN(year)) {
      throw helpers.inputError("'eventID;year' could not be parsed into eventID and year in user.favoriteEvent", eventObj);
    }

    const id = parseInt(event.pathParameters.id, 10);

    const existingEvent = await helpers.getOne(eventID, EVENTS_TABLE, {year});
    if(isEmpty(existingEvent)) throw helpers.notFoundResponse('event', eventID);

    const existingUser = await helpers.getOne(id, USERS_TABLE);
    if(isEmpty(existingUser)) throw helpers.notFoundResponse('user', id);

    let updateExpression = '';
    let conditionExpression = '';
    const isFavourite = data.isFavourite;
    if (isFavourite) {

      updateExpression = 'add favedEventsID;year :eventsID;year';
      conditionExpression =
        'attribute_exists(id) and (not contains(favedEventsID;year, :eventID;year))'; // if eventID already exists, don't perform add operation

    } else {

      updateExpression = 'delete favedEventsID;year :eventsID;year';
      conditionExpression =
        'attribute_exists(id) and contains(favedEventsID;year, :eventID;year)'; // if eventID does not exist, don't perform delete operation

    }

    let expressionAttributeValues;
    expressionAttributeValues = {
      ':eventsID;year': docClient.createSet([eventIDAndYear]) // set data type, for updateExpression
    };
    expressionAttributeValues[':eventID;year'] = eventIDAndYear; // string data type, for conditionExpression

    const params = {
      Key: { id },
      TableName: USERS_TABLE + process.env.ENVIRONMENT,
      ExpressionAttributeValues: expressionAttributeValues,
      UpdateExpression: updateExpression,
      ConditionExpression: conditionExpression
    };

    const res = await docClient.update(params).promise();

    let successMsg = isFavourite ? 'Favourited' : 'Unfavourited';
    successMsg += ` event with id and year ${eventIDAndYear}`;
    callback(null, helpers.createResponse(200, {
      message: successMsg,
      response: res
    }));
    return null;

  }
  catch(err) {

    console.error(err);
    const response = helpers.createResponse(err.statusCode || 500, err);
    callback(null, response);
    return null;

  }

};

// TODO: refactor to abstract delete code among different endpoints
module.exports.delete = async (event, ctx, callback) => {

  try {

    // check that the param was given
    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('event');
    const id = event.pathParameters.id;

    // check that the user exists
    const existingUser = await helpers.getOne(id, USERS_TABLE);
    if(isEmpty(existingUser)) throw helpers.notFoundResponse('User', id);

    const res = await helpers.deleteOne(id, USERS_TABLE);
    const response = helpers.createResponse(200, {
      message: 'User deleted!',
      response: res
    });

    callback(null, response);
    return null;

  } catch(err) {

    callback(null, err);
    return null;

  }

};
