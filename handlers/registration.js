'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers')

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);
  const studentID = parseInt(data.studentID, 10);
  const eventID = data.eventID;
  let registrationStatus = data.registrationStatus;

  const eventParams = {
    Key: { id: eventID },
    TableName: 'biztechEvents' + process.env.ENVIRONMENT
  }

  await docClient.get(eventParams).promise()
    .then(async(event) => {
      const counts = await helpers.getEventCounts(eventID)
      if (counts.registeredCount >= event.capac){
        registrationStatus = 'waitlist'
      }
    })
    
    const updateObject = {
      registrationStatus,
      createdAt: timestamp
    };

    const {
      updateExpression,
      expressionAttributeValues
    } = helpers.createUpdateExpression(updateObject)

    var params = {
      Key: {
        id: studentID,
        eventID
      },
      TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
      ExpressionAttributeValues: expressionAttributeValues,
      UpdateExpression: updateExpression,
      ReturnValues:"UPDATED_NEW"
    };

    // call dynamoDb
    await docClient.update(params).promise()
      .then(result => {
        const response = {
          statusCode: 200,
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

// Return list of entries with the matching studentID
module.exports.queryStudent = async (event, ctx, callback) => {

  const id = parseInt(event.queryStringParameters.id, 10);

  const params = {
    TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
    KeyConditionExpression: 'studentID = :query',
    ExpressionAttributeValues: {
      ':query': id
    }
  };

  await docClient.query(params).promise()
    .then(result => {
      console.log('Query success');
      var data = result.Items;
      var response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify(data)
      };
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to query registration table'));
      return;
    });
}

// Return list of entries with the matching eventID
module.exports.scanEvent = async (event, ctx, callback) => {

  const eventID = event.queryStringParameters.eventID;

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
    var data = result.Items;
    var response = {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify(data)
    };
    callback(null, response);
  })
  .catch(error => {
    console.error(error);
    callback(new Error('Unable to scan registration table'));
    return;
  });
}
