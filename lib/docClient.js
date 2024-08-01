import * as dotenv from "dotenv";
import {
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient
} from "@aws-sdk/lib-dynamodb";

dotenv.config({
  path: "../../.env"
});

const destinationAWSConfig = {
  region: "localhost",
  endpoint: "http://localhost:8000",
  credentials: {
    accessKeyId: "MockAccessKeyId",
    secretAccessKey: "MockSecretAccessKey"
  }
};

console.log("NODE_ENV", process.env.NODE_ENV);

const client = process.env.NODE_ENV === "development"
  ? new DynamoDBClient(destinationAWSConfig)
  : new DynamoDBClient();

const docClient = DynamoDBDocumentClient.from(client);

export default docClient;
