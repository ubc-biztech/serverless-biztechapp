import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers.js";
import {
  isEmpty
} from "../../lib/utils.js";
import {
  humanId
} from "human-id";
import {
  PROFILES_TABLE
} from "../../constants/tables.js";
const REGISTRATIONS_TABLE = "biztechRegistrations";
const QRS_TABLE = "biztechQRs";

export const createProfile = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    // Validate input
    helpers.checkPayloadProps(data, {
      email: {
        required: true,
        type: "string"
      },
      eventID: {
        required: true,
        type: "string"
      },
      year: {
        required: true,
        type: "number"
      }
    });

    const {
      email, eventID, year
    } = data;
    const eventIDAndYear = `${eventID};${year}`;

    // Check if profile already exists
    const existingProfile = await db.getOne(email, PROFILES_TABLE, {
      "eventID;year": eventIDAndYear
    });

    if (!isEmpty(existingProfile)) {
      throw helpers.duplicateResponse("Profile", email);
    }

    // Get registration data
    const registration = await db.getOne(email, REGISTRATIONS_TABLE, {
      "eventID;year": eventIDAndYear
    });

    if (isEmpty(registration)) {
      throw helpers.notFoundResponse("Registration", email);
    }

    // Generate profileID
    const profileID = humanId();

    // Map registration data to profile schema
    const timestamp = new Date().getTime();
    const profile = {
      id: email,
      "eventID;year": eventIDAndYear,
      profileID,
      fname: registration.basicInformation.fname,
      lname: registration.basicInformation.lname,
      pronouns: registration.basicInformation.gender && registration.basicInformation.gender.length ? registration.basicInformation.gender[0] : "",
      type: registration.isPartner ? "Partner" : "Attendee",
      major: registration.basicInformation.major,
      year: registration.basicInformation.year,
      hobby1: registration.dynamicResponses["130fac25-e5d7-4fd1-8fd8-d844bfdaef06"] || "",
      hobby2: registration.dynamicResponses["52a3e21c-e65f-4248-a38d-db93e410fe2c"] || "",
      funQuestion1: registration.dynamicResponses["3d130254-8f1c-456e-a325-109717ad2bd4"] || "",
      funQuestion2: registration.dynamicResponses["f535e62d-96ee-4377-a8ac-c7b523d04583"] || "",
      linkedIn: registration.dynamicResponses["ffcb7fcf-6a24-46a3-bfca-e3dc96b6309f"] || "",
      profilePictureURL: registration.dynamicResponses["1fb1696d-9d90-4e02-9612-3eb9933e6c45"] || "",
      additionalLink: registration.dynamicResponses["e164e119-6d47-453b-b215-91837b70e9b7"] || "",
      description: registration.dynamicResponses["6849bb7f-b8bd-438c-b03b-e046cede378a"] || "",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // Create NFC entry
    const nfc = {
      id: profileID,
      "eventID;year": eventIDAndYear,
      type: "NFC_ATTENDEE",
      isUnlimitedScans: true,
      data: {
        registrationID: registration.id
      }
    };

    const params = {
      Key: {
        id: email,
        "eventID;year": eventIDAndYear
      },
      TableName: REGISTRATIONS_TABLE + (process.env.ENVIRONMENT || ""),
      UpdateExpression: "set profileID = :profileID, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":profileID": profileID,
        ":updatedAt": timestamp
      },
      ReturnValues: "UPDATED_NEW",
      ConditionExpression: "attribute_exists(id) and attribute_exists(#eventIDYear)",
      ExpressionAttributeNames: {
        "#eventIDYear": "eventID;year"
      }
    };

    await Promise.all([
      db.create(profile, PROFILES_TABLE),
      db.create(nfc, QRS_TABLE),
      db.updateDBCustom(params)
    ]);

    const response = helpers.createResponse(201, {
      message: `Created profile and NFC for ${email} for event ${eventIDAndYear}`,
      profile,
      nfc
    });

    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

const filterPublicProfileFields = (profile) => ({
  profileID: profile.profileID,
  fname: profile.fname,
  lname: profile.lname,
  pronouns: profile.pronouns,
  type: profile.type,
  major: profile.major,
  year: profile.year,
  hobby1: profile.hobby1,
  hobby2: profile.hobby2,
  funQuestion1: profile.funQuestion1,
  funQuestion2: profile.funQuestion2,
  linkedIn: profile.linkedIn,
  profilePictureURL: profile.profilePictureURL,
  additionalLink: profile.additionalLink,
  description: profile.description,
  "eventID;year": profile["eventID;year"],
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt
});

export const getProfile = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.profileID) {
      throw helpers.missingPathParamResponse("profileID");
    }

    const {
      profileID
    } = event.pathParameters;

    // Query using the GSI
    const result = await db.query(PROFILES_TABLE, "profileID-index", {
      expression: "profileID = :profileID",
      expressionValues: {
        ":profileID": profileID
      }
    });

    if (!result || result.length === 0) {
      throw helpers.notFoundResponse("Profile", profileID);
    }

    // Filter to only include public fields
    const publicProfile = filterPublicProfileFields(result[0]);

    const response = helpers.createResponse(200, publicProfile);
    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const getProfileByEmail = async (event, ctx, callback) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.email ||
      !event.pathParameters.eventID ||
      !event.pathParameters.year
    ) {
      throw helpers.missingPathParamResponse("email, eventID, or year");
    }

    const {
      email, eventID, year
    } = event.pathParameters;
    const eventIDAndYear = `${eventID};${year}`;

    // Get profile by email and eventID;year
    const profile = await db.getOne(email, PROFILES_TABLE, {
      "eventID;year": eventIDAndYear
    });

    if (!profile) {
      throw helpers.notFoundResponse("Profile", email);
    }

    const response = helpers.createResponse(200, {
      profileID: profile.profileID
    });

    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};
