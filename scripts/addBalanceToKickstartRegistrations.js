import dotenv from "dotenv";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

dotenv.config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-west-2",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE = "biztechRegistrations" + (process.env.ENVIRONMENT || "");
const CHUNK_SIZE = 20;

async function fetchRegistrations(eventID, year) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const { Items, LastEvaluatedKey } = await docClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "event-query",
        KeyConditionExpression: "#e = :val",
        ExpressionAttributeNames: { "#e": "eventID;year" },
        ExpressionAttributeValues: { ":val": `${eventID};${year}` },
        ExclusiveStartKey,
      })
    );
    if (Items) items.push(...Items);
    ExclusiveStartKey = LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function updateBalances(eventID, year, balance) {
  const regs = await fetchRegistrations(eventID, year);
  console.log(`Found ${regs.length} registrations for ${eventID};${year}`);

  for (let i = 0; i < regs.length; i += CHUNK_SIZE) {
    const batch = regs.slice(i, i + CHUNK_SIZE);
    const TransactItems = batch.map((r) => ({
      Update: {
        TableName: TABLE,
        Key: {
          id: r.id,
          "eventID;year": r["eventID;year"]
        },
        UpdateExpression: "SET #b = :val",
        ExpressionAttributeNames: { "#b": "balance" },
        ExpressionAttributeValues: { ":val": balance },
      },
    }));
    try {
      await docClient.send(new TransactWriteCommand({ TransactItems }));
      console.log(`Updated ${Math.min(i + CHUNK_SIZE, regs.length)}/${regs.length}`);
    } catch (err) {
      console.error("Batch update failed:", err?.message || err);
    }
  }
}

(async () => {
  const balance = 10000;
  const targets = [
    {
      eventID: "kickstart",
      year: 2025
    },
    {
      eventID: "kickstart-showcase",
      year: 2025
    },
  ];
  console.log(`Setting balance=${balance} for events: ${targets.map(t => t.eventID).join(", ")}`);

  for (const t of targets) await updateBalances(t.eventID, t.year, balance);
  console.log("Done.");
})();
