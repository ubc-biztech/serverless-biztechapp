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
      TableName: 'biztechRegistration'
  };

  await docClient.put(params).promise()

  // Update Event count
  let number = '';
  let updateExpression = 'set ';
  switch(data.status) {
    case 'R':
      number = 'regNum';
      break;
    case 'C':
      number = 'checkedNum';
      break;
    case 'Can':
      number = 'CANCEL';
      break;
    case 'W':
      number = 'waitNum';
      break;
    default:
  }

  if (number.length > 0) {
    if (number == 'CANCEL') {
      updateExpression += 'regNum \= regNum - :incr,';
    } else {
      updateExpression += number + ' \= ' + number + ' \+ :incr,';
    }
  }
  let expressionAttributeValues = {':incr': 1};

  // Update timestamp
  updateExpression += "updatedAt = :updatedAt";
  expressionAttributeValues[':updatedAt'] = timestamp;

  console.log(updateExpression);

  const eventParams = {
    Key: {
      id: data.eventID
    },
    TableName: 'biztechEvents',
    ExpressionAttributeValues: expressionAttributeValues,
    UpdateExpression: updateExpression,
    ReturnValues:"UPDATED_NEW"
  };

  await docClient.update(eventParams).promise()
  .then(result => {
      const response = {
        statusCode: 200,
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
  