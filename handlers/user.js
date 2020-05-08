'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers')

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);

  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('User ID not specified.', data));
  }
  const id = parseInt(data.id, 10);

  const params = {
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
      updatedAt: timestamp
    },
    TableName: 'biztechUsers' + process.env.ENVIRONMENT
  };

  await docClient.put(params).promise()

  const response = helpers.createResponse(201, {
    message: 'Created!',
    params: params
  })
  callback(null, response)

};

module.exports.get = async (event, ctx, callback) => {
  const queryString = event.pathParameters;
  if (queryString == null || !queryString.hasOwnProperty('id')) {
    callback(null, helpers.inputError('User ID not specified.', queryString));
    return;
  }

  const id = parseInt(queryString.id, 10);

  const params = {
    Key: {
      id
    },
    TableName: 'biztechUsers' + process.env.ENVIRONMENT
  };

  await docClient.get(params).promise()
    .then(result => {
      if (result.Item == null) {
        const response = helpers.createResponse(404, 'User not found.')
        callback(null, response)
      } else {
        const response = helpers.createResponse(200, result.Item)
        callback(null, response)
      }
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error)
      callback(null, response);
    });

};

module.exports.update = async (event, ctx, callback) => {
  const data = JSON.parse(event.body);
  const id = parseInt(event.pathParameters.id, 10);

  const params = {
    Key: { id },
    TableName: 'biztechUsers' + process.env.ENVIRONMENT,
  };

  await docClient.get(params).promise()
    .then(async (result) => {
      if (!helpers.isEmpty(result))
        callback(null, await helpers.updateDB(id, data, 'biztechUsers'));
      else {
        const response = helpers.createResponse(404, 'User not found.')
        callback(null, response);
      }
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error)
      callback(null, response);
    })

};

/* 
  if successful, returns 200 and JSON with 2 fields: items and length
*/
module.exports.getAll = async (event, ctx, callback) => {
  const params = {
    TableName: 'biztechUsers' + process.env.ENVIRONMENT
  }

  await docClient.scan(params).promise()
    .then(async (result) => {
      if (result.Items == null) {
        const response = helpers.createResponse(404, 'User not found.');
        callback(null, response);
      } else {
        const response = helpers.createResponse(200, { items: result.Items, length: result.ScannedCount });
        callback(null, response);
      }
    })
    .catch(async (error) => {
      console.error(error);
      const response = helpers.createResponse(502, error);
      callback(null, response);
    })
}
