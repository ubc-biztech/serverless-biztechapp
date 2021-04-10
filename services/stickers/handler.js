import helpers from '../../lib/handlerHelpers';
import db from '../../lib/db';
import { isEmpty } from '../../lib/utils';
import { STICKERS_TABLE } from '../../constants/tables';
import { imageUpload, deleteObject } from '../../lib/s3';

export const getAll = async(event, ctx, callback) => {

  try {

    // scan the table
    const stickers = await db.scan(STICKERS_TABLE);

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
export const create = async(event, ctx, callback) => {

  try {

    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      id: { required: true, type: 'string' },
      name: { required: true, type: 'string' },
      image: { required: true, type: 'string' },
      mime: { required: true, type: 'string' }
    });

    const existingSticker = await db.getOne(data.id, STICKERS_TABLE);
    if (!isEmpty(existingSticker)) throw helpers.duplicateResponse('id', data);

    const s3Upload = await imageUpload(data);

    if (s3Upload.statusCode !== 200) {

      throw s3Upload;

    }

    const uploadBody = JSON.parse(s3Upload.body);

    const item = {
      id: data.id,
      name: data.name,
      imageURL: uploadBody.imageURL,
      description: data.description,
      key: uploadBody.s3ObjectKey
    };
    const res = await db.create(item, STICKERS_TABLE);

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
export const get = async(event, ctx, callback) => {

  try {

    if (!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('id');
    const id = event.pathParameters.id;

    const sticker = await db.getOne(id, STICKERS_TABLE);
    if(isEmpty(sticker)) throw helpers.notFoundResponse('sticker', id);

    const response = helpers.createResponse(200, sticker);
    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

export const update = async (event, ctx, callback) => {

  try {

    const data = JSON.parse(event.body);

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse('id');
    const id = event.pathParameters.id;

    // check request body
    helpers.checkPayloadProps(data, {
      id: { required: true, type: 'string' },
      name: { required: true, type: 'string' },
      image: { required: true, type: 'string' },
      mime: { required: true, type: 'string' }
    });

    const existingSticker = await db.getOne(id, STICKERS_TABLE);
    if(isEmpty(existingSticker)) throw helpers.notFoundResponse('sticker', id);

    const s3Upload = await imageUpload(data);

    if (s3Upload.statusCode !== 200) {

      throw s3Upload;

    }

    const uploadBody = JSON.parse(s3Upload.body);

    const item = {
      id: data.id,
      name: data.name,
      imageURL: uploadBody.imageURL,
      description: data.description
    };

    const res = await db.updateDB(id, item, STICKERS_TABLE);
    const response = helpers.createResponse(200, {
      message: `Updated sticker with id ${id}!`,
      response: res
    });

    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
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
    const existingSticker = await db.getOne(id, STICKERS_TABLE);
    if(isEmpty(existingSticker)) throw helpers.notFoundResponse('Sticker', id);

    const s3Delete = await deleteObject(existingSticker);

    if (s3Delete.statusCode !== 200) {
      throw s3Delete;
    }

    // do the magic
    const res = await db.deleteOne(id, STICKERS_TABLE);
    const response = helpers.createResponse(200, {
      message: 'Sticker deleted!',
      response: res
    });

    callback(null, response);
    return null;

  } catch(err) {

    callback(null, err);
    return null;

  }

};
