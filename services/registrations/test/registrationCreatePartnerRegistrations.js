"use strict";

// tests for registrationCreatePartnerRegistrations

import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
import {
  mockClient
} from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import {
  SNSClient,
  PublishCommand
} from "@aws-sdk/client-sns";
import {
  EVENTS_TABLE,
  USER_REGISTRATIONS_TABLE
} from "../../../constants/tables";

let wrapped = mochaPlugin.getWrapper(
  "registrationPartnerBatch",
  "/handler.js",
  "createPartnerRegistrations"
);

const adminEmail = "admin@ubcbiztech.com";
const ddbMock = mockClient(DynamoDBDocumentClient);
const snsMock = mockClient(SNSClient);

const buildEvent = ({ email, body }) => ({
  requestContext: {
    authorizer: {
      claims: {
        email
      }
    }
  },
  body: JSON.stringify(body)
});

describe("registrationCreatePartnerRegistrations", () => {
  beforeEach(() => {
    ddbMock.reset();
    snsMock.reset();
  });

  afterEach(() => {
    ddbMock.restore();
    snsMock.restore();
  });

  it("returns 403 when caller is not a BizTech admin", async () => {
    const response = await wrapped.run(
      buildEvent({
        email: "student@gmail.com",
        body: {
          eventID: "kickstart",
          year: 2025,
          partners: []
        }
      })
    );

    expect(response.statusCode).to.equal(403);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.message).to.equal("unauthorized");
  });

  it("returns 406 when eventID is not a string", async () => {
    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {
          year: 2025,
          partners: []
        }
      })
    );

    expect(response.statusCode).to.equal(406);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.message).to.equal("eventID must be a string");
  });

  it("returns 406 when year is not a number", async () => {
    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {
          eventID: "kickstart",
          partners: []
        }
      })
    );

    expect(response.statusCode).to.equal(406);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.message).to.equal("year must be a number");
  });

  it("returns 406 when partners is not an array", async () => {
    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {
          eventID: "kickstart",
          year: 2025
        }
      })
    );

    expect(response.statusCode).to.equal(406);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.message).to.equal("partners must be an array");
  });

  it("marks invalid partner rows as failed", async () => {
    ddbMock.on(GetCommand).callsFake((params) => {
      if (
        params.TableName.includes(EVENTS_TABLE) &&
        params.Key.id === "kickstart" &&
        params.Key.year === 2025
      ) {
        return {
          Item: {
            id: "kickstart",
            year: 2025
          }
        };
      }

      return {
        Item: null
      };
    });

    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {
          eventID: "kickstart",
          year: 2025,
          partners: [
            {
              email: "not-an-email",
              firstName: "Grace",
              lastName: "Hopper"
            }
          ]
        }
      })
    );

    expect(response.statusCode).to.equal(200);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.eventID).to.equal("kickstart");
    expect(responseBody.year).to.equal(2025);
    expect(responseBody.created).to.equal(0);
    expect(responseBody.skipped).to.equal(0);
    expect(responseBody.failed).to.equal(1);
    expect(responseBody.results[0].email).to.equal("not-an-email");
    expect(responseBody.results[0].status).to.equal("failed");
    expect(responseBody.results[0].reason).to.equal("Invalid email");
  });

  it("returns 404 when the selected event does not exist", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: null
    });

    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {
          eventID: "missing-event",
          year: 2025,
          partners: []
        }
      })
    );

    expect(response.statusCode).to.equal(404);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.message).to.equal(
      "Event with id 'missing-event' and year '2025' could not be found."
    );
  });

  it("skips partner rows when registration already exists", async () => {
    const partnerEmail = "partner@example.com";

    ddbMock.on(GetCommand).callsFake((params) => {
      if (
        params.TableName.includes(EVENTS_TABLE) &&
        params.Key.id === "kickstart" &&
        params.Key.year === 2025
      ) {
        return {
          Item: {
            id: "kickstart",
            year: 2025
          }
        };
      }

      if (
        params.TableName.includes(USER_REGISTRATIONS_TABLE) &&
        params.Key.id === partnerEmail &&
        params.Key["eventID;year"] === "kickstart;2025"
      ) {
        return {
          Item: {
            id: partnerEmail,
            "eventID;year": "kickstart;2025"
          }
        };
      }

      return {
        Item: null
      };
    });

    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {
          eventID: "kickstart",
          year: 2025,
          partners: [
            {
              email: partnerEmail,
              firstName: "Grace",
              lastName: "Hopper"
            }
          ]
        }
      })
    );

    expect(response.statusCode).to.equal(200);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.created).to.equal(0);
    expect(responseBody.skipped).to.equal(1);
    expect(responseBody.failed).to.equal(0);
    expect(responseBody.results[0].email).to.equal(partnerEmail);
    expect(responseBody.results[0].status).to.equal("skipped");
    expect(responseBody.results[0].reason).to.equal(
      "registration already exists"
    );
  });

  it("creates a partner registration for a valid partner", async () => {
    const partnerEmail = "partner@example.com";
    let updateParams = null;

    ddbMock.on(GetCommand).callsFake((params) => {
      if (
        params.TableName.includes(EVENTS_TABLE) &&
        params.Key.id === "kickstart" &&
        params.Key.year === 2025
      ) {
        return {
          Item: {
            id: "kickstart",
            year: 2025,
            capac: 100
          }
        };
      }

      return {
        Item: null
      };
    });

    ddbMock.on(UpdateCommand).callsFake((params) => {
      updateParams = params;
      return {
        Attributes: {}
      };
    });

    snsMock.on(PublishCommand).resolves({});

    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {
          eventID: "kickstart",
          year: 2025,
          partners: [
            {
              email: partnerEmail,
              firstName: "Katherine",
              lastName: "Johnson"
            }
          ]
        }
      })
    );

    expect(response.statusCode).to.equal(200);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.created).to.equal(1);
    expect(responseBody.skipped).to.equal(0);
    expect(responseBody.failed).to.equal(0);
    expect(responseBody.results[0].email).to.equal(partnerEmail);
    expect(responseBody.results[0].status).to.equal("created");

    expect(updateParams.Key.id).to.equal(partnerEmail);
    expect(updateParams.Key["eventID;year"]).to.equal("kickstart;2025");
    expect(updateParams.ConditionExpression).to.equal(
      "attribute_not_exists(id) and attribute_not_exists(#eventIDYear)"
    );
    expect(updateParams.ExpressionAttributeValues[":fname"]).to.equal(
      "Katherine"
    );
    expect(updateParams.ExpressionAttributeValues[":registrationStatus"]).to.equal(
      "acceptedComplete"
    );
    expect(updateParams.ExpressionAttributeValues[":isPartner"]).to.equal(true);
  });

  it("marks partner rows as failed when registration creation fails", async () => {
    const partnerEmail = "partner@example.com";

    ddbMock.on(GetCommand).callsFake((params) => {
      if (
        params.TableName.includes(EVENTS_TABLE) &&
        params.Key.id === "kickstart" &&
        params.Key.year === 2025
      ) {
        return {
          Item: {
            id: "kickstart",
            year: 2025,
            capac: 100
          }
        };
      }

      return {
        Item: null
      };
    });

    ddbMock.on(UpdateCommand).rejects({
      statusCode: 500,
      message: "Write failed"
    });

    snsMock.on(PublishCommand).resolves({});

    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {
          eventID: "kickstart",
          year: 2025,
          partners: [
            {
              email: partnerEmail,
              firstName: "Dorothy",
              lastName: "Vaughan"
            }
          ]
        }
      })
    );

    expect(response.statusCode).to.equal(200);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.created).to.equal(0);
    expect(responseBody.skipped).to.equal(0);
    expect(responseBody.failed).to.equal(1);
    expect(responseBody.results[0].email).to.equal(partnerEmail);
    expect(responseBody.results[0].status).to.equal("failed");
    expect(responseBody.results[0].reason).to.not.be.empty;
  });
});
