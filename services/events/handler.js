import AWS from 'aws-sdk';
import eventHelpers from './helpers';
import helpers from '../../lib/handlerHelpers';
import db from '../../lib/db';
import { alphabeticalComparer, isEmpty } from '../../lib/utils';
import { MAX_BATCH_ITEM_COUNT } from '../../constants/dynamodb';
import { EVENTS_TABLE, USERS_TABLE, USER_REGISTRATIONS_TABLE } from '../../constants/tables';

export const create = async (event, ctx, callback) => {

  try {

    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      id: { required: true },
      year: { required: true, type: 'number' },
      capac: { required: true, type: 'number' }
    });

    const existingEvent = await db.getOne(data.id, EVENTS_TABLE, { year: data.year });
    if(!isEmpty(existingEvent)) throw helpers.duplicateResponse('event id and year', data);

    const item = {
      id: data.id,
      year: data.year,
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

    const res = await db.create(item, EVENTS_TABLE);

    const response = helpers.createResponse(201, {
      message: `Created event with id ${data.id} for the year ${data.year}!`,
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

// DELETE /events/{id}/{year}
// eslint-disable-next-line
export const del = async (event, ctx, callback) => {

  try {

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('event');
    const id = event.pathParameters.id;
    if(!event.pathParameters.year) throw helpers.missingPathParamResponse('event', 'year');

    const year = parseInt(event.pathParameters.year, 10);
    if(isNaN(year)) throw helpers.inputError('Year path parameter must be a number', event.pathParameters);

    const existingEvent = await db.getOne(id, EVENTS_TABLE, { year });
    if(isEmpty(existingEvent)) throw helpers.notFoundResponse('event', id);
    const res = await db.deleteOne(id, EVENTS_TABLE, { year });

    const response = helpers.createResponse(200, {
      message: `Deleted event with id '${id}' for the year ${year}!`,
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

// /events 
export const getAll = async (event, ctx, callback) => {

  try {

    let filterExpression = {};

    //Set up query by year if exists
    if(event && event.queryStringParameters && event.queryStringParameters.hasOwnProperty('year')) {

      const year = parseInt(event.queryStringParameters.year, 10);
      if(isNaN(year)) throw helpers.inputError('Year query parameter must be a number', event.queryStringParameters);

      filterExpression = {
        FilterExpression: '#vyear = :query',
        ExpressionAttributeNames: {
          '#vyear': 'year'
        },
        ExpressionAttributeValues: {
          ':query': year
        }
      };

    }

    // scan
    let events = await db.scan(EVENTS_TABLE, filterExpression);

    if(event && event.queryStringParameters && event.queryStringParameters.hasOwnProperty('id')) {

      events = events.filter(eventItem => eventItem.id === event.queryStringParameters.id);

    }

    // get event counts
    for(event of events) {

      event.counts = await eventHelpers.getEventCounts(`${event.id};${event.year}`);

    }
    // sort the events by startDate
    events.sort(alphabeticalComparer('startDate'));

    const response = helpers.createResponse(200, events);
    callback(null, response);

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

// PATCH events/{id}/{year}
export const update = async (event, ctx, callback) => {

  try {

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('event');
    const id = event.pathParameters.id;
    if(!event.pathParameters.year) throw helpers.missingPathParamResponse('event', 'year');

    const year = parseInt(event.pathParameters.year, 10);
    if(isNaN(year)) throw helpers.inputError('Year path parameter must be a number', event.pathParameters);

    const existingEvent = await db.getOne(id, EVENTS_TABLE, { year });
    if(isEmpty(existingEvent)) throw helpers.notFoundResponse('event', id, year);

    const data = JSON.parse(event.body);
    //Since we have a sort key, can't use helpers.updateDB()
    const docClient = new AWS.DynamoDB.DocumentClient();

    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    } = db.createUpdateExpression(data);

    // construct the param object
    let params = {
      Key: { id, year },
      TableName: EVENTS_TABLE + process.env.ENVIRONMENT,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: { ...expressionAttributeNames, '#vyear': 'year' },
      UpdateExpression: updateExpression,
      ReturnValues: 'UPDATED_NEW',
      ConditionExpression: 'attribute_exists(id) and attribute_exists(#vyear)'
    };

    const res = await docClient.update(params).promise();

    const response = helpers.createResponse(200, {
      message: `Updated event with id ${id} and year ${year}!`,
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

// GET events/{id}/{year}
export const get = async (event, ctx, callback) => {

  try {

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('event');
    const id = event.pathParameters.id;
    if(!event.pathParameters.year) throw helpers.missingPathParamResponse('event', 'year');

    const year = parseInt(event.pathParameters.year, 10);
    if(isNaN(year)) throw helpers.inputError('Year path parameter must be a number', event.pathParameters);

    const queryString = event.queryStringParameters;

    //TODO: fix the else-if conditions
    // if both count and users are true, throw error 
    if (queryString && queryString.count == 'true' && queryString.users == 'true') {

      throw helpers.createResponse(406, {
        message: 'Only one true parameter is permissible at a time'
      });

    } else if (queryString && queryString.count == 'true') {

      // return counts
      const counts = await eventHelpers.getEventCounts(`${id};${year}`);

      const response = helpers.createResponse(200, counts);
      callback(null, response);
      return null;

    } else if (queryString && queryString.users == 'true') {

      let registrationList = [];

      try {

        const filters = {
          FilterExpression: '#idyear = :query',
          ExpressionAttributeNames: {
            '#idyear':'eventID;year'
          },
          ExpressionAttributeValues: {
            ':query': `${id};${year}`
          }
        };

        /**
       * Get user registrations
       * Example of a registration object:
        {
          eventID: 'blueprint',
          email: test@gmail.com,
          updatedAt: 1580007893340,
          registrationStatus: 'registered'
        }
       */
        registrationList = await db.scan(USER_REGISTRATIONS_TABLE, filters);

      } catch(err) {

        throw helpers.createResponse(500, {
          message: 'Unable to scan registration table.'
        });

      }
      console.log(registrationList)
      let keysForRequest = registrationList.map(registrationObj => {

        const keyEntry = {};
        keyEntry.id = registrationObj.id;
        return keyEntry;

      });

      console.log('Keys:', keysForRequest);

      let keyBatches = [];

      while (keysForRequest.length > 0) {

        keyBatches.push(keysForRequest.splice(0, MAX_BATCH_ITEM_COUNT));

      }

      const result = await Promise.all(keyBatches.map(batch => (

        db.batchGet(batch, USERS_TABLE + process.env.ENVIRONMENT)

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

      resultsWithRegistrationStatus.sort(alphabeticalComparer('lname'));
      const response = helpers.createResponse(200, resultsWithRegistrationStatus);
      callback(null, response);
      return null;

    } else {

      // if none of the optional params are true, then return the event
      const event = await db.getOne(id, EVENTS_TABLE, { year });

      if(isEmpty(event)) throw helpers.notFoundResponse('event', id, year);

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
