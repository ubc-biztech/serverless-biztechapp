'use strict';
const AWS = require('aws-sdk');
const helpers = require('./helpers');
const email = require('../utils/email');
const { isEmpty } = require('../utils/functions');
const { EVENTS_TABLE, USERS_TABLE, USER_REGISTRATIONS_TABLE } = require('../constants/tables');

// const CHECKIN_COUNT_SANITY_CHECK = 500;

/* returns error 403 if the given id/eventID DNE in database
   returns error 502 if there is a problem with processing data or sending an email
   returns 201 when entry is created successfully, error 409 if a registration with the same id/eventID exists 
   returns 200 when entry is updated successfully, error 409 if a registration with the same id/eventID DNE
   sends an email to the user if they are registered, waitlisted, or cancelled, but not if checkedIn
*/
async function updateHelper(data, createNew, idString) {

  const id = parseInt(idString, 10);

  const { eventID, year } = data;
  const eventIDAndYear = eventID + ';' + year;

  //Check if eventID exists and is string. Check if year exists and is number.
  if(typeof eventID !== 'string' || typeof year !== 'number' || isNaN(year)) {

    throw helpers.inputError('\'eventID;year\' could not be parsed into eventID and year in registration.updateHelper', data);

  }


  let registrationStatus = data.registrationStatus;

  // Check if the user exists
  const existingUser = await helpers.getOne(id, USERS_TABLE);
  if(isEmpty(existingUser)) throw helpers.notFoundResponse('User', id);

  // Check if the event exists
  const existingEvent = await helpers.getOne(eventID, EVENTS_TABLE, { year });
  if(isEmpty(existingEvent)) throw helpers.notFoundResponse('Event', eventID, year);

  // Check if the event is full
  if (registrationStatus == 'registered') {

    const counts = await helpers.getEventCounts(eventIDAndYear);

    if (counts == null) {

      throw helpers.dynamoErrorResponse({
        code: 'DYNAMODB ERROR',
        time: new Date().getTime(),
      });

    }

    if (counts.registeredCount >= existingEvent.capac) registrationStatus = 'waitlist';

  }

  // try to send the registration email
  try {

    if(process.env.ENVIRONMENT !== '') await sendEmail(existingUser, existingEvent.ename, registrationStatus);

  }
  catch(err) {

    // if email sending failed, that user's email probably does not exist
    throw helpers.createResponse(500, {
      statusCode: 500,
      code: 'SENDGRID ERROR',
      message: `Sending Email Error!: ${err.message}`
    });

  }

  if(existingUser.heardFrom) data.heardFrom = existingUser.heardFrom;

  const response = await createRegistration(registrationStatus, data, id, eventIDAndYear, createNew);
  return response;

}

async function createRegistration(registrationStatus, data, id, eventIDAndYear, createNew) {

  try {

    const docClient = new AWS.DynamoDB.DocumentClient();

    const updateObject = {
      registrationStatus
    };
    if (data.heardFrom) updateObject.heardFrom = data.heardFrom;

    let conditionExpression = 'attribute_exists(id) and attribute_exists(#eventIDYear)';
    // if we are creating a new object, the condition expression needs to be different
    if (createNew) conditionExpression = 'attribute_not_exists(id) and attribute_not_exists(#eventIDYear)';

    // construct the update expressions
    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    } = helpers.createUpdateExpression(updateObject);

    // Because biztechRegistration table has a sort key, we cannot use helpers.updateDB()
    let params = {
      Key: { id, ['eventID;year']: eventIDAndYear },
      TableName: USER_REGISTRATIONS_TABLE + process.env.ENVIRONMENT,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: {...expressionAttributeNames, '#eventIDYear': 'eventID;year'},
      UpdateExpression: updateExpression,
      ReturnValues: 'UPDATED_NEW',
      ConditionExpression: conditionExpression
    };

    // do the magic
    const res = await docClient.update(params).promise();

    let message = `User with id ${id} successfully registered (through update) to status '${registrationStatus}'!`;
    let statusCode = 200;

    // different status code if created new entry
    if(createNew) {

      message = `User with id ${id} successfully registered (created) to status '${registrationStatus}'!`;
      statusCode = 201;

    }

    const response = helpers.createResponse(statusCode, {
      registrationStatus,
      message,
      response: res
    });

    return response;

  } catch(err) {

    let errorResponse = helpers.dynamoErrorResponse(err);
    const errBody = JSON.parse(errorResponse.body);

    // customize the error messsage if it is caused by the 'ConditionExpression' check
    if(errBody.code === 'ConditionalCheckFailedException') {

      errorResponse.statusCode = 409;
      errBody.statusCode = 409;
      if(createNew) errBody.message = `Create error because the registration entry for user '${id}' and with eventID;year'${eventIDAndYear}' already exists`;
      else errBody.message = `Update error because the registration entry for user '${id}' and with eventID;year '${eventIDAndYear}' does not exist`;
      errorResponse.body = JSON.stringify(errBody);

    }
    throw errorResponse;

  }

}

