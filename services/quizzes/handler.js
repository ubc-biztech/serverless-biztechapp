import { QUIZZES_TABLE } from "../../constants/tables.js";
import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers.js";
import { calculateAverage, generateMBTI } from "./helpers";

export const upload = async (event, ctx, callback) => {
  /*
    Responsible for:
    - Calculating average score of domain, mode, environment, focus
    - Generating MBTI based on the score
    - Storing individual scores and MBTI in DB
  */

  const data = JSON.parse(event.body);

  // object means array of scores
  helpers.checkPayloadProps(data, {
    id: {
      required: true,
      type: "string"
    },
    domain: {
      required: true,
      type: "object"
    },
    mode: {
      required: true,
      type: "object"
    },
    environment: {
      required: true,
      type: "object"
    },
    focus: {
      required: true,
      type: "object"
    },
  });

  const domainAvg = calculateAverage(data.domain);
  const modeAvg = calculateAverage(data.mode);
  const environmentAvg = calculateAverage(data.environment);
  const focusAvg = calculateAverage(data.focus);

  const mbti = generateMBTI(domainAvg, modeAvg, environmentAvg, focusAvg);

  // Check if entry exists in DB
  const entry = await db.getOne(data.id, QUIZZES_TABLE, {
    "eventID;year": "blueprint;2026"
  });
  const exists = !!entry;

  const dbEntry = {
    id: data.id,
    ["eventID;year"]: "blueprint;2026",
    domainAvg,
    modeAvg,
    environmentAvg,
    focusAvg,
    mbti
  };

  if (exists) {
    // if it already exists, update it
    await db.updateDB(data.id, dbEntry, QUIZZES_TABLE);
  } else {
    // if it doesn't exist, create a new one
    await db.create(dbEntry, QUIZZES_TABLE);
  }

  return helpers.createResponse(200, {
    message: "Upload successful"
  });
};

export const report = async (event, ctx, callback) => {
  /*
    Responsible for:
    - Sending a report of the user's MBTI and average scores
  */

  if (!event.pathParameters || !event.pathParameters.id) {
    return helpers.missingIdQueryResponse("id");
  }

  const id = event.pathParameters.id;

  const entry = await db.getOne(id, QUIZZES_TABLE, {
    "eventID;year": "blueprint;2026"
  });

  if (!entry) {
    return helpers.createResponse(400, {
      message: "Quiz report not found"
    });
  }

  return helpers.createResponse(200, {
    message: "Report found",
    data: entry
  });
};
