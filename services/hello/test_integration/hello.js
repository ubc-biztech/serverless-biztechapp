import chai from 'chai';
const expect = chai.expect;

import helpers from '../../../lib/testHelpers';

describe('hello integration', function () {

  this.timeout(10000);

  it('hello test', async () => {

    return helpers.invokeLambda('hello').then(([statusCode, body]) => {

      expect(statusCode).to.equal(200);
      expect(body.message).to.equal('Yeet!');

    });

  });

});
