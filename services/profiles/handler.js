import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers.js";
import { isEmpty } from "../../lib/utils.js";
import { humanId } from "human-id";
import { PROFILES_TABLE } from "../../constants/tables.js";
import { MEMBERS2026_TABLE } from "../../constants/tables.js";
import {
  MUTABLE_PROFILE_ATTRIBUTES,
  PROFILE_TYPES,
  TYPES
} from "./constants.js";
import {
  buildProfileUpdateParams,
  createProfile,
  filterPublicProfileFields
} from "./helpers.js";
const REGISTRATIONS_TABLE = "biztechRegistrations";
const QRS_TABLE = "biztechQRs";

export const create = async (event, ctx, callback) => {
  try {
    const email = event.requestContext.authorizer.claims.email.toLowerCase();
    const response = await createProfile(
      email,
      email.endsWith("@ubcbiztech.com")
        ? PROFILE_TYPES.EXEC
        : PROFILE_TYPES.ATTENDEE
    );
    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

// deprecated, will be done in another pr
export const createPartialPartnerProfile = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    // Validate input
    helpers.checkPayloadProps(data, {
      email: { required: true, type: "string" },
      eventID: { required: true, type: "string" },
      year: { required: true, type: "number" },
      fname: { required: true, type: "string" },
      lname: { required: true, type: "string" },
      company: { required: true, type: "string" },
      role: { required: true, type: "string" },
      linkedIn: { required: false, type: "string" },
      profilePictureURL: { required: false, type: "string" },
      pronouns: { required: false, type: "string" }
    });

    const {
      email,
      eventID,
      year,
      fname,
      lname,
      company,
      role,
      linkedIn = "",
      profilePictureURL = "",
      pronouns = ""
    } = data;
    const eventIDAndYear = `${eventID};${year}`;

    // Check if profile already exists
    const existingProfile = await db.getOne(email, PROFILES_TABLE, {
      "eventID;year": eventIDAndYear
    });

    if (!isEmpty(existingProfile)) {
      throw helpers.duplicateResponse("Profile", email);
    }

    // Generate profileID
    const profileID = humanId();

    // Create partial partner profile
    const timestamp = new Date().getTime();
    const profile = {
      id: email,
      "eventID;year": eventIDAndYear,
      profileID,
      fname,
      lname,
      pronouns,
      type: "Partner",
      company,
      role,
      linkedIn,
      profilePictureURL,
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
        email
      }
    };

    await Promise.all([
      db.create(profile, PROFILES_TABLE),
      db.create(nfc, QRS_TABLE)
    ]);

    const response = helpers.createResponse(201, {
      message: `Created partial partner profile and NFC for ${email} for event ${eventIDAndYear}`,
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

export const updatePublicProfile = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    const body = JSON.parse(event.body);
    helpers.checkPayloadProps(body, {
      viewableMap: {
        required: true
      }
    });
    const { viewableMap } = body;

    if (
      !viewableMap ||
      Object.prototype.toString.call(viewableMap) !== "[object Object]"
    ) {
      throw helpers.inputError("Viewable map is not a literal object", body);
    }

    const member = await db.getOne(userID, MEMBERS2026_TABLE);
    const { profileID = null } = member || {};

    if (!profileID) {
      throw helpers.notFoundResponse("Profile", userID);
    }

    const compositeID = `PROFILE#${profileID}`;

    const result = await db.query(PROFILES_TABLE, null, {
      expression: "compositeID = :compositeID AND #type = :profileType",
      expressionValues: {
        ":compositeID": compositeID,
        ":profileType": TYPES.PROFILE
      },
      expressionNames: {
        "#type": "type"
      }
    });

    if (!result || result.length == 0) {
      throw helpers.createResponse(404, {
        message: `Profile: ${userID} not found`
      });
    }

    const profile = result[0];

    Object.keys(viewableMap).forEach((key) => {
      if (
        Object.hasOwn(MUTABLE_PROFILE_ATTRIBUTES, key) &&
        typeof viewableMap[key] == "boolean"
      ) {
        profile.viewableMap[key] = viewableMap[key];
      }
    });

    delete body["viewableMap"];

    const updateBody = {};
    Object.keys(body).forEach((key) => {
      if (
        Object.hasOwn(MUTABLE_PROFILE_ATTRIBUTES, key) &&
        typeof body[key] == "string"
      ) {
        updateBody[key] = body[key];
      }
    });

    const updateProfileParam = buildProfileUpdateParams(
      compositeID,
      updateBody,
      profile.viewableMap,
      PROFILES_TABLE,
      new Date().getTime()
    );

    const data = await db.updateDBCustom(updateProfileParam);
    const response = helpers.createResponse(200, {
      message: `successfully updated profile: ${userID}`,
      data
    });
    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const getPublicProfile = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.profileID) {
      throw helpers.missingPathParamResponse("profileID");
    }

    const { profileID } = event.pathParameters;

    // Query using the GSI
    const result = await db.getOneCustom({
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        compositeID: `PROFILE#${profileID}`,
        type: TYPES.PROFILE
      }
    });

    if (!result) {
      throw helpers.notFoundResponse("Profile", profileID);
    }

    // Filter to only include public fields
    const publicProfile = filterPublicProfileFields(result);

    const response = helpers.createResponse(200, publicProfile);
    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const getUserProfile = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();

    const member = await db.getOne(userID, MEMBERS2026_TABLE);
    const { profileID = null } = member || {};

    if (!profileID) {
      throw helpers.notFoundResponse("Profile", userID);
    }

    const result = await db.getOneCustom({
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        compositeID: `PROFILE#${profileID}`,
        type: TYPES.PROFILE
      }
    });

    if (!result) {
      throw helpers.notFoundResponse("Profile", profileID);
    }

    const response = helpers.createResponse(200, result);
    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

