import {
  QueryCommand, UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import {
  QRS_TABLE,
  CONNECTIONS_TABLE,
  QUESTS_TABLE
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
  if (userID == connID) {
    return handlerHelpers.createResponse(400, {
      message: "Cannot connect with yourself"
    });
  }

  let profileData = await db.getOne(userID, QRS_TABLE, {
    "eventID;year": CURRENT_EVENT
  });
  let connProfileData = await db.getOne(connID, QRS_TABLE, {
    "eventID;year": CURRENT_EVENT
  });

  if (!profileData || !connProfileData) {
    return handlerHelpers.createResponse(400, {
      message: `User profile does not exist for user identified by ${
        !profileData ? userID : connID
      }`
    });
  }

  let {
    data: userData, type: userType
  } = profileData;
  let {
    data: connData, type: connType
  } = connProfileData;

  if (
    await isDuplicateRequest(userData.registrationID, connData.registrationID)
  ) {
    return handlerHelpers.createResponse(400, {
      message: "Connection has already been made"
    });
  }

  let swap = false;
  if (userType == EXEC && connType == EXEC) {
    connType = EXEC + EXEC;
  } else if (userType == EXEC) {
    // in the case that the first user is an EXEC, switch required for switch-case logic to catch
    userData = [connData, (connData = userData)][0];
    userType = [connType, (connType = userType)][0];
    userID = [connID, (connID = userID)][0];
    swap = true;
  }

  const userPut = {
    userID: userData.registrationID,
    obfuscatedID: connID,
    "eventID;year": CURRENT_EVENT,
    createdAt: timestamp,
    ...(connData.linkedinURL
      ? {
        linkedinURL: connData.linkedinURL
      }
      : {
      }),
    ...(connData.fname
      ? {
        fname: connData.fname
      }
      : {
      }),
    ...(connData.lname
      ? {
        lname: connData.lname
      }
      : {
      }),
    ...(connData.major
      ? {
        major: connData.major
      }
      : {
      }),
    ...(connData.year
      ? {
        year: connData.year
      }
      : {
      }),
    ...(connData.company
      ? {
        company: connData.company
      }
      : {
      }),
    ...(connData.title
      ? {
        title: connData.title
      }
      : {
      })
  };

  const connPut = {
    userID: connData.registrationID,
    obfuscatedID: userID,
    "eventID;year": CURRENT_EVENT,
    createdAt: timestamp,
    ...(userData.linkedinURL
      ? {
        linkedinURL: userData.linkedinURL
      }
      : {
      }),
    ...(userData.fname
      ? {
        fname: userData.fname
      }
      : {
      }),
    ...(userData.lname
      ? {
        lname: userData.lname
      }
      : {
      }),
    ...(userData.major
      ? {
        major: userData.major
      }
      : {
      }),
    ...(userData.year
      ? {
        year: userData.year
      }
      : {
      }),
    ...(userData.company
      ? {
        company: userData.company
      }
      : {
      }),
    ...(userData.title
      ? {
        title: userData.title
      }
      : {
      })
  };

  switch (connType) {
  case EXEC + EXEC:
    try {
      await incrementQuestProgress(
        connData.registrationID,
        QUEST_CONNECT_EXEC_H
      );
    } catch (error) {
      console.error(error);
      return handlerHelpers.createResponse(500, {
        message: "Internal server error"
      });
    }

  case EXEC:
    try {
      await incrementQuestProgress(
        userData.registrationID,
        QUEST_CONNECT_EXEC_H
      );
    } catch (error) {
      console.error(error);
      return handlerHelpers.createResponse(500, {
        message:
            "Internal server error, data inconsistency :( not all quests progressed"
      });
    }

    // case ATTENDEE:
  default:
    try {
      // potential race condition -> use transactions to fix, but will take time to implement
      await db.put(connPut, CONNECTIONS_TABLE, true);
      await db.put(userPut, CONNECTIONS_TABLE, true);
      await incrementQuestProgress(
        userData.registrationID,
        QUEST_CONNECT_ONE
      );
      await incrementQuestProgress(
        userData.registrationID,
        QUEST_CONNECT_FOUR
      );
      await incrementQuestProgress(
        userData.registrationID,
        QUEST_CONNECT_TEN_H
      );
      await incrementQuestProgress(
        connData.registrationID,
        QUEST_CONNECT_ONE
      );
      await incrementQuestProgress(
        connData.registrationID,
        QUEST_CONNECT_FOUR
      );
      await incrementQuestProgress(
        connData.registrationID,
        QUEST_CONNECT_TEN_H
      );
    } catch (error) {
      console.error(error);
      return handlerHelpers.createResponse(500, {
        message: "Internal server error"
      });
    }
    break;

    // case PARTNER:
    //   break;

    // default:
    //   break;
  }

  return handlerHelpers.createResponse(200, {
    message: `Connection created with ${swap ? userData.fname : connData.fname}`
  });
};

const isDuplicateRequest = async (userID, connID) => {
  let result;
  try {
    const command = new QueryCommand({
      ExpressionAttributeValues: {
        ":conn": connID,
        ":uid": userID
      },
      KeyConditionExpression: "obfuscatedID = :conn AND userID = :uid",
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
  const {
    data
  } = await db.getOne(profileID, QRS_TABLE, {
    "eventID;year": CURRENT_EVENT
  });

  let userID = data.registrationID;

  if (workshopID != WORKSHOP_TWO) {
    return handlerHelpers.createResponse(200, {
      message: `Checked into ${workshopID}`
    });
  }

  try {
    await incrementQuestProgress(userID, QUEST_WORKSHOP);
    return handlerHelpers.createResponse(200, {
      message: "Checked into workshop 2"
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const handleBooth = async (profileID, boothID, timestamp) => {
  const {
    data
  } = await db.getOne(profileID, QRS_TABLE, {
    "eventID;year": CURRENT_EVENT
  });

  let userID = data.registrationID;

  if (BIGTECH.includes(boothID)) {
    try {
      await incrementQuestProgress(userID, QUEST_BIGTECH);
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
      await incrementQuestProgress(userID, QUEST_STARTUP);
      return handlerHelpers.createResponse(200, {
        message: `Checked into booth ${boothID}`
      });
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  if (boothID == PHOTOBOOTH) {
    try {
      await incrementQuestProgress(userID, QUEST_PHOTOBOOTH);
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
