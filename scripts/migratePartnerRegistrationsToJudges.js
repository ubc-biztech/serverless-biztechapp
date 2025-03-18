import {
  PutCommand, QueryCommand
} from "@aws-sdk/lib-dynamodb";
import {
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";

const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2"
};

const client = new DynamoDBClient(awsConfig);

const migrateParterRegistrationsToJudges = async (eventID, year) => {
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

  let count = 0;
  let judges = 0;
  for (let i = 0; i < registrations.Items.length; i++) {
    const user = registrations.Items[i];
    const email = user.id;
    const isJudge = user.isPartner;

    // Migrate if user is a judge
    if (isJudge) {
      count++;
      try {
        // * using PUT which overwrites judge data if it exists
        await client.send(
          new PutCommand({
            TableName: "bizJudge" + (process.env.ENVIRONMENT || ""),
            Item: {
              user
            }
          })
        );
        judges++;
        console.log("Migrated judge: " + email);
      } catch (err) {
        console.error(
          `Error migrating ${email}: \n ${JSON.stringify(err, null, 2)}`
        );
        throw err;
      }
    }
  }
  console.log(`Created ${count} Judge Entries for ${judges} Users`);
};

migrateParterRegistrationsToJudges("productx", 2025);
