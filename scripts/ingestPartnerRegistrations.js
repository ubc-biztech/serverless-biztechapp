import fs from "fs";
import csv from "csv-parser";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { humanId } from "human-id";
import dotenv from "dotenv";

dotenv.config();

// Configure AWS SDK v3
const awsConfig = {
  region: process.env.AWS_REGION || "us-west-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
};

const client = new DynamoDBClient(awsConfig);
const docClient = DynamoDBDocumentClient.from(client);

const USERS_TABLE = "biztechUsers" + (process.env.ENVIRONMENT || "");
const PROFILES_TABLE = "biztechProfiles" + (process.env.ENVIRONMENT || "");
const MEMBERS2026_TABLE = "biztechMembers2026" + (process.env.ENVIRONMENT || "");
const USER_REGISTRATIONS_TABLE = "biztechRegistrations" + (process.env.ENVIRONMENT || "");

// TODO
// NOTE: ADJUSTED FOR BLUEPRINT 2026

async function updateTables(user) {
  const timestamp = new Date().getTime();
  const profileID = humanId();

  // we just want to give them cards
  const transactParams = {
    TransactItems: [
      // 1. Add them to users so they can log in
      {
        Put: {
          TableName: USERS_TABLE,
          Item: {
            id: user.email.toLowerCase(),
            fname: user.fname,
            lname: user.lname,
            isMember: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          ConditionExpression: "attribute_not_exists(id)"
        }
      },
      // 2. Give them memberships for NFC cards
      {
        Put: {
          TableName: MEMBERS2026_TABLE,
          Item: {
            id: user.email.toLowerCase(),
            profileID,
            firstName: user.fname,
            lastName: user.lname,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          ConditionExpression: "attribute_not_exists(id)"
        }
      },
      // 3. Create a profile for them
      {
        Put: {
          TableName: PROFILES_TABLE,
          Item: {
            fname: user.fname,
            lname: user.lname,
            type: "PROFILE",
            compositeID: `PROFILE#${profileID}`,
            createdAt: timestamp,
            updatedAt: timestamp,
            profileType: "PARTNER",
            linkedIn: user.linkedin,
            company: user.company,
            position: user.position,
            viewableMap: {
              fname: true,
              lname: true,
              pronouns: true,
              major: false,
              year: false,
              profileType: true, // for attendees to see if it's a partner
              hobby1: false,
              hobby2: false,
              funQuestion1: false,
              funQuestion2: false,
              linkedIn: true, // for attendees to see partner's linkedin
              profilePictureURL: false,
              additionalLink: false,
              description: false,
              company: true,
              position: true
            }
          },
          ConditionExpression: "attribute_not_exists(id)"
        }
      },
      // 4. Create a registration for blueprint
      {
        Put: {
          TableName: USER_REGISTRATIONS_TABLE,
          Item: {
            id: user.email.toLowerCase(),
            ["eventID;year"]: "blueprint;2026",
            registrationStatus: "registered",
            isPartner: true, // flag as partner investment
            fname: user.fname,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          ConditionExpression: "attribute_not_exists(id)"
        }
      }
    ]
  };

  try {
    const command = new TransactWriteCommand(transactParams);
    await docClient.send(command);
    console.log(`Successfully created user, registration, and profile for ${user.email}`);
    console.log(`Profile ID: ${profileID}`);
    return true;
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      console.log(`Entry already exists for ${user.email}`);
    } else {
      console.error(`Error processing ${user.email}:`, error.message);
      console.error("Error details:", error);
    }
    return false;
  }
}


/**
 * Processes the CSV file and creates registrations
 * @param {string} filePath - Path to the CSV file
 */
async function processCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found at ${filePath}`);
    process.exit(1);
  }

  const results = [];
  const errors = [];
  let successCount = 0;
  let errorCount = 0;

  console.log(`📋 Processing ${filePath}...`);

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", async () => {
        console.log(`Found ${results.length} records to process`);

        const getValue = (row, key) => (row[key] || "").trim();

        const getFirstLastName = (fullName) => {
          const cleaned = fullName.trim();
          if (!cleaned) return ["", ""];
          const parts = cleaned.split(/\s+/);
          if (parts.length === 1) return [parts[0], ""];
          const last = parts.pop();
          return [parts.join(" "), last];
        };

        // Process each record
        for (const [index, row] of results.entries()) {
          try {
            // Mapped to current partner CSV headers
            const displayName =
              getValue(row, "Name as you would like to see it on your name tag") ||
              getValue(row, "Full Name");
            const [firstname, lastname] = getFirstLastName(displayName);

            const user = {
              email: getValue(row, "Email Address").toLowerCase(),
              fname: firstname,
              lname: lastname,
              pronouns: getValue(row, "Pronouns"),
              linkedin: getValue(
                row,
                "Please include your LinkedIn URL if your profile is not public"
              ),
              company: getValue(row, "What company do you work for?"),
              position: getValue(row, "What is your current role?")
            };

            const success = await updateTables(user);
            if (success) {
              successCount++;
            } else {
              errorCount++;
            }

            // add small delay to avoid throttling
            if (index < results.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (error) {
            console.error(`Error processing record ${index + 1}:`, error.message);
            errors.push({
              row: index + 2, // +2 for 1-based index and header row
              error: error.message,
              data: row
            });
            errorCount++;
          }
        }

        // Print summary
        console.log("\nImport Summary:");
        console.log(`Successfully processed: ${successCount} records`);
        console.log(`Failed to process: ${errorCount} records`);

        if (errors.length > 0) {
          console.log("\nErrors encountered:");
          errors.forEach((err, idx) => {
            console.log(`\nRow ${err.row}: ${err.error}`);
            console.log("Data:", JSON.stringify(err.data, null, 2));
          });
        }

        resolve({
          successCount,
          errorCount,
          errors
        });
      })
      .on("error", (error) => {
        console.error("Error reading CSV file:", error);
        reject(error);
      });
  });
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: node scripts/ingestPartnerRegistrations.js <path-to-csv>");
    console.log("Example: node scripts/ingestPartnerRegistrations.js ./partner-registrations.csv");
    process.exit(1);
  }

  const csvFilePath = args[0];

  try {
    console.log("Starting CSV processing...");
    await processCSV(csvFilePath);
    console.log("CSV processing completed successfully!");
  } catch (error) {
    console.error("Fatal error:", error);
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

// Run the script
main();
