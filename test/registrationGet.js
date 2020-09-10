'use strict';

// tests for registrationGet
// Generated by serverless-mocha-plugin

const mochaPlugin = require('serverless-mocha-plugin');
const expect = mochaPlugin.chai.expect;
const AWSMock = require('aws-sdk-mock');
let wrapped = mochaPlugin.getWrapper('registrationGet', '/handlers/registration.js', 'get')

describe('registrationUpdateHelper', () => {
  
    before(() => {

        AWSMock.mock('DynamoDB.DocumentClient', 'get', (params, callback) => {  

        }); 
    });
after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });


  it('return 406 when queryString is not given ', async () => {
    const response = await wrapped.run({
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it('return 406 when queryString is missing eventID and id ', async () => {
    const response = await wrapped.run({
      queryStringParameters: {
        registrationStatus: 'status'
      }
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it('return 404 when users not found', async () => {
    AWSMock.mock('DynamoDB.DocumentClient', 'scan', function (params, callback){
        Promise.resolve(
            callback(null, {
                Items: []
            })
        )
      });
      const response = await wrapped.run({
        queryStringParameters: {
          eventID: 'event', 
        }
      });
      expect(response.statusCode).to.equal(404);
      AWSMock.restore('DynamoDB.DocumentClient');
  }) 
  

}); 
