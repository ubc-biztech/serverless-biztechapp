"use strict";
import AWSMock from "aws-sdk-mock";

// tests for prizeUpdate
// Generated by serverless-mocha-plugin

import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper("prizeUpdate", "/handler.js", "update");

const updatePayload = {
  name: "i am a prize",
  price: 100,
  imageHash: "bf9f97372c2ebbb3",
  links: {
    sponsor: "https://www.google.com"
  }
};

describe("prizeUpdate", () => {
  let existingPrizes = ["prize001", "prize002"];

  before(() => {
    AWSMock.mock("DynamoDB.DocumentClient", "get", (params, callback) => {
      let returnValue = null;
      if(existingPrizes.includes(params.Key.id)) returnValue = {
        ...updatePayload,
        id: params.Key.id
      };
      callback(null, { Item: returnValue });
    });

    AWSMock.mock("DynamoDB.DocumentClient", "update", (params, callback) => {
      if(params.Key.id && existingPrizes.includes(params.Key.id)) {
        callback(null, "successfully updated item in database");
      }
      else callback("item not found in database");
    });
  });

  after(() => {
    AWSMock.restore("DynamoDB.DocumentClient");
  });

  it("return 400 for trying to update a prize with no id", async () => {
    const response = await wrapped.run({
      body: JSON.stringify(updatePayload)
    });
    expect(response.statusCode).to.be.equal(400);
  });

  it("return 404 for trying to update a prize that doesn't exist", async () => {
    const unknownId = "unknownid";

    const response = await wrapped.run({
      pathParameters: { id: unknownId },
      body: JSON.stringify(updatePayload)
    });
    expect(response.statusCode).to.be.equal(404);
  });

  it("return 406 for trying to update a prize with invalid name", async () => {
    const invalidPayload = {
      ...updatePayload,
      name: 123456789
    };

    const response = await wrapped.run({
      pathParameters: { id: "prize001" },
      body: JSON.stringify(invalidPayload)
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("return 406 for trying to update a prize with invalid image hash", async () => {
    const invalidPayload = {
      ...updatePayload,
      imageHash: 123456789
    };

    const response = await wrapped.run({
      pathParameters: { id: "prize001" },
      body: JSON.stringify(invalidPayload)
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("return 406 for trying to update a prize with invalid price", async () => {
    const invalidPayload = {
      ...updatePayload,
      price: "not a price"
    };

    const response = await wrapped.run({
      pathParameters: { id: "prize001" },
      body: JSON.stringify(invalidPayload)
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("return 406 for trying to update a prize with invalid links", async () => {
    const invalidPayload = {
      ...updatePayload,
      links: "not a link object"
    };

    const response = await wrapped.run({
      pathParameters: { id: "prize001" },
      body: JSON.stringify(invalidPayload)
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("return 200 for successfully updating a prize", async () => {
    const response = await wrapped.run({
      pathParameters: { id: "prize002" },
      body: JSON.stringify(updatePayload)
    });
    expect(response.statusCode).to.be.equal(200);
  });
});
