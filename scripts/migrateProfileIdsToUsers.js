import dotenv from "dotenv";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { MEMBERS_TABLE } from "../constants/tables.js";

dotenv.config();

// To run:
// node scripts/migrateProfileIdsToUsers.js --stage=dev
// node scripts/migrateProfileIdsToUsers.js --stage=prod
// node scripts/migrateProfileIdsToUsers.js --stage=prod --write

const DEFAULT_REGION = "us-west-2";
const DEFAULT_USERS_TABLE = "biztechUsers";
const DEFAULT_MEMBERS_TABLE = MEMBERS_TABLE;

function parseArgs(argv) {
  const args = {
    write: false,
    usersTable: DEFAULT_USERS_TABLE,
    membersTable: DEFAULT_MEMBERS_TABLE,
    envSuffix: process.env.ENVIRONMENT || "",
    limit: null
  };

  for (const arg of argv) {
    if (arg === "--write") {
      args.write = true;
    } else if (arg === "--dry-run") {
      args.write = false;
    } else if (arg.startsWith("--users-table=")) {
      args.usersTable = arg.split("=")[1];
    } else if (arg.startsWith("--members-table=")) {
      args.membersTable = arg.split("=")[1];
    } else if (arg.startsWith("--env-suffix=")) {
      args.envSuffix = arg.split("=")[1];
    } else if (arg.startsWith("--stage=")) {
      const stage = arg.split("=")[1].toLowerCase();
      args.envSuffix = stage === "prod" ? "PROD" : "";
    } else if (arg.startsWith("--limit=")) {
      args.limit = Number(arg.split("=")[1]);
    } else if (arg === "--help") {
      args.help = true;
    }
  }

  if (Number.isNaN(args.limit)) {
    throw new Error("--limit must be a number");
  }

  return args;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/migrateProfileIdsToUsers.js --stage=dev
  node scripts/migrateProfileIdsToUsers.js --stage=prod
  node scripts/migrateProfileIdsToUsers.js --stage=prod --write

Options:
  --write                  Actually update biztechUsers. Default is dry-run.
  --dry-run                Force dry-run mode.
  --stage=dev|prod         Maps prod to ENVIRONMENT suffix "PROD"; dev/staging to "".
  --env-suffix=SUFFIX      Override table suffix directly.
  --members-table=NAME     Source membership table base name. Defaults to MEMBERS_TABLE.
  --users-table=NAME       Destination users table base name. Default: biztechUsers.
  --limit=N                Process only N source member records.
`);
}

function tableName(baseName, envSuffix) {
  return `${baseName}${envSuffix || ""}`;
}

async function scanAll(docClient, params, limit = null) {
  const items = [];
  let ExclusiveStartKey;

  do {
    const res = await docClient.send(
      new ScanCommand({
        ...params,
        ExclusiveStartKey
      })
    );

    for (const item of res.Items || []) {
      items.push(item);
      if (limit && items.length >= limit) {
        return items;
      }
    }

    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

function buildProfileIdCounts(members) {
  const counts = new Map();

  for (const member of members) {
    if (!member.profileID) continue;
    counts.set(member.profileID, (counts.get(member.profileID) || 0) + 1);
  }

  return counts;
}

function buildUsersById(users) {
  const byId = new Map();
  const byProfileId = new Map();

  for (const user of users) {
    if (user.id) {
      byId.set(String(user.id).toLowerCase(), user);
    }

    if (user.profileID) {
      const existing = byProfileId.get(user.profileID) || [];
      existing.push(user);
      byProfileId.set(user.profileID, existing);
    }
  }

  return {
    byId,
    byProfileId
  };
}

async function updateUserProfileId(docClient, usersTableName, email, profileID) {
  const timestamp = Date.now();

  await docClient.send(
    new UpdateCommand({
      TableName: usersTableName,
      Key: {
        id: email
      },
      UpdateExpression:
        "SET #profileID = :profileID, #updatedAt = :updatedAt",
      ConditionExpression:
        "attribute_exists(#id) AND (attribute_not_exists(#profileID) OR #profileID = :profileID)",
      ExpressionAttributeNames: {
        "#id": "id",
        "#profileID": "profileID",
        "#updatedAt": "updatedAt"
      },
      ExpressionAttributeValues: {
        ":profileID": profileID,
        ":updatedAt": timestamp
      }
    })
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || DEFAULT_REGION
  });
  const docClient = DynamoDBDocumentClient.from(client);

  const usersTableName = tableName(args.usersTable, args.envSuffix);
  const membersTableName = tableName(args.membersTable, args.envSuffix);

  console.log("ProfileID migration: members -> users");
  console.log(`Mode: ${args.write ? "WRITE" : "DRY RUN"}`);
  console.log(`Source members table: ${membersTableName}`);
  console.log(`Destination users table: ${usersTableName}`);

  const members = await scanAll(
    docClient,
    {
      TableName: membersTableName,
      ProjectionExpression: "#id, #profileID",
      ExpressionAttributeNames: {
        "#id": "id",
        "#profileID": "profileID"
      }
    },
    args.limit
  );

  const users = await scanAll(docClient, {
    TableName: usersTableName,
    ProjectionExpression: "#id, #profileID",
    ExpressionAttributeNames: {
      "#id": "id",
      "#profileID": "profileID"
    }
  });

  const profileIdCounts = buildProfileIdCounts(members);
  const usersById = buildUsersById(users);

  const stats = {
    scannedMembers: members.length,
    scannedUsers: users.length,
    skippedNoEmail: 0,
    skippedNoProfileID: 0,
    skippedDuplicateMemberProfileID: 0,
    skippedMissingUser: 0,
    alreadySetSame: 0,
    skippedUserHasDifferentProfileID: 0,
    skippedProfileIDAssignedToOtherUser: 0,
    wouldUpdate: 0,
    updated: 0,
    failedUpdates: 0
  };

  const samples = {
    missingUsers: [],
    duplicateMemberProfileIDs: [],
    userDifferentProfileID: [],
    profileIDAssignedToOtherUser: [],
    failedUpdates: []
  };

  for (const member of members) {
    if (!member.id) {
      stats.skippedNoEmail++;
      continue;
    }

    const email = String(member.id).toLowerCase();
    const profileID = member.profileID;

    if (!profileID) {
      stats.skippedNoProfileID++;
      continue;
    }

    if (profileIdCounts.get(profileID) > 1) {
      stats.skippedDuplicateMemberProfileID++;
      if (samples.duplicateMemberProfileIDs.length < 10) {
        samples.duplicateMemberProfileIDs.push({ email, profileID });
      }
      continue;
    }

    const user = usersById.byId.get(email);
    if (!user) {
      stats.skippedMissingUser++;
      if (samples.missingUsers.length < 10) {
        samples.missingUsers.push({ email, profileID });
      }
      continue;
    }

    if (user.profileID === profileID) {
      stats.alreadySetSame++;
      continue;
    }

    if (user.profileID && user.profileID !== profileID) {
      stats.skippedUserHasDifferentProfileID++;
      if (samples.userDifferentProfileID.length < 10) {
        samples.userDifferentProfileID.push({
          email,
          userProfileID: user.profileID,
          memberProfileID: profileID
        });
      }
      continue;
    }

    const usersWithProfileID = usersById.byProfileId.get(profileID) || [];
    const assignedToOtherUser = usersWithProfileID.find(
      (u) => String(u.id).toLowerCase() !== email
    );

    if (assignedToOtherUser) {
      stats.skippedProfileIDAssignedToOtherUser++;
      if (samples.profileIDAssignedToOtherUser.length < 10) {
        samples.profileIDAssignedToOtherUser.push({
          email,
          profileID,
          assignedTo: assignedToOtherUser.id
        });
      }
      continue;
    }

    stats.wouldUpdate++;

    if (!args.write) {
      continue;
    }

    try {
      await updateUserProfileId(docClient, usersTableName, email, profileID);
      stats.updated++;
    } catch (err) {
      stats.failedUpdates++;
      if (samples.failedUpdates.length < 10) {
        samples.failedUpdates.push({
          email,
          profileID,
          error: err.message || String(err)
        });
      }
    }
  }

  console.log("\nSummary");
  console.log(JSON.stringify(stats, null, 2));

  const hasSamples = Object.values(samples).some((items) => items.length > 0);
  if (hasSamples) {
    console.log("\nSamples");
    console.log(JSON.stringify(samples, null, 2));
  }

  if (!args.write) {
    console.log("\nDry-run complete. Re-run with --write to update users.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
