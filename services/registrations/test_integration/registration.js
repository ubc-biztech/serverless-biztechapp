'use strict';
import chai from 'chai';
const expect = chai.expect;
import {
  INTEGRATION_TEST_PERSISTENT_USER_EMAIL,
  INTEGRATION_TEST_PERSISTENT_USER_EMAIL_2,
  INTEGRATION_TEST_NON_EXISTANT_USER_EMAIL,
  INTEGRATION_TEST_PERSISTENT_EVENT_ID,
  INTEGRATION_TEST_PERSISTENT_YEAR,
  INTEGRATION_TEST_NON_EXISTANT_EVENT_ID,
  INTEGRATION_TEST_NON_EXISTANT_YEAR,
  INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS
} from '../../../constants/test';

import helpers from '../../../lib/testHelpers';

const SERVICE = 'registrations';

describe('registration integration', function () {

  this.timeout(15000);

  describe('registrations/ GET', function() {

    it('entry GET event ID scan doesn\'t exist returns 200', async () => {

      const payload = {
        queryStringParameters: {
          year: INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS.year,
          email: INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS.email,
          eventID: INTEGRATION_TEST_PERSISTENT_EVENT_ID // wrong eventId
        }
      };
      return helpers.invokeLambda(SERVICE, 'registrationGet', JSON.stringify(payload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(200);
          expect(body.size).to.equal(0);
          expect(body.data).to.have.length(0);

        });

    });

    it('entry GET event ID scan exists returns 200', async () => {

      const payload = {
        queryStringParameters: {
          eventID: INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS.eventId,
          year: INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS.year
        }
      };
      return helpers.invokeLambda(SERVICE, 'registrationGet', JSON.stringify(payload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(200);
          expect(body.size).to.equal(1);
          expect(body.data[0]['eventID;year']).to.equal(INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS.key);

        });

    });

  });

  describe('registrations/ POST', function() {

    it('entry POST no such event returns 404', async () => {

      const payload = createPayload(INTEGRATION_TEST_PERSISTENT_USER_EMAIL, INTEGRATION_TEST_NON_EXISTANT_EVENT_ID, INTEGRATION_TEST_NON_EXISTANT_YEAR, 'registered');
      return helpers.invokeLambda(SERVICE, 'registrationPost', JSON.stringify(payload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(404);
          expect(body.message).to.equal(`Event with id '${INTEGRATION_TEST_NON_EXISTANT_EVENT_ID}' and secondaryKey '${INTEGRATION_TEST_NON_EXISTANT_YEAR}' could not be found. Make sure you have provided them correctly.`);

        });

    });

    it('entry POST no such user returns 404', async () => {

      const payload = createPayload(INTEGRATION_TEST_NON_EXISTANT_USER_EMAIL, INTEGRATION_TEST_PERSISTENT_EVENT_ID, INTEGRATION_TEST_PERSISTENT_YEAR, 'registered');
      return helpers.invokeLambda(SERVICE, 'registrationPost', JSON.stringify(payload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(404);
          expect(body.message).to.equal(`User with id '${INTEGRATION_TEST_NON_EXISTANT_USER_EMAIL}' could not be found. Make sure you have provided the correct id.`);

        });

    });

    it('entry POST success returns 201', async () => {

      const payload = createPayload(INTEGRATION_TEST_PERSISTENT_USER_EMAIL, INTEGRATION_TEST_PERSISTENT_EVENT_ID, INTEGRATION_TEST_PERSISTENT_YEAR, 'registered');
      return helpers.invokeLambda(SERVICE, 'registrationPost', JSON.stringify(payload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(201);
          expect(body.registrationStatus).to.equal('registered');

        });

    });

    it('entry POST entry already exists returns 409', async () => {

      const payload = createPayload(INTEGRATION_TEST_PERSISTENT_USER_EMAIL, INTEGRATION_TEST_PERSISTENT_EVENT_ID, INTEGRATION_TEST_PERSISTENT_YEAR, 'checkedIn');
      return helpers.invokeLambda(SERVICE, 'registrationPost', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(409);

        });

    });

    it('entry POST event at capacity returns 201', async () => {

      const payload = createPayload(
        INTEGRATION_TEST_PERSISTENT_USER_EMAIL_2,
        INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS.eventId,
        INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS.year,
        'registered'
      );
      return helpers.invokeLambda(SERVICE, 'registrationPost', JSON.stringify(payload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(201);
          expect(body.registrationStatus).to.equal('waitlist');

        });

    });

  });

  describe('registrations/{email} PUT', function() {

    it('entry PUT success returns 200', async () => {

      const payload = createPayloadPut(INTEGRATION_TEST_PERSISTENT_USER_EMAIL, INTEGRATION_TEST_PERSISTENT_EVENT_ID, INTEGRATION_TEST_PERSISTENT_YEAR, 'checkedIn');
      return helpers.invokeLambda(SERVICE, 'registrationPut', JSON.stringify(payload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(200);
          expect(body.registrationStatus).to.equal('checkedIn');

        });

    });

    it('entry GET to verify put - returns 200', async () => {

      const payload = {
        queryStringParameters: {
          email: INTEGRATION_TEST_PERSISTENT_USER_EMAIL
        }
      };
      return helpers.invokeLambda(SERVICE, 'registrationGet', JSON.stringify(payload))
        .then(([statusCode, body]) => {
          expect(statusCode).to.equal(200);
          expect(body.size).to.equal(2);
          for(const entry of body.data) {

            expect(entry.id).to.equal(INTEGRATION_TEST_PERSISTENT_USER_EMAIL);
            if (entry['eventID;year'] == `${INTEGRATION_TEST_PERSISTENT_EVENT_ID};${INTEGRATION_TEST_PERSISTENT_YEAR}`) {

              expect(entry.registrationStatus).to.equal('checkedIn');

            }
            if (entry['eventID;year'] == INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS.key) {

              expect(entry.registrationStatus).to.equal('registered');

            }

          }

        });

    });

  });

  describe('registrations/{email} DELETE', function() {

    it('entry DELETE success returns 200', async () => {

      const payload = {
        pathParameters: {
          email: INTEGRATION_TEST_PERSISTENT_USER_EMAIL
        },
        body: JSON.stringify({
          eventID: INTEGRATION_TEST_PERSISTENT_EVENT_ID,
          year: INTEGRATION_TEST_PERSISTENT_YEAR
        })
      };
      return helpers.invokeLambda(SERVICE, 'registrationDelete', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

    it('entry DELETE cleanup returns 200', async () => {

      const payload = {
        pathParameters: {
          email: INTEGRATION_TEST_PERSISTENT_USER_EMAIL_2,
        },
        body: JSON.stringify({
          eventID: INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS.eventId,
          year: INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS.year
        })
      };
      return helpers.invokeLambda(SERVICE, 'registrationDelete', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

    it('entry PUT no such id and event combination returns 409', async() => {

      const payload = createPayloadPut(INTEGRATION_TEST_PERSISTENT_USER_EMAIL, INTEGRATION_TEST_PERSISTENT_EVENT_ID, INTEGRATION_TEST_PERSISTENT_YEAR,'checkedIn');
      return helpers.invokeLambda(SERVICE, 'registrationPut', JSON.stringify(payload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(409);
          expect(body.message).to.equal(`Update error because the registration entry for user '${INTEGRATION_TEST_PERSISTENT_USER_EMAIL}' and with eventID;year '${INTEGRATION_TEST_PERSISTENT_EVENT_ID};${INTEGRATION_TEST_PERSISTENT_YEAR}' does not exist`);

        });

    });

  });

});

const createPayload = function(email, eventID, year, registrationStatus) {

  return {
    body: JSON.stringify({
      email,
      eventID,
      year,
      registrationStatus
    })
  };

};

const createPayloadPut = function(email, eventID, year, registrationStatus) {

  return {
    pathParameters: {
      email
    },
    body: JSON.stringify({
      eventID,
      year,
      registrationStatus
    })
  };

};
