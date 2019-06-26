'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);

  if (data.capac == null || isNaN(data.capac) ){
      const response = {
        statusCode: 406,
        body: JSON.stringify({
          message: 'Capac invalid, please provide valid number',
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
          capac: data.capac,
          img: data.img,
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


module.exports.get = async (event, ctx, callback) => {

  var params = {
      TableName: 'biztechEvents'
  };

  await docClient.scan(params).promise()
    .then(result => {
      var events = result.Items
      const response = {
        statusCode: 200,
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
  const timestamp = new Date().getTime();

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
          id: data.id
        },
        TableName: 'biztechEvents',
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
        const response = {
          statusCode: 500,
          body: error
        };
        callback(null, response);
        return;
      });

};
