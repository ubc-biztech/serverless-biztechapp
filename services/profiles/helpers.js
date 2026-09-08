import humanId from "human-id";
import {
  MEMBERS_TABLE,
  PROFILES_TABLE,
  USERS_TABLE
} from "../../constants/tables.js";
import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers.js";
import { MUTABLE_PROFILE_ATTRIBUTES, TYPES } from "./constants.js";

const PROFILE_VIEWABLE_MAP = {
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

const buildProfileItem = (
  profileID,
  profileType,
  memberData,
  timestamp = Date.now()
) => ({
  compositeID: `PROFILE#${profileID}`,
  type: TYPES.PROFILE,
  profileID,
  fname: memberData.firstName,
  lname: memberData.lastName,
  pronouns: memberData.pronouns || "",
  major: memberData.major,
  year: memberData.year,
  hobby1: "",
  hobby2: "",
  funQuestion1: "",
  funQuestion2: "",
  linkedIn: memberData.linkedIn || "",
  profilePictureURL: "",
  additionalLink: "",
  resumeURL: "",
  description: "",
  createdAt: timestamp,
  updatedAt: timestamp,
  profileType,
  viewableMap: PROFILE_VIEWABLE_MAP
});

export async function createProfile(email, profileType, onboardingData = null) {
  const [memberData, userData] = await Promise.all([
    onboardingData
      ? Promise.resolve(onboardingData)
      : db.getOne(email, MEMBERS_TABLE),
    db.getOne(email, USERS_TABLE)
  ]);

  if (!memberData) {
    throw helpers.notFoundResponse("member", email);
  }

  if (!userData) {
    throw helpers.notFoundResponse("user", email);
  }

  if (userData.profileID) {
    throw helpers.duplicateResponse("Profile", email);
  }

  // Generate profileID
  const profileID = humanId();

  // Map registration data to profile schema
  const timestamp = new Date().getTime();
  const profile = buildProfileItem(
    profileID,
    profileType,
    memberData,
    timestamp
  );

  const updateParams = {
    UpdateExpression: "set profileID = :profileID, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":profileID": profileID,
      ":updatedAt": timestamp
    },
    ConditionExpression:
      "attribute_exists(id) AND attribute_not_exists(profileID)"
  };

  await db.writeMultiple([
    {
      Put: {
        TableName: PROFILES_TABLE,
        Item: profile,
        ConditionExpression: "attribute_not_exists(compositeID)"
      }
    },
    {
      Update: {
        ...updateParams,
        TableName: USERS_TABLE,
        Key: {
          id: email
        }
      }
    }
  ]);

  const response = helpers.createResponse(201, {
    message: `Created profile for ${email}`,
    profile
  });

  return response;
}

export function buildProfileUpsertParams(
  profileID,
  memberData,
  profileType,
  timestamp = Date.now()
) {
  // Some migrated users have a profileID but no corresponding profile row.
  // Preserve customized fields on existing profiles while supplying a complete
  // default record when DynamoDB creates the missing item during this update.
  const profile = buildProfileItem(
    profileID,
    profileType,
    memberData,
    timestamp
  );
  // Only fields the caller actually supplied overwrite an existing profile.
  // buildProfileItem defaults absent pronouns/linkedIn to "", so checking the
  // built item alone would clobber existing values (e.g. on membership grant).
  const profileKeyToSource = {
    fname: "firstName",
    lname: "lastName",
    pronouns: "pronouns",
    major: "major",
    year: "year",
    linkedIn: "linkedIn"
  };
  const updateExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  Object.entries(profile).forEach(([key, value]) => {
    if (key === "compositeID" || key === "type" || value === undefined) return;

    const sourceKey = profileKeyToSource[key];
    const wasProvided =
      key === "updatedAt" ||
      (sourceKey !== undefined && memberData[sourceKey] !== undefined);

    const nameKey = `#${key}`;
    const valueKey = `:${key}`;
    expressionAttributeNames[nameKey] = key;
    expressionAttributeValues[valueKey] = value;
    updateExpressions.push(
      wasProvided
        ? `${nameKey} = ${valueKey}`
        : `${nameKey} = if_not_exists(${nameKey}, ${valueKey})`
    );
  });

  return {
    Key: {
      compositeID: `PROFILE#${profileID}`,
      type: TYPES.PROFILE
    },
    TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
    UpdateExpression: `SET ${updateExpressions.join(", ")}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: "ALL_NEW",
    ConditionExpression:
      "attribute_not_exists(#profileID) OR #profileID = :profileID"
  };
}

export async function updateProfileFromMembershipData(
  profileID,
  memberData,
  profileType
) {
  const profileFields = {
    firstName: "fname",
    lastName: "lname",
    pronouns: "pronouns",
    major: "major",
    year: "year",
    linkedIn: "linkedIn"
  };

  const normalizedMemberData = {};
  Object.keys(profileFields).forEach((sourceKey) => {
    if (memberData[sourceKey] !== undefined && memberData[sourceKey] !== null) {
      normalizedMemberData[sourceKey] = memberData[sourceKey];
    }
  });

  return db.updateDBCustom(
    buildProfileUpsertParams(profileID, normalizedMemberData, profileType)
  );
}

export function filterPublicProfileFields(profile) {
  const publicFields = {};
  const map = profile.viewableMap;

  for (const key in profile) {
    if (profile.hasOwnProperty(key) && map[key]) {
      publicFields[key] = profile[key];
    }
  }

  return publicFields;
}

/**
 * Builds dynamic update parameters for profile updates
 * @param {string} compositeID - The composeID for the profile string
 * @param {Object} updateData - The data to update (valid attributes from MUTABLE_PROFILE_ATTRIBUTES)
 * @param {Object} viewableMap - The viewable map to update
 * @param {string} tableName - The DynamoDB table name
 * @param {number} timestamp - The update timestamp
 * @returns {Object} DynamoDB update parameters
 */
export const buildProfileUpdateParams = (
  compositeID,
  updateData = {},
  viewableMap,
  tableName,
  timestamp
) => {
  const updateExpressions = [];
  const expressionAttributeValues = {};
  const expressionAttributeNames = {};

  // Add timestamp to updates
  updateExpressions.push("#updatedAt = :updatedAt");
  expressionAttributeValues[":updatedAt"] = timestamp;
  expressionAttributeNames["#updatedAt"] = "updatedAt";

  // Process valid mutable attributes
  Object.keys(updateData).forEach((key) => {
    if (Object.hasOwn(MUTABLE_PROFILE_ATTRIBUTES, key)) {
      const attrName = `#${key}`;
      const attrValue = `:${key}`;

      updateExpressions.push(`${attrName} = ${attrValue}`);
      expressionAttributeValues[attrValue] = updateData[key];
      expressionAttributeNames[attrName] = key;
    }
  });

  // Add viewableMap update if provided
  if (viewableMap !== null) {
    updateExpressions.push("#viewableMap = :viewableMap");
    expressionAttributeValues[":viewableMap"] = viewableMap;
    expressionAttributeNames["#viewableMap"] = "viewableMap";
  }

  return {
    Key: {
      compositeID,
      type: TYPES.PROFILE
    },
    TableName: tableName + (process.env.ENVIRONMENT || ""),
    UpdateExpression: `SET ${updateExpressions.join(", ")}`,
    ExpressionAttributeValues: expressionAttributeValues,
    ExpressionAttributeNames: expressionAttributeNames,
    ReturnValues: "UPDATED_NEW"
  };
};
