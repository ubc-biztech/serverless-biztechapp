import teamHelpers, {
  scoreObjectAverage,
  normalizeScores,
  scoreObjectAverageWeighted
} from "./helpers";
import helpers from "../../lib/handlerHelpers";
import {
  TEAMS_TABLE,
  JUDGING_TABLE,
  FEEDBACK_TABLE,
  USER_REGISTRATIONS_TABLE
} from "../../constants/tables";
import db from "../../lib/db.js";
import { WEIGHTS, ROUND } from "./constants.js";
import { LambdaHandler } from "../../lib/types";
import {
  AddMultipleQuestionsBody,
  AddQRScanBody,
  ChangeTeamNameBody,
  CheckQRScannedBody,
  CreateJudgeSubmissionsBody,
  FeedbackRecord,
  GetTeamFromUserIDBody,
  JoinTeamBody,
  JudgeRegistrationRecord,
  JudgeScore,
  LeaveTeamBody,
  MakeTeamBody,
  NormalizedRoundScoreResult,
  NormalizedScore,
  RoundRecord,
  ScoreMetrics,
  TeamRecord,
  UpdateCurrentTeamForJudgeBody,
  UpdateJudgeSubmissionBody,
  UpdateTeamPointsBody,
} from "./types";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/*
  Team Table Schema from DynamoDB:
    {
    "id": "string", [PARTITION KEY]
    "team_name": "string",
    "eventID;year": "string;number", [SORT KEY]
    "memberIDs": "string[]",
    "scannedQRs": "string[]",
    "points": "number",
    "pointsSpent": "number",
    "transactions": "string[]",
    "inventory": "string[]",
    "submission": "string",
    "metadata": object
 */

export const updateTeamPoints: LambdaHandler = async (event) => {
  try {
    const data = JSON.parse(event.body as string) as UpdateTeamPointsBody;

    helpers.checkPayloadProps(data, {
      user_id: {
        required: true,
        type: "string"
      }, // User ID
      eventID: {
        required: true,
        type: "string"
      }, // Event identifier
      year: {
        required: true,
        type: "number"
      }, // Event year
      change_points: {
        required: true,
        type: "number"
      } // Points to add/subtract
    });

    const team = await teamHelpers._getTeamFromUserRegistration(
      data.user_id,
      data.eventID,
      data.year
    );

    if (!team) {
      return helpers.createResponse(404, {
        message: "User not associated with a team",
      });
    }

    team.points += data.change_points;

    await teamHelpers._putTeam(team, false);

    return helpers.createResponse(200, {
      message: "Team points updated successfully",
      updatedPoints: team.points
    });
  } catch (error) {
    console.error("Error updating team points:", error);

    return helpers.createResponse(500, {
      message: "Failed to update team points",
      error: errorMessage(error),
    });
  }
};

export const leaveTeam: LambdaHandler = async (event) => {
  try {
    const data = JSON.parse(event.body as string) as LeaveTeamBody;

    helpers.checkPayloadProps(data, {
      memberID: {
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
      }
    });

    await teamHelpers.leaveTeam(data.memberID, data.eventID, data.year);

    return helpers.createResponse(200, {
      message: "Successfully left team.",
      response: data
    });
  } catch (error) {
    console.error("Error leaving team:", error);

    return helpers.createResponse(500, {
      message: "Failed to leave team",
      error: errorMessage(error)
    });
  }
};

