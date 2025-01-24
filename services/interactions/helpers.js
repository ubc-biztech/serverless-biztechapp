import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  QRS_TABLE,
  CONNECTIONS_TABLE,
  QUESTS_TABLE,
  PROFILES_TABLE
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
  QUEST_CONNECT_EXEC_H
} from "./constants";

export const handleConnection = async (userID, connID, timestamp) => {
  let userData = await db.getOne(userID, PROFILES_TABLE, {
    "eventID;year": CURRENT_EVENT
  });

  let { data: connProfileData } = await db.getOne(connID, QRS_TABLE, {
    "eventID;year": CURRENT_EVENT
  });

  if (userID === connProfileData.registrationID) {
    return handlerHelpers.createResponse(400, {
      message: "Cannot connect with yourself"
    });
  }

  if (!userData || !connProfileData) {
    return handlerHelpers.createResponse(400, {
      message: `User profile does not exist for user identified by ${
        !userData ? userID : connID
      }`
    });
  }

  let connData = await db.getOne(
    connProfileData.registrationID,
    PROFILES_TABLE,
    {
      "eventID;year": CURRENT_EVENT
    }
  );

  if (await isDuplicateRequest(userData.id, connID)) {
    return handlerHelpers.createResponse(400, {
      message: "Connection has already been made"
    });
  }

  let swap = false;
  if (userData.type === EXEC && connData.type === EXEC) {
    connData.type = EXEC + EXEC;
  } else if (userData.type === EXEC) {
    // in the case that the first user is an EXEC, switch required for switch-case logic to catch
    userData = [connData, (connData = userData)][0];
    userID = [connID, (connID = userID)][0];
    swap = true;
  }

  const userPut = {
    userID: userData.id,
    obfuscatedID: connID,
    "eventID;year": CURRENT_EVENT,
    createdAt: timestamp,
    ...(connData.linkedin
      ? {
          linkedinURL: connData.linkedin
        }
      : {}),
    ...(connData.fname
      ? {
          fname: connData.fname
        }
      : {}),
    ...(connData.lname
      ? {
          lname: connData.lname
        }
      : {}),
    ...(connData.major
      ? {
          major: connData.major
        }
      : {}),
    ...(connData.year
      ? {
          year: connData.year
        }
      : {}),
    ...(connData.company
      ? {
          company: connData.company
        }
      : {}),
    ...(connData.title
      ? {
          title: connData.title
        }
      : {})
  };

  const connPut = {
    userID: connData.id,
    obfuscatedID: userID,
    "eventID;year": CURRENT_EVENT,
    createdAt: timestamp,
    ...(userData.linkedin
      ? {
          linkedinURL: userData.linkedin
        }
      : {}),
    ...(userData.fname
      ? {
          fname: userData.fname
        }
      : {}),
    ...(userData.lname
      ? {
          lname: userData.lname
        }
      : {}),
    ...(userData.major
      ? {
          major: userData.major
        }
      : {}),
    ...(userData.year
      ? {
          year: userData.year
        }
      : {}),
    ...(userData.company
      ? {
          company: userData.company
        }
      : {}),
    ...(userData.title
      ? {
          title: userData.title
        }
      : {})
  };

  const promises = [];
  switch (connData.type) {
    case EXEC + EXEC:
      promises.push(
        incrementQuestProgress(connData.registrationID, QUEST_CONNECT_EXEC_H)
      );

    case EXEC:
      promises.push(
        incrementQuestProgress(userData.registrationID, QUEST_CONNECT_EXEC_H)
      );

    // case ATTENDEE:
    default:
      promises.push(
        db.put(connPut, CONNECTIONS_TABLE, true),
        db.put(userPut, CONNECTIONS_TABLE, true),
        incrementQuestProgress(userData.id, QUEST_CONNECT_ONE),
        incrementQuestProgress(userData.id, QUEST_CONNECT_FOUR),
        incrementQuestProgress(userData.id, QUEST_CONNECT_TEN_H),
        incrementQuestProgress(connData.id, QUEST_CONNECT_ONE),
        incrementQuestProgress(connData.id, QUEST_CONNECT_FOUR),
        incrementQuestProgress(connData.id, QUEST_CONNECT_TEN_H)
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
      swap ? userData.fname : connData.fname
    }`,
    name: `${
      swap
        ? userData.fname + " " + userData.lname
        : connData.fname + " " + connData.lname
    }`
  });
};

const isDuplicateRequest = async (userID, connID) => {
  let result;
  try {
    const command = new QueryCommand({
      ExpressionAttributeValues: {
        ":uid": userID,
        ":conn": connID
      },
      KeyConditionExpression: "userID = :uid AND obfuscatedID = :conn",
      ProjectionExpression: "userID, obfuscatedID",
      TableName: CONNECTIONS_TABLE + (process.env.ENVIRONMENT || "")
    });

    result = await docClient.send(command);
  } catch (error) {
    console.error(error);
    throw error;
  }

  return result.Items.length > 0;
};

export const handleWorkshop = async (profileID, workshopID, timestamp) => {
  if (workshopID !== WORKSHOP_TWO) {
    return handlerHelpers.createResponse(200, {
      message: `Checked into ${workshopID}`
    });
  }

  try {
    await incrementQuestProgress(profileID, QUEST_WORKSHOP);
    return handlerHelpers.createResponse(200, {
      message: "Checked into workshop 2"
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const handleBooth = async (profileID, boothID, timestamp) => {
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
