import { PRIZES_TABLE } from "../../constants/tables.js";
import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers";
import { protect } from "../../lib/auth";
import { isEmpty } from "../../lib/utils.js";

const errorMessage = (err: unknown): string =>
  err instanceof Error
    ? err.message
    : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);

export const getAll = protect("user", async () => {
  try {
    const prizes = await db.scan(PRIZES_TABLE);

    let response = {};
    if (prizes !== null) response = helpers.createResponse(200, prizes);

    return response;
  } catch (err: unknown) {
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
});

export const create = protect("admin", async (event) => {
  try {
    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body as string) as Record<string, unknown>;

    helpers.checkPayloadProps(data, {
      id: {
        required: true,
        type: "string",
      },
      name: {
        required: true,
        type: "string",
      },
      imageHash: {
        type: "string",
      },
      price: {
        required: true,
        type: "number",
      },
      links: {
        type: "object",
      },
    });

    const existingPrize = await db.getOne(data.id as string, PRIZES_TABLE);
    if (!isEmpty(existingPrize)) throw helpers.duplicateResponse("id", data);

    const item = {
      ...data,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const res = await db.create(item, PRIZES_TABLE);

    const response = helpers.createResponse(201, {
      message: "Prize Created!",
      response: res,
      item,
    });

    return response;
  } catch (err: unknown) {
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
});

export const update = protect("admin", async (event) => {
  try {
    const data = JSON.parse(event.body as string) as Record<string, unknown>;

    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("prize");
    const id = event.pathParameters.id;

    helpers.checkPayloadProps(data, {
      name: {
        type: "string",
      },
      imageHash: {
        type: "string",
      },
      price: {
        type: "number",
      },
      links: {
        type: "object",
      },
    });

    const existingPrize = await db.getOne(id, PRIZES_TABLE);
    if (isEmpty(existingPrize)) throw helpers.notFoundResponse("Prize", id);

    const res = await db.updateDB(id, data, PRIZES_TABLE);

    const response = helpers.createResponse(200, {
      message: "Prize updated!",
      response: res,
    });

    return response;
  } catch (err: unknown) {
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
});

export const del = protect("admin", async (event) => {
  try {
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("prize");
    const id = event.pathParameters.id;

    const existingPrize = await db.getOne(id, PRIZES_TABLE);
    if (isEmpty(existingPrize)) throw helpers.notFoundResponse("Prize", id);

    const res = await db.deleteOne(id, PRIZES_TABLE);
    const response = helpers.createResponse(200, {
      message: "Prize deleted!",
      response: res,
    });

    return response;
  } catch (err: unknown) {
    return helpers.createResponse(500, { message: errorMessage(err) });
  }
});
