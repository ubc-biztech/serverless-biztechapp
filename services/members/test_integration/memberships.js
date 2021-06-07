'use strict';
import chai from 'chai';
const expect = chai.expect;

import helpers from '../../../lib/testHelpers';

const SERVICE = 'memberss';

describe('memberss integration', function () {

  this.timeout(10000);

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

});
