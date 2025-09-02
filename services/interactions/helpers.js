import {
  PutCommand, QueryCommand, UpdateCommand
} from "@aws-sdk/lib-dynamodb";
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
  QUEST_WORKSHOP_TWO_PARTICIPANT,
  QUEST_TOTAL_CONNECTIONS
} from "./constants";
import {
  PROFILE_TYPES, TYPES
} from "../profiles/constants";

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

  let userProfile = q1;
  let connProfile = q2;

  if (await isDuplicateRequest(userProfileID, connProfileID)) {
    return handlerHelpers.createResponse(200, {
      message: "Connection has already been made"
    });
  }

  let swap = false;
  if (userProfile.profileType === EXEC && connProfile.profileType === EXEC) {
    connProfile.type = PROFILE_TYPES.EXEC + PROFILE_TYPES.EXEC;
  } else if (userProfile.profileType === EXEC) {
    userProfile = [connProfile, (connProfile = userProfile)][0];
    userID = [connProfileID, (connProfileID = userID)][0];
    swap = true;
  }

  const userPut = {
    compositeID: `${TYPES.PROFILE}#${userProfileID}`,
    type: `${TYPES.CONNECTION}#${connProfileID}`,
    connectionID: connProfileID,
    createdAt: timestamp,
    fname: connProfile.fname,
    lname: connProfile.lname,
    pronouns: connProfile.pronouns,
    ...(connProfile.major
      ? {
        major: connProfile.major
      }
      : {
      }),
    ...(connProfile.year
      ? {
        year: connProfile.year
      }
      : {
      }),
    ...(connProfile.company
      ? {
        company: connProfile.company
      }
      : {
      }),
    ...(connProfile.title
      ? {
        title: connProfile.title
      }
      : {
      })
  };

  const connPut = {
    compositeID: `${TYPES.PROFILE}#${connProfileID}`,
    type: `${TYPES.CONNECTION}#${userProfileID}`,
    createdAt: timestamp,
    fname: userProfile.fname,
    lname: userProfile.lname,
    pronouns: userProfile.pronouns,
    ...(userProfile.major
      ? {
        major: userProfile.major
      }
      : {
      }),
    ...(userProfile.year
      ? {
        year: userProfile.year
      }
      : {
      }),
    ...(userProfile.company
      ? {
        company: userProfile.company
      }
      : {
      }),
    ...(userProfile.title
      ? {
        title: userProfile.title
      }
      : {
      })
  };

  const promises = [];
  switch (connProfile.profileType) {
  // exec cases temporarily will be paused as we decide how to handle other interactions
  case PROFILE_TYPES.EXEC + PROFILE_TYPES.EXEC:
    // promises.push(
    //   incrementQuestProgress(userProfileID, QUEST_CONNECT_EXEC_H)
    // );

  case PROFILE_TYPES.EXEC:
    // promises.push(
    //   incrementQuestProgress(connProfileID, QUEST_CONNECT_EXEC_H)
    // );

    // case ATTENDEE:
  default:
    try {
      await db.putMultiple(
        [connPut, userPut],
        [PROFILES_TABLE, PROFILES_TABLE],
        true
      );
    } catch (error) {
      console.error(error);
      return handlerHelpers.createResponse(500, {
        message: "Internal server error"
      });
    }
    // incrementQuestProgress(userProfile.id, QUEST_TOTAL_CONNECTIONS),
    // incrementQuestProgress(connProfile.id, QUEST_TOTAL_CONNECTIONS)
    break;
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
  const result = await db.getOneCustom({
    TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
    Key: {
      compositeID: `PROFILE#${userID}`,
      type: `${TYPES.CONNECTION}#${connID}`
    }
  });
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
    UpdateExpression:
      "SET progress = if_not_exists(progress, :startValue) + :incrementValue",
    ExpressionAttributeValues: {
      ":startValue": 1,
      ":incrementValue": 1
    },
    ReturnValues: "ALL_NEW"
  });

  return await docClient.send(command);
};
