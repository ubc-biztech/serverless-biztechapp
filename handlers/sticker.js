'use strict';
const helpers = require('./helpers');
const { isEmpty } = require('../utils/functions');
const { STICKERS_TABLE } = require('../constants/tables');

module.exports.getAll = async(event, ctx, callback) => {

  try {

    // scan the table
    const stickers = await helpers.scan(STICKERS_TABLE);

    // re-organize the response
    let response = {};
    if (stickers !== null) response = helpers.createResponse(200, stickers);

    // return the response object
    callback(null, response);
    return null;

  } catch (err) {

    callback(null, err);
    return null;

  }

};
module.exports.create = async(event, ctx, callback) => {

  try {

    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      id: { required: true, type: 'string' },
      name: { required: true, type: 'string' },
      url: { required: true, type: 'string' }
    });

    const existingSticker = await helpers.getOne(data.id, STICKERS_TABLE);
    if (!isEmpty(existingSticker)) throw helpers.duplicateResponse('sticker id', data);

    const item = {
      id: data.id,
      name: data.name,
      url: data.url
    };
    const res = await helpers.create(item, STICKERS_TABLE);

    const response = helpers.createResponse(201, {
      message: `Created sticker with id ${data.id}!`,
      response: res,
      item
    });

    callback(null, response);
    return null;

  } catch (err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};
