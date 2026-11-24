import docClient from "../../lib/docClient";
import registrationHelpers from "./helpers";
import helpers from "../../lib/handlerHelpers";
import { sendSNSNotification } from "../../lib/snsHelper";
import db from "../../lib/db";
import { protect, Access } from "../../lib/auth";
import { isEmpty, isValidEmail } from "../../lib/utils";
import {
  EVENTS_TABLE,
  MEMBERS_TABLE,
  USER_REGISTRATIONS_TABLE
} from "../../constants/tables";
import SESEmailService from "./EmailService/SESEmailService";
import awsConfig from "../../lib/config";
import { REGISTRATION_STATUS, STATUS_FIELD } from "./constants";

// const CHECKIN_COUNT_SANITY_CHECK = 500;

const normalizePartnerRegistration = (partner = {}) => ({
  email: partner.email ? partner.email.trim().toLowerCase() : "",
  firstName: (partner.firstName || partner.fname || "").trim(),
  lastName: (partner.lastName || partner.lname || "").trim()
});

const validatePartnerRegistration = (partner) => {
  if (!isValidEmail(partner.email)) return "Invalid email";
  if (!partner.firstName) return "Missing firstName";
  if (!partner.lastName) return "Missing lastName";
  return null;
};

const BULK_UPDATE_CHUNK_SIZE = 50;

const summarizePartnerRegistrationResults = (results) => {
  return results.reduce(
    (summary, result) => {
      summary[result.status] += 1;
      return summary;
    },
    {
      created: 0,
      skipped: 0,
      failed: 0
    }
  );
};

// BatchWrite cannot do conditions, so a txn blocks deleting a registration that is on a team
async function deleteBtxRegistrations(emails, eventKey) {
  const uniqueEmails = [...new Set(emails)];
  if (uniqueEmails.length === 0) return {};
  if (uniqueEmails.length > 100) {
    throw helpers.createResponse(400, { message: "Delete up to 100 BTX registrations at a time." });
  }
  try {
    return await db.txn(...uniqueEmails.map(id =>
      db.build.delete(USER_REGISTRATIONS_TABLE, {
        id,
        "eventID;year": eventKey
      })
        .if("teamID").notExists()
    ));
  } catch (error) {
    if (db.isConflict(error)) {
      throw helpers.createResponse(409, {
        message: "A registration is on a team or changed. Leave the team before deleting it, then retry."
      });
    }
    throw error;
  }
}

