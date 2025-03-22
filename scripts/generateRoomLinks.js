import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import fs from "fs/promises";

const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2"
};

const client = new DynamoDBClient(awsConfig);

const generateRoomLinks = async (eventID, year) => {
  let registrations;
  try {
    registrations = await client.send(
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
    throw err;
  }

  let judges = {};
  for (let i = 0; i < registrations.Items.length; i++) {
    const user = registrations.Items[i];
    const email = user.id;
    const isJudge = user.isPartner;
    const team = user.teamID;

    // Migrate if user is a judge
    if (!isJudge) {
      continue;
    }

    if (!judges[team]) {
      judges[team] = [email];
      continue;
    }

    judges[team].push(email);
  }

  try {
    // Create an object with all teams and their encoded judge arrays
    const encodedTeamData = {};

    for (const team in judges) {
      const judgesString = JSON.stringify(judges[team]);
      encodedTeamData[team] =
        "https://v2.ubcbiztech.com/companion/redirect/" +
        Buffer.from(judgesString).toString("base64");
    }

    // Format the output without quotes or brackets
    const outputFilename = `./data/${eventID}_${year}_judges.txt`;
    const formattedOutput = Object.entries(encodedTeamData)
      .map(([team, encodedValue]) => `${team}: ${encodedValue}`)
      .join("\n");

    await fs.writeFile(outputFilename, formattedOutput);
    console.log(
      `Successfully wrote all encoded judges data to ${outputFilename}`
    );
  } catch (error) {
    console.error(`Error writing judges data file:`, error);
  }
};

generateRoomLinks("productx", 2025);
