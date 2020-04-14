'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_KEY);


module.exports.create = async (event, ctx, callback) => {

  // TODO: merge Jacques PR for checking required fields
  const data = JSON.parse(event.body);

  // Check that parameters are valid
  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('Registration student ID not specified.', data));
    return;
  } else if (!data.hasOwnProperty('eventID')) {
    callback(null, helpers.inputError('Registration event ID not specified.', data));
    return;
  } else if (!data.hasOwnProperty('registrationStatus')) {
    const response = {
      statusCode: 406,
      body: JSON.stringify({
        message: 'Status not specified.',
        data: data
      }, null, 2),
    };
    callback(null, response);
    return;
  }
  const id = parseInt(data.id, 10);
  const eventID = data.eventID;
  let eventName = "";
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
        eventName = event.Item.ename;

        if (counts.registeredCount >= event.Item.capac) {
          registrationStatus = 'waitlist'
        }
      })
  }

  //confirmation email 
  const userParams = {
    Key: { id: id },
    TableName: 'biztechUsers' + process.env.ENVIRONMENT
  }

  await docClient.get(userParams).promise()
    .then(async (user) => {
      console.log(user);
      const userEmail = await user.Item.email;
      const userName = await user.Item.fname;
      if (eventName != undefined) {

        const msg = {
          to: userEmail,
          from: "info@ubcbiztech.com",
          templateId: "d-99da9013c9a04ef293e10f0d73e9b49c",
          dynamic_template_data: {
            subject: "BizTech " + eventName + "Receipt",
            name: userName,
            registrationStatus: registrationStatus,
            eventName: eventName
          }
        }
        if (msg) {
          await sgMail.send(msg);
        }
      }
    })


  const updateObject = { registrationStatus };
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
      const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({
          message: 'Update succeeded',
          registrationStatus
        })
      };
      callback(null, response)
    })
    .catch(error => {
      console.error(error);
      const response = {
        statusCode: 500,
        body: error
      };
      callback(null, response)
    });
};

// Return list of entries with the matching id
module.exports.queryStudent = async (event, ctx, callback) => {
  const queryString = event.queryStringParameters;
  if (queryString == null || !queryString.hasOwnProperty('id')) {
    callback(null, helpers.inputError('Student ID not specified.', queryString));
    return;
  }
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
      const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({
          size: data.length,
          data: data
        }, null, 2)
      };
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to query registration table.'));
      return;
    });
}

// Return list of entries with the matching eventID
module.exports.scanEvent = async (event, ctx, callback) => {
  const queryString = event.queryStringParameters;
  if (queryString == null || !queryString.hasOwnProperty('eventID')) {
    callback(null, helpers.inputError('Event ID not specified.', queryString));
    return;
  }
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
      console.log('Scan success.');
      const data = result.Items;
      const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({
          size: data.length,
          data: data
        }, null, 2)
      };
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to scan registration table.'));
      return;
    });
}
