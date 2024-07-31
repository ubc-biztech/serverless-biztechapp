import * as dotenv from "dotenv";
import {
  copy
} from "copy-dynamodb-table";
import { DynamoDB } from "@aws-sdk/client-dynamodb";

dotenv.config({
  path: "../.env"
});

const sourceAWSConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2",
};

const dynamodb = new DynamoDB(sourceAWSConfig);

const destinationAWSConfig = {
  accessKeyId: "AKID",
  secretAccessKey: "SECRET",
  endpoint: "http://localhost:8000", // use the local dynamodb url here
  region: "us-west-2",
};

dynamodb.listTables({
}, (err, data) => {
  if (err) {
    console.log("Error", err);
  } else {
    data.TableNames.forEach((name) => {
      console.log(`copying ${name} to local db`);
      copy(
        {
          source: {
            tableName: name,
            config: sourceAWSConfig,
          },
          destination: {
            config: destinationAWSConfig,
            tableName: name,
          },
          log: true,
          create: true,
        },
        (err, result) => {
          if (err) {
            console.log(err);
          }
          console.log(result);
        }
      );
    });
  }
});