export const joinTeam: LambdaHandler = async (event) => {
  try {
    const data = JSON.parse(event.body as string) as JoinTeamBody;

    helpers.checkPayloadProps(data, {
      memberID: {
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
      teamID: {
        required: true,
        type: "string"
      }
    });

    const { memberIDs, teamName } = await teamHelpers.joinTeam(data.memberID, data.eventID, data.year, data.teamID);

    return helpers.createResponse(200, {
      message: "Successfully joined team.",
      response: data,
      memberIDs,
      teamName
    });
  } catch (error) {
    console.error("Error joining team:", error);

    return helpers.createResponse(500, {
      message: "Failed to join team",
      error: errorMessage(error)
    });
  }
};

export const makeTeam: LambdaHandler = async (event) => {
  try {
    const data = JSON.parse(event.body as string) as MakeTeamBody;

    helpers.checkPayloadProps(data, {
      team_name: {
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
      memberIDs: {
        required: true,
        type: "object"
      } // 'object' means array in this case
    });

    const res = await teamHelpers.makeTeam(data.team_name, data.eventID, data.year, data.memberIDs);
    return helpers.createResponse(200, {
      message: "Successfully created new team.",
      response: res
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, {
      message: errorMessage(err)
    });
  }
};

export const getTeamFromUserID: LambdaHandler = async (event) => {
  /*
    Returns the team object of the team that the user is on from the user's ID.

    Requires: user_id, eventID, year
   */
  try {
    const data = JSON.parse(event.body as string) as GetTeamFromUserIDBody;

    helpers.checkPayloadProps(data, {
      user_id: {
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
      }
    });

    const res = await teamHelpers._getTeamFromUserRegistration(data.user_id, data.eventID, data.year);

    if (res) {
      return helpers.createResponse(200, {
        message: "Successfully retrieved team.",
        response: res
      });
    }

    return helpers.createResponse(404, { message: "Team not found" });
  } catch (error) {
    console.error("Error retrieving team:", error);

    return helpers.createResponse(403, {
      message: "Could not retrieve team.",
      error: errorMessage(error)
    });
  }
};

export const get: LambdaHandler = async (event) => {
  let obfuscateEmails = true;

  const userID = event.requestContext.authorizer?.claims?.email?.toLowerCase() ?? "";
  if (userID.endsWith("@ubcbiztech.com")) {
    obfuscateEmails = false;
  }

  if (
    !event.pathParameters ||
    !event.pathParameters.eventID ||
    !event.pathParameters.year
  ) {
    throw helpers.missingPathParamResponse("event", "year");
  }

  const { eventID, year } = event.pathParameters;

  try {
    const eventIDYear = eventID + ";" + year;
    const filterExpression = {
      FilterExpression: "#eventIDyear = :query",
      ExpressionAttributeNames: {
        "#eventIDyear": "eventID;year"
      },
      ExpressionAttributeValues: {
        ":query": eventIDYear
      }
    };

    const teams = (await db.scan(TEAMS_TABLE, filterExpression)) as TeamRecord[];
    const responseTeams = obfuscateEmails
      ? teams.map(({ memberIDs: _memberIDs, ...team }) => team)
      : teams;
    return helpers.createResponse(200, responseTeams);
  } catch (error) {
    console.error(error);
    return helpers.createResponse(500, {
      message: "Failed to fetch teams",
      error: errorMessage(error)
    });
  }
};

// STUBS or unused functions below

// export const changeTeam = async (event, ctx, callback) => {

// };

// export const addMember = async (event, ctx, callback) => {

// };

export const changeTeamName: LambdaHandler = async (event) => {
  /*
    Changes the team name of the team with the given user_id.
   */
  try {
    const data = JSON.parse(event.body as string) as ChangeTeamNameBody;

    helpers.checkPayloadProps(data, {
      user_id: {
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
      team_name: {
        required: true,
        type: "string"
      }
    });

    const res = await teamHelpers.changeTeamName(data.user_id, data.eventID, data.year, data.team_name);
    return helpers.createResponse(200, {
      message: "Successfully changed team name.",
      response: res
    });
  } catch (error) {
    console.error("Error changing team name:", error);
    return helpers.createResponse(500, {
      message: "Failed to change team name",
      error: errorMessage(error)
    });
  }
};

// export const viewPoints = async (event, ctx, callback) => {

// };

// export const changePoints = async (event, ctx, callback) => {

// };

export const addQRScan: LambdaHandler = async (event) => {
  /*
    !!!! DEPRECATED: use the QR microservice for client facing calls.

    Adds a QR code to the scannedQRs array of the team.
    If points are passed in, it will also add the points to the team's points.

    Requires: user_id, qr_code_id, eventID, year
   */

  try {
    const data = JSON.parse(event.body as string) as AddQRScanBody;

    helpers.checkPayloadProps(data, {
      user_id: {
        required: true,
        type: "string"
      },
      qr_code_id: {
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
      points: {
        required: false,
        type: "number"
      }
    });

    const points = data.points ? data.points : 0;

    const res = await teamHelpers.addQRScan(data.user_id, data.qr_code_id, data.eventID, data.year, points);
    return helpers.createResponse(200, {
      message: "Successfully added QR code to scannedQRs array of team.",
      response: res
    });
  } catch (error) {
    console.error("Error adding QR scan:", error);
    return helpers.createResponse(500, {
      message: "Failed to add QR scan",
      error: errorMessage(error)
    });
  }
};

export const addMultipleQuestions: LambdaHandler = async (event) => {
  /*
    !!!! NOTE: This is specifically for Dataverse, where we are using the
    scannedQRs field to store correctly answered questions.

    Requires: user_id, answered_questions (array), eventID, year
  */

  try {
    const data = JSON.parse(event.body as string) as AddMultipleQuestionsBody;

    helpers.checkPayloadProps(data, {
      user_id: {
        required: true,
        type: "string"
      },
      answered_questions: {
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
      },
      points: {
        required: false,
        type: "number"
      }
    });

    const points = data.points ? data.points : 0;

    const res = await teamHelpers.addQuestions(
      data.user_id,
      data.answered_questions,
      data.eventID,
      data.year,
      points
    );

    return helpers.createResponse(200, {
      message:
        "Successfully added questions to scannedQRs array of team.",
      response: res
    });
  } catch (error) {
    console.error("Error adding questions:", error);
    return helpers.createResponse(500, {
      message: "Failed to add questions",
      error: errorMessage(error)
    });
  }
};

export const checkQRScanned: LambdaHandler = async (event) => {
  /*
    !!!! DEPRECATED: use the QR microservice for client facing calls.

    Checks if a QR code has been scanned by a team.

    Requires: user_id, qr_code_id, eventID, year
   */

  try {
    const data = JSON.parse(event.body as string) as CheckQRScannedBody;

    helpers.checkPayloadProps(data, {
      user_id: {
        required: true,
        type: "string"
      },
      qr_code_id: {
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
      }
    });

    const bool = await teamHelpers.checkQRScanned(data.user_id, data.qr_code_id, data.eventID, data.year);

    return helpers.createResponse(200, {
      message:
        "Attached boolean for check if QR code has been scanned for that user's team; refer to \"response\" field.",
      response: bool
    });
  } catch (error) {
    console.error("Error checking QR scan:", error);
    return helpers.createResponse(403, {
      message: "Could not check if QR code has been scanned.",
      error: errorMessage(error)
    });
  }
};

export const getNormalizedRoundScores: LambdaHandler = async () => {
  let scores: FeedbackRecord[];

  try {
    scores = (await db.scan(FEEDBACK_TABLE)) as FeedbackRecord[];
  } catch (error) {
    console.error(error);
    return helpers.createResponse(500, {
      message: "Failed to fetch all feedback"
    });
  }

  const teamRawFeedback: Record<string, Array<{ judge: string } & ScoreMetrics>> = {};
  const scoreByJudgeID: Record<string, JudgeScore[]> = {};

  for (let i = 0; i < scores.length; i++) {
    const scoreEntry = scores[i];
    const teamRoundKey = scoreEntry["teamID;round"];
    const judgeScore = {
      judge: scoreEntry.id,
      ...scoreEntry.scores
    } as { judge: string } & ScoreMetrics;

    if (!teamRawFeedback[teamRoundKey]) {
      teamRawFeedback[teamRoundKey] = [judgeScore];
    } else {
      teamRawFeedback[teamRoundKey].push(judgeScore);
    }

    const judgeEntry: JudgeScore = {
      team: teamRoundKey,
      teamName: scoreEntry.teamName || "Unnamed Team",
      judge: scoreEntry.id,
      metric1: scoreEntry.scores?.metric1 ?? 0,
      metric2: scoreEntry.scores?.metric2 ?? 0,
      metric3: scoreEntry.scores?.metric3 ?? 0,
      metric4: scoreEntry.scores?.metric4 ?? 0,
      metric5: scoreEntry.scores?.metric5 ?? 0,
    };

    if (!scoreByJudgeID[scoreEntry.id]) {
      scoreByJudgeID[scoreEntry.id] = [judgeEntry];
      continue;
    }

    scoreByJudgeID[scoreEntry.id].push(judgeEntry);
  }

  let scoresNormalized: NormalizedScore[] = [];
  Object.keys(scoreByJudgeID).forEach((idx) => {
    const avg = scoreObjectAverage(scoreByJudgeID[idx]);
    const normalized = normalizeScores(scoreByJudgeID[idx], avg);

    scoresNormalized = [...scoresNormalized, ...normalized];
  });

  const scoresByTeamID: Record<string, NormalizedScore[]> = {};
  for (let i = 0; i < scoresNormalized.length; i++) {
    const normalizedScore = scoresNormalized[i];
    if (!scoresByTeamID[normalizedScore.team]) {
      scoresByTeamID[normalizedScore.team] = [normalizedScore];
      continue;
    }

    scoresByTeamID[normalizedScore.team].push(normalizedScore);
  }

  const res: NormalizedRoundScoreResult[] = [];

  Object.keys(scoresByTeamID).forEach((idx) => {
    res.push({
      teamID: scoresByTeamID[idx][0].team,
      teamName: scoresByTeamID[idx][0].teamName,
      zScoreWeighted: scoreObjectAverageWeighted(
        scoresByTeamID[idx],
        WEIGHTS.ORIGINAL,
        WEIGHTS.TECHNICAL,
        WEIGHTS.UX,
        WEIGHTS.PROBLEMSOLVING,
        WEIGHTS.PRESENTATION
      ),
      judges: scoresByTeamID[idx].map((s) => s.judge),
      originalResponses: teamRawFeedback[scoresByTeamID[idx][0].team]
    });
  });

  res.sort((a, b) => b.zScoreWeighted - a.zScoreWeighted);

  return helpers.createResponse(200, res);
};

export const createJudgeSubmissions: LambdaHandler = async (event) => {
  const data = JSON.parse(event.body as string) as CreateJudgeSubmissionsBody;

  try {
    helpers.checkPayloadProps(data, {
      teamID: {
        required: true
      },
      judgeID: {
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
      scores: {
        required: true,
        type: "object"
      }
    });

    if (
      !data.scores.metric1 ||
      !data.scores.metric2 ||
      !data.scores.metric3 ||
      !data.scores.metric4 ||
      !data.scores.metric5
    ) {
      return helpers.createResponse(400, {
        message: "invalid scores object; should have valid metrics in body"
      });
    }
  } catch (error) {
    return helpers.createResponse(500, {
      message: "Failed to validate judge submission",
      error: errorMessage(error)
    });
  }

  const eventIDYear = `${data.eventID};${data.year}`;

  if (!data.teamID || !data.judgeID) {
    return helpers.createResponse(400, {
      message: "Missing required fields: teamID;round or judgeID"
    });
  }

  let judgeReg: JudgeRegistrationRecord;

  try {
    judgeReg = (await db.getOne(data.judgeID, USER_REGISTRATIONS_TABLE, {
      ["eventID;year"]: "productx;2025"
    })) as JudgeRegistrationRecord;
  } catch (error) {
    return helpers.createResponse(409, {
      message: "judge registration doesn't exist"
    });
  }

  if (!judgeReg.isPartner) {
    return helpers.createResponse(409, {
      message: "not a judge"
    });
  }

  const round = (await db.getOne(ROUND, JUDGING_TABLE)) as RoundRecord;
  const teamID_round = data.teamID + ";" + round.currentTeam;

  let existingFeedback: FeedbackRecord | undefined;
  try {
    existingFeedback = (await db.getOne(data.judgeID, FEEDBACK_TABLE, {
      "teamID;round": teamID_round
    })) as FeedbackRecord;
    if (existingFeedback) {
      return helpers.createResponse(409, {
        message: "Feedback already exists for this judge and team round",
        existingFeedback
      });
    }
  } catch (error) {
    console.error(error);

    const dbError = error as { statusCode?: number; message?: string };
    if (dbError.statusCode !== 404) {
      return helpers.createResponse(500, {
        message: "Error checking existing feedback",
        error: dbError.message
      });
    }
  }

  const teamDetails = (await db.getOne(data.teamID, TEAMS_TABLE, {
    "eventID;year": eventIDYear
  })) as TeamRecord | null;
  const teamName =
    teamDetails && teamDetails.teamName
      ? teamDetails.teamName
      : "Team not found";

  const newFeedback: FeedbackRecord = {
    "teamID;round": teamID_round,
    "id": data.judgeID,
    "judgeName": judgeReg.fname,
    "teamName": teamName,
    "teamID": data.teamID,
    "scores": data.scores,
    "feedback": data.feedback || {},
    "createdAt": new Date().toISOString()
  };

  try {
    await db.put(newFeedback, FEEDBACK_TABLE, true);
  } catch (error) {
    return helpers.createResponse(500, {
      message: "Error creating feedback",
      error: errorMessage(error)
    });
  }

  return helpers.createResponse(200, {
    message: "Feedback created successfully",
    newFeedback
  });
};

export const getJudgeSubmissions: LambdaHandler = async (event) => {
  try {
    const judgeID = event.pathParameters?.judgeID;

    if (!judgeID) {
      throw helpers.createResponse(400, {
        message: "judgeID is required"
      });
    }

    const feedbackEntries = (await db.query(FEEDBACK_TABLE, null, {
      expression: "#id = :judgeID",
      expressionValues: {
        ":judgeID": judgeID
      },
      expressionNames: {
        "#id": "id"
      }
    })) as FeedbackRecord[];

    if (!feedbackEntries || feedbackEntries.length === 0) {
      throw helpers.createResponse(404, {
        message: "No feedback found for this judge"
      });
    }

    const scoresPerRound = feedbackEntries.map((item) => {
      const [team, round] = item["teamID;round"].split(";");

      return {
        round,
        judgeID: item.id,
        judgeName: item.judgeName,
        scores: item.scores,
        feedback: item.feedback,
        teamID: team,
        teamName: item.teamName,
        createdAt: item.createdAt
      };
    });

    const groupedScores = scoresPerRound.reduce<Record<string, typeof scoresPerRound>>((acc, item) => {
      if (!acc[item.round]) {
        acc[item.round] = [];
      }
      acc[item.round].push(item);
      return acc;
    }, {});

    return helpers.createResponse(200, {
      message: "Scores retrieved successfully",
      scores: groupedScores
    });
  } catch (error) {
    console.error("Internal error:", error);
    throw helpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};

export const getJudgeCurrentTeam: LambdaHandler = async (event) => {
  try {
    const judgeID = event.pathParameters?.judgeID;

    if (!judgeID) {
      throw helpers.createResponse(400, {
        message: "judgeID is required"
      });
    }

    const judge = (await db.getOne(judgeID, JUDGING_TABLE)) as RoundRecord | null;

    if (!judge) {
      throw helpers.createResponse(404, {
        message: "Judge not found"
      });
    }

    const teamDetails = (await db.getOne(judge.currentTeam, TEAMS_TABLE, {
      "eventID;year": judge["eventID;year"] as string
    })) as TeamRecord | null;

    return helpers.createResponse(200, {
      message: "Current team retrieved successfully",
      currentTeamID: judge.currentTeam,
      currentTeamName: teamDetails?.teamName || null
    });
  } catch (error) {
    console.error("Internal error:", error);
    return helpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};

export const getCurrentRound: LambdaHandler = async () => {
  try {
    const round = (await db.getOne(ROUND, JUDGING_TABLE)) as RoundRecord;

    return helpers.createResponse(200, {
      round: round.currentTeam
    });
  } catch (error) {
    console.error("Internal error:", error);
    return helpers.createResponse(500, {
      message: "unable to fetch current round"
    });
  }
};

export const setCurrentRound: LambdaHandler = async (event) => {
  try {
    const round = event.pathParameters?.round;

    if (!round) {
      return helpers.createResponse(400, {
        message: "must include round in setting current round"
      });
    }

    const val = {
      id: ROUND,
      currentTeam: round
    };

    await db.put(val, JUDGING_TABLE, false);

    return helpers.createResponse(200, {
      message: "successfully updated round",
      round
    });
  } catch (error) {
    console.error("Internal error:", error);
    return helpers.createResponse(500, {
      message: "unable to set current round"
    });
  }
};

export const getTeamFeedbackScore: LambdaHandler = async (event) => {
  try {
    const teamID = event.pathParameters?.teamID;
    if (!teamID) {
      throw helpers.createResponse(400, {
        message: "teamID is required"
      });
    }

    const feedbackEntries = (await db.query(FEEDBACK_TABLE, "team-round-query", {
      expression: "#team = :teamID",
      expressionValues: {
        ":teamID": teamID
      },
      expressionNames: {
        "#team": "teamID"
      }
    })) as FeedbackRecord[];

    if (!feedbackEntries || feedbackEntries.length === 0) {
      throw helpers.createResponse(404, {
        message: "No feedback found for this team"
      });
    }

    const scoresPerRound = feedbackEntries.reduce<Record<string, Array<{
      judgeID: string;
      judgeName?: string;
      scores?: ScoreMetrics;
      feedback?: FeedbackRecord["feedback"];
      createdAt?: string;
      teamName?: string;
    }>>>((acc, item) => {
      const [, round] = item["teamID;round"].split(";");
      if (!acc[round]) {
        acc[round] = [];
      }
      acc[round].push({
        judgeID: item.id,
        judgeName: item.judgeName,
        scores: item.scores,
        feedback: item.feedback,
        createdAt: item.createdAt,
        teamName: item.teamName
      });

      return acc;
    }, {});

    return helpers.createResponse(200, {
      message: "Scores retrieved successfully",
      scores: scoresPerRound
    });
  } catch (error) {
    console.error("Internal error:", error);
    throw helpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};

export const updateJudgeSubmission: LambdaHandler = async (event) => {
  try {
    const data = JSON.parse(event.body as string) as UpdateJudgeSubmissionBody;

    try {
      helpers.checkPayloadProps(data, {
        teamID: {
          required: true
        },
        round: {
          required: true
        },
        judgeID: {
          required: true
        }
      });
    } catch (error) {
      return helpers.createResponse(500, {
        message: "Failed to validate judge submission update",
        error: errorMessage(error)
      });
    }

    if (!data.teamID || !data.round || !data.judgeID) {
      throw helpers.createResponse(400, {
        message: "Missing required fields: teamID;round or judgeID"
      });
    }

    const teamID_round = data.teamID + ";" + data.round;

    let existingFeedback: FeedbackRecord | null = null;
    try {
      existingFeedback = (await db.getOne(data.judgeID, FEEDBACK_TABLE, {
        "teamID;round": teamID_round
      })) as FeedbackRecord;
    } catch (error) {
      throw helpers.createResponse(500, {
        message: "Error retrieving existing feedback",
        error: errorMessage(error)
      });
    }

    const updatedFeedback: FeedbackRecord = {
      "teamID;round": teamID_round,
      "id": data.judgeID,
      "scores":
        data.scores ?? existingFeedback?.scores,
      "feedback":
        data.feedback || (existingFeedback ? existingFeedback.feedback : ""),
      "teamID":
        data.teamID || (existingFeedback ? existingFeedback.teamID : ""),
      "teamName":
        data.teamName || (existingFeedback ? existingFeedback.teamName : ""),
      "createdAt":
        data.createdAt ||
        (existingFeedback
          ? existingFeedback.createdAt
          : new Date().toISOString()),
      "judgeName":
        data.judgeName || (existingFeedback ? existingFeedback.judgeName : "")
    };

    try {
      await db.put(updatedFeedback, FEEDBACK_TABLE, false);
    } catch (error) {
      throw helpers.createResponse(500, {
        message: "Error updating feedback",
        error: errorMessage(error)
      });
    }

    return helpers.createResponse(200, {
      message: "Feedback updated successfully",
      updatedFeedback
    });
  } catch (error) {
    console.error("Internal error:", error);
    throw helpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};

export const updateCurrentTeamForJudge: LambdaHandler = async (event) => {
  try {
    const data = JSON.parse(event.body as string) as UpdateCurrentTeamForJudgeBody;

    try {
      helpers.checkPayloadProps(data, {
        judgeIDs: {
          required: true
        }
      });
    } catch (error) {
      return helpers.createResponse(500, {
        message: "Failed to validate judge team update",
        error: errorMessage(error)
      });
    }

    const { judgeIDs } = data;
    const teamID = event.pathParameters?.teamID;

    const roundRecord = (await db.getOne(ROUND, JUDGING_TABLE)) as RoundRecord;
    const round = roundRecord.currentTeam;

    const feedbackEntries = (await db.query(FEEDBACK_TABLE, "team-round-query", {
      expression: "#team = :teamID AND #rnd = :round",
      expressionValues: {
        ":teamID": teamID,
        ":round": teamID + ";" + round
      },
      expressionNames: {
        "#team": "teamID",
        "#rnd": "teamID;round"
      }
    })) as FeedbackRecord[];

    if (
      judgeIDs.every((id) => {
        return feedbackEntries.findIndex((v) => v.id === id) >= 0;
      })
    ) {
      return helpers.createResponse(409, {
        message: "this team has already received feedback from all judges",
        data: judgeIDs
      });
    }

    if (!teamID) {
      throw helpers.createResponse(400, {
        message: "Missing teamID parameter in path"
      });
    }

    try {
      const response = await teamHelpers.updateJudgeTeam(judgeIDs, teamID);
      return helpers.createResponse(200, {
        message: "Successfully updated judge entries",
        response
      });
    } catch (error) {
      throw helpers.createResponse(500, {
        message: "Error updating judge entries",
        error: errorMessage(error)
      });
    }
  } catch (error) {
    console.error(error);
    throw helpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};

// export const addTransaction = async (event, ctx, callback) => {

// };

// export const getTransactions = async (event, ctx, callback) => {

// };

// export const addInventory = async (event, ctx, callback) => {

// };

// export const getTeamInventory = async (event, ctx, callback) => {

// };
