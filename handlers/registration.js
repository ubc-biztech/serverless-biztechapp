'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);
  const studentID = parseInt(data.studentID, 10);

  const params = {
      Item: {
          studentID,
          eventID: data.eventID,
          status: data.status,
          createdAt: timestamp,
          updatedAt: timestamp
      },
      TableName: 'biztechRegistration' + process.env.ENVIRONMENT
  };

  await docClient.put(params).promise()

  // Update timestamp
  updateExpression += "updatedAt = :updatedAt";
  expressionAttributeValues[':updatedAt'] = timestamp;

  await docClient.update(eventParams).promise()
  .then(result => {
      const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify('Update succeeded')
      };
      callback(null, response);
  })
  .catch(error => {
    console.error(error);
    const response = {
      statusCode: 500,
      body: error
    };
    callback(null, response);
    return;
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
