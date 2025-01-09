import docClient from "../lib/docClient";
import db from "../lib/db";
import { PutCommand, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { QUESTS_TABLE, USER_REGISTRATIONS_TABLE } from "../constants/tables";
import { QUESTS } from "../services/interactions/constants";

const questsForEventRegistrations = async (eventID, year) => {
  let registrations;
  try {
    registrations = await docClient.send(
      new QueryCommand({
        TableName: "biztechRegistrations" + (process.env.ENVIRONMENT || ""),
        IndexName: "event-query",
        KeyConditionExpression: "#eventIDYear = :eventIDYear",
        ExpressionAttributeNames: {
          "#eventIDYear": "eventID;year"
        },
        ExpressionAttributeValues: {
          ":eventIDYear": `${eventID};${year}`
        }
      })
    );
  } catch (err) {
    console.error(
      `Error querying profiles: \n ${JSON.stringify(err, null, 2)}`
    );
  }

  const registrationIDs = new Set();

  for (let i = 0; i < registrations.Items.length; i++) {
    if (!registrationIDs.has(registrations.Items[i].id)) {
      try {
        await db.create({
          userID: registrations.Items[i].id
        });
      } catch (err) {
        `Error writing quests: \n ${JSON.stringify(err, null, 2)}`;
      }
    }
  }
};
