import * as dotenv from "dotenv";
import {
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import {
  PutCommand
} from "@aws-sdk/lib-dynamodb";
dotenv.config({
  path: "../.env"
});
const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2",
};
const client = new DynamoDBClient(awsConfig);
const partnerNames = [
  "Partner 1",
  "Partner 2",
  "Partner 3",
];
const partnerLinkedinUrls = [
  "https://www.linkedin.com/company/partner1",
  "https://www.linkedin.com/company/partner2",
  "https://www.linkedin.com/company/partner3",
];
const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const generateIDString = (length) => {
  let result = "";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result + "-";
};
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
const massCreateLinkedinQRs = async (names, urls, eventID, year, points) => {
  for (let i = 0; i < names.length; i++) {
    const qr = await create({
      id: generateIDString(5) + names[i],
      "eventID;year": eventID+";"+year,
      isActive: true,
      points: points,
      type: "Partner",
      isUnlimitedScans: true,
      data: {
        partnerID: names[i],
        linkedin: urls[i],
      }
    }, "biztechQRs" + (process.env.ENVIRONMENT || ""));
  }
};
