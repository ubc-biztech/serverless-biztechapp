"use strict";

// tests for registrationPost
// Generated by serverless-mocha-plugin

import AWSMock from "aws-sdk-mock";
import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper("registrationPost", "/handler.js", "post");
import { EVENTS_TABLE, USERS_TABLE, USER_REGISTRATIONS_TABLE } from "../../../constants/tables";

const email = "test@gmail.com";
const email2 = "test2@gmail.com";
const userResponse = {
  studentId: 12200034,
  fname: "user",
  lname: "man",
  faculty: "Science",
  email: email
};

const eventResponse = {
  "id": "event",
  "year": 2020,
  "capac": 2,
  "createdAt": 1581227718674,
  "description":	"I am a description",
  "elocation": "UBC",
  "ename": "Existing Event",
  "startDate": "2020-02-09T05:55:11.131Z",
  "endDate":	"2020-02-09T05:55:11.131Z",
  "imageUrl":	"https://i.picsum.photos/id/236/700/400.jpg",
  "updatedAt": 1581227718674
};

const registrationsResponse = [
  {
    email: email,
    eventID: "event",
    year: 2020,
    updatedAt: 1600669844493,
    registrationStatus: "registered"
  },
  {
    email: email2,
    eventID: "event",
    year: 2020,
    updatedAt: 1600669844493,
    registrationStatus: "registered"
  }
];

describe("registrationPost", () => {
  before(() => {
    AWSMock.mock("DynamoDB.DocumentClient", "get", (params, callback) => {
      if(params.TableName.includes(EVENTS_TABLE)) {
        if(params.Key.id === "event" && params.Key.year === 2020) callback(null, { Item: eventResponse });
        else callback(null, { Item: null });
      }
      else if(params.TableName.includes(USERS_TABLE)) {
        if(params.Key.id === email) callback(null, { Item: userResponse });
        else if(params.Key.id === email2) callback(null, { Item: { ...userResponse, id: email2 } });
        else callback(null, { Item: null });
      }
      return null;
    });

    AWSMock.mock("DynamoDB.DocumentClient", "scan", (params, callback) => {
      if(params.TableName.includes(USER_REGISTRATIONS_TABLE)) {
        callback(null, { Items: registrationsResponse });
        return null;
      }
    });

    AWSMock.mock("DynamoDB.DocumentClient", "update", (params, callback) => {
      // for POST
      // throw error if already exists (only check for email2)
      if(params.Key.id === email2 && params.Key["eventID;year"] === "event;2020") callback({ code: "ConditionalCheckFailedException" });
      else callback(null, "Created!");

      return null;
    });
  });

  after(() => {
    AWSMock.restore("DynamoDB.DocumentClient");
  });

  it("should return 406 when email is not given ", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        eventID: "event",
        year: 2020,
        registrationStatus: "registered"
      })
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("should return 406 when no eventID is provided", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        year: 2020,
        registrationStatus: "registered"
      })
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("should return 406 when year is not provided in eventID;year", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        registrationStatus: "registered",
        eventID: "event",
      })
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("should return 406 when no registrationStatus is provided", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        ["eventID;year"]: "event;2020",
      })
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("should return 404 when unknown event id is provided", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        eventID: "unknownEvent",
        year: 2020,
        registrationStatus: "registered"
      })
    });
    expect(response.statusCode).to.be.equal(404);
  });

  it("should return 404 when unknown user email is provided", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: "asdf@gmail.com",
        eventID: "event",
        year: 2020,
        registrationStatus: "registered"
      })
    });
    expect(response.statusCode).to.be.equal(404);
  });

  it("should return 201 for successful creation of registration as waitlist", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        eventID: "event",
        year: 2020,
        registrationStatus: "waitlist"
      }),
    });

    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(201);
    expect(body.registrationStatus).to.equal("waitlist");
  });

  it("should return 201 for successful creation of registration with maximum capac", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        eventID: "event",
        year: 2020,
        registrationStatus: "registered"
      }),
    });

    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(201);
    expect(body.registrationStatus).to.equal("waitlist");
  });

  it("should return 409 for trying to create duplicate registration entry", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email2,
        eventID: "event",
        year: 2020,
        registrationStatus: "registered"
      }),
    });
    expect(response.statusCode).to.equal(409);
  });
});
