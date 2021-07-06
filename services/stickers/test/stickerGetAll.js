'use strict';
import AWSMock from 'aws-sdk-mock';

// tests for stickerGetAll
// Generated by serverless-mocha-plugin

import mochaPlugin from 'serverless-mocha-plugin';
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper('stickerGetAll', '/handler.js', 'getAll');

import { stickerItemList } from './testData';

describe('stickerGetAll', () => {

  before(() => {

    AWSMock.mock('DynamoDB.DocumentClient', 'scan', (params, callback) => {

      callback(null, { Items: stickerItemList });

    });

  });

  after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

  it('return 200 response for getting all stickers', async() => {

    const response = await wrapped.run();
    expect(response.statusCode).to.be.equal(200);

    const body = JSON.parse(response.body);
    expect(body).to.have.length(3);

    const event = body[0];
    expect(event).to.have.property('id');
    expect(event).to.have.property('name');
    expect(event).to.have.property('imageURL');
    expect(event).to.have.property('key');

  });

});
