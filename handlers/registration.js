'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers');
const email = require('../utils/email')

module.exports.post = async (event, ctx, callback) => {
  const data = JSON.parse(event.body);

  // Check that parameters are valid
  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('Registration student ID not specified.', data));
  } else if (!data.hasOwnProperty('eventID')) {
    callback(null, helpers.inputError('Registration event ID not specified.', data));
  } else if (!data.hasOwnProperty('registrationStatus')) {
    callback(null, helpers.inputError('Status not specified.', data));
  }
  const id = parseInt(data.id, 10);
  const eventID = data.eventID;
  let registrationStatus = data.registrationStatus;

  // Check if the event is full
  if (registrationStatus === 'registered') {

    const eventParams = {
      Key: { id: eventID },
      TableName: 'biztechEvents' + process.env.ENVIRONMENT
    }

    await docClient.get(eventParams).promise()
      .then(async (event) => {
        const counts = await helpers.getEventCounts(eventID);

        if (counts.registeredCount >= event.Item.capac) {
          registrationStatus = 'waitlist'
        }
        return event.Item.ename;
      })
      .then(async (eventName) => {
        //after the person has been either registered or waitlisted, send confirmation email 
        const userParams = {
          Key: { id: id },
          TableName: 'biztechUsers' + process.env.ENVIRONMENT
        }
        console.log('user params')
        console.log(userParams)
        await docClient.get(userParams).promise()
          .then(async (user) => {
            console.log(user);
            const userEmail = user.Item.email;
            const userName = user.Item.fname;

            const msg = {
              to: userEmail,
              from: "info@ubcbiztech.com",
              templateId: "d-99da9013c9a04ef293e10f0d73e9b49c",
              dynamic_template_data: {
                subject: "BizTech " + eventName + " Receipt",
                name: userName,
                registrationStatus: registrationStatus,
                eventName: eventName
              }
            }
            await email.send(msg);
          })
      })
  }

  const updateObject = { registrationStatus };
  if (data.heardFrom) {
    updateObject.heardFrom = data.heardFrom
  }
  console.log(updateObject)

  const {
    updateExpression,
    expressionAttributeValues
  } = helpers.createUpdateExpression(updateObject)

  // Because biztechRegistration table has a sort key we cannot use updateDB()
  var params = {
    Key: {
      id,
      eventID
    },
    TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
    ExpressionAttributeValues: expressionAttributeValues,
    UpdateExpression: updateExpression,
    ReturnValues: "UPDATED_NEW"
  };

  // call dynamoDb
  await docClient.update(params).promise()
    .then(result => {
      const response = helpers.createResponse(200, {
        message: 'Update succeeded',
        registrationStatus
      })
      callback(null, response)
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error);
      callback(null, response)
    });
};

// Return list of entries with the matching id
module.exports.get = async (event, ctx, callback) => {
  const queryString = event.queryStringParameters;
  if (queryString == null || (!queryString.hasOwnProperty('eventID') && !queryString.hasOwnProperty('id'))) {
    callback(null, helpers.inputError('User and/or Event ID not specified.', queryString));
    return;
  }

  if (queryString.hasOwnProperty('eventID')) {
    const eventID = parseInt(queryString.eventID, 10);
    const params = {
      TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
      FilterExpression: 'eventID = :query',
      ExpressionAttributeValues: {
        ':query': eventID
      }
    };
  
    await docClient.scan(params).promise()
      .then(result => {
        console.log('Scan success.');
        const data = result.Items;
        if (queryString.hasOwnProperty('id')) {
          data = data.filter(entry => entry.id === parseInt(queryString.id, 10));
        }
        const response;
        if (data.length == 0) {
          response = helpers.notFoundResponse();
        } else {
          response = helpers.createResponse(200, {
            size: data.length,
            data: data
          })
        }
        callback(null, response);
      })
      .catch(error => {
        console.error(error);
        const response = helpers.createResponse(502, error)
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
        const data = result.Items;
        const response;
        if (data.length == 0) {
          response = helpers.notFoundResponse();
        }
        response = helpers.createResponse(200, {
          size: data.length,
          data: data
        })
        callback(null, response);
      })
      .catch(error => {
        console.error(error);
        helpers.createResponse(502, error)
        callback(null, response);
      });
  }
}
