import { QUIZZES_TABLE } from "../../constants/tables.js";
import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers.js";
import {
  calculateAverage,
  generateMBTI,
  validateQuestionScores
} from "./helpers.js";

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
    }
  });

  const domainAvg = validateQuestionScores(data.domain)
    ? calculateAverage(data.domain)
    : -1;
  const modeAvg = validateQuestionScores(data.mode)
    ? calculateAverage(data.mode)
    : -1;
  const environmentAvg = validateQuestionScores(data.environment)
    ? calculateAverage(data.environment)
    : -1;
  const focusAvg = validateQuestionScores(data.focus)
    ? calculateAverage(data.focus)
    : -1;

  if (
    domainAvg === -1 ||
    modeAvg === -1 ||
    environmentAvg === -1 ||
    focusAvg === -1
  ) {
    return helpers.inputError("Invalid scores", data);
  }

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

  // create new if doesn't exist anc vice versa
  await db.put(dbEntry, QUIZZES_TABLE, !exists);

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

export const all = async (event, ctx, callback) => {
  /*
    Responsible for:
    - Getting all quiz reports 
  */

  try {
    let eventAndYear = "blueprint;2026";

    if (event.pathParameters && event.pathParameters.event) {
      eventAndYear = event.pathParameters.event;
    }

    const keyCondition = {
      expression: "#eventIDYear = :query",
      expressionNames: {
        "#eventIDYear": "eventID;year"
      },
      expressionValues: {
        ":query": eventAndYear
      }
    };

    const quizzes = await db.query(QUIZZES_TABLE, "event-query", keyCondition);

    return helpers.createResponse(200, quizzes);
  } catch (error) {
    return helpers.createResponse(500, {
      message: "Internal Server Error"
    });
  }
};

export const aggregate = async (event, ctx, callback) => {
  /*
    Responsible for:
    - Aggregating average scores across all users
    - Counting MBTI distribution
  */

  try {
    let eventAndYear = "blueprint;2026";

    if (event.pathParameters && event.pathParameters.event) {
      eventAndYear = event.pathParameters.event;
    }

    const keyCondition = {
      expression: "#eventIDYear = :query",
      expressionNames: {
        "#eventIDYear": "eventID;year"
      },
      expressionValues: {
        ":query": eventAndYear
      }
    };

    const quizzes = await db.query(QUIZZES_TABLE, "event-query", keyCondition);

    if (!quizzes || quizzes.length === 0) {
      return helpers.createResponse(200, {
        message: "No quiz data found",
        data: {
          totalResponses: 0,
          averages: null,
          mbtiCount: {}
        }
      });
    }

    const count = quizzes.length;

    let totals = {
      domainAvg: 0,
      modeAvg: 0,
      environmentAvg: 0,
      focusAvg: 0
    };

    const mbtiCount = {};

    for (const quiz of quizzes) {
      totals.domainAvg += quiz.domainAvg;
      totals.modeAvg += quiz.modeAvg;
      totals.environmentAvg += quiz.environmentAvg;
      totals.focusAvg += quiz.focusAvg;

      mbtiCount[quiz.mbti] = (mbtiCount[quiz.mbti] || 0) + 1;
    }

    const averages = {
      domainAvg: totals.domainAvg / count,
      modeAvg: totals.modeAvg / count,
      environmentAvg: totals.environmentAvg / count,
      focusAvg: totals.focusAvg / count
    };

    return helpers.createResponse(200, {
      message: "Aggregate report generated",
      data: {
        totalResponses: count,
        averages,
        mbtiCount
      }
    });
  } catch (error) {
    console.error(error);
    return helpers.createResponse(500, {
      message: "Internal Server Error"
    });
  }
};

export const wrapped = async (event, ctx, callback) => {
  /*
    Responsible for:
    - Getting stats for one's MBTI
  */

  try {
    const data = JSON.parse(event.body);

    // object means array of scores
    helpers.checkPayloadProps(data, {
      mbti: {
        required: true,
        type: "string"
      }
    });
    
    let eventAndYear = "blueprint;2026";

    if (event.pathParameters && event.pathParameters.event) {
      eventAndYear = event.pathParameters.event;
    }

    const keyCondition = {
      expression: "#eventIDYear = :query",
      expressionNames: {
        "#eventIDYear": "eventID;year"
      },
      expressionValues: {
        ":query": eventAndYear
      }
    };

    const quizzes = await db.query(QUIZZES_TABLE, "event-query", keyCondition);
    const sameMbtiCount = quizzes.filter((quiz) => quiz.mbti === data.mbti);
    const othersWithSameMbtiCount = sameMbtiCount.length - 1;
    const totalWithMbtiCount = sameMbtiCount.length;

    let percentage; 
    if (quizzes.length) {
      percentage = (totalWithMbtiCount / quizzes.length) * 100;
    } else {
      percentage = 0;
    }

    return helpers.createResponse(200, {
      othersWithSameMbtiCount,
      totalWithMbtiCount,
      percentage
    });
  } catch (error) {
    return helpers.createResponse(500, {
      message: "Internal Server Error"
    });
  }
};
