import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import { isEmpty, isValidEmail } from "../../lib/utils";
import {
  USERS_TABLE,
  EVENTS_TABLE,
  MEMBERS_TABLE,
  IMMUTABLE_USER_PROPS
} from "../../constants/tables";
import docClient from "../../lib/docClient";
import type { APIGatewayEvent, LambdaCallback, LambdaContext } from "../../lib/types";

export const create = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body as string);
  if (!isValidEmail(data.email))
    return helpers.inputError("Invalid email", data.email);
  const email = data.email.toLowerCase();

  let isBiztechAdmin = false;

  //assume the created user is biztech admin if using biztech email
  if (
    email.substring(email.indexOf("@") + 1, email.length) === "ubcbiztech.com"
  ) {
    isBiztechAdmin = true;
  }

  const userParams = {
    id: email,
    education: data.education,
    studentId: data.studentId || 0,
    fname: data.fname,
    lname: data.lname,
    faculty: data.faculty,
    major: data.major,
    year: data.year,
    gender: data.gender,
    diet: data.diet,
    createdAt: timestamp,
    updatedAt: timestamp,
    admin: isBiztechAdmin
  };
  //check whether the favedEventsArray body param meets the requirements
  if (
    data.hasOwnProperty("favedEventsArray") &&
    Array.isArray(data.favedEventsArray)
  ) {
    let favedEventsArray = data.favedEventsArray;
    // BUG (pre-existing, preserved): operator precedence makes this
    // `(!favedEventsArray.length) === 0`, i.e. `false === 0`, which is never
    // true, so the empty-array case is never rejected. TypeScript flags the
    // mismatch, which is exactly the bug; the directive keeps it as-is.
    // @ts-expect-error TS2367 comparing boolean to number
    if (!favedEventsArray.length === 0) {
      return helpers.inputError("the favedEventsArray is empty", data);
    }
    if (
      !favedEventsArray.every(
        (eventIDAndYear: unknown) => typeof eventIDAndYear === "string"
      )
    ) {
      return helpers.inputError(
        "the favedEventsArray contains non-string element(s)",
        data
      );
    }
    if (favedEventsArray.length !== new Set(favedEventsArray).size) {
      return helpers.inputError(
        "the favedEventsArray contains duplicate elements",
        data
      );
    }
    //if all conditions met, add favedEventsArray as a Set to userParams
    // BUG (pre-existing, preserved): `userParams` has no `Item` property, so
    // this throws a TypeError whenever `favedEventsArray` is supplied. The
    // `createSet` call is also a v2 SDK leftover that does not exist on the v3
    // DynamoDBDocumentClient. The casts keep both behaviours verbatim.
    (userParams as any).Item["favedEventsID;year"] =
      (docClient as any).createSet(favedEventsArray);
  }

  // if (data.hasOwnProperty('inviteCode')) {

  //   const inviteCodeParams = {
  //     Key: { id: data.inviteCode },
  //     TableName: USER_INVITE_CODES_TABLE + process.env.ENVIRONMENT
  //   };
  //   await docClient
  //     .get(inviteCodeParams)
  //     .promise()
  //     .then(async result => {

  //       if (result.Item === null) {

  //         const response = helpers.createResponse(
  //           404,
  //           'Invite code not found.'
  //         );
  //         callback(null, response);

  //       } else {

  //         // invite code was found
  //         // add paid: true to user
  //         userParams.Item.paid = true;
  //         const deleteParams = {
  //           Key: { id: data.inviteCode },
  //           TableName: USER_INVITE_CODES_TABLE + process.env.ENVIRONMENT
  //         };
  //         await docClient.delete(deleteParams).promise();

  //       }

  //     })
  //     .catch(error => {

  //       console.error(error);
  //       const response = helpers.createResponse(502, error);
  //       callback(null, response);

  //     });

  // }

  try {
    await db.put(userParams, USERS_TABLE, true);
    const response = helpers.createResponse(201, {
      message: "Created!",
      params: userParams
    });
    return response;
  } catch (error) {
    let response;
    if ((error as { type?: unknown }).type === "ConditionalCheckFailedException") {
      response = helpers.createResponse(
        409,
        "User could not be created because email already exists"
      );
    } else {
      response = helpers.createResponse(502, "Internal Server Error occurred");
    }
    return response;
  }
};

export const checkUser = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  try {
    const email = event.pathParameters!.email;
    const user = await db.getOne(email, USERS_TABLE);
    if (isEmpty(user)) {
      return helpers.createResponse(200, false);
    } else {
      return helpers.createResponse(200, true);
    }
  } catch (err) {
    return helpers.createResponse(400, err);
  }
};

export const checkUserMembership = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  console.log(event);
  try {
    const email = event.pathParameters?.email?.trim().toLowerCase();
    if (!isValidEmail(email)) {
      return helpers.inputError("Invalid email", email);
    }
    const member = await db.getOne(email, MEMBERS_TABLE);
    return helpers.createResponse(200, !isEmpty(member));
  } catch (err) {
    return helpers.createResponse(400, err);
  }
};

export const get = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  try {
    let email = event.requestContext.authorizer!.claims!.email.toLowerCase();

    if (
      email.endsWith("@ubcbiztech.com") &&
      event.pathParameters &&
      event.pathParameters.email &&
      isValidEmail(event.pathParameters.email)
    )
      email = event.pathParameters.email;

    if (!isValidEmail(email)) {
      return helpers.inputError("Invalid email", email);
    }
    const user = await db.getOne(email, USERS_TABLE);
    if (isEmpty(user)) {
      return helpers.notFoundResponse("user", email);
    }

    const response = helpers.createResponse(200, user);
    return response;
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: (err as { message?: unknown }).message || err });
  }
};

