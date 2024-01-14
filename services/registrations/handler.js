import docClient from "../../lib/docClient";
import registrationHelpers from "./helpers";
import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import {
  isEmpty, isValidEmail
} from "../../lib/utils";
import {
  EVENTS_TABLE, USER_REGISTRATIONS_TABLE
} from "../../constants/tables";
import SESEmailService from "./EmailService/SESEmailService";
import awsConfig from "../../lib/config";

// const CHECKIN_COUNT_SANITY_CHECK = 500;

/* returns error 403 if the given id/eventID DNE in database
   returns error 502 if there is a problem with processing data or sending an email
   returns 201 when entry is created successfully, error 409 if a registration with the same id/eventID exists
   returns 200 when entry is updated successfully, error 409 if a registration with the same id/eventID DNE
   sends an email to the user if registration status is included in data, and
     if they are registered, waitlisted, or cancelled, but not if checkedIn
*/
export async function updateHelper(data, createNew, email, fname) {
  const {
    eventID, year, dynamicResponses, registrationStatus, applicationStatus
  } = data;
  const eventIDAndYear = eventID + ";" + year;

  console.log(data);
  console.log("CloudWatch debugging purposes");

  // for the QR code, we pass this to SendGrid
  const id = `${email};${eventIDAndYear};${fname}`;

  //Check if eventID exists and is string. Check if year exists and is number.
  if (
    typeof eventID !== "string" ||
    typeof year !== "number" ||
    isNaN(year) ||
    !isValidEmail(email)
  ) {
    throw helpers.inputError(
      "Incorrect types for eventID and year in registration.updateHelper",
      data
    );
  }

  if (data.isPartner !== undefined) {
    data.isPartner = Boolean(data.isPartner);
  }

  // Check if the user exists
  // const existingUser = await db.getOne(email, USERS_TABLE);
  // if(isEmpty(existingUser)) throw helpers.notFoundResponse('User', email);

  // Check if the event exists
  const existingEvent = await db.getOne(eventID, EVENTS_TABLE, {
    year
  });
  if (isEmpty(existingEvent))
    throw helpers.notFoundResponse("Event", eventID, year);

  const user = {
    id: email,
    fname
  };
  let dynamicRegistrationStatus = registrationStatus;
  // always check application status first, if not null then we send a application status email, else send regular 
  if (applicationStatus) {
    try {
      await sendEmail(user, existingEvent, applicationStatus, id, "application");
    } catch (err) {
      // if email sending failed, that user's email probably does not exist
      throw helpers.createResponse(500, {
        statusCode: 500,
        code: "SES EMAIL SERVICE ERROR",
        message: `Sending Email Error!: ${err.message}`
      });
    }
  } else if (dynamicRegistrationStatus) {
    // Check if the event is full
    if (dynamicRegistrationStatus === "registered") {
      const counts = await registrationHelpers.getEventCounts(eventID, year);
      if (counts === null) {
        throw db.dynamoErrorResponse({
          code: "DYNAMODB ERROR",
          time: new Date().getTime()
        });
      }

      if (counts.registeredCount >= existingEvent.capac)
        dynamicRegistrationStatus = "waitlist";

      // backend check if workshop is full. No longer needed for applicable.
      // counts.dynamicCounts.forEach(count => {
      //   const response = dynamicResponses[`${count.questionId}`];
      //   const dynamicWorkshopCount = count.counts.find(questionChoice => questionChoice.label === response);
      //   if (dynamicWorkshopCount.count && dynamicWorkshopCount.count.count === dynamicWorkshopCount.count.cap) {
      //     throw helpers.createResponse(401, {
      //       statusCode: 401,
      //       code: "WORKSHOP ERROR",
      //       message: `${response} is full!`
      //     });
      //   }
      // });
    }
    // try to send the registration and calendar emails 
    try {
      await sendEmail(user, existingEvent, dynamicRegistrationStatus);
    } catch (err) {
      // if email sending failed, that user's email probably does not exist
      throw helpers.createResponse(500, {
        statusCode: 500,
        code: "SES ERROR",
        message: `Sending Email Error!: ${err.message}`
      });
    }
  }

  const response = await createRegistration(
    dynamicRegistrationStatus,
    applicationStatus,
    data,
    email,
    eventIDAndYear,
    createNew
  );
  return response;
}

function removeDefaultKeys(data) {
  const formResponse = data;
  const ignoreKeys = ["eventID", "year", "email"];

  Object.keys(formResponse).forEach(function (key) {
    if (ignoreKeys.includes(key)) delete formResponse[key];
  });
  return formResponse;
}

