/**
 * Turn MIS Night registrations into wall-ready profiles.
 *
 *   node scripts/ingestMISRegistrations.js                 # dry run, prints the plan
 *   node scripts/ingestMISRegistrations.js --apply         # write to dev tables
 *   ENVIRONMENT=PROD node scripts/ingestMISRegistrations.js --apply
 *
 * For every non-cancelled registration under EVENT;YEAR:
 *   - no biztechUsers row      -> create user + membership + profile
 *   - user but no profileID    -> create profile, stamp profileID on the user
 *   - user with a profile      -> set `archetype` on the existing profile
 *
 * The archetype comes from the registration's quiz answer
 * (dynamicResponses.careerInterest, e.g. "The Architect") and is what the
 * live wall draws. A membership row is created when missing because
 * POST /interactions refuses to connect anyone without one; pass
 * --no-membership to skip that.
 *
 * Reads AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from the
 * environment or .env, same as the other scripts here.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { humanId } from "human-id";
import dotenv from "dotenv";
import {
  MEMBERS_TABLE,
  PROFILES_TABLE,
  USERS_TABLE,
  USER_REGISTRATIONS_TABLE
} from "../constants/tables.js";

dotenv.config();

const EVENT_ID = "MISNight";
const YEAR = "2026";

const APPLY = process.argv.includes("--apply");
const GRANT_MEMBERSHIP = !process.argv.includes("--no-membership");

const suffix = process.env.ENVIRONMENT || "";
const T = {
  users: USERS_TABLE + suffix,
  members: MEMBERS_TABLE + suffix,
  profiles: PROFILES_TABLE + suffix,
  registrations: USER_REGISTRATIONS_TABLE + suffix
};

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-west-2"
});
const db = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true }
});

/* "The Architect" -> "ARCHITECT"; matches ARCHETYPES in the web app */
const ARCHETYPES = ["ARCHITECT", "DESIGNER", "LOGICIAN", "STRATEGIST", "VISIONARY"];
const toArchetype = (careerInterest) => {
  if (!careerInterest) return undefined;
  const key = String(careerInterest).replace(/^the\s+/i, "").trim().toUpperCase();
  return ARCHETYPES.includes(key) ? key : undefined;
};

const VIEWABLE_MAP = {
  fname: true,
  lname: true,
  pronouns: true,
  major: true,
  year: true,
  profileType: true,
  hobby1: false,
  hobby2: false,
  funQuestion1: false,
  funQuestion2: false,
  linkedIn: true,
  profilePictureURL: true,
  additionalLink: true,
  resumeURL: false,
  description: true,
  company: true,
  position: true
};

async function fetchRegistrations() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(
      new QueryCommand({
        TableName: T.registrations,
        IndexName: "event-query",
        KeyConditionExpression: "#ey = :ey",
        ExpressionAttributeNames: { "#ey": "eventID;year" },
        ExpressionAttributeValues: { ":ey": `${EVENT_ID};${YEAR}` },
        ExclusiveStartKey
      })
    );
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

const getOne = async (TableName, Key) =>
  (await db.send(new GetCommand({
    TableName,
    Key
  }))).Item;

function buildProfile(profileID, reg, archetype, now) {
  const b = reg.basicInformation || {};
  return {
    compositeID: `PROFILE#${profileID}`,
    type: "PROFILE",
    profileID,
    fname: b.fname || reg.fname || "",
    lname: b.lname || "",
    pronouns: "",
    major: b.major || "",
    year: b.year || "",
    hobby1: "",
    hobby2: "",
    funQuestion1: "",
    funQuestion2: "",
    linkedIn: "",
    profilePictureURL: "",
    additionalLink: "",
    resumeURL: "",
    description: "",
    profileType: "ATTENDEE",
    archetype,
    createdAt: now,
    updatedAt: now,
    viewableMap: VIEWABLE_MAP
  };
}

async function createEverything(email, reg, archetype) {
  const now = Date.now();
  const profileID = humanId();
  const b = reg.basicInformation || {};
  const items = [
    {
      Put: {
        TableName: T.users,
        Item: {
          id: email,
          profileID,
          fname: b.fname || reg.fname || "",
          lname: b.lname || "",
          createdAt: now,
          updatedAt: now
        },
        ConditionExpression: "attribute_not_exists(id)"
      }
    },
    {
      Put: {
        TableName: T.profiles,
        Item: buildProfile(profileID, reg, archetype, now),
        ConditionExpression: "attribute_not_exists(compositeID)"
      }
    }
  ];
  if (GRANT_MEMBERSHIP) {
    items.push({
      Put: {
        TableName: T.members,
        Item: {
          id: email,
          firstName: b.fname || reg.fname || "",
          lastName: b.lname || "",
          createdAt: now,
          updatedAt: now
        },
        ConditionExpression: "attribute_not_exists(id)"
      }
    });
  }
  await db.send(new TransactWriteCommand({ TransactItems: items }));
  return profileID;
}

