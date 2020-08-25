'use strict';
const AWSMock = require('aws-sdk-mock');

// tests for prizeDelete
// Generated by serverless-mocha-plugin

const mochaPlugin = require('serverless-mocha-plugin');
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper('prizeCreate', '/handlers/prize.js', 'delete');

const prizePayload = {
    id: 'prize001',
    name: 'i am a prize',
    price: 100,
    imageHash: 'bf9f97372c2ebbb3',
    links: {
        sponsor: 'https://www.google.com'
    }
}

describe('prizeDelete', () => {

  let existingPrizes = ['prize001', 'prize002'];

  before(() => {

    AWSMock.mock('DynamoDB.DocumentClient', 'get', (params, callback) => {
        let returnValue = null;
        if(existingPrizes.includes(params.Key.id)) returnValue = {
            ...prizePayload,
            id: params.Key.id
        };
        callback(null, { Item: returnValue });
    });


    AWSMock.mock('DynamoDB.DocumentClient', 'delete', (params, callback) => {
        if(params.Key.id && existingPrizes.includes(params.Key.id)) {
          callback(null, "successfully deleted item in database");
        }
        else callback(new Error(""));
    });
    
  });

  after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

  it('return 400 for trying to delete a prize with no id', async () => {


    const response = await wrapped.run({ pathParameters: {} });
    expect(response.statusCode).to.be.equal(400);
    
  });

  it('return 404 for trying to delete a prize that doesn\'t exist', async () => {

    const unknownId = 'nonExistantPrize';

    const response = await wrapped.run({ pathParameters: { id: unknownId } });
    console.log({response})
    expect(response.statusCode).to.be.equal(404);
    
  });

  it('return 200 for successfully deleting a prize', async () => {

    const validId = existingPrizes[0];

    const response = await wrapped.run({ pathParameters: { id: validId } });
    expect(response.statusCode).to.be.equal(200);
    
  });

});