/* returns error 403 if the given id/eventID DNE in database
   returns error 502 if there is a problem with processing data or sending an email
   returns 201 when entry is created successfully, error 409 if a registration with the same id/eventID exists
   returns 200 when entry is updated successfully, error 409 if a registration with the same id/eventID DNE
   sends an email to the user if registration status is included in data, and
     if they are registered, waitlisted, or cancelled, but not if checkedIn
*/
export async function updateHelper(
  data,
  createNew,
  email,
  fname,
  isAcceptancePayment = false,
  { existingEvent, batchCapacity } = {}
) {
  const {
    eventID,
    year,
    dynamicResponses,
    registrationStatus,
    applicationStatus
  } = data;
  const eventIDAndYear = eventID + ";" + year;

  // Normalize email to lowercase
  const normalizedEmail = email.toLowerCase();

  console.log(data);
  console.log("CloudWatch debugging purposes");

  // for the QR code, we pass this to SendGrid
  const id = `${normalizedEmail};${eventIDAndYear};${fname}`;

  //Check if eventID exists and is string. Check if year exists and is number.
  if (
    typeof eventID !== "string" ||
    typeof year !== "number" ||
    isNaN(year) ||
    !isValidEmail(normalizedEmail)
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
  existingEvent ??= await db.getOne(eventID, EVENTS_TABLE, {
    year
  });
  if (isEmpty(existingEvent))
    throw helpers.notFoundResponse("Event", eventID, year);

  if (existingEvent.btxEnabled === true && data.teamID !== undefined) {
    throw helpers.createResponse(400, { message: "Team membership must be changed using the team endpoints." });
  }

  const user = {
    id: normalizedEmail,
    fname
  };
  let dynamicRegistrationStatus = registrationStatus;
  // always check application status first, if not null then we send a application status email, else send regular
  if (applicationStatus) {
    try {
      if (!data.isPartner && !isAcceptancePayment) {
        await sendEmail(
          user,
          existingEvent,
          applicationStatus,
          id,
          "application"
        );
      }
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
    if (dynamicRegistrationStatus === REGISTRATION_STATUS.REGISTERED) {
      let counts = batchCapacity;
      counts ??= await registrationHelpers.getEventCounts(eventID, year);
      if (!counts) {
        throw db.dynamoErrorResponse({
          code: "DYNAMODB ERROR",
          time: new Date().getTime()
        });
      }

      const registeredCount = counts.registeredIds?.size ?? counts.registeredCount;
      const alreadyRegistered = counts.registeredIds?.has(normalizedEmail);
      const capacity = batchCapacity ? batchCapacity.capacity : existingEvent.capac;
      if (!alreadyRegistered && registeredCount >= capacity)
        dynamicRegistrationStatus = REGISTRATION_STATUS.WAITLIST;

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
      if (!data.isPartner) {
        await sendEmail(user, existingEvent, dynamicRegistrationStatus);
      }
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
    normalizedEmail,
    eventIDAndYear,
    createNew
  );

  if (batchCapacity && dynamicRegistrationStatus) {
    if (dynamicRegistrationStatus === REGISTRATION_STATUS.REGISTERED && !batchCapacity.partnerIds.has(normalizedEmail)) {
      batchCapacity.registeredIds.add(normalizedEmail);
    } else {
      batchCapacity.registeredIds.delete(normalizedEmail);
    }
  }

  // Slack SNS notification
  try {
    await sendSNSNotification({
      type: "registration_update",
      email: normalizedEmail,
      eventID,
      year,
      registrationStatus: dynamicRegistrationStatus,
      applicationStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(
      "Failed to send SNS notification for registration update:",
      error
    );
  }

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

    if (registrationStatus !== undefined) updateObject.registrationStatus = registrationStatus;

    if (createNew) {
      updateObject["createdAt"] = new Date().getTime();
    }

    // HARCODED FOR KICKSTART 2025
    if (eventIDAndYear === "kickstart;2025") {
      updateObject["balance"] = 50000;
    }

    if (eventIDAndYear === "kickstart-showcase;2025") {
      updateObject["balance"] = 100000;
    }

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

    const res = await db.updateDBCustom(params);
    const applicationOnly = Boolean(applicationStatus) && registrationStatus === undefined;
    let message = `User with email ${email} successfully registered (through update) to status '${registrationStatus}'!`;
    let statusCode = 200;

    // different status code if created new entry
    if (createNew) {
      message = `User with email ${email} successfully registered (created) to status '${registrationStatus}'!`;
      statusCode = 201;
    } else if (applicationOnly) {
      message = `User with email ${email} successfully updated application status to '${applicationStatus}'!`;
    }

    const response = helpers.createResponse(statusCode, {
      ...(applicationOnly ? { applicationStatus } : { registrationStatus }),
      message,
      response: res
    });

    return response;
  } catch (err) {
    let errorResponse = db.dynamoErrorResponse(err);
    const errBody = JSON.parse(errorResponse.body);

    // customize the error messsage if it is caused by the 'ConditionExpression' check
    if (
      errBody.statusCode === 502 ||
      errBody.code === "ConditionalCheckFailedException"
    ) {
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

export async function sendEmail(
  user,
  existingEvent,
  userStatus,
  emailType = ""
) {
  if (
    userStatus === REGISTRATION_STATUS.INCOMPLETE ||
    userStatus === REGISTRATION_STATUS.REJECTED ||
    userStatus === REGISTRATION_STATUS.ACCEPTED ||
    userStatus === REGISTRATION_STATUS.ACCEPTED_PENDING
  )
    return;
  if (userStatus !== REGISTRATION_STATUS.CHECKED_IN) {
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
    if (existingReg && existingReg.isPartner) {
      return;
    }
    const statusField = emailType === "application"
      ? STATUS_FIELD.APPLICATION
      : STATUS_FIELD.REGISTRATION;
    if (existingReg && existingReg[statusField] === userStatus) {
      return;
    }

    const EmailService = new SESEmailService(awsConfig);
    if (userStatus === REGISTRATION_STATUS.ACCEPTED_COMPLETE) {
      await EmailService.sendCalendarInvite(existingEvent, user, userStatus);
      return;
    }

    await EmailService.sendDynamicQR(
      existingEvent,
      user,
      userStatus,
      emailType
    );
    if (userStatus === REGISTRATION_STATUS.REGISTERED)
      await EmailService.sendCalendarInvite(existingEvent, user, userStatus);
  }
}

export const post = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);
    // Normalize email to lowercase
    data.email = data.email.toLowerCase();

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

    // Check if event exists first
    const eventExists = await db.getOne(data.eventID, EVENTS_TABLE, {
      year: data.year
    });

    if (!eventExists) {
      return helpers.createResponse(404, {
        message: `Event with id '${data.eventID}' and year '${data.year}' could not be found.`
      });
    }

    const existingReg = await db.getOne(data.email, USER_REGISTRATIONS_TABLE, {
      "eventID;year": `${data.eventID};${data.year}`
    });
    if (existingReg) {
      if (existingReg.registrationStatus === REGISTRATION_STATUS.INCOMPLETE) {
        await updateHelper(data, false, data.email, data.fname);
        return helpers.createResponse(200, {
          message: "Redirect to link",
          url: existingReg.checkoutLink
        });
      } else {
        return helpers.createResponse(400, {
          message: "You are already registered for this event!"
        });
      }
    } else {
      return await updateHelper(data, true, data.email, data.fname);
    }
  } catch (err) {
    console.error(err);

    // Known/intentional HTTP error
    if (err && err.statusCode && err.body) {
      return err;
    }

    // Unexpected internal error
    return helpers.createResponse(500, {
      message: (err && err.message) || "Internal server error"
    });
  }
};

export const createPartnerRegistrations = protect(Access.ADMIN, async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body || "{}");
    const { eventID, year } = data;

    if (typeof eventID !== "string") {
      return helpers.inputError("eventID must be a string", data);
    }

    if (typeof year !== "number" || isNaN(year)) {
      return helpers.inputError("year must be a number", data);
    }

    if (!Array.isArray(data.partners)) {
      return helpers.inputError("partners must be an array", data);
    }

    const existingEvent = await db.getOne(eventID, EVENTS_TABLE, {
      year
    });
    if (isEmpty(existingEvent)) {
      return helpers.createResponse(404, {
        message: `Event with id '${eventID}' and year '${year}' could not be found.`
      });
    }

    const results = await Promise.all(data.partners.map(async (partnerData) => {
      const partner = normalizePartnerRegistration(partnerData);
      const validationError = validatePartnerRegistration(partner);
      if (validationError) {
        return {
          email: partner.email,
          status: "failed",
          reason: validationError
        };
      }

      const existingRegistration = await db.getOne(
        partner.email,
        USER_REGISTRATIONS_TABLE,
        {
          "eventID;year": `${eventID};${year}`
        }
      );
      if (!isEmpty(existingRegistration)) {
        return {
          email: partner.email,
          status: "skipped",
          reason: "registration already exists"
        };
      }

      try {
        await updateHelper(
          {
            eventID,
            year,
            email: partner.email,
            fname: partner.firstName,
            registrationStatus: REGISTRATION_STATUS.ACCEPTED_COMPLETE,
            isPartner: true
          },
          true,
          partner.email,
          partner.firstName
        );

        return {
          email: partner.email,
          status: "created"
        };
      } catch (err) {
        const body = err && err.body ? JSON.parse(err.body) : {};
        return {
          email: partner.email,
          status: "failed",
          reason:
            body.code ||
            body.message ||
            (err && err.message) ||
            "Failed to create partner registration"
        };
      }
    }));

    return helpers.createResponse(200, {
      eventID,
      year,
      ...summarizePartnerRegistrationResults(results),
      results
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, {
      message: err.message || "Internal server error"
    });
  }
});

async function updateExistingRegistration(data, email, fname, batchCapacity) {
  const existingEvent = await db.getOne(data.eventID, EVENTS_TABLE, {
    year: data.year
  });

  if (!existingEvent) {
    throw helpers.createResponse(404, {
      message: `Event with id '${data.eventID}' and year '${data.year}' could not be found.`
    });
  }
  if (data.registrationStatus === REGISTRATION_STATUS.REGISTERED && batchCapacity === null) {
    throw new Error("Could not check event capacity");
  }

  if (data.registrationStatus === REGISTRATION_STATUS.ACCEPTED) {
    const member = await db.getOne(email, MEMBERS_TABLE);
    const pricing = isEmpty(member)
      ? existingEvent.pricing?.nonMembers
      : existingEvent.pricing?.members;

    if ((pricing ?? 0) === 0) {
      data.registrationStatus = REGISTRATION_STATUS.ACCEPTED_PENDING;
    }
  }

  return updateHelper(data, false, email, fname, false, { existingEvent, batchCapacity });
}

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

    // API Gateway can forward URL-encoded path parameters. Decode once before
    // validating or looking up the registration; preserve literal + characters.
    let email;
    let fname;
    try {
      email = decodeURIComponent(event.pathParameters.email).toLowerCase();
      fname = event.pathParameters.fname
        ? decodeURIComponent(event.pathParameters.fname)
        : undefined;
    } catch {
      throw helpers.inputError("Invalid registration path parameters");
    }

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

    return await updateExistingRegistration(data, email, fname);
  } catch (err) {
    console.error(err);
    if (err && err.statusCode && err.body) {
      return err;
    }

    return helpers.createResponse(500, {
      message: (err && err.message) || "Internal server error"
    });
  }
};

