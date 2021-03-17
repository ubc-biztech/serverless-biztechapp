'use strict';
import chai from 'chai';
const expect = chai.expect;

import helpers from '../../../lib/testHelpers';
import {
  INTEGRATION_TEST_STICKER_ID,
  INTEGRATION_TEST_NON_EXISTANT_STICKER_ID
} from '../../../constants/test';

const SERVICE = 'stickers';

describe('stickers integration', function () {

  this.timeout(3000);

  const defaultPayload = {
    pathParameters: {
      id: INTEGRATION_TEST_STICKER_ID,
    }
  };

  describe('stickers/{id} GET setup', function () {

    it('stickers/{id} GET doesn\'t exist returns 404', async () => {

      return helpers.invokeLambda(SERVICE, 'stickerGet', JSON.stringify(defaultPayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(404);

        });

    });

  });

  describe('stickers/ POST tests', function () {

    let stickerPayload = {
      body: JSON.stringify({
        id: INTEGRATION_TEST_STICKER_ID,
        name: 'Integration Sticker',
        url: 'http://google.ca'
      })
    };

    it('stickers/ POST returns 201 on success', async () => {

      await helpers.invokeLambda(SERVICE, 'stickerCreate', JSON.stringify(stickerPayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(201);

        });

    });

    it('stickers/ POST returns 409 when sticker id already exists', async () => {

      return helpers.invokeLambda(SERVICE, 'stickerCreate', JSON.stringify(stickerPayload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(409);
          expect(body.message).to.equal('A database entry with the same \'id\' already exists!');

        });

    });

  });

  describe('stickers/{id} PATCH and GET tests', function () {

    const stickerPayload = {
      name: 'Updated Sticker',
      url: 'http://google.com'
    };

    it('stickers/{id} PATCH returns 404 when event not found', async () => {

      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_NON_EXISTANT_STICKER_ID
        },
        body: JSON.stringify(stickerPayload)
      };

      return helpers.invokeLambda(SERVICE, 'stickerUpdate', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(404);

        });

    });

    it('stickers/{id} PATCH returns 200 on update success', async () => {

      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_STICKER_ID
        },
        body: JSON.stringify(stickerPayload)
      };
      await helpers.invokeLambda(SERVICE, 'stickerUpdate', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

    it('stickers/{id} GET returns 200 and check PATCH success', async () => {

      return helpers.invokeLambda(SERVICE, 'stickerGet', JSON.stringify(defaultPayload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(200);

          // Check that update succeeded
          expect(body.name).to.equal(stickerPayload.name);
          expect(body.url).to.equal(stickerPayload.url);

        });

    });

    it('stickers/ GET returns 200 on success', async () => {

      return helpers.invokeLambda(SERVICE, 'stickerGetAll', '').then(([statusCode]) => {

        expect(statusCode).to.equal(200);

      });

    });

  });

  describe('stickers/{id} DELETE tests', function () {

    it('stickers/{id} DELETE returns 404 when event not found', async () => {

      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_NON_EXISTANT_STICKER_ID
        }
      };

      return helpers.invokeLambda(SERVICE, 'stickerDelete', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(404);

        });

    });

    it('stickers/{id} DELETE returns 200 on update success', async () => {

      await helpers.invokeLambda(SERVICE, 'stickerDelete', JSON.stringify(defaultPayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

  });


});
