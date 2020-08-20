'use strict';

// tests for userUpdat
// Generated by serverless-mocha-plugin

const mochaPlugin = require('serverless-mocha-plugin');
const expect = mochaPlugin.chai.expect;
const AWSMock = require('aws-sdk-mock');
let wrapped = mochaPlugin.getWrapper('userUpdate', '/handlers/user.js', 'update');

const testEntry = {
    id: '6456456464',
    fname: 'insanetest',
    lname: 'dude',
    faculty: 'Science',
    email: 'test@test.com'
};

describe('userUpdate', () => {
  before(() => {
    AWSMock.mock('DynamoDB.DocumentClient', 'update', function (params, callback) {
        Promise.resolve(
            callback(null, {
              Item: 'not null user'
            } 
          ));
    });
  });

  after(() => {
    AWSMock.restore('DynamoDB.DocumentClient');
  });

  it('returns 200 when given valid data', async () => {
    const response = await wrapped.run({ 
        body: JSON.stringify(testEntry),
        pathParameters: {
            id: '6456456464'
        }
    });
    expect(response.statusCode).to.equal(200);
    expect(response.body).to.equal('\"Update succeeded.\"')
  });

  it('returns 400 when given bad id (string)', async () => {
      const response = await wrapped.run({
          body: JSON.stringify(testEntry),
          pathParameters: {
              id: 'badID'
          }
      });
      expect(response.statusCode).to.equal(400);
  })
});
