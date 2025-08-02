import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  QRS_TABLE,
  CONNECTIONS_TABLE,
  QUESTS_TABLE,
  PROFILES_TABLE,
  NFC_SCANS_TABLE,
  MEMBERS2026_TABLE
} from "../../constants/tables";
import db from "../../lib/db";
import handlerHelpers from "../../lib/handlerHelpers";
import docClient from "../../lib/docClient";
import {
  ATTENDEE,
  BIGTECH,
  CURRENT_EVENT,
  EXEC,
  PARTNER,
  QUEST_BIGTECH,
  QUEST_STARTUP,
  QUEST_CONNECT_FOUR,
  QUEST_CONNECT_ONE,
  QUEST_CONNECT_TEN_H,
  QUEST_WORKSHOP,
  STARTUPS,
  WORKSHOP_TWO,
  PHOTOBOOTH,
  QUEST_PHOTOBOOTH,
  QUEST_CONNECT_EXEC_H,
  WORKSHOP_TWO_PARTICIPANT,
  QUEST_WORKSHOP_TWO_PARTICIPANT
} from "./constants";
import { TYPES } from "../profiles/constants";

export const handleConnection = async (userID, connProfileID, timestamp) => {
  let memberData = await db.getOne(userID, MEMBERS2026_TABLE);

  let userProfileID = memberData.profileID;

  if (userProfileID === connProfileID) {
    return handlerHelpers.createResponse(400, {
      message: "Cannot connect with yourself"
    });
  }

  let [q1, q2] = await Promise.all([
    db.getOneCustom({
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        compositeID: `PROFILE#${userProfileID}`,
        type: TYPES.PROFILE
      }
    }),
    db.getOneCustom({
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        compositeID: `PROFILE#${connProfileID}`,
        type: TYPES.PROFILE
      }
    })
  ]);

  if (!q1 || !q2) {
    throw handlerHelpers.notFoundResponse(
      "Profile",
      q1 ? connProfileID : userID
    );
  }

  const userProfile = q1[0];
  const connProfile = q2[0];

  if (await isDuplicateRequest(userProfileID, connProfileID)) {
    return handlerHelpers.createResponse(200, {
      message: "Connection has already been made"
    });
  }

  let swap = false;
  if (userProfile.type === EXEC && connProfile.type === EXEC) {
    connProfile.type = EXEC + EXEC;
  } else if (userProfile.type === EXEC) {
    userProfile = [connProfile, (connProfile = userProfile)][0];
    userID = [connProfileID, (connProfileID = userID)][0];
    swap = true;
  }

  const userPut = {
    userID: userProfile.id,
    obfuscatedID: connProfile.profileID,
    "eventID;year": CURRENT_EVENT,
    createdAt: timestamp,
    ...(connProfile.linkedin
      ? {
          linkedinURL: connProfile.linkedin
        }
      : {}),
    ...(connProfile.fname
      ? {
          fname: connProfile.fname
        }
      : {}),
    ...(connProfile.lname
      ? {
          lname: connProfile.lname
        }
      : {}),
    ...(connProfile.major
      ? {
          major: connProfile.major
        }
      : {}),
    ...(connProfile.year
      ? {
          year: connProfile.year
        }
      : {}),
    ...(connProfile.company
      ? {
          company: connProfile.company
        }
      : {}),
    ...(connProfile.role
      ? {
          title: connProfile.role
        }
      : {})
  };

  const connPut = {
    userID: connProfile.id,
    obfuscatedID: userProfile.profileID,
    "eventID;year": CURRENT_EVENT,
    createdAt: timestamp,
    ...(userProfile.linkedin
      ? {
          linkedinURL: userProfile.linkedin
        }
      : {}),
    ...(userProfile.fname
      ? {
          fname: userProfile.fname
        }
      : {}),
    ...(userProfile.lname
      ? {
          lname: userProfile.lname
        }
      : {}),
    ...(userProfile.major
      ? {
          major: userProfile.major
        }
      : {}),
    ...(userProfile.year
      ? {
          year: userProfile.year
        }
      : {}),
    ...(userProfile.company
      ? {
          company: userProfile.company
        }
      : {}),
    ...(userProfile.role
      ? {
          role: userProfile.role
        }
      : {})
  };

  const promises = [];
  switch (connProfile.type) {
    case EXEC + EXEC:
      promises.push(incrementQuestProgress(profileID, QUEST_CONNECT_EXEC_H));

    case EXEC:
      promises.push(
        incrementQuestProgress(userProfile.id, QUEST_CONNECT_EXEC_H)
      );

    // case ATTENDEE:
    default:
      promises.push(
        db.put(connPut, CONNECTIONS_TABLE, true),
        db.put(userPut, CONNECTIONS_TABLE, true),
        incrementQuestProgress(userProfile.id, QUEST_CONNECT_ONE),
        incrementQuestProgress(userProfile.id, QUEST_CONNECT_FOUR),
        incrementQuestProgress(userProfile.id, QUEST_CONNECT_TEN_H),
        incrementQuestProgress(connProfile.id, QUEST_CONNECT_ONE),
        incrementQuestProgress(connProfile.id, QUEST_CONNECT_FOUR),
        incrementQuestProgress(connProfile.id, QUEST_CONNECT_TEN_H)
      );
      break;
  }

  try {
    await Promise.all(promises);
  } catch (error) {
    console.error(error);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error"
    });
  }

  return handlerHelpers.createResponse(200, {
    message: `Connection created with ${
      swap ? userProfile.fname : connProfile.fname
    }`,
    name: `${
      swap
        ? userProfile.fname + " " + userProfile.lname
        : connProfile.fname + " " + connProfile.lname
    }`
  });
};

