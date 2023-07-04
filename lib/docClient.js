import * as dotenv from "dotenv";
import AWS from "aws-sdk";

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
// process.env.NODE_ENV === "development"
    new AWS.DynamoDB.DocumentClient(destinationAWSConfig);
// : new AWS.DynamoDB.DocumentClient();

export default docClient;
