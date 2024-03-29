"use strict";
import AWSMock from "aws-sdk-mock";

// tests for eventGet
// Generated by serverless-mocha-plugin

import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper("eventGet", "/handler.js", "get");
import {
  EVENTS_TABLE, USERS_TABLE, USER_REGISTRATIONS_TABLE
} from "../../../constants/tables";

import eventData from "./events.json";
const event = eventData.Items[0];
const getEventResponse = {
  Item: event
};
import getEventRegistrationResponse from "./eventRegistrations.json";

describe("eventGet", () => {
  const existingEvents = [{
    id: "existingEvent1",
    year: 2020
  }];

  before(() => {
    // Mocks the GET request to DyanmoDB
    AWSMock.mock("DynamoDB.DocumentClient", "get", (params, callback) => {
      // Check if the table exists first
      if (params.TableName.includes(EVENTS_TABLE)) {
        // Check if an entry with the same id and year already exists in our table
        if (params.Key.id && params.Key.year && existingEvents.some(key => key.id === params.Key.id && key.year === params.Key.year)) callback(null, getEventResponse);

        // Id and year does not exist in our table
        else callback(null, {
          Item: null
        });
      }
    });


    // event counts from registration table
    AWSMock.mock("DynamoDB.DocumentClient", "scan", (params, callback) => {
      if(params.TableName.includes(USER_REGISTRATIONS_TABLE)) {
        callback(null, getEventRegistrationResponse);
      }
    });

    // users from users table
    AWSMock.mock("DynamoDB.DocumentClient", "batchGet", (params, callback) => {
      const tables = Object.keys(params.RequestItems);

      if(tables.includes(USERS_TABLE)) {
        const table = tables[0];
        const response = {
          Responses: {
          }
        };

        // return users here
        response.Responses[table] = [{
          id: 1
        }, {
          id: 2
        }, {
          id: 3
        }];

        callback(null, response);
      } else callback(new Error("error during batch get!"));
    });
  });
  after(() => {
    AWSMock.restore("DynamoDB.DocumentClient");
  });

  it("return 404 for trying to get an event with unknown id", async () => {
    const unknownId = "nonExistingEvent";
    const validYear = existingEvents[0].year;
    const response = await wrapped.run({
      pathParameters: {
        id: unknownId,
        year:validYear
      }
    });
    expect(response.statusCode).to.be.equal(404);
  });

  it("return 404 for trying to get an event with unknown year", async () => {
    const validId = existingEvents[0].id;
    const unknownYear = 12345;
    const response = await wrapped.run({
      pathParameters: {
        id: validId,
        year:unknownYear
      }
    });
    expect(response.statusCode).to.be.equal(404);
  });

  it("return 200 for successfully getting an event", async () => {
    const validId = existingEvents[0].id;
    const validYear = existingEvents[0].year;

    const response = await wrapped.run({
      pathParameters: {
        id: validId,
        year:validYear
      }
    });
    expect(response.statusCode).to.be.equal(200);
  });

  it("return 406 for trying to get an event with both count and users", async () => {
    const validId = existingEvents[0].id;
    const validYear = existingEvents[0].year;

    const response = await wrapped.run({
      queryStringParameters: {
        count: "true",
        users: "true"
      },
      pathParameters: {
        id: validId,
        year: validYear
      }
    });
    expect(response.statusCode).to.be.equal(406);
  });

  it("return 200 for successfully getting an event with count", async () => {
    const validId = existingEvents[0].id;
    const validYear = existingEvents[0].year;

    const response = await wrapped.run({
      queryStringParameters: {
        count: "true"
      },
      pathParameters: {
        id: validId,
        year: validYear
      }
    });
    expect(response.statusCode).to.be.equal(200);

    const body = JSON.parse(response.body);
    expect(body).to.have.property("registeredCount", 2);
    expect(body).to.have.property("checkedInCount", 3);
    expect(body).to.have.property("waitlistCount", 1);
  });

  it("return 200 for successfully getting an event with users", async () => {
    const validId = existingEvents[0].id;
    const validYear = existingEvents[0].year;

    const response = await wrapped.run({
      queryStringParameters: {
        users: "true"
      },
      pathParameters: {
        id: validId,
        year: validYear
      }
    });
    expect(response.statusCode).to.be.equal(200);

    const body = JSON.parse(response.body);
    expect(body).to.have.length(3);
    expect(body[0]).to.have.property("id", 1);
    expect(body[0]).to.have.property("registrationStatus", "registered");
  });
});
