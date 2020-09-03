'use strict';
const AWS = require('aws-sdk');
const chai = require('chai');
const expect = chai.expect;

const helpers = require('./helpers')

describe('hello integration', function () {
  
  this.timeout(10000);

  it('hello test', async () => {
    return helpers.invokeLambda("hello").then((data) => {
      const [statusCode, body] = helpers.extractPayloadData(data);
      expect(statusCode).to.equal(200);
      expect(body.message).to.equal("Yeet!");
    })
  });
});
