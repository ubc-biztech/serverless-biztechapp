'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers')
const sorters = require('../utils/sorters')

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);

  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('Event ID not specified.', data));
  }

  if (data.capac == null || isNaN(data.capac)) {
    callback(null, helpers.inputError('capac invalid, please provide valid number.', data));
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
      elocation: data.elocation,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    TableName: 'biztechEvents' + process.env.ENVIRONMENT
  };

  await docClient.put(params).promise()
    .then(result => {
      const response = helpers.createResponse(200, {
        message: 'Event Created!',
        params: params
      })
      callback(null, response)
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error);
      callback(null, response)
    })

};

module.exports.delete = async (event, ctx, callback) => {

  const id = event.queryStringParameters.id;

  // Check that parameters are valid
  if (!id) {
    callback(null, helpers.inputError('id not specified.', 'missing query param'));
  }

  const params = {
    Key: { id },
    TableName: 'biztechEvents' + process.env.ENVIRONMENT
  };

  await docClient.delete(params).promise()
    .then(result => {
      const response = helpers.createResponse(200, {
        message: 'Event Deleted!'
      })
      callback(null, response)
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error);
      callback(null, response)
    })

};

module.exports.get = async (event, ctx, callback) => {

  const params = {
    TableName: 'biztechEvents' + process.env.ENVIRONMENT
  };

  await docClient.scan(params).promise()
    .then(async (result) => {
      var events = result.Items
      for (const event of events) {
        event.counts = await helpers.getEventCounts(event.id)
      }
      events.sort(sorters.dateSorter('startDate')) // sort by startDate
      const response = helpers.createResponse(200, events)
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error);
      callback(null, response);
    })

};

module.exports.count = async (event, ctx, callback) => {

  const id = event.queryStringParameters.id;
  const counts = await helpers.getEventCounts(id)

  const response = helpers.createResponse(200, counts)
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
        const results = result.flatMap(batchResult => batchResult.Responses[`biztechUsers${process.env.ENVIRONMENT}`]) // extract what's inside

        const resultsWithRegistrationStatus = results.map(item => {
          const registrationObj = registrationList.filter(registrationObject => {
            return registrationObject.id === item.id  // find the same user in 'registrationList' and attach the registrationStatus
          })
          if(registrationObj[0]) item.registrationStatus = registrationObj[0].registrationStatus
          else item.registrationStatus = '';
          return item
        });
        resultsWithRegistrationStatus.sort(sorters.alphabeticalSorter('lname'));
        const response = helpers.createResponse(200, resultsWithRegistrationStatus)
        callback(null, response);
      })
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to scan registration table.'));
    });
};

module.exports.update = async (event, ctx, callback) => {

  const data = JSON.parse(event.body);

  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('Event ID not specified.', data));
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
        const response = helpers.createResponse(404, 'Event not found.')
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
      const response = helpers.createResponse(200, {
        size: data.length,
        data: data
      })
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to scan events.'));
    });

};
