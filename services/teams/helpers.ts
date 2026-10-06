import { v4 as uuidv4 } from "uuid";
import {
  USER_REGISTRATIONS_TABLE,
  TEAMS_TABLE,
  JUDGING_TABLE,
} from "../../constants/tables";
import helpers from "../../lib/handlerHelpers.js";
import db from "../../lib/db.js";
import docClient from "../../lib/docClient.js";
import { GetCommand, TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type {
  JudgeScore,
  JudgeUpdateResult,
  NewTeamRecord,
  NormalizedScore,
  ScoreAverage,
  TeamRecord,
  TeamsHelpers,
} from "./types";

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

type RegistrationRecord = {
  id: string;
  teamID?: string;
  fname?: string;
  registrationStatus?: string;
  [key: string]: unknown;
};

type JudgeRecord = {
  currentTeam?: string;
  [key: string]: unknown;
};

export class ProductPlusTeamError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

const cleanupLambda = new LambdaClient({ maxAttempts: 2 });

/** Product Plus alone requires atomic membership writes and empty-team deletion. */
async function updateProductPlusMembership(memberID: string, eventKey: string, action: "join" | "leave", requestedTeamID?: string) {
  const suffix = process.env.ENVIRONMENT || "";
  const teamsTable = TEAMS_TABLE + suffix;
  const registrationsTable = USER_REGISTRATIONS_TABLE + suffix;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const registrationKey = { id: memberID, "eventID;year": eventKey };
      const registration = (await docClient.send(new GetCommand({
        TableName: registrationsTable, Key: registrationKey, ConsistentRead: true
      }))).Item as RegistrationRecord | undefined;
      if (!registration) throw new ProductPlusTeamError(404, "Event registration is required.");
      if (action === "join" && registration.registrationStatus?.toLowerCase() !== "checkedin") {
        throw new ProductPlusTeamError(403, "Check in before joining a team.");
      }
      if (action === "join" && registration.teamID) throw new ProductPlusTeamError(400, "You are already on a team.");
      const teamID = action === "leave" ? registration.teamID : requestedTeamID;
      if (!teamID) throw new ProductPlusTeamError(400, "Current team membership is required.");
      const teamKey = { id: teamID, "eventID;year": eventKey };
      const team = (await docClient.send(new GetCommand({
        TableName: teamsTable, Key: teamKey, ConsistentRead: true
      }))).Item as TeamRecord | undefined;
      if (!team || !Array.isArray(team.memberIDs)) throw new ProductPlusTeamError(404, "Team does not exist.");
      if (action === "leave" && !team.memberIDs.includes(memberID)) throw new ProductPlusTeamError(403, "Current team membership is required.");
      if (action === "join" && team.memberIDs.includes(memberID)) throw new ProductPlusTeamError(400, "You are already on this team.");
      const members = action === "join" ? [...team.memberIDs, memberID] : team.memberIDs.filter(id => id !== memberID);
      const removeTeam = action === "leave" && members.length === 0;
      if (removeTeam && (typeof team.team_code !== "string" || !/^\d{6}$/.test(team.team_code))) {
        throw new ProductPlusTeamError(409, "The Product Plus team needs its six-digit code before deletion.");
      }
      const teamCondition = {
        TableName: teamsTable, Key: teamKey,
        ConditionExpression: "attribute_exists(id) AND #members = :before" + (removeTeam ? " AND team_code = :code" : ""),
        ExpressionAttributeNames: { "#members": "memberIDs" },
        ExpressionAttributeValues: { ":before": team.memberIDs, ...(removeTeam ? { ":code": team.team_code } : {}) }
      };
      const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
        removeTeam ? { Delete: teamCondition } : { Update: {
          ...teamCondition, UpdateExpression: "SET #members = :after",
          ExpressionAttributeValues: { ...teamCondition.ExpressionAttributeValues, ":after": members }
        } },
        { Update: {
          TableName: registrationsTable, Key: registrationKey,
          ConditionExpression: "attribute_exists(id) AND " +
            (registration.teamID === undefined ? "attribute_not_exists(#team)" : "#team = :before") +
            (action === "join" ? " AND registrationStatus = :status" : ""),
          UpdateExpression: "SET #team = :after",
          ExpressionAttributeNames: { "#team": "teamID" },
          ExpressionAttributeValues: {
            ":after": action === "join" ? teamID : "",
            ...(registration.teamID === undefined ? {} : { ":before": registration.teamID }),
            ...(action === "join" ? { ":status": registration.registrationStatus } : {})
          }
        } }
      ];
      try {
        // Conditional Update prevents a stale join from putting a deleted team back.
        await docClient.send(new TransactWriteCommand({ TransactItems: transaction }));
      } catch (error) {
        if (error instanceof Error && (error.name === "TransactionConflictException" ||
          (error.name === "TransactionCanceledException" && "CancellationReasons" in error &&
            Array.isArray(error.CancellationReasons) && error.CancellationReasons.some(reason =>
              ["ConditionalCheckFailed", "TransactionConflict"].includes(reason?.Code))))) continue;
        // A transport timeout can happen after the atomic write committed.
        const [savedTeam, savedRegistration] = await Promise.all([
          docClient.send(new GetCommand({ TableName: teamsTable, Key: teamKey, ConsistentRead: true })),
          docClient.send(new GetCommand({ TableName: registrationsTable, Key: registrationKey, ConsistentRead: true }))
        ]);
        const committed = action === "join"
          ? savedRegistration.Item?.teamID === teamID && savedTeam.Item?.memberIDs?.includes(memberID)
          : savedRegistration.Item?.teamID === "" && (removeTeam ? !savedTeam.Item :
            Array.isArray(savedTeam.Item?.memberIDs) && !savedTeam.Item.memberIDs.includes(memberID));
        if (!committed) {
          console.error("Product Plus membership write needs recovery", {
            event_key: eventKey, team_id: teamID, team_code: team.team_code,
            error: error instanceof Error ? error.name : "UnknownError"
          });
          throw error;
        }
      }
      if (removeTeam) {
        const task = { internalTask: "team_deleted", payload: { event_key: eventKey, team_id: teamID, team_code: team.team_code } };
        try {
          const functionName = process.env.PRODUCTPLUS_CLEANUP_FUNCTION;
          if (!functionName) throw new Error("Cleanup function is not configured.");
          const result = await cleanupLambda.send(new InvokeCommand({
            FunctionName: functionName, InvocationType: "Event", Payload: Buffer.from(JSON.stringify(task))
          }));
          if (result.StatusCode !== 202) throw new Error("Cleanup invocation was not accepted.");
        } catch (error) {
          // Membership already committed. Log a replayable task without failing leave.
          console.error("Product Plus team cleanup delivery failed", { task, error: error instanceof Error ? error.name : "UnknownError" });
        }
      }
      return { success: true, message: action === "join" ? "Joined team." : "Left team.", memberIDs: members, teamName: team.teamName };
    }
    throw new ProductPlusTeamError(409, "Team membership changed. Try again.");
  } catch (error) {
    if (error instanceof ProductPlusTeamError) throw error;
    console.error("Product Plus membership failed", { error: error instanceof Error ? error.name : "UnknownError" });
    throw new ProductPlusTeamError(500, "Unable to update team membership.");
  }
}

