'use strict';
const AWS = require('aws-sdk');
const chai = require('chai');
const expect = chai.expect;

const helpers = require('./helpers')

describe('user integration', function () {

  this.timeout(15000);

  const defaultPayload = {
    pathParameters: {
      id: -40,
    }
  };

  it('user GET doesn\'t exist returns 404', async () => {
    return helpers.invokeLambda('userGet', JSON.stringify(defaultPayload))
    .then(([statusCode, body]) => {
      expect(statusCode).to.equal(404);
    });
  });

  const userCreatePayload = {
    body: JSON.stringify({
      id: -40,
      fname: 'TESTUSER',
      lname: 'DONOTMODIFY',
      email: 'integration@test.com',
      faculty: 'science',
      year: '2',
      gender: 'Male',
      diet: 'vegan',
      favedEventsArray: ['someEvent', 'bluePrint'],
    })
  }

  it('user POST returns 201', async () => {
    return helpers.invokeLambda('userCreate', JSON.stringify(userCreatePayload))
    .then(([statusCode, body]) => {
      expect(statusCode).to.equal(201);
      expect(body.message).to.equal('Created!');
    });
  });

  it('user POST already exists returns 409', async () => {
    return helpers.invokeLambda('userCreate', JSON.stringify(userCreatePayload))
    .then(([statusCode, body]) => {
      expect(statusCode).to.equal(409);
    });
  });

  const userPatchBody = {
    fname: 'STILLTESTUSER',
    lname: 'DONOTMODIFYSTILL',
    year: '3',
    faculty: 'arts',
    gender: 'Female',
    diet: 'none',
  };

  const userPatchPayload = {
    pathParameters: {
      id: -40,
    },
    body: JSON.stringify(userPatchBody)
  }

  it('user PATCH on user that exists returns 200', async() => {
    return helpers.invokeLambda('userUpdate', JSON.stringify(userPatchPayload))
    .then(([statusCode, body]) => {
      expect(statusCode).to.equal(200);
    });
  });

  it('user favouriteEvent PATCH returns 200', async () => {
    const payload = {
      pathParameters: {
        id: -40,
      },
      body: JSON.stringify({
        isFavourite: true,
        eventID: 'randomEvent',
      }),
    }

    return helpers.invokeLambda('userFavouriteEvent', JSON.stringify(payload))
    .then(([statusCode, body]) => {
      expect(statusCode).to.equal(200);
      expect(body).to.equal('Favouriting event \'randomEvent\' success.')
    });
  });

  it('user unfavouriteEvent PATCH returns 200', async () => {
    const payload = {
      pathParameters: {
        id: -40,
      },
      body: JSON.stringify({
        isFavourite: false,
        eventID: 'bluePrint',
      }),
    }

    return helpers.invokeLambda('userFavouriteEvent', JSON.stringify(payload))
    .then(([statusCode, body]) => {
      expect(statusCode).to.equal(200);
      expect(body).to.equal('Unfavouriting event \'bluePrint\' success.')
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
      expect(body.favedEventsID).to.contain('randomEvent');
      expect(body.favedEventsID).to.contain('someEvent');
    });
  });

  it('user DELETE returns 200', async () => {
    return helpers.invokeLambda('userDelete', JSON.stringify(defaultPayload))
    .then(([statusCode, body]) => {
      expect(statusCode).to.equal(200);
    });
  });

  it('user GET returns 404 to check DELETE worked', async () => {
    return helpers.invokeLambda('userGet', JSON.stringify(defaultPayload))
    .then(([statusCode, body]) => {
      expect(statusCode).to.equal(404);
    });
  });

  it('user PATCH on user that does not exist returns 404', async () => {
    return helpers.invokeLambda('userGet', JSON.stringify(userPatchPayload))
    .then(([statusCode, body]) => {
      expect(statusCode).to.equal(404);
    });
  });
});

// TODO: fix userGetAll and add getAll test
// params = {
//     FunctionName: 'biztechApp-dev-userGetAll',
//   }
//   await lambda.invoke(params, function(err, data) {
//     if (err) {
//       console.log(err);
//       throw err;
//     }
//     else console.log(data);
//   });
