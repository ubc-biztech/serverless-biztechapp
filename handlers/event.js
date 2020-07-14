'use strict';
const AWS = require('aws-sdk');
const helpers = require('./helpers')
const sorters = require('../utils/sorters')

module.exports.create = async (event, ctx, callback) => {
  const docClient = new AWS.DynamoDB.DocumentClient();

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);

  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('Event ID not specified.', data));
    return null;
  }

  if (data.capac == null || isNaN(data.capac)) {
    callback(null, helpers.inputError('capac invalid, please provide valid number.', data));
    return null;
  }

  const params = {
    Item: {
      id: data.id,
      ename: data.ename,
      description: data.description,
      startDate: data.startDate,
      endDate: data.endDate,
      capac: data.capac,
      facebookUrl: data.facebookUrl,
      imageUrl: data.imageUrl,
      elocation: data.elocation,
      longitude: data.longitude,
      latitude: data.latitude,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    TableName: 'biztechEvents' + process.env.ENVIRONMENT,
    ConditionExpression: 'attribute_not_exists(id)'
  };

  await docClient.put(params).promise()
    .then(result => {
      const response = helpers.createResponse(201, {
        message: 'Event Created!',
        params: params
      })
      callback(null, response);
    })
    .catch(error => {
      const response = helpers.createResponse(409, "Event could not be created because id already exists");
      callback(null, response);
    })

};

module.exports.delete = async (event, ctx, callback) => {
  const docClient = new AWS.DynamoDB.DocumentClient();

  const id = event.pathParameters.id;

  // Check that parameters are valid
  if (!id) {
    callback(null, helpers.inputError('id not specified.', 'missing query param'));
    return null;
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
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error);
      callback(null, response);
    })

};

module.exports.getAll = async (event, ctx, callback) => {
  const docClient = new AWS.DynamoDB.DocumentClient();

  const params = {
    TableName: 'biztechEvents' + process.env.ENVIRONMENT
  };

  await docClient.scan(params).promise()
    .then(async (result) => {
      var events = result.Items
      for (const event of events) {
        event.counts = await helpers.getEventCounts(event.id)
      }
      events.sort(sorters.alphabeticalComparer('startDate')) // sort by startDate
      const response = helpers.createResponse(200, events)
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error);
      callback(null, response);
    })

};

module.exports.update = async (event, ctx, callback) => {
  const docClient = new AWS.DynamoDB.DocumentClient();

  const data = JSON.parse(event.body);
  var updateExpression = "set ";
  var expressionAttributeValues = {};
  var expressionAttributeNames = {
    "#eventName": "name",
    "#eventLocation": "location"
  }

  for (var key in data) {
    if (data.hasOwnProperty(key)) {
      if (key == "name") {
        updateExpression += "#eventName= :name,";
        expressionAttributeValues[":name"] = data["name"];
      } else if (key == "location") {
        updateExpression += "#eventLocation= :location,";
        expressionAttributeValues[":location"] = data["location"];
      } else if (key != "id") {
        updateExpression += key + "= :" + key + ",";
        expressionAttributeValues[":" + key] = data[key];
      }
    }
  }

  const timestamp = new Date().getTime();
  updateExpression += "updatedAt = :updatedAt";
  expressionAttributeValues[":updatedAt"] = timestamp;

  const id = event.pathParameters.id;

  const params = {
    Key: { id },
    TableName: 'biztechEvents' + process.env.ENVIRONMENT,
    ExpressionAttributeValues: expressionAttributeValues,
    ExpressionAttributeNames: expressionAttributeNames,
    UpdateExpression: updateExpression,
    ReturnValues: "UPDATED_NEW",
    ConditionExpression: "attribute_exists(id)"
  };

  await docClient.update(params).promise()
    .then(async (result) => {
      callback(null, helpers.createResponse(200, "Update succeeded."));
    })
    .catch(error => {
      console.error(error);
      callback(null, helpers.createResponse(404, "Event not found."));
    })

};

module.exports.get = async (event, ctx, callback) => {
  const docClient = new AWS.DynamoDB.DocumentClient();

  const id = event.pathParameters.id;
  const queryString = event.queryStringParameters;

  // if both count and users are true, throw error 
  if (queryString && queryString.count == "true" && queryString.users == "true") {
    const response = helpers.createResponse(406, 'Only one true parameter is permissible at a time');
    callback(null, response);
  } else if (queryString && queryString.count == "true") {
    //return counts
    const counts = await helpers.getEventCounts(id)

    const response = helpers.createResponse(200, counts)
    callback(null, response);
  } else if (queryString && queryString.users == "true") {
    //return users
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
            if (registrationObj[0]) item.registrationStatus = registrationObj[0].registrationStatus
            else item.registrationStatus = '';
            return item
          });
          resultsWithRegistrationStatus.sort(sorters.alphabeticalComparer('lname'));
          const response = helpers.createResponse(200, resultsWithRegistrationStatus)
          callback(null, response);
        })
      })
      .catch(error => {
        console.error(error);
        callback(new Error('Unable to scan registration table.'));
      });
  } else {
    //if none of the optional params are true, then return event
    const params = {
      Key: { id },
      TableName: 'biztechEvents' + process.env.ENVIRONMENT
    };

    await docClient.get(params).promise()
      .then(result => {
        if (result.Item == null) {
          const response = helpers.createResponse(404, 'Event not found');
          callback(null, response);
        } else {
          const response = helpers.createResponse(200, result.Item);
          callback(null, response);
        }
      })
      .catch(error => {
        console.error(error);
        const response = helpers.createResponse(502, error);
        callback(null, response);
      })
  }
}