async function createRegistration(
  registrationStatus,
  applicationStatus,
  data,
  email,
  eventIDAndYear,
  createNew
) {
  try {
    const formResponse = removeDefaultKeys(data);

    const updateObject = {
      ...formResponse
    };

    let conditionExpression =
      "attribute_exists(id) and attribute_exists(#eventIDYear)";
    // if we are creating a new object, the condition expression needs to be different
    if (createNew)
      conditionExpression =
        "attribute_not_exists(id) and attribute_not_exists(#eventIDYear)";

    // construct the update expressions
    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    } = db.createUpdateExpression(updateObject);

    // Because biztechRegistration table has a sort key, we cannot use helpers.updateDB()
    let params = {
      Key: {
        id: email,
        ["eventID;year"]: eventIDAndYear
      },
      TableName:
        USER_REGISTRATIONS_TABLE +
        (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: {
        ...expressionAttributeNames,
        "#eventIDYear": "eventID;year"
      },
      UpdateExpression: updateExpression,
      ReturnValues: "UPDATED_NEW",
      ConditionExpression: conditionExpression
    };

    // do the magic
    const res = await docClient.update(params).promise();
    let message = `User with email ${email} successfully registered (through update) to status '${registrationStatus}'!`;
    let statusCode = 200;

    // different status code if created new entry
    if (createNew) {
      message = `User with email ${email} successfully registered (created) to status '${registrationStatus}'!`;
      statusCode = 201;
    }

    const response = helpers.createResponse(statusCode, {
      registrationStatus,
      message,
      response: res
    });

    return response;
  } catch (err) {
    let errorResponse = db.dynamoErrorResponse(err);
    const errBody = JSON.parse(errorResponse.body);

    // customize the error messsage if it is caused by the 'ConditionExpression' check
    if (errBody.code === "ConditionalCheckFailedException") {
      errorResponse.statusCode = 409;
      errBody.statusCode = 409;
      if (createNew)
        errBody.message = `Create error because the registration entry for user '${email}' and with eventID;year'${eventIDAndYear}' already exists`;
      else
        errBody.message = `Update error because the registration entry for user '${email}' and with eventID;year '${eventIDAndYear}' does not exist`;
      errorResponse.body = JSON.stringify(errBody);
    }
    throw errorResponse;
  }
}

export async function sendEmail(user, existingEvent, userStatus, emailType = "") {
  if (userStatus === "incomplete" || userStatus === "rejected" || userStatus === "accepted") return;
  if (userStatus !== "checkedIn") {
    const userEmail = user.id;

    if (!userEmail) {
      throw {
        message: "User does not have an e-mail address!"
      };
    }

    // TODO: make partner specific email, no emails sent to partners as of now.
    const existingReg = await db.getOne(user.id, USER_REGISTRATIONS_TABLE, {
      "eventID;year": `${existingEvent.id};${existingEvent.year}`
    });
    if (existingReg.isPartner) {
      return;
    }

    const EmailService = new SESEmailService(awsConfig);
    await EmailService.sendDynamicQR(existingEvent, user, userStatus, emailType);
    if (emailType !== "application" && userStatus === "registered")
      await EmailService.sendCalendarInvite(existingEvent, user);
  }
}

export const post = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    if (!isValidEmail(data.email))
      throw helpers.inputError("Invalid email", data.email);
    helpers.checkPayloadProps(data, {
      email: {
        required: true,
        type: "string"
      },
      eventID: {
        required: true,
        type: "string"
      },
      year: {
        required: true,
        type: "number"
      },
      registrationStatus: {
        required: true,
        type: "string"
      }
    });
    const existingReg = await db.getOne(data.email, USER_REGISTRATIONS_TABLE, {
      "eventID;year": `${data.eventID};${data.year}`
    });
    if (existingReg) {
      if (existingReg.registrationStatus === "incomplete") {
        await updateHelper(data, false, data.email, data.fname);
        const response = helpers.createResponse(200, {
          message: "Redirect to link",
          url: existingReg.checkoutLink
        });

        callback(null, response);
        return response;
      } else {
        const response = helpers.createResponse(400, {
          message: "You are already registered for this event!"
        });

        callback(null, response);
        return response;
      }
    } else {
      const response = await updateHelper(data, true, data.email, data.fname);
      callback(null, response);
      return null;
    }
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

/**
 * Update a registration entry.
 * Side effect: Sends an email to the user if the registration status is changed to anything that is not Checked In.
 *
 * Args:
 *  event: The event object. It must contain the following:
 *      - pathParameters: object with the following properties
 *          - email: string
 *          - fname: string
 *      - body: object with the following properties
 *          - eventID: string
 *          - year: number
 *  ctx: The context object
 *  callback: The callback function
 *
 * Returns: The response object
 */
