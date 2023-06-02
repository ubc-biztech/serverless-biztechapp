"use strict";
import chai from "chai";
const expect = chai.expect;
import {
  INTEGRATION_TEST_USER_EMAIL, INTEGRATION_TEST_PERSISTENT_EVENT_ID, INTEGRATION_TEST_PERSISTENT_YEAR
} from "../../../constants/test";

import helpers from "../../../lib/testHelpers";

const SERVICE = "users";

describe("user integration", function () {
  this.timeout(15000);

  const defaultPayload = {
    pathParameters: {
      email: INTEGRATION_TEST_USER_EMAIL,
    }
  };

  describe("user/{email} GET setup", function () {
    it("user GET doesn't exist returns 404", async () => {
      return helpers.invokeLambda(SERVICE, "userGet", JSON.stringify(defaultPayload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(404);
        });
    });
  });

  const userCreatePayload = {
    body: JSON.stringify({
      email: INTEGRATION_TEST_USER_EMAIL,
      studentId: 44403060,
      fname: "TESTUSER",
      lname: "DONOTMODIFY",
      faculty: "science",
      major: "biology",
      userYear: 1,
      gender: "Male",
      diet: "vegan",
      favedEventsArray: ["someEvent;2020", "bluePrint;2020"],
    })
  };

  describe("user/ POST", function () {
    it("user POST returns 201", async () => {
      return helpers.invokeLambda(SERVICE, "userCreate", JSON.stringify(userCreatePayload))
        .then(([statusCode, body]) => {
          expect(statusCode).to.equal(201);
          expect(body.message).to.equal("Created!");
        });
    });

    it("user POST already exists returns 409", async () => {
      return helpers.invokeLambda(SERVICE, "userCreate", JSON.stringify(userCreatePayload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(409);
        });
    });
  });

  const userPatchBody = {
    fname: "STILLTESTUSER",
    lname: "DONOTMODIFYSTILL",
    userYear: 3,
    faculty: "arts",
    major: "history",
    gender: "Female",
    diet: "none"
  };

  const userPatchPayload = {
    pathParameters: {
      email: INTEGRATION_TEST_USER_EMAIL,
    },
    body: JSON.stringify(userPatchBody)
  };

  describe("user/{email} PATCH", function () {
    it("user PATCH on user that exists returns 200", async() => {
      return helpers.invokeLambda(SERVICE, "userUpdate", JSON.stringify(userPatchPayload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(200);
        });
    });

    it("user favouriteEvent PATCH returns 200", async () => {
      const payload = {
        pathParameters: {
          email: INTEGRATION_TEST_USER_EMAIL,
        },
        body: JSON.stringify({
          isFavourite: true,
          eventID: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
          year: INTEGRATION_TEST_PERSISTENT_YEAR
        }),
      };

      return helpers.invokeLambda(SERVICE, "userFavouriteEvent", JSON.stringify(payload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(200);
        });
    });

    it("user favouriteEvent PATCH returns 200 for an already favourited event", async () => {
      const payload = {
        pathParameters: {
          email: INTEGRATION_TEST_USER_EMAIL,
        },
        body: JSON.stringify({
          isFavourite: true,
          eventID: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
          year: INTEGRATION_TEST_PERSISTENT_YEAR
        }),
      };

      return helpers.invokeLambda(SERVICE, "userFavouriteEvent", JSON.stringify(payload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(200);
        });
    });

    it("user unfavouriteEvent PATCH returns 200", async () => {
      const payload = {
        pathParameters: {
          email: INTEGRATION_TEST_USER_EMAIL,
        },
        body: JSON.stringify({
          isFavourite: false,
          eventID: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
          year: INTEGRATION_TEST_PERSISTENT_YEAR
        }),
      };

      return helpers.invokeLambda(SERVICE, "userFavouriteEvent", JSON.stringify(payload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(200);
        });
    });

    it("user unfavouriteEvent PATCH returns 200 for an already unfavourited event", async () => {
      const payload = {
        pathParameters: {
          email: INTEGRATION_TEST_USER_EMAIL,
        },
        body: JSON.stringify({
          isFavourite: false,
          eventID: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
          year: INTEGRATION_TEST_PERSISTENT_YEAR
        }),
      };

      return helpers.invokeLambda(SERVICE, "userFavouriteEvent", JSON.stringify(payload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(200);
        });
    });

    it("user GET exists returns 200 and check PATCH success", async () => {
      return helpers.invokeLambda(SERVICE, "userGet", JSON.stringify(defaultPayload))
        .then(([statusCode, body]) => {
          expect(statusCode).to.equal(200);
          // check that update succeeded
          expect(body.fname).to.equal(userPatchBody.fname);
          expect(body.year).to.equal(userPatchBody.year);
          expect(body.gender).to.equal(userPatchBody.gender);
          expect(body.faculty).to.equal(userPatchBody.faculty);
          expect(body.major).to.equal(userPatchBody.major);
          expect(body["favedEventsID;year"]).to.contain("bluePrint;2020");
          expect(body["favedEventsID;year"]).to.contain("someEvent;2020");
        });
    });
  });

  describe("user/{email} DELETE and wrapup", function () {
    it("user DELETE returns 200", async () => {
      return helpers.invokeLambda(SERVICE, "userDelete", JSON.stringify(defaultPayload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(200);
        });
    });

    it("user GET returns 404 to check DELETE worked", async () => {
      return helpers.invokeLambda(SERVICE, "userGet", JSON.stringify(defaultPayload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(404);
        });
    });

    it("user PATCH on user that does not exist returns 404", async () => {
      return helpers.invokeLambda(SERVICE, "userGet", JSON.stringify(userPatchPayload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(404);
        });
    });
  });
});