export const update = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.email)
      throw helpers.missingIdQueryResponse("event");

    const email = event.pathParameters.email;
    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);

    const existingUser = await db.getOne(email, USERS_TABLE);
    if (isEmpty(existingUser)) throw helpers.notFoundResponse("user", email);

    const data = JSON.parse(event.body as string);

    const invalidUpdates = Object.keys(data).filter((prop) =>
      IMMUTABLE_USER_PROPS.includes(prop)
    );
    if (invalidUpdates.length > 0)
      throw helpers.inputError(`Cannot update ${invalidUpdates.join(", ")}`);

    const res = await db.updateDB(email, data, USERS_TABLE);
    const response = helpers.createResponse(200, {
      message: `Updated event with email ${email}!`,
      response: res
    });

    return response;
  } catch (err) {
    console.error(err);
    return helpers.createResponse((err as { statusCode?: number }).statusCode || 500, { message: (err as { message?: unknown }).message || err });
  }
};

export const getAll = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  try {
    const users = await db.scan(USERS_TABLE);

    const response = helpers.createResponse(200, users);

    return response;
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: (err as { message?: unknown }).message || err });
  }
};

// TODO: Fix favouriteEvents 08/08/24
export const favouriteEvent = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  try {
    const data = JSON.parse(event.body as string);

    helpers.checkPayloadProps(data, {
      eventID: {
        required: true,
        type: "string"
      },
      year: {
        required: true,
        type: "number"
      },
      isFavourite: {
        required: true,
        type: "boolean"
      }
    });

    const { eventID, year, isFavourite } = data;
    const eventIDAndYear = eventID + ";" + year;

    const email = event.pathParameters!.email;
    if (email === null || !isValidEmail(email))
      throw helpers.inputError("Invalid email", email);

    const existingEvent = await db.getOne(eventID, EVENTS_TABLE, {
      year
    });
    if (isEmpty(existingEvent))
      throw helpers.notFoundResponse("event", eventID, year);

    const existingUser = await db.getOne(email, USERS_TABLE);
    if (isEmpty(existingUser)) throw helpers.notFoundResponse("user", email);

    const favedEventsList = existingUser!["favedEventsID;year"]
      ? existingUser!["favedEventsID;year"].values
      : undefined;

    let updateExpression = "";
    let conditionExpression = "";
    if (
      isFavourite &&
      (!favedEventsList || !favedEventsList.includes(eventIDAndYear))
    ) {
      updateExpression = "add #favedEvents :eventsIDAndYear";
      conditionExpression =
        "attribute_exists(id) and (not contains(#favedEvents, :eventIDAndYear))"; // if eventID already exists, don't perform add operation
    } else if (
      !isFavourite &&
      favedEventsList &&
      favedEventsList.includes(eventIDAndYear)
    ) {
      updateExpression = "delete #favedEvents :eventsIDAndYear";
      conditionExpression =
        "attribute_exists(id) and contains(#favedEvents, :eventIDAndYear)"; // if eventID does not exist, don't perform delete operation
    } else {
      //If user is trying to favourite an event that they've already favourited
      //OR if user is trying to unfavourite an event that is not favourited
      //In either of these cases, do nothing, but return a success message.
      let successMsg =
        "Already " + (isFavourite ? "favourited" : "unfavourited");
      successMsg += ` event with eventID ${eventID} for the year ${year}`;
      return helpers.createResponse(200, {
        message: successMsg,
        response: {}
      });
    }

    let expressionAttributeNames: Record<string, string>;
    expressionAttributeNames = {
      "#favedEvents": "favedEventsID;year"
    };

    let expressionAttributeValues: Record<string, unknown>;
    // BUG (pre-existing, preserved): `createSet` does not exist on the v3
    // DynamoDBDocumentClient, so this throws a TypeError at runtime.
    expressionAttributeValues = {
      ":eventsIDAndYear": (docClient as any).createSet([eventIDAndYear])
    };
    expressionAttributeValues[":eventIDAndYear"] = eventIDAndYear; // string data type, for conditionExpression

    const params = {
      Key: {
        id: email
      },
      TableName:
        USERS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      UpdateExpression: updateExpression,
      ConditionExpression: conditionExpression
    };

    const res = await db.updateDBCustom(params);

    let successMsg = isFavourite ? "Favourited" : "Unfavourited";
    successMsg += ` event with eventID ${eventID} for the year ${year}`;
    return helpers.createResponse(200, {
      message: successMsg,
      response: res
    });
  } catch (err) {
    console.error(err);
    const response = helpers.createResponse((err as { statusCode?: number }).statusCode || 500, { message: (err as { message?: unknown }).message || err });
    return response;
  }
};

// TODO: refactor to abstract delete code among different endpoints
export const del = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  try {
    // check that the param was given
    if (!event.pathParameters || !event.pathParameters.email)
      throw helpers.missingIdQueryResponse("event");

    const email = event.pathParameters.email;
    // check that the user exists
    const existingUser = await db.getOne(email, USERS_TABLE);
    if (isEmpty(existingUser)) throw helpers.notFoundResponse("User", email);

    const res = await db.deleteOne(email, USERS_TABLE);
    const response = helpers.createResponse(200, {
      message: "User deleted!",
      response: res
    });

    return response;
  } catch (err) {
    return helpers.createResponse((err as { statusCode?: number }).statusCode || 500, { message: (err as { message?: unknown }).message || err });
  }
};
