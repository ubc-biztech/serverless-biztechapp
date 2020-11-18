'use strict';
const chai = require('chai');
const expect = chai.expect;

const helpers = require('./helpers');

describe('memberships integration', function () {

  this.timeout(10000);

  describe('memberships/ GET tests', function () {

    it('memberships GET returns 200 on success', async () => {

      return helpers.invokeLambda('membershipsGetAll', '')
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

  });

});
