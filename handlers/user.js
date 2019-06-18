'use strict';

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();

  var obj = JSON.parse(event.body);

  var id = parseInt(obj.id, 10);

  var params = {
      Item: {
          id: id,
          fname: obj.fname,
          lname: obj.lname,
          email: obj.email,
          faculty: obj.faculty,
          year: obj.year,
          gender: obj.gender,
          diet: obj.diet,
          createdAt: timestamp,
          updatedAt: timestamp
      },
      TableName: 'biztechUsers'
  };

  console.log(params)

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

  var id = parseInt(event.queryStringParameters.id, 10);

  var params = {
      Key: {
        id: id,
      },
      TableName: 'biztechUsers'
  };

  console.log(params);

  await docClient.get(params).promise()
    .then(result => {
      if (result.Item == null){

        console.log('User not found');
        const response = {
          statusCode: 404,
          body: JSON.stringify('User not found')
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
  const timestamp = new Date().getTime();
  const id = parseInt(event.queryStringParameters.id, 10);

  var params = {
      Key: {
        id: id,
      },
      TableName: 'biztechUsers',
      ExpressionAttributeValues:{
        ':fname': data.fname,
        ':updatedAt': timestamp
      },
      UpdateExpression: 'SET fname = :fname, updatedAt = :updatedAt',
      ReturnValues:"UPDATED_NEW"
  };

  console.log(params);

  await docClient.update(params).promise()
    .then(result => {
        const response = {
          statusCode: 200,
          body: JSON.stringify('Update succeeded')
        };
        callback(null, response);
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to update user.'));
      return;
    });

};