export const put = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.email)
      throw helpers.missingIdQueryResponse("user");

    const email = event.pathParameters.email;

    const data = JSON.parse(event.body);
    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);
    // Check that parameters are valid
    helpers.checkPayloadProps(data, {
      eventID: {
        required: true,
        type: "string"
      },
      year: {
        required: true,
        type: "number"
      },
      registrationStatus: {
        required: false,
        type: "string"
      },
      points: {
        required: false,
        type: "number"
      },
      applicationStatus: {
        required: false,
        type: "string"
      }
    });

    const response = await updateHelper(
      data,
      false,
      email,
      event.pathParameters.fname
    );

    callback(null, response);
    return null;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

// Return list of entries with the matching id
export const get = async (event, ctx, callback) => {
  try {
    const queryString = event.queryStringParameters;
    if (
      !queryString ||
      (!queryString.eventID && !queryString.year && !queryString.email)
    )
      throw helpers.missingIdQueryResponse("eventID/year/user ");

    const email = queryString.email;
    if (
      (queryString.eventID && !queryString.year) ||
      (!queryString.eventID && queryString.year)
    ) {
      throw helpers.missingIdQueryResponse(
        "eventID or year (must have both or neither)"
      );
    }
    let timeStampFilter;
    if (queryString.hasOwnProperty("afterTimestamp")) {
      timeStampFilter = Number(queryString.afterTimestamp);
      const d = new Date(timeStampFilter);
      console.log("Getting registration on and after ", d.toLocaleString());
    }

    let registrations = [];

    // if eventID and year was given
    if (
      queryString.hasOwnProperty("eventID") &&
      queryString.hasOwnProperty("year")
    ) {
      const eventIDAndYear = queryString.eventID + ";" + queryString.year;
      const filterExpression = {
        FilterExpression: "#eventIDyear = :query",
        ExpressionAttributeNames: {
          "#eventIDyear": "eventID;year"
        },
        ExpressionAttributeValues: {
          ":query": eventIDAndYear
        }
      };
      registrations = await db.scan(USER_REGISTRATIONS_TABLE, filterExpression);

      // filter by id query, if given
      if (queryString.hasOwnProperty("email")) {
        registrations = registrations.filter((entry) => entry.id === email);
      }
    } else {
      // if eventID and year was not given (only id)

      const filterExpression = {
        FilterExpression: "id = :query",
        ExpressionAttributeValues: {
          ":query": email
        }
      };
      registrations = await db.scan(USER_REGISTRATIONS_TABLE, filterExpression);
    }

    // filter by timestamp, if given
    if (timeStampFilter) {
      registrations = registrations.filter(
        (entry) => entry.updatedAt > timeStampFilter
      );
    }

    // filter by partner, if given
    if (queryString.hasOwnProperty("isPartner")) {
      const isPartner = queryString.isPartner === "true";
      registrations = registrations.filter(
        (entry) => entry.isPartner === isPartner
      );
    }

    const response = helpers.createResponse(200, {
      size: registrations.length,
      data: registrations
    });
    callback(null, response);
    return null;
  } catch (err) {
    callback(null, err);
    return null;
  }
};

// (used for testing)
export const del = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    if (!event.pathParameters || !event.pathParameters.email)
      throw helpers.missingIdQueryResponse("registration");

    const email = event.pathParameters.email;
    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);
    helpers.checkPayloadProps(data, {
      eventID: {
        required: true,
        type: "string"
      },
      year: {
        required: true,
        type: "number"
      }
    });

    const eventIDAndYear = data.eventID + ";" + data.year;

    const res = await db.deleteOne(email, USER_REGISTRATIONS_TABLE, {
      ["eventID;year"]: eventIDAndYear
    });

    const response = helpers.createResponse(200, {
      message: "Registration entry Deleted!",
      response: res
    });

    callback(null, response);
    return null;
  } catch (err) {
    callback(null, err);
    return null;
  }
};

export const leaderboard = async (event, ctx, callback) => {
  try {
    const queryString = event.queryStringParameters;
    if (
      !queryString || (!queryString.eventID && !queryString.year)
    ) {
      throw helpers.missingIdQueryResponse("eventID/year");
    }
    // if eventID and year was given
    if (
      queryString.hasOwnProperty("eventID") &&
      queryString.hasOwnProperty("year")
    ) {
      const eventIDAndYear = queryString.eventID + ";" + queryString.year;
      const filterExpression = {
        FilterExpression: "#eventIDyear = :query",
        ExpressionAttributeNames: {
          "#eventIDyear": "eventID;year"
        },
        ExpressionAttributeValues: {
          ":query": eventIDAndYear
        }
      };

      let registrations = await db.scan(USER_REGISTRATIONS_TABLE, filterExpression);
      registrations = registrations.filter(user => {
        if (user.points !== undefined) {
          return user.points > 0;
        }
        return false;
      }).map(user => {
        return {
          points: user.points,
          fname: user.basicInformation.fname,
          lname: user.basicInformation.lname
        };
      });
      registrations.sort((a, b) => b.points - a.points);
      return helpers.createResponse(200, registrations);
    }
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error"
      }),
    };
  }
};
