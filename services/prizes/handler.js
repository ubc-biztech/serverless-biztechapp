import helpers from '../../lib/helpers';
import db from '../../lib/db';
import { isEmpty } from '../../utils/functions';
import { PRIZES_TABLE } from '../../constants/tables';

export const getAll = async (event, ctx, callback) => {

  try {

    // scan the table
    const prizes = await db.scan(PRIZES_TABLE);

    // re-organize the response
    let response = {};
    if(prizes !== null) response = helpers.createResponse(200, prizes);

    // return the response object
    callback(null, response);
    return null;

  } catch(err) {

    callback(null, err);
    return null;

  }

};

export const create = async (event, ctx, callback) => {

  try {

    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body);

    // check request body
    helpers.checkPayloadProps(data, {
      id: { required: true, type: 'string' },
      name: { required: true, type: 'string' },
      imageHash: { type: 'string' },
      price: { required: true, type: 'number' },
      links: { type: 'object' }
    });

    // check if there are prizes with the given id
    const existingPrize = await db.getOne(data.id, PRIZES_TABLE);
    if(!isEmpty(existingPrize)) throw helpers.duplicateResponse('id', data);

    // construct the item
    const item = {
      ...data,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // do the magic
    const res = await db.create(item, PRIZES_TABLE);

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

export const update = async (event, ctx, callback) => {

  try {

    const data = JSON.parse(event.body);

    // check if id was given
    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('prize');
    const id = event.pathParameters.id;

    // check request body
    helpers.checkPayloadProps(data, {
      name: { type: 'string' },
      imageHash: { type: 'string' },
      price: { type: 'number' },
      links: { type: 'object' }
    });

    // check that the id exists
    const existingPrize = await db.getOne(id, PRIZES_TABLE);
    if(isEmpty(existingPrize)) throw helpers.notFoundResponse('Prize', id);

    // do the magic
    const res = await db.updateDB(id, data, PRIZES_TABLE);

    const response = helpers.createResponse(200, {
      message: 'Prize updated!',
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

export const del = async (event, ctx, callback) => {

  try {

    // check if id was given
    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('prize');
    const id = event.pathParameters.id;

    // check that the id exists
    const existingPrize = await db.getOne(id, PRIZES_TABLE);
    if(isEmpty(existingPrize)) throw helpers.notFoundResponse('Prize', id);

    // do the magic
    const res = await db.deleteOne(id, PRIZES_TABLE);
    const response = helpers.createResponse(200, {
      message: 'Prize deleted!',
      response: res
    });

    callback(null, response);
    return null;

  } catch(err) {

    callback(null, err);
    return null;

  }

};
