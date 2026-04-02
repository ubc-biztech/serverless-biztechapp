import eventHelpers from "./helpers";
import feedbackHelpers from "./feedbackHelpers";
import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import {
  alphabeticalComparer, dateComparer, isEmpty, isValidEmail
} from "../../lib/utils";
import {
  MAX_BATCH_ITEM_COUNT
} from "../../constants/dynamodb";
import {
  EVENTS_TABLE,
  EVENT_FEEDBACK_TABLE,
  USERS_TABLE,
  USER_REGISTRATIONS_TABLE
} from "../../constants/tables";
import {
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

const S3 = new S3Client({
  region: "us-west-2"
});

const THUMBNAIL_BUCKET = "biztech-event-images";
const {
  parseFormType,
  ensureDefaultOverallRatingQuestion,
  getFeedbackQuestionsForType,
  isFeedbackEnabledForType,
  normalizeFeedbackQuestions,
  validateFeedbackPayload,
  normalizeText
} = feedbackHelpers;

export const create = async (event, ctx, callback) => {
  try {
    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body);
    if (data.hasOwnProperty("attendeeFeedbackQuestions") &&
      !Array.isArray(data.attendeeFeedbackQuestions)) {
      return helpers.createResponse(406, {
        message: "attendeeFeedbackQuestions must be an array."
      });
    }
    if (data.hasOwnProperty("partnerFeedbackQuestions") &&
      !Array.isArray(data.partnerFeedbackQuestions)) {
      return helpers.createResponse(406, {
        message: "partnerFeedbackQuestions must be an array."
      });
    }

    const attendeeFeedbackQuestions = Array.isArray(data.attendeeFeedbackQuestions)
      ? data.attendeeFeedbackQuestions
      : [];
    const partnerFeedbackQuestions = Array.isArray(data.partnerFeedbackQuestions)
      ? data.partnerFeedbackQuestions
      : [];

    const attendeeQuestionValidation = normalizeFeedbackQuestions(
      attendeeFeedbackQuestions,
      "attendee"
    );
    if (!attendeeQuestionValidation.isValid) {
      return helpers.createResponse(406, {
        message: attendeeQuestionValidation.error
      });
    }

    const partnerQuestionValidation = normalizeFeedbackQuestions(
      partnerFeedbackQuestions,
      "partner"
    );
    if (!partnerQuestionValidation.isValid) {
      return helpers.createResponse(406, {
        message: partnerQuestionValidation.error
      });
    }

    const normalizedAttendeeQuestions = ensureDefaultOverallRatingQuestion(
      attendeeQuestionValidation.questions
    );
    const normalizedPartnerQuestions = ensureDefaultOverallRatingQuestion(
      partnerQuestionValidation.questions
    );

    const attendeeFeedbackEnabled = Boolean(data.attendeeFeedbackEnabled);
    const partnerFeedbackEnabled = Boolean(data.partnerFeedbackEnabled);
    if (attendeeFeedbackEnabled && normalizedAttendeeQuestions.length === 0) {
      return helpers.createResponse(406, {
        message: "Enable attendee feedback only after adding at least one attendee feedback question."
      });
    }
    if (partnerFeedbackEnabled && normalizedPartnerQuestions.length === 0) {
      return helpers.createResponse(406, {
        message: "Enable partner feedback only after adding at least one partner feedback question."
      });
    }

    helpers.checkPayloadProps(data, {
      id: {
        required: true
      },
      year: {
        required: true,
        type: "number"
      },
      capac: {
        required: true,
        type: "number"
      }
    });

    const existingEvent = await db.getOne(data.id, EVENTS_TABLE, {
      year: data.year
    });
    if (!isEmpty(existingEvent))
      throw helpers.duplicateResponse("event id and year", data);
    const item = {
      id: data.id,
      year: data.year,
      ename: data.ename,
      description: data.description,
      partnerDescription: data.partnerDescription,
      startDate: data.startDate,
      endDate: data.endDate,
      deadline: data.deadline,
      capac: data.capac,
      facebookUrl: data.facebookUrl,
      imageUrl: data.imageUrl,
      elocation: data.elocation,
      longitude: data.longitude,
      latitude: data.latitude,
      pricing: data.pricing,
      createdAt: timestamp,
      updatedAt: timestamp,
      requiredTextFields: data.requiredTextFields,
      unrequiredTextFields: data.unrequiredTextFields,
      requiredSelectFields: data.requiredSelectFields,
      unrequiredSelectFields: data.unrequiredSelectFields,
      requiredCheckBoxFields: data.requiredCheckBoxFields,
      unrequiredCheckBoxFields: data.unrequiredCheckBoxFields,
      isPublished: data.isPublished,
      feedback: data.feedback,
      isApplicationBased: data.isApplicationBased,
      nonBizTechAllowed: data.nonBizTechAllowed,
      attendeeFeedbackEnabled,
      partnerFeedbackEnabled,
      attendeeFeedbackQuestions: normalizedAttendeeQuestions,
      partnerFeedbackQuestions: normalizedPartnerQuestions
    };

    if (Array.isArray(data.registrationQuestions)) {
      item.registrationQuestions = eventHelpers.addIdsToRegistrationQuestions(
        data.registrationQuestions
      );
    }

    if (Array.isArray(data.partnerRegistrationQuestions)) {
      item.partnerRegistrationQuestions =
        eventHelpers.addIdsToRegistrationQuestions(
          data.partnerRegistrationQuestions
        );
    }

    const res = await db.create(item, EVENTS_TABLE);

    const response = helpers.createResponse(201, {
      message: `Created event with id ${data.id} for the year ${data.year}!`,
      response: res,
      item
    });

    return response;
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: err.message || err });
  }
};

