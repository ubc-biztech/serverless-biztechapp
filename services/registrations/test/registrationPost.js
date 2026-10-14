"use strict";

const mochaPlugin = require("serverless-mocha-plugin");
const expect = mochaPlugin.chai.expect;
const {
  mockClient
} = require("aws-sdk-client-mock");
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  SNSClient, PublishCommand
} = require("@aws-sdk/client-sns");
const {
  SESClient
} = require("@aws-sdk/client-ses");
const {
  EVENTS_TABLE,
  USERS_TABLE,
  USER_REGISTRATIONS_TABLE,
} = require("../../../constants/tables");
const sinon = require("sinon");
const nodemailer = require("nodemailer");

const SESEmailService = require("../EmailService/SESEmailService").default;

const {
  sendSNSNotification
} = require("../../../lib/snsHelper");

const registrationHelpers = require("../helpers").default;

const ddbMock = mockClient(DynamoDBDocumentClient);
const snsMock = mockClient(SNSClient);
const sesMock = mockClient(SESClient);

const handler = require("../handler");

const wrapped = mochaPlugin.getWrapper("post", "/handler", "post");

const email = "victorv@ubcbiztech.com";
const email2 = "victorv+2@ubcbiztech.com";
const email3 = "victorv+3@ubcbiztech.com";
const email4 = "victorv+4@ubcbiztech.com";
const userResponse = {
  studentId: 12200034,
  fname: "user",
  lname: "man",
  faculty: "Science",
  email: email,
};

const eventResponse = {
  id: "event",
  year: 2020,
  capac: 2,
  createdAt: 1581227718674,
  description: "I am a description",
  elocation: "UBC",
  ename: "Existing Event",
  startDate: "2020-02-09T05:55:11.131Z",
  endDate: "2020-02-09T05:55:11.131Z",
  imageUrl: "https://i.picsum.photos/id/236/700/400.jpg",
  updatedAt: 1581227718674,
};

const registrationsResponse = [
  {
    email: email,
    eventID: "event",
    year: 2020,
    updatedAt: 1600669844493,
    registrationStatus: "registered",
  },
  {
    email: email2,
    eventID: "event",
    year: 2020,
    updatedAt: 1600669844493,
    registrationStatus: "registered",
  },
];

