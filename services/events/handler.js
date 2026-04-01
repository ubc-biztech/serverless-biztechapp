import eventHelpers from "./helpers";
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
const FEEDBACK_FORM_TYPES = new Set(["attendee", "partner"]);
const FEEDBACK_QUESTION_TYPES = new Set([
  "SHORT_TEXT",
  "LONG_TEXT",
  "MULTIPLE_CHOICE",
  "CHECKBOXES",
  "LINEAR_SCALE"
]);
const FEEDBACK_TEXT_LIMITS = {
  SHORT_TEXT: 280,
  LONG_TEXT: 4000
};
const MAX_FEEDBACK_QUESTIONS_PER_FORM = 50;
const OVERALL_RATING_QUESTION_ID = "overall-rating";
const DEFAULT_OVERALL_RATING_QUESTION = {
  questionId: OVERALL_RATING_QUESTION_ID,
  type: "LINEAR_SCALE",
  label: "How would you rate this event overall?",
  required: true,
  scaleMin: 1,
  scaleMax: 10,
  scaleMinLabel: "Poor",
  scaleMaxLabel: "Excellent"
};

const parseFormType = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  const normalized = raw.toLowerCase();
  if (!FEEDBACK_FORM_TYPES.has(normalized)) return null;
  return normalized;
};

const ensureDefaultOverallRatingQuestion = (questions) => {
  const otherQuestions = (Array.isArray(questions) ? questions : []).filter(
    (question) => question && question.questionId !== OVERALL_RATING_QUESTION_ID
  );
  return [
    { ...DEFAULT_OVERALL_RATING_QUESTION },
    ...otherQuestions
  ];
};

const getFeedbackQuestionsForType = (eventItem, formType) => {
  const questions = formType === "partner"
    ? Array.isArray(eventItem?.partnerFeedbackQuestions)
      ? eventItem.partnerFeedbackQuestions
      : []
    : Array.isArray(eventItem?.attendeeFeedbackQuestions)
      ? eventItem.attendeeFeedbackQuestions
      : [];

  return ensureDefaultOverallRatingQuestion(questions);
};

const isFeedbackEnabledForType = (eventItem, formType) => {
  if (formType === "partner")
    return Boolean(eventItem?.partnerFeedbackEnabled);
  return Boolean(eventItem?.attendeeFeedbackEnabled);
};

const normalizeChoices = (choicesValue) => {
  if (Array.isArray(choicesValue)) {
    return choicesValue
      .map((choice) => normalizeText(choice))
      .filter(Boolean);
  }

  if (typeof choicesValue !== "string") return [];
  return choicesValue
    .split(",")
    .map((choice) => choice.trim())
    .filter(Boolean);
};

const normalizeText = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeFeedbackQuestions = (rawQuestions, formType) => {
  if (!Array.isArray(rawQuestions)) {
    return {
      isValid: false,
      error: `${formType}FeedbackQuestions must be an array.`
    };
  }

  if (rawQuestions.length > MAX_FEEDBACK_QUESTIONS_PER_FORM) {
    return {
      isValid: false,
      error: `${formType}FeedbackQuestions cannot exceed ${MAX_FEEDBACK_QUESTIONS_PER_FORM} questions.`
    };
  }

  const normalizedQuestions = [];
  const questionIdSet = new Set();

  for (let index = 0; index < rawQuestions.length; index++) {
    const rawQuestion = rawQuestions[index];
    if (!rawQuestion || typeof rawQuestion !== "object" || Array.isArray(rawQuestion)) {
      return {
        isValid: false,
        error: `${formType}FeedbackQuestions[${index}] is invalid.`
      };
    }

    const type = normalizeText(rawQuestion.type).toUpperCase();
    if (!FEEDBACK_QUESTION_TYPES.has(type)) {
      return {
        isValid: false,
        error: `${formType}FeedbackQuestions[${index}] has unsupported type '${rawQuestion.type}'.`
      };
    }

    const label = normalizeText(rawQuestion.label || rawQuestion.question);
    if (!label) {
      return {
        isValid: false,
        error: `${formType}FeedbackQuestions[${index}] is missing a question label.`
      };
    }

    if (label.length > 500) {
      return {
        isValid: false,
        error: `${formType}FeedbackQuestions[${index}] exceeds 500 characters.`
      };
    }

    const rawQuestionId = normalizeText(
      rawQuestion.questionId || rawQuestion.id
    );
    const questionId = rawQuestionId || uuidv4();
    if (questionIdSet.has(questionId)) {
      return {
        isValid: false,
        error: `${formType}FeedbackQuestions contains duplicate questionId '${questionId}'.`
      };
    }
    questionIdSet.add(questionId);

    const question = {
      questionId,
      type,
      label,
      required: Boolean(rawQuestion.required)
    };

    if (type === "MULTIPLE_CHOICE" || type === "CHECKBOXES") {
      const options = [...new Set(normalizeChoices(
        rawQuestion.choices || rawQuestion.options
      ))];
      if (options.length === 0) {
        return {
          isValid: false,
          error: `${formType}FeedbackQuestions[${index}] must include at least one option.`
        };
      }

      const invalidOption = options.find((option) => option.length > 200);
      if (invalidOption) {
        return {
          isValid: false,
          error: `${formType}FeedbackQuestions[${index}] has an option longer than 200 characters.`
        };
      }

      question.choices = options.join(",");
    }

    if (type === "LINEAR_SCALE") {
      const parsedMin = Number(rawQuestion.scaleMin);
      const parsedMax = Number(rawQuestion.scaleMax);
      const scaleMin = Number.isFinite(parsedMin) ? parsedMin : 1;
      const scaleMax = Number.isFinite(parsedMax) ? parsedMax : 5;

      if (!Number.isInteger(scaleMin) || !Number.isInteger(scaleMax)) {
        return {
          isValid: false,
          error: `${formType}FeedbackQuestions[${index}] scale bounds must be integers.`
        };
      }

      if (scaleMin >= scaleMax) {
        return {
          isValid: false,
          error: `${formType}FeedbackQuestions[${index}] scaleMin must be less than scaleMax.`
        };
      }

      if (scaleMin < 0 || scaleMax > 20) {
        return {
          isValid: false,
          error: `${formType}FeedbackQuestions[${index}] scale bounds must be between 0 and 20.`
        };
      }

      const scaleMinLabel = normalizeText(rawQuestion.scaleMinLabel);
      const scaleMaxLabel = normalizeText(rawQuestion.scaleMaxLabel);
      if (scaleMinLabel.length > 120 || scaleMaxLabel.length > 120) {
        return {
          isValid: false,
          error: `${formType}FeedbackQuestions[${index}] scale labels cannot exceed 120 characters.`
        };
      }

      question.scaleMin = scaleMin;
      question.scaleMax = scaleMax;
      question.scaleMinLabel = scaleMinLabel || "";
      question.scaleMaxLabel = scaleMaxLabel || "";
    }

    normalizedQuestions.push(question);
  }

  return {
    isValid: true,
    questions: normalizedQuestions
  };
};