// deprecated, will be done in another pr
export const createCompanyProfile = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    // Validate input
    helpers.checkPayloadProps(data, {
      name: { required: true, type: "string" },
      description: { required: true, type: "string" },
      profilePictureURL: { required: true, type: "string" },
      eventID: { required: true, type: "string" },
      year: { required: true, type: "number" }
    });

    // Additional validation for arrays
    if (data.links && !Array.isArray(data.links)) {
      throw helpers.createResponse(400, {
        message: "links must be an array",
        data
      });
    }

    if (data.delegateProfileIDs && !Array.isArray(data.delegateProfileIDs)) {
      throw helpers.createResponse(400, {
        message: "delegateProfileIDs must be an array",
        data
      });
    }

    const {
      name,
      description,
      profilePictureURL,
      eventID,
      year,
      links = [],
      delegateProfileIDs = []
    } = data;
    const eventIDAndYear = `${eventID};${year}`;

    // Format company name to create ID (remove spaces and special characters)
    const companyId = name.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Check if company profile already exists
    const existingProfile = await db.getOne(companyId, PROFILES_TABLE, {
      "eventID;year": eventIDAndYear
    });

    if (!isEmpty(existingProfile)) {
      throw helpers.duplicateResponse("Company Profile", name);
    }

    const timestamp = new Date().getTime();

    const companyProfile = {
      id: companyId,
      "eventID;year": eventIDAndYear,
      profileID: companyId,
      type: "Company",
      name,
      description,
      profilePictureURL,
      links,
      delegateProfileIDs,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // Create QR entry for company
    const qr = {
      id: companyId,
      "eventID;year": eventIDAndYear,
      type: "NFC_COMPANY",
      isUnlimitedScans: true,
      data: {
        companyId
      }
    };

    await Promise.all([
      db.create(companyProfile, PROFILES_TABLE),
      db.create(qr, QRS_TABLE)
    ]);

    const response = helpers.createResponse(201, {
      message: `Created company profile and QR for ${name}`,
      profile: companyProfile,
      qr
    });

    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const linkPartnerToCompany = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    // Validate input
    helpers.checkPayloadProps(data, {
      partnerProfileID: { required: true, type: "string" },
      companyProfileID: { required: true, type: "string" },
      eventID: { required: true, type: "string" },
      year: { required: true, type: "number" }
    });

    const { partnerProfileID, companyProfileID, eventID, year } = data;
    const eventIDAndYear = `${eventID};${year}`;

    // Get company profile
    const companyResults = await db.query(PROFILES_TABLE, "profileID-index", {
      expression: "profileID = :profileID",
      expressionValues: {
        ":profileID": companyProfileID
      }
    });

    if (!companyResults || companyResults.length === 0) {
      throw helpers.notFoundResponse("Company Profile", companyProfileID);
    }

    const companyProfile = companyResults[0];
    if (companyProfile.type !== "Company") {
      throw helpers.createResponse(400, {
        message: "Provided profile ID is not a company profile"
      });
    }

    // Get partner profile
    const partnerResults = await db.query(PROFILES_TABLE, "profileID-index", {
      expression: "profileID = :profileID",
      expressionValues: {
        ":profileID": partnerProfileID
      }
    });

    if (!partnerResults || partnerResults.length === 0) {
      throw helpers.notFoundResponse("Partner Profile", partnerProfileID);
    }

    const partnerProfile = partnerResults[0];
    if (partnerProfile.type !== "Partner") {
      throw helpers.createResponse(400, {
        message: "Provided profile ID is not a partner profile"
      });
    }

    const timestamp = new Date().getTime();

    // Update partner profile with company information
    const partnerUpdateParams = {
      Key: {
        id: partnerProfile.id,
        "eventID;year": eventIDAndYear
      },
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      UpdateExpression:
        "set companyProfileID = :companyProfileID, companyProfilePictureURL = :companyProfilePictureURL, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":companyProfileID": companyProfileID,
        ":companyProfilePictureURL": companyProfile.profilePictureURL,
        ":updatedAt": timestamp
      },
      ReturnValues: "UPDATED_NEW"
    };

    // Update company profile with new delegate
    const companyUpdateParams = {
      Key: {
        id: companyProfile.id,
        "eventID;year": eventIDAndYear
      },
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      UpdateExpression:
        "set delegateProfileIDs = list_append(if_not_exists(delegateProfileIDs, :empty_list), :newDelegate), updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":newDelegate": [partnerProfileID],
        ":empty_list": [],
        ":updatedAt": timestamp
      },
      ReturnValues: "UPDATED_NEW"
    };

    await Promise.all([
      db.updateDBCustom(partnerUpdateParams),
      db.updateDBCustom(companyUpdateParams)
    ]);

    const response = helpers.createResponse(200, {
      message: `Linked partner ${partnerProfileID} to company ${companyProfileID}`,
      companyProfile,
      partnerProfile
    });

    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};

