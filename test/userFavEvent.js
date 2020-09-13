'use strict';

// tests for userFavEvent
// Generated by serverless-mocha-plugin

const mochaPlugin = require('serverless-mocha-plugin');
const expect = mochaPlugin.chai.expect;
const AWSMock = require('aws-sdk-mock');
let wrapped = mochaPlugin.getWrapper('userFavEvent', '/handlers/user.js', 'favouriteEvent');

const testEntry = {
    eventID: 'some event that exists',
    isFavourite: true
};

describe('userFavEvent', () => {

  it('returns 200 when given valid data', async () => {
    AWSMock.mock('DynamoDB.DocumentClient', 'update', function (params, callback) {
        Promise.resolve(
            callback(null, {
              Item: 'not null user'
            } 
          ));
    });
    const response = await wrapped.run({ 
        body: JSON.stringify(testEntry),
        pathParameters: {
            id: '6456456464'
        }
    });
    expect(response.statusCode).to.equal(200);
    expect(response.body).to.equal(`"Favouriting event '${testEntry.eventID}' success."`)
    AWSMock.restore('DynamoDB.DocumentClient');
    });

  it('returns 406 when eventID not provided', async () => {
      const response = await wrapped.run({
          body: JSON.stringify({
              isFavourite: true
          }),
          pathParameters: {
            id: '6456456464'
          }
      })
      expect(response.statusCode).to.equal(406);
  })

  it('returns 406 when isFavourite is not provided', async () => {
      const response = await wrapped.run({
          body: JSON.stringify({
              eventID: 'some event id'
          }),
          pathParameters: {
            id: '6456456464'
          }
      })
      expect(response.statusCode).to.equal(406);
  })

  it ('returns 406 when isFavourite is not a boolean', async () => {
      const response = await wrapped.run({
          body: JSON.stringify({
              eventID: 'some event id',
              isFavourite: 'not a boolean'
          }),
          pathParameters: {
            id: '6456456464'
          }
      })
      expect(response.statusCode).to.equal(406);
  })
});