const validateFeedbackPayload = (questions, rawResponses) => {
  if (!rawResponses || typeof rawResponses !== "object" || Array.isArray(rawResponses)) {
    return {
      isValid: false,
      error: "Feedback responses must be an object keyed by questionId."
    };
  }

  const responses = rawResponses || {};
  const allowedIds = new Set(questions.map((q) => q.questionId));
  const normalized = {};

  for (const key of Object.keys(responses)) {
    if (!allowedIds.has(key)) {
      return {
        isValid: false,
        error: `Unknown questionId '${key}' in responses.`
      };
    }
  }

  for (const question of questions) {
    const {
      questionId, type, required = false
    } = question;
    if (!FEEDBACK_QUESTION_TYPES.has(type)) {
      return {
        isValid: false,
        error: `Unsupported feedback question type '${type}' for question '${questionId}'.`
      };
    }

    const answer = responses[questionId];

    if (type === "SHORT_TEXT" || type === "LONG_TEXT") {
      const maxLength = FEEDBACK_TEXT_LIMITS[type];
      const text = normalizeText(answer);
      if (!text && required) {
        return {
          isValid: false,
          error: `Question '${questionId}' is required.`
        };
      }
      if (!text) continue;
      if (text.length > maxLength) {
        return {
          isValid: false,
          error: `Question '${questionId}' exceeds max length of ${maxLength}.`
        };
      }
      normalized[questionId] = text;
      continue;
    }

    if (type === "MULTIPLE_CHOICE") {
      const options = normalizeChoices(question.choices);
      const text = normalizeText(answer);
      if (!text && required) {
        return {
          isValid: false,
          error: `Question '${questionId}' is required.`
        };
      }
      if (!text) continue;
      if (!options.includes(text)) {
        return {
          isValid: false,
          error: `Invalid choice for question '${questionId}'.`
        };
      }
      normalized[questionId] = text;
      continue;
    }

    if (type === "CHECKBOXES") {
      const options = normalizeChoices(question.choices);
      let selected = [];
      if (Array.isArray(answer)) {
        selected = answer.map((item) => normalizeText(item)).filter(Boolean);
      } else if (typeof answer === "string") {
        selected = answer.split(",").map((item) => item.trim()).filter(Boolean);
      } else if (answer != null) {
        return {
          isValid: false,
          error: `Invalid checkbox response for question '${questionId}'.`
        };
      }

      const deduped = [...new Set(selected)];
      if (required && deduped.length === 0) {
        return {
          isValid: false,
          error: `Question '${questionId}' is required.`
        };
      }
      if (deduped.length === 0) continue;

      const invalidChoices = deduped.filter((item) => !options.includes(item));
      if (invalidChoices.length > 0) {
        return {
          isValid: false,
          error: `Invalid checkbox selection for question '${questionId}'.`
        };
      }
      normalized[questionId] = deduped;
      continue;
    }

    if (type === "LINEAR_SCALE") {
      const min = Number.isFinite(Number(question.scaleMin))
        ? Number(question.scaleMin)
        : 1;
      const max = Number.isFinite(Number(question.scaleMax))
        ? Number(question.scaleMax)
        : 5;
      if ((answer === "" || answer == null) && required) {
        return {
          isValid: false,
          error: `Question '${questionId}' is required.`
        };
      }
      if (answer === "" || answer == null) continue;
      const numericValue = Number(answer);
      if (
        !Number.isFinite(numericValue) ||
        !Number.isInteger(numericValue) ||
        numericValue < min ||
        numericValue > max
      ) {
        return {
          isValid: false,
          error: `Scale response for question '${questionId}' must be a whole number between ${min} and ${max}.`
        };
      }
      normalized[questionId] = numericValue;
    }
  }

  return {
    isValid: true,
    responses: normalized
  };
};

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
