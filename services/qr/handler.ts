import { EVENTS_TABLE, QRS_TABLE } from "../../constants/tables.js";
import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers";
import res from "../../lib/responseHelpers";
import type { APIGatewayEvent, LambdaCallback, LambdaContext } from "../../lib/types";
import { isEmpty } from "../../lib/utils";
import registrationHelpers from "./helpers";

const errorMessage = (err: unknown): string =>
  err instanceof Error
    ? err.message
    : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);

/*
  Returns Status Code 200 when QR code is scanned successfully
  Returns Status Code 403 if a QR scan is not valid
  Returns Status Code 405 if a QR scan is valid but the user has not confirmed negative point QR scans
  Returns Status Code 406 if a QR scan is valid but the Team's balance would be negative
*/

// Endpoint: POST /qrscan/
export const post = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    const data = JSON.parse(event.body as string) as Record<string, unknown>;

    helpers.checkPayloadProps(data, {
      qrCodeID: {
        required: true,
        type: "string",
      },
      eventID: {
        required: true,
        type: "string",
      },
      year: {
        required: true,
        type: "number",
      },
      email: {
        required: true,
        type: "string",
      },
      negativePointsConfirmed: {
        required: true,
        type: "boolean",
      },
      admin: {
        required: false,
        type: "boolean",
      },
    });

    const scanRes = (await registrationHelpers.qrScanPostHelper(
      data as never,
      data.email as string,
    )) as Record<string, unknown>;

    console.log(scanRes);

    if (
      scanRes &&
      Object.prototype.hasOwnProperty.call(scanRes, "errorMessage")
    ) {
      const status =
        scanRes.errorMessage === "Team scan would result in negative points"
          ? 406
          : 403;
      return res.send(status, {
        message: "ERROR: " + scanRes.errorMessage,
        response: scanRes,
      });
    }

    try {
      await registrationHelpers.logQRScan(
        data.qrCodeID as string,
        data.email as string,
      );
    } catch (logErr) {
      console.error("Error logging QR scan:", logErr);
    }

    return res.ok({
      message: "Successfully scanned QR code.",
      response: scanRes,
    });
  } catch (err: unknown) {
    console.error(err);
    return res.send(500, { message: errorMessage(err) });
  }
};

export const get = async (
  _event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    const qrs = await db.scan(QRS_TABLE, {});
    return res.ok(qrs);
  } catch (err: unknown) {
    console.log(err);
    return res.send(500, { message: errorMessage(err) });
  }
};

export const getOne = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.id ||
      !event.pathParameters.eventID ||
      !event.pathParameters.year
    ) {
      throw helpers.missingPathParamResponse("id", "event");
    }
    const { id, eventID, year } = event.pathParameters;
    const eventIDAndYear = `${eventID};${year}`;
    const qr = await db.getOne(id, QRS_TABLE, {
      "eventID;year": eventIDAndYear,
    });
    return res.ok(qr);
  } catch (err: unknown) {
    console.log(err);
    return res.send(500, { message: errorMessage(err) });
  }
};

export const create = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body as string) as Record<string, unknown>;

    helpers.checkPayloadProps(data, {
      id: {
        required: true,
      },
      eventID: {
        required: true,
        type: "string",
      },
      year: {
        required: true,
        type: "number",
      },
      points: {
        required: false,
        type: "number",
      },
      type: {
        required: true,
        type: "string",
      },
      data: {
        required: false,
        type: "object",
      },
    });

    const eventIDAndYear = `${(data as { eventID: string }).eventID};${(data as { year: number }).year}`;
    const existingQR = await db.getOne(
      (data as { id: string }).id,
      QRS_TABLE,
      {
        "eventID;year": eventIDAndYear,
      },
    );
    if (!isEmpty(existingQR)) {
      throw helpers.duplicateResponse("id and event", data);
    }
    const existingEvent = await db.getOne(
      (data as { eventID: string }).eventID,
      EVENTS_TABLE,
      {
        year: (data as { year: number }).year,
      },
    );
    if (isEmpty(existingEvent)) {
      throw res.notAcceptable("Event does not exist", data);
    }

    const item = {
      id: (data as { id: string }).id,
      "eventID;year": eventIDAndYear,
      points: (data as { points?: number }).points
        ? (data as { points: number }).points
        : 0,
      isActive: (data as { isActive?: unknown }).isActive,
      isUnlimitedScans: (data as { isUnlimitedScans?: unknown }).isUnlimitedScans,
      createdAt: timestamp,
      updatedAt: timestamp,
      type: (data as { type: string }).type,
      data: (data as { data?: unknown }).data,
    };

    const createRes = await db.create(item, QRS_TABLE);

    return res.created({
      message: `Create QR with id ${(data as { id: string }).id} for the event ${eventIDAndYear}!`,
      response: createRes,
      item,
    });
  } catch (err: unknown) {
    console.log(err);
    return res.send(500, { message: errorMessage(err) });
  }
};

export const update = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.id ||
      !event.pathParameters.eventID ||
      !event.pathParameters.year
    ) {
      throw helpers.missingPathParamResponse("id", "event");
    }
    const { id, eventID, year } = event.pathParameters;
    const eventIDAndYear = `${eventID};${year}`;

    const existingQR = await db.getOne(id, QRS_TABLE, {
      "eventID;year": eventIDAndYear,
    });
    if (isEmpty(existingQR)) {
      throw res.notFound("QR", id, eventIDAndYear);
    }
    const data = JSON.parse(event.body as string) as Record<string, unknown>;

    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames,
    } = db.createUpdateExpression(data);

    const params = {
      Key: {
        id,
        eventIDAndYear,
      },
      TableName:
        QRS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: {
        ...expressionAttributeNames,
      },
      UpdateExpression: updateExpression,
      ReturnValues: "UPDATED_NEW" as const,
      ConditionExpression:
        "attribute_exists(id) and attribute_exists(eventID;year)",
    };

    const updateRes = await db.updateDBCustom(params);

    return res.ok({
      message: `Updated QR with id ${id} and event ${eventIDAndYear}!`,
      response: updateRes,
    });
  } catch (err: unknown) {
    console.log(err);
    return res.send(500, { message: errorMessage(err) });
  }
};

export const del = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.id ||
      !event.pathParameters.eventID ||
      !event.pathParameters.year
    ) {
      throw helpers.missingPathParamResponse("id", "event");
    }
    const { id, eventID, year } = event.pathParameters;
    const eventIDAndYear = `${eventID};${year}`;

    const existingQR = await db.getOne(id, QRS_TABLE, {
      "eventID;year": eventIDAndYear,
    });
    if (isEmpty(existingQR)) {
      throw res.notFound("QR", id, eventIDAndYear);
    }

    const deleteRes = await db.deleteOne(id, QRS_TABLE, {
      "eventID;year": eventIDAndYear,
    });

    return res.ok({
      message: `Deleted QR with id ${id} and event ${eventIDAndYear}!`,
      response: deleteRes,
    });
  } catch (err: unknown) {
    console.log(err);
    return res.send(500, { message: errorMessage(err) });
  }
};
