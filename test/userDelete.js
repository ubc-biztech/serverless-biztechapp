'use strict';
const AWSMock = require('aws-sdk-mock');

// tests for userDelete
// Generated by serverless-mocha-plugin

const mochaPlugin = require('serverless-mocha-plugin');
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper('userDelete', '/handlers/user.js', 'delete');

const userPayload = {
  id: 6456456464,
  fname: 'insanetest',
  lname: 'dude',
  faculty: 'Science',
  email: 'test@test.com'
};

describe('userDelete', () => {

  const existingUsers = [1234];

  before(() => {

    AWSMock.mock('DynamoDB.DocumentClient', 'get', (params, callback) => {

      let returnValue = null;
      if(existingUsers.includes(params.Key.id)) returnValue = {
        ...userPayload,
        id: params.Key.id
      };
      callback(null, { Item: returnValue });

    });

    AWSMock.mock('DynamoDB.DocumentClient', 'delete', (params, callback) => {

      if(params.Key.id && existingUsers.includes(params.Key.id)) {

        callback(null, 'successfully deleted item in database');

      }
      else callback('item not found in database');

    });

  });

  after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

  it('return 400 for trying to delete a user with no id', async () => {


    const response = await wrapped.run({ pathParameters: {} });
    expect(response.statusCode).to.be.equal(400);

  });

  it('return 404 for trying to delete a user that does not exist', async () => {

    const invalidId = '2468';

    const response = await wrapped.run({ pathParameters: { id: invalidId } });
    expect(response.statusCode).to.be.equal(404);

  });

  it('return 406 for inputting a malformed user id (string instead of number)', async () => {

    const invalidId = 'badID';

    const response = await wrapped.run({ pathParameters: { id: invalidId } });
    expect(response.statusCode).to.be.equal(406);

  });

  it('return 200 for successfully deleting a user', async () => {

    const validId = '1234';

    const response = await wrapped.run({ pathParameters: { id: validId } });
    expect(response.statusCode).to.be.equal(200);

  });

});