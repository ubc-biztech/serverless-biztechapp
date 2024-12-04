import {
  DynamoDB,
  ListTablesCommand,
  DescribeTableCommand,
  CreateTableCommand,
  DeleteTableCommand,
  ScanCommand,
  BatchWriteItemCommand
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocument
} from "@aws-sdk/lib-dynamodb";
import * as dotenv from "dotenv";
import {
  fileURLToPath
} from "url";
import {
  dirname
} from "path";

const __filename = fileURLToPath(import.meta.url);

dotenv.config({
  path: "../.env"
});

// Validate required environment variables
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error("Missing required AWS credentials in .env file");
  process.exit(1);
}

// Configure source DynamoDB client (production)
const sourceConfig = {
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  region: process.env.AWS_REGION || "us-west-2",
};

// Configure destination DynamoDB client (local)
const destConfig = {
  credentials: {
    accessKeyId: "AKID",
    secretAccessKey: "SECRET",
  },
  endpoint: process.env.DYNAMODB_LOCAL_ENDPOINT || "http://localhost:8000",
  region: process.env.AWS_REGION || "us-west-2",
};

const sourceClient = new DynamoDB(sourceConfig);
const destClient = new DynamoDB(destConfig);

async function validateLocalConnection() {
  try {
    await destClient.send(new ListTablesCommand({
    }));
    return true;
  } catch (err) {
    console.error("Failed to connect to local DynamoDB:", err.message);
    return false;
  }
}

async function copyTable(tableName) {
  try {
    // Get table description from source
    const {
      Table: tableDesc
    } = await sourceClient.send(
      new DescribeTableCommand({
        TableName: tableName
      })
    );

    if (!tableDesc) throw new Error(`Table ${tableName} not found`);

    // Properly format GSIs for local DynamoDB
    const gsis = tableDesc.GlobalSecondaryIndexes?.map(gsi => ({
      IndexName: gsi.IndexName,
      KeySchema: gsi.KeySchema,
      Projection: gsi.Projection,
      ProvisionedThroughput: {
        ReadCapacityUnits: 1,
        WriteCapacityUnits: 1
      }
    }));

    // Create table definition for destination
    const createParams = {
      TableName: tableName,
      AttributeDefinitions: tableDesc.AttributeDefinitions,
      KeySchema: tableDesc.KeySchema,
      GlobalSecondaryIndexes: gsis,
      LocalSecondaryIndexes: tableDesc.LocalSecondaryIndexes,
      ProvisionedThroughput: {
        ReadCapacityUnits: 1,
        WriteCapacityUnits: 1
      }
    };

    // Delete existing table if it exists
    try {
      await destClient.send(new DeleteTableCommand({
        TableName: tableName
      }));
      await waitForTableDeletion(destClient, tableName);
      console.log(`Deleted existing table ${tableName}`);
    } catch (err) {
      if (err.name !== "ResourceNotFoundException") {
        throw err;
      }
    }

    // Create new table
    await destClient.send(new CreateTableCommand(createParams));
    console.log(`Created table ${tableName}`);

    // Wait for table to be active
    await waitForTableStatus(destClient, tableName, "ACTIVE");

    // Copy data with progress tracking
    let totalItems = 0;
    let copiedItems = 0;
    let lastEvaluatedKey;

    // First, count total items
    do {
      const scanParams = {
        TableName: tableName,
        Select: "COUNT",
        ExclusiveStartKey: lastEvaluatedKey,
      };

      const {
        Count, LastEvaluatedKey
      } = await sourceClient.send(
        new ScanCommand(scanParams)
      );
      totalItems += Count;
      lastEvaluatedKey = LastEvaluatedKey;
    } while (lastEvaluatedKey);

    // Reset for actual copy
    lastEvaluatedKey = undefined;

    do {
      const scanParams = {
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
        ReturnConsumedCapacity: "TOTAL",
      };

      const {
        Items, LastEvaluatedKey, ConsumedCapacity
      } = await sourceClient.send(
        new ScanCommand(scanParams)
      );
      lastEvaluatedKey = LastEvaluatedKey;

      if (Items && Items.length > 0) {
        // Batch write items in chunks of 25 (DynamoDB limit)
        for (let i = 0; i < Items.length; i += 25) {
          const batch = Items.slice(i, i + 25);
          const writeParams = {
            RequestItems: {
              [tableName]: batch.map(item => ({
                PutRequest: {
                  Item: item
                },
              })),
            },
          };

          await destClient.send(new BatchWriteItemCommand(writeParams));
          copiedItems += batch.length;
          const progress = ((copiedItems / totalItems) * 100).toFixed(2);
          console.log(`Progress for ${tableName}: ${progress}% (${copiedItems}/${totalItems} items)`);
        }
      }
    } while (lastEvaluatedKey);

    console.log(`Successfully copied table ${tableName}`);
  } catch (err) {
    console.error(`Error copying table ${tableName}:`, err);
    throw err;
  }
}

async function waitForTableStatus(client, tableName, desiredStatus) {
  console.log(`Waiting for table ${tableName} to be ${desiredStatus}...`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const {
        Table
      } = await client.send(
        new DescribeTableCommand({
          TableName: tableName
        })
      );
      if (Table.TableStatus === desiredStatus) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      if (err.name === "ResourceNotFoundException" && desiredStatus === "DELETED") {
        break;
      }
      throw err;
    }
  }
}

async function waitForTableDeletion(client, tableName) {
  return waitForTableStatus(client, tableName, "DELETED");
}

async function copyAllTables() {
  try {
    // Validate local DynamoDB connection first
    if (!await validateLocalConnection()) {
      console.error("Please make sure your local DynamoDB is running and accessible at", destConfig.endpoint);
      process.exit(1);
    }

    let tables = [];
    let lastEvaluatedTableName;

    console.log("Listing source tables...");
    do {
      const {
        TableNames, LastEvaluatedTableName
      } = await sourceClient.send(
        new ListTablesCommand({
          ExclusiveStartTableName: lastEvaluatedTableName,
        })
      );
      tables = tables.concat(TableNames);
      lastEvaluatedTableName = LastEvaluatedTableName;
    } while (lastEvaluatedTableName);

    console.log(`Found ${tables.length} tables to copy:`, tables);

    for (const tableName of tables) {
      await copyTable(tableName);
    }

    console.log("All tables copied successfully");
  } catch (err) {
    console.error("Error copying tables:", err);
    process.exit(1);
  }
}

// Main execution
copyAllTables();

export {
  copyTable, copyAllTables
};
