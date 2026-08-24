import { PROFILES_TABLE, QUIZZES_TABLE } from "../../constants/tables.js";
import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers";
import type { APIGatewayEvent, LambdaCallback, LambdaContext } from "../../lib/types";
import { TYPES } from "../profiles/constants";
import {
  calculateAverage,
  generateMBTI,
  validateQuestionScores,
} from "./helpers";

export const upload = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    const data = JSON.parse(event.body as string) as Record<string, unknown>;

    helpers.checkPayloadProps(data, {
      id: {
        required: true,
        type: "string",
      },
      domain: {
        required: true,
        type: "object",
      },
      mode: {
        required: true,
        type: "object",
      },
      environment: {
        required: true,
        type: "object",
      },
      focus: {
        required: true,
        type: "object",
      },
    });

    const domainAvg = validateQuestionScores(data.domain)
      ? calculateAverage(data.domain as number[])
      : -1;
    const modeAvg = validateQuestionScores(data.mode)
      ? calculateAverage(data.mode as number[])
      : -1;
    const environmentAvg = validateQuestionScores(data.environment)
      ? calculateAverage(data.environment as number[])
      : -1;
    const focusAvg = validateQuestionScores(data.focus)
      ? calculateAverage(data.focus as number[])
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
    const profile = await db.getOneCustom({
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        compositeID: `PROFILE#${data.id as string}`,
        type: TYPES.PROFILE,
      },
    });

    const entry = await db.getOne(data.id as string, QUIZZES_TABLE, {
      "eventID;year": "blueprint;2026",
    });
    const exists = !!entry;

    const dbEntry = {
      id: data.id as string,
      fname: profile?.fname,
      lname: profile?.lname,
      ["eventID;year"]: "blueprint;2026",
      domainAvg,
      modeAvg,
      environmentAvg,
      focusAvg,
      mbti,
    };

    await db.put(dbEntry, QUIZZES_TABLE, !exists);

    await db.updateDBCustom({
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        compositeID: "PROFILE#" + data.id,
        type: "PROFILE",
      },
      UpdateExpression: "SET mbti = :mbti",
      ExpressionAttributeValues: {
        ":mbti": mbti,
      },
      ConditionExpression: "attribute_exists(compositeID)",
    });

    return helpers.createResponse(200, {
      message: "Upload successful",
    });
  } catch (_error: unknown) {
    return helpers.createResponse(500, {
      message: "Internal Server Error",
    });
  }
};

export const report = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (!event.pathParameters || !event.pathParameters.profile_id) {
      return helpers.createResponse(400, {
        message: "Missing profile_id path parameter",
      });
    }

    const profileID = event.pathParameters.profile_id;

    const entry = await db.getOne(profileID, QUIZZES_TABLE, {
      "eventID;year": "blueprint;2026",
    });

    if (!entry) {
      return helpers.createResponse(404, {
        message: "Quiz report not found",
      });
    }

    return helpers.createResponse(200, {
      data: entry,
    });
  } catch (_error: unknown) {
    return helpers.createResponse(500, {
      message: "Internal Server Error",
    });
  }
};

export const all = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    let eventAndYear = "blueprint;2026";

    if (event.pathParameters && event.pathParameters.event) {
      eventAndYear = event.pathParameters.event;
    }

    const keyCondition = {
      expression: "#eventIDYear = :query",
      expressionNames: {
        "#eventIDYear": "eventID;year",
      },
      expressionValues: {
        ":query": eventAndYear,
      },
    };

    const quizzes = await db.query(QUIZZES_TABLE, "event-query", keyCondition);

    return helpers.createResponse(200, quizzes);
  } catch (_error: unknown) {
    return helpers.createResponse(500, {
      message: "Internal Server Error",
    });
  }
};

export const aggregate = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    let eventAndYear = "blueprint;2026";

    if (event.pathParameters && event.pathParameters.event) {
      eventAndYear = event.pathParameters.event;
    }

    const keyCondition = {
      expression: "#eventIDYear = :query",
      expressionNames: {
        "#eventIDYear": "eventID;year",
      },
      expressionValues: {
        ":query": eventAndYear,
      },
    };

    const quizzes = await db.query(QUIZZES_TABLE, "event-query", keyCondition);

    if (!quizzes || quizzes.length === 0) {
      return helpers.createResponse(200, {
        message: "No quiz data found",
        data: {
          totalResponses: 0,
          averages: null,
          mbtiCount: {},
        },
      });
    }

    const count = quizzes.length;

    const totals = {
      domainAvg: 0,
      modeAvg: 0,
      environmentAvg: 0,
      focusAvg: 0,
    };

    const mbtiCount: Record<string, number> = {};

    for (const quiz of quizzes) {
      totals.domainAvg += quiz.domainAvg as number;
      totals.modeAvg += quiz.modeAvg as number;
      totals.environmentAvg += quiz.environmentAvg as number;
      totals.focusAvg += quiz.focusAvg as number;

      mbtiCount[quiz.mbti as string] =
        (mbtiCount[quiz.mbti as string] || 0) + 1;
    }

    const averages = {
      domainAvg: totals.domainAvg / count,
      modeAvg: totals.modeAvg / count,
      environmentAvg: totals.environmentAvg / count,
      focusAvg: totals.focusAvg / count,
    };

    return helpers.createResponse(200, {
      message: "Aggregate report generated",
      data: {
        totalResponses: count,
        averages,
        mbtiCount,
      },
    });
  } catch (error: unknown) {
    console.error(error);
    return helpers.createResponse(500, {
      message: "Internal Server Error",
    });
  }
};

export const wrapped = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    const data = JSON.parse(event.body as string) as Record<string, unknown>;

    helpers.checkPayloadProps(data, {
      mbti: {
        required: true,
        type: "string",
      },
    });

    let eventAndYear = "blueprint;2026";

    if (event.pathParameters && event.pathParameters.event) {
      eventAndYear = event.pathParameters.event;
    }

    const keyCondition = {
      expression: "#eventIDYear = :query",
      expressionNames: {
        "#eventIDYear": "eventID;year",
      },
      expressionValues: {
        ":query": eventAndYear,
      },
    };

    const quizzes = await db.query(QUIZZES_TABLE, "event-query", keyCondition);
    const totalResponses = quizzes.length;
    const sameMbtiCount = quizzes.filter((quiz) => quiz.mbti === data.mbti);
    const totalWithMbtiCount = sameMbtiCount.length;

    return helpers.createResponse(200, {
      totalResponses,
      totalWithMbtiCount,
    });
  } catch (_error: unknown) {
    return helpers.createResponse(500, {
      message: "Internal Server Error",
    });
  }
};

export const perMbti = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (!event.pathParameters || !event.pathParameters.mbti) {
      return helpers.missingIdQueryResponse("mbti");
    }

    const mbti = event.pathParameters.mbti;

    const keyCondition = {
      expression: "#mbti = :query",
      expressionNames: {
        "#mbti": "mbti",
      },
      expressionValues: {
        ":query": mbti,
      },
    };

    const mbtiQuizzes = await db.query(
      QUIZZES_TABLE,
      "mbti-query",
      keyCondition,
    );

    return helpers.createResponse(200, {
      [`mbtiQuizzes-${mbti}`]: mbtiQuizzes,
    });
  } catch (_error: unknown) {
    return helpers.createResponse(500, {
      message: "Internal Server Error",
    });
  }
};
