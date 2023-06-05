"use strict";

// tests for userUpdate
// Generated by serverless-mocha-plugin

import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
import AWSMock from "aws-sdk-mock";
let wrapped = mochaPlugin.getWrapper("userUpdate", "/handler.js", "update");

const email = "test@gmail.com";

const testEntry = {
  studentId: 6456456464,
  fname: "insanetest",
  lname: "dude",
  faculty: "Science",
  major: "biology",
  email: email,
  year: "3rd year"
};

describe("userUpdate", () => {
  const existingUserIds = [email];

  before(() => {
    AWSMock.mock("DynamoDB.DocumentClient", "get", (params, callback) => {
      let returnValue = null;
      if(existingUserIds.includes(params.Key.id)) returnValue = {
        ...testEntry,
        id: params.Key.id
      };
      callback(null, {
        Item: returnValue
      });
    });

    AWSMock.mock("DynamoDB.DocumentClient", "update", function (params, callback) {
      Promise.resolve(
        callback(null, {
          Item: "not null user"
        })
      );
    });
  });

  after(() => {
    AWSMock.restore("DynamoDB.DocumentClient");
  });

  it("returns 406 when given email is not valid", async () => {
    const badEmail = "asdf";

    const response = await wrapped.run({
      body: JSON.stringify(testEntry),
      pathParameters: {
        email: badEmail
      }
    });
    expect(response.statusCode).to.equal(406);
  });

  it("returns 404 when given unknown email", async () => {
    const unknownEmail = "asdf@gmail.com";

    const response = await wrapped.run({
      body: JSON.stringify(testEntry),
      pathParameters: {
        email: unknownEmail
      }
    });
    expect(response.statusCode).to.equal(404);
  });

  it("returns 200 when given valid data", async () => {
    const response = await wrapped.run({
      body: JSON.stringify(testEntry),
      pathParameters: {
        email: email
      }
    });
    expect(response.statusCode).to.equal(200);
  });
});