export const syncPartnerData = async (event, ctx, callback) => {
  try {
    // Get all partner profiles
    const partnerProfiles = await db.scan(PROFILES_TABLE, {
      FilterExpression: "#type = :type",
      ExpressionAttributeNames: {
        "#type": "type"
      },
      ExpressionAttributeValues: {
        ":type": "Partner"
      }
    });

    if (!partnerProfiles || partnerProfiles.length === 0) {
      const response = helpers.createResponse(200, {
        message: "No partner profiles found to sync"
      });
      callback(null, response);
      return response;
    }

    const results = await Promise.all(
      partnerProfiles.map(async (profile) => {
        const [eventID, year] = profile["eventID;year"].split(";");

        // Try to find matching registration
        const registration = await db.getOne(profile.id, REGISTRATIONS_TABLE, {
          "eventID;year": profile["eventID;year"]
        });

        if (!registration) {
          // Create registration entry if it doesn't exist
          const timestamp = new Date().getTime();
          const registrationData = {
            id: profile.id,
            "eventID;year": profile["eventID;year"],
            isPartner: true,
            profileID: profile.profileID,
            basicInformation: {
              fname: profile.fname || "",
              lname: profile.lname || "",
              companyName: profile.company || "",
              role: profile.role || "",
              gender: profile.pronouns || ""
            },
            registrationStatus: "registered",
            createdAt: timestamp,
            updatedAt: timestamp,
            dynamicResponses: {} // Ensure this exists even if empty
          };

          await db.create(registrationData, REGISTRATIONS_TABLE);
          return {
            profileID: profile.profileID,
            action: "created_registration",
            email: profile.id
          };
        } else {
          // Safely get dynamic responses with fallbacks
          const dynamicResponses = registration.dynamicResponses || {};

          // Update profile with registration data
          const updateParams = {
            Key: {
              id: profile.id,
              "eventID;year": profile["eventID;year"]
            },
            TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
            UpdateExpression:
              "set fname = :fname, lname = :lname, pronouns = :pronouns, company = :company, #role = :role, hobby1 = :hobby1, hobby2 = :hobby2, funQuestion1 = :funQuestion1, funQuestion2 = :funQuestion2, linkedIn = :linkedIn, additionalLink = :additionalLink, description = :description, updatedAt = :updatedAt",
            ExpressionAttributeNames: {
              "#role": "role"
            },
            ExpressionAttributeValues: {
              ":fname": registration.basicInformation?.fname || "",
              ":lname": registration.basicInformation?.lname || "",
              ":pronouns": registration.basicInformation?.gender || "",
              ":company": registration.basicInformation?.companyName || "",
              ":role": registration.basicInformation?.role || "",
              ":hobby1":
                dynamicResponses["130fac25-e5d7-4fd1-8fd8-d844bfdaef06"] || "",
              ":hobby2":
                dynamicResponses["52a3e21c-e65f-4248-a38d-db93e410fe2c"] || "",
              ":funQuestion1":
                dynamicResponses["3d130254-8f1c-456e-a325-109717ad2bd4"] || "",
              ":funQuestion2":
                dynamicResponses["f535e62d-96ee-4377-a8ac-c7b523d04583"] || "",
              ":linkedIn":
                dynamicResponses["ffcb7fcf-6a24-46a3-bfca-e3dc96b6309f"] || "",
              ":additionalLink":
                dynamicResponses["e164e119-6d47-453b-b215-91837b70e9b7"] || "",
              ":description":
                dynamicResponses["6849bb7f-b8bd-438c-b03b-e046cede378a"] || "",
              ":updatedAt": new Date().getTime()
            }
          };

          // Only update profile picture if it doesn't exist in profile and exists in registration
          if (
            !profile.profilePictureURL &&
            dynamicResponses["1fb1696d-9d90-4e02-9612-3eb9933e6c45"]
          ) {
            updateParams.UpdateExpression +=
              ", profilePictureURL = :profilePictureURL";
            updateParams.ExpressionAttributeValues[":profilePictureURL"] =
              dynamicResponses["1fb1696d-9d90-4e02-9612-3eb9933e6c45"];
          }

          await db.updateDBCustom(updateParams);
          return {
            profileID: profile.profileID,
            action: "synced_from_registration",
            email: profile.id
          };
        }
      })
    );

    const response = helpers.createResponse(200, {
      message: `Synced ${results.length} partner profiles`,
      results
    });

    callback(null, response);
    return response;
  } catch (err) {
    console.error(err);
    callback(null, err);
    return null;
  }
};
