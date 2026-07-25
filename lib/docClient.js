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

const client = process.env.NODE_ENV === "development"
  ? new DynamoDBClient(destinationAWSConfig)
  : new DynamoDBClient();

// Match the AWS SDK v2 DocumentClient behavior used by the original handlers:
// optional fields with an undefined value are omitted instead of causing the
// entire DynamoDB command to fail during marshalling.
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

export default docClient;