// DELETE /events/{id}/{year}
// eslint-disable-next-line
export const del = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("event");
    const id = event.pathParameters.id;
    if (!event.pathParameters.year)
      throw helpers.missingPathParamResponse("event", "year");

    const year = parseInt(event.pathParameters.year, 10);
    if (isNaN(year))
      throw helpers.inputError(
        "Year path parameter must be a number",
        event.pathParameters
      );

    const existingEvent = await db.getOne(id, EVENTS_TABLE, {
      year
    });
    if (isEmpty(existingEvent)) throw helpers.notFoundResponse("event", id);
    const res = await db.deleteOne(id, EVENTS_TABLE, {
      year
    });

    const response = helpers.createResponse(200, {
      message: `Deleted event with id '${id}' for the year ${year}!`,
      response: res
    });

    return response;
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: err.message || err });
  }
};

export const getAll = async (event, ctx, callback) => {
  try {
    // Set context callbackWaitsForEmptyEventLoop to false to prevent Lambda from waiting
    ctx.callbackWaitsForEmptyEventLoop = false;

    // scan using the GSI
    let events = await db.scan(EVENTS_TABLE, {
    }, "event-overview");

    // Filter by ID if provided
    if (
      event &&
      event.queryStringParameters &&
      event.queryStringParameters.hasOwnProperty("id")
    ) {
      events = events.filter(
        (eventItem) => eventItem.id === event.queryStringParameters.id
      );
    }

    // sort by startDate
    events.sort(alphabeticalComparer("startDate"));

    const response = helpers.createResponse(200, events);
    return response;
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: err.message || err });
  }
};

