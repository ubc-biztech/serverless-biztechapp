import humanId from "human-id";
import {
  MEMBERS2026_TABLE, PROFILES_TABLE
} from "../../constants/tables";
import db from "../../lib/db";
import helpers from "../../lib/handlerHelpers";
import {
  TYPES
} from "./constants";

export async function createProfile(email) {
  const memberData = await db.getOne(email, MEMBERS2026_TABLE);

  // Check if profile already exists, member entry implies profile entry
  if (memberData.profileID) {
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
    hobby1: false,
    hobby2: false,
    funQuestion1: false,
    funQuestion2: false,
    linkedIn: false,
    profilePictureURL: false,
    additionalLink: false,
    description: false
  };

  // Map registration data to profile schema
  const timestamp = new Date().getTime();
  const profile = {
    compositeID: `PROFILE#${profileID}`,
    type: TYPES.PROFILE,
    fname: memberData.firstName,
    lname: memberData.lastName,
    pronouns: memberData.pronouns || "",
    major: memberData.major,
    year: memberData.year,
    hobby1: "",
    hobby2: "",
    funQuestion1: "",
    funQuestion2: "",
    linkedIn: "",
    profilePictureURL: "",
    additionalLink: "",
    description: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    viewableMap
  };

  // const nfc = {
  //   id: email,
  //   "eventID;year": "member;2026",
  //   type: "NFC_ATTENDEE",
  //   isUnlimitedScans: true,
  //   data: profileID
  // };

  const params = {
    Key: {
      id: email
    },
    TableName: MEMBERS2026_TABLE + (process.env.ENVIRONMENT || ""),
    UpdateExpression: "set profileID = :profileID, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":profileID": profileID,
      ":updatedAt": timestamp
    },
    ReturnValues: "UPDATED_NEW",
    ConditionExpression: "attribute_exists(id)"
  };

  await Promise.all([
    db.create(profile, PROFILES_TABLE),
    // db.create(nfc, QRS_TABLE), redundant?
    db.updateDBCustom(params)
  ]);

  const response = helpers.createResponse(201, {
    message: `Created profile for ${email}`,
    profile
  });

  return response;
}
