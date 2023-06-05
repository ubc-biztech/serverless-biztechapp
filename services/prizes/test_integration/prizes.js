"use strict";
import chai from "chai";
const expect = chai.expect;

import helpers from "../../../lib/testHelpers";
import {
  INTEGRATION_TEST_PRIZE_ID,
  INTEGRATION_TEST_NON_EXISTANT_PRIZE_ID
} from "../../../constants/test";

const SERVICE = "prizes";

describe("prizes integration", function () {
  this.timeout(10000);

  describe("prizes/ GET tests", function () {
    it("prizes GET returns 200 on success", async () => {
      return helpers.invokeLambda(SERVICE, "prizeGetAll", "")
        .then(([statusCode]) => {
          expect(statusCode).to.equal(200);
        });
    });
  });

  describe("prizes/ POST tests", function () {
    let prizePayload = {
      body: JSON.stringify({
        id: INTEGRATION_TEST_PRIZE_ID,
        name: "integration post",
        price: 200000,
        links: {
          sponsor: "hello"
        }
      })
    };

    it("prizes POST returns 201 on success", async () => {
      await helpers.invokeLambda(SERVICE, "prizeCreate", JSON.stringify(prizePayload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(201);
        });
    });

    it("prizes POST returns 409 when prize id already exists", async () => {
      return helpers.invokeLambda(SERVICE, "prizeCreate", JSON.stringify(prizePayload))
        .then(([statusCode, body]) => {
          expect(statusCode).to.equal(409);
          expect(body.message).to.equal("A database entry with the same 'id' already exists!");
        });
    });
  });

  describe("prizes/{id} PATCH tests", function () {
    const prizePayload = {
      name: "Updated Prize",
      price: 1000
    };

    it("prize PATCH returns 404 when event not found", async () => {
      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_NON_EXISTANT_PRIZE_ID
        },
        body: JSON.stringify(prizePayload)
      };

      return helpers.invokeLambda(SERVICE, "prizeUpdate", JSON.stringify(payload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(404);
        });
    });

    it("prize PATCH returns 200 on update success", async () => {
      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_PRIZE_ID
        },
        body: JSON.stringify(prizePayload)
      };
      await helpers.invokeLambda(SERVICE, "prizeUpdate", JSON.stringify(payload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(200);
        });
    });
  });

  describe("prizes/{id} DELETE tests", function () {
    it("prizes DELETE returns 404 when event not found", async () => {
      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_NON_EXISTANT_PRIZE_ID
        }
      };

      return helpers.invokeLambda(SERVICE, "prizeDelete", JSON.stringify(payload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(404);
        });
    });

    it("prizes DELETE returns 200 on update success", async () => {
      let payload = {
        pathParameters: {
          id: INTEGRATION_TEST_PRIZE_ID
        }
      };
      await helpers.invokeLambda(SERVICE, "prizeDelete", JSON.stringify(payload))
        .then(([statusCode]) => {
          expect(statusCode).to.equal(200);
        });
    });
  });
});
