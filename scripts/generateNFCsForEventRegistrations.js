import * as dotenv from "dotenv";
import {
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import {
  PutCommand,
  ScanCommand,
  QueryCommand,
  GetCommand
} from "@aws-sdk/lib-dynamodb";
import {
  humanId
} from "human-id";

dotenv.config({
  path: "../.env"
});


const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2",
};

const client = new DynamoDBClient(awsConfig);

const create = async function (item, table) {
  try {
    const params = {
      Item: item,
      TableName: table + (process.env.ENVIRONMENT || ""),
      ConditionExpression: "attribute_not_exists(id)"
    };
    const command = new PutCommand(params);
    const res = await client.send(command);
    return res;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

const generateNFCsForEventRegistrations = async (eventID, year) => {
  const registrations = await client.send(new QueryCommand({
    TableName: "biztechRegistrations" + (process.env.ENVIRONMENT || ""),
    IndexName: "event-query",
    KeyConditionExpression: "#eventIDYear = :eventIDYear",
    ExpressionAttributeNames: {
      "#eventIDYear": "eventID;year"
    },
    ExpressionAttributeValues: {
      ":eventIDYear": `${eventID};${year}`
    }
  }));

  // fetch all QRs for this event with type NFC

  const qrs = await client.send(new ScanCommand({
    TableName: "biztechQRs" + (process.env.ENVIRONMENT || ""),
    FilterExpression: "#eventIDYear = :eventIDYear AND #type = :type",
    ExpressionAttributeNames: {
      "#eventIDYear": "eventID;year",
      "#type": "type"
    },
    ExpressionAttributeValues: {
      ":eventIDYear": `${eventID};${year}`,
      ":type": "NFC_ATTENDEE"
    }
  }));

  // create a set of all registration IDs
  const registrationIDs = new Set();


  for (const qr of qrs.Items) {
    if (qr.type === "NFC_ATTENDEE") {
      registrationIDs.add(qr.data.registrationID);
    }
  }

  console.log(`total registrations: ${registrations.Items.length}`);

  let count = 0;

  for (const registration of registrations.Items) {
    if (!registrationIDs.has(registration.id)) {
      const profileID = humanId();
      const nfc = await create({
        id: humanId(),
        "eventID;year": `${eventID};${year}`,
        type: "NFC_ATTENDEE",
        isUnlimitedScans: true,
        data: {
          registrationID: registration.id,
          profileID: profileID
        }
      }, "biztechQRs" + (process.env.ENVIRONMENT || ""));

      // Get existing profile
      const existingProfile = await client.send(new GetCommand({
        TableName: "biztechProfiles" + (process.env.ENVIRONMENT || ""),
        Key: {
          id: registration.basicInformation.email,
          "eventID;year": `${eventID};${year}`
        }
      }));

      if (existingProfile.Item) {
        // Update the profile with the profileID while keeping existing data
        await client.send(new PutCommand({
          TableName: "biztechProfiles" + (process.env.ENVIRONMENT || ""),
          Item: {
            ...existingProfile.Item,
            profileID: profileID,
            updatedAt: new Date().getTime()
          }
        }));
      } else {
        console.warn(`No existing profile found for registration ${registration.id}`);
      }
      count++;
    }
  }

  console.log(`created ${count} NFCs`);
};
generateNFCsForEventRegistrations("blueprint", 2025);
