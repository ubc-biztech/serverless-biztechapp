import docClient from "../../lib/docClient";

import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import {
  isEmpty, isValidEmail
} from "../../lib/utils";
import {
  USERS_TABLE, EVENTS_TABLE, IMMUTABLE_USER_PROPS
} from "../../constants/tables";

export const create = async (event, ctx, callback) => {
  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);
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
    Item: {
      id: data.email,
      education: data.education,
      studentId: data.studentId || 0,
      fname: data.fname,
      lname: data.lname,
      faculty: data.faculty,
      major: data.major,
      year: data.year,
      gender: data.gender,
      diet: data.diet,
      isMember: data.isMember,
      createdAt: timestamp,
      updatedAt: timestamp,
      admin: isBiztechAdmin
    },
    TableName:
      USERS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
    ConditionExpression: "attribute_not_exists(id)"
  };
  //check whether the favedEventsArray body param meets the requirements
  if (
    data.hasOwnProperty("favedEventsArray") &&
    Array.isArray(data.favedEventsArray)
  ) {
    let favedEventsArray = data.favedEventsArray;
    if (!favedEventsArray.length === 0) {
      callback(null, helpers.inputError("the favedEventsArray is empty", data));
    }
    if (
      !favedEventsArray.every(
        (eventIDAndYear) => typeof eventIDAndYear === "string"
      )
    ) {
      callback(
        null,
        helpers.inputError(
          "the favedEventsArray contains non-string element(s)",
          data
        )
      );
    }
    if (favedEventsArray.length !== new Set(favedEventsArray).size) {
      callback(
        null,
        helpers.inputError(
          "the favedEventsArray contains duplicate elements",
          data
        )
      );
    }
    //if all conditions met, add favedEventsArray as a Set to userParams
    userParams.Item["favedEventsID;year"] =
      docClient.createSet(favedEventsArray);
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

  await // The `.promise()` call might be on an JS SDK v2 client API.
  // If yes, please remove .promise(). If not, remove this comment.
  // The `.promise()` call might be on an JS SDK v2 client API.
  // If yes, please remove .promise(). If not, remove this comment.
  docClient
    .put(userParams)
    .promise()
    .then(() => {
      const response = helpers.createResponse(201, {
        message: "Created!",
        params: userParams
      });
      callback(null, response);
    })
    .catch((error) => {
      let response;
      if (error.code === "ConditionalCheckFailedException") {
        response = helpers.createResponse(
          409,
          "User could not be created because email already exists"
        );
      } else {
        response = helpers.createResponse(
          502,
          "Internal Server Error occurred"
        );
      }
      callback(null, response);
    });
};

export const checkUser = async (event, ctx, callback) => {
  try {
    const email = event.pathParameters.email;
    const user = await db.getOne(email, USERS_TABLE);
    if (isEmpty(user)) {
      callback(null, helpers.createResponse(200, false));
    } else {
      callback(null, helpers.createResponse(200, true));
    }
    return null;
  } catch (err) {
    callback(null, helpers.createResponse(400, err));
    return null;
  }
};

export const checkUserMembership = async (event, ctx, callback) => {
  console.log(event);
  try {
    const email = event.pathParameters.email;
    const user = await db.getOne(email, USERS_TABLE);
    if (isEmpty(user)) {
      callback(null, helpers.createResponse(200, false));
    } else {
      callback(null, helpers.createResponse(200, user.isMember));
    }
    return null;
  } catch (err) {
    callback(null, helpers.createResponse(400, err));
    return null;
  }
};

export const get = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.email)
      throw helpers.missingIdQueryResponse("email");
    const email = event.pathParameters.email;
    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);
    const user = await db.getOne(email, USERS_TABLE);
    if (isEmpty(user)) throw helpers.notFoundResponse("user", email);

    const response = helpers.createResponse(200, user);
    callback(null, response);
    return null;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const update = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.email)
      throw helpers.missingIdQueryResponse("event");

    const email = event.pathParameters.email;
    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);

    const existingUser = await db.getOne(email, USERS_TABLE);
    if (isEmpty(existingUser)) throw helpers.notFoundResponse("user", email);

    const data = JSON.parse(event.body);

    const invalidUpdates = Object.keys(data).filter((prop) => IMMUTABLE_USER_PROPS.includes(prop));
    if (invalidUpdates.length > 0) throw helpers.inputError(`Cannot update ${invalidUpdates.join(", ")}`);

    const res = await db.updateDB(email, data, USERS_TABLE);
    const response = helpers.createResponse(200, {
      message: `Updated event with email ${email}!`,
      response: res
    });

    callback(null, response);
    return null;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const getAll = async (event, ctx, callback) => {
  try {
    const users = await db.scan(USERS_TABLE);

    // create the response
    const response = helpers.createResponse(200, users);

    callback(null, response);
    return null;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const favouriteEvent = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

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

    const {
      eventID, year, isFavourite
    } = data;
    const eventIDAndYear = eventID + ";" + year;

    const email = event.pathParameters.email;
    if (email === null || !isValidEmail(email))
      throw helpers.inputError("Invalid email", email);

    const existingEvent = await db.getOne(eventID, EVENTS_TABLE, {
      year
    });
    if (isEmpty(existingEvent))
      throw helpers.notFoundResponse("event", eventID, year);

    const existingUser = await db.getOne(email, USERS_TABLE);
    if (isEmpty(existingUser)) throw helpers.notFoundResponse("user", email);

    const favedEventsList = existingUser["favedEventsID;year"]
      ? existingUser["favedEventsID;year"].values
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
      callback(
        null,
        helpers.createResponse(200, {
          message: successMsg,
          response: {
          }
        })
      );
      return null;
    }

    let expressionAttributeNames;
    expressionAttributeNames = {
      "#favedEvents": "favedEventsID;year"
    };

    let expressionAttributeValues;
    expressionAttributeValues = {
      ":eventsIDAndYear": docClient.createSet([eventIDAndYear]) // set data type, for updateExpression
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

    const res = await // The `.promise()` call might be on an JS SDK v2 client API.
    // If yes, please remove .promise(). If not, remove this comment.
    // The `.promise()` call might be on an JS SDK v2 client API.
    // If yes, please remove .promise(). If not, remove this comment.
    docClient.update(params).promise();

    let successMsg = isFavourite ? "Favourited" : "Unfavourited";
    successMsg += ` event with eventID ${eventID} for the year ${year}`;
    callback(
      null,
      helpers.createResponse(200, {
        message: successMsg,
        response: res
      })
    );
    return null;
  } catch (err) {
    console.error(err);
    const response = helpers.createResponse(err.statusCode || 500, err);
    callback(null, response);
    return null;
  }
};

// TODO: refactor to abstract delete code among different endpoints
export const del = async (event, ctx, callback) => {
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

    callback(null, response);
    return null;
  } catch (err) {
    callback(null, err);
    return null;
  }
};
