'use strict';

// tests for userGet
// Generated by serverless-mocha-plugin

import mochaPlugin from 'serverless-mocha-plugin';
const expect = mochaPlugin.chai.expect;
import AWSMock from 'aws-sdk-mock';
let wrapped = mochaPlugin.getWrapper('userGet', '/handler.js', 'get');

// If want to invoke mocha instead of sls invoke
// let wrapped = mochaPlugin.getWrapper('userGet', '../../../handlers/user.js', 'get');

const email = 'test@gmail.com';
const nonexistentEmail = 'nonexistent@gmail.com';
describe('userGet', () => {

  before(() => {

    AWSMock.mock('DynamoDB.DocumentClient', 'get', function (params, callback){

      if (params.Key.id == email) {

        Promise.resolve(
          callback(null, { Item: 'not null user' })
        );

      } else if  (params.Key.id == nonexistentEmail) {

        Promise.resolve(
          callback(null, { Item: null })
        );

      }

    });

  });

  after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

  it ('should return 406 for trying to get a user with invalid email', async () => {

    const response = await wrapped.run({
      pathParameters: {
        email: 'asdf'
      }
    });
    expect(response).to.not.be.empty;
    expect(response.statusCode).to.equal(406);

  });

  it ('should return 404 for trying to get a user that does not exist', async () => {

    const response = await wrapped.run({
      pathParameters: {
        email: nonexistentEmail
      }
    });
    expect(response).to.not.be.empty;
    expect(response.statusCode).to.equal(404);

  });

  it('should return 200 for successfully getting a user', async () => {

    const response = await wrapped.run({
      pathParameters: {
        email: email
      }
    });
    expect(response).to.not.be.empty;
    expect(response.statusCode).to.equal(200);

  });

});
