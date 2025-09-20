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
    memberPrice: event?.pricing?.members,
    nonMemberPrice: event?.pricing?.nonMembers
  };
};

const getUsersMap = async (userIDs) => {
  if (!userIDs.length) return {};
  const keys = userIDs.map((id) => ({ id }));
  const batchResult = await docClient.send(new BatchGetCommand({
    RequestItems: {
      users: {
        Keys: keys
      }
    }
  }));

  const users = (batchResult.Responses && batchResult.Responses.users) || [];
  const userMap = {};
  for (const user of users) {
    userMap[user.id] = user;
  }
  return userMap;
};

const findAcceptedRegistrations = async (eventID, year) => {
  const acceptedRegistrations = await getAcceptedRegistrations(eventID, year);
  if (!acceptedRegistrations.length) return [];

  const userIDs = acceptedRegistrations.map((reg) => reg.userID);
  const [pricing, userMap] = await Promise.all([
    getEventPricing(eventID, year),
    getUsersMap(userIDs)
  ]);

  const { memberPrice, nonMemberPrice } = pricing;
  const registrationsWithPrice = acceptedRegistrations.map((reg) => {
    const user = userMap[reg.userID];
    const price = (!user || !user.isMember) ? nonMemberPrice : memberPrice;
    return {
      ...reg,
      price
    };
  });

  return registrationsWithPrice;
};

findAcceptedRegistrations("hello-hacks", "2024")
  .then((registrations) => registrations)
  .then((registrations) => {
    console.log(registrations);
  });
