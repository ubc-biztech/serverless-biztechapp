import {
  v4 as uuidv4
} from "uuid";
import {
  USER_REGISTRATIONS_TABLE,
  TEAMS_TABLE,
  JUDGING_TABLE
} from "../../constants/tables";
import helpers from "../../lib/handlerHelpers.js";
import db from "../../lib/db.js";

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

export default {
  async _getTeamFromUserRegistration(userID, eventID, year) {
    /*
        Returns the Team object of the team that the user is on.
    */

    const eventID_year = eventID + ";" + year;

    return await db
      .getOne(userID, USER_REGISTRATIONS_TABLE, {
        "eventID;year": eventID_year
      })
      .then((res) => {
        if (res) {
          return res.teamID;
        } else {
          return null;
        }
      })
      .then((teamID) => {
        if (teamID) {
          return db.getOne(teamID, TEAMS_TABLE, {
            "eventID;year": eventID_year
          });
        } else {
          return null;
        }
      });
  },
  async updateJudgeTeam(judgeIDs, teamID) {
    if (!Array.isArray(judgeIDs) || judgeIDs.length === 0) {
      throw new Error("judgeIDs must be a non-empty array");
    }

    try {
      const updateResults = await Promise.all(
        judgeIDs.map(async (judgeID) => {
          try {
            if (!judgeID) {
              console.error("Error: judgeID is missing!");
              return null;
            }

            const judge = await db.getOne(judgeID, JUDGING_TABLE);
            if (!judge) {
              console.log(`Judge ${judgeID} not found, skipping.`);
              return {
                judgeID,
                status: "not found"
              };
            }
            judge.currentTeam = teamID;
            await db.put(judge, JUDGING_TABLE, false);

            console.log(`Judge ${judgeID} updated to team ${teamID}`);
            return {
              judgeID,
              status: "updated"
            };
          } catch (err) {
            console.error(`Failed to update judge ${judgeID}:`, err);
            return {
              judgeID,
              status: "failed",
              error: err.message
            };
          }
        })
      );

      console.log("All judges updated successfully:", updateResults);

      return helpers.createResponse(200, {
        message: "Judges updated successfully",
        updatedJudges: judgeIDs,
        newTeamID: teamID
      });
    } catch (error) {
      console.error("Database update error:", error);
      throw new Error("Database update failed");
    }
  },

  async _putTeam(team, createNew) {
    /*
        Puts a team in the Teams table according to the Table Schema.
        Partition key is teamID, sort key is eventID;year
   */
    return await db.put(team, TEAMS_TABLE, createNew);
  },

  async leaveTeam(memberID, eventID, year) {
    const eventID_year = eventID + ";" + year;

    const registration = await db.getOne(memberID, USER_REGISTRATIONS_TABLE, {
      "eventID;year": eventID_year
    });

    if (!registration) {
      throw helpers.inputError(
        `User ${memberID} is not registered for event ${eventID_year}`,
        404
      );
    }

    if (!registration.teamID) {
      throw helpers.inputError(`User ${memberID} is not on any team`, 400);
    }

    const team = await this._getTeamFromUserRegistration(memberID, eventID, year);
    if (!team) {
      throw helpers.inputError(`Team not found for user ${memberID}`, 404);
    }

    // Remove member from the team
    team.memberIDs = team.memberIDs.filter((id) => id !== memberID);

    // TODO: delete team if empty ?
    await this._putTeam(team, false);

    // Remove teamID from user registration
    registration.teamID = "";

    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    } = db.createUpdateExpression(registration);

    const updateParams = {
      Key: {
        id: registration.id,
        ["eventID;year"]: eventID_year
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
      ConditionExpression: "attribute_exists(id) and attribute_exists(#eventIDYear)"
    };

    await db.updateDBCustom(updateParams);

    return {
      success: true,
      message: `User ${memberID} has left the team.`
    };
  },


  async joinTeam(memberID, eventID, year, teamID) {
    const eventID_year = eventID + ";" + year;

    const registration = await db.getOne(memberID, USER_REGISTRATIONS_TABLE, {
      "eventID;year": eventID_year
    });

    if (!registration) {
      throw helpers.inputError(
        `User ${memberID} is not registered for event ${eventID_year}`,
        403
      );
    }

    if (registration.registrationStatus !== "acceptedComplete" && registration.checkedIn !== "checkedIn") {
      throw helpers.inputError(
        `User ${memberID} has not confirmed their spot or has not checked in for event ${eventID_year}`,
        403
      );
    }

    if (registration.teamID?.length > 0) {
      throw helpers.inputError(
        `User ${memberID} is already in another team`,
        400
      );
    }

    // Get the team
    const team = await db.getOne(teamID, TEAMS_TABLE, {
      "eventID;year": eventID_year
    });

    if (!team) {
      throw helpers.inputError(`Team ${teamID} does not exist`, 404);
    }

    // Add the member to the team
    if (!team.memberIDs.includes(memberID)) {
      team.memberIDs.push(memberID);
      await this._putTeam(team, false);
    }

    // Update the user's registration
    registration.teamID = teamID;

    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    } = db.createUpdateExpression(registration);

    const updateParams = {
      Key: {
        id: registration.id,
        ["eventID;year"]: eventID_year
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
      ConditionExpression: "attribute_exists(id) and attribute_exists(#eventIDYear)"
    };

    await db.updateDBCustom(updateParams);

    return {
      success: true,
      message: `User ${memberID} joined team ${team.teamName}`
    };
  },


  async makeTeam(team_name, eventID, year, memberIDs) {
    /*
      Creates a team in the Teams table according to the Table Schema.
     */

    const eventID_year = eventID + ";" + year;

    // First, check if ALL members are registered for the event with eventID;year. Iterate through memberIDs.
    for (let i = 0; i < memberIDs.length; i++) {
      const memberID = memberIDs[i];

      // get user's registration
      await db
        .getOne(memberID, USER_REGISTRATIONS_TABLE, {
          "eventID;year": eventID_year
        })
        .then((res) => {
          if (!res) {
            throw helpers.inputError(
              "User " +
                memberID +
                " is not registered for event " +
                eventID_year,
              403
            );
          }

          // hardcoded for kickstart 2025
          if (res.registrationStatus !== "acceptedComplete") {
            throw helpers.inputError(
              "User " +
                memberID +
                " is not has not confirmed their spot for event " +
                eventID_year,
              403
            );
          }

          // disallow users from adding people already in other teams to their own team
          if (res.teamID?.length > 0) {
            throw helpers.inputError(
              "User " + memberID + " is already registered to a team"
            );
          }
        });
    }

    const params = {
      id: uuidv4(),
      teamName: team_name,
      "eventID;year": eventID + ";" + year,
      memberIDs: memberIDs,
      scannedQRs: [],
      points: 0,
      pointsSpent: 0,
      transactions: [],
      inventory: [],
      submission: "",
      metadata: {
      }
    };

    // HARDCODED FOR KICKSTART PURPOSES
    if (eventID === "kickstart" && year === 2025) {
      params.funding = 0;
    }

    try {
      // Create the new team=
      await db.put(params, TEAMS_TABLE, true);

      // Update all members' teamIDs in the User Registrations table
      for (let i = 0; i < memberIDs.length; i++) {
        const memberID = memberIDs[i];

        // Get the user's registration
        const res = await db.getOne(memberID, USER_REGISTRATIONS_TABLE, {
          "eventID;year": eventID_year
        });

        if (res.teamID) {
          // If user is already on a team, remove them from that team on the Teams table
          const team = await this._getTeamFromUserRegistration(
            memberID,
            eventID,
            year
          );
          team.memberIDs = team.memberIDs.filter((id) => id !== memberID);
          await this._putTeam(team, false);
        }

        res.teamID = params.id;

        let conditionExpression =
          "attribute_exists(id) and attribute_exists(#eventIDYear)";
        const {
          updateExpression,
          expressionAttributeValues,
          expressionAttributeNames
        } = db.createUpdateExpression(res);

        let updateParams = {
          Key: {
            id: res.id,
            ["eventID;year"]: eventID + ";" + year
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

        await db.updateDBCustom(updateParams);
      }

      // Return the newly created team
      return params;
    } catch (error) {
      console.log(error);
      throw new Error(error);
    }
  },
  async checkQRScanned(user_id, qr_code_id, eventID, year) {
    /*
        Checks if a user's team has already scanned a QR code. Return true if they have, false if they haven't.
        This method might not make sense in the far future, but it's here so that the QR microservice can quickly check :')
        PLEASE REVISIT
   */

    // get user's team using helper function _getTeamFromUserRegistration
    return await this._getTeamFromUserRegistration(user_id, eventID, year)
      .then((team) => {
        // check if qr_code_id is in scannedQRs
        return team.scannedQRs.includes(qr_code_id);
      })
      .catch((err) => {
        console.log(err);
        throw new Error(err);
      });
  },
  async addQRScan(user_id, qr_code_id, eventID, year, points) {
    /*
        Adds a QR code to the scannedQRs array of a user's team.
   */

    // get user's team using helper function _getTeamFromUserRegistration
    return await this._getTeamFromUserRegistration(user_id, eventID, year).then(
      (team) => {
        // add qr_code_id to scannedQRs
        team.scannedQRs.push(qr_code_id);

        // if points is non-zero, add points to team.
        if (points !== 0) {
          team.points += points;
        }

        // if points are negative, add absolute points to team's pointsSpent.
        if (points < 0) {
          team.pointsSpent += points * -1;
        }

        // put team in Teams table
        return new Promise((resolve, reject) => {
          this._putTeam(team, false)
            .then((res) => {
              resolve(res);
            })
            .catch((err) => {
              reject(err);
            });
        });
      }
    );
  },

  async addQuestions(user_id, questions, eventID, year, pointsPerQuestion) {
    /*
    Helper for addMultipleQuestions, a dataverse specific endpoint utilizes the
    scannedQRs field to store questions
    */
    if (!Array.isArray(questions)) {
      throw new Error("'questions' must be an array.");
    }
    /*
        Adds multiple questions to the scannedQRs array of a user's team.
    */

    return await this._getTeamFromUserRegistration(user_id, eventID, year).then(
      (team) => {
        const uniqueQuestions = questions.filter(
          (question) => !team.scannedQRs.includes(question)
        ); // Only add new questions

        team.scannedQRs.push(...uniqueQuestions);

        if (uniqueQuestions.includes("Final Question")) {
          const timestamp = new Date().toISOString();
          team.submission = timestamp;
        }
        const totalPoints = pointsPerQuestion * uniqueQuestions.length;

        if (totalPoints !== 0) {
          team.points += totalPoints;
        }

        if (totalPoints < 0) {
          team.pointsSpent += Math.abs(totalPoints);
        }

        return new Promise((resolve, reject) => {
          this._putTeam(team, false)
            .then((res) => {
              resolve(res);
            })
            .catch((err) => {
              reject(err);
            });
        });
      }
    );
  },

  async changeTeamName(user_id, eventID, year, team_name) {
    /*
        Changes a team's name in the Teams table
   */

    return await this._getTeamFromUserRegistration(user_id, eventID, year).then(
      (team) => {
        team.teamName = team_name;

        return new Promise((resolve, reject) => {
          this._putTeam(team, false)
            .then((res) => {
              resolve(res);
            })
            .catch((err) => {
              reject(err);
            });
        });
      }
    );
  }
};

export const normalizeScores = (scores, scoreAvg) => {
  let normalizedScores = [];
  const count = scores.length;

  let s1N = 0;
  let s2N = 0;
  let s3N = 0;
  let s4N = 0;
  let s5N = 0;

  for (let i = 0; i < scores.length; i++) {
    s1N += (scores[i].metric1 - scoreAvg.metric1) ** 2;
    s2N += (scores[i].metric2 - scoreAvg.metric2) ** 2;
    s3N += (scores[i].metric3 - scoreAvg.metric3) ** 2;
    s4N += (scores[i].metric4 - scoreAvg.metric4) ** 2;
    s5N += (scores[i].metric5 - scoreAvg.metric5) ** 2;
  }

  s1N /= count;
  s2N /= count;
  s3N /= count;
  s4N /= count;
  s5N /= count;

  for (let i = 0; i < scores.length; i++) {
    let scoreObj = {
      team: scores[i].team,
      teamName: scores[i].teamName,
      judge: scores[i].judge,
      metric1: s1N !== 0 ? (scores[i].metric1 - scoreAvg.metric1) / s1N : 0,
      metric2: s2N !== 0 ? (scores[i].metric2 - scoreAvg.metric2) / s2N : 0,
      metric3: s3N !== 0 ? (scores[i].metric3 - scoreAvg.metric3) / s3N : 0,
      metric4: s4N !== 0 ? (scores[i].metric4 - scoreAvg.metric4) / s4N : 0,
      metric5: s5N !== 0 ? (scores[i].metric5 - scoreAvg.metric5) / s5N : 0,
      originalScores: scores
    };

    normalizedScores.push(scoreObj);
  }

  return normalizedScores;
};

// UNSAFE
// doesn't account for length == 0 cause it will only be called on arrays > 0 length
export const scoreObjectAverage = (originalScores) => {
  let scoreAvg = {
    metric1: 0,
    metric2: 0,
    metric3: 0,
    metric4: 0,
    metric5: 0
  };

  for (let i = 0; i < originalScores.length; i++) {
    scoreAvg.metric1 += originalScores[i].metric1;
    scoreAvg.metric2 += originalScores[i].metric2;
    scoreAvg.metric3 += originalScores[i].metric3;
    scoreAvg.metric4 += originalScores[i].metric4;
    scoreAvg.metric5 += originalScores[i].metric5;
  }

  scoreAvg.metric1 = scoreAvg.metric1 / originalScores.length;
  scoreAvg.metric2 = scoreAvg.metric2 / originalScores.length;
  scoreAvg.metric3 = scoreAvg.metric3 / originalScores.length;
  scoreAvg.metric4 = scoreAvg.metric4 / originalScores.length;
  scoreAvg.metric5 = scoreAvg.metric5 / originalScores.length;

  return scoreAvg;
};

export const scoreObjectAverageWeighted = (
  originalScores,
  w1,
  w2,
  w3,
  w4,
  w5
) => {
  let scoreAvg = {
    metric1: 0,
    metric2: 0,
    metric3: 0,
    metric4: 0,
    metric5: 0
  };

  for (let i = 0; i < originalScores.length; i++) {
    scoreAvg.metric1 += originalScores[i].metric1;
    scoreAvg.metric2 += originalScores[i].metric2;
    scoreAvg.metric3 += originalScores[i].metric3;
    scoreAvg.metric4 += originalScores[i].metric4;
    scoreAvg.metric5 += originalScores[i].metric5;
  }

  scoreAvg.metric1 = scoreAvg.metric1 / originalScores.length;
  scoreAvg.metric2 = scoreAvg.metric2 / originalScores.length;
  scoreAvg.metric3 = scoreAvg.metric3 / originalScores.length;
  scoreAvg.metric4 = scoreAvg.metric4 / originalScores.length;
  scoreAvg.metric5 = scoreAvg.metric5 / originalScores.length;

  return (
    scoreAvg.metric1 * w1 +
    scoreAvg.metric2 * w2 +
    scoreAvg.metric3 * w3 +
    scoreAvg.metric4 * w4 +
    scoreAvg.metric5 * w5
  );
};