async function applyBulkRegistrationUpdate(update, eventID, year, batchCapacity) {
  const { email, fname, registrationStatus, applicationStatus } = update ?? {};
  try {
    if (typeof email !== "string" || !isValidEmail(email)) {
      throw new Error("Invalid email");
    }
    const updatesRegistration = registrationStatus !== undefined;
    if (updatesRegistration && (
      applicationStatus !== undefined ||
      registrationStatus === REGISTRATION_STATUS.REJECTED ||
      !Object.values(REGISTRATION_STATUS).includes(registrationStatus)
    )) {
      throw new Error("Provide a valid registrationStatus by itself");
    }
    if (!updatesRegistration && (typeof applicationStatus !== "string" || !applicationStatus)) {
      throw new Error("Provide an applicationStatus or registrationStatus");
    }
    const updateData = {
      eventID,
      year,
      email,
      ...(updatesRegistration ? { registrationStatus } : { applicationStatus })
    };
    const response = await updateExistingRegistration(updateData, email.toLowerCase(), fname, batchCapacity);
    if (!updatesRegistration) {
      return {
        success: true,
        email,
        response
      };
    }
    const saved = JSON.parse(response.body);
    return {
      success: true,
      email,
      registrationStatus: saved.response?.Attributes?.registrationStatus ?? saved.registrationStatus,
      response
    };
  } catch (error) {
    const message = error.message || (error.body && JSON.parse(error.body).message);
    return {
      success: false,
      email,
      error: message || "Failed to update registration"
    };
  }
}

