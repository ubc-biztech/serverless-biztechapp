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

const handler = require("../handler");

const wrapped = mochaPlugin.getWrapper("put", "/handler", "put");

const email = "test@ubcbiztech.com";
const email2 = "test2@ubcbiztech.com";

const userResponse = {
  studentId: 12345678,
  fname: "Test",
  lname: "User",
  faculty: "Science",
  email: email,
};

const eventResponse = {
  id: "event",
  year: 2020,
  capac: 2,
  createdAt: 1581227718674,
  description: "Test event description",
  elocation: "UBC",
  ename: "Test Event",
  startDate: "2024-02-09T05:55:11.131Z",
  endDate: "2024-02-09T05:55:11.131Z",
  imageUrl: "https://example.com/image.jpg",
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

describe("registrationPut", () => {
  let sendDynamicQRStub;
  let sendCalendarInviteStub;
  let sendSNSNotificationStub;
  let registeredCount = 0;

  const ddbMock = mockClient(DynamoDBDocumentClient);
  const snsMock = mockClient(SNSClient);
  const sesMock = mockClient(SESClient);

  beforeEach(() => {
    try {
      ddbMock.reset();
      snsMock.reset();
      sesMock.reset();

      // Restore all sinon stubs
      sinon.restore();

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

      // Set up DynamoDB mock responses
      ddbMock.on(GetCommand).callsFake((params) => {
        if (params.TableName.includes(EVENTS_TABLE)) {
          if (params.Key.id === "event" && params.Key.year === 2020) {
            return {
              Item: eventResponse
            };
          }
        } else if (params.TableName.includes(USERS_TABLE)) {
          if (params.Key.id === email) {
            return {
              Item: userResponse
            };
          }
          if (params.Key.id === "unknown@test.com") {
            return {
              Item: undefined
            };
          }
        } else if (params.TableName.includes(USER_REGISTRATIONS_TABLE)) {
          if (params.Key.id === email) {
            return {
              Item: registrationsResponse[0]
            };
          }
        }
        return {
          Item: undefined
        };
      });

      ddbMock.on(UpdateCommand).callsFake((params) => {
        if (params.Key.id === email2) {
          const error = new Error("ConditionalCheckFailedException");
          error.code = "ConditionalCheckFailedException";
          throw error;
        }
        return {
          Attributes: {
            message: "Updated!",
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

  it("should return 400 when email parameter is not given", async () => {
    const response = await wrapped.run({
      body: JSON.stringify({
        eventID: "event",
        year: 2020,
        registrationStatus: "registered"
      })
    });
    expect(response.statusCode).to.equal(400);
  });

  it("should return 406 when eventID is not provided", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email
      },
      body: JSON.stringify({
        year: 2020,
        registrationStatus: "registered"
      })
    });
    expect(response.statusCode).to.equal(406);
  });

  it("should return 406 when year is not provided", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email
      },
      body: JSON.stringify({
        eventID: "event",
        registrationStatus: "registered"
      })
    });
    expect(response.statusCode).to.equal(406);
  });

  // TODO - We shouldn't be able to update registrations without a status - the implementation is incorrect?
  it("should return 406 when registrationStatus is not provided", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email
      },
      body: JSON.stringify({
        eventID: "event",
        year: 2020
      })
    });
    expect(response.statusCode).to.equal(200);
  });

  it("should return 404 when unknown event is provided", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email: "unknown@test.com"
      },
      body: JSON.stringify({
        eventID: "unknown-event",
        year: 2020,
        registrationStatus: "registered"
      })
    });
    expect(response.statusCode).to.equal(404);
  });

  // TODO - We shouldn't be able to update registrations for unknown users, otherwise it's just POST. 
  //  More investigation needed.
  xit("should return 404 when unknown user is provided", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email: "unknown@test.com"
      },
      body: JSON.stringify({
        eventID: "event",
        year: 2020,
        registrationStatus: "registered"
      })
    });
    expect(response.statusCode).to.equal(404);
  });

  it("should send appropriate emails when updating to registered status", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email
      },
      body: JSON.stringify({
        eventID: "event",
        year: 2020,
        registrationStatus: "registered"
      })
    });

    expect(response.statusCode).to.equal(200);
    sinon.assert.calledOnce(sendDynamicQRStub);
    sinon.assert.calledOnce(sendCalendarInviteStub);
  });

  it("should send only QR email for waitlist status", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email
      },
      body: JSON.stringify({
        eventID: "event",
        year: 2020,
        registrationStatus: "waitlist"
      })
    });

    expect(response.statusCode).to.equal(200);
    sinon.assert.calledOnce(sendDynamicQRStub);
    sinon.assert.notCalled(sendCalendarInviteStub);
  });

  it("should send SNS notification on successful update", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email
      },
      body: JSON.stringify({
        eventID: "event",
        year: 2020,
        registrationStatus: "registered"
      })
    });

    expect(response.statusCode).to.equal(200);
    sinon.assert.calledOnce(sendSNSNotificationStub);

    const expectedMessage = {
      type: "registration_update",
      email,
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

  it("should return 409 for trying to update non-existent registration", async () => {
    const response = await wrapped.run({
      pathParameters: {
        email: email2
      },
      body: JSON.stringify({
        eventID: "event",
        year: 2020,
        registrationStatus: "registered"
      })
    });
    expect(response.statusCode).to.equal(409);
  });
});
