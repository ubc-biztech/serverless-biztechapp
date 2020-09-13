'use strict';
const AWS = require('aws-sdk');
const chai = require('chai');
const expect = chai.expect;

const helpers = require('./helpers')

describe('registration integration', function () {

  this.timeout(15000);

  const INTEGRATION_TEST_ID = 'integrationTestEvent';
  const EXISTING_EVENT_ID = 'usingfortestdonotmodify';

  describe('registrations/ GET', function() {
    
    it('entry GET doesn\'t exist returns 404', async () => {
      const payload = {
        queryStringParameters: {
          id: -60,
          eventID: INTEGRATION_TEST_ID,
        }
      }
      return helpers.invokeLambda('registrationGet', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(404);
      });
    });

    it('entry GET event ID scan returns 200', async () => {
      const payload = {
        queryStringParameters: {
          eventID: EXISTING_EVENT_ID,
        }
      }
      return helpers.invokeLambda('registrationGet', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(200);
        expect(body.size).to.equal(3);
        for (const entry of body.data) {
          expect(entry.eventID).to.equal(EXISTING_EVENT_ID);
        }
      });
    });
  });

  describe('registrations/ POST', function() {

    it('entry POST success returns 201', async () => {
      const payload = createPayload(-60, INTEGRATION_TEST_ID, 'registered');
      return helpers.invokeLambda('registrationPost', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(201);
        expect(body.registrationStatus).to.equal('registered');
      });
    });

    it('entry POST no such event returns 403', async () => {
      const payload = createPayload(-60, 'randomNonExistantEventIntegrations', 'registered');
      return helpers.invokeLambda('registrationPost', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(403);
        expect(body).to.equal('Event with eventID: randomNonExistantEventIntegrations was not found.');
      });
    });

    it('entry POST no such user returns 403', async () => {
      const payload = createPayload(-598765230, INTEGRATION_TEST_ID, 'registered');
      return helpers.invokeLambda('registrationPost', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(403);
        expect(body).to.equal('User with user id: -598765230 was not found.')
      });
    });

    it('entry POST entry already exists returns 409', async () => {
      const payload = createPayload(-60, INTEGRATION_TEST_ID, 'checkedIn');
      return helpers.invokeLambda('registrationPost', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(409);
        expect(body.message).to.equal('Entry with given id and eventID already exists.')
      });
    });

    it('entry POST event at capacity returns 201', async () => {
      const payload = createPayload(-60, EXISTING_EVENT_ID, 'registered');
      return helpers.invokeLambda('registrationPost', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(201);
        expect(body.registrationStatus).to.equal('waitlist');
      });
    })
  });

  describe('registrations/{id} PUT', function() {

    it('entry PUT success returns 200', async () => {
      const payload = createPayloadPut(-60, INTEGRATION_TEST_ID, 'checkedIn');
      return helpers.invokeLambda('registrationPut', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(200);
        expect(body.registrationStatus).to.equal('checkedIn');
      });
    });

    it('entry GET to verify put returns 200', async () => {
      const payload = {
        queryStringParameters: {
          id: -60
        }
      }
      return helpers.invokeLambda('registrationGet', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(200);
        expect(body.size).to.equal(2);
        for(const entry of body.data) {
          expect(entry.id).to.equal(-60);
          if (entry.eventID == INTEGRATION_TEST_ID) {
            expect(entry.registrationStatus).to.equal('checkedIn');
          }
          if (entry.eventID == EXISTING_EVENT_ID) {
            expect(entry.registrationStatus).to.equal('waitlist');
          }
        }
      });
    });
  });

  describe('registrations/{id} DELETE', function() {

    it('entry DELETE success returns 200', async () => {
      const payload = {
        pathParameters: {
          id: -60,
        },
        body: JSON.stringify({
          eventID: INTEGRATION_TEST_ID
        })
      }
      return helpers.invokeLambda('registrationDelete', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(200);
      });
    });

    it('entry DELETE cleanup returns 200', async () => {
      const payload = {
        pathParameters: {
          id: -60,
        },
        body: JSON.stringify({
          eventID: EXISTING_EVENT_ID
        })
      }
      return helpers.invokeLambda('registrationDelete', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(200);
      });
    });

    it('entry PUT no such id and event combination returns 409', async() => {
      const payload = createPayloadPut(-60, INTEGRATION_TEST_ID, 'checkedIn');
      return helpers.invokeLambda('registrationPut', JSON.stringify(payload))
      .then(([statusCode, body]) => {
        expect(statusCode).to.equal(409);
        expect(body.message).to.equal('Entry with given id and eventID doesn\'t exist.');
      });
    });

  });
});

const createPayload = function(id, eventID, registrationStatus) {
  return {
    body: JSON.stringify({
      id,
      eventID,
      registrationStatus
    })
  };
};

const createPayloadPut = function(id, eventID, registrationStatus) {
  return {
    pathParameters: {
      id
    },
    body: JSON.stringify({
      eventID,
      registrationStatus
    })
  };
};
