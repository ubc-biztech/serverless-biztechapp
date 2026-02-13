import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import {
  isEmpty
} from "../../lib/utils";
import {
  PRIZES_TABLE
} from "../../constants/tables";

export const getAll = async (event, ctx) => {
  try {
    const prizes = await db.scan(PRIZES_TABLE);

    let response = {};
    if(prizes !== null) response = helpers.createResponse(200, prizes);

    return response;
  } catch(err) {
    return helpers.createResponse(500, { message: err.message || err });
  }
};

export const create = async (event, ctx) => {
  try {
    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      id: {
        required: true,
        type: "string"
      },
      name: {
        required: true,
        type: "string"
      },
      imageHash: {
        type: "string"
      },
      price: {
        required: true,
        type: "number"
      },
      links: {
        type: "object"
      }
    });

    const existingPrize = await db.getOne(data.id, PRIZES_TABLE);
    if(!isEmpty(existingPrize)) throw helpers.duplicateResponse("id", data);

    const item = {
      ...data,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const res = await db.create(item, PRIZES_TABLE);

    const response = helpers.createResponse(201, {
      message: "Prize Created!",
      response: res,
      item
    });

    return response;
  } catch(err) {
    return helpers.createResponse(500, { message: err.message || err });
  }
};

export const update = async (event, ctx) => {
  try {
    const data = JSON.parse(event.body);

    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse("prize");
    const id = event.pathParameters.id;

    helpers.checkPayloadProps(data, {
      name: {
        type: "string"
      },
      imageHash: {
        type: "string"
      },
      price: {
        type: "number"
      },
      links: {
        type: "object"
      }
    });

    const existingPrize = await db.getOne(id, PRIZES_TABLE);
    if(isEmpty(existingPrize)) throw helpers.notFoundResponse("Prize", id);

    const res = await db.updateDB(id, data, PRIZES_TABLE);

    const response = helpers.createResponse(200, {
      message: "Prize updated!",
      response: res
    });

    return response;
  } catch(err) {
    return helpers.createResponse(500, { message: err.message || err });
  }
};

export const del = async (event, ctx) => {
  try {
    if(!event.pathParameters || !event.pathParameters.id) throw helpers.missingIdQueryResponse("prize");
    const id = event.pathParameters.id;

    const existingPrize = await db.getOne(id, PRIZES_TABLE);
    if(isEmpty(existingPrize)) throw helpers.notFoundResponse("Prize", id);

    const res = await db.deleteOne(id, PRIZES_TABLE);
    const response = helpers.createResponse(200, {
      message: "Prize deleted!",
      response: res
    });

    return response;
  } catch(err) {
    return helpers.createResponse(500, { message: err.message || err });
  }
};
