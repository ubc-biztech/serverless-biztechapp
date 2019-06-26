'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);

  if (data.capacity == null || isNaN(data.capacity) ){
      const response = {
        statusCode: 406,
        body: JSON.stringify({
          message: 'Capacity invalid, please provide valid number',
          params: params
        }, null, 2),
      };
      callback(null, response);
  }

  var params = {
      Item: {
          id: data.id,
          name: data.name,
          date: data.date,
          capacity: data.capacity,
          createdAt: timestamp,
          updatedAt: timestamp
      },
      TableName: 'biztechEvents'
  };

  await docClient.put(params).promise()
    .then(result => {
      const response = {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Event Created',
          params: params
        }, null, 2),
      };
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to create event.'));
      return;
    })

};
