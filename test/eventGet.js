'use strict';
const AWSMock = require('aws-sdk-mock');

// tests for eventGet
// Generated by serverless-mocha-plugin

const mochaPlugin = require('serverless-mocha-plugin');
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper('eventGet', '/handlers/event.js', 'get');

const event = require('./data/events.json').Items[0];
const getEventResponse = { Item: event };
const getRegistrationResponse = require('./data/eventRegistration.json');

describe('eventGet', () => {

  const existingEvents = ['existingEvent1', 'existingEvent2'];

  before(() => {

    // get event
    AWSMock.mock('DynamoDB.DocumentClient', 'get', (params, callback) => {

      const { id } = params.Key;

      if(params.TableName.includes('biztechEvents')) {

        // if id found
        if(existingEvents.includes(id)) callback(null, { Item: getEventResponse });
        // if id not found
        else callback(null, { Item: null });

      }

    });

    // event counts from registration table
    AWSMock.mock('DynamoDB.DocumentClient', 'scan', (params, callback) => {

      if(params.TableName.includes('biztechRegistration')) {

        callback(null, getRegistrationResponse);

      }

    });

    // users from users table
    AWSMock.mock('DynamoDB.DocumentClient', 'batchGet', (params, callback) => {

      const tables = Object.keys(params.RequestItems);

      if(tables.includes('biztechUsers')) {

        const table = tables[0];
        const response = { Responses: {} };

        // return users here
        response.Responses[table] = [{ id: 1 }, { id: 2 }, { id: 3 }];

        callback(null, response);

      } else callback(new Error('error during batch get!'));

    });

  });
  after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

  it('return 404 for trying to get an event with unknown id', async () => {

    const unknownId = 'nonExistingEvent';

    const response = await wrapped.run({ pathParameters: { id: unknownId } });
    expect(response.statusCode).to.be.equal(404);

  });

  it('return 200 for successfully getting an event', async () => {

    const validId = existingEvents[0];

    const response = await wrapped.run({ pathParameters: { id: validId } });
    expect(response.statusCode).to.be.equal(200);

  });

  it('return 406 for trying to get an event with both count and users', async () => {

    const validId = existingEvents[0];

    const response = await wrapped.run({ queryStringParameters: { count: 'true', users: 'true' }, pathParameters: { id: validId } });
    expect(response.statusCode).to.be.equal(406);

  });

  it('return 200 for successfully getting an event with count', async () => {

    const validId = existingEvents[0];

    const response = await wrapped.run({ queryStringParameters: { count: 'true' }, pathParameters: { id: validId } });
    expect(response.statusCode).to.be.equal(200);

    const body = JSON.parse(response.body);
    expect(body).to.have.property('registeredCount', 2);
    expect(body).to.have.property('checkedInCount', 3);
    expect(body).to.have.property('waitlistCount', 1);

  });

  it('return 200 for successfully getting an event with users', async () => {

    const validId = existingEvents[0];

    const response = await wrapped.run({ queryStringParameters: { users: 'true' }, pathParameters: { id: validId } });
    expect(response.statusCode).to.be.equal(200);
    console.log(response);

    const body = JSON.parse(response.body);
    expect(body).to.have.length(3);
    expect(body[0]).to.have.property('id', 1);
    expect(body[0]).to.have.property('registrationStatus', 'registered');

  });

});
