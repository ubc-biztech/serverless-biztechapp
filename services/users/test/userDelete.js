"use strict";

// tests for userDelete
// Generated by serverless-mocha-plugin

import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
import AWSMock from "aws-sdk-mock";
let wrapped = mochaPlugin.getWrapper("userDelete", "/handler.js", "del");

const email = "test@gmail.com";
const userPayload = {
  studentId: 6456456464,
  fname: "insanetest",
  lname: "dude",
  faculty: "Science",
  email: email
};

describe("userDelete", () => {
  const existingUsers = [email];

  before(() => {
    AWSMock.mock("DynamoDB.DocumentClient", "get", (params, callback) => {
      let returnValue = null;
      if(existingUsers.includes(params.Key.id)) returnValue = {
        ...userPayload,
        id: params.Key.id
      };
      callback(null, {
        Item: returnValue
      });
    });

    AWSMock.mock("DynamoDB.DocumentClient", "delete", (params, callback) => {
      if(params.Key.id && existingUsers.includes(params.Key.id)) {
        callback(null, "successfully deleted item in database");
      }
      else callback("item not found in database");
    });
  });

  after(() => {
    AWSMock.restore("DynamoDB.DocumentClient");
  });

  it("return 400 for trying to delete a user with no email", async () => {
    const response = await wrapped.run({
      pathParameters: {
      }
    });
    expect(response.statusCode).to.be.equal(400);
  });

  it("return 404 for trying to delete a user that does not exist", async () => {
    const invalidEmail = "asdf@gmail.com";

    const response = await wrapped.run({
      pathParameters: {
        email: invalidEmail
      }
    });
    expect(response.statusCode).to.be.equal(404);
  });

  it("return 200 for successfully deleting a user", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email: email
      }
    });
    expect(response.statusCode).to.be.equal(200);
  });
});
