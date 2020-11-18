'use strict';
const AWSMock = require('aws-sdk-mock');

// tests for eventCreate
// Generated by serverless-mocha-plugin

const mochaPlugin = require('serverless-mocha-plugin');
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper('eventCreate', '/handlers/event.js', 'create');
const { EVENTS_TABLE } = require('../constants/tables');

const eventPayload = {
  id: 'localTestEvent',
  year: 2020,
  ename: 'Local Test Event',
  description: 'Local test event description',
  startDate: '20200607T000000-0400',
  endDate: '20200607T000000-0400',
  capac: 100,
  facebookUrl: 'https://www.facebook.com/BizTechUBC/',
  imageUrl: 'https://www.facebook.com/BizTechUBC/',
  elocation: 'https://i.picsum.photos/id/320/200/300.jpg',
  longitude: -120.00,
  latitude: 78.00,
  createdAt: '20200607T000000-0400',
  updatedAt: '20200607T000000-0400'
};

describe('eventCreate', () => {

  let createdEventsIdAndYear = [];

  before(() => {
    
    AWSMock.mock('DynamoDB.DocumentClient', 'get', (params, callback) => {
      const { id, year } = params.Key;
      const idAndYear = `${id}${year}`;

      if(params.TableName.includes(EVENTS_TABLE)) {

        // if id found
        if(createdEventsIdAndYear.includes(idAndYear)) callback(null, { Item: eventPayload });
        // if id not found
        else callback(null, { Item: null });

      }

    });

    AWSMock.mock('DynamoDB.DocumentClient', 'put', (params, callback) => {

      if(params.Item.id && params.Item.year && createdEventsIdAndYear.includes(`${params.Item.id}${params.Item.year}`)) callback(new Error('event already exists!'));
      else {
        
        createdEventsIdAndYear.push(`${params.Item.id}${params.Item.year}`);
        console.log("GOING TO ADD ITEM ")
        console.log(`${params.Item.id}${params.Item.year}`)
        console.log(createdEventsIdAndYear)
        callback(null, 'successfully put item in database');

      }

    });

  });
  after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

  it('return 406 for trying to create an event with no id', async () => {
    console.log("It");
    const invalidPayload = {
      ...eventPayload
    };
    delete invalidPayload.id;

    const response = await wrapped.run({ body: JSON.stringify(invalidPayload) });
    expect(response.statusCode).to.be.equal(406);

  });

  it('return 406 for trying to create an event with no year', async () => {

    const invalidPayload = {
      ...eventPayload
    };
    delete invalidPayload.year;

    const response = await wrapped.run({ body: JSON.stringify(invalidPayload) });
    expect(response.statusCode).to.be.equal(406);

  });

  it('return 406 for trying to create an event with invalid capac', async () => {

    const invalidPayload = {
      ...eventPayload
    };
    delete invalidPayload.capac;

    const response = await wrapped.run({ body: JSON.stringify(invalidPayload) });
    expect(response.statusCode).to.be.equal(406);

  });

  it('return 201 for successfully creating an event', async () => {
    console.log("TEST CASE SHOULD PASS")
    const payload = {
      ...eventPayload,
    };

    const response = await wrapped.run({ body: JSON.stringify(payload) });
    expect(response.statusCode).to.be.equal(201);
    console.log("FINISHED TEST CASE SHOULD")


  });

  it('return 409 for trying to create an event with the same id and year', async () => {
    console.log("Whats going on?");
    const payload = {
      ...eventPayload,
    };

    const response = await wrapped.run({ body: JSON.stringify(payload) });
    expect(response.statusCode).to.be.equal(409);

  });

  it('return 201 for successfully creating another event with same id but different year', async () => {

    const payload = {
      ...eventPayload,
      year: 6969,
      id: 'localTestEvent'
    };

    const response = await wrapped.run({ body: JSON.stringify(payload) });
    expect(response.statusCode).to.be.equal(201);

  });

});
