"use strict";

// tests for memberCreatePartnerMemberships

import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
import {
  mockClient
} from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";
import {
  MEMBERS2026_TABLE,
  PROFILES_TABLE,
  USERS_TABLE
} from "../../../constants/tables";

let wrapped = mochaPlugin.getWrapper(
  "memberCreatePartnerMemberships",
  "/handler.js",
  "createPartnerMemberships"
);

const adminEmail = "admin@ubcbiztech.com";
const ddbMock = mockClient(DynamoDBDocumentClient);

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

describe("memberCreatePartnerMemberships", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  afterEach(() => {
    ddbMock.restore();
  });

  it("returns 403 when caller is not a BizTech admin", async () => {
    const response = await wrapped.run(
      buildEvent({
        email: "student@gmail.com",
        body: {
          partners: []
        }
      })
    );

    expect(response.statusCode).to.equal(403);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.message).to.equal("unauthorized");
  });

  it("returns 406 when partners is not an array", async () => {
    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {}
      })
    );

    expect(response.statusCode).to.equal(406);
    const responseBody = JSON.parse(response.body);
    expect(responseBody.message).to.equal("partners must be an array");
  });

  it("marks invalid partner rows as failed", async () => {
    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {
          partners: [
            {
              email: "not-an-email",
              firstName: "Ada",
              lastName: "Lovelace"
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
    expect(responseBody.results[0].email).to.equal("not-an-email");
    expect(responseBody.results[0].status).to.equal("failed");
    expect(responseBody.results[0].reason).to.equal("Invalid email");
  });

  it("skips partner rows when membership already exists", async () => {
    const partnerEmail = "partner@example.com";

    ddbMock.on(GetCommand).callsFake((params) => {
      if (
        params.TableName.includes(MEMBERS2026_TABLE) &&
        params.Key.id === partnerEmail
      ) {
        return {
          Item: {
            id: partnerEmail
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
      "membership already exists"
    );
  });

  it("creates user member and profile records for a valid partner", async () => {
    const partnerEmail = "partner@example.com";
    let transactionItems = [];

    ddbMock.on(GetCommand).resolves({
      Item: null
    });

    ddbMock.on(TransactWriteCommand).callsFake((params) => {
      transactionItems = params.TransactItems;
      return {};
    });

    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {
          partners: [
            {
              email: partnerEmail,
              firstName: "Katherine",
              lastName: "Johnson",
              pronouns: "She/Her",
              company: "NASA",
              position: "Mathematician",
              linkedIn: "https://linkedin.com/in/katherine"
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
    expect(responseBody.results[0].profileID).to.not.be.empty;

    expect(transactionItems).to.have.lengthOf(3);

    const userWrite = transactionItems.find((item) =>
      item.Put && item.Put.TableName.includes(USERS_TABLE)
    );
    const memberWrite = transactionItems.find((item) =>
      item.Put && item.Put.TableName.includes(MEMBERS2026_TABLE)
    );
    const profileWrite = transactionItems.find((item) =>
      item.Put && item.Put.TableName.includes(PROFILES_TABLE)
    );

    expect(userWrite.Put.Item.id).to.equal(partnerEmail);
    expect(userWrite.Put.Item.fname).to.equal("Katherine");
    expect(userWrite.Put.Item.lname).to.equal("Johnson");
    expect(userWrite.Put.Item.isMember).to.equal(true);
    expect(userWrite.Put.Item.profileID).to.equal(
      responseBody.results[0].profileID
    );

    expect(memberWrite.Put.Item.id).to.equal(partnerEmail);
    expect(memberWrite.Put.Item.firstName).to.equal("Katherine");
    expect(memberWrite.Put.Item.lastName).to.equal("Johnson");
    expect(memberWrite.Put.Item.cardCount).to.equal(0);

    expect(profileWrite.Put.Item.profileID).to.equal(
      responseBody.results[0].profileID
    );
    expect(profileWrite.Put.Item.fname).to.equal("Katherine");
    expect(profileWrite.Put.Item.lname).to.equal("Johnson");
    expect(profileWrite.Put.Item.company).to.equal("NASA");
    expect(profileWrite.Put.Item.position).to.equal("Mathematician");
  });

  it("marks partner rows as failed when the transaction write fails", async () => {
    const partnerEmail = "partner@example.com";

    ddbMock.on(GetCommand).resolves({
      Item: null
    });

    ddbMock.on(TransactWriteCommand).rejects({
      code: "TransactionCanceledException",
      message: "Transaction cancelled"
    });

    const response = await wrapped.run(
      buildEvent({
        email: adminEmail,
        body: {
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
    expect(responseBody.results[0].reason).to.equal(
      "TransactionCanceledException"
    );
  });
});
