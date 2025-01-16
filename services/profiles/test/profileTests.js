"use strict";

const mochaPlugin = require("serverless-mocha-plugin");
const expect = mochaPlugin.chai.expect;
const {
  mockClient
} = require("aws-sdk-client-mock");
const {
  DynamoDBDocumentClient, GetCommand, PutCommand
} = require("@aws-sdk/lib-dynamodb");
const sinon = require("sinon");

const ddbMock = mockClient(DynamoDBDocumentClient);

const handler = require("../handler");
const wrappedCreate = mochaPlugin.getWrapper("createProfile", "/handler", "createProfile");
const wrappedGet = mochaPlugin.getWrapper("getProfile", "/handler", "getProfile");

// Test data
const testEmail = "test@ubcbiztech.com";
const testEventId = "blueprint";
const testYear = 2025;

const mockRegistration = {
  id: testEmail,
  "eventID;year": `${testEventId};${testYear}`,
  basicInformation: {
    fname: "Test",
    lname: "User",
    gender: ["They/Them"],
    major: "Computer Science",
    year: "3rd Year"
  },
  dynamicResponses: {
    "130fac25-e5d7-4fd1-8fd8-d844bfdaef06": "Reading",
    "52a3e21c-e65f-4248-a38d-db93e410fe2c": "Gaming",
    "3d130254-8f1c-456e-a325-109717ad2bd4": "Elon Musk",
    "f535e62d-96ee-4377-a8ac-c7b523d04583": "Smartphone",
    "ffcb7fcf-6a24-46a3-bfca-e3dc96b6309f": "https://linkedin.com/test",
    "1fb1696d-9d90-4e02-9612-3eb9933e6c45": "https://photo.url/test",
    "e164e119-6d47-453b-b215-91837b70e9b7": "https://portfolio.test"
  }
};

const mockProfile = {
  id: testEmail,
  "eventID;year": `${testEventId};${testYear}`,
  fname: "Test",
  lname: "User",
  pronouns: "They/Them",
  type: "Attendee",
  major: "Computer Science",
  year: "3rd Year",
  hobby1: "Reading",
  hobby2: "Gaming",
  funQuestion1: "Elon Musk",
  funQuestion2: "Smartphone",
  linkedIn: "https://linkedin.com/test",
  profilePictureURL: "https://photo.url/test",
  additionalLink: "https://portfolio.test"
};

describe("Profiles Service", () => {
  beforeEach(() => {
    try {
      ddbMock.reset();
      sinon.restore();

      // Mock DynamoDB GetCommand
      ddbMock.on(GetCommand).callsFake((params) => {
        if (params.TableName.includes("biztechRegistrations")) {
          if (params.Key.id === testEmail && params.Key["eventID;year"] === `${testEventId};${testYear}`) {
            return {
              Item: mockRegistration
            };
          }
          return {
            Item: undefined
          };
        } else if (params.TableName.includes("biztechProfiles")) {
          if (params.Key.email === testEmail && params.Key["eventID;year"] === `${testEventId};${testYear}`) {
            return {
              Item: mockProfile
            };
          }
          return {
            Item: undefined
          };
        }
        return {
          Item: undefined
        };
      });

      // Mock DynamoDB PutCommand
      ddbMock.on(PutCommand).callsFake((params) => {
        if (params.TableName.includes("biztechProfiles")) {
          return {
            Item: params.Item
          };
        }
        return {
        };
      });

      // Stub db module functions
      sinon.stub(require("../../../lib/db"), "getOne").callsFake(async (id, table, sortKey) => {
        const params = {
          TableName: table,
          Key: {
            ...(table.includes("biztechRegistrations") ? {
              id
            } : {
              email: id
            }),
            ...sortKey
          }
        };
        const result = await ddbMock.send(new GetCommand(params));
        return result.Item;
      });

      sinon.stub(require("../../../lib/db"), "create").callsFake(async (item, table) => {
        const params = {
          TableName: table,
          Item: item
        };
        return await ddbMock.send(new PutCommand(params));
      });
    } catch (error) {
      console.error("Error setting up mocks:", error);
      throw error;
    }
  });

  afterEach(() => {
    ddbMock.restore();
    sinon.restore();
  });

  describe("createProfile", () => {
    it("should return 406 when required fields are missing", async () => {
      const response = await wrappedCreate.run({
        body: JSON.stringify({
          email: testEmail,
          // missing eventID and year
        })
      });

      expect(response.statusCode).to.equal(406);
      const body = JSON.parse(response.body);
      expect(body.message).to.include("missing");
    });

    it("should return 404 when registration does not exist", async () => {
      const response = await wrappedCreate.run({
        body: JSON.stringify({
          email: "nonexistent@test.com",
          eventID: testEventId,
          year: testYear
        })
      });

      expect(response.statusCode).to.equal(404);
      const body = JSON.parse(response.body);
      expect(body.message).to.include("not found");
    });

    it("should return 403 when profile already exists", async () => {
      // First create the profile
      await wrappedCreate.run({
        body: JSON.stringify({
          email: testEmail,
          eventID: testEventId,
          year: testYear
        })
      });

      // Try to create it again
      const response = await wrappedCreate.run({
        body: JSON.stringify({
          email: testEmail,
          eventID: testEventId,
          year: testYear
        })
      });

      expect(response.statusCode).to.equal(403);
      const body = JSON.parse(response.body);
      expect(body.message).to.include("duplicate");
    });

    it("should successfully create a profile from registration", async () => {
      const response = await wrappedCreate.run({
        body: JSON.stringify({
          email: testEmail,
          eventID: testEventId,
          year: testYear
        })
      });

      expect(response.statusCode).to.equal(201);
      const body = JSON.parse(response.body);
      expect(body.profile).to.include({
        email: testEmail,
        "eventID;year": `${testEventId};${testYear}`,
        fname: mockRegistration.basicInformation.fname,
        lname: mockRegistration.basicInformation.lname,
        pronouns: mockRegistration.basicInformation.gender[0],
        type: "Attendee"
      });
    });
  });

  describe("getProfile", () => {
    it("should return 404 when profile does not exist", async () => {
      const response = await wrappedGet.run({
        pathParameters: {
          email: "nonexistent@test.com",
          eventID: testEventId,
          year: testYear
        }
      });

      expect(response.statusCode).to.equal(404);
      const body = JSON.parse(response.body);
      expect(body.message).to.include("not found");
    });

    it("should return 406 when path parameters are missing", async () => {
      const response = await wrappedGet.run({
        pathParameters: {
          email: testEmail
          // missing eventID and year
        }
      });

      expect(response.statusCode).to.equal(406);
      const body = JSON.parse(response.body);
      expect(body.message).to.include("missing");
    });

    it("should successfully retrieve an existing profile", async () => {
      // First create the profile
      await wrappedCreate.run({
        body: JSON.stringify({
          email: testEmail,
          eventID: testEventId,
          year: testYear
        })
      });

      // Then retrieve it
      const response = await wrappedGet.run({
        pathParameters: {
          email: testEmail,
          eventID: testEventId,
          year: testYear
        }
      });

      expect(response.statusCode).to.equal(200);
      const body = JSON.parse(response.body);
      expect(body).to.deep.include(mockProfile);
    });
  });
});
