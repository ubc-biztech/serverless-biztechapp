"use strict";
import AWSMock from "aws-sdk-mock";

// tests for transactionCreate
// Generated by serverless-mocha-plugin

import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper("transactionCreate", "/handler.js", "create");

import {
  USERS_TABLE
} from "../../../constants/tables";

const transactionPayload = {
  userId: 77777777,
  reason: "ATTENDANCE/EVENT",
  credits: 100
};

describe("transactionCreate", () => {
  let createdTransactionIds = [];
  const userCredits = {
    77777777: 0,
    77777771: 100
  };

  before(() => {
    AWSMock.mock("DynamoDB.DocumentClient", "get", (params, callback) => {
      let returnValue = null;
      if(params.TableName.includes(USERS_TABLE) && userCredits[params.Key.id] !== undefined) {
        // if searching for users
        returnValue = {
          id: params.Key.id,
          credits: userCredits[params.Key.id]
        };
      }
      else if(createdTransactionIds.includes(params.Key.id)) {
        // if searching for transactions
        returnValue = {
          ...transactionPayload,
          id: params.Key.id
        };
      }
      callback(null, {
        Item: returnValue
      });
    });

    AWSMock.mock("DynamoDB.DocumentClient", "put", (params, callback) => {
      if(params.Item.id && createdTransactionIds.includes(params.Item.id)) callback("Transaction already exists!");
      else {
        createdTransactionIds.push(params.Item.id);
        callback(null, "Successfully put item in database");
      }
    });
  });

  after(() => {
    AWSMock.restore("DynamoDB.DocumentClient");
  });

  it("return 406 for trying to create a transaction with no user id", async () => {
    const invalidPayload = {
      ...transactionPayload
    };
    delete invalidPayload.userId;

    const response = await wrapped.run({
      body: JSON.stringify(invalidPayload)
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("return 406 for trying to create a transaction with no reason", async () => {
    const invalidPayload = {
      ...transactionPayload
    };
    delete invalidPayload.reason;

    const response = await wrapped.run({
      body: JSON.stringify(invalidPayload)
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("return 406 for trying to create a transaction with no credits", async () => {
    const invalidPayload = {
      ...transactionPayload
    };
    delete invalidPayload.credits;

    const response = await wrapped.run({
      body: JSON.stringify(invalidPayload)
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("return 406 for trying to create a transaction with invalid user id", async () => {
    const invalidPayload = {
      ...transactionPayload,
      userId: "not a user id"
    };

    const response = await wrapped.run({
      body: JSON.stringify(invalidPayload)
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("return 406 for trying to create a transaction with invalid reason", async () => {
    const invalidPayload = {
      ...transactionPayload,
      reason: 123456789
    };

    const response = await wrapped.run({
      body: JSON.stringify(invalidPayload)
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("return 406 for trying to create a transaction with invalid credits", async () => {
    const invalidPayload = {
      ...transactionPayload,
      credits: "not a credit"
    };

    const response = await wrapped.run({
      body: JSON.stringify(invalidPayload)
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("return 404 for trying to create a transaction with a user that doesn't exist ", async () => {
    const invalidPayload = {
      ...transactionPayload,
      userId: 11111111
    };

    const response = await wrapped.run({
      body: JSON.stringify(invalidPayload)
    });
    expect(response.statusCode).to.be.equal(404);
  });

  it("return 201 for successfully creating a transaction", async () => {
    const response = await wrapped.run({
      body: JSON.stringify(transactionPayload)
    });
    expect(response.statusCode).to.be.equal(201);
  });

  it("return 202 for trying to create a transaction when the user doesn't have enough credits", async () => {
    const payload = {
      ...transactionPayload,
      reason: "PURCHASE/STICKER",
      credits: -100
    };

    const response = await wrapped.run({
      body: JSON.stringify(payload)
    });
    expect(response.statusCode).to.be.equal(202);
  });

  it("return 201 for successfully creating a transaction with negative balance", async () => {
    const payload = {
      ...transactionPayload,
      userId: 77777771,
      reason: "PURCHASE/STICKER",
      credits: -100
    };

    const response = await wrapped.run({
      body: JSON.stringify(payload)
    });
    expect(response.statusCode).to.be.equal(201);
  });
});
