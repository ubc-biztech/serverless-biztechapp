'use strict';

// tests for userGet
// Generated by serverless-mocha-plugin

import mochaPlugin from 'serverless-mocha-plugin';
const expect = mochaPlugin.chai.expect;
import AWSMock from 'aws-sdk-mock';
let wrapped = mochaPlugin.getWrapper('userGet', '/handler.js', 'get');

// If want to invoke mocha instead of sls invoke
// let wrapped = mochaPlugin.getWrapper('userGet', '../../../handlers/user.js', 'get');
describe('userGet', () => {

  before(() => {

    AWSMock.mock('DynamoDB.DocumentClient', 'get', function (params, callback){

      if (params.Key.id == 332332) {

        Promise.resolve(
          callback(null, { Item: 'not null user' })
        );

      } else if  (params.Key.id == 123123) {

        Promise.resolve(
          callback(null, { Item: null })
        );

      }

    });

  });

  after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

  it ('should return 406 for trying to get a user with invalid id (string)', async () => {

    const response = await wrapped.run({
      pathParameters: {
        id: 'badID'
      }
    });
    expect(response).to.not.be.empty;
    expect(response.statusCode).to.equal(406);

  });

  it ('shoult return 404 for trying to get a user that does not exist', async () => {

    const response = await wrapped.run({
      pathParameters: {
        id: 123123
      }
    });
    expect(response).to.not.be.empty;
    expect(response.statusCode).to.equal(404);

  });

  it('should return 200 for successfully getting a user', async () => {

    const response = await wrapped.run({
      pathParameters: {
        id: 332332
      }
    });
    expect(response).to.not.be.empty;
    expect(response.statusCode).to.equal(200);

  });

});