// PATCH events/{id}/{year}
export const update = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("event");
    const id = event.pathParameters.id;
    if (!event.pathParameters.year)
      throw helpers.missingPathParamResponse("event", "year");

    const year = parseInt(event.pathParameters.year, 10);
    if (isNaN(year))
      throw helpers.inputError(
        "Year path parameter must be a number",
        event.pathParameters
      );

    const existingEvent = await db.getOne(id, EVENTS_TABLE, {
      year
    });
    if (isEmpty(existingEvent))
      throw helpers.notFoundResponse("event", id, year);
    const data = JSON.parse(event.body);
    if (data.hasOwnProperty("attendeeFeedbackQuestions") &&
      !Array.isArray(data.attendeeFeedbackQuestions)) {
      return helpers.createResponse(406, {
        message: "attendeeFeedbackQuestions must be an array."
      });
    }
    if (data.hasOwnProperty("partnerFeedbackQuestions") &&
      !Array.isArray(data.partnerFeedbackQuestions)) {
      return helpers.createResponse(406, {
        message: "partnerFeedbackQuestions must be an array."
      });
    }

    if (Array.isArray(data.registrationQuestions)) {
      for (let i = 0; i < data.registrationQuestions.length; i++) {
        if (!data.registrationQuestions[i].questionId) {
          data.registrationQuestions[i] =
            eventHelpers.addIdsToRegistrationQuestions([
              data.registrationQuestions[i]
            ])[0];
        }
      }
    }

    if (Array.isArray(data.partnerRegistrationQuestions)) {
      for (let i = 0; i < data.partnerRegistrationQuestions.length; i++) {
        if (!data.partnerRegistrationQuestions[i].questionId) {
          data.partnerRegistrationQuestions[i] =
            eventHelpers.addIdsToRegistrationQuestions([
              data.partnerRegistrationQuestions[i]
            ])[0];
        }
      }
    }

    if (Array.isArray(data.partnerFeedbackQuestions)) {
      const partnerQuestionValidation = normalizeFeedbackQuestions(
        data.partnerFeedbackQuestions,
        "partner"
      );
      if (!partnerQuestionValidation.isValid) {
        return helpers.createResponse(406, {
          message: partnerQuestionValidation.error
        });
      }
      data.partnerFeedbackQuestions = ensureDefaultOverallRatingQuestion(
        partnerQuestionValidation.questions
      );
    }

    if (Array.isArray(data.attendeeFeedbackQuestions)) {
      const attendeeQuestionValidation = normalizeFeedbackQuestions(
        data.attendeeFeedbackQuestions,
        "attendee"
      );
      if (!attendeeQuestionValidation.isValid) {
        return helpers.createResponse(406, {
          message: attendeeQuestionValidation.error
        });
      }
      data.attendeeFeedbackQuestions = ensureDefaultOverallRatingQuestion(
        attendeeQuestionValidation.questions
      );
    }

    const resolvedAttendeeFeedbackEnabled = data.hasOwnProperty("attendeeFeedbackEnabled")
      ? Boolean(data.attendeeFeedbackEnabled)
      : Boolean(existingEvent.attendeeFeedbackEnabled);
    const resolvedPartnerFeedbackEnabled = data.hasOwnProperty("partnerFeedbackEnabled")
      ? Boolean(data.partnerFeedbackEnabled)
      : Boolean(existingEvent.partnerFeedbackEnabled);

    const resolvedAttendeeQuestions = ensureDefaultOverallRatingQuestion(
      data.hasOwnProperty("attendeeFeedbackQuestions")
        ? data.attendeeFeedbackQuestions
        : Array.isArray(existingEvent.attendeeFeedbackQuestions)
          ? existingEvent.attendeeFeedbackQuestions
          : []
    );

    const resolvedPartnerQuestions = ensureDefaultOverallRatingQuestion(
      data.hasOwnProperty("partnerFeedbackQuestions")
        ? data.partnerFeedbackQuestions
        : Array.isArray(existingEvent.partnerFeedbackQuestions)
          ? existingEvent.partnerFeedbackQuestions
          : []
    );

    data.attendeeFeedbackQuestions = resolvedAttendeeQuestions;
    data.partnerFeedbackQuestions = resolvedPartnerQuestions;

    if (resolvedAttendeeFeedbackEnabled && resolvedAttendeeQuestions.length === 0) {
      return helpers.createResponse(406, {
        message: "Enable attendee feedback only after adding at least one attendee feedback question."
      });
    }

    if (resolvedPartnerFeedbackEnabled && resolvedPartnerQuestions.length === 0) {
      return helpers.createResponse(406, {
        message: "Enable partner feedback only after adding at least one partner feedback question."
      });
    }
    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    } = db.createUpdateExpression(data);

    // construct the param object
    let params = {
      Key: {
        id,
        year
      },
      TableName:
        EVENTS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: {
        ...expressionAttributeNames,
        "#vyear": "year"
      },
      UpdateExpression: updateExpression,
      ReturnValues: "UPDATED_NEW",
      ConditionExpression: "attribute_exists(id) and attribute_exists(#vyear)"
    };

    const res = await db.updateDBCustom(params);

    const response = helpers.createResponse(200, {
      message: `Updated event with id ${id} and year ${year}!`,
      response: res
    });

    return response;
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: err.message || err });
  }
};

