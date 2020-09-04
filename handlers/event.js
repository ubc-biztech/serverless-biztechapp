'use strict';
const helpers = require('./helpers');
const sorters = require('../utils/sorters');
const { isEmpty } = require('../utils/functions');
const { MAX_BATCH_ITEM_COUNT } = require('../constants/dynamodb');
const { EVENTS_TABLE, USERS_TABLE, USER_REGISTRATIONS_TABLE } = require('../constants/tables');

module.exports.create = async (event, ctx, callback) => {

  try {

    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      id: { required: true },
      capac: { required: true, type: 'number' }
    });

    const existingEvent = await helpers.getOne(data.id, EVENTS_TABLE);
    if(!isEmpty(existingEvent)) throw helpers.duplicateResponse('event id', data);

    const item = {
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
    };

    const res = await helpers.create(item, EVENTS_TABLE);

    const response = helpers.createResponse(201, {
      message: `Created event with id ${data.id}!`,
      response: res,
      item
    });

    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

module.exports.delete = async (event, ctx, callback) => {

  try {

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('event');
    const id = event.pathParameters.id;

    const existingEvent = await helpers.getOne(id, EVENTS_TABLE);
    if(isEmpty(existingEvent)) throw helpers.notFoundResponse('event', id);

    const res = await helpers.deleteOne(id, EVENTS_TABLE);

    const response = helpers.createResponse(200, {
      message: `Deleted event with id '${id}'!`,
      response: res
    });

    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

module.exports.getAll = async (event, ctx, callback) => {

  try {

    // scan
    const events = await helpers.scan(EVENTS_TABLE);

    // get event counts
    for(event of events) {

      event.counts = await helpers.getEventCounts(event.id);

    }
    // sort the events by startDate
    events.sort(sorters.alphabeticalComparer('startDate'));

    const response = helpers.createResponse(200, events);
    callback(null, response);

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

module.exports.update = async (event, ctx, callback) => {

  try {

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('event');
    const id = event.pathParameters.id;

    const existingEvent = await helpers.getOne(id, EVENTS_TABLE);
    if(isEmpty(existingEvent)) throw helpers.notFoundResponse('event', id);

    const data = JSON.parse(event.body);

    const res = await helpers.updateDB(event.pathParameters.id, data, EVENTS_TABLE);
    const response = helpers.createResponse(200, {
      message: `Updated event with id ${id}!`,
      response: res
    });

    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

module.exports.get = async (event, ctx, callback) => {

  try {

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('event');
    const id = event.pathParameters.id;

    const queryString = event.queryStringParameters;

    // if both count and users are true, throw error 
    if (queryString && queryString.count == 'true' && queryString.users == 'true') {

      throw helpers.createResponse(406, {
        message: 'Only one true parameter is permissible at a time'
      });

    } else if (queryString && queryString.count == 'true') {

      // return counts
      const counts = await helpers.getEventCounts(id);

      const response = helpers.createResponse(200, counts);
      callback(null, response);
      return null;

    } else if (queryString && queryString.users == 'true') {

      let registrationList = [];

      try {

        const filters = {
          FilterExpression: 'eventID = :query',
          ExpressionAttributeValues: {
            ':query': id
          }
        };

        /**
       * Get user registrations
       * Example of a registration object:
        {
          eventID: 'blueprint',
          id: 123,
          updatedAt: 1580007893340,
          registrationStatus: 'registered'
        }
       */
        registrationList = await helpers.scan(USER_REGISTRATIONS_TABLE, filters);

      } catch(err) {

        throw helpers.createResponse(500, {
          message: 'Unable to scan registration table.'
        });

      }

      let keysForRequest = registrationList.map(registrationObj => {

        const keyEntry = {};
        keyEntry.id = parseInt(registrationObj.id);
        return keyEntry;

      });

      console.log('Keys:', keysForRequest);

      let keyBatches = [];

      while (keysForRequest.length > 0) {

        keyBatches.push(keysForRequest.splice(0, MAX_BATCH_ITEM_COUNT));

      }

      const result = await Promise.all(keyBatches.map(batch => (

        helpers.batchGet(batch, USERS_TABLE + process.env.ENVIRONMENT)

      )));

      // extract what's inside
      const flattenResults = result.flatMap(batchResult => batchResult.Responses[`${USERS_TABLE}${process.env.ENVIRONMENT}`]);

      const resultsWithRegistrationStatus = flattenResults.map(item => {

        const registrationObj = registrationList.filter(registrationObject => {

          // find the same user in 'registrationList' and attach the registrationStatus
          return registrationObject.id === item.id;

        });

        if (registrationObj[0]) item.registrationStatus = registrationObj[0].registrationStatus;
        else item.registrationStatus = '';
        return item;

      });

      resultsWithRegistrationStatus.sort(sorters.alphabeticalComparer('lname'));
      const response = helpers.createResponse(200, resultsWithRegistrationStatus);
      callback(null, response);
      return null;

    } else {

      // if none of the optional params are true, then return the event
      const event = await helpers.getOne(id, EVENTS_TABLE);

      if(isEmpty(event)) throw helpers.notFoundResponse('event', id);

      const response = helpers.createResponse(200, event);
      callback(null, response);
      return null;

    }

  }
  catch(err) {

    console.error(err);

    // need a way to come up with a proper response in case any logic throws errors
    let response = err;
    if(!response || !response.statusCode || !response.headers) response = helpers.createResponse(502,);

    callback(null, err);
    return null;

  }

};
