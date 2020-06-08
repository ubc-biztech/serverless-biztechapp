'use strict';

// tests for userCreate
// Generated by serverless-mocha-plugin

const mochaPlugin = require('serverless-mocha-plugin');
const expect = mochaPlugin.chai.expect;
const AWS = require('aws-sdk-mock');
let wrapped = mochaPlugin.getWrapper('userCreate', '/handlers/user.js', 'create');

describe('userCreate', () => {
  before((done) => {
    done();
  });

  it('user create success', async () => {
    AWS.mock('DynamoDB.DocumentClient', 'put', function (params, callback){
      Promise.resolve(
          callback(null, {
            Item: 'not null user'
          } 
        ));
    });

    const body = JSON.stringify( {
      id: '6456456464',
      fname: 'insanetest',
      lname: 'dude',
      faculty: 'Science',
      email: 'test@test.com'
    }
    );
    const response = await wrapped.run({
      body: body
    });
    expect(response.statusCode).to.equal(201);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.params.Item.id).to.equal(6456456464);
    expect(responseBody.params.Item.admin).to.equal(false);
  });

  it('user create no ID fails', async () => {
    const body = JSON.stringify( {
      fname: 'insanetest',
      lname: 'dude',
      faculty: 'Science',
      email: 'test@test.com'
    }
    );
    const response = await wrapped.run({
      body: body
    });
    expect(response.statusCode).to.equal(406);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.message).to.equal("User ID not specified.");
  });

  it('user create admin success', async () => {
    AWS.mock('DynamoDB.DocumentClient', 'put', function (params, callback){
      Promise.resolve(
          callback(null, {
            Item: 'not null user'
          } 
        ));
    });

    const body = JSON.stringify( {
      id: '6456456464',
      fname: 'insanetest',
      lname: 'dude',
      faculty: 'Science',
      email: 'test@ubcbiztech.com'
    }
    );
    const response = await wrapped.run({
      body: body
    });
    expect(response.statusCode).to.equal(201);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.params.Item.id).to.equal(6456456464);
    expect(responseBody.params.Item.admin).to.equal(true);
  });

  it('user create invitecode success', async () => {
    AWS.mock('DynamoDB.DocumentClient', 'put', function (params, callback) {
      Promise.resolve(
          callback(null, {
            Item: 'not null user'
          } 
        ));
    });

    AWS.mock('DynamoDB.DocumentClient', 'get', function (params, callback) {
      if (params.TableName == 'inviteCodes' + process.env.ENVIRONMENT) {
        Promise.resolve(
          callback(null, {
            Item: 'not null invites'
          })
        )
      }
    });

    AWS.mock('DynamoDB.DocumentClient', 'delete', function (params, callback) {
      if (params.TableName == 'inviteCodes' + process.env.ENVIRONMENT) {
        Promise.resolve(
          callback(null, {
            Item: 'expected invites delete'
          })
        )
      }
    });

    const body = JSON.stringify( {
      id: '6456456464',
      fname: 'insanetest',
      lname: 'dude',
      faculty: 'Science',
      email: 'test@biztech.com',
      inviteCode: '23233',
    }
    );
    const response = await wrapped.run({
      body: body
    });
    expect(response.statusCode).to.equal(201);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.params.Item.id).to.equal(6456456464);
    expect(responseBody.params.Item.admin).to.equal(false);
    expect(responseBody.params.Item.paid).to.equal(true);
  });

  it('user create invitecode failure', async () => {
    AWS.mock('DynamoDB.DocumentClient', 'put', function (params, callback) {
      Promise.resolve(
          callback(null, {
            Item: 'not null user'
          } 
        ));
    });

    AWS.mock('DynamoDB.DocumentClient', 'get', function (params, callback) {
      if (params.TableName == 'inviteCodes' + process.env.ENVIRONMENT) {
        Promise.resolve(
          callback(null, {
            Item: null
          })
        )
      }
    });

    const body = JSON.stringify( {
      id: '6456456464',
      fname: 'insanetest',
      lname: 'dude',
      faculty: 'Science',
      email: 'test@biztech.com',
      inviteCode: '23233',
    }
    );
    const response = await wrapped.run({
      body: body
    });
    expect(response.statusCode).to.equal(404);
    const responseBody = JSON.parse(response.body);
    expect(responseBody).to.equal('Invite code not found.');
  });

  afterEach(function() {
    AWS.restore('DynamoDB.DocumentClient');
  });

});
