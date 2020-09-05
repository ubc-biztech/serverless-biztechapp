'use strict';
const AWS = require('aws-sdk');
const chai = require('chai');
const expect = chai.expect;

const helpers = require('./helpers')

describe('user integration', function () {

  this.timeout(10000);

  it('user basic test', async () => {
    const payload = {
      pathParameters: {
        id: -40
      }
    };
    return helpers.invokeLambda('userGet', JSON.stringify(payload))
    .then(([statusCode, body]) => {
      expect(statusCode).to.equal(404);
    })
  });
});

// TODO: fix userGetAll and add getAll test
// params = {
//     FunctionName: "biztechApp-dev-userGetAll",
//   }
//   await lambda.invoke(params, function(err, data) {
//     if (err) {
//       console.log(err);
//       throw err;
//     }
//     else console.log(data);
//   });
