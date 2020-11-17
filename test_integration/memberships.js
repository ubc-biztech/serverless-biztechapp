'use strict';
const chai = require('chai');
const expect = chai.expect;

const helpers = require('./helpers');

describe('prizes integration', function () {

    this.timeout(10000);

    describe('prizes/ GET tests', function () {

        it('prizes GET returns 200 on success', async () => {

            return helpers.invokeLambda('prizeGetAll', '')
                .then(([statusCode]) => {

                    expect(statusCode).to.equal(200);

                });

        });

    });

});