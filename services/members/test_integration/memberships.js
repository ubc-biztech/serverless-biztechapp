'use strict';
import chai from 'chai';
const expect = chai.expect;
import { INTEGRATION_TEST_MEMBER_EMAIL } from '../../../constants/test';

import helpers from '../../../lib/testHelpers';

const SERVICE = 'memberss';

describe('members integration', function () {

  this.timeout(10000);

  const defaultPayload = {
    pathParameters: {
      email: INTEGRATION_TEST_MEMBER_EMAIL,
    },
  };

  describe('member/{email} GET setup', function () {

    it('member GET doesn\'t exist returns 404', async () => {

      return helpers
        .invokeLambda(SERVICE, 'memberGet', JSON.stringify(defaultPayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(404);

        });

    });

  });

  describe('members/ GET tests', function () {

    it('members GET returns 200 on success', async () => {

      return helpers
        .invokeLambda(SERVICE, 'membersGetAll', '')
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(200);
          expect(body).to.not.be.empty;
          expect(body[0]).to.have.property('id');
          expect(body[0]).to.have.property('email');

        });

    });

  });

  const memberCreatePayload = {
    body: JSON.stringify({
      email: INTEGRATION_TEST_MEMBER_EMAIL, // TODO: write constant for email
      pronouns: 'He/Him',
      major: 'BUCS',
      prevMember: 'yes',
      international: 'yes',
      topics: 'Cyber Security, Careers in the Tech Industry',
      heardFrom: 'Instagram',
      verificationCode: 'bizbot',
    }),
  };

  describe('member/ POST', function () {

    it('member POST returns 201', async () => {

      return helpers
        .invokeLambda(
          SERVICE,
          'memberCreate',
          JSON.stringify(memberCreatePayload)
        )
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(201);
          expect(body.message).to.equal('Created!');

        });

    });

    it('member POST already exists returns 409', async () => {

      return helpers
        .invokeLambda(
          SERVICE,
          'memberCreate',
          JSON.stringify(memberCreatePayload)
        )
        .then(([statusCode]) => {

          expect(statusCode).to.equal(409);

        });

    });

    it('member POST already exists returns 409', async () => {

      return helpers
        .invokeLambda(
          SERVICE,
          'memberCreate',
          JSON.stringify(memberCreatePayload)
        )
        .then(([statusCode]) => {

          expect(statusCode).to.equal(409);

        });

    });

  });

});
