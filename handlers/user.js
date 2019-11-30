'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers')

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);

  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('User ID not specified.', data));
    return;
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

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Created!',
      params: params
    }, null, 2),
  };

};

module.exports.get = async (event, ctx, callback) => {
  const queryString = event.queryStringParameters;
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
      if (result.Item == null){

        console.log('User not found');
        const response = {
          statusCode: 404,
          body: JSON.stringify('User not found.')
        };
        callback(null, response);

      } else {

        console.log('User found');
        const response = {
          statusCode: 200,
          body: JSON.stringify(result.Item)
        };
        callback(null, response);

      }
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Couldn\'t fetch user.'));
      return;
    });

};

module.exports.update = async (event, ctx, callback) => {

  const data = JSON.parse(event.body);
  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('User ID not specified.', data));
    return;
  }
  const id = parseInt(data.id, 10);

  const params = {
    Key: { id },
    TableName: 'biztechUsers' + process.env.ENVIRONMENT,
  };

  await docClient.get(params).promise()
    .then(async(result) => {
      if (!helpers.isEmpty(result))
        return callback(null, await helpers.updateDB(id, data, 'biztechUsers'));
      else {
        const response = {
          statusCode: 404,
          body: JSON.stringify('User not found.')
        };
        callback(null, response);
      }
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Could not get user from database.'));
    })

};