const teamHelpers: TeamsHelpers = {
  async _getTeamFromUserRegistration(userID, eventID, year) {
    /*
        Returns the Team object of the team that the user is on.
    */

    const eventID_year = eventID + ";" + year;

    try {
      // Get the user registration for this event+year
      const res = (await db.getOne(userID, USER_REGISTRATIONS_TABLE, {
        "eventID;year": eventID_year,
      })) as RegistrationRecord | null;

      if (!res) {
        return null;
      }

      const teamID = res.teamID;
      if (!teamID) {
        return null;
      }

      // Fetch the team
      const team = (await db.getOne(teamID, TEAMS_TABLE, {
        "eventID;year": eventID_year,
      })) as TeamRecord;

      // List of member IDs
      const teamMemberKeys = team.memberIDs.map((id) => {
        return {
          id,
          "eventID;year": eventID_year,
        };
      });
      // Fetch member registration objects
      const registrationsTable =
        USER_REGISTRATIONS_TABLE + (process.env.ENVIRONMENT || "");
      const batchResult = (await db.batchGet(
        teamMemberKeys,
        registrationsTable,
      )) as unknown as { Responses: Record<string, RegistrationRecord[]> };
      const teamMembers = batchResult.Responses[registrationsTable];

      // Extract names
      const teamMemberEmails = teamMembers.map((member) => member.id);
      const teamMemberNames = teamMembers.map(
        (member) => member.fname ?? "Participant",
      );
      team.memberIDs = teamMemberEmails;
      team.memberNames = teamMemberNames;

      return team;
    } catch (err) {
      console.error(err);
      throw err;
    }
  },

  async updateJudgeTeam(judgeIDs, teamID) {
    if (!Array.isArray(judgeIDs) || judgeIDs.length === 0) {
      throw new Error("judgeIDs must be a non-empty array");
    }

    try {
      const updateResults = await Promise.all(
        judgeIDs.map(async (judgeID): Promise<JudgeUpdateResult | null> => {
          try {
            if (!judgeID) {
              console.error("Error: judgeID is missing!");
              return null;
            }

            const judge = (await db.getOne(
              judgeID,
              JUDGING_TABLE,
            )) as JudgeRecord | null;
            if (!judge) {
              console.log(`Judge ${judgeID} not found, skipping.`);
              return {
                judgeID,
                status: "not found",
              };
            }
            judge.currentTeam = teamID;
            await db.put(judge, JUDGING_TABLE, false);

            console.log(`Judge ${judgeID} updated to team ${teamID}`);
            return {
              judgeID,
              status: "updated",
            };
          } catch (err) {
            console.error(`Failed to update judge ${judgeID}:`, err);
            return {
              judgeID,
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );

      console.log("All judges updated successfully:", updateResults);

      return helpers.createResponse(200, {
        message: "Judges updated successfully",
        updatedJudges: judgeIDs,
        newTeamID: teamID,
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
    if (eventID_year === process.env.PRODUCTPLUS_EVENT_KEY) {
      return updateProductPlusMembership(memberID, eventID_year, "leave");
    }

    const registration = (await db.getOne(memberID, USER_REGISTRATIONS_TABLE, {
      "eventID;year": eventID_year,
    })) as RegistrationRecord | null;

    if (!registration) {
      throw helpers.inputError(
        `User ${memberID} is not registered for event ${eventID_year}`,
        404,
      );
    }

    if (!registration.teamID) {
      throw helpers.inputError(`User ${memberID} is not on any team`, 400);
    }

    const team = await teamHelpers._getTeamFromUserRegistration(
      memberID,
      eventID,
      year,
    );
    if (!team) {
      throw helpers.inputError(`Team not found for user ${memberID}`, 404);
    }

    // Remove member from the team
    team.memberIDs = team.memberIDs.filter((id) => id !== memberID);

    // TODO: delete team if empty ?
    await teamHelpers._putTeam(team, false);

    // Remove teamID from user registration
    registration.teamID = "";

    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames,
    } = db.createUpdateExpression(registration);

    const updateParams = {
      Key: {
        id: registration.id,
        ["eventID;year"]: eventID_year,
      },
      TableName:
        USER_REGISTRATIONS_TABLE + (process.env.ENVIRONMENT || ""),
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: {
        ...expressionAttributeNames,
        "#eventIDYear": "eventID;year",
      },
      UpdateExpression: updateExpression,
      ReturnValues: "UPDATED_NEW",
      ConditionExpression:
        "attribute_exists(id) and attribute_exists(#eventIDYear)",
    };

    await db.updateDBCustom(updateParams);

    return {
      success: true,
      message: `User ${memberID} has left the team.`,
    };
  },

  async joinTeam(memberID, eventID, year, teamID) {
    const eventID_year = eventID + ";" + year;
    if (eventID_year === process.env.PRODUCTPLUS_EVENT_KEY) {
      return updateProductPlusMembership(memberID, eventID_year, "join", teamID);
    }

    const registration = (await db.getOne(memberID, USER_REGISTRATIONS_TABLE, {
      "eventID;year": eventID_year,
    })) as RegistrationRecord | null;

    if (!registration) {
      throw helpers.inputError(
        `User ${memberID} is not registered for event ${eventID_year}`,
        403,
      );
    }

    if (registration.registrationStatus?.toLowerCase() !== "checkedin") {
      throw helpers.inputError(
        `User ${memberID} has not checked in for event ${eventID_year}`,
        403,
      );
    }

    if ((registration.teamID?.length ?? 0) > 0) {
      throw helpers.inputError(
        `User ${memberID} is already in another team`,
        400,
      );
    }

    // Get the team
    const team = (await db.getOne(teamID, TEAMS_TABLE, {
      "eventID;year": eventID_year,
    })) as TeamRecord | null;

    if (!team) {
      throw helpers.inputError(`Team ${teamID} does not exist`, 404);
    }

    // Short circuit if user is already in the team
    if (team.memberIDs.includes(memberID)) {
      throw helpers.inputError(
        `User ${memberID} is already in team ${teamID}`,
        400,
      );
    }

    // Add the member to the team
    team.memberIDs.push(memberID);
    const memberIDs = team.memberIDs;
    await teamHelpers._putTeam(team, false);

    // Update the user's registration
    registration.teamID = teamID;

    const {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames,
    } = db.createUpdateExpression(registration);

    const updateParams = {
      Key: {
        id: registration.id,
        ["eventID;year"]: eventID_year,
      },
      TableName:
        USER_REGISTRATIONS_TABLE +
        (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: {
        ...expressionAttributeNames,
        "#eventIDYear": "eventID;year",
      },
      UpdateExpression: updateExpression,
      ReturnValues: "UPDATED_NEW",
      ConditionExpression:
        "attribute_exists(id) and attribute_exists(#eventIDYear)",
    };

    await db.updateDBCustom(updateParams);

    return {
      success: true,
      message: `User ${memberID} joined team ${team.teamName}`,
      memberIDs, // return list of members in the team
      teamName: team.teamName, // return team name
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
          "eventID;year": eventID_year,
        })
        .then((res) => {
          const registration = res as RegistrationRecord | null;
          if (!registration) {
            throw helpers.inputError(
              "User " +
                memberID +
                " is not registered for event " +
                eventID_year,
              403,
            );
          }

          // hardcoded for kickstart 2025
          if (registration.registrationStatus?.toLowerCase() !== "checkedin") {
            throw helpers.inputError(
              "User " +
                memberID +
                " is not checked in for event " +
                eventID_year,
              403,
            );
          }

          // disallow users from adding people already in other teams to their own team
          if ((registration.teamID?.length ?? 0) > 0) {
            throw helpers.inputError(
              "User " + memberID + " is already registered to a team",
            );
          }
        });
    }

    const params: NewTeamRecord = {
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
      metadata: {},
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
        const res = (await db.getOne(memberID, USER_REGISTRATIONS_TABLE, {
          "eventID;year": eventID_year,
        })) as RegistrationRecord;

        if (res.teamID) {
          // If user is already on a team, remove them from that team on the Teams table
          const team = await teamHelpers._getTeamFromUserRegistration(
            memberID,
            eventID,
            year,
          );
          if (team) {
            team.memberIDs = team.memberIDs.filter((id) => id !== memberID);
            await teamHelpers._putTeam(team, false);
          }
        }

        res.teamID = params.id;

        let conditionExpression =
          "attribute_exists(id) and attribute_exists(#eventIDYear)";
        const {
          updateExpression,
          expressionAttributeValues,
          expressionAttributeNames,
        } = db.createUpdateExpression(res);

        let updateParams = {
          Key: {
            id: res.id,
            ["eventID;year"]: eventID + ";" + year,
          },
          TableName:
            USER_REGISTRATIONS_TABLE +
            (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
          ExpressionAttributeValues: expressionAttributeValues,
          ExpressionAttributeNames: {
            ...expressionAttributeNames,
            "#eventIDYear": "eventID;year",
          },
          UpdateExpression: updateExpression,
          ReturnValues: "UPDATED_NEW",
          ConditionExpression: conditionExpression,
        };

        await db.updateDBCustom(updateParams);
      }

      // Return the newly created team
      return params;
    } catch (error) {
      console.log(error);
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  },
  async checkQRScanned(user_id, qr_code_id, eventID, year) {
    /*
        Checks if a user's team has already scanned a QR code. Return true if they have, false if they haven't.
        This method might not make sense in the far future, but it's here so that the QR microservice can quickly check :')
        PLEASE REVISIT
   */

    // get user's team using helper function _getTeamFromUserRegistration
    return await teamHelpers
      ._getTeamFromUserRegistration(user_id, eventID, year)
      .then((team) => {
        if (!team) {
          throw new Error(`User ${user_id} is not on a team`);
        }

        // check if qr_code_id is in scannedQRs
        return team.scannedQRs.includes(qr_code_id);
      })
      .catch((err) => {
        console.log(err);
        throw new Error(err instanceof Error ? err.message : String(err));
      });
  },
  async addQRScan(user_id, qr_code_id, eventID, year, points) {
    /*
        Adds a QR code to the scannedQRs array of a user's team.
   */

    // get user's team using helper function _getTeamFromUserRegistration
    return await teamHelpers
      ._getTeamFromUserRegistration(user_id, eventID, year)
      .then((team) => {
        if (!team) {
          throw new Error(`User ${user_id} is not on a team`);
        }

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
          teamHelpers
            ._putTeam(team, false)
            .then((res) => {
              resolve(res);
            })
            .catch((err) => {
              reject(err);
            });
        });
      });
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

    return await teamHelpers
      ._getTeamFromUserRegistration(user_id, eventID, year)
      .then((team) => {
        if (!team) {
          throw new Error(`User ${user_id} is not on a team`);
        }

        const uniqueQuestions = questions.filter(
          (question) => !team.scannedQRs.includes(question),
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
          teamHelpers
            ._putTeam(team, false)
            .then((res) => {
              resolve(res);
            })
            .catch((err) => {
              reject(err);
            });
        });
      });
  },

  async changeTeamName(user_id, eventID, year, team_name) {
    /*
        Changes a team's name in the Teams table
   */

    return await teamHelpers
      ._getTeamFromUserRegistration(user_id, eventID, year)
      .then((team) => {
        if (!team) {
          throw new Error(`User ${user_id} is not on a team`);
        }

        team.teamName = team_name;

        return new Promise((resolve, reject) => {
          teamHelpers
            ._putTeam(team, false)
            .then((res) => {
              resolve(res);
            })
            .catch((err) => {
              reject(err);
            });
        });
      });
  },
};

export default teamHelpers;

export const normalizeScores = (
  scores: JudgeScore[],
  scoreAvg: ScoreAverage,
): NormalizedScore[] => {
  let normalizedScores: NormalizedScore[] = [];
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
    let scoreObj: NormalizedScore = {
      team: scores[i].team,
      teamName: scores[i].teamName,
      judge: scores[i].judge,
      metric1: s1N !== 0 ? (scores[i].metric1 - scoreAvg.metric1) / s1N : 0,
      metric2: s2N !== 0 ? (scores[i].metric2 - scoreAvg.metric2) / s2N : 0,
      metric3: s3N !== 0 ? (scores[i].metric3 - scoreAvg.metric3) / s3N : 0,
      metric4: s4N !== 0 ? (scores[i].metric4 - scoreAvg.metric4) / s4N : 0,
      metric5: s5N !== 0 ? (scores[i].metric5 - scoreAvg.metric5) / s5N : 0,
      originalScores: scores,
    };

    normalizedScores.push(scoreObj);
  }

  return normalizedScores;
};

// UNSAFE
// doesn't account for length == 0 cause it will only be called on arrays > 0 length
export const scoreObjectAverage = (
  originalScores: JudgeScore[],
): ScoreAverage => {
  let scoreAvg: ScoreAverage = {
    metric1: 0,
    metric2: 0,
    metric3: 0,
    metric4: 0,
    metric5: 0,
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
  originalScores: JudgeScore[],
  w1: number,
  w2: number,
  w3: number,
  w4: number,
  w5: number,
): number => {
  let scoreAvg: ScoreAverage = {
    metric1: 0,
    metric2: 0,
    metric3: 0,
    metric4: 0,
    metric5: 0,
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
