"use strict";

// tests for memberDelete
// Generated by serverless-mocha-plugin

import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
import AWSMock from "aws-sdk-mock";
let wrapped = mochaPlugin.getWrapper("memberDelete", "/handler.js", "del");

const email = "test@gmail.com";

describe("memberDelete", () => {
  const existingMembers = [email];

  beforeEach(() => {
    AWSMock.mock("DynamoDB.DocumentClient", "get", (params, callback) => {
      let returnValue = null;
      if(existingMembers.includes(params.Key.id)) returnValue = {
        id: params.Key.id
      };
      callback(null, {
        Item: returnValue
      });
    });

    AWSMock.mock("DynamoDB.DocumentClient", "delete", (params, callback) => {
      if(params.Key.id && existingMembers.includes(params.Key.id)) {
        callback(null, "successfully deleted item in database");
      }
      else callback("item not found in database");
    });
  });

  after(() => {
    AWSMock.restore("DynamoDB.DocumentClient");
  });

  it("returns 200 when deleting a member", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email : email
      }
    });
    expect(response.statusCode).to.equal(200);
  });

  it("returns 406 when deleting a member with invalid email", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email : "232wdwd"
      }
    });
    expect(response.statusCode).to.equal(406);
  });

  it("returns 404 when deleting a member that does not exist", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email : "invalidmember@gmail.com"
      }
    });
    expect(response.statusCode).to.equal(404);
  });

  it("returns 400 when deleting a member with no email", async () => {
    const response = await wrapped.run({
    });
    expect(response.statusCode).to.equal(400);
  });
});
