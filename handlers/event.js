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

  const params = {
    Key: {
      id: data.id
    },
    TableName: 'biztechEvents' + process.env.ENVIRONMENT,
  };

  await docClient.get(params).promise()
    .then(result => {
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
          TableName: 'biztechEvents' + process.env.ENVIRONMENT,
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
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Error getting event from database'));
    })

};

module.exports.userUpdate = async (event, ctx, callback) => {
  const data = JSON.parse(event.body);
  const timestamp = new Date().getTime();

  let updateExpression = 'set #usr.#userID = :status,';
  let expressionAttributeValues = {':status' : data.status};

  let number = '';
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
  expressionAttributeValues[':incr'] = 1;

  // update timestamp
  updateExpression += "updatedAt = :updatedAt";
  expressionAttributeValues[':updatedAt'] = timestamp;

  console.log(updateExpression);

  const params = {
    Key: {
      id: data.id
    },
    TableName: 'biztechEvents' + process.env.ENVIRONMENT,
    ExpressionAttributeNames: {
      "#userID" : data.userID,
      "#usr" : "users"
    },
    ExpressionAttributeValues: expressionAttributeValues,
    UpdateExpression: updateExpression,
    ReturnValues:"UPDATED_NEW"
  };

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
}

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
