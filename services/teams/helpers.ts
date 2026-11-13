import { randomInt } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import {
  USER_REGISTRATIONS_TABLE,
  USERS_TABLE,
  TEAMS_TABLE,
  JUDGING_TABLE,
} from "../../constants/tables";
import helpers from "../../lib/handlerHelpers.js";
import db, { field } from "../../lib/db.js";
import {
  KICKSTART_EVENT_KEY,
  KICKSTART_TEAM_REGISTRATION_STATUSES,
} from "../../constants/kickstart";
import type { APIGatewayResponse } from "../../lib/types";
import type { WriteBuilder } from "../../lib/db/build/WriteBuilder.js";
import type {
  EventTeamRecord,
  JudgeScore,
  JudgeUpdateResult,
  NewTeamRecord,
  NormalizedScore,
  ScoreAverage,
  Team,
  TeamRecord,
  TeamsHelpers,
} from "./types";
import docClient from "../../lib/docClient.js";
import { GetCommand, TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { CleanupTask, TeamRecord as ProductPlusTeamRecord } from "../productplus/types";
import { buildInitialCompany, getCompanyProjectId } from "../btx/projects";
import { getUnusedCompanyDeletes, getTeamFormationChecks } from "../btx/teamFormation";

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

export type RegistrationRecord = {
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

export class EventTeamConflictError extends Error {
  constructor(message = "Team membership or registration changed. Reload and try again.") {
    super(message);
    this.name = "EventTeamConflictError";
  }
}

const cleanupLambda = new LambdaClient({ maxAttempts: 2 });

/** Asks Product Plus to remove a deleted team's submission and files. Call only after the delete commits. */
export async function enqueueTeamDeletedCleanup(eventKey: string, teamCode: string) {
  const task: CleanupTask = { internalTask: "team_deleted", payload: { event_key: eventKey, team_code: teamCode } };
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

/** Legacy Product Plus leave retains its atomic writes, retries, and file cleanup. */
async function leaveProductPlusTeam(memberID: string, eventKey: string) {
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
      const teamID = registration.teamID;
      if (!teamID) throw new ProductPlusTeamError(400, "Current team membership is required.");
      const teamKey = { id: teamID, "eventID;year": eventKey };
      const team = (await docClient.send(new GetCommand({
        TableName: teamsTable, Key: teamKey, ConsistentRead: true
      }))).Item as ProductPlusTeamRecord | undefined;
      if (!team || !(team.member_ids instanceof Set)) throw new ProductPlusTeamError(404, "Team does not exist.");
      if (!team.member_ids.has(memberID)) throw new ProductPlusTeamError(403, "Current team membership is required.");
      const members = new Set([...team.member_ids].filter(id => id !== memberID));
      const removeTeam = members.size === 0;
      if (removeTeam && (typeof team.id !== "string" || !/^\d{6}$/.test(team.id))) {
        throw new ProductPlusTeamError(409, "The Product Plus team needs its six-digit code before deletion.");
      }
      const teamCondition = {
        TableName: teamsTable, Key: teamKey,
        ConditionExpression: "attribute_exists(id) AND #members = :before" + (removeTeam ? " AND id = :code" : ""),
        ExpressionAttributeNames: { "#members": "member_ids" },
        ExpressionAttributeValues: { ":before": team.member_ids, ...(removeTeam ? { ":code": team.id } : {}) }
      };
      const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
        removeTeam ? { Delete: teamCondition } : { Update: {
          ...teamCondition, UpdateExpression: "SET #members = :after",
          ExpressionAttributeValues: { ...teamCondition.ExpressionAttributeValues, ":after": members }
        } },
        { Update: {
          TableName: registrationsTable, Key: registrationKey,
          ConditionExpression: "attribute_exists(id) AND #team = :before",
          UpdateExpression: "REMOVE #team",
          ExpressionAttributeNames: { "#team": "teamID" },
          ExpressionAttributeValues: { ":before": teamID }
        } }
      ];
      try {
        // The member-set condition rejects concurrent membership changes.
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
        const committed = savedRegistration.Item?.id === memberID && savedRegistration.Item.teamID === undefined && (removeTeam ? !savedTeam.Item :
            savedTeam.Item?.member_ids instanceof Set && !savedTeam.Item.member_ids.has(memberID));
        if (!committed) {
          console.error("Product Plus membership write needs recovery", {
            event_key: eventKey, team_id: teamID, team_code: team.id,
            error: error instanceof Error ? error.name : "UnknownError"
          });
          throw error;
        }
      }
      if (removeTeam) await enqueueTeamDeletedCleanup(eventKey, team.id);
      return { success: true, message: "Left team.", memberIDs: [...members], teamName: team.team_name };
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
      return leaveProductPlusTeam(memberID, eventID_year);
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

/** Display names from biztechUsers, keyed by user id; batched to DynamoDB's 100-key limit. */
export const getMemberNames = async (userIDs: string[]): Promise<Map<string, string>> => {
  const usersTable = USERS_TABLE + (process.env.ENVIRONMENT || "");
  const ids = [...new Set(userIDs)];
  const names = new Map<string, string>();
  for (let start = 0; start < ids.length; start += 100) {
    const { Responses } = (await db.batchGet(
      ids.slice(start, start + 100).map((id) => ({ id })),
      usersTable,
    )) as unknown as { Responses: Record<string, { id: string; fname?: string; lname?: string }[]> };
    for (const user of Responses[usersTable] ?? [])
      names.set(user.id, [user.fname, user.lname].filter(Boolean).join(" "));
  }
  return names;
};

export const toTeamMembers = (team: EventTeamRecord, names: Map<string, string>): Team["members"] =>
  [...team.member_ids].map((user_id) => ({
    user_id,
    name: names.get(user_id) || "Participant",
  }));

export const toTeamResponse = async (team: EventTeamRecord): Promise<Team> => ({
  team_code: team.id,
  team_name: team.team_name,
  leader_user_id: team.leader_user_id,
  members: toTeamMembers(team, await getMemberNames([...team.member_ids])),
  ...(team["eventID;year"] === KICKSTART_EVENT_KEY
    ? { projectId: getCompanyProjectId(team["eventID;year"], team.id) }
    : {}),
});

export const getEventRegistration = async (
  userID: string,
  eventKey: string,
): Promise<RegistrationRecord | null> =>
  (await db.getOne(userID, USER_REGISTRATIONS_TABLE, {
    "eventID;year": eventKey,
  })) as RegistrationRecord | null;

export const resolveTeamMembership = async (
  userID: string,
  eventKey: string,
): Promise<string | null> =>
  (await getEventRegistration(userID, eventKey))?.teamID || null;

/**
 * Null when the caller may take a team slot for this event, otherwise the response
 * saying why not. Kickstart 2027 also requires an accepted/checked-in status.
 */
export const requireTeamEligibility = async (
  userID: string,
  eventKey: string,
): Promise<APIGatewayResponse | null> => {
  const registration = await getEventRegistration(userID, eventKey);

  if (!registration) {
    return helpers.createResponse(403, {
      message: "You must be registered for this event",
    });
  }
  if (
    eventKey === KICKSTART_EVENT_KEY &&
    !KICKSTART_TEAM_REGISTRATION_STATUSES.some(
      status => status === registration.registrationStatus,
    )
  ) {
    return helpers.createResponse(403, {
      message: "Your Kickstart registration must be accepted or checked in to create or join a team",
    });
  }
  if (registration.teamID) {
    return helpers.createResponse(409, {
      message: "You are already on a team for this event",
    });
  }
  return null;
};

export const getEventTeam = async (
  teamCode: string,
  eventKey: string,
): Promise<EventTeamRecord | null> =>
  (await db.getOne(teamCode, TEAMS_TABLE, {
    "eventID;year": eventKey,
  })) as EventTeamRecord | null;

export const removeMemberAsLeader = async (
  team: EventTeamRecord,
  leaderID: string,
  memberID: string,
): Promise<void> => {
  const eventKey = team["eventID;year"];
  const marketChecks = eventKey === KICKSTART_EVENT_KEY
    ? await getTeamFormationChecks(eventKey, team.id)
    : [];

  await commitMembershipChange(
    eventKey,
    db.build
      .update(USER_REGISTRATIONS_TABLE, { id: memberID, "eventID;year": eventKey })
      .remove("teamID")
      .if("teamID").equals(team.id),
    // The leader stays on the team, so member_ids is never emptied here
    db.build
      .update(TEAMS_TABLE, { id: team.id, "eventID;year": eventKey })
      .removeFromSet("member_ids", [memberID])
      .if("leader_user_id").equals(leaderID)
      .if("member_ids").contains(leaderID)
      .if("member_ids").contains(memberID),
    ...marketChecks,
  );
};

/** A 6-digit team code, kept a string so leading zeros survive. */
export const generateTeamCode = (): string =>
  String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Prepare one registration claim, with the same eligibility rule as the precheck. */
const buildMembershipClaim = (team: EventTeamRecord, userID: string): WriteBuilder => {
  const eventKey = team["eventID;year"];
  const claim = db.build
    .update(
      USER_REGISTRATIONS_TABLE,
      { id: userID, "eventID;year": eventKey },
      { teamID: team.id },
    )
    .if("id").exists()
    .if("teamID").notExists();

  if (eventKey === KICKSTART_EVENT_KEY) {
    claim.anyOf(...KICKSTART_TEAM_REGISTRATION_STATUSES.map(
      status => field("registrationStatus").equals(status),
    ));
  }
  return claim;
};

const commitMembershipChange = async (eventKey: string, ...writes: WriteBuilder[]): Promise<void> => {
  try {
    await db.txn(...writes);
  } catch (error) {
    // A stale precheck is a state conflict, not an internal-server failure.
    if (eventKey === KICKSTART_EVENT_KEY && db.isConflict(error)) {
      throw new EventTeamConflictError();
    }
    throw error;
  }
};

/** Writes the team, leader membership, and Kickstart company/initial history together. */
export const createTeamWithLeader = async (team: EventTeamRecord): Promise<EventTeamRecord> => {
  const eventKey = team["eventID;year"];
  const maxAttempts = eventKey === KICKSTART_EVENT_KEY ? 3 : 1;
  const marketChecks = eventKey === KICKSTART_EVENT_KEY
    ? await getTeamFormationChecks(eventKey)
    : [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = attempt === 0 ? team : { ...team, id: generateTeamCode() };
    const writes: WriteBuilder[] = [
      // Keep this order aligned with the cancellation-reason checks below.
      db.build.put(TEAMS_TABLE, { ...candidate }).if("id").notExists(),
      buildMembershipClaim(candidate, candidate.leader_user_id),
    ];

    if (eventKey === KICKSTART_EVENT_KEY) {
      writes.push(...buildInitialCompany({
        eventId: eventKey,
        teamId: candidate.id,
        companyName: candidate.team_name,
      }));
    }

    const marketChecksStart = writes.length;
    writes.push(...marketChecks);

    try {
      await db.txn(...writes);
      return candidate;
    } catch (error) {
      if (eventKey !== KICKSTART_EVENT_KEY || !db.isConflict(error)) throw error;

      const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
      // A taken team code may also have its company already present. Membership
      // must still be valid; mixed failures and uncertain errors are not retried.
      const isCodeCollision = reasons?.length === writes.length &&
        reasons[0]?.Code === "ConditionalCheckFailed" &&
        reasons[1]?.Code === "None" &&
        reasons.slice(2, marketChecksStart).every(reason =>
          ["None", "ConditionalCheckFailed"].includes(reason.Code ?? "")) &&
        reasons.slice(marketChecksStart).every(reason => reason.Code === "None");
      if (isCodeCollision) continue;
      if (reasons?.slice(marketChecksStart).some(reason => reason.Code === "ConditionalCheckFailed")) {
        throw new EventTeamConflictError("Team creation availability changed. Reload and try again.");
      }
      throw new EventTeamConflictError();
    }
  }

  throw new EventTeamConflictError("Unable to create your team right now. Please try again.");
};

/** Adds `userID` to `team` and claims their membership together. */
export const addTeamMember = async (
  team: EventTeamRecord,
  userID: string,
): Promise<void> => {
  const eventKey = team["eventID;year"];
  const marketChecks = eventKey === KICKSTART_EVENT_KEY
    ? await getTeamFormationChecks(eventKey, team.id)
    : [];
  await commitMembershipChange(
    eventKey,
    buildMembershipClaim(team, userID),
    db.build
      .update(TEAMS_TABLE, { id: team.id, "eventID;year": team["eventID;year"] })
      .addToSet("member_ids", [userID])
      .if("id").exists(),
    ...marketChecks,
  );
};

/**
 * Drops `userID`'s own membership. The last member out deletes the team, since an
 * empty String Set cannot be stored; a departing leader hands off to `remaining`.
 */
export const removeSelfFromTeam = async (
  team: EventTeamRecord,
  userID: string,
  remaining: string[],
): Promise<void> => {
  const eventKey = team["eventID;year"];
  const teamKey = { id: team.id, "eventID;year": eventKey };
  // For last-member cleanup, the company check belongs on its Delete operation.
  const marketChecks = eventKey === KICKSTART_EVENT_KEY
    ? await getTeamFormationChecks(eventKey, remaining.length === 0 ? undefined : team.id)
    : [];
  if (eventKey === KICKSTART_EVENT_KEY && remaining.length === 0) {
    marketChecks.push(...await getUnusedCompanyDeletes(eventKey, team.id));
  }

  let teamWrite: WriteBuilder;
  if (remaining.length === 0) {
    // A concurrent join fails this
    teamWrite = db.build
      .delete(TEAMS_TABLE, teamKey)
      .if("member_ids").hasSize(1)
      .if("member_ids").contains(userID);
  } else if (team.leader_user_id === userID) {
    const newLeader = remaining[randomInt(0, remaining.length)];
    // contains(newLeader) stops the handoff naming someone who just left
    teamWrite = db.build
      .update(TEAMS_TABLE, teamKey, { leader_user_id: newLeader })
      .removeFromSet("member_ids", [userID])
      .if("leader_user_id").equals(userID)
      .if("member_ids").contains(userID)
      .if("member_ids").contains(newLeader);
  } else {
    // The leader stays on the team, so member_ids is never emptied here
    teamWrite = db.build
      .update(TEAMS_TABLE, teamKey)
      .removeFromSet("member_ids", [userID])
      .if("member_ids").contains(userID)
      .if("member_ids").contains(team.leader_user_id)
      .if("leader_user_id").notEquals(userID);
  }

  await commitMembershipChange(
    eventKey,
    db.build
      .update(USER_REGISTRATIONS_TABLE, { id: userID, "eventID;year": eventKey })
      .remove("teamID")
      .if("teamID").equals(team.id),
    teamWrite,
    ...marketChecks,
  );
};

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
