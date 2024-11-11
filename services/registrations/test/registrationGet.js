"use strict";

// tests for registrationGet
// Generated by serverless-mocha-plugin

import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper("registrationGet", "/handler.js", "get");

import {
  USERS_TABLE
} from "../../../constants/tables";
import {
  mockClient
} from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient, QueryCommand, GetCommand
} from "@aws-sdk/lib-dynamodb";

const email = "test@gmail.com";
const email2 = "test2@gmail.com";

const registrationPayload = [
  {
    id: email,
    "eventID;year": "event;2020",
    registrationStatus: "registered",
    updatedAt: 1600669844493,
    basicInformation: {
      diet: "None",
      faculty: "Commerce",
      fname: "Test",
      gender: "Other/Prefer not to say",
      heardFrom: "Instagram",
      lname: "User",
      major: "BUCS",
      year: "1st Year"
    }
  },
  {
    id: email2,
    "eventID;year": "event;2020",
    registrationStatus: "registered",
    updatedAt: 1600669844493,
    basicInformation: {
      diet: "None",
      faculty: "Commerce",
      fname: "Test2",
      gender: "Other/Prefer not to say",
      heardFrom: "Instagram",
      lname: "User2",
      major: "BUCS",
      year: "2nd Year"
    }
  }
];

const eventResponse = {
  id: "event",
  year: 2020,
  capac: 2,
  ename: "Test Event",
  description: "Test Description",
  elocation: "Test Location",
  startDate: "2024-09-12T01:00:00.000Z",
  endDate: "2024-09-12T04:00:00.000Z",
  isPublished: true,
  registrationQuestions: []
};

describe("registrationUpdateHelper", () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);

  beforeEach(() => {
    ddbMock.reset();

    // Mock Query Command
    ddbMock.on(QueryCommand).callsFake(params => {
      if (params.IndexName === "event-query") {
        // For event-query GSI, we need eventID;year as the partition key
        const eventIDYear = params.ExpressionAttributeValues[":eventIDYear"];
        const items = registrationPayload.filter(item =>
          item["eventID;year"] === eventIDYear
        );
        return {
          Items: items
        };
      } else {
        // Primary index query by email
        const emailId = params.ExpressionAttributeValues[":id"];
        const items = registrationPayload.filter(item =>
          item.id === emailId
        );
        return {
          Items: items
        };
      }
    });

    // Mock Get Command
    ddbMock.on(GetCommand).callsFake(params => {
      if (params.TableName.includes("events")) {
        if (params.Key.id === "event" && params.Key.year === 2020) {
          return {
            Item: eventResponse
          };
        }
        return {
          Item: null
        };
      } else if (params.TableName.includes(USERS_TABLE)) {
        if (params.Key.id === email) {
          return {
            Item: registrationPayload[0]
          };
        }
        return {
        };
      }
    });
  });

  afterEach(() => {
    ddbMock.restore();
  });

  it("return 400 when queryString is not given ", async () => {
    const response = await wrapped.run({
    });
    expect(response.statusCode).to.be.equal(400);
  });

  it("return 400 when queryString is missing both eventID and email ", async () => {
    const response = await wrapped.run({
      queryStringParameters: {
        registrationStatus: "status"
      }
    });
    expect(response.statusCode).to.be.equal(400);
  });

  it("return 200 for successful get with id (event) and year but no email", async () => {
    const response = await wrapped.run({
      queryStringParameters: {
        "eventID": "event",
        "year": "2020"
      }
    });
    expect(response.statusCode).to.equal(200);
    const body = JSON.parse(response.body);
    expect(body.data.length).to.equal(2);
  });

  it("return 200 for successful get with email and no eventID or year", async () => {
    const response = await wrapped.run({
      queryStringParameters: {
        email: email
      }
    });

    expect(response.statusCode).to.equal(200);
  });

  it("return 200 for successful get with both eventID and email", async () => {
    const response = await wrapped.run({
      queryStringParameters: {
        id: "event",
        year: "2020",
        email: email
      }
    });
    expect(response.statusCode).to.equal(200);
    const body = JSON.parse(response.body);
    expect(body.data.length).to.equal(1);
    expect(body.data[0].id).to.equal(email);
  });

  it("return 200 for successful get with email, eventID;year, and recent timestamp", async () => {
    const response = await wrapped.run({
      queryStringParameters: {
        eventID: "event",
        year: "2020",
        email: email,
        afterTimestamp: 1600669844494
      }
    });

    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(200);
    expect(body.size).to.equal(0);
    expect(body.data).to.have.length(0);
  });


  it("return 200 for successful get with email, eventID;year, and timestamp", async () => {
    const response = await wrapped.run({
      queryStringParameters: {
        eventID: "event",
        year: "2020",
        email: email,
        afterTimestamp: 1600669844492
      }
    });

    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(200);
    expect(body.data.length).to.equal(1);
    expect(body.data[0].id).to.equal(email);
  });
});
