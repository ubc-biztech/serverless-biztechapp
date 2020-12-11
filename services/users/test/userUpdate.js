'use strict';

// tests for userUpdate
// Generated by serverless-mocha-plugin

import mochaPlugin from 'serverless-mocha-plugin';
const expect = mochaPlugin.chai.expect;
import AWSMock from 'aws-sdk-mock';
let wrapped = mochaPlugin.getWrapper('userUpdate', '/handler.js', 'update');

const testEntry = {
  id: 6456456464,
  fname: 'insanetest',
  lname: 'dude',
  faculty: 'Science',
  email: 'test@test.com',
  year: '3rd year'
};

describe('userUpdate', () => {

  const existingUserIds = [6456456464];

  before(() => {

    AWSMock.mock('DynamoDB.DocumentClient', 'get', (params, callback) => {

      let returnValue = null;
      if(existingUserIds.includes(params.Key.id)) returnValue = {
        ...testEntry,
        id: params.Key.id
      };
      callback(null, { Item: returnValue });

    });

    AWSMock.mock('DynamoDB.DocumentClient', 'update', function (params, callback) {

      Promise.resolve(
        callback(null, { Item: 'not null user' })
      );

    });

  });

  after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

  it('returns 406 when given id that is not a number', async () => {

    const badID = 'badID';

    const response = await wrapped.run({
      body: JSON.stringify(testEntry),
      pathParameters: { id: badID }
    });
    expect(response.statusCode).to.equal(406);

  });

  it('returns 404 when given unknown id', async () => {

    const unknownID = '2468';

    const response = await wrapped.run({
      body: JSON.stringify(testEntry),
      pathParameters: { id: unknownID }
    });
    expect(response.statusCode).to.equal(404);

  });

  it('returns 200 when given valid data', async () => {

    const response = await wrapped.run({
      body: JSON.stringify(testEntry),
      pathParameters: {
        id: '6456456464'
      }
    });
    expect(response.statusCode).to.equal(200);

  });

});
