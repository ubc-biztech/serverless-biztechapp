'use strict';
import chai from 'chai';
const expect = chai.expect;

import helpers from '../../../lib/testHelpers';
import { stickerPayloadBody } from './integrationTestData';
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

      return helpers.invokeLambda(SERVICE, 'stickersGet', JSON.stringify(defaultPayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(404);

        });

    });

  });

  describe('stickers/ POST tests', function () {

    const payload = {
      body: JSON.stringify(stickerPayloadBody)
    };

    it('stickers/ POST returns 201 on success', async () => {

      await helpers.invokeLambda(SERVICE, 'stickersCreate', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(201);

        });

    });

    it('stickers/ POST returns 409 when sticker id already exists', async () => {

      return helpers.invokeLambda(SERVICE, 'stickersCreate', JSON.stringify(payload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(409);
          expect(body.message).to.equal('A database entry with the same \'id\' already exists!');

        });

    });

  });

  describe('stickers/{id} PATCH and GET tests', function () {

    const newStickerName = `${stickerPayloadBody}-updatedName`;

    it('stickers/{id} PATCH returns 404 when sticker not found', async () => {

      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_NON_EXISTANT_STICKER_ID
        },
        body: JSON.stringify({
          ...stickerPayloadBody,
          id: INTEGRATION_TEST_NON_EXISTANT_STICKER_ID,
        })
      };

      return helpers.invokeLambda(SERVICE, 'stickersUpdate', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(404);

        });

    });

    it('stickers/{id} PATCH returns 200 on update success', async () => {

      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_STICKER_ID
        },
        body: JSON.stringify({
          ...stickerPayloadBody,
          name: newStickerName,
          id: INTEGRATION_TEST_STICKER_ID,
        })
      };
      await helpers.invokeLambda(SERVICE, 'stickersUpdate', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

    it('stickers/{id} GET returns 200 and check PATCH success', async () => {

      return helpers.invokeLambda(SERVICE, 'stickersGet', JSON.stringify(defaultPayload))
        .then(([statusCode, body]) => {

          expect(statusCode).to.equal(200);

          // Check that update succeeded
          expect(body.name).to.equal(newStickerName);
          expect(body).to.have.property('id');
          expect(body).to.have.property('name');
          expect(body).to.have.property('imageURL');
          expect(body).to.have.property('key');

        });

    });

    it('stickers/ GET returns 200 on success', async () => {

      return helpers.invokeLambda(SERVICE, 'stickersGetAll', '').then(([statusCode]) => {

        expect(statusCode).to.equal(200);

      });

    });

  });

  describe('stickers/{id} DELETE tests', function () {

    it('stickers/{id} DELETE returns 404 when sticker not found', async () => {

      const payload = {
        pathParameters: {
          id: INTEGRATION_TEST_NON_EXISTANT_STICKER_ID
        }
      };

      return helpers.invokeLambda(SERVICE, 'stickersDelete', JSON.stringify(payload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(404);

        });

    });

    it('stickers/{id} DELETE returns 200 on delete success', async () => {

      await helpers.invokeLambda(SERVICE, 'stickersDelete', JSON.stringify(defaultPayload))
        .then(([statusCode]) => {

          expect(statusCode).to.equal(200);

        });

    });

  });


});
