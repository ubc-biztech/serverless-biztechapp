'use strict';
import AWSMock from 'aws-sdk-mock';

// tests for transactionGetAll
// Generated by serverless-mocha-plugin

import mochaPlugin from 'serverless-mocha-plugin';
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper('transactionGetAll', '/handler.js', 'getAll');

import getTransactionsResponse from './transactions.json';

describe('transactionGetAll', () => {

  before(() => {

    AWSMock.mock('DynamoDB.DocumentClient', 'scan', (params, callback) => {

      const response = (params && params.ExpressionAttributeValues)
        ? { Items: getTransactionsResponse.Items.filter((transaction) => params.ExpressionAttributeValues[':query'] === transaction.userId) }
        : getTransactionsResponse;
      callback(null, response);

    });

  });

  after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

  it('return 200 response for getting all transactions', async () => {

    const response = await wrapped.run();
    expect(response.statusCode).to.be.equal(200);

    const body = JSON.parse(response.body);
    expect(body).to.have.length(3);

    const event = body[0];
    expect(event).to.have.property('id');
    expect(event).to.have.property('userId');
    expect(event).to.have.property('reason');
    expect(event).to.have.property('credits');

  });

  it('return 200 response for getting all transactions for a specific user', async () => {

    const response = await wrapped.run({ queryStringParameters: { userId: 77777771 } });
    expect(response.statusCode).to.be.equal(200);

    const body = JSON.parse(response.body);

    expect(body.transactions).to.have.length(2);
    expect(body.count).to.be.equal(2);
    expect(body.totalCredits).to.be.equal(0);

    const event = body.transactions[0];
    expect(event).to.have.property('userId');
    expect(event).to.have.property('reason');
    expect(event).to.have.property('credits');

  });

});