// POST events/event-thumbnail-upload-url/{id}/{year}
export const createThumbnailPicUploadUrl = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);
    helpers.checkPayloadProps(data, {
      fileType: {
        required: true
      },
      fileName: {
        required: true
      },
      prefix: {
        required: true
      },
      eventId: {
        required: true
      },
    });
    const {
      fileType, fileName, prefix, eventId
    } = JSON.parse(event.body || "{}");
    if (!fileType || !fileName) {
      const res = helpers.createResponse(400, {
        message: "Missing fileType or fileName"
      });
      return res;
    }

    if (!fileType.startsWith("image/")) {
      const res = helpers.createResponse(400, {
        message: "Only image uploads are allowed"
      });
      return res;
    }

    const safeExt = (fileName.split(".").pop() || "jpg")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    const folder =
      prefix === "original" || prefix === "optimized" ? prefix : "optimized";

    const key = `event-thumbnails/${eventId}/${folder}/${Date.now()}.${
      safeExt || "jpg"
    }`;

    // ?
    const putCmd = new PutObjectCommand({
      Bucket: THUMBNAIL_BUCKET,
      Key: key,
      ContentType: fileType,
      CacheControl: "public, max-age=31536000, immutable"
    });

    const uploadUrl = await getSignedUrl(S3, putCmd, {
      expiresIn: 60
    });
    const publicUrl = `https://${THUMBNAIL_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    const res = helpers.createResponse(200, {
      uploadUrl,
      key,
      publicUrl
    });
    return res;
  } catch (err) {
    console.error("createThumbnail error", err);
    const res = helpers.createResponse(500, {
      message: "Failed to get upload URL"
    });
    return res;
  }
};

// GET events/{id}/{year}
export const get = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("event");
    const id = event.pathParameters.id;
    if (!event.pathParameters.year)
      throw helpers.missingPathParamResponse("event", "year");

    const year = parseInt(event.pathParameters.year, 10);
    if (isNaN(year))
      throw helpers.inputError(
        "Year path parameter must be a number",
        event.pathParameters
      );

    const queryString = event.queryStringParameters;

    //TODO: fix the else-if conditions
    // if both count and users are true, throw error
    if (
      queryString &&
      queryString.count === "true" &&
      queryString.users === "true"
    ) {
      throw helpers.createResponse(406, {
        message: "Only one true parameter is permissible at a time"
      });
    } else if (queryString && queryString.count === "true") {
      // return counts
      const counts = await eventHelpers.getEventCounts(id,year);

      const response = helpers.createResponse(200, counts);
      return response;
    } else if (queryString && queryString.users === "true") {
      let registrationList = [];

      try {
        const filters = {
          FilterExpression: "#idyear = :query",
          ExpressionAttributeNames: {
            "#idyear": "eventID;year"
          },
          ExpressionAttributeValues: {
            ":query": `${id};${year}`
          }
        };

        registrationList = await db.scan(USER_REGISTRATIONS_TABLE, filters);
      } catch (err) {
        throw helpers.createResponse(500, {
          message: "Unable to scan registration table."
        });
      }
      let keysForRequest = registrationList.map((registrationObj) => {
        const keyEntry = {
        };
        keyEntry.id = registrationObj.id;
        return keyEntry;
      });

      console.log("Keys:", keysForRequest);

      let keyBatches = [];

      while (keysForRequest.length > 0) {
        keyBatches.push(keysForRequest.splice(0, MAX_BATCH_ITEM_COUNT));
      }

      const result = await Promise.all(
        keyBatches.map((batch) =>
          db.batchGet(
            batch,
            USERS_TABLE +
              (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : "")
          )
        )
      );

      const flattenResults = result.flatMap(
        (batchResult) =>
          batchResult.Responses[
            `${USERS_TABLE}${
              process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""
            }`
          ]
      );

      const resultsWithRegistrationStatus = flattenResults.map((item) => {
        const registrationObj = registrationList.filter(
          (registrationObject) => {
            return registrationObject.id === item.id;
          }
        );

        if (registrationObj[0])
          item.registrationStatus = registrationObj[0].registrationStatus;
        else item.registrationStatus = "";
        return item;
      });

      resultsWithRegistrationStatus.sort(alphabeticalComparer("lname"));
      const response = helpers.createResponse(
        200,
        resultsWithRegistrationStatus
      );
      return response;
    } else {
      // if none of the optional params are true, then return the event
      const event = await db.getOne(id, EVENTS_TABLE, {
        year
      });

      if (isEmpty(event)) throw helpers.notFoundResponse("event", id, year);

      const response = helpers.createResponse(200, event);
      return response;
    }
  } catch (err) {
    console.error(err);

    let response = err;
    if (!response || !response.statusCode || !response.headers)
      response = helpers.createResponse(502, { message: err.message || err });

    return response;
  }
};

// GET events/{id}/{year}/feedback/{formType}
export const getFeedbackForm = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("event");
    const id = event.pathParameters.id;
    const formType = parseFormType(event.pathParameters.formType);
    if (!formType) {
      return helpers.createResponse(400, {
        message: "Feedback formType must be either 'attendee' or 'partner'."
      });
    }
    if (!event.pathParameters.year)
      throw helpers.missingPathParamResponse("event", "year");

    const year = parseInt(event.pathParameters.year, 10);
    if (isNaN(year))
      throw helpers.inputError(
        "Year path parameter must be a number",
        event.pathParameters
      );

    const eventItem = await db.getOne(id, EVENTS_TABLE, {
      year
    });

    if (isEmpty(eventItem)) throw helpers.notFoundResponse("event", id, year);

    const feedbackQuestions = getFeedbackQuestionsForType(eventItem, formType);
    const enabled = isFeedbackEnabledForType(eventItem, formType);

    return helpers.createResponse(200, {
      event: {
        id: eventItem.id,
        year: eventItem.year,
        ename: eventItem.ename,
        description: eventItem.description,
        partnerDescription: eventItem.partnerDescription,
        imageUrl: eventItem.imageUrl,
        endDate: eventItem.endDate,
        isCompleted: eventItem.isCompleted
      },
      formType,
      enabled,
      feedbackQuestions
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: err.message || err });
  }
};

// POST events/{id}/{year}/feedback/{formType}
export const submitFeedback = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("event");
    if (!event.pathParameters.year)
      throw helpers.missingPathParamResponse("event", "year");
    const id = event.pathParameters.id;
    const year = parseInt(event.pathParameters.year, 10);
    if (isNaN(year))
      throw helpers.inputError(
        "Year path parameter must be a number",
        event.pathParameters
      );
    const formType = parseFormType(event.pathParameters.formType);
    if (!formType) {
      return helpers.createResponse(400, {
        message: "Feedback formType must be either 'attendee' or 'partner'."
      });
    }

    const data = JSON.parse(event.body || "{}");
    const eventItem = await db.getOne(id, EVENTS_TABLE, {
      year
    });
    if (isEmpty(eventItem)) throw helpers.notFoundResponse("event", id, year);

    if (!isFeedbackEnabledForType(eventItem, formType)) {
      return helpers.createResponse(403, {
        message: `The ${formType} feedback form is not enabled for this event.`
      });
    }

    const eventEndDate = Date.parse(eventItem.endDate);
    if (Number.isFinite(eventEndDate) && Date.now() < eventEndDate) {
      return helpers.createResponse(409, {
        message: "Feedback form submissions open after the event ends."
      });
    }

    const feedbackQuestions = getFeedbackQuestionsForType(eventItem, formType);
    if (!feedbackQuestions.length) {
      return helpers.createResponse(406, {
        message: `No ${formType} feedback questions are configured for this event.`
      });
    }

    const validation = validateFeedbackPayload(feedbackQuestions, data.responses);
    if (!validation.isValid) {
      return helpers.createResponse(406, {
        message: validation.error
      });
    }

    const respondentName = normalizeText(data.respondentName);
    if (respondentName.length > 120) {
      return helpers.createResponse(406, {
        message: "respondentName cannot exceed 120 characters."
      });
    }

    const respondentEmail = normalizeText(data.respondentEmail).toLowerCase();
    if (respondentEmail && !isValidEmail(respondentEmail)) {
      return helpers.createResponse(406, {
        message: "respondentEmail must be a valid email address."
      });
    }

    const submittedAt = Date.now();
    const feedbackItem = {
      id: uuidv4(),
      eventID: id,
      year,
      formType,
      eventIDYear: `${id};${year}`,
      eventFormKey: `${id};${year};${formType}`,
      submittedAt,
      responses: validation.responses,
      respondentName: respondentName || undefined,
      respondentEmail: respondentEmail || undefined,
      createdAt: submittedAt,
      updatedAt: submittedAt
    };

    await db.put(feedbackItem, EVENT_FEEDBACK_TABLE, true);

    return helpers.createResponse(201, {
      message: "Feedback submitted successfully.",
      id: feedbackItem.id
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: err.message || err });
  }
};

// GET events/{id}/{year}/feedback/{formType}/submissions
export const getFeedbackSubmissions = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.id)
      throw helpers.missingIdQueryResponse("event");
    if (!event.pathParameters.year)
      throw helpers.missingPathParamResponse("event", "year");

    const id = event.pathParameters.id;
    const year = parseInt(event.pathParameters.year, 10);
    if (isNaN(year))
      throw helpers.inputError(
        "Year path parameter must be a number",
        event.pathParameters
      );
    const formType = parseFormType(event.pathParameters.formType);
    if (!formType) {
      return helpers.createResponse(400, {
        message: "Feedback formType must be either 'attendee' or 'partner'."
      });
    }

    const existingEvent = await db.getOne(id, EVENTS_TABLE, { year });
    if (isEmpty(existingEvent))
      throw helpers.notFoundResponse("event", id, year);

    const eventFormKey = `${id};${year};${formType}`;
    const submissions = await db.query(
      EVENT_FEEDBACK_TABLE,
      "event-form-query",
      {
        expression: "#eventFormKey = :eventFormKey",
        expressionNames: {
          "#eventFormKey": "eventFormKey"
        },
        expressionValues: {
          ":eventFormKey": eventFormKey
        }
      }
    );

    const sortedSubmissions = submissions
      .slice()
      .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));

    return helpers.createResponse(200, {
      count: sortedSubmissions.length,
      submissions: sortedSubmissions
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: err.message || err });
  }
};

// GET events/getActiveEvent
export const getActiveEvent = async (event, ctx, callback) => {
  try {
    // already now by default
    const nowISO = new Date().toISOString();

    const filters = {
      FilterExpression: "startDate <= :now AND endDate >= :now",
      ExpressionAttributeValues: {
        ":now": nowISO
      }
    };

    let events = await db.scan(EVENTS_TABLE, filters, "event-overview");

    events.sort(dateComparer("startDate"));
    const activeEvent = events.length > 0 ? events[0] : null;

    const response = helpers.createResponse(
      200,
      activeEvent
    );
    return response;
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, { message: err.message || err });
  }
};
