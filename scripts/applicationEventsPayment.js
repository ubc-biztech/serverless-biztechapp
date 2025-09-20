import * as dotenv from "dotenv";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { QueryCommand, GetCommand, BatchGetCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

dotenv.config({
  path: "../.env"
});

const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2",
};

const client = new DynamoDBClient(awsConfig);
const docClient = DynamoDBDocumentClient.from(client);

const getAcceptedRegistrations = async (eventID, year) => {
  const acceptedRegistrationsResult = await docClient.send(new QueryCommand({
    TableName: "biztechRegistrationsPROD",
    IndexName: "event-query",
    KeyConditionExpression: "#eventIDYear = :eventIDYear",
    FilterExpression: "#status = :accepted",
    ExpressionAttributeNames: {
      "#eventIDYear": "eventID;year",
      "#status": "applicationStatus"
    },
    ExpressionAttributeValues: {
      ":eventIDYear": `${eventID};${year}`,
      ":accepted": "accepted"
    }
  }));

  return acceptedRegistrationsResult.Items || [];
};

const getEventPricing = async (eventID, year) => {
  const eventResult = await docClient.send(new GetCommand({
    TableName: "biztechEventsPROD",
    Key: {
      id: eventID,
      year: Number(year)
    }
  }));

  const event = eventResult.Item || {};
  return {
    memberPrice: event?.pricing?.members === undefined ? 0 : event?.pricing?.members,
    nonMemberPrice: event?.pricing?.nonMembers === undefined ? 0 : event?.pricing?.nonMembers,
  };
};

const getUsersMembershipMap = async (userIDs) => {
  userIDs = [...new Set(userIDs)]; // avoid duplicates
  if (!userIDs.length) return {};

  const userMap = {};

  // process in batches of 100 to avoid dynamodb limits
  while (userIDs.length) {
    const batchIDs = userIDs.splice(0, 100);
    const keys = batchIDs.map((id) => ({ id }));

    const batchResult = await docClient.send(new BatchGetCommand({
      RequestItems: {
        biztechUsersPROD: {
          Keys: keys
        }
      }
    }));

    const users = (batchResult.Responses && batchResult.Responses.biztechUsersPROD) || [];

    // map the existent users to whether they are members or not
    for (const user of users) {
      userMap[user.id] = user.isMember;
    }

    // missing users should be set to false -> indicate non-membership by default
    for (const userID of batchIDs) {
      if (!(userID in userMap)) {
        userMap[userID] = false;
      }
    }
  }

  return userMap;
};


const findAcceptedRegistrations = async (eventID, year) => {
  const acceptedRegistrations = await getAcceptedRegistrations(eventID, year);
  if (!acceptedRegistrations.length) return [];

  const userIDs = acceptedRegistrations.map((reg) => reg.id);
  const [pricing, userMap] = await Promise.all([
    getEventPricing(eventID, year),
    getUsersMembershipMap(userIDs)
  ]);

  const { memberPrice, nonMemberPrice } = pricing;
  const res = [];
  acceptedRegistrations.forEach((reg) => {
    const id = reg.id;
    const isMember = userMap[id];
    const price = isMember ? memberPrice : nonMemberPrice;
    if (price === 0) return;
    res.push({
      userID: id,
      price,
      isMember,
    });
  });

  return res;
};

/*
findAcceptedRegistrations("hello-hacks", "2024")
  .then((registrations) => registrations)
  .then((registrations) => {
    console.log(registrations);
  });
*/

// TESTING
/* 
getAcceptedRegistrations("hello-hacks", "2024")
  .then((registrations) => console.table(registrations));
getEventPricing("hellohacks", "2025")
  .then((pricing) => console.log(pricing));
*/

const [,, eventID, year] = process.argv;

if (!eventID || !year) {
  console.error("Usage: node scripts/yourScript.js <eventID> <year>");
  process.exit(1);
}

findAcceptedRegistrations(eventID, year)
  .then((registrations) => console.table(registrations))
  .catch((err) => console.error(err));