'use strict';
const AWSMock = require('aws-sdk-mock');

// tests for prizeCreate
// Generated by serverless-mocha-plugin

const mochaPlugin = require('serverless-mocha-plugin');
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper('prizeCreate', '/handlers/prize.js', 'create');

const prizePayload = {
    id: 'prize001',
    name: 'i am a prize',
    price: 100,
    imageHash: 'bf9f97372c2ebbb3',
    links: {
        sponsor: 'https://www.google.com'
    }
}

describe('prizeCreate', () => {

  let createdPrizeIds = [];

  before(() => {

    AWSMock.mock('DynamoDB.DocumentClient', 'get', (params, callback) => {
        let returnValue = null;
        if(createdPrizeIds.includes(params.Key.id)) returnValue = {
            ...prizePayload,
            id: params.Key.id
        };
        callback(null, { Item: returnValue });
    });

    AWSMock.mock('DynamoDB.DocumentClient', 'put', (params, callback) => {
      if(params.Item.id && createdPrizeIds.includes(params.Item.id)) callback(new Error('Prize already exists!'));
      else {
        createdPrizeIds.push(params.Item.id);
        callback(null, 'Successfully put item in database');
      }
    });
    
  });

  after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

  it('return 406 for trying to create a prize with no id', async () => {

    const invalidPayload = {
      ...prizePayload
    }
    delete invalidPayload.id;

    const response = await wrapped.run({ body: JSON.stringify(invalidPayload) });
    expect(response.statusCode).to.be.equal(406);
    
  });

  it('return 406 for trying to create a prize with no name', async () => {

    const invalidPayload = {
      ...prizePayload
    }
    delete invalidPayload.name;

    const response = await wrapped.run({ body: JSON.stringify(invalidPayload) });
    expect(response.statusCode).to.be.equal(406);
    
  });

  it('return 406 for trying to create a prize with no price', async () => {

    const invalidPayload = {
      ...prizePayload
    }
    delete invalidPayload.price;

    const response = await wrapped.run({ body: JSON.stringify(invalidPayload) });
    expect(response.statusCode).to.be.equal(406);
    
  });

  it('return 406 for trying to create a prize with invalid name', async () => {

    const invalidPayload = {
      ...prizePayload,
      name: 123456789
    }

    const response = await wrapped.run({ body: JSON.stringify(invalidPayload) });
    expect(response.statusCode).to.be.equal(406);
    
  });

  it('return 406 for trying to create a prize with invalid image hash', async () => {

    const invalidPayload = {
      ...prizePayload,
      imageHash: 123456789
    }

    const response = await wrapped.run({ body: JSON.stringify(invalidPayload) });
    expect(response.statusCode).to.be.equal(406);
    
  });

  it('return 406 for trying to create a prize with invalid price', async () => {

    const invalidPayload = {
      ...prizePayload,
      price: 'not a price'
    }

    const response = await wrapped.run({ body: JSON.stringify(invalidPayload) });
    expect(response.statusCode).to.be.equal(406);
    
  });

  it('return 406 for trying to create a prize with invalid links', async () => {

    const invalidPayload = {
      ...prizePayload,
      links: 'not a link object'
    }

    const response = await wrapped.run({ body: JSON.stringify(invalidPayload) });
    expect(response.statusCode).to.be.equal(406);
    
  });

  it('return 201 for successfully creating a prize', async () => {

    const response = await wrapped.run({ body: JSON.stringify(prizePayload) });
    expect(response.statusCode).to.be.equal(201);
    
  });

  it('return 409 for trying to create a prize with the same id', async () => {

    const response = await wrapped.run({ body: JSON.stringify(prizePayload) });
    expect(response.statusCode).to.be.equal(409);
    
  });

});