function nextBulkUpdateChunk(updates, offset, batchCapacity) {
  const registering = updates[offset]?.registrationStatus === REGISTRATION_STATUS.REGISTERED;
  const remainingSeats = batchCapacity && registering
    ? Math.ceil(batchCapacity.capacity - batchCapacity.registeredIds.size)
    : 0;
  const limit = remainingSeats > 0
    ? Math.min(remainingSeats, BULK_UPDATE_CHUNK_SIZE)
    : BULK_UPDATE_CHUNK_SIZE;

  const chunk = [];
  const emails = new Set();
  for (const update of updates.slice(offset, offset + limit)) {
    const registers = update?.registrationStatus === REGISTRATION_STATUS.REGISTERED;
    // Keep seat-consuming and seat-releasing updates in request order.
    if (batchCapacity && registers !== registering) break;
    const email = typeof update?.email === "string" ? update.email.toLowerCase() : "";
    if (email && emails.has(email)) break;
    emails.add(email);
    chunk.push(update);
  }
  return chunk;
}

// Apply each administrative update independently, reporting per-row results.
export const massUpdate = protect(Access.ADMIN, async (event) => {
  try {
    const data = JSON.parse(event.body || "{}") ?? {};
    helpers.checkPayloadProps(data, {
      eventID: {
        required: true,
        type: "string"
      },
      eventYear: {
        required: true,
        type: "number"
      },
      updates: {
        required: true,
        type: "object"
      }
    });
    const { eventID, eventYear, updates } = data;
    if (!eventID || !Number.isInteger(eventYear) || !Array.isArray(updates)) {
      throw helpers.inputError("Expected an event ID, integer event year, and array of updates");
    }

    const tracksCapacity = updates.some((update) => update?.registrationStatus === REGISTRATION_STATUS.REGISTERED);
    const batchCapacity = tracksCapacity
      ? await registrationHelpers.getEventCounts(eventID, eventYear, true)
      : undefined;

    const results = [];
    let offset = 0;
    while (offset < updates.length) {
      const chunk = nextBulkUpdateChunk(updates, offset, batchCapacity);
      const chunkResults = await Promise.all(chunk.map((update) =>
        applyBulkRegistrationUpdate(update, eventID, eventYear, batchCapacity)
      ));
      results.push(...chunkResults);
      offset += chunk.length;
    }

    return helpers.createResponse(200, { results });
  } catch (error) {
    if (error?.statusCode && error.body) return error;
    console.error("Mass update failed", error);
    return helpers.createResponse(500, {
      error: "Internal server error"
    });
  }
});