const isDuplicateRequest = async (userID, connID) => {
  let result;
  try {
    result = await db.getOneCustom({
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        compositeID: `PROFILE#${userID}`,
        type: `${TYPES.CONNECTION}#${connID}`
      }
    });
  } catch (error) {
    console.error(error);
    throw error;
  }

  return Boolean(result);
};

export const handleWorkshop = async (profileID, workshopID, timestamp) => {
  try {
    switch (workshopID) {
      case WORKSHOP_TWO:
        await incrementQuestProgress(profileID, QUEST_WORKSHOP);
        return handlerHelpers.createResponse(200, {
          message: "Completed Workshop Two Challenge"
        });

      case WORKSHOP_TWO_PARTICIPANT:
        await incrementQuestProgress(profileID, QUEST_WORKSHOP_TWO_PARTICIPANT);
        return handlerHelpers.createResponse(200, {
          message: "Braved 1-on-1 onstage interview"
        });

      default:
        return handlerHelpers.createResponse(200, {
          message: "Unknown workshop"
        });
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const handleBooth = async (profileID, boothID, timestamp) => {
  let putItem = {
    id: profileID,
    name: boothID,
    createdAt: timestamp
  };

  const params = {
    Item: putItem,
    TableName: NFC_SCANS_TABLE + (process.env.ENVIRONMENT || "")
  };

  try {
    const command = new PutCommand(params);
    await docClient.send(command);
  } catch (err) {
    const errorResponse = this.dynamoErrorResponse(err);
    console.error(errorResponse);
  }

  if (BIGTECH.includes(boothID)) {
    try {
      await incrementQuestProgress(profileID, QUEST_BIGTECH);
      return handlerHelpers.createResponse(200, {
        message: `Checked into booth ${boothID}`
      });
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  if (STARTUPS.includes(boothID)) {
    try {
      await incrementQuestProgress(profileID, QUEST_STARTUP);
      return handlerHelpers.createResponse(200, {
        message: `Checked into booth ${boothID}`
      });
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  if (boothID === PHOTOBOOTH) {
    try {
      await incrementQuestProgress(profileID, QUEST_PHOTOBOOTH);
      return handlerHelpers.createResponse(200, {
        message: `Checked into booth ${boothID}`
      });
    } catch (error) {
      console.error(error);
      throw error;
    }
  }
};

const incrementQuestProgress = async (userID, questID) => {
  const command = new UpdateCommand({
    TableName: QUESTS_TABLE + (process.env.ENVIRONMENT || ""),
    Key: {
      userID,
      questID
    },
    UpdateExpression: "ADD progress :incrementValue",
    ExpressionAttributeValues: {
      ":incrementValue": 1
    },
    ReturnValues: "ALL_NEW"
  });

  return await docClient.send(command);
};
