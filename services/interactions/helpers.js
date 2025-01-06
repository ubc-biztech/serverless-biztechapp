import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { QRS_TABLE, CONNECTIONS_TABLE } from "../../constants/tables";
import db from "../../lib/db";
import handlerHelpers from "../../lib/handlerHelpers";
import docClient from "../../lib/docClient";

const event = "blueprint;2025";

export const handleConnection = async (userID, connID, timestamp) => {
  let result;
  try {
    const command = new QueryCommand({
      IndexName: "connID",
      ExpressionAttributeValues: {
        ":conn": connID,
        ":uid": userID
      },
      KeyConditionExpression: "connID = :conn",
      FilterExpression: "userID = :uid",
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

  if (result.Items.length > 0) {
    throw handlerHelpers.createResponse(409, {
      message: `Connection with ${connID} already made`
    });
  }

  const { data: userData } = await db.getOne(userID, QRS_TABLE, {
    "eventID;year": event
  });

  const { data: connData, type } = await db.getOne(connID, QRS_TABLE, {
    "eventID;year": event
  });

  const userPut = {
    userID,
    "eventID;year": event,
    connID,
    createdAt: timestamp,
    ...(connData?.linkedinURL ? { linkedinURL: connData.linkedinURL } : {}),
    ...(connData?.fname ? { fname: connData.fname } : {}),
    ...(connData?.lname ? { lname: connData.lname } : {}),
    ...(connData?.major ? { major: connData.major } : {}),
    ...(connData?.year ? { year: connData.year } : {}),
    ...(connData?.company ? { company: connData.company } : {}),
    ...(connData?.title ? { title: connData.title } : {})
  };

  const connPut = {
    userID: connID,
    "eventID;year": event,
    connID: userID,
    createdAt: timestamp,
    ...(userData?.linkedinURL ? { linkedinURL: userData.linkedinURL } : {}),
    ...(userData?.fname ? { fname: userData.fname } : {}),
    ...(userData?.lname ? { lname: userData.lname } : {}),
    ...(userData?.major ? { major: userData.major } : {}),
    ...(userData?.year ? { year: userData.year } : {}),
    ...(userData?.company ? { company: userData.company } : {}),
    ...(userData?.title ? { title: userData.title } : {})
  };

  let res;
  switch (type) {
    case "NFC_ATTENDEE":
      await db.put(connPut, CONNECTIONS_TABLE, true);
      res = await db.put(userPut, CONNECTIONS_TABLE, true);
      break;

    default:
      break;
  }

  return handlerHelpers.createResponse(200, {
    message: `Connection created with ${connID}`,
    res
  });
};

export const handleWorkshop = async (userID, workshopID, timestamp) => {};

export const handleBooth = async (userID, boothID, timestamp) => {};
