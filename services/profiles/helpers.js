import humanId from "human-id";
import {
  MEMBERS_TABLE,
  PROFILES_TABLE,
  USERS_TABLE
} from "../../constants/tables";
import db from "../../lib/db";
import helpers from "../../lib/handlerHelpers";
import { MUTABLE_PROFILE_ATTRIBUTES, TYPES } from "./constants";

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

  const viewableMap = {
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

  // Map registration data to profile schema
  const timestamp = new Date().getTime();
  const profile = {
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
    viewableMap
  };

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

export async function updateProfileFromMembershipData(profileID, memberData) {
  const updateData = {};

  const profileFields = {
    firstName: "fname",
    lastName: "lname",
    pronouns: "pronouns",
    major: "major",
    year: "year",
    linkedIn: "linkedIn"
  };

  Object.entries(profileFields).forEach(([sourceKey, profileKey]) => {
    if (memberData[sourceKey] !== undefined && memberData[sourceKey] !== null) {
      updateData[profileKey] = memberData[sourceKey];
    }
  });

  if (Object.keys(updateData).length === 0) {
    return null;
  }

  const updateExpressions = ["#updatedAt = :updatedAt"];
  const expressionAttributeNames = {
    "#updatedAt": "updatedAt",
    "#type": "type"
  };
  const expressionAttributeValues = {
    ":updatedAt": Date.now()
  };

  Object.entries(updateData).forEach(([key, value]) => {
    expressionAttributeNames[`#${key}`] = key;
    expressionAttributeValues[`:${key}`] = value;
    updateExpressions.push(`#${key} = :${key}`);
  });

  return db.updateDBCustom({
    Key: {
      compositeID: `PROFILE#${profileID}`,
      type: TYPES.PROFILE
    },
    TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
    UpdateExpression: `SET ${updateExpressions.join(", ")}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: "UPDATED_NEW",
    ConditionExpression:
      "attribute_exists(compositeID) AND attribute_exists(#type)"
  });
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
