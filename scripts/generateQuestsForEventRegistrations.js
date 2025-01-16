import {
  PutCommand, QueryCommand
} from "@aws-sdk/lib-dynamodb";
import {
  QUESTS_TABLE, USER_REGISTRATIONS_TABLE
} from "../constants/tables.js";
import {
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";

const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2"
};

const docClient = new DynamoDBClient(awsConfig);

const QUEST_CONNECT_ONE = "QUEST_CONNECT_ONE";
const QUEST_SNACK = "QUEST_SNACK";
const QUEST_BOOTH_STARTUP = "QUEST_STARTUP";
const QUEST_BIGTECH = "QUEST_BIGTECH";
const QUEST_PHOTOBOOTH = "QUEST_PHOTOBOOTH";
const QUEST_WORKSHOP = "QUEST_WORKSHOP";
const QUEST_CONNECT_FOUR = "QUEST_CONNECT_FOUR";
const QUEST_CONNECT_TEN_H = "QUEST_CONNECT_TEN_H";
const QUEST_BT_BOOTH_H = "QUEST_BT_BOOTH_H";
const QUEST_CONNECT_EXEC_H = "QUEST_CONNECT_EXEC_H";

const QUESTS = [
  [QUEST_CONNECT_ONE, 1, "First Impressionist", "Make your first connection!"],
  [QUEST_CONNECT_FOUR, 4, "Networking Pro", "Make 4 connections."],
  [QUEST_CONNECT_TEN_H, 10, "Networking Guru", "Make 10+ connections."],
  [
    QUEST_CONNECT_EXEC_H,
    1,
    "Director’s Circle",
    "Connect with a Biztech Exec."
  ],
  [QUEST_BT_BOOTH_H, 1, "Loyalist Legacy", "Visit the BizTech Booth."],
  [QUEST_SNACK, 1, "Snack Seeker", "Grab some food."],
  [QUEST_BOOTH_STARTUP, 1, "Startup Explorer", "Visit a startup booth."],
  [QUEST_BIGTECH, 1, "Big League Scout", "Visit a big company booth."],
  [QUEST_WORKSHOP, 1, "Workshop Wonder", "Attend Workshop 2."],
  [QUEST_PHOTOBOOTH, 1, "Memory Maker", "Take a photo to reminisce."]
];

const create = async (item, table) => {
  const params = {
    Item: item,
    TableName: table + (process.env.ENVIRONMENT || ""),
    ConditionExpression: "attribute_not_exists(id)"
  };

  const command = new PutCommand(params);
  const res = await docClient.send(command);
  return res;
};

const userQuestsArray = (id, eventString) => {
  return QUESTS.map((q) => ({
    userID: id,
    "eventID;year": eventString,
    progress: 0,
    threshold: q[1],
    questID: q[0],
    badgeName: q[2],
    description: q[3]
  }));
};

const questsForEventRegistrations = async (eventID, year) => {
  let registrations;
  try {
    registrations = await docClient.send(
      new QueryCommand({
        TableName: USER_REGISTRATIONS_TABLE + (process.env.ENVIRONMENT || ""),
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
    throw err;
  }

  let count = 0;
  let users = 0;
  const promises = [];
  for (let i = 0; i < registrations.Items.length; i++) {
    try {
      const userQuests = userQuestsArray(
        registrations.Items[i].id,
        `${eventID};${year}`
      );

      users++;
      for (let j = 0; j < userQuests.length; j++) {
        promises.push(create(userQuests[j], QUESTS_TABLE));
      }

      await Promise.all(promises);
      count += userQuests.length;

      console.log(`Quests created for user: ${registrations.Items[i].id}`);
    } catch (err) {
      console.error(`Created ${count} Quest Entries for ${users} Users`);
      console.error(`Error writing quests: \n ${JSON.stringify(err, null, 2)}`);
      throw err;
    }
  }

  console.log(`Created ${count} Quest Entries for ${users} Users`);
};

questsForEventRegistrations("blueprint", 2025);