describe("registrationPost", () => {
  let sendDynamicQRStub;
  let sendCalendarInviteStub;
  let sendSNSNotificationStub;
  let registeredCount = 0;

  beforeEach(() => {
    try {
      ddbMock.reset();
      snsMock.reset();
      sesMock.reset();

      // Restore all sinon stubs
      sinon.restore();

      // Initialize `registrationsResponse` with empty array for each test
      registrationsResponse.length = 0;

      // Stub nodemailer to avoid real SES calls
      sinon.stub(nodemailer, "createTransport").returns({
        sendMail: sinon.stub().resolves({
          messageId: "mock-email-id",
        }),
      });

      // Stub SESEmailService methods
      sendDynamicQRStub = sinon
        .stub(SESEmailService.prototype, "sendDynamicQR")
        .resolves("mocked-sendDynamicQR-response");
      sendCalendarInviteStub = sinon
        .stub(SESEmailService.prototype, "sendCalendarInvite")
        .resolves("mocked-sendCalendarInvite-response");

      sendSNSNotificationStub = sinon
        .stub(require("../../../lib/snsHelper"), "sendSNSNotification")
        .resolves("mocked-sendSNSNotification-response");

      // Set up fresh DynamoDB responses
      ddbMock.on(GetCommand).callsFake((params) => {
        if (params.TableName.includes(EVENTS_TABLE)) {
          if (params.Key.id === "event" && params.Key.year === 2020) {
            return {
              Item: eventResponse
            };
          } else if (
            params.Key.id === "unknownEvent" &&
            params.Key.year === 2020
          ) {
            return {
              Item: undefined
            };
          }
        } else if (params.TableName.includes(USERS_TABLE)) {
          if (params.Key.id === email) {
            return {
              Item: userResponse
            };
          } else if (params.Key.id === email2) {
            return {
              Item: {
                ...userResponse,
                email: email2
              }
            };
          } else if (params.Key.id === "asdf@gmail.com") {
            return {
              Item: undefined
            };
          }
        } else if (params.TableName.includes(USER_REGISTRATIONS_TABLE)) {
          if (params.Key.id === email2) {
            return {
              Item: registrationsResponse[1]
            };
          }
        }
        return {
          Item: undefined
        };
      });

      ddbMock.on(ScanCommand).callsFake((params) => {
        if (params.TableName.includes(USER_REGISTRATIONS_TABLE)) {
          return {
            Items: registrationsResponse
          };
        }
        return {
          Items: []
        };
      });

      ddbMock.on(UpdateCommand).callsFake((params) => {
        if (
          params.Key.id === email2 &&
          params.Key["eventID;year"] === "event;2020"
        ) {
          const error = new Error("ConditionalCheckFailedException");
          error.code = "ConditionalCheckFailedException";
          throw error;
        }
        return {
          Attributes: {
            message: "Created!",
          },
        };
      });

      snsMock.on(PublishCommand).resolves({
        MessageId: "mock-sns-id",
        $metadata: {
          httpStatusCode: 200,
        },
      });

      sinon.stub(registrationHelpers, "getEventCounts").callsFake(async () => {
        return {
          registeredCount: registeredCount,
          checkedInCount: 0,
          waitlistCount: 0,
          dynamicCounts: []
        };
      });

      // Reset the counter for each test
      registeredCount = 0;
    } catch (error) {
      console.error("Error setting up mocks:", error);
      throw error;
    }
  });

  afterEach(() => {
    ddbMock.restore();
    snsMock.restore();
    sesMock.restore();
    sinon.restore();
    registeredCount = 0;
  });

  it("should return 406 when email is not given", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        eventID: "event",
        year: 2020,
        registrationStatus: "registered",
      }),
    });
    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(406);
    expect(body.message).to.include("Invalid email");
  });

  it("should return 406 when no eventID is provided", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        year: 2020,
        registrationStatus: "registered",
      }),
    });
    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(406);
    expect(body.message).to.include("eventID");
  });

  it("should return 406 when year is not provided", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        registrationStatus: "registered",
        eventID: "event",
      }),
    });
    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(406);
    expect(body.message).to.include("year");
  });

  it("should return 406 when no registrationStatus is provided", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        eventID: "event",
        year: 2020,
      }),
    });
    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(406);
    expect(body.message).to.include("registrationStatus");
  });

  it("should return 404 when unknown event id is provided", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        eventID: "unknownEvent",
        year: 2020,
        registrationStatus: "registered",
      }),
    });
    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(404);
    expect(body.message).to.include(
      "Event with id 'unknownEvent' and year '2020' could not be found."
    );
  });

  // TODO - not clear what "unknown user email" is. Test disabled for now.
  xit("should return 404 when unknown user email is provided", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: "asdf@gmail.com",
        eventID: "event",
        year: 2020,
        registrationStatus: "registered",
      }),
    });
    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(404);
    expect(body.message).to.include("User not found");
  });

  it("should return 201 for successful creation of registration as waitlist", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        eventID: "event",
        year: 2020,
        registrationStatus: "waitlist",
      }),
    });

    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(201);
    expect(body.registrationStatus).to.equal("waitlist");

    // Verify that sendDynamicQR was called once, sendCalendarInvite should not be called for waitlist
    sinon.assert.calledOnce(sendDynamicQRStub);
    sinon.assert.notCalled(sendCalendarInviteStub);
  });

  it("should return 201 for successful creation of registration with maximum capacity, with waitlisting", async () => {
    let response = await wrapped.run({
      body: JSON.stringify({
        email: `${email}`,
        eventID: "event",
        year: 2020,
        registrationStatus: "registered",
      }),
    });

    let body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(201);
    expect(body.registrationStatus).to.equal("registered");

    registeredCount++;

    response = await wrapped.run({
      body: JSON.stringify({
        email: `${email3}`,
        eventID: "event",
        year: 2020,
        registrationStatus: "registered",
      }),
    });

    body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(201);
    expect(body.registrationStatus).to.equal("registered");

    registeredCount++;

    // Third registration - should now be placed on "waitlist" due to full capacity
    response = await wrapped.run({
      body: JSON.stringify({
        email: `${email4}`,
        eventID: "event",
        year: 2020,
        registrationStatus: "registered",
      }),
    });

    body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(201);
    expect(body.registrationStatus).to.equal("waitlist");

    // Verify that sendDynamicQR and sendCalendarInvite were called appropriately
    sinon.assert.calledThrice(sendDynamicQRStub);
    sinon.assert.calledTwice(sendCalendarInviteStub); // Only called for "registered" statuses
  });

  it("should return 400 for trying to create duplicate registration entry", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email2,
        eventID: "event",
        year: 2020,
        registrationStatus: "registered",
      }),
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).to.equal(409);
    expect(body.message).to.include("already exists");
  });

  it("should send SNS notification on successful registration", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        eventID: "event",
        year: 2020,
        registrationStatus: "registered",
      }),
    });

    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(201);

    // Verify SNS notification was sent
    sinon.assert.calledOnce(sendSNSNotificationStub);

    // Verify the SNS notification content
    const expectedMessage = {
      type: "registration_update",
      email: email,
      eventID: "event",
      year: 2020,
      registrationStatus: "registered",
      timestamp: sinon.match.string
    };

    sinon.assert.calledWith(
      sendSNSNotificationStub,
      sinon.match(expectedMessage)
    );
  });

  it("should send SNS notification when registration is waitlisted", async () => {
    // Fill up the event capacity first
    registeredCount = eventResponse.capac;

    const response = await wrapped.run({
      body: JSON.stringify({
        email: email,
        eventID: "event",
        year: 2020,
        registrationStatus: "registered", // This should automatically become waitlist
      }),
    });

    const body = JSON.parse(response.body);
    expect(response.statusCode).to.equal(201);
    expect(body.registrationStatus).to.equal("waitlist");

    // Verify SNS notification was sent
    sinon.assert.calledOnce(sendSNSNotificationStub);

    // Verify the SNS notification content
    const expectedMessage = {
      type: "registration_update",
      email: email,
      eventID: "event",
      year: 2020,
      registrationStatus: "waitlist",
      timestamp: sinon.match.string
    };

    sinon.assert.calledWith(
      sendSNSNotificationStub,
      sinon.match(expectedMessage)
    );
  });
});