async function createProfileForUser(email, reg, archetype) {
  const now = Date.now();
  const profileID = humanId();
  await db.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: T.profiles,
            Item: buildProfile(profileID, reg, archetype, now),
            ConditionExpression: "attribute_not_exists(compositeID)"
          }
        },
        {
          Update: {
            TableName: T.users,
            Key: { id: email },
            UpdateExpression: "set profileID = :p, updatedAt = :t",
            ConditionExpression: "attribute_exists(id) AND attribute_not_exists(profileID)",
            ExpressionAttributeValues: {
              ":p": profileID,
              ":t": now
            }
          }
        }
      ]
    })
  );
  return profileID;
}

async function ensureMembership(email, reg) {
  if (!GRANT_MEMBERSHIP) return false;
  const existing = await getOne(T.members, { id: email });
  if (existing) return false;
  const now = Date.now();
  const b = reg.basicInformation || {};
  await db.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: T.members,
            Item: {
              id: email,
              firstName: b.fname || reg.fname || "",
              lastName: b.lname || "",
              createdAt: now,
              updatedAt: now
            },
            ConditionExpression: "attribute_not_exists(id)"
          }
        }
      ]
    })
  );
  return true;
}

async function setArchetype(profileID, archetype) {
  await db.send(
    new UpdateCommand({
      TableName: T.profiles,
      Key: {
        compositeID: `PROFILE#${profileID}`,
        type: "PROFILE"
      },
      UpdateExpression: "set archetype = :a, updatedAt = :t",
      ExpressionAttributeValues: {
        ":a": archetype,
        ":t": Date.now()
      }
    })
  );
}

async function main() {
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} · ${EVENT_ID};${YEAR} · tables: ${Object.values(T).join(", ")}`);

  const regs = await fetchRegistrations();
  console.log(`${regs.length} registrations`);

  const counts = {
    created: 0,
    profileAdded: 0,
    archetypeSet: 0,
    membershipAdded: 0,
    skipped: 0,
    noArchetype: 0
  };

  for (const reg of regs) {
    const email = String(reg.id || "").toLowerCase();
    const status = reg.registrationStatus;
    if (!email || status === "cancelled") {
      counts.skipped++;
      console.log(`  skip     ${email || "<no id>"} (${status})`);
      continue;
    }

    const archetype = toArchetype(reg.dynamicResponses?.careerInterest);
    if (!archetype) counts.noArchetype++;

    const user = await getOne(T.users, { id: email });
    const label = `${email.padEnd(36)} ${(archetype || "-").padEnd(10)}`;

    if (!user) {
      console.log(`  create   ${label} user+profile${GRANT_MEMBERSHIP ? "+membership" : ""}`);
      if (APPLY) await createEverything(email, reg, archetype);
      counts.created++;
      continue;
    }

    if (!user.profileID) {
      console.log(`  profile  ${label} user exists, adding profile`);
      if (APPLY) {
        await createProfileForUser(email, reg, archetype);
        if (await ensureMembership(email, reg)) counts.membershipAdded++;
      }
      counts.profileAdded++;
      continue;
    }

    const profile = await getOne(T.profiles, {
      compositeID: `PROFILE#${user.profileID}`,
      type: "PROFILE"
    });
    if (!profile) {
      console.log(`  WARN     ${label} user points at missing profile ${user.profileID}`);
      counts.skipped++;
      continue;
    }
    if (APPLY && (await ensureMembership(email, reg))) counts.membershipAdded++;

    if (!archetype) {
      console.log(`  keep     ${label} profile ${user.profileID}, no quiz answer`);
      continue;
    }
    if (profile.archetype === archetype) {
      console.log(`  ok       ${label} profile ${user.profileID}`);
      continue;
    }
    console.log(`  archetype ${label} profile ${user.profileID}: ${profile.archetype || "none"} -> ${archetype}`);
    if (APPLY) await setArchetype(user.profileID, archetype);
    counts.archetypeSet++;
  }

  console.log("\nsummary", counts);
  if (!APPLY) console.log("dry run — re-run with --apply to write");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
