import * as dotenv from "dotenv";
import AWS from "aws-sdk";

dotenv.config({
  path: "../.env"
});

const destinationAWSConfig = {
  accessKeyId: "AKIAWJP6JFRVBES4JFOQ",
  secretAccessKey: "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",
  endpoint: "dynamodb-fips.us-west-2.amazonaws.com", // use the local dynamodb url here
  region: "us-west-2"
};

const docClient =
process.env.NODE_ENV === "development" ?
  new AWS.DynamoDB.DocumentClient(destinationAWSConfig)
  : new AWS.DynamoDB.DocumentClient();

export default docClient;
