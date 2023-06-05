import AWS from "../../lib/aws";

import registrationHelpers from "./helpers";
import helpers from "../../lib/handlerHelpers";
import { isEmpty } from "../../lib/utils";
import db from "../../lib/db";
import { EVENTS_TABLE, QRS_TABLE } from "../../constants/tables";

/*
  Returns Status Code 200 when QR code is scanned successfully
  Returns Status Code 403 if a QR scan is not valid
  Returns Status Code 405 if a QR scan is valid but the user has not confirmed negative point QR scans
  Returns Status Code 406 if a QR scan is valid but the Team's balance would be negative
*/

// Endpoint: POST /qr
export const post = async (event, ctx, callback) => {
  /* Processes a QR code scan and tries to update the user's points in the Registrations database

  Args:
    event (object): object containing the request body, params, headers, etc. (refer to checkPayloadProps)
    ctx (object): object containing the context of the request
    callback (function): callback function to return the response

  Returns:
      response (object): object containing the response body, params, headers (status code), etc.
   */

  try {
    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      qrCodeID: { required: true, type: "string" },
      eventID: { required: true, type: "string" },
      year: { required: true, type: "number" },
      email: { required: true, type: "string" },
      negativePointsConfirmed: { required: true, type: "boolean" }, // true if the user has confirmed negative point QR scans
      admin: { required: false, type: "boolean" } // TODO: Admin possibility if gated actions required in the future
    });

    await registrationHelpers
      .qrScanPostHelper(data, data.email)
      .then((res) => {
        if (res.hasOwnProperty("errorMessage")) {
          if (
            res.errorMessage === "Team scan would result in negative points"
          ) {
            const response_fail = helpers.createResponse(406, {
              message: "ERROR: " + res.errorMessage,
              response: res
            });

            callback(null, response_fail);
            return response_fail;
          }

          const response_fail = helpers.createResponse(403, {
            message: "ERROR: " + res.errorMessage,
            response: res
          });

          callback(null, response_fail);
          return response_fail;
        }

        const response_success = helpers.createResponse(200, {
          message: "Successfully scanned QR code.",
          response: res
        });

        callback(null, response_success);
        return response_success;
      })
      .catch((err) => {
        console.error(err);
        callback(null, err);
        return null;
      });
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const get = async (event, ctx, callback) => {
  try {
    const qrs = await db.scan(QRS_TABLE, {});
    const response = helpers.createResponse(200, qrs);
    callback(null, response);
    return response;
  } catch (err) {
    console.log(err);
    callback(null, err);
    return null;
  }
};

export const getOne = async (event, ctx, callback) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.id ||
      !event.pathParameters.eventID ||
      !event.pathParameters.year
    )
      throw helpers.missingPathParamResponse("id", "event", "year");
    const { id, eventID, year } = event.pathParameters;
    const eventIDAndYear = eventID + ";" + year;
    const qr = await db.scan(id, QRS_TABLE, { "eventID;year": eventIDAndYear });
    const response = helpers.createResponse(200, qr);
    callback(null, response);
    return response;
  } catch (err) {
    console.log(err);
    callback(null, err);
    return null;
  }
};

export const create = async (event, ctx, callback) => {
  try {
    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      id: {
        required: true
      },
      eventID: {
        required: true,
        type: "string"
      },
      year: {
        required: true,
        type: "number"
      },
      points: {
        required: true,
        type: "number"
      }
    });

    const eventIDAndYear = data.eventID + ";" + data.year;
    const existingQR = await db.getOne(data.id, QRS_TABLE, {
      "eventID;year": eventIDAndYear
    });
    if (!isEmpty(existingQR))
      throw helpers.duplicateResponse("id and event", data);
    const existingEvent = await db.getOne(data.eventID, EVENTS_TABLE, {
      year: data.year
    });
    if (isEmpty(existingEvent))
      throw helpers.inputError("Event does not exist", data);

    const item = {
      id: data.id,
      "eventID;year": eventIDAndYear,
      points: data.points,
      isActive: data.isActive,
      isUnlimitedScans: data.isUnlimitedScans,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const res = await db.create(item, QRS_TABLE);

    const response = helpers.createResponse(201, {
      message: `Create QR with id ${data.id} for the event ${eventIDAndYear}!`,
      response: res,
      item
    });

    callback(null, response);
    return null;
  } catch (err) {
    console.log(err);
    callback(null, err);
    return null;
  }
};

export const update = async (event, ctx, callback) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.id ||
      !event.pathParameters.eventID ||
      !event.pathParameters.year
    )
      throw helpers.missingPathParamResponse("id", "event", "year");
    const { id, eventID, year } = event.pathParameters;
    const eventIDAndYear = eventID + ";" + year;

    const existingQR = await db.getOne(id, QRS_TABLE, {
      "eventID;year": eventIDAndYear
    });
    if (isEmpty(existingQR))
      throw helpers.notFoundResponse("QR", id, eventIDAndYear);
    const data = JSON.parse(event.body);

    const docClient = new AWS.DynamoDB.DocumentClient();

    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    } = db.createUpdateExpression(data);

    let params = {
      Key: {
        id,
        eventIDAndYear
      },
      TableName:
        QRS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: {
        ...expressionAttributeNames
      },
      UpdateExpression: updateExpression,
      ReturnValues: "UPDATED_NEW",
      ConditionExpression:
        "attribute_exists(id) and attribute_exists(eventID;year)"
    };

    const res = await docClient.update(params).promise();

    const response = helpers.createResponse(200, {
      message: `Updated QR with id ${id} and event ${eventIDAndYear}!`,
      response: res
    });

    callback(null, response);
    return null;
  } catch (err) {
    console.log(err);
    callback(null, err);
    return null;
  }
};

export const del = async (event, ctx, callback) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.id ||
      !event.pathParameters.eventID ||
      !event.pathParameters.year
    )
      throw helpers.missingPathParamResponse("id", "event", "year");
    const { id, eventID, year } = event.pathParameters;
    const eventIDAndYear = eventID + ";" + year;

    const existingQR = await db.getOne(id, QRS_TABLE, {
      "eventID;year": eventIDAndYear
    });
    if (isEmpty(existingQR))
      throw helpers.notFoundResponse("QR", id, eventIDAndYear);

    const res = await db.deleteOne(id, QRS_TABLE, {
      "eventID;year": eventIDAndYear
    });

    const response = helpers.createResponse(200, {
      message: `Deleted QR with id ${id} and event ${eventIDAndYear}!`,
      response: res
    });

    callback(null, response);
    return null;
  } catch (err) {
    console.log(err);
    callback(null, err);
    return null;
  }
};
