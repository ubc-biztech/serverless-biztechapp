import teamHelpers, { scoreObjectAverage } from "./helpers";
import helpers from "../../lib/handlerHelpers";
import {
  TEAMS_TABLE,
  JUDGING_TABLE,
  FEEDBACK_TABLE
} from "../../constants/tables";
import db from "../../lib/db.js";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { createResponse } from "../stickers/helpers.js";
import handlerHelpers from "../../lib/handlerHelpers";

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

    const eventIDYear = `${data.eventID};${data.year}`;

    const team = await teamHelpers._getTeamFromUserRegistration(
      data.user_id,
      data.eventID,
      data.year
    );

    if (!team) {
      throw helpers.inputError("Team not found", 404);
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
  if (
    !event.pathParameters ||
    !event.pathParameters.eventID ||
    !event.pathParameters.year
  )
    throw helpers.missingPathParamResponse("event", "year");
  const {
    eventID, year
  } = event.pathParameters;

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

    const qrs = await db.scan(TEAMS_TABLE, filterExpression);
    const response = helpers.createResponse(200, qrs);
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
    return db.createResponse(500, { message: "Failed to fetch all feedback" });
  }

  // step 1: format data by team, track min and max (used for normalization)

  console.log(scores);

  let scoreByTeam = {};

  for (let i = 0; i < scores.length; i++) {
    const currScore = scoreObjectAverage(scores[i].scores);

    if (!scoreByTeam[scores[i]["teamID;round"]]) {
      scoreByTeam[scores[i]["teamID;round"]] = {
        id: scores[i]["teamID;round"],
        scores: [currScore],
        max: currScore,
        min: currScore,
        originalScores: [scores[i].scores]
      };
      continue;
    }

    scoreByTeam[scores[i]["teamID;round"]].scores.push(currScore);
    scoreByTeam[scores[i]["teamID;round"]].originalScores.push(
      scores[i].scores
    );

    if (scoreByTeam[scores[i]["teamID;round"]].max < currScore) {
      scoreByTeam[scores[i]["teamID;round"]].max = currScore;
    } else if (scoreByTeam[scores[i]["teamID;round"]].min > currScore)
      scoreByTeam[scores[i]["teamID;round"]].min = currScore;
  }

  let res = [];

  Object.keys(scoreByTeam).forEach((idx) => {
    let sum = scoreByTeam[idx].scores.reduce((a, b) => a + b, 0);
    let avg = sum / scoreByTeam[idx].scores.length;

    let normalizedScores = scoreByTeam[idx].scores.map((val) => {
      return (
        (val - scoreByTeam[idx].min) /
        (scoreByTeam[idx].max - scoreByTeam[idx].min)
      );
    });

    let nSum = normalizedScores.reduce((a, b) => a + b, 0);
    let nAvg = nSum / normalizedScores.length;

    res.push({
      id: scoreByTeam[idx].id,
      normalizedScore: nAvg * 100,
      averageScore: avg,
      originalScores: scoreByTeam[idx].scores,
      adjustedScores: normalizedScores
    });
  });

  res = res.sort((a, b) => {
    return b.normalizedScore - a.normalizedScore;
  });

  return handlerHelpers.createResponse(200, { data: res });
};

export const getTeamFeedback = async (event, ctx, callback) => {};

export const getJudgeSubmissions = async (event, ctx, callback) => {};

export const createJudgeSubmissions = async (event, ctx, callback) => {
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
      if (existingFeedback) {
        throw helpers.createResponse(409, {
          message: "Feedback already exists for this judge and team round",
          existingFeedback
        });
      }
    } catch (error) {
      if (error.statusCode !== 404) {
        throw helpers.createResponse(500, {
          message: "Error checking existing feedback",
          error: error.message
        });
      }
    }

    const newFeedback = {
      "teamID;round": teamID_round,
      id: data.judgeID,
      scores: data.scores || {
      },
      feedback: data.feedback || {
      },
      createdAt: new Date().toISOString()
    };

    try {
      await db.put(newFeedback, FEEDBACK_TABLE, true);
    } catch (error) {
      throw helpers.createResponse(500, {
        message: "Error creating feedback",
        error: error.message
      });
    }

    const response = helpers.createResponse(200, {
      message: "Feedback created successfully",
      newFeedback
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
      id: data.judgeID,
      scores: data.scores || (existingFeedback ? existingFeedback.scores : {
      }),
      feedback: data.feedback || (existingFeedback ? existingFeedback.feedback : ""),
      updatedAt: new Date().toISOString()
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

    const {
      judgeIDs
    } = data;
    const teamID = event.pathParameters.teamID;

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
