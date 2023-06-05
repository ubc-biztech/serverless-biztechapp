"use strict";
import AWSMock from "aws-sdk-mock";

// tests for eventDelete
// Generated by serverless-mocha-plugin

import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper("eventDelete", "/handler.js", "del");
import {
  EVENTS_TABLE
} from "../../../constants/tables";

describe("eventDelete", () => {
  // Stores the id and year of our current created events in a dictionary
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
        if (params.Key.id && params.Key.year && existingEvents.some(key => key.id === params.Key.id && key.year === params.Key.year)) callback(null, {
          Item: {
            id: params.Key.id,
            year: params.Key.year,
            capac: 100
          }
        });

        // Id and year does not exist in our table
        else callback(null, {
          Item: null
        });
      }
    });

    // Mocks the DELETE request to DynamoDB
    AWSMock.mock("DynamoDB.DocumentClient", "delete", (params, callback) => {
      // Check if an entry with the same id and year already exists in our table
      if (params.Key.id && params.Key.year && existingEvents.some(key => key.id === params.Key.id && key.year === params.Key.year)) {
        // Remove this entry from our table
        existingEvents.splice(existingEvents.indexOf({
          id: params.Key.id,
          year: params.Key.year
        }),1);
        callback(null, "successfully deleted item in database");
      }
      else callback(new Error(""));
    });
  });
  after(() => {
    AWSMock.restore("DynamoDB.DocumentClient");
  });

  it("return 400 for trying to delete an event with no year", async () => {
    const validId = existingEvents[0].id;

    const response = await wrapped.run({
      pathParameters: {
        id: validId
      }
    });
    expect(response.statusCode).to.be.equal(400);
  });

  it("return 400 for trying to delete an event with no id", async () => {
    const validYear = existingEvents[0].year;

    const response = await wrapped.run({
      pathParameters: {
        year: validYear
      }
    });
    expect(response.statusCode).to.be.equal(400);
  });

  it("return 404 for trying to delete an event that doesn't exist", async () => {
    const unknownId = "nonExistingEvent";
    const validYear = existingEvents[0].year;
    const response = await wrapped.run({
      pathParameters: {
        id: unknownId,
        year: validYear
      }
    });
    expect(response.statusCode).to.be.equal(404);
  });

  it("return 200 for successfully deleting an event", async () => {
    const validEvent = existingEvents[0];
    const response = await wrapped.run({
      pathParameters: validEvent
    });
    expect(response.statusCode).to.be.equal(200);
  });
});
