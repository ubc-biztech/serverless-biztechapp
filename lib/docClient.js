import * as dotenv from "dotenv";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { DynamoDB } from "@aws-sdk/client-dynamodb";

dotenv.config({
  path: "../.env"
});

const destinationAWSConfig = {
  accessKeyId: "AKID",
  secretAccessKey: "SECRET",
  endpoint: "http://localhost:8000", // use the local dynamodb url here
  region: "us-west-2"
};

const docClient =
process.env.NODE_ENV === "development" ?
  DynamoDBDocument.from(new DynamoDB(destinationAWSConfig))
  : DynamoDBDocument.from(new DynamoDB());

export default docClient;
