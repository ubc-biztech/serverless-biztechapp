'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers');
const email = require('../utils/email');
const { isEmpty } = require('../utils/functions');
// const CHECKIN_COUNT_SANITY_CHECK = 500;

/* returns an error if id, eventID, or registrationStatus is not provided
   returns error 403 if the given id/eventID DNE in database
   returns error 502 if there is a problem with processing data or sending an email
   returns 201 when entry is created successfully, error 409 if a registration with the same id/eventID exists 
   returns 200 when entry is updated successfully, error 409 if a registration with the same id/eventID DNE
   sends an email to the user if they are registered, waitlisted, or cancelled, but not if checkedIn
*/
async function updateHelper(event, callback, data, createNew, idString) {

  if (data == null || !data.hasOwnProperty('eventID')) {

    return callback(null, helpers.inputError('Registration event ID not specified.', data));

  } else if (!data.hasOwnProperty('registrationStatus')) {

    return callback(null, helpers.inputError('Status not specified.', data));

  }
  const id = parseInt(idString, 10);
  const eventID = data.eventID;
  let registrationStatus = data.registrationStatus;

  // Check if the event is full
  // TODO: Refactor this nicely into a promise or something

  const eventParams = {
    Key: { id: eventID },
    TableName: 'biztechEvents' + process.env.ENVIRONMENT
  };

  await docClient.get(eventParams).promise()
    .then(async (event) => {

      if (event.Item == null) {

        throw 'event';

      }

      if (registrationStatus == 'registered') {

        const counts = await helpers.getEventCounts(eventID);

        if (counts == null) {

          throw 'error getting event counts';

        }

        if (counts.registeredCount >= event.Item.capac) {

          registrationStatus = 'waitlist';

        }

      }
      return event.Item.ename;

    })
    .then(async (eventName) => {

      // if send email is resolved, then update the database since both email and user exists

      await sendEmail(id, eventName, registrationStatus)
        .then(async () => {

          await createRegistration(registrationStatus, data, id, eventID, createNew, callback);

        });

    })
    .catch(error => {

      let response;
      let message;
      switch (error) {

      case 'event':
        response = helpers.createResponse(403, 'Event with eventID: ' + eventID + ' was not found.');
        break;
      case 'user':
        response = helpers.createResponse(403, 'User with user id: ' + id + ' was not found.');
        break;
      case 'exists':
        message = 'Entry with given id and eventID already exists.';
        response = helpers.createResponse(409, { message });
        break;
      case 'DNE':
        message = 'Entry with given id and eventID doesn\'t exist.';
        response = helpers.createResponse(409, { message });
        break;
      default:
        response = helpers.createResponse(502, error);

      }
      callback(null, response);

    });

}

async function createRegistration(registrationStatus, data, id, eventID, createNew, callback) {

  const updateObject = { registrationStatus };
  if (data.heardFrom) {

    updateObject.heardFrom = data.heardFrom;

  }
  console.log(updateObject);

  const {
    updateExpression,
    expressionAttributeValues
  } = helpers.createUpdateExpression(updateObject);

  // Because biztechRegistration table has a sort key we cannot use updateDB()
  let params = {
    Key: {
      id,
      eventID
    },
    TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
    ExpressionAttributeValues: expressionAttributeValues,
    UpdateExpression: updateExpression,
    ReturnValues: 'UPDATED_NEW'
  };

  if (createNew) {

    params['ConditionExpression'] = 'attribute_not_exists(id) and attribute_not_exists(eventID)';

  } else {

    params['ConditionExpression'] = 'attribute_exists(id) and attribute_exists(eventID)';

  }

  // call dynamoDb
  await docClient.update(params).promise()
    .then(() => {

      let response;
      if (createNew) {

        response = helpers.createResponse(201, {
          message: 'Entry created',
          registrationStatus
        });

      } else {

        response = helpers.createResponse(200, {
          message: 'Update succeeded',
          registrationStatus
        });

      }
      callback(null, response);

    })
    .catch(error => {

      console.error(error);
      if (error.code === 'ConditionalCheckFailedException') {

        if (createNew) {

          throw 'exists';

        } else {

          throw 'DNE';

        }

      }
      throw '502';

    });

}

async function sendEmail(id, eventName, registrationStatus) {

  const user = await helpers.getOne(id, 'biztechUsers');
  if(isEmpty(user)) throw helpers.notFoundResponse('user', id);

  if(registrationStatus !== 'checkedIn') {

    const userEmail = user.Item.email;
    const userName = user.Item.fname;

    //template id for registered and waitlist
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
      id: { required: true }
    });

    const res = await updateHelper(event, callback, data, true, data.id);
    const response = {
      message: `User with id ${data.id} successfully registered!`,
      response: res
    };

    callback(200, response);
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

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('event');
    const id = event.pathParameters.id;

    const data = JSON.parse(event.body);

    // Check that parameters are valid
    // TODO: Turn into using "checkPayloadProps"
    if (data == null) return callback(null, helpers.inputError('Registration data not specified.', data));

    await updateHelper(event, callback, data, false, id);

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};


// Return list of entries with the matching id
module.exports.get = async (event, ctx, callback) => {

  const queryString = event.queryStringParameters;
  if (queryString == null || (!queryString.hasOwnProperty('eventID') && !queryString.hasOwnProperty('id'))) {

    callback(null, helpers.inputError('User and/or Event ID not specified.', queryString));
    return;

  }
  let timeStampFilter = undefined;
  if (queryString.hasOwnProperty('afterTimestamp')) {

    timeStampFilter = Number(queryString.afterTimestamp);
    const d = new Date(timeStampFilter);
    console.log('Get registration on and after ', d.getHours() + ':' + d.getMinutes() + '/' + d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear());

  }
  if (queryString.hasOwnProperty('eventID')) {

    const eventID = queryString.eventID;
    const params = {
      TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
      FilterExpression: 'eventID = :query',
      ExpressionAttributeValues: {
        ':query': eventID
      }
    };
    await docClient.scan(params).promise()
      .then(result => {

        let data = result.Items;
        if (queryString.hasOwnProperty('id')) {

          data = data.filter(entry => entry.id === parseInt(queryString.id, 10));

        }
        if (timeStampFilter !== undefined) {

          data = data.filter(entry => entry.updatedAt > timeStampFilter);

        }
        let response;
        if (data.length == 0) {

          response = helpers.notFoundResponse();

        } else {

          response = helpers.createResponse(200, {
            size: data.length,
            data: data
          });

        }
        callback(null, response);

      })
      .catch(error => {

        console.error(error);
        const response = helpers.createResponse(502, error);
        callback(null, response);

      });

  } else {

    // only has id parameter
    const id = parseInt(queryString.id, 10);
    const params = {
      TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
      KeyConditionExpression: 'id = :query',
      ExpressionAttributeValues: {
        ':query': id
      }
    };

    await docClient.query(params).promise()
      .then(result => {

        console.log('Query success.');
        let data = result.Items;
        if (timeStampFilter !== undefined) {

          data = data.filter(entry => entry.updatedAt > timeStampFilter);

        }
        let response;
        if (data.length == 0) {

          response = helpers.notFoundResponse();

        } else {

          response = helpers.createResponse(200, {
            size: data.length,
            data: data
          });

        }
        callback(null, response);

      })
      .catch(error => {

        console.error(error);
        helpers.createResponse(502, error);
        callback(null, error);
        return null;

      });

  }

};