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
import handlerHelpers from "../../lib/handlerHelpers";
import { WEIGHTS, ROUND } from "./constants.js";

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

export const updateTeamPoints = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

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
      const response = helpers.createResponse(404, {
        message: "User not associated with a team",
      });
      callback(null, response);
    }

    team.points += data.change_points;

    await teamHelpers._putTeam(team, false);

    const response = helpers.createResponse(200, {
      message: "Team points updated successfully",
      updatedPoints: team.points
    });
    callback(null, response);
  } catch (error) {
    console.error("Error updating team points:", error);

    const errorResponse = helpers.createResponse(500, {
      message: "Failed to update team points",
      error: error.message
    });
    callback(null, errorResponse);
  }
};

export const leaveTeam = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

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

    await teamHelpers.leaveTeam(data.memberID, data.eventID, data.year, data.teamID);

    const response = helpers.createResponse(200, {
      message: "Successfully left team.",
      response: data
    });
    callback(null, response);
    return response;
  } catch (error) {
    console.error("Error leaving team:", error);

    const errorResponse = helpers.createResponse(500, {
      message: "Failed to leave team",
      error: error.message
    });
    callback(null, errorResponse);
    return errorResponse;
  }
};

export const joinTeam = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

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

    const response = helpers.createResponse(200, {
      message: "Successfully joined team.",
      response: data,
      memberIDs,
      teamName
    });
    callback(null, response);
    return response;
  } catch (error) {
    console.error("Error joining team:", error);

    const errorResponse = helpers.createResponse(500, {
      message: "Failed to join team",
      error: error.message
    });
    callback(null, errorResponse);
    return errorResponse;
  }
};

export const makeTeam = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

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

    await teamHelpers
      .makeTeam(data.team_name, data.eventID, data.year, data.memberIDs)
      .then((res) => {
        if (res) {
          const response_success = helpers.createResponse(200, {
            message: "Successfully created new team.",
            response: res
          });

          callback(null, response_success);
          return response_success;
        }
      })
      .catch((err) => {
        const response_fail = helpers.createResponse(403, {
          message: "Could not create team.",
          response: err
        });

        callback(null, response_fail);
        return response_fail;
      });
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const getTeamFromUserID = async (event, ctx, callback) => {
  /*
    Returns the team object of the team that the user is on from the user's ID.

    Requires: user_id, eventID, year
   */

  const data = JSON.parse(event.body);

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

  await teamHelpers
    ._getTeamFromUserRegistration(data.user_id, data.eventID, data.year)
    .then((res) => {
      if (res) {
        const response_success = helpers.createResponse(200, {
          message: "Successfully retrieved team.",
          response: res
        });

        callback(null, response_success);
        return response_success;
      } else {
        callback(null, helpers.createResponse(404, { message: "Team not found" }));
      }
    })
    .catch((err) => {
      const response_fail = helpers.createResponse(403, {
        message: "Could not retrieve team.",
        response: err
      });

      callback(null, response_fail);
      return response_fail;
    });
};

export const get = async (event, ctx, callback) => {
  let obfuscateEmails = true;

  const userID = event.requestContext.authorizer.claims.email.toLowerCase();
  if (userID.endsWith("@ubcbiztech.com")) {
    obfuscateEmails = false;
  }

  if (
    !event.pathParameters ||
    !event.pathParameters.eventID ||
    !event.pathParameters.year
  )
    throw helpers.missingPathParamResponse("event", "year");
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

    const teams = await db.scan(TEAMS_TABLE, filterExpression);
    if (obfuscateEmails) {
      teams.forEach((team) => {
        delete team.memberIDs;
      });
    }
    const response = helpers.createResponse(200, teams);
    callback(null, response);
    return response;
  } catch (err) {
    console.log(err);
    callback(null, err);
    return null;
  }
};

// STUBS or unused functions below

// export const changeTeam = async (event, ctx, callback) => {

// };

// export const addMember = async (event, ctx, callback) => {

// };

