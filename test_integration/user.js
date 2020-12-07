'use strict';
const chai = require('chai');
const expect = chai.expect;
const { INTEGRATION_TEST_USER_ID, INTEGRATION_TEST_PERSISTENT_EVENT_ID, INTEGRATION_TEST_PERSISTENT_YEAR } = require('../constants/test');

const helpers = require('./helpers');

describe('user integration', function () {

  this.timeout(15000);

  const defaultPayload = {
    pathParameters: {
      id: INTEGRATION_TEST_USER_ID,
    }
  };

  describe('user/{id} GET setup', function () {

    it('user GET doesn\'t exist returns 404', async () => {

      return helpers.invokeLambda('userGet', JSON.stringify(defaultPayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(404);

        });

    });

  });

  const userCreatePayload = {
    body: JSON.stringify({
      id: INTEGRATION_TEST_USER_ID,
      fname: 'TESTUSER',
      lname: 'DONOTMODIFY',
      email: 'integration@test.com',
      faculty: 'science',
      userYear: 1,
      gender: 'Male',
      diet: 'vegan',
      favedEventsArray: ['someEvent;2020', 'bluePrint;2020'],
    })
  };

  describe('user/ POST', function () {

    it('user POST returns 201', async () => {

      return helpers.invokeLambda('userCreate', JSON.stringify(userCreatePayload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(201);
          expect(body.message).to.equal('Created!');

        });

    });

    it('user POST already exists returns 409', async () => {

      return helpers.invokeLambda('userCreate', JSON.stringify(userCreatePayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(409);

        });

    });

  });

  const userPatchBody = {
    fname: 'STILLTESTUSER',
    lname: 'DONOTMODIFYSTILL',
    userYear: 3,
    faculty: 'arts',
    gender: 'Female',
    diet: 'none',
  };

  const userPatchPayload = {
    pathParameters: {
      id: INTEGRATION_TEST_USER_ID,
    },
    body: JSON.stringify(userPatchBody)
  };

  describe('user/{id} PATCH', function () {

    it('user PATCH on user that exists returns 200', async() => {

      return helpers.invokeLambda('userUpdate', JSON.stringify(userPatchPayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

    it('user favouriteEvent PATCH returns 200', async () => {

      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_USER_ID,
        },
        body: JSON.stringify({
          isFavourite: true,
          eventID: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
          year: INTEGRATION_TEST_PERSISTENT_YEAR
        }),
      };

      return helpers.invokeLambda('userFavouriteEvent', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

    it('user favouriteEvent PATCH returns 200 for an already favourited event', async () => {

      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_USER_ID,
        },
        body: JSON.stringify({
          isFavourite: true,
          eventID: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
          year: INTEGRATION_TEST_PERSISTENT_YEAR
        }),
      };

      return helpers.invokeLambda('userFavouriteEvent', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

    it('user unfavouriteEvent PATCH returns 200', async () => {

      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_USER_ID,
        },
        body: JSON.stringify({
          isFavourite: false,
          eventID: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
          year: INTEGRATION_TEST_PERSISTENT_YEAR
        }),
      };

      return helpers.invokeLambda('userFavouriteEvent', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

    it('user unfavouriteEvent PATCH returns 200 for an already unfavourited event', async () => {

      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_USER_ID,
        },
        body: JSON.stringify({
          isFavourite: false,
          eventID: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
          year: INTEGRATION_TEST_PERSISTENT_YEAR
        }),
      };

      return helpers.invokeLambda('userFavouriteEvent', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

    it('user GET exists returns 200 and check PATCH success', async () => {

      return helpers.invokeLambda('userGet', JSON.stringify(defaultPayload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(200);
          // check that update succeeded
          expect(body.fname).to.equal(userPatchBody.fname);
          expect(body.year).to.equal(userPatchBody.year);
          expect(body.gender).to.equal(userPatchBody.gender);
          expect(body['favedEventsID;year']).to.contain('bluePrint;2020');
          expect(body['favedEventsID;year']).to.contain('someEvent;2020');

        });

    });

  });

  describe('user/{id} DELETE and wrapup', function () {

    it('user DELETE returns 200', async () => {

      return helpers.invokeLambda('userDelete', JSON.stringify(defaultPayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

    it('user GET returns 404 to check DELETE worked', async () => {

      return helpers.invokeLambda('userGet', JSON.stringify(defaultPayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(404);

        });

    });

    it('user PATCH on user that does not exist returns 404', async () => {

      return helpers.invokeLambda('userGet', JSON.stringify(userPatchPayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(404);

        });

    });

  });

});
