import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { QRS_TABLE, CONNECTIONS_TABLE } from "../../constants/tables";
import db from "../../lib/db";
import handlerHelpers from "../../lib/handlerHelpers";
import docClient from "../../lib/docClient";
import { ATTENDEE, CURRENT_EVENT, EXEC, PARTNER } from "./constants";

export const handleConnection = async (userID, connID, timestamp) => {
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

  const { data: userData } = profileData;
  const { data: connData, type } = connProfileData;

  if (
    await isDuplicateRequest(userData.registrationID, connData.registrationID)
  ) {
    return handlerHelpers.createResponse(400, {
      message: "Connection has already been made"
    });
  }

  const userPut = {
    userID: userData.registrationID,
    connID: connData.registrationID,
    obfuscatedID: connID,
    "eventID;year": CURRENT_EVENT,
    createdAt: timestamp,
    ...(connData.linkedinURL
      ? {
          linkedinURL: connData.linkedinURL
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
    userID: connData.registrationID,
    connID: userData.registrationID,
    obfuscatedID: userID,
    "eventID;year": CURRENT_EVENT,
    createdAt: timestamp,
    ...(userData.linkedinURL
      ? {
          linkedinURL: userData.linkedinURL
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

  switch (type) {
    case ATTENDEE:
      try {
        // potential race condition -> use transactions to fix, but will take time to implement
        await db.put(connPut, CONNECTIONS_TABLE, true);
        await db.put(userPut, CONNECTIONS_TABLE, true);
        // logic to check if quests entry has been made for connection
        // put command to update the quest entry
      } catch (error) {
        console.error(error);
        return handlerHelpers.createResponse(500, {
          message: "Internal server error"
        });
      }
      break;

    case EXEC:
      break;

    case PARTNER:
      break;

    default:
      break;
  }

  return handlerHelpers.createResponse(200, {
    message: `Connection created with ${connData.registrationID}`
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
      KeyConditionExpression: "connID = :conn AND userID = :uid",
      ProjectionExpression: "userID, connID",
      TableName: CONNECTIONS_TABLE + (process.env.ENVIRONMENT || "")
    });

    result = await docClient.send(command);
  } catch (error) {
    console.error(error);
    throw handlerHelpers.createResponse(500, {
      message: "dynamodb silly"
    });
  }

  return result.Items.length > 0;
};

export const handleWorkshop = async (userID, workshopID, timestamp) => {};

export const handleBooth = async (userID, boothID, timestamp) => {};
