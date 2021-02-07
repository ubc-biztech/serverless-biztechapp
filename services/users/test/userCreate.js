'use strict';

// tests for userCreate
// Generated by serverless-mocha-plugin

import mochaPlugin from 'serverless-mocha-plugin';
const expect = mochaPlugin.chai.expect;
import AWSMock from 'aws-sdk-mock';
let wrapped = mochaPlugin.getWrapper('userCreate', '/handler.js', 'create');
import { USER_INVITE_CODES_TABLE } from '../../../constants/tables';

const email = 'test@gmail.com';
const testEntry = {
  studentId: 6456456464,
  fname: 'insanetest',
  lname: 'dude',
  faculty: 'Science',
  email: email
};

describe('userCreate', () => {

  beforeEach(() => {

    AWSMock.mock('DynamoDB.DocumentClient', 'put', function (params, callback) {

      Promise.resolve(
        callback(null, {
          Item: 'not null user'
        }
        ));

    });

  });

  it('returns 201 when given valid data', async () => {

    const response = await wrapped.run({ body: JSON.stringify(testEntry) });
    expect(response.statusCode).to.equal(201);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.params.Item.id).to.equal(email);
    expect(responseBody.params.Item.admin).to.equal(false);

  });

  it('returns 406 when not given email', async () => {

    const body = {
      ...testEntry
    };
    delete body.email;

    const response = await wrapped.run({ body: JSON.stringify(body) });
    expect(response.statusCode).to.equal(406);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.message).to.equal('Invalid email');

  });

  it('returns 201 and sets user as admin', async () => {

    const body = {
      ...testEntry,
      email: 'adminUser@ubcbiztech.com'
    };

    const response = await wrapped.run({ body: JSON.stringify(body) });
    expect(response.statusCode).to.equal(201);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.params.Item.admin).to.equal(true);

  });

  it('returns 201 and deletes invite code', async () => {

    AWSMock.mock('DynamoDB.DocumentClient', 'get', function (params, callback) {

      if (params.TableName == USER_INVITE_CODES_TABLE + process.env.ENVIRONMENT) {

        Promise.resolve(
          callback(null, {
            Item: 'not null invites'
          })
        );

      } else {

        Promise.reject(
          callback(null)
        );

      }

    });

    AWSMock.mock('DynamoDB.DocumentClient', 'delete', function (params, callback) {

      if (params.TableName == USER_INVITE_CODES_TABLE + process.env.ENVIRONMENT) {

        Promise.resolve(
          callback(null, {
            Item: 'expected invites delete'
          })
        );

      } else {

        Promise.reject(
          callback(null)
        );

      }

    });

    const body = {
      ...testEntry,
      inviteCode: '23323'
    };

    const response = await wrapped.run({ body: JSON.stringify(body) });
    expect(response.statusCode).to.equal(201);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.params.Item.id).to.equal(email);
    expect(responseBody.params.Item.admin).to.equal(false);
    expect(responseBody.params.Item.paid).to.equal(true);

  });

  it('returns 404 when invite code not found', async () => {

    AWSMock.mock('DynamoDB.DocumentClient', 'get', function (params, callback) {

      if (params.TableName == USER_INVITE_CODES_TABLE + process.env.ENVIRONMENT) {

        Promise.resolve(
          callback(null, {
            Item: null
          })
        );

      } else {

        Promise.reject(
          callback(null)
        );

      }

    });

    const body = {
      ...testEntry,
      inviteCode: '23323'
    };
    const response = await wrapped.run({ body: JSON.stringify(body) });
    expect(response.statusCode).to.equal(404);
    const responseBody = JSON.parse(response.body);
    expect(responseBody).to.equal('Invite code not found.');

  });

  afterEach(function() {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

});
