'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers')

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);

  if (data.capac == null || isNaN(data.capac) ){
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
          ename: data.ename,
          date: data.date,
          capacity: data.capac,
          img: data.img,
          createdAt: timestamp,
          updatedAt: timestamp
      },
      TableName: 'biztechEvents' + process.env.ENVIRONMENT
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

module.exports.get = async (event, ctx, callback) => {

  var params = {
      TableName: 'biztechEvents' + process.env.ENVIRONMENT
  };

  await docClient.scan(params).promise()
    .then(result => {
      var events = result.Items
      const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify(events),
      };
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to get events.'));
      return;
    })

};

module.exports.update = async (event, ctx, callback) => {

  const data = JSON.parse(event.body);
  const id = event.queryStringParameters.id;

  const params = {
    Key: { id },
    TableName: 'biztechEvents' + process.env.ENVIRONMENT,
  };

  await docClient.get(params).promise()
    .then(async(result) => {
      if (!helpers.isEmpty(result))
        return callback(null, await helpers.updateDB(id, data, 'biztechEvents'));
      else {
        const response = {
          statusCode: 404,
          body: JSON.stringify('Event not found')
        };
        callback(null, response);
      }
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Could not get event from database'));
    })

};

module.exports.scan = async (event, ctx, callback) => {

  const code = event.queryStringParameters.code;

  const params = {
    TableName: 'biztechEvents' + process.env.ENVIRONMENT,
    FilterExpression: '#code = :query',
    ExpressionAttributeNames:{
      '#code': 'code'
    },
    ExpressionAttributeValues: {
      ':query': code
    }
  };

  await docClient.scan(params).promise()
    .then(result => {
      console.log('Scan success.');
      var data = result.Items;
      var response = {
        statusCode: 200,
        body: JSON.stringify(data)
      };
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to scan events.'));
      return;
    });

};
