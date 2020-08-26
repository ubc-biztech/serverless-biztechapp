const index         = require('../index');
const AWS           = require('aws-sdk');
const AWSMock       = require('aws-sdk-mock');

const userCredits = { 33333331: 0 }
const cb = (a, text) => { console.log(text); }

beforeAll(() => {

  AWSMock.setSDKInstance(AWS);
  AWSMock.mock('DynamoDB.DocumentClient', 'update', (params, callback) => {

    if(userCredits[params.Key.id] !== null && userCredits[params.Key.id] !== undefined) {
        userCredits[params.Key.id] += parseInt(params.ExpressionAttributeValues[":credits"], 10);
        callback(null, "Successfully updated item in DynamoDB!");
    }
    else throw "Did not find the user";

  })

});

afterAll(() => {

  AWSMock.restore('DynamoDB.DocumentClient');

})

describe('transactions', () => {

  test('positive transaction', async (done) => {

    const positiveTransactionTrigger = require('./positiveTransaction.json');
    await index.handler(positiveTransactionTrigger, {}, cb);

    expect(userCredits[33333331]).toEqual(100)

    done();

  });

  test('negative transaction', async (done) => {

    const negativeTransactionTrigger = require('./negativeTransaction.json');
    await index.handler(negativeTransactionTrigger, {}, cb);

    expect(userCredits[33333331]).toEqual(0)

    done();

  });

});
