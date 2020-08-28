'use strict';
const helpers = require('./helpers');
const { isEmpty } = require('../utils/functions');

module.exports.getAll = async (event, ctx, callback) => {

  try {

    // scan the table
    const prizes = await helpers.scan("biztechPrizes");

    // re-organize the response
    let response = {}
    if(prizes !== null) response = helpers.createResponse(200, prizes);

    // return the response object
    callback(null, response);
    return null;

  } catch(err) {

    callback(null, err);
    return null;
  }

};

module.exports.create = async (event, ctx, callback) => {

  try {

    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body);

    // check request body
    helpers.checkPayloadProps(data, {
      id: { required: true, type: 'string' },
      name: { required: true, type: 'string' },
      imageHash: { type: 'string'},
      price: { required: true, type: 'number' },
      links: { type: 'object' }
    });

    // check if there are prizes with the given id
    const existingPrize = await helpers.getOne(data.id, "biztechPrizes");
    if(!isEmpty(existingPrize)) throw helpers.duplicateResponse('id', data);

    // construct the item
    const item = {
      id: data.id,
      name: data.name,
      price: data.price,
      imageHash: data.imageHash,
      links: data.links,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // do the magic
    const res = await helpers.create(item, 'biztechPrizes');

    const response = helpers.createResponse(201, {
      message: 'Prize Created!',
      response: res,
      item
    });

    // return the response object
    callback(null, response);
    return null;

  } catch(err) {

    callback(null, err);
    return null;
  }

};

module.exports.update = async (event, ctx, callback) => {

  try {

    const data = JSON.parse(event.body);
    
    // check if id was given
    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdResponse('prize');
    const id = event.pathParameters.id;

    // check request body
    helpers.checkPayloadProps(data, {
      name: { type: 'string' },
      imageHash: { type: 'string'},
      price: { type: 'number' },
      links: { type: 'object' }
    });

    // check that the id exists
    const existingPrize = await helpers.getOne(id, "biztechPrizes")
    if(isEmpty(existingPrize)) throw helpers.notFoundResponse('Prize', id);

    // do the magic
    const res = await helpers.updateDB(id, data, "biztechPrizes");
    
    const response = helpers.createResponse(200, {
      message: "Prize updated!",
      response: res
    });

    // return the response object
    callback(null, response);
    return null;

  } catch(err) {

    callback(null, err);
    return null;
  }

};

module.exports.delete = async (event, ctx, callback) => {

  try {
    
    // check if id was given
    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdResponse('prize');
    const id = event.pathParameters.id;

    // check that the id exists
    const existingPrize = await helpers.getOne(id, 'biztechPrizes');
    if(isEmpty(existingPrize)) throw helpers.notFoundResponse('Prize', id);

    // do the magic
    const res = await helpers.deleteOne(id, 'biztechPrizes');
    const response = helpers.createResponse(200, {
      message: 'Prize deleted!',
      response: res
    })

    callback(null, response);

  } catch(err) {

    callback(null, err);
    return null;
  }

};