// Return list of entries with the matching id
export const get = async (event, ctx, callback) => {
  try {
    const queryString = event.queryStringParameters;
    if (
      !queryString ||
      (!queryString.eventID && !queryString.year && !queryString.email)
    )
      throw helpers.missingIdQueryResponse("eventID/year/user ");

    let registrations = [];

    if (queryString.email) {
      // Normalize email to lowercase
      const normalizedEmail = queryString.email.toLowerCase();
      // Query by email (primary key)
      const keyCondition = {
        expression: "id = :id",
        expressionValues: {
          ":id": normalizedEmail
        }
      };
      registrations = await db.query(
        USER_REGISTRATIONS_TABLE,
        null,
        keyCondition
      );

      // If eventID and year are provided, filter results
      if (queryString.eventID && queryString.year) {
        const eventIDYear = `${queryString.eventID};${queryString.year}`;
        registrations = registrations.filter(
          (reg) => reg["eventID;year"] === eventIDYear
        );
      }
    } else if (queryString.eventID && queryString.year) {
      // Query by eventID;year using GSI
      const eventIDYear = `${queryString.eventID};${queryString.year}`;
      const keyCondition = {
        expression: "#eventIDYear = :eventIDYear",
        expressionNames: {
          "#eventIDYear": "eventID;year"
        },
        expressionValues: {
          ":eventIDYear": eventIDYear
        }
      };

      registrations = await db.query(
        USER_REGISTRATIONS_TABLE,
        "event-query",
        keyCondition
      );
    }

    // filter by timestamp, if given
    if (queryString.hasOwnProperty("afterTimestamp")) {
      const timeStampFilter = Number(queryString.afterTimestamp);
      registrations = registrations.filter(
        (entry) => entry.updatedAt > timeStampFilter
      );
    }

    return helpers.createResponse(200, {
      size: registrations.length,
      data: registrations
    });
  } catch (err) {
    console.error("Error in get handler:", err);
    if (err && err.statusCode && err.body) {
      return err;
    }

    return helpers.createResponse(500, {
      message: (err && err.message) || "Internal server error"
    });
  }
};