async function sendEmail(user, eventName, registrationStatus) {

  if(registrationStatus !== 'checkedIn') {

    const userEmail = user.email;
    const userName = user.fname;

    if(!userEmail) throw { message: 'User does not have an e-mail address!' };

    // template id for registered and waitlist
    let tempId = 'd-99da9013c9a04ef293e10f0d73e9b49c';
    if (registrationStatus == 'cancelled') {

      tempId = 'd-0c87cb420ba2456ebc4c3f99a9d50ba0';

    }

    let status = registrationStatus;
    if (registrationStatus == 'waitlist') {

      status = 'waitlisted';

    }
    const msg = {
      to: userEmail,
      from: 'info@ubcbiztech.com',
      templateId: tempId,
      dynamic_template_data: {
        subject: 'BizTech ' + eventName + ' Receipt',
        name: userName,
        registrationStatus: status,
        eventName: eventName
      }
    };

    await email.send(msg);

  }

}

module.exports.post = async (event, ctx, callback) => {

  try {

    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      id: { required: true, type: 'number' },
      eventID: { required: true, type: 'string' },
      year: { required: true, type: 'number' },
      registrationStatus: { required: true , type: 'string' },
    });

    const response = await updateHelper(data, true, data.id);

    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

module.exports.put = async (event, ctx, callback) => {

  try {

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('user');
    const id = event.pathParameters.id;

    const data = JSON.parse(event.body);

    // Check that parameters are valid
    helpers.checkPayloadProps(data, {
      eventID: { required: true, type: 'string' },
      year: { required: true, type: 'number' },
      registrationStatus: { required: true , type: 'string' },
    });

    const response = await updateHelper(data, false, id);

    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};


// Return list of entries with the matching id
module.exports.get = async (event, ctx, callback) => {

  try {

    const queryString = event.queryStringParameters;
    if(!queryString || (!(queryString.eventID && queryString.year) && !queryString.id)) throw helpers.missingIdQueryResponse('event/user');

    console.log(queryString);
    console.log(queryString.eventID);
    console.log(queryString.year);

    let timeStampFilter = undefined;
    if (queryString.hasOwnProperty('afterTimestamp')) {

      timeStampFilter = Number(queryString.afterTimestamp);
      const d = new Date(timeStampFilter);
      console.log('Getting registration on and after ', d.toLocaleString());

    }

    let registrations = [];

    // if eventID and year was given
    if (queryString.hasOwnProperty('eventID') && queryString.hasOwnProperty('year')) {

      const eventIDAndYear = queryString.eventID + ';' + queryString.year;
      console.log("Querying by eventID and year:");
      console.log(eventIDAndYear);
      const filterExpression = {
        FilterExpression: '#eventIDyear = :query',
        ExpressionAttributeNames: {
          '#eventIDyear': 'eventID;year'
        },
        ExpressionAttributeValues: {
          ':query': eventIDAndYear
        }
      };

      registrations = await helpers.scan(USER_REGISTRATIONS_TABLE, filterExpression);

      // filter by id query, if given 
      if(queryString.hasOwnProperty('id')) {
        console.log("Filtering by ID");
        console.log(queryString.id);
        registrations = registrations.filter(entry => entry.id === parseInt(queryString.id, 10));

      }

    } else { // if eventID and year was not given (only id)

      console.log("Querying by id:");
      console.log(queryString.id);

      const id = parseInt(queryString.id, 10);
      const filterExpression = {
        FilterExpression: 'id = :query',
        ExpressionAttributeValues: {
          ':query': id
        }
      };

      registrations = await helpers.scan(USER_REGISTRATIONS_TABLE, filterExpression);

    }

    // filter by timestamp, if given
    if(timeStampFilter !== undefined) {

      console.log("Filtering by timestamps");
      console.log(timeStampFilter);

      registrations = registrations.filter(entry => entry.updatedAt > timeStampFilter);

    }

    console.log(registrations);

    const response = helpers.createResponse(200, {
      size: registrations.length,
      data: registrations
    });

    callback(null, response);
    return null;

  } catch(err) {

    callback(null, err);
    return null;

  }

};

// (used for testing)
module.exports.delete = async (event, ctx, callback) => {

  try {

    const data = JSON.parse(event.body);

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('registration');
    const id = event.pathParameters.id;

    helpers.checkPayloadProps(data, {
      eventID : { required: true , type: 'string' },
      year : { required: true, type: 'number' }
    });

    const eventIDAndYear = data.eventID + ';' + data.year;

    const res = await helpers.deleteOne(id, USER_REGISTRATIONS_TABLE, { ['eventID;year']: eventIDAndYear });

    const response = helpers.createResponse(200, {
      message: 'Registration entry Deleted!',
      response: res
    });

    callback(null, response);
    return null;

  } catch(err) {

    callback(null, err);
    return null;

  }

};
