'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers')
const cryptoRandomString = require('crypto-random-string');

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);
  const code = cryptoRandomString({ length: 4, characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' });

  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('Event ID not specified.', data));
    return;
  }

  if (data.capac == null || isNaN(data.capac)) {
    callback(null, helpers.inputError('capac invalid, please provide valid number.', data));
    return;
  }

  const params = {
    Item: {
      id: data.id,
      ename: data.ename,
      description: data.description,
      startDate: data.startDate,
      endDate: data.endDate,
      capac: data.capac,
      imageUrl: data.imageUrl,
      location: data.location,
      code,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    TableName: 'biztechEvents' + process.env.ENVIRONMENT
  };

  await docClient.put(params).promise()
    .then(result => {
      const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({
          message: 'Event Created!',
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

  const params = {
    TableName: 'biztechEvents' + process.env.ENVIRONMENT
  };

  await docClient.scan(params).promise()
    .then(async(result) => {
      var events = result.Items
      for (const event of events) {
          event.counts = await helpers.getEventCounts(event.id)
        }
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

module.exports.count = async (event, ctx, callback) => {

  const id = event.queryStringParameters.id;
  const counts = await helpers.getEventCounts(id)

  const response = {
    statusCode: 200,
    body: JSON.stringify(counts)
  };

  callback(null, response);

}

module.exports.getUsers = async (event, ctx, callback) => {

  const id = event.queryStringParameters.id;

  // Check that parameters are valid
  if (!id) {
    callback(null, helpers.inputError('id not specified.', 'missing query param'));
  }

  const params = {
    TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
    FilterExpression: 'eventID = :query',
    ExpressionAttributeValues: {
      ':query': id
    }
  };

  await docClient.scan(params).promise()
  .then(async result => {
    console.log('Scan success.');
    const registrationList = result.Items;

    /**
     * Example registration obj:
     * { eventID: 'blueprint',
     *   id: 123,
     *   updatedAt: 1580007893340,
     *   registrationStatus: 'registered'
     * }
     */
    let keysForRequest = registrationList.map(registrationObj => {
      let keyEntry = {}
      keyEntry.id = parseInt(registrationObj.id)
      return keyEntry
    })
    console.log('Keys:', keysForRequest)

    let keyBatches = [];
    const size = 100 // max BatchGetItem count
    while (keysForRequest.length > 0) {
      keyBatches.push(keysForRequest.splice(0, size))
    }

    await Promise.all(keyBatches.map(batch => {
      return helpers.batchGet(batch, 'biztechUsers' + process.env.ENVIRONMENT)
    })).then(result => {
        const results = result.flatMap(batchResult => batchResult.Responses.biztechUsers)
        
        const resultsWithRegistrationStatus = results.map(item => {
          const registrationObj = registrationList.filter(registrationObject => {
            return registrationObject.id === item.id
          })
          item.registrationStatus = registrationObj[0].registrationStatus
          return item
        });
        console.log(resultsWithRegistrationStatus)
        const response = {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify(resultsWithRegistrationStatus),
        };
        callback(null, response);
      })    
  })
  .catch(error => {
    console.error(error);
    callback(new Error('Unable to scan registration table.'));
    return;
  });
};

module.exports.update = async (event, ctx, callback) => {

  const data = JSON.parse(event.body);

  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('Event ID not specified.', data));
    return;
  }
  const id = data.id;

  const params = {
    Key: { id },
    TableName: 'biztechEvents' + process.env.ENVIRONMENT,
  };

  await docClient.get(params).promise()
    .then(async (result) => {
      if (!helpers.isEmpty(result))
        return callback(null, await helpers.updateDB(id, data, 'biztechEvents'));
      else {
        const response = {
          statusCode: 404,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': true,
          },  
          body: JSON.stringify('Event not found.')
        };
        callback(null, response);
      }
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Could not get event from database.'));
    })

};

module.exports.scan = async (event, ctx, callback) => {
  const data = JSON.parse(event.body);
  const code = event.queryStringParameters.code;

  // Check that parameters are valid
  if (!code) {
    callback(null, helpers.inputError('code not specified.', data));
    return;
  }

  const params = {
    TableName: 'biztechEvents' + process.env.ENVIRONMENT,
    FilterExpression: '#code = :query',
    ExpressionAttributeNames: {
      '#code': 'code'
    },
    ExpressionAttributeValues: {
      ':query': code
    }
  };

  await docClient.scan(params).promise()
    .then(result => {
      console.log('Scan success.');
      const data = result.Items;
      const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({
          size: data.length,
          data: data
        }, null, 2)
      };
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to scan events.'));
      return;
    });

};