export const changeTeamName = async (event, ctx, callback) => {
  /*
    Changes the team name of the team with the given user_id.
   */
  try {
    const data = JSON.parse(event.body);

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

    await teamHelpers
      .changeTeamName(data.user_id, data.eventID, data.year, data.team_name)
      .then((res) => {
        if (res) {
          const response_success = helpers.createResponse(200, {
            message: "Successfully changed team name.",
            response: res
          });

          callback(null, response_success);
          return response_success;
        }
      })
      .catch((err) => {
        const response_fail = helpers.createResponse(403, {
          message: "Could not change team name.",
          response: err
        });

        callback(null, response_fail);
        return response_fail;
      });
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

// export const viewPoints = async (event, ctx, callback) => {

// };

// export const changePoints = async (event, ctx, callback) => {

// };

export const addQRScan = async (event, ctx, callback) => {
  /*
    !!!! DEPRECATED: use the QR microservice for client facing calls.

    Adds a QR code to the scannedQRs array of the team.
    If points are passed in, it will also add the points to the team's points.

    Requires: user_id, qr_code_id, eventID, year
   */

  try {
    const data = JSON.parse(event.body);

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

    await teamHelpers
      .addQRScan(data.user_id, data.qr_code_id, data.eventID, data.year, points)
      .then((res) => {
        if (res) {
          const response_success = helpers.createResponse(200, {
            message: "Successfully added QR code to scannedQRs array of team.",
            response: res
          });

          callback(null, response_success);
          return response_success;
        }
      })
      .catch((err) => {
        const response_fail = helpers.createResponse(403, {
          message: "Could not add QR code to scannedQRs array of team.",
          response: err
        });

        callback(null, response_fail);
        return response_fail;
      });
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const addMultipleQuestions = async (event, ctx, callback) => {
  /*
    !!!! NOTE: This is specifically for Dataverse, where we are using the
    scannedQRs field to store correctly answered questions.

    Requires: user_id, answered_questions (array), eventID, year
  */

  try {
    const data = JSON.parse(event.body);

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

    await teamHelpers
      .addQuestions(
        data.user_id,
        data.answered_questions,
        data.eventID,
        data.year,
        points
      )
      .then((res) => {
        if (res) {
          const response_success = helpers.createResponse(200, {
            message:
              "Successfully added questions to scannedQRs array of team.",
            response: res
          });

          callback(null, response_success);
          return response_success;
        }
      })
      .catch((err) => {
        const response_fail = helpers.createResponse(403, {
          message: "Could not add questions to scannedQRs array of team.",
          response: err
        });

        callback(null, response_fail);
        return response_fail;
      });
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const checkQRScanned = async (event, ctx, callback) => {
  /*
    !!!! DEPRECATED: use the QR microservice for client facing calls.

    Checks if a QR code has been scanned by a team.

    Requires: user_id, qr_code_id, eventID, year
   */

  try {
    const data = JSON.parse(event.body);

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

    await teamHelpers
      .checkQRScanned(data.user_id, data.qr_code_id, data.eventID, data.year)
      .then((bool) => {
        const response_success = helpers.createResponse(200, {
          message:
            "Attached boolean for check if QR code has been scanned for that user's team; refer to \"response\" field.",
          response: bool
        });

        callback(null, response_success);
        return response_success;
      })
      .catch((err) => {
        const response_fail = helpers.createResponse(403, {
          message: "Could not check if QR code has been scanned.",
          response: err
        });

        callback(null, response_fail);
        return response_fail;
      });
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const getNormalizedRoundScores = async (event, ctx, callback) => {
  let scores;

  try {
    scores = await db.scan(FEEDBACK_TABLE);
  } catch (error) {
    console.error(error);
    callback(
      null,
      db.createResponse(500, {
        message: "Failed to fetch all feedback"
      })
    );
  }

  // step 1: format data by team
  let teamRawFeedback = {};
  let scoreByJudgeID = {};
  for (let i = 0; i < scores.length; i++) {
    if (!teamRawFeedback[scores[i]["teamID;round"]]) {
      teamRawFeedback[scores[i]["teamID;round"]] = [
        {
          judge: scores[i].id,
          ...scores[i].scores
        }
      ];
    } else {
      teamRawFeedback[scores[i]["teamID;round"]].push({
        judge: scores[i].id,
        ...scores[i].scores
      });
    }

    if (!scoreByJudgeID[scores[i].id]) {
      scoreByJudgeID[scores[i].id] = [
        {
          team: scores[i]["teamID;round"],
          teamName: scores[i].teamName || "Unnamed Team",
          judge: scores[i].id,
          ...scores[i].scores
        }
      ];
      continue;
    }

    scoreByJudgeID[scores[i].id].push({
      team: scores[i]["teamID;round"],
      teamName: scores[i].teamName || "Unnamed Team",
      judge: scores[i].id,
      ...scores[i].scores
    });
  }

  // step 2: normalize for each metric, by each judge
  let scoresNormalized = [];
  Object.keys(scoreByJudgeID).forEach((idx) => {
    let avg = scoreObjectAverage(scoreByJudgeID[idx]);
    let normalized = normalizeScores(scoreByJudgeID[idx], avg);

    scoresNormalized = [...scoresNormalized, ...normalized];
  });

  // step 3: rehash by team
  let scoresByTeamID = {};
  for (let i = 0; i < scoresNormalized.length; i++) {
    if (!scoresByTeamID[scoresNormalized[i].team]) {
      scoresByTeamID[scoresNormalized[i].team] = [scoresNormalized[i]];
      continue;
    }

    scoresByTeamID[scoresNormalized[i].team].push(scoresNormalized[i]);
  }

  const res = [];

  // step 4: calculate weighted average
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

  return handlerHelpers.createResponse(200, res);
};

export const createJudgeSubmissions = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

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
        callback(null, {
          message: "invalid scores object; should have valid metrics in body"
        });
      }
    } catch (error) {
      callback(null, error);
      return null;
    }

    const eventIDYear = `${data.eventID};${data.year}`;

    if (!data.teamID || !data.judgeID) {
      callback(
        null,
        helpers.createResponse(400, {
          message: "Missing required fields: teamID;round or judgeID"
        })
      );
    }

    let judgeReg;

    try {
      judgeReg = await db.getOne(data.judgeID, USER_REGISTRATIONS_TABLE, {
        ["eventID;year"]: "productx;2025"
      });
    } catch (error) {
      callback(
        null,
        helpers.createResponse(409, {
          message: "judge registration doesn't exist"
        })
      );
    }

    if (!judgeReg.isPartner) {
      callback(
        null,
        helpers.createResponse(409, {
          message: "not a judge"
        })
      );
    }

    const round = await db.getOne(ROUND, JUDGING_TABLE);
    const teamID_round = data.teamID + ";" + round.currentTeam;

    let existingFeedback;
    try {
      existingFeedback = await db.getOne(data.judgeID, FEEDBACK_TABLE, {
        "teamID;round": teamID_round
      });
      if (existingFeedback) {
        callback(
          null,
          helpers.createResponse(409, {
            message: "Feedback already exists for this judge and team round",
            existingFeedback
          })
        );
      }
    } catch (error) {
      console.error(error);

      if (error.statusCode !== 404) {
        callback(
          null,
          helpers.createResponse(500, {
            message: "Error checking existing feedback",
            error: error.message
          })
        );
      }
    }

    const teamDetails = await db.getOne(data.teamID, TEAMS_TABLE, {
      "eventID;year": eventIDYear
    });
    const teamName =
      teamDetails && teamDetails.teamName
        ? teamDetails.teamName
        : "Team not found"; // Default if name is missing

    const newFeedback = {
      "teamID;round": teamID_round,
      "id": data.judgeID,
      "judgeName": judgeReg.fname,
      "teamName": teamName,
      "teamID": data.teamID,
      "scores": data.scores || {},
      "feedback": data.feedback || {},
      "createdAt": new Date().toISOString()
    };

    try {
      await db.put(newFeedback, FEEDBACK_TABLE, true);
    } catch (error) {
      callback(
        null,
        helpers.createResponse(500, {
          message: "Error creating feedback",
          error: error.message
        })
      );
    }

    const response = helpers.createResponse(200, {
      message: "Feedback created successfully",
      newFeedback
    });

    callback(null, response);
  } catch (err) {
    console.error("Internal error:", err);
    callback(
      null,
      helpers.createResponse(500, {
        message: "Internal server error"
      })
    );
  }

  return null;
};

export const getJudgeSubmissions = async (event, ctx, callback) => {
  try {
    const { judgeID } = event.pathParameters;

    if (!judgeID) {
      throw helpers.createResponse(400, {
        message: "judgeID is required"
      });
    }

    const feedbackEntries = await db.query(FEEDBACK_TABLE, null, {
      expression: "#id = :judgeID",
      expressionValues: {
        ":judgeID": judgeID
      },
      expressionNames: {
        "#id": "id"
      }
    });

    if (!feedbackEntries || feedbackEntries.length === 0) {
      throw helpers.createResponse(404, {
        message: "No feedback found for this judge"
      });
    }

    // Group scores by round
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

    // Group the results by round
    const groupedScores = scoresPerRound.reduce((acc, item) => {
      if (!acc[item.round]) {
        acc[item.round] = [];
      }
      acc[item.round].push(item);
      return acc;
    }, {});

    const response = helpers.createResponse(200, {
      message: "Scores retrieved successfully",
      scores: groupedScores
    });

    callback(null, response);
  } catch (err) {
    console.error("Internal error:", err);
    throw helpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};

export const getJudgeCurrentTeam = async (event, ctx, callback) => {
  try {
    const { judgeID } = event.pathParameters;

    if (!judgeID) {
      throw helpers.createResponse(400, {
        message: "judgeID is required"
      });
    }

    const judge = await db.getOne(judgeID, JUDGING_TABLE);

    if (!judge) {
      throw helpers.createResponse(404, {
        message: "Judge not found"
      });
    }

    const teamDetails = await db.getOne(judge.currentTeam, TEAMS_TABLE, {
      "eventID;year": judge["eventID;year"]
    });

    const response = helpers.createResponse(200, {
      message: "Current team retrieved successfully",
      currentTeamID: judge.currentTeam,
      currentTeamName: teamDetails.teamName || null
    });

    callback(null, response);
  } catch (err) {
    console.error("Internal error:", err);
    callback(
      null,
      helpers.createResponse(500, {
        message: "Internal server error"
      })
    );
  }
};

export const getCurrentRound = async (event, ctx, callback) => {
  try {
    const round = await db.getOne(ROUND, JUDGING_TABLE);

    return helpers.createResponse(200, {
      round: round.currentTeam
    });
  } catch (err) {
    console.error("Internal error:", err);
    callback(
      null,
      helpers.createResponse(500, {
        message: "unable to fetch current round"
      })
    );
  }
};

export const setCurrentRound = async (event, ctx, callback) => {
  try {
    const { round } = event.pathParameters;

    if (!round) {
      return helpers.createResponse(400, {
        message: "must include round in setting current round"
      });
    }

    let val = {
      id: ROUND,
      currentTeam: round
    };

    const roundValue = await db.put(val, JUDGING_TABLE, false);

    return helpers.createResponse(200, {
      message: "successfully updated round",
      round
    });
  } catch (err) {
    console.error("Internal error:", err);
    callback(
      null,
      helpers.createResponse(500, {
        message: "unable to set current round"
      })
    );
  }
};

export const getTeamFeedbackScore = async (event, ctx, callback) => {
  try {
    const { teamID } = event.pathParameters;
    if (!teamID) {
      throw helpers.createResponse(400, {
        message: "teamID is required"
      });
    }

    const feedbackEntries = await db.query(FEEDBACK_TABLE, "team-round-query", {
      expression: "#team = :teamID",
      expressionValues: {
        ":teamID": teamID
      },
      expressionNames: {
        "#team": "teamID"
      }
    });

    if (!feedbackEntries || feedbackEntries.length === 0) {
      throw helpers.createResponse(404, {
        message: "No feedback found for this team"
      });
    }

    // Group scores by round
    const scoresPerRound = feedbackEntries.reduce((acc, item) => {
      const [team, round] = item["teamID;round"].split(";");
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

    const response = helpers.createResponse(200, {
      message: "Scores retrieved successfully",
      scores: scoresPerRound
    });

    callback(null, response);
  } catch (err) {
    console.error("Internal error:", err);
    throw helpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};

export const updateJudgeSubmission = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

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
      callback(null, error);
      return null;
    }

    if (!data.teamID || !data.round || !data.judgeID) {
      throw helpers.createResponse(400, {
        message: "Missing required fields: teamID;round or judgeID"
      });
    }

    const teamID_round = data.teamID + ";" + data.round;

    let existingFeedback;
    try {
      existingFeedback = await db.getOne(data.judgeID, FEEDBACK_TABLE, {
        "teamID;round": teamID_round
      });
    } catch (error) {
      throw helpers.createResponse(500, {
        message: "Error retrieving existing feedback",
        error: error.message
      });
    }

    const updatedFeedback = {
      "teamID;round": teamID_round,
      "id": data.judgeID,
      "scores":
        data.scores || (existingFeedback ? existingFeedback.scores : {}),
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
        error: error.message
      });
    }

    const response = helpers.createResponse(200, {
      message: "Feedback updated successfully",
      updatedFeedback
    });

    callback(null, response);
  } catch (err) {
    console.error("Internal error:", err);
    throw helpers.createResponse(500, {
      message: "Internal server error"
    });
  }

  return null;
};

export const updateCurrentTeamForJudge = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    try {
      helpers.checkPayloadProps(data, {
        judgeIDs: {
          required: true
        }
      });
    } catch (error) {
      callback(null, error);
      return null;
    }

    const { judgeIDs } = data;
    const teamID = event.pathParameters.teamID;

    let round = await db.getOne(ROUND, JUDGING_TABLE);
    round = round.currentTeam;

    const feedbackEntries = await db.query(FEEDBACK_TABLE, "team-round-query", {
      expression: "#team = :teamID AND #rnd = :round",
      expressionValues: {
        ":teamID": teamID,
        ":round": teamID + ";" + round
      },
      expressionNames: {
        "#team": "teamID",
        "#rnd": "teamID;round"
      }
    });

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

    let response;

    try {
      response = await teamHelpers.updateJudgeTeam(judgeIDs, teamID);
    } catch (error) {
      throw helpers.createResponse(500, {
        message: "Error updating judge entries",
        error: error.message
      });
    }

    callback(null, response);
  } catch (err) {
    console.error(err);
    throw helpers.createResponse(500, {
      message: "Internal server error"
    });
  }

  return null;
};

// export const addTransaction = async (event, ctx, callback) => {

// };

// export const getTransactions = async (event, ctx, callback) => {

// };

// export const addInventory = async (event, ctx, callback) => {

// };

// export const getTeamInventory = async (event, ctx, callback) => {

// };
