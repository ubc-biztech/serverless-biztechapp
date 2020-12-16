'use strict';
import chai from 'chai';
const expect = chai.expect;

import helpers from '../../../lib/testHelpers';
import {
  INTEGRATION_TEST_EVENT_ID,
  INTEGRATION_TEST_YEAR,
  INTEGRATION_TEST_PERSISTENT_EVENT_ID,
  INTEGRATION_TEST_PERSISTENT_YEAR,
  INTEGRATION_TEST_NON_EXISTANT_EVENT_ID,
  INTEGRATION_TEST_NON_EXISTANT_YEAR,
} from '../../../constants/test';

const SERVICE = 'events';

describe('events integration', function () {

  this.timeout(10000);

  describe('events/{id}/{year} integration', function () {

    describe('events/{id}/{year} GET tests', function () {

      it('event GET with no additional params returns 200 on an event that exists', async () => {

        const payload = {
          pathParameters: {
            id: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
            year: INTEGRATION_TEST_PERSISTENT_YEAR
          }
        };
        return helpers.invokeLambda(SERVICE, 'eventGet', JSON.stringify(payload))
          .then(([statusCode, body]) => {

            expect(statusCode).to.equal(200);
            expect(body.id).to.equal(INTEGRATION_TEST_PERSISTENT_EVENT_ID);
            expect(body).to.have.property('capac');

          });

      });

      it('event GET when event doesn\'t exist returns 404', async () => {

        const payload = {
          pathParameters: {
            id: INTEGRATION_TEST_NON_EXISTANT_EVENT_ID,
            year: INTEGRATION_TEST_PERSISTENT_YEAR
          }
        };
        return helpers.invokeLambda(SERVICE, 'eventGet', JSON.stringify(payload))
          .then(([statusCode]) => {

            expect(statusCode).to.equal(404);

          });

      });

      it('event GET when year doesn\'t exist returns 404', async () => {

        const payload = {
          pathParameters: {
            id: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
            year: INTEGRATION_TEST_NON_EXISTANT_YEAR
          }
        };
        return helpers.invokeLambda(SERVICE, 'eventGet', JSON.stringify(payload))
          .then(([statusCode]) => {

            expect(statusCode).to.equal(404);

          });

      });

      it('event GET with count true and users false returns 200', async () => {

        const payload = {
          pathParameters: {
            id: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
            year: INTEGRATION_TEST_PERSISTENT_YEAR
          },
          queryStringParameters: {
            count: 'true',
            users: 'false'
          }
        };
        return helpers.invokeLambda(SERVICE, 'eventGet', JSON.stringify(payload))
          .then(([statusCode, body]) => {

            expect(statusCode).to.equal(200);
            expect(body).to.have.property('registeredCount');
            expect(body).to.have.property('checkedInCount');
            expect(body).to.have.property('waitlistCount');

          });

      });

      it('event GET with count false and users true returns 200', async () => {

        const payload = {
          pathParameters: {
            id: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
            year: INTEGRATION_TEST_PERSISTENT_YEAR
          },
          queryStringParameters: {
            count: 'false',
            users: 'true'
          }
        };
        return helpers.invokeLambda(SERVICE, 'eventGet', JSON.stringify(payload))
          .then(([statusCode]) => {

            expect(statusCode).to.equal(200);

          });

      });

    });

    describe('events/{id}/{year} PATCH tests', function () {

      const updatePayload = {
        ename: 'Updated Event',
        description: 'DO NOT DELETE',
        capac: 100,
        facebookUrl: 'https://www.facebook.com/BizTechUBC/',
        imageUrl: 'https://www.facebook.com/BizTechUBC/',
        elocation: 'UBC Sauder',
        longitude: -120.10,
        latitude: 78.03,
      };

      // fields that are different in the updatePayload: ename, description, capac, elocation, longitude, latitude
      const defaultPayload = {
        ename: 'integrationTestEventName',
        description: 'default test event description',
        capac: 50,
        facebookUrl: 'https://www.facebook.com/BizTechUBC/',
        imageUrl: 'https://www.facebook.com/BizTechUBC/',
        elocation: 'UBC Nest',
        longitude: 120.00,
        latitude: -78.00,
      };

      it('event PATCH returns 200 on update success', async () => {

        // update integrationTestEvent to defaultPayload
        let payload = {
          pathParameters: {
            id: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
            year: INTEGRATION_TEST_PERSISTENT_YEAR
          },
          body: JSON.stringify(defaultPayload)
        };
        await helpers.invokeLambda(SERVICE, 'eventUpdate', JSON.stringify(payload))
          .then(([statusCode]) => {

            expect(statusCode).to.equal(200);

          });

        payload = {
          pathParameters: {
            id: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
            year: INTEGRATION_TEST_PERSISTENT_YEAR
          }
        };
        // check that integrationTestEvent was updated
        await helpers.invokeLambda(SERVICE, 'eventGet', JSON.stringify(payload))
          .then(([statusCode, body]) => {

            expect(statusCode).to.equal(200);
            expect(body.elocation).to.equal(defaultPayload.elocation);
            expect(body.imageUrl).to.equal(defaultPayload.imageUrl);
            expect(body.facebookUrl).to.equal(defaultPayload.facebookUrl);
            expect(body.description).to.equal(defaultPayload.description);
            expect(body.capac).to.equal(defaultPayload.capac);
            expect(body.longitude).to.equal(defaultPayload.longitude);

          });

        // update integrationTestEvent to updatePayload
        payload = {
          pathParameters: {
            id: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
            year: INTEGRATION_TEST_PERSISTENT_YEAR
          },
          body: JSON.stringify(updatePayload)
        };
        await helpers.invokeLambda(SERVICE, 'eventUpdate', JSON.stringify(payload))
          .then(([statusCode]) => {

            expect(statusCode).to.equal(200);

          });

        // check that integrationTestEvent was updated
        return helpers.invokeLambda(SERVICE, 'eventGet', JSON.stringify(payload))
          .then(([statusCode, body]) => {

            expect(statusCode).to.equal(200);
            expect(body.elocation).to.equal(updatePayload.elocation);
            expect(body.imageUrl).to.equal(updatePayload.imageUrl);
            expect(body.facebookUrl).to.equal(updatePayload.facebookUrl);
            expect(body.description).to.equal(updatePayload.description);
            expect(body.capac).to.equal(updatePayload.capac);
            expect(body.longitude).to.equal(updatePayload.longitude);

          });

      });

      it('event PATCH returns 404 when event not found', async () => {

        const payload = {
          pathParameters: {
            id: INTEGRATION_TEST_NON_EXISTANT_EVENT_ID,
            year: INTEGRATION_TEST_PERSISTENT_YEAR
          },
          body: JSON.stringify(defaultPayload)
        };

        return helpers.invokeLambda(SERVICE, 'eventUpdate', JSON.stringify(payload))
          .then(([statusCode]) => {

            expect(statusCode).to.equal(404);

          });

      });

    });

  });

  describe('events/ integration', function () {

    describe('events/ GET tests', function () {

      it('events GET returns 200 on success', async () => {

        return helpers.invokeLambda(SERVICE, 'eventGetAll', '')
          .then(([statusCode]) => {

            expect(statusCode).to.equal(200);

          });

      });

    });

    describe('events/ POST tests', function () {

      it('events POST returns 201 on success', async () => {

        let payload = {
          body: JSON.stringify({
            id: INTEGRATION_TEST_EVENT_ID,
            year: INTEGRATION_TEST_YEAR,
            ename: 'test',
            capac: 200000,
            img: 'someImageUrl'
          })
        };
        await helpers.invokeLambda(SERVICE, 'eventCreate', JSON.stringify(payload))
          .then(([statusCode, body]) => {

            expect(statusCode).to.equal(201);
            expect(body.message).to.equal(`Created event with id ${INTEGRATION_TEST_EVENT_ID} for the year ${INTEGRATION_TEST_YEAR}!`);

          });

        payload = {
          pathParameters: {
            id: INTEGRATION_TEST_EVENT_ID,
            year: INTEGRATION_TEST_YEAR
          }
        };

        return helpers.invokeLambda(SERVICE, 'eventDelete', JSON.stringify(payload))
          .then(([statusCode]) => {

            expect(statusCode).to.equal(200);

          });

      });

      it('events POST returns 409 when event id already exists', async () => {

        const payload = {
          body: JSON.stringify({
            id: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
            year: INTEGRATION_TEST_PERSISTENT_YEAR,
            ename: 'test',
            capac: 20000,
            img: 'someImgUrl'
          })
        };
        return helpers.invokeLambda(SERVICE, 'eventCreate', JSON.stringify(payload))
          .then(([statusCode, body]) => {

            expect(statusCode).to.equal(409);
            expect(body.message).to.equal('A database entry with the same \'event id and year\' already exists!');

          });

      });

    });

  });

});
