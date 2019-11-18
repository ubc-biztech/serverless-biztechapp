'use strict';

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);
  const id = parseInt(data.id, 10);

  var params = {
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

  var id = parseInt(event.queryStringParameters.id, 10);

  var params = {
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

  const params = {
    Key: {
      id: data.id
    },
    TableName: 'biztechUsers' + process.env.ENVIRONMENT,
  };

  async function updateDB() {
    const timestamp = new Date().getTime();
    const id = parseInt(event.queryStringParameters.id, 10);
    var updateExpression = 'set ';
    var expressionAttributeValues = {};

    // loop through keys and create updateExpression string and
    // expressionAttributeValues object
    for (var key in data){
      if(data.hasOwnProperty(key)) {
        if (key != 'id'){
          updateExpression += key + '\= :' + key + ',';
          expressionAttributeValues[':' + key] = data[key];
        }
      }
    }

    // update timestamp
    updateExpression += "updatedAt = :updatedAt";
    expressionAttributeValues[':updatedAt'] = timestamp;

    var params = {
        Key: {
          id
        },
        TableName: 'biztechUsers' + process.env.ENVIRONMENT,
        ExpressionAttributeValues: expressionAttributeValues,
        UpdateExpression: updateExpression,
        ReturnValues:"UPDATED_NEW"
    };

    // call dynamoDb
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
  }

  await docClient.get(params).promise()
    .then(result => {
        updateDB()
      })
      .catch(error => {
        console.error(error);
        callback(new Error('Error getting user from database'));
      })

};