// (used for testing)
export const del = protect(Access.USER, async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    if (!event.pathParameters || !event.pathParameters.email)
      throw helpers.missingIdQueryResponse("registration");

    // Normalize email to lowercase
    const email = event.pathParameters.email.toLowerCase();
    if (!isValidEmail(email)) throw helpers.inputError("Invalid email", email);

    // Only the owner (or an admin) may delete this registration.
    if (!event.auth.isAdmin && email !== event.auth.email)
      return helpers.createResponse(403, {
        message: "You can only delete your own registration"
      });
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

    const eventRecord = await db.getOne(data.eventID, EVENTS_TABLE, { year: data.year });
    const res = eventRecord?.btxEnabled === true
      ? await deleteBtxRegistrations([email], eventIDAndYear)
      : await db.deleteOne(email, USER_REGISTRATIONS_TABLE, {
        ["eventID;year"]: eventIDAndYear
      });

    return helpers.createResponse(200, {
      message: "Registration entry Deleted!",
      response: res
    });
  } catch (err) {
    if (err && err.statusCode && err.body) {
      return err;
    }

    return helpers.createResponse(500, {
      message: (err && err.message) || "Internal server error"
    });
  }
});

export const delMany = protect(Access.ADMIN, async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      ids: {
        required: true,
        type: "object"
      },
      eventID: {
        required: true,
        type: "string"
      },
      year: {
        required: true,
        type: "number"
      }
    });

    if (!Array.isArray(data.ids))
      throw helpers.inputError("Ids must be an array", data.ids);

    const lowercaseEmails = data.ids
      .map((email) => email.toLowerCase())
      .filter(isValidEmail);

    const eventIDAndYear = data.eventID + ";" + data.year;

    const itemsToDelete = lowercaseEmails.map((email) => ({
      id: email, // partition key
      ["eventID;year"]: `${eventIDAndYear}` // sort key
    }));

    const eventRecord = await db.getOne(data.eventID, EVENTS_TABLE, { year: data.year });
    const res = eventRecord?.btxEnabled === true
      ? await deleteBtxRegistrations(lowercaseEmails, eventIDAndYear)
      : await db.batchDelete(itemsToDelete, USER_REGISTRATIONS_TABLE);

    return helpers.createResponse(200, {
      message: "Registration entry Deleted!",
      response: res
    });
  } catch (err) {
    if (err && err.statusCode && err.body) {
      return err;
    }

    return helpers.createResponse(500, {
      message: (err && err.message) || "Internal server error"
    });
  }
});

export const leaderboard = async (event, ctx, callback) => {
  try {
    const queryString = event.queryStringParameters;
    if (!queryString || (!queryString.eventID && !queryString.year)) {
      throw helpers.missingIdQueryResponse("eventID/year");
    }

    if (
      queryString.hasOwnProperty("eventID") &&
      queryString.hasOwnProperty("year")
    ) {
      const eventIDAndYear = queryString.eventID + ";" + queryString.year;
      const keyCondition = {
        expression: "#eventIDYear = :query",
        expressionNames: {
          "#eventIDYear": "eventID;year"
        },
        expressionValues: {
          ":query": eventIDAndYear
        }
      };

      let registrations = await db.query(
        USER_REGISTRATIONS_TABLE,
        "event-query",
        keyCondition
      );
      registrations = registrations
        .filter((user) => {
          if (user.points !== undefined) {
            return user.points > 0;
          }
          return false;
        })
        .map((user) => {
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

    if (error && error.statusCode && error.body) {
      return error;
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error"
      })
    };
  }
};
